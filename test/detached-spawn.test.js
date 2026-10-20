import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_ENTRY, detachedChildEnv, isDetachedChild } from '../src/cli-entry.js';
import { spawnPresetSyncIfDue } from '../src/preset-sync.js';
import { spawnTeamSyncIfDue, spawnTeamSyncOnPrompt } from '../src/team-ratchet.js';

/*
 * 2026-10-20: the three detached spawners passed process.argv[1] as the child's
 * script. Under `node --test` that is the test file, so a test that reached the
 * session-start path relaunched itself, detached, and every copy did the same:
 * 4,055 node processes in 59 seconds, and the machine stalled three times in two
 * days. These cases pin the two defences: the child is always bin/cli.js, and a
 * child never spawns a child.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NOW = 1_800_000_000_000;
const DUE_TEAM = { memberKey: 'k', lastSyncAt: NOW - 7 * 3600_000 };

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-detached-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

test('a detached child runs bin/cli.js, never the script that imported the module', (t) => {
  // Under the test runner argv[1] is this file: exactly what must not be spawned.
  assert.match(process.argv[1], /detached-spawn\.test\.js$/);
  assert.equal(CLI_ENTRY, join(ROOT, 'bin', 'cli.js'));
  const dir = sandbox(t);
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push({ args, opts }); return { unref() {} }; };
  assert.equal(spawnPresetSyncIfDue({ env: {}, now: NOW, dir, spawn }), true);
  assert.equal(spawnTeamSyncIfDue({ env: {}, now: NOW, spawn, state: DUE_TEAM }), true);
  assert.equal(spawnTeamSyncOnPrompt({ env: {}, now: NOW, spawn, state: DUE_TEAM }), true);
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(c.args[0], CLI_ENTRY);
    assert.notEqual(c.args[0], process.argv[1]);
    assert.equal(c.opts.detached, true);
    assert.equal(c.opts.env.SPRAG_DETACHED_CHILD, '1', 'the child carries the marker');
  }
});

test('a process that is itself a detached child never spawns another', (t) => {
  const dir = sandbox(t);
  const env = detachedChildEnv({});
  assert.equal(isDetachedChild(env), true);
  assert.equal(isDetachedChild({ CTS_DETACHED_CHILD: '1' }), true, 'the legacy prefix is read too');
  assert.equal(isDetachedChild({}), false);
  const spawn = () => { throw new Error('a detached child must not spawn'); };
  assert.equal(spawnPresetSyncIfDue({ env, now: NOW, dir, spawn }), false);
  assert.equal(spawnTeamSyncIfDue({ env, now: NOW, spawn, state: DUE_TEAM }), false);
  assert.equal(spawnTeamSyncOnPrompt({ env, now: NOW, spawn, state: DUE_TEAM }), false);
});

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(c|m)?js$/.test(name)) out.push(full);
  }
  return out;
}

test('no spawn under src/ or bin/ hands process.argv[1] to a child as its script', () => {
  const offenders = [];
  for (const file of ['src', 'bin'].flatMap((d) => sourceFiles(join(ROOT, d)))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bspawn\w*\((?:[^;]|\n){0,400}?argv\[1\]/g)) {
      offenders.push(`${file.slice(ROOT.length)}: ${m[0].split('\n')[0].trim()}`);
    }
  }
  assert.deepEqual(offenders, [], 'spawn the CLI through CLI_ENTRY from src/cli-entry.js');
});
