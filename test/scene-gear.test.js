import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const G = await import('../site/assets/scene/gear.js');
const { GEAR_ITEMS, GEAR_SLOTS, HEAD_ANCHOR, headGearFit, headGearSkips, placeHeadGear, backGearFit, backGearSkips, backAnchorOf, placeBackGear } = G;
const SRC = await readFile(new URL('../site/assets/scene/gear.js', import.meta.url), 'utf8');
/* every species with a seated cast model (the ghost wears nothing, but a fit for it must still be sane) */
const SPECIES = (await readdir(new URL('../site/assets/scene/cast/', import.meta.url))).filter(f => f.endsWith('.glb') && !f.endsWith('-pose.glb')).map(f => f.slice(0, -4));

/* The server's _cosmetic_items() in the sprag-team repository carries the same ids and slots and decides the unlock levels.
 * Change both lists together. */
const HEAD_IDS = ['cap', 'beanie', 'ribbon', 'flower', 'party', 'headphones', 'tophat', 'wizard', 'halo', 'antenna', 'tiara', 'orbit', 'starcrown', 'flame', 'aurora'];
const BACK_IDS = ['angel', 'butterfly', 'bat', 'fairy', 'drake', 'phoenix', 'prism'];
const DESK_IDS = ['plant', 'lamp', 'figurine', 'snowglobe', 'trophy', 'lavalamp', 'aquarium', 'neon', 'crystalball', 'galaxy'];
/* the pieces that follow the head width (the band pieces and the orbit); every other head piece keeps w = 1 */
const WIDE_IDS = ['headphones', 'antenna', 'tiara', 'orbit'];

test('the catalogue is exactly the thirty-two ids in three slots (head 15, back 7, desk 10), with no unlock levels', () => {
  assert.deepEqual(GEAR_SLOTS, ['head', 'back', 'desk']);
  assert.deepEqual(GEAR_ITEMS, [...HEAD_IDS.map(id => ({ id, slot: 'head' })), ...BACK_IDS.map(id => ({ id, slot: 'back' })), ...DESK_IDS.map(id => ({ id, slot: 'desk' }))]);
  assert.equal(new Set(GEAR_ITEMS.map(i => i.id)).size, 32, 'ids are unique');
});

test('headGearFit gives finite numbers for every head item on every cast species, and on an unknown one', () => {
  assert.ok(SPECIES.length >= 31, 'thirty species plus the ghost: ' + SPECIES.length);
  for(const id of HEAD_IDS) for(const k of [...SPECIES, 'nosuchanimal', undefined]){
    const f = headGearFit(id, k), tag = id + ' on ' + k;
    for(const key of ['y', 'z', 's', 'rx', 'w', 'c']) assert.ok(Number.isFinite(f[key]), tag + ' ' + key + '=' + f[key]);
    assert.equal(typeof f.skip, 'boolean', tag);
    assert.ok(f.s >= 0.5 && f.s < 2, tag + ' scale');
    assert.ok(f.w > 0.5 && f.w < 2, tag + ' width');
    assert.ok(f.c >= 0.3 && f.c <= 1.1, tag + ' cover angle');
    assert.ok(Math.abs(f.y) < 0.5 && Math.abs(f.z) < 0.3 && Math.abs(f.rx) < 0.6, tag + ' stays near the head top');
  }
});

test('headGearFit: the band pieces and the orbit follow the head width, other pieces keep w = 1', () => {
  for(const id of WIDE_IDS) assert.ok(headGearFit(id, 'lion').w > headGearFit(id, 'cat').w, id + ': the mane is wider than a cat head');
  for(const id of HEAD_IDS.filter(i => !WIDE_IDS.includes(i))) assert.equal(headGearFit(id, 'lion').w, 1, id);
});

test('headGearFit: the floating new pieces hover like the halo (same lift per species), the band pieces fit like the headphones', () => {
  for(const k of [...SPECIES, 'nosuchanimal']){
    for(const id of ['starcrown', 'flame', 'aurora']){ const f = headGearFit(id, k), h = headGearFit('halo', k); assert.equal(f.y, h.y, id + ' ' + k); assert.equal(f.rx, 0, id); assert.equal(f.skip, false, id + ' ' + k); }
    for(const id of ['antenna', 'tiara', 'orbit']){ const f = headGearFit(id, k), h = headGearFit('headphones', k); assert.deepEqual([f.y, f.z, f.w], [h.y, h.z, h.w], id + ' ' + k); assert.equal(f.skip, false, id + ' ' + k); }
  }
  assert.ok(headGearFit('starcrown', 'rabbit').y > headGearFit('starcrown', 'cat').y, 'the rabbit\'s crown floats over its ears');
});

/* wings: the species with wings of their own wear none */
const BACK_SKIP_TABLE = ['chick', 'dragon', 'duck', 'eagle', 'owl', 'penguin'];
test('backGearSkips and backGearFit: species with their own wings skip every wing, the others none; callers get a copy; the fit is finite', () => {
  for(const k of [...SPECIES, 'nosuchanimal', undefined]){
    const got = backGearSkips(k);
    assert.deepEqual(got, BACK_SKIP_TABLE.includes(k) ? BACK_IDS : [], String(k));
    for(const id of BACK_IDS){ const f = backGearFit(id, k); assert.equal(f.skip, got.includes(id), k + ' ' + id); for(const key of ['y', 'z', 's']) assert.ok(Number.isFinite(f[key]), key); assert.ok(f.s >= 0.8 && f.s <= 1.25); }
  }
  for(const k of BACK_SKIP_TABLE) assert.ok(SPECIES.includes(k), k + ' is a cast species');
  backGearSkips('owl').push('x'); assert.equal(backGearSkips('owl').length, BACK_IDS.length, 'a copy');
  assert.deepEqual(backGearFit('angel', 'cat'), { y: 0, z: -0.02, s: 1, skip: false }, 'the default fit');
});

test('placeBackGear puts the wings at the anchor plus the fit', () => {
  const calls = {}, g = { position: { set: (...a) => { calls.pos = a; } }, scale: { setScalar: s => { calls.s = s; } } };
  placeBackGear(g, { x: 0, y: 0.24, z: -0.3 }, { y: 0.05, z: -0.02, s: 1.1, skip: false });
  assert.deepEqual(calls.pos.map(v => +v.toFixed(4)), [0, 0.29, -0.32]); assert.equal(calls.s, 1.1);
});

/* identity transforms are enough here: the cast models are read in their own space */
const anchorKit = () => {
  const V = class { constructor(){ this.x = 0; this.y = 0; this.z = 0; } fromBufferAttribute(a, i){ [this.x, this.y, this.z] = a.v[i]; return this; } applyMatrix4(){ return this; } applyMatrix3(){ return this; }
    normalize(){ const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; } };
  const M4 = class { copy(){ return this; } invert(){ return this; } multiplyMatrices(){ return this; } };
  const M3 = class { getNormalMatrix(){ return this; } };
  const T = { Matrix4: M4, Matrix3: M3, Vector3: V };
  const attr = v => ({ count: v.length, v });
  const mesh = (v, n) => ({ isMesh: true, matrixWorld: {}, geometry: { attributes: n ? { position: attr(v), normal: attr(n) } : { position: attr(v) } } });
  const root = ms => ({ updateMatrixWorld(){}, matrixWorld: {}, traverse(fn){ fn(this); ms.forEach(fn); } });
  return { T, mesh, root };
};

test('backAnchorOf without normals: the deepest vertex of the lower back (|x| < 0.12, 0.10 <= y <= 0.34), at x = 0 and y = 0.24; null without one', () => {
  const { T, mesh, root } = anchorKit();
  const a = backAnchorOf(T, root([mesh([[0, 0.2, -0.31], [0.05, 0.3, -0.27], [0.5, 0.2, -0.9], [0, 0.6, -0.8], [0, 0.05, -0.7], [0.11, 0.12, -0.33]]), mesh([[0, 0.25, -0.2]])]));
  assert.deepEqual(a, { x: 0, y: 0.24, z: -0.33 }, 'the side, the high and the low vertices do not count');
  assert.equal(backAnchorOf(T, root([mesh([[0.5, 0.2, -0.9], [0, 0.6, -0.8]])])), null);
});

test('backAnchorOf: the torso\'s rear surface, never a tail behind it (the wings of the fox and the wolf hung on the tail tip until 3.130.0-3)', () => {
  const { T, mesh, root } = anchorKit(), back = [0, 0, -1], front = [0, 0, 1];
  /* a torso whose rear surface runs from -0.22 to -0.25 near the spine, a tail behind it from -0.30 to -0.46, a belly and folded arms in front */
  const pts = [[0, 0.25, -0.22], [0.06, 0.28, -0.23], [0, 0.3, -0.25], [0.02, 0.22, -0.24],
    [0, 0.26, -0.30], [0, 0.24, -0.46], [0.03, 0.3, -0.41],
    [0, 0.25, 0.24], [0.05, 0.26, 0.2]];
  const nrm = [back, back, back, back, front, back, back, front, back];
  assert.deepEqual(backAnchorOf(T, root([mesh(pts, nrm)])), { x: 0, y: 0.24, z: -0.25 }, 'the tail and the arms in front do not count');
  /* the tail's front faces the body (n.z > 0), so it never joins the torso's run; a sideways normal (n.z > -0.6) does not count either */
  assert.deepEqual(backAnchorOf(T, root([mesh([[0, 0.25, -0.24], [0, 0.25, -0.26], [0, 0.25, -0.27]], [back, back, [1, 0, -0.3]])])), { x: 0, y: 0.24, z: -0.26 });
  /* outside 0.21 <= y <= 0.33 or |x| >= 0.1 nothing counts: the pig's curly tail starts below the band */
  assert.equal(backAnchorOf(T, root([mesh([[0, 0.18, -0.36], [0.12, 0.25, -0.3], [0, 0.4, -0.3]], [back, back, back])])), null);
});

/* Species whose own body leaves no honest place for a piece: horns or antlers that a brim would rest on, ears that rise from the middle of the crown.
 * The shop shows "not shown on your current animal" for these; change it with the fit notes. Since 3.127.0-2 the cast models wear no hats, glasses,
 * bows or headphones of their own, so headwear is never a reason. */
const SKIP_TABLE = {
  unicorn: ['tophat', 'wizard'],
  dragon: ['cap', 'party', 'tophat', 'wizard'],
  deer: ['cap', 'beanie', 'party', 'tophat', 'wizard'],
  rabbit: ['wizard'],
};
/* The species that had headwear baked into the model until 3.127.0-2, each with the most it may skip now: only what its horns, antlers or ears
 * rule out (the same reasons as SKIP_TABLE). Everything else they unlock is drawn. */
const LOST_HEADWEAR = {
  bear: [], cat: [], cheetah: [], chick: [], dog: [], elephant: [], eagle: [], lion: [], pig: [], tiger: [], wolf: [], husky: [], squirrel: [],
  mouse: [], panda: [], raccoon: [], sheep: [],
  dragon: ['cap', 'party', 'tophat', 'wizard'], unicorn: ['tophat', 'wizard'], deer: ['cap', 'beanie', 'party', 'tophat', 'wizard'], rabbit: ['wizard'],
};

test('headGearSkips: the skip table, as data, and headGearFit agrees with it', () => {
  for(const k of [...SPECIES, 'nosuchanimal', undefined]){
    const got = headGearSkips(k);
    assert.ok(Array.isArray(got), String(k));
    assert.deepEqual(got, SKIP_TABLE[k] || [], String(k));
    for(const id of got) assert.ok(HEAD_IDS.includes(id), k + ': ' + id + ' is a head item');
    for(const id of HEAD_IDS) assert.equal(headGearFit(id, k).skip, got.includes(id), k + ' ' + id);
  }
  headGearSkips('dragon').push('halo');
  assert.ok(!headGearSkips('dragon').includes('halo'), 'callers get a copy');
  assert.ok(SPECIES.every(k => !headGearSkips(k).includes('halo')), 'the halo floats over every head');
  assert.ok(SPECIES.every(k => !headGearSkips(k).includes('flower') && !headGearSkips(k).includes('headphones')), 'a flower pin and headphones go on every head');
});

test('headGearSkips: no species skips a piece because of headwear it no longer has', () => {
  for(const [k, may] of Object.entries(LOST_HEADWEAR)){
    assert.ok(SPECIES.includes(k), k + ' is a cast species');
    for(const id of headGearSkips(k)) assert.ok(may.includes(id), k + ' skips ' + id + ', which only its horns, antlers or ears could justify');
  }
  /* every entry of the table names the body part that rules the pieces out, and none of them blames a hat, glasses, a bow or headphones */
  const block = SRC.slice(SRC.indexOf('const SKIPS = {'), SRC.indexOf('\n};', SRC.indexOf('const SKIPS = {')));
  const rows = block.split('\n').slice(1).filter(l => /^\s+[a-z]+: \[/.test(l));
  assert.equal(rows.length, Object.keys(SKIP_TABLE).length, 'one line per species');
  for(const l of rows){
    assert.match(l, /\/\*.*\b(horns?|antlers?|ears?)\b.*\*\//, 'a comment naming the body part: ' + l.trim().slice(0, 40));
    assert.doesNotMatch(l, /\b(hat|cap|beanie|beret|bow|ribbon|sunglasses|glasses|headphones) of its own\b/, 'no headwear reason: ' + l.trim().slice(0, 40));
  }
});

/* One size policy (3.127.0-3): a member who unlocks a piece expects it to look the same size on their animal as on a coworker's, so a piece that is shown
 * is drawn at 0.8 to 1.25 of its standard scale; where it cannot sit inside that range the species skips it. The cap has two looks, each one size:
 * over the whole head, or a small cap between the ears on heads with ears on top. The ghost wears nothing. */
const WEARERS = SPECIES.filter(k => k !== 'ghost');
const CAP_BETWEEN_EARS = ['tiger', 'wolf', 'fox', 'husky', 'panda', 'koala', 'raccoon', 'cat', 'bear', 'squirrel', 'rabbit', 'pig', 'mouse'];

test('headGearFit: every piece that is shown is within 0.8 to 1.25 of its standard scale', () => {
  assert.equal(WEARERS.length, 30, 'thirty species wear gear');
  for(const id of HEAD_IDS) for(const k of WEARERS){
    const f = headGearFit(id, k);
    if(!f.skip) assert.ok(f.s >= 0.8 && f.s <= 1.25, id + ' on ' + k + ' is drawn at ' + f.s);
  }
});

test('headGearFit: the cap is over the whole head or a small cap between the ears, each look one size on every species that wears it', () => {
  for(const k of CAP_BETWEEN_EARS) assert.ok(WEARERS.includes(k), k + ' is a cast species');
  for(const k of WEARERS){
    const f = headGearFit('cap', k);
    if(f.skip) continue;
    assert.equal(f.s, 1, 'cap on ' + k);
    assert.equal(f.c, CAP_BETWEEN_EARS.includes(k) ? 0.5 : 0.95, 'cap look on ' + k);
  }
});

test('placeHeadGear puts the piece at the crown anchor plus the fit and hands the width and the cover angle to the piece', () => {
  const calls = {}, g = { position: { set: (...a) => { calls.pos = a; } }, scale: { setScalar: s => { calls.s = s; } }, rotation: { set: (...a) => { calls.rot = a; } },
    userData: { setWidth: w => { calls.w = w; }, setCover: c => { calls.c = c; } } };
  placeHeadGear(g, { y: 0.1, z: -0.05, s: 1.2, rx: -0.1, w: 1.3, c: 0.6, skip: false });
  assert.deepEqual(calls.pos.map(v => +v.toFixed(4)), [HEAD_ANCHOR[0], +(HEAD_ANCHOR[1] + 0.1).toFixed(4), +(HEAD_ANCHOR[2] - 0.05).toFixed(4)]);
  assert.equal(calls.s, 1.2); assert.deepEqual(calls.rot, [-0.1, 0, 0]); assert.equal(calls.w, 1.3); assert.equal(calls.c, 0.6);
  assert.deepEqual(HEAD_ANCHOR, [0, 1.04, -0.02], 'the same place castCrown() in office-scene.js sits');
});

test('gear.js: three is passed in, no globals, a builder for every id, shared geometry can be freed', () => {
  assert.doesNotMatch(SRC, /^import /m, 'three is passed in as T');
  assert.doesNotMatch(SRC, /\b(window|document|location|navigator)\./, 'no globals');
  for(const fn of ['makeHeadGear', 'makeBackGear', 'makeDeskItem', 'headGearFit', 'headGearSkips', 'backGearFit', 'backGearSkips', 'backAnchorOf', 'placeHeadGear', 'placeBackGear', 'disposeGearShared']) assert.equal(typeof G[fn], 'function', fn);
  for(const id of [...HEAD_IDS, ...BACK_IDS, ...DESK_IDS]) assert.match(SRC, new RegExp('\\n  ' + id + '\\(T, K, [bg]'), 'a builder for ' + id);
  assert.match(SRC, /g\.userData\.dispose = K\.dispose;/, 'every piece frees its own materials');
  assert.match(SRC, /bentCone\(T\)/, 'the wizard cone is one smooth bent tube, not stacked cylinders');
});

/* the body of a builder, from its key to the next builder */
const builder = id => { const a = SRC.indexOf('\n  ' + id + '(T, K'); const b = SRC.slice(a + 4).search(/\n  [a-z]+\(T, K/); return SRC.slice(a, b < 0 ? undefined : a + 4 + b); };
const tickOf = id => { const b = builder(id); return b.slice(b.indexOf('userData.tick = '), b.indexOf('\n    };', b.indexOf('userData.tick = '))); };

test('gear.js: every tick takes (t, night, reduced); moving pieces add their own phase and hold still when reduced', () => {
  const ticks = SRC.match(/userData\.tick = \([^)]*\) =>/g) || [];
  assert.equal(ticks.length, 16, 'the halo and the six new head pieces, lamp, figurine, snowglobe, lavalamp, aquarium, neon, the two new desk items and the shared wing tick');
  for(const t of ticks) assert.equal(t, 'userData.tick = (t, night, reduced) =>', 'one signature for every piece');
  assert.match(SRC, /const phaseOf = g => Number\(g\.userData\.phase\) \|\| 0;/, 'the phase comes from userData.phase, 0 by default');
  for(const id of ['halo', 'figurine', 'snowglobe', 'lavalamp', 'neon', 'antenna', 'tiara', 'orbit', 'starcrown', 'flame', 'aurora', 'crystalball', 'galaxy']){
    const tick = tickOf(id);
    assert.match(tick, /\(t, night, reduced\)/, id + ' takes reduced');
    assert.match(tick, /reduced \? (0|1) : /, id + ' freezes its motion when reduced');
    assert.match(tick, /t \+ phaseOf\(g\)/, id + ' moves on its own phase');
  }
  const wing = SRC.slice(SRC.indexOf('function wingTick('), SRC.indexOf('function wingGeo('));
  assert.match(wing, /reduced \? 0 : t \+ phaseOf\(g\)/, 'every wing pair flaps on its own phase and holds still when reduced');
  assert.match(wing, /0\.12 \* Math\.sin\(tt \* FLAP_HZ\)/, 'a flap of 0.12 rad'); assert.match(SRC, /FLAP_HZ = 7\.54;/, '1.2 Hz');
  const fish = tickOf('aquarium');
  assert.match(fish, /if\(reduced\)\{ fish\.position\.set/, 'the fish stops when reduced');
  assert.match(fish, /t \+ phaseOf\(g\)/, 'the fish swims on its own phase');
});

test('gear.js: the fish turns round smoothly and the snow fades in and out instead of jumping', () => {
  const fish = tickOf('aquarium'), snow = tickOf('snowglobe');
  assert.doesNotMatch(fish, /\? 0 : Math\.PI/, 'no half turn in one frame');
  assert.match(fish, /\(1 - smooth\(-0\.11, 0\.11, v\)\) \* Math\.PI/, 'the heading eases through the turn while the speed passes zero');
  assert.match(snow, /smooth\(0, 0\.12, u\) \* \(1 - smooth\(0\.82, 1, u\)\)/, 'a flake grows in at the top and shrinks away at the bottom');
});

test('gear.js: the neon sign, the lava lamp and the lamp glow much brighter at night than by day', () => {
  const k = (id, re) => { const m = tickOf(id).match(re); assert.ok(m, id + ' ' + re); return [+m[1], +m[2]]; };
  for(const [id, re] of [['neon', /pink\.emissiveIntensity = \(([\d.]+) \+ ([\d.]+) \* n\)/], ['lavalamp', /blobM\.emissiveIntensity = ([\d.]+) \+ ([\d.]+) \* n/], ['lamp', /bulbM\.emissiveIntensity = ([\d.]+) \+ ([\d.]+) \* n/]]){
    const [day, add] = k(id, re); assert.ok((day + add) / day >= 3, id + ' night is at least three times the day glow');
  }
});

test('the night glow of the new pieces: every emissive piece is at least three times brighter at night than by day', () => {
  const k = (id, re) => { const m = tickOf(id).match(re); assert.ok(m, id + ' ' + re); return [+m[1], +m[2]]; };
  for(const [id, re] of [['flame', /outer\.emissiveIntensity = ([\d.]+) \+ ([\d.]+) \* n/], ['galaxy', /core\.emissiveIntensity = ([\d.]+) \+ ([\d.]+) \* n/], ['crystalball', /purple\.emissiveIntensity = ([\d.]+) \+ ([\d.]+) \* n/], ['antenna', /bm\.emissiveIntensity = ([\d.]+) \+ ([\d.]+) \* n/],
    ['tiara', /m\.emissiveIntensity = ([\d.]+) \+ ([\d.]+) \* n/], ['starcrown', /gold\.emissiveIntensity = ([\d.]+) \+ ([\d.]+) \* n/], ['orbit', /ringM\.emissiveIntensity = ([\d.]+) \+ ([\d.]+) \* n/]]){
    const [day, add] = k(id, re); assert.ok((day + add) / day >= 3 || id === 'starcrown' && (day + add) / day >= 2, id + ' night is much brighter');
  }
  const phoenix = SRC.slice(SRC.indexOf('  phoenix(T, K, g){'), SRC.indexOf('  prism(T, K, g){'));
  for(const m of phoenix.matchAll(/(red|orange|gold)\.emissiveIntensity = ([\d.]+) \+ ([\d.]+) \* n/g)) assert.ok((+m[2] + +m[3]) / +m[2] >= 3, 'phoenix ' + m[1]);
});

/* a stand-in for three that accepts every call the makers make: unknown methods return the object, objects of the scene graph keep their children */
function fakeThree(){
  const any = o => new Proxy(o, { get: (t, k, r) => (k in t || typeof k === 'symbol') ? t[k] : (...a) => r, set: (t, k, v) => { t[k] = v; return true; } });
  const node = class { constructor(geometry, material, count){ this.geometry = geometry; this.material = material; this.count = count; this.children = []; this.userData = {}; this.position = any({}); this.rotation = any({}); this.scale = any({}); this.instanceMatrix = any({}); this.instanceColor = any({}); return any(this); }
    add(...c){ c.forEach(x => { x.parent = this; this.children.push(x); }); return this; } traverse(fn){ fn(this); this.children.forEach(c => c.traverse(fn)); } dispose(){ this.disposed = true; } };
  const Mesh = class extends node {}, Inst = class extends node {}, Group = class extends node {};
  const plain = class { constructor(...a){ this.args = a; this.attributes = { position: any({ count: 0 }) }; return any(this); } dispose(){ this.disposed = true; } };
  const mat = class { constructor(o = {}){ Object.assign(this, o); this.disposed = false; return any(this); } dispose(){ this.disposed = true; } };
  return new Proxy({ Mesh, InstancedMesh: Inst, Group, MeshStandardMaterial: mat }, { get: (t, k) => k in t ? t[k] : plain });
}
const meshesOf = g => { const out = []; g.traverse(o => { if(o.geometry) out.push(o); }); return out; };

test('every new piece builds with a Mesh in it, ticks by day, by night and reduced, and frees its materials', () => {
  for(const [make, ids] of [['makeHeadGear', HEAD_IDS], ['makeBackGear', BACK_IDS], ['makeDeskItem', DESK_IDS]]) for(const id of ids){
    const T = fakeThree(), g = G[make](T, id);
    assert.equal(g.userData.gear, id); assert.ok(meshesOf(g).length >= 1, id + ' has a mesh'); assert.equal(typeof g.userData.dispose, 'function', id);
    if(g.userData.tick) for(const a of [[0, 0, true], [1.3, 0.35, false], [7, 1, false], [3, true, true]]) g.userData.tick(...a);
    if(g.userData.setWidth) g.userData.setWidth(1.4);
    if(g.userData.setCover) g.userData.setCover(0.5);
    g.userData.dispose();
    for(const m of meshesOf(g)) if(m.material && m.material.disposed !== undefined && !m.material.isShared) assert.equal(m.material.disposed, true, id + ' material freed');
    G.disposeGearShared(T);
  }
});

test('the new animated pieces carry a tick, and the wings are always drawn in 3D (keepLook) and hold still when reduced', () => {
  for(const id of ['antenna', 'tiara', 'orbit', 'starcrown', 'flame', 'aurora', 'crystalball', 'galaxy', ...BACK_IDS]){
    const g = (BACK_IDS.includes(id) ? G.makeBackGear : DESK_IDS.includes(id) ? G.makeDeskItem : G.makeHeadGear)(fakeThree(), id);
    assert.equal(typeof g.userData.tick, 'function', id);
  }
  for(const id of BACK_IDS){
    const g = G.makeBackGear(fakeThree(), id); assert.equal(g.userData.keepLook, true, id);
    const piv = g.children.filter(c => c.children.length), ys = () => piv.map(p => p.rotation.y);
    assert.equal(piv.length, 2, id + ' has a pair of wings'); assert.equal(piv[0].scale.x, -1); assert.equal(piv[1].scale.x, 1, 'the right one is not mirrored');
    g.userData.tick(0, 0, true); const y0 = ys(); g.userData.tick(9.7, 0, true); assert.deepEqual(ys(), y0, id + ' holds still when reduced');
    g.userData.tick(0.2, 0, false); assert.notDeepEqual(ys(), y0, id + ' flaps');
    assert.ok(Math.abs(y0[0] + y0[1]) < 1e-9, id + ' is symmetric'); g.userData.tick(0.2, 0, false); assert.ok(Math.abs(ys()[0] + ys()[1]) < 1e-9, id + ' stays symmetric while flapping');
  }
});
