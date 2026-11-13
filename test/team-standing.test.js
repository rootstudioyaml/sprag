/**
 * `sprag team status` standing block (src/team-standing.js): the rank and the
 * people ahead, what the overall score is made of, whether moving up takes more
 * tokens or a larger delegated share, the caller's own figures, the next species
 * up and the field guide of all thirty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { standingGuideLines, fieldGuideLines, nextGradeUp, scorePctOf, nextOf } from '../src/team-standing.js';
import { GRADES, SMALL_TEAM, squeezeSr, speciesLabel } from '../src/office-species.js';

const guided = (extra = {}) => ({
  grade: 'fox', tier: 'active', rank: 3, ranked: 12, crown: false, fetchedAt: 1,
  dlg: 0.31, medianDlg: 0.28, scorePct: 0.75, spent: 481.2, idle: false, hasPrompts: false,
  weights: [0.625, 0.375, 0], next: { grade: 'cheetah', pass: 2, needDlg: false },
  rangeFrom: '2026-10-09', rangeTo: '2026-11-07',
  ...extra,
});
const GUIDE_LINES = 5; // header and one line per tier

test('nothing on record: no lines', () => {
  assert.deepEqual(standingGuideLines(null), []);
  assert.deepEqual(standingGuideLines(undefined), []);
  assert.deepEqual(standingGuideLines({}), []);
});

test('the full block in Korean: rank and people ahead, formula, how to move, own figures, next species, field guide', () => {
  const lines = standingGuideLines(guided(), { lang: 'ko', org: 'acmeco' });
  assert.deepEqual(lines.slice(0, 6), [
    '순위: acmeco 종합 점수 12명 중 3위 · 🦊 여우 (2026-10-09 ~ 2026-11-07)',
    '  앞에 2명이 있습니다. 1위에 오르면 👑 왕관을 씁니다.',
    '  종합 점수는 기간 지출 순위 62.5%와 위임 비율 순위 37.5%를 더한 값입니다.',
    '  지출 순위는 토큰을 더 써야 오르고 위임 비율 순위는 같은 지출에서 싼 모델에 맡기는 몫을 늘려야 오릅니다. 늑대 이상 여섯 종은 위임 비율이 회사 중앙값 이상이어야 합니다.',
    '  이 PC: 지출 $481.20 · 위임 비율 31% (회사 중앙값 28%) · 점수 백분위 75%',
    '  다음 등급: 🐆 치타. 지금 백분위 75%, 2%p 더 오르면 됩니다 (2명 앞지르기).',
  ]);
  assert.equal(lines.length, 6 + GUIDE_LINES);
  assert.deepEqual(lines.slice(6), fieldGuideLines('fox', 'ko'));
});

test('the full block in English', () => {
  const lines = standingGuideLines(guided(), { lang: 'en', org: 'acmeco' });
  assert.equal(lines[0], 'Standing: acmeco overall score #3 of 12 · 🦊 Fox (2026-10-09 to 2026-11-07)');
  assert.equal(lines[1], '  2 ahead of you; reach #1 and you wear the crown 👑.');
  assert.equal(lines[2], '  The overall score adds the spend rank (62.5%) and the delegation-share rank (37.5%).');
  assert.match(lines[3], /^  The spend rank rises with more tokens; the delegation rank rises by handing a larger share of the same spend to cheaper models\. The six species from Wolf up also need a delegation share at or above the company median\.$/);
  assert.equal(lines[4], '  This machine: spent $481.20 · delegation share 31% (company median 28%) · score percentile 75%');
  assert.equal(lines[5], '  Next species: 🐆 Cheetah. Percentile now 75%; 2 pts more and you are there (pass 2).');
  assert.deepEqual(lines.slice(6), fieldGuideLines('fox', 'en'));
});

test('the field guide: every species by tier, best first, its starting percentile, and a marker on your own', () => {
  const ko = fieldGuideLines('fox', 'ko');
  assert.equal(ko[0], '동물 도감: 종합 점수 백분위로 30종을 나눕니다. 종 옆 숫자는 그 종이 시작되는 백분위이고 ▶ 가 지금 등급입니다.');
  assert.equal(ko[1], '  AI 파워 유저 (위임 비율이 회사 중앙값 이상이어야 함): 🐉 용 98 · 🦄 유니콘 95 · 🦁 사자 92 · 🐯 호랑이 89 · 🦅 독수리 85 · 🐺 늑대 80');
  assert.equal(ko[2], '  활발: 🐆 치타 77 · ▶ 🦊 여우 74 · 🦉 부엉이 71 · 🐕 허스키 68 · 🐼 판다 65 · 🐨 코알라 62 · 🐧 펭귄 58 · 🦝 너구리 54 · 🐱 고양이 50');
  assert.equal(ko[3], '  보통: 🐶 강아지 47 · 🐻 곰 44 · 🐵 원숭이 41 · 🦌 사슴 38 · 🐘 코끼리 35 · 🐷 돼지 32 · 🐑 양 29 · 🐰 토끼 25');
  assert.match(ko[4], /^  활용 장려 필요: 🦆 오리 22 · 🦔 고슴도치 19 · .* 다람쥐 16 · 🐹 햄스터 12 · 🐸 개구리 8 · 🐭 생쥐 4 · 🐤 병아리 \(지출 없음\)$/);
  // Every species appears exactly once, in ladder order, and only one is marked.
  const all = ko.slice(1).join(' · ');
  for (const g of GRADES) assert.ok(all.includes(speciesLabel(g.key, 'ko')), g.key);
  assert.equal((all.match(/▶ /g) || []).length, 1);
  const en = fieldGuideLines('cat', 'en');
  assert.equal(en[0], 'Field guide: 30 species by overall-score percentile. The number after a species is the percentile it starts at; ▶ marks yours.');
  assert.match(en[1], /^  AI power user \(needs a delegation share at or above the company median\): 🐉 Dragon 98 · /);
  assert.match(en[2], /· ▶ 🐱 Cat 50$/);
  assert.match(en[4], /^  Getting started: 🦆 Duck 22 · .* 🐤 Chick \(no spend\)$/);
  // No marker for a ghost, who is on no row (the header's own ▶ is the legend).
  assert.equal((fieldGuideLines(null, 'en').slice(1).join('').match(/▶ /g) || []).length, 0);
});

test('where the rank puts you: the crown, alone in the standings, or people ahead', () => {
  const ko = (extra) => standingGuideLines(guided(extra), { lang: 'ko' })[1];
  assert.equal(ko({ rank: 1, crown: true }), '  이번 기간 회사 1위입니다 👑');
  assert.equal(ko({ rank: 1, ranked: 1 }), '  지금은 순위에 혼자 올라 있습니다. 동료가 참여하면 경쟁이 시작됩니다.');
  assert.equal(ko({ rank: 1 }), '  회사 1위입니다.');
  assert.equal(ko({ rank: 12 }), '  앞에 11명이 있습니다. 1위에 오르면 👑 왕관을 씁니다.');
  const en = (extra) => standingGuideLines(guided(extra), { lang: 'en' })[1];
  assert.equal(en({ rank: 1, crown: true }), '  #1 in the company this period 👑');
  assert.equal(en({ rank: 1, ranked: 1 }), '  You are the only one in the standings so far; the race starts when a colleague joins.');
  assert.equal(en({ rank: 12 }), '  11 ahead of you; reach #1 and you wear the crown 👑.');
});

test('the prompt-count rank joins the formula where prompt capture is on', () => {
  const lines = standingGuideLines(guided({ weights: [0.5, 0.3, 0.2], hasPrompts: true }), { lang: 'ko' });
  assert.equal(lines[2], '  종합 점수는 기간 지출 순위 50%, 위임 비율 순위 30%와 프롬프트 수 순위 20%를 더한 값입니다.');
  const en = standingGuideLines(guided({ weights: [0.5, 0.3, 0.2], hasPrompts: true }), { lang: 'en' });
  assert.equal(en[2], '  The overall score adds the spend rank (50%), the delegation-share rank (30%) and the prompt-count rank (20%).');
});

test('the next species: the delegation rule alone, people and the rule, the top row, and an idle period', () => {
  const nextLine = (lang, extra) => standingGuideLines(guided(extra), { lang }).find((l) => /다음 등급|Next species/.test(l));
  // The percentile already clears the wolf's floor (80%): only the delegation rule is left.
  assert.equal(nextLine('ko', { next: { grade: 'wolf', pass: 0, needDlg: true }, scorePct: 0.82 }), '  다음 등급: 🐺 늑대. 백분위는 이미 80%를 넘었고 위임 비율을 회사 중앙값(28%) 이상으로 올리면 됩니다.');
  assert.equal(nextLine('ko', { next: { grade: 'wolf', pass: 2, needDlg: true } }), '  다음 등급: 🐺 늑대. 지금 백분위 75%, 5%p 더 오르고(2명 앞지르기) 위임 비율이 회사 중앙값(28%) 이상이면 됩니다.');
  // Without the server's percentile it is read off the rank: #4 of 13 is (13 − 4) / 12 = 75%.
  assert.equal(nextLine('ko', { rank: 4, ranked: 13, next: { grade: 'wolf', pass: 2, needDlg: true }, scorePct: null }), '  다음 등급: 🐺 늑대. 지금 백분위 75%, 5%p 더 오르고(2명 앞지르기) 위임 비율이 회사 중앙값(28%) 이상이면 됩니다.');
  // A percentile already past the floor still has one person to pass, as the office drawer says.
  assert.equal(nextLine('ko', { next: { grade: 'cheetah', pass: 0, needDlg: false }, scorePct: 0.78 }), '  다음 등급: 🐆 치타. 지금 백분위 78%, 1%p 더 오르면 됩니다 (1명 앞지르기).');
  // No median from the server: the rule is named without the figure.
  assert.equal(nextLine('ko', { next: { grade: 'wolf', pass: 0, needDlg: true }, scorePct: 0.82, medianDlg: null }), '  다음 등급: 🐺 늑대. 백분위는 이미 80%를 넘었고 위임 비율을 회사 중앙값 이상으로 올리면 됩니다.');
  // Alone in the standings: the percentile is pinned at 50%, and the line says what would move it.
  assert.equal(nextLine('ko', { grade: 'cat', rank: 1, ranked: 1 }), '  다음 등급: 혼자일 때는 백분위가 50%에 고정되어 🐱 고양이에 머뭅니다. 동료가 한 명이라도 참여하면 지출 순위와 위임 비율 순위로 등급이 갈립니다.');
  assert.equal(nextLine('en', { grade: 'cat', rank: 1, ranked: 1 }), '  Next species: alone, the percentile stays at 50% and so does the 🐱 Cat. As soon as one colleague joins, the spend rank and the delegation-share rank decide the species.');
  assert.equal(nextLine('ko', { grade: 'dragon', next: null, idle: false }), '  다음 등급: 도감에서 가장 높은 종입니다.');
  assert.equal(nextLine('ko', { grade: 'chick', next: null, idle: true }), '  다음 등급: 이 기간에 지출이 생기면 순위에 오릅니다.');
  assert.equal(nextLine('en', { next: { grade: 'wolf', pass: 0, needDlg: true }, scorePct: 0.82 }), '  Next species: 🐺 Wolf. Your percentile already clears 80%; raise the delegation share to the company median (28%).');
  assert.equal(nextLine('en', { next: { grade: 'wolf', pass: 2, needDlg: true } }), '  Next species: 🐺 Wolf. Percentile now 75%; 5 pts more (pass 2) and a delegation share at or above the company median (28%).');
  assert.equal(nextLine('en', { grade: 'chick', next: null, idle: true }), '  Next species: spend in this period puts you in the standings.');
});

test('an older server: the percentile and the distance are read off the rank, the formula with both weight sets, the guide', () => {
  const old = { grade: 'fox', tier: 'active', rank: 4, ranked: 13, crown: false, fetchedAt: 1 };
  const lines = standingGuideLines(old, { lang: 'ko', org: 'acmeco' });
  assert.deepEqual(lines.slice(0, 5), [
    '순위: acmeco 종합 점수 13명 중 4위 · 🦊 여우',
    '  앞에 3명이 있습니다. 1위에 오르면 👑 왕관을 씁니다.',
    '  종합 점수는 기간 지출 순위 62.5%와 위임 비율 순위 37.5%를 더한 값입니다. 프롬프트 수집을 켠 Enterprise 조직은 50%, 30%, 20%로 프롬프트 수 순위까지 더합니다.',
    '  지출 순위는 토큰을 더 써야 오르고 위임 비율 순위는 같은 지출에서 싼 모델에 맡기는 몫을 늘려야 오릅니다. 늑대 이상 여섯 종은 위임 비율이 회사 중앙값 이상이어야 합니다.',
    '  다음 등급: 🐆 치타. 지금 백분위 75%, 2%p 더 오르면 됩니다 (1명 앞지르기).',
  ]);
  assert.equal(lines.length, 5 + GUIDE_LINES);
  const en = standingGuideLines(old, { lang: 'en' });
  assert.equal(en[0], 'Standing: overall score #4 of 13 · 🦊 Fox');
  assert.equal(en[4], '  Next species: 🐆 Cheetah. Percentile now 75%; 2 pts more and you are there (pass 1).');
  // A species with the delegation rule keeps it while the share is unknown: #1 of 12 as a cheetah sits at 100%.
  assert.equal(standingGuideLines({ ...old, grade: 'cheetah', rank: 1, ranked: 12, crown: true }, { lang: 'ko' })[4], '  다음 등급: 🐺 늑대. 백분위는 이미 80%를 넘었고 위임 비율을 회사 중앙값 이상으로 올리면 됩니다.');
  // The top row and the idle row from the ladder alone.
  assert.equal(standingGuideLines({ ...old, grade: 'dragon', rank: 1, crown: true }, { lang: 'ko' })[4], '  다음 등급: 도감에서 가장 높은 종입니다.');
  assert.equal(standingGuideLines({ ...old, grade: 'chick' }, { lang: 'ko' })[4], '  다음 등급: 이 기간에 지출이 생기면 순위에 오릅니다.');
});

test('a ghost, or no rank: one line saying there is no rank yet, then the guide with no marker', () => {
  const ko = standingGuideLines({ grade: 'ghost', rank: null, ranked: 0, rangeFrom: '2026-10-09', rangeTo: '2026-11-07' }, { lang: 'ko', org: 'acmeco' });
  assert.equal(ko[0], '순위: acmeco 👻 유령 (2026-10-09 ~ 2026-11-07). 이 기간에 올라온 사용 기록이 없어 순위 밖입니다. 지출이 올라오면 아래 도감의 한 종이 됩니다.');
  assert.equal(ko.length, 1 + GUIDE_LINES);
  assert.ok(!ko.slice(2).join('').includes('▶'), 'no row is marked; the header keeps its legend');
  const en = standingGuideLines({ grade: 'ghost', rank: null, ranked: 0 }, { lang: 'en' });
  assert.equal(en[0], 'Standing: 👻 Ghost. No usage uploaded in this period, so no rank yet; once spend comes in you become one of the species below.');
});

test('nextGradeUp walks the ladder', () => {
  assert.equal(nextGradeUp('fox').key, 'cheetah');
  assert.equal(nextGradeUp('chick').key, 'mouse');
  assert.equal(nextGradeUp('dragon'), null);
  assert.equal(nextGradeUp('ghost'), null);
});

test('the standing line adds the rank within the team when the team is a strict part of the ranked people', () => {
  const inTeam = guided({ teamRank: 1, teamRanked: 4, teamName: 'DEV-OPS' });
  assert.equal(standingGuideLines(inTeam, { lang: 'ko', org: 'acmeco' })[0], '순위: acmeco 종합 점수 12명 중 3위 · DEV-OPS 팀 4명 중 1위 · 🦊 여우 (2026-10-09 ~ 2026-11-07)');
  assert.equal(standingGuideLines(inTeam, { lang: 'en', org: 'acmeco' })[0], 'Standing: acmeco overall score #3 of 12 · team DEV-OPS #1 of 4 · 🦊 Fox (2026-10-09 to 2026-11-07)');
  // The local team name stands in for a server that sent none; one team in the organization says it once.
  assert.equal(standingGuideLines(guided({ teamRank: 2, teamRanked: 5 }), { lang: 'ko', team: 'platform' })[0], '순위: 종합 점수 12명 중 3위 · platform 팀 5명 중 2위 · 🦊 여우 (2026-10-09 ~ 2026-11-07)');
  assert.equal(standingGuideLines(guided({ teamRank: 3, teamRanked: 12 }), { lang: 'ko', team: 'platform' })[0], '순위: 종합 점수 12명 중 3위 · 🦊 여우 (2026-10-09 ~ 2026-11-07)');
});

test('this machine line adds the rank on each axis when the server sent them', () => {
  const ranked = guided({ spendRank: 2, dlgRank: 5 });
  assert.equal(standingGuideLines(ranked, { lang: 'ko' })[4], '  이 PC: 지출 $481.20 (2/12위) · 위임 비율 31% (5/12위, 회사 중앙값 28%) · 점수 백분위 75%');
  assert.equal(standingGuideLines(ranked, { lang: 'en' })[4], '  This machine: spent $481.20 (#2/12) · delegation share 31% (#5/12, company median 28%) · score percentile 75%');
  // Without the median, or with only one axis rank, the brackets stay balanced.
  assert.equal(standingGuideLines(guided({ dlgRank: 5, medianDlg: null }), { lang: 'ko' })[4], '  이 PC: 지출 $481.20 · 위임 비율 31% (5/12위) · 점수 백분위 75%');
  assert.equal(standingGuideLines(guided({ spendRank: 2 }), { lang: 'ko' })[4], '  이 PC: 지출 $481.20 (2/12위) · 위임 비율 31% (회사 중앙값 28%) · 점수 백분위 75%');
});

// Fewer than five ranked people: the office squeezes the percentile into [0.3, 0.7], so two people are the sheep and the husky.
test('small team: the percentile read off the rank is squeezed, the server scorePct is used as it is', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(scorePctOf({ rank: 2, ranked: 2 }), 0.3);
  near(scorePctOf({ rank: 1, ranked: 2 }), 0.7);
  near(scorePctOf({ rank: 2, ranked: 4 }), squeezeSr(2 / 3, 4));
  assert.equal(scorePctOf({ rank: 1, ranked: 1 }), 0.5);
  near(scorePctOf({ rank: 5, ranked: 5 }), 0);
  assert.equal(scorePctOf({ rank: 3, ranked: 3, scorePct: 0.3 }), 0.3);
  assert.equal(SMALL_TEAM.n, 5);
});

test('small team: the bottom of two is read as the sheep, one person away from the pig, and the husky has nothing above it', () => {
  const sheep = { grade: 'sheep', tier: 'normal', rank: 2, ranked: 2, crown: false, fetchedAt: 1 };
  assert.deepEqual(nextOf(sheep), { grade: 'pig', pass: 1, needDlg: false });
  const ko = standingGuideLines(sheep, { lang: 'ko' });
  assert.equal(ko[0], '순위: 종합 점수 2명 중 2위 · 🐑 양');
  assert.equal(ko[4], '  다음 등급: 🐷 돼지. 지금 백분위 30%, 2%p 더 오르면 됩니다 (1명 앞지르기).');
  const husky = { grade: 'husky', tier: 'active', rank: 1, ranked: 2, crown: true, fetchedAt: 1 };
  assert.equal(nextOf(husky), null);
  assert.equal(standingGuideLines(husky, { lang: 'ko' })[4], '  다음 등급: 순위에 오른 사람이 5명이 되면 더 높은 등급이 열립니다. 지금은 인원이 적어 등급이 보통과 활발 사이에서만 갈립니다.');
  assert.equal(standingGuideLines(husky, { lang: 'en' })[4], '  Next species: higher species open once 5 people are ranked. With fewer, species stay between Normal and Active.');
});

test('small team: a server that sent next: null gets the same line, and four ranked people count on the squeezed span', () => {
  const srv = { grade: 'husky', tier: 'active', rank: 1, ranked: 3, crown: true, scorePct: 0.7, next: null, fetchedAt: 1 };
  const line = (st, lang) => standingGuideLines(st, { lang }).find((l) => /다음 등급|Next species/.test(l));
  assert.equal(line(srv, 'en'), '  Next species: higher species open once 5 people are ranked. With fewer, species stay between Normal and Active.');
  assert.match(line(srv, 'ko'), /^  다음 등급: 순위에 오른 사람이 5명이 되면 더 높은 등급이 열립니다\./);
  // 2nd of 4: squeezed percentile 57%, the penguin (58%) is one person up.
  assert.deepEqual(nextOf({ grade: 'raccoon', rank: 2, ranked: 4 }), { grade: 'penguin', pass: 1, needDlg: false });
  // 5 ranked people are the full ladder again: no small-team line.
  const five = { grade: 'chick', tier: 'low', rank: 5, ranked: 5, crown: false, fetchedAt: 1 };
  assert.ok(!standingGuideLines({ ...five, grade: 'fox', rank: 2 }, { lang: 'en' }).join('\n').includes('higher species open'));
  // Alone: the solo line is unchanged.
  assert.match(line({ grade: 'cat', rank: 1, ranked: 1 }, 'en'), /^ {2}Next species: alone, the percentile stays at 50%/);
});
