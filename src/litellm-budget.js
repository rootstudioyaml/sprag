/**
 * litellm-budget: LiteLLM 게이트웨이 사용자에게 예산 정보를 조회해 줍니다.
 *
 * Bedrock 등을 LiteLLM 프록시로 쓰는 환경에는 Claude Code stdin의
 * rate_limits(5h/7d cap)가 아예 오지 않습니다. 대신 LiteLLM은 키별
 * max_budget / spend 를 관리하므로, 그 값을 가져와 cap 게이지가 놓이던 지점에
 * 예산 게이지를 보여 줍니다.
 *
 * 네트워크 호출은 update-check와 같은 모양으로 처리합니다: 렌더 경로는
 * 캐시 파일만 읽고, 캐시가 오래되면 detached 자식 프로세스를 띄워
 * 다음 렌더를 위해 갱신합니다. 렌더가 네트워크를 기다리는 일은 없습니다.
 *
 * 감지 조건: ANTHROPIC_BASE_URL 이 설정돼 있고(공식 API가 아닌 게이트웨이),
 * 키(ANTHROPIC_AUTH_TOKEN 또는 ANTHROPIC_API_KEY)가 있을 때만 동작합니다.
 * 엔드포인트는 LiteLLM의 `GET {base}/key/info` 이며, 호출한 키 자신의 정보를
 * 돌려줍니다. 응답의 info.max_budget / info.spend / info.budget_reset_at 을
 * 사용합니다. max_budget 이 null 이면(무제한 키) 게이지를 만들지 않습니다.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { cliEntryPath } from './update-check.js';
import { debug } from './debug.js';

// 예산은 분 단위로 변하지 않습니다. 5분이면 게이지 용도로 충분히 신선하고,
// 통계선 렌더(수 초 간격)가 프록시를 두들기지 않습니다.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export function budgetStatePath() {
  return join(userDataDir(), 'litellm-budget.json');
}

/** 게이트웨이 환경 정보. 감지되지 않으면 null. */
export function gatewayEnv(env = process.env) {
  const base = (env.ANTHROPIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  // 공식 엔드포인트를 그대로 가리키면 게이트웨이가 아닙니다.
  if (/^https?:\/\/api\.anthropic\.com/i.test(base)) return null;
  const key = (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '').trim();
  if (!key) return null;
  return { base, key };
}

export function readBudgetState() {
  try {
    const s = JSON.parse(readFileSync(budgetStatePath(), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function writeBudgetState(next) {
  const dir = userDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(budgetStatePath(), JSON.stringify(next, null, 2) + '\n');
}

/**
 * 렌더 경로가 쓰는 읽기 전용 접근자. 캐시된 답이 있으면
 * rate_limits 윈도우와 같은 모양의 객체를 돌려줍니다.
 *
 * @returns {{key:string, usedPct:number, resetsAt:number|null,
 *            spend:number, maxBudget:number}|null}
 */
export function budgetWindow(env = process.env) {
  const gw = gatewayEnv(env);
  if (!gw) return null;
  const s = readBudgetState();
  // 다른 프록시의 캐시를 재사용하지 않도록 base 단위로 격리합니다.
  if (s.base !== gw.base) return null;
  const max = Number(s.maxBudget);
  const spend = Number(s.spend);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(spend)) return null;
  // 캐시에는 ms 로 저장하지만, rate_limits 윈도우의 resets_at 규약은
  // epoch 초 단위라서 여기서 초로 맞춰 내보낸다 (formatResetClock 입력 규약).
  const resetMs = Number(s.budgetResetAt) || null;
  return {
    key: 'litellm_budget',
    usedPct: Math.min(100, Math.max(0, (spend / max) * 100)),
    resetsAt: resetMs ? Math.round(resetMs / 1000) : null,
    spend,
    maxBudget: max,
  };
}

/** 캐시가 오래됐으면 detached 자식으로 갱신을 예약합니다. 즉시 반환. */
export function maybeSpawnBudgetCheck(env = process.env) {
  const gw = gatewayEnv(env);
  if (!gw) return false;
  const s = readBudgetState();
  const age = Date.now() - (Number(s.checkedAt) || 0);
  if (s.base === gw.base && age < CHECK_INTERVAL_MS) return false;
  // 오프라인/오류 시 렌더마다 자식을 다시 띄우지 않도록 시도 시각을 먼저 기록합니다.
  try {
    writeBudgetState({ ...s, base: gw.base, checkedAt: Date.now() });
  } catch (e) {
    debug('litellm-budget:stamp', e);
    return false;
  }
  try {
    spawn(process.execPath, [cliEntryPath(), 'litellm-budget', '--refresh', '--quiet'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return true;
  } catch (e) {
    debug('litellm-budget:spawn', e);
    return false;
  }
}

function numOrNull(v) {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) ? n : null;
}

function parseResetMs(v) {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * /key/info 와 /user/info 응답에서 예산 출처를 고릅니다 (도커 LiteLLM 실측 기준).
 * 실무에서는 팀 멤버십 예산(LiteLLM_TeamMembership + litellm_budget_table)이
 * 주로 쓰이므로 그쪽을 먼저 보고, 없으면 키 자체의 max_budget,
 * 그다음 internal user 의 max_budget 순으로 내려갑니다.
 *
 * @returns {{source:'team'|'key'|'user', spend:number, maxBudget:number,
 *            budgetResetAt:number|null}|null}
 */
export function pickBudgetSource(keyInfo, userInfo) {
  const userId = keyInfo?.user_id ?? null;
  const teamId = keyInfo?.team_id ?? null;
  // ① 팀 멤버십 예산: 키의 team_id 에 해당하는 팀에서 내 user_id 의 멤버십을 찾는다.
  const teams = Array.isArray(userInfo?.teams) ? userInfo.teams : [];
  for (const team of teams) {
    if (teamId && team?.team_id !== teamId) continue;
    for (const tm of team?.team_memberships || []) {
      if (userId && tm?.user_id !== userId) continue;
      const max = numOrNull(tm?.litellm_budget_table?.max_budget);
      if (max !== null && max > 0) {
        return {
          source: 'team',
          spend: numOrNull(tm?.spend) ?? 0,
          maxBudget: max,
          budgetResetAt: parseResetMs(tm?.litellm_budget_table?.budget_reset_at),
        };
      }
    }
  }
  // ② 키 자체 예산.
  const keyMax = numOrNull(keyInfo?.max_budget);
  if (keyMax !== null && keyMax > 0) {
    return {
      source: 'key',
      spend: numOrNull(keyInfo?.spend) ?? 0,
      maxBudget: keyMax,
      budgetResetAt: parseResetMs(keyInfo?.budget_reset_at),
    };
  }
  // ③ internal user 예산 (실무에서는 드물지만 폴백으로 유지).
  const u = userInfo?.user_info;
  const userMax = numOrNull(u?.max_budget);
  if (userMax !== null && userMax > 0) {
    return {
      source: 'user',
      spend: numOrNull(u?.spend) ?? 0,
      maxBudget: userMax,
      budgetResetAt: parseResetMs(u?.budget_reset_at),
    };
  }
  return null;
}

/**
 * 실제로 LiteLLM에 물어보고 캐시를 갱신합니다. detached 자식과
 * `litellm-budget --refresh` 명령만 호출합니다.
 * /key/info(키·소속 식별)와 /user/info(팀 멤버십 예산)를 함께 조회합니다.
 */
export async function refreshBudgetState(env = process.env, fetchImpl = fetch) {
  const gw = gatewayEnv(env);
  if (!gw) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${gw.key}`,
  };
  try {
    const keyRes = await fetchImpl(`${gw.base}/key/info`, { signal: controller.signal, headers });
    if (!keyRes.ok) throw new Error(`LiteLLM responded ${keyRes.status}`);
    const keyBody = await keyRes.json();
    const keyInfo = keyBody && typeof keyBody.info === 'object' ? keyBody.info : null;
    if (!keyInfo) throw new Error('key/info response carried no info object');
    // /user/info 는 팀 멤버십 예산 전용이라 실패해도 키 예산 폴백으로 진행한다.
    let userInfo = null;
    try {
      const userRes = await fetchImpl(`${gw.base}/user/info`, { signal: controller.signal, headers });
      if (userRes.ok) userInfo = await userRes.json();
    } catch (e) {
      debug('litellm-budget:user-info', e);
    }
    const picked = pickBudgetSource(keyInfo, userInfo);
    const next = {
      base: gw.base,
      checkedAt: Date.now(),
      source: picked ? picked.source : null,
      spend: picked ? picked.spend : (numOrNull(keyInfo.spend) ?? 0),
      maxBudget: picked ? picked.maxBudget : null,
      budgetResetAt: picked ? picked.budgetResetAt : null,
    };
    writeBudgetState(next);
    return next;
  } finally {
    clearTimeout(timer);
  }
}
