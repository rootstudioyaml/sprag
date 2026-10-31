// A rescan that changes figures for days the team sync already uploaded (the
// v3 repricing, a run found late) must make the next sync re-send those days.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The ledger path resolves from the environment when the module loads.
const home = realpathSync(mkdtempSync(join(tmpdir(), 'cts-ledger-change-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
process.env.APPDATA = join(home, 'config');

const ledger = await import('../src/savings-ledger.js');
const { ledgerWindow } = await import('../src/team-sync.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const at = (d, h = 12) => new Date(2026, 9, d, h, 0).getTime();
const ev = (key, day, usd) => ({ key, ts: at(day), usd, cost: 0.1, to: 'claude-sonnet-5-5', basis: 'v3' });

test('ledgerWindow reaches back to the day the ledger changed, capped at 30 days', () => {
  const now = at(31);
  const synced = { ledgerSyncedThrough: '2026-10-31' };
  assert.equal(ledgerWindow(synced, now).startKey, '2026-10-30');
  assert.equal(ledgerWindow(synced, now, { changedSince: at(20, 23) }).startKey, '2026-10-20');
  // a change inside the usual window does not shrink it
  assert.equal(ledgerWindow({ ledgerSyncedThrough: '2026-10-10' }, now, { changedSince: at(25) }).startKey, '2026-10-09');
  // never further back than the 30-day window
  assert.equal(ledgerWindow(synced, now, { changedSince: new Date(2026, 6, 1).getTime() }).startKey, '2026-10-02');
  assert.equal(ledgerWindow(synced, now, { changedSince: null }).startKey, '2026-10-30');
});

test('a ledger from before the mark existed is re-sent once, from its earliest event', () => {
  ledger.recordDelegationEvents([ev('/a/subagents/r0.jsonl', 5, 1)]);
  const first = ledger.changedSinceForSync();
  assert.equal(first.initial, true);
  assert.equal(first.since, at(5));
  assert.ok(ledger.clearChangedSince(first.seq));
  assert.equal(ledger.changedSinceForSync(), null);
});

test('recording events marks the earliest changed day; an unchanged rescan does not', () => {
  ledger.recordDelegationEvents([ev('/a/subagents/r1.jsonl', 18, 1), ev('/a/subagents/r2.jsonl', 22, 2)]);
  const first = ledger.changedSinceForSync();
  assert.equal(first.since, at(18));
  assert.ok(ledger.clearChangedSince(first.seq));
  assert.equal(ledger.changedSinceForSync(), null);

  // the same figures again: nothing to re-send
  ledger.recordDelegationEvents([ev('/a/subagents/r1.jsonl', 18, 1), ev('/a/subagents/r2.jsonl', 22, 2)]);
  assert.equal(ledger.changedSinceForSync(), null);

  // a repriced run from the 22nd marks the 22nd
  ledger.recordDelegationEvents([ev('/a/subagents/r2.jsonl', 22, 5)]);
  assert.equal(ledger.changedSinceForSync().since, at(22));
});

test('a change made while the sync was uploading survives the clear', () => {
  const seen = ledger.changedSinceForSync();
  // the scan reprices an older run before the sync finishes
  ledger.recordDelegationEvents([ev('/a/subagents/r1.jsonl', 18, 3)]);
  assert.equal(ledger.clearChangedSince(seen.seq), false);
  assert.equal(ledger.changedSinceForSync().since, at(18));
});
