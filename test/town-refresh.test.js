/**
 * The member town refreshes itself: site/town/index.html asks town_view again every minute and calls ctl.update(), and office-scene.js repaints in place
 * (soft) when the new data has the same sceneKey as the room it built, so the animals, the pets' places and the fur do not flicker. sceneKey is tested
 * directly; the wiring in the scene and the page is pinned on the source, like the neighbouring scene tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { sceneKey } = await import('../site/assets/scene/office-scene.js');
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCENE = read('../site/assets/scene/office-scene.js'), TOWN = read('../site/town/index.html');

const person = (id, extra) => ({ id, name: id, self: false, os: 'macOS', teamId: 't1', teamName: 'Apps', tier: 'active', grade: 'fox', gradeText: 'Fox', gradeLabel: 'No.01 Fox', crown: false, tag: '', lvl: 2,
  gear: { head: 'cap', back: null, desk: null }, pet: { kind: 'dog', name: 'Bori' }, rank: 3, spent: 10, promptId: null, tip: [['Team', 'Apps']], detail: { grid: [['Spent', '$10']] }, tierText: 'Active', bots: ['sonnet'], bubbles: [{ text: 'a', ai: true }], ...extra });
const data = extra => ({ ui: { close: 'Close' }, teams: [{ id: 't1', name: 'Apps' }], people: [person('a'), person('b')], free: 2, freeLabel: '2 free', more: 0, moreLabel: '', closed: false,
  server: { label: 'Server' }, activity: 0.4, book: { title: 'Guide' }, hud: { title: 'Org town', stats: '2 active', closed: 'Suspended' }, legend: [{ label: 'x' }], strip: { title: 's', tiers: [] }, aria: 'a', shop: { level: 2, spent: 1 }, ...extra });

test('sceneKey: data that differs only in text and figures keeps the same key', () => {
  const a = data(), b = data({
    ui: { close: 'Schließen' }, book: { title: 'Other' }, hud: { title: 'Org town 11.1-11.16', stats: '5 active', closed: 'Suspended' }, legend: [], strip: null, aria: 'b', shop: { level: 3, spent: 99 },
    people: [person('a', { rank: 1, spent: 500, promptId: 'p1', tip: [['Team', 'Apps'], ['Rank', '1']], detail: { grid: [] }, gradeLabel: 'x', tierText: 'y', bubbles: [{ text: 'other words', ai: false }] }), person('b')] });
  assert.equal(sceneKey(a), sceneKey(b));
});

test('sceneKey: a structural change gives another key', () => {
  const base = sceneKey(data());
  const changed = {
    tier: p => ({ ...p, tier: 'power' }), grade: p => ({ ...p, grade: 'tiger' }), crown: p => ({ ...p, crown: true }), gear: p => ({ ...p, gear: { head: 'tophat', back: null, desk: null } }),
    pet: p => ({ ...p, pet: { kind: 'cat', name: 'Bori' } }), os: p => ({ ...p, os: 'Windows' }), teamId: p => ({ ...p, teamId: 't2' }), lvl: p => ({ ...p, lvl: 5 }), tag: p => ({ ...p, tag: 'late' }), bots: p => ({ ...p, bots: [] }),
  };
  Object.entries(changed).forEach(([name, f]) => assert.notEqual(sceneKey(data({ people: [f(person('a')), person('b')] })), base, name + ' rebuilds the room'));
  assert.notEqual(sceneKey(data({ people: [person('a')] })), base, 'one person fewer');
  assert.notEqual(sceneKey(data({ people: [person('a'), person('b'), person('c')] })), base, 'one person more');
  assert.notEqual(sceneKey(data({ closed: true })), base, 'a suspended office');
  assert.notEqual(sceneKey(data({ book: null })), base, 'no field guide any more');
  assert.notEqual(sceneKey(data({ free: 3 })), base, 'free seats');
  assert.notEqual(sceneKey(data({ teams: [{ id: 't1', name: 'Other' }] })), base, 'team name');
  assert.notEqual(sceneKey(data({ hud: { title: 'Org town', stats: '2 active', closed: 'Gesperrt' } })), base, 'the suspended sign text is built into the room');
  assert.notEqual(sceneKey(data({ people: [person('a', { bubbles: [] }), person('b')] })), base, 'whether a person has bubbles at all');
});

test('sceneKey: a pet photo counts by its length and both ends, not by the whole data URL', () => {
  const url = 'data:image/jpeg;base64,' + 'A'.repeat(5000), withPhoto = ph => data({ people: [person('a', { pet: { kind: 'dog', photo: ph } }), person('b')] });
  const k = sceneKey(withPhoto(url));
  assert.ok(k.length < 1500, 'the key stays small: ' + k.length);
  assert.equal(sceneKey(withPhoto(url)), k);
  assert.notEqual(sceneKey(withPhoto(url + 'B')), k, 'another length');
  assert.notEqual(sceneKey(withPhoto(url.slice(0, -1) + 'B')), k, 'another tail');
  assert.notEqual(sceneKey(withPhoto('data:image/jpeg;base64,B' + 'A'.repeat(4999))), k, 'another head');
});

test('sceneKey: empty and partial data do not throw', () => {
  assert.equal(typeof sceneKey({}), 'string');
  assert.equal(typeof sceneKey(null), 'string');
  assert.equal(typeof sceneKey({ people: [{ id: 'x' }] }), 'string');
});

test('build() reads no soft field: the room is made without the text and figures sceneKey leaves out', () => {
  const a = SCENE.indexOf('  function build(d){'), b = SCENE.indexOf('  function soft(d){');
  assert.ok(a > 0 && b > a);
  const body = SCENE.slice(a, b);
  assert.ok(!/\.(detail|tip|spent|rank|gradeLabel|tierText|promptId)\b/.test(body), 'a per-person soft field is read while building');
  assert.ok(!/\bd\.(legend|strip|aria|shop|ui)\b/.test(body), 'a top-level soft field is read while building');
  assert.deepEqual(body.match(/\bd\.book\b/g), ['d.book'], 'book is read once, only to repaint or close an open field guide (its presence is in the key)');
  assert.deepEqual(body.match(/\bd\.hud\.\w+/g), ['d.hud.closed'], 'only the suspended sign text comes from hud');
  assert.match(body, /paintChrome\(d\);/, 'the chrome is painted through the shared function');
  assert.match(body, /builtKey = keyOf\(d\);/, 'the key of what was built is remembered');
});

test('update(): the same key repaints through soft() and anything else rebuilds', () => {
  assert.match(SCENE, /update\(d\)\{ cur = d; if\(started !== true\) return; if\(builtKey !== null && keyOf\(d\) === builtKey\) soft\(d\); else build\(d\); \}/);
  assert.match(SCENE, /const keyOf = d => sceneKey\(d\) \+ \(holidayOn\(\) \? '\|xmas' : ''\)/, 'the year-end dressing is part of the key');
  const a = SCENE.indexOf('  function soft(d){');
  assert.ok(a > 0);
  const body = SCENE.slice(a, SCENE.indexOf('\n  }\n', a));
  assert.ok(!/\bclear\(\)|\bbuild\(cur\)|renderer\.shadowMap/.test(body), 'soft clears nothing and leaves the shadow map alone');
  assert.match(body, /byId\.get\(o\.p\.id\)/, 'people are matched by id');
  assert.match(body, /next\.some\(q => !q\)\)\{ build\(d\); return; \}/, 'an unmatched person falls back to a rebuild');
  assert.match(body, /o\.p = next\[i\]/, 'each person takes the new data');
  assert.match(body, /paintChrome\(d\)/);
  assert.match(body, /if\(!shop\)\{/, 'an open shop keeps its draft: the drawer is not repainted');
  assert.match(body, /if\(sel\) rerender\(\)/, 'the open drawer repaints through rerender (scroll and focus kept), no flight of the camera');
  assert.match(body, /renderBook\(\)/, 'the field guide repaints in place');
  assert.match(body, /pcFill\(sel\)/, 'the profile card repaints its text without a new model');
  assert.ok(!/\bportrait\(/.test(body), 'the card model is not rebuilt');
  assert.match(body, /request\(\)/);
});

test('page: refresh every REFRESH_MS = 60000 while visible, with the skips the design names', () => {
  assert.match(TOWN, /const REFRESH_MS = 60000\b/);
  const a = TOWN.indexOf('async function refresh()');
  assert.ok(a > 0);
  const body = TOWN.slice(a, TOWN.indexOf('\ndocument.addEventListener(\'visibilitychange\'', a));
  assert.match(body, /if\(DEMO \|\| !view \|\| busy \|\| failed \|\| !ctl \|\| document\.hidden \|\| saving \|\| inflight\) return;/);
  assert.match(body, /if\(!tok \|\| !TOKEN_RE\.test\(tok\)\) return stopRefresh\(\)/, 'no usable token: stop');
  assert.match(body, /fetchTown\(tok, period\)/, 'the same period (a custom range is read by periodRange)');
  assert.match(body, /view = r\.body;[\s\S]*paintHead\(\); ctl\.update\(sceneData\(\)\); shown = lang;/);
  assert.match(body, /r\.status === 401 \|\| r\.status === 403 \|\| \(r\.status >= 400 && r\.status < 500 && r\.body && r\.body\.code === '28000'\)/, 'the same expiry test as changePeriod');
  assert.match(body, /stopRefresh\(\); stale = true; \$\('h-err'\)\.textContent = t\('pg\.stale'\); \$\('h-err'\)\.hidden = false;/);
  assert.ok(!/showMsg|ssSet\(TOKEN_KEY|ctl\.destroy|view = null/.test(body), 'an expired link leaves the page as it is');
  /* a network failure or a 5xx falls through: nothing is shown */
  const tail = body.slice(body.indexOf('r.status === 401'));
  assert.ok(!/pg\.pnet|pg\.net/.test(tail));
  assert.match(TOWN, /function startRefresh\(\)\{ if\(!refreshTm && !DEMO\) refreshTm = setInterval\(refresh, REFRESH_MS\); \}/, 'one timer only');
  assert.equal((TOWN.match(/setInterval\(refresh/g) || []).length, 1);
  assert.match(TOWN, /shown = lang; startRefresh\(\);/, 'the timer starts when the scene is first mounted');
  assert.match(TOWN, /document\.addEventListener\('visibilitychange', \(\) => \{ if\(!document\.hidden && !stale && Date\.now\(\) - lastOk >= REFRESH_GAP\) refresh\(\); \}\);/);
  assert.match(TOWN, /REFRESH_GAP = 15000/);
});

test('page: a save in flight is tracked by the saving flag, set before and cleared after', () => {
  assert.match(TOWN, /let saving = false;/);
  assert.match(TOWN, /async function saveCosmetics\(change, extra\)\{\s*saving = true;\s*try\{ return await saveCosmeticsNow\(change, extra\); \}finally\{ saving = false; \}\s*\}/);
  assert.match(TOWN, /ctl\.update\(sceneData\(\)\)/, 'applyCosmetics and changePeriod still update through the same call');
});

test('page: pg.stale exists in en and ko, ends like a sentence and names the command of pg.invalid', () => {
  const cmd = 'sprag team town';
  assert.match(TOWN, /'pg\.stale': 'This link has expired/);
  assert.match(TOWN, /'pg\.stale': '링크가 만료되어 타운 갱신을 멈췄습니다/);
  const en = /'pg\.stale': '([^']+)'/.exec(TOWN.slice(0, TOWN.indexOf('  ko: {')))[1], ko = /'pg\.stale': '([^']+)'/.exec(TOWN.slice(TOWN.indexOf('  ko: {')))[1];
  assert.ok(en.includes(cmd) && ko.includes(cmd), 'the command to run is in both texts');
  assert.ok(/\.$/.test(en) && /십시오\.$/.test(ko), 'both end as sentences');
  assert.ok(!/[·—]|,\s/.test(ko), 'no middle dot, em dash or comma in the Korean line');
});

test('page: the language switch keeps the expiry text on the error line', () => {
  assert.match(TOWN, /\$\('h-err'\)\.textContent = t\(stale \? 'pg\.stale' : 'pg\.pnet'\)/);
});
