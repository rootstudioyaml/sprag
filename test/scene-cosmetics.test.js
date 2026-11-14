/**
 * Cosmetics in the office scene (site/assets/scene/office-scene.js): unlock levels, head and desk gear (gear.js), the shop on the member page and
 * pets that play only from the toys level. The pure helpers are tested directly; the scene and page wiring is pinned on the source, like the
 * neighbouring scene tests. Server shapes: town_view people[].lvl/gear/pet and self.unlock, org_cosmetics rows, town_cosmetics_set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const S = await import('../site/assets/scene/office-scene.js');
const { headDress, cosmeticsOf, gearOf, lvOf, unlockNext, shopTiles, shopUi, SHOP_KEYS, officeSceneData, HOL_HAT_SKIP } = S;
const { GEAR_ITEMS } = await import('../site/assets/scene/gear.js');
const { PET_KINDS, PET_PATTERNS, PET_EARS, PET_TAILS, PET_SIZES } = await import('../site/assets/scene/pets.js');
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCENE = read('../site/assets/scene/office-scene.js'), TOWN = read('../site/town/index.html'), TEAM = read('../site/team/index.html'), OPS = read('../site/ops/index.html');
const TOWNSCENE = read('../site/assets/scene/town-scene.js');
const OFFICE = vm.runInNewContext('var window = {};\n' + read('../site/assets/scene/office-i18n.js') + '\n;window.SPRAG_OFFICE_I18N');

test('headDress: the crown wins over head gear, and in the season a head gear replaces the Santa hat or the antlers while the nose stays', () => {
  assert.deepEqual(headDress({ crown: true, head: 'cap', xmas: false }), { crown: true, head: null, hol: null }, 'a crowned person shows the crown, not the gear');
  assert.deepEqual(headDress({ crown: true, head: 'cap', xmas: true }), { crown: true, head: null, hol: 'nose' });
  assert.deepEqual(headDress({ head: 'cap', xmas: false }), { crown: false, head: 'cap', hol: null });
  assert.deepEqual(headDress({ head: 'cap', xmas: true, species: 'fox', coin: 0.1 }), { crown: false, head: 'cap', hol: 'nose' }, 'gear replaces the Santa hat');
  assert.deepEqual(headDress({ head: 'cap', xmas: true, species: 'panda', coin: 0.9 }), { crown: false, head: 'cap', hol: 'nose' }, 'gear replaces the antlers');
  assert.equal(headDress({ xmas: true, species: 'fox', coin: 0.1 }).hol, 'santa');
  assert.equal(headDress({ xmas: true, species: 'fox', coin: 0.9 }).hol, 'rudolph');
  assert.equal(headDress({ xmas: true, species: [...HOL_HAT_SKIP][0], coin: 0.1 }).hol, 'rudolph', 'species with a hat of their own take the Rudolph set');
  assert.deepEqual(headDress({ head: 'cap', skip: true, xmas: true, species: 'fox', coin: 0.1 }), { crown: false, head: null, hol: 'santa' }, 'a piece the fit skips is not drawn and the season piece stays');
  assert.deepEqual(headDress({ ghost: true, crown: true, head: 'cap', xmas: true }), { crown: false, head: null, hol: null });
});

test('cosmeticsOf: level clamped, unknown gear dropped, no pet without a valid look, toys from the toys level, nothing for ghosts and closed organizations', () => {
  assert.deepEqual(gearOf({ head: 'cap', desk: 'lamp' }), { head: 'cap', desk: 'lamp' });
  assert.deepEqual(gearOf({ head: 'lamp', desk: 'cap' }), { head: null, desk: null }, 'an id in the wrong slot is dropped');
  assert.deepEqual(gearOf(null), { head: null, desk: null });
  assert.deepEqual([-1, 0, 2.7, 4, 9, 'x', null].map(lvOf), [0, 0, 2, 4, 4, 0, 0]);
  const pet = { kind: 'dog', coat: ['#d9a35f'], photo: 'data:image/jpeg;base64,AA==' };
  const c = cosmeticsOf({ lvl: 3, gear: { head: 'cap' }, pet }, { toysLvl: 3 });
  assert.equal(c.lvl, 3); assert.deepEqual(c.gear, { head: 'cap', desk: null }); assert.equal(c.petToys, true); assert.ok(!('photo' in c.pet), 'the normalized look only by default');
  assert.equal(cosmeticsOf({ lvl: 2, pet }, { toysLvl: 3 }).petToys, false);
  assert.equal(cosmeticsOf({ lvl: 2, pet, toys: true }).petToys, true, 'a row may say so itself');
  assert.equal(cosmeticsOf({ lvl: 4, pet }).petToys, false, 'no toys level known: no toys');
  assert.equal(cosmeticsOf({ lvl: 4, pet }, { keepPet: true }).pet, pet, 'the admin mapper keeps the pet object as it is');
  assert.deepEqual(cosmeticsOf({ lvl: 4, gear: { head: 'cap' }, pet }, { off: true }), { lvl: 0, gear: { head: null, desk: null }, pet: null, petToys: false });
  assert.equal(cosmeticsOf({ pet: { coat: [] } }).pet, null);
});

test('unlockNext: thresholds come from the server, the top level says so, no delegation yet is flagged, and the next unlocks are listed', () => {
  const u = { level: 1, spent: 30, dlg: 0.02, runs: 4, levels: [{ lvl: 3, min_spent: 200, min_dlg: 0.1 }, { lvl: 2, min_spent: 50, min_dlg: 0.05 }, { lvl: 1, min_spent: 0, min_dlg: 0 }],
    items: [{ id: 'flower', slot: 'head', lvl: 2 }, { id: 'figurine', slot: 'desk', lvl: 2 }, { id: 'bogus', slot: 'head', lvl: 2 }], petLvl: 2, toysLvl: 3 };
  const x = unlockNext(u);
  assert.equal(x.next.lvl, 2); assert.equal(x.next.spent, 50); assert.ok(Math.abs(x.spentK - 0.6) < 1e-9 && Math.abs(x.dlgK - 0.4) < 1e-9); assert.equal(x.top, false); assert.equal(x.noDlg, false);
  assert.deepEqual(x.opens, ['flower', 'figurine', 'pet']);
  assert.deepEqual(unlockNext({ ...u, level: 2 }).opens, ['toys']);
  const top = unlockNext({ ...u, level: 3 }); assert.equal(top.top, true); assert.equal(top.next, null);
  assert.equal(unlockNext({ ...u, level: 0, runs: 0 }).noDlg, true);
  assert.equal(unlockNext({ level: 0 }).top, false, 'no thresholds sent: neither a next level nor the top');
  assert.ok(!/min_spent:\s*\d|min_dlg:\s*\d/.test(SCENE.slice(SCENE.indexOf('export function unlockNext'), SCENE.indexOf('export function shopTiles'))), 'no threshold is hard-coded');
});

test('shopTiles: the server\'s items in gear.js order, open up to the viewer\'s level', () => {
  const u = { level: 2, items: [{ id: 'halo', slot: 'head', lvl: 4 }, { id: 'cap', slot: 'head', lvl: 1 }, { id: 'lamp', slot: 'desk', lvl: 1 }, { id: 'zzz', slot: 'head', lvl: 1 }] };
  assert.deepEqual(shopTiles(u, 'head'), [{ id: 'cap', lvl: 1, open: true }, { id: 'halo', lvl: 4, open: false }]);
  assert.deepEqual(shopTiles(u, 'desk'), [{ id: 'lamp', lvl: 1, open: true }]);
  assert.deepEqual(shopTiles({}, 'head'), []);
});

test('officeSceneData attaches org_cosmetics by person id; ghosts and a closed organization get none; a person without a row keeps a machine row\'s pet', () => {
  const tt = (k, v) => k + (v ? JSON.stringify(v) : '');
  const rows = [{ member_id: 'a', display_name: 'A', team_id: 't1', team_name: 'T', signal: 'ok' }, { member_id: 'b', display_name: 'B', team_id: 't1', team_name: 'T', signal: 'ok', pet: { coat: ['#ffffff'] } },
    { member_id: 'g', display_name: 'G', team_id: 't1', team_name: 'T', signal: 'silent' }, { member_id: 'a2', display_name: 'A2', team_id: 't1', team_name: 'T', signal: 'ok', seat_of: 'a' }];
  const cosmetics = [{ member_id: 'a', lvl: 3, gear: { head: 'tophat', desk: 'trophy' }, pet: { kind: 'cat', coat: ['#e39a5c'] }, toys: true }, { member_id: 'g', lvl: 4, gear: { head: 'halo' } }];
  const base = { rows, usage: {}, promptRows: null, teams: [{ id: 't1', name: 'T' }], used: 3, limit: 9, orgName: 'O', rangeLabel: 'r', t: tt, rel: x => x, os: () => '', events: [] };
  const d = officeSceneData({ ...base, cosmetics }), by = Object.fromEntries(d.people.map(p => [p.id, p]));
  assert.equal(by.a.lvl, 3); assert.deepEqual(by.a.gear, { head: 'tophat', desk: 'trophy' }); assert.equal(by.a.pet.kind, 'cat'); assert.equal(by.a.petToys, true);
  assert.equal(by.b.lvl, 0); assert.deepEqual(by.b.pet, { coat: ['#ffffff'] }); assert.equal(by.b.petToys, false);
  assert.equal(by.g.tier, 'nodata'); assert.equal(by.g.lvl, 0); assert.deepEqual(by.g.gear, { head: null, desk: null });
  const off = officeSceneData({ ...base, cosmetics, closed: true });
  for(const p of off.people){ assert.equal(p.lvl, 0); assert.equal(p.pet, null); assert.deepEqual(p.gear, { head: null, desk: null }); }
  const none = officeSceneData(base);
  for(const p of none.people){ assert.equal(p.lvl, 0); assert.deepEqual(p.gear, { head: null, desk: null }); }
  assert.equal(d.ui.lv, 'of.lv');
});

test('every shop string exists in both languages, Korean prose has no middle dot or em dash, and item names are short nouns', () => {
  const keys = SHOP_KEYS.map(k => 'of.sh.' + k).concat(GEAR_ITEMS.map(g => 'of.gear.' + g.id), 'of.lv',
    [...PET_KINDS, ...PET_PATTERNS.map(x => 'pat.' + x), ...PET_EARS.map(x => 'ear.' + x), ...PET_TAILS.map(x => 'tail.' + x), ...PET_SIZES.map(x => 'size.' + x)].map(k => 'of.pet.' + k));
  for(const lang of ['en', 'ko']) for(const k of keys) assert.equal(typeof OFFICE[lang][k], 'string', `${lang} ${k}`);
  for(const k of keys){ const v = OFFICE.ko[k]; assert.ok(!/[가-힣] ?\u00b7 ?[가-힣]|\u2014/.test(v), `ko ${k}: ${v}`); }
  for(const g of GEAR_ITEMS) for(const lang of ['en', 'ko']) assert.ok(OFFICE[lang]['of.gear.' + g.id].length <= 14 && !/[.!?]$/.test(OFFICE[lang]['of.gear.' + g.id]), `${lang} ${g.id}`);
  const ui = shopUi(k => OFFICE.ko[k]);
  assert.equal(ui.gear.cap, OFFICE.ko['of.gear.cap']); assert.equal(ui.opt['pat.tabby'], OFFICE.ko['of.pet.pat.tabby']); assert.equal(ui['pet.private'], OFFICE.ko['of.sh.pet.private']);
});

test('the scene wires gear and the shop: imports, crown rule, season sheet, disposal on rebuild and destroy, desk ticks, shop only with data.shop and opts.shop', () => {
  assert.match(SCENE, /import \{ GEAR_ITEMS, makeHeadGear, headGearFit, headGearSkips, placeHeadGear, makeDeskItem, disposeGearShared \} from '\.\/gear\.js\?v=g1'/);
  assert.match(SCENE, /from '\.\/pets\.js\?v=p3'/);
  assert.match(SCENE, /function dressOf\(o\)\{[^\n]*headDress\(\{ ghost: o\.ghost, crown: o\.p\.crown/);
  assert.match(SCENE, /wantVariant\(hk === 'nose' \? 'crown' : hk/, 'a head gear in the season uses the nose-only sheet');
  assert.match(SCENE, /gearBits\.forEach\(h => \{ if\(h\.parent\) h\.parent\.remove\(h\); h\.userData\.dispose\(\); \}\); gearBits = \[\];/, 'clear() frees the desk items on every rebuild');
  assert.match(SCENE, /clear\(\); disposePetShared\(T\); disposeGearShared\(T\); shopKill\(\);/, 'destroy() frees the shared gear geometries and the shop renderers');
  assert.match(SCENE, /h\.userData\.tick\(time, envN, reduced\)/);
  assert.match(SCENE, /const shopFor = o => !!\(o && o\.p && o\.p\.self && cur\.shop && opts\.shop && typeof opts\.shop\.save === 'function'/);
  assert.match(SCENE, /kind = a\.kind === 'play' && !pt\.toys \? 'roam' : a\.kind/, 'no fetch and play below the toys level');
  for(const c of ['lv-1', 'lv-2', 'lv-3', 'lv-4']) assert.ok(SCENE.includes('.of-pcard.' + c), c);
  assert.match(SCENE, /@media \(prefers-reduced-motion:reduce\)\{\.of-pcard\.lv-4 \.pc-foil,\.of-pcard\.lv-4 \.pc-spk\{animation:none\}/);
});

test('pages: one office-scene.js query everywhere (town-scene.js included), the member page saves through town_cosmetics_set and keeps the photo local, the admin page reads org_cosmetics', () => {
  const q = [...(TOWN + TEAM + OPS + TOWNSCENE).matchAll(/office-scene\.js\?v=([^'"]+)/g)].map(m => m[1]);
  /* one value on every page; the value itself is rewritten at each release (scripts/sync-site-version.mjs), so only its shape is pinned */
  assert.ok(q.length >= 4); assert.equal(new Set(q).size, 1, String(q)); assert.match(q[0], /^\d+\.\d+\.\d+(-\d+)?$/);
  assert.match(TOWN, /shop: \{ save: saveCosmetics \}/);
  assert.match(TOWN, /\/rest\/v1\/rpc\/town_cosmetics_set/);
  assert.match(TOWN, /if\(res\.status === 404 && code === 'PGRST202'\) noShop = true;/);
  assert.match(TOWN, /const PHOTO_KEY = 'sprag\.town\.petphoto';/);
  assert.match(TOWN, /petPhoto: lsGet\(PHOTO_KEY\)/);
  assert.match(TOWN, /if\(change\.petClear\) lsDel\(PHOTO_KEY\);/);
  const save = TOWN.slice(TOWN.indexOf('async function saveCosmetics'), TOWN.indexOf('/* ── demo (?demo=1)'));
  assert.ok(!/photo/.test(save.slice(0, save.indexOf('applyCosmetics('))), 'the photo never goes into the request');
  assert.match(TOWN, /if\(DEMO\)\{ fixedPeriod = true; view = demoTown\(\); return show\(\); \}/, 'the demo needs no token and makes no call');
  assert.match(TEAM, /sb\.rpc\('org_cosmetics', \{ p_org_id: org\.id \}\)/);
  assert.match(TEAM, /return error \|\| !Array\.isArray\(data\) \? \[\] : data;/, 'an old server reads as nobody wearing anything');
  assert.match(TEAM, /events: Seats\.events\(\), cosmetics,/);
  assert.ok(!/shop:/.test(TEAM.slice(TEAM.indexOf('ctl = mod.mountOfficeScene'), TEAM.indexOf('ctl = mod.mountOfficeScene') + 600)), 'no shop on the admin page');
});

test('review fixes, strings: the next level says what to do and that both conditions count, Korean says 위임 비율 and N단계, lists join without 및, option labels are nouns', () => {
  for(const lang of ['en', 'ko']) for(const k of ['need', 'need1']) for(const v of ['{s}', '{n}']) assert.ok(OFFICE[lang]['of.sh.' + k].includes(v), `${lang} ${k} ${v}`);
  for(const lang of ['en', 'ko']) assert.ok(OFFICE[lang]['of.sh.need'].includes('{d}'));
  assert.match(OFFICE.en['of.sh.need'], /Both are needed/); assert.match(OFFICE.ko['of.sh.need'], /모두 채우면 \{n\}단계가 열립니다/);
  const ko = Object.entries(OFFICE.ko).filter(([k]) => /^of\.(sh|pet|gear)\./.test(k));
  for(const [k, v] of ko){ assert.ok(!/비중|및 |Lv\./.test(v) || k === 'of.sh.locked', `ko ${k}: ${v}`); assert.ok(!/[가-힣](고|며|서|면|지만),/.test(v), `ko ${k}: comma after a connective ending`); }
  assert.equal(OFFICE.ko['of.sh.dlg'], '위임 비율');
  assert.deepEqual(['s', 'm', 'l'].map(x => OFFICE.ko['of.pet.size.' + x]), ['소형', '중형', '대형']);
  assert.deepEqual(['up', 'flop', 'fold'].map(x => OFFICE.ko['of.pet.ear.' + x]), ['쫑긋한 귀', '늘어진 귀', '접힌 귀']);
  assert.ok(!/포인트/.test(OFFICE.ko['of.pet.pat.point']));
  assert.match(SCENE, /if\(\/\^ko\/\.test\(lang\)\) return a\.join\(', '\);/, 'Korean item lists join with commas');
  for(const lang of ['en', 'ko']) assert.ok(!/drop|끌어/i.test(OFFICE[lang]['of.sh.pet.add']), 'the touch prompt never says drop');
});

test('review fixes, the unlock block: scope in the title line, a run count for a level that only needs a delegation, a ghost note, Decorate as a secondary button', () => {
  const u = unlockHtmlSrc();
  assert.match(u, /<small>\$\{esc\(ui\.scope\)\}<\/small>/);
  assert.match(u, /fillT\(dl \? ui\.need : ui\.need1/);
  assert.match(u, /bar\(ui\.runs, String\(Math\.min\(x\.runs, 1\)\), '1'/);
  assert.match(u, /sel && sel\.ghost \? `<p class="ulk-g">/);
  assert.match(u, /class="of-dbtn out" data-sh="open"/);
  assert.match(SCENE, /\.of-drawer \.ulk\{[^}]*background:#fff;/, 'the block is neutral, apart from the lavender strip');
  assert.match(SCENE, /\.ulk-bar i\{[^}]*transform:scaleX\(var\(--k,0\)\);animation:ulk-fill \.3s ease-out\}/);
  assert.match(SCENE, /@media \(prefers-reduced-motion:reduce\)\{\.of-drawer \.ulk-bar i\{animation:none\}\}/);
});
function unlockHtmlSrc(){ return SCENE.slice(SCENE.indexOf('  function unlockHtml(){'), SCENE.indexOf('  const msgHtml = ')); }

test('review fixes, the shop panel: Save pinned under a scrolling body, tiles with a pressed state and quiet locks, skipped head items marked, pet form styled', () => {
  assert.match(SCENE, /<div class="bd">\$\{ghost\}\$\{tl\}<div role="tabpanel"[^`]*<\/div><\/div>\$\{foot\}`/, 'the foot sits outside the scrolling body');
  assert.match(SCENE, /class="of-dbtn plain" data-sh="cancel"/, 'Cancel is a neutral outline');
  assert.match(SCENE, /\.sh-tile:not\(\[aria-disabled="true"\]\):hover/, 'no hover on locked tiles');
  assert.match(SCENE, /\.sh-tile\[aria-pressed="true"\]/, 'the selected tile is styled on the attribute the markup sets');
  assert.ok(!/aria-checked/.test(SCENE.slice(SCENE.indexOf('.of-drawer .sh-grid'), SCENE.indexOf('.of-drawer .of-sr'))));
  assert.match(SCENE, /\.sh-tabs button\[aria-selected="true"\]\{background:#6d5ce7;color:#fff/);
  assert.match(SCENE, /skips = slot === 'head' && sel \? headGearSkips\(sel\.gk\) : \[\]/);
  assert.match(SCENE, /<span class="ph" aria-hidden="true">\$\{NONE_SVG\}<\/span>/, 'None has a no-item glyph');
  assert.match(SCENE, /\.pet-f select\{-webkit-appearance:none;appearance:none;/); assert.match(SCENE, /input\[type=range\]\{width:100%;accent-color:#6d5ce7\}/);
  assert.match(SCENE, /@media \(hover:none\) and \(pointer:coarse\)\{\.of-drawer \.pet-drop \.dk\{display:none\}/);
  assert.match(SCENE, /data-sh="petask"/); assert.match(SCENE, /if\(a === 'petask' \|\| a === 'petkeep'\)/, 'removing the pet asks once');
  assert.match(SCENE, /class="pet-toy\$\{toyOn \? '' : ' off'\}"/, 'the toys line sits under the preview');
  assert.match(SCENE, /chrome\.el\.classList\.toggle\('shop', !!inShop\); stage\.classList\.toggle\('of-shop', !!inShop\);/);
  assert.match(SCENE, /\.of-stage\.has-drawer\.of-shop \.of-drawer\{height:calc\(100% - 190px\)\}/);
});

test('review fixes, the profile card: level badge in the header, readable on gold, frames told apart, hologram turned by a transform and paused while tilted', () => {
  assert.match(SCENE, /el\.querySelector\('\.pc-hd'\)\.innerHTML = `<b>\$\{esc\(p\.name \|\| ''\)\}<\/b>` \+ \(lv \? `<span class="lvb">/);
  assert.ok(!/lvb/.test(SCENE.slice(SCENE.indexOf("el.querySelector('.pc-ft').innerHTML"), SCENE.indexOf("el.querySelector('.pc-ft').innerHTML") + 300)), 'not in the footer');
  assert.match(SCENE, /\.of-pcard\.lv-3 \.lvb,\.of-pcard\.lv-4 \.lvb\{color:#ffe08a;background:#3a2410/);
  assert.ok(!/--hr/.test(SCENE), 'no custom property animated inside a gradient');
  assert.match(SCENE, /\.of-pcard\.lv-4 \.pc-foil::before\{[^}]*animation:pc-spin 14s linear infinite\}/);
  assert.match(SCENE, /\.of-pcard\.tilt \.pc-foil::before\{animation-play-state:paused\}/);
  assert.match(SCENE, /\.of-pcard\.lv-4 \.pc-star\{display:block/); assert.match(SCENE, /<i class="pc-star"><\/i>/);
  assert.match(SCENE, /\.of-pcard\.lv-4 \.pc-spk::after\{[^}]*animation-delay:-1\.9s\}/, 'the sparkles do not blink as one block');
  assert.match(SCENE, /@property --mx\{syntax:'<percentage>'/); assert.match(SCENE, /--mx \.3s cubic-bezier\(\.23,1,\.32,1\)/, 'glare and foil ease back with the tilt');
});

test('review fixes, gear motion and pets: per person phase, reduced motion for head gear, the pet sits at the mouth of its gap', () => {
  assert.match(SCENE, /g\.userData\.phase = hash\(String\(pid\) \+ ':head'\) \* 10;/);
  assert.match(SCENE, /g\.userData\.phase = hash\(String\(o\.p\.id\) \+ ':desk'\) \* 10;/);
  assert.match(SCENE, /if\(u\.gearHead\) u\.tick\(time, envN, reduced\);/);
  assert.match(SCENE, /const g = headPiece\(dr\.head, o\.gk, o\.p\.id\);/);
  assert.match(SCENE, /sit = \{ x: gx, z: o\.z \+ 1\.8 \}/);
});

test('review fixes, demo data: the member demo uses the server thresholds and figures since joining that differ from the period; admin Lv.3 and Lv.4 people delegate enough', () => {
  assert.match(TOWN, /levels: \[\{ lvl: 1, min_spent: 10, min_dlg: 0 \}, \{ lvl: 2, min_spent: 50, min_dlg: 0\.01 \}, \{ lvl: 3, min_spent: 200, min_dlg: 0\.05 \}, \{ lvl: 4, min_spent: 1000, min_dlg: 0\.1 \}\]/);
  assert.match(TOWN, /unlock: \{ level: 3, spent: 1240,/);
  const share = Function('return ' + TEAM.match(/const DEMO_SHARE = (\{[^}]*\})/)[1])(), gear = Function('return ' + TEAM.match(/const DEMO_GEAR = (\{[\s\S]*?\});/)[1])();
  const need = { 3: 0.05, 4: 0.1 };
  for(const [i, [lvl]] of Object.entries(gear)) if(lvl >= 3) assert.ok((share[i] || 0.015) >= need[lvl], `machine ${i} at level ${lvl} delegates ${share[i] || 0.015}`);
  assert.match(TEAM, /dr = DEMO_SHARE\[String\(o\.member_id\)\.replace\(\/\^\.\*-m\/, ''\)\] \* k \|\| 0\.015;/);
});
