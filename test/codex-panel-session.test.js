import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, renameSync, rmSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPanelBinding, bindPanelSession, readPanelBinding } from '../src/codex-panel-session.js';
import { createPanelReader, formatCodexPanel } from '../src/codex-panel.js';
import { childEnv } from './helpers/child-env.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const jsonl = (records) => records.map(JSON.stringify).join('\n') + '\n';
const usage = (input) => ({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'token_count', info: {
  total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 10 },
  last_token_usage: { input_tokens: input }, model_context_window: 200000,
} } });

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'sprag-session-'));
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  mkdirSync(join(home, 'sessions'));
  const root = join(home, 'project');
  mkdirSync(root);
  const log = (id, input, source = 'cli') => {
    const file = join(home, 'sessions', `${id}.jsonl`);
    writeFileSync(file, jsonl([{ type: 'session_meta', payload: { id, cwd: root, source } }, usage(input)]));
    return file;
  };
  const bind = (file, id, transcript, source = 'startup') => bindPanelSession('session-start', {
    session_id: id, transcript_path: transcript, source, cwd: root,
  }, { file });
  const a = join(home, 'launch-a.json'), b = join(home, 'launch-b.json');
  createPanelBinding(a);
  createPanelBinding(b);
  return { home, root, log, bind, a, b };
}

test('same-project inline panels remain independent while either session changes', async (t) => {
  const f = fixture(t);
  const one = f.log('one', 20000), two = f.log('two', 170000);
  f.bind(f.a, 'one', one);
  f.bind(f.b, 'two', two);
  const readA = createPanelReader({ root: f.root, home: f.home, sessionFile: f.a });
  const readB = createPanelReader({ root: f.root, home: f.home, sessionFile: f.b });
  assert.equal((await readA()).session.lastContextTokens, 20000);
  assert.equal((await readB()).session.lastContextTokens, 170000);
  appendFileSync(two, jsonl([usage(190000)]));
  assert.equal((await readA()).session.lastContextTokens, 20000);
  assert.equal((await readB()).session.lastContextTokens, 190000);
  appendFileSync(one, jsonl([usage(40000)]));
  assert.equal((await readA()).session.lastContextTokens, 40000);
  assert.equal((await readB()).session.lastContextTokens, 190000);
  const render = (data) => formatCodexPanel(data, { compact: true, columns: 200, rows: 20, color: false });
  assert.match(render(await readA()), /20.0%[\s\S]*session \.\.\.one/);
  assert.match(render(await readB()), /95.0%[\s\S]*session \.\.\.two/);
  assert.doesNotMatch(render(await readA()), /latest project|95.0%/);
});

test('pending, missing, malformed, or mismatched bindings never show the latest project', async (t) => {
  const f = fixture(t);
  const one = f.log('one', 170000);
  const read = createPanelReader({ root: f.root, home: f.home, sessionFile: f.a });
  assert.equal((await read()).session, null);
  assert.equal((await read()).bindingPending, true);
  assert.match(formatCodexPanel(await read(), { compact: true, color: false }), /Waiting for session binding/);
  f.bind(f.a, 'missing', one);
  assert.equal((await read()).session, null, 'transcript metadata must match the bound ID');
  writeFileSync(f.a, '{partial');
  assert.equal((await read()).session, null);
  rmSync(f.a);
  assert.equal((await read()).session, null);
  assert.equal(f.bind(f.a, 'one', one), false);
  assert.equal(existsSync(f.a), false, 'late hooks cannot recreate a closed launcher binding');
  assert.throws(() => createPanelReader({ sessionId: 'one', sessionFile: f.b }), /not both/);
});

test('resume, clear, compaction, and archived old logs retain exact identity', async (t) => {
  const f = fixture(t);
  const old = f.log('old', 160000), newer = f.log('newer', 40000);
  const stale = new Date(Date.now() - 90 * 86400000);
  utimesSync(old, stale, stale);
  f.bind(f.a, 'old', old, 'resume');
  const read = createPanelReader({ root: f.root, home: f.home, sessionFile: f.a, days: 1 });
  assert.equal((await read()).session.sessionId, 'old');
  assert.equal((await createPanelReader({ home: f.home, sessionId: 'old', days: 1 })()).session.sessionId, 'old');
  mkdirSync(join(f.home, 'archived_sessions'));
  renameSync(old, join(f.home, 'archived_sessions', 'old.jsonl'));
  assert.equal((await read()).session.sessionId, 'old', 'moved transcript falls back to ID, without a time cutoff');
  f.bind(f.a, 'newer', newer, 'clear');
  assert.equal((await read()).session.sessionId, 'newer');
  assert.equal(f.bind(f.a, 'old', old, 'compact'), false, 'an old background session cannot replace the newly selected session');
  appendFileSync(newer, jsonl([usage(10000)]));
  f.bind(f.a, 'newer', newer, 'compact');
  assert.equal((await read()).session.lastContextTokens, 10000);
});

test('subagent hooks and child logs do not take over a bound main-session panel', async (t) => {
  const f = fixture(t);
  const main = f.log('main', 40000);
  const child = f.log('child', 190000, { subagent: { thread_spawn: { parent_thread_id: 'main' } } });
  f.bind(f.a, 'main', main);
  const before = readFileSync(f.a, 'utf8');
  for (const event of ['subagent-start', 'prompt', 'post-tool']) {
    assert.equal(bindPanelSession(event, { session_id: 'child', transcript_path: child, source: 'startup' }, { file: f.a }), false);
  }
  assert.equal(readFileSync(f.a, 'utf8'), before);
  f.bind(f.a, 'child', child);
  assert.equal((await createPanelReader({ home: f.home, sessionFile: f.a })()).session, null);
  assert.equal((await createPanelReader({ home: f.home, sessionId: 'child' })()).session.sessionId, 'child');
});

test('real CLI hooks bind inline panels even with panel auto-start suppressed', (t) => {
  const f = fixture(t);
  const one = f.log('one', 20000);
  const env = childEnv({ HOME: f.home, CODEX_HOME: f.home, XDG_CONFIG_HOME: join(f.home, 'cfg'),
    SPRAG_CODEX_PANEL: '1', SPRAG_CODEX_PANEL_BINDING: f.a, CTS_NO_KOREAN: '1' });
  for (const event of ['session-start', 'panel-start']) {
    createPanelBinding(f.a);
    const result = spawnSync(process.execPath, [CLI, 'codex-hook', '--agent', 'codex', '--event', event], {
      env, input: JSON.stringify({ session_id: 'one', transcript_path: one, cwd: f.root, source: 'resume' }), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readPanelBinding(f.a).sessionId, 'one');
  }
  const panel = spawnSync(process.execPath, [CLI, 'panel', '--agent', 'codex', '--once', '--compact', '--text', '--session-file', f.a], {
    env, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(panel.status, 0, panel.stderr);
  assert.match(panel.stdout, /session \.\.\.one/);
  assert.match(panel.stdout, /10.0%/);
  assert.doesNotMatch(panel.stdout, /latest project/);
});
