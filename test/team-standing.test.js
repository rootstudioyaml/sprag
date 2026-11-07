/**
 * `sprag team status` standing block (src/team-standing.js): the rank, what the
 * overall score is made of, whether moving up takes more tokens or a larger
 * delegated share, the caller's own figures and the next species up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { standingGuideLines } from '../src/team-standing.js';

const guided = (extra = {}) => ({
  grade: 'fox', tier: 'active', rank: 3, ranked: 12, crown: false, fetchedAt: 1,
  dlg: 0.31, medianDlg: 0.28, scorePct: 0.75, spent: 481.2, idle: false, hasPrompts: false,
  weights: [0.625, 0.375, 0], next: { grade: 'cheetah', pass: 2, needDlg: false },
  rangeFrom: '2026-10-09', rangeTo: '2026-11-07',
  ...extra,
});

test('nothing on record: no lines', () => {
  assert.deepEqual(standingGuideLines(null), []);
  assert.deepEqual(standingGuideLines(undefined), []);
  assert.deepEqual(standingGuideLines({}), []);
});

test('the full block in Korean: rank, formula, how to move, own figures, next species', () => {
  const lines = standingGuideLines(guided(), { lang: 'ko', org: 'amazon' });
  assert.deepEqual(lines, [
    '순위: amazon 종합 점수 12명 중 3위 · 🦊 여우 (2026-10-09 ~ 2026-11-07)',
    '  종합 점수는 기간 지출 순위 63%와 위임 비율 순위 38%를 더한 값입니다.',
    '  지출 순위는 토큰을 더 써야 오르고 위임 비율 순위는 같은 지출에서 싼 모델에 맡기는 몫을 늘려야 오릅니다. 늑대 이상 여섯 종은 위임 비율이 회사 중앙값 이상이어야 합니다.',
    '  이 컴퓨터: 지출 $481.20 · 위임 비율 31% (회사 중앙값 28%) · 점수 백분위 75%',
    '  다음 등급: 2명을 더 앞지르면 🐆 치타',
  ]);
});

test('the full block in English', () => {
  const lines = standingGuideLines(guided(), { lang: 'en', org: 'amazon' });
  assert.equal(lines[0], 'Standing: amazon overall score #3 of 12 · 🦊 Fox (2026-10-09 to 2026-11-07)');
  assert.equal(lines[1], '  The overall score adds the spend rank (63%) and the delegation-share rank (38%).');
  assert.match(lines[2], /^  The spend rank rises with more tokens; the delegation rank rises by handing a larger share of the same spend to cheaper models\. The six species from Wolf up also need a delegation share at or above the company median\.$/);
  assert.equal(lines[3], '  This machine: spent $481.20 · delegation share 31% (company median 28%) · score percentile 75%');
  assert.equal(lines[4], '  Next species: pass 2 more to become 🐆 Cheetah');
});

test('the prompt-count rank joins the formula where prompt capture is on', () => {
  const lines = standingGuideLines(guided({ weights: [0.5, 0.3, 0.2], hasPrompts: true }), { lang: 'ko' });
  assert.equal(lines[1], '  종합 점수는 기간 지출 순위 50%, 위임 비율 순위 30%와 프롬프트 수 순위 20%를 더한 값입니다.');
  const en = standingGuideLines(guided({ weights: [0.5, 0.3, 0.2], hasPrompts: true }), { lang: 'en' });
  assert.equal(en[1], '  The overall score adds the spend rank (50%), the delegation-share rank (30%) and the prompt-count rank (20%).');
});

test('the next species: the delegation rule alone, people and the rule, and the top row', () => {
  const ko = (extra) => standingGuideLines(guided(extra), { lang: 'ko' }).at(-1);
  assert.equal(ko({ next: { grade: 'wolf', pass: 0, needDlg: true } }), '  다음 등급: 위임 비율을 회사 중앙값(28%) 이상으로 올리면 🐺 늑대');
  assert.equal(ko({ next: { grade: 'wolf', pass: 2, needDlg: true } }), '  다음 등급: 2명을 더 앞지르고 위임 비율이 회사 중앙값(28%) 이상이면 🐺 늑대');
  // A percentile already past the floor still has one person to pass, as the office drawer says.
  assert.equal(ko({ next: { grade: 'cheetah', pass: 0, needDlg: false } }), '  다음 등급: 1명을 더 앞지르면 🐆 치타');
  assert.equal(ko({ next: null, idle: false }), '  다음 등급: 도감에서 가장 높은 종입니다.');
  assert.equal(ko({ next: null, idle: true }), '  다음 등급: 이 기간에 지출이 생기면 순위에 오릅니다.');
  const en = (extra) => standingGuideLines(guided(extra), { lang: 'en' }).at(-1);
  assert.equal(en({ next: { grade: 'wolf', pass: 0, needDlg: true } }), '  Next species: raise the delegation share to the company median (28%) to become 🐺 Wolf');
  assert.equal(en({ next: { grade: 'wolf', pass: 2, needDlg: true } }), '  Next species: pass 2 more and reach the company median delegation share (28%) to become 🐺 Wolf');
  assert.equal(en({ next: null, idle: true }), '  Next species: spend in this period puts you in the standings.');
});

test('an older server: the formula with both weight sets, and where the rest will come from', () => {
  const old = { grade: 'fox', tier: 'active', rank: 3, ranked: 12, crown: false, fetchedAt: 1 };
  const lines = standingGuideLines(old, { lang: 'ko', org: 'amazon' });
  assert.deepEqual(lines, [
    '순위: amazon 종합 점수 12명 중 3위 · 🦊 여우',
    '  종합 점수는 기간 지출 순위 62.5%와 위임 비율 순위 37.5%를 더한 값입니다. 프롬프트 수집을 켠 Enterprise 조직은 50%, 30%, 20%로 프롬프트 수 순위까지 더합니다.',
    '  지출 순위는 토큰을 더 써야 오르고 위임 비율 순위는 같은 지출에서 싼 모델에 맡기는 몫을 늘려야 오릅니다. 늑대 이상 여섯 종은 위임 비율이 회사 중앙값 이상이어야 합니다.',
    '  이 컴퓨터의 수치와 다음 등급까지의 거리는 팀 서버가 갱신되면 나옵니다.',
  ]);
  const en = standingGuideLines(old, { lang: 'en' });
  assert.equal(en[0], 'Standing: overall score #3 of 12 · 🦊 Fox');
  assert.equal(en.at(-1), '  Your own figures and the distance to the next species appear once the team server is updated.');
});

test('a ghost, or no rank: one line saying there is no rank yet', () => {
  assert.deepEqual(standingGuideLines({ grade: 'ghost', rank: null, ranked: 0, rangeFrom: '2026-10-09', rangeTo: '2026-11-07' }, { lang: 'ko', org: 'amazon' }),
    ['순위: amazon 👻 유령 (2026-10-09 ~ 2026-11-07). 이 기간에 올라온 사용 기록이 없어 순위 밖입니다.']);
  assert.deepEqual(standingGuideLines({ grade: 'ghost', rank: null, ranked: 0 }, { lang: 'en' }),
    ['Standing: 👻 Ghost. No usage uploaded in this period, so no rank yet.']);
});
