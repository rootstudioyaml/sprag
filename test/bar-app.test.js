import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BAR_SOURCE,
  LOCK_STALE_MS,
  barChildEnv,
  barEnabled,
  barPaths,
  barRunning,
  buildBar,
  ensureBar,
  findSwiftc,
  launchBar,
  removeBarFiles,
  stopBar,
  barBuildId,
} from '../src/bar-app.js';
import { CLI_ENTRY, DETACHED_CHILD_VAR, spawnDetachedCli } from '../src/cli-entry.js';
import { run as runBarCommand } from '../src/commands/bar.js';
import { childEnv } from './helpers/child-env.js';

/*
 * The menu bar app is compiled on the user's Mac once per version and started
 * at session start. Every case here injects its outside effects (run, spawn,
 * kill, exists, clock, dataDir, version), so no process starts, nothing is
 * compiled and nothing outside a temporary folder is written. The one real
 * process is the CLI in the session-start case, which runs with SPRAG_NO_BAR
 * set (childEnv does that) or with a PATH that holds no compiler.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.js');
const VERSION = '9.9.9';
const NOW = 1_800_000_000_000;

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-bar-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

/** A command runner that answers from a table and records every call. */
function fakeRun(answers = {}) {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const a = answers[cmd];
    const r = typeof a === 'function' ? a(args, opts) : a;
    return { status: 0, stdout: '', stderr: '', error: null, ...(r ?? {}) };
  };
  run.calls = calls;
  return run;
}

const TOOLCHAIN = { 'xcode-select': { stdout: '/Library/Developer/CommandLineTools\n' }, xcrun: { stdout: '/usr/bin/swiftc\n' } };

function setup(t, extra = {}) {
  const dataDir = sandbox(t);
  const paths = barPaths({ dataDir, version: VERSION });
  const kills = [];
  const spawns = [];
  const deps = {
    dataDir,
    version: VERSION,
    kill: (pid, sig) => { kills.push([pid, sig]); },
    spawn: (cmd, args, opts) => { spawns.push({ cmd, args, opts }); return { unref() {} }; },
    exists: (p) => p === '/usr/bin/swiftc' || existsSync(p),
    run: fakeRun(TOOLCHAIN),
    ...extra,
  };
  return { dataDir, paths, deps, kills, spawns };
}

const writeBinary = (paths) => {
  mkdirSync(join(paths.dir, VERSION), { recursive: true });
  writeFileSync(paths.binary, '#!/bin/sh\n');
};
const writePid = (paths, pid, version = VERSION) => writeFileSync(paths.pidFile, JSON.stringify({ pid, version, startedAt: NOW }));
const writeState = (paths, state) => writeFileSync(paths.buildState, JSON.stringify(state));
const writeLock = (paths, ageMs) => {
  writeFileSync(paths.buildLock, '1');
  const at = new Date(NOW - ageMs);
  utimesSync(paths.buildLock, at, at);
};
const MAC = { platform: 'darwin', env: {}, cfg: {}, now: NOW };

test('the shipped Swift source is where BAR_SOURCE says and is listed in the package files', () => {
  assert.equal(BAR_SOURCE, join(ROOT, 'mac', 'SpragBar.swift'));
  assert.ok(existsSync(BAR_SOURCE));
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('mac/SpragBar.swift'));
  assert.ok(!pkg.files.some((f) => /sprag-bar$|\.app/.test(f)), 'no binary is shipped');
});

test('barPaths puts the binary under the build id and the state files in the data directory', () => {
  const p = barPaths({ dataDir: '/home/me/data', version: '1.2.3' });
  assert.equal(p.dir, join('/home/me/data', 'bar'));
  assert.equal(p.binary, join('/home/me/data', 'bar', '1.2.3', 'sprag-bar'));
  assert.equal(p.pidFile, join('/home/me/data', 'bar-app.json'));
  assert.equal(p.buildState, join('/home/me/data', 'bar-build.json'));
  assert.equal(p.buildLock, join('/home/me/data', 'bar-build.lock'));
  // Keyed by the source, not the sprag version: an upgrade that leaves the app's source alone must not recompile it.
  assert.match(barPaths({ dataDir: '/x' }).binary, /bar[\\/][0-9a-f]{12}[\\/]sprag-bar$/, 'the build id defaults to a hash of the source');
  const dir = mkdtempSync(join(tmpdir(), 'bar-id-'));
  const one = join(dir, 'one.swift');
  const two = join(dir, 'two.swift');
  writeFileSync(one, 'print(1)\n');
  writeFileSync(two, 'print(2)\n');
  assert.match(barBuildId(one), /^[0-9a-f]{12}$/);
  assert.notEqual(barBuildId(one), barBuildId(two), 'a changed source is a new build');
  assert.equal(barBuildId(one), barBuildId(one));
  assert.match(barBuildId(join(dir, 'missing.swift')), /^\d+\.\d+\.\d+/, 'an unreadable source falls back to the package version');
  rmSync(dir, { recursive: true, force: true });
});

test('the bar is on unless the config says false', () => {
  assert.equal(barEnabled({}), true);
  assert.equal(barEnabled({ bar: true }), true);
  assert.equal(barEnabled({ bar: false }), false);
});

// findSwiftc

test('findSwiftc never runs xcrun after xcode-select -p failed', (t) => {
  const { deps } = setup(t, { run: fakeRun({ 'xcode-select': { status: 2 } }) });
  assert.equal(findSwiftc(deps), null);
  assert.deepEqual(deps.run.calls.map((c) => c.cmd), ['xcode-select']);
  assert.deepEqual(deps.run.calls[0].args, ['-p']);
  const missing = fakeRun({ 'xcode-select': { status: -1, error: new Error('ENOENT') } });
  assert.equal(findSwiftc({ run: missing }), null);
  assert.deepEqual(missing.calls.map((c) => c.cmd), ['xcode-select']);
});

test('findSwiftc returns the path xcrun reports when that file exists, else null', (t) => {
  const { deps } = setup(t);
  assert.equal(findSwiftc(deps), '/usr/bin/swiftc');
  assert.deepEqual(deps.run.calls.map((c) => c.cmd), ['xcode-select', 'xcrun']);
  assert.deepEqual(deps.run.calls[1].args, ['--find', 'swiftc']);
  assert.equal(findSwiftc({ ...deps, exists: () => false }), null);
  assert.equal(findSwiftc({ run: fakeRun({ ...TOOLCHAIN, xcrun: { status: 1 } }) }), null);
});

// barRunning and stopBar

test('barRunning reads the pid file and tolerates a missing, corrupt or stale one', (t) => {
  const { deps, paths } = setup(t);
  assert.equal(barRunning(deps), null, 'no file');
  writeFileSync(paths.pidFile, '{not json');
  assert.equal(barRunning(deps), null, 'corrupt');
  writeFileSync(paths.pidFile, JSON.stringify({ pid: 'x' }));
  assert.equal(barRunning(deps), null, 'no pid');
  writePid(paths, 4242, '1.0.0');
  assert.deepEqual(barRunning(deps), { pid: 4242, version: '1.0.0' });
  assert.deepEqual(barRunning({ ...deps, kill: () => { throw Object.assign(new Error('x'), { code: 'ESRCH' }); } }), null, 'stale pid');
});

test('stopBar signals only a process whose command is sprag-bar', (t) => {
  const { deps, paths, kills } = setup(t);
  assert.equal(stopBar(deps), false, 'nothing is running');
  writePid(paths, 4242);
  const ours = fakeRun({ ps: { stdout: `${paths.binary}\n` } });
  assert.equal(stopBar({ ...deps, run: ours }), true);
  assert.deepEqual(ours.calls[0].args, ['-p', '4242', '-o', 'comm=']);
  assert.deepEqual(kills.filter(([, s]) => s === 'SIGTERM'), [[4242, 'SIGTERM']]);

  kills.length = 0;
  for (const answer of [{ stdout: '/usr/local/bin/node\n' }, { stdout: '/x/sprag-bar-other\n' }, { stdout: '', status: 1 }]) {
    assert.equal(stopBar({ ...deps, run: fakeRun({ ps: answer }) }), false);
  }
  assert.deepEqual(kills.filter(([, s]) => s === 'SIGTERM'), [], 'a pid that is something else is never signalled');
});

// barChildEnv and launchBar

test('barChildEnv removes the Claude session markers and keeps everything else', () => {
  const env = {
    CLAUDECODE: '1', CLAUDE_PID: '12', CLAUDE_EFFORT: 'high', AI_AGENT: 'claude',
    CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_OAUTH_TOKEN: 'placeholder', [DETACHED_CHILD_VAR]: '1',
    CLAUDE_CONFIG_DIR: '/home/me/.claude', PATH: '/usr/bin', HOME: '/home/me', SPRAG_LANG: 'ko', CLAUDE_OTHER: 'x',
  };
  const out = barChildEnv(env);
  for (const key of ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_OAUTH_TOKEN', DETACHED_CHILD_VAR]) {
    assert.equal(key in out, false, `${key} must not reach the app`);
  }
  assert.deepEqual(out, { CLAUDE_CONFIG_DIR: '/home/me/.claude', PATH: '/usr/bin', HOME: '/home/me', SPRAG_LANG: 'ko', CLAUDE_OTHER: 'x' });
  assert.equal(env.CLAUDECODE, '1', 'the caller environment is not modified');
});

test('launchBar starts the binary detached with the cleaned environment and the five arguments', (t) => {
  const { deps, paths, spawns } = setup(t, { env: { CLAUDECODE: '1', PATH: '/usr/bin', [DETACHED_CHILD_VAR]: '1' }, execPath: '/opt/node' });
  launchBar(deps);
  assert.equal(spawns.length, 1);
  const [s] = spawns;
  assert.equal(s.cmd, paths.binary);
  assert.deepEqual(s.args, ['--node', '/opt/node', '--cli', CLI_ENTRY, '--data-dir', paths.dataDir, '--version-tag', VERSION]);
  assert.equal(s.opts.detached, true);
  assert.equal(s.opts.stdio, 'ignore');
  assert.equal(s.opts.windowsHide, true);
  assert.deepEqual(s.opts.env, { PATH: '/usr/bin' });
});

// buildBar

/** A swiftc that writes the file named after -o, or fails with the given stderr. */
function compiler({ fail, onRun } = {}) {
  return fakeRun({
    ...TOOLCHAIN,
    '/usr/bin/swiftc': (args, opts) => {
      onRun?.(args, opts);
      if (fail) return { status: 1, stderr: fail };
      writeFileSync(args[args.indexOf('-o') + 1], 'binary');
      return {};
    },
  });
}

test('buildBar takes the lock, compiles to a temp file, renames it, records the state and releases the lock', (t) => {
  let lockDuringBuild = false;
  let ticks = 0;
  const { deps, paths } = setup(t);
  const run = compiler({ onRun: () => { lockDuringBuild = existsSync(paths.buildLock); } });
  const r = buildBar({ ...deps, run, clock: () => NOW + (ticks++) * 1500 });
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(lockDuringBuild, true, 'the lock is held while swiftc runs');
  assert.equal(existsSync(paths.buildLock), false, 'and released afterwards');
  const call = run.calls.at(-1);
  assert.equal(call.cmd, '/usr/bin/swiftc');
  assert.deepEqual(call.args.slice(0, 4), ['-O', '-swift-version', '5', BAR_SOURCE]);
  assert.equal(call.args[4], '-o');
  assert.equal(call.args[5], `${paths.binary}.tmp-${process.pid}`);
  assert.equal(call.opts.timeout, 5 * 60 * 1000);
  assert.equal(call.opts.stdio, 'pipe');
  assert.equal(call.opts.windowsHide, true);
  assert.equal(readFileSync(paths.binary, 'utf8'), 'binary');
  assert.equal(statSync(paths.binary).mode & 0o777, 0o755);
  assert.deepEqual(readdirSync(join(paths.dir, VERSION)), ['sprag-bar'], 'no temp file is left');
  const state = JSON.parse(readFileSync(paths.buildState, 'utf8'));
  assert.deepEqual(state, { version: VERSION, ok: true, at: state.at, ms: r.ms, error: null });
  assert.ok(Number.isFinite(state.at));
  assert.ok(r.ms > 0);
});

test('buildBar removes the other version folders after a success and keeps them after a failure', (t) => {
  const { deps, paths } = setup(t);
  for (const v of ['1.0.0', '2.0.0']) {
    mkdirSync(join(paths.dir, v), { recursive: true });
    writeFileSync(join(paths.dir, v, 'sprag-bar'), 'old');
  }
  assert.equal(buildBar({ ...deps, run: compiler({ fail: 'boom' }) }).ok, false);
  assert.deepEqual(readdirSync(paths.dir).sort(), ['1.0.0', '2.0.0', VERSION]);
  assert.equal(buildBar({ ...deps, run: compiler() }).ok, true);
  assert.deepEqual(readdirSync(paths.dir), [VERSION]);
});

test('buildBar records the last 600 characters of stderr when swiftc fails', (t) => {
  const { deps, paths } = setup(t);
  const stderr = `${'e'.repeat(900)}\nerror: the tail`;
  const r = buildBar({ ...deps, run: compiler({ fail: stderr }) });
  assert.equal(r.ok, false);
  assert.equal(r.error.length, 600);
  assert.ok(r.error.endsWith('error: the tail'));
  const state = JSON.parse(readFileSync(paths.buildState, 'utf8'));
  assert.equal(state.ok, false);
  assert.equal(state.version, VERSION);
  assert.equal(state.error, r.error);
  assert.equal(existsSync(paths.binary), false);
  assert.equal(existsSync(paths.buildLock), false, 'the lock is released on failure too');
});

test('buildBar reports a timeout from the compiler as an error', (t) => {
  const { deps, paths } = setup(t);
  const run = fakeRun({ ...TOOLCHAIN, '/usr/bin/swiftc': { status: null, error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }) } });
  const r = buildBar({ ...deps, run });
  assert.equal(r.ok, false);
  assert.match(r.error, /timeout/);
  assert.equal(existsSync(paths.buildLock), false);
});

test('buildBar without a toolchain records no-toolchain and does not compile', (t) => {
  const { deps, paths } = setup(t, { run: fakeRun({ 'xcode-select': { status: 2 } }) });
  const r = buildBar(deps);
  assert.deepEqual({ ok: r.ok, error: r.error }, { ok: false, error: 'no-toolchain' });
  assert.deepEqual(JSON.parse(readFileSync(paths.buildState, 'utf8')).error, 'no-toolchain');
  assert.deepEqual(deps.run.calls.map((c) => c.cmd), ['xcode-select']);
  assert.equal(existsSync(paths.buildLock), false);
});

test('buildBar leaves a fresh lock alone and skips', (t) => {
  const { deps, paths } = setup(t);
  writeLock(paths, 60_000);
  const run = compiler();
  assert.deepEqual(buildBar({ ...deps, run, clock: () => NOW }), { ok: false, skipped: 'building' });
  assert.equal(run.calls.length, 0);
  assert.equal(existsSync(paths.buildLock), true, 'the other build keeps its lock');
});

test('buildBar replaces a lock older than ten minutes', (t) => {
  const { deps, paths } = setup(t);
  writeLock(paths, LOCK_STALE_MS + 1000);
  const r = buildBar({ ...deps, run: compiler(), clock: () => NOW });
  assert.equal(r.ok, true);
  assert.equal(existsSync(paths.buildLock), false);
});

// ensureBar: one case per reason

test('ensureBar: not-mac', (t) => {
  const { deps } = setup(t);
  assert.equal(ensureBar({ ...deps, ...MAC, platform: 'linux' }), 'not-mac');
  assert.equal(ensureBar({ ...deps, ...MAC, platform: 'win32' }), 'not-mac');
  assert.equal(deps.run.calls.length, 0);
});

test('ensureBar: child, for a detached child of sprag', (t) => {
  const { deps, spawns } = setup(t);
  assert.equal(ensureBar({ ...deps, ...MAC, env: { [DETACHED_CHILD_VAR]: '1' } }), 'child');
  assert.equal(ensureBar({ ...deps, ...MAC, env: { CTS_DETACHED_CHILD: '1' } }), 'child');
  assert.equal(spawns.length, 0);
});

test('ensureBar: off, by SPRAG_NO_BAR or by the config', (t) => {
  const { deps, paths, spawns } = setup(t);
  writeBinary(paths);
  assert.equal(ensureBar({ ...deps, ...MAC, env: { SPRAG_NO_BAR: '1' } }), 'off');
  assert.equal(ensureBar({ ...deps, ...MAC, env: { CTS_NO_BAR: '1' } }), 'off');
  assert.equal(ensureBar({ ...deps, ...MAC, cfg: { bar: false } }), 'off');
  assert.equal(spawns.length, 0);
});

test('ensureBar: running, when the same version is up', (t) => {
  const { deps, paths, spawns, kills } = setup(t);
  writeBinary(paths);
  writePid(paths, 4242, VERSION);
  assert.equal(ensureBar({ ...deps, ...MAC }), 'running');
  assert.equal(spawns.length, 0);
  assert.deepEqual(kills.filter(([, s]) => s === 'SIGTERM'), []);
});

test('ensureBar: restarted, when another version is up and this one is built', (t) => {
  const { deps, paths, spawns, kills } = setup(t, { run: fakeRun({ ...TOOLCHAIN, ps: { stdout: '/x/1.0.0/sprag-bar\n' } }) });
  writeBinary(paths);
  writePid(paths, 4242, '1.0.0');
  assert.equal(ensureBar({ ...deps, ...MAC }), 'restarted');
  assert.deepEqual(kills.filter(([, s]) => s === 'SIGTERM'), [[4242, 'SIGTERM']], 'the old app is stopped');
  assert.equal(spawns.length, 1, 'and the new one started');
  assert.equal(spawns[0].cmd, paths.binary);
});

test('ensureBar: started, when the binary exists and nothing runs', (t) => {
  const { deps, paths, spawns } = setup(t);
  writeBinary(paths);
  assert.equal(ensureBar({ ...deps, ...MAC }), 'started');
  assert.equal(spawns.length, 1);
  assert.equal(deps.run.calls.length, 0, 'no toolchain probe when the binary is there');
});

test('ensureBar: build-failed, when this version failed less than a day ago', (t) => {
  const { deps, paths, spawns } = setup(t);
  writeState(paths, { version: VERSION, ok: false, at: NOW - 23 * 3600_000, ms: 10, error: 'boom' });
  const spawnCli = () => { throw new Error('no build may start'); };
  assert.equal(ensureBar({ ...deps, ...MAC, spawnCli }), 'build-failed');
  assert.equal(spawns.length, 0);
  // A day later, or a failure of another version, is tried again.
  const calls = [];
  const again = (args, opts) => { calls.push({ args, opts }); return true; };
  writeState(paths, { version: VERSION, ok: false, at: NOW - 25 * 3600_000, ms: 10, error: 'boom' });
  assert.equal(ensureBar({ ...deps, ...MAC, spawnCli: again }), 'building');
  writeState(paths, { version: '1.0.0', ok: false, at: NOW - 1000, ms: 10, error: 'boom' });
  assert.equal(ensureBar({ ...deps, ...MAC, spawnCli: again }), 'building');
  assert.equal(calls.length, 2);
});

test('ensureBar: a corrupt build state counts as no state', (t) => {
  const { deps, paths } = setup(t);
  writeFileSync(paths.buildState, '{broken');
  const calls = [];
  assert.equal(ensureBar({ ...deps, ...MAC, spawnCli: (args) => { calls.push(args); return true; } }), 'building');
  assert.equal(calls.length, 1);
});

test('ensureBar: building, when a fresh lock exists', (t) => {
  const { deps, paths } = setup(t);
  writeLock(paths, 60_000);
  const spawnCli = () => { throw new Error('a second build must not start'); };
  assert.equal(ensureBar({ ...deps, ...MAC, spawnCli }), 'building');
  assert.equal(deps.run.calls.length, 0);
  // A stale lock does not block a new build.
  writeLock(paths, LOCK_STALE_MS + 1000);
  const calls = [];
  assert.equal(ensureBar({ ...deps, ...MAC, spawnCli: (args) => { calls.push(args); return true; } }), 'building');
  assert.equal(calls.length, 1);
});

test('ensureBar: no-toolchain, and the state says so', (t) => {
  const { deps, paths } = setup(t, { run: fakeRun({ 'xcode-select': { status: 2 } }) });
  const spawnCli = () => { throw new Error('no build may start'); };
  assert.equal(ensureBar({ ...deps, ...MAC, spawnCli }), 'no-toolchain');
  assert.deepEqual(deps.run.calls.map((c) => c.cmd), ['xcode-select'], 'xcrun is never run');
  assert.deepEqual(JSON.parse(readFileSync(paths.buildState, 'utf8')), { version: VERSION, ok: false, at: NOW, ms: 0, error: 'no-toolchain' });
});

test('ensureBar: a recorded no-toolchain is not a failed build: the tools are looked for again and the build starts once they exist', (t) => {
  const { deps, paths } = setup(t);
  // The state a session start left when the command line tools were missing, a minute ago.
  writeFileSync(paths.buildState, JSON.stringify({ version: VERSION, ok: false, at: NOW - 60_000, ms: 0, error: 'no-toolchain' }));
  const calls = [];
  assert.equal(ensureBar({ ...deps, ...MAC, spawnCli: (args) => { calls.push(args); return true; } }), 'building');
  assert.deepEqual(calls, [['bar', 'build', '--then-launch']]);
  // A compile that really failed a minute ago still waits out the day.
  writeFileSync(paths.buildState, JSON.stringify({ version: VERSION, ok: false, at: NOW - 60_000, ms: 900, error: 'error: something' }));
  assert.equal(ensureBar({ ...deps, ...MAC, spawnCli: () => { throw new Error('no retry inside a day'); } }), 'build-failed');
});

test('ensureBar: building, started through spawnDetachedCli with bar build --then-launch', (t) => {
  const { deps, spawns } = setup(t);
  const calls = [];
  const env = { PATH: '/usr/bin' };
  assert.equal(ensureBar({ ...deps, ...MAC, env, spawnCli: (args, opts) => { calls.push({ args, opts }); return true; } }), 'building');
  assert.deepEqual(calls, [{ args: ['bar', 'build', '--then-launch'], opts: { env } }]);
  assert.equal(spawns.length, 0, 'the app itself is not started before it exists');
  assert.equal(deps.run.calls.every((c) => c.cmd !== '/usr/bin/swiftc'), true, 'ensureBar never compiles in the hook process');
});

test('ensureBar: the build child is bin/cli.js with the detached-child marker', (t) => {
  const { deps } = setup(t);
  const seen = [];
  const spawnCli = (args, opts) => spawnDetachedCli(args, {
    ...opts, execPath: '/opt/node', spawn: (cmd, a, o) => { seen.push({ cmd, a, o }); return { unref() {} }; },
  });
  assert.equal(ensureBar({ ...deps, ...MAC, spawnCli }), 'building');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cmd, '/opt/node');
  assert.deepEqual(seen[0].a, [CLI_ENTRY, 'bar', 'build', '--then-launch']);
  assert.equal(seen[0].o.detached, true);
  assert.equal(seen[0].o.env[DETACHED_CHILD_VAR], '1');
});

test('ensureBar: error, and it never throws', (t) => {
  const { deps, paths } = setup(t);
  writeBinary(paths);
  const spawn = () => { throw new Error('EACCES'); };
  assert.equal(ensureBar({ ...deps, ...MAC, spawn }), 'error');
});

// uninstall

test('removeBarFiles stops the app and deletes the folder, the pid file, the build state and the lock', (t) => {
  const { deps, paths, kills } = setup(t, { run: fakeRun({ ps: { stdout: '/x/sprag-bar\n' } }) });
  writeBinary(paths);
  writePid(paths, 4242);
  writeState(paths, { version: VERSION, ok: true });
  writeLock(paths, 1000);
  removeBarFiles(deps);
  assert.deepEqual(kills.filter(([, s]) => s === 'SIGTERM'), [[4242, 'SIGTERM']]);
  for (const p of [paths.dir, paths.pidFile, paths.buildState, paths.buildLock]) assert.equal(existsSync(p), false, p);
  assert.doesNotThrow(() => removeBarFiles(deps), 'nothing left is not an error');
});

// the subcommands

function fakeBar(over = {}) {
  const log = [];
  const rec = (name, ret) => (...a) => { log.push([name, ...a.slice(0, 0)]); return typeof ret === 'function' ? ret(...a) : ret; };
  const bar = {
    setBarEnabled: (on) => { log.push(['setBarEnabled', on]); },
    barEnabled: () => true,
    barPaths: (d) => barPaths(d),
    barRunning: rec('barRunning', null),
    stopBar: rec('stopBar', false),
    findSwiftc: rec('findSwiftc', '/usr/bin/swiftc'),
    buildBar: rec('buildBar', { ok: true, ms: 31_400, error: null }),
    launchBar: rec('launchBar', undefined),
    readBuildState: rec('readBuildState', null),
    ...over,
  };
  return { bar, log };
}

async function runSub(args, { lang, platform = 'darwin', bar, exists = () => false, flags = [] }) {
  const out = [];
  const err = [];
  const prev = process.exitCode;
  process.exitCode = undefined;
  await runBarCommand({
    args: ['bar', ...args],
    hasFlag: (f) => flags.includes(f),
    deps: {
      lang, platform, bar,
      barDeps: { dataDir: '/home/me/data', version: VERSION, exists },
      stdout: { write: (s) => out.push(s) },
      stderr: { write: (s) => err.push(s) },
    },
  });
  const code = process.exitCode ?? 0;
  process.exitCode = prev;
  return { out: out.join(''), err: err.join(''), code };
}

const names = (log) => log.map((l) => l[0]);

test('sprag bar off switches the app off, stops it and says how to bring it back', async () => {
  const en = fakeBar();
  const r = await runSub(['off'], { lang: 'en', bar: en.bar });
  assert.deepEqual(en.log.filter((l) => l[0] === 'setBarEnabled'), [['setBarEnabled', false]]);
  assert.ok(names(en.log).includes('stopBar'));
  assert.match(r.out, /off/);
  assert.match(r.out, /sprag bar on/);
  assert.equal(r.code, 0);
  const ko = await runSub(['off'], { lang: 'ko', bar: fakeBar().bar });
  assert.match(ko.out, /껐/);
  assert.match(ko.out, /sprag bar on/);
});

test('sprag bar on: not macOS says so and exits 0', async () => {
  const f = fakeBar();
  const en = await runSub(['on'], { lang: 'en', platform: 'linux', bar: f.bar });
  assert.match(en.out, /only works on macOS/);
  assert.equal(en.code, 0);
  assert.ok(!names(f.log).includes('buildBar'));
  const ko = await runSub(['on'], { lang: 'ko', platform: 'linux', bar: fakeBar().bar });
  assert.match(ko.out, /macOS/);
  assert.equal(ko.code, 0);
});

test('sprag bar on: already running with this version', async () => {
  const f = fakeBar({ barRunning: () => ({ pid: 4242, version: VERSION }) });
  const en = await runSub(['on'], { lang: 'en', bar: f.bar });
  assert.match(en.out, /already running/);
  assert.match(en.out, /4242/);
  assert.ok(!names(f.log).includes('launchBar'));
  const ko = await runSub(['on'], { lang: 'ko', bar: fakeBar({ barRunning: () => ({ pid: 4242, version: VERSION }) }).bar });
  assert.match(ko.out, /이미 실행 중/);
});

test('sprag bar on: no toolchain names xcode-select --install and exits 1', async () => {
  for (const lang of ['en', 'ko']) {
    const f = fakeBar({ findSwiftc: () => null });
    const r = await runSub(['on'], { lang, bar: f.bar });
    assert.match(r.err, /xcode-select --install/);
    assert.equal(r.code, 1);
    assert.ok(!names(f.log).includes('buildBar'));
    assert.ok(!names(f.log).includes('launchBar'));
  }
});

test('sprag bar on: compiles when the binary is missing, then starts it', async () => {
  const en = fakeBar();
  const r = await runSub(['on'], { lang: 'en', bar: en.bar });
  assert.match(r.out, /Compiling.*half a minute/);
  assert.match(r.out, /in the menu bar/);
  assert.equal(r.code, 0);
  const order = names(en.log).filter((n) => ['setBarEnabled', 'buildBar', 'launchBar'].includes(n));
  assert.deepEqual(order, ['setBarEnabled', 'buildBar', 'launchBar']);
  const ko = await runSub(['on'], { lang: 'ko', bar: fakeBar().bar });
  assert.match(ko.out, /30초/);
  assert.match(ko.out, /메뉴 막대/);
});

test('sprag bar on: a built binary is started without compiling', async () => {
  const f = fakeBar();
  const r = await runSub(['on'], { lang: 'en', bar: f.bar, exists: () => true });
  assert.ok(!names(f.log).includes('buildBar'));
  assert.ok(names(f.log).includes('launchBar'));
  assert.equal(r.code, 0);
});

test('sprag bar on: a failed build prints the error tail and exits 1 without starting', async () => {
  for (const lang of ['en', 'ko']) {
    const f = fakeBar({ buildBar: () => ({ ok: false, ms: 5, error: 'error: expected expression' }) });
    const r = await runSub(['on'], { lang, bar: f.bar });
    assert.match(r.err, /error: expected expression/);
    assert.equal(r.code, 1);
    assert.ok(!names(f.log).includes('launchBar'));
  }
});

test('sprag bar build prints ok or the error tail and starts only with --then-launch', async () => {
  const plain = fakeBar();
  const ok = await runSub(['build'], { lang: 'en', bar: plain.bar });
  assert.match(ok.out, /Compiled the menu bar app in 31\.4s/);
  assert.equal(ok.code, 0);
  assert.ok(!names(plain.log).includes('launchBar'));

  const then = fakeBar();
  const launched = await runSub(['build'], { lang: 'ko', bar: then.bar, flags: ['--then-launch'] });
  assert.match(launched.out, /31\.4초/);
  assert.ok(names(then.log).includes('launchBar'));

  const running = fakeBar({ barRunning: () => ({ pid: 1, version: VERSION }) });
  await runSub(['build'], { lang: 'en', bar: running.bar, flags: ['--then-launch'] });
  assert.ok(!names(running.log).includes('launchBar'), 'nothing is started when the app already runs');

  const off = fakeBar({ barEnabled: () => false });
  await runSub(['build'], { lang: 'en', bar: off.bar, flags: ['--then-launch'] });
  assert.ok(!names(off.log).includes('launchBar'), 'nothing is started when the bar is turned off');

  for (const lang of ['en', 'ko']) {
    const bad = fakeBar({ buildBar: () => ({ ok: false, ms: 5, error: 'error: nope' }) });
    const r = await runSub(['build'], { lang, bar: bad.bar, flags: ['--then-launch'] });
    assert.match(r.err, /error: nope/);
    assert.equal(r.code, 1);
    assert.ok(!names(bad.log).includes('launchBar'));
  }
  const skipped = await runSub(['build'], { lang: 'en', bar: fakeBar({ buildBar: () => ({ ok: false, skipped: 'building' }) }).bar });
  assert.match(skipped.out, /already running/);
  assert.equal(skipped.code, 0);
});

test('sprag bar status prints one line each in both languages', async () => {
  const state = { version: VERSION, ok: false, error: 'error: boom', at: NOW };
  const running = () => ({ pid: 4242, version: VERSION });
  const en = await runSub(['status'], { lang: 'en', bar: fakeBar({ barRunning: running, readBuildState: () => state }).bar, exists: () => true });
  const lines = en.out.trimEnd().split('\n');
  assert.match(lines[0], /^Menu bar app: on$/);
  assert.match(lines[1], /^Running: yes \(pid 4242, build 9\.9\.9\)$/);
  assert.match(lines[2], /^Compiled \(build 9\.9\.9\): yes \(.*sprag-bar\)$/);
  assert.match(lines[3], /^Swift toolchain: found \(\/usr\/bin\/swiftc\)$/);
  assert.match(lines[4], /^Last build error/);
  assert.match(en.out, /error: boom/);
  assert.equal(en.code, 0);

  const ko = await runSub(['status'], { lang: 'ko', bar: fakeBar({ barRunning: running, readBuildState: () => state }).bar, exists: () => true });
  const kl = ko.out.trimEnd().split('\n');
  assert.match(kl[0], /^메뉴 막대 앱: 켜짐$/);
  assert.match(kl[1], /^실행 중: 예 \(pid 4242, 빌드 9\.9\.9\)$/);
  assert.match(kl[2], /^컴파일 \(빌드 9\.9\.9\): 있음/);
  assert.match(kl[3], /^Swift 도구: 있음/);
  assert.match(kl[4], /^마지막 컴파일 오류/);

  const down = await runSub(['status'], { lang: 'en', bar: fakeBar({ barEnabled: () => false, findSwiftc: () => null }).bar });
  const dl = down.out.trimEnd().split('\n');
  assert.equal(dl[2], 'Compiled (build 9.9.9): no');
  assert.deepEqual(dl.map((l) => l.replace(/\(.*\)/, '()')), [
    'Menu bar app: off', 'Running: no', 'Compiled (): no', 'Swift toolchain: missing ()',
  ]);
});

test('a bar call with no subcommand still prints the snapshot', async () => {
  const out = [];
  await runBarCommand({
    args: ['bar'],
    hasFlag: (f) => f === '--json',
    deps: { collect: () => ({ at: NOW, sessions: [], totals: { sessions: 0, busy: 0 } }), stdout: { write: (s) => out.push(s) } },
  });
  assert.equal(JSON.parse(out.join('')).sessions.length, 0);
});

// session start

function hookSandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-bar-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const home = join(dir, 'home');
  const empty = join(dir, 'empty-path');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(dir, 'claude-token-saver'), { recursive: true });
  mkdirSync(empty);
  return { dir, home, empty, data: join(dir, 'claude-token-saver') };
}

const hook = (env) => execFileSync(process.execPath, [CLI, 'route-scan', '--hook'], {
  input: '{}', encoding: 'utf8', timeout: 60_000, env,
});

test('the SessionStart hook under the test sandbox starts no bar process and no build', (t) => {
  const { dir, home, data } = hookSandbox(t);
  hook(childEnv({ HOME: home, XDG_CONFIG_HOME: dir }));
  for (const name of ['bar', 'bar-app.json', 'bar-build.json', 'bar-build.lock']) {
    assert.equal(existsSync(join(data, name)), false, `${name} must not exist`);
  }
});

test('the SessionStart hook reaches ensureBar, which stops at a missing toolchain without starting anything', (t) => {
  const { dir, home, empty, data } = hookSandbox(t);
  // A PATH with no programs: on a Mac xcode-select is not found, so ensureBar can only record that.
  hook(childEnv({ HOME: home, XDG_CONFIG_HOME: dir, SPRAG_NO_BAR: undefined, PATH: empty }));
  assert.equal(existsSync(join(data, 'bar')), false);
  assert.equal(existsSync(join(data, 'bar-app.json')), false);
  assert.equal(existsSync(join(data, 'bar-build.lock')), false);
  if (process.platform === 'darwin') {
    assert.equal(JSON.parse(readFileSync(join(data, 'bar-build.json'), 'utf8')).error, 'no-toolchain');
  } else {
    assert.equal(existsSync(join(data, 'bar-build.json')), false);
  }
});

test('sprag bar off writes bar: false to the config, and the hook then starts nothing', (t) => {
  const { dir, home, empty, data } = hookSandbox(t);
  const env = childEnv({ HOME: home, XDG_CONFIG_HOME: dir, SPRAG_NO_BAR: undefined, PATH: empty });
  execFileSync(process.execPath, [CLI, 'bar', 'off'], { encoding: 'utf8', timeout: 60_000, env });
  assert.equal(JSON.parse(readFileSync(join(data, 'config.json'), 'utf8')).bar, false);
  hook(env);
  assert.equal(existsSync(join(data, 'bar-build.json')), false, 'a turned-off bar does not even probe the toolchain');
});
