/**
 * oauth-budget: claude.ai 로 로그인한 Enterprise 사용자의 usage-credit 예산을 조회합니다.
 *
 * 이 사용자들은 Claude Code 상태줄 입력에 rate_limits 를 받지 못합니다. 기본으로 켜져
 * 있으며 `GET https://api.anthropic.com/api/oauth/usage` 응답의 extra_usage 로
 * 예산 게이지(`💳 budget ▰▱ 54% $271/$500`)를 그립니다. 공식 문서에 없는
 * 엔드포인트라서 응답 모양이 다르면 아무것도 그리지 않습니다.
 *
 * 구조는 litellm-budget.js 와 같습니다: 렌더 경로는 캐시 파일만 읽고, 캐시가
 * 오래되면 detached 자식을 띄워 다음 렌더를 위해 갱신합니다.
 *
 * 토큰은 메모리에서만 씁니다. 캐시 파일, debug 로그, argv, 에러 메시지에 토큰이나
 * 그 해시를 넣지 않습니다. 토큰 갱신은 Claude Code 가 하므로 여기서는 읽기만 합니다.
 * 토큰 읽기는 키체인 대화상자를 띄울 수 있어 자식 프로세스에서만 합니다.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { userDataDir } from './paths.js';
import { gaugeBar, formatMoney } from './formatters/statusline.js';
import { labelForKey } from './window-labels.js';
import { gatewayBase } from './gateway-auth.js';
import { loadConfig } from './config.js';
import { envVar } from './env.js';
import { spawnDetachedCli } from './cli-entry.js';
import { debug } from './debug.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
// 키체인 허용 대화상자가 뜨는 환경에서 5분마다 창이 쌓이지 않도록, 토큰을 못 읽으면 쉽니다.
const NO_TOKEN_BACKOFF_MS = 6 * 60 * 60 * 1000;
// Pro 와 Max 는 상태줄 입력에 rate_limits 가 오므로 이 경로가 필요 없습니다. 세션 첫
// 응답 전에는 rate_limits 가 비어 이 경로가 불리는데, 그때마다 조회하지 않도록 하루 쉽니다.
const PLAN_BACKOFF_MS = 24 * 60 * 60 * 1000;
const PLANS_WITH_RATE_LIMITS = new Set(['pro', 'max']);
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export function oauthStatePath() {
  return join(userDataDir(), 'oauth-budget.json');
}

export function readOauthState() {
  try {
    const s = JSON.parse(readFileSync(oauthStatePath(), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function writeOauthState(next) {
  const dir = userDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(oauthStatePath(), JSON.stringify(next, null, 2) + '\n');
}

/** 기본으로 켜져 있습니다. `sprag mode no-oauth-budget` 이나 SPRAG_OAUTH_BUDGET=0 으로 끕니다. */
export function oauthBudgetEnabled(cfg = loadConfig(), env = process.env) {
  if (envVar('OAUTH_BUDGET', env) === '0') return false;
  return cfg?.statusline?.oauthBudget !== false;
}

/** 게이트웨이, API 키, 클라우드 공급자 사용자는 OAuth 로그인 사용자가 아닙니다. */
export function oauthEligible(env = process.env) {
  if (gatewayBase(env)) return false;
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return false;
  for (const k of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
    if (env[k] && env[k] !== '0' && env[k] !== 'false') return false;
  }
  return true;
}

function credentialFromJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = parsed?.claudeAiOauth;
  const token = o?.accessToken;
  if (typeof token !== 'string' || !token) return null;
  const exp = Number(o.expiresAt);
  // 만료된 토큰은 쓰지 않습니다. 갱신은 Claude Code 몫입니다.
  if (Number.isFinite(exp) && exp > 0 && exp <= Date.now()) return null;
  const plan = typeof o.subscriptionType === 'string' ? o.subscriptionType : null;
  return { token, subscriptionType: plan };
}

/**
 * OAuth 액세스 토큰을 읽습니다. 자식 프로세스에서만 부르십시오.
 * 순서: ① CLAUDE_CODE_OAUTH_TOKEN ② macOS 키체인 ③ .credentials.json.
 * 읽지 못하거나 만료됐으면 null.
 */
export function readOauthToken(env = process.env, deps = {}) {
  return readOauthCredential(env, deps)?.token ?? null;
}

/** readOauthToken 과 같은 순서로 읽고 요금제(subscriptionType)도 함께 돌려줍니다. */
export function readOauthCredential(env = process.env, deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  const read = deps.readFileSync || readFileSync;
  const platform = deps.platform || process.platform;
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { token: env.CLAUDE_CODE_OAUTH_TOKEN, subscriptionType: null };
  try {
    if (platform === 'darwin') {
      const out = exec('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return credentialFromJson(String(out));
    }
    const dir = env.CLAUDE_CONFIG_DIR || join(deps.homedir || homedir(), '.claude');
    return credentialFromJson(String(read(join(dir, '.credentials.json'), 'utf8')));
  } catch (e) {
    // 오류 객체에 명령 출력이 실릴 수 있어 종류만 남깁니다.
    debug('oauth-budget:token', new Error(`token read failed (${e?.code || 'error'})`));
    return null;
  }
}

/**
 * /api/oauth/usage 응답에서 창 재료를 뽑습니다 (달러 단위).
 * 예산이 꺼져 있거나 모양이 다르면 null.
 *
 * @returns {{spend:number, maxBudget:number, usedPct:number}|null}
 */
export function parseOauthUsage(body) {
  const x = body?.extra_usage;
  if (!x || typeof x !== 'object' || x.is_enabled !== true) return null;
  const limit = Number(x.monthly_limit);
  if (x.monthly_limit === null || x.monthly_limit === undefined || !Number.isFinite(limit) || limit <= 0) return null;
  if (x.currency && x.currency !== 'USD') return null;
  const places = Number.isFinite(Number(x.decimal_places)) && x.decimal_places !== null ? Number(x.decimal_places) : 2;
  const div = 10 ** places;
  const usedRaw = Number(x.used_credits);
  const used = x.used_credits !== null && x.used_credits !== undefined && Number.isFinite(usedRaw) ? usedRaw : 0;
  const spend = used / div;
  const maxBudget = limit / div;
  let usedPct;
  if (x.spend_limit_reached === true) usedPct = 100;
  else if (x.utilization !== null && x.utilization !== undefined && Number.isFinite(Number(x.utilization))) usedPct = Number(x.utilization);
  else usedPct = (used / limit) * 100;
  usedPct = Math.min(100, Math.max(0, usedPct));
  return { spend, maxBudget, usedPct };
}

/**
 * 렌더 경로가 쓰는 읽기 전용 접근자. 캐시만 읽습니다.
 * 리셋 시각은 응답에 없으므로 resetsAt 은 null 입니다.
 */
export function oauthBudgetWindow(deps = {}) {
  if (!oauthBudgetEnabled(deps.cfg, deps.env)) return null;
  // 나중에 게이트웨이나 API 키로 바꾼 사용자에게 옛 OAuth 캐시를 그리지 않습니다.
  if (!oauthEligible(deps.env)) return null;
  const s = readOauthState();
  const max = Number(s.maxBudget);
  const spend = Number(s.spend);
  const pct = Number(s.usedPct);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(spend) || !Number.isFinite(pct)) return null;
  return { key: 'spend_limit', usedPct: pct, resetsAt: null, spend, maxBudget: max, source: 'oauth' };
}

/** 캐시가 오래됐으면 detached 자식으로 갱신을 예약합니다. 즉시 반환. */
export function maybeSpawnOauthBudgetCheck(env = process.env, deps = {}) {
  if (!oauthBudgetEnabled(deps.cfg, env)) return false;
  if (!oauthEligible(env)) return false;
  const now = deps.now ?? Date.now();
  const s = readOauthState();
  if (now - (Number(s.checkedAt) || 0) < CHECK_INTERVAL_MS) return false;
  if (Number(s.backoffUntil) > now) return false;
  // 오프라인이나 오류 때 렌더마다 자식을 다시 띄우지 않도록 시도 시각을 먼저 기록합니다.
  try {
    writeOauthState({ ...s, checkedAt: now });
  } catch (e) {
    debug('oauth-budget:stamp', e);
    return false;
  }
  try {
    return (deps.spawnDetachedCli || spawnDetachedCli)(['oauth-budget', '--refresh', '--quiet']) !== false;
  } catch (e) {
    debug('oauth-budget:spawn', e);
    return false;
  }
}

/**
 * 실제로 조회하고 캐시를 갱신합니다. detached 자식과 `oauth-budget --refresh`
 * 만 부릅니다. 캐시에는 토큰을 쓰지 않습니다.
 */
export async function refreshOauthBudgetState(env = process.env, fetchImpl = fetch, deps = {}) {
  const now = deps.now ?? Date.now();
  const cred = readOauthCredential(env, deps);
  if (!cred) {
    const next = { checkedAt: now, backoffUntil: now + NO_TOKEN_BACKOFF_MS, error: 'no-token' };
    writeOauthState(next);
    return next;
  }
  if (PLANS_WITH_RATE_LIMITS.has(cred.subscriptionType)) {
    const next = { checkedAt: now, backoffUntil: now + PLAN_BACKOFF_MS, skipped: 'plan-has-rate-limits' };
    writeOauthState(next);
    return next;
  }
  const { token } = cred;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetchImpl(USAGE_URL, {
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          accept: 'application/json',
        },
      });
    } catch (e) {
      // 메시지에 URL 외의 것이 실릴 일은 없지만, 종류만 남기는 규칙을 지킵니다.
      debug('oauth-budget:fetch', new Error(`fetch failed (${e?.name || 'error'})`));
      throw new Error(`fetch failed (${e?.name || 'error'})`);
    }
    if (!res.ok) {
      debug('oauth-budget:http', new Error(`usage responded ${res.status}`));
      const next = { checkedAt: now, error: `http-${res.status}` };
      writeOauthState(next);
      return next;
    }
    const parsed = parseOauthUsage(await res.json());
    const next = parsed ? { checkedAt: now, ...parsed } : { checkedAt: now, enabled: false };
    writeOauthState(next);
    return next;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `sprag oauth-budget` 이 출력하는 사람용 보고서입니다. 모드 처리는
 * litellm-budget 의 formatBudgetReport 와 같습니다.
 *
 * @returns {string[]} 출력할 줄들
 */
export function formatOauthBudgetReport(state, now = new Date(), mode = 'icon') {
  const max = Number(state?.maxBudget);
  const spend = Number(state?.spend);
  if (!Number.isFinite(max) || max <= 0) {
    if (state?.error) return [`조회에 실패했습니다 (${state.error}). 잠시 뒤 \`sprag oauth-budget --refresh\` 로 다시 확인하십시오.`];
    return ['usage-credit 예산이 켜져 있지 않거나 캐시가 비어 있습니다.'];
  }
  const used = Number.isFinite(spend) ? Math.max(0, spend) : 0;
  const left = Math.max(0, max - used);
  const pct = Number.isFinite(Number(state?.usedPct)) ? Math.min(100, Math.max(0, Number(state.usedPct))) : Math.min(100, (used / max) * 100);
  const win = labelForKey('spend_limit');
  const bare = mode === 'text';
  const tickMode = mode === 'icon' ? 'icon' : 'narrow';
  const icon = bare ? '' : (mode === 'narrow' ? (win.narrowIcon || win.icon) : win.icon);
  const head = bare ? 'budget' : `${icon} budget`;
  const lines = [
    `${head} ${gaugeBar(pct, tickMode)} ${Math.round(pct)}% ${formatMoney(used)}/${formatMoney(max)}`,
    `   사용 ${formatMoney(used)}, 잔여 ${formatMoney(left)} (${(100 - pct).toFixed(1)}%)`,
    '   출처 claude.ai usage credits',
  ];
  const checkedAt = Number(state?.checkedAt);
  if (Number.isFinite(checkedAt) && checkedAt > 0) {
    const ageMin = Math.max(0, Math.round((now.getTime() - checkedAt) / 60000));
    lines.push(`   조회 ${ageMin}분 전`);
  }
  return lines;
}
