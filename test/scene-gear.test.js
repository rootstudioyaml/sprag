import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const G = await import('../site/assets/scene/gear.js');
const { GEAR_ITEMS, GEAR_SLOTS, HEAD_ANCHOR, headGearFit, headGearSkips, placeHeadGear } = G;
const SRC = await readFile(new URL('../site/assets/scene/gear.js', import.meta.url), 'utf8');
/* every species with a seated cast model (the ghost wears nothing, but a fit for it must still be sane) */
const SPECIES = (await readdir(new URL('../site/assets/scene/cast/', import.meta.url))).filter(f => f.endsWith('.glb') && !f.endsWith('-pose.glb')).map(f => f.slice(0, -4));

/* The server's _cosmetic_items() in the sprag-team repository carries the same ids and slots and decides the unlock levels.
 * Change both lists together. */
const HEAD_IDS = ['cap', 'beanie', 'ribbon', 'flower', 'party', 'headphones', 'tophat', 'wizard', 'halo'];
const DESK_IDS = ['plant', 'lamp', 'figurine', 'snowglobe', 'trophy', 'lavalamp', 'aquarium', 'neon'];

test('the catalogue is exactly the seventeen ids in two slots, with no unlock levels', () => {
  assert.deepEqual(GEAR_SLOTS, ['head', 'desk']);
  assert.deepEqual(GEAR_ITEMS, [...HEAD_IDS.map(id => ({ id, slot: 'head' })), ...DESK_IDS.map(id => ({ id, slot: 'desk' }))]);
  assert.equal(new Set(GEAR_ITEMS.map(i => i.id)).size, 17, 'ids are unique');
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

test('headGearFit: headphones follow the head width, other pieces keep w = 1', () => {
  assert.ok(headGearFit('headphones', 'lion').w > headGearFit('headphones', 'cat').w, 'the mane is wider than a cat head');
  for(const id of HEAD_IDS.filter(i => i !== 'headphones')) assert.equal(headGearFit(id, 'lion').w, 1, id);
});

/* Species whose model already wears something on the head (the cast glbs are two merged meshes, so it cannot be hidden), or whose horns,
 * antlers or ears leave no clean place for a hat. The shop shows "not shown on your current animal" for these; change it with the fit notes. */
const SKIP_TABLE = {
  husky: ['cap', 'beanie', 'party', 'tophat', 'wizard'],
  panda: ['cap', 'beanie', 'party', 'tophat', 'wizard', 'headphones'],
  raccoon: ['cap', 'beanie', 'party', 'tophat', 'wizard'],
  bear: ['cap', 'beanie', 'party', 'tophat', 'wizard'],
  sheep: ['cap', 'beanie', 'party', 'tophat', 'wizard', 'ribbon'],
  squirrel: ['cap', 'beanie', 'party', 'tophat', 'wizard'],
  chick: ['party', 'tophat', 'wizard'],
  rabbit: ['ribbon', 'tophat', 'wizard'],
  pig: ['ribbon'],
  unicorn: ['tophat', 'wizard'],
  dragon: ['cap', 'party', 'tophat', 'wizard'],
  deer: ['cap', 'beanie', 'party', 'tophat', 'wizard'],
};

test('headGearSkips: the skip table, as data, and headGearFit agrees with it', () => {
  for(const k of [...SPECIES, 'nosuchanimal', undefined]){
    const got = headGearSkips(k);
    assert.ok(Array.isArray(got), String(k));
    assert.deepEqual(got, SKIP_TABLE[k] || [], String(k));
    for(const id of got) assert.ok(HEAD_IDS.includes(id), k + ': ' + id + ' is a head item');
    for(const id of HEAD_IDS) assert.equal(headGearFit(id, k).skip, got.includes(id), k + ' ' + id);
  }
  headGearSkips('panda').push('halo');
  assert.ok(!headGearSkips('panda').includes('halo'), 'callers get a copy');
  assert.ok(SPECIES.every(k => !headGearSkips(k).includes('halo')), 'the halo floats over every head');
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
  for(const fn of ['makeHeadGear', 'makeDeskItem', 'headGearFit', 'headGearSkips', 'placeHeadGear', 'disposeGearShared']) assert.equal(typeof G[fn], 'function', fn);
  for(const id of [...HEAD_IDS, ...DESK_IDS]) assert.match(SRC, new RegExp('\\n  ' + id + '\\(T, K, [bg]'), 'a builder for ' + id);
  assert.match(SRC, /g\.userData\.dispose = K\.dispose;/, 'every piece frees its own materials');
  assert.match(SRC, /bentCone\(T\)/, 'the wizard cone is one smooth bent tube, not stacked cylinders');
});

/* the body of a builder, from its key to the next builder */
const builder = id => { const a = SRC.indexOf('\n  ' + id + '(T, K'); const b = SRC.slice(a + 4).search(/\n  [a-z]+\(T, K/); return SRC.slice(a, b < 0 ? undefined : a + 4 + b); };
const tickOf = id => { const b = builder(id); return b.slice(b.indexOf('userData.tick = '), b.indexOf('\n    };', b.indexOf('userData.tick = '))); };

test('gear.js: every tick takes (t, night, reduced); moving pieces add their own phase and hold still when reduced', () => {
  const ticks = SRC.match(/userData\.tick = \([^)]*\) =>/g) || [];
  assert.equal(ticks.length, 7, 'halo, lamp, figurine, snowglobe, lavalamp, aquarium and neon tick');
  for(const t of ticks) assert.equal(t, 'userData.tick = (t, night, reduced) =>', 'one signature for every piece');
  assert.match(SRC, /const phaseOf = g => Number\(g\.userData\.phase\) \|\| 0;/, 'the phase comes from userData.phase, 0 by default');
  for(const id of ['halo', 'figurine', 'snowglobe', 'lavalamp', 'neon']){
    const tick = tickOf(id);
    assert.match(tick, /\(t, night, reduced\)/, id + ' takes reduced');
    assert.match(tick, /reduced \? (0|1) : /, id + ' freezes its motion when reduced');
    assert.match(tick, /t \+ phaseOf\(g\)/, id + ' moves on its own phase');
  }
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
