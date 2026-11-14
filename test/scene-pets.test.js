import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../site/assets/scene/pets.js');
const { normalizePetLook, petLookFromPixels, petPlan, pickPets, petHash, pastel, hexToOklab, PET_KINDS, PET_PATTERNS, PET_EARS, PET_TAILS, PET_SIZES, PET_DEFAULTS, PET_ACTS } = P;

test('the enum lists the server validates with are exported', () => {
  assert.deepEqual(PET_KINDS, ['dog', 'cat']);
  assert.deepEqual(PET_PATTERNS, ['solid', 'patch', 'tabby', 'tuxedo', 'point']);
  assert.deepEqual(PET_EARS, ['up', 'flop', 'fold']);
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
  assert.match(src, /customProgramCacheKey = \(\) => 'petcoat1'/, 'every coat material shares one program');
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
  assert.match(src, /import \{[^}]*normalizePetLook[^}]*pickPets[^}]*petPlan[^}]*makePet[^}]*makeBowls[^}]*makeToy[^}]*makeToyBasket[^}]*makePhotoFrame[^}]*disposePetShared[^}]*PET_MAX[^}]*\} from '\.\/pets\.js\?v=p3'/);
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
  class O { constructor(geometry, material){ this.position = new V(); this.rotation = new E(); this.scale = new V(1, 1, 1); this.children = []; this.userData = {}; this.visible = true; this.name = ''; this.geometry = geometry; this.material = material; }
    add(...c){ c.forEach(x => { x.parent = this; this.children.push(x); }); return this; } remove(c){ this.children = this.children.filter(x => x !== c); } dispose(){} }
  class G { dispose(){} getAttribute(){ return null; } }
  class M { constructor(o = {}){ Object.assign(this, o); this.userData = {}; this.color = { set(){} }; } dispose(){} }
  return { Group: O, Mesh: O, InstancedMesh: O, SphereGeometry: G, CapsuleGeometry: G, ConeGeometry: G, TorusGeometry: G, LatheGeometry: G, Vector2: V, Vector3: V, Color: class { constructor(c){ this.c = c; } set(c){ this.c = c; } }, MeshStandardMaterial: M };
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
