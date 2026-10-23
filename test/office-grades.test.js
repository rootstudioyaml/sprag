import { test } from 'node:test';
import assert from 'node:assert/strict';

const { GRADES, gradeOf, gradeBands, tierOfGrade, officeSceneData, W_FULL, W_NOPR } = await import('../site/assets/scene/office-scene.js');

/* the tier rule the scene used before species existed */
const legacyTier = (sr, dlg, med, idle) => (sr <= 0.25 || idle ? 'low' : sr >= 0.8 && dlg >= med ? 'power' : sr >= 0.5 ? 'active' : 'normal');

test('species boundaries (dlg at the median)', () => {
  const g = sr => gradeOf(sr, 0.5, 0.5, false);
  const cases = [[1, 'lion'], [0.9, 'lion'], [0.8999, 'tiger'], [0.8, 'tiger'], [0.7999, 'fox'], [0.65, 'fox'], [0.6499, 'penguin'], [0.5, 'penguin'],
    [0.4999, 'bear'], [0.35, 'bear'], [0.3499, 'rabbit'], [0.2501, 'rabbit'], [0.25, 'chick'], [0, 'chick']];
  for(const [sr, k] of cases) assert.equal(g(sr), k, 'sr ' + sr);
});

test('delegation below the median drops a top scorer to the fox row; no spend is always a chick', () => {
  assert.equal(gradeOf(0.95, 0.2, 0.5, false), 'fox');
  assert.equal(gradeOf(0.85, 0.2, 0.5, false), 'fox');
  assert.equal(gradeOf(0.95, 0.5, 0.5, false), 'lion');
  assert.equal(gradeOf(0.85, 0.9, 0.5, false), 'tiger');
  assert.equal(gradeOf(0.95, 0.9, 0.5, true), 'chick');
});

test('tier derived from the species equals the old tier rule over a grid', () => {
  for(let i = 0; i <= 100; i++) for(const dlg of [0, 0.4, 0.5, 0.9]) for(const idle of [false, true]) {
    const sr = i / 100, k = gradeOf(sr, dlg, 0.5, idle);
    assert.equal(tierOfGrade(k), legacyTier(sr, dlg, 0.5, idle), `sr ${sr} dlg ${dlg} idle ${idle}`);
  }
  assert.equal(tierOfGrade('ghost'), 'nodata');
});

test('field guide bands come from the GRADES table', () => {
  const b = Object.fromEntries(gradeBands().map(x => [x.k, x]));
  assert.deepEqual(gradeBands().map(x => x.k), GRADES.map(x => x.k));
  assert.deepEqual([b.lion.a, b.lion.b], [0, 10]);
  assert.deepEqual([b.tiger.a, b.tiger.b], [10, 20]);
  assert.deepEqual([b.fox.a, b.fox.b, b.fox.d], [20, 35, 20]);
  assert.deepEqual([b.penguin.a, b.penguin.b], [35, 50]);
  assert.deepEqual([b.bear.a, b.bear.b], [50, 65]);
  assert.deepEqual([b.rabbit.a, b.rabbit.b], [65, 75]);
  assert.equal(b.chick.c, 25);
  assert.equal(W_FULL.reduce((a, c) => a + c, 0), 1);
  assert.equal(W_NOPR.reduce((a, c) => a + c, 0), 1);
});

/* end to end: the data mapper hands out species and a guide whose counts add up */
test('officeSceneData assigns grades, book rows and day/today groups', () => {
  const rows = [], usage = {};
  for(let i = 0; i < 20; i++){
    const id = 'm' + i; rows.push({ member_id: id, display_name: 'P' + i, team_id: 't1', team_name: 'T', signal: i === 19 ? 'silent' : 'ok' });
    usage[id] = { spent: i * 3, saved: i * (i % 3), delegated: i, spent_today: 1, saved_today: 2, delegated_today: i === 3 ? undefined : 4, errors: 0 };
  }
  const tt = (k, v) => k + (v ? JSON.stringify(v) : '');
  const d = officeSceneData({ rows, usage, promptRows: null, teams: [{ id: 't1', name: 'T' }], used: 20, limit: 30, orgName: 'O', rangeLabel: '30d', t: tt, money: x => '$' + x, rel: x => x, os: () => '' });
  const tierOf = { lion: 'power', tiger: 'power', fox: 'active', penguin: 'active', bear: 'normal', rabbit: 'normal', chick: 'low', ghost: 'nodata' };
  for(const p of d.people) assert.equal(p.tier, tierOf[p.grade], p.id);
  assert.equal(d.book.rows.length, 8);
  assert.equal(d.book.rows.reduce((a, r) => a + r.n, 0), d.people.length);
  assert.equal(d.people.filter(p => p.grade === 'ghost').length, 1);
  const p3 = d.people.find(p => p.id === 'm3');
  assert.equal(p3.detail.groups.length, 2);
  assert.equal(p3.detail.groups[1].rows[2][1], '—');
  assert.equal(d.people.find(p => p.id === 'm4').detail.groups[1].rows[2][1], '4');
});
