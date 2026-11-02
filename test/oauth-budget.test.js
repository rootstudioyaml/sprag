/**
 * oauth-budget 테스트. XDG_CONFIG_HOME 을 임시 디렉터리로 돌려 실제 사용자 캐시를
 * 건드리지 않습니다. 키체인, 네트워크, 자식 프로세스는 모두 주입한 가짜를 씁니다.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmp;
let prevXdg;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cts-oauth-budget-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
});
after(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const dir = () => join(tmp, 'claude-token-saver');
const statePath = () => join(dir(), 'oauth-budget.json');
function writeState(state) {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state));
}
function clearState() {
  rmSync(statePath(), { force: true });
}

const ON = { statusline: { oauthBudget: true } };
const OFF = {};
const TOKEN = 'sk-ant-oat01-SECRET-TOKEN-VALUE';

const ENTERPRISE = { extra_usage: { is_enabled: true, monthly_limit: 50000, used_credits: 27140, utilization: 54, currency: 'USD' } };
const MAX_ACCOUNT = {
  five_hour: { utilization: 9.0, resets_at: '2026-11-02T09:39:59.604651+00:00', limit_dollars: null, used_dollars: null },
  seven_day: { utilization: 20.0, resets_at: '2026-11-05T03:59:59.604676+00:00' },
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null, decimal_places: null, disabled_reason: null, user_disabled: false, spend_limit_reached: false, credits_ever_enabled: false, daily: null, weekly: null },
  spend: { used: { amount_minor: 0, currency: 'USD', exponent: 2 }, limit: null, percent: 0, severity: 'normal', enabled: false },
};

test('parseOauthUsage: Enterprise 예시는 센트를 달러로 바꾼다', async () => {
  const { parseOauthUsage } = await import('../src/oauth-budget.js');
  assert.deepEqual(parseOauthUsage(ENTERPRISE), { spend: 271.4, maxBudget: 500, usedPct: 54 });
});

test('parseOauthUsage: 꺼진 계정, 한도 없음, 비 USD, 엉뚱한 모양은 null', async () => {
  const { parseOauthUsage } = await import('../src/oauth-budget.js');
  assert.equal(parseOauthUsage(MAX_ACCOUNT), null);
  assert.equal(parseOauthUsage(null), null);
  assert.equal(parseOauthUsage({}), null);
  assert.equal(parseOauthUsage({ extra_usage: { is_enabled: true, monthly_limit: 0, used_credits: 0 } }), null);
  assert.equal(parseOauthUsage({ extra_usage: { is_enabled: true, monthly_limit: null } }), null);
  assert.equal(parseOauthUsage({ extra_usage: { is_enabled: true, monthly_limit: 500000, used_credits: 1, currency: 'KRW' } }), null);
});

test('parseOauthUsage: decimal_places, spend_limit_reached, utilization 없음', async () => {
  const { parseOauthUsage } = await import('../src/oauth-budget.js');
  const zero = parseOauthUsage({ extra_usage: { is_enabled: true, monthly_limit: 500, used_credits: 120, decimal_places: 0, utilization: 24 } });
  assert.deepEqual([zero.spend, zero.maxBudget], [120, 500]);
  const reached = parseOauthUsage({ extra_usage: { is_enabled: true, monthly_limit: 50000, used_credits: 100, utilization: 0.2, spend_limit_reached: true } });
  assert.equal(reached.usedPct, 100);
  const computed = parseOauthUsage({ extra_usage: { is_enabled: true, monthly_limit: 50000, used_credits: 12500 } });
  assert.equal(computed.usedPct, 25);
  const noUsed = parseOauthUsage({ extra_usage: { is_enabled: true, monthly_limit: 50000 } });
  assert.deepEqual([noUsed.spend, noUsed.usedPct], [0, 0]);
});

test('readOauthToken: 환경변수가 우선한다', async () => {
  const { readOauthToken } = await import('../src/oauth-budget.js');
  const boom = () => { throw new Error('must not be called'); };
  assert.equal(readOauthToken({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, { execFileSync: boom, readFileSync: boom, platform: 'darwin' }), TOKEN);
});

test('readOauthToken: darwin 은 키체인을 읽는다', async () => {
  const { readOauthToken } = await import('../src/oauth-budget.js');
  let call;
  const execFileSync = (cmd, args, opts) => {
    call = { cmd, args, opts };
    return JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() + 3600_000 } }) + '\n';
  };
  assert.equal(readOauthToken({}, { execFileSync, platform: 'darwin' }), TOKEN);
  assert.equal(call.cmd, 'security');
  assert.deepEqual(call.args, ['find-generic-password', '-s', 'Claude Code-credentials', '-w']);
  assert.equal(call.opts.timeout, 3000);
});

test('readOauthToken: 비 darwin 은 .credentials.json 을 읽는다', async () => {
  const { readOauthToken } = await import('../src/oauth-budget.js');
  let path;
  const readFileSync = (p) => {
    path = p;
    return JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() + 3600_000 } });
  };
  const boom = () => { throw new Error('keychain must not be used'); };
  assert.equal(readOauthToken({ CLAUDE_CONFIG_DIR: '/cfg' }, { execFileSync: boom, readFileSync, platform: 'linux' }), TOKEN);
  assert.equal(path, join('/cfg', '.credentials.json'));
});

test('readOauthToken: 만료 토큰과 예외는 null', async () => {
  const { readOauthToken } = await import('../src/oauth-budget.js');
  const expired = () => JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() - 1000 } });
  assert.equal(readOauthToken({}, { execFileSync: expired, platform: 'darwin' }), null);
  assert.equal(readOauthToken({}, { readFileSync: expired, platform: 'linux' }), null);
  const denied = () => { throw Object.assign(new Error('The specified item could not be found'), { code: 'ETIMEDOUT' }); };
  assert.equal(readOauthToken({}, { execFileSync: denied, platform: 'darwin' }), null);
  assert.equal(readOauthToken({}, { readFileSync: denied, platform: 'linux' }), null);
  assert.equal(readOauthToken({}, { execFileSync: () => 'not json', platform: 'darwin' }), null);
});

test('refresh: 성공하면 캐시에 토큰이 없고 요청 헤더가 맞다', async () => {
  const { refreshOauthBudgetState } = await import('../src/oauth-budget.js');
  clearState();
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, headers: init.headers };
    return { ok: true, status: 200, json: async () => ENTERPRISE };
  };
  const next = await refreshOauthBudgetState({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, fetchImpl, { now: 1000 });
  assert.equal(seen.url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(seen.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(seen.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(seen.headers.accept, 'application/json');
  assert.deepEqual(next, { checkedAt: 1000, spend: 271.4, maxBudget: 500, usedPct: 54 });
  const raw = readFileSync(statePath(), 'utf8');
  assert.ok(!raw.includes(TOKEN), '캐시 원문에 토큰이 있으면 안 된다');
  assert.ok(!raw.includes('SECRET'));
});

test('refresh: 예산이 꺼진 응답은 금액 없이 enabled:false', async () => {
  const { refreshOauthBudgetState } = await import('../src/oauth-budget.js');
  writeState({ checkedAt: 1, spend: 5, maxBudget: 10, usedPct: 50 });
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => MAX_ACCOUNT });
  const next = await refreshOauthBudgetState({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, fetchImpl, { now: 2000 });
  assert.deepEqual(next, { checkedAt: 2000, enabled: false });
});

test('refresh: 401 이면 이전 금액이 지워진다', async () => {
  const { refreshOauthBudgetState, readOauthState } = await import('../src/oauth-budget.js');
  writeState({ checkedAt: 1, spend: 271.4, maxBudget: 500, usedPct: 54 });
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await refreshOauthBudgetState({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, fetchImpl, { now: 3000 });
  assert.deepEqual(readOauthState(), { checkedAt: 3000, error: 'http-401' });
});

test('refresh: 토큰이 없으면 6시간 백오프를 쓰고 요청하지 않는다', async () => {
  const { refreshOauthBudgetState, readOauthState } = await import('../src/oauth-budget.js');
  clearState();
  const fetchImpl = async () => { throw new Error('must not fetch'); };
  const denied = () => { throw new Error('denied'); };
  await refreshOauthBudgetState({}, fetchImpl, { now: 10_000, execFileSync: denied, platform: 'darwin' });
  assert.deepEqual(readOauthState(), { checkedAt: 10_000, backoffUntil: 10_000 + 6 * 60 * 60 * 1000, error: 'no-token' });
});

test('maybeSpawn: opt-in 이 꺼져 있거나 게이트웨이, API 키가 있으면 띄우지 않는다', async () => {
  const { maybeSpawnOauthBudgetCheck } = await import('../src/oauth-budget.js');
  clearState();
  let spawned = 0;
  const spawnDetachedCli = () => { spawned++; return true; };
  assert.equal(maybeSpawnOauthBudgetCheck({}, { cfg: OFF, spawnDetachedCli }), false);
  assert.equal(maybeSpawnOauthBudgetCheck({ ANTHROPIC_BASE_URL: 'https://gw.example.com' }, { cfg: ON, spawnDetachedCli }), false);
  assert.equal(maybeSpawnOauthBudgetCheck({ ANTHROPIC_API_KEY: 'k' }, { cfg: ON, spawnDetachedCli }), false);
  assert.equal(spawned, 0);
  assert.equal(existsSync(statePath()), false, '띄우지 않으면 시도 기록도 남기지 않는다');
});

test('maybeSpawn: 5분 안이거나 백오프 중이면 띄우지 않는다', async () => {
  const { maybeSpawnOauthBudgetCheck } = await import('../src/oauth-budget.js');
  let spawned = 0;
  const spawnDetachedCli = () => { spawned++; return true; };
  const now = 1_000_000_000;
  writeState({ checkedAt: now - 60_000 });
  assert.equal(maybeSpawnOauthBudgetCheck({}, { cfg: ON, now, spawnDetachedCli }), false);
  writeState({ checkedAt: now - 10 * 60_000, backoffUntil: now + 1000 });
  assert.equal(maybeSpawnOauthBudgetCheck({}, { cfg: ON, now, spawnDetachedCli }), false);
  assert.equal(spawned, 0);
});

test('maybeSpawn: 그 밖에는 시도 시각을 먼저 쓰고 spawnDetachedCli 를 거친다', async () => {
  const { maybeSpawnOauthBudgetCheck, readOauthState } = await import('../src/oauth-budget.js');
  const now = 1_000_000_000;
  writeState({ checkedAt: now - 10 * 60_000, spend: 1, maxBudget: 2, usedPct: 50, backoffUntil: now - 1 });
  let args;
  let stampedBefore;
  const spawnDetachedCli = (a) => { args = a; stampedBefore = readOauthState().checkedAt; return true; };
  assert.equal(maybeSpawnOauthBudgetCheck({}, { cfg: ON, now, spawnDetachedCli }), true);
  assert.deepEqual(args, ['oauth-budget', '--refresh', '--quiet']);
  assert.equal(stampedBefore, now);
  assert.equal(readOauthState().spend, 1, '이전 금액은 유지한다');
});

test('oauthBudgetWindow: opt-in 이 꺼져 있으면 null, 켜져 있으면 spend_limit 창', async () => {
  const { oauthBudgetWindow } = await import('../src/oauth-budget.js');
  writeState({ checkedAt: Date.now(), spend: 271.4, maxBudget: 500, usedPct: 54 });
  assert.equal(oauthBudgetWindow({ cfg: OFF, env: {} }), null);
  assert.deepEqual(oauthBudgetWindow({ cfg: ON, env: {} }), {
    key: 'spend_limit', usedPct: 54, resetsAt: null, spend: 271.4, maxBudget: 500, source: 'oauth',
  });
  assert.equal(oauthBudgetWindow({ cfg: OFF, env: { SPRAG_OAUTH_BUDGET: '1' } }).key, 'spend_limit');
  // 나중에 API 키나 게이트웨이로 옮긴 사용자에게는 옛 캐시를 그리지 않는다.
  assert.equal(oauthBudgetWindow({ cfg: ON, env: { ANTHROPIC_API_KEY: 'sk-test' } }), null);
  assert.equal(oauthBudgetWindow({ cfg: ON, env: { ANTHROPIC_BASE_URL: 'https://litellm.example.com' } }), null);
  writeState({ checkedAt: Date.now(), error: 'http-401' });
  assert.equal(oauthBudgetWindow({ cfg: ON, env: {} }), null);
});

test('렌더: 이 창을 caps 로 넣으면 상태줄에 $271 과 $500 이 나온다', async () => {
  const { oauthBudgetWindow, formatOauthBudgetReport } = await import('../src/oauth-budget.js');
  const { formatReport } = await import('../src/formatters/statusline.js');
  writeState({ checkedAt: Date.now(), spend: 271.4, maxBudget: 500, usedPct: 54 });
  const win = oauthBudgetWindow({ cfg: ON, env: {} });
  const line = formatReport({
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: { usedPct: 47, size: 1_000_000 },
    spikeChip: null,
    caps: { windows: [win] },
    model: 'Opus 5',
    effort: 'high',
    delegationSaved: 0,
  }, { color: false, timer: false, mode: 'icon' });
  assert.match(line, /budget/);
  assert.match(line, /\$271\/\$500/);
  const report = formatOauthBudgetReport(readFileState(), new Date(), 'icon').join('\n');
  assert.match(report, /54%/);
  assert.match(report, /출처 claude\.ai usage credits/);
  assert.deepEqual(formatOauthBudgetReport({}, new Date(), 'icon').length, 1);
});

function readFileState() {
  return JSON.parse(readFileSync(statePath(), 'utf8'));
}
