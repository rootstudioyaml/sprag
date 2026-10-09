/**
 * Codex panel state files: one pair per session, never removed before. Files
 * untouched for a week go, nothing else does, and the directory is not listed
 * on every write.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const home = mkdtempSync(join(tmpdir(), 'cts-panel-sweep-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
delete process.env.CODEX_HOME;

const { sweepPanelState, recordPanelState, panelStatePath, panelHealth, readPanelState, PANEL_STATE_MAX_AGE_MS } =
  await import('../src/codex-panel-state.js');

after(() => rmSync(home, { recursive: true, force: true }));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Whole seconds, so the mtime the filesystem stores is exactly now - age. */
const wholeSecondNow = () => Math.floor(Date.now() / 1000) * 1000;

function scratch(name) {
  const dir = join(home, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function aged(path, ageMs, now = wholeSecondNow()) {
  writeFileSync(path, '{}');
  const t = (now - ageMs) / 1000;
  utimesSync(path, t, t);
  return path;
}

const hex = (c) => c.repeat(64);
const panelFile = (dir, c, kind) => join(dir, `codex-panel-${hex(c)}-${kind}.json`);

test('sweepPanelState removes week-old frame and hook files and keeps recent ones', () => {
  const dir = scratch('sweep-age');
  const now = wholeSecondNow();
  const oldFrame = aged(panelFile(dir, 'a', 'frame'), 8 * DAY, now);
  const oldHook = aged(panelFile(dir, 'b', 'hook'), 30 * DAY, now);
  const recentFrame = aged(panelFile(dir, 'c', 'frame'), 6 * DAY, now);
  const recentHook = aged(panelFile(dir, 'd', 'hook'), 1000, now);

  assert.equal(sweepPanelState({ dir, now }), 2);
  assert.equal(existsSync(oldFrame), false);
  assert.equal(existsSync(oldHook), false);
  assert.equal(existsSync(recentFrame), true);
  assert.equal(existsSync(recentHook), true);
});

test('sweepPanelState keeps a file until it is more than seven days old', () => {
  const dir = scratch('sweep-boundary');
  const now = wholeSecondNow();
  const exactly = aged(panelFile(dir, 'a', 'frame'), PANEL_STATE_MAX_AGE_MS, now);
  const over = aged(panelFile(dir, 'b', 'frame'), PANEL_STATE_MAX_AGE_MS + 1000, now);
  assert.equal(PANEL_STATE_MAX_AGE_MS, 7 * DAY);

  sweepPanelState({ dir, now });
  assert.equal(existsSync(exactly), true);
  assert.equal(existsSync(over), false);
});

test('sweepPanelState leaves files of any other name alone, however old', () => {
  const dir = scratch('sweep-names');
  const now = wholeSecondNow();
  const kept = [
    join(dir, 'codex-panel-abc-frame.json'),                           // hash too short
    join(dir, `codex-panel-${'A'.repeat(64)}-frame.json`),             // not lowercase hex
    join(dir, `codex-panel-${'a'.repeat(65)}-frame.json`),             // hash too long
    join(dir, `codex-panel-${hex('a')}-other.json`),                   // another kind
    join(dir, `codex-panel-${hex('a')}-frame.json.bak`),               // another suffix
    join(dir, `xcodex-panel-${hex('a')}-frame.json`),                  // another prefix
    join(dir, 'session-cache.json'),
    join(dir, 'update-check.json'),
    join(dir, 'housekeeping.json'),
  ].map((f) => aged(f, 60 * DAY, now));
  mkdirSync(join(dir, `codex-panel-${hex('f')}-hook.json`)); // a directory with a matching name

  assert.equal(sweepPanelState({ dir, now }), 0);
  for (const f of kept) assert.equal(existsSync(f), true, f);
  assert.equal(existsSync(join(dir, `codex-panel-${hex('f')}-hook.json`)), true);
});

test('sweepPanelState never removes a path it was told to keep', () => {
  const dir = scratch('sweep-keep');
  const now = wholeSecondNow();
  const mine = aged(panelFile(dir, 'a', 'frame'), 40 * DAY, now);
  const theirs = aged(panelFile(dir, 'b', 'frame'), 40 * DAY, now);

  assert.equal(sweepPanelState({ dir, now, keep: [mine] }), 1);
  assert.equal(existsSync(mine), true);
  assert.equal(existsSync(theirs), false);
});

test('sweepPanelState on a missing directory is a no-op', () => {
  assert.equal(sweepPanelState({ dir: join(home, 'nope') }), 0);
});

test('recording panel state sweeps old files once, and keeps this session\'s files of both kinds', () => {
  const dir = scratch('record');
  const now = wholeSecondNow();

  // This session's hook record, written first and then left to age past a week
  // while the frame keeps being rewritten.
  recordPanelState('/project', 'hook', { status: 'opened', sessionId: 's1' }, dir);
  const ownHooks = [panelStatePath('/project', 'hook', dir), panelStatePath('/project', 'hook', dir, 's1')];
  for (const f of ownHooks) assert.equal(existsSync(f), true);
  // That first write ran the day's clean-up; start the day over for the case below.
  rmSync(join(dir, 'housekeeping.json'), { force: true });

  // Backdate in place: aged() rewrites the file as {}, which would drop the
  // status the panelHealth check below reads back.
  for (const f of ownHooks) utimesSync(f, (now - 10 * DAY) / 1000, (now - 10 * DAY) / 1000);
  const oldOther = [
    aged(panelFile(dir, 'a', 'frame'), 10 * DAY, now),
    aged(panelFile(dir, 'b', 'hook'), 10 * DAY, now),
  ];
  const recentOther = aged(panelFile(dir, 'c', 'frame'), 2 * DAY, now);
  const unrelated = aged(join(dir, 'last-caps.json'), 10 * DAY, now);
  const strayTmp = aged(`${panelFile(dir, 'd', 'frame')}.4242.tmp`, 3 * HOUR, now);

  recordPanelState('/project', 'frame', { status: 'rendered', sessionId: 's1' }, dir);

  for (const f of oldOther) assert.equal(existsSync(f), false, f);
  assert.equal(existsSync(strayTmp), false, 'a dead writer\'s temp file goes in the same pass');
  assert.equal(existsSync(recentOther), true);
  assert.equal(existsSync(unrelated), true);
  for (const f of ownHooks) assert.equal(existsSync(f), true, 'this session\'s hook record survives its own age');
  assert.equal(panelHealth('/project', { dir, sessionId: 's1' }).hook?.status, 'opened');
  assert.equal(panelHealth('/project', { dir, sessionId: 's1' }).live, true);

  // A second write the same day does not go looking again.
  const lateOld = aged(panelFile(dir, 'e', 'frame'), 10 * DAY, now);
  recordPanelState('/project', 'frame', { status: 'rendered', sessionId: 's1' }, dir);
  recordPanelState('/project', 'frame', { status: 'rendered', sessionId: 's1' }, dir);
  assert.equal(existsSync(lateOld), true, 'throttled to once a day');
});

test('a write after a day has passed sweeps again', () => {
  const dir = scratch('record-next-day');
  const now = wholeSecondNow();
  recordPanelState('/project', 'frame', { status: 'rendered' }, dir);
  const lateOld = aged(panelFile(dir, 'e', 'frame'), 10 * DAY, now);

  recordPanelState('/project', 'frame', { status: 'rendered' }, dir);
  assert.equal(existsSync(lateOld), true, 'same day');

  const stampFile = join(dir, 'housekeeping.json');
  const stamps = JSON.parse(readFileSync(stampFile, 'utf8'));
  stamps['codex-panel'] -= DAY + 1000;
  writeFileSync(stampFile, JSON.stringify(stamps));
  recordPanelState('/project', 'frame', { status: 'rendered' }, dir);
  assert.equal(existsSync(lateOld), false, 'a day later');
  assert.equal(readPanelState('/project', 'frame', dir)?.status, 'rendered');
});

test('recording panel state still writes the record when the directory holds nothing to sweep', () => {
  const dir = scratch('record-plain');
  recordPanelState('/project', 'hook', { status: 'started' }, dir);
  assert.equal(readPanelState('/project', 'hook', dir).status, 'started');
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});
