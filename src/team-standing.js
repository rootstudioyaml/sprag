/**
 * team-standing — the lines `sprag team status` prints about the member's
 * standing in the organization's virtual office, and what moving up takes.
 *
 * The statusline chip says `Pro member-1e500474 amazon 종합 점수 12명 중 3위
 * 🦊 여우` and no more. This answers the question that chip raises: is the
 * rank earned by spending more tokens or by using them better? Both, in a
 * fixed ratio. The overall score adds the spend rank and the delegation-share
 * rank (and the prompt-count rank where prompt capture is on), so the spend
 * rank rises with more tokens and the delegation rank rises by handing a larger
 * share of the same spend to cheaper models. The species follow the score's
 * percentile, and the six species from the wolf up also need the delegation
 * share at or above the company median.
 *
 * The figures come from the server's member_standing (team-sync.js
 * refreshStanding): `dlg`, `medianDlg`, `scorePct`, `spent`, `weights`, `idle`
 * and `next` ({ grade, pass, needDlg }). An older server sends none of them, and
 * the block then states the formula alone and says where the rest will come
 * from. Pure: no I/O, so the tests pin every wording.
 */

import { speciesLabel } from './office-species.js';

const pct = (v) => `${Math.round(Number(v) * 100)}%`;
const money = (v) => `$${Number(v).toFixed(2)}`;

/**
 * @param {object|null|undefined} st team.json `standing`
 * @param {{ lang?: 'ko'|'en', org?: string|null }} [opts]
 * @returns {string[]} lines; empty when there is no standing on record
 */
export function standingGuideLines(st, { lang = 'en', org = null } = {}) {
  if (!st || typeof st !== 'object' || typeof st.grade !== 'string') return [];
  const ko = lang === 'ko';
  const animal = speciesLabel(st.grade, lang, { emoji: true }) || st.grade;
  const ranked = Number.isInteger(st.rank) && Number.isInteger(st.ranked) && st.rank >= 1 && st.ranked >= st.rank;
  const period = st.rangeFrom && st.rangeTo ? ` (${st.rangeFrom} ${ko ? '~' : 'to'} ${st.rangeTo})` : '';
  const where = org ? `${org} ` : '';
  const lines = [];

  if (st.grade === 'ghost' || !ranked) {
    lines.push(ko
      ? `순위: ${where}${animal}${period}. 이 기간에 올라온 사용 기록이 없어 순위 밖입니다.`
      : `Standing: ${where}${animal}${period}. No usage uploaded in this period, so no rank yet.`);
    return lines;
  }

  lines.push(ko
    ? `순위: ${where}종합 점수 ${st.ranked}명 중 ${st.rank}위 · ${animal}${period}`
    : `Standing: ${where}overall score #${st.rank} of ${st.ranked} · ${animal}${period}`);

  // What the score is made of. The weights are the server's when it sent them;
  // otherwise both known sets are stated.
  const w = Array.isArray(st.weights) && st.weights.length >= 2 ? st.weights : null;
  if (w) {
    const parts = ko
      ? [`기간 지출 순위 ${pct(w[0])}`, `위임 비율 순위 ${pct(w[1])}`, ...(w[2] > 0 ? [`프롬프트 수 순위 ${pct(w[2])}`] : [])]
      : [`the spend rank (${pct(w[0])})`, `the delegation-share rank (${pct(w[1])})`, ...(w[2] > 0 ? [`the prompt-count rank (${pct(w[2])})`] : [])];
    lines.push(ko
      ? `  종합 점수는 ${parts.slice(0, -1).join(', ')}${parts.length > 1 ? '와 ' : ''}${parts[parts.length - 1]}를 더한 값입니다.`
      : `  The overall score adds ${parts.slice(0, -1).join(', ')}${parts.length > 1 ? ' and ' : ''}${parts[parts.length - 1]}.`);
  } else {
    lines.push(ko
      ? '  종합 점수는 기간 지출 순위 62.5%와 위임 비율 순위 37.5%를 더한 값입니다. 프롬프트 수집을 켠 Enterprise 조직은 50%, 30%, 20%로 프롬프트 수 순위까지 더합니다.'
      : '  The overall score adds the spend rank (62.5%) and the delegation-share rank (37.5%). An Enterprise organization with prompt capture on uses 50%, 30% and 20%, with the prompt-count rank as the third.');
  }
  lines.push(ko
    ? `  지출 순위는 토큰을 더 써야 오르고 위임 비율 순위는 같은 지출에서 싼 모델에 맡기는 몫을 늘려야 오릅니다. ${speciesLabel('wolf', 'ko', { emoji: false })} 이상 여섯 종은 위임 비율이 회사 중앙값 이상이어야 합니다.`
    : `  The spend rank rises with more tokens; the delegation rank rises by handing a larger share of the same spend to cheaper models. The six species from ${speciesLabel('wolf', 'en', { emoji: false })} up also need a delegation share at or above the company median.`);

  // The caller's own figures, when the server sent them.
  const has = (v) => Number.isFinite(v);
  if (has(st.dlg) || has(st.spent) || has(st.scorePct)) {
    const parts = [];
    if (has(st.spent)) parts.push(ko ? `지출 ${money(st.spent)}` : `spent ${money(st.spent)}`);
    if (has(st.dlg)) {
      const med = has(st.medianDlg) ? (ko ? ` (회사 중앙값 ${pct(st.medianDlg)})` : ` (company median ${pct(st.medianDlg)})`) : '';
      parts.push(ko ? `위임 비율 ${pct(st.dlg)}${med}` : `delegation share ${pct(st.dlg)}${med}`);
    }
    if (has(st.scorePct)) parts.push(ko ? `점수 백분위 ${pct(st.scorePct)}` : `score percentile ${pct(st.scorePct)}`);
    lines.push(`  ${ko ? '이 컴퓨터' : 'This machine'}: ${parts.join(' · ')}`);
  }

  // The next species up, as the office drawer says it.
  const next = st.next && typeof st.next === 'object' && typeof st.next.grade === 'string' ? st.next : null;
  if (next) {
    const s = speciesLabel(next.grade, lang, { emoji: true }) || next.grade;
    const x = Math.max(1, Number(next.pass) || 0);
    const c = has(st.medianDlg) ? pct(st.medianDlg) : (ko ? '알 수 없음' : 'unknown');
    let text;
    if (next.needDlg && !(Number(next.pass) > 0)) {
      text = ko ? `위임 비율을 회사 중앙값(${c}) 이상으로 올리면 ${s}` : `raise the delegation share to the company median (${c}) to become ${s}`;
    } else if (next.needDlg) {
      text = ko ? `${x}명을 더 앞지르고 위임 비율이 회사 중앙값(${c}) 이상이면 ${s}` : `pass ${x} more and reach the company median delegation share (${c}) to become ${s}`;
    } else {
      text = ko ? `${x}명을 더 앞지르면 ${s}` : `pass ${x} more to become ${s}`;
    }
    lines.push(`  ${ko ? '다음 등급' : 'Next species'}: ${text}`);
  } else if (st.idle === true) {
    lines.push(ko ? '  다음 등급: 이 기간에 지출이 생기면 순위에 오릅니다.' : '  Next species: spend in this period puts you in the standings.');
  } else if (st.idle === false) {
    lines.push(ko ? '  다음 등급: 도감에서 가장 높은 종입니다.' : '  Next species: the top species in the field guide.');
  } else {
    // An older server: nothing personal came back.
    lines.push(ko
      ? '  이 컴퓨터의 수치와 다음 등급까지의 거리는 팀 서버가 갱신되면 나옵니다.'
      : '  Your own figures and the distance to the next species appear once the team server is updated.');
  }
  return lines;
}
