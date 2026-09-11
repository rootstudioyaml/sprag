/**
 * month-spend: 이번 달 1일 00시(로컬 시각) 이후 지출한 추정 금액을 계산합니다.
 *
 * LiteLLM·Bedrock처럼 5h/7d cap 이 아예 없는 게이트웨이 사용자도
 * "이번 달에 얼마나 썼는지"는 늘 궁금하므로, 세션 로그를 기반으로
 * 달력 월 단위 지출을 통계선에 상시 노출합니다. 모델 단가는 세션마다
 * 다르므로 세션별로 estimateCost 를 적용해 합산합니다.
 */

import { estimateCost } from './cost.js';

/** 이번 달 1일 00:00(로컬)의 epoch ms. */
export function monthStartMs(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

/** 통계선 라벨에 쓰는 짧은 월 이름 (예: 'Sep'). */
export function monthLabel(now = new Date()) {
  return now.toLocaleString('en-US', { month: 'short' });
}

/**
 * 월초 이후 세션들의 지출 추정치 합계(USD).
 * endTime 이 월초 이후인 세션만 집계합니다. 세션이 월 경계에 걸치는
 * 경우는 세션 전체를 포함하는데, 경계 세션은 드물고 통계선 지표는
 * 추정치이므로 이 정도 오차는 허용합니다.
 *
 * @param {Array} sessions parseAllSessions 결과
 * @param {Date} [now]
 * @returns {{usd:number, sessions:number, sinceMs:number, label:string}}
 */
export function monthSpend(sessions, now = new Date()) {
  const since = monthStartMs(now);
  let usd = 0;
  let count = 0;
  for (const s of sessions || []) {
    if (!s || !s.endTime || s.endTime.getTime() < since) continue;
    if (!s.totals) continue;
    try {
      usd += estimateCost(s.totals, s.model).actual;
      count += 1;
    } catch {
      // 단가를 모르는 모델은 합계에서 빠집니다. 통계선에서는 침묵이 낫습니다.
    }
  }
  return { usd, sessions: count, sinceMs: since, label: monthLabel(now) };
}
