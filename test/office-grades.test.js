import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const { GRADES, TIERS, SMALL_TEAM, squeezeSr, gradeOf, gradeBands, gradeIndex, tierOfGrade, speciesArt, officeSceneData, W_FULL, W_NOPR } = await import('../site/assets/scene/office-scene.js');

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
      /* the team page reads the strings from office-i18n.js (shared with the member town); the ops page still carries its own copy */
      let o;
      if(f.includes('/team/')){ o = vm.runInNewContext('var window = {};\n' + readFileSync(new URL('../site/assets/scene/office-i18n.js', import.meta.url), 'utf8') + '\n;window.SPRAG_OFFICE_I18N')[lang]; }
      else {
        const line = src.split('\n').find(l => l.startsWith(`Object.assign(I18N.${lang}, {"of.g.`)); assert.ok(line, f + ' ' + lang);
        o = JSON.parse(line.replace(/^Object\.assign\(I18N\.\w+, /, '').replace(/\);\s*$/, ''));
      }
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
  /* two ghosts: the person who stopped uploading (m19) and the one with no usage in the period (m0 spent 0) */
  assert.deepEqual(d.people.filter(p => p.grade === 'ghost').map(p => p.id).sort(), ['m0', 'm19']);
  /* standings: one crown on rank 1, the leaderboard is the top five by rank */
  const crowned = d.people.filter(p => p.crown);
  assert.equal(crowned.length, 1); assert.equal(crowned[0].rank, 1);
  assert.deepEqual(d.book.top.rows.map(r => r.rk), [1, 2, 3, 4, 5].map(r => 'of.book.rank' + JSON.stringify({ r })));
  assert.ok(d.people.filter(p => p.grade === 'ghost').every(p => p.rank === 0));
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
  assert.equal(p3.detail.groups[1].rows[2][1], 'of.unknown');
  assert.equal(d.people.find(p => p.id === 'm4').detail.groups[1].rows[2][1], '4');
});

/* a small fixture: person i spends 10 * (i + 1), a share list gives each one a delegation share, runs gives the delegated runs.
   The share is savings over spend plus savings (sprag-team 20261116000400), so saved = spent * sh / (1 - sh); delegated_cost carries the same
   share for the HUD's cost figure. noShare leaves both out: no savings is a share of 0 and the HUD's cost share is unknown. costOnly keeps the cost
   and no savings, for the HUD's figures. */
function fixture(shares, { runs = null, noShare = false, spend = null, costOnly = false } = {}){
  const rows = [], usage = {};
  shares.forEach((sh, i) => {
    const id = 'm' + i, spent = spend ? spend[i] : 10 * (i + 1);
    rows.push({ member_id: id, display_name: 'P' + i, team_id: 't1', team_name: 'T', signal: 'ok' });
    usage[id] = { spent, delegated: runs ? runs[i] : i, saved: noShare || costOnly ? 0 : spent * sh / (1 - sh), ...(noShare ? {} : { delegated_cost: spent * sh }) };
  });
  const tt = (k, v) => k + (v ? JSON.stringify(v) : '');
  return officeSceneData({ rows, usage, promptRows: null, teams: [{ id: 't1', name: 'T' }], used: shares.length, limit: 30, orgName: 'O', rangeLabel: '30d', t: tt, rel: x => x, os: () => '' });
}
const tt0 = (k, v) => k + (v ? JSON.stringify(v) : '');
const byId = d => Object.fromEntries(d.people.map(p => [p.id, p]));

test('squeezeSr: untouched from five people, [0.3, 0.7] below', () => {
  assert.deepEqual(SMALL_TEAM, { n: 5, lo: 0.3, hi: 0.7 });
  for(const sr of [0, 0.25, 0.5, 1]) assert.equal(squeezeSr(sr, 5), sr);
  assert.equal(squeezeSr(0, 2), 0.3);
  assert.equal(squeezeSr(1, 4), 0.7);
  assert.equal(squeezeSr(0.5, 1), 0.5);
});

test('small team: two people are the husky and the sheep, never the chick', () => {
  const d = byId(fixture([0.5, 0.5]));
  assert.equal(d.m1.grade, 'husky'); assert.equal(d.m0.grade, 'sheep');
  assert.equal(d.m1.rank, 1); assert.equal(d.m1.crown, true); assert.equal(d.m0.crown, false);
  assert.equal(d.m0.tier, 'normal'); assert.equal(d.m1.tier, 'active');
});

test('small team: one person is the cat, three are sheep, cat and husky, four never reach power or low', () => {
  assert.equal(fixture([0.5]).people[0].grade, 'cat');
  assert.deepEqual(fixture([0.5, 0.5, 0.5]).people.map(p => p.grade).sort(), ['cat', 'husky', 'sheep']);
  const four = fixture([0.9, 0.1, 0.5, 0.3]).people;
  assert.equal(four.length, 4);
  for(const p of four) assert.ok(p.tier === 'normal' || p.tier === 'active', p.id + ' ' + p.tier);
  /* five people open the full ladder: the lowest score is the chick again */
  const five = fixture([0.5, 0.5, 0.5, 0.5, 0.5]).people;
  assert.ok(five.some(p => p.grade === 'chick'));
});

/* 20261122000100 (sprag-team): no usage in the period is a ghost outside the ranking, on the 1st of a month as on the 20th; the chick is for someone who used little */
test('no usage in the period: a ghost with the quiet tag, rank 0, left out of the ranked count', () => {
  const d = fixture([0.5, 0.5, 0.5], { spend: [0, 0.005, 20] }), q = byId(d);
  for(const k of ['m0', 'm1']){
    assert.equal(q[k].grade, 'ghost', k); assert.equal(q[k].tier, 'nodata', k); assert.equal(q[k].rank, 0, k); assert.equal(q[k].tag, 'of.tag.quiet', k);
    assert.deepEqual(q[k].bots, [], k); assert.equal(q[k].crown, false, k);
  }
  /* the one person left is ranked among one: rank 1 of 1, no crown (the crown needs two ranked people) */
  assert.equal(q.m2.rank, 1); assert.equal(q.m2.tier, 'active'); assert.equal(q.m2.crown, false); assert.deepEqual(q.m2.detail.next.slice(0, 1), ['of.d.rank{"r":1,"n":1}']);
  assert.equal(JSON.parse(d.hud.stats.slice('of.hud'.length)).n, 1); assert.equal(JSON.parse(d.hud.stats.slice('of.hud'.length)).o, 2);
  /* a person who spent a little still ranks, and with five ranked people the lowest score is the chick */
  const e = fixture([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], { spend: [0, 0.02, 20, 30, 40, 50] }), r = byId(e);
  assert.equal(r.m0.grade, 'ghost'); assert.equal(r.m0.tag, 'of.tag.quiet'); assert.equal(r.m1.grade, 'chick'); assert.equal(r.m1.rank, 5);
  assert.ok(r.m1.detail.next.length > 0);
});

test('no usage with prompts collected: a person with prompts but no spend is ranked, one with neither is quiet', () => {
  const rows = ['a', 'b', 'c'].map(id => ({ member_id: id, display_name: id.toUpperCase(), team_id: 't1', team_name: 'T', signal: 'ok' }));
  const usage = { a: { spent: 0 }, b: { spent: 0 }, c: { spent: 12, saved: 0, delegated: 0 } };
  const promptRows = [{ member_id: 'a', display_name: 'A', prompts: 4, chars: 100 }, { member_id: 'b', display_name: 'B', prompts: 0, chars: 0 }, { member_id: 'c', display_name: 'C', prompts: 2, chars: 50 }];
  const d = byId(officeSceneData({ rows, usage, promptRows, teams: [{ id: 't1', name: 'T' }], used: 3, limit: 30, orgName: 'O', rangeLabel: '30d', t: (k, v) => k + (v ? JSON.stringify(v) : ''), rel: x => x, os: () => '' }));
  assert.notEqual(d.a.grade, 'ghost'); assert.ok(d.a.rank >= 1);
  assert.equal(d.b.grade, 'ghost'); assert.equal(d.b.tag, 'of.tag.quiet'); assert.equal(d.b.rank, 0);
  assert.notEqual(d.c.grade, 'ghost');
});

test('small team: the drawer counts people on the squeezed span and says when the ladder is closed', () => {
  const d = byId(fixture([0.5, 0.5]));
  assert.equal(d.m1.detail.next[d.m1.detail.next.length - 1], 'of.d.next.small{"k":5}');
  const sheep = d.m0.detail.next[d.m0.detail.next.length - 1];
  assert.ok(sheep.startsWith('of.d.next{"x":1,"s":"of.g.pig"'), sheep);
  /* four people: ranks 4..1 sit at 0.3, 0.433, 0.567, 0.7; the 0.567 raccoon needs 0.7 for the husky */
  const q = byId(fixture([0.5, 0.5, 0.5, 0.5]));
  assert.equal(q.m2.grade, 'raccoon');
  assert.ok(q.m2.detail.next[q.m2.detail.next.length - 1].startsWith('of.d.next{"x":1,"s":"of.g.penguin"'), q.m2.detail.next.join('|'));
  assert.equal(q.m3.detail.next[q.m3.detail.next.length - 1], 'of.d.next.small{"k":5}');
});

test('small team: the field guide explains the narrowing only with two to four ranked people', () => {
  assert.equal(fixture([0.5]).book.small, '');
  assert.equal(fixture([0.5, 0.5]).book.small, 'of.book.small{"k":5}');
  assert.equal(fixture([0.5, 0.5, 0.5, 0.5]).book.small, 'of.book.small{"k":5}');
  assert.equal(fixture([0.5, 0.5, 0.5, 0.5, 0.5]).book.small, '');
});

test('one median: the drawer shows the same company median that grading uses (even number of known shares)', () => {
  const d = fixture([0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5, 0.05]);
  /* sorted shares 0.05 .. 0.9: the middle pair is 0.4 and 0.5, so the median is 45%, not the upper 50% */
  let checked = 0;
  for(const p of d.people){
    const why = p.detail.why.match(/"c":"(\d+%)"/)[1], last = p.detail.next[p.detail.next.length - 1], m = last.match(/"c":"(\d+%)"/);
    assert.equal(why, '45%');
    if(m){ assert.equal(m[1], why, p.id); checked++; }
  }
  assert.ok(checked >= 5);
  /* 70% clears the 45% median and the cheetah is not held back by the delegation rule */
  const cheetah = d.people.find(p => p.grade === 'cheetah');
  assert.ok(cheetah.detail.next[cheetah.detail.next.length - 1].startsWith('of.d.next{'), cheetah.detail.next.join('|'));
});

test('HUD: savings and the company delegation share lead the stats; unknown without a known share', () => {
  const d = fixture([0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5, 0.05], { costOnly: true });
  /* sum of dcost / sum of spent: 10 * (0.1 + 2 * 0.9 + 3 * 0.2 + ...) / 550 */
  const spent = [...Array(10)].map((_, i) => 10 * (i + 1)), sh = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5, 0.05];
  const want = Math.round(spent.reduce((a, s, i) => a + s * sh[i], 0) / spent.reduce((a, s) => a + s, 0) * 100) + '%';
  assert.match(d.hud.stats, /^of\.hud\{"s":"\$0\.00","d":"/);
  assert.equal(JSON.parse(d.hud.stats.slice('of.hud'.length)).d, want);
  assert.equal(JSON.parse(fixture([0.5, 0.5], { noShare: true }).hud.stats.slice('of.hud'.length)).d, 'of.unknown');
});

test('bots follow delegated runs only, at any tier; the legend names them', () => {
  const d = fixture([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], { runs: [20, 1, 4, 5, 19, 0], spend: [1, 2, 3, 4, 5, 600] }), q = byId(d);
  assert.equal(q.m0.tier, 'low');
  assert.deepEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5'].map(id => q[id].bots.length), [3, 1, 1, 2, 2, 0]);
  assert.equal(d.legend.find(l => l.bots).label, 'of.lg.bots');
});

test('the drawer prints no em dash placeholder', () => {
  const rows = [{ member_id: 'a', display_name: 'A', team_id: 't1', team_name: 'T', signal: 'ok' }];
  const d = officeSceneData({ rows, usage: { a: { spent: 5, delegated: 0 } }, promptRows: [{ member_id: 'a', prompts: 0, chars: 0 }], teams: [{ id: 't1', name: 'T' }], used: 1, limit: 3, orgName: 'O', rangeLabel: '30d', t: (k, v) => k + (v ? JSON.stringify(v) : ''), rel: x => x, os: () => '' });
  const cells = d.people[0].detail.grid.map(r => r[1]);
  assert.ok(!cells.includes('\u2014'));
  assert.ok(cells.includes('of.unknown'));
});

/* The delegation axis counts savings over spend plus savings from the day each machine joined (sprag-team 20261116000400, _office_standings),
   while the spend axis keeps the whole period. Same numbers as standing_smoke.sql (b18..b21) in sprag-team, so the console and the server agree. */
/* 20261121000100 (sprag-team): a person is ranked when the organization is open and one machine is ok or late; only paused-only and silent-only people are ghosts */
test('late stays ranked: a late machine keeps the species, the rank, the bots and the cosmetics; paused-only and silent-only people are ghosts', () => {
  const sigs = { L: ['late'], M: ['late', 'paused'], N: ['ok'], P: ['paused'], S: ['silent'], Q: ['paused', 'silent'] };
  const run = closed => {
    const rows = [], usage = {}, cosmetics = []; let i = 0;
    for(const [k, ss] of Object.entries(sigs)){
      i++; cosmetics.push({ member_id: k + '0', lvl: 2, gear: {}, pet: null });
      ss.forEach((sg, j) => {
        const id = k + j;
        rows.push({ member_id: id, display_name: k, team_id: 't1', team_name: 'T', signal: sg, seat_of: j ? k + '0' : null, last_upload_at: '2026-11-18T00:00:00Z' });
        usage[id] = { spent: 10 * i, saved: 5 * i, delegated: 3 * i, delegated_cost: 2 * i };
      });
    }
    const tt = (k, v) => k + (v ? JSON.stringify(v) : '');
    return byId(officeSceneData({ rows, usage, cosmetics, promptRows: null, teams: [{ id: 't1', name: 'T' }], used: 6, limit: 30, orgName: 'O', rangeLabel: '30d', closed, t: tt, rel: x => x, os: () => '' }));
  };
  const d = run(false);
  for(const k of ['L0', 'M0', 'N0']){
    const p = d[k];
    assert.notEqual(p.grade, 'ghost', k); assert.notEqual(p.tier, 'nodata', k);
    assert.ok(GRADES[gradeIndex(p.grade)], k); assert.equal(p.tier, GRADES[gradeIndex(p.grade)].tier, k);
    assert.ok(p.rank >= 1 && p.rank <= 3, k + ' rank ' + p.rank);
    assert.ok(p.bots.length > 0, k + ' bots'); assert.equal(p.tag, '', k); assert.equal(p.lvl, 2, k + ' cosmetics');
    assert.ok(p.detail.next.length > 0, k + ' drawer standings');
  }
  assert.deepEqual(['L0', 'M0', 'N0'].map(k => d[k].rank).sort(), [1, 2, 3]);
  for(const k of ['P0', 'S0', 'Q0']){
    const p = d[k];
    assert.equal(p.grade, 'ghost', k); assert.equal(p.tier, 'nodata', k); assert.equal(p.rank, 0, k); assert.deepEqual(p.bots, [], k); assert.equal(p.lvl, 0, k);
  }
  assert.equal(d.P0.tag, 'of.tag.off'); assert.equal(d.Q0.tag, 'of.tag.off'); assert.equal(d.S0.tag, 'of.tag.late');
  /* an ok, a late and a mixed seat with usage keep their animal; the same seats without usage are quiet ghosts and say so (a late-only seat keeps the late tag) */
  const quiet = byId(officeSceneData({ rows: [{ member_id: 'q', display_name: 'Q', team_id: 't1', team_name: 'T', signal: 'ok' }, { member_id: 'l', display_name: 'L', team_id: 't1', team_name: 'T', signal: 'late' },
    { member_id: 'u', display_name: 'U', team_id: 't1', team_name: 'T', signal: 'ok' }], usage: { q: { spent: 0 }, l: { spent: 0 }, u: { spent: 9 } }, promptRows: null, teams: [{ id: 't1', name: 'T' }], used: 3, limit: 30, orgName: 'O',
    rangeLabel: '30d', t: tt0, rel: x => x, os: () => '' }));
  assert.equal(quiet.q.grade, 'ghost'); assert.equal(quiet.q.tag, 'of.tag.quiet'); assert.equal(quiet.l.grade, 'ghost'); assert.equal(quiet.l.tag, 'of.tag.late'); assert.notEqual(quiet.u.grade, 'ghost');
  /* a suspended organization ranks nobody, late or not */
  for(const p of Object.values(run(true))){ assert.equal(p.grade, 'ghost', p.id); assert.equal(p.tier, 'nodata', p.id); assert.equal(p.rank, 0, p.id); }
});

test('delegation share: savings since the install, not the delegated cost, and spend keeps the pre-install days (server parity)', () => {
  const day = (d, total, saved, dc = null) => ({ day: d, spent: total, total, saved, delegated_cost: dc });
  const row = id => ({ member_id: id, display_name: id, team_id: 't1', team_name: 'T', signal: 'ok' });
  const u = (since, series) => ({ since, series, spent: series.reduce((a, q) => a + q.total, 0), saved: series.reduce((a, q) => a + q.saved, 0),
    delegated_cost: series.reduce((a, q) => a + (q.delegated_cost || 0), 0) });
  const usage = {
    A: u('2026-11-16', [day('2026-11-16', 120, 60, 40)]),
    B: u('2026-11-16', [day('2026-11-16', 60, 90, 36)]),
    /* C: $1000 uploaded for the day before joining, then $30 with $5 saved and a huge delegated cost */
    C: u('2026-11-16', [day('2026-11-15', 1000, 0), day('2026-11-16', 30, 5, 10000)]),
    D: u('2026-11-16', [day('2026-11-16', 10, 0, 0)]),
  };
  const tt = (k, v) => k + (v ? JSON.stringify(v) : '');
  const d = officeSceneData({ rows: ['A', 'B', 'C', 'D'].map(row), usage, promptRows: null, teams: [{ id: 't1', name: 'T' }], used: 4, limit: 30, orgName: 'O', rangeLabel: 'r', t: tt, rel: x => x, os: () => '' });
  const share = id => d.people.find(p => p.id === id).detail.cmp.find(c => c.label === 'of.deleg').items[0].v;
  assert.equal(d.people.find(p => p.id === 'C').spent, 1030, 'spend keeps the day before the install');
  assert.ok(Math.abs(share('C') - 5 / 35) < 1e-12, 'the share skips it and ignores the delegated cost');
  assert.ok(Math.abs(share('A') - 60 / 180) < 1e-12);
  assert.ok(Math.abs(share('B') - 0.6) < 1e-12);
  assert.equal(share('D'), 0);
});
