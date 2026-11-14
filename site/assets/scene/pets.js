/* Pets for the team office: a small chibi dog or cat that lives around its owner's desk, with bowls, toys and a photo frame.
 * The pure part (normalizePetLook, petLookFromPixels, petPlan, pickPets) imports nothing, so Node can test it and the server can
 * share the validation rules. Every maker takes the three instance T (the same three@0.160.0 build office-scene.js imports), like holiday.js.
 * Each returned Group carries userData.dispose(). Pet bodies share one set of unit geometries per T (freed by disposePetShared); a pet
 * owns only its materials. Coat patterns are object-space shader patterns injected with onBeforeCompile, so there are no UV textures.
 * Pets face +z (Object3D.lookAt works directly) and stand on y = 0. */

/* ---------- look: the data contract shared with the server ---------- */
export const PET_KINDS = ['dog', 'cat'];
export const PET_PATTERNS = ['solid', 'patch', 'tabby', 'tuxedo', 'point'];
export const PET_EARS = ['up', 'flop', 'fold'];
export const PET_TAILS = ['long', 'short', 'curl', 'fluff'];
export const PET_SIZES = ['s', 'm', 'l'];
export const PET_DEFAULTS = { kind: 'dog', pattern: 'solid', ear: 'up', tail: 'long', size: 'm', fluff: 0.5 };
export const PET_NAME_MAX = 20, PET_COAT_MAX = 3, PET_MAX = 16;

const HEX6 = /^#[0-9a-f]{6}$/;
export function normHex(c){ if(typeof c !== 'string') return null; const h = c.trim().toLowerCase(); return HEX6.test(h) ? h : null; }
const pick = (v, list, def) => list.includes(v) ? v : def;

/* a valid look or null: unknown enum values fall back to the defaults, bad colours are dropped, an empty coat gives null */
export function normalizePetLook(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const coat = (Array.isArray(raw.coat) ? raw.coat : [raw.coat]).map(normHex).filter(Boolean).slice(0, PET_COAT_MAX);
  if(!coat.length) return null;
  const D = PET_DEFAULTS, f = Number(raw.fluff);
  const look = { kind: pick(raw.kind, PET_KINDS, D.kind), coat, pattern: pick(raw.pattern, PET_PATTERNS, D.pattern), ear: pick(raw.ear, PET_EARS, D.ear),
    tail: pick(raw.tail, PET_TAILS, D.tail), size: pick(raw.size, PET_SIZES, D.size), fluff: Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : D.fluff };
  if(typeof raw.name === 'string'){ const n = Array.from(raw.name.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, PET_NAME_MAX).join('').trim(); if(n) look.name = n; }
  return look;
}

/* ---------- colour: sRGB <-> OKLab ---------- */
const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const gam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
export function rgbToOklab(r8, g8, b8){
  const r = lin(r8 / 255), g = lin(g8 / 255), b = lin(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function oklabToLinear([L, a, b]){
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
/* OKLab to '#rrggbb', pulling chroma in until the colour fits sRGB (keeps lightness and hue) */
export function oklabToHex(lab){
  let [L, a, b] = lab, rgb;
  for(let k = 0; k < 24; k++){ rgb = oklabToLinear([L, a, b]); if(rgb.every(v => v >= -0.0005 && v <= 1.0005)) break; a *= 0.88; b *= 0.88; }
  return '#' + rgb.map(v => Math.round(255 * gam(Math.min(1, Math.max(0, v)))).toString(16).padStart(2, '0')).join('');
}
export function hexToOklab(h){ const n = parseInt(normHex(h).slice(1), 16); return rgbToOklab(n >> 16, (n >> 8) & 255, n & 255); }
export const mixHex = (x, y, t) => { const A = hexToOklab(x), B = hexToOklab(y); return oklabToHex(A.map((v, i) => v + (B[i] - v) * t)); };
const shadeHex = (h, dL) => { const c = hexToOklab(h); c[0] = Math.min(0.97, Math.max(0.2, c[0] + dL)); return oklabToHex(c); };
const lum = h => hexToOklab(h)[0];
const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/* a coat colour with its chroma clamped where it is very dark (OKLab L below about 0.45), so black fur reads as neutral charcoal under the warm room light */
export function neutralDark(h){ const c = hexToOklab(h), C = Math.hypot(c[1], c[2]), cap = 0.004 + sstep(0.4, 0.55, c[0]); if(C <= cap) return h; return oklabToHex([c[0], c[1] * cap / C, c[2] * cap / C]); }
/* the scene's soft look without losing the photo: only the dark end is lifted (black fur becomes charcoal, the range below L 0.5 is squeezed into
   0.34..0.5) and near-black loses its colour cast, mid tones keep their lightness so a brown coat stays brown, near-white fur is pulled toward white
   (a photo's white coat is mostly in some shade), and chroma gets a slight lift with a cap */
export function pastel(lab){
  const [L, a, b] = lab, C = Math.hypot(a, b), l = Math.min(1, Math.max(0, L));
  /* chroma fades out toward black: a near-black coat must come out neutral charcoal, never olive or brown (a photo's black fur carries the room's cast) */
  const C2 = Math.min(C * 1.05, 0.16) * Math.min(1, (l + 0.05) / 0.4) * sstep(0.16, 0.42, l), k = C > 1e-6 ? C2 / C : 0;
  const L2 = l < 0.5 ? 0.34 + l * 0.32 : C < 0.035 && l > 0.75 ? l + (0.96 - l) * 0.6 : l;
  return [Math.min(0.96, L2), a * k, b * k];
}
/* weighted k-means with a deterministic farthest-point start; pts is a flat [L, a, b, ...] array */
function kmeans(pts, w, k, iters = 14){
  const n = w.length, cs = [], tot = w.reduce((s, v) => s + v, 0) || 1, mean = [0, 0, 0];
  for(let i = 0; i < n; i++) for(let j = 0; j < 3; j++) mean[j] += pts[3 * i + j] * w[i] / tot;
  cs.push(mean);
  while(cs.length < k){
    let best = -1, bi = 0;
    for(let i = 0; i < n; i++){ const p = [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]], dm = Math.min(...cs.map(c => d2(p, c))) * Math.sqrt(w[i]); if(dm > best){ best = dm; bi = i; } }
    if(best <= 1e-9) break; cs.push([pts[3 * bi], pts[3 * bi + 1], pts[3 * bi + 2]]);
  }
  const lab = new Int32Array(n); let ws = [];
  for(let it = 0; it < iters; it++){
    const acc = cs.map(() => [0, 0, 0]); ws = cs.map(() => 0);
    for(let i = 0; i < n; i++){ const p = [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]]; let bj = 0, bd = Infinity; cs.forEach((c, j) => { const d = d2(p, c); if(d < bd){ bd = d; bj = j; } }); lab[i] = bj; ws[bj] += w[i]; for(let j = 0; j < 3; j++) acc[bj][j] += p[j] * w[i]; }
    cs.forEach((c, j) => { if(ws[j] > 0) for(let q = 0; q < 3; q++) c[q] = acc[j][q] / ws[j]; });
  }
  return cs.map((c, j) => ({ c, w: ws[j] || 0 })).filter(x => x.w > 0);
}

/* coat colours from a photo:
   1. centre crop to a square and average it down to 64 x 64 cells (transparent cells are skipped);
   2. background: the main colours of the border ring, flood-filled inward from the border, so a white chest inside black fur survives a white wall
      (a ring colour that also fills the middle is the pet itself reaching the border, not background);
   3. weights: toward the centre, and a fur prior (grey, black, white, and the red, orange, yellow and brown hues count fully; green, blue and pink
      count little, which drops grass, sky and props);
   4. k-means (k = 4) in OKLab, near clusters merged (lightness counts 0.6, so shading on one coat stays one colour), specks under 5 % dropped;
   5. each colour is the lit side of its cluster (the mean of its lightest 30 %), because a coat reads as its lit colour and a photo's shade side
      would make every pet look muddy;
   6. pattern suggestion: tuxedo for near-black with near-white; two shades of one hue are one coat (tabby when the shades flip often between
      neighbouring cells, solid otherwise); else solid when one colour holds 85 %, patch otherwise;
   7. at most three colours, in the order the pattern reads them: tuxedo dark then white, two shades lighter (the coat) then darker (the stripes),
      otherwise by share.
   Returns { coat (scene colours, see pastel), raw (photo colours), shares, pattern, edges } or null when the image has no opaque pixels. */
export const TABBY_EDGES = 0.13;
const WARM_C = 0.045;   /* OKLab chroma from which a cluster counts as a coloured coat (orange, golden, brown) rather than grey, black or white */   /* edge density from which two shades of one hue read as stripes (tuned on the sample photos) */
const furWeight = c => { const C = Math.hypot(c[1], c[2]); if(C < 0.05) return 1; const h = (Math.atan2(c[2], c[1]) * 180 / Math.PI + 360) % 360; return h >= 15 && h <= 115 ? 1 : 0.12; };
export function petLookFromPixels(rgba, w, h){
  const N = 64, S = Math.min(w, h), x0 = (w - S) / 2, y0 = (h - S) / 2, st = S / N, cell = new Array(N * N).fill(null);
  for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){
    let r = 0, g = 0, b = 0, c = 0;
    for(let sy = 0; sy < 3; sy++) for(let sx = 0; sx < 3; sx++){
      const px = Math.min(w - 1, Math.floor(x0 + (i + (sx + 0.5) / 3) * st)), py = Math.min(h - 1, Math.floor(y0 + (j + (sy + 0.5) / 3) * st)), o = 4 * (py * w + px);
      if(rgba[o + 3] < 128) continue; r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; c++;
    }
    if(c) cell[j * N + i] = rgbToOklab(r / c, g / c, b / c);
  }
  const ids = cell.map((c, k) => (c ? k : -1)).filter(k => k >= 0);
  if(!ids.length) return null;
  const rr = k => Math.hypot((k % N + 0.5) / N - 0.5, (Math.floor(k / N) + 0.5) / N - 0.5), onRing = k => { const i = k % N, j = Math.floor(k / N); return i < 4 || j < 4 || i >= N - 4 || j >= N - 4; };
  const flat = ks => { const f = new Float64Array(ks.length * 3); ks.forEach((k, n) => { f[3 * n] = cell[k][0]; f[3 * n + 1] = cell[k][1]; f[3 * n + 2] = cell[k][2]; }); return f; };
  const ring = ids.filter(onRing), mid = ids.filter(k => rr(k) < 0.18), BG = 0.08 ** 2;
  const bgs = ring.length ? kmeans(flat(ring), ring.map(() => 1), 3).filter(x => x.w >= 0.15 * ring.length).map(x => x.c)
    .filter(c => mid.filter(k => d2(cell[k], c) < BG).length < 0.4 * mid.length) : [];
  const bg = new Uint8Array(N * N), q = ring.filter(k => bgs.some(c => d2(cell[k], c) < BG));
  q.forEach(k => { bg[k] = 1; });
  while(q.length){ const k = q.pop(), i = k % N, j = (k - i) / N;
    for(const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]){ if(a < 0 || b < 0 || a >= N || b >= N) continue; const n = b * N + a; if(bg[n] || !cell[n] || !bgs.some(c => d2(cell[n], c) < BG)) continue; bg[n] = 1; q.push(n); } }
  let keep = ids.filter(k => !bg[k]);
  if(keep.length < 0.05 * ids.length) keep = ids;
  const wt = keep.map(k => Math.exp(-(rr(k) ** 2) / (2 * 0.3 * 0.3)) * furWeight(cell[k]));
  let cl = kmeans(flat(keep), wt, 4);
  const near = (p, q2) => (0.6 * (p[0] - q2[0])) ** 2 + (p[1] - q2[1]) ** 2 + (p[2] - q2[2]) ** 2 < 0.08 ** 2;
  for(let merged = true; merged;){
    merged = false;
    for(let i = 0; i < cl.length && !merged; i++) for(let j = i + 1; j < cl.length && !merged; j++) if(near(cl[i].c, cl[j].c)){
      const a = cl[i], b = cl[j], t = a.w + b.w; a.c = a.c.map((v, n) => (v * a.w + b.c[n] * b.w) / t); a.w = t; cl.splice(j, 1); merged = true;
    }
  }
  let tot = cl.reduce((s, x) => s + x.w, 0);
  /* shadow is not a coat: when coloured clusters (golden, orange, brown) hold most of the weight, a dark grey cluster is the shade between the fur and the
     background (the golden retriever sample gave #574e57 at 21 %), so it is dropped. A black-and-white or grey pet has no coloured majority and keeps it. */
  const Cc = c => Math.hypot(c[1], c[2]), chromatic = cl.filter(x => Cc(x.c) >= 0.03).reduce((s, x) => s + x.w, 0);
  if(chromatic >= 0.5 * tot){ const kept = cl.filter(x => !(x.c[0] < 0.5 && Cc(x.c) < 0.03)); if(kept.length) cl = kept; tot = cl.reduce((s, x) => s + x.w, 0); }
  cl = cl.map(x => ({ c: x.c, s: x.w / tot })).filter(x => x.s >= 0.05).sort((a, b) => b.s - a.s);
  const st2 = cl.reduce((s, x) => s + x.s, 0), shares = cl.map(x => Math.round(100 * x.s / st2) / 100);
  /* members per cluster, the lit colour, and how often neighbours differ */
  const lab = new Int16Array(N * N).fill(-1), mem = cl.map(() => []);
  keep.forEach((k, n) => { let bj = 0, bd = Infinity; cl.forEach((x, j) => { const d = d2(cell[k], x.c); if(d < bd){ bd = d; bj = j; } }); lab[k] = bj; mem[bj].push([cell[k], wt[n]]); });
  /* the lit colour: for a grey, white or black cluster the mean of its lightest 30 %; for a coloured one (chroma of the mean at least WARM_C) the cells are
     ranked by lightness plus chroma, because the shade side of warm fur is both darker and greyer, and the chroma is kept at the cluster's strong end
     (its 75th percentile) with the hue of the lit mean, so a golden coat stays golden instead of averaging toward tan */
  const Cm = c => Math.hypot(c[1], c[2]);
  cl.forEach((x, j) => { if(!mem[j].length) return; const warm = Cm(x.c) >= WARM_C, key = e => e[0][0] + (warm ? 1.6 * Cm(e[0]) : 0);
    const m = mem[j].slice().sort((a, b) => key(a) - key(b)), half = m.slice(Math.floor(m.length * 0.7)), sw = half.reduce((s, e) => s + e[1], 0) || 1;
    const lit = [0, 1, 2].map(n => half.reduce((s, e) => s + e[0][n] * e[1], 0) / sw);
    if(warm){ const cs = m.map(e => Cm(e[0])).sort((a, b) => a - b), c75 = cs[Math.floor(cs.length * 0.75)], c0 = Cm(lit); if(c0 > 1e-6 && c75 > c0){ const k = Math.min(1.35, c75 / c0); lit[1] *= k; lit[2] *= k; } }
    x.lit = lit; });
  let pairs = 0, diff = 0;
  for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){ const a = lab[j * N + i]; if(a < 0) continue;
    if(i + 1 < N && lab[j * N + i + 1] >= 0){ pairs++; if(lab[j * N + i + 1] !== a) diff++; } if(j + 1 < N && lab[(j + 1) * N + i] >= 0){ pairs++; if(lab[(j + 1) * N + i] !== a) diff++; } }
  const edges = pairs ? Math.round(1000 * diff / pairs) / 1000 : 0, col = x => x.lit || x.c;
  const C = c => Math.hypot(c[1], c[2]), hue = c => Math.atan2(c[2], c[1]), dk = cl.find(x => col(x)[0] < 0.42 && C(col(x)) < 0.06), lt = cl.find(x => col(x)[0] > 0.75 && C(col(x)) < 0.06);
  const [A, B] = cl.map(col), shades = !!B && Math.abs(A[0] - B[0]) < 0.35 && ((C(A) < 0.04 && C(B) < 0.04) || (C(A) >= 0.04 && C(B) >= 0.04 && Math.abs(Math.atan2(Math.sin(hue(A) - hue(B)), Math.cos(hue(A) - hue(B)))) < 0.5));
  const grey = cl.filter(x => C(col(x)) < 0.06).reduce((s2, x) => s2 + x.s, 0), tux = !!(dk && lt) && lt.s >= 0.06 && dk.s >= 0.3 && grey >= 0.7;   /* a white chest is small, so tuxedo comes before the share rule */
  const pattern = tux ? 'tuxedo' : shades ? (edges >= TABBY_EDGES && C(A) >= 0.04 ? 'tabby' : 'solid') : shares[0] >= 0.85 ? 'solid' : 'patch';
  cl.forEach((x, i) => { x.share = shares[i]; });
  const lead = tux ? [dk, lt] : shades ? [cl[0], cl[1]].sort((a, b) => col(b)[0] - col(a)[0]) : [];
  let ord = lead.concat(cl.filter(x => !lead.includes(x)));
  if(shades && pattern === 'solid') ord = ord.filter(x => x !== lead[1]);   /* two shades of one coat with no stripes are light and shade on one colour: offer the lit one only */
  ord = ord.slice(0, PET_COAT_MAX);
  /* two colours unless a third is clearly fur: a white chest or paws (near-white, at least 6 %), or a stripe shade of a tabby's own hue */
  if(ord.length > 2){ const x = ord[2], c = col(x), sameHue = C(c) >= 0.04 && C(col(ord[0])) >= 0.04 && Math.abs(Math.atan2(Math.sin(hue(c) - hue(col(ord[0]))), Math.cos(hue(c) - hue(col(ord[0]))))) < 0.5;
    if(!((c[0] > 0.8 && C(c) < 0.05 && x.share >= 0.06) || (pattern === 'tabby' && sameHue))) ord = ord.slice(0, 2); }
  return { coat: ord.map(x => oklabToHex(pastel(col(x)))), raw: ord.map(x => oklabToHex(col(x))), shares: ord.map(x => x.share), pattern, edges };
}

/* ---------- behaviour schedule ---------- */
/* FNV-1a with a final avalanche (murmur3 fmix32), 0..1. Plain FNV-1a (office-scene.js hash) moves by about 1/256 per step of a trailing character, so keys
   that differ only in a counter at the end ('...r1', '...r2') land close together; the pet schedule and the stroll points are keyed exactly that way. */
export const petHash = s => {
  let h = 2166136261; for(const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const hash = petHash;
export const PET_ACTS = ['roam', 'sit', 'eat', 'drink', 'sleep', 'play'];
const ACT_W = [0.3, 0.14, 0.12, 0.08, 0.18, 0.18], ACT_DUR = { roam: [7, 6], sit: [4, 5], eat: [6, 3], drink: [5, 3], sleep: [18, 12], play: [16, 8] };
/* act n starts after a short pause from prev (the previous act's end); the same seed always gives the same sequence. A calm act (all but roam)
   never repeats back to back. Mirrors planAct for people in office-scene.js. */
export function petPlan(seed, n = 0, prev = 0, prevKind = null){
  const choose = salt => { let x = hash(seed + ':' + salt + n), i = 0; for(; i < ACT_W.length - 1; i++){ x -= ACT_W[i]; if(x < 0) break; } return PET_ACTS[i]; };
  let kind = choose('k');
  if(kind === prevKind && kind !== 'roam') kind = choose('r');
  if(kind === prevKind && kind !== 'roam') kind = 'roam';
  const d = ACT_DUR[kind], gap = 0.4 + 0.8 * hash(seed + ':g' + n), dur = d[0] + d[1] * hash(seed + ':d' + n);
  return { n, t0: prev + gap, t1: prev + gap + dur, kind };
}
/* which pets to draw: the viewer's own first, then by a hash of the owner id, at most max. list items are { id, pet } */
export function pickPets(list, viewerId, max = PET_MAX){
  return (list || []).filter(p => p && p.id != null && normalizePetLook(p.pet))
    .sort((a, b) => (b.id === viewerId) - (a.id === viewerId) || hash(a.id + ':pet') - hash(b.id + ':pet')).slice(0, max).map(p => p.id);
}

/* ---------- motion helpers (pure, tested) ---------- */
/* ease in and out (smoothstep), clamped to 0..1 */
export const easeIO = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
/* every change of pose mixes from what was on screen into the new pose over this many seconds */
export const PET_BLEND = 0.2;
/* the gait is driven by distance: one full leg cycle per PET_STRIDE of travel in the pet's own units (times its scale in the world), so a small pet takes
   quicker steps than a large one and no pet's feet slide. With a leg swing of 0.55 rad on a 0.2 leg the foot travels about 0.21 per half cycle. */
export const PET_STRIDE = 0.42;
export const petGait = (phase, dist, scale) => phase + dist / (PET_STRIDE * Math.max(1e-3, scale));
/* walking speed for one frame: speeds up and slows down at accel A (about 0.2 s from rest to V), slows so it stops exactly at the end of the path
   (rem is the distance left), and does not move at all while the heading is more than about 30 degrees off (err in radians), so the pet turns first */
export function petSpeedStep(v, rem, err, dt, V = 1.1, A = 5){
  const head = err <= 0.35 ? 1 : err >= 0.55 ? 0 : 1 - (err - 0.35) / 0.2;
  const want = Math.min(V * head, Math.sqrt(2 * A * Math.max(0, rem)));
  return want > v ? Math.min(want, v + A * dt) : Math.max(want, v - 2.5 * A * dt);
}
/* a short twitch now and then: 0 most of the time, a smooth 0..1..0 bump lasting len of every per seconds on about half the periods */
function twitch(t, per, salt, len = 0.07){
  const k = Math.floor(t / per), f = t / per - k, r = Math.abs(Math.sin((k + salt) * 78.233) * 43758.5453) % 1;
  return r < 0.5 && f < len ? Math.sin(Math.PI * f / len) : 0;
}

/* play: a sequence of moves seeded per pet and per act, so two pets never move in step and one pet never repeats like a metronome.
   Moves: crouch (wiggle, eyes on the toy), pounce (a short leap onto the toy, which squirts away), bat (a paw swipe that rolls the toy to the other
   side), look (a pause with the head tilted), back (a hop back to where it started). The state is the body's forward offset bz and the toy's place
   (tx across, tz ahead, in the pet's own units, the toy always ahead of the chest) and its roll. Positions only change inside a move, eased between the
   move's start and end, so the toy and the body never jump; the poses of consecutive moves are mixed by posePet's blend. */
export const PET_PLAY_Z = 0.42;
export function petPlaySeq(seed, total){
  const h = k => petHash(seed + ':pl' + k), out = [];
  let t = 0, i = 0, since = 0, st = { bz: 0, tx: 0, tz: PET_PLAY_Z, roll: 0 };
  const push = (k, dur, b, side = 0) => { out.push({ k, t0: t, t1: t + dur, a: st, b, side }); t += dur; st = b; };
  const sideOf = r => st.tx > 0.006 ? 1 : st.tx < -0.006 ? -1 : r < 0.5 ? 1 : -1;
  while((t < total || st.bz > 1e-4) && out.length < 400){
    const r = h(i + 'a'), r2 = h(i + 'b'), r3 = h(i + 'c'); i++;
    if(st.bz > 1e-4){
      if(since >= 2 || r < 0.3){ push('back', 0.45 + 0.15 * r2, { ...st, bz: 0 }); since = 0; }
      else if(r < 0.72){ const s = sideOf(r3); push('bat', 0.7 + 0.2 * r2, { ...st, tx: -s * (0.025 + 0.035 * r3), tz: st.bz + PET_PLAY_Z + 0.01 * r2, roll: st.roll + 2.6 * s }, s); since++; }
      else { push('look', 0.5 + 0.8 * r2, { ...st }, r3 < 0.5 ? 1 : -1); since++; }
    }else if(r < 0.45){
      push('crouch', 0.7 + 1.0 * r2, { ...st });
      push('pounce', 0.62, { bz: 0.08, tx: Math.max(-0.07, Math.min(0.07, st.tx + (r3 - 0.5) * 0.09)), tz: PET_PLAY_Z + 0.1 + 0.04 * r3, roll: st.roll + 4 }); since = 0;
    }else if(r < 0.78){ const s = sideOf(r3); push('bat', 0.7 + 0.2 * r2, { ...st, tx: -s * (0.025 + 0.035 * r3), tz: PET_PLAY_Z + 0.015 * r2, roll: st.roll + 2.6 * s }, s); }
    else push('look', 0.5 + 0.8 * r2, { ...st }, r3 < 0.5 ? 1 : -1);
  }
  return out;
}
/* the play state at time t (seconds from the start of the act): { k, u, side, bz, tx, tz, roll } */
export function petPlayAt(seq, t){
  if(!seq.length) return { k: 'look', u: 0, side: 1, bz: 0, tx: 0, tz: PET_PLAY_Z, roll: 0 };
  let m = seq[seq.length - 1]; for(const q of seq) if(t < q.t1){ m = q; break; }
  const u = Math.min(1, Math.max(0, (t - m.t0) / (m.t1 - m.t0))), A = m.a, B = m.b;
  const win = (a, b) => easeIO((u - a) / (b - a));
  const kb = m.k === 'pounce' ? win(0.15, 0.72) : m.k === 'back' ? win(0, 1) : 0, kt = m.k === 'pounce' ? win(0.15, 0.72) : m.k === 'bat' ? win(0.38, 0.8) : 0;   /* the toy squirts ahead as the pet leaps, so it never ends up under the chest */
  const L = (p, k) => A[p] + (B[p] - A[p]) * k;
  return { k: m.k, u, side: m.side, bz: L('bz', kb), tx: L('tx', kt), tz: L('tz', kt), roll: L('roll', kt) };
}

/* ---------- three.js part ---------- */
function kit(){
  const geos = new Set(), mats = new Set(), ims = new Set();
  return { geo: g => (geos.add(g), g), mat: m => (mats.add(m), m), im: i => (ims.add(i), i),
    dispose(){ ims.forEach(i => i.dispose && i.dispose()); geos.forEach(g => g.dispose()); mats.forEach(m => { if(m.map && m.userData.ownMap) m.map.dispose(); m.dispose(); }); geos.clear(); mats.clear(); ims.clear(); } };
}
/* bend a unit-height geometry (y 0..1) toward +z by b radians over its length, keeping its cross sections */
function bendY(geo, b){
  const p = geo.getAttribute('position');
  if(b > 0 && p) for(let i = 0; i < p.count; i++){ const y = p.getY(i); if(y <= 0) continue; const z = p.getZ(i), th = b * y, R = 1 / b;
    p.setXYZ(i, p.getX(i), R * Math.sin(th) - z * Math.sin(th), R * (1 - Math.cos(th)) + z * Math.cos(th)); }
  if(p) p.needsUpdate = true; if(geo.computeVertexNormals) geo.computeVertexNormals(); return geo;
}
const lathe = (T, prof, seg = 18) => new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(r, y)), seg);
const SHARED = new WeakMap();
function shared(T){
  let s = SHARED.get(T);
  if(!s){ s = { sph: new T.SphereGeometry(1, 24, 16), cap: new T.CapsuleGeometry(1, 1, 6, 14), cone: new T.ConeGeometry(1, 1, 14), tor: new T.TorusGeometry(1, 0.42, 10, 20, Math.PI * 1.5),
    /* a tapered tail, unit length up +y, curling gently toward +z at the tip */
    tail: bendY(lathe(T, [[0, -0.04], [0.6, -0.02], [1, 0.06], [0.94, 0.3], [0.8, 0.55], [0.63, 0.77], [0.46, 0.91], [0.26, 0.99], [0, 1.02]], 14), 0.95),
    /* a plume for the fluffy tail: thick in the middle, a soft point, a slight curve */
    plume: bendY(lathe(T, [[0, -0.04], [0.5, 0], [0.86, 0.15], [1, 0.4], [0.95, 0.62], [0.76, 0.82], [0.42, 0.96], [0, 1.01]], 16), 0.6),
    /* a hanging ear: narrow where it joins the head, rounded and full at the bottom */
    drop: lathe(T, [[0, -0.52], [0.6, -0.47], [0.9, -0.32], [0.96, -0.1], [0.78, 0.2], [0.48, 0.42], [0, 0.5]], 16),
    /* closed eyes: a thin arc (drawn as a smile-shaped curve when turned upside down) */
    arc: new T.TorusGeometry(1, 0.2, 6, 14, Math.PI) }; SHARED.set(T, s); }
  return s;
}
export function disposePetShared(T){ const s = SHARED.get(T); if(s){ Object.values(s).forEach(g => g.dispose()); SHARED.delete(T); } }

/* one material per part: colour c0, and c1 where the pattern says. mode 0 plain, 1 patches (value noise), 2 stripes across dir, 3 region
   facing dir (dot of the unit-sphere position with dir above th). Positions are the mesh's own unit-geometry coordinates. */
const FRAG_HEAD = `uniform vec3 uPetC0; uniform vec3 uPetC1; uniform int uPetMode; uniform vec3 uPetDir; uniform float uPetTh; uniform float uPetFreq; uniform vec3 uPetOff; uniform float uPetPlush; varying vec3 vPetPos;
#ifdef PET_SHELL
uniform vec3 uPetScale; uniform float uPetFurF; varying float vPetH;
#endif
float petH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float petN(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(petH(i), petH(i + vec3(1, 0, 0)), f.x), mix(petH(i + vec3(0, 1, 0)), petH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(petH(i + vec3(0, 0, 1)), petH(i + vec3(1, 0, 1)), f.x), mix(petH(i + vec3(0, 1, 1)), petH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
`;
const FRAG_BODY = `#include <color_fragment>
float petFz = 0.5, petFd = 0.0;   /* strand noise and its strength (0 where a tuft is under a pixel) */
{ vec3 q = vPetPos; float m = 0.0;
  if(uPetMode == 1){ float n = petN(q * uPetFreq + uPetOff) * 0.65 + petN(q * uPetFreq * 2.3 + uPetOff.zxy) * 0.35; m = smoothstep(0.5, 0.56, n); }
  else if(uPetMode == 2){ float s = sin(dot(q, uPetDir) * uPetFreq + petN(q * 2.5 + uPetOff) * 3.0); m = smoothstep(0.15, 0.55, s) * smoothstep(uPetTh, uPetTh + 0.15, normalize(q + vec3(1e-5)).y); }
  else if(uPetMode == 3){ m = smoothstep(uPetTh - 0.06, uPetTh + 0.06, dot(normalize(q + vec3(1e-5)), uPetDir)); }
  if(uPetMode == 4){ vec3 n = normalize(q + vec3(1e-5)); vec3 c = mix(uPetC1, uPetC0, smoothstep(uPetTh - 0.05, uPetTh + 0.05, n.z));
    diffuseColor.rgb = mix(c, vec3(1.0), smoothstep(0.84, 0.88, dot(n, uPetDir))); }
  else diffuseColor.rgb = mix(uPetC0, uPetC1, m);
  /* plush: a fine two-octave strand noise in object space darkens the fur between tufts; it fades out where a tuft is smaller than a pixel. The cast's warm
     daylight gain (fur.js GAIN_DAY) is applied too, so a pet beside its owner is not the duller of the two, but not on near-black fur, where a warm gain
     under the warm room light turns charcoal olive or brown. */
  if(uPetPlush > 0.0){ vec3 fq = q * 16.0 + uPetOff; petFz = petN(fq) * 0.7 + petN(fq * 2.1 + 7.1) * 0.3; petFd = uPetPlush * (1.0 - smoothstep(0.3, 1.4, length(fwidth(fq))));
    float petL = dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1));
    diffuseColor.rgb *= (1.0 + 0.08 * petFd * (petFz - 0.5)) * mix(vec3(0.97, 0.985, 1.03), mix(vec3(1.0), vec3(1.12, 1.09, 1.03), uPetPlush), smoothstep(0.025, 0.12, petL)); }
#ifdef PET_SHELL
  /* shell fur: strands are columns of a two-octave noise in the pet's own units (vPetPos is the surface point before the shell was pushed out, so a strand
     stays put from shell to shell); a strand thins toward its tip, and the roots sit a little darker */
  { vec3 sq = vPetPos * uPetScale * uPetFurF; float sn = petN(sq) * 0.62 + petN(sq * 2.37 + 3.1) * 0.38;
    if(sn < 0.3 + 0.6 * vPetH) discard;
    diffuseColor.rgb *= mix(0.84, 1.05, vPetH); }
#endif
}
`;
/* the plush shading of a coat: the light wraps round the form instead of ending at a hard terminator, and a soft sheen of the diffuse light rises
   toward the silhouette, which is how short fur reads (the cast's fur.js gets the same from shells). A normal bump from the strand noise was tried
   and read as a crusty patch on these small spheres, so the noise only tints. */
const FRAG_SHEEN = `{ float sh = pow(1.0 - saturate(dot(normal, geometryViewDir)), 2.2); outgoingLight += (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) * sh * 0.55 * uPetPlush; }
#include <opaque_fragment>`;
const DIFFUSE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
/* a shell is pushed out along the surface normal of the scaled mesh by uPetLen (in the units of the mesh's parent, the pet's own units), as far as
   its layer: layer i of n reaches (i + 1) / n of the length */
const SHELL_V = `
#ifdef PET_SHELL
  vPetH = (float(gl_InstanceID) + 1.0) / uPetShells;
  { vec3 sn = normalize(objectNormal * uPetInvS); transformed += sn * uPetInvS * (uPetLen * vPetH); }
#endif`;
/* mode 2 stripes fade out below y = th on the unit sphere (th -2 keeps them everywhere); mode 4 is an eye: pupil c0 facing +z beyond th,
   an iris ring c1 round it, and a white highlight toward dir. sh: { u, len, inv, scale } turns the material into the shell layers of a part,
   sharing the part's colour uniforms so a recolour reaches both. */
function coatMat(T, pt, rough, seed, plush = 0, sh = null){
  const m = new T.MeshStandardMaterial({ color: pt ? pt.c0 : '#ffffff', roughness: rough, metalness: 0 });
  const u = sh ? sh.u : { uPetC0: { value: new T.Color(pt.c0) }, uPetC1: { value: new T.Color(pt.c1) }, uPetMode: { value: pt.mode }, uPetDir: { value: new T.Vector3(...pt.dir).normalize() },
    uPetTh: { value: pt.th }, uPetFreq: { value: pt.freq }, uPetOff: { value: new T.Vector3(hash(seed + 'x') * 40, hash(seed + 'y') * 40, hash(seed + 'z') * 40) }, uPetPlush: { value: plush } };
  const su = sh ? { uPetLen: { value: sh.len }, uPetShells: sh.shells, uPetInvS: { value: sh.inv }, uPetScale: { value: sh.scale }, uPetFurF: { value: 95 } } : {};
  m.userData.pet = u;
  if(sh) m.defines = { PET_SHELL: '' };
  m.onBeforeCompile = shd => {
    Object.assign(shd.uniforms, u, su);
    shd.vertexShader = 'varying vec3 vPetPos;\n#ifdef PET_SHELL\nvarying float vPetH; uniform float uPetLen; uniform float uPetShells; uniform vec3 uPetInvS;\n#endif\n'
      + shd.vertexShader.replace('#include <begin_vertex>', () => '#include <begin_vertex>\nvPetPos = position;' + SHELL_V);
    /* function replacements, so the dollar signs in the chunks are not read as patterns */
    shd.fragmentShader = FRAG_HEAD + shd.fragmentShader.replace('#include <color_fragment>', () => FRAG_BODY)
      .replace('#include <lights_physical_pars_fragment>', () => T.ShaderChunk.lights_physical_pars_fragment.replace(DIFFUSE, () => 'reflectedLight.directDiffuse += mix( saturate( dot( geometryNormal, directLight.direction ) ), saturate( ( dot( geometryNormal, directLight.direction ) + 0.45 ) / 1.45 ), uPetPlush ) * directLight.color * BRDF_Lambert( material.diffuseColor );'))
      .replace('#include <opaque_fragment>', () => FRAG_SHEEN);
  };
  m.customProgramCacheKey = () => 'petcoat1';
  if(sh) m.customProgramCacheKey = () => 'petcoat1shell';
  return m;
}
const WHITE = '#f3efe8';
/* role -> paint for the chosen pattern; with fewer coat colours than a pattern needs, the missing one is derived from the first */
function paints(look){
  const cat = look.kind === 'cat', coat = look.coat.map(neutralDark), [c0, c1, c2] = coat, byL = coat.slice().sort((a, b) => lum(a) - lum(b));
  const dark = byL[0], light = byL[byL.length - 1], p = (a, b = a, mode = 0, dir = [0, 0, 1], th = 0, freq = 3.5) => ({ c0: a, c1: b, mode, dir, th, freq });
  let r;
  if(look.pattern === 'patch'){ const b = c1 || shadeHex(c0, lum(c0) > 0.6 ? -0.28 : 0.3);
    r = { body: p(c0, b, 1, [0, 0, 1], 0, 1.3), head: p(c0, b, 1, [0, 0, 1], 0, 1.1), leg: p(c0, b, 1, [0, 0, 1], 0, 0.7), ear: p(c2 || b), tail: p(b), muzzle: p(mixHex(c0, WHITE, 0.5)) };
  }else if(look.pattern === 'tabby'){ const two = c1 ? [c0, c1].sort((a, b) => lum(b) - lum(a)) : [c0, shadeHex(c0, -0.2)], base = two[0], st = two[1];
    /* stripes on the back, the sides, the tail and the crown only: the body's rings fade out toward the belly, the legs stay plain (striped legs read as a
       caterpillar at this size) and the head keeps its lines on the crown, so the eyes, cheeks and muzzle stay plain and the face reads */
    r = { body: p(base, st, 2, [0, 0, 1], -0.28, 13), head: p(base, st, 2, [1, 0, 0], 0.38, 15), leg: p(base), ear: p(base), tail: p(base, st, 2, [0, 1, 0], -2, 7), muzzle: p(c2 || mixHex(base, WHITE, 0.55)) };
  }else if(look.pattern === 'tuxedo'){ const d = lum(dark) < 0.6 ? dark : '#47464a', w = lum(light) - lum(d) > 0.3 ? light : WHITE;
    r = { body: p(d, w, 3, [0, -0.55, 1], 0.45), head: p(d, w, 3, [0, -0.75, 1], 0.62), leg: p(d, w, 3, [0, -1, 0], 0.7), ear: p(d), tail: p(d), muzzle: p(w) };
  }else if(look.pattern === 'point'){ const pale = light, pt = lum(light) - lum(dark) > 0.25 ? dark : shadeHex(light, -0.35);
    r = { body: p(pale), head: p(pale, pt, 3, [0, 0, 1], 0.3), leg: p(pale, pt, 3, [0, -1, 0], -0.1), ear: p(pt), tail: p(pt), muzzle: p(pt) };
  }else r = { body: p(c0), head: p(c0), leg: p(c0), ear: p(c0), tail: p(c0), muzzle: p(mixHex(c0, WHITE, cat ? 0.5 : 0.35)) };
  r.nose = p(cat && look.pattern !== 'tuxedo' ? '#e79aa8' : '#3b3036');
  /* eyes: a dark pupil with an iris ring, so they still read on a dark head (amber for cats, brown for dogs, lighter when the face is dark) */
  const faceDark = lum(r.head.c0) < 0.55;
  r.eye = p('#241d2a', cat ? (faceDark ? '#f0c95a' : '#b9a14a') : (faceDark ? '#c49a72' : '#6e4c3a'), 4, [0.35, 0.5, 0.8], cat ? 0.45 : 0.3);
  r.lid = p(faceDark ? '#b9aeb4' : '#3b3036');
  return r;
}
const SIZE = { s: 0.82, m: 1, l: 1.2 };
/* the parts of a look that change the model's shape; anything else (colours, pattern, name) is repainted in place by petRecolor */
export const petShapeKey = look => { const l = normalizePetLook(look); return l ? [l.kind, l.ear, l.tail, l.size, l.fluff].join('|') : ''; };
/* fur length in the pet's own units, from fluff */
export const petFurLen = fluff => 0.009 + 0.021 * Math.min(1, Math.max(0, +fluff || 0));
/* the shell count for a pet seen at px screen pixels per unit of its own size: about one shell per pixel of fur, 3 to 5, none below 1.5 pixels of fur */
export const PET_SHELLS = 5;
export const petShellCount = (len, px) => { const f = len * px; return f < 1.5 ? 0 : Math.max(3, Math.min(PET_SHELLS, Math.round(f * 1.1))); };

/* the pet: Group 'pet' > 'rig' > named joints (body, head with eyeL eyeR lidL lidR mouth, earL earR, legFL legFR legBL legBR, tail). 15 or 16 meshes,
   and shell fur on the body, the head, the four legs and the tail (6 or 7 instanced meshes of up to PET_SHELLS layers each) that userData.fur(px) switches on when the pet
   is large on screen. No part casts a shadow-map shadow: the scene draws a contact shadow under the pet, which follows it every frame. */
export function makePet(T, raw){
  const look = normalizePetLook(raw) || normalizePetLook({ coat: ['#d9b48f'] }), G = shared(T), cat = look.kind === 'cat', f = look.fluff, K = kit(), P = paints(look), seed = look.coat.join('') + look.pattern;
  const mats = [], shells = [], shellN = { value: PET_SHELLS }, furLen = petFurLen(f);
  /* fur parts are plush (rough, tufted, wrapped light, a rim sheen); the eyes and the nose keep their own roughness and stay smooth and wet */
  const mat = (role, rough) => { const m = K.mat(rough == null ? coatMat(T, P[role], 1, seed + role + K.n++, 0.75 + 0.25 * f) : coatMat(T, P[role], rough, seed + role + K.n++, 0)); mats.push({ m, role }); return m; }; K.n = 0;
  const root = new T.Group(); root.name = 'pet'; const rig = new T.Group(); rig.name = 'rig'; root.add(rig);
  const nodes = { rig };
  const node = (name, parent, x, y, z) => { const g = new T.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); nodes[name] = g; return g; };
  const mesh = (geo, m, parent, x, y, z, sx, sy, sz) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = false; o.receiveShadow = true; parent.add(o); return o; };
  /* shell fur over a part: the part's own material settings, a few instanced layers pushed out along the normal, alpha-tested strands */
  const fur = (o, len = furLen) => {
    const sm = K.mat(coatMat(T, null, 1, '', 0, { u: o.material.userData.pet, len, shells: shellN, inv: new T.Vector3(1 / o.scale.x, 1 / o.scale.y, 1 / o.scale.z), scale: o.scale.clone() }));
    const im = K.im(new T.InstancedMesh(o.geometry, sm, PET_SHELLS)); im.name = 'petFur'; im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false; im.count = 0; im.visible = false; im.raycast = () => {};
    o.add(im); shells.push(im); return im;
  };
  const puff = 1 + 0.08 * f, bl = cat ? 0.165 : 0.175, bw = cat ? 0.105 : 0.125;
  const body = node('body', rig, 0, 0.25, 0);
  fur(mesh(G.sph, mat('body'), body, 0, 0, 0, bw * puff, 0.115 * puff, bl));
  for(const [nm, sx, sz] of [['legFL', 1, 1], ['legFR', -1, 1], ['legBL', 1, -1], ['legBR', -1, -1]]){
    const lg = node(nm, rig, sx * bw * 0.58, 0.2, sz * bl * 0.55); fur(mesh(G.cap, mat('leg'), lg, 0, -0.1, 0, 0.05, 0.2 / 3, 0.052), furLen * 0.55);   /* short fur on the legs, so they do not read as smooth pegs under a fluffy body */
  }
  const head = node('head', rig, 0, 0.33, bl * 0.72), hr = (cat ? 0.15 : 0.145) * puff, fz = 0.04 + hr;   /* hr already carries the fluff, so the face parts sit on the puffed surface */
  fur(mesh(G.sph, mat('head'), head, 0, 0.1, 0.04, hr * (cat ? 1.1 : 1), hr * (cat ? 0.93 : 1), hr), furLen * 0.8);
  if(cat){ mesh(G.sph, mat('muzzle'), head, 0, 0.05, fz - 0.025, 0.06, 0.038, 0.04); mesh(G.sph, mat('nose', 0.5), head, 0, 0.07, fz + 0.012, 0.018, 0.013, 0.012); }
  else{ mesh(G.sph, mat('muzzle'), head, 0, 0.045, fz - 0.02, 0.075, 0.058, 0.075); mesh(G.sph, mat('nose', 0.4), head, 0, 0.075, fz + 0.05, 0.026, 0.02, 0.02); }
  const lidM = mat('lid', 0.6);
  for(const s of [1, -1]){
    const e = mesh(G.sph, mat('eye', 0.3), head, s * hr * 0.43, 0.125, 0.04 + hr * 0.86, hr * 0.24, hr * 0.255, hr * 0.13); e.rotation.y = s * 0.35;   /* eye size follows the head, the same for both kinds */ e.name = s > 0 ? 'eyeL' : 'eyeR'; nodes[e.name] = e;
    /* the closed eye: a thin downward arc, shown instead of the eye when the eye is squeezed shut (asleep, a blink) */
    const l = mesh(G.arc, lidM, head, s * hr * 0.43, 0.132, 0.04 + hr * 0.975, hr * 0.2, hr * 0.17, hr * 0.12); l.rotation.set(0, s * 0.35, Math.PI); l.visible = false; l.name = s > 0 ? 'lidL' : 'lidR'; nodes[l.name] = l;
  }
  const mouth = node('mouth', head, 0, 0.03, fz + 0.05);
  for(const s of [1, -1]){
    const nm = s > 0 ? 'earL' : 'earR';
    /* a floppy ear hangs as a soft teardrop with some thickness, narrow at the root and full at the tip */
    if(look.ear === 'flop'){ const g = node(nm, head, s * 0.11, 0.17, 0.03); g.rotation.set(0.12, 0, s * 0.22); const o = mesh(G.drop, mat('ear'), g, s * 0.016, -0.062, 0, 0.026, 0.105, 0.066); o.rotation.z = s * 0.06; }
    else if(look.ear === 'fold'){ const g = node(nm, head, s * 0.075, 0.215, 0.05); g.rotation.set(0.4, 0, -s * 0.15); mesh(G.sph, mat('ear'), g, s * 0.01, 0.01, 0.02, 0.055, 0.028, 0.05); }
    else{ const g = node(nm, head, s * 0.085, 0.2, 0.03); g.rotation.set(cat ? 0.1 : 0, 0, -s * (cat ? 0.25 : 0.35)); if(cat) mesh(G.cone, mat('ear'), g, 0, 0.05, 0, 0.06, 0.11, 0.035); else { g.rotation.z = -s * 0.5; mesh(G.cone, mat('ear'), g, 0, 0.035, 0, 0.068, 0.075, 0.034); } }   /* cats get tall pointed cones; a dog's pricked ear is a short wide triangle tipped outward (shiba, corgi) */
  }
  const tail = node('tail', rig, 0, 0.29, -bl * 0.92), tm = mat('tail');
  if(look.tail === 'short'){ tail.rotation.x = -0.9; mesh(G.sph, tm, tail, 0, 0.03, 0, 0.045, 0.045, 0.045); }
  else if(look.tail === 'curl'){ const o = mesh(G.tor, tm, tail, 0, 0.07, 0.01, 0.055, 0.055, 0.055); o.rotation.set(0, Math.PI / 2, -0.4); }
  else if(look.tail === 'fluff'){ tail.rotation.x = -0.95; const r = 0.05 + 0.02 * f; fur(mesh(G.plume, tm, tail, 0, -0.01, 0, r, 0.21, r), furLen * 1.3); }
  /* a tapered tail with a slight curve toward the tip: a cat holds it up like a question mark, a dog carries it out behind */
  else{ tail.rotation.x = cat ? -0.3 : -0.85; const r = cat ? 0.03 : 0.034; fur(mesh(G.tail, tm, tail, 0, -0.01, 0, r, cat ? 0.25 : 0.2, r), furLen * 0.7); }
  root.scale.setScalar(SIZE[look.size]);
  const rest = {}; for(const k in nodes) rest[k] = { p: nodes[k].position.clone(), r: nodes[k].rotation.clone(), s: nodes[k].scale.clone() };
  const keys = Object.keys(nodes);
  root.userData = { look, nodes, rest, keys, mats, shells, height: 0.62 * SIZE[look.size], mouth, shown: new Float32Array(keys.length * 9), from: new Float32Array(keys.length * 9), bkey: null, bon: false, bt0: 0, bdur: 0,
    pose: (kind, u, t, o) => posePet(root, kind, u, t, o),
    /* shell fur for the on-screen size: px is screen pixels per world unit at the pet; returns the draw calls the shells add */
    fur: px => { const n = petShellCount(furLen, px * root.scale.x); if(n) shellN.value = n; shells.forEach(im => { im.count = n; im.visible = n > 0; }); return n ? shells.length : 0; },
    dispose: K.dispose };
  return root;
}
/* repaint a pet in place for a new look with the same shape (petShapeKey): colours and pattern only, no new geometry or programs. False when the shape differs. */
export function petRecolor(g, raw){
  const look = normalizePetLook(raw), ud = g && g.userData; if(!look || !ud || !ud.mats || petShapeKey(look) !== petShapeKey(ud.look)) return false;
  const P = paints(look);
  ud.mats.forEach(({ m, role }) => { const pt = P[role], u = m.userData.pet; if(!pt || !u) return; u.uPetC0.value.set(pt.c0); u.uPetC1.value.set(pt.c1); u.uPetMode.value = pt.mode; u.uPetDir.value.set(pt.dir[0], pt.dir[1], pt.dir[2]).normalize(); u.uPetTh.value = pt.th; u.uPetFreq.value = pt.freq; m.color.set(pt.c0); });
  ud.look = look; return true;
}

/* Poses are node transforms over the rest pose. t is seconds (drives the idle cycles and the blend), u is 0..1 over a stage where it matters.
   o: { phase: gait cycles (distance travelled / stride, see petGait), amp: 0..1 how strongly the legs swing (0 standing, 1 full stride), play: the state
   from petPlayAt, blend: seconds to mix a change of pose (PET_BLEND by default, 0 snaps; pass 0 when t does not advance, as under reduced motion) }.
   Every change of pose, and every change of move within play, starts from what was on screen and eases into the new pose, so nothing cuts. */
export function posePet(g, kind, u = 0, t = 0, o = {}){
  const ud = g.userData, n = ud.nodes, R = ud.rest, s = Math.sin, pl = o.play || null;
  for(const k in n){ n[k].position.copy(R[k].p); n[k].rotation.copy(R[k].r); n[k].scale.copy(R[k].s); }
  const legs = (fl, fr, bl, br) => { n.legFL.rotation.x = fl; n.legFR.rotation.x = fr; n.legBL.rotation.x = bl; n.legBR.rotation.x = br; };
  const wag = (sp, a) => { n.tail.rotation.z = s(t * sp) * a; }, shut = k => { n.eyeL.scale.y *= k; n.eyeR.scale.y *= k; };
  const blink = () => { if((t * 0.31) % 1 < 0.035) shut(0.15); };
  const amp = o.amp == null ? 1 : Math.min(1, Math.max(0, o.amp)), ph = 2 * Math.PI * (o.phase == null ? t * 1.4 : o.phase);
  if(kind !== 'sleep') n.body.scale.y *= 1 + 0.025 * s(t * 2.4);
  if(kind === 'walk' || kind === 'carry'){
    const a = 0.55 * amp; legs(s(ph) * a, -s(ph) * a, -s(ph) * a, s(ph) * a);
    n.rig.position.y += Math.abs(s(ph)) * 0.014 * amp; n.head.rotation.x += s(2 * ph) * 0.05 * amp + (kind === 'carry' ? -0.15 : 0); wag(12, kind === 'carry' ? 0.6 : 0.35); blink();
  }else if(kind === 'sit'){
    /* on its haunches: the body pitched up about the back hips, which stay low; the front legs straight down, the back legs folded forward along the floor,
       the head level and looking up a little, the tail lying on the floor round the feet */
    const hz = n.legBL.position.z;
    n.rig.rotation.x = -0.6; n.rig.position.set(0, 0.075 - (0.2 * Math.cos(0.6) + hz * Math.sin(0.6)), hz - (-0.2 * Math.sin(0.6) + hz * Math.cos(0.6)) + 0.01);
    legs(0.6, 0.6, -0.72, -0.72); n.legBL.rotation.z = 0.12; n.legBR.rotation.z = -0.12;
    n.head.rotation.x = 0.42 + 0.04 * s(t * 1.3); n.tail.position.y -= 0.03; n.tail.rotation.set(0.6, -0.95, -1.5); n.tail.rotation.y += 0.12 * s(t * 1.7); blink();   /* laid on the floor and curled round the left side toward the front paws */
  }else if(kind === 'eat' || kind === 'drink'){
    n.rig.rotation.x = 0.12; legs(-0.15, -0.15, 0.1, 0.1); n.head.position.y -= 0.04; n.head.rotation.x += 0.75 + 0.07 * s(t * (kind === 'eat' ? 7 : 11)); wag(6, 0.3);
  }else if(kind === 'sniff'){
    /* digging at the presents: head over the pile, the front paws taking turns */
    n.rig.rotation.x = 0.1; n.head.position.z += 0.03; n.head.rotation.x += 0.45 + 0.05 * s(t * 8); legs(-0.3 - 0.4 * Math.max(0, s(t * 9)), -0.3 - 0.4 * Math.max(0, -s(t * 9)), 0.12, 0.12); wag(10, 0.45);
  }else if(kind === 'crouch'){
    /* gathering for a jump: the rear sinks onto the loaded back legs, the head comes up toward the target */
    n.rig.position.y = -0.05; n.rig.rotation.x = -0.14; legs(0.2, 0.2, -0.6, -0.6); n.head.rotation.x = -0.2; n.tail.rotation.x -= 0.2; wag(18, 0.1);
  }else if(kind === 'leap'){
    n.rig.rotation.x = 0.02; legs(-1.05, -0.95, 0.95, 0.85); n.head.rotation.x = -0.1; n.tail.rotation.x -= 0.45; n.earL.rotation.x -= 0.25; n.earR.rotation.x -= 0.25;
  }else if(kind === 'sleep'){
    /* lying down facing forward, chin on the front paws: the body low and round, the front legs stretched forward along the floor, the back legs tucked,
       the tail laid round the left side toward the front. One slow clear breath (about 4 s), and now and then an ear twitch or a flick of the tail. */
    const br = s(t * 1.5);
    n.rig.position.y = -0.135; legs(-1.5, -1.5, -1.25, -1.25); n.legFL.position.x *= 0.62; n.legFR.position.x *= 0.62; n.legFL.position.y -= 0.01; n.legFR.position.y -= 0.01;
    n.legBL.position.z *= 0.78; n.legBR.position.z *= 0.78; n.legBL.rotation.z = 0.15; n.legBR.rotation.z = -0.15;
    n.body.scale.z *= 0.9; n.body.scale.x *= 1.06 * (1 + 0.022 * br); n.body.scale.y *= 1 + 0.055 * br; n.body.position.y += 0.004 * br;
    n.head.position.y -= 0.055 - 0.005 * br; n.head.position.z += 0.03; n.head.rotation.set(0.14, 0.32, 0.1);   /* turned a little more toward the camera's side, so the face reads */
    const ea = twitch(t, 4.7, 1), eb = twitch(t + 1.9, 6.1, 7), tf = twitch(t + 0.7, 5.3, 3, 0.1);
    const out = ud.look && ud.look.ear === 'flop' ? -0.12 : 0.18;   /* pricked ears relax outward, floppy ones fall close to the head */
    n.earL.rotation.z += out - 0.35 * ea; n.earR.rotation.z -= out - 0.35 * eb; n.earL.rotation.x -= 0.3 * ea; n.earR.rotation.x -= 0.3 * eb;
    /* the tail lies on the floor along the left flank and curls toward the front paws (Rz lays it down sideways, Ry swings it forward) */
    n.tail.position.y -= 0.1; n.tail.position.x += 0.03; n.tail.scale.y *= 0.85; n.tail.rotation.set(0, -0.95 + 0.25 * tf, -1.62);
    shut(0.06);
  }else if(kind === 'play' && pl){
    /* the ready stance every move starts from: front low, rear up, eyes on the toy (the head follows it), tail up and busy */
    n.rig.position.z = pl.bz; n.rig.rotation.x = 0.1; n.rig.position.y = -0.015; legs(-0.3, -0.3, 0.2, 0.2);
    n.head.rotation.x = 0.36; n.head.rotation.y = Math.max(-0.6, Math.min(0.6, Math.atan2(pl.tx, Math.max(0.05, pl.tz - pl.bz)) * 0.9)); wag(14, 0.5);
    const U = pl.u, side = pl.side || 1;
    if(pl.k === 'crouch'){
      const d = easeIO(U / 0.3), w = d * (0.4 + 0.6 * easeIO((U - 0.3) / 0.5));
      n.rig.position.y -= 0.045 * d; n.rig.rotation.x += 0.12 * d; legs(-0.3 - 0.35 * d, -0.3 - 0.35 * d, 0.2 + 0.35 * d, 0.2 + 0.35 * d);
      n.rig.rotation.z = s(t * 17) * 0.07 * w; n.rig.position.x = s(t * 17) * 0.008 * w; n.tail.rotation.x -= 0.5 * d; n.tail.rotation.z = s(t * 9) * 0.35 * d; n.head.rotation.x += 0.08 * d;
    }else if(pl.k === 'pounce'){
      const f = easeIO((U - 0.12) / 0.6), air = s(Math.PI * Math.min(1, Math.max(0, (U - 0.12) / 0.6))), land = easeIO((U - 0.62) / 0.2) * (1 - easeIO((U - 0.85) / 0.15));
      const pre = 1 - easeIO(U / 0.15);
      n.rig.position.y += 0.085 * air - 0.045 * pre * (1 - f); n.rig.rotation.x += -0.3 * air + 0.22 * land + 0.12 * pre * (1 - f);
      legs(-0.3 - 0.75 * air - 0.3 * land, -0.3 - 0.75 * air - 0.3 * land, 0.2 + 0.6 * air, 0.2 + 0.6 * air); n.head.rotation.x += 0.25 * land - 0.15 * air; n.tail.rotation.x -= 0.4 * air;
    }else if(pl.k === 'bat'){
      const a = Math.min(1, U / 0.85), lift = s(Math.PI * a), lean = s(Math.PI * Math.min(1, U));
      const paw = side > 0 ? n.legFL : n.legFR; paw.rotation.x = -0.3 - 1.05 * lift; paw.rotation.z = side * 0.42 * s(2 * Math.PI * a) * (a < 1 ? 1 : 0);
      n.rig.position.z += 0.05 * lean; n.rig.rotation.x += 0.1 * lean; n.rig.rotation.z = -side * 0.06 * lift; n.head.rotation.z = side * 0.12 * lift;
    }else if(pl.k === 'look'){
      const e = easeIO(U / 0.22) * easeIO((1 - U) / 0.22);
      n.head.rotation.z = side * 0.3 * e; n.head.rotation.x -= 0.1 * e; n.earL.rotation.x -= 0.18 * e; n.earR.rotation.x -= 0.18 * e; n.rig.rotation.x -= 0.06 * e; wag(5, 0.35);
    }else if(pl.k === 'back'){
      const hop = s(Math.PI * U); n.rig.position.y += 0.045 * hop; legs(-0.3 + 0.35 * hop, -0.3 + 0.35 * hop, 0.2 - 0.3 * hop, 0.2 - 0.3 * hop); n.rig.rotation.x -= 0.1 * hop;
    }
    blink();
  }else{ wag(4, 0.2); blink(); }
  /* the blend: mix from the last pose on screen into this one when the pose (or the play move) changed */
  const keys = ud.keys, S = ud.shown, F = ud.from, key = kind + (pl ? ':' + pl.k : ''), dur = o.blend == null ? (pl && ud.bkey && ud.bkey.startsWith('play:') ? 0.16 : PET_BLEND) : o.blend;
  if(ud.bkey !== key){ if(ud.bkey != null && dur > 0){ F.set(S); ud.bt0 = t; ud.bdur = dur; ud.bon = true; } else ud.bon = false; ud.bkey = key; }
  const e = ud.bon ? ((t - ud.bt0) / ud.bdur) : 1;
  if(ud.bon && !(e >= 0 && e < 1)) ud.bon = false;
  const k = ud.bon ? easeIO(e) : 1;
  keys.forEach((nm, i) => { const q = n[nm], j = i * 9, P = q.position, Rr = q.rotation, Sc = q.scale;
    if(k < 1){ P.x = F[j] + (P.x - F[j]) * k; P.y = F[j + 1] + (P.y - F[j + 1]) * k; P.z = F[j + 2] + (P.z - F[j + 2]) * k;
      Rr.x = F[j + 3] + (Rr.x - F[j + 3]) * k; Rr.y = F[j + 4] + (Rr.y - F[j + 4]) * k; Rr.z = F[j + 5] + (Rr.z - F[j + 5]) * k;
      Sc.x = F[j + 6] + (Sc.x - F[j + 6]) * k; Sc.y = F[j + 7] + (Sc.y - F[j + 7]) * k; Sc.z = F[j + 8] + (Sc.z - F[j + 8]) * k; }
    S[j] = P.x; S[j + 1] = P.y; S[j + 2] = P.z; S[j + 3] = Rr.x; S[j + 4] = Rr.y; S[j + 5] = Rr.z; S[j + 6] = Sc.x; S[j + 7] = Sc.y; S[j + 8] = Sc.z; });
  /* eyes squeezed below 40 % of their height show the closed-eye arc instead */
  for(const [a, b] of [['eyeL', 'lidL'], ['eyeR', 'lidR']]){ const c = n[a].scale.y < R[a].s.y * 0.4; n[a].visible = !c; n[b].visible = c; }
}

/* a food and a water bowl on a small mat; userData.food and .water are the bowl centres in the group's space. 5 meshes */
export function makeBowls(T){
  const K = kit(), g = new T.Group(); g.name = 'petBowls';
  const mat = (c, side) => K.mat(new T.MeshStandardMaterial({ color: c, roughness: 0.7, side: side ? T.DoubleSide : T.FrontSide }));
  const add = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  add(K.geo(new T.BoxGeometry(0.46, 0.012, 0.26)), mat('#f2c6c2'), 0, 0.006, 0).castShadow = false;
  const bowl = K.geo(new T.LatheGeometry([[0, 0.002], [0.06, 0.002], [0.078, 0.05], [0.07, 0.052], [0.054, 0.012], [0, 0.012]].map(([x, y]) => new T.Vector2(x, y)), 24));
  const fill = K.geo(new T.CylinderGeometry(0.062, 0.054, 0.023, 20));
  for(const [x, c, fc] of [[-0.11, '#8ec5fb', '#bfe3fb'], [0.11, '#f9a8d4', '#b07a4c']]){ add(bowl, mat(c, true), x, 0.012, 0); add(fill, mat(fc), x, 0.012 + 0.0235, 0); }
  g.userData = { water: new T.Vector3(-0.11, 0, 0), food: new T.Vector3(0.11, 0, 0), dispose: K.dispose };
  return g;
}

/* toys stand on y = 0: 'ball', 'bone', 'yarn', 'mouse' */
export const PET_TOYS = ['ball', 'bone', 'yarn', 'mouse'];
export function makeToy(T, kind = 'ball'){
  const K = kit(), g = new T.Group(); g.name = 'petToy';
  const std = c => K.mat(new T.MeshStandardMaterial({ color: c, roughness: 0.75 })), sph = K.geo(new T.SphereGeometry(1, 16, 12));
  const add = (geo, m, x, y, z, sx, sy = sx, sz = sx) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = false; o.receiveShadow = true; g.add(o); return o; };   /* a toy moves, so it casts no shadow-map shadow (the scene gives it a contact disc) */
  const striped = (a, b, dir, freq) => K.mat(coatMat(T, { c0: a, c1: b, mode: 2, dir, th: 0, freq }, 0.7, kind));
  if(kind === 'bone'){ const m = std('#fdf2e0'); add(K.geo(new T.CapsuleGeometry(1, 1, 4, 10)), m, 0, 0.024, 0, 0.02, 0.04, 0.02).rotation.z = Math.PI / 2; for(const x of [-0.07, 0.07]) for(const z of [-0.018, 0.018]) add(sph, m, x, 0.026, z, 0.026); }
  else if(kind === 'yarn'){ add(sph, striped('#c4b5fd', '#a78bfa', [1, 1, 0.3], 26), 0, 0.045, 0, 0.045); add(K.geo(new T.CapsuleGeometry(1, 1, 4, 8)), std('#c4b5fd'), 0.07, 0.006, 0.02, 0.006, 0.02, 0.006).rotation.z = Math.PI / 2; }
  else if(kind === 'mouse'){ const m = std('#b8b2c4'); add(sph, m, 0, 0.03, 0, 0.032, 0.03, 0.055); for(const x of [-0.02, 0.02]) add(sph, std('#f4b8c4'), x, 0.058, 0.03, 0.016, 0.016, 0.006); add(K.geo(new T.CapsuleGeometry(1, 1, 4, 8)), m, 0, 0.012, -0.08, 0.005, 0.03, 0.005).rotation.x = Math.PI / 2; }
  else add(sph, striped('#fb7185', '#fde68a', [0, 1, 0], 9), 0, 0.045, 0, 0.045);
  g.userData = { kind, dispose: K.dispose };
  return g;
}
/* a small wicker basket with toys peeking out, where the presents pile stands when the year-end dressing is off */
export function makeToyBasket(T){
  const K = kit(), g = new T.Group(); g.name = 'petBasket';
  const b = new T.Mesh(K.geo(new T.LatheGeometry([[0, 0.004], [0.17, 0.004], [0.2, 0.15], [0.185, 0.155], [0.155, 0.02], [0, 0.02]].map(([x, y]) => new T.Vector2(x, y)), 28)),
    K.mat(coatMat(T, { c0: '#e3c39b', c1: '#c9a173', mode: 2, dir: [0, 1, 0], th: 0, freq: 40 }, 0.9, 'basket')));
  b.material.side = T.DoubleSide; b.castShadow = b.receiveShadow = true; g.add(b);
  const toys = [makeToy(T, 'ball'), makeToy(T, 'bone')]; toys[0].position.set(0.05, 0.1, 0.02); toys[1].position.set(-0.05, 0.12, -0.03); toys[1].rotation.set(0.3, 0.6, 0.5); toys.forEach(t => g.add(t));
  g.userData = { dispose: () => { toys.forEach(t => t.userData.dispose()); K.dispose(); } };
  return g;
}
/* a standing picture frame for the desk; src is a Texture (the frame takes ownership) or an image or data URL. The photo is cover-cropped. 3 meshes */
export function makePhotoFrame(T, src, onLoad){
  const K = kit(), g = new T.Group(); g.name = 'petFrame';
  const PW = 0.19, PH = 0.24, lean = new T.Group(); lean.rotation.x = -0.18; g.add(lean);
  const wood = K.mat(new T.MeshStandardMaterial({ color: '#f5e6d3', roughness: 0.6 }));
  const fr = new T.Mesh(K.geo(new T.BoxGeometry(PW + 0.05, PH + 0.05, 0.022)), wood); fr.position.y = (PH + 0.05) / 2; fr.castShadow = fr.receiveShadow = true; lean.add(fr);
  const tex = typeof src === 'string' ? new T.TextureLoader().load(src, t => { cover(t); if(onLoad) onLoad(); }) : src || null;
  const cover = t => { const img = t.image; if(!img || !img.width) return; const a = img.width / img.height, want = PW / PH;
    t.colorSpace = T.SRGBColorSpace; if(a > want){ t.repeat.set(want / a, 1); t.offset.set((1 - want / a) / 2, 0); }else{ t.repeat.set(1, a / want); t.offset.set(0, (1 - a / want) / 2); } t.needsUpdate = true; };
  if(tex){ tex.colorSpace = T.SRGBColorSpace; if(tex.image) cover(tex); }
  const pm = K.mat(new T.MeshStandardMaterial({ color: tex ? '#ffffff' : '#dbeafe', map: tex, roughness: 0.55 })); pm.userData.ownMap = !!tex;
  const ph = new T.Mesh(K.geo(new T.PlaneGeometry(PW, PH)), pm); ph.position.set(0, (PH + 0.05) / 2, 0.0115); lean.add(ph);
  const st = new T.Mesh(K.geo(new T.BoxGeometry(0.05, 0.2, 0.012)), wood); st.position.set(0, 0.1, -0.06); st.rotation.x = 0.45; st.castShadow = true; g.add(st);
  g.userData = { dispose: K.dispose };
  return g;
}
