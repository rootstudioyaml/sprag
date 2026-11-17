/* Cosmetics for the team office: fifteen head pieces and seven pairs of wings for the cast animals, and ten desk items.
 * Like holiday.js and pets.js this file imports nothing: every maker takes the three instance T (the same three@0.160.0 build office-scene.js
 * imports), and GEAR_ITEMS and headGearFit are pure, so Node can test them. The server decides which items a person has unlocked; this file only
 * draws them. Geometries are shared per T (freed by disposeGearShared); each piece owns its materials and frees them with userData.dispose().
 * Animated pieces carry userData.tick(t, night, reduced): t is seconds, night is 0..1 (a boolean works too), and reduced holds every part still.
 *
 * Head pieces are in cast model units with the origin on the top of the skull, where castCrown() in office-scene.js sits (HEAD_ANCHOR). Add one
 * to a cast model before it is scaled and place it with placeHeadGear(g, headGearFit(id, species)). The skull is close to a ball of radius 0.36
 * whose centre is 0.37 below the anchor; the front is +z.
 * Wings (the back slot) are made for the standing and the seated cast model alike: place them with placeBackGear(g, backAnchorOf(T, model), backGearFit(id, species)).
 * The anchor is read off the loaded model once (the torso's back surface at the height of the lower back, x = 0, never the tail); a wing pair is symmetric about x = 0, each wing
 * hung from a pivot 0.06 beside the anchor and swept out and back, so from the front it shows beside the head. Species with wings of their own skip them.
 * Desk items stand on y = 0 (the desk top) and face +z; each fits in 0.5 x 0.5 and is at most about 0.7 tall, in desk units. */

/* the catalogue; the server's _cosmetic_items() carries the same ids and decides the unlock levels */
export const GEAR_SLOTS = ['head', 'back', 'desk'];
export const GEAR_ITEMS = [
  ...['cap', 'beanie', 'ribbon', 'flower', 'party', 'headphones', 'tophat', 'wizard', 'halo', 'antenna', 'tiara', 'orbit', 'starcrown', 'flame', 'aurora'].map(id => ({ id, slot: 'head' })),
  ...['angel', 'butterfly', 'bat', 'fairy', 'drake', 'phoenix', 'prism'].map(id => ({ id, slot: 'back' })),
  ...['plant', 'lamp', 'figurine', 'snowglobe', 'trophy', 'lavalamp', 'aquarium', 'neon', 'crystalball', 'galaxy'].map(id => ({ id, slot: 'desk' })),
];
export const HEAD_ANCHOR = [0, 1.04, -0.02];
const SKULL_Y = -0.37, SKULL_R = 0.36;

/* ---------- fit ---------- */
/* Hat-type pieces: item -> species -> [y, z, s, rx] (cap and beanie add c, the cover angle). y lifts the piece above the anchor, z moves it along the
 * face direction, s scales it, rx tilts it back (negative) or forward. The values come from a fit solver run on the seated and the standing model of each
 * species: it counts model vertices that would pass through the piece (ears, horns, antlers, crests) and rejects any fit where the piece floats over
 * the head, sinks too far, or overhangs the head at its rim; among the clean fits it keeps the largest, least shifted one. A species missing from a list
 * uses FIT0. See the fit notes for the method and the sheets it was checked on. Re-solved on the models without their own headwear (3.127.0-2) for the
 * species that lost some; the rest keep their checked fits. By hand: the pig's beanie and wizard hat (the solver tipped them back until they slid off),
 * the wolf's top hat, wizard hat and party hat (its standing head sits 0.05 lower than the seated one, so they split the difference), and the owl's top hat
 * (less tilt, so the front of the brim stays on the standing head).
 * One size policy (3.127.0-3): a piece that is shown is never drawn below 0.8 or above 1.25 of its standard scale, so a hat looks the same size on a
 * coworker's animal; where it cannot sit inside that range the species skips it (SKIPS). The wolf and the fox wear the wizard hat at 0.85, the cat and
 * the fox the top hat at 0.85. The lion's pieces sit on the mane, not on the skull under it. The dragon's beanie lets the horns through the knit; the
 * unicorn's sits behind the horn. On the dragon and the deer the ribbon and the flower sit on the head in front of the horn or antler base.
 * Seated on the crown (3.130.0-4): the earlier fits kept clear of ears, so the brims rested on the ear tips and every top hat, wizard hat, party hat and the
 * small caps and beanies between the ears hung over the crown with a gap that showed from the side and on the profile card. Now ears may pass through
 * a hat. The y of cap, beanie, party, tophat and wizard was solved on the seated and the standing model (the mean of the two) against the skull alone,
 * the model's vertices within 0.42 of (0, 0.67, -0.02), so ears, horns and tufts do not hold a hat up:
 *   - top hat, wizard hat, party hat: the crown's base ring (radius 0.175, 0.2, 0.166) meets the skull, 0.015 into the fur (median over the ring), but no
 *     lower than lets the head show through the brim (8th percentile of brim vertices at most 0.015 under the skull top, so an ear base may poke through).
 *     The brims bend down over the head (BRIM) and the two hats sit level (rx 0, the top hat's own tilt 0.04).
 *   - cap and beanie: one look on every species, over the whole head (cover 0.95, z 0, rx -0.1); the dome's crown (within 0.6 rad of the top) stands
 *     0.055 (cap) or 0.075 (beanie) over the skull at the median, as on the species that already wore them that way.
 * By hand: the frog's top hat and wizard hat sit behind its eyes at 0.85 (z -0.1), where the solver set them on the eyes. */
const FIT = {
  cap: {
    dragon: [0.068, -0.08, 1, -0.4, 0.55], unicorn: [0.114, -0.12, 1, -0.1, 0.95], lion: [0.222, -0.08, 1, -0.1, 0.95],
    tiger: [-0.022, 0, 1, -0.1, 0.95], eagle: [-0.02, 0, 1, -0.1, 0.95], wolf: [-0.004, 0, 1, -0.1, 0.95], cheetah: [-0.026, 0.04, 1, -0.1, 0.95],
    fox: [0.009, 0, 1, -0.1, 0.95], owl: [0.022, 0.04, 1, -0.1, 0.95], husky: [-0.024, 0, 1, -0.1, 0.95], panda: [-0.017, 0, 1, -0.1, 0.95],
    koala: [-0.035, 0, 1, -0.1, 0.95], penguin: [-0.012, 0, 1, -0.1, 0.95], raccoon: [0.003, 0, 1, -0.1, 0.95], cat: [-0.003, 0, 1, -0.1, 0.95],
    dog: [-0.02, 0, 1, 0, 0.95], bear: [-0.041, 0, 1, -0.1, 0.95], sheep: [0.075, 0, 1, -0.1, 0.95], squirrel: [-0.05, 0, 1, -0.1, 0.95],
    hedgehog: [0.04, 0, 1, -0.1, 0.95], rabbit: [-0.034, 0, 1, -0.1, 0.95], monkey: [0.008, -0.04, 1, -0.2, 0.95], pig: [-0.036, 0, 1, -0.1, 0.95],
    mouse: [-0.043, 0, 1, -0.1, 0.95], elephant: [-0.02, 0, 1, 0, 0.95], frog: [0.022, 0, 1, -0.3, 0.95], duck: [-0.006, -0.04, 1, -0.2, 0.95],
    hamster: [-0.04, 0, 1, -0.1, 0.95], chick: [-0.026, 0, 1, -0.1, 0.95]
  },
  beanie: {
    dragon: [-0.05, 0, 1, -0.2, 0.9], unicorn: [0.09, -0.12, 1, -0.35, 0.8], lion: [0.214, 0, 1, -0.2, 0.95], tiger: [-0.064, 0, 1, -0.1, 0.95],
    eagle: [-0.1, 0, 1, -0.1, 0.95], wolf: [-0.047, 0, 1, -0.1, 0.95], cheetah: [-0.038, -0.08, 1, -0.1, 0.95], fox: [-0.033, 0, 1, -0.1, 0.95],
    owl: [-0.032, 0, 1, -0.2, 0.95], husky: [-0.064, 0, 1, -0.1, 0.95], panda: [-0.06, 0, 1, -0.1, 0.95], koala: [-0.079, 0, 1, -0.1, 0.95],
    penguin: [-0.086, 0, 1, -0.1, 0.95], raccoon: [-0.039, 0, 1, -0.1, 0.95], cat: [-0.042, 0, 1, -0.1, 0.95], dog: [-0.052, 0, 1, -0.1, 0.95],
    deer: [0.128, 0, 1, -0.2, 0.4], bear: [-0.082, 0, 1, -0.1, 0.95], sheep: [0.008, 0, 1, -0.1, 0.95], squirrel: [-0.06, -0.04, 1, 0, 0.9],
    hedgehog: [-0.018, 0, 1, -0.1, 0.95], rabbit: [-0.074, 0, 1, -0.1, 0.95], monkey: [-0.046, 0, 1, -0.1, 0.95], pig: [-0.074, 0, 1, -0.1, 0.95],
    mouse: [-0.083, 0, 1, -0.1, 0.95], elephant: [-0.046, 0, 1, -0.1, 0.95], frog: [-0.026, 0, 1, -0.4, 0.95], duck: [-0.066, 0, 1, -0.1, 0.95],
    hamster: [-0.04, -0.08, 1, -0.3, 0.95], chick: [-0.1, 0, 1, -0.1, 0.95]
  },
  ribbon: {
    dragon: [-0.01, 0.1, 1, -0.1], unicorn: [0.008, 0, 1, -0.1], lion: [0.214, -0.04, 1, 0], tiger: [-0.026, 0.04, 1, -0.2],
    eagle: [0, -0.08, 1, 0.1], wolf: [-0.006, 0.08, 1, -0.1], cheetah: [-0.02, -0.08, 1, -0.2], fox: [0.008, 0, 1, -0.2], owl: [0.02, 0, 1, -0.1],
    husky: [-0.04, 0.08, 1, -0.1], panda: [-0.038, 0.08, 1, -0.2], koala: [-0.038, 0.04, 1, -0.1], penguin: [0, -0.12, 1, 0.1],
    raccoon: [-0.032, 0.12, 0.95, -0.1], cat: [-0.012, 0.08, 1, -0.1], dog: [-0.018, 0, 1, -0.1], deer: [-0.03, 0.14, 1, 0.1],
    bear: [-0.06, 0.08, 1, -0.2], sheep: [0.042, 0.08, 0.85, -0.1], squirrel: [-0.018, -0.04, 1, 0.1], hedgehog: [0.008, -0.04, 1, -0.3],
    rabbit: [-0.026, -0.08, 1, 0], monkey: [0.028, 0, 1, 0.1], pig: [-0.078, 0.12, 1, -0.2], mouse: [-0.092, 0.12, 1, -0.3],
    elephant: [-0.012, -0.04, 1, -0.1], frog: [0, -0.08, 1, -0.1], duck: [0.002, -0.04, 0.85, 0.1], hamster: [-0.04, 0.04, 1, -0.2],
    chick: [-0.026, -0.12, 1, -0.1]
  },
  flower: {
    dragon: [0, 0.1, 1, -0.1], unicorn: [0.028, 0, 1, -0.1], lion: [0.17, 0, 1, -0.1], tiger: [-0.018, 0, 1, -0.1], eagle: [-0.012, 0, 1, -0.1],
    wolf: [0.054, 0, 1, -0.1], cheetah: [-0.012, 0, 1, -0.1], fox: [0.028, 0, 1, -0.1], owl: [0.068, 0, 1, -0.1], husky: [-0.012, 0, 1, -0.1],
    panda: [-0.012, 0, 1, -0.1], koala: [-0.026, 0, 1, -0.1], penguin: [-0.006, 0, 1, -0.1], raccoon: [0, 0, 1, -0.1], cat: [0.008, 0, 1, -0.1],
    dog: [-0.02, 0, 1, -0.1], deer: [-0.01, 0.12, 1, 0.1], bear: [-0.038, 0, 1, -0.1], sheep: [0.06, 0, 1, -0.1], squirrel: [-0.04, 0, 1, -0.1],
    hedgehog: [0.02, 0, 1, -0.1], rabbit: [-0.032, 0, 1, -0.1], monkey: [0.008, 0, 1, -0.1], pig: [0.014, 0, 1, -0.1], mouse: [-0.04, 0, 1, -0.1],
    elephant: [-0.018, 0, 1, -0.1], frog: [0.06, 0, 1, -0.1], duck: [-0.012, 0, 1, -0.1], hamster: [-0.032, 0, 1, -0.1], chick: [-0.012, 0, 1, -0.1]
  },
  party: {
    dragon: [0.094, -0.04, 1, -0.1], unicorn: [0.005, 0, 1, -0.1], lion: [0.194, 0, 1, -0.1], tiger: [-0.049, 0, 1, -0.1], eagle: [-0.042, 0, 1, -0.1],
    wolf: [-0.023, 0.02, 0.9, -0.1], cheetah: [-0.043, 0, 1, -0.1], fox: [-0.017, 0, 1, -0.1], owl: [-0.045, 0, 1, -0.1], husky: [-0.047, 0.04, 1, -0.1],
    panda: [-0.042, 0.04, 1, -0.1], koala: [-0.06, 0, 1, -0.1], penguin: [-0.035, 0, 1, -0.1], raccoon: [-0.022, 0, 1, -0.1], cat: [-0.027, 0, 1, -0.1],
    dog: [-0.048, 0, 1, -0.1], deer: [0.194, -0.04, 1, -0.1], bear: [-0.063, 0.04, 1, -0.1], sheep: [0.021, 0, 1, -0.1], squirrel: [-0.076, 0, 1, -0.1],
    hedgehog: [-0.026, -0.04, 1, 0], rabbit: [-0.084, 0.12, 1, -0.1], monkey: [-0.059, -0.12, 1, -0.1], pig: [-0.061, 0, 1, -0.1], mouse: [-0.062, 0.04, 1, 0],
    elephant: [-0.052, -0.04, 1, -0.1], frog: [-0.075, 0, 1, -0.1], duck: [-0.093, -0.12, 1, -0.1], hamster: [-0.063, 0, 1, -0.1],
    chick: [-0.049, 0, 1, -0.1]
  },
  tophat: {
    dragon: [0.12, 0, 0.75, -0.2], unicorn: [0.14, -0.04, 1, -0.1], lion: [0.15, 0, 1, 0], tiger: [-0.013, 0, 1, 0], eagle: [-0.018, 0, 1, 0],
    wolf: [0.021, 0.02, 0.8, 0], cheetah: [-0.016, 0, 1, 0], fox: [0.021, 0.06, 0.85, 0], owl: [-0.004, 0, 1, 0], husky: [-0.023, 0.04, 1, 0],
    panda: [-0.003, 0, 1, 0], koala: [-0.023, 0, 1, 0], penguin: [-0.013, 0, 1, 0], raccoon: [0.001, 0, 1, 0], cat: [0.007, 0.06, 0.85, 0],
    dog: [-0.02, 0, 1, 0], deer: [0.2, -0.04, 0.85, -0.1], bear: [-0.013, 0, 1, 0], sheep: [0.034, 0, 1, 0], squirrel: [-0.037, 0, 1, 0],
    hedgehog: [-0.005, 0, 1, 0], rabbit: [-0.017, 0.12, 0.95, 0], monkey: [0.007, 0, 1, 0], pig: [-0.025, 0, 1, 0],
    mouse: [-0.026, 0.12, 1, 0], elephant: [-0.016, 0, 1, 0], frog: [0.01, -0.1, 0.85, 0], duck: [-0.003, -0.04, 1, 0],
    hamster: [-0.027, 0, 1, 0], chick: [-0.017, 0, 1, 0]
  },
  wizard: {
    dragon: [0.148, 0, 1, -0.1], unicorn: [0.154, 0, 1, -0.1], lion: [0.15, 0, 1, 0], tiger: [0.004, 0, 1, 0], eagle: [-0.012, 0, 1, 0],
    wolf: [0.042, 0.06, 0.85, 0], cheetah: [-0.001, 0, 1, 0], fox: [0.033, 0.04, 0.85, 0], owl: [0.001, 0, 1, 0], husky: [0.02, 0.12, 0.95, 0],
    panda: [0.012, 0, 1, 0], koala: [-0.008, 0, 1, 0], penguin: [-0.006, 0, 1, 0], raccoon: [0.013, 0, 1, 0], cat: [0.041, 0.12, 1, 0],
    dog: [-0.005, 0, 1, 0], deer: [0.24, 0, 1, -0.1], bear: [0.004, 0, 1, 0], sheep: [0.043, 0, 1, 0], squirrel: [-0.027, 0, 1, 0],
    hedgehog: [0.007, 0, 1, 0], rabbit: [0, 0.12, 0.65, 0], monkey: [0.01, 0, 1, 0], pig: [-0.007, 0, 1, 0], mouse: [0.02, -0.12, 1, 0],
    elephant: [-0.013, 0, 1, 0], frog: [0.035, -0.1, 0.85, 0], duck: [0.008, -0.04, 1, 0], hamster: [-0.01, 0, 1, 0], chick: [-0.01, 0, 1, 0]
  },
};
const FIT0 = { y: 0, z: 0, s: 1, rx: -0.1, c: 0.85 };
/* Headphones (band height, head width factor, nudge back) and the halo's lift, per species. The band's inner edge rests about 0.02 into the fur at the
 * crown, so its height follows the head top at the centre line (the dog's, 1.016, is 0); the halo hovers the same distance over every crown. Remeasured
 * on the models without their own hats (3.127.0-2): the husky's, squirrel's, bear's and pig's bands and the husky's, panda's, raccoon's, bear's,
 * sheep's, squirrel's and chick's halos came down with their crowns (the husky by 0.12, the sheep and squirrel by 0.09). Checked on the sheets.
 * The lion's band goes over the mane, wide enough that the cups sit outside it; the rabbit's halo floats over the tips of its ears, the unicorn's over
 * the tip of its horn (3.127.0-3). */
const PHONES = {
  lion: [0.15, 1.4, -0.04], deer: [0.05, 1, -0.08], husky: [0, 1, -0.03], sheep: [0.06, 1.12, 0], squirrel: [-0.03, 1, -0.03], hedgehog: [0.04, 1.08, 0],
  monkey: [0.02, 1.08, 0], raccoon: [0.02, 1.1, 0], frog: [0.02, 1, -0.02], unicorn: [0, 1, -0.1], dragon: [0, 1, -0.06], wolf: [0, 1.02, -0.04],
  fox: [0, 1, -0.04], cat: [0, 1.05, -0.03], tiger: [0, 1.04, 0], panda: [0, 1.1, 0], koala: [0, 1.05, 0], dog: [0, 1.05, 0], bear: [-0.01, 1.1, 0],
  pig: [-0.01, 1.02, 0], mouse: [0, 1.05, 0], elephant: [0, 1.12, 0], rabbit: [0, 1, 0.04],
};
const HALO_Y = { dragon: 0.06, unicorn: 0.09, lion: 0.15, wolf: 0.02, fox: 0.02, raccoon: 0.025, cat: 0.02, deer: 0.1, sheep: 0.07, squirrel: -0.03,
  hedgehog: 0.06, rabbit: 0.33, monkey: 0.05, frog: 0.03, duck: 0.01 };
/* Pieces a species cannot wear because of its own body, with the body part. The cast models wear nothing on the head of their own since 3.127.0-2,
 * so every other piece is fitted, with a per-species adjustment where needed. The shop reads this through headGearSkips() and tells the member the
 * item is not shown on that animal. */
const SKIPS = {
  unicorn: ['tophat', 'wizard'],   /* the horn rises from the forehead to brim height: a brim rests on its tip or the crown swallows it */
  dragon: ['cap', 'party', 'tophat', 'wizard'],   /* two horns beside the crown: a cap or a brim between them is tiny, a larger one rests on the horn tips */
  deer: ['cap', 'beanie', 'party', 'tophat', 'wizard'],   /* the antlers rise from the crown: every hat either swallows them or rests on their tips */
  rabbit: ['wizard'],   /* the long ears rise from the middle of the crown: the cone's wide brim hangs on them (the top hat fits in front of them) */
};
export function headGearSkips(species){ return (SKIPS[species] || []).slice(); }
const num = (v, d) => Number.isFinite(v) ? v : d;
/* { y, z, s, rx, c, w, skip }: lift above the anchor, nudge along z, scale, tilt about x, cover angle (cap, beanie), width factor (headphones),
 * and whether the piece is left off this species */
export function headGearFit(id, species){
  const skip = !!(SKIPS[species] && SKIPS[species].includes(id));
  if(id === 'headphones' || id === 'antenna' || id === 'tiara' || id === 'orbit'){ const p = PHONES[species] || [0, 1, 0]; return { y: p[0], z: p[2], s: 1, rx: -0.1, c: FIT0.c, w: p[1], skip }; }   /* the band pieces and the orbit follow the head width */
  if(id === 'halo' || id === 'starcrown' || id === 'flame' || id === 'aurora') return { y: num(HALO_Y[species], 0), z: 0, s: 1, rx: 0, c: FIT0.c, w: 1, skip };
  const f = (FIT[id] || {})[species];
  return f ? { y: num(f[0], 0), z: num(f[1], 0), s: num(f[2], 1), rx: num(f[3], FIT0.rx), c: num(f[4], FIT0.c), w: 1, skip } : { ...FIT0, w: 1, skip };
}
/* ---------- fit: wings ---------- */
/* Species with wings of their own wear none. BACK_FIT holds per-species corrections, item -> species -> [y, z, s]; empty until a fit run finds one needed. */
const BACK_SKIP = ['chick', 'dragon', 'duck', 'eagle', 'owl', 'penguin'];
const BACK_FIT = {};
/* the wing ids this species cannot wear (all of them for the species in BACK_SKIP), as a copy like headGearSkips */
export function backGearSkips(species){ return BACK_SKIP.includes(species) ? GEAR_ITEMS.filter(i => i.slot === 'back').map(i => i.id) : []; }
/* { y, z, s, skip }: lift above the anchor, nudge along z (the default tucks the roots 0.02 into the back), scale, and whether this species wears none */
export function backGearFit(id, species){
  const f = (BACK_FIT[id] || {})[species], skip = BACK_SKIP.includes(species);
  return { y: num(f && f[0], 0), z: num(f && f[1], -0.02), s: num(f && f[2], 1), skip };
}
/* Where wings hang on a loaded cast model, in the model's own space (front is +z): the rear surface of the torso at the lower back, or null without one.
 * The torso's rear surface is made of the vertices near the centre line (|x| < 0.1, 0.21 <= y <= 0.33) behind the middle (z < 0) whose normal points
 * back (n.z < -0.6). Sorted from the front, it is the first run of their z values with no step over 0.03. A tail also faces back there but starts a new
 * run further back, so it is left out. Until 3.130.0-3 the deepest vertex of the band was the anchor: on the fox, wolf, cat, dog, husky and squirrel
 * that was the tail, and the wings hung up to 0.25 behind the back (measured on all thirty models, the torso's rear is at -0.25 to -0.28, the pig's
 * curly tail starts below 0.21). A model without normals falls back to the deepest vertex of the wider band. */
export function backAnchorOf(T, root){
  root.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(root.matrixWorld).invert(), m4 = new T.Matrix4(), nm = new T.Matrix3(), v = new T.Vector3(), n = new T.Vector3();
  const zs = []; let minZ = Infinity;
  root.traverse(o => {
    const at = o.isMesh && o.geometry && o.geometry.attributes, pos = at && at.position; if(!pos) return;
    const nor = at.normal; m4.multiplyMatrices(inv, o.matrixWorld); if(nor) nm.getNormalMatrix(m4);
    for(let i = 0; i < pos.count; i++){
      v.fromBufferAttribute(pos, i).applyMatrix4(m4);
      if(!nor){ if(Math.abs(v.x) < 0.12 && v.y >= 0.10 && v.y <= 0.34 && v.z < minZ) minZ = v.z; continue; }
      if(Math.abs(v.x) >= 0.1 || v.y < 0.21 || v.y > 0.33 || v.z >= 0) continue;
      if(n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize().z < -0.6) zs.push(v.z);
    }
  });
  if(zs.length){ zs.sort((a, b) => b - a); let k = 0; while(k + 1 < zs.length && zs[k] - zs[k + 1] < 0.03) k++; minZ = zs[k]; }
  return Number.isFinite(minZ) ? { x: 0, y: 0.24, z: minZ } : null;
}
export function placeBackGear(g, anchor, fit){
  g.position.set(anchor.x, anchor.y + fit.y, anchor.z + fit.z); g.scale.setScalar(fit.s);
  return g;
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
/* A brim that bends down over the head (3.130.0-4): a ring from ri to ro, th thick, whose top follows a ball of radius R from y = 0 at ri. A flat brim
 * wider than the crown could not come down to the head: its edge hung over the round skull with a gap, and lowering it pushed the skull up through
 * it. Drawn from both sides because the closed profile is not wound one way. */
const BRIM = { tophat: [0.16, 0.25, 0.5, 0.03], wizard: [0.18, 0.33, 0.6, 0.026] };
const brimGeo = (T, k) => geo(T, 'brim' + k, () => {
  const [ri, ro, R, th] = BRIM[k], S = 10, drop = r => Math.sqrt(R * R - ri * ri) - Math.sqrt(R * R - r * r), pts = [];
  for(let i = 0; i <= S; i++){ const r = ri + (ro - ri) * i / S; pts.push(new T.Vector2(r, -drop(r))); }
  for(let i = S; i >= 0; i--){ const r = ri + (ro - ri) * i / S; pts.push(new T.Vector2(r, -drop(r) - th)); }
  pts.push(pts[0].clone());
  return new T.LatheGeometry(pts, 48);
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

/* low-poly shapes for swarms of tiny parts and for gems */
const ico0 = T => geo(T, 'ico0', () => new T.IcosahedronGeometry(1, 0));
const gemGeo = T => geo(T, 'gem', () => new T.OctahedronGeometry(1));
/* the antenna spring: a helix of four turns rising COIL_H, one tube */
const COIL_H = 0.26;
const coil = T => geo(T, 'coil', () => {
  const pts = []; for(let i = 0; i <= 28; i++){ const u = i / 28, a = u * Math.PI * 8, r = 0.016 * (1 - 0.25 * u); pts.push(new T.Vector3(Math.cos(a) * r, u * COIL_H, Math.sin(a) * r)); }
  return new T.TubeGeometry(new T.CatmullRomCurve3(pts), 140, 0.005, 5, false);
});

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
    b.rotation.z = 0.04;
    const felt = K.std('#5b5478', { roughness: 0.55 });
    K.mesh(brimGeo(T, 'tophat'), K.std('#5b5478', { roughness: 0.55, side: T.DoubleSide }), b, [0, -0.005, 0], null, [1, 1, 0.92]).userData.brim = true;
    K.mesh(cyl(T, 0.175, 0.16, 0.3, 28), felt, b, [0, 0.14, 0]);
    K.mesh(cyl(T, 0.166, 0.165, 0.065, 28), K.std('#f9a8d4', { roughness: 0.6 }), b, [0, 0.03, 0], null, [1.02, 1, 1.02]);
    K.mesh(fluffy(T), K.std('#fff2a8', { roughness: 0.8, flatShading: true }), b, [0.11, 0.05, 0.13], null, 0.045);
  },
  /* a wizard hat: a wide brim and one smooth cone whose tip bends over to the right and back, with a gold band and gold stars */
  wizard(T, K, b){
    b.rotation.z = 0.05;
    const cloth = K.std('#8b93f0', { roughness: 0.75 }), gold = K.glow('#ffd35a', 0.35, { roughness: 0.3, metalness: 0.3 });
    K.mesh(brimGeo(T, 'wizard'), K.std('#8b93f0', { roughness: 0.75, side: T.DoubleSide }), b, [0, -0.037, 0], null, [1, 1, 0.94]).userData.brim = true;
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
  /* an alice band over the crown with two springy antennae that sway, each ending in a glowing ball (pink and cyan); setWidth(w) follows the head like the headphones */
  antenna(T, K, b, g){
    const piv = new T.Group(); piv.position.y = SKULL_Y; piv.rotation.x = -0.12; b.add(piv);
    const R = SKULL_R + 0.01, band = K.mesh(torus(T, R, 0.022, Math.PI, 8, 40), K.std('#6d7cff', { roughness: 0.4, metalness: 0.2 }), piv); band.scale.y = 0.96;
    const spring = K.std('#c9d1e6', { roughness: 0.3, metalness: 0.6 });
    const ants = [-1, 1].map(s => {
      const root = new T.Group(), sway = new T.Group(); root.add(sway); piv.add(root);
      K.mesh(coil(T), spring, sway);
      const bm = K.glow(s < 0 ? '#ff7ac6' : '#6fe6ff', 0.7), ball = K.mesh(unitSph(T), bm, sway, [0, COIL_H, 0], null, 0.034); ball.userData.noShadow = true;
      return { root, sway, s, bm };
    });
    g.userData.setWidth = w => {
      const ww = Math.max(0.6, Number(w) || 1); band.scale.x = ww;
      ants.forEach(({ root, s }) => { const a = Math.PI / 2 - s * 0.42; root.position.set(R * ww * Math.cos(a), R * 0.96 * Math.sin(a), 0); root.rotation.z = -s * 0.3; });
    };
    g.userData.setWidth(1);
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
      ants.forEach(({ sway, s, bm }, i) => { sway.rotation.set(0.16 * Math.sin(tt * 2.4 + i * 1.7), 0, 0.1 * Math.sin(tt * 1.9 + i)); bm.emissiveIntensity = 0.7 + 2.2 * n; });
    };
    g.userData.tick(0, 0, true);
  },
  /* a silver tiara on the band's path over the crown: five spikes, the middle one tallest, a gem on each and four little stars that twinkle; setWidth(w) as the headphones */
  tiara(T, K, b, g){
    const piv = new T.Group(); piv.position.y = SKULL_Y; piv.rotation.x = -0.12; b.add(piv);
    const R = SKULL_R + 0.012, silver = K.std('#e4eaf5', { roughness: 0.25, metalness: 0.7 }), band = K.mesh(torus(T, R, 0.014, Math.PI, 8, 40), silver, piv); band.scale.y = 0.96;
    const SP = [[0, 0.13, 0.034, '#ff5fa2'], [-0.27, 0.09, 0.022, '#7fd8ff'], [0.27, 0.09, 0.022, '#7fd8ff'], [-0.52, 0.055, 0.017, '#ffe58a'], [0.52, 0.055, 0.017, '#ffe58a']];
    const gemM = SP.map(([, , , c]) => K.glow(c, 0.3, { roughness: 0.15, flatShading: true }));
    const parts = SP.map(([da, h, gs], i) => {
      const spike = K.mesh(geo(T, 'cone', () => new T.ConeGeometry(1, 1, 10)), silver, piv, null, null, [0.02, h, 0.012]);
      const gem = K.mesh(gemGeo(T), gemM[i], piv, null, null, gs); gem.userData.noShadow = true;
      return { spike, gem, a: Math.PI / 2 + da, h, gs };
    });
    const sp = K.inst(starGeo(T), K.glow('#ffffff', 0.9), 4, piv); sp.userData.noShadow = true; sp.frustumCulled = false;
    const M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3();
    const STAR = [[-0.4, 0.16], [0.4, 0.16], [-0.14, 0.2], [0.14, 0.2]];
    let ww = 1;
    g.userData.setWidth = w => {
      ww = Math.max(0.6, Number(w) || 1); band.scale.x = ww;
      parts.forEach(({ spike, gem, a, h, gs }) => {
        const ca = Math.cos(a), sa = Math.sin(a), x = R * ww * ca, y = R * 0.96 * sa;
        spike.position.set(x + ca * h / 2, y + sa * h / 2, 0); spike.rotation.z = a - Math.PI / 2;
        gem.position.set(x + ca * (h + gs * 0.6), y + sa * (h + gs * 0.6), 0);
      });
    };
    g.userData.setWidth(1);
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
      gemM.forEach(m => { m.emissiveIntensity = 0.3 + 1.4 * n; });
      STAR.forEach(([da, off], i) => {
        const a = Math.PI / 2 + da, k = reduced ? 1 : Math.max(0, Math.sin(tt * 2.7 + i * 1.9));
        V.set(R * ww * Math.cos(a) * (1 + off), R * 0.96 * Math.sin(a) * (1 + off), 0.03); S.setScalar(0.022 * k); M.compose(V, Q, S); sp.setMatrixAt(i, M);
      });
      sp.instanceMatrix.needsUpdate = true;
    };
    g.userData.tick(0, 0, true);
  },
  /* a thin tilted ring round the skull with three planets circling it (one ringed like Saturn); the ring and the planets scale with the head width */
  orbit(T, K, b, g){
    const ob = new T.Group(); ob.position.y = SKULL_Y; b.add(ob);
    const tilt = new T.Group(); tilt.rotation.set(0.5, 0, 0.22); ob.add(tilt);
    const ringM = K.glow('#9fb4ff', 0.3, { roughness: 0.3 }), R = 0.5;
    K.mesh(torus(T, R, 0.007, Math.PI * 2, 6, 72), ringM, tilt, null, [Math.PI / 2, 0, 0]).userData.noShadow = true;
    const PL = [[0.05, '#ff9f5a', 0.0, 0.7], [0.04, '#6fc3ff', 2.1, 0.5], [0.045, '#ffd27a', 4.2, 0.35]];
    const bodies = PL.map(([r, c, a0, sp], i) => {
      const piv = new T.Group(); tilt.add(piv);
      const m = K.std(c, { roughness: 0.45, emissive: c, emissiveIntensity: 0.1 });
      K.mesh(unitSph(T), m, piv, [R, 0, 0], null, r);
      if(i === 2) K.mesh(torus(T, 1.7, 0.1, Math.PI * 2, 6, 32), K.std('#f3e2b4', { roughness: 0.5, side: T.DoubleSide }), piv, [R, 0, 0], [Math.PI / 2 - 0.35, 0, 0], r);
      return { piv, a0, sp, m };
    });
    g.userData.setWidth = w => { ob.scale.setScalar(Math.max(0.6, Number(w) || 1)); };
    g.userData.setWidth(1);
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
      ringM.emissiveIntensity = 0.3 + 1.2 * n;
      bodies.forEach(({ piv, a0, sp, m }) => { piv.rotation.y = a0 + tt * sp; m.emissiveIntensity = 0.1 + 0.6 * n; });
    };
    g.userData.tick(0, 0, true);
  },
  /* a crown of five gold stars that circle slowly over the head with a large star in the middle; it bobs like the halo */
  starcrown(T, K, b, g){
    const gold = K.glow('#ffd23f', 0.5, { metalness: 0.3, roughness: 0.3 }), hov = new T.Group(), spin = new T.Group(); hov.position.y = 0.2; hov.add(spin); b.add(hov);
    const st = K.inst(starGeo(T), gold, 5, spin);
    for(let i = 0; i < 5; i++){ const a = i / 5 * Math.PI * 2; setInst(st, i, T, [Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22], [0, Math.PI / 2 - a, 0], 0.06); }
    st.instanceMatrix.needsUpdate = true;
    K.mesh(starGeo(T), gold, spin, [0, 0.1, 0], null, 0.095);
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
      hov.position.y = 0.2 + 0.025 * Math.sin(tt * 1.4); spin.rotation.y = tt * 0.5; gold.emissiveIntensity = 0.5 + 1.1 * n;
    };
    g.userData.tick(0, 0, true);
  },
  /* a crown of eight flames over the head: orange tongues with yellow cores whose height, width and lean flicker out of step, strong at night */
  flame(T, K, b, g){
    const N = 8, outer = K.glow('#ff7a1a', 0.8, { roughness: 0.5 }), inner = K.glow('#ffd43b', 1.0, { roughness: 0.5 }), ember = K.glow('#ff5a1a', 0.9), hov = new T.Group();
    hov.position.y = 0.12; b.add(hov);
    K.mesh(torus(T, 0.17, 0.02, Math.PI * 2, 8, 32), ember, hov, null, [Math.PI / 2, 0, 0]).userData.noShadow = true;
    const cone = geo(T, 'cone', () => new T.ConeGeometry(1, 1, 10)), o = K.inst(cone, outer, N, hov), c = K.inst(cone, inner, N, hov);
    [o, c].forEach(m => { m.userData.noShadow = true; m.frustumCulled = false; });
    const M = new T.Matrix4(), Q = new T.Quaternion(), E = new T.Euler(), V = new T.Vector3(), S = new T.Vector3();
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
      outer.emissiveIntensity = 0.8 + 2.2 * n; inner.emissiveIntensity = 1.0 + 2.6 * n; ember.emissiveIntensity = 0.9 + 1.8 * n;
      for(let i = 0; i < N; i++){
        const a = i / N * Math.PI * 2, ph = i * 2.399, h = 0.2 * (1 + 0.3 * Math.sin(tt * 5.1 + ph) + 0.15 * Math.sin(tt * 8.7 + ph * 1.9)), w = 0.05 * (1 - 0.2 * Math.sin(tt * 4 + ph)), lean = 0.12 * Math.sin(tt * 3.3 + ph);
        Q.setFromEuler(E.set(lean, 0, lean * 0.7));
        V.set(Math.cos(a) * 0.17, h / 2, Math.sin(a) * 0.17); S.set(w, h, w); M.compose(V, Q, S); o.setMatrixAt(i, M);
        V.set(Math.cos(a) * 0.17, h * 0.3, Math.sin(a) * 0.17); S.set(w * 0.55, h * 0.6, w * 0.55); M.compose(V, Q, S); c.setMatrixAt(i, M);
      }
      o.instanceMatrix.needsUpdate = true; c.instanceMatrix.needsUpdate = true;
    };
    g.userData.tick(0, 0, true);
  },
  /* a ring of beads floating over the head whose colours turn slowly through the rainbow (HSL), with six light motes circling it */
  aurora(T, K, b, g){
    const N = 40, mat = K.std('#ffffff', { roughness: 0.3, emissive: '#ffffff', emissiveIntensity: 0.2 }), hr = new T.Group(); hr.position.y = 0.13; hr.rotation.x = Math.PI / 2 - 0.22; b.add(hr);
    const beads = K.inst(unitSph(T), mat, N, hr), moteM = K.glow('#ffffff', 1.4), motes = K.inst(ico0(T), moteM, 6, hr);
    [beads, motes].forEach(m => { m.userData.noShadow = true; m.frustumCulled = false; });
    const M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3(), C = new T.Color();
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
      b.position.y = 0.025 * Math.sin(tt * 1.5); mat.emissiveIntensity = 0.2 + 0.5 * n; moteM.emissiveIntensity = 1.4 + 1.6 * n;
      for(let i = 0; i < N; i++){
        const a = i / N * Math.PI * 2;
        V.set(Math.cos(a) * 0.21, Math.sin(a) * 0.21, 0); S.setScalar(0.026 + 0.008 * Math.sin(tt * 2 + i * 0.7)); M.compose(V, Q, S); beads.setMatrixAt(i, M);
        beads.setColorAt(i, C.setHSL((i / N + tt * 0.07) % 1, 0.85, 0.66));
      }
      for(let i = 0; i < 6; i++){ const a = tt * 0.9 + i * 1.047; V.set(Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.03 * Math.sin(tt * 2 + i)); S.setScalar(0.014); M.compose(V, Q, S); motes.setMatrixAt(i, M); }
      beads.instanceMatrix.needsUpdate = true; if(beads.instanceColor) beads.instanceColor.needsUpdate = true; motes.instanceMatrix.needsUpdate = true;
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

/* ---------- wings (the back slot) ---------- */
/* Every wing is built as the right one in a group whose origin is the shoulder (x outward, y up, the membrane facing +z) and mirrored for the left by
 * scale.x = -1. The pivot sits WING_X from the middle and is swept back by WING_YAW; flapping turns it about y. */
const WING_X = 0.06, WING_YAW = 0.32, WING_LIFT = 0.08, FLAP_HZ = 7.54;   /* 1.2 Hz in radians per second */
function wingPair(T, g, k = 1){
  return [-1, 1].map(s => {
    const piv = new T.Group(), w = new T.Group();
    piv.position.x = s * WING_X; piv.scale.x = s; piv.rotation.y = s * WING_YAW; w.rotation.z = WING_LIFT; w.scale.setScalar(k); piv.add(w); g.add(piv);
    return { piv, w, s };
  });
}
/* wingPair(T, g, k): k sizes the wing so that a pair reaches about 0.5 to each side of the middle, whatever its drawn span */
/* the shared tick of a wing pair: the pivots flap a little inward (still under reduced motion), extra(tt, n, reduced) animates what else the pair has */
function wingTick(g, ws, extra){
  g.userData.tick = (t, night, reduced) => {
    const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
    ws.forEach(({ piv, s }) => { piv.rotation.y = s * (WING_YAW + 0.12 * Math.sin(tt * FLAP_HZ)); });
    if(extra) extra(tt, n, reduced);
  };
  g.userData.tick(0, 0, true);
}
/* a flat wing from a drawn outline, coloured per vertex by colorAt(x, y, C) */
function wingGeo(T, key, draw, colorAt, seg = 12){
  return geo(T, 'wing' + key, () => {
    const sh = new T.Shape(); draw(sh);
    const g = new T.ShapeGeometry(sh, seg), p = g.attributes.position, col = new Float32Array(p.count * 3), C = new T.Color();
    for(let i = 0; i < p.count; i++){ colorAt(p.getX(i), p.getY(i), C); col.set([C.r, C.g, C.b], i * 3); }
    g.setAttribute('color', new T.BufferAttribute(col, 3)); return g;
  });
}
const clamp01 = x => Math.max(0, Math.min(1, x));
/* three colours along k = 0..1 */
const ramp = (C, k, a, b, c) => { k = clamp01(k); return k < 0.5 ? C.set(a).lerp(new C.constructor(b), k * 2) : C.set(b).lerp(new C.constructor(c), k * 2 - 1); };
/* feathers hung from the wing arm, as tiers of instanced ellipsoids: tiers of { n, L: [from the root, to the tip], w, d, z, mat, geo, color(u, i) }.
 * Returns { pose(tt, amp), ims }; amp > 0 makes the feather ends waver out of step (the phoenix). */
const ARM = u => [0.05 + 0.26 * u, 0.04 + 0.5 * Math.pow(u, 0.85)];
function featherFan(T, K, parent, tiers){
  const ims = tiers.map(t => { const im = K.inst(t.geo || unitSph(T), t.mat, t.n, parent); im.frustumCulled = false; return im; });
  const pose = (tt, amp) => {
    tiers.forEach((t, k) => {
      for(let i = 0; i < t.n; i++){
        const u = (i + 0.5) / t.n, [bx, by] = ARM(u), L = t.L[0] + (t.L[1] - t.L[0]) * u;
        const ph = (125 - 70 * u) * Math.PI / 180 + (amp ? amp * 0.09 * (0.4 + u) * Math.sin(tt * 3.2 + i * 0.9 + k * 1.7) : 0);
        setInst(ims[k], i, T, [bx + Math.sin(ph) * L / 2, by + Math.cos(ph) * L / 2, t.z], [0, 0, -ph], [t.w, L / 2, t.d || 0.012]);
      }
      ims[k].instanceMatrix.needsUpdate = true;
    });
  };
  pose(0, 0);
  tiers.forEach((t, k) => { if(t.color){ for(let i = 0; i < t.n; i++) ims[k].setColorAt(i, new T.Color(t.color((i + 0.5) / t.n, i))); ims[k].instanceColor.needsUpdate = true; } });
  return { pose, ims };
}
/* a bat or dragon wing: an arm to the wrist, finger bones to the tips and a membrane scalloped between the tips.
 * spec: { key, arm: [[x, y, z]...] shoulder to wrist, tips: [[x, y]...], color(x, y, C), bone, r (bone radius), claw (colour or null) } */
function leatherWing(T, K, w, spec){
  const wr = spec.arm[spec.arm.length - 1], top = [0.02, 0.02];
  const mem = wingGeo(T, spec.key, sh => {
    sh.moveTo(top[0], top[1]); sh.lineTo(wr[0], wr[1]); sh.lineTo(spec.tips[0][0], spec.tips[0][1]);
    for(let i = 1; i < spec.tips.length; i++){ const a = spec.tips[i - 1], b = spec.tips[i], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; sh.quadraticCurveTo(mx + (wr[0] - mx) * 0.35, my + (wr[1] - my) * 0.35, b[0], b[1]); }
    const e = spec.tips[spec.tips.length - 1]; sh.quadraticCurveTo((e[0] + 0.05) / 2, (e[1] - 0.04) / 2 - 0.02, 0.05, -0.03); sh.lineTo(top[0], top[1]);
  }, spec.color, 8);
  K.mesh(mem, K.std('#ffffff', { vertexColors: true, side: T.DoubleSide, roughness: 0.7 }), w, [0, 0, 0]);
  const bone = K.std(spec.bone, { roughness: 0.5 });
  K.mesh(tube(T, spec.key + 'arm', spec.arm, spec.r * 1.3, 10), bone, w, [0, 0, 0.006]);
  spec.tips.forEach((tp, i) => {
    K.mesh(tube(T, spec.key + 'f' + i, [[wr[0], wr[1], 0.006], [(wr[0] + tp[0]) / 2, (wr[1] + tp[1]) / 2, 0.006], [tp[0], tp[1], 0.006]], spec.r, 4), bone, w);
    if(spec.claw){ const dx = tp[0] - wr[0], dy = tp[1] - wr[1]; K.mesh(geo(T, 'cone', () => new T.ConeGeometry(1, 1, 10)), K.std(spec.claw, { roughness: 0.4 }), w, [tp[0], tp[1], 0.006], [0, 0, -Math.atan2(dx, dy)], [spec.r * 1.4, 0.04, spec.r * 1.4]); }
  });
  K.mesh(geo(T, 'cone', () => new T.ConeGeometry(1, 1, 10)), K.std(spec.claw || spec.bone, { roughness: 0.4 }), w, [wr[0], wr[1] + 0.02, 0.006], [0, 0, 0.2], [spec.r * 1.6, 0.05, spec.r * 1.6]);
}
const BACK = {
  /* three tiers of white feathers fanned from a curved arm, the longest ones tipped with pale gold */
  angel(T, K, g){
    const white = K.std('#ffffff', { roughness: 0.85 }), cream = K.std('#fffaf0', { roughness: 0.85 }), ws = wingPair(T, g, 0.87);
    ws.forEach(({ w }) => featherFan(T, K, w, [
      { n: 6, L: [0.2, 0.12], w: 0.032, z: 0.018, mat: white, color: () => '#ffffff' },
      { n: 7, L: [0.34, 0.2], w: 0.036, z: 0.009, mat: cream, color: u => u > 0.7 ? '#fff4d2' : '#ffffff' },
      { n: 8, L: [0.46, 0.28], w: 0.04, z: 0, mat: white, color: u => u > 0.8 ? '#ffe9a8' : u > 0.45 ? '#fff6dc' : '#ffffff' },
    ]));
    wingTick(g, ws);
  },
  /* two pastel wings a side, pink and lilac fading to sky blue at the edge, with glowing spots */
  butterfly(T, K, g){
    const up = wingGeo(T, 'bf-up', sh => { sh.moveTo(0.02, 0); sh.bezierCurveTo(0.05, 0.3, 0.2, 0.62, 0.38, 0.6); sh.bezierCurveTo(0.52, 0.58, 0.52, 0.36, 0.42, 0.22); sh.bezierCurveTo(0.3, 0.08, 0.15, 0.02, 0.02, 0); },
      (x, y, C) => ramp(C, Math.hypot(x, y) / 0.65, '#ffc2e8', '#c3b5ff', '#9fe3ff'));
    const lo = wingGeo(T, 'bf-lo', sh => { sh.moveTo(0.02, 0); sh.bezierCurveTo(0.2, 0.05, 0.4, 0.1, 0.38, -0.12); sh.bezierCurveTo(0.34, -0.3, 0.16, -0.38, 0.08, -0.26); sh.bezierCurveTo(0.03, -0.16, 0.02, -0.06, 0.02, 0); },
      (x, y, C) => ramp(C, Math.hypot(x, y) / 0.45, '#a6e8ff', '#d2b9ff', '#ffb8e0'));
    const wm = K.std('#ffffff', { vertexColors: true, side: T.DoubleSide, roughness: 0.45, transparent: true, opacity: 0.82, depthWrite: false }), dotM = K.glow('#fff4ff', 0.6);
    const ws = wingPair(T, g);
    ws.forEach(({ w }) => {
      K.mesh(up, wm, w, [0, 0, 0.004]).userData.noShadow = true; K.mesh(lo, wm, w, [0, 0, 0]).userData.noShadow = true;
      [[0.34, 0.46, 0.028], [0.24, 0.3, 0.02], [0.42, 0.3, 0.016], [0.26, -0.14, 0.022], [0.16, -0.22, 0.015]].forEach(([x, y, r]) => { K.mesh(unitSph(T), dotM, w, [x, y, 0.012], null, [r, r, 0.004]).userData.noShadow = true; });
    });
    wingTick(g, ws, (tt, n) => { dotM.emissiveIntensity = 0.6 + 2.0 * n; });
  },
  /* a bat wing: four finger bones and a scalloped membrane, deep purple at the arm and magenta at the edge */
  bat(T, K, g){
    const ws = wingPair(T, g);
    ws.forEach(({ w }) => leatherWing(T, K, w, { key: 'bat', arm: [[0.02, 0.02, 0], [0.1, 0.3, 0.01], [0.2, 0.5, 0]], tips: [[0.46, 0.62], [0.5, 0.34], [0.42, 0.08], [0.26, -0.08]],
      color: (x, y, C) => ramp(C, Math.hypot(x, y - 0.1) / 0.55, '#2a1450', '#7b2a86', '#c23a96'), bone: '#1c0d33', r: 0.012, claw: '#d9c8ef' }));
    wingTick(g, ws);
  },
  /* four dragonfly wings, clear and rainbow tinted, with glittering motes drifting round them */
  fairy(T, K, g){
    const rb = (x, y, C) => C.setHSL((x * 1.2 + y * 0.6 + 0.55 + 10) % 1, 0.75, 0.78);
    const up = wingGeo(T, 'fy-up', sh => { sh.moveTo(0.02, 0); sh.bezierCurveTo(0, 0.3, 0.18, 0.55, 0.42, 0.52); sh.bezierCurveTo(0.5, 0.4, 0.38, 0.22, 0.2, 0.1); sh.bezierCurveTo(0.12, 0.04, 0.06, 0, 0.02, 0); }, rb);
    const lo = wingGeo(T, 'fy-lo', sh => { sh.moveTo(0.02, -0.01); sh.bezierCurveTo(0.2, 0.04, 0.4, -0.04, 0.46, -0.16); sh.bezierCurveTo(0.36, -0.3, 0.16, -0.24, 0.04, -0.06); }, rb);
    const wm = K.std('#ffffff', { vertexColors: true, side: T.DoubleSide, roughness: 0.2, transparent: true, opacity: 0.5, depthWrite: false });
    const ws = wingPair(T, g);
    ws.forEach(({ w }) => { K.mesh(up, wm, w, [0, 0, 0.003]).userData.noShadow = true; K.mesh(lo, wm, w, [0, 0, 0]).userData.noShadow = true; });
    const N = 16, moteM = K.glow('#ffffff', 1.2), motes = K.inst(ico0(T), moteM, N, g); motes.userData.noShadow = true; motes.frustumCulled = false;
    const M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3();
    wingTick(g, ws, (tt, n, reduced) => {
      moteM.emissiveIntensity = 1.2 + 1.6 * n;
      for(let i = 0; i < N; i++){
        const s = i % 2 ? 1 : -1, u = (i * 0.37 + tt * 0.12) % 1;
        V.set(s * (0.15 + 0.3 * ((i * 0.618) % 1) + 0.05 * Math.sin(tt * 1.3 + i)), 0.05 + 0.5 * u, -0.06 - 0.04 * Math.sin(tt * 0.9 + i)); S.setScalar(0.012 * (0.6 + 0.4 * Math.sin(tt * 3 + i)) * Math.sin(Math.PI * u) + 0.002); M.compose(V, Q, S); motes.setMatrixAt(i, M);
      }
      motes.instanceMatrix.needsUpdate = true;
    });
  },
  /* a dragon wing: a larger leather wing with banded scales, emerald at the arm and teal at the edge, and a claw at every finger */
  drake(T, K, g){
    const ws = wingPair(T, g, 0.9);
    ws.forEach(({ w }) => leatherWing(T, K, w, { key: 'drake', arm: [[0.02, 0.02, 0], [0.08, 0.32, 0.01], [0.18, 0.56, 0]], tips: [[0.42, 0.78], [0.54, 0.5], [0.5, 0.2], [0.34, 0.0]],
      color: (x, y, C) => { const d = Math.hypot(x, y - 0.1); ramp(C, d / 0.7, '#0b6b5b', '#14a085', '#34d399'); return C.multiplyScalar(0.86 + 0.14 * (Math.floor(d * 16) % 2)); }, bone: '#12805f', r: 0.014, claw: '#f2efd0' }));
    wingTick(g, ws);
  },
  /* flame feathers in gold, orange and crimson that glow and waver at the tips, strongest at night */
  phoenix(T, K, g){
    const gold = K.glow('#ffc82e', 0.6, { roughness: 0.5 }), orange = K.glow('#ff7a1a', 0.6, { roughness: 0.5 }), red = K.glow('#e0182d', 0.6, { roughness: 0.5 }), ws = wingPair(T, g, 0.83);
    const fans = ws.map(({ w }) => featherFan(T, K, w, [
      { n: 8, L: [0.5, 0.3], w: 0.042, z: -0.01, mat: red },
      { n: 7, L: [0.36, 0.22], w: 0.038, z: 0.004, mat: orange },
      { n: 6, L: [0.22, 0.13], w: 0.032, z: 0.016, mat: gold },
    ]));
    fans.forEach(f => f.ims.forEach(m => { m.userData.noShadow = true; }));
    wingTick(g, ws, (tt, n, reduced) => {
      red.emissiveIntensity = 0.6 + 2.0 * n; orange.emissiveIntensity = 0.7 + 2.4 * n; gold.emissiveIntensity = 0.8 + 2.6 * n;
      fans.forEach(f => f.pose(tt, reduced ? 0 : 1));
    });
  },
  /* angular crystal plates in two tiers whose colours turn through the rainbow, with star glints that blink */
  prism(T, K, g){
    const oct = gemGeo(T), plate = K.std('#ffffff', { roughness: 0.25, metalness: 0.45, flatShading: true, emissive: '#8a8cff', emissiveIntensity: 0.15 }), ws = wingPair(T, g, 0.8);
    const fans = ws.map(({ w }) => featherFan(T, K, w, [
      { n: 6, L: [0.52, 0.32], w: 0.055, d: 0.035, z: -0.01, mat: plate, geo: oct },
      { n: 5, L: [0.34, 0.2], w: 0.05, d: 0.03, z: 0.012, mat: plate, geo: oct },
    ]));
    const glint = K.glow('#ffffff', 0.9), gl = ws.map(({ w }) => { const im = K.inst(starGeo(T), glint, 4, w); im.userData.noShadow = true; im.frustumCulled = false; return im; });
    const C = new T.Color(), M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3(), TIP = [[0.45, 0.0], [0.4, 0.28], [0.32, 0.5], [0.2, 0.32]];
    wingTick(g, ws, (tt, n, reduced) => {
      plate.emissiveIntensity = 0.15 + 0.7 * n;
      fans.forEach(f => f.ims.forEach((im, k) => { for(let i = 0; i < im.count; i++) im.setColorAt(i, C.setHSL(((i * 0.11 + k * 0.3 + tt * 0.04) % 1 + 1) % 1, 0.7, 0.72)); im.instanceColor.needsUpdate = true; }));
      gl.forEach((im, wi) => { TIP.forEach(([x, y], i) => { V.set(x, y, 0.03); S.setScalar(0.03 * (reduced ? 1 : Math.max(0, Math.sin(tt * 2.6 + i * 1.7 + wi * 0.9)))); M.compose(V, Q, S); im.setMatrixAt(i, M); }); im.instanceMatrix.needsUpdate = true; });
    });
  },
};
/* a wing pair for the back of a cast model; place it with placeBackGear (the standing and the seated model use the same anchor) */
export function makeBackGear(T, id){
  const K = kit(T), g = new T.Group();
  g.name = 'gear-' + id; g.userData.gear = id; g.userData.keepLook = true;
  const make = BACK[id];
  if(make) make(T, K, g);
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
  /* a crystal ball on a brass stand: purple and teal mist swirls inside the glass and glows at night */
  crystalball(T, K, g){
    const brass = K.std('#c9a24a', { roughness: 0.3, metalness: 0.6 });
    K.mesh(cyl(T, 0.1, 0.125, 0.04, 28), brass, g, [0, 0.02, 0]);
    K.mesh(torus(T, 0.085, 0.016, Math.PI * 2, 8, 28), brass, g, [0, 0.055, 0], [Math.PI / 2, 0, 0]);
    const purple = K.glow('#a06bff', 0.5, { transparent: true, opacity: 0.8 }), teal = K.glow('#35e0c8', 0.5, { transparent: true, opacity: 0.8 }), N = 6;
    const pm = K.inst(fluffy(T), purple, N, g), tm = K.inst(fluffy(T), teal, N, g);
    [pm, tm].forEach(m => { m.userData.noShadow = true; m.frustumCulled = false; });
    const glass = K.mesh(unitSph(T), K.glass('#e9e4ff', 0.18), g, [0, 0.2, 0], null, 0.15); glass.userData.noShadow = true;
    const M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3();
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
      purple.emissiveIntensity = 0.5 + 1.8 * n; teal.emissiveIntensity = 0.5 + 1.8 * n;
      [pm, tm].forEach((im, k) => {
        for(let i = 0; i < N; i++){
          const a = tt * (0.7 + i * 0.11) * (k ? -1 : 1) + i * 1.05 + k * 0.5, r = 0.035 + 0.045 * ((i * 0.37 + k * 0.2) % 1), y = 0.2 + 0.07 * Math.sin(tt * 0.8 + i * 1.3 + k * 2), sz = 0.04 + 0.014 * Math.sin(tt * 1.6 + i);
          V.set(Math.cos(a) * r, y, Math.sin(a) * r); S.setScalar(sz); M.compose(V, Q, S); im.setMatrixAt(i, M);
        }
        im.instanceMatrix.needsUpdate = true;
      });
    };
    g.userData.tick(0, 0, true);
  },
  /* a spiral galaxy of about 150 glowing points turning slowly under a glass dome: gold core, blue and violet arms, much brighter at night */
  galaxy(T, K, g){
    K.mesh(cyl(T, 0.2, 0.22, 0.05, 32), K.std('#2a2a46', { roughness: 0.4, metalness: 0.3 }), g, [0, 0.025, 0]);
    const dome = K.mesh(geo(T, 'hemi', () => new T.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2)), K.glass('#cfd8ff', 0.16), g, [0, 0.05, 0], null, 0.19); dome.userData.noShadow = true;
    const spin = new T.Group(); spin.position.y = 0.13; spin.rotation.x = 0.22; g.add(spin);
    const core = K.glow('#ffe9a8', 1.0), mid = K.glow('#8fa8ff', 1.0), edge = K.glow('#d79cff', 1.0), N = [30, 60, 60];
    const ims = [core, mid, edge].map((m, k) => { const im = K.inst(ico0(T), m, N[k], spin); im.userData.noShadow = true; im.frustumCulled = false; return im; });
    const R0 = [0.0, 0.05, 0.11], R1 = [0.05, 0.11, 0.17];
    ims.forEach((im, k) => { for(let i = 0; i < N[k]; i++){
      const u = (i + 0.5) / N[k], r = R0[k] + (R1[k] - R0[k]) * u, a = r * 26 + (i % 2) * Math.PI + Math.sin(i * 12.9898) * 0.25, yy = Math.sin(i * 78.233) * 0.012 * (1 - r / 0.17);
      setInst(im, i, T, [Math.cos(a) * r, yy, Math.sin(a) * r], null, 0.006 + 0.005 * ((i * 0.61) % 1) + (k === 0 ? 0.002 : 0));
    } im.instanceMatrix.needsUpdate = true; });
    K.mesh(unitSph(T), K.glow('#fff6d8', 1.4), spin, null, null, 0.02).userData.noShadow = true;
    g.userData.tick = (t, night, reduced) => {
      const n = nightOf(night), tt = reduced ? 0 : t + phaseOf(g);
      spin.rotation.y = tt * 0.25; core.emissiveIntensity = 1.0 + 2.4 * n; mid.emissiveIntensity = 1.0 + 2.4 * n; edge.emissiveIntensity = 1.0 + 2.4 * n;
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
