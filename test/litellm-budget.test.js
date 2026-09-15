/**
 * litellm-budget · month-spend 테스트.
 * XDG_CONFIG_HOME 을 임시 디렉터리로 돌려 실제 사용자 캐시를 건드리지 않습니다.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmp;
let prevXdg;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cts-budget-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
});
after(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  rmSync(tmp, { recursive: true, force: true });
});

const ENV = {
  ANTHROPIC_BASE_URL: 'https://litellm.example.com/',
  ANTHROPIC_AUTH_TOKEN: 'sk-test',
};

function writeState(state) {
  const dir = join(tmp, 'claude-token-saver');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'litellm-budget.json'), JSON.stringify(state));
}

test('gatewayEnv: 공식 엔드포인트는 게이트웨이로 보지 않는다', async () => {
  const { gatewayEnv } = await import('../src/litellm-budget.js');
  assert.equal(gatewayEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_API_KEY: 'k' }), null);
  assert.equal(gatewayEnv({}), null);
  assert.equal(gatewayEnv({ ANTHROPIC_BASE_URL: 'https://gw.example.com' }), null); // 키 없음
  const gw = gatewayEnv(ENV);
  assert.equal(gw.base, 'https://litellm.example.com'); // 끝 슬래시 제거
  assert.equal(gw.key, 'sk-test');
});

test('budgetWindow: 캐시된 예산을 rate_limits 윈도우 모양으로 돌려준다', async () => {
  const { budgetWindow } = await import('../src/litellm-budget.js');
  const resetMs = Date.parse('2026-10-01T00:00:00Z');
  writeState({ base: 'https://litellm.example.com', checkedAt: Date.now(), spend: 34, maxBudget: 100, budgetResetAt: resetMs });
  const w = budgetWindow(ENV);
  assert.equal(w.key, 'litellm_budget');
  assert.equal(Math.round(w.usedPct), 34);
  assert.equal(w.resetsAt, Math.round(resetMs / 1000)); // epoch 초 규약
  assert.equal(w.maxBudget, 100);
});

test('budgetWindow: base 가 다르거나 max_budget 이 없으면 null', async () => {
  const { budgetWindow } = await import('../src/litellm-budget.js');
  writeState({ base: 'https://other.example.com', spend: 1, maxBudget: 10 });
  assert.equal(budgetWindow(ENV), null);
  writeState({ base: 'https://litellm.example.com', spend: 1, maxBudget: null });
  assert.equal(budgetWindow(ENV), null);
});

test('budgetWindow: 초과 지출은 100% 로 클램프한다', async () => {
  const { budgetWindow } = await import('../src/litellm-budget.js');
  writeState({ base: 'https://litellm.example.com', spend: 150, maxBudget: 100 });
  assert.equal(budgetWindow(ENV).usedPct, 100);
});

test('refreshBudgetState: /key/info 와 /user/info 를 함께 조회해 캐시에 기록한다', async () => {
  const { refreshBudgetState, readBudgetState } = await import('../src/litellm-budget.js');
  const fakeFetch = async (url, opts) => {
    assert.equal(opts.headers.authorization, 'Bearer sk-test');
    if (url === 'https://litellm.example.com/key/info') {
      return {
        ok: true,
        json: async () => ({ info: { spend: 12.5, max_budget: 200, budget_reset_at: '2026-10-01T00:00:00Z', user_id: 'u1', team_id: null } }),
      };
    }
    assert.equal(url, 'https://litellm.example.com/user/info');
    return { ok: true, json: async () => ({ user_id: 'u1', user_info: {}, teams: [] }) };
  };
  const next = await refreshBudgetState(ENV, fakeFetch);
  assert.equal(next.source, 'key');
  assert.equal(next.spend, 12.5);
  assert.equal(next.maxBudget, 200);
  assert.equal(readBudgetState().maxBudget, 200);
});

test('pickBudgetSource: 팀 멤버십 예산이 키·유저 예산보다 우선한다', async () => {
  const { pickBudgetSource } = await import('../src/litellm-budget.js');
  // 도커 LiteLLM(main-latest, 2026-09 실측) 응답 모양 그대로.
  const keyInfo = { user_id: 'user1', team_id: 't1', spend: 5, max_budget: 200, budget_reset_at: null };
  const userInfo = {
    user_id: 'user1',
    user_info: { max_budget: 50, spend: 1 },
    teams: [{
      team_id: 't1',
      max_budget: 500,
      team_memberships: [{
        user_id: 'user1',
        spend: 34,
        litellm_budget_table: { max_budget: 100, budget_reset_at: '2026-10-01T00:00:00Z' },
      }],
    }],
  };
  const p = pickBudgetSource(keyInfo, userInfo);
  assert.equal(p.source, 'team');
  assert.equal(p.spend, 34);
  assert.equal(p.maxBudget, 100);
  assert.equal(p.budgetResetAt, Date.parse('2026-10-01T00:00:00Z'));
});

test('pickBudgetSource: 멤버십·키 예산이 없으면 internal user 예산으로 폴백한다', async () => {
  const { pickBudgetSource } = await import('../src/litellm-budget.js');
  const keyInfo = { user_id: 'user1', team_id: null, spend: 0, max_budget: null };
  const userInfo = { user_info: { max_budget: 50, spend: 7 }, teams: [] };
  const p = pickBudgetSource(keyInfo, userInfo);
  assert.equal(p.source, 'user');
  assert.equal(p.spend, 7);
  assert.equal(p.maxBudget, 50);
  // 전부 무제한이면 null.
  assert.equal(pickBudgetSource({ max_budget: null }, { user_info: {}, teams: [] }), null);
});

test('monthSpend: 월초 이전 세션은 빠지고 세션별 단가로 합산한다', async () => {
  const { monthSpend, monthStartMs, monthLabel } = await import('../src/month-spend.js');
  const now = new Date(2026, 8, 12); // 2026-09-12 로컬
  const mk = (endTime, model) => ({
    endTime,
    model,
    totals: { input: 1_000_000, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 },
  });
  const inMonth = mk(new Date(2026, 8, 2), 'claude-sonnet-4-5'); // $3
  const before1 = mk(new Date(2026, 7, 31, 23, 59), 'claude-sonnet-4-5'); // 8월, 제외
  const r = monthSpend([inMonth, before1], now);
  assert.equal(r.sessions, 1);
  assert.ok(Math.abs(r.usd - 3) < 0.01, `expected ~$3, got ${r.usd}`);
  assert.equal(r.sinceMs, monthStartMs(now));
  assert.equal(r.label, 'Sep');
  assert.equal(monthLabel(new Date(2026, 0, 5)), 'Jan');
});

test('formatBudgetReport: 게이지와 사용·잔여 금액을 함께 낸다', async () => {
  const { formatBudgetReport } = await import('../src/litellm-budget.js');
  const now = new Date(2026, 8, 14, 12, 0, 0);
  const lines = formatBudgetReport(
    {
      base: 'https://litellm.example.com',
      checkedAt: now.getTime() - 3 * 60 * 1000,
      source: 'team',
      spend: 34,
      maxBudget: 100,
      budgetResetAt: new Date(2026, 9, 1, 0, 0, 0).getTime(),
    },
    now,
  );
  const text = lines.join('\n');
  // Eighth blocks can appear in the boundary cell, so the class covers them.
  assert.match(lines[0], /^💳 budget [█▉▊▋▌▍▎▏▒]{6} 34% \$34\.0\/\$100$/);
  assert.match(text, /사용 \$34\.0 · 잔여 \$66\.0 \(66\.0%\)/);
  assert.match(text, /출처 팀 멤버십 예산/);
  assert.match(text, /조회 3분 전/);
});

test('formatBudgetReport: 한도가 없으면 무제한으로 알린다', async () => {
  const { formatBudgetReport } = await import('../src/litellm-budget.js');
  const lines = formatBudgetReport({ maxBudget: null, spend: 12.5 });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /무제한.*\$12\.5/);
});

test('refreshBudgetState: /key/info 404 여도 /user/info 로 팀 예산을 채운다', async () => {
  const { refreshBudgetState } = await import('../src/litellm-budget.js');
  const userInfo = {
    user_info: { user_id: 'me@example.com', max_budget: 20, spend: 81.42 },
    teams: [
      {
        team_id: 'ab0752f5',
        team_memberships: [
          {
            user_id: 'me@example.com',
            spend: 961.33,
            litellm_budget_table: { max_budget: 4000, budget_reset_at: '2026-10-01T00:00:00Z' },
          },
        ],
      },
    ],
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/key/info')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => userInfo };
  };
  const next = await refreshBudgetState(ENV, fetchImpl);
  assert.deepEqual(calls, [
    'https://litellm.example.com/key/info',
    'https://litellm.example.com/user/info',
  ]);
  assert.equal(next.source, 'team');
  assert.equal(next.maxBudget, 4000);
  assert.equal(next.spend, 961.33);
});

test('refreshBudgetState: 두 엔드포인트가 모두 실패할 때만 던진다', async () => {
  const { refreshBudgetState } = await import('../src/litellm-budget.js');
  const dead = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => refreshBudgetState(ENV, dead), /neither key\/info nor user\/info/);
});

test('budgetWindow: 환경변수 토큰이 없어도 캐시로 게이지를 만든다', async () => {
  const { budgetWindow } = await import('../src/litellm-budget.js');
  writeState({ base: 'https://litellm.example.com', checkedAt: Date.now(), source: 'team', spend: 50, maxBudget: 200 });
  const w = budgetWindow({ ANTHROPIC_BASE_URL: 'https://litellm.example.com' }); // 키 없음
  assert.equal(Math.round(w.usedPct), 25);
  assert.equal(w.source, 'team');
});

test('pickBudgetSource: keyInfo 가 없으면 user_info 의 user_id 로 남의 멤버십을 거른다', async () => {
  const { pickBudgetSource } = await import('../src/litellm-budget.js');
  const userInfo = {
    user_info: { user_id: 'a' },
    teams: [{ team_memberships: [{ user_id: 'b', spend: 1, litellm_budget_table: { max_budget: 9 } }] }],
  };
  assert.equal(pickBudgetSource(null, userInfo), null);
  userInfo.teams[0].team_memberships[0].user_id = 'a';
  assert.equal(pickBudgetSource(null, userInfo).maxBudget, 9);
});
