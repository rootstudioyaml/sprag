import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { netSavingV3, unitRates, exactCost, priceSource } from '../src/net-saving.js';
import { runSaving, runSavingDetail } from '../src/route-scan.js';
import { collectSessionRecords, delegationContexts, CARRY_CAP } from '../src/session-records.js';
import { collectSubagentRun } from '../src/subagent-records.js';
import { resetModelAliasCache } from '../src/model-alias.js';

const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// Rates chosen so every term is easy to check by hand.
const RATES = { cacheRead: 1e-7, write: 1e-6, output: 5e-6 };
const CALLS = [{ ctx: 20000, newIn: 20000, out: 100 }, { ctx: 21000, newIn: 900, out: 200 }];
const BASE = { calls: CALLS, mainCtx: 100000, followUps: 10, promptTokens: 500, resultTokens: 1000, rates: RATES, subActual: 0.01 };

test('netSavingV3 matches the hand-worked example', () => {
  // CF_work : (100000)*1e-7 + (100000+1000)*1e-7 = 0.0201 cache reads
  //           (20000+900)*1e-6 = 0.0209 writes, 300*5e-6 = 0.0015 output
  // CF_carry: G = (21000-20000)+300 = 1300; 1300*10*1e-7 = 0.0013
  // overhead: 500*5e-6 + 1000*1e-6 + 1000*10*1e-7 = 0.0045
  // saving  : 0.0425 + 0.0013 - (0.01 + 0.0045) = 0.0293
  const r = netSavingV3(BASE);
  near(r.cfWork, 0.0425);
  near(r.cfCarry, 0.0013);
  near(r.overhead, 0.0045);
  near(r.actual, 0.0145);
  near(r.usd, 0.0293);
});

test('a delegation at the end of the session carries nothing forward', () => {
  const r = netSavingV3({ ...BASE, followUps: 0 });
  near(r.cfCarry, 0);
  near(r.overhead, 0.0025 + 0.001); // the result is written once and never re-read
  near(r.usd, 0.0425 - (0.01 + 0.0035));
});

test('skipFirstWrite leaves only the first call new input out', () => {
  const r = netSavingV3({ ...BASE, skipFirstWrite: true });
  near(r.cfWork, 0.0425 - 20000 * 1e-6);
});

test('a run whose context shrank is not credited a negative growth', () => {
  const calls = [{ ctx: 30000, newIn: 30000, out: 50 }, { ctx: 25000, newIn: 10, out: 50 }];
  const r = netSavingV3({ ...BASE, calls });
  // g_2 = 0 and G = 100 (output only), not negative
  near(r.cfCarry, 100 * 10 * 1e-7);
});

test('netSavingV3 returns null when any input is missing or unusable', () => {
  assert.equal(netSavingV3({ ...BASE, calls: [] }), null);
  assert.equal(netSavingV3({ ...BASE, calls: undefined }), null);
  assert.equal(netSavingV3({ ...BASE, calls: [{ ctx: 1, newIn: 1 }] }), null);
  assert.equal(netSavingV3({ ...BASE, mainCtx: null }), null);
  assert.equal(netSavingV3({ ...BASE, mainCtx: 0 }), null);
  assert.equal(netSavingV3({ ...BASE, followUps: null }), null);
  assert.equal(netSavingV3({ ...BASE, promptTokens: null }), null);
  assert.equal(netSavingV3({ ...BASE, resultTokens: NaN }), null);
  assert.equal(netSavingV3({ ...BASE, rates: null }), null);
  assert.equal(netSavingV3({ ...BASE, rates: { cacheRead: 1e-7, write: null, output: 5e-6 } }), null);
  assert.equal(netSavingV3({ ...BASE, subActual: null }), null);
});

test('unitRates reads per-token list rates, and null for no model', () => {
  const r = unitRates('claude-opus-5-5', { env: {} });
  near(r.cacheRead, 0.2e-6);
  near(r.write, 5e-6);
  near(r.output, 20e-6);
  assert.equal(unitRates(null, { env: {} }), null);
  assert.equal(priceSource({}), 'list');
  assert.equal(priceSource({ ANTHROPIC_BASE_URL: 'https://litellm.example.com' }), 'gateway');
});

test('exactCost keeps the sub-cent amounts that estimateCost rounds away', () => {
  // 10k input + 2k output on haiku 5.5: 10000*0.1/M + 2000*0.5/M = 0.002
  const c = exactCost({ input: 10000, output: 2000 }, 'claude-haiku-5-5', { env: {} });
  near(c, 0.002, 1e-9);
});

function run({ perCall, input = 0, out = 0, model = 'claude-haiku-5-5', finalChars = 0 }) {
  return {
    model, calls: perCall.length, input, out, cacheCreation: 20900, cacheRead: 0, ephemeral5m: 20900, ephemeral1h: 0,
    perCall, finalChars,
  };
}

test('runSavingDetail prices on v3 when the main session numbers exist', () => {
  const r = run({ perCall: CALLS, input: 0, out: 300 });
  const info = { C: 100000, N: 10, P: 500, resultChars: 4000, async: false };
  const d = runSavingDetail(r, 'claude-opus-5-5', info, { env: {} });
  assert.equal(d.basis, 'v3');
  // main rates: read 0.2/M, write 5/M, output 20/M; sub (haiku 5.5): 20900 writes*0.125/M + 300*0.5/M
  const subActual = 20900 * 0.125e-6 + 300 * 0.5e-6;
  const cfWork = (100000 + 101000) * 0.2e-6 + 20900 * 5e-6 + 300 * 20e-6;
  const cfCarry = 1300 * 10 * 0.2e-6;
  const overhead = 500 * 20e-6 + 1000 * 5e-6 + 1000 * 10 * 0.2e-6;
  near(d.usd, cfWork + cfCarry - subActual - overhead, 1e-9);
});

test('a background launch counts the report the run produced, not only the acknowledgement', () => {
  const r = run({ perCall: CALLS, out: 300, finalChars: 8000 });
  const sync = runSavingDetail(r, 'claude-opus-5-5', { C: 100000, N: 10, P: 500, resultChars: 1000, async: false }, { env: {} });
  const bg = runSavingDetail(r, 'claude-opus-5-5', { C: 100000, N: 10, P: 500, resultChars: 1000, async: true }, { env: {} });
  // (1000 + 8000)/4 - 1000/4 = 2000 more result tokens, each written once and re-read 10 times
  near(sync.usd - bg.usd, 2000 * 5e-6 + 2000 * 10 * 0.2e-6, 1e-9);
});

test('runSavingDetail falls back to the v2 formula and says so', () => {
  const r = run({ perCall: CALLS, out: 300 });
  const v2 = runSaving(r, 'claude-opus-5-5');
  assert.ok(Number.isFinite(v2));
  const info = { C: 100000, N: 10, P: 500, resultChars: 4000, async: false };
  for (const bad of [
    undefined,                              // delegation not found in the main transcript
    { ...info, resultChars: null },         // no result seen
    { ...info, C: null },                   // context unreadable
    { ...info, P: null },                   // prompt size unreadable
  ]) {
    const d = runSavingDetail(r, 'claude-opus-5-5', bad, { env: {} });
    assert.equal(d.basis, 'v2');
    assert.equal(d.usd, v2);
  }
  const noCalls = runSavingDetail({ ...r, perCall: undefined }, 'claude-opus-5-5', info, { env: {} });
  assert.deepEqual(noCalls, { usd: v2, basis: 'v2' });
});

test('an unpriced model is null, never a substitute value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-net-saving-'));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir; // a gateway with no price table
  resetModelAliasCache();
  try {
    const env = { ANTHROPIC_BASE_URL: 'https://litellm.example.com' };
    assert.equal(unitRates('claude-opus-5-5', { env }), null);
    assert.equal(exactCost({ input: 1000, output: 10 }, 'claude-haiku-5-5', { env }), null);
    const r = run({ perCall: CALLS, out: 300 });
    const info = { C: 100000, N: 10, P: 500, resultChars: 4000, async: false };
    assert.equal(runSavingDetail(r, 'claude-opus-5-5', info, { env }), null);
    assert.equal(runSavingDetail({ ...r, model: null }, 'claude-opus-5-5', info, { env: {} }), null);
    assert.equal(runSavingDetail(r, null, info, { env: {} }), null);
  } finally {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev;
    resetModelAliasCache();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ── reading the numbers out of transcripts ───────────────────────────────

const usage = (input, cr, cc, out) => ({ input_tokens: input, cache_read_input_tokens: cr, cache_creation_input_tokens: cc, output_tokens: out });
let seq = 0;
function asst(id, u, content = [{ type: 'text', text: 'ok' }]) {
  seq += 1;
  return { type: 'assistant', timestamp: new Date(1700000000000 + seq * 1000).toISOString(), requestId: `r-${id}`,
    message: { id: `m-${id}`, model: 'claude-opus-5-5', usage: u, content } };
}
const agentUse = (id, prompt = 'x'.repeat(400)) => ({ type: 'tool_use', id, name: 'Agent', input: { prompt } });
function result(id, text, toolUseResult) {
  return { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] }, ...(toolUseResult ? { toolUseResult } : {}) };
}
const toLines = (entries) => entries.map((e) => JSON.stringify(e)).join('\n') + '\n';

test('delegationContexts reads C, N, P and the result, and stops at a compaction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-net-saving-'));
  try {
    const f = join(dir, 's.jsonl');
    writeFileSync(f, toLines([
      { type: 'user', message: { role: 'user', content: 'go' } },
      asst('1', usage(10, 90000, 0, 50)),
      asst('2', usage(10, 100000, 0, 600), [agentUse('toolu_a'), agentUse('toolu_b')]),
      result('toolu_a', 'y'.repeat(2000)),
      result('toolu_b', 'ack', { isAsync: true, status: 'async_launched' }),
      asst('3', usage(10, 101000, 0, 50)),
      asst('4', usage(10, 102000, 0, 50)),
      asst('5', usage(10, 20000, 0, 50)), // compaction: context collapses
      asst('6', usage(10, 21000, 0, 50)),
    ]));
    const records = await collectSessionRecords(f, { includeContent: false });
    const info = delegationContexts(records);
    assert.deepEqual([...info.keys()], ['toolu_a', 'toolu_b']);
    const a = info.get('toolu_a');
    assert.equal(a.C, 100010);
    assert.equal(a.N, 2);            // calls 3 and 4; call 5 follows the compaction
    assert.equal(a.P, 300);          // 600 output tokens shared by two delegations
    assert.equal(a.resultChars, 2000);
    assert.equal(a.async, false);
    assert.equal(info.get('toolu_b').resultChars, 3);
    assert.equal(info.get('toolu_b').async, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('delegationContexts caps N and leaves unreadable values null', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-net-saving-'));
  try {
    const f = join(dir, 's.jsonl');
    const entries = [asst('d', usage(10, 50000, 0, 0), [agentUse('toolu_x')])];
    for (let i = 0; i < CARRY_CAP + 20; i++) entries.push(asst(`f${i}`, usage(10, 50000, 0, 5)));
    writeFileSync(f, toLines(entries));
    const info = delegationContexts(await collectSessionRecords(f, { includeContent: false })).get('toolu_x');
    assert.equal(info.N, CARRY_CAP);
    assert.equal(info.resultChars, null); // no tool_result ever arrived
    assert.equal(info.P, null);           // the call wrote no output tokens
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a subagent run carries its per-call context and the size of its report', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-net-saving-'));
  try {
    const sub = join(dir, 'sid', 'subagents');
    mkdirSync(sub, { recursive: true });
    const f = join(sub, 'agent-abc.jsonl');
    writeFileSync(f, toLines([
      asst('s1', usage(5, 0, 20000, 100), [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
      asst('s2', usage(5, 20000, 900, 200), [{ type: 'text', text: 'z'.repeat(777) }]),
    ]));
    const r = await collectSubagentRun(f);
    assert.deepEqual(r.perCall, [{ ctx: 20005, newIn: 20005, out: 100 }, { ctx: 20905, newIn: 905, out: 200 }]);
    assert.equal(r.finalChars, 777);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the ledger ────────────────────────────────────────────────────────────

test('a v2 ledger keeps its events, and a rescan reprices them as v3 with the basis fields', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-net-saving-'));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const ledger = await import('../src/savings-ledger.js');
  assert.equal(ledger.LEDGER_VERSION, 3);
  mkdirSync(join(ledger.ledgerPath(), '..'), { recursive: true });
  const old = '/h/.claude/projects/-p/sid-old/subagents/agent-old.jsonl';
  const inWindow = '/h/.claude/projects/-p/sid-new/subagents/agent-new.jsonl';
  writeFileSync(ledger.ledgerPath(), JSON.stringify({ version: 2, events: {
    [old]: { ts: 1000, usd: 4, from: 'claude-opus-5', to: 'claude-haiku-5-5' },
    [inWindow]: { ts: 2000, usd: 1, from: 'claude-opus-5', to: 'claude-haiku-5-5' },
  } }));
  assert.equal(ledger.delegationSavedTotals(3000).total, 5); // nothing dropped by the version bump

  ledger.recordDelegationEvents([{ key: inWindow, ts: 2000, usd: 2.5, from: 'claude-opus-5', to: 'claude-haiku-5-5',
    basis: 'v3', priceSource: 'list', baselineSource: 'episode' }]);
  const saved = JSON.parse(readFileSync(ledger.ledgerPath(), 'utf8'));
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.events[inWindow], { ts: 2000, usd: 2.5, from: 'claude-opus-5', to: 'claude-haiku-5-5',
    basis: 'v3', priceSource: 'list', baselineSource: 'episode' });
  assert.equal(saved.events[old].basis, undefined); // outside the window: value kept, no basis = v2
  assert.equal(saved.events[old].usd, 4);
  assert.equal(ledger.delegationSavedTotals(3000).total, 6.5);

  // The same figure with a different basis is a change, so it is rewritten.
  ledger.recordDelegationEvents([{ key: inWindow, ts: 2000, usd: 2.5, from: 'claude-opus-5', to: 'claude-haiku-5-5',
    basis: 'v2', priceSource: 'list', baselineSource: 'rule' }]);
  assert.equal(JSON.parse(readFileSync(ledger.ledgerPath(), 'utf8')).events[inWindow].basis, 'v2');

  // Version 1 is still discarded.
  writeFileSync(ledger.ledgerPath(), JSON.stringify({ version: 1, events: { [old]: { ts: 1000, usd: 9 } } }));
  assert.equal(ledger.delegationSavedTotals(3000).total, 0);
});

test('a report delivered through the handback tool counts as the run\'s final message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-net-saving-'));
  try {
    const sub = join(dir, 'sid', 'subagents');
    mkdirSync(sub, { recursive: true });
    const f = join(sub, 'agent-hb.jsonl');
    writeFileSync(f, toLines([
      asst('h1', usage(5, 0, 20000, 100), [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
      asst('h2', usage(5, 20000, 900, 200), [{ type: 'tool_use', id: 't2', name: 'SubagentHandback', input: { message: 'm'.repeat(1234) } }]),
    ]));
    assert.equal((await collectSubagentRun(f)).finalChars, 1234);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
