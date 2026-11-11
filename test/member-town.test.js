/**
 * The member town: memberTownData (site/assets/scene/office-scene.js) turns the town_view reply into scene data.
 * The server already cuts other people's figures; these tests pin that the front end adds none of its own and that the
 * strings the scene reads exist on both pages (office-i18n.js is shared by /team/ and /town/).
 *
 * What counts as "a figure" for another person: any '$', any number other than 0 in the entry (rank and spend are 0), any digit in the
 * tip rows or the drawer text. The species number in a label ("No.07") is the species' place in the field guide, so it is allowed;
 * so is a digit inside a team name, which is a name. The fixture's team names carry no digits to keep the digit check strict.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const { memberTownData, officeSceneData, GRADES, gradeBands } = await import('../site/assets/scene/office-scene.js');
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCENE = read('../site/assets/scene/office-scene.js');
const I18N_SRC = read('../site/assets/scene/office-i18n.js');
const TEAM = read('../site/team/index.html');
const TOWN = read('../site/town/index.html');
const OFFICE = vm.runInNewContext('var window = {};\n' + I18N_SRC + '\n;window.SPRAG_OFFICE_I18N');

const tOf = lang => (k, vars) => { let s = OFFICE[lang][k] ?? OFFICE.en[k] ?? k; if(vars) for(const key in vars) s = s.split('{' + key + '}').join(String(vars[key])); return s; };
const rel = x => 'rel:' + x;
const osOf = r => r.os || '';

const DAY = '2026-11-05', NOW = '2026-11-11T09:00:00Z';
function machine(id, name, extra = {}){
  return { member_id: id, display_name: name, os: 'darwin', os_version: '14', arch: 'arm64', sprag_version: '3.120.0', signal: 'ok', switch: 'on', last_upload_at: NOW, last_seen: NOW, sync_state_at: NOW, ...extra };
}
function town(extra = {}){
  const people = [
    { id: 'a', name: 'Mina', os: 'darwin', team_id: 't1', team_name: 'Apps', grade: 'fox', tier: 'active', crown: false, state: 'ok', self: true },
    { id: 'b', name: 'Jun', os: 'win32', team_id: 't1', team_name: 'Apps', grade: 'dragon', tier: 'power', crown: true, state: 'ok', self: false },
    { id: 'c', name: 'Sora', os: 'linux', team_id: 't2', team_name: 'Data', grade: 'bear', tier: 'normal', crown: false, state: 'ok', self: false },
    { id: 'd', name: 'Hana', os: null, team_id: 't2', team_name: 'Data', grade: 'ghost', tier: 'nodata', crown: false, state: 'late', self: false },
    { id: 'e', name: 'Doyun', os: 'darwin', team_id: 't2', team_name: 'Data', grade: 'chick', tier: 'low', crown: false, state: 'paused', self: false },
  ];
  return {
    org: { name: 'Northwind', closed: false, seats_used: 5, seat_limit: 8 }, range: { from: '2026-10-13', to: '2026-11-11' }, has_prompts: true, expires_at: '2026-11-11T21:00:00Z',
    teams: [{ id: 't1', name: 'Apps' }, { id: 't2', name: 'Data' }], people,
    self: {
      id: 'a',
      standing: { grade: 'fox', tier: 'active', rank: 3, ranked: 4, crown: false, dlg: 0.31, median_dlg: 0.4, score_pct: 0.5, spent: 123.45, idle: false, has_prompts: true,
        next: { grade: 'tiger', pass: 1, need_dlg: true }, team_rank: 2, team_ranked: 2, team_name: 'Apps', spend_rank: 2, dlg_rank: 3, prompt_rank: 3, range_from: '2026-10-13', range_to: '2026-11-11' },
      machines: [machine('a', 'Mina Mac'), machine('a2', 'Mina PC', { os: 'win32', os_version: '11', arch: 'x64', last_upload_at: '2026-11-10T09:00:00Z' })],
      usage: [
        { member_id: 'a', spent: 100, total_spent: 100, saved: 20, delegated: 12, errors: 1, spent_today: 4, saved_today: 1, delegated_today: 2, total_spent_today: 4, families: { haiku: 5, sonnet: 5, opus: 2 }, models: { sonnet: 60, opus: 40 },
          delegated_cost: 30, series: [{ day: DAY, spent: 100, total: 100, saved: 20 }] },
        { member_id: 'a2', spent: 23.45, total_spent: 23.45, saved: 2, delegated: 1, errors: 0, delegated_cost: 5, series: [{ day: DAY, spent: 23.45, total: 23.45, saved: 2 }] },
      ],
      prompts: { prompts: 40, chars: 4000, last_prompt_at: NOW, by_day: [{ day: DAY, prompts: 40 }] },
    },
    ...extra,
  };
}
const run = (v, lang = 'en') => memberTownData(v, { t: tOf(lang), rel, os: osOf });
/** every number in a value, depth first */
function numbers(x, out = []){
  if(typeof x === 'number') out.push(x);
  else if(Array.isArray(x)) x.forEach(y => numbers(y, out));
  else if(x && typeof x === 'object') Object.values(x).forEach(y => numbers(y, out));
  return out;
}
const strings = x => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : []);
const noSpecies = s => s.replace(/No\.\d+/g, '');

test('every person of the reply is drawn once and only the viewer is marked as self', () => {
  const d = run(town());
  assert.deepEqual(d.people.map(p => p.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(d.people.filter(p => p.self).map(p => p.id), ['a']);
  assert.deepEqual(d.people.map(p => [p.teamId, p.grade, p.tier, p.crown]), [['t1', 'fox', 'active', false], ['t1', 'dragon', 'power', true], ['t2', 'bear', 'normal', false], ['t2', 'ghost', 'nodata', false], ['t2', 'chick', 'low', false]]);
  assert.deepEqual(d.teams, [{ id: 't1', name: 'Apps' }, { id: 't2', name: 'Data' }]);
});

test('other people are characters only: no figure of any kind', () => {
  for(const lang of ['en', 'ko']){
    const d = run(town(), lang);
    for(const p of d.people.filter(q => !q.self)){
      const j = JSON.stringify(p);
      assert.ok(!j.includes('$'), `${lang} ${p.id}: a dollar sign`);
      assert.ok(numbers(p).every(n => n === 0), `${lang} ${p.id}: a number other than 0 in ${JSON.stringify(numbers(p))}`);
      assert.equal(p.rank, 0); assert.equal(p.spent, 0); assert.equal(p.promptId, null);
      assert.equal(p.tip.length, 2, 'the team and the state, nothing else');
      assert.equal(p.tip[0][1], p.teamName);
      for(const s of strings(p.tip)) assert.ok(!/\d/.test(s), `${lang} ${p.id}: digit in tip "${s}"`);
      assert.ok(!/\d/.test(noSpecies(p.gradeLabel)), `${lang} ${p.id}: digit in gradeLabel "${p.gradeLabel}"`);
      const dt = p.detail;
      for(const k of ['grid', 'groups', 'cmp', 'days', 'spent', 'saved', 'pdays', 'pvals', 'machines', 'events', 'next']) assert.deepEqual(dt[k], [], `${p.id}: detail.${k}`);
      assert.equal(dt.fam, null); assert.equal(dt.models, null); assert.equal(dt.canPrompts, false); assert.equal(dt.redacted, true); assert.equal(dt.why, '');
      for(const s of strings(dt)) assert.ok(!/\d/.test(s), `${lang} ${p.id}: digit in detail "${s}"`);
      assert.deepEqual(p.bots, []); assert.deepEqual(p.bubbles, []);
    }
  }
});

test('a ghost and a paused person show their state, a person with data does not hint at a figure', () => {
  const d = run(town()), by = id => d.people.find(p => p.id === id);
  assert.match(by('d').tag, /Late/);
  assert.match(by('e').tip[1][1], /Paused/);
  assert.match(by('b').tip[1][1], /OK/);
  assert.equal(by('b').tag, '');
  assert.match(by('b').gradeLabel, /^No\.01 Dragon/);
  assert.match(by('d').gradeLabel, /Ghost/);
});

test('the viewer gets the full drawer with the server standing, not a one-person ranking', () => {
  const d = run(town()), me = d.people.find(p => p.self);
  assert.equal(me.grade, 'fox'); assert.equal(me.tier, 'active'); assert.equal(me.rank, 3); assert.equal(me.crown, false);
  assert.match(me.gradeLabel, /Fox/); assert.match(me.gradeText, /Fox/);
  assert.match(me.name, /^Mina \(you\)$/);
  assert.equal(me.detail.redacted, false);
  const j = JSON.stringify(me.detail);
  assert.ok(j.includes('"$123"'), 'their total spend is in the drawer (the scene rounds from $100 up)');
  assert.equal(me.detail.machines.length, 2, 'both machines, merged into one person');
  assert.deepEqual(me.detail.cmp, [], 'no team or company medians');
  assert.match(me.detail.next[0], /Overall #3 of 4/);
  assert.match(me.detail.next[1], /Pass 1 more and reach the company median delegation \(40%\) to become Tiger/);
  assert.match(me.detail.why, /Top 33% spend/);
  assert.deepEqual(me.tip.filter(r => r[0] === 'Rank').map(r => r[1]), ['#3 / 4']);
  assert.ok(me.tip.some(r => r[1] === '$123'));
  assert.ok(me.detail.pdays.length > 0, 'prompt days present when the reply has prompts');
});

test('the standing lines follow the drawer wording: crown, top species, idle and the small-team note', () => {
  const v = town();
  v.people[0] = { ...v.people[0], grade: 'dragon', tier: 'power', crown: true };
  v.self.standing = { ...v.self.standing, grade: 'dragon', tier: 'power', rank: 1, crown: true, next: null };
  let me = run(v).people.find(p => p.self);
  assert.deepEqual(me.detail.next, ['Overall #1 of 4', '#1 in the company this period', 'Top species in the field guide']);
  assert.equal(me.crown, true);
  v.self.standing = { ...v.self.standing, idle: true };
  me = run(v).people.find(p => p.self);
  assert.match(me.detail.next[me.detail.next.length - 1], /standings/);
  const w = town(); w.self.standing = { ...w.self.standing, next: null };
  me = run(w).people.find(p => p.self);
  assert.match(me.detail.next[1], /Higher species open once 5 people are ranked/);
});

test('the viewer as a ghost, a suspended organization, a missing self and a self without machines all build', () => {
  const g = town(); g.people[0] = { ...g.people[0], grade: 'ghost', tier: 'nodata', state: 'paused' }; g.self.standing = { grade: 'ghost', tier: 'nodata', rank: null, ranked: 4 }; g.self.machines = [machine('a', 'Mina Mac', { signal: 'paused' })];
  let me = run(g).people.find(p => p.self);
  assert.equal(me.tier, 'nodata'); assert.equal(me.rank, 0); assert.deepEqual(me.detail.next, []);
  const c = town(); c.org.closed = true;
  const dc = run(c); assert.equal(dc.closed, true); assert.ok(dc.people.every(p => p.tier === 'nodata' && !p.crown)); assert.equal(dc.book, null);
  const n = town(); n.self = null;
  assert.equal(run(n).people.length, 5);
  const m = town(); m.self.machines = []; m.self.usage = []; m.self.prompts = null;
  me = run(m).people.find(p => p.self);
  assert.ok(me, 'still a person'); assert.equal(me.detail.redacted, false);
  const k = run(town(), 'ko'); assert.match(k.hud.stats, /사용 중/); assert.match(k.people[0].gradeLabel, /여우/);
});

test('HUD, legend, strip, field guide, server label and aria text carry no money', () => {
  const v = town(); v.org.seats_used = 5;
  for(const lang of ['en', 'ko']){
    const d = run(v, lang);
    for(const [name, part] of [['hud', d.hud], ['server', d.server], ['legend', d.legend], ['strip', d.strip], ['book', d.book], ['aria', d.aria], ['freeLabel', d.freeLabel], ['moreLabel', d.moreLabel]]) assert.ok(!JSON.stringify(part).includes('$'), `${lang} ${name}`);
    assert.equal(d.server.label, lang === 'en' ? 'Sprag server' : 'Sprag 서버');
    assert.ok(!/saved|절감|work share|작업 비중/i.test(d.hud.stats), 'no savings or delegation share in the HUD: ' + d.hud.stats);
    assert.deepEqual(d.book.top.rows.map(r => r.id), ['a'], 'the field guide lists only the viewer');
    assert.equal(d.book.rows.length, GRADES.length + 1);
    assert.equal(d.free, 3);
  }
});

test('office-scene.js keeps the admin behaviour by default and cuts every admin action under readOnly', () => {
  assert.match(SCENE, /onAction: a => \{ if\(!sel \|\| opts\.readOnly\) return;/);
  assert.match(SCENE, /\(opts\.readOnly \? '' : `<div class="ft">/, 'no Seats or Prompts buttons');
  assert.match(SCENE, /!opts\.readOnly && opts\.onServer/);
  assert.match(SCENE, /if\(h\.team\)\{ if\(!opts\.readOnly && opts\.onTeam\)/);
  assert.match(SCENE, /if\(dt\.redacted\)/);
  // the admin data mapper is unchanged by the town: same output for an admin fixture with the standing path untouched
  const o = officeSceneData({ rows: [machine('x', 'X', { team_id: 't', team_name: 'T' })], usage: { x: { spent: 5, saved: 1, delegated: 0 } }, promptRows: null, teams: [{ id: 't', name: 'T' }], used: 1, limit: 2, orgName: 'O', rangeLabel: 'r', closed: false, t: tOf('en'), rel, os: osOf, events: [], demoBubbles: null });
  assert.match(o.server.label, /\$5\.00/);
});

test('the scene reads only strings that office-i18n.js has, in both languages', () => {
  assert.deepEqual(Object.keys(OFFICE.en).sort(), Object.keys(OFFICE.ko).sort(), 'en and ko hold the same keys');
  const have = new Set(Object.keys(OFFICE.en));
  const need = new Set([...SCENE.matchAll(/'((?:of|sr|pu)\.[A-Za-z0-9_.]*[A-Za-z0-9_])'/g)].map(m => m[1]));
  for(const k of ['never']) need.add(k);
  assert.ok(need.size > 60, 'found the keys the scene reads: ' + need.size);
  const missing = [...need].filter(k => !have.has(k) && !/^(of\.(g|tier|gr|ev|d\.next|tag)|sr\.(s|sw))$/.test(k));
  assert.deepEqual(missing, []);
  // keys built at run time
  const dyn = [];
  for(const g of GRADES.map(x => x.k).concat('ghost')) dyn.push('of.g.' + g);
  for(const tr of ['power', 'active', 'normal', 'low', 'nodata']) dyn.push('of.tier.' + tr);
  for(const b of gradeBands()) dyn.push('of.gr.' + b.rk);
  for(const s of ['ok', 'late', 'paused', 'silent']) dyn.push('sr.s.' + s);
  for(const s of ['on', 'off']) dyn.push('sr.sw.' + s);
  for(const e of ['joined', 'paused', 'resumed', 'left', 'removed', 'restored']) dyn.push('of.ev.' + e);
  for(const e of ['of.tag.off', 'of.tag.late', 'of.tag.closed', 'of.d.next', 'of.d.next.d', 'of.d.next.xd', 'of.d.next.small', 'of.d.next.idle', 'of.d.top', 'of.d.crown', 'of.d.rank']) dyn.push(e);
  assert.deepEqual(dyn.filter(k => !have.has(k)), []);
});

test('the team page loads office-i18n.js and no longer carries the strings itself', () => {
  assert.match(TEAM, /<script src="\/assets\/scene\/office-i18n\.js\?v=[^"]+"><\/script>/);
  assert.ok(TEAM.indexOf('office-i18n.js') < TEAM.indexOf('const I18N = {'), 'loaded before the table is built');
  assert.match(TEAM, /Object\.assign\(I18N\.en, window\.SPRAG_OFFICE_I18N\.en\); Object\.assign\(I18N\.ko, window\.SPRAG_OFFICE_I18N\.ko\);/);
  assert.ok(!/["']of\.g\.dragon["']\s*:/.test(TEAM), 'of.* strings live in office-i18n.js only');
  assert.ok(!/["'](never|pu\.chars|sr\.s\.ok|sr\.sw\.on)["']\s*:/.test(TEAM));
  // with the merge, every key the scene reads resolves on the team page in both languages
  const lines = TEAM.split('\n'), s = lines.findIndex(l => l.startsWith('const I18N = {')), e = lines.findIndex(l => l.startsWith("let lang = 'en';"));
  const page = vm.runInNewContext('var window = {};\n' + I18N_SRC + '\n' + lines.slice(s, e).join('\n') + '\n;I18N');
  for(const lg of ['en', 'ko']) for(const k of Object.keys(OFFICE[lg])) assert.equal(page[lg][k], OFFICE[lg][k], `${lg} ${k} on the team page`);
});

test('the town page is standalone, noindex, keeps the token out of the address bar and shows no admin shell', () => {
  assert.match(TOWN, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.match(TOWN, /<script src="\/assets\/scene\/office-i18n\.js\?v=[^"]+"><\/script>/);
  assert.match(TOWN, /memberTownData/);
  assert.match(TOWN, /readOnly: true/);
  assert.match(TOWN, /sessionStorage/); assert.match(TOWN, /history\.replaceState/);
  assert.match(TOWN, /p_token/); assert.match(TOWN, /\/rest\/v1\/rpc\/town_view/);
  assert.ok(!/admin-ux\.js|supabase-js|org_prompt_usage|team_member_usage/.test(TOWN), 'no admin scripts or admin RPCs');
  assert.match(read('../site/robots.txt'), /^Disallow: \/town\/$/m);
  assert.ok(!read('../site/sitemap.xml').includes('/town'), 'not in the sitemap');
});

test('opaque server ids: the viewer keeps the id of the people list, not a machine member id', () => {
  /* town_view sends _town_pid() hashes for people[].id and self.id; machines and usage still carry raw member ids */
  const v = town();
  const pid = 'pid-0f3a';
  v.people = v.people.map(p => (p.self ? { ...p, id: pid } : { ...p, id: 'pid-' + p.id }));
  v.self = { ...v.self, id: pid };
  const d = run(v);
  const me = d.people.filter(p => p.self);
  assert.equal(me.length, 1);
  assert.equal(me[0].id, pid, 'selectPerson(self.id) on the page must find the viewer');
  assert.ok(me[0].detail.grid.length > 0, 'the viewer still gets their own figures');
  assert.ok(JSON.stringify(me[0].detail).includes('$'), 'own spend is shown');
  assert.ok(!d.people.some(p => p.id === 'a' || p.id === 'a2'), 'no raw machine id becomes a person id');
});
