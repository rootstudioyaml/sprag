/**
 * team-standing — the lines `sprag team status` prints about the member's
 * standing in the organization's virtual office, what moving up takes, and the
 * field guide of species to climb through.
 *
 * The statusline chip says `Pro member-1e500474 amazon 종합 점수 12명 중 3위
 * 🦊 여우` and no more. This answers the questions that chip raises: how many
 * people stand ahead, whether the rank is earned by spending more tokens or by
 * using them better, which species is next and what the whole ladder looks
 * like. The score adds the spend rank and the delegation-share rank (and the
 * prompt-count rank where prompt capture is on), so the spend rank rises with
 * more tokens and the delegation rank rises by handing a larger share of the
 * same spend to cheaper models. The species follow the score's percentile
 * (GRADES in office-species.js), and the six species from the wolf up also
 * need the delegation share at or above the company median.
 *
 * The personal figures come from the server's member_standing (team-sync.js
 * refreshStanding): `dlg`, `medianDlg`, `scorePct`, `spent`, `weights`, `idle`
 * and `next` ({ grade, pass, needDlg }). An older server sends none of them;
 * the percentile is then read off the rank and the distance computed the way
 * the office drawer does (scorePctOf, nextOf), so the figures never wait for
 * the server. Alone in the standings the percentile is 50% by definition and
 * nothing moves it, and both blocks say so instead of naming a next species.
 * Pure: no I/O, so the tests pin every wording.
 */

import { GRADES, TIER_NAMES, speciesLabel } from './office-species.js';

const pct = (v) => `${Math.round(Number(v) * 100)}%`;
const money = (v) => `$${Number(v).toFixed(2)}`;
const floorPct = (g) => Math.round(g.minSr * 100);
/**
 * Percentage points from the score percentile `sr` up to the floor of species
 * `g`, at least 1 while the floor is not cleared, 0 when it already is (then
 * only the delegation rule stands in the way). Null without a percentile or a
 * floor (the idle row has none).
 */
export function pointsTo(g, sr) {
  if (!g || !(g.minSr >= 0) || !Number.isFinite(sr)) return null;
  const pts = Math.ceil((g.minSr - sr) * 100 - 1e-9);
  return pts <= 0 ? 0 : pts;
}
/** The species one row up the ladder, or null on the top row and for unknown keys. */
export function nextGradeUp(key) {
  const i = GRADES.findIndex((g) => g.key === key);
  return i > 0 ? GRADES[i - 1] : null;
}

const isRanked = (st) => Number.isInteger(st.rank) && Number.isInteger(st.ranked) && st.rank >= 1 && st.ranked >= st.rank;

/**
 * The score percentile the species follow (0 lowest, 1 highest). Alone in the
 * standings it is 0.5 by definition (office-scene.js rank() below two people).
 * Otherwise the server's `scorePct` when it sent one, else read off the rank:
 * the office ranks a score as (people below + ties / 2) / (people − 1), so
 * without ties rank r of n is (n − r) / (n − 1). Ties (two identical scores)
 * would put the true value a little lower. Null when there is no rank.
 */
export function scorePctOf(st) {
  if (!st || typeof st !== 'object' || !isRanked(st)) return null;
  if (st.ranked < 2) return 0.5;
  if (Number.isFinite(st.scorePct)) return st.scorePct;
  return (st.ranked - st.rank) / (st.ranked - 1);
}

/**
 * The next species up and the distance to it, { grade, pass, needDlg }: the
 * server's `next` when it sent one, otherwise the office drawer's arithmetic on
 * the percentile: people to pass = ceil((floor − percentile) × (people − 1)).
 * Whether the delegation-share rule still stands in the way is known only with
 * the share and the median; without them a species with the rule keeps it.
 * Null when idle, alone, on the top row, or without a percentile.
 */
export function nextOf(st, sr = scorePctOf(st)) {
  if (!st || typeof st !== 'object') return null;
  const srv = st.next && typeof st.next === 'object' && typeof st.next.grade === 'string' ? st.next : null;
  if (srv) return srv;
  if (st.idle === true || st.grade === 'chick' || !Number.isFinite(sr) || !isRanked(st) || st.ranked < 2) return null;
  const up = nextGradeUp(st.grade);
  if (!up || !(up.minSr >= 0)) return null;
  const dlgOk = Number.isFinite(st.dlg) && Number.isFinite(st.medianDlg) && st.dlg >= st.medianDlg;
  return { grade: up.key, pass: Math.max(0, Math.ceil((up.minSr - sr) * (st.ranked - 1) - 1e-6)), needDlg: up.needDlg && !dlgOk };
}

/**
 * @param {object|null|undefined} st team.json `standing`
 * @param {{ lang?: 'ko'|'en', org?: string|null }} [opts]
 * @returns {string[]} lines; empty when there is no standing on record
 */
export function standingGuideLines(st, { lang = 'en', org = null, team = null } = {}) {
  if (!st || typeof st !== 'object' || typeof st.grade !== 'string') return [];
  const ko = lang === 'ko';
  const label = (k) => speciesLabel(k, lang, { emoji: true }) || k;
  const animal = label(st.grade);
  const ranked = Number.isInteger(st.rank) && Number.isInteger(st.ranked) && st.rank >= 1 && st.ranked >= st.rank;
  const period = st.rangeFrom && st.rangeTo ? ` (${st.rangeFrom} ${ko ? '~' : 'to'} ${st.rangeTo})` : '';
  const where = org ? `${org} ` : '';
  const has = (v) => Number.isFinite(v);
  // The rank within the team, when the team is a strict part of the ranked people.
  const teamName = team || st.teamName || null;
  const inTeam = ranked && Number.isInteger(st.teamRank) && Number.isInteger(st.teamRanked)
    && st.teamRank >= 1 && st.teamRanked >= st.teamRank && st.teamRanked < st.ranked && teamName;
  const teamPlace = inTeam ? (ko ? ` · ${teamName} 팀 ${st.teamRanked}명 중 ${st.teamRank}위` : ` · team ${teamName} #${st.teamRank} of ${st.teamRanked}`) : '';
  const lines = [];

  if (st.grade === 'ghost' || !ranked) {
    lines.push(ko
      ? `순위: ${where}${animal}${period}. 이 기간에 올라온 사용 기록이 없어 순위 밖입니다. 지출이 올라오면 아래 도감의 한 종이 됩니다.`
      : `Standing: ${where}${animal}${period}. No usage uploaded in this period, so no rank yet; once spend comes in you become one of the species below.`);
    lines.push(...fieldGuideLines(null, lang));
    return lines;
  }

  lines.push(ko
    ? `순위: ${where}종합 점수 ${st.ranked}명 중 ${st.rank}위${teamPlace} · ${animal}${period}`
    : `Standing: ${where}overall score #${st.rank} of ${st.ranked}${teamPlace} · ${animal}${period}`);

  // Where that rank puts you: the people ahead, or the crown.
  if (st.crown) {
    lines.push(ko ? '  이번 기간 회사 1위입니다 👑' : '  #1 in the company this period 👑');
  } else if (st.rank === 1 && st.ranked === 1) {
    lines.push(ko
      ? '  지금은 순위에 혼자 올라 있습니다. 동료가 참여하면 경쟁이 시작됩니다.'
      : '  You are the only one in the standings so far; the race starts when a colleague joins.');
  } else if (st.rank === 1) {
    lines.push(ko ? '  회사 1위입니다.' : '  #1 in the company.');
  } else {
    lines.push(ko
      ? `  앞에 ${st.rank - 1}명이 있습니다. 1위에 오르면 👑 왕관을 씁니다.`
      : `  ${st.rank - 1} ahead of you; reach #1 and you wear the crown 👑.`);
  }

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

  // The next species up, as the office drawer says it. The percentile is the
  // server's or read off the rank (scorePctOf), the distance the server's or
  // the drawer's arithmetic (nextOf). Alone in the standings neither moves.
  const sr = scorePctOf(st);
  const solo = st.ranked === 1;
  const next = solo ? null : nextOf(st, sr);
  const up = nextGradeUp(st.grade);
  const floorNote = (g) => (g && g.minSr >= 0
    ? (ko
      ? ` (백분위 ${has(sr) ? `지금 ${pct(sr)}, ` : ''}${floorPct(g)}%부터)`
      : ` (percentile ${has(sr) ? `now ${pct(sr)}, ` : ''}${floorPct(g)}% and up)`)
    : '');
  if (st.idle === true || st.grade === 'chick') {
    lines.push(ko ? '  다음 등급: 이 기간에 지출이 생기면 순위에 오릅니다.' : '  Next species: spend in this period puts you in the standings.');
  } else if (solo) {
    lines.push(ko
      ? `  다음 등급: 혼자일 때는 백분위가 50%에 고정되어 ${animal}에 머뭅니다. 동료가 한 명이라도 참여하면 지출 순위와 위임 비율 순위로 등급이 갈립니다.`
      : `  Next species: alone, the percentile stays at 50% and so does the ${animal}. As soon as one colleague joins, the spend rank and the delegation-share rank decide the species.`);
  } else if (next) {
    const s = label(next.grade);
    const g = GRADES.find((r) => r.key === next.grade);
    const x = Math.max(1, Number(next.pass) || 0);
    // The median in brackets when the server sent it; the rule is named either way.
    const c = has(st.medianDlg) ? `${ko ? '' : ' '}(${pct(st.medianDlg)})` : '';
    const pts = pointsTo(g, sr);
    let text;
    if (pts !== null) {
      // With the percentile: where you are, how many points more, and the
      // people that amounts to.
      const now = pct(sr);
      if (next.needDlg && !(Number(next.pass) > 0)) {
        text = ko
          ? `${s}. 백분위는 이미 ${floorPct(g)}%를 넘었고 위임 비율을 회사 중앙값${c} 이상으로 올리면 됩니다.`
          : `${s}. Your percentile already clears ${floorPct(g)}%; raise the delegation share to the company median${c}.`;
      } else if (next.needDlg) {
        text = ko
          ? `${s}. 지금 백분위 ${now}, ${pts}%p 더 오르고(${x}명 앞지르기) 위임 비율이 회사 중앙값${c} 이상이면 됩니다.`
          : `${s}. Percentile now ${now}; ${pts} pts more (pass ${x}) and a delegation share at or above the company median${c}.`;
      } else {
        text = ko
          ? `${s}. 지금 백분위 ${now}, ${Math.max(1, pts)}%p 더 오르면 됩니다 (${x}명 앞지르기).`
          : `${s}. Percentile now ${now}; ${Math.max(1, pts)} pts more and you are there (pass ${x}).`;
      }
    } else if (next.needDlg && !(Number(next.pass) > 0)) {
      text = `${ko ? `위임 비율을 회사 중앙값${c} 이상으로 올리면 ${s}` : `raise the delegation share to the company median${c} to become ${s}`}${floorNote(g)}`;
    } else if (next.needDlg) {
      text = `${ko ? `${x}명을 더 앞지르고 위임 비율이 회사 중앙값${c} 이상이면 ${s}` : `pass ${x} more and reach the company median delegation share${c} to become ${s}`}${floorNote(g)}`;
    } else {
      text = `${ko ? `${x}명을 더 앞지르면 ${s}` : `pass ${x} more to become ${s}`}${floorNote(g)}`;
    }
    lines.push(`  ${ko ? '다음 등급' : 'Next species'}: ${text}`);
  } else if (!up) {
    lines.push(ko ? '  다음 등급: 도감에서 가장 높은 종입니다.' : '  Next species: the top species in the field guide.');
  } else {
    // An older server: the ladder names the species, the distance is not known.
    lines.push(ko
      ? `  다음 등급: ${label(up.key)}${floorNote(up)}. 몇 명을 더 앞질러야 하는지는 팀 서버가 갱신되면 나옵니다.`
      : `  Next species: ${label(up.key)}${floorNote(up)}. How many people to pass appears once the team server is updated.`);
  }

  lines.push(...fieldGuideLines(st.grade, lang));
  return lines;
}

/**
 * The short form for the statusline's team line: where the rank puts you and
 * what the next species takes, as two or three phrases. The same facts as the
 * block above, without the sentences.
 *   ['1위까지 2명', '다음 🐆 치타: 2명 더 (77%부터)']
 * `emoji: false` keeps the species names bare (narrow and text modes).
 */
export function standingFeedbackShort(st, lang = 'en', { emoji = true } = {}) {
  if (!st || typeof st !== 'object' || typeof st.grade !== 'string') return [];
  const ko = lang === 'ko';
  const label = (k) => speciesLabel(k, lang, { emoji }) || k;
  const has = (v) => Number.isFinite(v);
  const ranked = Number.isInteger(st.rank) && Number.isInteger(st.ranked) && st.rank >= 1 && st.ranked >= st.rank;
  if (st.grade === 'ghost' || !ranked) return [ko ? '이 기간 업로드 없음' : 'no usage this period'];
  const idle = st.idle === true || st.grade === 'chick';
  // Alone in the standings the percentile is 50% by definition and nothing
  // moves it, so the line says that and what would: a colleague joining.
  if (st.ranked === 1 && !idle) {
    return ko
      ? ['지금 50%, 혼자라 고정', '동료가 참여하면 순위 시작']
      : ['now 50%, fixed while alone', 'standings start when a colleague joins'];
  }
  const out = [];
  if (st.crown) out.push(ko ? `${emoji ? '👑 ' : ''}회사 1위` : `${emoji ? '👑 ' : ''}#1 in the company`);
  else if (st.rank === 1 && st.ranked === 1) out.push(ko ? '혼자 순위에 있음' : 'alone in the standings');
  else if (st.rank === 1) out.push(ko ? '회사 1위' : '#1 in the company');
  else out.push(ko ? `1위까지 ${st.rank - 1}명` : `${st.rank - 1} to pass for #1`);

  const sr = scorePctOf(st);
  const next = nextOf(st, sr);
  const up = nextGradeUp(st.grade);
  const floor = (g) => (g && g.minSr >= 0 ? (ko ? `${floorPct(g)}%부터` : `${floorPct(g)}% and up`) : '');
  if (next) {
    const s = label(next.grade);
    const g = GRADES.find((x) => x.key === next.grade);
    const x = Math.max(1, Number(next.pass) || 0);
    const c = has(st.medianDlg) ? pct(st.medianDlg) : (ko ? '회사 중앙값' : 'the company median');
    const pts = pointsTo(g, sr);
    if (pts !== null) {
      // With the percentile: where you are and how many points more.
      const now = pct(sr);
      if (next.needDlg && !(Number(next.pass) > 0)) out.push(ko ? `지금 ${now}, 위임 비율 ${c} 이상이면 ${s}` : `now ${now}, delegation share ${c} or more for ${s}`);
      else if (next.needDlg) out.push(ko ? `지금 ${now}, ${pts}%p 더 오르고 위임 비율 ${c} 이상이면 ${s}` : `now ${now}, ${pts} pts more and delegation share ${c} or more for ${s}`);
      else out.push(ko ? `지금 ${now}, ${Math.max(1, pts)}%p 더 오르면 ${s} (${x}명 앞지르기)` : `now ${now}, ${Math.max(1, pts)} pts more for ${s} (pass ${x})`);
    } else if (next.needDlg && !(Number(next.pass) > 0)) {
      out.push(ko ? `다음 ${s}: 위임 비율 ${c} 이상` : `next ${s}: delegation share ${c} or more`);
    } else if (next.needDlg) {
      out.push(ko ? `다음 ${s}: ${x}명 더, 위임 비율 ${c} 이상` : `next ${s}: ${x} more and delegation share ${c} or more`);
    } else {
      out.push(ko ? `다음 ${s}: ${x}명 더${floor(g) ? ` (${floor(g)})` : ''}` : `next ${s}: ${x} more${floor(g) ? ` (${floor(g)})` : ''}`);
    }
  } else if (idle) {
    out.push(ko ? '지출이 생기면 순위에 오름' : 'spend to enter the standings');
  } else if (!up) {
    out.push(ko ? '도감 최상위' : 'top of the field guide');
  } else {
    out.push(ko ? `다음 ${label(up.key)} (${floor(up)})` : `next ${label(up.key)} (${floor(up)})`);
  }
  return out;
}

/**
 * The field guide: every species by tier, best first, with the percentile each
 * one starts at and a marker on the caller's own. Shared by the ranked and the
 * unranked block, so a newcomer sees what there is to climb.
 */
export function fieldGuideLines(grade, lang = 'en') {
  const ko = lang === 'ko';
  const lines = [ko
    ? '동물 도감: 종합 점수 백분위로 30종을 나눕니다. 종 옆 숫자는 그 종이 시작되는 백분위이고 ▶ 가 지금 등급입니다.'
    : 'Field guide: 30 species by overall-score percentile. The number after a species is the percentile it starts at; ▶ marks yours.'];
  for (const tier of ['power', 'active', 'normal', 'low']) {
    const items = GRADES.filter((g) => g.tier === tier).map((g) => {
      const mark = g.key === grade ? '▶ ' : '';
      const floor = g.minSr >= 0 ? ` ${floorPct(g)}` : (ko ? ' (지출 없음)' : ' (no spend)');
      return `${mark}${speciesLabel(g.key, lang, { emoji: true })}${floor}`;
    });
    const rule = tier === 'power'
      ? (ko ? ' (위임 비율이 회사 중앙값 이상이어야 함)' : ' (needs a delegation share at or above the company median)')
      : '';
    lines.push(`  ${TIER_NAMES[tier][lang]}${rule}: ${items.join(' · ')}`);
  }
  return lines;
}
