import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { GRADES, TIERS, gradeOf, gradeBands, gradeIndex, tierOfGrade, speciesArt, officeSceneData, W_FULL, W_NOPR } = await import('../site/assets/scene/office-scene.js');

/* the tier rule the scene used before species existed */
const legacyTier = (sr, dlg, med, idle) => (sr <= 0.25 || idle ? 'low' : sr >= 0.8 && dlg >= med ? 'power' : sr >= 0.5 ? 'active' : 'normal');

test('thirty species, six power, nine active, eight normal, seven low, unique keys', () => {
  assert.equal(GRADES.length, 30);
  assert.equal(new Set(GRADES.map(g => g.k)).size, 30);
  assert.deepEqual(TIERS.map(tr => GRADES.filter(g => g.tier === tr).length), [6, 9, 8, 7]);
  for(let i = 1; i < GRADES.length; i++) assert.ok(GRADES[i].minSr < GRADES[i - 1].minSr, GRADES[i].k);
});

test('species boundaries (dlg at the median)', () => {
  const g = sr => gradeOf(sr, 0.5, 0.5, false);
  const cases = [[1, 'dragon'], [0.98, 'dragon'], [0.9799, 'unicorn'], [0.92, 'lion'], [0.89, 'tiger'], [0.85, 'eagle'], [0.8, 'wolf'], [0.7999, 'cheetah'],
    [0.74, 'fox'], [0.5, 'cat'], [0.4999, 'dog'], [0.44, 'bear'], [0.2501, 'rabbit'], [0.25, 'duck'], [0.22, 'duck'], [0.04, 'mouse'], [0.0399, 'chick'], [0, 'chick']];
  for(const [sr, k] of cases) assert.equal(g(sr), k, 'sr ' + sr);
});

test('delegation below the median drops a top scorer to the first active row; no spend is always a chick', () => {
  assert.equal(gradeOf(0.99, 0.2, 0.5, false), 'cheetah');
  assert.equal(gradeOf(0.85, 0.2, 0.5, false), 'cheetah');
  assert.equal(gradeOf(0.99, 0.5, 0.5, false), 'dragon');
  assert.equal(gradeOf(0.9, 0.9, 0.5, false), 'tiger');
  assert.equal(gradeOf(0.95, 0.9, 0.5, true), 'chick');
});

test('tier derived from the species equals the old tier rule over a grid', () => {
  for(let i = 0; i <= 1000; i++) for(const dlg of [0, 0.4, 0.5, 0.9]) for(const idle of [false, true]) {
    const sr = i / 1000, k = gradeOf(sr, dlg, 0.5, idle);
    assert.equal(tierOfGrade(k), legacyTier(sr, dlg, 0.5, idle), `sr ${sr} dlg ${dlg} idle ${idle}`);
  }
  assert.equal(tierOfGrade('ghost'), 'nodata');
});

test('field guide bands come from the GRADES table', () => {
  const bands = gradeBands(), b = Object.fromEntries(bands.map(x => [x.k, x]));
  assert.deepEqual(bands.map(x => x.k), GRADES.map(x => x.k));
  assert.deepEqual(bands.map(x => x.no), GRADES.map((_, i) => i + 1));
  assert.deepEqual([b.dragon.a, b.dragon.b, b.dragon.rk], [0, 2, 'top.d']);
  assert.deepEqual([b.unicorn.a, b.unicorn.b, b.unicorn.rk], [2, 5, 'band.d']);
  assert.deepEqual([b.cheetah.a, b.cheetah.b, b.cheetah.d, b.cheetah.rk], [20, 23, 20, 'fall']);
  assert.deepEqual([b.cat.a, b.cat.b, b.cat.rk], [46, 50, 'band']);
  assert.deepEqual([b.rabbit.a, b.rabbit.b], [71, 75]);
  assert.deepEqual([b.chick.c, b.chick.rk], [4, 'last']);
  for(let i = 1; i < bands.length; i++) assert.equal(bands[i].a, bands[i - 1].b, 'contiguous at ' + bands[i].k);
  assert.equal(W_FULL.reduce((a, c) => a + c, 0), 1);
  assert.equal(W_NOPR.reduce((a, c) => a + c, 0), 1);
});

test('every species has finite 3D parts, paw colour and an SVG icon', () => {
  for(const g of GRADES){
    const a = speciesArt(g.k); assert.ok(a, g.k);
    assert.match(a.icon, /^<svg [^>]*>.*<\/svg>$/s, g.k);
    assert.match(a.arm || '', /^#[0-9a-f]{6}$/i, g.k + ' arm');
    const parts = a.parts(); assert.ok(parts.length >= 6, g.k);
    for(const p of parts){
      assert.ok(p.g === 'sph' || p.g === 'cone', g.k);
      assert.match(p.c, /^#[0-9a-f]{6}$/i, g.k);
      for(const v of [...p.p, ...p.s, p.r]) assert.ok(Number.isFinite(v), g.k);
    }
  }
});

/* the species names and range texts are copied into two pages; both copies must name every species in both languages */
test('team and ops pages carry the species names and range texts in en and ko', () => {
  const rks = [...new Set(gradeBands().map(b => b.rk))].concat('ghost');
  for(const f of ['site/team/index.html', 'site/ops/index.html']){
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for(const lang of ['en', 'ko']){
      const line = src.split('\n').find(l => l.startsWith(`Object.assign(I18N.${lang}, {"of.g.`)); assert.ok(line, f + ' ' + lang);
      const o = JSON.parse(line.replace(/^Object\.assign\(I18N\.\w+, /, '').replace(/\);\s*$/, ''));
      for(const g of GRADES.concat({ k: 'ghost' })) assert.ok(o['of.g.' + g.k], `${f} ${lang} of.g.${g.k}`);
      for(const rk of rks) assert.ok(o['of.gr.' + rk], `${f} ${lang} of.gr.${rk}`);
      for(const k of ['of.lg.strip', 'of.lg.bots', 'of.lg.ghost', 'of.g.no', 'of.book.found', 'of.book.tier', 'of.book.top', 'of.book.rank', 'of.lg.crown', 'of.d.rank', 'of.d.rankk', 'of.d.crown', 'of.d.top', 'of.d.next', 'of.d.next.d', 'of.d.next.xd', 'of.d.next.idle'])
        assert.ok(o[k], `${f} ${lang} ${k}`);
    }
  }
});

/* end to end: the data mapper hands out species, standings and a guide whose counts add up */
test('officeSceneData assigns grades, standings, book rows and day/today groups', () => {
  const rows = [], usage = {};
  for(let i = 0; i < 20; i++){
    const id = 'm' + i; rows.push({ member_id: id, display_name: 'P' + i, team_id: 't1', team_name: 'T', signal: i === 19 ? 'silent' : 'ok' });
    usage[id] = { spent: i * 3, saved: i * (i % 3), delegated: i, spent_today: 1, saved_today: 2, delegated_today: i === 3 ? undefined : 4, errors: 0 };
  }
  const tt = (k, v) => k + (v ? JSON.stringify(v) : '');
  const d = officeSceneData({ rows, usage, promptRows: null, teams: [{ id: 't1', name: 'T' }], used: 20, limit: 30, orgName: 'O', rangeLabel: '30d', t: tt, money: x => '$' + x, rel: x => x, os: () => '' });
  for(const p of d.people) assert.equal(p.tier, p.grade === 'ghost' ? 'nodata' : GRADES[gradeIndex(p.grade)].tier, p.id);
  assert.equal(d.book.rows.length, 31);
  assert.equal(d.book.rows.reduce((a, r) => a + r.n, 0), d.people.length);
  assert.equal(d.people.filter(p => p.grade === 'ghost').length, 1);
  /* standings: one crown on rank 1, the leaderboard is the top five by rank */
  const crowned = d.people.filter(p => p.crown);
  assert.equal(crowned.length, 1); assert.equal(crowned[0].rank, 1);
  assert.deepEqual(d.book.top.rows.map(r => r.rk), [1, 2, 3, 4, 5].map(r => 'of.book.rank' + JSON.stringify({ r })));
  assert.equal(d.people.find(p => p.grade === 'ghost').rank, 0);
  /* the legend strip lists all thirty species by tier, with counts that match the guide; the keys explain the crown, the ghost and the robots */
  assert.deepEqual(d.strip.tiers.map(g => g.tier), TIERS);
  assert.deepEqual(d.strip.tiers.flatMap(g => g.items.map(q => q.k)), GRADES.map(g => g.k));
  assert.equal(d.strip.tiers.flatMap(g => g.items).reduce((a, q) => a + q.n, 0), d.people.filter(p => p.grade !== 'ghost').length);
  assert.deepEqual(d.legend.map(l => l.k || (l.bots ? 'bots' : l.label)), ['crown', 'ghost', 'bots', 'of.lg.screen']);
  /* the drawer names the next species up, or says it is the top one */
  for(const p of d.people.filter(q => q.rank)){
    const nx = p.detail.next; assert.ok(nx[0].startsWith('of.d.rank'), p.id);
    const gi = gradeIndex(p.grade), last = nx[nx.length - 1];
    if(gi === 0) assert.equal(last, 'of.d.top');
    else if(last !== 'of.d.next.idle') assert.ok(last.includes('"s":"of.g.' + GRADES[gi - 1].k + '"'), p.id + ' ' + last);
  }
  const p3 = d.people.find(p => p.id === 'm3');
  assert.equal(p3.detail.groups.length, 2);
  assert.equal(p3.detail.groups[1].rows[2][1], '—');
  assert.equal(d.people.find(p => p.id === 'm4').detail.groups[1].rows[2][1], '4');
});
