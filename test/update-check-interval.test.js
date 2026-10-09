/**
 * When the update check runs again: after a version change, and after a
 * caller-chosen interval. The statusline keeps the 24h default; SessionStart
 * asks for the shorter SESSION_START_CHECK_INTERVAL_MS.
 *
 * Nothing here starts a process: maybeSpawnUpdateCheck takes the spawn
 * function as an option, and the tests hand it a recorder.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  updateStatus,
  updateStatePath,
  maybeSpawnUpdateCheck,
  UPDATE_CHECK_INTERVAL_MS,
  SESSION_START_CHECK_INTERVAL_MS,
} from '../src/update-check.js';

const HOUR = 60 * 60 * 1000;

function isolated(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-update-interval-'));
  const saved = {};
  for (const name of ['XDG_CONFIG_HOME', 'CTS_NO_UPDATE_CHECK', 'NO_UPDATE_NOTIFIER']) saved[name] = process.env[name];
  process.env.XDG_CONFIG_HOME = dir;
  // An opt-out inherited from the shell would make every case below vacuous.
  delete process.env.CTS_NO_UPDATE_CHECK;
  delete process.env.NO_UPDATE_NOTIFIER;
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function writeState(state) {
  const p = updateStatePath();
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(state));
}

function readState() {
  return JSON.parse(readFileSync(updateStatePath(), 'utf8'));
}

/** A spawn stand-in that records its calls and hands back the unref-able handle the real one returns. */
function recorder() {
  const calls = [];
  const spawnImpl = (...args) => {
    calls.push(args);
    return { unref() {} };
  };
  return { calls, spawnImpl };
}

test('the interval constants are the documented 24h and 3h', () => {
  assert.equal(UPDATE_CHECK_INTERVAL_MS, 24 * HOUR);
  assert.equal(SESSION_START_CHECK_INTERVAL_MS, 3 * HOUR);
});

test('an upgrade past the cached latest makes the cache stale however fresh it is', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.58.0', current: '3.57.0' });
  assert.equal(updateStatus('3.59.0').stale, true, 'recorded under 3.57.0, running 3.59.0, cache says 3.58.0');
  assert.equal(updateStatus('3.57.0').stale, false, 'same version and just checked');
});

test('an upgrade that does not pass the cached latest leaves the answer standing', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.59.0', current: '3.57.0' });
  assert.equal(updateStatus('3.58.0').stale, false, 'the cache already knows about 3.59.0');
  assert.equal(updateStatus('3.58.0').available, true);
});

test('a downgrade, or two copies rendering side by side, does not re-check', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.59.0', current: '3.59.0' });
  assert.equal(updateStatus('3.58.0').stale, false, 'downgrade');
  const { calls, spawnImpl } = recorder();
  // A dev checkout at 3.54.0 and the global 3.59.0 take turns rendering.
  for (const v of ['3.54.0', '3.59.0', '3.54.0', '3.59.0']) maybeSpawnUpdateCheck(v, { spawnImpl });
  assert.equal(calls.length, 0, 'neither copy is newer than what the cache already holds');
});

test('an upgrade with the registry unreachable spawns once, not on every render', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.57.0', current: '3.57.0' });
  const { calls, spawnImpl } = recorder();
  for (let i = 0; i < 5; i += 1) maybeSpawnUpdateCheck('3.59.0', { spawnImpl });
  // The child never writes `latest` (offline), so 3.59.0 stays newer than the
  // cache; the stamped `current` is what keeps renders two to five quiet.
  assert.equal(calls.length, 1);
});

test('a cache that never recorded a version is judged by age alone', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.58.0' });
  assert.equal(updateStatus('3.59.0').stale, false, 'fresh, no recorded version: nothing to compare');
  writeState({ checkedAt: Date.now() - 25 * HOUR, latest: '3.58.0' });
  assert.equal(updateStatus('3.59.0').stale, true, 'old enough on its own');
});

test('a non-string recorded version is ignored rather than read as a change', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.58.0', current: 359 });
  assert.equal(updateStatus('3.59.0').stale, false);
});

test('intervalMs sets the age at which the cache goes stale', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now() - 4 * HOUR, latest: '3.59.0', current: '3.59.0' });
  assert.equal(updateStatus('3.59.0').stale, false, 'default is 24h');
  assert.equal(updateStatus('3.59.0', { intervalMs: SESSION_START_CHECK_INTERVAL_MS }).stale, true, '4h old, 3h interval');
  assert.equal(updateStatus('3.59.0', { intervalMs: 5 * HOUR }).stale, false, '4h old, 5h interval');
});

test('an unusable intervalMs falls back to the 24h default', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now() - 4 * HOUR, latest: '3.59.0', current: '3.59.0' });
  for (const bad of [NaN, -1, '3', null, undefined, Infinity]) {
    assert.equal(updateStatus('3.59.0', { intervalMs: bad }).stale, false, `intervalMs ${String(bad)}`);
  }
  assert.equal(updateStatus('3.59.0', null).stale, false, 'null options');
});

test('after a version change one spawn is made and the next call makes none', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.58.0', current: '3.58.0' });
  const { calls, spawnImpl } = recorder();

  assert.equal(maybeSpawnUpdateCheck('3.59.0', { spawnImpl }), true);
  assert.equal(calls.length, 1);
  const [bin, args, options] = calls[0];
  assert.equal(bin, process.execPath);
  assert.deepEqual(args.slice(1), ['update-check', '--refresh', '--quiet']);
  assert.equal(options.detached, true);

  // The attempt is recorded before the child exists, with the new version, so
  // an offline machine does not spawn again on the next render.
  const state = readState();
  assert.equal(state.current, '3.59.0');
  assert.ok(Date.now() - state.checkedAt < 60 * 1000, 'checkedAt was stamped');
  assert.equal(updateStatus('3.59.0').stale, false);

  assert.equal(maybeSpawnUpdateCheck('3.59.0', { spawnImpl }), false);
  assert.equal(maybeSpawnUpdateCheck('3.59.0', { spawnImpl }), false);
  assert.equal(calls.length, 1, 'no repeat spawn');
});

test('a spawn that throws still leaves the stamp, so the failure is not retried every render', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.58.0', current: '3.58.0' });
  let attempts = 0;
  const spawnImpl = () => { attempts += 1; throw new Error('EAGAIN'); };

  assert.equal(maybeSpawnUpdateCheck('3.59.0', { spawnImpl }), false);
  assert.equal(attempts, 1);
  assert.equal(readState().current, '3.59.0');
  assert.equal(maybeSpawnUpdateCheck('3.59.0', { spawnImpl }), false);
  assert.equal(attempts, 1, 'the second call saw a fresh stamp and did not try');
});

test('maybeSpawnUpdateCheck judges age by the intervalMs it is given', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now() - 4 * HOUR, latest: '3.59.0', current: '3.59.0' });
  const { calls, spawnImpl } = recorder();

  assert.equal(maybeSpawnUpdateCheck('3.59.0', { spawnImpl }), false, 'statusline default: 4h is fresh');
  assert.equal(calls.length, 0);

  assert.equal(maybeSpawnUpdateCheck('3.59.0', { spawnImpl, intervalMs: SESSION_START_CHECK_INTERVAL_MS }), true);
  assert.equal(calls.length, 1);
  assert.equal(maybeSpawnUpdateCheck('3.59.0', { spawnImpl, intervalMs: SESSION_START_CHECK_INTERVAL_MS }), false);
  assert.equal(calls.length, 1, 'stamped, so the 3h interval is not met again');
});

test('the env opt-out also stops a version change from spawning', (t) => {
  isolated(t);
  writeState({ checkedAt: Date.now(), latest: '3.58.0', current: '3.57.0' });
  process.env.CTS_NO_UPDATE_CHECK = '1';
  const { calls, spawnImpl } = recorder();
  assert.equal(updateStatus('3.59.0').stale, false);
  assert.equal(maybeSpawnUpdateCheck('3.59.0', { spawnImpl }), false);
  assert.equal(calls.length, 0);
});
