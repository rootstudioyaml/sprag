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
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { userDataDir } from './paths.js';
import { gaugeBar, formatMoney } from './formatters/statusline.js';
import { labelForKey } from './window-labels.js';
import { formatResetClock } from './format-time.js';
import { cliEntryPath } from './update-check.js';
import { debug } from './debug.js';

// 예산은 분 단위로 변하지 않습니다. 5분이면 게이지 용도로 충분히 신선하고,
// 통계선 렌더(수 초 간격)가 프록시를 두들기지 않습니다.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const HELPER_TIMEOUT_MS = 10000;

export function budgetStatePath() {
  return join(userDataDir(), 'litellm-budget.json');
}

/**
 * 게이트웨이 주소만 판정합니다. 캐시만 읽는 경로는 키가 필요하지 않으므로,
 * 키 확보와 주소 판정을 분리해 둡니다. apiKeyHelper 로만 인증하는 환경에는
 * 환경변수에 토큰이 없어서, 키를 함께 요구하면 렌더 경로가 통째로 탈락합니다.
 */
export function gatewayBase(env = process.env) {
  const base = (env.ANTHROPIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  // 공식 엔드포인트를 그대로 가리키면 게이트웨이가 아닙니다.
  if (/^https?:\/\/api\.anthropic\.com/i.test(base)) return null;
  return base;
}

/** 게이트웨이 주소와 키를 함께 돌려줍니다. 둘 중 하나라도 없으면 null. */
export function gatewayEnv(env = process.env) {
  const base = gatewayBase(env);
  if (!base) return null;
  const key = resolveKey(env);
  if (!key) return null;
  return { base, key };
}

/**
 * Claude Code 와 같은 방식으로 apiKeyHelper 를 실행해 토큰을 얻습니다.
 * 환경변수에 토큰을 두지 않고 헬퍼 스크립트로 매번 발급받는 구성이 공식 인증
 * 방식 가운데 하나이며, 그 구성에서는 statusline 자식 프로세스의 process.env
 * 안에 토큰이 존재하지 않습니다.
 *
 * 헬퍼 실행은 비용이 있으므로 갱신 경로(5분에 한 번 뜨는 detached 자식)에서만
 * 부릅니다. 수 초 간격으로 도는 렌더 경로에서 부르면 통계선이 그만큼 느려집니다.
 */
export function keyFromApiKeyHelper(cwd = process.cwd()) {
  const candidates = [
    join(cwd, '.claude', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.json'),
  ];
  for (const p of candidates) {
    let helper;
    try {
      helper = JSON.parse(readFileSync(p, 'utf8'))?.apiKeyHelper;
    } catch {
      continue;
    }
    if (typeof helper !== 'string' || !helper.trim()) continue;
    try {
      const out = execSync(helper, {
        encoding: 'utf8',
        timeout: HELPER_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      // 진행 로그를 함께 출력하는 헬퍼가 있으므로 마지막 비어 있지 않은 줄을 취합니다.
      const token = out.trim().split(/\r?\n/).filter(Boolean).pop();
      if (token) return token.trim();
    } catch (e) {
      debug('litellm-budget:helper', e);
    }
  }
  return null;
}

/** 환경변수 토큰을 먼저 보고, 없으면 apiKeyHelper 로 내려갑니다. */
export function resolveKey(env = process.env) {
  const direct = (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '').trim();
  return direct || keyFromApiKeyHelper();
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
  const base = gatewayBase(env);
  if (!base) return null;
  const s = readBudgetState();
  // 다른 프록시의 캐시를 재사용하지 않도록 base 단위로 격리합니다.
  if (s.base !== base) return null;
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
    // 렌더러가 출처를 함께 보여 줄 수 있도록 싣습니다. internal user 한도는
    // LiteLLM 이 차단 판정에 쓰는 값이 아니라서 그대로 보여 주면 오해를 부릅니다.
    source: typeof s.source === 'string' ? s.source : null,
  };
}

/**
 * `sprag litellm-budget` 이 출력하는 사람용 보고서입니다. 통계선의 cap 게이지와
 * 같은 모양(비주얼 바 + 백분율 + 금액)을 쓰되, 통계선에서는 폭이 부족해 생략하는
 * 잔여 금액과 예산 출처, 캐시 신선도를 함께 적습니다.
 *
 * `mode` 는 통계선과 같은 판정 결과를 받습니다. 이 보고서도 결국 터미널에
 * 출력되므로, IntelliJ 에서 실행하면 폰트에 없는 글리프가 대체 폰트로 그려져
 * 통계선과 똑같이 어긋납니다. 게이지 눈금과 예산 아이콘을 함께 모드에 맞춥니다.
 *
 * @param {object} state - readBudgetState() 가 돌려준 캐시 상태
 * @param {Date} [now]
 * @param {string} [mode] - 라벨 모드 ('icon' | 'narrow' | 'text')
 * @returns {string[]} 출력할 줄들
 */
export function formatBudgetReport(state, now = new Date(), mode = 'icon') {
  const max = Number(state?.maxBudget);
  const spend = Number(state?.spend);
  if (!Number.isFinite(max) || max <= 0) {
    const spent = Number.isFinite(spend) ? formatMoney(spend) : '알 수 없음';
    return [`예산 한도가 설정되지 않은 키입니다 (무제한). 누적 지출: ${spent}`];
  }
  const used = Number.isFinite(spend) ? Math.max(0, spend) : 0;
  const left = Math.max(0, max - used);
  const pct = Math.min(100, (used / max) * 100);
  const win = labelForKey('litellm_budget');
  // 통계선의 text 모드는 게이지를 아예 그리지 않지만 이 보고서는 그립니다. text 는
  // 이모지를 피하려고 고른 모드이므로, 그 선택을 존중해 눈금도 폰트 커버리지가
  // 확인된 narrow 쪽 글리프를 씁니다. 라벨은 아이콘 없이 이름만 적습니다.
  const bare = mode === 'text';
  const tickMode = mode === 'icon' ? 'icon' : 'narrow';
  const icon = bare ? '' : (mode === 'narrow' ? (win.narrowIcon || win.icon) : win.icon);
  const head = bare ? 'budget' : `${icon} budget`;
  const lines = [
    `${head} ${gaugeBar(pct, tickMode)} ${Math.round(pct)}% ${formatMoney(used)}/${formatMoney(max)}`,
    `   사용 ${formatMoney(used)} · 잔여 ${formatMoney(left)} (${(100 - pct).toFixed(1)}%)`,
  ];
  const resetMs = Number(state?.budgetResetAt);
  if (Number.isFinite(resetMs) && resetMs > 0) {
    const clock = formatResetClock(Math.round(resetMs / 1000), now);
    if (clock) lines.push(`   리셋 ${clock}`);
  }
  const labels = { team: '팀 멤버십 예산', key: '키 예산', user: '사용자 예산' };
  if (state?.source) lines.push(`   출처 ${labels[state.source] || state.source}`);
  if (state?.source === 'user') {
    // LiteLLM 은 팀 멤버십 한도로 차단 여부를 판정하므로, 사용자 한도만 잡힌
    // 상태에서는 실제 한도와 크게 어긋날 수 있습니다.
    lines.push('   주의: 사용자 한도는 차단 판정 기준과 다를 수 있습니다.');
  }
  const checkedAt = Number(state?.checkedAt);
  if (Number.isFinite(checkedAt) && checkedAt > 0) {
    const ageMin = Math.max(0, Math.round((now.getTime() - checkedAt) / 60000));
    lines.push(`   조회 ${ageMin}분 전`);
  }
  return lines;
}

/** 캐시가 오래됐으면 detached 자식으로 갱신을 예약합니다. 즉시 반환. */
export function maybeSpawnBudgetCheck(env = process.env) {
  // 키 확보는 자식이 담당합니다. 렌더 경로에서 헬퍼를 돌리면 통계선이 느려집니다.
  const base = gatewayBase(env);
  if (!base) return false;
  const s = readBudgetState();
  const age = Date.now() - (Number(s.checkedAt) || 0);
  if (s.base === base && age < CHECK_INTERVAL_MS) return false;
  // 오프라인/오류 시 렌더마다 자식을 다시 띄우지 않도록 시도 시각을 먼저 기록합니다.
  try {
    writeBudgetState({ ...s, base, checkedAt: Date.now() });
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
  // /key/info 가 404 인 게이트웨이(커스텀 인증)에서는 keyInfo 가 비므로,
  // /user/info 가 함께 주는 내 user_id 를 폴백으로 씁니다. 이 폴백이 없으면
  // 팀 전체 멤버십을 돌려주는 배포에서 남의 예산을 집을 수 있습니다.
  const userId = keyInfo?.user_id ?? userInfo?.user_info?.user_id ?? null;
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
  const base = gatewayBase(env);
  if (!base) return null;
  const key = resolveKey(env);
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${key}`,
  };
  try {
    // /key/info 는 커스텀 인증(JWT)을 쓰는 배포에서 404 가 정상입니다. 발급된
    // 토큰에 해당하는 행이 LiteLLM_VerificationToken 에 없기 때문입니다. 예산
    // 자체는 /user/info 에 있으므로, 여기서 중단하면 안 됩니다.
    let keyInfo = null;
    try {
      const keyRes = await fetchImpl(`${base}/key/info`, { signal: controller.signal, headers });
      if (keyRes.ok) {
        const keyBody = await keyRes.json();
        if (keyBody && typeof keyBody.info === 'object') keyInfo = keyBody.info;
      } else {
        debug('litellm-budget:key-info', new Error(`LiteLLM responded ${keyRes.status}`));
      }
    } catch (e) {
      debug('litellm-budget:key-info', e);
    }
    let userInfo = null;
    try {
      const userRes = await fetchImpl(`${base}/user/info`, { signal: controller.signal, headers });
      if (userRes.ok) userInfo = await userRes.json();
      else debug('litellm-budget:user-info', new Error(`LiteLLM responded ${userRes.status}`));
    } catch (e) {
      debug('litellm-budget:user-info', e);
    }
    // 둘 다 받지 못했을 때만 실패로 봅니다.
    if (!keyInfo && !userInfo) throw new Error('neither key/info nor user/info returned data');
    const picked = pickBudgetSource(keyInfo, userInfo);
    const next = {
      base,
      checkedAt: Date.now(),
      source: picked ? picked.source : null,
      spend: picked ? picked.spend : (numOrNull(keyInfo?.spend) ?? 0),
      maxBudget: picked ? picked.maxBudget : null,
      budgetResetAt: picked ? picked.budgetResetAt : null,
    };
    writeBudgetState(next);
    return next;
  } finally {
    clearTimeout(timer);
  }
}
