/**
 * Unified usage (HANDOFF-2026-10-27): the gateway daily spend module, the
 * Codex parser's usage records, the Codex ledger's cost, and the v2 daily row
 * aggregateDaily builds from them, plus the sync's handling of a gateway
 * failure. XDG_CONFIG_HOME points at a temp dir; every fetch is injected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sumSpendRows, gatewayDayValue, fetchGatewayDailySpend, gatewayUserHash } from '../src/gateway-spend.js';
import { parseCodexSessionFile } from '../src/codex/parser.js';
import { recordCodexDelegation, bindCodexSubagent, refreshCodexLedger, codexEventCost } from '../src/codex/ledger.js';
import { aggregateDaily, syncTeam, ledgerWindow, loadTeamState, saveTeamState, deviceInfo } from '../src/team-sync.js';
import { userDataDir } from '../src/paths.js';
import { codexBudgetProvider } from '../src/codex/budget.js';
import { refreshCodexPrices } from '../src/codex/cache-policy.js';
import { withClaudeSettingsEnv } from '../src/gateway-auth.js';

const GW = { ANTHROPIC_BASE_URL: 'https://litellm.example.com', ANTHROPIC_AUTH_TOKEN: 'sk-test-token' };

function isolate(t) {
  const root = mkdtempSync(join(tmpdir(), 'sprag-unified-'));
  const saved = {};
  for (const k of ['HOME', 'APPDATA', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'SPRAG_NO_TEAM_SYNC', 'SPRAG_TEAM_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']) saved[k] = process.env[k];
  process.env.XDG_CONFIG_HOME = root;
  process.env.HOME = root;
  process.env.APPDATA = root; // Cowork transcripts are looked for under %APPDATA% on Windows
  process.env.CODEX_HOME = join(root, '.codex');
  for (const k of ['SPRAG_NO_TEAM_SYNC', 'SPRAG_TEAM_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']) delete process.env[k];
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const dir = userDataDir();
  mkdirSync(dir, { recursive: true });
  return { root, dir };
}

/** A gateway fake: /key/info 404, /user/info with the id, /global/spend/logs with rows for two users. */
function gatewayFake({ userId = 'me@example.com', rows, keyInfo = false, fail = null, hang = false } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push(url);
    const path = new URL(url).pathname;
    if (hang) {
      // like fetch: an already-aborted signal rejects at once, a live one on abort
      const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (init.signal.aborted) return Promise.reject(abortErr());
      return new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(abortErr())); });
    }
    if (fail === path) return { ok: false, status: 500, json: async () => ({}) };
    if (path === '/key/info') return keyInfo ? { ok: true, status: 200, json: async () => ({ info: { user_id: userId } }) } : { ok: false, status: 404, json: async () => ({}) };
    if (path === '/user/info') return { ok: true, status: 200, json: async () => ({ user_info: { user_id: userId } }) };
    if (path === '/global/spend/logs') return { ok: true, status: 200, json: async () => rows };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  f.calls = calls;
  return f;
}

const ROWS = [
  { date: '2026-10-20', spend: 100.5, api_key: 'hashed-1', user: 'me@example.com' },
  { date: '2026-10-20', spend: 9.5, api_key: 'hashed-2', user: 'me@example.com' },
  { date: '2026-10-20', spend: 999, api_key: 'hashed-3', user: 'someone-else' },
  { date: '2026-10-22', spend: 3, api_key: 'hashed-1', user: 'me@example.com' },
  { date: 'garbage', spend: 5, user: 'me@example.com' },
];

// ── gateway-spend ─────────────────────────────────────────────────────────

test('sumSpendRows keeps only the caller\'s rows and sums them by date', () => {
  const { days, earliest } = sumSpendRows(ROWS, 'me@example.com');
  assert.deepEqual([...days.entries()], [['2026-10-20', 110], ['2026-10-22', 3]]);
  assert.equal(earliest, '2026-10-20');
  assert.deepEqual([...sumSpendRows({ data: ROWS }, 'nobody').days.entries()], []);
});

test('fetchGatewayDailySpend: own rows by day, 0 inside the window, null outside, hash of the user', async () => {
  const now = new Date(2026, 9, 25, 12).getTime();
  const f = gatewayFake({ rows: ROWS });
  const r = await fetchGatewayDailySpend({ env: GW, fetchImpl: f, now });
  assert.deepEqual(f.calls.map((u) => new URL(u).pathname), ['/key/info', '/user/info', '/global/spend/logs']);
  assert.equal(r.userId, 'me@example.com');
  assert.equal(r.userHash, gatewayUserHash('https://litellm.example.com', 'me@example.com'));
  assert.match(r.userHash, /^[0-9a-f]{16}$/);
  assert.equal(r.coveredTo, '2026-10-25');
  assert.equal(r.coveredFrom, '2026-09-26');
  assert.equal(gatewayDayValue(r, '2026-10-20'), 110);
  assert.equal(gatewayDayValue(r, '2026-10-21'), 0, 'a covered day without rows is zero spend');
  assert.equal(gatewayDayValue(r, '2026-09-01'), null, 'outside the window is unknown');
  assert.equal(gatewayDayValue(r, '2026-10-26'), null);
  // /key/info answering with the id is used first, like pickBudgetSource
  const g = gatewayFake({ rows: ROWS, keyInfo: true, userId: 'other@example.com' });
  const r2 = await fetchGatewayDailySpend({ env: GW, fetchImpl: g, now });
  assert.deepEqual(g.calls.map((u) => new URL(u).pathname), ['/key/info', '/global/spend/logs']);
  assert.equal(gatewayDayValue(r2, '2026-10-20'), 0, 'rows of another user are not summed');
});

test('fetchGatewayDailySpend: no gateway → null, unknown user id → null, failure → { error }, timeout → { error }', async () => {
  assert.equal(await fetchGatewayDailySpend({ env: {}, fetchImpl: gatewayFake({ rows: ROWS }) }), null);
  const noId = gatewayFake({ rows: ROWS, userId: '' });
  assert.equal(await fetchGatewayDailySpend({ env: GW, fetchImpl: noId }), null);
  assert.equal(noId.calls.length, 2, 'without a user id the spend logs are never fetched');
  const down = await fetchGatewayDailySpend({ env: GW, fetchImpl: gatewayFake({ rows: ROWS, fail: '/global/spend/logs' }) });
  assert.match(down.error, /500/);
  const slow = await fetchGatewayDailySpend({ env: GW, fetchImpl: gatewayFake({ rows: ROWS, hang: true }), timeoutMs: 20 });
  assert.equal(slow.error, 'timeout');
});

// ── Codex parser: usage records ───────────────────────────────────────────

const meta = (id) => ({ timestamp: '2026-10-20T01:00:00.000Z', type: 'session_meta', payload: { id, cwd: '/p', model_provider: 'openai' } });
const turnCtx = (turn, model) => ({ timestamp: '2026-10-20T01:00:01.000Z', type: 'turn_context', payload: { turn_id: turn, model } });
const record = (turn, resp, usage, ts = '2026-10-20T01:00:02.000Z') => ({ timestamp: ts, type: 'token_usage_record', payload: { turn_id: turn, response_id: resp, usage } });
const tokenCount = (total, ts = '2026-10-20T01:00:03.000Z') => ({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: total, model_context_window: 200000 } } });
const u = (input, cached, cacheWrite, output) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: cacheWrite, output_tokens: output, reasoning_output_tokens: 0 });

async function parseRollout(t, lines) {
  const { root } = isolate(t);
  const file = join(root, 'rollout.jsonl');
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return parseCodexSessionFile(file);
}

test('a rollout with usage records is summed from them, per model, with cache writes, duplicates by response_id dropped', async (t) => {
  const s = await parseRollout(t, [
    meta('s1'), turnCtx('t1', 'gpt-6-sol'),
    record('t1', 'r1', u(1000, 600, 100, 50)),
    record('t1', 'r1', u(1000, 600, 100, 50)),          // same response twice
    // the snapshot says 0 input, as current rollouts do: it must not win
    tokenCount(u(0, 0, 0, 50)),
    turnCtx('t2', 'gpt-6-luna'),
    record('t2', 'r2', u(400, 0, 0, 20)),
  ]);
  assert.equal(s.usageSource, 'token_usage_record');
  assert.equal(s.requestCount, 2);
  assert.deepEqual(s.totals, { input: 700, cacheRead: 600, cacheCreation: 100, ephemeral5m: 0, ephemeral1h: 0, output: 70 });
  assert.equal(s.modelTotals['gpt-6-sol'].cacheRead, 600);
  assert.equal(s.modelTotals['gpt-6-luna'].input, 400);
  assert.equal(s.model, 'gpt-6-luna', 'the snapshot model is the latest turn_context');
});

test('a rollout without usage records keeps the token_count deltas and now books cache writes', async (t) => {
  const s = await parseRollout(t, [
    meta('s2'), turnCtx('t1', 'gpt-6-sol'),
    tokenCount(u(1000, 200, 50, 10), '2026-10-20T01:00:03.000Z'),
    tokenCount(u(1000, 200, 50, 10), '2026-10-20T01:00:04.000Z'),   // repeated snapshot
    tokenCount(u(1600, 500, 50, 30), '2026-10-20T01:00:05.000Z'),
  ]);
  assert.equal(s.usageSource, 'token_count');
  assert.equal(s.requestCount, 2);
  // 1000 - 200 cached - 50 written = 750, then 600 - 300 cached = 300
  assert.deepEqual(s.totals, { input: 1050, cacheRead: 500, cacheCreation: 50, ephemeral5m: 0, ephemeral1h: 0, output: 30 });
  assert.deepEqual(Object.keys(s.modelTotals), ['gpt-6-sol']);
});

// ── Codex ledger: cost ────────────────────────────────────────────────────

function codexFixture(t) {
  const { root, dir } = isolate(t);
  const home = join(root, 'codex');
  for (const p of [join(home, 'sessions'), join(home, 'archived_sessions')]) mkdirSync(p, { recursive: true });
  return { root, dir, home };
}

function childRollout({ id, model, root, parentThreadId, aborted = false }) {
  const at = Date.now();
  const ts = (ms) => new Date(at + ms).toISOString();
  const turn_id = 'turn-1';
  const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 500 };
  return [
    { timestamp: ts(0), type: 'session_meta', payload: { id, cwd: root, model_provider: 'current-gateway', source: { subagent: { thread_spawn: { parent_thread_id: parentThreadId } } } } },
    { timestamp: ts(1), type: 'turn_context', payload: { turn_id, model } },
    { timestamp: ts(2), type: 'event_msg', payload: { type: 'task_started', turn_id } },
    { timestamp: ts(100), type: 'token_usage_record', payload: { turn_id, usage, turn_token_usage: usage } },
    { timestamp: ts(200), type: 'event_msg', payload: aborted ? { type: 'turn_aborted', turn_id, reason: 'interrupted' } : { type: 'task_complete', turn_id } },
  ];
}

test('refreshCodexLedger records the child\'s own cost, for a completed and an interrupted run alike', async (t) => {
  const f = codexFixture(t);
  const now = Date.now();
  const rate = (x) => ({ input: x, cacheRead: x / 10, cacheWrite: null, output: x * 4 });
  const prices = { provider: 'current-gateway', checkedAt: now, prices: { 'parent-model': rate(1e-5), 'child-model': rate(2e-6) } };
  const expected = Math.round((800 * 2e-6 + 200 * 2e-7 + 500 * 8e-6) * 10000) / 10000;
  for (const [id, aborted] of [['aaaaaaaaaaaaaaa1', false], ['aaaaaaaaaaaaaaa2', true]]) {
    recordCodexDelegation({ id, at: now - 15000, parentSessionId: 'parent-' + id, from: 'parent-model', to: 'child-model', provider: 'current-gateway' }, { dir: f.dir });
    bindCodexSubagent({ session_id: 'parent-' + id, agent_id: 'child-' + id, model: 'child-model' }, { dir: f.dir, now });
    writeFileSync(join(f.home, 'sessions', `${id}.jsonl`), childRollout({ id: 'child-' + id, model: 'child-model', root: f.base, parentThreadId: 'parent-' + id, aborted }).map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  const events = (await refreshCodexLedger({ dir: f.dir, home: f.home, now, prices })).events;
  assert.equal(events.aaaaaaaaaaaaaaa1.cost, expected);
  assert.equal(events.aaaaaaaaaaaaaaa2.cost, expected, 'an interrupted child spent its tokens too');
  assert.equal(events.aaaaaaaaaaaaaaa2.usd, -expected);
  assert.equal(codexEventCost(events.aaaaaaaaaaaaaaa1), expected);
});

test('codexEventCost recomputes an old event from tokens and rates, and is null without either', () => {
  const rates = { to: { input: 1e-6, cacheRead: 1e-7, cacheWrite: null, output: 4e-6 } };
  assert.equal(codexEventCost({ tokens: { input: 1000, cached: 200, cacheWrite: 0, output: 100 }, rates }), Math.round((800 * 1e-6 + 200 * 1e-7 + 100 * 4e-6) * 10000) / 10000);
  assert.equal(codexEventCost({ cost: 0.5, tokens: { input: 1 }, rates }), 0.5, 'a recorded cost wins');
  assert.equal(codexEventCost({ tokens: { input: 1000, output: 1 }, rates: null }), null);
  assert.equal(codexEventCost({ usd: 1 }), null);
});

// ── aggregateDaily (v2 row) ───────────────────────────────────────────────

const D1 = new Date(2026, 9, 10, 9, 0).getTime();
const D2 = new Date(2026, 9, 12, 1, 0).getTime();
const NOW = new Date(2026, 9, 15, 12).getTime();
const session = (start, input, model = 'claude-sonnet-4-5', extra = {}) => ({
  startTime: new Date(start), endTime: new Date(start), model,
  totals: { input, output: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0 }, ...extra,
});
const claudeLedger = {
  version: 2,
  events: {
    'a/subagents/1': { ts: D1, usd: 1.5, cost: 0.2, to: 'claude-haiku-4-5' },
    'b/subagents/2': { ts: D1 + 1000, usd: 0.5, cost: 0.1, to: 'claude-sonnet-5' },
    'c/subagents/3': { ts: D2, usd: 2, cost: 0.4, to: 'claude-haiku-4-5' },
    'd/subagents/4': { ts: D2 + 1000, usd: 1, to: 'claude-haiku-4-5' },   // no cost: unpriced part
  },
};
const codexLedger = { version: 1, events: {
  r1: { ts: D1 + 5000, usd: 0.3, cost: 0.05, to: 'gpt-6-luna', tokens: { input: 1, cached: 0, cacheWrite: 0, output: 1 } },
  r2: { ts: D2 + 5000, usd: -0.1, tokens: { input: 1000, cached: 0, cacheWrite: 0, output: 100 }, rates: { to: { input: 1e-5, cacheRead: 1e-6, cacheWrite: null, output: 4e-5 } } },
} };
const codexPrices = { provider: 'gw', checkedAt: NOW, prices: { 'gpt-6-sol': { input: 1e-6, output: 4e-6, cacheRead: 1e-7, cacheWrite: null } } };
const codexSessions = [
  { startTime: new Date(D2), model: 'gpt-6-sol', provider: 'gw', isSubagent: false, totals: { input: 1_000_000, cacheRead: 0, cacheCreation: 0, output: 0 } },
  { startTime: new Date(D2), model: 'gpt-6-sol', provider: 'gw', isSubagent: true, totals: { input: 500_000, cacheRead: 0, cacheCreation: 0, output: 0 } },
  { startTime: new Date(D2), model: 'gpt-6-nope', provider: 'gw', totals: { input: 500_000, cacheRead: 0, cacheCreation: 0, output: 0 } }, // unpriced
];

test('aggregateDaily: reset marks hit saved_usd only; runs, cost, Codex, subagent and family shares follow the design', async (t) => {
  const { dir } = isolate(t);
  writeFileSync(join(dir, 'delegation-ledger.json'), JSON.stringify(claudeLedger));
  // a routing reset between D1 and D2 and a codex-routing reset after everything
  writeFileSync(join(dir, 'saved-reset.json'), JSON.stringify({ version: 1, marks: { routing: D1 + 60000, doc2md: null, 'codex-routing': NOW, 'codex-docs': null }, history: [] }));
  const sub = session(D2, 1_000_000, 'claude-haiku-4-5');
  const main = session(D2, 1_000_000, 'claude-sonnet-4-5', { subagentRuns: [sub] });
  const rows = await aggregateDaily({ now: NOW, dir, days: 30, sessions: [main], codexSessions, codexLedger, codexDocEvents: [{ ts: D1, usd: 0.25 }], codexPrices });
  assert.deepEqual(rows.map((r) => r.day), ['2026-10-10', '2026-10-12']);
  const [a, b] = rows;
  // D1: two Claude runs before the routing mark, one Codex run (its saving is behind the codex mark)
  assert.equal(a.delegated_runs, 3, 'runs ignore the marks (2 Claude + 1 Codex)');
  assert.equal(a.codex_delegated_runs, 1);
  assert.equal(a.delegated_cost_usd, 0.35);
  assert.equal(a.codex_delegated_cost_usd, 0.05);
  assert.equal(a.saved_usd, 0.25, 'only the Codex document saving survives the marks');
  assert.deepEqual(a.family_share, {}, 'family share only counts runs after the mark');
  assert.equal(a.spent_usd, 0);
  assert.equal(a.total_spent_usd, 0);
  assert.equal(a.gateway_spent_usd, null);
  assert.equal(a.gateway_user_hash, null);
  // D2: Claude runs after the mark, Codex run before its mark but costed from its rates
  assert.equal(b.delegated_runs, 3);
  assert.deepEqual(b.family_share, { haiku: 1 }, 'the denominator is the Claude run count');
  assert.equal(b.saved_usd, 3);
  assert.equal(b.codex_delegated_cost_usd, Math.round((1000 * 1e-5 + 100 * 4e-5) * 10000) / 10000);
  assert.equal(b.delegated_cost_usd, Math.round((0.4 + 1000 * 1e-5 + 100 * 4e-5) * 10000) / 10000);
  assert.equal(b.unpriced_parts, 2, 'one Claude run without cost, one unpriced Codex session');
  assert.ok(b.spent_usd > 0);
  assert.equal(b.claude_spent_usd, b.spent_usd);
  assert.equal(b.codex_spent_usd, 1.5, '1.5M input tokens at $1/M');
  assert.equal(b.subagent_cost_usd, Math.round((0.5 + (b.spent_usd - b.model_spend.sonnet)) * 10000) / 10000, 'the haiku run plus the Codex child');
  assert.equal(b.total_spent_usd, Math.round((b.spent_usd + 1.5) * 10000) / 10000);
  assert.equal(b.model_spend['gpt-6-sol'], 1.5, 'Codex spend lands in model_spend under its model id');
});

test('aggregateDaily with a gateway result: totals follow the gateway, covered days without rows are 0, uncovered days fall back, a gateway-only day gets a row', async (t) => {
  const { dir } = isolate(t);
  const gw = { days: new Map([['2026-10-12', 139.731], ['2026-10-14', 20]]), coveredFrom: '2026-10-11', coveredTo: '2026-10-15', userId: 'me', userHash: 'abcdef0123456789' };
  const rows = await aggregateDaily({ now: NOW, dir, days: 30, sessions: [session(D1, 1_000_000), session(D2, 1_000_000), session(new Date(2026, 9, 13).getTime(), 1_000_000)], codexSessions: [], codexLedger: { events: {} }, codexDocEvents: [], codexPrices: null, gatewayDaily: gw });
  const by = Object.fromEntries(rows.map((r) => [r.day, r]));
  assert.deepEqual(Object.keys(by), ['2026-10-10', '2026-10-12', '2026-10-13', '2026-10-14']);
  assert.equal(by['2026-10-10'].gateway_spent_usd, null, 'before the covered range');
  assert.equal(by['2026-10-10'].total_spent_usd, by['2026-10-10'].spent_usd);
  assert.equal(by['2026-10-12'].gateway_spent_usd, 139.731);
  assert.equal(by['2026-10-12'].total_spent_usd, 139.731);
  assert.equal(by['2026-10-13'].gateway_spent_usd, 0, 'covered, no gateway row');
  assert.equal(by['2026-10-13'].total_spent_usd, 0);
  assert.equal(by['2026-10-14'].spent_usd, 0);
  assert.equal(by['2026-10-14'].total_spent_usd, 20, 'unrecorded usage still produces a row');
  for (const r of rows) assert.equal(r.gateway_user_hash, 'abcdef0123456789');
  // a failed gateway call: local figures go up, both gateway fields unknown
  const failed = await aggregateDaily({ now: NOW, dir, days: 30, sessions: [session(D2, 1_000_000)], codexSessions: [], codexLedger: { events: {} }, codexDocEvents: [], codexPrices: null, gatewayDaily: { error: 'timeout' } });
  assert.equal(failed.length, 1);
  assert.ok(failed[0].spent_usd > 0);
  assert.equal(failed[0].gateway_spent_usd, null);
  assert.equal(failed[0].total_spent_usd, null);
  assert.equal(failed[0].gateway_user_hash, null);
});

// ── ledgerWindow and syncTeam with a gateway ───────────────────────────────

test('ledgerWindow reaches back to gatewaySyncedThrough only when a gateway is configured', () => {
  const now = new Date(2026, 9, 27, 12).getTime();
  const state = { ledgerSyncedThrough: '2026-10-26', gatewaySyncedThrough: '2026-10-20' };
  assert.equal(ledgerWindow(state, now).startKey, '2026-10-25');
  assert.equal(ledgerWindow(state, now, { gateway: true }).startKey, '2026-10-19');
  assert.equal(ledgerWindow({ ledgerSyncedThrough: '2026-10-26' }, now, { gateway: true }).startKey, '2026-09-28', 'no gateway watermark yet: the whole window');
});

function teamFake(handlers = {}) {
  const calls = [];
  const f = async (url, init) => {
    const fn = url.split('/rpc/')[1];
    const body = JSON.parse(init.body);
    calls.push({ fn, body });
    if (fn === 'member_standing') return { ok: false, status: 404, json: async () => ({ code: 'PGRST202', message: 'no' }) };
    const r = handlers[fn];
    return { ok: true, status: 200, json: async () => (r === undefined ? true : r) };
  };
  f.calls = calls;
  return f;
}

test('syncTeam: a failed gateway call still uploads (null totals) and keeps gatewaySyncedThrough; the next success stamps it and re-sends from it', async (t) => {
  const { dir } = isolate(t);
  const now = new Date(2026, 9, 27, 12).getTime();
  const d26 = new Date(2026, 9, 26, 9).getTime();
  saveTeamState({ version: 1, memberKey: 'spk_secret', teamName: 'Acme', displayName: 'me', lastSyncAt: null, deviceInfo: deviceInfo(), ledgerSyncedThrough: '2026-10-26', gatewaySyncedThrough: '2026-10-10' }, dir);
  writeFileSync(join(dir, 'delegation-ledger.json'), JSON.stringify({ version: 2, events: { 'a/subagents/1': { ts: d26, usd: 1, cost: 0.2, to: 'claude-haiku-4-5' } } }));
  const team = teamFake({ ledger_upsert: 1, team_rules_get: { rules: [], removed: [] } });
  const common = { dir, fetch: team, env: GW, force: true, sessions: [session(d26, 1_000_000)], codexSessions: [], codexLedger: { events: {} }, codexDocEvents: [], codexPrices: null };
  const r1 = await syncTeam({ ...common, now, gatewayFetch: gatewayFake({ rows: [], fail: '/global/spend/logs' }) });
  assert.ok(!r1.error, r1.error);
  const up1 = team.calls.find((c) => c.fn === 'ledger_upsert').body.rows;
  assert.equal(up1.length, 1);
  assert.equal(up1[0].day, '2026-10-26');
  assert.equal(up1[0].delegated_runs, 1, 'local figures still go up');
  assert.equal(up1[0].delegated_cost_usd, 0.2);
  // behind a gateway a Claude session is priced from the gateway's table, which this sandbox lacks
  assert.equal(up1[0].spent_usd, 0);
  assert.equal(up1[0].unpriced_parts, 1);
  assert.equal(up1[0].total_spent_usd, null);
  assert.equal(up1[0].gateway_spent_usd, null);
  let st = loadTeamState(dir);
  assert.equal(st.lastSyncAt, now, 'the sync counts as a success');
  assert.equal(st.gatewaySyncedThrough, '2026-10-10', 'the gateway watermark does not move');
  assert.match(st.lastGatewayError, /500/);

  const rows = [{ date: '2026-10-26', spend: 42, user: 'me@example.com' }, { date: '2026-10-15', spend: 7, user: 'me@example.com' }];
  const r2 = await syncTeam({ ...common, now: now + 1000, gatewayFetch: gatewayFake({ rows }) });
  assert.ok(!r2.error, r2.error);
  const up2 = team.calls.filter((c) => c.fn === 'ledger_upsert')[1].body.rows;
  assert.deepEqual(up2.map((r) => r.day), ['2026-10-15', '2026-10-26'], 'the window reached back past the old gateway watermark');
  assert.equal(up2[0].spent_usd, 0);
  assert.equal(up2[0].total_spent_usd, 7, 'a gateway-only day is sent');
  assert.equal(up2[1].gateway_spent_usd, 42);
  assert.equal(up2[1].total_spent_usd, 42);
  assert.match(up2[1].gateway_user_hash, /^[0-9a-f]{16}$/);
  st = loadTeamState(dir);
  assert.equal(st.gatewaySyncedThrough, '2026-10-27');
  assert.equal(st.lastGatewayError, undefined);

  // no gateway configured: no gateway call at all, totals are local
  const plain = gatewayFake({ rows });
  const r3 = await syncTeam({ ...common, env: {}, now: now + 2000, gatewayFetch: plain });
  assert.ok(!r3.error, r3.error);
  assert.equal(plain.calls.length, 0);
  const up3 = team.calls.filter((c) => c.fn === 'ledger_upsert')[2].body.rows;
  assert.equal(up3.at(-1).total_spent_usd, up3.at(-1).spent_usd);
});

test('syncTeam: a failed schema-1 price refresh is not retried for an hour', async (t) => {
  const { root, dir } = isolate(t);
  const now = new Date(2026, 9, 27, 12).getTime();
  mkdirSync(process.env.CODEX_HOME, { recursive: true });
  writeFileSync(join(process.env.CODEX_HOME, 'config.toml'), 'model_provider="litellm"\n[model_providers.litellm]\nname="LiteLLM"\nbase_url="https://example.test/v1"\nenv_key="SPRAG_TEST_PRICE_KEY"\n');
  const savedKey = process.env.SPRAG_TEST_PRICE_KEY;
  process.env.SPRAG_TEST_PRICE_KEY = 'sk-test-price';
  t.after(() => { if (savedKey === undefined) delete process.env.SPRAG_TEST_PRICE_KEY; else process.env.SPRAG_TEST_PRICE_KEY = savedKey; });
  // a cached table from before the tier change: a successful refresh, then the schema marker removed
  const payload = { data: [{ model_name: 'gpt-6-sol', model_info: { mode: 'responses', input_cost_per_token: 1e-6, output_cost_per_token: 4e-6 } }] };
  await refreshCodexPrices({ provider: codexBudgetProvider(), dir, now: now - 1000, fetchImpl: async () => ({ ok: true, json: async () => payload }) });
  const cacheDir = join(dir, 'codex-cache-policy');
  const file = join(cacheDir, readdirSync(cacheDir)[0]);
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  delete snap.pricesSchema;
  writeFileSync(file, JSON.stringify(snap));
  saveTeamState({ version: 1, memberKey: 'spk_secret', teamName: 'Acme', displayName: 'me', lastSyncAt: null, deviceInfo: deviceInfo() }, dir);
  const team = teamFake({ ledger_upsert: 1, team_rules_get: { rules: [], removed: [] } });
  const modelInfoCalls = [];
  const gatewayFetch = async (url) => { modelInfoCalls.push(url); return { ok: false, status: 500, json: async () => ({}) }; };
  const common = { dir, fetch: team, env: {}, force: true, sessions: [], coworkSessions: [], codexSessions: [], codexLedger: { events: {} }, codexDocEvents: [], gatewayFetch };

  const r1 = await syncTeam({ ...common, now });
  assert.ok(!r1.error, r1.error);
  assert.deepEqual(modelInfoCalls, ['https://example.test/model/info']);
  assert.equal(loadTeamState(dir).codexPricesAttemptAt, now, 'the failed attempt is recorded');

  const r2 = await syncTeam({ ...common, now: now + 10 * 60000 });
  assert.ok(!r2.error, r2.error);
  assert.equal(modelInfoCalls.length, 1, 'no second call inside the hour');
  assert.equal(loadTeamState(dir).codexPricesAttemptAt, now, 'a skipped attempt does not move the record');

  const r3 = await syncTeam({ ...common, now: now + 61 * 60000 });
  assert.ok(!r3.error, r3.error);
  assert.equal(modelInfoCalls.length, 2, 'retried after the hour');
  assert.equal(loadTeamState(dir).codexPricesAttemptAt, now + 61 * 60000);
  assert.ok(root);
});

// ── Claude Code settings env (a sync started from a Codex hook) ────────────
function writeClaudeSettings(root, env) {
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ env }));
}

test('withClaudeSettingsEnv fills a missing gateway address and token from settings.json only', (t) => {
  const { root } = isolate(t);
  assert.deepEqual(withClaudeSettingsEnv({ PATH: '/bin' }, { home: root }), { PATH: '/bin' }, 'no settings file: unchanged');
  writeClaudeSettings(root, { ANTHROPIC_BASE_URL: 'https://gw.example.com/', ANTHROPIC_AUTH_TOKEN: 'sk-from-settings', OTHER: 'x' });
  assert.deepEqual(withClaudeSettingsEnv({ PATH: '/bin' }, { home: root }),
    { PATH: '/bin', ANTHROPIC_BASE_URL: 'https://gw.example.com/', ANTHROPIC_AUTH_TOKEN: 'sk-from-settings' }, 'only the gateway keys are copied');
  assert.equal(withClaudeSettingsEnv({ ANTHROPIC_AUTH_TOKEN: 'sk-env' }, { home: root }).ANTHROPIC_AUTH_TOKEN, 'sk-env', 'a token already in the environment wins');
  const own = { ANTHROPIC_BASE_URL: 'https://other.example.com' };
  assert.equal(withClaudeSettingsEnv(own, { home: root }), own, 'an address already set is never mixed with another gateway\'s token');
  writeClaudeSettings(root, { ANTHROPIC_AUTH_TOKEN: 'sk-only-token' });
  assert.deepEqual(withClaudeSettingsEnv({}, { home: root }), {}, 'a token without an address is not copied');
});

test('syncTeam from a process without Claude Code\'s environment still reads the gateway named in settings.json', async (t) => {
  const { root, dir } = isolate(t);
  writeClaudeSettings(root, { ANTHROPIC_BASE_URL: GW.ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN: GW.ANTHROPIC_AUTH_TOKEN });
  const now = new Date(2026, 9, 27, 12).getTime();
  saveTeamState({ version: 1, memberKey: 'spk_secret', teamName: 'Acme', displayName: 'me', lastSyncAt: null, deviceInfo: deviceInfo(), ledgerSyncedThrough: '2026-10-25' }, dir);
  const team = teamFake({ ledger_upsert: 1, team_rules_get: { rules: [], removed: [] } });
  const gw = gatewayFake({ rows: [{ date: '2026-10-26', spend: 42, user: 'me@example.com' }] });
  const r = await syncTeam({ dir, fetch: team, env: {}, force: true, now, sessions: [], coworkSessions: [], codexSessions: [], codexLedger: { events: {} }, codexDocEvents: [], codexPrices: null, gatewayFetch: gw });
  assert.ok(!r.error, r.error);
  assert.ok(gw.calls.some((u) => new URL(u).pathname === '/global/spend/logs'), 'the gateway was asked even though the environment had no address');
  const rows = team.calls.find((c) => c.fn === 'ledger_upsert').body.rows;
  const d26 = rows.find((x) => x.day === '2026-10-26');
  assert.equal(d26.gateway_spent_usd, 42);
  assert.equal(d26.total_spent_usd, 42);
});
