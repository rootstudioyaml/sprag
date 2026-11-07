/**
 * month-spend: 이번 달 1일 00시(로컬 시각) 이후 지출한 추정 금액을 계산합니다.
 *
 * LiteLLM·Bedrock처럼 5h/7d cap 이 아예 없는 게이트웨이 사용자도
 * "이번 달에 얼마나 썼는지"는 늘 궁금하므로, 세션 로그를 기반으로
 * 달력 월 단위 지출을 통계선에 상시 노출합니다. 모델 단가는 세션마다
 * 다르므로 세션별로 호출 경로에 맞는 가격(sessionCost)을 적용해 합산합니다.
 * LiteLLM 게이트웨이 세션은 게이트웨이 가격표로만 계산하고, 표에 없는 모델은
 * 합계에서 빼고 unpriced 로 셉니다. 정가표로 대신 채우지 않습니다.
 * 가격은 토큰을 쓴 날 기준입니다. 가격표는 UTC 자정에 바뀌므로 오늘 단가로
 * 계산하면 가격이 바뀔 때 지난 지출까지 달라집니다(#15).
 */

import { partCost, pricedParts } from './claude-price.js';
import { usageSince } from './usage-ledger.js';

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
 * endTime 이 월초 이후인 세션만 집계합니다. 월 경계에 걸친 세션은
 * 호출하는 쪽이 parser.js 의 sessionsSince 로 월초 이후 요청만 남겨서
 * 넘겨야 합니다. 그대로 넘기면 세션 전체가 이번 달 지출로 계산됩니다.
 *
 * Claude Code 가 transcript 를 지운 세션은 sessions 에 없으므로 사용량 장부
 * (usage-ledger.js)에서 월초 이후 일자분을 더합니다. sessions 에 있는 세션과
 * 그 서브에이전트 실행은 장부에서 빼서 두 번 세지 않습니다. 장부는 UTC 일자 단위라
 * 월초가 UTC 날짜와 어긋나면 장부 전용 세션은 최대 하루치를 더 셀 수 있습니다.
 * `ledger: false` 는 일부 프로젝트만 넘기는 호출처가 다른 프로젝트의 장부분을
 * 섞지 않으려고 씁니다.
 *
 * @param {Array} sessions parseAllSessions 결과
 * @param {Date} [now]
 * @param {{ledger?: boolean}} [opts]
 * @returns {{usd:number, sessions:number, unpriced:number, sinceMs:number, label:string}}
 */
export function monthSpend(sessions, now = new Date(), { ledger = true } = {}) {
  const since = monthStartMs(now);
  let usd = 0;
  let count = 0;
  let unpriced = 0;
  const price = (part) => {
    try {
      const c = partCost(part);
      if (!c) { unpriced += 1; return false; }
      usd += c.actual;
      return true;
    } catch {
      // 단가를 모르는 모델은 합계에서 빠집니다. 통계선에서는 침묵이 낫습니다.
      return false;
    }
  };
  const seen = new Set();
  for (const s of sessions || []) {
    if (s && s.sessionId) {
      seen.add(s.sessionId);
      for (const r of s.subagentRuns || []) if (r.agent) seen.add(`${s.sessionId}/${r.agent}`);
    }
    if (!s || !s.endTime || s.endTime.getTime() < since) continue;
    if (!s.totals) continue;
    // 세션이 띄운 서브에이전트 실행도 같은 청구서에 들어가므로 실행마다 그 모델의
    // 단가로 계산해 더합니다. 세션 수에는 넣지 않습니다.
    let priced = false;
    for (const part of pricedParts(s)) {
      if (price(part) && part.own) priced = true;
    }
    if (priced) count += 1;
  }
  if (ledger) {
    try {
      // 모델이 둘 이상인 장부 세션도 한 번만 세려고 id 로 모읍니다.
      const ids = new Set();
      for (const part of usageSince(since, { exclude: seen })) {
        if (price(part) && part.own) ids.add(part.id);
      }
      count += ids.size;
    } catch {
      // 장부를 못 읽어도 transcript 기준 합계는 그대로 냅니다.
    }
  }
  return { usd, sessions: count, unpriced, sinceMs: since, label: monthLabel(now) };
}
