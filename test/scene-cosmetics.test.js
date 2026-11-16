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
const { headDress, HOL_HEADS, cosmeticsOf, gearOf, lvOf, LV_MAX, unlockNext, bookOf, shopTiles, shopUi, SHOP_KEYS, officeSceneData, HOL_HAT_SKIP } = S;
const { GEAR_ITEMS } = await import('../site/assets/scene/gear.js');
const { PET_KINDS, PET_PATTERNS, PET_EARS, PET_TAILS, PET_SIZES, PET_TOYS } = await import('../site/assets/scene/pets.js');
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCENE = read('../site/assets/scene/office-scene.js'), TOWN = read('../site/town/index.html'), TEAM = read('../site/team/index.html'), OPS = read('../site/ops/index.html');
const TOWNSCENE = read('../site/assets/scene/town-scene.js');
const OFFICE = vm.runInNewContext('var window = {};\n' + read('../site/assets/scene/office-i18n.js') + '\n;window.SPRAG_OFFICE_I18N');

test('headDress: the crown wins over head gear, and in the season a head gear replaces the Santa hat or the antlers while the nose stays', () => {
  assert.deepEqual(headDress({ crown: true, head: 'cap', xmas: false, holHeads: true }), { crown: true, head: null, hol: null }, 'a crowned person shows the crown, not the gear');
  assert.deepEqual(headDress({ crown: true, head: 'cap', xmas: true, holHeads: true }), { crown: true, head: null, hol: 'nose' });
  assert.deepEqual(headDress({ head: 'cap', xmas: false, holHeads: true }), { crown: false, head: 'cap', hol: null });
  assert.deepEqual(headDress({ head: 'cap', xmas: true, holHeads: true, species: 'fox', coin: 0.1 }), { crown: false, head: 'cap', hol: 'nose' }, 'gear replaces the Santa hat');
  assert.deepEqual(headDress({ head: 'cap', xmas: true, holHeads: true, species: 'panda', coin: 0.9 }), { crown: false, head: 'cap', hol: 'nose' }, 'gear replaces the antlers');
  assert.equal(headDress({ xmas: true, holHeads: true, species: 'fox', coin: 0.1 }).hol, 'santa');
  assert.equal(headDress({ xmas: true, holHeads: true, species: 'fox', coin: 0.9 }).hol, 'rudolph');
  assert.equal(HOL_HAT_SKIP.size, 0, 'the cast models lost their built-in hats (3.127.0-2), so no species is held to the Rudolph set');
  assert.equal(headDress({ xmas: true, holHeads: true, species: 'panda', coin: 0.1 }).hol, 'santa', 'a species that used to wear a hat now takes the coin like everyone');
  assert.deepEqual(headDress({ head: 'cap', skip: true, xmas: true, holHeads: true, species: 'fox', coin: 0.1 }), { crown: false, head: null, hol: 'santa' }, 'a piece the fit skips is not drawn and the season piece stays');
  assert.deepEqual(headDress({ ghost: true, crown: true, head: 'cap', xmas: true, holHeads: true }), { crown: false, head: null, hol: null });
});

test('cosmeticsOf: level clamped, unknown gear dropped, no pet without a valid look, toys from the toys level, nothing for ghosts and closed organizations', () => {
  assert.deepEqual(gearOf({ head: 'cap', desk: 'lamp' }), { head: 'cap', back: null, desk: 'lamp' });
  assert.deepEqual(gearOf({ head: 'tiara', back: 'angel', desk: 'galaxy' }), { head: 'tiara', back: 'angel', desk: 'galaxy' }, 'the wings slot');
  assert.deepEqual(gearOf({ head: 'angel', back: 'cap', desk: 'angel' }), { head: null, back: null, desk: null }, 'wings are not a head or desk piece and the reverse');
  assert.deepEqual(gearOf({ head: 'lamp', desk: 'cap' }), { head: null, back: null, desk: null }, 'an id in the wrong slot is dropped');
  assert.deepEqual(gearOf(null), { head: null, back: null, desk: null });
  assert.deepEqual([-1, 0, 2.7, 4, 6, 9, 'x', null].map(lvOf), [0, 0, 2, 4, 6, 6, 0, 0]); assert.equal(LV_MAX, 6);
  const pet = { kind: 'dog', coat: ['#d9a35f'], photo: 'data:image/jpeg;base64,AA==' };
  const c = cosmeticsOf({ lvl: 3, gear: { head: 'cap' }, pet }, { toysLvl: 3 });
  assert.equal(c.lvl, 3); assert.deepEqual(c.gear, { head: 'cap', back: null, desk: null }); assert.equal(c.petToys, true); assert.ok(!('photo' in c.pet), 'the normalized look only by default');
  assert.equal(cosmeticsOf({ lvl: 2, pet }, { toysLvl: 3 }).petToys, false);
  assert.equal(cosmeticsOf({ lvl: 2, pet, toys: true }).petToys, true, 'a row may say so itself');
  assert.equal(cosmeticsOf({ lvl: 4, pet }).petToys, false, 'no toys level known: no toys');
  assert.equal(cosmeticsOf({ lvl: 4, pet }, { keepPet: true }).pet, pet, 'the admin mapper keeps the pet object as it is');
  assert.deepEqual(cosmeticsOf({ lvl: 4, gear: { head: 'cap' }, pet }, { off: true }), { lvl: 0, gear: { head: null, back: null, desk: null }, pet: null, petToys: false });
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
  assert.equal(by.a.lvl, 3); assert.deepEqual(by.a.gear, { head: 'tophat', back: null, desk: 'trophy' }); assert.equal(by.a.pet.kind, 'cat'); assert.equal(by.a.petToys, true);
  assert.equal(by.b.lvl, 0); assert.deepEqual(by.b.pet, { coat: ['#ffffff'] }); assert.equal(by.b.petToys, false);
  assert.equal(by.g.tier, 'nodata'); assert.equal(by.g.lvl, 0); assert.deepEqual(by.g.gear, { head: null, back: null, desk: null });
  const off = officeSceneData({ ...base, cosmetics, closed: true });
  for(const p of off.people){ assert.equal(p.lvl, 0); assert.equal(p.pet, null); assert.deepEqual(p.gear, { head: null, back: null, desk: null }); }
  const none = officeSceneData(base);
  for(const p of none.people){ assert.equal(p.lvl, 0); assert.deepEqual(p.gear, { head: null, back: null, desk: null }); }
  assert.equal(d.ui.lv, 'of.lv');
});

test('every shop string exists in both languages, Korean prose has no middle dot or em dash, and item names are short nouns', () => {
  const keys = SHOP_KEYS.map(k => 'of.sh.' + k).concat(GEAR_ITEMS.map(g => 'of.gear.' + g.id), 'of.lv',
    [...PET_KINDS, ...PET_PATTERNS.map(x => 'pat.' + x), ...PET_EARS.map(x => 'ear.' + x), ...PET_TAILS.map(x => 'tail.' + x), ...PET_SIZES.map(x => 'size.' + x), ...PET_TOYS.map(x => 'toy.' + x)].map(k => 'of.pet.' + k));
  for(const lang of ['en', 'ko']) for(const k of keys) assert.equal(typeof OFFICE[lang][k], 'string', `${lang} ${k}`);
  for(const k of keys){ const v = OFFICE.ko[k]; assert.ok(!/[가-힣] ?\u00b7 ?[가-힣]|\u2014/.test(v), `ko ${k}: ${v}`); }
  for(const g of GEAR_ITEMS) for(const lang of ['en', 'ko']) assert.ok(OFFICE[lang]['of.gear.' + g.id].length <= 14 && !/[.!?]$/.test(OFFICE[lang]['of.gear.' + g.id]), `${lang} ${g.id}`);
  const ui = shopUi(k => OFFICE.ko[k]);
  assert.equal(ui.gear.cap, OFFICE.ko['of.gear.cap']); assert.equal(ui.opt['pat.tabby'], OFFICE.ko['of.pet.pat.tabby']); assert.equal(ui['pet.visMeNote'], OFFICE.ko['of.sh.pet.visMeNote']); assert.equal(ui.opt['fur.curly'], OFFICE.ko['of.pet.fur.curly']);
});

test('the scene wires gear and the shop: imports, crown rule, season sheet, disposal on rebuild and destroy, desk ticks, shop only with data.shop and opts.shop', () => {
  assert.match(SCENE, /import \{ GEAR_ITEMS, makeHeadGear, headGearFit, headGearSkips, placeHeadGear, makeBackGear, backGearFit, backGearSkips, backAnchorOf, placeBackGear, makeDeskItem, disposeGearShared \} from '\.\/gear\.js\?v=g3'/);
  assert.match(SCENE, /from '\.\/pets\.js\?v=p6'/); assert.ok(!/pets\.js\?v=p[0-57-9]/.test(SCENE), 'every import of pets.js carries the same query');
  assert.match(SCENE, /export const CAST_Q = '\?v=3\.127\.0-2';/, 'the cast files without accessories need a new cache key');
  assert.match(SCENE, /function dressOf\(o\)\{[^\n]*headDress\(\{ ghost: o\.ghost, crown: o\.p\.crown/);
  assert.match(SCENE, /wantVariant\(hk === 'nose' \? 'crown' : hk/, 'a head gear in the season uses the nose-only sheet');
  assert.match(SCENE, /gearBits\.forEach\(h => \{ if\(h\.parent\) h\.parent\.remove\(h\); h\.userData\.dispose\(\); \}\); gearBits = \[\];/, 'clear() frees the desk items on every rebuild');
  assert.match(SCENE, /clear\(\); disposePetShared\(T\); disposeGearShared\(T\); shopKill\(\);/, 'destroy() frees the shared gear geometries and the shop renderers');
  assert.match(SCENE, /h\.userData\.tick\(time, envN, reduced\)/);
  assert.match(SCENE, /const shopFor = o => !!\(o && o\.p && o\.p\.self && cur\.shop && opts\.shop && typeof opts\.shop\.save === 'function'/);
  assert.match(SCENE, /kind = a\.kind === 'play' && !pt\.toys \? 'roam' : a\.kind/, 'no fetch and play below the toys level');
  for(const c of ['lv-1', 'lv-2', 'lv-3', 'lv-4', 'lv-5', 'lv-6']) assert.ok(SCENE.includes('.of-pcard.' + c), c);
  assert.match(SCENE, /@media \(prefers-reduced-motion:reduce\)\{\.of-pcard\.lv-4 \.pc-foil,\.of-pcard\.lv-4 \.pc-spk,\.of-pcard\.lv-5,\.of-pcard\.lv-6\{animation:none\}/);
  const rm = SCENE.slice(SCENE.indexOf('@media (prefers-reduced-motion:reduce){.of-pcard.lv-4'), SCENE.indexOf('.of-drawer .badge.lvb'));
  for(const c of ['lv-5 .pc-foil::before', 'lv-6 .pc-foil::before', 'lv-5 .pc-spk::before', 'lv-6 .pc-spk::after']) assert.ok(rm.includes('.of-pcard.' + c), 'reduced motion stops ' + c);
});

test('pages: one office-scene.js query everywhere (town-scene.js included), the member page saves through town_cosmetics_set and keeps the photo local, the admin page reads org_cosmetics', () => {
  const q = [...(TOWN + TEAM + OPS + TOWNSCENE).matchAll(/office-scene\.js\?v=([^'"]+)/g)].map(m => m[1]);
  /* one value on every page; the value itself is rewritten at each release (scripts/sync-site-version.mjs), so only its shape is pinned */
  assert.ok(q.length >= 4); assert.equal(new Set(q).size, 1, String(q)); assert.match(q[0], /^\d+\.\d+\.\d+(-\d+)?$/);
  assert.match(TOWN, /shop: \{ save: saveCosmetics, breeds: petBreeds \}, petPhotos,/);
  assert.match(TOWN, /\/rest\/v1\/rpc\/town_cosmetics_set/);
  assert.match(TOWN, /if\(res\.status === 404 && code === 'PGRST202'\) noShop = true;/);
  assert.match(TOWN, /const PHOTO_KEY = 'sprag\.town\.petphoto';/);
  assert.match(TOWN, /petPhoto: lsGet\(PHOTO_KEY\)/);
  assert.match(TOWN, /if\(change\.petClear\) lsDel\(PHOTO_KEY\);/);
  const save = TOWN.slice(TOWN.indexOf('async function saveCosmetics'), TOWN.indexOf('/* ── demo (?demo=1)'));
  assert.match(save, /const plan = mod\.petPhotoPlan\(change, extra\);/, 'the photo goes into the request only by the plan: shared on upload, cleared on going private');
  assert.match(save, /const args = mod\.cosmeticsArgs\(tok, change, plan, up\);/);
  assert.ok(!/extra\.photo/.test(save.slice(save.indexOf('const args'), save.indexOf('applyCosmetics('))), 'the local photo itself never goes into the request, only the shrunk copy');
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
  assert.deepEqual(PET_PATTERNS.map(x => OFFICE.ko['of.pet.pat.' + x]), ['단색', '얼룩', '줄무늬', '턱시도', '포인트', '투톤', '등 무늬', '점박이', '삼색'], 'one short noun per pattern');
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
  assert.match(SCENE, /skips = !sel \? \[\] : slot === 'head' \? headGearSkips\(sel\.gk\) : slot === 'back' \? backGearSkips\(sel\.gk\) : \[\]/);
  assert.match(SCENE, /<span class="ph" aria-hidden="true">\$\{NONE_SVG\}<\/span>/, 'None has a no-item glyph');
  assert.match(SCENE, /\.pet-f select\{-webkit-appearance:none;appearance:none;/); assert.match(SCENE, /input\[type=range\]\{width:100%;accent-color:#6d5ce7\}/);
  assert.match(SCENE, /@media \(hover:none\) and \(pointer:coarse\)\{\.of-drawer \.pet-drop \.dk\{display:none\}/);
  assert.match(SCENE, /data-sh="petask"/); assert.match(SCENE, /if\(a === 'petask' \|\| a === 'petkeep'\)/, 'removing the pet asks once');
  assert.match(SCENE, /class="pet-toy\$\{toyOn \? '' : ' off'\}"/, 'the toys line sits under the preview');
  assert.match(SCENE, /chrome\.el\.classList\.toggle\('shop', !!inShop\); stage\.classList\.toggle\('of-shop', !!inShop\);/);
  assert.ok(!/190px/.test(SCENE), 'the phone shop no longer squeezes the scene into a band');
  assert.match(SCENE, /sheetSync\(inShop\);/); assert.match(SCENE, /\.of-stage\.of-sheet\{contain:none\}/, 'contain would trap the fixed sheet inside the stage');
  assert.match(SCENE, /\.of-card \.of-stage\.of-sheet \.of-drawer\.shop\{position:fixed;inset:0;/); assert.match(SCENE, /env\(safe-area-inset-bottom\)/);
  assert.match(SCENE, /\.of-drawer\.shop \.bkbar\{flex:none;[^}]*background:#fffdf8;border-bottom:/, 'the Back row is opaque with a border');
  assert.match(SCENE, /\.pet-wrap>\.pet-pvc\{order:-1;position:sticky;top:0;z-index:2;[^}]*background:#fffdf8;border-bottom:/, 'the preview is pinned on top of the sheet, opaque');
  assert.match(SCENE, /onClose: \(\) => \{ shopReset\(\); sheetSync\(false\);/); assert.match(SCENE, /document\.documentElement\.classList\.remove\('of-sheet-on'\); viewKill\(\);/);
});

test('review fixes, the profile card: level badge in the header, readable on gold, frames told apart, hologram turned by a transform and paused while tilted', () => {
  assert.match(SCENE, /el\.querySelector\('\.pc-hd'\)\.innerHTML = `<b>\$\{esc\(p\.name \|\| ''\)\}<\/b>` \+ \(lv \? `<span class="lvb">/);
  assert.ok(!/lvb/.test(SCENE.slice(SCENE.indexOf("el.querySelector('.pc-ft').innerHTML"), SCENE.indexOf("el.querySelector('.pc-ft').innerHTML") + 300)), 'not in the footer');
  assert.match(SCENE, /\.of-pcard\.lv-3 \.lvb,\.of-pcard\.lv-4 \.lvb,\.of-pcard\.lv-5 \.lvb,\.of-pcard\.lv-6 \.lvb\{color:#ffe08a;background:#3a2410/);
  assert.ok(!/--hr/.test(SCENE), 'no custom property animated inside a gradient');
  assert.match(SCENE, /\.of-pcard\.lv-4 \.pc-foil::before,\.of-pcard\.lv-5 \.pc-foil::before,\.of-pcard\.lv-6 \.pc-foil::before\{[^}]*animation:pc-spin 14s linear infinite\}/);
  assert.match(SCENE, /\.of-pcard\.lv-5 \.pc-foil::before\{[^}]*animation-duration:8s\}/, 'the prism frame turns faster'); assert.match(SCENE, /\.of-pcard\.lv-6 \.pc-foil::before\{background:conic-gradient\(#ffd24a,#ff7a1a,#e0112b/, 'the legend frame is gold and flame');
  assert.match(SCENE, /\.of-pcard\.lv-5\{animation:pc-glow5 3\.2s[^}]*\}\.of-pcard\.lv-6\{animation:pc-glow6/, 'the outer glow pulses'); assert.match(SCENE, /@keyframes pc-glow5\{/); assert.match(SCENE, /@keyframes pc-glow6\{/);
  assert.match(SCENE, /\.of-pcard\.tilt \.pc-foil::before\{animation-play-state:paused\}/);
  assert.match(SCENE, /\.of-pcard\.lv-4 \.pc-star,\.of-pcard\.lv-5 \.pc-star,\.of-pcard\.lv-6 \.pc-star\{display:block/); assert.match(SCENE, /<i class="pc-star"><\/i>/);
  assert.match(SCENE, /\.of-pcard\.lv-4 \.pc-spk::after,\.of-pcard\.lv-5 \.pc-spk::after,\.of-pcard\.lv-6 \.pc-spk::after\{[^}]*animation-delay:-1\.9s\}/, 'the sparkles do not blink as one block');
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
  assert.match(TOWN, /levels: \[\{ lvl: 1, min_spent: 10, min_dlg: 0 \}, \{ lvl: 2, min_spent: 50, min_dlg: 0\.002 \}, \{ lvl: 3, min_spent: 200, min_dlg: 0\.01 \}, \{ lvl: 4, min_spent: 1000, min_dlg: 0\.03 \},\s*\{ lvl: 5, min_spent: 2500, min_dlg: 0\.07 \}, \{ lvl: 6, min_spent: 5000, min_dlg: 0\.12 \}\]/);
  assert.match(TOWN, /unlock: \{ level: 3, spent: 1240,/);
  const share = Function('return ' + TEAM.match(/const DEMO_SHARE = (\{[^}]*\})/)[1])(), gear = Function('return ' + TEAM.match(/const DEMO_GEAR = (\{[\s\S]*?\});/)[1])();
  const need = { 3: 0.01, 4: 0.03 };   /* the floors of sprag-team 20261116000400 */
  for(const [i, [lvl]] of Object.entries(gear)) if(lvl >= 3) assert.ok((share[i] || 0.015) >= need[lvl], `machine ${i} at level ${lvl} delegates ${share[i] || 0.015}`);
  assert.match(TEAM, /dr = DEMO_SHARE\[String\(o\.member_id\)\.replace\(\/\^\.\*-m\/, ''\)\] \* k \|\| 0\.015;/);
});

/* ── round 2: shared photos, breeds, coat roles, the object viewer, the toy ── */
const { petPhotoOk, petPhotosClean, petPhotoPlan, cosmeticsArgs, fitJpeg, PET_PHOTO_UP, breedList, breedName, petCoatFor, objPick, viewUi, VIEW_KEYS, petRoleKeys } = S;
const { petCoatRoles, PET_MARKS } = await import('../site/assets/scene/pets.js');
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('petPhotoOk and petPhotosClean: only small JPEG or WebP data URLs, only for the ids asked', () => {
  assert.ok(petPhotoOk(JPG)); assert.ok(petPhotoOk('data:image/webp;base64,UklGRg=='));
  for(const bad of ['data:image/png;base64,iVBORw0KGgo=', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://example.com/a.jpg', 'data:image/jpeg;base64,AA"onerror=x', 'javascript:alert(1)', null, 42,
    'data:image/jpeg;base64,' + 'A'.repeat(48001)]) assert.equal(petPhotoOk(bad), false, String(bad).slice(0, 40));
  assert.deepEqual(petPhotosClean({ a: JPG, b: 'data:image/png;base64,AA==', c: JPG, z: JPG }, ['a', 'b', 'c']), { a: JPG, c: JPG }, 'an id not asked for and a PNG are dropped');
  for(const r of [null, [], 'x', 7]) assert.deepEqual(petPhotosClean(r, ['a']), {});
});

test('petPhotoPlan and cosmeticsArgs: share uploads once, private clears a server copy, removing the pet clears by itself', () => {
  const pet = { kind: 'dog', coat: ['#d9a35f'] }, ch = { pet };
  assert.equal(petPhotoPlan(ch, { photo: JPG, fresh: true, share: true, shared: true }), 'upload', 'a new photo while sharing replaces the copy');
  assert.equal(petPhotoPlan(ch, { photo: JPG, fresh: false, share: true, shared: false }), 'upload', 'turning sharing on uploads the photo kept here');
  assert.equal(petPhotoPlan(ch, { photo: JPG, fresh: false, share: true, shared: true }), null, 'already shared: nothing to send');
  assert.equal(petPhotoPlan(ch, { photo: null, share: true, shared: false }), null, 'no photo, nothing to share');
  assert.equal(petPhotoPlan(ch, { photo: JPG, share: false, shared: true }), 'clear');
  assert.equal(petPhotoPlan(ch, { photo: JPG, share: false, shared: false }), null, 'private by default: no photo argument at all');
  assert.equal(petPhotoPlan({ petClear: true }, { share: false, shared: true }), null);
  assert.equal(petPhotoPlan({ gear: { head: 'cap' } }, { share: true, photo: JPG }), null);
  assert.deepEqual(cosmeticsArgs('t', ch, 'upload', JPG), { p_token: 't', p_pet: pet, p_photo: JPG });
  assert.deepEqual(cosmeticsArgs('t', ch, 'clear', null), { p_token: 't', p_pet: pet, p_photo_clear: true });
  assert.deepEqual(cosmeticsArgs('t', ch, null, null), { p_token: 't', p_pet: pet });
  assert.deepEqual(cosmeticsArgs('t', ch, 'upload', 'data:image/png;base64,AA=='), { p_token: 't', p_pet: pet }, 'an invalid copy is never sent');
  assert.deepEqual(cosmeticsArgs('t', { petClear: true }, 'clear', JPG), { p_token: 't', p_pet_clear: true }, 'p_pet_clear deletes the photo on the server too');
  assert.deepEqual(cosmeticsArgs('t', { gear: { head: 'cap', desk: null } }, null, null), { p_token: 't', p_gear: { head: 'cap', desk: null } });
});

test('fitJpeg: the first quality from 0.82 down whose data URL fits 46,000 characters, else null', () => {
  const tried = [], enc = q => { tried.push(q); return 'data:image/jpeg;base64,' + 'A'.repeat(Math.round(q * 80000)); };
  const u = fitJpeg(enc); assert.ok(u && u.length <= PET_PHOTO_UP); assert.equal(tried[0], 0.82); assert.ok(tried.every((q, i) => !i || q < tried[i - 1]), 'quality only goes down');
  assert.equal(fitJpeg(() => 'data:image/jpeg;base64,' + 'A'.repeat(50000)), null);
  assert.equal(fitJpeg(() => 'data:image/png;base64,AA=='), null);
  assert.equal(fitJpeg(() => { throw new Error('tainted'); }), null);
});

test('breedList: valid rows only, dogs first, each look carries its kind and breed; breedName follows the page language', () => {
  const rows = [{ key: 'korat', kind: 'cat', en: 'Korat', ko: '코랏', look: { coat: ['#8a8f99'] } }, { key: 'jindo', kind: 'dog', en: 'Jindo', ko: '진돗개', look: { coat: ['#e8c48e'], ear: 'up' } },
    { key: 'Bad Key', kind: 'dog', en: 'x', look: { coat: ['#ffffff'] } }, { key: 'fox', kind: 'fox', en: 'Fox', look: { coat: ['#ffffff'] } }, { key: 'nolook', kind: 'cat', en: 'x' }, { key: 'nocoat', kind: 'dog', look: { coat: [] } },
    { key: 'jindo', kind: 'dog', en: 'dup', look: { coat: ['#000000'] } }];
  const b = breedList(rows);
  assert.deepEqual(b.map(r => r.key), ['jindo', 'korat']);
  assert.equal(b[0].look.kind, 'dog'); assert.equal(b[0].look.breed, 'jindo'); assert.equal(b[1].look.kind, 'cat');
  assert.deepEqual(breedList(null), []); assert.deepEqual(breedList({ error: 1 }), []);
  assert.equal(breedName(b[0], 'ko'), '진돗개'); assert.equal(breedName(b[0], 'en'), 'Jindo'); assert.equal(breedName(null, 'en'), '');
});

test('petCoatFor: colours stay by position, a newly required one is filled (from memory, else derived), an optional one is left out', () => {
  const r = p => petCoatRoles(p);
  assert.deepEqual(petCoatFor(['#aa7744'], r('solid')), ['#aa7744']);
  assert.deepEqual(petCoatFor(['#aa7744', '#ffffff', '#000000'], r('solid')), ['#aa7744'], 'extra colours are dropped');
  const tux = petCoatFor(['#45434a'], r('tuxedo')); assert.equal(tux.length, 2); assert.equal(tux[0], '#45434a'); assert.match(tux[1], /^#[0-9a-f]{6}$/);
  assert.deepEqual(petCoatFor(['#45434a'], r('tuxedo'), ['#45434a', '#ece8e1']), ['#45434a', '#ece8e1'], 'the colour last used there comes back');
  assert.equal(petCoatFor(['#aa7744'], r('patch')).length, 2, 'the optional ear colour stays off');
  assert.equal(petCoatFor(['#aa7744'], r('calico')).length, 3);
  const lightOf = h => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  assert.ok(lightOf(petCoatFor(['#7a5a3a'], r('tuxedo'))[1]) > lightOf('#7a5a3a'), 'the white role is derived lighter');
  assert.ok(lightOf(petCoatFor(['#c9a070'], r('point'))[1]) < lightOf('#c9a070'), 'the points role is derived darker');
});

test('objPick: an object wins only inside its own projected radius (at least 10 px), the nearest by distance over radius', () => {
  const desk = { kind: 'desk', x: 100, y: 100, r: 4 }, pet = { kind: 'pet', x: 130, y: 100, r: 40 };
  assert.equal(objPick(108, 100, [desk]), desk, 'a small item still takes a 10 px radius');
  assert.equal(objPick(111, 100, [desk]), null, 'outside it: the person behind is picked as before');
  assert.equal(objPick(104, 100, [desk, pet]), desk, 'well inside the small one beats the edge of the big one');
  assert.equal(objPick(125, 100, [desk, pet]), pet);
  assert.equal(objPick(0, 0, []), null); assert.equal(objPick(0, 0, null), null);
});

test('photo flags: a row with photo true gives the pet shared, the viewer\'s self.photo becomes shop.photoShared', () => {
  const pet = { kind: 'cat', coat: ['#e39a5c'] };
  assert.equal(cosmeticsOf({ lvl: 2, pet, photo: true }).pet.shared, true);
  assert.ok(!('shared' in cosmeticsOf({ lvl: 2, pet, photo: false }).pet));
  assert.equal(cosmeticsOf({ lvl: 2, pet }, { keepPet: true }).pet, pet, 'no photo flag: the object is kept as it is');
  assert.equal(cosmeticsOf({ lvl: 2, pet, photo: true }, { off: true }).pet, null);
  const tt = (k, v) => k + (v ? JSON.stringify(v) : '');
  const d = officeSceneData({ rows: [{ member_id: 'a', display_name: 'A', team_id: 't1', team_name: 'T', signal: 'ok' }], usage: {}, promptRows: null, teams: [{ id: 't1', name: 'T' }], used: 1, limit: 2, orgName: 'O', rangeLabel: 'r', t: tt, rel: x => x, os: () => '', events: [],
    cosmetics: [{ member_id: 'a', lvl: 3, pet, photo: true }] });
  assert.equal(d.people[0].pet.shared, true); assert.equal(d.ui.view.photo, 'of.vw.photo'); assert.equal(d.ui.view.gear.lamp, 'of.gear.lamp'); assert.equal(d.ui.view.kind.cat, 'of.pet.cat');
});

test('round 2 strings: coat roles, marks, the viewer and the pet tab in both languages; Korean follows the house rules and says what sharing does', () => {
  const keys = petRoleKeys().map(k => 'of.pet.role.' + k).concat(PET_MARKS.map(m => 'of.pet.mark.' + m), VIEW_KEYS.map(k => 'of.vw.' + k));
  for(const p of PET_PATTERNS) for(const r of petCoatRoles(p)) assert.ok(keys.includes('of.pet.role.' + r.key), `${p} ${r.key}`);
  for(const lang of ['en', 'ko']) for(const k of keys) assert.equal(typeof OFFICE[lang][k], 'string', `${lang} ${k}`);
  for(const k of Object.keys(OFFICE.en)) assert.ok(k in OFFICE.ko, `ko ${k}`);
  for(const k of Object.keys(OFFICE.ko)) assert.ok(k in OFFICE.en, `en ${k}`);
  const ko = Object.entries(OFFICE.ko).filter(([k]) => /^of\.(sh|pet|vw)\./.test(k));
  for(const [k, v] of ko){ assert.ok(!/\u00b7|\u2014/.test(v), `ko ${k}: ${v}`); assert.ok(!/[가-힣](고|며|서|면|지만),/.test(v), `ko ${k}: comma after a connective ending`); }
  const fresh = /^of\.(vw|pet\.role|pet\.mark)\.|^of\.sh\.(err\.photo|pet\.(breed|custom|dogs|cats|vis|g\.|earsize|snout|legs|length|build|fluff\.|marks|markColor|eye|nose|auto|collar))/;   /* this round's strings */
  for(const [k, v] of ko.filter(([k]) => fresh.test(k))) assert.ok(!/[^다]\.$/.test(v), `ko ${k}: a period only after 다`);
  for(const k of petRoleKeys()) assert.ok(OFFICE.ko['of.pet.role.' + k].length <= 12 && !/[.!?]$/.test(OFFICE.ko['of.pet.role.' + k]), `role ${k} is a short noun phrase`);
  const me = OFFICE.ko['of.sh.pet.visMeNote'], sh = OFFICE.ko['of.sh.pet.visShareNote']; assert.match(me, /^나만 보기를 고르면/); assert.match(me, /지웁니다/); assert.match(sh, /서버/); assert.match(sh, /같은 조직/); assert.match(sh, /액자/);
  assert.equal(OFFICE.ko['of.sh.pet.visMe'], '나만 보기');
  const ui = shopUi(k => OFFICE.en[k]); assert.equal(ui.opt['role.white'], OFFICE.en['of.pet.role.white']); assert.equal(ui.opt['mark.socks'], OFFICE.en['of.pet.mark.socks']);
  const vu = viewUi(k => OFFICE.ko[k]); assert.equal(vu.photo, '{n} 사진');
});

test('the scene: the viewer, shared photo frames, breeds and the pet tab are wired as designed', () => {
  assert.match(SCENE, /const ok = petPhotosClean\(res, ids\);/, 'every fetched photo is checked before it becomes an image');
  assert.match(SCENE, /pt\.o\.p\.pet && pt\.o\.p\.pet\.shared === true && !pt\.frame && !photoCache\.has/, 'only pets whose owner shares, once per page');
  assert.match(SCENE, /const own = o\.p\.self && o\.p\.pet && typeof o\.p\.pet\.photo === 'string'/, 'only the viewer\'s own pet uses the photo in the data; a coworker\'s frame needs a shared photo');
  assert.match(SCENE, /viewKill\(\); clear\(\); disposePetShared\(T\);/, 'destroy frees the viewer renderer');
  assert.match(SCENE, /window\.addEventListener\('keydown', vwKey, true\)/); assert.match(SCENE, /window\.removeEventListener\('keydown', vwKey, true\)/);
  assert.match(SCENE, /make: \(\) => makeDeskItem\(T, id\)/); assert.match(SCENE, /make: \(\) => makePet\(T, L\)/, 'the viewer shows fresh instances');
  assert.match(SCENE, /if\(!noObj\)\{ const ob = objPick\(px, py, objList\(\)\); if\(ob\) return \{ obj: ob \}; \}/, 'hover: an object wins over the person behind it');
  assert.match(SCENE, /onDown: \(px, py, ev\) => \{ const mr = pickMinR\(ev && ev\.pointerType\), ob = objPick\(px, py, objList\(\), mr\);/, 'a tap takes its object at the press');
  assert.match(SCENE, /if\(v === 'open'\)\{ viewOpen\(d\.kind, d\.o\); return; \}/); assert.match(SCENE, /const h = nearest\(px, py, true\);\n        if\(!h\)\{ setHover\(null\); if\(sel\) closeDrawer\(\); return; \}/, 'people, teams and the server pick at the release as before');
  assert.match(SCENE, /if\(ptrs\.size === 1 && cfg\.onDown\) cfg\.onDown\(\.\.\.pt\(ev\), ev\);/);
  assert.match(SCENE, /\['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'contextmenu'\]\.forEach\(ev => \[bg, el\]/, 'the viewer swallows its own presses');
  assert.match(SCENE, /vw\.x\.focus\(\{ preventScroll: true \}\)/); assert.match(SCENE, /if\(focus && canvas\) canvas\.focus\(\{ preventScroll: true \}\)/);
  assert.match(SCENE, /t\.rotation\.set\(0, yaw \+ st\.roll \* 0\.4, 0\); toyFlat\(t\); \}   \/\* a bone or a mouse slides and turns flat \*\//, 'a flat toy slides and turns about y only');
  assert.match(SCENE, /q\.setFromAxisAngle\(ax, dd \/ R\); sp\.quaternion\.premultiply\(q\);/, 'a round toy rolls by its own travel, distance over radius');
  assert.ok(!/t\.rotation\.set\(st\.roll/.test(SCENE));
  for(const id of ["sel1('kind'", "sel1('size'", "sel1('pattern'", "sel1('ear'", "sel1('tail'", 'o-pf-breed', 'o-pf-vis-', 'o-pf-name', 'o-pf-c${i}', 'o-pf-use${i}', 'o-pf-mark-${m}', 'o-pf-mark"', 'o-pf-auto-${k}', 'o-pf-use-collar', 'o-pf-collar"'])
    assert.ok(SCENE.includes(id), id);
  assert.match(SCENE, /<details class="pet-g" data-g="\$\{k\}"/); assert.match(SCENE, /open: \(shop && shop\.pet && shop\.pet\.open\) \|\| \{ basic: true, coat: true, shape: false, face: false, toy: false \}/);
  assert.match(SCENE, /\.of-drawer \.pet-wrap>\.pet-pvc\{position:sticky;top:0/);
});

test('pages: shared photos and breeds go through their RPCs, the demo answers locally', () => {
  assert.match(TOWN, /\/rest\/v1\/rpc\/town_pet_photos/); assert.match(TOWN, /p_ids: ids\.slice\(0, 16\)/);
  assert.match(TOWN, /\/rest\/v1\/rpc\/pet_breeds/); assert.match(TOWN, /if\(DEMO\) return Promise\.resolve\(DEMO_BREEDS\);/);
  assert.match(TOWN, /const k = Math\.min\(1, 256 \/ Math\.max\(w, h\)\)/); assert.match(TOWN, /mod\.fitJpeg\(q => c\.toDataURL\('image\/jpeg', q\)\)/);
  assert.match(TOWN, /sf\.photo = !!\(r && r\.photo === true\);/);
  assert.match(TEAM, /sb\.rpc\('org_pet_photos', \{ p_org_id: org\.id, p_member_ids: ids\.slice\(0, 16\) \}\)/);
  assert.match(TEAM, /petPhotos, breeds: petBreeds,/);
  const demo = TOWN.slice(TOWN.indexOf('const DEMO_BREEDS'), TOWN.indexOf('if(DEMO) window.__spragDemoLog'));
  const rows = Function('return ' + demo.slice(demo.indexOf('['), demo.lastIndexOf(']') + 1))();
  assert.equal(rows.length, 6); assert.deepEqual(rows.map(r => r.kind), ['dog', 'dog', 'dog', 'cat', 'cat', 'cat']); assert.equal(breedList(rows).length, 6, 'the demo breeds are valid rows');
  assert.ok(!/data:image\/jpeg;base64,[A-Za-z0-9+/]{40}/.test(TOWN + TEAM), 'no embedded photograph in the pages: the demo draws its photos');
});

test('pets: a walk to where the pet already stands ends at once, and a toy rising from the pile or going back starts and ends on the floor', () => {
  assert.match(SCENE, /if\(sg\.pts\.length < 2\)\{ pt\.x = sg\.to\.x; pt\.z = sg\.to\.z; pt\.v = 0; return true; \}/, 'a one-point path no longer throws and stops the frame loop');
  assert.match(SCENE, /t\.position\.set\(p\.x, Math\.max\(p\.y, floor\(p\.x, p\.z\)\), p\.z\)/);
  assert.match(SCENE, /low: toyLow\(pt\)/, 'the rec hook reports the toy\'s lowest point above the floor');
});

/* ── round 2 fixes (UI) ── */
const { objTap, pickMinR, OBJ_R, floorSeen, playSeen, HOME_DIR, HOME_SLOPE, hopAlong, saveMsgKey, PET_FUR_LIST } = S;

test('a tap on a moving object: taken at the press, opened at the release only within 1.5 radii; a press on no object picks people as before', () => {
  assert.equal(pickMinR('touch'), 22); assert.equal(pickMinR('pen'), 22); assert.equal(pickMinR('mouse'), 10); assert.equal(pickMinR(undefined), 10);
  assert.equal(OBJ_R, 0.6, 'the pick radius follows the silhouette, not the bounding sphere');
  const pet = { kind: 'pet', x: 100, y: 100, r: 8 };
  assert.equal(objPick(117, 100, [pet], 22), pet, 'a finger gets 22 px'); assert.equal(objPick(117, 100, [pet], 10), null, 'a mouse 10');
  assert.equal(objTap(null, pet, 100, 100), 'pass', 'nothing under the press: the person, team or server below decides');
  assert.equal(objTap({ kind: 'pet' }, { x: 110, y: 100, r: 10 }, 100, 100, 10), 'open', 'it walked 10 px between press and release: still within 1.5 radii');
  assert.equal(objTap({ kind: 'pet' }, { x: 120, y: 100, r: 10 }, 100, 100, 10), 'keep', 'it walked away: nothing opens, and the person behind is not picked either');
  assert.equal(objTap({ kind: 'pet' }, null, 100, 100), 'keep', 'it is gone (rebuilt): a press that began on an object never closes the drawer');
  assert.equal(objTap({ kind: 'pet' }, { x: 120, y: 100, r: 4 }, 100, 100, 22), 'open', 'a finger: 1.5 times the 22 px floor');
});

test('play spots: the toy area must be in clear view of the home camera; desks, sitters and boxes between it and the camera rule a spot out', () => {
  assert.deepEqual(HOME_DIR.map(v => +v.toFixed(4)), [0.7071, 0.7071], 'the default camera stands at +x +z (theta0 = pi/4)');
  assert.ok(Math.abs(HOME_SLOPE - 16.6 / Math.hypot(20, 20)) < 1e-12);
  const desk = [-1.1, 0.55, 1.1, 1.75, 1.62];
  assert.equal(floorSeen(-0.5, -0.5, [desk]), false, 'right behind a desk from the camera: hidden');
  assert.equal(floorSeen(0, 2.2, [desk]), true, 'in front of it: seen'); assert.equal(floorSeen(2, 0, [desk]), true, 'beside it on the camera side: seen');
  assert.equal(floorSeen(-4, -4, [desk]), true, 'far behind: the line has risen over the desk top by then');
  assert.equal(floorSeen(0, 1, [desk]), false, 'under the desk');
  assert.equal(floorSeen(-0.5, -0.5, [[-1.1, 0.55, 1.1, 1.75, 0]]), true, 'a box with no height hides nothing');
  assert.equal(playSeen([[0, 2.2], [-0.5, -0.5]], [desk]), false, 'every point of the area must be seen'); assert.equal(playSeen([[0, 2.2], [2, 0]], [desk]), true);
  assert.match(SCENE, /&& playSeen\(area\.map\(/, 'petSlotSpots tests the toy area'); assert.match(SCENE, /const area = \[\[0, Z\], \[0, Z \+ 0\.3\]/, 'measured from the pet\'s own toy distance (playZ)');
});

test('the hop: horizontal travel lags going up and leads coming down; it takes off from the desk front the home camera sees, and the frame moved out of the sleeping pet\'s way', () => {
  assert.equal(hopAlong(0, true), 0); assert.equal(hopAlong(1, true), 1); assert.equal(hopAlong(0, false), 0); assert.equal(hopAlong(1, false), 1);
  for(let f = 0.05; f < 1; f += 0.05){ assert.ok(hopAlong(f, true) < f, `up lags at ${f}`); assert.ok(hopAlong(f, false) > f, `down leads at ${f}`); assert.ok(hopAlong(f + 0.01, true) > hopAlong(f, true)); }
  assert.match(SCENE, /const DESK_HOP = \{ x: 0\.1, z: 2\.3 \}, DESK_FRAME = \{ x: 0\.98, z: 0\.64 \};/, 'the take-off is in front of the desk middle, where the home camera sees the floor');
  assert.match(SCENE, /hop: \{ x: o\.x \+ DESK_HOP\.x, z: o\.z \+ DESK_HOP\.z, yaw: DESK_HOP_YAW \}/, 'facing the sleeping spot on a diagonal');
  /* the next row's sitter (a person box 3.1 ahead in the same column) hides the floor in front of the left end but not the new take-off point */
  const sitter = [-0.35, 2.85, 0.35, 3.35, 1.6];
  assert.equal(floorSeen(0.1, 2.3, [sitter]), true, 'the take-off is in view'); assert.equal(floorSeen(-0.76, 2.3, [sitter]), false, 'the old take-off was hidden');
  /* seen from the home camera the frame in the back right corner has nothing of the sleeping spot between it and the camera */
  const fit = [-1.1, 0.72, -0.42, 1.93, 1.4]; assert.equal(floorSeen(0.98, 0.64, [fit]), true); assert.equal(floorSeen(-0.98, 0.64, [fit]), false, 'where it stood before, the pet hid it');
});

test('save messages say who sees the photo; the strings for them exist in both languages', () => {
  assert.equal(saveMsgKey({ gear: { head: 'cap' } }, undefined), 'saved'); assert.equal(saveMsgKey({ pet: {} }, { photo: null, share: true }), 'saved', 'no photo: one plain message');
  assert.equal(saveMsgKey({ pet: {} }, { photo: 'data:', share: false }), 'saved.private'); assert.equal(saveMsgKey({ pet: {} }, { photo: 'data:', share: true }), 'saved.shared');
  assert.equal(saveMsgKey({ petClear: true }, {}), 'pet.removed');
  assert.equal(OFFICE.ko['of.sh.saved'], '저장했습니다. 동료에게도 보입니다.');
  assert.equal(OFFICE.ko['of.sh.saved.private'], '저장했습니다. 반려동물은 동료에게도 보이고 사진은 나만 봅니다.');
  assert.equal(OFFICE.ko['of.sh.saved.shared'], '저장했습니다. 사진도 동료 화면의 내 책상 액자에 보입니다.');
  assert.match(SCENE, /shop\.msg = \{ text: ui\[saveMsgKey\(change, extra\)\] \|\| ui\.saved \};/);
});

test('round 2 fix strings: the skip note names the body, the photo block says what choosing does, slider ends pair up, removing says take out', () => {
  assert.equal(OFFICE.ko['of.sh.skip'].split('. ')[0] + '.', '이 동물은 뿔이나 귀 때문에 이 소품을 쓸 수 없습니다.'); assert.ok(!/모자를 쓰고/.test(OFFICE.ko['of.sh.skip'])); assert.match(OFFICE.en['of.sh.skip'], /horns, antlers or ears/);
  assert.equal(OFFICE.ko['of.sh.pet.read'], '사진에서 털 색과 무늬를 읽었습니다.'); assert.equal(OFFICE.ko['of.sh.pet.readBreed'], '사진에서 털 색만 읽었습니다. 무늬는 품종을 따릅니다.');
  assert.match(OFFICE.ko['of.sh.pet.pick'], /이 브라우저/); assert.match(OFFICE.ko['of.sh.pet.pick'], /올라가지 않습니다/);
  for(const k of ['of.sh.pet.c0', 'of.sh.pet.c1', 'of.sh.pet.c2', 'of.sh.pet.private', 'of.sh.pet.visNote', 'of.sh.pet.visOff', 'of.sh.pet.hand']) for(const lang of ['en', 'ko']) assert.ok(!(k in OFFICE[lang]), `${lang} ${k} is gone`);
  assert.ok(!Object.values(OFFICE.ko).some(v => /두 번째 색/.test(v)));
  assert.deepEqual(['fluff', 'earsize', 'snout', 'legs', 'length', 'build'].map(k => [OFFICE.ko[`of.sh.pet.${k}.lo`], OFFICE.ko[`of.sh.pet.${k}.hi`]]),
    [['짧게', '길게'], ['작게', '크게'], ['짧게', '길게'], ['짧게', '길게'], ['짧게', '길게'], ['날씬하게', '통통하게']], 'slider ends as pairs');
  assert.equal(OFFICE.ko['of.sh.pet.remove'], '반려동물 빼기'); assert.equal(OFFICE.ko['of.sh.pet.ask'], '사무실에서 뺄까요?'); assert.equal(OFFICE.ko['of.sh.pet.auto'], '털 색에 맞춤');
  assert.equal(OFFICE.ko['of.sh.pet.g.face'], '얼굴과 목줄'); assert.equal(OFFICE.ko['of.pet.mark.tip'], '꼬리 끝 무늬');
  assert.deepEqual(PET_FUR_LIST.map(x => OFFICE.ko['of.pet.fur.' + x]), ['보통', '곱슬', '긴 직모']); assert.equal(PET_FUR_LIST[0], 'plush');
  const roles = { coat: '털 색', base: '바탕색', patch: '얼룩 색', ear: '귀 색', stripe: '줄무늬 색', muzzle: '주둥이 색', main: '바탕색', white: '가슴과 발 색', body: '바탕색', points: '포인트 색', top: '등 색', under: '배와 다리 색', saddle: '등 무늬 색', spot: '점 색', patch1: '얼룩 색', patch2: '다른 얼룩 색' };
  for(const [k, v] of Object.entries(roles)) assert.equal(OFFICE.ko['of.pet.role.' + k], v, k);
  assert.equal(OFFICE.ko['of.vw.tip'], '눌러서 크게 보기'); assert.equal(OFFICE.ko['of.vw.ownPet'], '{n}의 반려동물');
  for(const k of ['of.sh.saved.private', 'of.sh.saved.shared', 'of.sh.pet.pick', 'of.sh.pet.readBreed', 'of.sh.pet.breedNote', 'of.sh.pet.visMeNote', 'of.sh.pet.visShareNote', 'of.sh.pet.visEx', 'of.vw.shared', 'of.vw.mine', 'of.vw.mineShared']){
    const v = OFFICE.ko[k]; assert.ok(/다\.$/.test(v), `ko ${k}: whole sentences ending in 다.`); assert.ok(!/·|—|[가-힣](고|며|서|면|지만),/.test(v), `ko ${k}`); }
});

test('the pet tab and the viewer as fixed: kind above breed, the coat texture, the photo block, the preview opens the viewer, one viewer layout', () => {
  const f = SCENE.slice(SCENE.indexOf('  function petHtml(){'), SCENE.indexOf('  function shopHtml(){'));
  assert.ok(f.indexOf("${sel1('kind', PET_KINDS, '')}${breed}") > 0, 'kind directly above the breed');
  assert.match(f, /sel1\('fur', PET_FUR_LIST, 'fur\.'\)/); assert.match(SCENE, /else if\(k === 'fur'\)\{ if\(PET_FUR_LIST\.includes\(el\.value\) && el\.value !== PET_FUR_LIST\[0\]\) L\.fur = el\.value; else delete L\.fur; \}/, 'the standard coat writes no key');
  assert.match(f, /const vis = can \? `<fieldset class="pet-vis">/, 'the visibility group only with a photo here or on the server');
  assert.ok(!/sh-note off|9b2c1f/.test(f), 'no red text in the photo block');
  assert.match(f, /photoSafe\(P\.shown\) \? `<p class="pet-ex"/, 'the example frame carries a data URL only after the check');
  assert.match(f, /data-sh="pvopen"/); assert.match(SCENE, /if\(a === 'pvopen'\)\{ if\(sel\) viewOpen\('pet', sel, \{ look:/);
  assert.ok(f.indexOf('id="o-pf-auto-${k}"') < f.indexOf('<input type="color" id="o-pf-${k}"'), 'checkbox first, then the swatch');
  assert.match(SCENE, /\.of-drawer \.pet-rng::before\{content:"";position:absolute;left:50%/, 'a tick at the default');
  assert.match(SCENE, /\.of-stage \.of-view\{border-radius:16px!important\}/, 'the profile card\'s corners win over tokens.css');
  assert.match(SCENE, /\.of-view \.x\{flex:none;width:32px;height:32px;display:grid;place-items:center;padding:0;border:1px solid/, 'a bordered square close like the tool buttons');
  assert.ok(!/\.of-view\.photo \.vw-drag\{display:none\}/.test(SCENE) && !/\.of-view\.photo \.vw-art\{background/.test(SCENE), 'one background and one hint line for the three kinds');
  assert.match(SCENE, /vw\.clr = setTimeout\(\(\) => \{ if\(vw && !vw\.on\)\{ vw\.clr = 0; viewClear\(\);/, 'closing clears after the fade');
  assert.match(SCENE, /if\(!info\.photo\) vw\.raf = requestAnimationFrame\(\(\) => \{/, 'the model is built on the next frame');
  assert.match(SCENE, /u\.fur\(vw\.ppu\); \}/, 'fur stays on under reduced motion');
  assert.match(SCENE, /vw\.hold = performance\.now\(\) \+ 2000;/, 'after a drag the auto-turn waits 2 s');
  assert.match(SCENE, /pin: photoSafe\(ph\) \? ph : null/, 'a pet\'s photo beside the model only after the check');
});

test('the scene follows the pets contract with fallbacks: legK in the gait, playZ for the toy, air for the contact disc, carryYaw in the mouth', () => {
  assert.match(SCENE, /const lk = pt => \{ const v = pt\.g\.userData\.legK; return Number\.isFinite\(v\) && v > 0 \? v : 1; \}/);
  assert.match(SCENE, /pz = pt => \{ const v = pt\.g\.userData\.playZ; return Number\.isFinite\(v\) \? Math\.max\(v, PET_PLAY_Z\) : PET_PLAY_Z; \}/);
  assert.deepEqual((SCENE.match(/petGait\(pt\.phase, [^;]*;/g) || []).filter(c => !/lk\(pt\)\);/.test(c)), [], 'every gait call passes the leg factor');
  assert.equal((SCENE.match(/\/ PET_STRIDE\b(?! \*)/g) || []).length, 0, 'every stride divides by PET_STRIDE * legK');
  assert.deepEqual((SCENE.match(/petPlaySeq\([^;]*?\), t: 0/g) || []).filter(c => !/pz\(pt?\)\), t: 0$/.test(c)), [], 'every play sequence starts at the toy distance');
  assert.ok(!/PET_PLAY_Z \* gs/.test(SCENE), 'the toy is put down at the pet\'s own distance');
  assert.match(SCENE, /const toyCarry = t => \{ const v = t\.userData && t\.userData\.carryYaw; return Number\.isFinite\(v\) \? v : Math\.PI \/ 2; \};/);
  assert.match(SCENE, /const airL = Number\.isFinite\(g\.userData\.air\)/); assert.match(SCENE, /pt\.blobMat\.opacity = 0\.34 \* \(0\.3 \+ 0\.7 \* k\)/);
  assert.match(SCENE, /import \* as PETS_NS from '\.\/pets\.js\?v=p6';/, 'newer exports are read off the namespace, so an older pets.js still links');
});

test('an untouched pet form never saves: after the pet is taken out the form shows the default dog, and Save stays off until a field changes', () => {
  assert.match(SCENE, /shopFoot\(P\.dirty, P\.dirty\)\]/, 'the pet tab enables Save only on an edit');
  assert.doesNotMatch(SCENE, /P\.dirty \|\| !P\.had/, 'no pet is no reason to save the default look');
  assert.match(SCENE, /if\(look && P\.dirty\) shopSave\(\{ pet: look \}/, 'the save handler checks the edit too');
});

test('by default a head wears nothing in the season: no Santa hat, antlers or red nose unless HOL_HEADS is turned on', () => {
  assert.equal(HOL_HEADS, false);
  for(const coin of [0.1, 0.9]) assert.deepEqual(headDress({ xmas: true, species: 'fox', coin }), { crown: false, head: null, hol: null });
  assert.deepEqual(headDress({ crown: true, xmas: true }), { crown: true, head: null, hol: null }, 'the crown gets no red nose');
  assert.deepEqual(headDress({ head: 'cap', xmas: true, species: 'fox', coin: 0.1 }), { crown: false, head: 'cap', hol: null }, 'a chosen gear gets no red nose');
  assert.match(SCENE, /function dressOf\(o\)\{[^\n]*xmas, holHeads: HOL_HEADS,/, 'the scene passes the flag');
});

test('team names lie on the floor strip in front of each rug, and picking a person flies to the closest zoom that still shows the desk', () => {
  assert.match(SCENE, /const dm = decal\(zn\.name, zn\.dw, LANE - 0\.3, [^\n]*getStyle\(\)\); dm\.position\.set\(zn\.dx \+ zn\.dw \/ 2, 0\.085, zn\.cz \+ zn\.d \/ 2 - LANE \/ 2\); decals\.push\(dm\);/);
  assert.doesNotMatch(SCENE, /teamSign\(|signs\.push|overlay: \(\) => signs/, 'no upright board stands over the front desks');
  assert.match(SCENE, /function decal\(text, width, height, color\)\{[^]*?maxW = cw - 2 \* pad;/, 'the name gets the whole strip: no ghost badge on the floor');
  assert.match(SCENE, /h\.team\.gh \?/, 'the ghost count is in the hover tip of the team name');
  assert.match(SCENE, /const ZMAX = \(\) => \{[^\n]*Math\.max\(4, /, 'never closer-limited than before');
  assert.match(SCENE, /ppu: \(\) => scale, near: 6,/, 'the office lets one desk with its sitter fill the view');
  assert.match(SCENE, /zoom: view\.zoomMax\(\), ox: side \/ 2 \}\)/, 'a pick flies to that zoom');
});

/* ---- more levels, wings and pet toys (3.130) ---- */
test('LV_MAX is 6, wings are a slot of their own in the shop (tab, tiles, thumbnails, save), and the wing piece hangs on the model like head gear', () => {
  assert.equal(LV_MAX, 6); assert.equal(lvOf(6), 6); assert.equal(lvOf(7), 6);
  assert.deepEqual(shopTiles({ level: 5, items: GEAR_ITEMS.map((g, i) => ({ id: g.id, lvl: 1 + i % 6 })) }, 'back').map(t => t.id), ['angel', 'butterfly', 'bat', 'fairy', 'drake', 'phoenix', 'prism']);
  assert.match(SCENE, /const SHOP_TABS = \['book', 'head', 'back', 'desk', 'pet'\];/, 'the tab order: collection, head, wings, desk, pet');
  assert.match(SCENE, /shop = \{ open: true, tab: 'book',/, 'the shop opens on the collection');
  assert.match(SCENE, /draft\.back !== shop\.base\.back/, 'a changed wing choice is a change to save');
  assert.match(SCENE, /if\(slot !== 'head' && slot !== 'back' && slot !== 'desk'\) return; shop\.draft\[slot\] = v \|\| null;/);
  assert.match(SCENE, /makeBackGear\(T, id\)/); assert.match(SCENE, /g\.rotation\.set\(head \? 0\.35 : back \? 0\.12 : 0, back \? 0\.35 : -0\.45, 0\)/, 'wings are drawn from a little to the side');
  assert.match(SCENE, /\{ const g = backPiece\(m, o, pose\); if\(g\) add\(g\); \}/, 'holDress hangs the wings after the head piece, whatever the crown');
  const bp = SCENE.slice(SCENE.indexOf('function backPiece('), SCENE.indexOf('/* redress a model in place'));
  assert.match(bp, /backAnchors\[key\] = backAnchorOf\(T, m\)/); assert.match(bp, /const key = pose \+ o\.gk/, 'the anchor is read once per pose and species');
  assert.match(bp, /g\.userData\.phase = hash\(String\(o\.p\.id\) \+ ':back'\) \* 10; g\.userData\.keepLook = true; g\.userData\.gearHead = true;/);
  assert.match(bp, /placeBackGear\(g, an, f\); ownDispose\(g\)/); assert.match(bp, /f\.skip\) return null/);
  assert.match(SCENE, /if\(u\.gearHead\) u\.tick\(time, envN, reduced\)/, 'the same step path ticks the wings and passes reduced motion on');
  assert.match(SCENE, /'tab\.book', 'tab\.head', 'tab\.back', 'tab\.desk', 'tab\.pet'/);
});

test('pet toys: the scene picks the chosen toy and otherwise the automatic one exactly as before; the pet tab offers Auto and the ten toys once the toys level is reached', () => {
  assert.match(SCENE, /const toyKindFor = \(look, id\) => \{ if\(look\.toy\) return look\.toy; const tk = petHash\(id \+ ':toy'\) < 0\.5; return look\.kind === 'cat' \? \(tk \? 'yarn' : 'mouse'\) : tk \? 'ball' : 'bone'; \};/, 'the old rule is unchanged');
  assert.match(SCENE, /pt\.toy = makeToy\(T, toyKindFor\(look, id\)\)/);
  assert.match(SCENE, /if\(pt && petRecolor\(pt\.g, want\)\)\{ pt\.look = want; petToyFix\(pt, want\); request\(\); return; \}/, 'a toy chosen in the shop shows on the pet in the room at once');
  assert.match(SCENE, /petToy\(id, kind\)\{[^\n]*petToyReplace\(pt, kind\)/, 'the scripted petToy uses the same swap');
  assert.match(SCENE, /const toyGrp = !toyOn \? '' : /, 'only from the toys level'); assert.match(SCENE, /\['', \.\.\.PET_TOYS\]\.map\(toyTile\)/);
  assert.match(SCENE, /if\(a === 'toy'\)\{ const P = shop\.pet, L = \{ \.\.\.P\.look \}; if\(v\) L\.toy = v; else delete L\.toy;/, 'Auto removes the key');
  assert.match(SCENE, /t\.userData\.kind === 'bell'/, 'a bell rolls like a ball');
  assert.match(SCENE, /id\.startsWith\('toy:'\)[\s\S]{0,200}makeToy\(T, id\.slice\(4\)\)/, 'toy thumbnails are made by the same renderer');
  const ui = shopUi(k => k); for(const t of PET_TOYS) assert.equal(ui.opt['toy.' + t], 'of.pet.toy.' + t);
  assert.equal(ui['pet.toy'], 'of.sh.pet.toy'); assert.equal(ui['pet.toyAuto'], 'of.sh.pet.toyAuto');
  const ko = ['공', '뼈다귀', '털실', '쥐 인형', '원반', '밧줄', '고무 오리', '깃털 장난감', '물고기 인형', '방울 공'];
  assert.deepEqual(PET_TOYS.map(t => OFFICE.ko['of.pet.toy.' + t]), ko);
  for(const lang of ['en', 'ko']) for(const t of PET_TOYS) assert.equal(typeof OFFICE[lang]['of.pet.toy.' + t], 'string', lang + ' ' + t);
  assert.equal(OFFICE.ko['of.sh.pet.toy'], '장난감'); assert.equal(OFFICE.ko['of.sh.pet.toyAuto'], '자동');
});

test('the new gear names: both languages, ko as listed, en short noun phrases', () => {
  const ko = { antenna: '더듬이 머리띠', tiara: '티아라', orbit: '행성 궤도', starcrown: '별 왕관', flame: '불꽃 왕관', aurora: '오로라 고리', angel: '천사 날개', butterfly: '나비 날개', bat: '박쥐 날개', fairy: '요정 날개', drake: '용 날개', phoenix: '불사조 날개', prism: '프리즘 날개', crystalball: '수정 구슬', galaxy: '은하 무드등' };
  for(const [id, name] of Object.entries(ko)){ assert.equal(OFFICE.ko['of.gear.' + id], name, id); assert.equal(typeof OFFICE.en['of.gear.' + id], 'string', id); assert.ok(GEAR_ITEMS.some(g => g.id === id), id); }
  assert.equal(OFFICE.en['of.sh.tab.back'], 'Wings'); assert.equal(OFFICE.ko['of.sh.tab.back'], '날개');
});

/* ---- the collection tab ---- */
const LEVELS6 = [[1, 10, 0], [2, 50, 0.01], [3, 200, 0.05], [4, 1000, 0.1], [5, 2500, 0.15], [6, 5000, 0.2]].map(([lvl, min_spent, min_dlg]) => ({ lvl, min_spent, min_dlg }));
const ITEMS6 = [['cap', 'head', 1], ['beanie', 'head', 1], ['flower', 'head', 2], ['headphones', 'head', 3], ['antenna', 'head', 3], ['angel', 'back', 3], ['plant', 'desk', 1], ['lamp', 'desk', 1], ['galaxy', 'desk', 6], ['phoenix', 'back', 6], ['prism', 'back', 6]].map(([id, slot, lvl]) => ({ id, slot, lvl }));

test('bookOf: one page per level of the server table, lowest first, with done, next and locked states', () => {
  const u = { level: 3, spent: 600, dlg: 0.07, runs: 9, petLvl: 2, toysLvl: 3, levels: [...LEVELS6].reverse(), items: ITEMS6 };
  const b = bookOf(u);
  assert.deepEqual(b.pages.map(p => p.lvl), [1, 2, 3, 4, 5, 6]); assert.deepEqual(b.pages.map(p => p.state), ['done', 'done', 'done', 'next', 'locked', 'locked']);
  assert.deepEqual(b.pages.map(p => [p.spent, p.dlg]), LEVELS6.map(l => [l.min_spent, l.min_dlg]), 'the figures are the server\'s');
  assert.equal(b.total, 11); assert.equal(b.got, 8, 'cap, beanie, plant, lamp, flower, headphones, antenna, angel'); assert.ok(b.got <= b.total);
  const lv = n => b.pages.find(p => p.lvl === n);
  assert.deepEqual(lv(3).items, [{ id: 'headphones', slot: 'head', open: true }, { id: 'antenna', slot: 'head', open: true }, { id: 'angel', slot: 'back', open: true }], 'gear.js order: head, wings, desk');
  assert.deepEqual(lv(6).items, [{ id: 'phoenix', slot: 'back', open: false }, { id: 'prism', slot: 'back', open: false }, { id: 'galaxy', slot: 'desk', open: false }]);
  assert.deepEqual(lv(1).items.map(i => i.id), ['cap', 'beanie', 'plant', 'lamp']);
  assert.deepEqual(b.pages.map(p => p.feats), [[], ['pet'], ['toys'], [], [], []], 'the pet opens on level 2 and the toys on level 3');
});

test('bookOf: progress is only on the next page (clamped, a base of 0 counts as met); reached pages read 1 and locked ones 0', () => {
  const b = bookOf({ level: 3, spent: 600, dlg: 0.07, levels: LEVELS6, items: [] });
  assert.deepEqual(b.pages.map(p => [p.spentK, p.dlgK].map(x => +x.toFixed(6))), [[1, 1], [1, 1], [1, 1], [0.6, 0.7], [0, 0], [0, 0]]);
  const hi = bookOf({ level: 0, spent: 99, dlg: 0.9, levels: LEVELS6, items: [] }).pages[0]; assert.equal(hi.state, 'next'); assert.deepEqual([hi.spentK, hi.dlgK], [1, 1], 'clamped to 1, and a base of 0 is met');
  const lo = bookOf({ level: 0, spent: 4, dlg: 0, levels: LEVELS6, items: [] }).pages[0]; assert.equal(lo.spentK, 0.4);
  const top = bookOf({ level: 6, spent: 9999, dlg: 0.5, levels: LEVELS6, items: ITEMS6 }); assert.ok(top.pages.every(p => p.state === 'done')); assert.equal(top.got, top.total);
  const fresh = bookOf({ level: 0, spent: 0, dlg: 0, levels: LEVELS6, items: ITEMS6 }); assert.equal(fresh.got, 0); assert.deepEqual(fresh.pages.map(p => p.state), ['next', 'locked', 'locked', 'locked', 'locked', 'locked']);
  assert.ok(!/min_spent:\s*\d|min_dlg:\s*\d/.test(SCENE.slice(SCENE.indexOf('export function bookOf'), SCENE.indexOf('export function shopTiles'))), 'no threshold is hard-coded');
});

test('bookOf: unknown item ids are left out, items on a level the table lacks are not counted, and an empty or missing input gives an empty book', () => {
  const b = bookOf({ level: 1, spent: 1, dlg: 0, levels: LEVELS6.slice(0, 2), items: [{ id: 'cap', slot: 'head', lvl: 1 }, { id: 'nope', slot: 'head', lvl: 1 }, null, { id: 'galaxy', slot: 'desk', lvl: 6 }, { id: 'flower', lvl: 2 }] });
  assert.deepEqual(b.pages.map(p => p.items.map(i => i.id)), [['cap'], ['flower']]); assert.deepEqual([b.got, b.total], [1, 2]);
  for(const bad of [null, undefined, {}, { levels: 'x', items: 'y' }]){ const e = bookOf(bad); assert.deepEqual(e, { got: 0, total: 0, pages: [] }); }
});

test('the collection tab: the first tab, one card per level, the level badge in the look of its frame, a stamp, two bars on the next goal, silhouettes for locked items, reduced motion', () => {
  assert.match(SCENE, /tab === 'pet' \? petHtml\(\) : tab === 'book' \? bookHtml\(\) : gearHtml\(tab\)/);
  assert.match(SCENE, /<span class="bk-lv lv-\$\{pg\.lvl\}">/, 'the badge carries the level class'); assert.match(SCENE, /class="bk-card \$\{pg\.state\}"/);
  assert.match(SCENE, /dl \? ui\['book\.need'\] : ui\['book\.need1'\]/, 'level 1 asks for one delegation, the others for a share'); assert.match(SCENE, /bar\(ui\['book\.spent'\][^\n]*\n[^\n]*bar\(ui\['book\.dlg'\]/, 'two bars on the next goal');
  assert.match(SCENE, /bk-stamp/); assert.match(SCENE, /\.bk-stamp\{[^}]*transform:rotate\(-12deg\)/); assert.match(SCENE, /\.bk-t\.lock img\{filter:brightness\(0\);opacity:\.62\}/);
  for(const n of [1, 2, 3, 4, 5, 6]) assert.ok(SCENE.includes('.bk-lv.lv-' + n) || n === 1, 'badge lv-' + n);
  assert.match(SCENE, /@media \(max-width:480px\)\{\.of-drawer \.bk-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/, 'four tiles a row on a phone');
  assert.match(SCENE, /@media \(prefers-reduced-motion:reduce\)\{\.of-drawer \.bk-lv::before,\.of-drawer \.bk-lv::after\{animation:none\}\}/);
  assert.match(SCENE, /if\(a === 'bkgo'\)/, 'a tile goes to its tab and picks the item when it is open');
  for(const k of ['tab.book', 'book.got', 'book.need', 'book.need1', 'book.done', 'book.next', 'book.locked', 'book.spent', 'book.dlg', 'book.pet', 'book.toys', 'slot.head', 'slot.back', 'slot.desk']){
    assert.ok(SHOP_KEYS.includes(k), k); for(const lang of ['en', 'ko']) assert.equal(typeof OFFICE[lang]['of.sh.' + k], 'string', lang + ' ' + k); }
  for(const [k, ko, en] of [['tab.book', '도감', 'Collection'], ['book.got', '모은 꾸미기 {n}/{m}', 'Collected {n}/{m}'], ['book.need', '누적 사용액 {s}, 위임 비율 {d}', 'Total spend {s}, delegation share {d}'], ['book.need1', '누적 사용액 {s}, 위임 1회', 'Total spend {s}, one delegation'],
    ['book.done', '달성', 'Reached'], ['book.next', '다음 목표', 'Next goal'], ['book.locked', '잠김', 'Locked'], ['book.spent', '사용액', 'Spend'], ['book.dlg', '위임 비율', 'Delegation'], ['book.pet', '반려동물', 'Pet'], ['book.toys', '장난감', 'Toys'],
    ['slot.head', '머리', 'Head'], ['slot.back', '날개', 'Wings'], ['slot.desk', '책상', 'Desk']]){ assert.equal(OFFICE.ko['of.sh.' + k], ko, k); assert.equal(OFFICE.en['of.sh.' + k], en, k); }
  for(const k of Object.keys(OFFICE.ko).filter(x => /^of\.sh\.(book|slot)\./.test(x))) assert.ok(!/\u00b7|\u2014/.test(OFFICE.ko[k]), k);
});

test('the member demo shows all six levels in the collection: the server table, the same item ids and levels as the server, the wings worn by the viewer and two coworkers', () => {
  const m = TOWN.match(/const items = (\[\[[\s\S]*?\]\]\.map)/); assert.ok(m, 'the demo item list');
  const rows = [...m[1].matchAll(/\['([a-z]+)', '(head|back|desk)', (\d)\]/g)].map(r => ({ id: r[1], slot: r[2], lvl: +r[3] }));
  assert.equal(rows.length, GEAR_ITEMS.length, 'every catalogue item is in the demo'); for(const g of GEAR_ITEMS) assert.equal(rows.find(r => r.id === g.id).slot, g.slot, g.id);
  const want = { cap: 1, beanie: 1, ribbon: 1, flower: 2, party: 2, headphones: 3, tophat: 3, wizard: 4, halo: 4, antenna: 3, tiara: 4, orbit: 5, starcrown: 5, flame: 6, aurora: 6, angel: 3, butterfly: 4, bat: 4, fairy: 5, drake: 5, phoenix: 6, prism: 6,
    plant: 1, lamp: 1, figurine: 2, snowglobe: 2, trophy: 3, lavalamp: 3, aquarium: 4, neon: 4, crystalball: 5, galaxy: 6 };
  for(const [id, lvl] of Object.entries(want)) assert.equal(rows.find(r => r.id === id).lvl, lvl, id);
  const book = bookOf({ level: 3, spent: 1240, dlg: 0.086, petLvl: 2, toysLvl: 3, levels: LEVELS6, items: rows }); assert.equal(book.pages.length, 6); assert.equal(book.total, 32);
  assert.match(TOWN, /\{ lvl: 5, min_spent: 2500, min_dlg: 0\.07 \}, \{ lvl: 6, min_spent: 5000, min_dlg: 0\.12 \}/);
  assert.match(TOWN, /gear: \{ head: 'tophat', back: 'angel', desk: 'lamp' \}, pet: pets\.me/); assert.equal((TOWN.match(/back: '(drake|phoenix)'/g) || []).length, 2, 'two coworkers wear wings');
  assert.match(TOWN, /\[change\.gear\.head, change\.gear\.back, change\.gear\.desk\]\.some/); assert.match(TOWN, /back: change\.gear\.back \|\| null/);
});

test('the collection cards join their item tiles into one string, so no stray comma lands between the tiles of a level', () => {
  /* a mapped array added to a string becomes "a,b,c": the first build put a comma between every tile and the grid took each comma as a cell */
  assert.match(SCENE, /const tiles = pg\.items\.map\([^\n]*\)\)\.join\(''\)\n\s*\+ pg\.feats\.map\(/);
  assert.match(SCENE, /\.of-drawer \.bk-t\.lock img\{filter:brightness\(0\);opacity:\.62\}/, 'a locked item reads as a dark silhouette');
  assert.doesNotMatch(SCENE, /\.bk-card\.locked\{opacity:/, 'a locked card is not faded on top of its silhouettes');
});

test('the viewer\'s progress is rounded down, so a share or a spend short of the goal never reads as the goal', async () => {
  const { moneyDown, pctDown, fmtMoney } = await import('../site/assets/scene/office-scene.js');
  assert.equal(pctDown(0.009523), '0.9%', '0.952 % is short of 1 % and must not read 1.0 %');
  assert.equal(pctDown(0.01), '1.0%'); assert.equal(pctDown(0.0105), '1.0%'); assert.equal(pctDown(0.15), '15.0%'); assert.equal(pctDown(0.086), '8.6%');
  assert.equal(pctDown(0), '0.0%'); assert.equal(pctDown(undefined), '0.0%');
  assert.equal(fmtMoney(moneyDown(49.996)), '$49.99'); assert.equal(fmtMoney(moneyDown(999.6)), '$999'); assert.equal(fmtMoney(moneyDown(1240)), '$1,240'); assert.equal(fmtMoney(moneyDown(50)), '$50.00');
  assert.equal(moneyDown(null), 0);
  assert.doesNotMatch(SCENE, /pc1 = v => \(v \* 100\)\.toFixed\(1\)/, 'no progress figure rounds up');
  assert.match(SCENE, /bar\(ui\.spent, fm\(moneyDown\(x\.spent\)\)/); assert.match(SCENE, /bar\(ui\['book\.spent'\], fm\(moneyDown\(u\.spent\)\)/);
});

test('the ops office reads org_cosmetics like the team page, so the platform admin sees what members wear', () => {
  /* the ops page mounted the office without cosmetics, so every animal there was bare while the member town showed hats and pets */
  assert.match(OPS, /rpc\('org_cosmetics', \{ p_org_id: sel\.id \}\)/);
  assert.match(OPS, /const \[u, pr, cm\] = await Promise\.all\(\[fetchUsage\(ids\), fetchPrompts\(\), fetchCosmetics\(\)\]\)/);
  assert.match(OPS, /events: Seats\.events\(\), cosmetics,/);
  assert.match(OPS, /rpc\('org_pet_photos', \{ p_org_id: sel\.id, p_member_ids: ids\.slice\(0, 16\) \}\)/);
  const mount = OPS.slice(OPS.indexOf('ctl = mod.mountOfficeScene'), OPS.indexOf('ctl = mod.mountOfficeScene') + 900);
  assert.match(mount, /petPhotos, breeds: petBreeds,/); assert.ok(!/shop:/.test(mount), 'no shop on the ops page');
});

test('every scene module a page loads carries one query, the string table included', () => {
  /* 2026-11-16: office-scene.js moved to 3.129.1-1 by hand while office-i18n.js stayed on 3.129.1, so browsers kept the cached string table and the
     shop showed raw keys (of.sh.tab.book, of.gear.angel). A hand bump has to move every /assets/scene module on the page at once. */
  for(const [name, html] of [['town', TOWN], ['team', TEAM], ['ops', OPS]]){
    const q = [...html.matchAll(/\/assets\/scene\/[a-z0-9-]+\.js\?v=([^'"]+)/g)].map(m => m[1]);
    assert.ok(q.length >= 1, name); assert.equal(new Set(q).size, 1, `${name}: ${q.join(', ')}`);
  }
  const scene = [...TOWN.matchAll(/office-scene\.js\?v=([^'"]+)/g)][0][1];
  assert.equal([...TOWN.matchAll(/office-i18n\.js\?v=([^'"]+)/g)][0][1], scene); assert.equal([...TEAM.matchAll(/office-i18n\.js\?v=([^'"]+)/g)][0][1], scene);
});

test('the ops page loads the office string table, so the unlock level and the gear names are words, not keys', () => {
  /* the ops office showed "of.lv" beside the No. badge once it drew cosmetics: the page kept its own copy of the of.* strings and never loaded office-i18n.js */
  assert.match(OPS, /<script src="\/assets\/scene\/office-i18n\.js\?v=[^"]+"><\/script>/);
  assert.match(OPS, /for\(const lg of \['en', 'ko'\]\)\{ const src = \(window\.SPRAG_OFFICE_I18N \|\| \{\}\)\[lg\] \|\| \{\}; for\(const k in src\) if\(I18N\[lg\]\[k\] === undefined\) I18N\[lg\]\[k\] = src\[k\]; \}/);
  assert.ok(OPS.indexOf('office-i18n.js?v=') < OPS.indexOf('const I18N = {'), 'the table is loaded before the page reads it');
});
