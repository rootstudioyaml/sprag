import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { officeSceneData, usageTotal, GRADES, speciesArt, castLoader, castCrown, CAST_URL, iconSvg } = await import('../site/assets/scene/office-scene.js');
const { townSceneData, townDetailData, townOfficeData, townTeamRows, pctInt, pctRate } = await import('../site/assets/scene/town-scene.js');

const OPS = readFileSync(new URL('../site/ops/index.html', import.meta.url), 'utf8');
/* the town's strings as the ops page ships them: every one-line Object.assign(I18N.<lang>, {...}) that parses as JSON */
function strings(lang){
  const out = {};
  for(const l of OPS.split('\n')){
    if(!l.startsWith(`Object.assign(I18N.${lang}, {"`)) continue;
    try{ Object.assign(out, JSON.parse(l.replace(/^Object\.assign\(I18N\.\w+, /, '').replace(/\);\s*$/, ''))); }catch(e){ /* a line that is not plain JSON holds no town string */ }
  }
  return out;
}
const tOf = lang => { const S = strings(lang), EN = strings('en'); return (k, vars) => { let s = S[k] ?? EN[k] ?? k; if(vars) for(const key in vars) s = s.split('{' + key + '}').join(vars[key]); return s; }; };
const stub = (k, v) => k + (v ? JSON.stringify(v) : '');
const money = n => '$' + (Number(n) || 0).toFixed(2);

/* twenty people in two teams: person i spends 10 * (i + 1); every fourth has a second machine merged into the seat, odd ones go through a gateway,
   person 5 sent no delegation cost, person 19 stopped uploading */
function company(){
  const rows = [], usage = {}, promptRows = [];
  for(let i = 0; i < 20; i++){
    const id = 'm' + i, team = i % 3 === 0 ? 't2' : 't1', spent = 10 * (i + 1), gw = i % 2 === 1 ? 'hash' + i : null;
    rows.push({ member_id: id, display_name: 'P' + i, team_id: team, team_name: team === 't1' ? 'Apps' : 'Data', signal: i === 19 ? 'silent' : 'ok' });
    usage[id] = { spent, total_spent: gw ? spent * 1.5 : spent, gateway_spent: gw ? spent * 1.5 : null, gateway_user_hash: gw, saved: spent * 0.2, delegated: i,
      ...(i === 5 ? {} : { delegated_cost: spent * (0.05 + (i % 7) * 0.1) }),
      series: [{ day: '2026-11-01', spent, total: gw ? spent * 1.5 : spent, gateway: gw ? spent * 1.5 : null, saved: spent * 0.2 }] };
    promptRows.push({ member_id: id, display_name: 'P' + i, prompts: (i * 7) % 11, chars: 100 * i });
    if(i % 4 === 0){   /* a second machine on the same seat, same gateway hash when there is one: its gateway figure must not count twice */
      const id2 = id + 'b';
      rows.push({ member_id: id2, display_name: 'P' + i + ' laptop', team_id: team, team_name: team === 't1' ? 'Apps' : 'Data', signal: 'ok', seat_of: id });
      usage[id2] = { spent: 3, total_spent: 3, saved: 1, delegated: 1, delegated_cost: 0.3, series: [{ day: '2026-11-01', spent: 3, total: 3, gateway: null, saved: 1 }] };
    }
  }
  /* a machine removed during the period: no person any more, but its spend still belongs to its team */
  rows.push({ member_id: 'gone', display_name: 'Old box', team_id: 't2', team_name: 'Data', signal: 'removed' });
  usage.gone = { spent: 7, total_spent: 7, saved: 2, delegated: 0, delegated_cost: 1, series: [{ day: '2026-11-01', spent: 7, total: 7, gateway: null, saved: 2 }] };
  const teams = [{ id: 't1', name: 'Apps', members_active: 13 }, { id: 't2', name: 'Data', members_active: 7 }];
  const org = { id: 'o1', name: 'Northwind', plan: 'enterprise', status: 'active', seats_used: 20, seat_limit: 30 };
  return { rows, usage, promptRows, teams, org };
}
/* what the ops page's SceneHost hands the office scene for the open organization */
const officeArgs = (c, promptRows) => ({ rows: c.rows, usage: c.usage, promptRows, teams: c.teams, used: c.org.seats_used, limit: c.org.seat_limit, orgName: c.org.name, rangeLabel: '30d',
  closed: c.org.status === 'suspended', t: stub, rel: x => x, os: () => '', events: [], demoBubbles: null });
const townArgs = (c, promptRows) => ({ rows: c.rows, summary: { teams: c.teams }, usage: c.usage, promptRows, teams: c.teams, org: c.org, rangeLabel: '30d', os: () => '', t: stub, money, rel: x => x });

test('town and office give every person the same species, tier, rank and crown', () => {
  const c = company();
  for(const pr of [c.promptRows, null]){   /* with prompt collection (enterprise) and without (pro) */
    const office = officeSceneData(officeArgs(c, pr)), town = townDetailData(townArgs(c, pr));
    assert.equal(town.people.length, office.people.length);
    assert.equal(town.people.length, 20);
    for(const p of office.people){
      const q = town.people.find(x => x.id === p.id); assert.ok(q, p.id);
      assert.deepEqual([q.grade, q.tier, q.rank, q.crown, q.teamId], [p.grade, p.tier, p.rank, p.crown, p.teamId], p.id);
    }
    assert.ok(new Set(town.people.map(p => p.grade)).size >= 8, 'the fixture spreads over several species');
    assert.equal(town.people.filter(p => p.grade === 'ghost').length, 1);
  }
  /* the prompt weight changes the ranking, so the test would notice a town that dropped promptRows */
  const a = townDetailData(townArgs(c, c.promptRows)).people, b = townDetailData(townArgs(c, null)).people;
  assert.ok(a.some(p => p.grade !== b.find(x => x.id === p.id).grade));
});

test('townOfficeData mirrors the office arguments, also for a suspended company', () => {
  const c = company(); c.org.status = 'suspended';
  const office = officeSceneData(officeArgs(c, c.promptRows)), town = townOfficeData({ ...townArgs(c, c.promptRows) });
  assert.equal(town.closed, true);
  assert.deepEqual(town.people.map(p => [p.id, p.grade, p.tier]), office.people.map(p => [p.id, p.grade, p.tier]));
  const d = townDetailData(townArgs(c, c.promptRows));
  assert.equal(d.cast.length, 0, 'no models stand in front of a suspended company');
  assert.equal(d.zoo.ghosts, 20);
});

test('cast: the top twelve by rank, the crown first, every species has a model key and an icon', () => {
  const d = townDetailData(townArgs(company(), null));
  assert.equal(d.cast.length, 12);
  assert.equal(d.cast[0].rank, 1); assert.equal(d.cast[0].crown, true);
  for(let i = 1; i < d.cast.length; i++) assert.ok(d.cast[i].rank >= d.cast[i - 1].rank);
  const worstShown = d.cast[d.cast.length - 1].rank;
  for(const p of d.people.filter(x => x.rank > 0 && !d.cast.includes(x))) assert.ok(p.rank >= worstShown, p.id);
  for(const p of d.cast){ assert.ok(GRADES.some(g => g.k === p.grade), p.grade); assert.match(speciesArt(p.grade).icon, /^<svg /); }
  assert.equal(d.zoo.crowns.length, 1); assert.equal(d.zoo.crowns[0].name, d.cast[0].name);
});

test('zoo: tier rows add up to the ranked people, ghosts are counted apart', () => {
  const d = townDetailData(townArgs(company(), null));
  const ranked = d.people.filter(p => p.grade !== 'ghost').length;
  assert.equal(d.zoo.tiers.reduce((a, g) => a + g.n, 0), ranked);
  for(const g of d.zoo.tiers){ assert.equal(g.items.reduce((a, q) => a + q.n, 0), g.n); for(const q of g.items) assert.equal(d.people.filter(p => p.grade === q.k).length, q.n, q.k); }
  assert.equal(d.zoo.ghosts, 1);
});

test('team rows: people by host team, spend through usageTotal (a gateway hash counts once), savings rate and delegation share', () => {
  const c = company(), teams = townTeamRows({ rows: c.rows, usage: c.usage, teams: c.teams }), by = Object.fromEntries(teams.map(x => [x.id, x]));
  assert.deepEqual(teams.map(x => x.id), ['t1', 't2']);
  assert.equal(by.t1.people + by.t2.people, 20);
  assert.equal(by.t1.active + by.t2.active, 19);   /* m19 is silent */
  for(const tm of teams){
    const machines = c.rows.filter(r => r.team_id === tm.id).map(r => c.usage[r.member_id]);   /* the removed machine included */
    assert.equal(tm.spent, usageTotal(machines).total, tm.id);
    assert.equal(tm.saved, machines.reduce((a, u) => a + u.saved, 0));
    assert.equal(tm.rate, tm.saved / tm.spent);
    assert.equal(tm.util, tm.active / tm.people);
    assert.ok(tm.dlg > 0 && tm.dlg < 1);
  }
  /* the company total is the same number the office scene prints on its server kiosk */
  assert.equal(by.t1.spent + by.t2.spent, usageTotal(Object.values(c.usage)).total);

  /* two machines of one person behind one gateway: the day's gateway figure counts once, not once per machine */
  const rows = [{ member_id: 'a', team_id: 't', team_name: 'T', signal: 'ok' }, { member_id: 'b', team_id: 't', team_name: 'T', signal: 'ok', seat_of: 'a' }];
  const u = { gateway_user_hash: 'h', saved: 5, series: [{ day: 'd1', spent: 10, total: 40, gateway: 40, saved: 5 }] };
  const [one] = townTeamRows({ rows, usage: { a: u, b: u }, teams: [{ id: 't', name: 'T' }] });
  assert.equal(one.spent, 40); assert.equal(one.people, 1); assert.equal(one.active, 1); assert.equal(one.saved, 10); assert.equal(one.rate, 0.25);
  assert.equal(one.dlg, null, 'no machine sent a delegation cost: unknown');

  /* a team without machines keeps its row; a machine without a team gets its own */
  const loose = townTeamRows({ rows: [{ member_id: 'x', signal: 'ok' }], usage: { x: { spent: 2, saved: 1 } }, teams: [{ id: 't9', name: 'Empty' }] });
  assert.deepEqual(loose.map(x => [x.id, x.people, x.spent, x.rate]), [['t9', 0, 0, null], [null, 1, 2, 0.5]]);
});

test('drawer texts for teams: whole percent, one decimal, unknown delegation', () => {
  const c = company(); delete c.usage.m5.delegated_cost;
  const d = townDetailData(townArgs(c, null));
  for(const tm of d.teamUse){
    assert.equal(tm.utilText, pctInt(tm.active / tm.people));
    assert.equal(tm.rateText, (tm.saved / tm.spent * 100).toFixed(1) + '%');
    assert.match(tm.dlgText, /^\d+%$/);
    assert.equal(tm.head, 'tn.d.act' + JSON.stringify({ a: tm.active, n: tm.people }));
  }
  const none = townDetailData({ ...townArgs(c, null), usage: Object.fromEntries(Object.entries(c.usage).map(([k, u]) => [k, { spent: u.spent, saved: 0 }])) });
  for(const tm of none.teamUse) assert.equal(tm.dlgText, 'of.unknown');
});

const ORGS = [
  { id: 'a', name: 'A', plan: 'enterprise', status: 'active', seat_limit: 50, seats_used: 26, total_spent: 1000, spent: 800, saved: 125, delegated_cost: 250 },
  { id: 'b', name: 'B', plan: 'pro', status: 'active', seat_limit: 12, seats_used: 9, spent: 200, saved: 50 },
  { id: 'c', name: 'C', plan: 'pro', status: 'active', seat_limit: 8, seats_used: 0, spent: 0, saved: 0, delegated_cost: 0 },
  { id: 'z', name: 'Z', plan: 'pro', status: 'suspended', seat_limit: 5, seats_used: 3, spent: 0, saved: 0 }
];
const townOf = (t, orgs = ORGS) => townSceneData({ orgs, attention: {}, rangeLabel: '30d', t, money, revenue: g => (g.status === 'suspended' ? 0 : g.seat_limit * 10), rel: x => x });

test('townSceneData: utilisation, savings rate and delegation share per company', () => {
  const d = townOf(stub), by = Object.fromEntries(d.companies.map(c => [c.id, c]));
  assert.equal(by.a.util, 0.52); assert.equal(by.a.rate, 0.125); assert.equal(by.a.dlg, 0.25);   /* over total_spent, not the local spend */
  assert.equal(by.b.rate, 0.25); assert.equal(by.b.dlg, null);   /* no delegated_cost: unknown */
  assert.equal(by.c.rate, null); assert.equal(by.c.dlg, null);   /* no spend */
  const row = (c, k) => c.detail.rows.find(r => r[0] === k)[1];
  assert.deepEqual([row(by.a, 'tn.k.util'), row(by.a, 'tn.k.rate'), row(by.a, 'of.deleg')], ['52%', '12.5%', '25%']);
  assert.deepEqual([row(by.b, 'tn.k.util'), row(by.b, 'tn.k.rate'), row(by.b, 'of.deleg')], ['75%', '25.0%', 'of.unknown']);
  assert.deepEqual([row(by.c, 'tn.k.util'), row(by.c, 'tn.k.rate')], ['0%', '-']);
  assert.equal(pctRate(null), '-'); assert.equal(pctRate(0.5), '50.0%');
});

test('signboard gauges: two bars with text and a 0..1 fill, none for a suspended company', () => {
  const d = townOf(stub), by = Object.fromEntries(d.companies.map(c => [c.id, c]));
  assert.deepEqual(by.a.sign.gauges.map(g => [g.text, g.v, g.color]), [['tn.util{"v":"52%"}', 0.52, '#7c6cf0'], ['tn.rate{"v":"12.5%"}', 0.125, '#2f9e6f']]);
  assert.deepEqual(by.c.sign.gauges.map(g => [g.text, g.v]), [['tn.util{"v":"0%"}', 0], ['tn.rate{"v":"-"}', 0]]);
  assert.equal(by.z.sign.gauges, null);
  /* a rate above 100% fills the bar and no more */
  const over = townOf(stub, [{ id: 'o', name: 'O', plan: 'pro', status: 'active', seat_limit: 2, seats_used: 5, spent: 10, saved: 30 }]).companies[0];
  assert.deepEqual(over.sign.gauges.map(g => g.v), [1, 1]);
  assert.equal(over.sign.gauges[1].text, 'tn.rate{"v":"300.0%"}');
});

test('HUD: town-wide utilisation and savings rate in both languages, also with revenue hidden', () => {
  for(const lang of ['en', 'ko']){
    const d = townOf(tOf(lang));
    /* seats 38 / 75 = 51%, savings 175 / 1200 = 14.6% */
    assert.ok(d.hud.stats.includes('51%'), lang + ' ' + d.hud.stats);
    assert.ok(d.hud.stats.includes('14.6%'), lang + ' ' + d.hud.stats);
    assert.ok(d.hud.stats.includes('38 / 75'), lang);
    assert.ok(d.hud.stats.includes('$700.00'), lang + ' revenue');
    assert.ok(!d.hud.stats.includes('{'), lang + ' no placeholder left: ' + d.hud.stats);
    assert.ok(!d.hud.statsNoRev.includes('$700.00'), lang);
    assert.ok(!/\u0001/.test(d.hud.statsNoRev), lang);
    assert.ok(d.hud.statsNoRev.includes('51%') && d.hud.statsNoRev.includes('14.6%') && d.hud.statsNoRev.includes('38 / 75'), lang + ' ' + d.hud.statsNoRev);
    assert.equal(d.hud.statsNoRev.split(' · ').length, d.hud.stats.split(' · ').length - 1, lang + ': only the revenue item is dropped');
    assert.ok(d.legend.some(l => l.c === '#2f9e6f' && l.label && !l.label.startsWith('tn.')), lang + ' legend explains the flag');
  }
  assert.equal(townOf(stub, []).util, null);
  assert.match(townOf(tOf('en'), [{ id: 'q', name: 'Q', plan: 'pro', status: 'active', seat_limit: 0, seats_used: 0 }]).hud.stats, /utilisation - *$/);
});

test('ops page: the town strings exist in en and ko', () => {
  for(const lang of ['en', 'ko']){
    const S = strings(lang);
    for(const k of ['tn.util', 'tn.rate', 'tn.k.util', 'tn.k.rate', 'tn.lg.flag', 'tn.d.zoo', 'tn.d.zoo.none', 'tn.d.teamuse', 'tn.d.act', 'of.deleg', 'of.unknown', 'of.g.ghost', 'of.lg.crown']) assert.ok(S[k], lang + ' ' + k);
    for(const v of ['{up}', '{sr}', '{r}', '{u}', '{l}', '{s}']) assert.ok(S['tn.hud'].includes(v), lang + ' tn.hud ' + v);
    assert.ok(S['tn.util'].includes('{v}') && S['tn.rate'].includes('{v}'), lang);
  }
});

/* the town's loadDetail and the office's SceneHost must feed the mapper the same things, or the two screens drift apart */
test('ops page: the town loads prompts like the office scene does and passes them on', () => {
  const town = OPS.slice(OPS.indexOf('const TownHost'), OPS.indexOf('const SceneHost')), office = OPS.slice(OPS.indexOf('const SceneHost'));
  const call = "rpc('org_prompt_usage', { p_org_id: X, p_days: 30, ...Range.args() })";
  assert.ok(town.includes(call.replace('X', 'id')), 'town calls org_prompt_usage');
  assert.ok(office.includes(call.replace('X', 'sel.id')), 'office calls org_prompt_usage with the same arguments');
  assert.ok(/plan === 'enterprise' \? rpc\('org_prompt_usage'/.test(town) && office.includes("if(sel.plan !== 'enterprise') return null;"), 'both ask only for enterprise');
  assert.match(town, /townDetailData\(\{[^}]*\bpromptRows\b[^}]*\bteams: \(summary && summary\.teams\) \|\| \[\][^}]*\borg\b[^}]*rangeLabel: Range\.label\(\)[^}]*os: osLabel/);
});

test('office-scene exports what the town reuses', () => {
  assert.equal(typeof castLoader, 'function'); assert.equal(typeof castCrown, 'function'); assert.equal(typeof usageTotal, 'function');
  assert.match(CAST_URL, /\/site\/assets\/scene\/cast\/$/);
  assert.match(iconSvg('ghost'), /^<svg /); assert.match(iconSvg('crown'), /^<svg /); assert.equal(iconSvg('lion'), speciesArt('lion').icon);
});
