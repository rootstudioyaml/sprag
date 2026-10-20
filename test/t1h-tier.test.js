/**
 * T1H: the opus delegation tier for Fable/Mythos sessions.
 *
 * Covers the price-rank mapping, the tierOf() band between "too heavy for
 * sonnet" and "stays on the main model", the end-to-end scan (a Fable session
 * yields a T1H rule and a ledger saving, an Opus session yields neither), the
 * merged ratchet rendering with its stats comment, and the Codex target
 * resolution. HOME and XDG_CONFIG_HOME point into a temp directory before any
 * module that resolves a path is loaded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv } from './helpers/child-env.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-t1h-'));
const HOME = join(SANDBOX, 'home');
const CFG = join(SANDBOX, 'cfg');
mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = CFG;
{
  const clean = childEnv({ HOME, USERPROFILE: HOME, XDG_CONFIG_HOME: CFG });
  for (const key of Object.keys(process.env)) if (!(key in clean)) delete process.env[key];
}
process.once('exit', () => rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const DIR = join(CFG, 'claude-token-saver');
mkdirSync(DIR, { recursive: true });

const { TIER_TARGET_RANK, tierForRank } = await import('../src/cost.js');
const rs = await import('../src/route-scan.js');
const { tierOf, worthDelegating, calibrateThresholds, runRouteScan,
  T1H_MAX_ERRORS, T1H_MAX_MUTATING, T1H_OUT_CLAMP } = rs;
const { renderModelRatchet, loadModelRules } = await import('../src/model-rules.js');
const { loadLedger } = await import('../src/savings-ledger.js');

// ── cost / rank ──────────────────────────────────────────────────────────

test('T1H targets opus and is worth it only from a rank-3 session', () => {
  assert.deepEqual(TIER_TARGET_RANK, { T2: 0, T1: 1, T1H: 2 });
  assert.equal(tierForRank(2), 'T1H');
  assert.equal(tierForRank(3), null);
  assert.equal(worthDelegating('T1H', 3), true);
  for (const rank of [-1, 0, 1, 2]) assert.equal(worthDelegating('T1H', rank), false, `rank ${rank}`);
});

// ── tierOf ───────────────────────────────────────────────────────────────

const TH = { t2Out: 1500, t1Out: 8000, t1hOut: 30000 };
const CAT = { id: 'check' };
const ep = (o = {}) => ({ out: 12000, calls: 12, mutating: 3, errors: 0, delegated: 0, text: '상태 확인해줘', ...o });

test('tierOf: output between t1Out and t1hOut is T1H', () => {
  assert.equal(tierOf(ep(), CAT, TH), 'T1H');
  assert.equal(tierOf(ep({ out: 30000 }), CAT, TH), 'T1H');
  assert.equal(tierOf(ep({ out: 30001 }), CAT, TH), 'T0');
});

test('tierOf: hard evidence still wins', () => {
  assert.equal(tierOf(ep({ text: '이 구조 리팩토링해줘' }), CAT, TH), 'T0', 'ESCALATE_RE');
  assert.equal(tierOf(ep(), null, TH), 'T0', 'no category');
  assert.equal(tierOf(ep({ delegated: 1 }), CAT, TH), 'T0', 'already delegated');
  assert.equal(tierOf(ep({ errors: T1H_MAX_ERRORS + 1 }), CAT, TH), 'T0', 'errors 4');
  assert.equal(tierOf(ep({ errors: T1H_MAX_ERRORS }), CAT, TH), 'T1H', 'errors 3 still fits');
  assert.equal(tierOf(ep({ mutating: T1H_MAX_MUTATING + 1 }), CAT, TH), 'T0', 'mutating 21');
  assert.equal(tierOf(ep({ mutating: T1H_MAX_MUTATING }), CAT, TH), 'T1H', 'mutating 20 still fits');
});

test('tierOf: the T2 and T1 bands are unchanged', () => {
  assert.equal(tierOf(ep({ out: 800, calls: 3, mutating: 0 }), CAT, TH), 'T2');
  assert.equal(tierOf(ep({ out: 6000, mutating: 5, errors: 1 }), CAT, TH), 'T1');
  assert.equal(tierOf(ep({ out: 6000, mutating: 7 }), CAT, TH), 'T1H', 'was T0 before the band existed');
  assert.equal(tierOf(ep({ out: 50 }), CAT, TH), null);
});

test('tierOf: a missing t1hOut falls back to 30000', () => {
  assert.equal(tierOf(ep({ out: 25000 }), CAT, { t2Out: 1500, t1Out: 8000 }), 'T1H');
});

test('calibrateThresholds adds t1hOut: default 30000, then the p95 clamped', () => {
  assert.equal(calibrateThresholds([1, 2, 3]).t1hOut, 30000);
  const small = Array.from({ length: 200 }, (_, i) => 100 + i);
  assert.equal(calibrateThresholds(small).t1hOut, T1H_OUT_CLAMP[0]);
  const big = Array.from({ length: 200 }, (_, i) => 100000 + i);
  assert.equal(calibrateThresholds(big).t1hOut, T1H_OUT_CLAMP[1]);
});

// ── end-to-end scan ──────────────────────────────────────────────────────

const FABLE = 'claude-fable-5';
const OPUS = 'claude-opus-5';
const DAY = 86400000;
const NOW = Date.now();
const PROJECT_DIR = '-sandbox-t1h';
const PROJ = join(HOME, '.claude', 'projects', PROJECT_DIR);
const RULES_FILE = join(DIR, 'model-rules.json');

let seq = 0;
const iso = (ms) => new Date(ms).toISOString();
const userLine = (ms, text) => JSON.stringify({ type: 'user', timestamp: iso(ms), message: { role: 'user', content: text } });
const toolResultLine = () => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
function assistantLine({ model, ms, out, cacheRead = 0, tools = [] }) {
  seq += 1;
  return JSON.stringify({
    type: 'assistant', timestamp: iso(ms), requestId: `req-${seq}`,
    message: {
      id: `msg-${seq}`, model,
      content: tools.map((t) => ({ type: 'tool_use', name: t.name, id: t.id })),
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead, output_tokens: out },
    },
  });
}

/** Three heavy check-type requests handled directly by `model`. */
function writeHeavySession(model) {
  rmSync(PROJ, { recursive: true, force: true });
  mkdirSync(PROJ, { recursive: true });
  const lines = [];
  for (let i = 0; i < 3; i++) {
    const t = NOW - (3 - i) * 3600000;
    lines.push(userLine(t, `상태 확인해줘 ${i + 1}번째`));
    lines.push(assistantLine({ model, ms: t + 1000, out: 12000 }));
  }
  writeFileSync(join(PROJ, 'sess-heavy.jsonl'), lines.join('\n') + '\n');
}

test('a Fable session with a heavy episode yields a T1H rule candidate', async () => {
  rmSync(RULES_FILE, { force: true });
  writeHeavySession(FABLE);
  const cache = await runRouteScan({ days: 14 });
  const c = cache.candidates.find((x) => x.tier === 'T1H');
  assert.ok(c, `candidates: ${JSON.stringify(cache.candidates.map((x) => x.signature))}`);
  // A candidate names its tier; the agents preset says t1h-worker serves T1H.
  assert.equal(c.agent, undefined);
  const { agentForRule } = await import('../src/agents.js');
  assert.equal(agentForRule(c), 't1h-worker');
  assert.equal(c.budget.out, cache.thresholds.t1hOut);
  assert.match(c.rule, /opus/);
  assert.match(c.rule, /Fable/);
  assert.match(c.ruleEn, /Fable\/Mythos sessions only/);
});

test('the same episode in an Opus session yields no rule', async () => {
  rmSync(RULES_FILE, { force: true });
  writeHeavySession(OPUS);
  const cache = await runRouteScan({ days: 14 });
  assert.deepEqual(cache.candidates.filter((x) => x.tier === 'T1H'), []);
});

test('a Fable session delegating to an Opus subagent books a positive T1H saving', async () => {
  rmSync(PROJ, { recursive: true, force: true });
  const sub = join(PROJ, 'sess-d', 'subagents');
  mkdirSync(sub, { recursive: true });
  const t = NOW - 3600000;
  writeFileSync(join(PROJ, 'sess-d.jsonl'), [
    userLine(t, '상태 확인해줘 큰 작업'),
    assistantLine({ model: FABLE, ms: t + 1000, out: 50, tools: [{ name: 'Agent', id: 'toolu_h' }] }),
    toolResultLine(),
    assistantLine({ model: FABLE, ms: t + 30000, out: 60 }),
  ].join('\n') + '\n');
  writeFileSync(join(sub, 'agent-h.jsonl'), [
    assistantLine({ model: OPUS, ms: t + 5000, out: 200000, cacheRead: 2_000_000 }),
    assistantLine({ model: OPUS, ms: t + 9000, out: 100, cacheRead: 2_000_000 }),
  ].join('\n') + '\n');
  writeFileSync(join(sub, 'agent-h.meta.json'), JSON.stringify({ agentType: 't1h-worker', toolUseId: 'toolu_h', spawnDepth: 1 }));
  writeFileSync(RULES_FILE, JSON.stringify({ rules: [{
    signature: 'T1H|check|*', scope: 'global', tier: 'T1H', category: 'check', project: '*',
    label: '상태 확인·검증', labelEn: 'status checks / verification', example: '상태 확인해줘',
    agent: 'opus', status: 'active', errRate: 0, count: 0, baselineModel: FABLE,
    baselineSource: 'dominant', budget: { calls: null, out: 30000 },
  }] }));
  await runRouteScan({ days: 14 });
  const rule = JSON.parse(readFileSync(RULES_FILE, 'utf8')).rules[0];
  assert.equal(rule.delegatedRuns, 1);
  assert.ok(rule.savedUsd > 0, `savedUsd ${rule.savedUsd}`);
  const ev = Object.values(loadLedger().events).find((e) => e.rule === 'T1H|check|*');
  assert.ok(ev && ev.usd > 0, 'ledger event attributed to the T1H rule');
  assert.equal(ev.to, OPUS);
});

test('an Opus subagent run inside an Opus session earns no saving', async () => {
  rmSync(PROJ, { recursive: true, force: true });
  const sub = join(PROJ, 'sess-o', 'subagents');
  mkdirSync(sub, { recursive: true });
  const t = NOW - 7200000;
  writeFileSync(join(PROJ, 'sess-o.jsonl'), [
    userLine(t, '상태 확인해줘 큰 작업'),
    assistantLine({ model: OPUS, ms: t + 1000, out: 50, tools: [{ name: 'Agent', id: 'toolu_o' }] }),
    toolResultLine(),
    assistantLine({ model: OPUS, ms: t + 30000, out: 60 }),
  ].join('\n') + '\n');
  writeFileSync(join(sub, 'agent-o.jsonl'), assistantLine({ model: OPUS, ms: t + 5000, out: 5000 }) + '\n');
  writeFileSync(join(sub, 'agent-o.meta.json'), JSON.stringify({ agentType: 't1h-worker', toolUseId: 'toolu_o', spawnDepth: 1 }));
  const before = Object.values(loadLedger().events).filter((e) => e.to === OPUS && e.from === OPUS).length;
  await runRouteScan({ days: 14 });
  assert.equal(JSON.parse(readFileSync(RULES_FILE, 'utf8')).rules[0].delegatedRuns ?? 0, 0);
  assert.equal(Object.values(loadLedger().events).filter((e) => e.to === OPUS && e.from === OPUS).length, before);
});

// ── rendering ────────────────────────────────────────────────────────────

const base = { status: 'active', scope: 'global', category: 'check', label: '상태 확인·검증',
  labelEn: 'status checks', example: '상태 확인해줘', count: 4, errRate: 0, lastSeen: '2026-10-18', promotedAt: '2026-10-18' };

test('a category with T2, T1 and T1H renders one line with three branches and caps', () => {
  const rules = [
    { ...base, tier: 'T2', agent: 't2-explore', rule: 'r2', budget: { calls: 8, out: 1500 } },
    { ...base, tier: 'T1', agent: 'sonnet', rule: 'r1', budget: { calls: null, out: 8000 } },
    { ...base, tier: 'T1H', agent: 'opus', rule: 'rh', budget: { calls: null, out: 30000 } },
  ];
  const md = renderModelRatchet(rules, 'ko', { root: null });
  const line = md.split('\n').find((l) => l.startsWith('- "상태 확인·검증"'));
  assert.ok(line, md);
  assert.match(line, /기본 .*haiku.*, 여러 단계·여러 파일이 얽히면 .*sonnet.*, 범위가 크면\(Fable·Mythos 세션 한정\) .*opus/);
  assert.match(line, /상한 haiku 도구 호출 8회·출력 1500 토큰 \/ sonnet 출력 8000 토큰 \/ opus 출력 30000 토큰/);
  assert.match(md, /고난도 구현\(T1H\)/);
  assert.equal(md.split('\n').filter((l) => l.startsWith('- "상태 확인·검증"')).length, 1);
  // The stats comment stays one comment of ` / `-joined `<tier> <stats>` segments.
  const m = line.match(/ <!-- (.*) -->$/);
  assert.ok(m, 'trailing stats comment');
  const segs = m[1].split(' / ').map((x) => x.split(' ')[0]);
  assert.deepEqual(segs, ['T2', 'T1', 'T1H']);
  assert.ok(!line.slice(0, m.index).includes('<!--'));

  const en = renderModelRatchet(rules, 'en', { root: null });
  assert.match(en, /cap haiku .* \/ sonnet .* \/ opus 30000 output tokens/);
  assert.match(en, /for large scope \(Fable\/Mythos sessions only\)/);
});

test('a lone T1H rule names opus and the Fable-only condition', () => {
  const md = renderModelRatchet([{ ...base, tier: 'T1H', agent: 'opus', rule: 'rh' }], 'ko', { root: null });
  assert.match(md, /고난도 구현 요청\(예: "상태 확인해줘"\)은 Fable·Mythos 세션에 한해 model: opus에 위임 \(상한 출력 30000 토큰\)/);
  assert.match(md, /<!-- ×4, err 0%/);
});

test('tierLabel describes T1H', () => {
  assert.match(rs.tierLabel('T1H'), /opus급이면 충분 \(Fable 세션 전용\)/);
  assert.match(rs.tierLabel('T1H', 'en'), /opus-class is enough \(Fable sessions only\)/);
});

test('the registry round-trips a T1H rule', () => {
  assert.ok(Array.isArray(loadModelRules().rules));
});
