/* Holiday dressing for the team office: a Christmas tree with presents, a string of lights, a wreath and a Santa hat.
 * Every maker takes the three instance T (the same three@0.160.0 build office-scene.js imports) so this file needs no import of its own,
 * and holidayOn() is a pure function that Node can load without three.
 * Each returned Group carries userData.dispose() (geometries, materials and instanced meshes) and, for the animated ones, userData.tick(t, night):
 * t is seconds, night is 0..1 (a boolean works too). */

const SEOUL_MS = 9 * 3600 * 1000;   /* Seoul is UTC+9 all year */

/* month 1..12 and day of the month on the wall clock in Seoul, or null when now is not a valid date */
export function seoulMonthDay(now){
  const t = now instanceof Date ? now.getTime() : Number(now);
  if(!Number.isFinite(t)) return null;
  const d = new Date(t + SEOUL_MS);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
/* Nov 1 through Dec 30, both ends included (it goes off at Dec 31 00:00 Seoul time) */
export function inHolidaySeason(month, day){
  return month === 11 || (month === 12 && day <= 30);
}
/* ?season=xmas forces the dressing on and ?season=off forces it off. Otherwise the Seoul calendar decides. */
export function holidayOn(now = new Date(), search){
  if(search === undefined) search = typeof location !== 'undefined' && location ? location.search : '';
  let q = null;
  try{ q = new URLSearchParams(search || '').get('season'); }catch(e){ q = null; }
  if(q === 'xmas') return true;
  if(q === 'off') return false;
  const md = seoulMonthDay(now);
  return !!md && inHolidaySeason(md.month, md.day);
}

/* ---------- helpers ---------- */
function rng(seed){   /* mulberry32: a fixed seed gives the same tree every time */
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/* collects what a maker creates so one call can free it */
function kit(T){
  const geos = new Set(), mats = new Set(), inst = [];
  const k = {
    geo: g => { geos.add(g); return g; },
    mat: m => { mats.add(m); return m; },
    std: (color, o = {}) => k.mat(new T.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o })),
    mesh: (g, m) => new T.Mesh(k.geo(g), m),
    /* an emissive material whose glow follows each instance's colour (instanceColor), so one InstancedMesh can twinkle bulb by bulb.
     * MeshStandardMaterial rather than MeshBasicMaterial: the post-processing AO pass hides toneMapped:false basic materials. */
    glow: (intensity) => {
      const m = k.std('#ffffff', { emissive: '#ffffff', emissiveIntensity: intensity, roughness: 0.35 });
      m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor;'); };
      m.customProgramCacheKey = () => 'sprag-holiday-glow';
      return m;
    },
    instanced: (g, m, n) => { const im = new T.InstancedMesh(k.geo(g), m, n); im.setColorAt(0, new T.Color('#ffffff')); inst.push(im); return im; },
    dispose: () => { inst.forEach(i => i.dispose()); geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); geos.clear(); mats.clear(); inst.length = 0; },
  };
  return k;
}
const nightOf = n => Math.max(0, Math.min(1, Number(n) || 0));

/* ---------- tree ---------- */
/* four stacked tiers, bottom first: base height, rim radius, tier height */
const TIERS = [{ y: 0.55, r: 1.1, h: 1.0 }, { y: 1.2, r: 0.9, h: 0.9 }, { y: 1.75, r: 0.68, h: 0.8 }, { y: 2.2, r: 0.46, h: 0.75 }];
const tierProfile = t => [[t.r * 0.82, 0], [t.r, 0.07 * t.h], [t.r * 0.62, 0.45 * t.h], [t.r * 0.32, 0.75 * t.h], [0.015, t.h]];
function tierRadius(t, yl){   /* radius of a tier's surface at height yl above its base */
  const P = tierProfile(t);
  for(let i = 0; i < P.length - 1; i++){
    const [r0, y0] = P[i], [r1, y1] = P[i + 1];
    if(yl >= y0 && yl <= y1) return r0 + (r1 - r0) * (yl - y0) / (y1 - y0);
  }
  return 0;
}
function surfaceRadius(y){   /* widest tier surface at world height y, or 0 above and below the foliage */
  let r = 0;
  TIERS.forEach(t => { if(y >= t.y && y <= t.y + t.h) r = Math.max(r, tierRadius(t, y - t.y)); });
  return r;
}
const GREENS = ['#2f7d4f', '#357f50', '#2b7449', '#3b8856'];
const ORN = ['#e8505b', '#f5c542', '#5aa9e6', '#fffaf0'];
const BULB = ['#ffe2a0', '#ff5a5f', '#5aa9ff', '#ffe2a0', '#5fd38d', '#ffb347', '#ff8fc4', '#b69cff'];

/* the present pile: ten boxes with ribbon crosses, spread over the front half around the origin */
function addPresents(T, K, g){
  const PRES = [
    [0.55, 0.42, 0.5, -0.85, 0.75, 0.3, '#f08a9b', '#fffaf0'], [0.4, 0.34, 0.4, -0.35, 1.05, -0.2, '#7fb7e6', '#f5c542'],
    [0.5, 0.3, 0.7, 0.55, 0.95, 0.15, '#f6d36b', '#e8505b'], [0.3, 0.3, 0.3, 1.05, 0.5, -0.4, '#9bd6a8', '#fffaf0'],
    [0.36, 0.5, 0.36, -1.15, 0.1, 0.5, '#c4a6ee', '#f5c542'], [0.28, 0.22, 0.28, 0.12, 1.35, 0.1, '#ff9d76', '#fffaf0'],
    [0.4, 0.36, 0.4, 0.95, 1.1, 0.5, '#f9a8d4', '#f5c542'], [0.3, 0.24, 0.5, -0.65, 1.45, -0.15, '#a8dba0', '#e8505b'],
    [0.26, 0.26, 0.26, 1.5, 0.15, 0.2, '#fcd34d', '#5aa9e6'], [0.42, 0.3, 0.34, -1.55, 0.7, -0.35, '#8ec5fb', '#fffaf0'],
  ];
  const ribMats = {};
  PRES.forEach(([w, h, d, x, z, ry, body, rib]) => {
    const p = new T.Group(), rm = ribMats[rib] || (ribMats[rib] = K.std(rib, { roughness: 0.5 }));
    const box = K.mesh(new T.BoxGeometry(w, h, d), K.std(body, { roughness: 0.7 })); box.position.y = h / 2; p.add(box);
    const r1 = K.mesh(new T.BoxGeometry(w + 0.012, h + 0.012, 0.07), rm); r1.position.y = h / 2; p.add(r1);
    const r2 = K.mesh(new T.BoxGeometry(0.07, h + 0.012, d + 0.012), rm); r2.position.y = h / 2; p.add(r2);
    for(const sgn of [-1, 1]){ const lp = K.mesh(new T.SphereGeometry(0.05, 8, 6), rm); lp.scale.set(1.3, 0.8, 0.8); lp.position.set(sgn * 0.045, h + 0.025, 0); lp.rotation.z = sgn * 0.5; p.add(lp); }
    p.position.set(x, 0, z); p.rotation.y = ry; p.traverse(o => { if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } }); g.add(p);
  });
}
/* A pile of presents on its own, for a corner of the room. The front is +z. */
export function makePresents(T){
  const K = kit(T), g = new T.Group();
  addPresents(T, K, g);
  g.userData.dispose = K.dispose;
  return g;
}

/* opt: orn and bulbs are the counts, bands the number of spiral ribbons, pot false stands the trunk straight on the ground,
 * star scales the star, presents false leaves the pile out, shadow false keeps the tree from casting shadows. The defaults make the small tree. */
export function makeTree(T, o = {}){
  const opt = { orn: 30, bulbs: 48, bands: 0, pot: true, presents: true, star: 1, shadow: true, ...o };
  const K = kit(T), rand = rng(1225), g = new T.Group();
  /* pot and trunk */
  let pot = null, rim = null;
  if(opt.pot){
    pot = K.mesh(new T.CylinderGeometry(0.5, 0.38, 0.5, 18), K.std('#d9534f', { roughness: 0.6 })); pot.position.y = 0.25; g.add(pot);
    rim = K.mesh(new T.CylinderGeometry(0.54, 0.54, 0.09, 18), K.std('#f5c542', { roughness: 0.35, metalness: 0.4 })); rim.position.y = 0.5; g.add(rim);
    const soil = K.mesh(new T.CylinderGeometry(0.46, 0.46, 0.03, 18), K.std('#6b4a35', { roughness: 1 })); soil.position.y = 0.53; g.add(soil);
  }
  const trunk = K.mesh(new T.CylinderGeometry(0.13, 0.17, opt.pot ? 0.8 : 1.3, 10), K.std('#8a5a3c', { roughness: 0.95 })); trunk.position.y = opt.pot ? 0.85 : 0.65; g.add(trunk);
  /* foliage: lathe tiers, faceted and rough so the light breaks up like a low-poly tree */
  TIERS.forEach((t, i) => {
    const prof = tierProfile(t).map(([r, y]) => new T.Vector2(r, y));
    const m = K.mesh(new T.LatheGeometry([new T.Vector2(0, 0), ...prof], 11), K.std(GREENS[i], { roughness: 1, flatShading: true }));
    m.position.y = t.y; m.rotation.y = i * 0.45; m.castShadow = opt.shadow; m.receiveShadow = true; g.add(m);
  });
  /* star on top */
  const sh = new T.Shape(), OUT = 0.23, INN = 0.105;
  for(let i = 0; i < 10; i++){ const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? INN : OUT; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  sh.closePath();
  const sg = new T.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }); sg.center();
  const starMat = K.std('#ffd35a', { roughness: 0.3, metalness: 0.5, emissive: '#ffb938', emissiveIntensity: 0.5 });
  const star = K.mesh(sg, starMat); star.position.y = 2.95 + 0.14 * opt.star; star.scale.setScalar(opt.star); star.castShadow = opt.shadow; g.add(star);
  /* ornaments: golden-angle spread over the tiers, weighted by tier size */
  const NO = opt.orn, orn = K.instanced(new T.SphereGeometry(0.075, 10, 8), K.std('#ffffff', { roughness: 0.22, metalness: 0.35 }), NO);
  const wsum = TIERS.reduce((s, t) => s + t.r * t.h, 0), M = new T.Matrix4(), C = new T.Color();
  for(let i = 0; i < NO; i++){
    let w = rand() * wsum, ti = 0; while(ti < TIERS.length - 1 && w > TIERS[ti].r * TIERS[ti].h){ w -= TIERS[ti].r * TIERS[ti].h; ti++; }
    const t = TIERS[ti], yl = t.h * (0.16 + 0.48 * rand()), a = i * 2.39996 + rand() * 0.5, r = tierRadius(t, yl) + 0.03;
    M.makeTranslation(Math.cos(a) * r, t.y + yl, Math.sin(a) * r); orn.setMatrixAt(i, M);
    orn.setColorAt(i, C.set(ORN[(i + (rand() < 0.2 ? 1 : 0)) % 4]));
  }
  orn.instanceMatrix.needsUpdate = true; orn.instanceColor.needsUpdate = true; g.add(orn);
  /* string lights spiralling up */
  const NL = opt.bulbs, bulbMat = K.glow(0.9), bulbs = K.instanced(new T.SphereGeometry(0.045, 8, 6), bulbMat, NL), lph = [], lsp = [], lcol = [];
  for(let i = 0; i < NL; i++){
    const s = i / (NL - 1), y = 0.8 + s * 2.0, a = s * Math.PI * 2 * Math.round(NL / 9.6), r = (surfaceRadius(y) || 0.1) + 0.05;
    M.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r); bulbs.setMatrixAt(i, M);
    lcol.push(new T.Color(BULB[i % BULB.length])); lph.push(rand() * 6.283); lsp.push(1.3 + (i % 7) * 0.22);
    bulbs.setColorAt(i, lcol[i]);
  }
  bulbs.instanceMatrix.needsUpdate = true; bulbs.instanceColor.needsUpdate = true; g.add(bulbs);
  if(opt.presents) addPresents(T, K, g);
  /* ribbons winding up the foliage: gold first, then red */
  for(let b = 0; b < opt.bands; b++){
    const pts = [];
    for(let i = 0; i <= 220; i++){ const s = i / 220, y = 0.72 + s * 2.1, a = s * Math.PI * 2 * 3.5 + b * Math.PI, r = (surfaceRadius(y) || 0.05) + 0.035; pts.push(new T.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
    const band = K.mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 440, 0.034, 5, false), K.std(b ? '#e8505b' : '#f5c542', b ? { roughness: 0.5 } : { roughness: 0.3, metalness: 0.5 })); band.castShadow = opt.shadow; g.add(band);
  }
  trunk.castShadow = opt.shadow; if(pot){ pot.castShadow = opt.shadow; rim.castShadow = opt.shadow; pot.receiveShadow = true; }

  const col = new T.Color();
  g.userData.tick = (t, night) => {
    const n = nightOf(night), glow = 1 + n * 0.25;
    for(let i = 0; i < NL; i++){
      const f = 0.5 + 0.5 * Math.sin(t * lsp[i] + lph[i]);
      bulbs.setColorAt(i, col.copy(lcol[i]).multiplyScalar((0.3 + 0.7 * f) * glow));
    }
    bulbs.instanceColor.needsUpdate = true;
    bulbMat.emissiveIntensity = 0.85 + 0.3 * n;   /* the bloom pass spreads bright bulbs, so the night boost stays small and a crowd of bulbs does not wash out to white */
    const pulse = Math.sin(t * 1.4);
    starMat.emissiveIntensity = (0.45 + 0.6 * n) * (1 + 0.2 * pulse);
    star.scale.setScalar(opt.star * (1 + 0.04 * pulse)); star.rotation.y = Math.PI / 4 + 0.12 * Math.sin(t * 0.6);   /* it faces the default camera (which looks from +x +z) and is thick enough to read from the sides */
  };
  g.userData.dispose = K.dispose;
  return g;
}

/* ---------- garland ---------- */
/* points: [[x,y,z],...] polyline along the top of a wall. Each leg is cut into festoons that sag by at most maxSag. */
export function makeGarland(T, points, maxSag = 0.28){
  const K = kit(T), g = new T.Group(), pts = (points || []).map(p => new T.Vector3(p[0], p[1], p[2]));
  g.userData.dispose = K.dispose; g.userData.tick = () => {};
  if(pts.length < 2) return g;
  const dense = [], M = 10;
  for(let s = 0; s < pts.length - 1; s++){
    const a = pts[s], b = pts[s + 1], L = a.distanceTo(b), n = Math.max(1, Math.round(L / 1.6)), sag = Math.min(maxSag, 0.1 + (L / n) * 0.07);
    for(let f = 0; f < n; f++) for(let j = s || f ? 1 : 0; j <= M; j++){
      const v = j / M, p = new T.Vector3().lerpVectors(a, b, (f + v) / n);
      p.y -= sag * 4 * v * (1 - v); dense.push(p);
    }
  }
  const curve = new T.CatmullRomCurve3(dense, false, 'centripetal');
  const wire = K.mesh(new T.TubeGeometry(curve, dense.length * 2, 0.017, 5, false), K.std('#3f7d52', { roughness: 0.8 })); g.add(wire);
  /* bulbs every ~0.35 along the sagging line, hanging a little below it */
  const cum = [0]; for(let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dense[i].distanceTo(dense[i - 1]));
  const total = cum[cum.length - 1], N = Math.max(1, Math.round(total / 0.35)), step = total / N;
  const mat = K.glow(0.9), bulbs = K.instanced(new T.SphereGeometry(0.055, 8, 6), mat, N), base = [];
  const M4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(1, 1.3, 1), pos = new T.Vector3();
  const COL = ['#ff5a5f', '#5fd38d', '#ffd24a', '#5aa9ff']; let seg = 0;
  for(let i = 0; i < N; i++){
    const d = (i + 0.5) * step; while(seg < dense.length - 2 && cum[seg + 1] < d) seg++;
    const u = (d - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
    pos.lerpVectors(dense[seg], dense[seg + 1], Math.min(1, Math.max(0, u))); pos.y -= 0.06;
    M4.compose(pos, q, sc); bulbs.setMatrixAt(i, M4);
    base.push(new T.Color(COL[i % 4])); bulbs.setColorAt(i, base[i]);
  }
  bulbs.instanceMatrix.needsUpdate = true; bulbs.instanceColor.needsUpdate = true; g.add(bulbs);
  const col = new T.Color();
  g.userData.tick = (t, night) => {
    const n = nightOf(night), glow = 1 + n * 0.6;
    for(let i = 0; i < N; i++){
      const w = 0.5 + 0.5 * Math.cos((i / 4 - t * 1.1) * Math.PI * 2);   /* a bright group of bulbs runs along the line */
      bulbs.setColorAt(i, col.copy(base[i]).multiplyScalar((0.28 + 0.72 * w * w * w) * glow));
    }
    bulbs.instanceColor.needsUpdate = true; mat.emissiveIntensity = 0.9 + 0.7 * n;
  };
  return g;
}

/* ---------- wreath ---------- */
/* about 0.9 across, face toward +z */
export function makeWreath(T){
  const K = kit(T), rand = rng(77), g = new T.Group();
  const ring = K.mesh(new T.TorusGeometry(0.33, 0.12, 8, 20), K.std('#2f7d4f', { roughness: 1, flatShading: true })); g.add(ring);
  const NL = 16, lumps = K.instanced(new T.SphereGeometry(0.085, 7, 5), K.std('#ffffff', { roughness: 1, flatShading: true }), NL), M = new T.Matrix4(), C = new T.Color();
  for(let i = 0; i < NL; i++){
    const a = i / NL * Math.PI * 2, r = 0.33 + (i % 2 ? 0.07 : -0.07), z = (i % 3 - 1) * 0.04;
    M.makeTranslation(Math.cos(a) * r, Math.sin(a) * r, z + 0.04); lumps.setMatrixAt(i, M); lumps.setColorAt(i, C.set(GREENS[i % 4]));
  }
  lumps.instanceMatrix.needsUpdate = true; lumps.instanceColor.needsUpdate = true; g.add(lumps);
  const berry = K.std('#e8505b', { roughness: 0.3 }), bg = K.geo(new T.SphereGeometry(0.04, 8, 6));
  for(let i = 0; i < 8; i++){
    const a = 0.5 + i / 8 * Math.PI * 2 + rand() * 0.3, r = 0.33 + (rand() - 0.5) * 0.12, b = new T.Mesh(bg, berry);
    b.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.115); g.add(b);
  }
  /* red bow at the bottom */
  const rb = K.std('#e8505b', { roughness: 0.5 }), loop = K.geo(new T.SphereGeometry(0.07, 10, 8)), tail = K.geo(new T.BoxGeometry(0.05, 0.2, 0.014));
  for(const s of [-1, 1]){
    const l = new T.Mesh(loop, rb); l.scale.set(1.5, 0.9, 0.55); l.position.set(s * 0.11, -0.32, 0.14); l.rotation.z = s * 0.45; g.add(l);
    const t = new T.Mesh(tail, rb); t.position.set(s * 0.06, -0.47, 0.13); t.rotation.z = s * 0.28; g.add(t);
  }
  const knot = new T.Mesh(K.geo(new T.SphereGeometry(0.05, 10, 8)), rb); knot.position.set(0, -0.32, 0.16); g.add(knot);
  g.traverse(o => { if(o.isMesh) o.castShadow = true; });
  g.userData.dispose = K.dispose;
  return g;
}

/* ---------- Santa hat ---------- */
/* In cast model units, like castCrown() in office-scene.js: add it to the model and it sits on the head at (0, 1.04, -0.02).
 * The rim is wider than the crown band (0.13) so it covers a head of any species. */
export function santaHat(T){
  const K = kit(T), g = new T.Group(), red = K.std('#e8505b', { roughness: 0.75 }), fur = K.std('#fffaf0', { roughness: 1 });
  const rim = K.mesh(new T.TorusGeometry(0.19, 0.05, 8, 20), fur); rim.rotation.x = Math.PI / 2; rim.position.y = 0.025; g.add(rim);
  /* three cone sections, each bent a little further than the last, so the tip flops to the side */
  const SEG = [{ rb: 0.175, rt: 0.135, h: 0.13 }, { rb: 0.135, rt: 0.09, h: 0.13 }, { rb: 0.09, rt: 0.012, h: 0.14 }];
  let parent = g, y = 0.04;
  SEG.forEach((s, i) => {
    const j = new T.Group(); j.position.y = y; j.rotation.z = i ? -0.42 : -0.12; parent.add(j);
    const m = K.mesh(new T.CylinderGeometry(s.rt, s.rb, s.h, 14), red); m.position.y = s.h / 2; j.add(m);
    parent = j; y = s.h;
  });
  const ball = K.mesh(new T.SphereGeometry(0.048, 10, 8), fur); ball.position.y = SEG[2].h + 0.01; parent.add(ball);
  g.position.set(0, 1.03, -0.02); g.rotation.x = -0.12;
  g.userData.dispose = K.dispose;
  return g;
}

/* ---------- Rudolph set ---------- */
/* A headband with two brown antlers, in the same model space as castCrown() and santaHat(). Branches are tube curves with round tips. */
export function reindeerAntlers(T){
  const K = kit(T), g = new T.Group(), brown = K.std('#8a5a3c', { roughness: 0.85 }), band = K.std('#d9534f', { roughness: 0.6 });
  /* the band arcs over the top of the head from ear to ear, a little tilted back */
  const arc = K.mesh(new T.TorusGeometry(0.345, 0.02, 8, 24, Math.PI * 0.78), band); arc.rotation.z = Math.PI * 0.11; g.add(arc);
  const stem = (pts, r) => { const m = K.mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p => new T.Vector3(...p))), 10, r, 7, false), brown); g.add(m);
    const e = pts[pts.length - 1], c = K.mesh(new T.SphereGeometry(r * 1.15, 8, 6), brown); c.position.set(...e); g.add(c); };
  for(const s of [-1, 1]){
    const root = [s * 0.19, 0.285, 0];   /* where the antler leaves the band */
    const at = (x, y, z = 0) => [root[0] + s * x, root[1] + y, root[2] + z];
    stem([at(0, -0.02), at(0.03, 0.08), at(0.07, 0.17), at(0.06, 0.26)], 0.021);
    stem([at(0.035, 0.1), at(0.09, 0.15), at(0.14, 0.2)], 0.016);
    stem([at(0.065, 0.2), at(0.0, 0.25), at(-0.03, 0.31)], 0.014);
    const bell = K.mesh(new T.SphereGeometry(0.026, 10, 8), K.std('#f5c542', { roughness: 0.3, metalness: 0.5 })); bell.position.set(s * 0.335, 0.075, 0.05); g.add(bell);
  }
  /* a holly leaf with a berry at the front of the band */
  const leafM = K.std('#2f7d4f', { roughness: 0.8 }), leafG = K.geo(new T.SphereGeometry(0.04, 8, 6));
  for(const s of [-1, 1]){ const l = new T.Mesh(leafG, leafM); l.scale.set(1.6, 0.35, 0.8); l.position.set(s * 0.045, 0.365, 0.07); l.rotation.set(0.35, 0, s * 0.45); g.add(l); }
  const berry = K.mesh(new T.SphereGeometry(0.022, 8, 6), K.std('#e8505b', { roughness: 0.3 })); berry.position.set(0, 0.37, 0.085); g.add(berry);
  g.position.set(0, 0.69, -0.02); g.rotation.x = -0.1;
  g.userData.dispose = K.dispose;
  return g;
}

/* The nose tip of a loaded cast model in the model's own space (front is +z), or null for species without a nose material.
 * The tip is the middle of the nose mesh sideways and up, and its front edge. Beaks count as noses too. */
const NOSE_MAT = /^(nose|nos|nose_disc|beak)$/;
export function noseTipOf(T, root){
  root.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(root.matrixWorld).invert(), box = new T.Box3(), m4 = new T.Matrix4();
  let found = false;
  root.traverse(o => {
    if(!o.isMesh || !o.material || !NOSE_MAT.test(o.material.name || '')) return;
    if(!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld))); found = true;
  });
  return found ? { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: box.max.z } : null;
}
/* A glossy red ball on the nose tip. It pulses slowly and glows at night through the same emissive path as the lights. */
export function rudolphNose(T, tip){
  const K = kit(T), mat = K.std('#ff3b3b', { roughness: 0.18, emissive: '#ff2a2a', emissiveIntensity: 0.5 });
  const g = new T.Group(), ball = K.mesh(new T.SphereGeometry(0.05, 14, 10), mat); g.add(ball);
  g.position.set(tip.x, tip.y, tip.z - 0.004);
  const ph = (tip.x * 7.3 + tip.y * 3.1 + tip.z * 5.7) % 6.283;
  g.userData.tick = (t, night) => { const n = nightOf(night); mat.emissiveIntensity = (0.35 + 1.1 * n) * (1 + 0.3 * Math.sin(t * 1.8 + ph)); };
  g.userData.dispose = K.dispose;
  return g;
}

/* ---------- ginkgo ---------- */
/* A huge old ginkgo in the style of the 800-year-old Banggye-ri tree: a short, very thick trunk that splits low into a few big limbs, and a wide, low, round dome
 * of golden blobs. About 16 across and 12 tall, origin at the middle of the trunk's foot. Warm-white and gold twinkle lights and a few small baubles dress the crown.
 * opt.carpet and opt.fall are lists of { x0, x1, z0, z1, y, n }: rectangles in the tree's own space (y is the ground height there). Leaves lie on the ground in
 * carpet and drift down in fall. tick(t, night) moves the falling ones from t alone, so a frozen t (reduced motion) freezes them. */
const GINKGO = ['#f5cf3a', '#eebb24', '#f8dc63', '#e5a91c'];
export function makeGinkgo(T, o = {}){
  const opt = { lights: 200, baubles: 12, carpet: [], fall: [], carpetR: 8.5, ...o };
  const K = kit(T), rand = rng(800), g = new T.Group(), M = new T.Matrix4(), C = new T.Color(), Q = new T.Quaternion(), E = new T.Euler(), P = new T.Vector3(), S = new T.Vector3();
  const bark = K.std('#6f5a48', { roughness: 1, flatShading: true }), bark2 = K.std('#7a644f', { roughness: 1, flatShading: true });
  /* trunk: a fat lathe with a flared foot, a knuckle where the limbs leave it, and roots creeping over the ground */
  const prof = [[0, 0], [1.3, 0], [1.05, 0.45], [0.88, 1.3], [0.82, 2.6], [0.95, 3.5], [0.7, 4.0], [0, 4.0]].map(([r, y]) => new T.Vector2(r, y));
  g.add(K.mesh(new T.LatheGeometry(prof, 9), bark));
  for(let i = 0; i < 6; i++){
    const a = i * Math.PI / 3 + 0.3, ca = Math.cos(a), sa = Math.sin(a), L = 2.4 - 1.2 * Math.max(0, sa);   /* roots toward +z are shorter: that side faces the room wall */
    const root = K.mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(ca * 0.7, 0.5, sa * 0.7), new T.Vector3(ca * L * 0.65, 0.18, sa * L * 0.65), new T.Vector3(ca * L, 0.05, sa * L)]), 8, 0.3, 6, false), bark2); g.add(root);
  }
  /* five thick limbs fanning up and out into the crown */
  const CY = 6.7, A = 6.2, BU = 3.0, BD = 2.2;   /* crown centre height and the radii of the blob shell: sideways, up, down (a wide low dome, about 16 across and 12 tall) */
  for(let i = 0; i < 5; i++){
    const a = i * Math.PI * 2 / 5 + 0.5, ca = Math.cos(a), sa = Math.sin(a);
    const limb = K.mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(ca * 0.3, 3.4, sa * 0.3), new T.Vector3(ca * 1.4, 4.3, sa * 1.4), new T.Vector3(ca * 3.0, 5.4, sa * 3.0), new T.Vector3(ca * 4.0, 6.8, sa * 4.0)]), 14, 0.52, 7, false), bark2); g.add(limb);
  }
  /* crown: a few big smooth puffs, many middle ones, and lots of small ones scattered along the rim so the outline is ragged like a cloud */
  const blobs = [];
  const put = (n, rLo, rHi, fLo, fHi) => { for(let i = 0; i < n; i++){
    const u = rand() * 2 - 1, ph = rand() * Math.PI * 2, rr = Math.sqrt(1 - u * u), f = fLo + rand() * (fHi - fLo);
    blobs.push({ x: rr * Math.cos(ph) * A * f, y: (u > 0 ? u * BU : u * BD) * f, z: rr * Math.sin(ph) * A * f, r: rLo + rand() * (rHi - rLo) });
  } };
  put(12, 2.1, 2.9, 0.1, 0.4);    /* fill the middle so no hole shows */
  put(14, 1.8, 2.6, 0.5, 0.8);    /* the big puffs */
  put(70, 1.0, 1.7, 0.75, 0.98);  /* middle ones on the shell */
  put(150, 0.45, 0.95, 0.85, 1.12);   /* small ones along the edge */
  const NB = blobs.length, crown = K.instanced(new T.SphereGeometry(1, 14, 10), K.std('#ffffff', { roughness: 0.95, flatShading: false, emissive: '#b08400', emissiveIntensity: 0.14 }), NB);   /* a little warm self light keeps the shaded side yellow and not brown */
  blobs.forEach((b, i) => {
    E.set(rand() * 6, rand() * 6, rand() * 6); Q.setFromEuler(E); P.set(b.x, CY + b.y, b.z); S.set(b.r, b.r * (0.8 + rand() * 0.2), b.r);
    crown.setMatrixAt(i, M.compose(P, Q, S));
    const k = Math.max(0, Math.min(1, (b.y + BD + 1) / (BU + BD + 2)));   /* 0 at the bottom, 1 at the top */
    /* mostly yellow; the golden shades only where the crown is in its own shade */
    const pick = k < 0.4 ? (rand() < 0.6 ? '#eebb24' : '#e5a91c') : rand() < 0.5 ? '#f5cf3a' : rand() < 0.75 ? '#f8dc63' : '#eebb24';
    crown.setColorAt(i, C.set(pick).multiplyScalar(0.84 + 0.16 * k));
  });
  crown.instanceMatrix.needsUpdate = true; crown.instanceColor.needsUpdate = true; g.add(crown);
  /* the outer surface of the blob union along a direction from the crown centre, so lights and baubles sit on the crown and not in it */
  const surf = (dx, dy, dz) => {
    let t = 0;
    for(const b of blobs){ const cd = b.x * dx + b.y * dy + b.z * dz, d2 = cd * cd - (b.x * b.x + b.y * b.y + b.z * b.z) + b.r ** 2; if(d2 > 0) t = Math.max(t, cd + Math.sqrt(d2)); }
    return t;
  };
  /* twinkle lights, spread evenly with a Fibonacci sphere, skipping the deep underside */
  const NL = opt.lights, bulbMat = K.glow(0.85), bulbs = K.instanced(new T.SphereGeometry(0.12, 8, 6), bulbMat, NL), lcol = [], lph = [], lsp = [], WARM = ['#fff0c4', '#ffd45a', '#fff0c4', '#ffe28a'];
  let li = 0;
  for(let k = 0; li < NL && k < NL * 3; k++){
    const u = 1 - 2 * (k + 0.5) / (NL * 1.5), rr = Math.sqrt(1 - u * u), a = k * 2.39996;
    if(u < -0.35) continue;
    const dx = rr * Math.cos(a), dz = rr * Math.sin(a), t = surf(dx, u, dz) + 0.02;
    M.makeTranslation(dx * t, CY + u * t, dz * t); bulbs.setMatrixAt(li, M);
    lcol.push(new T.Color(WARM[li % 4])); lph.push(rand() * 6.283); lsp.push(1.2 + (li % 7) * 0.25); bulbs.setColorAt(li, lcol[li]); li++;
  }
  bulbs.count = li; bulbs.instanceMatrix.needsUpdate = true; bulbs.instanceColor.needsUpdate = true; g.add(bulbs);
  /* a few small baubles, gold and white with some red, mostly buried in the crown: hardly visible by day, glints at night */
  const NR = opt.baubles, bau = K.instanced(new T.SphereGeometry(0.12, 10, 8), K.std('#ffffff', { roughness: 0.25, metalness: 0.3 }), NR);
  for(let i = 0; i < NR; i++){
    const u = 0.05 + rand() * 0.9, rr = Math.sqrt(1 - u * u), a = rand() * Math.PI * 2, dx = rr * Math.cos(a), dz = rr * Math.sin(a), t = surf(dx, u, dz) + 0.02;
    M.makeTranslation(dx * t, CY + u * t, dz * t); bau.setMatrixAt(i, M); bau.setColorAt(i, C.set(['#f5c542', '#fffaf0', '#e8505b', '#f5c542', '#fffaf0'][i % 5]));
  }
  bau.instanceMatrix.needsUpdate = true; bau.instanceColor.needsUpdate = true; g.add(bau);
  /* ginkgo leaves: a small fan with a notch in the middle of its edge, seen from both sides */
  const lf = new T.Shape(); lf.moveTo(0, 0);
  for(let i = 0; i <= 26; i++){ const a = Math.PI * (0.17 + 0.66 * i / 26), r = 1 - 0.22 * Math.exp(-(((a - Math.PI / 2) / 0.1) ** 2)); lf.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  lf.closePath();
  const leafG = K.geo(new T.ShapeGeometry(lf)), leafM = K.std('#ffffff', { roughness: 0.9, side: T.DoubleSide });
  const LEAF = ['#f5cf3a', '#eebb24', '#f8dc63', '#f2c230'];
  /* fall leaves: anywhere in a rectangle. carpet leaves: thickest right under the middle of the crown and thinning toward the edge (radius carpetR), kept inside the rectangles */
  const spots = list => list.flatMap(a => Array.from({ length: a.n }, () => ({ x: a.x0 + (a.x1 - a.x0) * rand(), z: a.z0 + (a.z1 - a.z0) * rand(), y: a.y, k: rand() })));
  const dense = list => list.flatMap(a => { const out = []; for(let tries = 0; out.length < a.n && tries < a.n * 60; tries++){
    const rho = opt.carpetR * Math.pow(rand(), 1.4), th = rand() * 6.283, x = Math.cos(th) * rho, z = Math.sin(th) * rho;
    if(x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) out.push({ x, z, y: a.y, k: rand() }); } return out; });
  const flat = dense(opt.carpet), carpet = flat.length ? K.instanced(leafG, leafM, flat.length) : null;
  if(carpet){
    flat.forEach((l, i) => { const sc = 0.18 + rand() * 0.12; E.set(-Math.PI / 2 + (rand() - 0.5) * 0.15, rand() * 6.283, 0, 'YXZ'); Q.setFromEuler(E);
      carpet.setMatrixAt(i, M.compose(P.set(l.x, l.y + i * 0.0003, l.z), Q, S.set(sc, sc, sc))); carpet.setColorAt(i, C.set(LEAF[i % 4]).multiplyScalar(0.92 + rand() * 0.1)); });
    carpet.instanceMatrix.needsUpdate = true; carpet.instanceColor.needsUpdate = true; carpet.receiveShadow = false; g.add(carpet);
  }
  const fl = spots(opt.fall), fall = fl.length ? K.instanced(leafG, leafM, fl.length) : null;
  if(fall){ fl.forEach((l, i) => { l.ph = rand(); l.v = 0.35 + rand() * 0.35; l.sc = 0.2 + rand() * 0.1; fall.setColorAt(i, C.set(LEAF[i % 4])); }); fall.instanceColor.needsUpdate = true; g.add(fall); }
  const col = new T.Color(), TOP = 7.5;
  g.userData.tick = (t, night) => {
    const n = nightOf(night), glow = 1 + n * 0.25;
    for(let i = 0; i < li; i++){ const f = 0.5 + 0.5 * Math.sin(t * lsp[i] + lph[i]); bulbs.setColorAt(i, col.copy(lcol[i]).multiplyScalar((0.35 + 0.65 * f) * glow)); }
    bulbs.instanceColor.needsUpdate = true; bulbMat.emissiveIntensity = 0.85 + 0.3 * n;   /* small night boost: the bloom pass spreads bright bulbs */
    if(!fall) return;
    for(let i = 0; i < fl.length; i++){
      const l = fl[i], H = TOP - l.y, d = (t * l.v + l.ph * H) % H, y = TOP - d, q = l.ph * 6.283;
      E.set(0.9 * Math.sin(t * 1.3 + q * 3), q + t * 0.5, 0.6 * Math.sin(t * 0.9 + q), 'YXZ'); Q.setFromEuler(E);
      fall.setMatrixAt(i, M.compose(P.set(l.x + 0.7 * Math.sin(t * 0.8 + q), Math.max(l.y, y), l.z + 0.2 * Math.sin(t * 0.6 + q * 2)), Q, S.set(l.sc, l.sc, l.sc)));
    }
    fall.instanceMatrix.needsUpdate = true;
  };
  g.userData.dispose = K.dispose;
  return g;
}
