// #15 stage 2: the ledger stores token quantities and computes dollars from
// them with the price in effect when the run happened.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// The ledger path resolves from the environment when the module loads.
const home = realpathSync(mkdtempSync(join(tmpdir(), 'cts-ledger-q-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
process.env.APPDATA = join(home, 'config');
delete process.env.ANTHROPIC_BASE_URL;

const ledger = await import('../src/savings-ledger.js');
const { netSavingV3, netSavingQuantities, unitRates, exactCost } = await import('../src/net-saving.js');
const { runSavingDetail, runTotals, runTime } = await import('../src/route-scan.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const ZERO = { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 };
const OCT1 = Date.parse('2026-10-01T12:00:00Z');
const OCT10 = Date.parse('2026-10-10T12:00:00Z');
const read = () => JSON.parse(readFileSync(ledger.ledgerPath(), 'utf8'));
const write = (obj) => {
  mkdirSync(dirname(ledger.ledgerPath()), { recursive: true });
  writeFileSync(ledger.ledgerPath(), JSON.stringify(obj));
};

const v2event = (at) => ({
  ts: at, usd: 123, cost: 456, priceSource: 'list', from: 'claude-sonnet-5-5', to: 'claude-haiku-4-5-20251001',
  q: { at, sub: { ...ZERO, cacheRead: 10_000_000 } },
});

test('priceLedgerEvent v2 uses the price in effect at q.at', () => {
  // Sonnet 5.5 cache read was $0.20/M until 2026-10-07 and $0.10/M after; the Haiku 4.5 run's own cost is the same.
  const early = ledger.priceLedgerEvent(v2event(OCT1));
  const late = ledger.priceLedgerEvent(v2event(OCT10));
  const hCost = exactCost({ ...ZERO, cacheRead: 10_000_000 }, 'claude-haiku-4-5-20251001', { env: {}, at: OCT1 });
  assert.equal(early.cost, ledger.roundUsd(hCost));
  assert.equal(late.cost, early.cost);
  near(early.usd, ledger.roundUsd(2 - hCost), 1e-9);
  near(late.usd, ledger.roundUsd(1 - hCost), 1e-9);
  assert.ok(early.usd - late.usd > 0.99 && early.usd - late.usd < 1.01);
});

test('priceLedgerEvent v2: zero-cost sub model gives the plain difference', () => {
  // a sub run with a free output: the cost is whatever the table says; check the spec example with cache reads only
  const e = { priceSource: 'list', from: 'claude-sonnet-5-5', to: 'claude-sonnet-5-5', q: { at: OCT1, sub: { ...ZERO, cacheRead: 10_000_000 } } };
  assert.deepEqual(ledger.priceLedgerEvent(e), { usd: 0, cost: 2 });
  assert.equal(ledger.priceLedgerEvent({ ...e, q: { ...e.q, at: OCT10 } }).cost, 1);
});

test('priceLedgerEvent v3 equals what runSavingDetail computed for the same run', () => {
  const calls = [{ ctx: 20000, newIn: 20000, out: 100 }, { ctx: 21000, newIn: 900, out: 200 }];
  const run = {
    model: 'claude-haiku-5-5', calls: 2, input: 0, out: 300, cacheCreation: 20900, cacheRead: 0,
    ephemeral5m: 20900, ephemeral1h: 0, perCall: calls, finalChars: 0, startedAt: OCT1,
  };
  const info = { C: 100000, N: 10, P: 500, resultChars: 4001, async: false };
  const d = runSavingDetail(run, 'claude-opus-5-5', info, { env: {} });
  assert.equal(d.basis, 'v3');
  const e = {
    priceSource: 'list', from: 'claude-opus-5-5', to: run.model,
    q: { at: runTime(run), sub: runTotals(run), main: d.main },
  };
  const p = ledger.priceLedgerEvent(e);
  assert.equal(p.usd, ledger.roundUsd(d.usd));
  assert.equal(p.cost, ledger.roundUsd(exactCost(runTotals(run), run.model, { env: {}, at: OCT1 })));
  // and from the plain functions at the same time
  const rates = unitRates('claude-opus-5-5', { env: {}, at: OCT1 });
  const sub = exactCost(runTotals(run), run.model, { env: {}, at: OCT1 });
  const ref = netSavingV3({ calls, mainCtx: 100000, followUps: 10, promptTokens: 500, resultTokens: 4001 / 4, rates, subActual: sub });
  near(d.usd, ref.usd);
  assert.deepEqual(d.main, netSavingQuantities({ calls, mainCtx: 100000, followUps: 10, promptTokens: 500, resultTokens: 4001 / 4 }));
});

test('priceLedgerEvent is null when the event cannot be priced from quantities', () => {
  const e = v2event(OCT1);
  assert.ok(ledger.priceLedgerEvent(e));
  const { q, ...noQ } = e;
  assert.equal(ledger.priceLedgerEvent(noQ), null);
  assert.equal(ledger.priceLedgerEvent({ ...e, priceSource: 'gateway' }), null);
  assert.equal(ledger.priceLedgerEvent({ ...e, priceSource: undefined }), null);
  assert.equal(ledger.priceLedgerEvent({ ...e, from: undefined }), null);
  assert.equal(ledger.priceLedgerEvent({ ...e, to: undefined }), null);
  assert.equal(ledger.priceLedgerEvent(null), null);
});

test('loadLedger computes dollars from q and leaves an event without q alone', () => {
  write({ version: 3, events: {
    '/p/s1/subagents/a.jsonl': v2event(OCT10),
    '/p/s2/subagents/b.jsonl': { ts: OCT10, usd: 7, cost: 1, from: 'claude-sonnet-5-5', to: 'claude-haiku-5-5', priceSource: 'list' },
  } });
  const events = ledger.loadLedger().events;
  const a = events['/p/s1/subagents/a.jsonl'];
  assert.notEqual(a.usd, 123);
  assert.notEqual(a.cost, 456);
  assert.deepEqual({ usd: a.usd, cost: a.cost }, ledger.priceLedgerEvent(a));
  assert.deepEqual(events['/p/s2/subagents/b.jsonl'].usd, 7);
  assert.equal(events['/p/s2/subagents/b.jsonl'].cost, 1);
  // readers see the computed figure
  near(ledger.delegationSavedTotals(OCT10 + 1000).total, a.usd + 7, 1e-9);
  // reading does not rewrite the file
  assert.equal(read().events['/p/s1/subagents/a.jsonl'].usd, 123);
});

test('an identical event recorded twice does not bump changeSeq', () => {
  rmSync(ledger.ledgerPath(), { force: true });
  const key = '/p/s3/subagents/c.jsonl';
  const ev = () => {
    const e = v2event(OCT10);
    const p = ledger.priceLedgerEvent(e);
    return { key, ts: OCT10, usd: p.usd, cost: p.cost, from: e.from, to: e.to, basis: 'v2', priceSource: 'list', q: { ...e.q, sub: { ...e.q.sub } } };
  };
  ledger.recordDelegationEvents([ev()]);
  const first = read();
  assert.equal(first.changeSeq, 1);
  assert.deepEqual(first.events[key].q, v2event(OCT10).q);
  ledger.recordDelegationEvents([ev()]);
  assert.equal(read().changeSeq, 1);
  // a changed quantity is a change
  const moved = ev();
  moved.q.sub.cacheRead += 1;
  ledger.recordDelegationEvents([moved]);
  assert.equal(read().changeSeq, 2);
});

test('repriceDelegationLedger stores corrected figures and marks the earliest changed day', () => {
  const T0 = OCT1;
  const T1 = OCT10;
  const withQ = v2event(T1);
  write({ version: 3, changeTracking: 1, events: {
    '/p/s4/subagents/d.jsonl': { ...withQ, usd: 99, cost: 99 },
    '/p/s5/subagents/e.jsonl': { ts: T0, usd: 5, cost: 1, from: 'claude-sonnet-5-5', to: 'claude-haiku-5-5', priceSource: 'list' },
  } });
  assert.equal(ledger.repriceDelegationLedger(), 1);
  const after1 = read();
  const want = ledger.priceLedgerEvent(withQ);
  assert.equal(after1.events['/p/s4/subagents/d.jsonl'].usd, want.usd);
  assert.equal(after1.events['/p/s4/subagents/d.jsonl'].cost, want.cost);
  assert.equal(after1.events['/p/s5/subagents/e.jsonl'].usd, 5);
  assert.equal(after1.changedSince, T1);
  assert.equal(after1.changeSeq, 1);
  assert.equal(ledger.changedSinceForSync().since, T1);

  assert.equal(ledger.repriceDelegationLedger(), 0);
  assert.equal(read().changeSeq, 1);
});
