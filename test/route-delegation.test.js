import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { modelRank, tierForRank, TIER_TARGET_RANK, estimateCost } from '../src/cost.js';
import { episodeRank, worthDelegating, runSaving } from '../src/route-scan.js';
import {
  collectSubagentRun, collectSubagentRuns, subagentDirFor, indexRuns, runsForEpisode,
} from '../src/subagent-records.js';
import { renderModelRatchet, composeRuleText, budgetCapPhrase } from '../src/model-rules.js';

// ── helpers ──────────────────────────────────────────────────────────────

let tmpRoots = [];
function tmpRoot() {
  const d = mkdtempSync(join(tmpdir(), 'cts-deleg-'));
  tmpRoots.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of tmpRoots) { try { rmSync(d, { recursive: true, force: true }); } catch { /* temp dir */ } }
});

function assistant({ model, out = 0, ts, tools = [] }) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    requestId: `req-${ts}-${out}`,
    message: {
      id: `msg-${ts}-${out}`,
      model,
      content: tools.map((t, i) => ({ type: 'tool_use', name: t, id: `tu-${ts}-${i}` })),
      usage: {
        input_tokens: 5,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1000,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 },
        output_tokens: out,
      },
    },
  });
}

function toolError(text = 'Exit code 1') {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: text }] },
  });
}

/** Write a session transcript plus its subagents/ directory. */
function writeSession(root, sessionId, { lines, subagents = {} }) {
  const sessionPath = join(root, `${sessionId}.jsonl`);
  writeFileSync(sessionPath, lines.join('\n') + '\n');
  const subDir = join(root, sessionId, 'subagents');
  if (Object.keys(subagents).length) mkdirSync(subDir, { recursive: true });
  for (const [agentId, spec] of Object.entries(subagents)) {
    writeFileSync(join(subDir, `agent-${agentId}.jsonl`), spec.lines.join('\n') + '\n');
    if (spec.meta) {
      writeFileSync(join(subDir, `agent-${agentId}.meta.json`), JSON.stringify(spec.meta));
    }
  }
  return sessionPath;
}

// ── Workstream B — relative tier ─────────────────────────────────────────

test('modelRank orders the pricing tiers cheapest-first', () => {
  assert.equal(modelRank('claude-haiku-4-5'), 0);
  assert.equal(modelRank('claude-sonnet-4-5'), 1);
  assert.equal(modelRank('claude-opus-5'), 2);
  assert.equal(modelRank('claude-opus-4-1'), 2, 'legacy opus pricing still ranks as opus');
  assert.equal(modelRank('claude-fable-5'), 3);
  assert.equal(modelRank('some-unknown-model'), 1, 'unknown falls back to the sonnet rank');
});

test('worthDelegating requires the target tier to be strictly cheaper', () => {
  // The bug this guards: a Sonnet session used to produce "delegate to
  // sonnet" T1 rules — a subagent rebuilding context for zero price gap.
  assert.equal(worthDelegating('T1', modelRank('claude-sonnet-4-5')), false);
  assert.equal(worthDelegating('T2', modelRank('claude-sonnet-4-5')), true);
  assert.equal(worthDelegating('T1', modelRank('claude-opus-5')), true);
  assert.equal(worthDelegating('T1', modelRank('claude-fable-5')), true);
  assert.equal(worthDelegating('T2', modelRank('claude-haiku-4-5')), false, 'already cheapest');
});

test('episodeRank takes the priciest model that touched the episode', () => {
  const ep = { models: new Set(['claude-haiku-4-5', 'claude-opus-5']) };
  assert.equal(episodeRank(ep), 2);
});

test('tierForRank maps a run model back to the rule tier it represents', () => {
  assert.equal(tierForRank(0), 'T2');
  assert.equal(tierForRank(1), 'T1');
  assert.equal(tierForRank(2), null, 'an opus run is not a downgrade — no saving to attribute');
  assert.deepEqual(TIER_TARGET_RANK, { T2: 0, T1: 1 });
});

// ── Workstream A — subagent parsing + attribution ────────────────────────

test('collectSubagentRun aggregates tokens, errors and the model from a run', async () => {
  const root = tmpRoot();
  const p = join(root, 'agent-abc.jsonl');
  writeFileSync(p, [
    assistant({ model: 'claude-haiku-4-5', out: 300, ts: '2026-08-01T00:00:01.000Z' }),
    toolError(),
    assistant({ model: 'claude-haiku-4-5', out: 200, ts: '2026-08-01T00:00:09.000Z' }),
  ].join('\n') + '\n');
  writeFileSync(join(root, 'agent-abc.meta.json'), JSON.stringify({
    agentType: 'haiku-explore', toolUseId: 'toolu_X', spawnDepth: 1,
  }));

  const run = await collectSubagentRun(p);
  assert.equal(run.agentId, 'abc');
  assert.equal(run.agentType, 'haiku-explore');
  assert.equal(run.toolUseId, 'toolu_X');
  assert.equal(run.model, 'claude-haiku-4-5');
  assert.equal(run.calls, 2);
  assert.equal(run.out, 500);
  assert.equal(run.cacheRead, 2000, 'per-bucket usage is summed, not collapsed');
  assert.equal(run.toolErrors, 1);
  assert.ok(run.startedAt < run.endedAt);
});

test('collectSubagentRun keeps the rejection/self-corrected error filters', async () => {
  const root = tmpRoot();
  const p = join(root, 'agent-f.jsonl');
  writeFileSync(p, [
    assistant({ model: 'claude-haiku-4-5', out: 10, ts: '2026-08-01T00:00:01.000Z' }),
    toolError('The user doesn\'t want to proceed with this tool use'),
    assistant({ model: 'claude-haiku-4-5', out: 10, ts: '2026-08-01T00:00:02.000Z' }),
    toolError('File has not been read yet'),
  ].join('\n') + '\n');
  const run = await collectSubagentRun(p);
  assert.equal(run.toolErrors, 0, 'permission denials and self-corrections are not difficulty');
});

test('collectSubagentRuns returns [] when the session never delegated', async () => {
  const root = tmpRoot();
  const sessionPath = writeSession(root, 's-none', {
    lines: [assistant({ model: 'claude-opus-5', out: 50, ts: '2026-08-01T00:00:00.000Z' })],
  });
  assert.deepEqual(await collectSubagentRuns(sessionPath), []);
  assert.ok(subagentDirFor(sessionPath).endsWith(join('s-none', 'subagents')));
});

test('collectSubagentRuns tolerates a missing meta file', async () => {
  const root = tmpRoot();
  const sessionPath = writeSession(root, 's-nometa', {
    lines: [assistant({ model: 'claude-opus-5', out: 50, ts: '2026-08-01T00:00:00.000Z' })],
    subagents: {
      nometa: { lines: [assistant({ model: 'claude-haiku-4-5', out: 40, ts: '2026-08-01T00:00:02.000Z' })] },
    },
  });
  const runs = await collectSubagentRuns(sessionPath);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].toolUseId, null);
  assert.equal(runs[0].model, 'claude-haiku-4-5');
});

test('runsForEpisode joins by tool_use id, falls back to the time span, never double-counts', () => {
  const joined = { path: 'a', toolUseId: 'toolu_1', startedAt: 100, model: 'claude-haiku-4-5' };
  const orphan = { path: 'b', toolUseId: null, startedAt: 150, model: 'claude-haiku-4-5' };
  const outside = { path: 'c', toolUseId: null, startedAt: 9999, model: 'claude-haiku-4-5' };
  const index = indexRuns([joined, orphan, outside]);

  const used = new Set();
  const ep = { delegationToolUseIds: ['toolu_1'], startedAt: 90, endedAt: 200 };
  const got = runsForEpisode(index, ep, used);
  assert.deepEqual(got.map((r) => r.path).sort(), ['a', 'b'], 'exact join + timestamp fallback');
  assert.equal(runsForEpisode(index, ep, used).length, 0, 'already-used runs are not re-attributed');
});

test('runsForEpisode skips the time fallback when the episode has no span', () => {
  const index = indexRuns([{ path: 'b', toolUseId: null, startedAt: 150 }]);
  const got = runsForEpisode(index, { delegationToolUseIds: [], startedAt: null, endedAt: null }, new Set());
  assert.equal(got.length, 0);
});

// ── Workstream C — savings ───────────────────────────────────────────────

test('runSaving prices the run against what the session model would have cost', () => {
  const run = {
    model: 'claude-haiku-4-5',
    input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0,
    out: 1_000_000,
  };
  // 1M output: haiku $5 vs fable $50 → $45 saved.
  assert.equal(runSaving(run, 'claude-fable-5'), 45);
  // Same tier on both sides → nothing saved, never negative.
  assert.equal(runSaving(run, 'claude-haiku-4-5'), 0);
  assert.equal(runSaving({ ...run, model: 'claude-opus-5' }, 'claude-haiku-4-5'), 0);
});

test('runSaving matches estimateCost on the per-bucket split', () => {
  const run = {
    model: 'claude-haiku-4-5',
    input: 1000, cacheCreation: 2000, cacheRead: 50_000,
    ephemeral5m: 2000, ephemeral1h: 0, out: 3000,
  };
  const totals = {
    input: 1000, cacheCreation: 2000, cacheRead: 50_000,
    ephemeral5m: 2000, ephemeral1h: 0, output: 3000,
  };
  const expected = estimateCost(totals, 'claude-opus-5').actual - estimateCost(totals, 'claude-haiku-4-5').actual;
  assert.equal(runSaving(run, 'claude-opus-5'), Math.max(0, expected));
});

// ── Workstream D + render ────────────────────────────────────────────────

const baseRule = {
  category: 'explore', label: '탐색', labelEn: 'lookup', agent: 'haiku-explore',
  scope: 'global', example: '어디 있지', promotedAt: '2026-08-01', count: 5,
};

test('renderModelRatchet states both calibrated budgets once in the merged rule', () => {
  const md = renderModelRatchet([
    { ...baseRule, tier: 'T2', rule: 'r2', budget: { calls: 8, out: 1800 } },
    { ...baseRule, tier: 'T1', rule: 'r1', budget: { calls: null, out: 9000 } },
  ], 'ko');
  assert.match(md, /위임 상한은 haiku 도구 호출 8회·출력 1800 토큰, sonnet 출력 9000 토큰이며/);
  assert.match(md, /메인 모델이 이어받는다/);
  assert.match(md, /세션 모델이 이미 위임 목표와 같은 급 이하면 위임하지 않는다/);
  assert.equal(md.match(/진행분만 보고하고/g).length, 1, 'the stop condition is stated once, not per tier');
});

test('renderModelRatchet falls back to default budgets for pre-budget rules', () => {
  const md = renderModelRatchet([
    { ...baseRule, tier: 'T2', rule: 'r2' },
    { ...baseRule, tier: 'T1', rule: 'r1' },
  ], 'en');
  assert.match(md, /Cap haiku runs at 8 tool calls \/ 1500 output tokens and sonnet runs at 8000 output tokens/);
  assert.match(md, /Skip delegation entirely when the session model is already at or below the target tier/);
});

test('a standalone rule gets the budget composed on too, not just merged pairs', () => {
  // Rules promoted before budgets existed are the common case in a live
  // registry — they must still carry the clause.
  const md = renderModelRatchet([{ ...baseRule, tier: 'T2', rule: '기본 룰' }], 'ko');
  assert.match(md, /기본 룰\. 위임 상한은 도구 호출 8회·출력 1500 토큰이며/);
});

test('composeRuleText is the single source both the file and the preview use', () => {
  const rule = { tier: 'T1', budget: { calls: null, out: 9000 } };
  const composed = composeRuleText('base', rule, 'en');
  assert.match(composed, /^base\. Cap the run at 9000 output tokens;/);
  assert.equal(budgetCapPhrase(rule, 'en'), '9000 output tokens');
  assert.equal(budgetCapPhrase({ tier: 'T2' }, 'ko'), '도구 호출 8회·출력 1500 토큰');
});

test('renderModelRatchet reports measured delegations and savings when present', () => {
  const md = renderModelRatchet([{
    ...baseRule, tier: 'T2', rule: 'r2', count: 12, errRate: 0.1,
    delegatedRuns: 7, delegatedErrRate: 0.14, savedUsd: 1.234,
  }], 'en');
  assert.match(md, /delegated ×7 err 14%, saved ~\$1\.23/);
});

test('renderModelRatchet omits the measured block when nothing was delegated', () => {
  const md = renderModelRatchet([{ ...baseRule, tier: 'T2', rule: 'r2', count: 12, errRate: 0.1 }], 'en');
  assert.doesNotMatch(md, /delegated ×/);
});

test('a review flag names the measured evidence when that is what tripped it', () => {
  const md = renderModelRatchet([{
    ...baseRule, tier: 'T2', rule: 'r2', status: 'review',
    healthSource: 'delegated', delegatedRuns: 8, delegatedErrRate: 0.5, errRate: 0.01,
  }], 'en');
  assert.match(md, /50% error rate across 8 measured delegations/);
  assert.doesNotMatch(md, /shape/i);
});

test('a review flag falls back to the proxy wording without measured runs', () => {
  const md = renderModelRatchet([{
    ...baseRule, tier: 'T2', rule: 'r2', status: 'review', healthSource: 'proxy', errRate: 0.4,
  }], 'ko');
  assert.match(md, /최근 위임 대상 에러율 40%/);
});
