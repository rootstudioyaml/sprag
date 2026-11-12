/**
 * Sprites for the seated office cast (site/assets/scene/sprites.js): which cell to draw and when to fall back to the glb, the manifest reading,
 * the plane geometry, the colour factor at night, and the wiring in office-scene.js and the pages (cache-busting queries).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wrapPi, relAzimuth, pickCell, elevOk, wantVariant, parseManifest, pickVariant, sheetUrl, planeSpec, cellUv, nightTint, zoomOk, cardBlend, cardShow, cardOf, cardUrl, SPRITE_MIN_ZOOM, SPRITE_ZOOM_HYST } from '../site/assets/scene/sprites.js';

const D = Math.PI / 180, COLS = [-34, -17, 0, 17, 34];
const RAW = { v: 7, cell: [384, 448], cols: COLS, elev: 30.4, unitsPerPx: 0.004,
  species: { cat: { anchor: [190, 380], variants: ['plain', 'santa'] }, fox: { anchor: [190, 380], variants: ['plain'] }, bad: { anchor: [1], variants: ['plain'] }, noplain: { anchor: [1, 2], variants: ['santa'] } } };
const read = f => readFileSync(new URL(`../site/${f}`, import.meta.url), 'utf8');

test('relAzimuth: camera azimuth minus the default azimuth minus the body yaw, wrapped', () => {
  assert.equal(relAzimuth(Math.PI / 4, 0), 0);
  assert.ok(Math.abs(relAzimuth(Math.PI / 4 + 0.3, 0.1) - 0.2) < 1e-12);
  assert.ok(Math.abs(relAzimuth(Math.PI / 4 + 2 * Math.PI + 0.2, 0) - 0.2) < 1e-12);   /* a camera that turned a full circle */
  assert.ok(Math.abs(Math.abs(wrapPi(3 * Math.PI)) - Math.PI) < 1e-12);
});

test('pickCell: nearest column, glb beyond 42 degrees', () => {
  assert.deepEqual(pickCell(0, COLS), { k: 2, glb: false });
  assert.deepEqual(pickCell(10 * D, COLS), { k: 3, glb: false });   /* 10 is nearer to 17 than to 0 */
  assert.deepEqual(pickCell(-8 * D, COLS), { k: 2, glb: false });
  assert.deepEqual(pickCell(-30 * D, COLS), { k: 0, glb: false });
  assert.deepEqual(pickCell(41.9 * D, COLS), { k: 4, glb: false });
  assert.equal(pickCell(42.1 * D, COLS).glb, true);
  assert.equal(pickCell(-50 * D, COLS).glb, true);   /* the 50 degree turn of the check screenshots */
  assert.equal(pickCell(Math.PI, COLS).glb, true);
  assert.equal(pickCell(2 * Math.PI + 5 * D, COLS).k, 2);
});

test('pickCell: hysteresis keeps the last cell and the last glb choice near a boundary', () => {
  assert.equal(pickCell(9 * D, COLS).k, 3);   /* 9 is past the 8.5 midpoint */
  assert.equal(pickCell(9 * D, COLS, 42, { k: 2, glb: false }).k, 2);   /* but a sprite that showed cell 2 stays on it for 1 more degree */
  assert.equal(pickCell(11 * D, COLS, 42, { k: 2, glb: false }).k, 3);
  assert.equal(pickCell(9 * D, COLS, 42, { k: 3, glb: false }).k, 3);
  assert.equal(pickCell(41 * D, COLS, 42, { k: 4, glb: true }).glb, true);   /* between 40 and 42 a glb stays a glb */
  assert.equal(pickCell(41 * D, COLS, 42, { k: 4, glb: false }).glb, false);   /* and a sprite stays a sprite */
  assert.equal(pickCell(39.9 * D, COLS, 42, { k: 4, glb: true }).glb, false);
  assert.equal(pickCell(0, COLS, 42, { k: 99, glb: false }).k, 2);   /* a stale previous cell is ignored */
});

test('elevOk: within 12 degrees of the sheet elevation', () => {
  assert.equal(elevOk(30.4 * D, 30.4), true);
  assert.equal(elevOk(42 * D, 30.4), true);
  assert.equal(elevOk(43 * D, 30.4), false);
  assert.equal(elevOk(18 * D, 30.4), false);
});

test('wantVariant: the sheet each year-end choice maps to', () => {
  const skip = new Set(['panda', 'deer']), none = new Set(['eagle']);
  assert.equal(wantVariant(null, 'cat', skip, none), 'plain');
  assert.equal(wantVariant('santa', 'cat', skip, none), 'santa');
  assert.equal(wantVariant('rudolph', 'cat', skip, none), 'reindeer');
  assert.equal(wantVariant('rudolph', 'panda', skip, none), 'nose');   /* a band would tangle with its own ears */
  assert.equal(wantVariant('rudolph', 'eagle', skip, none), 'reindeer');   /* antlers without a nose, on the sheet itself */
  assert.equal(wantVariant('crown', 'cat', skip, none), 'nose');   /* the crown stays 3D and the nose is on the sheet */
  assert.equal(wantVariant('crown', 'eagle', skip, none), 'plain');
});

test('parseManifest: keeps valid species, drops the broken ones, builds the cache-busted URL', () => {
  const m = parseManifest(RAW, '/sprites/');
  assert.deepEqual(Object.keys(m.species).sort(), ['cat', 'fox']);
  assert.equal(m.v, 7); assert.deepEqual(m.cols, COLS);
  assert.equal(sheetUrl(m, 'cat', 'santa'), '/sprites/cat-santa.webp?v=7');
  for(const bad of [null, 'x', {}, { ...RAW, v: 'a' }, { ...RAW, cols: [] }, { ...RAW, cell: [0, 1] }, { ...RAW, unitsPerPx: 0 }, { ...RAW, elev: null }]) assert.equal(parseManifest(bad), null);
});

test('pickVariant: the wanted sheet, else plain with exact false, else null', () => {
  const m = parseManifest(RAW, '/s/');
  assert.deepEqual(pickVariant(m, 'cat', 'santa'), { variant: 'santa', exact: true });
  assert.deepEqual(pickVariant(m, 'cat', 'plain'), { variant: 'plain', exact: true });
  assert.deepEqual(pickVariant(m, 'fox', 'reindeer'), { variant: 'plain', exact: false });
  assert.equal(pickVariant(m, 'lion', 'plain'), null);
  assert.equal(pickVariant(null, 'cat', 'plain'), null);
});

test('planeSpec: the anchor pixel is the plane origin and the height undoes the elevation foreshortening', () => {
  const s = planeSpec([384, 448], [192, 448], 0.01, 60);   /* anchor at the bottom middle */
  assert.ok(Math.abs(s.w - 3.84) < 1e-9); assert.ok(Math.abs(s.h - 4.48 / 0.5) < 1e-9);
  assert.ok(Math.abs(s.dx) < 1e-9);   /* centred horizontally */
  assert.ok(Math.abs(s.dy - s.h / 2) < 1e-9);   /* the bottom edge is at the origin, so the geometry moves up by h/2 */
  const t = planeSpec([100, 200], [0, 0], 1, 0);   /* anchor at the top left */
  assert.deepEqual([t.dx, t.dy], [50, -100]);
});

test('cellUv: one fifth of the sheet per cell', () => {
  assert.deepEqual(cellUv(0, 5), [0, 1, 0.2, 1, 0, 0, 0.2, 0]);
  assert.ok(Math.abs(cellUv(4, 5)[2] - 1) < 1e-12);
});

test('nightTint: 1 by day, about 0.55 and warm at night, lamps lift it', () => {
  assert.deepEqual(nightTint(0), [1, 1, 1]);
  const [r, g, b] = nightTint(1);
  assert.ok(g > 0.5 && g < 0.6 && r > g && b < g, `${r} ${g} ${b}`);
  assert.ok(nightTint(1, 1)[1] > g);
  assert.ok(nightTint(0, 0, 1)[1] < 1);
});

test('zoomOk: sprites from zoom 2, kept until 1.85, so the overview stays glb', () => {
  assert.equal(SPRITE_MIN_ZOOM, 2.0); assert.ok(Math.abs(SPRITE_ZOOM_HYST - 0.15) < 1e-12);
  assert.equal(zoomOk(1, false), false);   /* the default overview */
  assert.equal(zoomOk(1.99, false), false);
  assert.equal(zoomOk(2.0, false), true);
  assert.equal(zoomOk(3.4, false), true);   /* the drawer fly-in */
  assert.equal(zoomOk(1.9, true), true);   /* once on, a small zoom-out keeps them */
  assert.equal(zoomOk(1.85, true), true);
  assert.equal(zoomOk(1.84, true), false);
  assert.equal(zoomOk(1.9, false), false);   /* and a zoom-in has to reach 2.0 first */
});

const YAWS = [0.22, 0.33, 0.44, 0.55, 0.66];
test('cardBlend: the two neighbouring frames and the mix, clamped at both ends', () => {
  const near = (b, i, j, t) => { assert.equal(b.i, i); assert.equal(b.j, j); assert.ok(Math.abs(b.t - t) < 1e-9, `t ${b.t} want ${t}`); };
  near(cardBlend(0.44, YAWS), 2, 3, 0);   /* the reduced-motion yaw is frame 2 untouched */
  near(cardBlend(0.385, YAWS), 1, 2, 0.5);
  near(cardBlend(0.5, YAWS), 2, 3, 6 / 11);
  near(cardBlend(0.22, YAWS), 0, 0, 0);
  near(cardBlend(0.1, YAWS), 0, 0, 0);   /* below the first frame */
  near(cardBlend(0.66, YAWS), 4, 4, 0);
  near(cardBlend(1.2, YAWS), 4, 4, 0);   /* above the last */
  near(cardBlend(0.5, [0.3]), 0, 0, 0);   /* a single frame */
  for(let y = 0.44 - 0.22; y <= 0.44 + 0.22; y += 0.01){ const b = cardBlend(y, YAWS); assert.ok(b.t >= 0 && b.t <= 1 && b.j - b.i <= 1, String(y)); }   /* the whole sway */
});

const CARD = { cell: [480, 640], yaws: YAWS, fov: 26, species: { cat: { cam: [0, 1.2, 4], at: [0, 0.8, 0] }, fox: { cam: [0, 1, 3], at: [0, 0.7, 0] }, bad: { cam: [0, 1], at: [0, 0, 0] }, 'Bad Name': { cam: [0, 1, 2], at: [0, 0, 0] } } };
test('parseManifest: the optional card block, a broken one means no cards and the sprites still work', () => {
  const m = parseManifest({ ...RAW, card: CARD }, '/s/');
  assert.deepEqual(Object.keys(m.card.species).sort(), ['cat', 'fox']);   /* a camera without three coordinates and a bad name are dropped */
  assert.deepEqual(m.card.yaws, YAWS); assert.equal(m.card.fov, 26); assert.deepEqual(m.card.cell, [480, 640]);
  assert.equal(cardUrl(m, 'cat'), '/s/cat-card.webp?v=7');
  assert.deepEqual(cardOf(m, 'cat'), { url: '/s/cat-card.webp?v=7', cam: [0, 1.2, 4], at: [0, 0.8, 0], yaws: YAWS, fov: 26, cell: [480, 640] });
  assert.equal(cardOf(m, 'lion'), null);   /* a species without a card keeps the live portrait */
  assert.equal(cardOf(parseManifest(RAW, '/s/'), 'cat'), null);   /* no card block at all */
  assert.equal(cardOf(null, 'cat'), null);
  for(const bad of [null, 'x', {}, { ...CARD, yaws: [] }, { ...CARD, yaws: [0.3, 0.2] }, { ...CARD, yaws: ['a'] }, { ...CARD, fov: 0 }, { ...CARD, cell: [0, 640] }, { ...CARD, species: {} }, { ...CARD, species: { cat: { cam: [1, 2, 3] } } }]){
    const r = parseManifest({ ...RAW, card: bad }, '/s/');
    assert.ok(r && r.card === null && Object.keys(r.species).length === 2, JSON.stringify(bad));
  }
});

test('wiring: office-scene.js loads sprites.js, honours ?sprite=0, keeps the crown and the profile card in 3D, and the pages carry the cache-busting queries', () => {
  const src = read('assets/scene/office-scene.js');
  assert.match(src, /from '\.\/sprites\.js\?v=s2'/);
  assert.match(src, /sprite=0/);
  assert.match(src, /g\.userData\.keepLook = true/);   /* the crown is drawn in 3D over the sprite */
  assert.match(src, /sprReveal\(o\);\s*\n\s*const m = pr\.m = /);   /* the card clones a whole glb, never the shadow-only one */
  assert.match(src, /sprKit\.dispose\(\)/);
  assert.match(src, /sv\.eok && sv\.zok/);   /* sprites only when zoomed in, on top of the azimuth and elevation checks */
  assert.match(src, /zoomOk\(view\.zoom\(\), sprZoom\)/);
  assert.match(src, /portraitInfo:/);
  assert.match(src, /sprKit\.depthOnly\(m\)/);   /* the card clone keeps only the accessories in colour */
  assert.match(src, /h\.userData\.holPiece = true; if\(pose\) h\.userData\.keepLook = true/);   /* the standing model's holiday pieces stay drawn; every piece is marked for the card */
  const ver = /office-scene\.js\?v=(\d+\.\d+\.\d+(?:-\d+)?)/;   /* any version: the release rewrites the queries to the new version, so a pinned one broke after every release */
  const want = src.match(/import \{[^}]*\} from '\.\/holiday\.js\?v=(g\d+)'/)[1];   /* the import query of holiday.js is unchanged by sprites */
  assert.ok(want);
  const v = read('assets/scene/town-scene.js').match(ver)[1];
  for(const f of ['team', 'ops', 'town']) assert.equal(read(`${f}/index.html`).match(ver)[1], v, f);
});

test('cardShow: a frame holds most of its interval, the accessories follow the shown yaw', () => {
  const Y = [0.22, 0.33, 0.44, 0.55, 0.66];
  const a = cardShow(0.25, Y); assert.equal(a.s, 0); assert.ok(Math.abs(a.y - 0.22) < 1e-9);   /* early in the interval: frame i alone, crisp */
  const b = cardShow(0.385, Y); assert.ok(Math.abs(b.s - 0.5) < 1e-9); assert.ok(Math.abs(b.y - 0.385) < 1e-9);   /* the midpoint is the only half mix */
  const c = cardShow(0.32, Y); assert.equal(c.s, 1); assert.ok(Math.abs(c.y - 0.33) < 1e-9);
  assert.ok(Math.abs(cardShow(0.44, Y).y - 0.44) < 1e-9);   /* reduced motion: frame 2 exactly */
  assert.ok(Math.abs(cardShow(0.9, Y).y - 0.66) < 1e-9);
});
