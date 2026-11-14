/* Cosmetics for the team office: nine head pieces for the cast animals and eight desk items.
 * Like holiday.js and pets.js this file imports nothing: every maker takes the three instance T (the same three@0.160.0 build office-scene.js
 * imports), and GEAR_ITEMS and headGearFit are pure, so Node can test them. The server decides which items a person has unlocked; this file only
 * draws them. Geometries are shared per T (freed by disposeGearShared); each piece owns its materials and frees them with userData.dispose().
 * Animated pieces carry userData.tick(t, night, reduced): t is seconds, night is 0..1 (a boolean works too), and reduced holds every part still.
 *
 * Head pieces are in cast model units with the origin on the top of the skull, where castCrown() in office-scene.js sits (HEAD_ANCHOR). Add one
 * to a cast model before it is scaled and place it with placeHeadGear(g, headGearFit(id, species)). The skull is close to a ball of radius 0.36
 * whose centre is 0.37 below the anchor; the front is +z.
 * Desk items stand on y = 0 (the desk top) and face +z; each fits in 0.5 x 0.5 and is at most about 0.7 tall, in desk units. */

/* the catalogue; the server's _cosmetic_items() carries the same ids and decides the unlock levels */
export const GEAR_SLOTS = ['head', 'desk'];
export const GEAR_ITEMS = [
  ...['cap', 'beanie', 'ribbon', 'flower', 'party', 'headphones', 'tophat', 'wizard', 'halo'].map(id => ({ id, slot: 'head' })),
  ...['plant', 'lamp', 'figurine', 'snowglobe', 'trophy', 'lavalamp', 'aquarium', 'neon'].map(id => ({ id, slot: 'desk' })),
];
export const HEAD_ANCHOR = [0, 1.04, -0.02];
const SKULL_Y = -0.37, SKULL_R = 0.36;

/* ---------- fit ---------- */
/* Hat-type pieces: item -> species -> [y, z, s, rx] (cap and beanie add c, the cover angle). y lifts the piece above the anchor, z moves it along the
 * face direction, s scales it, rx tilts it back (negative) or forward. The values come from a fit solver run on the seated and the standing model of each
 * species: it counts model vertices that would pass through the piece (ears, horns, sunglasses, crests) and rejects any fit where the piece floats over
 * the head, sinks too far, or overhangs the head at its rim; among the clean fits it keeps the largest, least shifted one. A species missing from a list
 * uses FIT0. See the fit notes for the method and the sheets it was checked on. */
const FIT = {
  cap: {
    dragon: [0.068, -0.08, 1, -0.4, 0.55], unicorn: [0.14, -0.12, 1, -0.2, 0.95], lion: [0.234, -0.04, 1, -0.1, 0.95], tiger: [0.014, 0.12, 1, 0, 0.7],
    eagle: [0.002, 0.04, 1, -0.1, 0.9], wolf: [0.048, 0.12, 1, -0.1, 0.55], cheetah: [0, 0.04, 1, -0.1, 0.65], fox: [0.008, 0, 1, 0, 0.45],
    owl: [0.022, 0.04, 0.93, -0.1, 0.95], husky: [0.08, 0, 1, 0.1, 0.65], panda: [0.04, 0.12, 1, 0.1, 0.7], koala: [-0.06, 0, 1, -0.1, 0.5],
    penguin: [-0.012, 0, 1, -0.1, 0.95], raccoon: [0.048, 0, 1, -0.1, 0.6], cat: [-0.02, 0, 1, -0.1, 0.45], dog: [-0.006, 0, 1, -0.1, 0.95],
    bear: [-0.006, 0, 1, 0, 0.5], sheep: [0.134, -0.04, 1, 0.1, 0.8], squirrel: [0.014, -0.12, 0.93, -0.3, 0.95], hedgehog: [0.04, 0, 1, -0.1, 0.95],
    rabbit: [-0.018, 0.12, 1, -0.1, 0.45], monkey: [0.008, -0.04, 1, -0.2, 0.95], pig: [-0.006, 0.04, 1, -0.2, 0.5],
    mouse: [-0.02, 0.12, 1, 0.1, 0.65], elephant: [0, 0, 1, -0.1, 0.9], frog: [0.022, 0, 1, -0.3, 0.95], duck: [-0.006, -0.04, 1, -0.2, 0.9],
    hamster: [-0.052, 0, 1, -0.1, 0.45], chick: [0.014, 0, 1, 0.1, 0.9]
  },
  beanie: {
    dragon: [0.034, 0, 1, -0.3, 0.95], unicorn: [0.148, 0, 1, -0.1, 0.95], lion: [0.214, 0, 1, -0.2, 0.95], tiger: [-0.026, 0, 1, -0.1, 0.6],
    eagle: [-0.026, 0, 1, -0.1, 0.95], wolf: [0.008, 0, 1, -0.1, 0.5], cheetah: [-0.006, -0.04, 1, -0.2, 0.95], fox: [-0.012, 0.04, 1, -0.1, 0.5],
    owl: [-0.032, 0, 1, -0.2, 0.95], husky: [0.034, 0, 1, 0.1, 0.7], panda: [0.054, 0, 1, 0, 0.8], koala: [-0.058, 0, 1, -0.1, 0.55],
    penguin: [-0.086, 0, 1, -0.1, 0.95], raccoon: [0.02, 0, 1, 0, 0.95], cat: [-0.006, 0.12, 1, -0.1, 0.65], dog: [-0.052, 0, 1, -0.1, 0.95],
    deer: [0.122, 0, 1, -0.3, 0.4], bear: [-0.018, 0, 1, -0.1, 0.6], sheep: [0.14, 0, 1, 0, 0.95], squirrel: [-0.026, -0.04, 1, -0.1, 0.95],
    hedgehog: [-0.018, 0, 1, -0.1, 0.95], rabbit: [-0.106, 0.12, 1, 0, 0.4], monkey: [-0.046, 0, 1, -0.1, 0.95], pig: [-0.03, 0.06, 1, -0.1, 0.5],
    mouse: [-0.072, 0.12, 1, -0.1, 0.55], elephant: [-0.046, 0, 1, -0.1, 0.95], frog: [-0.026, 0, 1, -0.4, 0.95], duck: [-0.066, 0, 1, -0.1, 0.95],
    hamster: [-0.04, -0.08, 1, -0.3, 0.95], chick: [-0.046, -0.04, 1, -0.1, 0.95]
  },
  ribbon: {
    dragon: [0.128, 0, 1, -0.3], unicorn: [0.094, 0, 1, -0.1], lion: [0.2, 0.1, 0.9, -0.2], tiger: [0.02, 0.04, 1, -0.1],
    eagle: [-0.046, -0.12, 1, -0.4], wolf: [0.042, 0.04, 1, -0.1], cheetah: [0, -0.04, 0.8, 0.1], fox: [0.008, 0, 1, -0.2], owl: [0.02, 0, 1, -0.1],
    husky: [0.054, 0, 0.9, 0.1], panda: [0.04, -0.04, 1, 0], koala: [-0.038, 0.04, 1, -0.1], penguin: [0, -0.12, 1, 0.1],
    raccoon: [0.042, -0.08, 0.8, -0.3], cat: [-0.006, 0, 0.95, -0.4], dog: [-0.032, 0, 0.95, -0.4], deer: [0.06, -0.12, 1, -0.2],
    bear: [-0.006, 0, 1, -0.2], sheep: [0.1, 0.04, 0.95, -0.1], squirrel: [0, 0, 0.75, -0.1], hedgehog: [0.008, -0.04, 1, -0.3],
    rabbit: [-0.026, 0, 0.95, -0.1], monkey: [0.028, 0, 1, 0.1], pig: [-0.012, 0.04, 0.85, -0.3], mouse: [-0.046, 0.04, 1, -0.1],
    elephant: [-0.012, -0.04, 1, -0.1], frog: [0, -0.08, 1, -0.1], duck: [0.002, -0.04, 0.85, 0.1], hamster: [-0.04, 0.04, 1, -0.2],
    chick: [0.022, -0.04, 0.75, -0.1]
  },
  flower: {
    dragon: [0.134, 0, 1, -0.1], unicorn: [0.148, 0, 1, -0.1], lion: [0.208, 0, 1, -0.1], tiger: [0.042, 0, 1, -0.2], eagle: [0.034, 0, 1, -0.2],
    wolf: [0.074, 0, 1, -0.2], cheetah: [0.002, 0, 1, -0.1], fox: [0.028, 0, 1, -0.1], owl: [0.068, 0, 1, -0.1], husky: [0.048, 0, 1, -0.1],
    panda: [0.034, 0, 1, -0.1], koala: [-0.026, 0, 1, -0.1], penguin: [-0.006, 0, 1, -0.1], raccoon: [0.04, 0, 1, -0.1], cat: [0.008, 0, 1, -0.1],
    dog: [-0.02, 0, 1, -0.1], deer: [0.208, 0, 1, -0.1], bear: [-0.006, 0, 1, -0.1], sheep: [0.134, 0, 1, -0.1], squirrel: [0.002, 0, 1, -0.1],
    hedgehog: [0.02, 0, 1, -0.1], rabbit: [-0.032, 0, 1, -0.1], monkey: [0.008, 0, 1, -0.1], pig: [0.014, 0, 1, -0.1], mouse: [-0.04, 0, 1, -0.1],
    elephant: [-0.018, 0, 1, -0.1], frog: [0.088, 0, 1, -0.1], duck: [-0.012, 0, 1, -0.1], hamster: [-0.032, 0, 1, -0.1], chick: [-0.012, 0, 1, -0.1]
  },
  party: {
    dragon: [0.094, -0.04, 1, -0.1], unicorn: [0.1, -0.06, 1, -0.25], lion: [0.194, 0, 1, -0.1], tiger: [0.02, 0, 1, -0.1],
    eagle: [-0.026, 0, 1, -0.1], wolf: [0.08, 0, 1, -0.1], cheetah: [-0.006, 0, 1, -0.1], fox: [0.06, 0, 1, -0.1], owl: [-0.006, 0, 1, -0.1],
    husky: [0.088, 0, 1, -0.1], panda: [0.054, 0, 1, -0.1], koala: [0, 0, 1, -0.1], penguin: [-0.06, 0, 1, -0.1], raccoon: [0.022, 0, 1, -0.1],
    cat: [0.054, 0, 1, -0.1], dog: [-0.02, 0, 1, -0.1], deer: [0.188, -0.04, 1, -0.1], bear: [0.028, 0, 1, -0.1], sheep: [0.148, 0, 1, -0.1],
    squirrel: [0.048, 0, 1, -0.1], hedgehog: [-0.012, -0.04, 1, 0], rabbit: [-0.052, 0.04, 0.65, 0], monkey: [0.008, -0.12, 1, -0.1],
    pig: [0, 0, 1, -0.1], mouse: [0.014, 0.04, 1, 0], elephant: [-0.058, -0.04, 1, -0.1], frog: [0.04, 0, 1, -0.1], duck: [-0.006, -0.12, 1, -0.1],
    hamster: [-0.006, 0, 1, -0.1], chick: [0.04, 0, 1, -0.1]
  },
  tophat: {
    dragon: [0.12, 0, 0.75, -0.2], unicorn: [0.13, -0.14, 0.9, -0.25], lion: [0.2, 0, 1, -0.1], tiger: [0.014, 0, 1, -0.1], eagle: [0, 0, 1, -0.1],
    wolf: [0.054, 0.04, 0.95, -0.1], cheetah: [-0.012, 0, 1, -0.1], fox: [0.04, 0.04, 1, -0.1], owl: [0.022, 0, 1, -0.3],
    husky: [0.108, -0.04, 1, -0.1], panda: [0.042, 0, 1, -0.1], koala: [-0.02, 0, 1, -0.1], penguin: [-0.006, 0, 1, -0.1], raccoon: [0.06, 0, 1, -0.1],
    cat: [0.034, 0, 1, -0.1], dog: [0, 0, 1, -0.1], deer: [0.2, -0.04, 0.85, -0.1], bear: [0.014, 0, 1, -0.1], sheep: [0.214, 0, 1, -0.1],
    squirrel: [0.074, -0.04, 1, -0.1], hedgehog: [0.014, 0, 1, -0.1], monkey: [0.008, 0, 1, -0.1], pig: [0, 0, 1, -0.1],
    mouse: [-0.02, 0.04, 0.85, 0.1], elephant: [-0.02, 0, 1, -0.1], frog: [0.04, 0.04, 1, -0.3], duck: [-0.012, -0.04, 1, -0.1],
    hamster: [-0.026, 0, 1, -0.1], chick: [0.08, 0, 1, -0.1]
  },
  wizard: {
    dragon: [0.148, 0, 1, -0.1], unicorn: [0.13, -0.1, 1, -0.25], lion: [0.22, 0, 1, -0.1], tiger: [0.042, 0, 1, -0.1], eagle: [0.014, 0, 1, -0.1],
    wolf: [0.06, 0.04, 0.6, -0.1], cheetah: [0.02, 0, 1, -0.1], fox: [0.068, 0.04, 0.75, -0.1], owl: [0.048, 0, 1, -0.2], husky: [0.134, 0, 1, -0.1],
    panda: [0.082, 0, 1, -0.1], koala: [0.028, 0, 1, 0], penguin: [-0.02, 0, 1, -0.1], raccoon: [0.068, 0, 1, -0.1], cat: [0.06, 0.04, 0.85, 0.1],
    dog: [0.008, 0, 1, -0.1], deer: [0.24, 0, 1, -0.1], bear: [0.054, 0, 1, -0.1], sheep: [0.22, 0, 1, -0.1], squirrel: [0.1, 0, 1, -0.1],
    hedgehog: [0.008, 0, 1, -0.1], monkey: [0.028, 0, 1, 0.1], pig: [0.034, 0, 1, -0.1], mouse: [0.06, -0.12, 1, -0.1], elephant: [-0.026, 0, 1, -0.1],
    frog: [0.06, 0, 1, -0.1], duck: [0.028, -0.04, 1, 0.1], hamster: [0.008, 0, 1, -0.1], chick: [0.08, 0, 1, -0.1]
  },
};
const FIT0 = { y: 0, z: 0, s: 1, rx: -0.1, c: 0.85 };
/* Headphones (band height, head width factor, nudge back) and the halo's lift, per species; measured on the head profile and checked on the sheets */
const PHONES = {
  lion: [0.1, 1.3, -0.04], deer: [0.05, 1, -0.08], husky: [0.02, 1, -0.03], sheep: [0.06, 1.12, 0], squirrel: [0.02, 1, -0.03], hedgehog: [0.04, 1.08, 0],
  monkey: [0.02, 1.08, 0], raccoon: [0.02, 1.1, 0], frog: [0.02, 1, -0.02], unicorn: [0, 1, -0.1], dragon: [0, 1, -0.06], wolf: [0, 1.02, -0.04],
  fox: [0, 1, -0.04], cat: [0, 1.05, -0.03], tiger: [0, 1.04, 0], panda: [0, 1.1, 0], koala: [0, 1.05, 0], dog: [0, 1.05, 0], bear: [0, 1.1, 0],
  pig: [0, 1.02, 0], mouse: [0, 1.05, 0], elephant: [0, 1.12, 0], rabbit: [0, 1, 0.04],
};
const HALO_Y = { dragon: 0.06, unicorn: 0.05, lion: 0.15, wolf: 0.02, fox: 0.02, husky: 0.06, panda: 0.05, raccoon: 0.04, cat: 0.02, deer: 0.1, bear: 0.02,
  sheep: 0.1, squirrel: 0.04, hedgehog: 0.06, rabbit: 0.02, monkey: 0.05, frog: 0.03, duck: 0.01, chick: 0.03 };
/* Pieces a species cannot wear, with the reason. The model is two merged meshes, so its own headwear cannot be hidden: a hat-type piece on a species
 * that already wears one would be a second hat. The shop reads this through headGearSkips() and tells the member the item is not shown on that animal. */
const SKIPS = {
  husky: ['cap', 'beanie', 'party', 'tophat', 'wizard'],   /* a red knit hat with a pom-pom over the whole crown, the ears through it */
  panda: ['cap', 'beanie', 'party', 'tophat', 'wizard', 'headphones'],   /* a straw hat with a wide brim: hats would stack on it, the headphone band would cut the brim */
  raccoon: ['cap', 'beanie', 'party', 'tophat', 'wizard'],   /* an orange cap over the crown, its brim to the side */
  bear: ['cap', 'beanie', 'party', 'tophat', 'wizard'],   /* a teal cap over the crown, its brim at the back */
  sheep: ['cap', 'beanie', 'party', 'tophat', 'wizard', 'ribbon'],   /* a red beret over the right of the crown; the bow would sit on it */
  squirrel: ['cap', 'beanie', 'party', 'tophat', 'wizard'],   /* a green knit hat with a cuff and a pom-pom, one ear through it */
  chick: ['party', 'tophat', 'wizard'],   /* an eggshell cap: the cap and the beanie cover it, a perched hat leaves it showing underneath */
  rabbit: ['ribbon', 'tophat', 'wizard'],   /* a pink bow of its own; the long ears rise from the middle of the crown, so a brimmed hat cannot sit between them */
  pig: ['ribbon'],   /* heart sunglasses pushed up on the crown, read as a second bow */
  unicorn: ['tophat', 'wizard'],   /* the horn rises from the forehead to brim height and the sunglasses sit in front of the crown: a brim rests on the horn tip */
  dragon: ['cap', 'party', 'tophat', 'wizard'],   /* two horns beside the crown: a cap or a brim between them is tiny, a larger one rests on the horn tips */
  deer: ['cap', 'beanie', 'party', 'tophat', 'wizard'],   /* the antlers rise from the crown: every hat either swallows them or rests on their tips */
};
export function headGearSkips(species){ return (SKIPS[species] || []).slice(); }
const num = (v, d) => Number.isFinite(v) ? v : d;
/* { y, z, s, rx, c, w, skip }: lift above the anchor, nudge along z, scale, tilt about x, cover angle (cap, beanie), width factor (headphones),
 * and whether the piece is left off this species */
export function headGearFit(id, species){
  const skip = !!(SKIPS[species] && SKIPS[species].includes(id));
  if(id === 'headphones'){ const p = PHONES[species] || [0, 1, 0]; return { y: p[0], z: p[2], s: 1, rx: -0.1, c: FIT0.c, w: p[1], skip }; }
  if(id === 'halo') return { y: num(HALO_Y[species], 0), z: 0, s: 1, rx: 0, c: FIT0.c, w: 1, skip };
  const f = (FIT[id] || {})[species];
  return f ? { y: num(f[0], 0), z: num(f[1], 0), s: num(f[2], 1), rx: num(f[3], FIT0.rx), c: num(f[4], FIT0.c), w: 1, skip } : { ...FIT0, w: 1, skip };
}
/* put a head piece where headGearFit says, in the model space of a cast model (before the model is scaled) */
export function placeHeadGear(g, fit){
  g.position.set(HEAD_ANCHOR[0], HEAD_ANCHOR[1] + fit.y, HEAD_ANCHOR[2] + fit.z);
  g.scale.setScalar(fit.s); g.rotation.set(fit.rx, 0, 0);
  if(g.userData.setWidth) g.userData.setWidth(fit.w);
  if(g.userData.setCover) g.userData.setCover(fit.c);
  return g;
}

/* ---------- shared pieces ---------- */
const SHARED = new WeakMap();
function geo(T, key, make){
  let s = SHARED.get(T); if(!s){ s = new Map(); SHARED.set(T, s); }
  let g = s.get(key); if(!g){ g = make(); s.set(key, g); }
  return g;
}
export function disposeGearShared(T){ const s = SHARED.get(T); if(s){ s.forEach(g => g.dispose()); SHARED.delete(T); } }
/* materials and instanced meshes belong to the piece; geometries are shared */
function kit(T){
  const mats = new Set(), inst = [];
  const k = {
    std: (color, o = {}) => { const m = new T.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o }); mats.add(m); return m; },
    glow: (color, intensity, o = {}) => k.std(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.35, ...o }),
    glass: (color, opacity) => k.std(color, { roughness: 0.08, transparent: true, opacity, depthWrite: false }),
    mesh: (g, m, parent, p, r, s) => { const x = new T.Mesh(g, m); if(p) x.position.set(...p); if(r) x.rotation.set(...r); if(s) (typeof s === 'number' ? x.scale.setScalar(s) : x.scale.set(...s)); if(parent) parent.add(x); return x; },
    inst: (g, m, n, parent) => { const x = new T.InstancedMesh(g, m, n); inst.push(x); if(parent) parent.add(x); return x; },
    dispose: () => { inst.forEach(i => i.dispose()); mats.forEach(m => m.dispose()); inst.length = 0; mats.clear(); },
  };
  return k;
}
const nightOf = n => Math.max(0, Math.min(1, Number(n) || 0));
const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
/* every animated piece reads its own phase, so two desks with the same item do not move in step (the integrator sets userData.phase) */
const phaseOf = g => Number(g.userData.phase) || 0;
/* the wizard cone: a centre line that rises straight and bends over to the right and back at the top, and the radius along it (u = 0 base, 1 tip) */
const WIZ_H = 0.52;
const wizAt = u => [0.17 * u ** 3, WIZ_H * u - 0.05 * u ** 3, -0.05 * u * u];
const wizR = u => 0.205 * Math.pow(Math.max(0, 1 - u), 1.1) + 0.006;
const WIZ_STARS = [[0.26, 0.45, 0.045], [0.52, -0.55, 0.034], [1, 0, 0.04]];
/* one smooth tube along the centre line, closed at the tip; the base stays open under the brim */
const bentCone = T => geo(T, 'wizcone', () => {
  const N = 24, M = 28, pos = [], idx = [], t = new T.Vector3(), b1 = new T.Vector3(), b2 = new T.Vector3(), Z = new T.Vector3(0, 0, 1);
  for(let i = 0; i <= N; i++){
    const u = i / N, c = wizAt(u), c1 = wizAt(Math.max(0, u - 0.01)), c2 = wizAt(Math.min(1, u + 0.01)), r = wizR(u);
    t.set(c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]).normalize(); b1.crossVectors(Z, t).normalize(); b2.crossVectors(t, b1);
    for(let j = 0; j < M; j++){ const a = j / M * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); pos.push(c[0] + r * (ca * b1.x + sa * b2.x), c[1] + r * (ca * b1.y + sa * b2.y), c[2] + r * (ca * b1.z + sa * b2.z)); }
  }
  const tip = wizAt(1); pos.push(tip[0] + t.x * 0.012, tip[1] + t.y * 0.012, tip[2] + t.z * 0.012);
  for(let i = 0; i < N; i++) for(let j = 0; j < M; j++){ const a = i * M + j, b = i * M + (j + 1) % M, c = a + M, d = b + M; idx.push(a, b, c, b, d, c); }
  const tp = (N + 1) * M; for(let j = 0; j < M; j++) idx.push(N * M + j, N * M + (j + 1) % M, tp);
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
});
/* the lava lamp's glass, as [radius, height] from its foot, and its inner radius at a height */
const LAVA = [[0.0, 0], [0.07, 0], [0.095, 0.12], [0.082, 0.24], [0.052, 0.3], [0.0, 0.3]];
const lavaR = y => { for(let i = 1; i < LAVA.length - 1; i++){ const [r0, y0] = LAVA[i], [r1, y1] = LAVA[i + 1]; if(y >= y0 && y <= y1) return r0 + (r1 - r0) * (y - y0) / Math.max(1e-6, y1 - y0); } return 0.05; };
/* the finished group: shadows on (glass and glow-only parts opt out with userData.noShadow), dispose attached */
function done(g, K){
  g.traverse(o => { if(o.isMesh){ o.castShadow = !o.userData.noShadow; o.receiveShadow = true; } });
  g.userData.dispose = K.dispose;
  return g;
}
const unitSph = T => geo(T, 'sph', () => new T.SphereGeometry(1, 20, 14));
const fluffy = T => geo(T, 'fluff', () => new T.IcosahedronGeometry(1, 1));
/* cap and beanie crowns: lathe shells concentric with the skull (centre SKULL_Y) of radius rh, the top lifted by lift, reaching down to the polar
 * angle c from the top. shellY is the outer height at a distance r from the axis; shellRim is [radius, height] of the rim. */
const SHELL = { cap: { rh: SKULL_R + 0.03, lift: 0.035 }, beanie: { rh: SKULL_R + 0.045, lift: 0.085 } };
const COVER0 = 0.85;
const coverKey = c => Math.round(Math.min(1.1, Math.max(0.3, Number(c) || COVER0)) * 40) / 40;
const shellY = (k, r, c) => { const { rh, lift } = SHELL[k], ph = Math.asin(Math.min(1, r / rh)), cc = Math.cos(c); return SKULL_Y + rh * Math.cos(ph) + lift * Math.max(0, Math.cos(ph) - cc) / (1 - cc); };
const shellRim = (k, c) => [SHELL[k].rh * Math.sin(c), SKULL_Y + SHELL[k].rh * Math.cos(c)];
const shellGeo = (T, k, c) => geo(T, 'shell' + k + c, () => {
  const pts = [], n = 16, rimR = SHELL[k].rh * Math.sin(c);
  for(let i = 0; i <= n; i++){ const ph = c * (1 - i / n), r = i === n ? 0 : SHELL[k].rh * Math.sin(ph); pts.push(new T.Vector2(r, shellY(k, r, c))); }
  const g = new T.LatheGeometry(pts, 48);
  if(k === 'beanie'){ const p = g.attributes.position; for(let i = 0; i < p.count; i++){ const x = p.getX(i), z = p.getZ(i), q = 1 + 0.03 * Math.cos(Math.atan2(z, x) * 18) * Math.min(1, Math.hypot(x, z) / rimR); p.setX(i, x * q); p.setZ(i, z * q); } }
  g.computeVertexNormals(); return g;
});
const ribRing = (T, tb = 0.2) => geo(T, 'ribring' + tb, () => {
  const g = new T.TorusGeometry(1, tb, 10, 64), p = g.attributes.position;
  for(let i = 0; i < p.count; i++){ const x = p.getX(i), y = p.getY(i), a = Math.atan2(y, x), r = Math.hypot(x, y), k = 1 + 0.02 * Math.cos(a * 36) / Math.max(0.5, r); p.setX(i, x * k); p.setY(i, y * k); }
  g.computeVertexNormals(); return g;
});
const starGeo = T => geo(T, 'star', () => {
  const sh = new T.Shape();
  for(let i = 0; i < 10; i++){ const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.45 : 1; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  sh.closePath();
  const g = new T.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 1 }); g.center(); return g;
});
const cyl = (T, rt, rb, h, n = 24, open = false) => geo(T, `cyl${rt},${rb},${h},${n},${open}`, () => new T.CylinderGeometry(rt, rb, h, n, 1, open));
const box = (T, w, h, d) => geo(T, `box${w},${h},${d}`, () => new T.BoxGeometry(w, h, d));
const torus = (T, r, t, arc = Math.PI * 2, rs = 10, ts = 32) => geo(T, `tor${r},${t},${arc},${rs},${ts}`, () => new T.TorusGeometry(r, t, rs, ts, arc));
const tube = (T, key, pts, r, seg = 16) => geo(T, 'tube' + key, () => new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p => new T.Vector3(...p))), seg, r, 7, false));
/* a lathe whose stripes are crisp: each boundary is doubled and the colours go per vertex */
function stripedLathe(T, key, prof, cols){
  return geo(T, key, () => {
    const pts = [], idx = [];
    prof.forEach(([r, y, c], i) => { if(i && c !== prof[i - 1][2]){ pts.push(new T.Vector2(prof[i - 1][0] + (r - prof[i - 1][0]) * 0.0, y - 0.0008)); idx.push(prof[i - 1][2]); } pts.push(new T.Vector2(r, y)); idx.push(c); });
    const g = new T.LatheGeometry(pts, 28), n = pts.length, col = new Float32Array(g.attributes.position.count * 3), C = new T.Color();
    for(let v = 0; v < g.attributes.position.count; v++){ C.set(cols[idx[v % n]]); col.set([C.r, C.g, C.b], v * 3); }
    g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
  });
}
function setInst(im, i, T, p, r, s, color){
  const M = new T.Matrix4(), q = new T.Quaternion().setFromEuler(new T.Euler(...(r || [0, 0, 0])));
  M.compose(new T.Vector3(...p), q, Array.isArray(s) ? new T.Vector3(...s) : new T.Vector3(s, s, s)); im.setMatrixAt(i, M);
  if(color) im.setColorAt(i, new T.Color(color));
}

/* ---------- head pieces ---------- */
const HEAD = {
  /* a baseball cap, worn a little askew: a crown that follows the skull, the brim pointing to the right of the face, a star badge.
   * setCover(c) sets how far down the crown reaches (the polar angle from the top): small values make a cap that sits between pointed ears. */
  cap(T, K, b, g){
    b.rotation.set(0, 0.6, -0.07);
    const dome = K.mesh(shellGeo(T, 'cap', COVER0), K.std('#8ec5fb', { roughness: 0.7, side: T.DoubleSide }), b);
    const brim = K.mesh(geo(T, 'capbrim', () => new T.CylinderGeometry(0.23, 0.23, 0.03, 24, 1, false, -Math.PI / 2, Math.PI)), K.std('#5f9fe0', { roughness: 0.6 }), b);
    const btn = K.mesh(unitSph(T), K.std('#fffaf0', { roughness: 0.6 }), b, null, null, [0.036, 0.024, 0.036]);
    const star = K.mesh(starGeo(T), K.std('#ffd35a', { roughness: 0.45 }), b, null, null, [0.07, 0.07, 0.04]);
    g.userData.setCover = c => {
      const cc = coverKey(c), [rr, ry] = shellRim('cap', cc), ph = cc * 0.55, sr = SHELL.cap.rh * Math.sin(ph);
      dome.geometry = shellGeo(T, 'cap', cc);
      brim.position.set(0, ry + 0.014, rr * 0.7); brim.rotation.x = 0.1; brim.scale.set(0.75 + 0.25 * rr / 0.33, 1, 0.75 + 0.25 * rr / 0.33);
      btn.position.y = shellY('cap', 0, cc) + 0.012;
      star.position.set(0, shellY('cap', sr, cc) + 0.008 * Math.cos(ph), sr + 0.012); star.rotation.x = ph - Math.PI / 2;
    };
    g.userData.setCover(COVER0);
  },
  /* a knitted beanie: a ribbed crown that follows the skull with a slouch on top, a ribbed cuff and a pom-pom; setCover(c) as for the cap */
  beanie(T, K, b, g){
    b.rotation.z = -0.06;
    const dome = K.mesh(shellGeo(T, 'beanie', COVER0), K.std('#f6a5b6', { roughness: 1, side: T.DoubleSide }), b);
    const cuff = K.mesh(ribRing(T, 0.1), K.std('#fbc6d1', { roughness: 1 }), b, null, [Math.PI / 2, 0, 0]);
    const pom = K.mesh(fluffy(T), K.std('#fffaf0', { roughness: 1, flatShading: true }), b);
    g.userData.setCover = c => {
      const cc = coverKey(c), [rr, ry] = shellRim('beanie', cc);
      dome.geometry = shellGeo(T, 'beanie', cc);
      cuff.position.y = ry + 0.015; cuff.scale.set(rr - 0.004, rr - 0.004, 0.5);   /* a ring that hugs the rim, about 0.035 thick and 0.1 tall */
      pom.position.set(0.02, shellY('beanie', 0, cc) + 0.06, 0); pom.scale.setScalar(0.055 + 0.03 * rr / 0.33);
    };
    g.userData.setCover(COVER0);
  },
  /* a big bow on the right of the crown, tilted toward the ear */
  ribbon(T, K, b){
    b.position.set(0.13, 0.0, 0.06); b.rotation.set(-0.2, 0.25, -0.38);
    const pink = K.std('#ff8fb1', { roughness: 0.55 }), dark = K.std('#f2729a', { roughness: 0.55 });
    for(const s of [-1, 1]){
      K.mesh(unitSph(T), pink, b, [s * 0.13, 0.02, 0], [0, 0, s * 0.32], [0.14, 0.085, 0.06]);
      K.mesh(box(T, 0.065, 0.17, 0.022), dark, b, [s * 0.05, -0.08, 0.01], [0, 0, s * 0.35]);
    }
    K.mesh(unitSph(T), dark, b, [0, 0.01, 0.015], null, [0.05, 0.05, 0.045]);
  },
  /* one large flower with two small ones and leaves, on the right of the crown */
  flower(T, K, b){
    b.position.set(0.12, 0.0, 0.08); b.rotation.set(0.6, 0.3, -0.3); b.scale.setScalar(1.25);
    const FL = [[0, 0, 0, 1, '#ffb3c7', 6], [-0.16, -0.02, -0.03, 0.62, '#fff2a8', 5], [0.12, -0.03, -0.12, 0.58, '#c4b5fd', 5]];
    const np = FL.reduce((s, f) => s + f[5], 0), petals = K.inst(unitSph(T), K.std('#ffffff', { roughness: 0.6 }), np, b), mids = K.inst(unitSph(T), K.std('#ffffff', { roughness: 0.5 }), FL.length, b);
    let i = 0;
    FL.forEach(([x, y, z, s, c, n], f) => {
      for(let j = 0; j < n; j++){ const a = j / n * Math.PI * 2 + f; setInst(petals, i++, T, [x + Math.cos(a) * 0.075 * s, y, z + Math.sin(a) * 0.075 * s], [0, -a, 0.12], [0.075 * s, 0.028 * s, 0.05 * s], c); }
      setInst(mids, f, T, [x, y + 0.02 * s, z], null, [0.04 * s, 0.03 * s, 0.04 * s], f === 0 ? '#ffcf3f' : '#ff9d76');
    });
    const leaves = K.inst(unitSph(T), K.std('#7cc48a', { roughness: 0.7 }), 3, b);
    [[-0.08, -0.04, 0.1, 0.6], [0.1, -0.04, 0.06, -0.7], [-0.02, -0.05, -0.14, 2.6]].forEach(([x, y, z, a], j) => setInst(leaves, j, T, [x, y, z], [0, a, 0], [0.04, 0.012, 0.085], '#ffffff'));
    [petals, mids, leaves].forEach(m => { m.instanceMatrix.needsUpdate = true; if(m.instanceColor) m.instanceColor.needsUpdate = true; });
  },
  /* a striped party cone with a pom-pom, cocked to one side */
  party(T, K, b){
    b.rotation.set(0, 0, -0.2); b.position.x = 0.03;
    const H = 0.44, R = 0.16, N = 5, prof = [[0.0, 0, 0]];
    for(let i = 0; i <= N * 4; i++){ const u = i / (N * 4); prof.push([R * (1 - u) + 0.006, u * H, Math.min(N - 1, Math.floor(u * N)) % 3]); }
    const g = stripedLathe(T, 'party', prof, ['#8ec5fb', '#fff2a8', '#f9a8d4']);
    K.mesh(g, K.std('#ffffff', { roughness: 0.6, vertexColors: true }), b, [0, -0.04, 0]);
    K.mesh(ribRing(T), K.std('#f9a8d4', { roughness: 0.8 }), b, [0, -0.035, 0], [Math.PI / 2, 0, 0], [0.165, 0.165, 0.18]);
    K.mesh(fluffy(T), K.std('#fffaf0', { roughness: 1, flatShading: true }), b, [0, H - 0.02, 0], null, 0.06);
  },
  /* over-ear headphones: a band over the crown, tilted back from the skull centre, and a cup at each side. setWidth(w) follows the head. */
  headphones(T, K, b, g){
    const piv = new T.Group(); piv.position.y = SKULL_Y; piv.rotation.x = -0.12; b.add(piv);
    const R = SKULL_R + 0.01, body = K.std('#c4a6ee', { roughness: 0.45 }), cupM = K.std('#a98be8', { roughness: 0.45 }), pad = K.std('#fffaf0', { roughness: 1 });
    const band = K.mesh(torus(T, R, 0.032, Math.PI, 8, 40), body, piv); band.scale.y = 0.96;
    const cups = [-1, 1].map(s => {
      const c = new T.Group(); piv.add(c);
      K.mesh(cyl(T, 0.115, 0.115, 0.075, 24), cupM, c, [s * 0.045, 0, 0], [0, 0, Math.PI / 2]);
      K.mesh(cyl(T, 0.1, 0.1, 0.05, 24), pad, c, [s * -0.0, 0, 0], [0, 0, Math.PI / 2]);
      const dot = K.mesh(unitSph(T), K.glow('#7fe0b8', 0.6), c, [s * 0.085, 0.02, 0.03], null, [0.012, 0.022, 0.022]); dot.userData.noShadow = true;
      return [c, s];
    });
    g.userData.setWidth = w => { const ww = Math.max(0.6, Number(w) || 1); band.scale.x = ww; cups.forEach(([c, s]) => { c.position.x = s * (R * ww - 0.01); }); };
    g.userData.setWidth(1);
  },
  /* a small top hat perched on the crown, with a band and a little flower */
  tophat(T, K, b){
    b.rotation.z = 0.12;
    const felt = K.std('#5b5478', { roughness: 0.55 });
    K.mesh(cyl(T, 0.25, 0.25, 0.03, 32), felt, b, [0, -0.02, 0], null, [1, 1, 0.92]);
    K.mesh(cyl(T, 0.175, 0.16, 0.3, 28), felt, b, [0, 0.14, 0]);
    K.mesh(cyl(T, 0.166, 0.165, 0.065, 28), K.std('#f9a8d4', { roughness: 0.6 }), b, [0, 0.03, 0], null, [1.02, 1, 1.02]);
    K.mesh(fluffy(T), K.std('#fff2a8', { roughness: 0.8, flatShading: true }), b, [0.11, 0.05, 0.13], null, 0.045);
  },
  /* a wizard hat: a wide brim and one smooth cone whose tip bends over to the right and back, with a gold band and gold stars */
  wizard(T, K, b){
    b.rotation.z = 0.05;
    const cloth = K.std('#8b93f0', { roughness: 0.75 }), gold = K.glow('#ffd35a', 0.35, { roughness: 0.3, metalness: 0.3 });
    K.mesh(cyl(T, 0.34, 0.33, 0.026, 40), cloth, b, [0, -0.05, 0], null, [1, 1, 0.94]);
    K.mesh(bentCone(T), cloth, b, [0, -0.045, 0]);
    K.mesh(torus(T, 0.197, 0.017, Math.PI * 2, 8, 40), gold, b, [0, -0.02, 0], [Math.PI / 2, 0, 0]);
    const st = K.inst(starGeo(T), gold, WIZ_STARS.length, b);
    WIZ_STARS.forEach(([u, a, s], i) => { const p = wizAt(u), r = wizR(u) * 0.96 + (u >= 1 ? 0.03 : 0); setInst(st, i, T, [p[0] + Math.sin(a) * r, p[1] - 0.045 + (u >= 1 ? 0.01 : 0), p[2] + Math.cos(a) * r], [-0.15, a, 0], s); });
    st.instanceMatrix.needsUpdate = true;
  },
  /* a glowing ring that floats over the head and bobs slowly; a darker gold rim behind it outlines it on a pale background */
  halo(T, K, b, g){
    const mat = K.glow('#ffd84a', 0.55, { roughness: 0.25, metalness: 0.2 }), rimM = K.std('#a87418', { roughness: 0.55, side: T.BackSide });
    const hr = new T.Group(); hr.position.y = 0.13; hr.rotation.x = Math.PI / 2 - 0.22; b.add(hr);
    K.mesh(torus(T, 0.2, 0.032, Math.PI * 2, 12, 40), mat, hr).userData.noShadow = true;
    K.mesh(torus(T, 0.2, 0.044, Math.PI * 2, 12, 40), rimM, hr).userData.noShadow = true;
    const sp = K.inst(starGeo(T), K.glow('#fff4c2', 0.8), 3, b); sp.userData.noShadow = true;
    const M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3();
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
      b.position.y = 0.025 * Math.sin(tt * 1.5);
      mat.emissiveIntensity = 0.55 + 1.1 * n;
      for(let i = 0; i < 3; i++){ const a = tt * 0.7 + i * 2.094, k = reduced ? 1 : 0.6 + 0.4 * Math.sin(tt * 2.3 + i * 1.7); V.set(Math.cos(a) * 0.235, 0.13 + Math.sin(a) * 0.235 * Math.sin(0.22) + 0.02, Math.sin(a) * 0.235 * Math.cos(0.22)); S.setScalar(0.024 * k); M.compose(V, Q, S); sp.setMatrixAt(i, M); }
      sp.instanceMatrix.needsUpdate = true;
    };
    g.userData.tick(0, 0, true);
  },
};
export function makeHeadGear(T, id){
  const K = kit(T), g = new T.Group(), b = new T.Group(); g.add(b);
  g.name = 'gear-' + id; g.userData.gear = id; g.userData.keepLook = true;
  const make = HEAD[id];
  if(make) make(T, K, b, g);
  return done(g, K);
}

/* ---------- desk items ---------- */
const DESK = {
  /* a small bonsai in a glazed tray: a twisting trunk and flat pads of foliage */
  plant(T, K, g){
    K.mesh(box(T, 0.34, 0.08, 0.22), K.std('#6fa8dc', { roughness: 0.35 }), g, [0, 0.04, 0]);
    K.mesh(box(T, 0.31, 0.012, 0.19), K.std('#6b4a35', { roughness: 1 }), g, [0, 0.083, 0]);
    K.mesh(unitSph(T), K.std('#8cc79a', { roughness: 1 }), g, [0.09, 0.088, 0.04], null, [0.05, 0.015, 0.04]);
    const bark = K.std('#8a5a3c', { roughness: 0.95 });
    K.mesh(tube(T, 'bonsai1', [[0.0, 0.08, 0], [-0.04, 0.16, 0.01], [0.03, 0.24, -0.01], [-0.02, 0.33, 0]], 0.024), bark, g);
    K.mesh(tube(T, 'bonsai2', [[0.0, 0.2, 0.0], [0.08, 0.25, 0.02], [0.13, 0.27, 0.02]], 0.014, 8), bark, g);
    const pads = K.inst(fluffy(T), K.std('#ffffff', { roughness: 1, flatShading: true }), 4, g);
    [[-0.03, 0.36, 0, 0.12, '#5fae6e'], [0.13, 0.29, 0.02, 0.08, '#6fbd7c'], [-0.11, 0.3, 0.01, 0.075, '#57a368'], [0.04, 0.42, -0.01, 0.07, '#7cc48a']]
      .forEach(([x, y, z, r, c], i) => setInst(pads, i, T, [x, y, z], [0, i, 0], [r * 1.25, r * 0.55, r], c));
    pads.instanceMatrix.needsUpdate = true; pads.instanceColor.needsUpdate = true;
  },
  /* an angle-poise desk lamp; the shade and the bulb glow warm, much more at night, and a soft pool of light lies under it at night */
  lamp(T, K, g){
    const body = K.std('#9bd6a8', { roughness: 0.45 });
    K.mesh(cyl(T, 0.085, 0.1, 0.035, 24), body, g, [0, 0.0175, 0]);
    K.mesh(cyl(T, 0.014, 0.014, 0.26, 10), body, g, [-0.03, 0.15, 0], [0, 0, 0.25]);
    K.mesh(unitSph(T), K.std('#fffaf0', { roughness: 0.5 }), g, [-0.062, 0.275, 0], null, 0.028);
    K.mesh(cyl(T, 0.014, 0.014, 0.22, 10), body, g, [0.03, 0.33, 0.0], [0, 0, -1.05]);
    const head = new T.Group(); head.position.set(0.13, 0.37, 0); head.rotation.z = -0.55; g.add(head);
    const shade = K.std('#ffc98a', { roughness: 0.5, emissive: '#ffb45e', emissiveIntensity: 0.12, side: T.DoubleSide });
    K.mesh(cyl(T, 0.035, 0.105, 0.12, 24, true), shade, head, [0, -0.06, 0]);
    const bulbM = K.glow('#fff1c8', 0.5), bulb = K.mesh(unitSph(T), bulbM, head, [0, -0.1, 0], null, [0.05, 0.03, 0.05]); bulb.userData.noShadow = true;
    const poolM = K.std('#000000', { emissive: '#ffcf7a', emissiveIntensity: 1, transparent: true, opacity: 0, depthWrite: false });
    const pool = K.mesh(geo(T, 'disc', () => new T.CircleGeometry(1, 28)), poolM, g, [0.19, 0.003, 0.02], [-Math.PI / 2, 0, 0], 0.16); pool.userData.noShadow = true;
    g.userData.tick = (t, night, reduced) => { const n = nightOf(night); shade.emissiveIntensity = 0.12 + 0.6 * n; bulbM.emissiveIntensity = 0.5 + 1.6 * n; poolM.opacity = 0.32 * n; };
    g.userData.tick(0, 0, true);
  },
  /* a little robot on a round yellow plinth: orange body, blue head, a dark face with glowing eyes, and an antenna that blinks */
  figurine(T, K, g){
    K.mesh(cyl(T, 0.13, 0.14, 0.03, 28), K.std('#ffd35a', { roughness: 0.4 }), g, [0, 0.015, 0]);
    const orange = K.std('#ff7a59', { roughness: 0.45 }), blue = K.std('#4fb6e0', { roughness: 0.4 });
    K.mesh(box(T, 0.2, 0.17, 0.14), orange, g, [0, 0.115, 0]);
    const arms = K.inst(geo(T, 'arm', () => new T.CapsuleGeometry(1, 1, 4, 10)), blue, 2, g);
    [-1, 1].forEach((s, i) => setInst(arms, i, T, [s * 0.125, 0.12, 0], [0, 0, s * 0.25], [0.026, 0.05, 0.026]));
    arms.instanceMatrix.needsUpdate = true;
    const head = new T.Group(); head.position.y = 0.2; g.add(head);
    K.mesh(box(T, 0.22, 0.16, 0.16), blue, head, [0, 0.08, 0]);
    K.mesh(box(T, 0.17, 0.095, 0.012), K.std('#26304a', { roughness: 0.3 }), head, [0, 0.08, 0.081]);
    const eyeM = K.glow('#7fe7ff', 0.5), eyes = K.inst(unitSph(T), eyeM, 2, head); eyes.userData.noShadow = true;
    [-1, 1].forEach((s, i) => setInst(eyes, i, T, [s * 0.042, 0.088, 0.088], null, [0.024, 0.024, 0.01]));
    eyes.instanceMatrix.needsUpdate = true;
    K.mesh(cyl(T, 0.008, 0.008, 0.07, 6), K.std('#f4f1ea', { roughness: 0.4 }), head, [0, 0.195, 0]);
    const ballM = K.glow('#ff6f91', 0.4), ball = K.mesh(unitSph(T), ballM, head, [0, 0.24, 0], null, 0.026); ball.userData.noShadow = true;
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
      eyeM.emissiveIntensity = 0.5 + 1.8 * n; ballM.emissiveIntensity = (0.4 + 1.4 * n) * (reduced ? 1 : (Math.sin(tt * 3) > 0.6 ? 1.6 : 0.6));
      head.rotation.y = 0.35 * Math.sin(tt * 0.5) * Math.max(0, Math.sin(tt * 0.23));
    };
    g.userData.tick(0, 0, true);
  },
  /* a snow globe on a wooden base: a tiny tree inside and flakes that swirl down, shrinking away at the bottom and growing in at the top */
  snowglobe(T, K, g){
    K.mesh(cyl(T, 0.115, 0.135, 0.07, 28), K.std('#c98b5b', { roughness: 0.7 }), g, [0, 0.035, 0]);
    K.mesh(cyl(T, 0.112, 0.112, 0.02, 28), K.std('#fffaf0', { roughness: 1 }), g, [0, 0.08, 0]);
    K.mesh(geo(T, 'cone', () => new T.ConeGeometry(1, 1, 10)), K.std('#3f9a5e', { roughness: 0.9, flatShading: true }), g, [0, 0.15, 0], null, [0.045, 0.12, 0.045]);
    const starM = K.glow('#ffd35a', 0.4); K.mesh(starGeo(T), starM, g, [0, 0.22, 0], null, 0.016);
    const glass = K.mesh(unitSph(T), K.glass('#e8f6ff', 0.2), g, [0, 0.185, 0], null, 0.135); glass.userData.noShadow = true;
    const N = 20, fl = K.inst(unitSph(T), K.std('#ffffff', { roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.15 }), N, g); fl.userData.noShadow = true;
    const ph = Array.from({ length: N }, (_, i) => [(i * 0.618) % 1, i * 2.39996, 0.03 + ((i * 7) % 9) / 9 * 0.07]);
    const M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3();
    g.userData.tick = (t, night, reduced) => {
      const tt = reduced ? 0 : t + phaseOf(g), n = nightOf(night); starM.emissiveIntensity = 0.4 + 1.2 * n;
      for(let i = 0; i < N; i++){
        const [u0, a0, r] = ph[i], u = (u0 + tt * 0.045) % 1, a = a0 + tt * 0.5, k = smooth(0, 0.12, u) * (1 - smooth(0.82, 1, u));
        V.set(Math.cos(a) * r, 0.29 - u * 0.19, Math.sin(a) * r); S.setScalar(0.0085 * k); M.compose(V, Q, S); fl.setMatrixAt(i, M);
      }
      fl.instanceMatrix.needsUpdate = true;
    };
    g.userData.tick(0, 0, true);
  },
  /* a gold cup on a stepped base with a plaque */
  trophy(T, K, g){
    const gold = K.std('#ffd257', { roughness: 0.3, metalness: 0.25, emissive: '#a8700e', emissiveIntensity: 0.18 });
    K.mesh(box(T, 0.18, 0.05, 0.16), K.std('#6b4a35', { roughness: 0.7 }), g, [0, 0.025, 0]);
    K.mesh(box(T, 0.12, 0.035, 0.11), gold, g, [0, 0.0675, 0]);
    K.mesh(cyl(T, 0.018, 0.035, 0.08, 16), gold, g, [0, 0.125, 0]);
    const prof = [[0.0, 0], [0.03, 0.0], [0.06, 0.02], [0.085, 0.06], [0.1, 0.12], [0.105, 0.15], [0.095, 0.15], [0.088, 0.12], [0.072, 0.06], [0.0, 0.035]].map(([r, y]) => new T.Vector2(r, y));
    K.mesh(geo(T, 'cup', () => new T.LatheGeometry(prof, 28)), gold, g, [0, 0.16, 0]);
    for(const s of [-1, 1]) K.mesh(torus(T, 0.045, 0.012, Math.PI * 1.2, 8, 16), gold, g, [s * 0.1, 0.24, 0], [0, 0, s > 0 ? -Math.PI * 0.6 : Math.PI * 0.4]);
    K.mesh(box(T, 0.07, 0.025, 0.006), K.std('#fffaf0', { roughness: 0.5 }), g, [0, 0.026, 0.081]);
  },
  /* a chunky lava lamp: warm blobs drift up and down in magenta liquid that glows at night */
  lavalamp(T, K, g){
    const metal = K.std('#7c5cff', { roughness: 0.35, metalness: 0.25 });
    K.mesh(cyl(T, 0.075, 0.11, 0.12, 28), metal, g, [0, 0.06, 0]);
    const liquid = K.std('#ff5aa8', { roughness: 0.15, transparent: true, opacity: 0.62, emissive: '#ff3d8f', emissiveIntensity: 0.15, depthWrite: false });
    const gl = K.mesh(geo(T, 'lavaglass', () => new T.LatheGeometry(LAVA.map(([r, y]) => new T.Vector2(r, y)), 28)), liquid, g, [0, 0.12, 0]); gl.userData.noShadow = true;
    K.mesh(cyl(T, 0.042, 0.056, 0.06, 24), metal, g, [0, 0.45, 0]);
    const blobM = K.glow('#ffa31a', 0.35), N = 4, bl = K.inst(unitSph(T), blobM, N, g); bl.userData.noShadow = true;
    const M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3(), RR = [0.052, 0.04, 0.034, 0.03];
    g.userData.tick = (t, night, reduced) => {
      const tt = reduced ? 0 : t + phaseOf(g), n = nightOf(night); liquid.emissiveIntensity = 0.15 + 1.2 * n; blobM.emissiveIntensity = 0.35 + 2.0 * n;
      for(let i = 0; i < N; i++){
        const u = 0.5 + 0.5 * Math.sin(tt * (0.22 + i * 0.05) + i * 1.9), y = 0.05 + u * 0.2, rr = RR[i] * (1 - 0.2 * Math.abs(u - 0.5)), room = Math.max(0, lavaR(y) - rr - 0.006);
        V.set(Math.sin(i * 2.1 + tt * 0.1) * room * 0.5, 0.12 + y, Math.cos(i * 2.1) * room * 0.4); S.set(rr, rr * (1.15 + (reduced ? 0 : 0.2 * Math.sin(tt + i))), rr); M.compose(V, Q, S); bl.setMatrixAt(i, M);
      }
      bl.instanceMatrix.needsUpdate = true;
    };
    g.userData.tick(0, 0, true);
  },
  /* a small fish tank: blue water, bright green weed and one big orange fish that swims from end to end and turns round smoothly */
  aquarium(T, K, g){
    const W = 0.44, H = 0.3, D = 0.26;
    K.mesh(box(T, W, 0.03, D), K.std('#3d4a63', { roughness: 0.5 }), g, [0, 0.015, 0]);
    K.mesh(box(T, W - 0.02, 0.035, D - 0.02), K.std('#f2d49b', { roughness: 1 }), g, [0, 0.0475, 0]);
    const weed = K.inst(geo(T, 'weed', () => new T.CapsuleGeometry(1, 2, 4, 8)), K.std('#ffffff', { roughness: 0.7 }), 3, g);
    [[-0.15, 0.04, 1], [-0.11, -0.06, 0.75], [0.16, 0.05, 0.85]].forEach(([x, z, k], i) => setInst(weed, i, T, [x, 0.065 + 0.065 * k, z], [0, 0, (i - 1) * 0.18], [0.022, 0.045 * k, 0.022], i === 1 ? '#7be08a' : '#3fbf5a'));
    weed.instanceMatrix.needsUpdate = true; weed.instanceColor.needsUpdate = true;
    const fish = new T.Group(); fish.position.set(0, 0.17, 0); g.add(fish);
    const orange = K.std('#ff7b1c', { roughness: 0.45, emissive: '#ff5a00', emissiveIntensity: 0.8 });
    K.mesh(unitSph(T), orange, fish, [0, 0, 0], null, [0.08, 0.055, 0.035]);
    K.mesh(geo(T, 'cone', () => new T.ConeGeometry(1, 1, 10)), orange, fish, [-0.1, 0, 0], [0, 0, -Math.PI / 2], [0.045, 0.06, 0.014]);
    K.mesh(unitSph(T), K.std('#26304a', { roughness: 0.3 }), fish, [0.045, 0.014, 0], null, [0.012, 0.012, 0.037]);
    const waterM = K.std('#1272d6', { roughness: 0.3, transparent: true, opacity: 0.66, emissive: '#1f8fff', emissiveIntensity: 0.12, depthWrite: false });
    const water = K.mesh(box(T, W - 0.02, H - 0.07, D - 0.02), waterM, g, [0, 0.03 + (H - 0.07) / 2, 0]); water.userData.noShadow = true;
    const glass = K.mesh(box(T, W, H, D), K.glass('#eaf7ff', 0.1), g, [0, H / 2, 0]); glass.userData.noShadow = true;
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night); waterM.emissiveIntensity = 0.12 + 0.8 * n;
      if(reduced){ fish.position.set(0.02, 0.17, 0.02); fish.rotation.set(0, 0.3, 0); return; }
      const tt = t + phaseOf(g), w = 0.55, v = Math.cos(tt * w);
      fish.position.set(Math.sin(tt * w) * 0.1, 0.17 + 0.012 * Math.sin(tt * 1.7), 0.03 * Math.sin(tt * 0.9));
      fish.rotation.y = (1 - smooth(-0.11, 0.11, v)) * Math.PI + 0.06 * Math.sin(tt * 6);   /* v runs through +-0.11 in about 0.4 s at each end, so the turn takes that long */
    };
    g.userData.tick(0, 0, true);
  },
  /* a neon heart and a wave on a dark acrylic board: dull pink tubes by day, bright enough at night for the bloom pass */
  neon(T, K, g){
    K.mesh(box(T, 0.3, 0.03, 0.1), K.std('#4a4466', { roughness: 0.5 }), g, [0, 0.015, 0]);
    K.mesh(box(T, 0.32, 0.26, 0.015), K.std('#2a2c44', { roughness: 0.25, transparent: true, opacity: 0.85 }), g, [0, 0.16, -0.01]);
    const hp = []; for(let i = 0; i <= 40; i++){ const a = i / 40 * Math.PI * 2, x = 16 * Math.sin(a) ** 3, y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a); hp.push([x * 0.0055, 0.175 + y * 0.0055, 0.012]); }
    const pink = K.std('#ff9cc6', { roughness: 0.35, emissive: '#ff4f9a', emissiveIntensity: 0.3 }), cyan = K.std('#a6f0ff', { roughness: 0.35, emissive: '#38d8ff', emissiveIntensity: 0.25 });
    const heart = K.mesh(geo(T, 'neonheart', () => new T.TubeGeometry(new T.CatmullRomCurve3(hp.map(p => new T.Vector3(...p)), true), 80, 0.012, 6, true)), pink, g); heart.userData.noShadow = true;
    const wp = []; for(let i = 0; i <= 12; i++){ const x = -0.1 + i / 12 * 0.2; wp.push([x, 0.065 + 0.012 * Math.sin(i / 12 * Math.PI * 3), 0.012]); }
    const wave = K.mesh(tube(T, 'neonwave', wp, 0.009, 30), cyan, g); wave.userData.noShadow = true;
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = t + phaseOf(g), f = reduced ? 1 : 0.94 + 0.06 * Math.sin(tt * 23) * Math.sin(tt * 3.1);
      pink.emissiveIntensity = (0.3 + 2.6 * n) * f; cyan.emissiveIntensity = (0.25 + 2.4 * n) * f;
    };
    g.userData.tick(0, 0, true);
  },
};
export function makeDeskItem(T, id){
  const K = kit(T), g = new T.Group(); g.name = 'gear-' + id; g.userData.gear = id;
  const make = DESK[id];
  if(make) make(T, K, g);
  return done(g, K);
}
