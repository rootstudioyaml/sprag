/**
 * team-prompts — extraction, redaction, byte-offset handling, the consent boundary,
 * policy off, the pause switch and the per-run caps. fetch/put are mocked and every
 * path lives in a temp directory: no test reads the real ~/.claude or ~/.codex.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync, truncateSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  redactSecrets, claudePromptFromLine, codexPromptFromLine, uploadPrompts, pendingPrompts, loadOffsets,
  promptOffsetsPath, MAX_CHUNK_PROMPTS,
} from '../src/team-prompts.js';
import { syncTeam, saveTeamState, loadTeamState, deviceInfo } from '../src/team-sync.js';
import { userDataDir } from '../src/paths.js';

const ENV_KEYS = ['XDG_CONFIG_HOME', 'HOME', 'USERPROFILE', 'CODEX_HOME', 'SPRAG_NO_TEAM_SYNC', 'CTS_NO_TEAM_SYNC', 'SPRAG_TEAM_TOKEN'];

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'sprag-prompts-'));
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.XDG_CONFIG_HOME = join(root, 'xdg');
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.CODEX_HOME = join(root, '.codex');
  for (const k of ['SPRAG_NO_TEAM_SYNC', 'CTS_NO_TEAM_SYNC', 'SPRAG_TEAM_TOKEN']) delete process.env[k];
  const dir = userDataDir();
  mkdirSync(dir, { recursive: true });
  const claudeDir = join(root, '.claude');
  const codexDir = join(root, '.codex');
  mkdirSync(join(claudeDir, 'projects', '-work-app'), { recursive: true });
  mkdirSync(join(codexDir, 'sessions', '2026', '10', '18'), { recursive: true });
  t.after(() => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { root, dir, claudeDir, codexDir, session: join(claudeDir, 'projects', '-work-app', 's1.jsonl') };
}

const TS = (n) => `2026-10-18T10:${String(n % 60).padStart(2, '0')}:00.000Z`;
const cl = (text, n = 1, extra = {}) => JSON.stringify({
  type: 'user', timestamp: TS(n), cwd: '/Users/dev/work/app', message: { role: 'user', content: text }, ...extra,
}) + '\n';
const assistant = (n = 1) => JSON.stringify({ type: 'assistant', timestamp: TS(n), message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } }) + '\n';

function recorder(reply = (c) => ({ accepted: c.prompts.length, duplicate: false })) {
  const calls = [];
  const put = async (p) => { calls.push(p); return reply(p, calls.length); };
  put.calls = calls;
  return put;
}

// -- extraction --------------------------------------------------------------

test('claude: keeps typed prompts, drops tool results, meta, wrappers, reminders, assistant lines', () => {
  assert.deepEqual(claudePromptFromLine(cl('fix the build', 3).trim()), { at: TS(3), project: 'app', text: 'fix the build' });
  const parts = JSON.stringify({ type: 'user', timestamp: TS(1), cwd: 'C:\\Users\\dev\\win-app', message: { content: [{ type: 'text', text: 'look at this' }, { type: 'image', source: {} }] } });
  assert.equal(claudePromptFromLine(parts).text, 'look at this');
  assert.equal(claudePromptFromLine(parts).project, 'win-app');
  const toolResult = JSON.stringify({ type: 'user', timestamp: TS(1), message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'secret file body' }] } });
  assert.equal(claudePromptFromLine(toolResult), null);
  assert.equal(claudePromptFromLine(cl('meta text', 1, { isMeta: true }).trim()), null);
  assert.equal(claudePromptFromLine(cl('side', 1, { isSidechain: true }).trim()), null);
  for (const w of ['<command-name>/model</command-name>', '<command-message>x</command-message>', '<local-command-stdout>ok</local-command-stdout>', '<local-command-caveat>c</local-command-caveat>']) {
    assert.equal(claudePromptFromLine(cl(w).trim()), null, w);
  }
  assert.equal(claudePromptFromLine(cl('<system-reminder>only reminder</system-reminder>').trim()), null);
  assert.equal(claudePromptFromLine(cl('hello <system-reminder>noise</system-reminder>').trim()).text, 'hello');
  assert.equal(claudePromptFromLine(assistant().trim()), null);
  assert.equal(claudePromptFromLine('not json'), null);
});

test('codex: reads UserMessage and legacy user_message, skips injected context', () => {
  const item = (text) => JSON.stringify({ timestamp: TS(2), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text }] } } });
  const legacy = (message) => JSON.stringify({ timestamp: TS(2), type: 'event_msg', payload: { type: 'user_message', message } });
  assert.deepEqual(codexPromptFromLine(item('where is X')), { at: TS(2), text: 'where is X' });
  assert.equal(codexPromptFromLine(legacy('old style')).text, 'old style');
  assert.equal(codexPromptFromLine(item('<environment_context>cwd</environment_context>')), null);
  assert.equal(codexPromptFromLine(legacy('# AGENTS.md instructions\n\nrules')), null);
  const agentMsg = JSON.stringify({ timestamp: TS(2), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: 'reply' }] } } });
  assert.equal(codexPromptFromLine(agentMsg), null);
  const resp = JSON.stringify({ timestamp: TS(2), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'dup' }] } });
  assert.equal(codexPromptFromLine(resp), null);
});

// -- redaction ---------------------------------------------------------------

test('redactSecrets replaces keys, tokens, bearer, private keys and assignments', () => {
  const cases = [
    ['use sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv now', 'use [redacted] now'],
    ['key sk-proj-AbCdEfGhIjKlMnOpQrSt1234', 'key [redacted]'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789 and gho_abcdefghijklmnopqrstuvwxyz0123', '[redacted] and [redacted]'],
    ['github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuv', '[redacted]'],
    ['aws AKIAIOSFODNN7EXAMPLE end', 'aws [redacted] end'],
    ['slack xoxb-1234567890-abcdefghij', 'slack [redacted]'],
    ['Authorization: Bearer abcdef0123456789.XYZ_token-value', 'Authorization: Bearer [redacted]'],
    ['API_KEY=abc123 and NPM_TOKEN="quoted value" PASSWORD=hunter2 SECRET=\'x y\'', 'API_KEY=[redacted] and NPM_TOKEN=[redacted] PASSWORD=[redacted] SECRET=[redacted]'],
    ['before\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\nafter', 'before\n[redacted]\nafter'],
    ['cut -----BEGIN PRIVATE KEY-----\nMIIabc', 'cut [redacted]'],
  ];
  for (const [input, want] of cases) assert.equal(redactSecrets(input), want);
  assert.equal(redactSecrets('plain text with sk-short and a key idea'), 'plain text with sk-short and a key idea');
  assert.equal(claudePromptFromLine(cl('deploy with GH=ghp_abcdefghijklmnopqrstuvwxyz0123456789').trim()).text, 'deploy with GH=[redacted]');
});

// -- offsets / consent boundary ---------------------------------------------

test('first run with capture on pins existing files at EOF: no backfill; later appends upload', async (t) => {
  const sb = sandbox(t);
  writeFileSync(sb.session, cl('old 1', 1) + cl('old 2', 2));
  const put = recorder();
  const first = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(first.initialized, true);
  assert.equal(put.calls.length, 0);
  assert.equal(loadOffsets(sb.dir)[sb.session].offset, readFileSync(sb.session).length);

  appendFileSync(sb.session, assistant(3) + cl('new 1', 4) + cl('new 2', 5));
  const second = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(second.uploaded, 2);
  assert.deepEqual(put.calls[0].prompts.map((p) => p.text), ['new 1', 'new 2']);
  assert.equal(put.calls[0].source, 'claude');
  assert.match(put.calls[0].file_key, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(put.calls[0]).includes(sb.root), 'no local path is sent');
  assert.equal(put.calls[0].end_offset, readFileSync(sb.session).length);

  const third = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(third.uploaded, 0);
  assert.equal(put.calls.length, 1, 'nothing new, no call');
});

test('files created after the boundary start at offset 0; subagent transcripts are never read', async (t) => {
  const sb = sandbox(t);
  await uploadPrompts({ put: recorder(), dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  const fresh = join(sb.claudeDir, 'projects', '-work-app', 's2.jsonl');
  writeFileSync(fresh, cl('brand new session', 1));
  mkdirSync(join(sb.claudeDir, 'projects', '-work-app', 's2', 'subagents'), { recursive: true });
  writeFileSync(join(sb.claudeDir, 'projects', '-work-app', 's2', 'subagents', 'agent-1.jsonl'), cl('subagent prompt', 1));
  const put = recorder();
  const r = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(r.uploaded, 1);
  assert.equal(put.calls[0].prompts[0].text, 'brand new session');
});

test('a partial last line waits for its newline', async (t) => {
  const sb = sandbox(t);
  writeFileSync(sb.session, '');
  await uploadPrompts({ put: recorder(), dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  const line = cl('half written', 1);
  appendFileSync(sb.session, cl('complete', 1) + line.slice(0, 30));
  const put = recorder();
  await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.deepEqual(put.calls[0].prompts.map((p) => p.text), ['complete']);
  appendFileSync(sb.session, line.slice(30));
  await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.deepEqual(put.calls[1].prompts.map((p) => p.text), ['half written']);
  assert.equal(put.calls[1].start_offset, put.calls[0].end_offset);
});

test('a shrunk file or a new inode restarts at 0', async (t) => {
  const sb = sandbox(t);
  writeFileSync(sb.session, cl('a long first line to push the offset up', 1) + cl('second', 2));
  await uploadPrompts({ put: recorder(), dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  truncateSync(sb.session, 0);
  appendFileSync(sb.session, cl('x', 3));
  const put = recorder();
  let r = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(r.uploaded, 1);
  assert.equal(put.calls[0].start_offset, 0);
  // rotate: same size or larger content, different inode
  const offs = loadOffsets(sb.dir);
  const rotated = sb.session + '.new';
  writeFileSync(rotated, cl('rotated one', 4) + cl('rotated two', 5) + cl('rotated three', 6));
  renameSync(rotated, sb.session);
  assert.notEqual(loadOffsets(sb.dir)[sb.session].ino, undefined);
  void offs;
  r = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(r.uploaded, 3);
  assert.equal(put.calls[1].start_offset, 0);
});

test('offsets advance only after the server accepts; a failure keeps them and retries the same range', async (t) => {
  const sb = sandbox(t);
  writeFileSync(sb.session, '');
  await uploadPrompts({ put: recorder(), dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  appendFileSync(sb.session, cl('p1', 1) + cl('p2', 2));
  const failing = async () => { throw new Error('prompt_chunk_put: HTTP 500'); };
  const r = await uploadPrompts({ put: failing, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.match(r.error, /500/);
  assert.equal(loadOffsets(sb.dir)[sb.session].offset, 0);
  const put = recorder();
  const ok = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(ok.uploaded, 2);
  assert.equal(put.calls[0].start_offset, 0);
});

test('a duplicate answer also advances the offset', async (t) => {
  const sb = sandbox(t);
  writeFileSync(sb.session, '');
  await uploadPrompts({ put: recorder(), dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  appendFileSync(sb.session, cl('seen before', 1));
  const put = recorder(() => ({ accepted: 0, duplicate: true }));
  const r = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(r.duplicates, 1);
  assert.equal(r.uploaded, 0);
  assert.equal(loadOffsets(sb.dir)[sb.session].offset, readFileSync(sb.session).length);
  await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(put.calls.length, 1);
});

test('codex sessions: project from session_meta, one prompt per turn, subagent sessions skipped', async (t) => {
  const sb = sandbox(t);
  await uploadPrompts({ put: recorder(), dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  const meta = (extra = {}) => JSON.stringify({ timestamp: TS(0), type: 'session_meta', payload: { cwd: '/Users/dev/repos/cx-proj', thread_source: 'user', source: 'exec', ...extra } }) + '\n';
  const item = (text, n) => JSON.stringify({ timestamp: TS(n), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text }] } } }) + '\n';
  const legacy = (text, n) => JSON.stringify({ timestamp: TS(n), type: 'event_msg', payload: { type: 'user_message', message: text } }) + '\n';
  const main = join(sb.codexDir, 'sessions', '2026', '10', '18', 'rollout-main.jsonl');
  const sub = join(sb.codexDir, 'sessions', '2026', '10', '18', 'rollout-sub.jsonl');
  writeFileSync(main, meta() + item('ask codex', 1) + legacy('ask codex', 1) + item('second ask', 2));
  writeFileSync(sub, meta({ thread_source: 'subagent', source: { subagent: { thread_spawn: {} } } }) + item('child task', 1));
  const put = recorder();
  const r = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(r.uploaded, 2);
  assert.equal(put.calls.length, 1);
  assert.equal(put.calls[0].source, 'codex');
  assert.deepEqual(put.calls[0].prompts.map((p) => [p.project, p.text]), [['cx-proj', 'ask codex'], ['cx-proj', 'second ask']]);
});

// -- caps --------------------------------------------------------------------

test('chunks hold at most 500 prompts and ranges are contiguous', async (t) => {
  const sb = sandbox(t);
  writeFileSync(sb.session, '');
  await uploadPrompts({ put: recorder(), dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  let body = '';
  for (let i = 0; i < 1200; i++) body += cl(`prompt ${i}`, i);
  appendFileSync(sb.session, body);
  const put = recorder();
  const r = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(r.uploaded, 1200);
  assert.deepEqual(put.calls.map((c) => c.prompts.length), [MAX_CHUNK_PROMPTS, MAX_CHUNK_PROMPTS, 200]);
  assert.equal(put.calls[1].start_offset, put.calls[0].end_offset);
  assert.equal(put.calls[2].start_offset, put.calls[1].end_offset);
});

test('the per-run prompt cap leaves the rest for the next run', async (t) => {
  const sb = sandbox(t);
  writeFileSync(sb.session, '');
  await uploadPrompts({ put: recorder(), dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  let body = '';
  for (let i = 0; i < 30; i++) body += cl(`prompt ${i}`, i);
  appendFileSync(sb.session, body);
  const put = recorder();
  const r1 = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir, maxPrompts: 12 });
  assert.equal(r1.uploaded, 12);
  assert.equal(r1.capped, true);
  const r2 = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir, maxPrompts: 12 });
  assert.equal(r2.uploaded, 12);
  const r3 = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir, maxPrompts: 12 });
  assert.equal(r3.uploaded, 6);
  const texts = put.calls.flatMap((c) => c.prompts.map((p) => p.text));
  assert.deepEqual(texts, Array.from({ length: 30 }, (_, i) => `prompt ${i}`), 'every prompt exactly once, in order');
});

test('the per-run byte cap stops before the limit', async (t) => {
  const sb = sandbox(t);
  writeFileSync(sb.session, '');
  await uploadPrompts({ put: recorder(), dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  appendFileSync(sb.session, cl('a'.repeat(1000), 1) + cl('b'.repeat(1000), 2) + cl('c'.repeat(1000), 3));
  const put = recorder();
  const r = await uploadPrompts({ put, dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir, maxBytes: 2500 });
  assert.equal(r.uploaded, 2);
  assert.equal(r.capped, true);
});

test('pendingPrompts counts and shows one example cut to 80 characters', async (t) => {
  const sb = sandbox(t);
  writeFileSync(sb.session, '');
  await uploadPrompts({ put: recorder(), dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  appendFileSync(sb.session, cl('k'.repeat(300) + ' API_KEY=abc', 1) + cl('two', 2));
  const p = await pendingPrompts({ dir: sb.dir, claudeDir: sb.claudeDir, codexDir: sb.codexDir });
  assert.equal(p.count, 2);
  assert.equal(p.example.text.length, 80);
  assert.equal(p.example.project, 'app');
  assert.equal(loadOffsets(sb.dir)[sb.session].offset, 0, 'looking does not advance anything');
});

// -- syncTeam wiring ---------------------------------------------------------

function fakeFetch({ capture = true, putReply, rulesCapture } = {}) {
  const calls = [];
  const f = async (url, init) => {
    const fn = url.split('/rpc/')[1];
    const body = JSON.parse(init.body);
    calls.push({ fn, body });
    let r = true;
    if (fn === 'team_rules_get') r = { team_name: 'Acme', plan: 'enterprise', prompt_capture: rulesCapture ?? capture, rules: [], removed: [] };
    if (fn === 'prompt_chunk_put') {
      r = putReply ? putReply(body) : { accepted: body.prompts.length, duplicate: false };
      if (r && r.error) return { ok: false, status: 400, json: async () => ({ message: r.error }) };
    }
    return { ok: true, status: 200, json: async () => r };
  };
  f.calls = calls;
  return f;
}
const joined = (extra = {}) => ({ version: 1, memberKey: 'spk_secret', teamName: 'Acme', displayName: 'me', plan: 'enterprise', promptCapture: true, lastSyncAt: null, deviceInfo: deviceInfo(), ...extra });

test('syncTeam uploads prompts after the ledger when capture is on; no backfill on the first sync', async (t) => {
  const sb = sandbox(t);
  saveTeamState(joined(), sb.dir);
  writeFileSync(sb.session, cl('history before policy', 1));
  const f = fakeFetch();
  let r = await syncTeam({ force: true, fetch: f, sessions: [] });
  assert.equal(r.prompts, 0);
  assert.equal(f.calls.filter((c) => c.fn === 'prompt_chunk_put').length, 0);
  appendFileSync(sb.session, cl('typed after', 2));
  r = await syncTeam({ force: true, fetch: f, sessions: [] });
  assert.equal(r.prompts, 1);
  const order = f.calls.map((c) => c.fn);
  assert.ok(order.indexOf('ledger_upsert') < order.indexOf('prompt_chunk_put'));
  const put = f.calls.find((c) => c.fn === 'prompt_chunk_put');
  assert.equal(put.body.member_key, 'spk_secret');
  assert.equal(put.body.prompts[0].text, 'typed after');
  const st = loadTeamState(sb.dir);
  assert.equal(st.lastPromptCount, 1);
  assert.ok(st.lastPromptUploadAt > 0);
});

test('policy off drops the offsets file; turning it on again starts at EOF', async (t) => {
  const sb = sandbox(t);
  saveTeamState(joined(), sb.dir);
  writeFileSync(sb.session, cl('one', 1));
  await syncTeam({ force: true, fetch: fakeFetch(), sessions: [] });
  assert.ok(existsSync(promptOffsetsPath(sb.dir)));
  const off = fakeFetch({ rulesCapture: false });
  const r = await syncTeam({ force: true, fetch: off, sessions: [] });
  assert.equal(r.prompts, undefined);
  assert.ok(!existsSync(promptOffsetsPath(sb.dir)));
  assert.equal(off.calls.filter((c) => c.fn === 'prompt_chunk_put').length, 0);
  assert.equal(loadTeamState(sb.dir).promptCapture, false);
  appendFileSync(sb.session, cl('written while off', 2));
  const on = fakeFetch({ rulesCapture: true });
  await syncTeam({ force: true, fetch: on, sessions: [] });
  assert.equal(on.calls.filter((c) => c.fn === 'prompt_chunk_put').length, 0, 'what was typed while off is never uploaded');
});

test("server 'prompt capture is off' flips the local flag and clears offsets", async (t) => {
  const sb = sandbox(t);
  saveTeamState(joined(), sb.dir);
  writeFileSync(sb.session, '');
  await syncTeam({ force: true, fetch: fakeFetch(), sessions: [] });
  appendFileSync(sb.session, cl('refused', 1));
  const f = fakeFetch({ putReply: () => ({ error: 'prompt capture is off' }) });
  const r = await syncTeam({ force: true, fetch: f, sessions: [] });
  assert.equal(r.error, undefined, 'a refused prompt upload does not fail the sync');
  assert.equal(loadTeamState(sb.dir).promptCapture, false);
  assert.ok(!existsSync(promptOffsetsPath(sb.dir)));
});

test('other prompt upload errors fail soft and keep the offsets', async (t) => {
  const sb = sandbox(t);
  saveTeamState(joined(), sb.dir);
  writeFileSync(sb.session, '');
  await syncTeam({ force: true, fetch: fakeFetch(), sessions: [] });
  appendFileSync(sb.session, cl('retry me', 1));
  const bad = fakeFetch({ putReply: () => ({ error: 'boom' }) });
  const r = await syncTeam({ force: true, fetch: bad, sessions: [] });
  assert.equal(r.error, undefined);
  assert.equal(loadOffsets(sb.dir)[sb.session].offset, 0);
  const good = fakeFetch();
  const r2 = await syncTeam({ force: true, fetch: good, sessions: [] });
  assert.equal(r2.prompts, 1);
});

test('SPRAG_NO_TEAM_SYNC=1 uploads no prompts (only the pause signal)', async (t) => {
  const sb = sandbox(t);
  saveTeamState(joined(), sb.dir);
  writeFileSync(sb.session, '');
  await syncTeam({ force: true, fetch: fakeFetch(), sessions: [] });
  appendFileSync(sb.session, cl('must stay local', 1));
  process.env.SPRAG_NO_TEAM_SYNC = '1';
  const f = fakeFetch();
  const r = await syncTeam({ force: true, fetch: f, sessions: [] });
  assert.equal(r.skipped, 'disabled');
  assert.deepEqual(f.calls.map((c) => c.fn), ['member_set_sync']);
});

test('capture off in the policy never creates an offsets file', async (t) => {
  const sb = sandbox(t);
  saveTeamState(joined({ promptCapture: false }), sb.dir);
  writeFileSync(sb.session, cl('x', 1));
  const f = fakeFetch({ capture: false });
  await syncTeam({ force: true, fetch: f, sessions: [] });
  assert.ok(!existsSync(promptOffsetsPath(sb.dir)));
  assert.equal(f.calls.filter((c) => c.fn === 'prompt_chunk_put').length, 0);
});

// -- 30-minute prompt timer --------------------------------------------------

import { promptSyncDue, spawnTeamSyncOnPrompt, teamSyncDue as hookLedgerDue, PROMPT_SYNC_INTERVAL_MS } from '../src/team-ratchet.js';
import { promptSyncDue as syncDue, PROMPT_SYNC_INTERVAL_MS as SYNC_MS, teamSyncDue, ledgerWindow, ledgerRetryDelayMs } from '../src/team-sync.js';

test('the 30-minute gate: due, not due, capture off, paused, not joined (both copies agree)', () => {
  const now = 1_800_000_000_000;
  const base = { memberKey: 'k', promptCapture: true };
  assert.equal(PROMPT_SYNC_INTERVAL_MS, 30 * 60 * 1000);
  assert.equal(SYNC_MS, PROMPT_SYNC_INTERVAL_MS);
  const cases = [
    [{ ...base }, true],
    [{ ...base, lastPromptSyncAt: now - PROMPT_SYNC_INTERVAL_MS }, true],
    [{ ...base, lastPromptSyncAt: now - PROMPT_SYNC_INTERVAL_MS + 1000 }, false],
    [{ ...base, promptCapture: false }, false],
    [{ memberKey: 'k' }, false],
    [{ ...base, pausedReported: true }, false],
    [{ ...base, left: true }, false],
    [{ promptCapture: true }, false],
    [{}, false],
  ];
  for (const [state, want] of cases) {
    assert.equal(promptSyncDue(state, now, {}), want, JSON.stringify(state));
    assert.equal(syncDue(state, now), want && !state.pausedReported, JSON.stringify(state));
  }
  assert.equal(promptSyncDue(base, now, { SPRAG_NO_TEAM_SYNC: '1' }), false);
  assert.equal(promptSyncDue(base, now, { CTS_NO_TEAM_SYNC: '1' }), false);
});

test('the prompt hook spawns the right detached child only when due, and prints nothing', () => {
  const now = 1_800_000_000_000;
  const spawned = [];
  const spawn = (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { unref() {} }; };
  const common = { now, env: {}, spawn, argv: ['node', '/x/cli.js'], execPath: '/bin/node' };
  const fresh = { memberKey: 'k', promptCapture: true, lastSyncAt: now - 60_000 };
  const out = [];
  const w = process.stdout.write; process.stdout.write = (c) => { out.push(c); return true; };
  try {
    assert.equal(spawnTeamSyncOnPrompt({ ...common, state: { ...fresh, lastPromptSyncAt: now - 60_000 } }), false);
    assert.equal(spawnTeamSyncOnPrompt({ ...common, state: { ...fresh, promptCapture: false } }), false);
    assert.equal(spawnTeamSyncOnPrompt({ ...common, state: fresh, env: { SPRAG_NO_TEAM_SYNC: '1' } }), false);
    assert.equal(spawnTeamSyncOnPrompt({ ...common, state: {} }), false);
    assert.equal(spawned.length, 0);
    // only the prompt upload is due
    assert.equal(spawnTeamSyncOnPrompt({ ...common, state: { ...fresh, lastPromptSyncAt: now - 31 * 60_000 } }), true);
    // the ledger is due (6h after the last success): the full background sync
    assert.equal(spawnTeamSyncOnPrompt({ ...common, state: { ...fresh, lastSyncAt: now - 7 * 3600_000 } }), true);
  } finally { process.stdout.write = w; }
  assert.deepEqual(spawned.map((s) => s.args), [
    ['/x/cli.js', 'team', 'sync', '--background', '--prompts-only'],
    ['/x/cli.js', 'team', 'sync', '--background'],
  ]);
  assert.ok(spawned.every((s) => s.opts.detached === true && s.opts.stdio === 'ignore'));
  assert.deepEqual(out, []);
});

test('the hook spawns when a failure backoff has elapsed, not before', () => {
  const t0 = 1_800_000_000_000;
  const spawned = [];
  const spawn = (cmd, args) => { spawned.push(args); return { unref() {} }; };
  const st = { memberKey: 'k', lastSyncAt: t0 - 5 * 3600_000, lastSyncAttemptAt: t0, syncFailures: 1 };
  const go = (now, state = st) => spawnTeamSyncOnPrompt({ state, now, env: {}, spawn, argv: ['n', '/x/cli.js'], execPath: '/bin/node' });
  assert.equal(go(t0 + 14 * 60_000), false);
  assert.equal(go(t0 + 15 * 60_000), true);
  assert.equal(go(t0 + 29 * 60_000, { ...st, syncFailures: 2 }), false);
  assert.equal(go(t0 + 30 * 60_000, { ...st, syncFailures: 2 }), true);
  assert.deepEqual(spawned[0], ['/x/cli.js', 'team', 'sync', '--background']);
});

test('both per-prompt hooks call the gate', () => {
  assert.match(readFileSync(new URL('../src/commands/brief.js', import.meta.url), 'utf8'), /spawnTeamSyncOnPrompt\(\)/);
  assert.match(readFileSync(new URL('../src/codex/hooks.js', import.meta.url), 'utf8'), /event === 'prompt'[\s\S]{0,200}spawnTeamSyncOnPrompt\(\)/);
});

test('promptsOnly uploads prompts, skips the ledger and rules, and stamps the timer', async (t) => {
  const sb = sandbox(t);
  const now = Date.now();
  saveTeamState(joined({ lastSyncAt: now }), sb.dir); // ledger not due
  writeFileSync(sb.session, '');
  await syncTeam({ force: true, fetch: fakeFetch(), sessions: [], now });
  appendFileSync(sb.session, cl('typed later', 1));
  const f = fakeFetch();
  const r = await syncTeam({ promptsOnly: true, fetch: f, now: now + 31 * 60_000 });
  assert.equal(r.prompts, 1);
  assert.deepEqual(f.calls.map((c) => c.fn), ['prompt_chunk_put']);
  assert.equal(loadTeamState(sb.dir).lastPromptSyncAt, now + 31 * 60_000);
  // not due again right away
  const again = await syncTeam({ promptsOnly: true, fetch: f, now: now + 32 * 60_000 });
  assert.equal(again.skipped, 'not-due');
  assert.equal(f.calls.length, 1);
});

test('plain background sync with the ledger not due still runs a due prompt upload', async (t) => {
  const sb = sandbox(t);
  const now = Date.now();
  saveTeamState(joined({ lastSyncAt: now - 1000 }), sb.dir);
  writeFileSync(sb.session, '');
  await syncTeam({ force: true, fetch: fakeFetch(), sessions: [], now: now - 40 * 60_000 });
  appendFileSync(sb.session, cl('x', 1));
  const f = fakeFetch();
  const r = await syncTeam({ fetch: f, now });
  assert.equal(r.prompts, 1);
  assert.ok(!f.calls.some((c) => c.fn === 'ledger_upsert'));
});

test('promptsOnly with capture off or uploads switched off does nothing', async (t) => {
  const sb = sandbox(t);
  saveTeamState(joined({ promptCapture: false }), sb.dir);
  const f = fakeFetch();
  assert.equal((await syncTeam({ promptsOnly: true, fetch: f })).skipped, 'not-due');
  saveTeamState(joined(), sb.dir);
  process.env.SPRAG_NO_TEAM_SYNC = '1';
  const r = await syncTeam({ promptsOnly: true, fetch: f });
  assert.equal(r.skipped, 'disabled');
  assert.ok(!f.calls.some((c) => c.fn === 'prompt_chunk_put' || c.fn === 'ledger_upsert'));
});

// -- ledger retry + watermark ------------------------------------------------

const MIN = 60_000;

test('ledgerRetryDelayMs: 15, 30, 60 minutes, then capped at 60', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(ledgerRetryDelayMs), [15 * MIN, 30 * MIN, 60 * MIN, 60 * MIN, 60 * MIN]);
});

test('teamSyncDue: 6h after a success, backoff after a failure, in-flight guard; both copies agree', () => {
  const now = 1_800_000_000_000;
  const base = { memberKey: 'k' };
  const cases = [
    [{ ...base }, true],
    [{ ...base, lastSyncAt: now - 5 * 3600_000 }, false],
    [{ ...base, lastSyncAt: now - 6 * 3600_000 }, true],
    // failed 20 minutes ago: 15 minute backoff has passed even though the last success was an hour ago
    [{ ...base, lastSyncAt: now - 3600_000, lastSyncAttemptAt: now - 20 * MIN, syncFailures: 1 }, true],
    [{ ...base, lastSyncAt: now - 3600_000, lastSyncAttemptAt: now - 10 * MIN, syncFailures: 1 }, false],
    [{ ...base, lastSyncAt: now - 3600_000, lastSyncAttemptAt: now - 20 * MIN, syncFailures: 2 }, false],
    [{ ...base, lastSyncAt: now - 3600_000, lastSyncAttemptAt: now - 31 * MIN, syncFailures: 2 }, true],
    [{ ...base, lastSyncAt: now - 9 * 3600_000, lastSyncAttemptAt: now - 59 * MIN, syncFailures: 7 }, false],
    [{ ...base, lastSyncAt: now - 9 * 3600_000, lastSyncAttemptAt: now - 61 * MIN, syncFailures: 7 }, true],
    [{ ...base, lastSyncAt: now - 9 * 3600_000, lastSyncAttemptAt: now - 30_000 }, false], // in flight
    [{}, false],
    [{ ...base, left: true }, false],
  ];
  for (const [state, want] of cases) {
    assert.equal(teamSyncDue(state, now), want, JSON.stringify(state));
    assert.equal(hookLedgerDue(state, now), want, 'hook copy: ' + JSON.stringify(state));
  }
});

test('a failed ledger sync retries after 15 minutes, backs off, caps, and a success resets', async (t) => {
  const sb = sandbox(t);
  const t0 = new Date(2026, 9, 18, 12, 0).getTime();
  saveTeamState(joined({ promptCapture: false }), sb.dir);
  const down = async () => { throw new Error('offline'); };
  let now = t0;
  const attempt = async (fetch) => syncTeam({ fetch, now, sessions: [] });
  assert.match((await attempt(down)).error, /offline/);
  let st = loadTeamState(sb.dir);
  assert.equal(st.syncFailures, 1);
  assert.equal(st.lastSyncAt, null);
  now = t0 + 14 * MIN;
  assert.equal((await attempt(down)).skipped, 'not-due');
  now = t0 + 15 * MIN;
  assert.match((await attempt(down)).error, /offline/);
  assert.equal(loadTeamState(sb.dir).syncFailures, 2);
  now += 29 * MIN;
  assert.equal((await attempt(down)).skipped, 'not-due');
  now += 1 * MIN;
  assert.match((await attempt(down)).error, /offline/);
  assert.equal(loadTeamState(sb.dir).syncFailures, 3);
  for (let i = 0; i < 3; i++) { now += 60 * MIN; assert.match((await attempt(down)).error, /offline/); }
  assert.equal(loadTeamState(sb.dir).syncFailures, 6);
  now += 59 * MIN;
  assert.equal((await attempt(down)).skipped, 'not-due', 'delay never exceeds 60 minutes');
  now += 1 * MIN;
  const ok = fakeFetch({ capture: false });
  const r = await attempt(ok);
  assert.equal(r.error, undefined);
  st = loadTeamState(sb.dir);
  assert.equal(st.syncFailures, undefined);
  assert.equal(st.lastError, undefined);
  assert.equal(st.lastSyncAt, now);
  // next try waits the regular 6 hours
  now += 5 * 3600_000;
  assert.equal((await attempt(ok)).skipped, 'not-due');
});

test('ledgerWindow: first sync is 30 days; later syncs start the day before the watermark, capped at 30', () => {
  const now = new Date(2026, 9, 18, 12, 0).getTime();
  assert.equal(ledgerWindow({}, now).startKey, '2026-09-19');
  assert.equal(ledgerWindow({ ledgerSyncedThrough: '2026-10-18' }, now).startKey, '2026-10-17');
  assert.equal(ledgerWindow({ ledgerSyncedThrough: '2026-10-15' }, now).startKey, '2026-10-14');
  assert.equal(ledgerWindow({ ledgerSyncedThrough: '2026-07-01' }, now).startKey, '2026-09-19');
  assert.equal(ledgerWindow({ ledgerSyncedThrough: 'garbage' }, now).startKey, '2026-09-19');
});

test('after 3 offline days the first success uploads those days plus the previous open day', async (t) => {
  const sb = sandbox(t);
  const now = new Date(2026, 9, 18, 12, 0).getTime();
  const at = (d, h = 9) => new Date(2026, 9, d, h).getTime();
  const ledgerEvents = {};
  for (const [i, d] of [10, 14, 15, 16, 17, 18].entries()) ledgerEvents[`e${i}/subagents/1`] = { ts: at(d), usd: 1, to: 'claude-haiku-4-5' };
  writeFileSync(join(sb.dir, 'delegation-ledger.json'), JSON.stringify({ version: 2, events: ledgerEvents }));
  // synced through the 14th (successfully, 6h+ ago), then three offline days
  saveTeamState(joined({ promptCapture: false, lastSyncAt: now - 7 * 3600_000, ledgerSyncedThrough: '2026-10-15' }), sb.dir);
  const f = fakeFetch({ capture: false });
  const r = await syncTeam({ fetch: f, now, sessions: [] });
  assert.equal(r.error, undefined);
  const rows = f.calls.find((c) => c.fn === 'ledger_upsert').body.rows;
  assert.deepEqual(rows.map((x) => x.day), ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  assert.equal(loadTeamState(sb.dir).ledgerSyncedThrough, '2026-10-18');
  // first ever sync: everything inside 30 days
  saveTeamState(joined({ promptCapture: false }), sb.dir);
  const g = fakeFetch({ capture: false });
  await syncTeam({ fetch: g, now, sessions: [], force: true });
  assert.deepEqual(g.calls.find((c) => c.fn === 'ledger_upsert').body.rows.map((x) => x.day),
    ['2026-10-10', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
});

test('a failed sync does not move the watermark', async (t) => {
  const sb = sandbox(t);
  const now = new Date(2026, 9, 18, 12, 0).getTime();
  saveTeamState(joined({ promptCapture: false, lastSyncAt: now - 7 * 3600_000, ledgerSyncedThrough: '2026-10-15' }), sb.dir);
  await syncTeam({ fetch: async () => { throw new Error('offline'); }, now, sessions: [] });
  const st = loadTeamState(sb.dir);
  assert.equal(st.ledgerSyncedThrough, '2026-10-15');
  assert.equal(st.lastSyncAt, now - 7 * 3600_000);
});
