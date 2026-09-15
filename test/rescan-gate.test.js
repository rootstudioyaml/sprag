/**
 * The rescan gate, and the one event exempt from it.
 *
 * The gate exists because a scan over unchanged transcripts is deterministic:
 * running it again spends time to reproduce the same numbers. A finished
 * delegation is the case that breaks that reasoning — savings and the rule's own
 * error rate both move — and its transcript is nowhere near the 5MB the gate
 * wants, so without an exemption the figure the user is watching lags an hour at
 * best and a day at worst.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRescan,
  RESCAN_MIN_INTERVAL_MS,
  RESCAN_AFTER_DELEGATION_MS,
} from '../src/route-scan.js';

const ago = (ms) => new Date(Date.now() - ms).toISOString();

test('no cache at all always scans', async () => {
  assert.equal(await shouldRescan(null), true);
  assert.equal(await shouldRescan({}), true);
  assert.equal(await shouldRescan({ scannedAt: 'not a date' }), true);
});

test('a fresh scan holds the gate shut', async () => {
  const cache = { scannedAt: ago(RESCAN_MIN_INTERVAL_MS / 2), dataBytes: 1 };
  assert.equal(await shouldRescan(cache), false, 'inside the hourly floor');
});

test('a finished delegation is exempt from the hourly floor', async () => {
  // The whole point: this cache would be refused above, and is accepted here.
  const cache = { scannedAt: ago(RESCAN_MIN_INTERVAL_MS / 2), dataBytes: 1 };
  assert.equal(await shouldRescan(cache), false);
  assert.equal(await shouldRescan(cache, { afterDelegation: true }), true);
});

test('the exemption still keeps a floor, so a fan-out triggers one scan', async () => {
  // Parallel agents finish within seconds of each other. Each one calls the
  // hook, and rescanning per agent would spend the saving on measuring it.
  const justNow = { scannedAt: ago(RESCAN_AFTER_DELEGATION_MS / 3), dataBytes: 1 };
  assert.equal(await shouldRescan(justNow, { afterDelegation: true }), false,
    'a second delegation seconds later rides the first scan');

  const settled = { scannedAt: ago(RESCAN_AFTER_DELEGATION_MS * 2), dataBytes: 1 };
  assert.equal(await shouldRescan(settled, { afterDelegation: true }), true,
    'past the floor it scans again');
});

test('the floor is short enough to be imperceptible, and the interval is not', async () => {
  // If these ever converge the exemption stops meaning anything.
  assert.ok(RESCAN_AFTER_DELEGATION_MS < RESCAN_MIN_INTERVAL_MS / 10,
    'the delegation floor must be far below the general interval');
  assert.ok(RESCAN_AFTER_DELEGATION_MS <= 60 * 1000,
    'a user watching the statusline should not wait a minute for it');
});
