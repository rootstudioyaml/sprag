/**
 * Temp files from the tmp+rename writers: a failed write must not leave one
 * behind, and one left by a killed process is swept up, at most once a day.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, utimesSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

// The writers resolve the data directory when their module loads, so the
// environment has to be in place before the imports below.
const home = mkdtempSync(join(tmpdir(), 'cts-tmp-cleanup-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
const dataDir = join(home, 'config', 'claude-token-saver');
mkdirSync(dataDir, { recursive: true });

const stateFile = await import('../src/state-file.js');
const { writeViaTmp, sweepStaleTmp, runHousekeeping, STALE_TMP_AGE_MS, HOUSEKEEPING_INTERVAL_MS } = stateFile;
const sessionCache = await import('../src/session-cache.js');
const capsCache = await import('../src/caps-cache.js');
const panelState = await import('../src/codex-panel-state.js');
const harnessAnalyzer = createRequire(import.meta.url)('../src/harness-analyzer.cjs');

after(() => rmSync(home, { recursive: true, force: true }));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function scratch(name) {
  const dir = join(home, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A file whose mtime is `ageMs` before `now`. */
function aged(path, ageMs, { now = Date.now(), body = 'x' } = {}) {
  writeFileSync(path, body);
  const t = (now - ageMs) / 1000;
  utimesSync(path, t, t);
  return path;
}

const tmpsIn = (dir) => readdirSync(dir).filter((n) => n.endsWith('.tmp'));

// ---- a failed write cleans up after itself --------------------------------

test('writeViaTmp writes the file and leaves no temp file', () => {
  const dir = scratch('via-ok');
  const file = join(dir, 'a.json');
  writeViaTmp(`${file}.1.tmp`, file, '{"a":1}\n');
  writeViaTmp(`${file}.1.tmp`, file, '{"a":2}\n', { mode: 0o600 });
  assert.equal(readFileSync(file, 'utf8'), '{"a":2}\n');
  assert.deepEqual(readdirSync(dir), ['a.json']);
});

test('writeViaTmp removes the temp file when the rename fails, and rethrows', () => {
  const dir = scratch('via-rename');
  const target = join(dir, 'a.json');
  mkdirSync(target); // a directory in the way: the rename cannot replace it
  assert.throws(() => writeViaTmp(`${target}.7.tmp`, target, 'data'));
  assert.deepEqual(tmpsIn(dir), []);
  assert.ok(statSync(target).isDirectory(), 'the target was not touched');
});

test('writeViaTmp reports the write error itself when the temp file cannot be created', () => {
  const dir = scratch('via-write');
  const file = join(dir, 'missing-dir', 'a.json');
  assert.throws(() => writeViaTmp(`${file}.7.tmp`, file, 'data'), { code: 'ENOENT' });
});

test('session-cache: a failed save leaves no temp file', () => {
  const target = sessionCache.sessionCachePath();
  mkdirSync(target);
  try {
    sessionCache.saveCache({ entries: {} }); // best-effort: must not throw
    assert.deepEqual(tmpsIn(dataDir), []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('caps-cache: a failed snapshot write leaves no temp file', () => {
  const target = join(dataDir, 'last-caps.json');
  mkdirSync(target);
  try {
    capsCache.persistSnapshot({ model: 'claude-opus-5' });
    assert.deepEqual(tmpsIn(dataDir), []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('codex-panel-state: a failed record leaves no temp file', () => {
  const dir = scratch('panel-fail');
  const target = panelState.panelStatePath('/project', 'frame', dir);
  mkdirSync(target);
  panelState.recordPanelState('/project', 'frame', { status: 'rendered' }, dir); // must not throw
  assert.deepEqual(tmpsIn(dir), []);
});

test('harness-analyzer: a failed state write leaves no temp file', () => {
  const target = harnessAnalyzer.STATE_PATH;
  mkdirSync(target, { recursive: true });
  try {
    harnessAnalyzer.writeState({ pevSkip: null }); // best-effort: must not throw
    assert.deepEqual(tmpsIn(dataDir), []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- the sweep ------------------------------------------------------------

test('sweepStaleTmp removes old <name>.json.<pid>.tmp files and nothing else', () => {
  const dir = scratch('sweep-shapes');
  const now = Date.now();
  const old = 3 * HOUR;
  const doomed = [
    aged(join(dir, 'session-cache.json.52038.tmp'), old, { now, body: '' }),
    aged(join(dir, 'session-cache.json.58669.tmp'), old, { now, body: 'x'.repeat(112 * 1024) }),
    aged(join(dir, 'codex-panel-abc-frame.json.4242.tmp'), old, { now }),
  ];
  const kept = [
    aged(join(dir, 'session-cache.json'), old, { now }),
    aged(join(dir, 'session-cache.json.corrupt'), old, { now }),
    aged(join(dir, 'state.json.abc.tmp'), old, { now }),         // not a pid
    aged(join(dir, 'state.json.tmp'), old, { now }),             // no pid
    aged(join(dir, 'state.json.123.tmp.bak'), old, { now }),     // another suffix
    aged(join(dir, 'notes.txt.123.tmp'), old, { now }),          // not a .json state file
    aged(join(dir, 'state.json.tmp-123'), old, { now }),         // the tmp-<pid> writers' shape
    aged(join(dir, 'ratchet-preset.md.123.tmp'), old, { now }),
  ];
  mkdirSync(join(dir, 'looks.json.99.tmp')); // a directory with a matching name
  const sub = join(dir, 'nested');
  mkdirSync(sub);
  const nested = aged(join(sub, 'inner.json.55.tmp'), old, { now });

  assert.equal(sweepStaleTmp(dir, { now }), doomed.length);
  for (const f of doomed) assert.equal(existsSync(f), false, f);
  for (const f of [...kept, nested]) assert.equal(existsSync(f), true, f);
  assert.ok(existsSync(join(dir, 'looks.json.99.tmp')));
});

test('sweepStaleTmp keeps a temp file until it is more than an hour old', () => {
  const dir = scratch('sweep-age');
  // Whole seconds, so the mtime the filesystem stores is exactly now - age.
  const now = Math.floor(Date.now() / 1000) * 1000;
  const file = aged(join(dir, 'a.json.10.tmp'), STALE_TMP_AGE_MS - 1000, { now });
  const exactly = aged(join(dir, 'b.json.11.tmp'), STALE_TMP_AGE_MS, { now });
  const over = aged(join(dir, 'c.json.12.tmp'), STALE_TMP_AGE_MS + 5000, { now });

  assert.equal(sweepStaleTmp(dir, { now }), 1);
  assert.equal(existsSync(file), true, 'a writer may be between its write and its rename');
  assert.equal(existsSync(exactly), true);
  assert.equal(existsSync(over), false);
});

test('sweepStaleTmp on a missing directory is a no-op', () => {
  assert.equal(sweepStaleTmp(join(home, 'does-not-exist')), 0);
});

// ---- at most once a day ---------------------------------------------------

test('runHousekeeping runs a job once, then not again until a day has passed', () => {
  const dir = scratch('daily');
  const t0 = 1_800_000_000_000;
  let runs = 0;
  const jobs = { sweep: () => { runs += 1; } };

  assert.deepEqual(runHousekeeping(dir, jobs, { now: t0 }), ['sweep']);
  assert.deepEqual(runHousekeeping(dir, jobs, { now: t0 + 1000 }), []);
  assert.deepEqual(runHousekeeping(dir, jobs, { now: t0 + HOUSEKEEPING_INTERVAL_MS - 1 }), []);
  assert.equal(runs, 1);
  assert.deepEqual(runHousekeeping(dir, jobs, { now: t0 + HOUSEKEEPING_INTERVAL_MS }), ['sweep']);
  assert.equal(runs, 2);
});

test('runHousekeeping stamps each job on its own', () => {
  const dir = scratch('daily-each');
  const t0 = 1_800_000_000_000;
  const ran = [];
  runHousekeeping(dir, { a: () => ran.push('a') }, { now: t0 });
  runHousekeeping(dir, { a: () => ran.push('a'), b: () => ran.push('b') }, { now: t0 + HOUR });
  assert.deepEqual(ran, ['a', 'b'], 'b is new, a is not due yet');
});

test('runHousekeeping stamps before the job runs, so a job that throws is not retried at once', () => {
  const dir = scratch('daily-throw');
  const t0 = 1_800_000_000_000;
  let runs = 0;
  const jobs = { boom: () => { runs += 1; throw new Error('boom'); } };
  assert.doesNotThrow(() => runHousekeeping(dir, jobs, { now: t0 }));
  runHousekeeping(dir, jobs, { now: t0 + HOUR });
  assert.equal(runs, 1);
});

test('runHousekeeping treats a stamp from the future or an unreadable stamp file as due', () => {
  const dir = scratch('daily-odd');
  const t0 = 1_800_000_000_000;
  let runs = 0;
  const jobs = { sweep: () => { runs += 1; } };

  writeFileSync(join(dir, 'housekeeping.json'), JSON.stringify({ sweep: t0 + 10 * DAY }));
  runHousekeeping(dir, jobs, { now: t0 });
  assert.equal(runs, 1, 'clock moved back');

  writeFileSync(join(dir, 'housekeeping.json'), '{not json');
  runHousekeeping(dir, jobs, { now: t0 });
  assert.equal(runs, 2, 'unparseable stamp file');
});

test('runHousekeeping does not run the jobs when the stamp cannot be written', () => {
  const dir = scratch('daily-nowrite');
  mkdirSync(join(dir, 'housekeeping.json')); // a directory where the stamp file should go
  let runs = 0;
  assert.deepEqual(runHousekeeping(dir, { sweep: () => { runs += 1; } }), []);
  assert.equal(runs, 0, 'without a stamp the job would run on every call');
});

// ---- wired into the session-cache save path -------------------------------

test('session-cache save sweeps stale temp files, and only once a day', () => {
  // The failed-save test above already ran the sweep once; start the day over.
  rmSync(join(dataDir, 'housekeeping.json'), { force: true });
  const old = aged(join(dataDir, 'session-cache.json.52038.tmp'), 3 * HOUR, { body: '' });
  const recent = aged(join(dataDir, 'session-cache.json.66895.tmp'), 10 * 60 * 1000);
  const other = aged(join(dataDir, 'unrelated.json.abc.tmp'), 3 * HOUR);

  sessionCache.saveCache({ entries: {} });
  assert.equal(existsSync(old), false, 'the old pid temp file is gone');
  assert.equal(existsSync(recent), true, 'a recent one may belong to a live writer');
  assert.equal(existsSync(other), true, 'a different shape is left alone');
  assert.ok(existsSync(join(dataDir, 'housekeeping.json')));

  // Same day: a new leftover is not looked for.
  const second = aged(join(dataDir, 'session-cache.json.70001.tmp'), 3 * HOUR);
  sessionCache.saveCache({ entries: {} });
  assert.equal(existsSync(second), true, 'the directory was not listed again');

  // A day later it is.
  const stampFile = join(dataDir, 'housekeeping.json');
  const stamps = JSON.parse(readFileSync(stampFile, 'utf8'));
  stamps['stale-tmp'] -= DAY + 1000;
  writeFileSync(stampFile, JSON.stringify(stamps));
  sessionCache.saveCache({ entries: {} });
  assert.equal(existsSync(second), false);
  assert.equal(existsSync(recent), true, 'still under an hour old');
});
