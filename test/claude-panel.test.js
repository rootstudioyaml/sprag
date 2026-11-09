/**
 * `sprag panel` (Claude Code side): transcript lookup, payload, one-frame
 * render through an injected spawner, and the CLI dispatch.
 *
 * Every filesystem case lives in a temp directory. The render child is never
 * started for real except in the CLI case, which runs with a scrubbed
 * environment and an empty HOME.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv } from './helpers/child-env.js';
import { CLI_ENTRY } from '../src/cli-entry.js';
import {
  encodeProjectDir, projectTranscriptDir, latestSession, panelPayload,
  renderFrame, createScreen, run, waitingHint,
} from '../src/commands/panel.js';

const SANDBOX = realpathSync(mkdtempSync(join(tmpdir(), 'sprag-claude-panel-')));
after(() => rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const CLAUDE = join(SANDBOX, 'claude');
const PROJECT = join(SANDBOX, 'my.proj_1');
mkdirSync(PROJECT, { recursive: true });
const DIR = join(CLAUDE, 'projects', encodeProjectDir(PROJECT));

function touch(path, secondsAgo) {
  writeFileSync(path, '{}\n');
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(path, t, t);
}

test('encodeProjectDir turns every non-alphanumeric char into a dash', () => {
  assert.equal(encodeProjectDir('/Users/a.b/my_proj-1'), '-Users-a-b-my-proj-1');
});

test('projectTranscriptDir joins claudeDir/projects/<encoded cwd>', () => {
  assert.equal(projectTranscriptDir('/nope/x.y', { claudeDir: '/c' }), join('/c', 'projects', '-nope-x-y'));
});

test('projectTranscriptDir falls back to the realpath when only that directory exists', () => {
  const real = join(SANDBOX, 'real-target');
  const link = join(SANDBOX, 'link-to-target');
  mkdirSync(real, { recursive: true });
  try { symlinkSync(real, link, 'dir'); } catch { return; } // symlinks may need privileges on Windows
  const realDir = join(CLAUDE, 'projects', encodeProjectDir(real));
  mkdirSync(realDir, { recursive: true });
  assert.equal(projectTranscriptDir(link, { claudeDir: CLAUDE }), realDir);
});

test('latestSession picks the newest jsonl and ignores subdirectories', () => {
  mkdirSync(join(DIR, 'sub-agents'), { recursive: true });
  touch(join(DIR, 'old.jsonl'), 300);
  touch(join(DIR, 'new.jsonl'), 10);
  touch(join(DIR, 'notes.txt'), 1);
  // A subagent transcript is newer than both, but lives in a subdirectory.
  touch(join(DIR, 'sub-agents', 'agent-x.jsonl'), 0);
  const s = latestSession(PROJECT, { claudeDir: CLAUDE });
  assert.equal(s.sessionId, 'new');
  assert.equal(s.transcriptPath, join(DIR, 'new.jsonl'));
});

test('latestSession returns null when the project has no transcripts', () => {
  assert.equal(latestSession(join(SANDBOX, 'unknown'), { claudeDir: CLAUDE }), null);
});

test('latestSession --session pins an id, with the path only when the file exists', () => {
  const hit = latestSession(PROJECT, { claudeDir: CLAUDE, session: 'old' });
  assert.deepEqual(hit, { sessionId: 'old', transcriptPath: join(DIR, 'old.jsonl') });
  const miss = latestSession(PROJECT, { claudeDir: CLAUDE, session: 'ghost' });
  assert.deepEqual(miss, { sessionId: 'ghost', transcriptPath: null });
});

test('panelPayload carries the cwd and never invents model, context or rate limits', () => {
  const none = panelPayload({ cwd: '/p', session: null });
  assert.deepEqual(none, { cwd: '/p', workspace: { current_dir: '/p', project_dir: '/p' } });
  const some = panelPayload({ cwd: '/p', session: { sessionId: 's1', transcriptPath: '/t/s1.jsonl' } });
  assert.equal(some.session_id, 's1');
  assert.equal(some.transcript_path, '/t/s1.jsonl');
  for (const k of ['rate_limits', 'model', 'context_window', 'cost']) assert.equal(k in some, false);
});

test('renderFrame spawns the CLI entry with --statusline, --columns and the payload on stdin', async () => {
  const calls = [];
  const spawner = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { ok: true, stdout: 'line one\nline two\n\n' };
  };
  const payload = { cwd: '/p' };
  const frame = await renderFrame({ payload, cols: 77, passthrough: ['--no-color'], spawner });
  assert.equal(frame, 'line one\nline two');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, process.execPath);
  assert.deepEqual(calls[0].args, [CLI_ENTRY, '--statusline', '--columns', '77', '--no-color']);
  assert.equal(calls[0].opts.input, JSON.stringify(payload));
  assert.equal(calls[0].opts.timeout, 4000);
});

test('renderFrame returns null on a failed or empty render', async () => {
  assert.equal(await renderFrame({ payload: {}, cols: 80, spawner: async () => ({ ok: false, stdout: 'x' }) }), null);
  assert.equal(await renderFrame({ payload: {}, cols: 80, spawner: async () => ({ ok: true, stdout: '\n' }) }), null);
});

test('createScreen repaints only when the frame text changed', () => {
  const out = [];
  const screen = createScreen((s) => out.push(s));
  assert.equal(screen.draw('a'), true);
  assert.equal(screen.draw('a'), false);
  assert.equal(screen.draw('b'), true);
  assert.deepEqual(out, ['\x1b[H\x1b[2Ja\n', '\x1b[H\x1b[2Jb\n']);
});

function fakeStream(extra = {}) {
  const chunks = [];
  return { chunks, write: (s) => { chunks.push(s); return true; }, ...extra };
}
const argsOf = (argv) => ({
  getArg: (n) => { const i = argv.indexOf(n); return i === -1 ? undefined : argv[i + 1]; },
  hasFlag: (n) => argv.includes(n),
});

test('run --once prints one frame, no screen clearing, through the injected spawner', async () => {
  const stdout = fakeStream({ columns: 90, isTTY: true });
  const calls = [];
  const spawner = async (cmd, args, opts) => { calls.push({ args, opts }); return { ok: true, stdout: 'FRAME\n' }; };
  await run({
    ...argsOf(['panel', '--once', '--project', PROJECT, '--no-color']),
    deps: { spawner, stdout, stderr: fakeStream(), env: { CLAUDE_CONFIG_DIR: CLAUDE } },
  });
  assert.deepEqual(stdout.chunks, ['FRAME\n']);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes(CLI_ENTRY));
  assert.ok(calls[0].args.includes('--statusline'));
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--columns'), calls[0].args.indexOf('--columns') + 2), ['--columns', '90']);
  const sent = JSON.parse(calls[0].opts.input);
  assert.equal(sent.session_id, 'new');
  assert.equal(sent.transcript_path, join(DIR, 'new.jsonl'));
});

test('run without a TTY behaves like --once and hints on stderr when no session exists', async () => {
  const stdout = fakeStream({ isTTY: false });
  const stderr = fakeStream();
  const empty = join(SANDBOX, 'no-session-here');
  await run({
    ...argsOf(['panel', '--project', empty]),
    deps: { spawner: async () => ({ ok: true, stdout: 'F\n' }), stdout, stderr, env: { CLAUDE_CONFIG_DIR: CLAUDE } },
  });
  assert.deepEqual(stdout.chunks, ['F\n']);
  assert.deepEqual(stderr.chunks, [`${waitingHint(empty)}\n`]);
});

test('live mode keeps the last frame on a failed render and does not overlap ticks', async () => {
  const stdout = fakeStream({ columns: 100, isTTY: true });
  const replies = [{ ok: true, stdout: 'GOOD\n' }, { ok: false, stdout: '' }];
  let active = 0;
  let maxActive = 0;
  const spawner = async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setImmediate(r));
    active--;
    return replies.shift() || { ok: true, stdout: 'GOOD\n' };
  };
  const scheduled = [];
  await run({
    ...argsOf(['panel', '--project', PROJECT, '--interval', '0.2']),
    deps: {
      spawner, stdout, stderr: fakeStream(), env: { CLAUDE_CONFIG_DIR: CLAUDE },
      setTimeoutFn: (fn, ms) => { scheduled.push({ fn, ms }); return 0; },
      onStop: () => {},
    },
  });
  // One tick has run and exactly one follow-up is scheduled, at the 1 s minimum.
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 1000);
  await scheduled[0].fn();
  assert.equal(maxActive, 1);
  const painted = stdout.chunks.filter((c) => c.includes('GOOD'));
  assert.equal(painted.length, 1, 'the failed second render must not repaint or blank the screen');
  assert.ok(stdout.chunks[0].includes('\x1b[?25l'), 'cursor hidden at start');
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
});

test('CLI: sprag panel --once is a known command (no exit 2)', () => {
  const home = join(SANDBOX, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const r = spawnSync(process.execPath, [CLI_ENTRY, 'panel', '--once', '--no-color', '--project', PROJECT], {
    env: childEnv({ HOME: home, XDG_CONFIG_HOME: join(SANDBOX, 'cfg'), CLAUDE_CONFIG_DIR: CLAUDE }),
    encoding: 'utf8', timeout: 30000,
  });
  assert.notEqual(r.status, 2, r.stderr);
  assert.doesNotMatch(r.stderr, /Unknown (command|option)/);
});

test('CLI: sprag panel rejects an option it does not know', () => {
  const home = join(SANDBOX, 'home');
  const r = spawnSync(process.execPath, [CLI_ENTRY, 'panel', '--bogus'], {
    env: childEnv({ HOME: home, XDG_CONFIG_HOME: join(SANDBOX, 'cfg') }), encoding: 'utf8', timeout: 30000,
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown option: --bogus/);
});
