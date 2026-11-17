import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../site/assets/scene/pets.js');
const { normalizePetLook, petLookFromPixels, petPlan, pickPets, petHash, pastel, hexToOklab, PET_KINDS, PET_PATTERNS, PET_EARS, PET_TAILS, PET_SIZES, PET_DEFAULTS, PET_ACTS } = P;

test('the enum lists the server validates with are exported', () => {
  assert.deepEqual(PET_KINDS, ['dog', 'cat']);
  assert.deepEqual(PET_PATTERNS, ['solid', 'patch', 'tabby', 'tuxedo', 'point', 'bicolor', 'saddle', 'spots', 'calico']);
  assert.deepEqual(PET_EARS, ['up', 'flop', 'fold', 'half']);
  assert.deepEqual(P.PET_MARKS, ['socks', 'chest', 'blaze', 'tip']);
  assert.deepEqual(P.PET_NUMS, ['snout', 'earsize', 'legs', 'length', 'build']);
  assert.deepEqual(P.PET_HEX_KEYS, ['eye', 'nose', 'collar', 'mark']);
  assert.deepEqual(PET_DEFAULTS, { kind: 'dog', pattern: 'solid', ear: 'up', tail: 'long', size: 'm', fluff: 0.5 }, 'no v2 default leaks into old looks');
  assert.deepEqual(PET_TAILS, ['long', 'short', 'curl', 'fluff']);
  assert.deepEqual(PET_SIZES, ['s', 'm', 'l']);
  assert.equal(P.PET_MAX, 16);
});

test('normalizePetLook: a valid look comes back whole, hex is lower-cased', () => {
  const raw = { kind: 'cat', coat: ['#FFAA00', '#112233'], pattern: 'tabby', ear: 'fold', tail: 'fluff', size: 'l', fluff: 0.8, name: 'Nabi' };
  assert.deepEqual(normalizePetLook(raw), { ...raw, coat: ['#ffaa00', '#112233'] });
});

test('normalizePetLook: bad colours are dropped, at most three are kept, an empty coat is null', () => {
  assert.deepEqual(normalizePetLook({ coat: ['red', '#12345', '#abcdef', 7, '#000000', '#111111', '#222222'] }).coat, ['#abcdef', '#000000', '#111111']);
  assert.deepEqual(normalizePetLook({ coat: '#ABCDEF' }).coat, ['#abcdef'], 'a single string is one colour');
  for(const bad of [null, undefined, 'dog', [], {}, { coat: [] }, { coat: ['nope'] }, { coat: ['#fff'] }]) assert.equal(normalizePetLook(bad), null, JSON.stringify(bad));
});

test('normalizePetLook: unknown enums fall back to the defaults, fluff is clamped, the name is trimmed to 20', () => {
  const l = normalizePetLook({ coat: ['#ffffff'], kind: 'horse', pattern: 'zebra', ear: 'x', tail: 'y', size: 'xl', fluff: 9, name: '  ' + 'a'.repeat(30) });
  assert.equal(l.kind, PET_DEFAULTS.kind); assert.equal(l.pattern, PET_DEFAULTS.pattern); assert.equal(l.ear, PET_DEFAULTS.ear);
  assert.equal(l.tail, PET_DEFAULTS.tail); assert.equal(l.size, PET_DEFAULTS.size); assert.equal(l.fluff, 1); assert.equal(l.name, 'a'.repeat(20));
  assert.equal(normalizePetLook({ coat: ['#ffffff'], fluff: -2 }).fluff, 0);
  assert.equal(normalizePetLook({ coat: ['#ffffff'], fluff: 'abc' }).fluff, PET_DEFAULTS.fluff);
  assert.equal('name' in normalizePetLook({ coat: ['#ffffff'], name: ' \n ' }), false, 'a blank name is left out');
  assert.equal(normalizePetLook({ coat: ['#ffffff'], name: '😺'.repeat(25) }).name, '😺'.repeat(20), 'the cap counts characters, not UTF-16 units');
  assert.equal('photo' in normalizePetLook({ coat: ['#ffffff'], photo: 'data:x' }), false, 'the photo travels beside the look, not inside it');
});

/* synthetic photos: a background with an ellipse of fur painted by fn(x, y) */
function photo(w, h, bg, fn){
  const a = new Uint8ClampedArray(w * h * 4);
  for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
    const dx = (x - w / 2) / (w * 0.36), dy = (y - h / 2) / (h * 0.36), c = dx * dx + dy * dy < 1 ? fn(x, y) : bg, o = 4 * (y * w + x);
    a[o] = c[0]; a[o + 1] = c[1]; a[o + 2] = c[2]; a[o + 3] = 255;
  }
  return a;
}

test('petLookFromPixels: a white dog on green grass is one white coat, solid', () => {
  const r = petLookFromPixels(photo(120, 90, [60, 140, 60], () => [245, 245, 240]), 120, 90);
  assert.equal(r.coat.length, 1, JSON.stringify(r));
  assert.equal(r.pattern, 'solid');
  assert.ok(hexToOklab(r.coat[0])[0] > 0.9, 'it stays white');
  assert.ok(Math.hypot(...hexToOklab(r.coat[0]).slice(1)) < 0.03, 'no green leaks in');
});

test('petLookFromPixels: black with a white chest suggests tuxedo, and black becomes charcoal', () => {
  const r = petLookFromPixels(photo(100, 100, [150, 150, 150], (x, y) => Math.hypot(x - 50, y - 58) < 12 ? [240, 240, 238] : [22, 22, 26]), 100, 100);
  assert.equal(r.pattern, 'tuxedo', JSON.stringify(r));
  const L = r.coat.map(h => hexToOklab(h)[0]);
  assert.ok(Math.min(...L) > 0.3 && Math.min(...L) < 0.45, 'dark charcoal, not pure black');
  assert.ok(Math.max(...L) > 0.85);
});

test('petLookFromPixels: narrow stripes of two shades of orange suggest tabby, the lighter shade leads and keeps its hue', () => {
  const r = petLookFromPixels(photo(100, 100, [90, 120, 200], (x) => (x >> 2) % 2 ? [230, 140, 60] : [150, 80, 35]), 100, 100);
  assert.equal(r.pattern, 'tabby', JSON.stringify(r));
  assert.ok(r.edges >= P.TABBY_EDGES);
  assert.ok(hexToOklab(r.coat[0])[0] > hexToOklab(r.coat[1])[0], 'the coat is the lit shade, the stripes the darker one');
  const [, a, b] = hexToOklab(r.coat[0]);
  assert.ok(a > 0.02 && b > 0.05, 'orange: red and yellow both positive');
  assert.ok(Math.abs(r.shares.reduce((s, v) => s + v, 0) - 1) < 0.03);
});

test('petLookFromPixels: the same two shades in broad bands are shading on one coat, so solid', () => {
  const r = petLookFromPixels(photo(100, 100, [90, 120, 200], (x) => x < 50 ? [230, 140, 60] : [150, 80, 35]), 100, 100);
  assert.equal(r.pattern, 'solid', JSON.stringify(r));
  assert.ok(r.edges < P.TABBY_EDGES);
});

test('petLookFromPixels: a white chest that matches a white wall survives (the background is flood-filled from the border)', () => {
  const r = petLookFromPixels(photo(100, 100, [238, 238, 234], (x, y) => Math.hypot(x - 50, y - 58) < 12 ? [240, 240, 238] : [22, 22, 26]), 100, 100);
  assert.equal(r.pattern, 'tuxedo', JSON.stringify(r));
  assert.ok(hexToOklab(r.coat[0])[0] < 0.45 && hexToOklab(r.coat[1])[0] > 0.85, 'dark first, then the white');
});

test('petLookFromPixels: green grass and blue sky barely count even inside the frame (fur prior), and at most three colours come back', () => {
  const r = petLookFromPixels(photo(120, 120, [70, 150, 60], (x, y) => y < 50 ? [80, 140, 230] : x < 45 ? [60, 170, 80] : [205, 150, 90]), 120, 120);
  assert.ok(r.coat.length <= 3);
  const [, a, b] = hexToOklab(r.coat[0]);
  assert.ok(a > 0.01 && b > 0.04, 'the warm coat leads: ' + JSON.stringify(r));
});

test('pastel: black turns charcoal without a colour cast, brown keeps its lightness, near-white goes whiter', () => {
  const blk = pastel(hexToOklab('#120d06'));
  assert.ok(blk[0] > 0.34 && blk[0] < 0.42 && Math.hypot(blk[1], blk[2]) < 0.01, JSON.stringify(blk));
  const br = hexToOklab('#8b5a2b'), pb = pastel(br);
  assert.ok(Math.abs(pb[0] - br[0]) < 1e-9, 'mid tones keep their lightness');
  assert.ok(Math.abs(Math.atan2(pb[2], pb[1]) - Math.atan2(br[2], br[1])) < 1e-9, 'and their hue');
  assert.ok(pastel(hexToOklab('#d8d6d0'))[0] > hexToOklab('#d8d6d0')[0]);
});

test('petHash spreads keys that differ only in a trailing counter (plain FNV-1a does not)', () => {
  const v = Array.from({ length: 20 }, (_, n) => petHash('demo-org-m9:pet:r' + n + 'a'));
  assert.ok(Math.max(...v) - Math.min(...v) > 0.6, v.join(' '));
  assert.equal(petHash('x'), petHash('x'));
});

test('petLookFromPixels: a pet that fills the frame is not mistaken for background', () => {
  const w = 64, h = 64, a = new Uint8ClampedArray(w * h * 4);
  for(let i = 0; i < w * h; i++){ a[4 * i] = 200; a[4 * i + 1] = 150; a[4 * i + 2] = 90; a[4 * i + 3] = 255; }
  const r = petLookFromPixels(a, w, h);
  assert.equal(r.coat.length, 1); assert.equal(r.pattern, 'solid');
  assert.equal(petLookFromPixels(new Uint8ClampedArray(16), 2, 2), null, 'fully transparent gives null');
});

test('petPlan: the same seed gives the same sequence, every act shows up, calm acts never repeat back to back', () => {
  const run = seed => { const out = []; let a = petPlan(seed, 0, 0); for(let i = 0; i < 300; i++){ out.push(a); a = petPlan(seed, a.n + 1, a.t1, a.kind); } return out; };
  const A = run('u1'), B = run('u1'), C = run('u2');
  assert.deepEqual(A, B);
  assert.notDeepEqual(A.map(a => a.kind), C.map(a => a.kind));
  assert.deepEqual(new Set(A.map(a => a.kind)), new Set(PET_ACTS));
  for(let i = 1; i < A.length; i++){
    assert.ok(A[i].t0 > A[i - 1].t1 && A[i].t1 > A[i].t0, 'acts follow each other with a pause');
    if(A[i].kind !== 'roam') assert.notEqual(A[i].kind, A[i - 1].kind);
  }
  assert.deepEqual(petPlan('u1', 0, 0), { n: 0, t0: petPlan('u1', 0, 0).t0, t1: petPlan('u1', 0, 0).t1, kind: A[0].kind });
});

test('pickPets: the viewer first, then a stable hash order, capped; people without a valid pet are skipped', () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ id: 'p' + i, pet: i % 5 === 4 ? { coat: [] } : { coat: ['#ffffff'] } }));
  const ids = pickPets(list, 'p17', 16);
  assert.equal(ids.length, 16); assert.equal(ids[0], 'p17');
  assert.ok(!ids.includes('p4') && !ids.includes('p9'));
  assert.deepEqual(pickPets(list.slice().reverse(), 'p17', 16), ids, 'input order does not matter');
});

test('pets.js stays importable without three or a DOM, and exports the scene makers', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../site/assets/scene/pets.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'three is passed in as T');
  assert.doesNotMatch(src, /\b(window|document)\./, 'no globals');
  for(const fn of ['makePet', 'posePet', 'makeBowls', 'makeToy', 'makeToyBasket', 'makePhotoFrame', 'disposePetShared']) assert.equal(typeof P[fn], 'function', fn);
  assert.match(src, /customProgramCacheKey = \(\) => 'petcoat3'/, 'every coat material shares one program (the key changes with the shader)');
});

test('officeSceneData hands a machine\'s pet to its person; people without one get null', async () => {
  const { officeSceneData } = await import('../site/assets/scene/office-scene.js');
  const tt = (k, v) => k + (v ? JSON.stringify(v) : '');
  const pet = { kind: 'cat', coat: ['#e39a5c'], pattern: 'tabby', photo: 'data:image/png;base64,AA==' };
  const rows = [{ member_id: 'a', display_name: 'A', team_id: 't1', team_name: 'T', signal: 'ok', pet }, { member_id: 'b', display_name: 'B', team_id: 't1', team_name: 'T', signal: 'ok' }];
  const d = officeSceneData({ rows, usage: {}, promptRows: null, teams: [{ id: 't1', name: 'T' }], used: 2, limit: 30, orgName: 'O', rangeLabel: '30d', t: tt, money: x => '$' + x, rel: x => x, os: () => '' });
  const by = Object.fromEntries(d.people.map(p => [p.id, p]));
  assert.deepEqual(by.a.pet, pet); assert.equal(by.b.pet, null);
});

test('office-scene wires pets: import query, data contract, drawn set, still life, rebuild and destroy, step, reduced motion, recording hooks', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../site/assets/scene/office-scene.js', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*normalizePetLook[^}]*pickPets[^}]*petPlan[^}]*makePet[^}]*makeBowls[^}]*makeToy[^}]*makeToyBasket[^}]*makePhotoFrame[^}]*disposePetShared[^}]*PET_MAX[^}]*\} from '\.\/pets\.js\?v=p10'/);
  assert.match(src, /people\[\]\.pet \(optional\)/, 'the data contract names the field');
  assert.match(src, /if\(d\.closed\) return new Set\(\);/, 'a closed organization shows no pets');
  assert.match(src, /filter\(p => p && p\.tier !== 'nodata' && p\.pet\)/, 'ghosts have no pets');
  assert.ok(src.includes('me ? me.id : d.viewerId, PET_MAX))'), 'the viewer first, at most PET_MAX');
  assert.match(src, /if\(!\(p && sets\.petIds\.has\(p\.id\)\)\)\{ \/\* a little still life/, 'a pet owner\'s desk drops the still life for the frame and the sleeping pet');
  assert.match(src, /petBits\.forEach\(h => \{ if\(h\.parent\) h\.parent\.remove\(h\); h\.userData\.dispose\(\); \}\); petBits = \[\]; pets = \[\]; petNav = null;/, 'clear() frees every pet piece on each rebuild');
  assert.match(src, /clear\(\); disposePetShared\(T\);/, 'destroy() frees the shared pet geometries');
  assert.match(src, /if\(pets\.length\) stepPets\(dt\);/);
  assert.match(src, /if\(reduced && !pt\.force\)/, 'reduced motion: the pet sits by the desk');
  assert.match(src, /if\(!xmas && owners\.some\(o => o\.p\.petToys\)\)\{ const b = makeToyBasket\(T\)/, 'the toy basket stands in for the presents out of season, when some pet has toys');
  for(const h of ['setPet(id, pet, toys){', 'petAct(id, kind, walk, dur){', 'pets: () =>']) assert.ok(src.includes(h), h);
});

/* a minimal stand-in for three: enough for makePet and posePet to run in Node */
function fakeThree(){
  class V { constructor(x = 0, y = 0, z = 0){ this.x = x; this.y = y; this.z = z; } set(x, y, z){ this.x = x; this.y = y; this.z = z; return this; } copy(v){ this.x = v.x; this.y = v.y; this.z = v.z; if(v.order) this.order = v.order; return this; }
    clone(){ const c = new this.constructor(); return c.copy(this); } setScalar(s){ return this.set(s, s, s); } multiplyScalar(s){ return this.set(this.x * s, this.y * s, this.z * s); } normalize(){ return this; } }
  class E extends V { constructor(){ super(); this.order = 'XYZ'; } }
  class Q { setFromUnitVectors(a, b){ this.from = a; this.to = b; return this; } }
  class O { constructor(geometry, material){ this.position = new V(); this.rotation = new E(); this.quaternion = new Q(); this.scale = new V(1, 1, 1); this.children = []; this.userData = {}; this.visible = true; this.name = ''; this.geometry = geometry; this.material = material; }
    add(...c){ c.forEach(x => { x.parent = this; this.children.push(x); }); return this; } remove(c){ this.children = this.children.filter(x => x !== c); } dispose(){} }
  class G { dispose(){} getAttribute(k){ return this.attrs ? this.attrs[k] || null : null; } setAttribute(k, a){ (this.attrs = this.attrs || {})[k] = a; return this; } setIndex(i){ this.index = i; return this; } computeVertexNormals(){} }
  class M { constructor(o = {}){ Object.assign(this, o); this.userData = {}; this.color = { set(){} }; } dispose(){} }
  class Sh { constructor(){ this.cmds = []; } moveTo(...a){ this.cmds.push(['m', ...a]); } lineTo(...a){ this.cmds.push(['l', ...a]); } bezierCurveTo(...a){ this.cmds.push(['b', ...a]); } quadraticCurveTo(...a){ this.cmds.push(['q', ...a]); } closePath(){} }
  class X extends G { constructor(shape, opt){ super(); this.shape = shape; this.opt = opt; } }
  return { DoubleSide: 2, Group: O, Mesh: O, InstancedMesh: O, SphereGeometry: G, CapsuleGeometry: G, ConeGeometry: G, TorusGeometry: G, LatheGeometry: G, PlaneGeometry: G, ExtrudeGeometry: X, Shape: Sh, BufferGeometry: G, Float32BufferAttribute: class { constructor(a, n){ this.array = a; this.itemSize = n; } },
    Vector2: V, Vector3: V, Color: class { constructor(c){ this.c = c; } set(c){ this.c = c; } }, MeshStandardMaterial: M };
}

test('posePet: a change of pose blends from what was on screen over PET_BLEND, eased, and snaps with blend 0', () => {
  const T = fakeThree(), g = P.makePet(T, { kind: 'dog', coat: ['#c89159'] }), n = g.userData.nodes;
  g.userData.pose('stand', 0, 10, { amp: 0 }); const y0 = n.rig.position.y;
  g.userData.pose('sleep', 0, 10, {}); assert.ok(Math.abs(n.rig.position.y - y0) < 1e-9, 'the first frame of a new pose is the old pose');
  g.userData.pose('sleep', 0, 10 + P.PET_BLEND / 2, {}); const mid = n.rig.position.y;
  g.userData.pose('sleep', 0, 10 + P.PET_BLEND + 0.01, {}); const end = n.rig.position.y;
  assert.ok(end < -0.1, 'asleep the body lies low: ' + end);
  assert.ok(Math.abs(mid - (y0 + end) / 2) < 0.01, 'halfway through the blend it is halfway (ease in and out is symmetric)');
  let prev = end, worst = 0; g.userData.pose('stand', 0, 20, {});
  for(let t = 20; t < 20.4; t += 1 / 60){ g.userData.pose('stand', 0, t, { amp: 0 }); worst = Math.max(worst, Math.abs(n.rig.position.y - prev)); prev = n.rig.position.y; }
  assert.ok(worst < 0.025, 'no frame jumps more than a small step: ' + worst);
  g.userData.pose('sleep', 0, 30, { blend: 0 }); assert.ok(n.rig.position.y < -0.1, 'blend 0 snaps (reduced motion)');
  assert.equal(n.eyeL.visible, false); assert.equal(n.lidL.visible, true, 'asleep the closed-eye arcs show instead of the eyes');
});

test('the gait follows the distance walked: a small pet takes more steps over the same ground, and standing still does not step', () => {
  assert.equal(P.petGait(0, 0, 1.4), 0);
  const small = P.petGait(0, 1, 0.82 * 1.75), large = P.petGait(0, 1, 1.2 * 1.75);
  assert.ok(small > large && Math.abs(small / large - 1.2 / 0.82) < 1e-9, 'cycles scale with 1 / size');
  assert.ok(Math.abs(P.petGait(0, P.PET_STRIDE * 2, 2) - 1) < 1e-9, 'one cycle per stride times the scale');
});

test('petSpeedStep: eases in and out, stops at the end of the path, and does not move while facing more than about 30 degrees away', () => {
  let v = 0, x = 0; const L = 3, dt = 1 / 60, vs = [];
  for(let i = 0; i < 600 && L - x > 0.004; i++){ v = P.petSpeedStep(v, L - x, 0, dt); x += Math.min(L - x, v * dt); vs.push(v); }
  assert.ok(L - x <= 0.004, 'it arrives');
  assert.ok(vs[0] < 0.1 && vs.findIndex(u => u >= 1.09) * dt > 0.15, 'about 0.2 s to full speed, no instant start');
  for(let i = 1; i < vs.length; i++) assert.ok(Math.abs(vs[i] - vs[i - 1]) <= 5 * 2.5 * dt + 1e-9, 'no jump in speed');
  assert.equal(P.petSpeedStep(0, 2, 0.7, dt), 0, 'turned away: it stays put and turns first');
});

test('petPlaySeq: seeded per pet, continuous, the toy always ahead of the chest, every kind of move, ends where it started', () => {
  const A = P.petPlaySeq('pet-a:3', 30), B = P.petPlaySeq('pet-a:3', 30), C = P.petPlaySeq('pet-b:3', 30);
  assert.deepEqual(A, B); assert.notDeepEqual(A.map(m => m.k), C.map(m => m.k));
  assert.deepEqual(new Set(A.map(m => m.k)), new Set(['crouch', 'pounce', 'bat', 'look', 'back']));
  assert.ok(new Set(A.map(m => (m.t1 - m.t0).toFixed(2))).size > 6, 'move lengths vary, not a metronome');
  const end = A[A.length - 1].t1; let prev = P.petPlayAt(A, 0), worst = 0;
  for(let t = 0.004; t <= end; t += 0.004){ const s = P.petPlayAt(A, t); worst = Math.max(worst, Math.abs(s.tx - prev.tx), Math.abs(s.tz - prev.tz), Math.abs(s.bz - prev.bz)); assert.ok(s.tz - s.bz >= P.PET_PLAY_Z - 0.03, 'the toy stays ahead of the chest'); prev = s; }
  assert.ok(worst < 0.004, 'nothing jumps between frames: ' + worst);
  assert.equal(P.petPlayAt(A, end).bz, 0, 'the body is back where it started');
  A.forEach((m, i) => { if(m.k === 'pounce') assert.equal(A[i - 1].k, 'crouch', 'a pounce follows a crouch'); });
});

test('petLookFromPixels: a golden coat in front of a shadowy background drops the dark grey shadow, and at most two colours come back', () => {
  const r = petLookFromPixels(photo(120, 120, [70, 120, 60], (x, y) => y > 78 ? [88, 78, 88] : [200, 150, 90]), 120, 120);
  assert.ok(r.coat.length <= 2, JSON.stringify(r));
  assert.ok(r.coat.every(h => Math.hypot(...hexToOklab(h).slice(1)) > 0.04), 'no grey shadow colour: ' + JSON.stringify(r));
});

test('neutralDark: near-black coats come out neutral charcoal, mid colours are untouched', () => {
  const c = hexToOklab(P.neutralDark('#2f3326')); assert.ok(Math.hypot(c[1], c[2]) <= 0.008, 'no olive cast (within 8-bit rounding)');
  assert.equal(P.neutralDark('#c89159'), '#c89159');
});

test('petRecolor repaints in place for the same shape and refuses a new shape', () => {
  const T = fakeThree(), g = P.makePet(T, { kind: 'cat', coat: ['#e39a5c'], ear: 'up', tail: 'long', size: 's' });
  assert.equal(P.petRecolor(g, { kind: 'cat', coat: ['#333333', '#ffffff'], pattern: 'tuxedo', ear: 'up', tail: 'long', size: 's' }), true);
  assert.equal(g.userData.look.pattern, 'tuxedo');
  assert.equal(P.petRecolor(g, { kind: 'dog', coat: ['#333333'], ear: 'up', tail: 'long', size: 's' }), false, 'another kind needs a new model');
});

/* ---------- look v2 ---------- */
test('look v2: a round 1 look normalizes to exactly itself, with no v2 key filled in', () => {
  const r1 = { kind: 'dog', coat: ['#c89159', '#f3efe8'], pattern: 'patch', ear: 'flop', tail: 'curl', size: 's', fluff: 0.37, name: 'Bori' };
  assert.deepEqual(normalizePetLook(r1), r1);
  for(const k of [...P.PET_NUMS, ...P.PET_HEX_KEYS, 'marks', 'breed']) assert.equal(k in normalizePetLook(r1), false, k);
});

test('look v2: shape numbers are kept when finite, clamped to 0..1, rounded to 2 decimals, dropped otherwise', () => {
  const n = v => normalizePetLook({ coat: ['#ffffff'], snout: v }).snout;
  assert.equal(n(0.3), 0.3); assert.equal(n(0), 0); assert.equal(n(1), 1);
  assert.equal(n(0.333), 0.33); assert.equal(n(0.675), 0.68); assert.equal(n(1.7), 1); assert.equal(n(-2), 0);
  for(const bad of [NaN, Infinity, -Infinity, '0.5', null, true, {}, [0.5]]) assert.equal(n(bad), undefined, String(bad));
  for(const k of P.PET_NUMS){ const l = normalizePetLook({ coat: ['#ffffff'], [k]: 0.25 }); assert.equal(l[k], 0.25, k); assert.equal(k in normalizePetLook({ coat: ['#ffffff'], [k]: 'x' }), false, k); }
});

test('look v2: eye, nose, collar and mark colours are lower-cased hex or dropped; breed must match the key pattern', () => {
  for(const k of P.PET_HEX_KEYS){
    assert.equal(normalizePetLook({ coat: ['#ffffff'], [k]: '#ABCDEF' })[k], '#abcdef', k);
    for(const bad of ['red', '#abc', '#abcdeg', 7, null]) assert.equal(k in normalizePetLook({ coat: ['#ffffff'], [k]: bad }), false, k + ' ' + bad);
  }
  assert.equal(normalizePetLook({ coat: ['#ffffff'], breed: 'shiba' }).breed, 'shiba');
  assert.equal(normalizePetLook({ coat: ['#ffffff'], breed: 'a'.repeat(32) }).breed, 'a'.repeat(32));
  for(const bad of ['Shiba', 'a'.repeat(33), '', 'shiba inu', 'x-y', 3]) assert.equal('breed' in normalizePetLook({ coat: ['#ffffff'], breed: bad }), false, String(bad));
  assert.ok(P.PET_BREED_RE.test('golden_retriever'));
});

test('look v2: marks keep known values once each, in PET_MARKS order, and are left out when empty', () => {
  assert.deepEqual(normalizePetLook({ coat: ['#ffffff'], marks: ['tip', 'socks', 'tip', 'stripes', 'blaze'] }).marks, ['socks', 'blaze', 'tip']);
  assert.deepEqual(normalizePetLook({ coat: ['#ffffff'], marks: ['chest'] }).marks, ['chest']);
  for(const bad of [[], ['x'], 'socks', null, { socks: true }]) assert.equal('marks' in normalizePetLook({ coat: ['#ffffff'], marks: bad }), false, JSON.stringify(bad));
});

test('petCoatRoles: the colour roles of every pattern, by position', () => {
  const R = pat => P.petCoatRoles(pat).map(r => r.key + (r.optional ? '?' : ''));
  assert.deepEqual(R('solid'), ['coat']); assert.deepEqual(R('patch'), ['base', 'patch', 'ear?']); assert.deepEqual(R('tabby'), ['base', 'stripe', 'muzzle?']);
  assert.deepEqual(R('tuxedo'), ['main', 'white']); assert.deepEqual(R('point'), ['body', 'points']); assert.deepEqual(R('bicolor'), ['top', 'under']);
  assert.deepEqual(R('saddle'), ['body', 'saddle']); assert.deepEqual(R('spots'), ['base', 'spot']); assert.deepEqual(R('calico'), ['base', 'patch1', 'patch2']);
  assert.deepEqual(R('zebra'), ['coat'], 'an unknown pattern reads as solid');
  for(const pat of PET_PATTERNS) assert.ok(P.petCoatRoles(pat).length <= P.PET_COAT_MAX, pat);
  P.petCoatRoles('patch')[0].key = 'x'; assert.equal(P.petCoatRoles('patch')[0].key, 'base', 'callers get a fresh list');
});

test('petApplyBreed: the breed look with the pet\'s own name, nothing else carried over', () => {
  const mine = { kind: 'cat', coat: ['#333333'], pattern: 'solid', ear: 'fold', tail: 'curl', size: 's', fluff: 0.1, collar: '#ff0000', name: 'Nabi' };
  const breed = { kind: 'dog', breed: 'shiba', coat: ['#d9924c', '#f6efe4'], pattern: 'bicolor', ear: 'up', tail: 'curl', size: 'm', fluff: 0.5, name: 'ignored' };
  const out = P.petApplyBreed(mine, breed);
  assert.deepEqual(out, { ...breed, name: 'Nabi' });
  assert.equal('name' in P.petApplyBreed({ coat: ['#111111'] }, breed), false, 'no name to keep, and the breed has none of its own');
  assert.equal(P.petApplyBreed(null, breed).breed, 'shiba', 'works before the member has a pet');
  assert.deepEqual(P.petApplyBreed(mine, { coat: [] }), normalizePetLook(mine), 'a broken breed changes nothing');
});

/* a sample of the server's breed seed: each look plus its kind normalizes to itself */
const BREEDS = [
  { kind: 'dog', look: { coat: ['#e3a058', '#f7f2ea'], pattern: 'bicolor', ear: 'up', tail: 'short', size: 'm', fluff: 0.5, earsize: 0.8, legs: 0.1, length: 0.75, marks: ['socks', 'blaze'] } },
  { kind: 'dog', look: { coat: ['#d39a5a', '#3f3a3c'], pattern: 'saddle', ear: 'flop', tail: 'long', size: 'm', fluff: 0.2, marks: ['socks', 'chest', 'blaze', 'tip'] } },
  { kind: 'dog', look: { coat: ['#6d7480', '#f5f3ef'], pattern: 'bicolor', ear: 'up', tail: 'fluff', size: 'l', fluff: 0.7, eye: '#7fb7e6', marks: ['socks', 'blaze'] } },
  { kind: 'dog', look: { coat: ['#f7f5f1', '#2f2d30'], pattern: 'spots', ear: 'flop', tail: 'long', size: 'l', fluff: 0.1, build: 0.35 } },
  { kind: 'cat', look: { coat: ['#f7f3ec', '#e59a4a', '#3b3839'], pattern: 'calico', ear: 'up', tail: 'long', size: 'm', fluff: 0.3 } },
  { kind: 'cat', look: { coat: ['#efe3cf', '#5a4538'], pattern: 'point', ear: 'up', tail: 'long', size: 'm', fluff: 0.2, eye: '#6fa8dc', build: 0.3, earsize: 0.7 } },
  { kind: 'cat', look: { coat: ['#f3ede4'], pattern: 'solid', ear: 'up', tail: 'fluff', size: 'm', fluff: 1, snout: 0, earsize: 0.25, build: 0.75, eye: '#e0a94a' } },
];
test('breed looks normalize to themselves', () => {
  for(const b of BREEDS){ const l = { ...b.look, kind: b.kind }; assert.deepEqual(normalizePetLook(l), l, JSON.stringify(b.look)); }
});

test('paint roles are positional: a darker coat[0] stays the base, no sorting by lightness', () => {
  const T = fakeThree(), c0 = (look, role) => { const g = P.makePet(T, look); return g.userData.mats.find(x => x.role === role).m.userData.pet.uPetC0.value.c; };
  assert.equal(c0({ kind: 'cat', coat: ['#6b4a2e', '#e8b07a'], pattern: 'tabby' }, 'body'), P.neutralDark('#6b4a2e'), 'tabby base');
  assert.equal(c0({ kind: 'cat', coat: ['#e8e2d8', '#3a3a40'], pattern: 'tuxedo' }, 'body'), '#e8e2d8', 'tuxedo main is coat[0] even when lighter');
  assert.equal(c0({ kind: 'cat', coat: ['#5a4538', '#efe3cf'], pattern: 'point' }, 'body'), P.neutralDark('#5a4538'), 'point body is coat[0]');
  const g = P.makePet(T, { kind: 'dog', coat: ['#6d7480', '#f5f3ef'], pattern: 'bicolor', eye: '#7fb7e6', nose: '#aa5555', mark: '#eeeeee', marks: ['socks'] }), u = r => g.userData.mats.find(x => x.role === r).m.userData.pet;
  assert.equal(u('body').uPetC1.value.c, '#f5f3ef'); assert.equal(u('leg').uPetC0.value.c, '#f5f3ef', 'bicolor legs wear the under colour');
  assert.equal(u('eye').uPetC1.value.c, '#7fb7e6', 'eye is the iris'); assert.equal(u('nose').uPetC0.value.c, '#aa5555');
  assert.equal(u('leg').uPetMkK.value, 2, 'socks on the legs'); assert.equal(u('leg').uPetCM.value.c, '#eeeeee'); assert.equal(u('body').uPetMkK.value, 0);
});

test('petShapeKey changes with every shape key and not with a colour; petRecolor repaints every colour in place', () => {
  const base = { kind: 'dog', coat: ['#c89159'], pattern: 'solid', ear: 'up', tail: 'long', size: 'm', fluff: 0.5 }, K = P.petShapeKey, k0 = K(base);
  for(const k of P.PET_NUMS) assert.notEqual(K({ ...base, [k]: 0.2 }), k0, k);
  assert.equal(K({ ...base, snout: 0.5 }), k0, 'an absent number is 0.5');
  for(const ch of [{ ear: 'half' }, { tail: 'curl' }, { size: 'l' }, { kind: 'cat' }, { fluff: 0.9 }, { marks: ['tip'] }, { collar: '#ff0000' }]) assert.notEqual(K({ ...base, ...ch }), k0, JSON.stringify(ch));
  assert.notEqual(K({ ...base, marks: ['tip'] }), K({ ...base, marks: ['socks'] }));
  for(const ch of [{ coat: ['#111111', '#eeeeee'] }, { pattern: 'calico' }, { eye: '#00ff00' }, { nose: '#ff00ff' }, { mark: '#000000' }, { name: 'x' }, { breed: 'shiba' }]) assert.equal(K({ ...base, ...ch }), k0, JSON.stringify(ch));
  assert.equal(K({ ...base, collar: '#ff0000' }), K({ ...base, collar: '#00ff00' }), 'collar colour is a repaint');
  const T = fakeThree(), g = P.makePet(T, { ...base, collar: '#ff0000', marks: ['blaze'] }), u = r => g.userData.mats.find(x => x.role === r).m.userData.pet;
  assert.equal(P.petRecolor(g, { ...base, coat: ['#111111', '#eeeeee', '#884422'], pattern: 'calico', collar: '#00ff00', marks: ['blaze'], eye: '#123456', nose: '#654321', mark: '#abcdef' }), true);
  assert.equal(u('collar').uPetC0.value.c, '#00ff00'); assert.equal(u('eye').uPetC1.value.c, '#123456'); assert.equal(u('nose').uPetC0.value.c, '#654321');
  assert.equal(u('head').uPetCM.value.c, '#abcdef'); assert.equal(u('body').uPetC2.value.c, '#884422'); assert.equal(u('body').uPetMode.value, 6);
});

test('mesh budget: a pet without a collar keeps 15 meshes, a collar adds 2', () => {
  const T = fakeThree(), count = g => { let n = 0; const walk = o => { o.children.forEach(c => { if(c.geometry && c.name !== 'petFur') n++; walk(c); }); }; walk(g); return n; };
  for(const ear of PET_EARS){ const look = { kind: 'cat', coat: ['#e39a5c'], ear, tail: 'long' }; assert.equal(count(P.makePet(T, look)), 15, ear); assert.equal(count(P.makePet(T, { ...look, collar: '#e0685f' })), 17, ear + ' with a collar'); }
});

/* the accessories (look v5): a tag shape, a body piece, a hat and wings. The hat and wing lists are copies of gear.js ids, since pets.js imports nothing. */
test('the accessory lists: tags, body pieces, and the hat and wing ids equal the head and back ids of gear.js in order', async () => {
  const { GEAR_ITEMS } = await import('../site/assets/scene/gear.js');
  assert.deepEqual(P.PET_TAGS, ['round', 'bone', 'heart', 'star', 'plate']);
  assert.deepEqual(P.PET_BODIES, ['bandana', 'chime', 'harness', 'bowtie', 'scarf', 'vest', 'raincoat', 'cape']); assert.equal('PET_NECKS' in P, false, 'the neck list is gone');
  assert.deepEqual(P.PET_HATS, GEAR_ITEMS.filter(g => g.slot === 'head').map(g => g.id)); assert.equal(P.PET_HATS.length, 15);
  assert.deepEqual(P.PET_WINGS, GEAR_ITEMS.filter(g => g.slot === 'back').map(g => g.id)); assert.equal(P.PET_WINGS.length, 7);
});

test('normalizePetLook keeps a known tag, body piece, hat and wing and drops any other value (and the old neck key); a look without them stays without', () => {
  const base = { kind: 'dog', coat: ['#c89159'] };
  assert.deepEqual(normalizePetLook({ ...base, tag: 'heart', body: 'scarf', hat: 'tophat', wing: 'angel' }), { ...normalizePetLook(base), tag: 'heart', body: 'scarf', hat: 'tophat', wing: 'angel' });
  assert.equal('neck' in normalizePetLook({ ...base, neck: 'bandana' }), false, 'neck was renamed body'); assert.equal('body' in normalizePetLook({ ...base, body: 'bell' }), false, 'bell is the chime now');
  for(const k of ['tag', 'body', 'hat', 'wing']) for(const bad of ['nope', '', 7, null, ['round'], 'Round', 'desk']) assert.equal(k in normalizePetLook({ ...base, [k]: bad }), false, k + ' ' + JSON.stringify(bad));
  assert.equal('hat' in normalizePetLook({ ...base, hat: 'angel' }), false, 'a wing id is not a hat');
  assert.equal('wing' in normalizePetLook({ ...base, wing: 'cap' }), false, 'a hat id is not a wing');
  for(const k of ['tag', 'body', 'hat', 'wing']) assert.equal(k in normalizePetLook(base), false, k + ' is never filled in');
  for(const v of P.PET_TAGS) assert.equal(normalizePetLook({ ...base, tag: v }).tag, v);
  for(const v of P.PET_BODIES) assert.equal(normalizePetLook({ ...base, body: v }).body, v);
  for(const v of P.PET_HATS) assert.equal(normalizePetLook({ ...base, hat: v }).hat, v);
  for(const v of P.PET_WINGS) assert.equal(normalizePetLook({ ...base, wing: v }).wing, v);
});

test('petShapeKey changes with each accessory key; the name matters only to a plate tag', () => {
  const base = { kind: 'dog', coat: ['#c89159'], collar: '#e0685f', name: 'Bori' }, K = P.petShapeKey, k0 = K(base);
  const seen = new Set([k0]);
  for(const ch of [{ tag: 'bone' }, { tag: 'heart' }, { body: 'bandana' }, { body: 'chime' }, { body: 'harness' }, { body: 'vest' }, { body: 'raincoat' }, { body: 'cape' }, { hat: 'cap' }, { hat: 'tophat' }, { wing: 'angel' }, { wing: 'bat' }]){ const k = K({ ...base, ...ch }); assert.ok(!seen.has(k), JSON.stringify(ch)); seen.add(k); }
  assert.equal(K({ ...base, name: 'Mo' }), k0, 'the name is a repaint for every tag but the plate');
  assert.equal(K({ ...base, tag: 'star', name: 'Mo' }), K({ ...base, tag: 'star' }));
  assert.notEqual(K({ ...base, tag: 'plate', name: 'Mo' }), K({ ...base, tag: 'plate', name: 'Bori' }), 'a plate prints the name, so a new name is a new model');
  assert.equal(K({ ...base, tag: 'plate', name: 'Mo', collar: '#00ff00' }), K({ ...base, tag: 'plate', name: 'Mo' }), 'colours stay a repaint');
});

/* what the test's gear makers record: a one-mesh piece with a tick and a dispose, so the pet's wiring can be checked without gear.js's own geometry */
function fakeGear(T){
  const log = { made: [], placed: [], ticks: [], disposed: [] };
  const mk = (slot, T2, id) => { const g = new T2.Group(); g.userData.id = id; g.add(new T2.Mesh({}, {})); g.userData.tick = (t, n, r) => log.ticks.push([id, t, n, r]); g.userData.dispose = () => log.disposed.push(id); log.made.push([slot, id]); return g; };
  return { log, gear: { head: (T2, id) => mk('head', T2, id), back: (T2, id) => mk('back', T2, id), headFit: (id, kind) => ({ kind, id, y: 0, z: 0, s: 1, rx: 0, c: 1, w: 1, skip: false }), backFit: (id, kind) => ({ kind, id, y: 0, z: -0.02, s: 1, skip: false }),
    placeHead: (g, fit) => { log.placed.push(['head', g.userData.id, fit]); return g; }, placeBack: (g, anchor, fit) => { log.placed.push(['back', g.userData.id, anchor, fit]); return g; } } };
}
const meshCount = g => { let n = 0; const walk = o => { o.children.forEach(c => { if(c.geometry && c.name !== 'petFur') n++; walk(c); }); }; walk(g); return n; };

test('mesh budget with accessories: the collar band and a round tag are 2, the other tags and the body pieces add their own parts', () => {
  const T = fakeThree(), look = { kind: 'dog', coat: ['#c89159'] }, N = o => meshCount(P.makePet(T, { ...look, ...o }));
  assert.equal(N({}), 15); assert.equal(N({ collar: '#e0685f' }), 17); assert.equal(N({ collar: '#e0685f', tag: 'round' }), 17, 'round is the default tag');
  assert.equal(N({ collar: '#e0685f', tag: 'bone' }), 15 + 1 + 5, 'band, four knobs and a shaft');
  assert.equal(N({ collar: '#e0685f', tag: 'heart' }), 17); assert.equal(N({ collar: '#e0685f', tag: 'star' }), 17);
  assert.equal(N({ collar: '#e0685f', tag: 'plate' }), 17, 'a blank plate is one mesh'); assert.equal(N({ collar: '#e0685f', tag: 'plate', name: 'Bori' }), 18, 'the name is a plane over the plate');
  assert.equal(N({ tag: 'bone' }), 15, 'a tag hangs from the collar: with none it is not drawn');
  assert.equal(N({ body: 'bandana' }), 16); assert.equal(N({ body: 'bowtie' }), 18); assert.equal(N({ body: 'scarf' }), 18); assert.equal(N({ body: 'chime' }), 18, 'without a collar the chime hangs on a cord');
  assert.equal(N({ collar: '#e0685f', body: 'bowtie' }), 17 + 3, 'a bow tie sits on the collar');
  assert.equal(N({ collar: '#e0685f', body: 'chime' }), 17 + 2, 'the chime hangs beside the tag');
  /* the pieces that cover the body: harness = chest ring, neck band, back strap, chest strap and a D-ring; vest and raincoat = the shell and a D-ring or a hood; cape = the cloth and a clasp */
  assert.equal(N({ body: 'harness' }), 15 + 5); assert.equal(N({ body: 'vest' }), 15 + 2); assert.equal(N({ body: 'raincoat' }), 15 + 2); assert.equal(N({ body: 'cape' }), 15 + 2);
  assert.equal(N({ collar: '#e0685f', body: 'harness' }), 17 + 5, 'the harness and the collar both show');
  assert.equal(N({ collar: '#e0685f', tag: 'star', body: 'cape' }), 17 + 2);
  for(const kind of ['dog', 'cat']) for(const body of P.PET_BODIES) for(const tag of P.PET_TAGS) assert.ok(meshCount(P.makePet(T, { kind, coat: ['#c89159'], collar: '#e0685f', body, tag, name: 'Mo' })) >= 17, kind + body + tag);
});

test('makePet draws every tag shape and body piece with and without a collar, on every build, fluff and kind, with finite geometry', () => {
  const T = fakeThree();
  for(const kind of ['dog', 'cat']) for(const fluff of [0, 0.5, 1]) for(const build of [0, 0.5, 1]) for(const body of [undefined, ...P.PET_BODIES]) for(const tag of [undefined, ...P.PET_TAGS]) for(const collar of [undefined, '#336699']){
    const look = { kind, coat: ['#c89159'], fluff, build, name: 'Bori' }; if(body) look.body = body; if(tag) look.tag = tag; if(collar) look.collar = collar;
    const g = P.makePet(T, look), tag2 = JSON.stringify(look); g.userData.pose('stand', 0, 0, { blend: 0 });
    const walk = o => { o.children.forEach(c => { for(const v of [c.position, c.scale]) assert.ok([v.x, v.y, v.z].every(Number.isFinite), tag2 + ' transform');
      const at = c.geometry && c.geometry.attrs && c.geometry.attrs.position; if(at) assert.ok(at.array.every(Number.isFinite), tag2 + ' vertices'); walk(c); }); };
    walk(g); g.userData.dispose();
  }
  const g = P.makePet(T, { kind: 'dog', coat: ['#c89159'], body: 'scarf' }); assert.ok(g.userData.nodes.collar, 'a body piece alone hangs on the collar joint, so it follows the head');
  const cat = P.makePet(T, { kind: 'cat', coat: ['#c89159'], collar: '#336699', tag: 'heart' }), tg = cat.userData.nodes.collar.children.find(c => !c.geometry || !c.geometry.attrs);
  assert.ok(tg && tg.quaternion.to, 'the tag faces forward through a quaternion from +z to the collar frame\'s front');
});

test('the body pieces and the tag take the right colour: the collar colour when set (not for the chime, raincoat and cape), else their own', () => {
  const T = fakeThree(), role = (look, r) => { const g = P.makePet(T, look); const m = g.userData.mats.find(x => x.role === r); return m && m.m.userData.pet.uPetC0.value.c; };
  const base = { kind: 'dog', coat: ['#c89159'] }, own = { bandana: '#4a7bd6', chime: '#e8c56a', harness: '#2f8f6b', bowtie: '#d9534f', scarf: '#e8a23a', vest: '#c8414b', raincoat: '#f2c230', cape: '#8b3fd1' };
  for(const body of P.PET_BODIES){
    assert.equal(role({ ...base, body }, 'wear'), own[body], body + ' own colour');
    assert.equal(role({ ...base, body, collar: '#123456' }, 'wear'), ['chime', 'raincoat', 'cape'].includes(body) ? own[body] : '#123456', body + ' with a collar colour');
  }
  assert.equal(role({ ...base, collar: '#123456', tag: 'heart' }, 'tag'), '#e8c56a', 'the tag is always gold');
  assert.equal(role(base, 'wear'), undefined, 'no body piece, no wear material');
  assert.equal(role({ ...base, body: 'harness' }, 'metal'), '#b9bdc6', 'the D-ring is metal'); assert.equal(role({ ...base, body: 'vest' }, 'metal'), '#b9bdc6'); assert.equal(role({ ...base, body: 'cape' }, 'metal'), undefined, 'the cape has a gold clasp, no ring');
  const g = P.makePet(T, { ...base, body: 'scarf', collar: '#336699' }); assert.equal(P.petRecolor(g, { ...base, body: 'scarf', collar: '#abcdef' }), true, 'a collar colour is a repaint');
  assert.equal(P.petRecolor(P.makePet(T, { ...base, body: 'scarf' }), { ...base, body: 'scarf', collar: '#abcdef' }), false, 'putting a collar on is a new model');
  assert.equal(g.userData.mats.find(x => x.role === 'wear').m.userData.pet.uPetC0.value.c, '#abcdef');
  assert.equal(P.petRecolor(g, { ...base, body: 'chime' }), false, 'a different piece is a new model');
});

test('the body pieces: the harness, vest, raincoat and cape sit over the body ellipsoid, on every build, fluff and length, and the cloth is drawn from both sides', () => {
  const T = fakeThree(), W = P.PET_WEAR_K;
  assert.deepEqual(W.vestZ, [-0.15, 0.75]); assert.deepEqual(W.coatZ, [-0.85, 0.8]); assert.equal(W.ringZ, 0.3);
  for(const kind of ['dog', 'cat']) for(const fluff of [0, 0.5, 1]) for(const build of [0, 0.5, 1]) for(const length of [0, 1]) for(const body of ['harness', 'vest', 'raincoat', 'cape']){
    const look = { kind, coat: ['#c89159'], fluff, build, length, body }, tag = JSON.stringify(look), g = P.makePet(T, look);
    const puff = 1 + 0.08 * fluff, sh = P.petShape(look), kb = sh.build, bl = (kind === 'cat' ? 0.165 : 0.175) * sh.length, bw = (kind === 'cat' ? 0.105 : 0.125) * kb;
    const fur = (fluff <= 0.05 ? 0 : P.petFurLen(fluff)) * P.PET_WEAR_FUR, R = [bw * puff + fur, 0.115 * kb * puff + fur, bl + fur];   /* the pieces sit PET_WEAR_FUR of the fur's length over the skin */
    const pts = []; const walk = o => { o.children.forEach(c => { const at = c.geometry && c.geometry.attrs && c.geometry.attrs.position; if(at && o.name === 'body') for(let i = 0; i < at.array.length; i += 3) pts.push([at.array[i], at.array[i + 1], at.array[i + 2]]); walk(c); }); };
    walk(g); assert.ok(pts.length > 0, tag + ' draws on the body node');
    for(const p of pts){ assert.ok(p.every(Number.isFinite), tag); const q = Math.sqrt((p[0] / R[0]) ** 2 + (p[1] / R[1]) ** 2 + (p[2] / R[2]) ** 2); assert.ok(q >= 0.99, tag + ': never inside the body ' + q.toFixed(3)); assert.ok(q < 1.8, tag + ': close to the body, not in the air ' + q.toFixed(3)); }
    g.userData.dispose();
  }
  for(const body of P.PET_BODIES) assert.equal(P.makePet(T, { kind: 'dog', coat: ['#c89159'], body }).userData.mats.find(x => x.role === 'wear').m.side, T.DoubleSide, body + ' is drawn from both sides');
});

test('a plate tag with a name needs the DOM for its texture: in Node the name plane stays invisible, and the texture is freed with the pet', () => {
  const T = fakeThree(), g = P.makePet(T, { kind: 'dog', coat: ['#c89159'], collar: '#e0685f', tag: 'plate', name: 'Bori' });
  const plane = g.userData.nodes.collar.children.flatMap(c => c.children).find(c => c.geometry && c.material && c.material.transparent);
  assert.ok(plane, 'the name plane exists'); assert.equal(plane.visible, false, 'no canvas without a DOM'); assert.ok(!plane.material.map);
  let freed = 0; const T2 = fakeThree(); T2.CanvasTexture = class { constructor(cv){ this.cv = cv; } dispose(){ freed++; } };
  const calls = []; globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ font: '', measureText: t => ({ width: t.length * 30 }), fillText: (...a) => calls.push(a), clearRect(){} }) }) };
  try{
    const g2 = P.makePet(T2, { kind: 'dog', coat: ['#c89159'], collar: '#e0685f', tag: 'plate', name: 'A rather long name' });
    const pl = g2.userData.nodes.collar.children.flatMap(c => c.children).find(c => c.geometry && c.material && c.material.transparent);
    assert.equal(pl.visible, true); assert.ok(pl.material.map, 'the texture is on the plane'); assert.equal(calls.length, 1, 'the name is drawn once');
    g2.userData.dispose(); assert.equal(freed, 1, 'the texture is freed with the pet');
  }finally{ delete globalThis.document; }
});

test('hat and wings: wrappers map the character skull and the shoulders onto the pet, pieces are ticked through gearParts and freed with the pet', () => {
  const T = fakeThree(), { gear, log } = fakeGear(T), look = { kind: 'dog', coat: ['#c89159'], fluff: 0.5, hat: 'party', wing: 'angel' };
  const g = P.makePet(T, look, { gear }), ud = g.userData;
  assert.equal(ud.gearParts.length, 2); assert.deepEqual(log.made, [['head', 'party'], ['back', 'angel']]);
  assert.deepEqual(log.placed.map(x => x.slice(0, 2)), [['head', 'party'], ['back', 'angel']]);
  assert.equal(log.placed[0][2].kind, 'dog', 'the dog fit of the characters'); assert.equal(log.placed[1][3].kind, 'dog'); assert.deepEqual(log.placed[1][2], { x: 0, y: 0, z: 0 });
  const hat = ud.nodes.head.children.find(c => c.name === 'hat'), wing = ud.nodes.body.children.find(c => c.name === 'wings');
  assert.ok(hat && wing && hat.children[0] === ud.gearParts[0] && wing.children[0] === ud.gearParts[1]);
  const puff = 1.04, hr = 0.145 * puff, headFur = P.petFurLen(0.5) * 0.8, w = P.petHatWrap([hr + headFur, hr + headFur, hr + headFur]);
  assert.ok(Math.abs(hat.scale.x - w.k) < 1e-9 && Math.abs(hat.position.y - w.pos[1]) < 1e-9);
  assert.ok(Math.abs(w.k - P.PET_HAT_K * (hr + headFur) / P.PET_HAT_SKULL_R) < 1e-9, 'the scale is the head\'s mean radius over the skull\'s');
  for(const i of [0, 2]) assert.ok(Math.abs(w.pos[i] + w.k * P.PET_HAT_SKULL[i] - P.PET_HEAD_C[i]) < 1e-9, 'the skull centre lands on the head centre, axis ' + i);
  assert.ok(Math.abs(w.pos[1] + w.k * (P.PET_HAT_SKULL[1] + P.PET_HAT_SKULL_R + 0.01) - (P.PET_HEAD_C[1] + hr + headFur)) < 1e-9, 'the crown anchor lands on the head top');
  assert.ok(Math.abs(wing.scale.x - P.PET_WING_K * (0.125 * puff) / 0.125) < 1e-9, 'a medium dog\'s wings scale by PET_WING_K times its puff');
  assert.ok(Math.abs(wing.position.z - 0.175 * P.PET_WING_Z) < 1e-9 && wing.position.y > 0.115 * puff, 'the wings root at the top of the back, near the shoulders');
  assert.ok(typeof ud.gearParts[0].userData.phase === 'number' && ud.gearParts[0].userData.phase !== ud.gearParts[1].userData.phase, 'each piece has a phase of its own');
  ud.gearParts.forEach(p => p.userData.tick(1.5, 0.2, true)); assert.deepEqual(log.ticks.map(x => x[0]), ['party', 'angel']);
  ud.dispose(); assert.deepEqual(log.disposed.sort(), ['angel', 'party']);
  const cat = P.makePet(T, { ...look, kind: 'cat' }, { gear }); assert.equal(log.placed.at(-2)[2].kind, 'dog', 'every pet wears hats with the dog fits'); assert.equal(log.placed.at(-1)[3].kind, 'cat', 'the cat fit for a cat\'s wings');
  assert.equal(P.PET_HAT_K, 1); assert.equal(P.PET_WING_K, 0.42);
  assert.deepEqual(P.petHatWrap([0.36, 0.36, 0.36]).pos.map(x => Math.round(x * 1e6) / 1e6), [0, -0.58, 0.06], 'at k = 1 the anchor 1.04 lands on the head top 0.46');
  const tall = P.petHatWrap([0.2, 0.15, 0.2]); assert.ok(Math.abs(tall.pos[1] + tall.k * 1.04 - 0.25) < 1e-9, 'a flat head keeps the anchor on its own top');
});

test('without gear makers a hat and wings are not drawn; a pet without them has an empty gearParts; a skipped fit or a failing maker leaves the piece off', () => {
  const T = fakeThree(), look = { kind: 'dog', coat: ['#c89159'], hat: 'cap', wing: 'bat' };
  const bare = P.makePet(T, look); assert.deepEqual(bare.userData.gearParts, []); assert.equal(meshCount(bare), 15); bare.userData.dispose();
  assert.deepEqual(P.makePet(T, { kind: 'dog', coat: ['#c89159'] }, { gear: fakeGear(T).gear }).userData.gearParts, [], 'no hat or wings in the look');
  const f = fakeGear(T), skip = { ...f.gear, headFit: () => ({ skip: true }), backFit: () => ({ skip: true }) }; assert.equal(P.makePet(T, look, { gear: skip }).userData.gearParts.length, 0);
  const bad = { ...f.gear, head: () => { throw new Error('x'); } }; const g = P.makePet(T, look, { gear: bad }); assert.equal(g.userData.gearParts.length, 1, 'the wings still show'); assert.equal(f.log.made.length, 1);
});

test('petApplyBreed keeps the member\'s accessories, like the toy', () => {
  const mine = { kind: 'dog', coat: ['#111111'], tag: 'star', body: 'harness', hat: 'cap', wing: 'bat', name: 'Mo' }, out = P.petApplyBreed(mine, { kind: 'cat', coat: ['#efe3cf'], tag: 'heart', hat: 'beanie' });
  assert.deepEqual([out.tag, out.body, out.hat, out.wing, out.name, out.kind], ['star', 'harness', 'cap', 'bat', 'Mo', 'cat']);
  const none = P.petApplyBreed({ kind: 'dog', coat: ['#111111'] }, { kind: 'cat', coat: ['#efe3cf'], hat: 'beanie' }); assert.equal('hat' in none, false, 'a breed look\'s accessories are not the member\'s choice');
});

/* the collar follows the neck's crease (3.130.0-5): every point stands just over the fur of the head and the body, never in the air like the hoop or
   sunk like the old band, and the tag hangs at the front below the head's centre */
test('petCollarFrame: the band hugs the crease over the fur on every build and fluff, and the tag hangs at the front', () => {
  for(const cat of [false, true]) for(const f of [0, 0.5, 1]) for(const kb of [0.85, 1, 1.25]) for(const len of [0.85, 1.4]){
    const puff = 1 + 0.08 * f, kh = 1 + 0.5 * (kb - 1), furLen = P.petFurLen(f), hr = (cat ? 0.15 : 0.145) * puff * kh, bl = (cat ? 0.165 : 0.175) * len, bw = (cat ? 0.105 : 0.125) * kb;
    const s = { hr, cat, bl, bw, kb, puff, headFur: furLen * 0.8, bodyFur: furLen }, fr = P.petCollarFrame({}, s), tag = `cat ${cat} fluff ${f} build ${kb} length ${len}`;
    const hf = s.headFur * P.PET_WEAR_FUR, bf = s.bodyFur * P.PET_WEAR_FUR;   /* the band sits PET_WEAR_FUR of the fur over the skin, down in the coat */
    const hc = [0, 0.1, 0.04], hR = [hr * (cat ? 1.1 : 1) + hf, hr * (cat ? 0.93 : 1) + hf, hr + hf];
    const bc = [0, -0.08, -bl * 0.72], bR = [bw * puff + bf, 0.115 * kb * puff + bf, bl + bf];
    const q = (p, o, R) => Math.sqrt(((p[0] - o[0]) / R[0]) ** 2 + ((p[1] - o[1]) / R[1]) ** 2 + ((p[2] - o[2]) / R[2]) ** 2);
    assert.equal(fr.pts.length, P.PET_COLLAR_N, tag);
    for(const p of fr.pts){
      assert.ok(q(p, hc, hR) >= 1 && q(p, bc, bR) >= 0.97, tag + ': over the fur ' + p.map(x => x.toFixed(3)));
      assert.ok(q(p, hc, hR) < 1.25, tag + ': on the head, not in the air ' + p.map(x => x.toFixed(3)));
    }
    const mz = fr.pts.reduce((a, p) => a + p[2], 0) / fr.pts.length, my = fr.pts.reduce((a, p) => a + p[1], 0) / fr.pts.length;
    assert.ok(fr.tagAt[2] > mz && fr.tagAt[1] < my, tag + ': the tag hangs at the front of the collar, below it');
  }
});

/* forward kinematics over the fake three's nodes (Euler XYZ, as three applies it), with sampled unit geometry surfaces */
const rotE = (v, r) => { let [x, y, z] = v; let c = Math.cos(r.z), s = Math.sin(r.z); [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(r.y); s = Math.sin(r.y); [x, z] = [x * c + z * s, -x * s + z * c]; c = Math.cos(r.x); s = Math.sin(r.x); [y, z] = [y * c - z * s, y * s + z * c]; return [x, y, z]; };
const toWorld = (v, o, top) => { for(let q = o; q && q !== top.parent; q = q.parent){ v = rotE([v[0] * q.scale.x, v[1] * q.scale.y, v[2] * q.scale.z], q.rotation); v = [v[0] + q.position.x, v[1] + q.position.y, v[2] + q.position.z]; } return v; };
const SPH = []; for(let i = 0; i <= 24; i++) for(let j = 0; j < 32; j++){ const a = Math.PI * i / 24, b = 2 * Math.PI * j / 32; SPH.push([Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)]); }
const CAPS = (r, len) => SPH.map(([x, y, z]) => [x * r, y * r + (y >= 0 ? len / 2 : -len / 2), z * r]);
const lowest = (o, pts, top) => Math.min(...pts.map(p => toWorld(p, o, top)[1]));

test('poses at the extremes of every shape number keep the feet where today\'s proportions put them (on the floor, or in the air scaled by the legs)', () => {
  const T = fakeThree(), seq = P.petPlaySeq('x', 30), at = k => { const m = seq.find(q => q.k === k); return P.petPlayAt(seq, m.t0 + (m.t1 - m.t0) * 0.5); };
  const poses = [['stand', {}], ['walk', { phase: 0.25 }], ['sit', {}], ['sleep', {}], ['eat', {}], ['play', { play: at('crouch') }], ['play', { play: at('pounce') }], ['crouch', {}]];
  const feet = (look, kind, o) => { const g = P.makePet(T, look); g.userData.pose(kind, 0, 1, { ...o, blend: 0 }); const n = g.userData.nodes;
    return Math.min(...['legFL', 'legFR', 'legBL', 'legBR'].map(k => lowest(n[k].children[0], CAPS(1, 1), g))) / g.scale.x; };
  for(const kind of ['dog', 'cat']){ const base = { kind, coat: ['#c89159'], size: 'm', fluff: 0.5 };
    for(const [pose, o] of poses){ const f0 = feet(base, pose, o);
      for(const k of P.PET_NUMS) for(const v of [0, 1]){ const f = feet({ ...base, [k]: v }, pose, o);
        const kl = k === 'legs' ? (v ? 1.35 : 0.55) : 1;   /* in the air (a pounce) the height scales with the legs, on the floor it stays about 0 */
        assert.ok(Math.abs(f - f0 * kl) < 0.03, `${kind} ${pose}${o.play ? ':' + o.play.k : ''} ${k}=${v}: lowest foot ${f.toFixed(3)} vs ${f0.toFixed(3)} today`); } } }
});

test('eating at the extremes brings the mouth to about the height today\'s proportions reach', () => {
  const T = fakeThree(), mouthY = look => { const g = P.makePet(T, look); g.userData.pose('eat', 0, 0, { blend: 0 }); return toWorld([0, 0, 0], g.userData.mouth, g)[1] / g.scale.x; };
  for(const kind of ['dog', 'cat']){ const base = { kind, coat: ['#c89159'] }, y0 = mouthY(base);
    for(const k of ['snout', 'legs', 'length', 'build']) for(const v of [0, 1]){ const y = mouthY({ ...base, [k]: v }); assert.ok(Math.abs(y - y0) < 0.03, `${kind} ${k}=${v}: ${y.toFixed(3)} vs ${y0.toFixed(3)}`); } }
});

test('makeToy: the origin stays on the floor, the rolling parts turn about the toy\'s centre, nothing dips under the floor', () => {
  const T = { ...fakeThree(), SphereGeometry: class { constructor(r = 1){ this.pts = SPH.map(p => p.map(c => c * r)); } dispose(){} },
    CapsuleGeometry: class { constructor(r = 1, len = 1){ this.pts = CAPS(r, len); } dispose(){} },
    TorusGeometry: class { constructor(R = 1, r = 0.4){ this.pts = []; for(let i = 0; i < 24; i++) for(let j = 0; j < 12; j++){ const a = i / 24 * 2 * Math.PI, b = j / 12 * 2 * Math.PI; this.pts.push([(R + r * Math.cos(b)) * Math.cos(a), (R + r * Math.cos(b)) * Math.sin(a), r * Math.sin(b)]); } } dispose(){} } };
  const low = g => { let m = Infinity; const walk = o => o.children.forEach(c => { if(c.geometry) m = Math.min(m, lowest(c, c.geometry.pts, g)); walk(c); }); walk(g); return m; };
  const angles = [0, 0.7, 1.6, 2.5, Math.PI, 3.9, 5.1];
  for(const kind of P.PET_TOYS){ const g = P.makeToy(T, kind), ud = g.userData;
    assert.equal(g.position.y, 0); assert.ok(ud.spin && ud.spin.parent === g, kind + ' has a spin group'); assert.equal(ud.spin.position.y, ud.r, kind + ': spin sits at the centre height r');
    assert.equal(ud.round, kind === 'ball' || kind === 'yarn' || kind === 'bell', kind);
    assert.ok(Math.abs(low(g)) < 1e-3, kind + ' rests on the floor: ' + low(g));
    for(const a of angles) for(const b of angles){
      if(ud.round){ ud.spin.rotation.set(a, b, a * 0.5 + b); assert.ok(low(g) >= -1e-6, `${kind} rolled (${a}, ${b}) dips to ${low(g)}`); }
      else{ ud.spin.rotation.set(0, a + b, 0); assert.ok(low(g) >= -1e-6, `${kind} turned dips to ${low(g)}`); } }
    ud.spin.rotation.set(0, 0, 0); g.userData.dispose(); }
  const y = P.makeToy(T, 'yarn'); assert.ok(y.children.some(c => c !== y.userData.spin && c.geometry), 'the yarn\'s loose strand stays outside spin and does not roll');
});

test('the body and the head stay above the floor in every pose, also with short legs under a chubby body', () => {
  const T = { ...fakeThree(), SphereGeometry: class { constructor(){ this.pts = SPH; } dispose(){} getAttribute(){ return null; } } }, seq = P.petPlaySeq('x', 30), at = k => { const m = seq.find(q => q.k === k); return P.petPlayAt(seq, m.t0 + (m.t1 - m.t0) * 0.5); };
  const poses = [['stand', {}], ['walk', { phase: 0.25 }], ['sit', {}], ['sleep', {}], ['eat', {}], ['crouch', {}], ['play', { play: at('crouch') }], ['play', { play: at('bat') }], ['play', { play: at('pounce') }]];
  for(const kind of ['dog', 'cat']) for(const ext of [{}, { legs: 0, build: 1 }, { legs: 0, build: 1, length: 0 }, { legs: 1, build: 1, length: 1, snout: 1 }, { legs: 0, snout: 1 }])
    for(const [pose, o] of poses){ const g = P.makePet(T, { kind, coat: ['#c89159'], fluff: 1, ...ext }); g.userData.pose(pose, 0, 1, { ...o, blend: 0 }); const n = g.userData.nodes;
      for(const part of ['body', 'head']){ const y = Math.min(...n[part].children.filter(c => c.geometry && c.geometry.pts).map(c => lowest(c, c.geometry.pts, g))) / g.scale.x;
        assert.ok(y > -0.02, `${kind} ${JSON.stringify(ext)} ${pose}${o.play ? ':' + o.play.k : ''}: ${part} reaches ${y.toFixed(3)}`); } }
});

/* ---------- look v3 and the round 2 fixes ---------- */
test('look v3: fur keeps curly and silky only (plush is the absent key), and round 1 and round 2 looks come back unchanged', () => {
  assert.deepEqual(P.PET_FURS, ['plush', 'curly', 'silky']);
  for(const v of ['curly', 'silky']) assert.equal(normalizePetLook({ coat: ['#ffffff'], fur: v }).fur, v);
  for(const bad of ['plush', 'Curly', 'wool', '', 1, null, ['curly'], { curly: true }]) assert.equal('fur' in normalizePetLook({ coat: ['#ffffff'], fur: bad }), false, JSON.stringify(bad));
  const r1 = { kind: 'dog', coat: ['#c89159', '#f3efe8'], pattern: 'patch', ear: 'flop', tail: 'curl', size: 's', fluff: 0.37, name: 'Bori' };
  const r2 = { kind: 'dog', coat: ['#6d7480', '#f5f3ef'], pattern: 'bicolor', ear: 'up', tail: 'fluff', size: 'l', fluff: 0.7, snout: 0.3, eye: '#7fb7e6', collar: '#e0685f', marks: ['socks', 'blaze'], breed: 'husky', name: 'Kong' };
  for(const l of [r1, r2]){ assert.deepEqual(normalizePetLook(l), l); assert.equal('fur' in normalizePetLook(l), false); }
});

test('petShapeKey changes with fur; an explicit plush is the same as no key', () => {
  const base = { kind: 'dog', coat: ['#c89159'] }, K = P.petShapeKey;
  assert.notEqual(K({ ...base, fur: 'curly' }), K(base)); assert.notEqual(K({ ...base, fur: 'silky' }), K(base)); assert.notEqual(K({ ...base, fur: 'silky' }), K({ ...base, fur: 'curly' }));
  assert.equal(K({ ...base, fur: 'plush' }), K(base));
});

test('bare skin: fluff 0.05 or less has no shells and no strand tint; a silky coat draws no more shells than the longest plush coat', () => {
  const T = fakeThree();
  for(const fluff of [0, 0.05]){ const g = P.makePet(T, { kind: 'cat', coat: ['#e6c4b4'], fluff }); assert.equal(g.userData.shells.length, 0, 'fluff ' + fluff); assert.equal(g.userData.fur(2000), 0);
    assert.ok(g.userData.mats.every(({ m }) => m.userData.pet.uPetFurK.value === -1)); }
  const plush = P.makePet(T, { kind: 'dog', coat: ['#ffffff'], fluff: 1 }), silky = P.makePet(T, { kind: 'dog', coat: ['#ffffff'], fluff: 1, fur: 'silky' });
  assert.equal(silky.userData.shells.length, plush.userData.shells.length);
  for(const px of [20, 50, 80, 120, 200, 600]){ plush.userData.fur(px); silky.userData.fur(px); assert.equal(silky.userData.shells[0].count, plush.userData.shells[0].count, 'px ' + px); }
  assert.ok(P.makePet(T, { kind: 'dog', coat: ['#ffffff'], fur: 'curly' }).userData.mats.some(({ m }) => m.userData.pet.uPetFurK.value === 1));
});

test('petGait with legK: one cycle per PET_STRIDE * legK; the default is the old gait', () => {
  for(const k of [0.55, 1, 1.35]) assert.ok(Math.abs(P.petGait(0, P.PET_STRIDE * k * 1.4, 1.4, k) - 1) < 1e-9, String(k));
  assert.equal(P.petGait(0.3, 0.5, 1.2), P.petGait(0.3, 0.5, 1.2, 1));
  const T = fakeThree(); for(const [v, k] of [[0, 0.55], [0.5, 1], [1, 1.35]]) assert.ok(Math.abs(P.makePet(T, { kind: 'dog', coat: ['#c89159'], legs: v }).userData.legK - k) < 1e-9);
  assert.equal(P.makePet(T, { kind: 'dog', coat: ['#c89159'] }).userData.legK, 1);
});

test('walking: the foot\'s sweep per cycle matches the travel per cycle within 15 % at legs 0, 0.5 and 1 (no sliding feet)', () => {
  const T = fakeThree();
  for(const kind of ['dog', 'cat']) for(const legs of [0, 0.5, 1]){
    const g = P.makePet(T, { kind, coat: ['#c89159'], legs }), ud = g.userData, leg = ud.nodes.legFL.children[0], zs = [];
    for(let ph = 0; ph < 1; ph += 0.01){ ud.pose('walk', 0, 1, { phase: ph, amp: 1, blend: 0 }); zs.push(toWorld([0, -1.5, 0], leg, g)[2] / g.scale.x); }
    const sweep = 2 * (Math.max(...zs) - Math.min(...zs)), travel = 1 / P.petGait(0, 1, 1, ud.legK);   /* the foot sweeps its range back during the half cycle it stands on */
    assert.ok(Math.abs(sweep - travel) / travel < 0.15, `${kind} legs ${legs}: sweep ${sweep.toFixed(3)} vs travel ${travel.toFixed(3)}`);
  }
});

test('petPlaySeq and petPlayAt with z0: every toy distance is measured from z0, the pounce travels PET_POUNCE', () => {
  for(const z0 of [P.PET_PLAY_Z, 0.5, 0.62]){ const A = P.petPlaySeq('pet-z:1', 30, z0), end = A[A.length - 1].t1;
    assert.equal(A[0].a.tz, z0); A.forEach(m => assert.ok(m.b.tz - m.b.bz >= z0 - 1e-9, 'every move ends with the toy at least z0 ahead'));
    for(let t = 0; t <= end; t += 0.01){ const s = P.petPlayAt(A, t, z0); assert.ok(s.tz - s.bz >= z0 - 1e-9, `t ${t}: ${(s.tz - s.bz).toFixed(3)} < ${z0}`); }
    assert.ok(A.some(m => m.k === 'pounce' && Math.abs(m.b.bz - P.PET_POUNCE) < 1e-9)); }
  assert.equal(P.PET_POUNCE, 0.14);
  assert.equal(P.petPlayAt([], 0, 0.55).tz, 0.55); assert.equal(P.petPlayAt([], 0).tz, P.PET_PLAY_Z);
  assert.deepEqual(P.petPlaySeq('pet-z:1', 30), P.petPlaySeq('pet-z:1', 30, P.PET_PLAY_Z), 'the default is PET_PLAY_Z');
});

test('userData.playZ is at least PET_PLAY_Z and beyond the head\'s front extent in play, also for a long muzzle on short legs', () => {
  const T = { ...fakeThree(), SphereGeometry: class { constructor(){ this.pts = SPH; } dispose(){} getAttribute(){ return null; } } };
  const front = (g, kind2, o) => { g.userData.pose(kind2, 0, 1, { ...o, blend: 0 }); let m = -Infinity; const walk = q => q.children.forEach(c => { if(c.geometry && c.geometry.pts && c.name !== 'petFur') m = Math.max(m, ...c.geometry.pts.map(p => toWorld(p, c, g)[2])); walk(c); }); walk(g.userData.nodes.head); return m / g.scale.x; };
  for(const kind of ['dog', 'cat']) for(const ext of [{}, { snout: 1, legs: 0 }, { snout: 1, legs: 0, length: 1 }, { snout: 1, legs: 1 }]){
    const g = P.makePet(T, { kind, coat: ['#c89159'], ...ext }), Z = g.userData.playZ, seq = P.petPlaySeq('x', 30, Z);
    assert.ok(Z >= P.PET_PLAY_Z, `${kind} ${JSON.stringify(ext)} ${Z}`);
    for(const k of ['crouch', 'look']) for(const u of [0.5, 0.95]){ const m = seq.find(q => q.k === k && q.a.bz === 0), s = P.petPlayAt(seq, m.t0 + (m.t1 - m.t0) * u, Z);
      const f = front(g, 'play', { play: s }); assert.ok(f - s.bz < Z, `${kind} ${JSON.stringify(ext)} ${k}@${u}: head reaches ${f.toFixed(3)}, playZ ${Z}`); } }
  const T2 = fakeThree(); assert.ok(P.makePet(T2, { kind: 'dog', coat: ['#c89159'], snout: 1, legs: 0 }).userData.playZ > P.makePet(T2, { kind: 'dog', coat: ['#c89159'] }).userData.playZ, 'a long muzzle pushes the toy further out');
});

test('userData.air is 0 standing and positive at the top of a pounce', () => {
  const T = fakeThree(), g = P.makePet(T, { kind: 'cat', coat: ['#c89159'] }), ud = g.userData, seq = P.petPlaySeq('x', 30), m = seq.find(q => q.k === 'pounce');
  assert.equal(ud.air, 0); ud.pose('stand', 0, 1, { blend: 0 }); assert.equal(ud.air, 0);
  ud.pose('walk', 0, 1, { phase: 0.25, blend: 0 }); assert.equal(ud.air, 0, 'the walk bob is not air');
  ud.pose('play', 0, 2, { play: P.petPlayAt(seq, m.t0 + (m.t1 - m.t0) * 0.42), blend: 0 }); assert.ok(ud.air > 0.03, 'pounce top: ' + ud.air);
  ud.pose('play', 0, 3, { play: P.petPlayAt(seq, m.t0 + 0.001), blend: 0 }); assert.equal(ud.air, 0, 'still crouched at the start');
});

test('PET_TOYS: ten toys, the first four unchanged, and every toy carries the contract fields', () => {
  assert.deepEqual(P.PET_TOYS, ['ball', 'bone', 'yarn', 'mouse', 'frisbee', 'rope', 'duck', 'feather', 'fish', 'bell']);
  const T = fakeThree();
  for(const kind of P.PET_TOYS){ const g = P.makeToy(T, kind), u = g.userData;
    assert.equal(u.kind, kind); assert.ok(u.spin && u.spin.parent === g, kind); assert.ok(u.r > 0 && u.r <= 0.045, kind + ' r'); assert.equal(typeof u.round, 'boolean', kind); assert.equal(typeof u.dispose, 'function', kind);
    let n = 0; g.children.forEach(function walk(c){ if(c.geometry){ n++; assert.equal(c.castShadow, false, kind + ' casts no shadow'); assert.equal(c.receiveShadow, true, kind); } (c.children || []).forEach(walk); }); assert.ok(n >= 1, kind + ' has a part'); u.dispose(); }
  assert.deepEqual(P.PET_TOYS.filter(k => P.makeToy(T, k).userData.carryYaw === 0), ['bone', 'frisbee', 'rope'], 'held along the mouth: the bone, the rope and the frisbee');
  assert.deepEqual(P.PET_TOYS.filter(k => P.makeToy(T, k).userData.round), ['ball', 'yarn', 'bell']);
});

test('normalizePetLook keeps a known toy and drops any other value; a look without one stays without; a breed pick keeps the toy', () => {
  const base = { kind: 'dog', coat: ['#c89159'] };
  for(const t of P.PET_TOYS) assert.equal(P.normalizePetLook({ ...base, toy: t }).toy, t, t);
  assert.equal(P.normalizePetLook({ ...base, toy: 'duck' }).toy, 'duck');
  for(const bad of ['laser', '', null, 3, ['duck'], undefined]) assert.ok(!('toy' in P.normalizePetLook({ ...base, toy: bad })), 'toy ' + JSON.stringify(bad) + ' is removed');
  assert.ok(!('toy' in P.normalizePetLook(base)), 'no key when absent');
  assert.deepEqual(P.normalizePetLook(P.normalizePetLook({ ...base, toy: 'fish' })), P.normalizePetLook({ ...base, toy: 'fish' }), 'idempotent');
  const picked = P.petApplyBreed({ ...base, toy: 'bell', name: 'Mo' }, { kind: 'cat', coat: ['#efe3cf', '#5a4538'], pattern: 'point', toy: 'yarn' });
  assert.equal(picked.toy, 'bell'); assert.equal(picked.name, 'Mo'); assert.equal(picked.kind, 'cat');
  assert.ok(!('toy' in P.petApplyBreed(base, { kind: 'cat', coat: ['#efe3cf'], toy: 'yarn' })), 'a breed look\'s toy is not the member\'s choice');
  const T = fakeThree(); assert.equal(P.petShapeKey({ ...base, toy: 'rope' }), P.petShapeKey(base), 'a toy is not a body shape, so the model is only repainted');
  assert.equal(P.petRecolor(P.makePet(T, base), { ...base, toy: 'rope' }), true);
});

test('makeToy: every toy says how it is held in the mouth (carryYaw): the bone crosswise, the rest a quarter turn', () => {
  const T = fakeThree();
  for(const kind of P.PET_TOYS){ const y = P.makeToy(T, kind).userData.carryYaw; assert.equal(typeof y, 'number', kind); assert.ok(Number.isFinite(y), kind); }
  assert.equal(P.makeToy(T, 'bone').userData.carryYaw, 0); assert.equal(P.makeToy(T, 'mouse').userData.carryYaw, Math.PI / 2);
});

test('eyes on dark paint get the light ring and a light lid, decided by the colour painted at the eye (point, tuxedo, solid black); light faces keep the plain iris', () => {
  const T = fakeThree(), L = h => hexToOklab(h)[0], eye = look => { const g = P.makePet(T, look), u = r => g.userData.mats.find(x => x.role === r).m.userData.pet; return { e: u('eye'), lid: u('lid') }; };
  for(const look of [{ kind: 'cat', coat: ['#efe3cf', '#5a4538'], pattern: 'point', eye: '#6fa8dc' }, { kind: 'dog', coat: ['#e2c9a0', '#3d3536'], pattern: 'point', snout: 0 },
    { kind: 'cat', coat: ['#34343a', '#f6f3ee'], pattern: 'tuxedo' }, { kind: 'dog', coat: ['#35353b', '#f6f3ee'], pattern: 'tuxedo' }, { kind: 'cat', coat: ['#38373c'] }, { kind: 'dog', coat: ['#202022'] }]){
    const { e, lid } = eye(look); assert.ok(L(e.uPetC2.value.c) > 0.85, 'light ring: ' + JSON.stringify(look)); assert.ok(e.uPetFreq.value > -1, 'the ring is drawn'); assert.ok(L(lid.uPetC0.value.c) > 0.85, 'light lid: ' + JSON.stringify(look)); }
  for(const look of [{ kind: 'cat', coat: ['#efe3cf'] }, { kind: 'dog', coat: ['#e3a058', '#f7f2ea'], pattern: 'bicolor' }, { kind: 'cat', coat: ['#f7f3ec', '#e59a4a', '#3b3839'], pattern: 'calico' }]){
    const { e, lid } = eye(look); assert.equal(e.uPetC2.value.c, e.uPetC1.value.c, 'no ring on a light face: ' + JSON.stringify(look)); assert.ok(L(lid.uPetC0.value.c) < 0.5); }
  const { e } = eye({ kind: 'dog', coat: ['#efe3cf', '#5a4538'], pattern: 'point' }); assert.ok(e.uPetTh.value > 0.5, 'on a dark mask the pupil shrinks so the iris shows');
});
