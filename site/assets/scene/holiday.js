/* Holiday dressing for the team office: a Christmas tree with presents, a string of lights, a wreath and a Santa hat.
 * Every maker takes the three instance T (the same three@0.160.0 build office-scene.js imports) so this file imports only fur.js (the soft light),
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
/* A huge old ginkgo in the style of the 800-year-old Banggye-ri tree: a short, very thick trunk that splits low into a few big limbs, and a wide, low dome
 * of real ginkgo leaves. About 16 across and 12 tall, origin at the middle of the trunk's foot. The crown is one InstancedMesh of fan leaves laid on the skin of
 * about 60 overlapping leaf clumps (each clump is 2 or 3 flattened lobes), so the outline is a ragged pile of clumps and not one round ball. A few gaps show thinner
 * branches inside. Warm-white and gold twinkle lights and a few small baubles sit on the clumps.
 * opt.carpet and opt.fall are lists of { x0, x1, z0, z1, y, n }: rectangles in the tree's own space (y is the ground height there). Leaves lie on the ground in
 * carpet and drift down in fall. tick(t, night) moves the falling ones from t alone, so a frozen t (reduced motion) freezes them. */
export function makeGinkgo(T, o = {}){
  const opt = { lights: 200, baubles: 12, carpet: [], fall: [], carpetR: 8.5, leaves: 7000, clumps: 58, ...o };
  const K = kit(T), rand = rng(800), cr = rng(1291), g = new T.Group(), M = new T.Matrix4(), C = new T.Color(), Q = new T.Quaternion(), Q2 = new T.Quaternion(), E = new T.Euler(), P = new T.Vector3(), S = new T.Vector3(), V = new T.Vector3(), ZAX = new T.Vector3(0, 0, 1);
  const bark = K.std('#6f5a48', { roughness: 1, flatShading: true }), bark2 = K.std('#7a644f', { roughness: 1, flatShading: true });
  /* trunk: a fat lathe with a flared foot, a knuckle where the limbs leave it, and roots creeping over the ground */
  const prof = [[0, 0], [1.3, 0], [1.05, 0.45], [0.88, 1.3], [0.82, 2.6], [0.95, 3.5], [0.7, 4.0], [0, 4.0]].map(([r, y]) => new T.Vector2(r, y));
  g.add(K.mesh(new T.LatheGeometry(prof, 9), bark));
  for(let i = 0; i < 6; i++){
    const a = i * Math.PI / 3 + 0.3, ca = Math.cos(a), sa = Math.sin(a), L = 2.4 - 1.2 * Math.max(0, sa);   /* roots toward +z are shorter: that side faces the room wall */
    const root = K.mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(ca * 0.7, 0.5, sa * 0.7), new T.Vector3(ca * L * 0.65, 0.18, sa * L * 0.65), new T.Vector3(ca * L, 0.05, sa * L)]), 8, 0.3, 6, false), bark2); g.add(root);
  }
  const CY = 6.7, A = 6.2, BU = 3.0, BD = 2.2;   /* crown centre height and the radii of the clump shell: sideways, up, down (a wide low dome, about 16 across and 12 tall) */
  /* the radius of the shell along a unit direction from the crown centre */
  const shellR = (dx, dy, dz) => 1 / Math.sqrt((dx * dx + dz * dz) / (A * A) + dy * dy / ((dy > 0 ? BU : BD) ** 2));
  /* five thick limbs fanning up and out into the crown. The limb that points at the back wall (+z) stops short so it never pokes out sideways. */
  const limbs = [];
  for(let i = 0; i < 5; i++){
    const a = i * Math.PI * 2 / 5 + 0.5, ca = Math.cos(a), sa = Math.sin(a), kz = 1 - 0.38 * Math.max(0, sa);
    const curve = new T.CatmullRomCurve3([new T.Vector3(ca * 0.3, 3.4, sa * 0.3), new T.Vector3(ca * 1.3 * kz, 4.4, sa * 1.3 * kz), new T.Vector3(ca * 2.6 * kz, 5.7, sa * 2.6 * kz), new T.Vector3(ca * 3.3 * kz, 7.2, sa * 3.3 * kz)]);
    limbs.push(curve); g.add(K.mesh(new T.TubeGeometry(curve, 14, 0.52, 7, false), bark2));
  }
  /* gaps: a few directions with no leaves, and a thinner branch from a limb reaching toward each one */
  const holes = [];
  for(let i = 0; i < 7; i++){
    const a = i * 2.39996 + 0.4, u = 0.05 + 0.55 * ((i * 0.618) % 1), rr = Math.sqrt(1 - u * u);
    holes.push({ x: rr * Math.cos(a), y: u, z: rr * Math.sin(a), c: Math.cos(0.13 + 0.04 * (i % 3)) });
  }
  holes.forEach((h, i) => {
    const R = shellR(h.x, h.y, h.z) * 0.86, p0 = limbs[i % 5].getPoint(0.62 + 0.3 * ((i * 0.37) % 1)), end = new T.Vector3(h.x * R, CY + h.y * R, h.z * R), mid = p0.clone().lerp(end, 0.5); mid.y += 0.5;
    g.add(K.mesh(new T.TubeGeometry(new T.CatmullRomCurve3([p0, mid, end]), 10, 0.12, 5, false), bark2));
  });
  /* clumps: part of them in the middle, the rest scattered over a lumpy dome shell. The rim sags and bulges so the lowest ones hang like skirts in two or three layers. */
  const lobes = [], clumpTint = [];
  const addClump = (x, y, z, rc, ci) => {
    const nl = 2 + (cr() < 0.55 ? 1 : 0);
    for(let j = 0; j < nl; j++){
      const k = j === 0 ? 1 : 0.55 + cr() * 0.25, ang = cr() * 6.283, off = j === 0 ? 0 : rc * (0.55 + cr() * 0.35);
      const l = { x: x + Math.cos(ang) * off, y: y + (cr() - 0.5) * rc * 0.5, z: z + Math.sin(ang) * off, rx: rc * k * (1.05 + cr() * 0.3), ry: rc * k * (0.65 + cr() * 0.2), rz: rc * k * (1.05 + cr() * 0.3), c: ci };
      l.y = Math.max(l.y, 3.55 - CY + l.ry);   /* nothing hangs lower than the animals' heads */
      lobes.push(l);
    }
  };
  const NCL = opt.clumps, NIN = Math.round(NCL * 0.17);
  for(let i = 0; i < NCL; i++){
    clumpTint.push(0.9 + cr() * 0.14);
    if(i < NIN){ const a = cr() * 6.283, rr = 0.1 + cr() * 0.45; addClump(Math.cos(a) * A * 0.84 * rr, (cr() * 0.9 - 0.2) * BU, Math.sin(a) * A * 0.84 * rr, 1.6 + cr() * 0.7, i); continue; }
    const m = i - NIN, nm = NCL - NIN, u = 1 - 1.85 * (m + 0.5) / nm, rr = Math.sqrt(1 - u * u), a = m * 2.39996 + cr() * 0.5, f = 0.66 + cr() * 0.28;
    const rim = 1 + 0.09 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 5 + 2);   /* the dome bulges and pinches around the edge */
    const AC = A * 0.84; let x = rr * Math.cos(a) * AC * f * rim, z = rr * Math.sin(a) * AC * f * rim, y = (u > 0 ? u * BU : u * BD) * f;
    y -= 1.1 * rr * rr * rr * (0.4 + cr() * 0.6);   /* sagging skirt */
    addClump(x, y, z, 1.25 + cr() * 0.85, i);
  }
  const NLB = lobes.length, wsum = [];
  lobes.reduce((s, l, i) => (wsum[i] = s + l.rx * l.rz), 0);
  const pickLobe = () => { const r = cr() * wsum[NLB - 1]; let a = 0, b = NLB - 1; while(a < b){ const m = (a + b) >> 1; if(wsum[m] < r) a = m + 1; else b = m; } return a; };
  /* a point on the skin of the clump union, with its outward normal, or null when it falls inside a neighbour or in a gap */
  const skin = (minY = -9) => {
    const li = pickLobe(), l = lobes[li], u = cr() * 2 - 1, ph = cr() * 6.283, rr = Math.sqrt(1 - u * u), dx = rr * Math.cos(ph), dy = u, dz = rr * Math.sin(ph), s = 0.9 + cr() * 0.1;
    const x = l.x + dx * l.rx * s, y = l.y + dy * l.ry * s, z = l.z + dz * l.rz * s;
    for(let j = 0; j < NLB; j++){ if(j === li) continue; const q = lobes[j], ex = (x - q.x) / q.rx, ey = (y - q.y) / q.ry, ez = (z - q.z) / q.rz; if(ex * ex + ey * ey + ez * ez < 0.8) return null; }
    const len = Math.hypot(x, y, z) || 1, ux = x / len, uy = y / len, uz = z / len;
    if(len > 2.2) for(const h of holes) if(ux * h.x + uy * h.y + uz * h.z > h.c) return null;
    let nx = dx / l.rx, ny = dy / l.ry, nz = dz / l.rz; const nl = Math.hypot(nx, ny, nz) || 1;
    return { x, y, z, nx: nx / nl, ny: ny / nl, nz: nz / nl, li, len };
  };
  /* ginkgo leaves: a small fan with a notch in the middle of its edge, seen from both sides */
  const lf = new T.Shape(); lf.moveTo(0, 0);
  for(let i = 0; i <= 26; i++){ const a = Math.PI * (0.17 + 0.66 * i / 26), r = 1 - 0.22 * Math.exp(-(((a - Math.PI / 2) / 0.1) ** 2)); lf.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  lf.closePath();
  const leafG = K.geo(new T.ShapeGeometry(lf)), leafM = K.std('#ffffff', { roughness: 0.9, side: T.DoubleSide });
  const LEAF = ['#f5cf3a', '#eebb24', '#f8dc63', '#f2c230'];
  /* crown leaves. A small warm self light keeps the shaded side yellow and not brown. The wind is a sine on each leaf's position in the vertex shader, driven by one uniform. */
  const windU = { value: 0 };
  const crownMat = K.std('#ffffff', { roughness: 0.92, side: T.DoubleSide, emissive: '#b08400', emissiveIntensity: 0.16 });
  crownMat.onBeforeCompile = s => {
    s.uniforms.uWind = windU;
    s.vertexShader = 'uniform float uWind;\n' + s.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      float wv = sin( uWind * 1.1 + mvPosition.x * 0.42 + mvPosition.z * 0.36 ) * 0.07 + sin( uWind * 2.3 + mvPosition.y * 0.9 + mvPosition.x * 0.5 ) * 0.035;
      mvPosition.xz += vec2( wv, wv * 0.6 ); mvPosition.y += wv * 0.25;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  crownMat.customProgramCacheKey = () => 'sprag-ginkgo-wind';
  const NLF = opt.leaves, crown = K.instanced(leafG, crownMat, NLF), leafPts = [];
  const GOLD = ['#eebb24', '#e5a91c'], YEL = ['#f5cf3a', '#f8dc63', '#fbe27a'];
  for(let n = 0, tries = 0; n < NLF && tries < NLF * 30; tries++){
    const s = skin(); if(!s) continue;
    /* tilt the leaf toward the sky a little and scatter its direction so the clump reads as a pile of leaves, not a smooth shell */
    V.set(s.nx + (cr() - 0.5) * 0.9, s.ny + 0.3 + (cr() - 0.5) * 0.9, s.nz + (cr() - 0.5) * 0.9).normalize();
    Q.setFromUnitVectors(ZAX, V); Q.multiply(Q2.setFromAxisAngle(ZAX, cr() * 6.283));
    const sc = 0.3 + cr() * 0.17;
    P.set(s.x - V.x * 0.04, CY + s.y - V.y * 0.04, s.z - V.z * 0.04);
    crown.setMatrixAt(n, M.compose(P, Q, S.set(sc, sc, sc)));
    /* mostly yellow, some gold, rarely a leaf that is still green. Low and inner leaves are darker, high ones brighter. */
    const k = Math.max(0, Math.min(1, (s.y + BD + 0.8) / (BU + BD + 1.6))), depth = Math.max(0, Math.min(1, s.len / (shellR(s.x / s.len, s.y / s.len, s.z / s.len) * 0.95))), r = cr();
    const pick = r < 0.03 ? '#c9c85a' : r < 0.03 + (k < 0.4 ? 0.4 : 0.22) ? GOLD[cr() < 0.5 ? 0 : 1] : YEL[(cr() * 3) | 0];
    crown.setColorAt(n, C.set(pick).multiplyScalar((0.7 + 0.3 * k) * (0.82 + 0.18 * depth) * clumpTint[lobes[s.li].c] * (0.92 + cr() * 0.1) * (0.86 + 0.14 * (s.ny * 0.5 + 0.5))));
    leafPts.push(s); n++;
  }
  crown.count = leafPts.length; crown.instanceMatrix.needsUpdate = true; crown.instanceColor.needsUpdate = true; crown.castShadow = false; crown.receiveShadow = false; crown.frustumCulled = false; g.add(crown);
  /* twinkle lights sit on the outer leaf skin, spread apart, skipping the deep underside */
  const placed = [], spot = (n, minD, minNy, lift) => {
    const out = [];
    for(let tries = 0; out.length < n && tries < 40000; tries++){
      const s = leafPts[(cr() * leafPts.length) | 0]; if(s.ny < minNy || s.len < 3.5) continue;
      if(placed.some(q => (q.x - s.x) ** 2 + (q.y - s.y) ** 2 + (q.z - s.z) ** 2 < minD * minD)) continue;
      const q = { x: s.x + s.nx * lift, y: s.y + s.ny * lift, z: s.z + s.nz * lift }; placed.push(q); out.push(q);
    }
    return out;
  };
  const NL = opt.lights, bulbMat = K.glow(0.8), bulbs = K.instanced(new T.SphereGeometry(0.11, 8, 6), bulbMat, NL), lcol = [], lph = [], lsp = [], WARM = ['#fff0c4', '#ffd45a', '#fff0c4', '#ffe28a'];
  const bp = spot(NL, 0.95, -0.25, 0.14); let li = 0;
  bp.forEach(q => { M.makeTranslation(q.x, CY + q.y, q.z); bulbs.setMatrixAt(li, M); lcol.push(new T.Color(WARM[li % 4])); lph.push(rand() * 6.283); lsp.push(1.2 + (li % 7) * 0.25); bulbs.setColorAt(li, lcol[li]); li++; });
  bulbs.count = li; bulbs.instanceMatrix.needsUpdate = true; bulbs.instanceColor.needsUpdate = true; bulbs.frustumCulled = false; g.add(bulbs);
  /* a few small baubles, gold and white with some red, sitting in the leaves: hardly visible by day, glints at night */
  const NR = opt.baubles, bau = K.instanced(new T.SphereGeometry(0.12, 10, 8), K.std('#ffffff', { roughness: 0.25, metalness: 0.3 }), NR);
  spot(NR, 1.6, 0.0, 0.05).forEach((q, i) => { M.makeTranslation(q.x, CY + q.y, q.z); bau.setMatrixAt(i, M); bau.setColorAt(i, C.set(['#f5c542', '#fffaf0', '#e8505b', '#f5c542', '#fffaf0'][i % 5])); });
  bau.instanceMatrix.needsUpdate = true; bau.instanceColor.needsUpdate = true; bau.frustumCulled = false; g.add(bau);
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
    windU.value = t;   /* the leaves sway from t alone, so a frozen t (reduced motion) holds them still */
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

/* ---------- world tree ---------- */
/* A fantasy world tree for the team office, grown from the same gold ginkgo fan leaves as makeGinkgo. Origin at the middle of the trunk's foot, one unit is one scene unit.
 * It stands just outside the back corner of the room (opt.corner units out from the corner on both axes) so the Sprag server (opt.srv, the kiosk centre in this space) is at its foot.
 * A twisted trunk of five strands rises about 8.6 and leans a little toward the room, two thick roots arch over the corner wall and come down on both sides of the kiosk
 * wrapped in twinkle lights, and more roots spread over the lawn. The branches end in stacks of 2 to 4 flat leaf discs that shrink toward the top (about 17 high and 18 across in all).
 * The lowest leaves start at height 9. Leaves are one InstancedMesh laid on the skin of the discs. The wind, the fireflies (many gather round the server) and 14 swinging lanterns run
 * in vertex shaders from one time uniform. Two rings of lights go round the kiosk and a few mushrooms and moss patches sit between the roots.
 * opt.carpet and opt.fall are lists of { x0, x1, z0, z1, y, n } in the tree's own space as in makeGinkgo. opt.floor is the same kind of list for leaves lying on the floor
 * (placed evenly, not by distance from the trunk). tick(t, night) only sets uniforms (and moves the few falling leaves), so a frozen t (reduced motion) freezes the whole tree. */
import { softLook } from './fur.js?v=f1';
export function makeWorldTree(T, o = {}){
  const opt = { leaves: 7000, lights: 220, baubles: 16, flies: 150, lanterns: 14, carpet: [], fall: [], floor: [], carpetR: 12, srv: { x: 5.8, z: 5.6 }, corner: 2.2, ...o };
  const sv = opt.srv, cn = opt.corner;
  const K = kit(T), rand = rng(4242), cr = rng(9001), g = new T.Group(), M = new T.Matrix4(), C = new T.Color(), Q = new T.Quaternion(), Q2 = new T.Quaternion(), E = new T.Euler(), P = new T.Vector3(), S = new T.Vector3(), V = new T.Vector3(), ZAX = new T.Vector3(0, 0, 1);
  const tU = { value: 0 };   /* seconds: the one clock that the wind, the fireflies and the lanterns read in their shaders */
  const clamp01 = x => Math.max(0, Math.min(1, x)), smooth = t => t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;
  /* value noise for the bark colours */
  const hs = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), ux = smooth(x - ix), uy = smooth(y - iy), uz = smooth(z - iz);
    const f = k => lerp(lerp(hs(ix, iy, iz + k), hs(ix + 1, iy, iz + k), ux), lerp(hs(ix, iy + 1, iz + k), hs(ix + 1, iy + 1, iz + k), ux), uy);
    return lerp(f(0), f(1), uz);
  };
  /* ---- bark: every trunk strand, root and branch is a tapered tube with vertical grooves and vertex colours (warm grey brown with green moss), merged into one mesh ---- */
  const B1 = new T.Color('#8a7561'), B2 = new T.Color('#5a4a3e'), MOSS = new T.Color('#6d9a46'), MOSS2 = new T.Color('#92b65a'), CB = new T.Color();
  const barkAt = (x, y, z, ny, gr) => {
    const n1 = vn(x * 0.55, y * 0.45, z * 0.55), n2 = vn(x * 2.4 + 3, y * 1.5, z * 2.4);
    CB.copy(B1).lerp(B2, clamp01(n1 * 0.7 + n2 * 0.25));
    CB.lerp(n2 > 0.55 ? MOSS2 : MOSS, clamp01((vn(x * 0.42 + 7, y * 0.3 + 2, z * 0.42 + 5) - 0.5) * 5 + ny * 0.45) * 0.85);
    return CB.multiplyScalar(Math.max(0.7, Math.min(1.12, 0.78 + 3 * (gr - 0.93))));
  };
  const BP = [], BC = [], BI = [], WRAP = [], tp = new T.Vector3();   /* WRAP: points that spiral round a tube, for the light strings */
  const tube = (curve, seg, radial, rf, ob = {}) => {
    const fr = curve.computeFrenetFrames(seg, false), base = BP.length / 3, gv = ob.groove === undefined ? 0.07 : ob.groove, ph = ob.ph || 0;
    for(let i = 0; i <= seg; i++){
      const t = i / seg, r = rf(t), N = fr.normals[i], B = fr.binormals[i]; curve.getPointAt(t, tp);
      for(let j = 0; j < radial; j++){
        const a = j / radial * 6.2832, ca = Math.cos(a), sa = Math.sin(a), gr = 1 + gv * Math.cos(a * 6 + t * 5 + ph), nx = N.x * ca + B.x * sa, ny = N.y * ca + B.y * sa, nz = N.z * ca + B.z * sa;
        const x = tp.x + nx * r * gr, y = tp.y + ny * r * gr, z = tp.z + nz * r * gr, c = barkAt(x, y, z, ny, 1 + (gr - 1) / (gv || 1) * 0.07);
        BP.push(x, y, z); BC.push(c.r, c.g, c.b);
      }
    }
    for(let i = 0; i < seg; i++) for(let j = 0; j < radial; j++){
      const a = base + i * radial + j, b = base + i * radial + (j + 1) % radial, c = a + radial, d = b + radial; BI.push(a, b, c, b, d, c);
    }
    if(ob.wrap) for(let k = 0; k < ob.wrap.n; k++){
      const w = ob.wrap, t = w.t0 + (w.t1 - w.t0) * (k + 0.5) / w.n, ii = Math.round(t * seg), N = fr.normals[ii], B = fr.binormals[ii], an = t * w.turns * 6.2832 + k * 0.01, ca = Math.cos(an), sa = Math.sin(an), rr = rf(t) + 0.1;
      curve.getPointAt(t, tp); WRAP.push({ x: tp.x + (N.x * ca + B.x * sa) * rr, y: tp.y + (N.y * ca + B.y * sa) * rr, z: tp.z + (N.z * ca + B.z * sa) * rr });
    }
  };
  /* trunk: the axis leans toward the room as it climbs (smooth step, so the foot and the top are upright). Five strands wind round a core and flare at the foot. */
  const T0 = new T.Vector3(2.0, 8.6, 1.8), axis = t => new T.Vector3(T0.x * smooth(t), -0.5 + (T0.y + 0.5) * t, T0.z * smooth(t));
  const NS = 5;
  for(let j = 0; j < NS; j++){
    const pts = []; for(let i = 0; i <= 16; i++){ const t = i / 16, a = j * 6.2832 / NS + 6.2832 * 1.15 * t, rs = 0.95 - 0.4 * t, c = axis(t); pts.push(new T.Vector3(c.x + Math.cos(a) * rs, c.y, c.z + Math.sin(a) * rs)); }
    tube(new T.CatmullRomCurve3(pts), 60, 10, t => 0.85 - 0.4 * t + 0.4 * (1 - t) ** 6, { ph: j * 1.3 });
  }
  { const pts = []; for(let i = 0; i <= 8; i++) pts.push(axis(i / 8)); tube(new T.CatmullRomCurve3(pts), 40, 10, t => 0.8 - 0.4 * t + 0.4 * (1 - t) ** 6, { ph: 4 }); }
  /* roots. Outside the walls: [direction in degrees, reach, arch], clipped to the lawn (it ends 3.1 beyond the room's left wall and 6 beyond its back wall). Two thick arches climb the trunk,
   * cross the wall corner above the wall top (2.4) and come down on both sides of the kiosk, wrapped in twinkle lights. Nothing reaches the seats. */
  [[190, 3.0, 0], [222, 4.2, 1], [255, 5.4, 0], [285, 5.6, 1], [318, 4.8, 0], [348, 5.2, 0], [105, 5.0, 0], [12, 5.2, 0]].forEach(([deg, L0, arch]) => {
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); let L = L0;
    if(ca < -0.01) L = Math.min(L, 3.0 / -ca); if(sa < -0.01) L = Math.min(L, 5.8 / -sa);
    const at = (r, y) => new T.Vector3(ca * r, y, sa * r);
    const pts = arch ? [at(1.2, 3.0), at(L * 0.34, 2.5), at(L * 0.62, 1.5), at(L * 0.86, 0.3), at(L, -0.3)] : [at(1.0, 3.6), at(L * 0.2 + 0.8, 1.6), at(L * 0.45, 0.5), at(L * 0.75, 0.05), at(L, -0.3)];
    tube(new T.CatmullRomCurve3(pts), 26, 8, t => (arch ? 0.62 : 0.85) * (1 - t) + 0.28, { ph: deg });
  });
  { const Vr = (x, y, z) => new T.Vector3(x, y, z), lx = sv.x - 2.2, rx = sv.x + 2.3, wrap = { n: 26, t0: 0.22, t1: 0.98, turns: 5 };
    tube(new T.CatmullRomCurve3([Vr(0.9, 3.5, 0.9), Vr(cn + 1.3, 3.9, cn - 0.1), Vr(cn + 2.9, 3.4, cn + 1.1), Vr(rx - 1.4, 2.0, sv.z - 1.2), Vr(rx - 0.3, 0.7, sv.z - 0.5), Vr(rx, -0.15, sv.z - 0.1), Vr(rx - 0.1, -0.25, sv.z + 0.8)]), 44, 9, t => 0.78 * (1 - t) + 0.3, { ph: 11, wrap });
    tube(new T.CatmullRomCurve3([Vr(0.9, 3.5, 0.9), Vr(cn - 0.1, 3.9, cn + 1.3), Vr(cn + 0.9, 3.2, cn + 2.5), Vr(lx - 0.1, 1.8, sv.z - 0.4), Vr(lx, 0.5, sv.z + 0.2), Vr(lx + 0.1, -0.2, sv.z + 0.9)]), 44, 9, t => 0.78 * (1 - t) + 0.3, { ph: 12, wrap }); }
  /* crown plan: [direction in degrees from the trunk top, distance, base height, radius of the lowest disc, number of discs]. Discs are 2.1 apart and 20 percent smaller each. */
  const PADS = [[0, 0, 13.0, 2.7, 3], [20, 5.6, 9.8, 3.4, 4], [85, 5.8, 9.4, 3.1, 3], [150, 6.0, 10.4, 3.5, 4], [215, 5.4, 11.2, 3.1, 3], [275, 5.2, 10.0, 3.2, 3], [330, 5.8, 10.8, 3.3, 4], [120, 3.0, 12.2, 2.3, 2]];
  const limbs = [], lobes = [], padTint = [];
  PADS.forEach(([deg, rho, y0, r0, nt], k) => {
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), px = T0.x + ca * rho, pz = T0.z + sa * rho, bend = (k % 2 ? 1 : -1) * 0.9, e = new T.Vector3(px, y0 - 0.2, pz), V3 = (x, y, z) => new T.Vector3(x, y, z);
    const pts = rho < 0.5 ? [V3(T0.x, T0.y - 0.8, T0.z), V3(T0.x, T0.y + 2, T0.z), e] : [
      V3(T0.x + ca * 0.3, T0.y - 0.8, T0.z + sa * 0.3),
      V3(T0.x + ca * rho * 0.3 - sa * bend * 0.4, T0.y + 0.9, T0.z + sa * rho * 0.3 + ca * bend * 0.4),
      V3(T0.x + ca * rho * 0.68 - sa * bend, T0.y + (y0 - T0.y) * 0.5 + 0.9, T0.z + sa * rho * 0.68 + ca * bend), e];
    const curve = new T.CatmullRomCurve3(pts); if(rho >= 0.5) limbs.push(curve);
    tube(curve, 30, 8, t => (rho < 0.5 ? 0.62 : 0.78) * (1 - t) + 0.2, { ph: k });
    const top = y0 + (nt - 1) * 2.1 - 0.1;
    tube(new T.CatmullRomCurve3([e, V3(px + 0.15, (e.y + top) / 2, pz - 0.1), V3(px, top, pz)]), 12, 6, t => 0.27 - 0.12 * t, { ph: k + 3, groove: 0.04 });   /* the stalk that shows between the discs */
    padTint.push(0.9 + cr() * 0.14);
    for(let j = 0; j < nt; j++){
      const rj = r0 * (1 - 0.2 * j), ry = 0.22 * rj + 0.12, cy = y0 + j * 2.1, cx = px + Math.sin(k * 2 + j * 1.7) * 0.35, cz = pz + Math.cos(k * 3 + j * 2.1) * 0.35;
      lobes.push({ x: cx, y: cy, z: cz, rx: rj, ry, rz: rj, pad: k });
      for(let s = 0; s < 4; s++){ const an = (s + cr() * 0.6) * 1.5708, off = rj * (0.5 + cr() * 0.2), q = rj * (0.5 + cr() * 0.15); lobes.push({ x: cx + Math.cos(an) * off, y: cy + (cr() - 0.5) * 0.3, z: cz + Math.sin(an) * off, rx: q, ry: ry * 0.85, rz: q, pad: k }); }
    }
  });
  const bg = K.geo(new T.BufferGeometry()); bg.setAttribute('position', new T.Float32BufferAttribute(BP, 3)); bg.setAttribute('color', new T.Float32BufferAttribute(BC, 3)); bg.setIndex(BI); bg.computeVertexNormals();
  g.add(new T.Mesh(bg, K.std('#ffffff', { vertexColors: true, roughness: 1, flatShading: true, side: T.DoubleSide })));
  /* ---- leaves on the skin of the discs ---- */
  const NLB = lobes.length, wsum = [];
  lobes.reduce((s, l, i) => (wsum[i] = s + l.rx * l.rz), 0);
  const pickLobe = () => { const r = cr() * wsum[NLB - 1]; let a = 0, b = NLB - 1; while(a < b){ const m = (a + b) >> 1; if(wsum[m] < r) a = m + 1; else b = m; } return a; };
  const skin = () => {
    const li = pickLobe(), l = lobes[li], u = cr() * 2 - 1, ph = cr() * 6.283, rr = Math.sqrt(1 - u * u), dx = rr * Math.cos(ph), dy = u, dz = rr * Math.sin(ph), s = 0.9 + cr() * 0.1;
    const x = l.x + dx * l.rx * s, y = l.y + dy * l.ry * s, z = l.z + dz * l.rz * s;
    for(let j = 0; j < NLB; j++){ if(j === li) continue; const q = lobes[j], ex = (x - q.x) / q.rx, ey = (y - q.y) / q.ry, ez = (z - q.z) / q.rz; if(ex * ex + ey * ey + ez * ez < 0.8) return null; }
    let nx = dx / l.rx, ny = dy / l.ry, nz = dz / l.rz; const nl = Math.hypot(nx, ny, nz) || 1;
    return { x, y, z, nx: nx / nl, ny: ny / nl, nz: nz / nl, li };
  };
  const lf = new T.Shape(); lf.moveTo(0, 0);
  for(let i = 0; i <= 26; i++){ const a = Math.PI * (0.17 + 0.66 * i / 26), r = 1 - 0.22 * Math.exp(-(((a - Math.PI / 2) / 0.1) ** 2)); lf.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  lf.closePath();
  const leafG = K.geo(new T.ShapeGeometry(lf)), leafM = K.std('#ffffff', { roughness: 0.9, side: T.DoubleSide });
  const LEAF = ['#f5cf3a', '#eebb24', '#f8dc63', '#f2c230'], GOLD = ['#eebb24', '#e5a91c'], YEL = ['#f5cf3a', '#f8dc63', '#fbe27a'];
  const crownMat = K.std('#ffffff', { roughness: 0.92, side: T.DoubleSide, emissive: '#b08400', emissiveIntensity: 0.16 });
  crownMat.onBeforeCompile = s => {
    s.uniforms.uWind = tU;
    s.vertexShader = 'uniform float uWind;\n' + s.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      float wv = sin( uWind * 1.1 + mvPosition.x * 0.42 + mvPosition.z * 0.36 ) * 0.1 + sin( uWind * 2.3 + mvPosition.y * 0.9 + mvPosition.x * 0.5 ) * 0.045;
      mvPosition.xz += vec2( wv, wv * 0.6 ); mvPosition.y += wv * 0.25;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  crownMat.customProgramCacheKey = () => 'sprag-worldtree-wind';
  softLook(T, crownMat);   /* wrap light, warm underside bounce and a faint rim, chained after the wind patch above */
  const NLF = opt.leaves, crown = K.instanced(leafG, crownMat, NLF), leafPts = [];
  for(let n = 0, tries = 0; n < NLF && tries < NLF * 30; tries++){
    const s = skin(); if(!s) continue;
    V.set(s.nx + (cr() - 0.5) * 0.9, s.ny + 0.3 + (cr() - 0.5) * 0.9, s.nz + (cr() - 0.5) * 0.9).normalize();
    Q.setFromUnitVectors(ZAX, V); Q.multiply(Q2.setFromAxisAngle(ZAX, cr() * 6.283));
    const sc = 0.42 + cr() * 0.22;
    P.set(s.x - V.x * 0.05, s.y - V.y * 0.05, s.z - V.z * 0.05);
    crown.setMatrixAt(n, M.compose(P, Q, S.set(sc, sc, sc)));
    const yk = clamp01((s.y - 8.5) / 9), r = cr(), pick = r < 0.03 ? '#c9c85a' : r < 0.03 + (yk < 0.4 ? 0.4 : 0.22) ? GOLD[cr() < 0.5 ? 0 : 1] : YEL[(cr() * 3) | 0];
    crown.setColorAt(n, C.set(pick).multiplyScalar((0.72 + 0.28 * yk) * (0.8 + 0.2 * (s.ny * 0.5 + 0.5)) * padTint[lobes[s.li].pad] * (0.92 + cr() * 0.1)));
    leafPts.push(s); n++;
  }
  crown.count = leafPts.length; crown.instanceMatrix.needsUpdate = true; crown.instanceColor.needsUpdate = true; crown.castShadow = false; crown.receiveShadow = false; crown.frustumCulled = false; g.add(crown);
  /* ---- twinkle lights and baubles on the outer skin (the year-end dressing) ---- */
  const placed = [], spot = (n, minD, minNy, lift) => {
    const out = [];
    for(let tries = 0; out.length < n && tries < 40000; tries++){
      const s = leafPts[(cr() * leafPts.length) | 0]; if(s.ny < minNy) continue;
      if(placed.some(q => (q.x - s.x) ** 2 + (q.y - s.y) ** 2 + (q.z - s.z) ** 2 < minD * minD)) continue;
      const q = { x: s.x + s.nx * lift, y: s.y + s.ny * lift, z: s.z + s.nz * lift }; placed.push(q); out.push(q);
    }
    return out;
  };
  const NL = opt.lights, bulbMat = K.glow(0.8), bulbs = K.instanced(new T.SphereGeometry(0.15, 8, 6), bulbMat, NL + 120), lcol = [], lph = [], lsp = [], WARM = ['#fff0c4', '#ffd45a', '#fff0c4', '#ffe28a'];
  let li = 0;
  /* two rings of lights round the kiosk (just under its dome and on its base) and a string up each front corner */
  const XC = ['#ffe2a0', '#ff5a5f', '#5aa9ff', '#5fd38d', '#ffb347', '#ff8fc4'], kring = [];
  { const hx = 1.34, hz = 0.84, ring = y => { for(let k = 0; k < 18; k++){ const u = k / 18 * 4, side = Math.floor(u), f = u - side, x = side === 0 ? -hx + 2 * hx * f : side === 2 ? hx - 2 * hx * f : side === 1 ? hx : -hx, z = side === 1 ? -hz + 2 * hz * f : side === 3 ? hz - 2 * hz * f : side === 0 ? -hz : hz; kring.push({ x: sv.x + x, y, z: sv.z + z }); } };
    ring(2.93); ring(0.3); for(let k = 0; k < 6; k++){ kring.push({ x: sv.x - 1.28, y: 0.6 + k * 0.45, z: sv.z + 0.78 }); kring.push({ x: sv.x + 1.28, y: 0.6 + k * 0.45, z: sv.z + 0.78 }); } }
  const crownB = spot(NL, 1.0, -0.25, 0.18);
  crownB.concat(WRAP, kring).forEach((q, qi) => { const x = qi >= crownB.length; bulbs.setMatrixAt(li, M.compose(P.set(q.x, q.y, q.z), Q.identity(), S.setScalar(x ? 0.55 : 1))); lcol.push(new T.Color(x ? XC[li % 6] : WARM[li % 4])); lph.push(rand() * 6.283); lsp.push(1.2 + (li % 7) * 0.25); bulbs.setColorAt(li, lcol[li]); li++; });
  bulbs.count = li; bulbs.instanceMatrix.needsUpdate = true; bulbs.instanceColor.needsUpdate = true; bulbs.frustumCulled = false; g.add(bulbs);
  const bau = K.instanced(new T.SphereGeometry(0.18, 10, 8), K.std('#ffffff', { roughness: 0.25, metalness: 0.3 }), opt.baubles);
  spot(opt.baubles, 1.8, 0.0, 0.06).forEach((q, i) => { M.makeTranslation(q.x, q.y, q.z); bau.setMatrixAt(i, M); bau.setColorAt(i, C.set(['#f5c542', '#fffaf0', '#e8505b', '#f5c542', '#fffaf0'][i % 5])); });
  bau.instanceMatrix.needsUpdate = true; bau.instanceColor.needsUpdate = true; bau.frustumCulled = false; g.add(bau);
  /* ---- fireflies: each rises about 6 units in a slow loop, circles a little and fades at both ends. Position, size and twinkle come from the time uniform and the instance's home point. ---- */
  const NF = opt.flies, flyMat = K.std('#ffffff', { emissive: '#ffd27a', emissiveIntensity: 1, roughness: 0.4 });
  const HASH = 'vec3 b0 = instanceMatrix[3].xyz; float ph = fract(sin(dot(b0, vec3(12.9898, 78.233, 37.719))) * 43758.5453);';
  const glowFrag = f => 'varying float vFly;\n' + f.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor * vFly;');
  flyMat.onBeforeCompile = s => {
    s.uniforms.uT = tU;
    s.vertexShader = 'uniform float uT;\nvarying float vFly;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      ${HASH}
      float f = fract( uT * ( 0.018 + 0.03 * fract( ph * 7.3 ) ) + ph );
      float fade = sin( 3.14159 * f );
      transformed *= 0.4 + 0.6 * fade;
      transformed.y += ( f - 0.5 ) * 6.0;
      transformed.x += 0.9 * sin( uT * ( 0.35 + ph * 0.3 ) + ph * 40.0 );
      transformed.z += 0.9 * cos( uT * ( 0.28 + ph * 0.3 ) + ph * 31.0 );
      vFly = fade * ( 0.7 + 0.3 * sin( uT * ( 1.6 + ph * 2.4 ) + ph * 50.0 ) );`);
    s.fragmentShader = glowFrag(s.fragmentShader);
  };
  flyMat.customProgramCacheKey = () => 'sprag-worldtree-fly';
  const flies = K.instanced(new T.SphereGeometry(0.13, 6, 4), flyMat, NF), FC = ['#ffe9a8', '#ffc861', '#fff3c4', '#ffd27a'];
  for(let i = 0; i < NF; i++){
    let x, y, z;
    if(i % 5 < 2){ x = sv.x + (rand() - 0.5) * 7; z = sv.z + (rand() - 0.5) * 6; y = 2.8 + rand() * 3.2; }   /* two in five gather round the server */
    else if(i % 5 === 2){ x = -3 + rand() * 5; z = -5 + rand() * 6; y = 2 + rand() * 5; }   /* round the trunk, off the room's walls */
    else { const p = PADS[(rand() * PADS.length) | 0], a = rand() * 6.283, rr = p[3] * (0.9 + rand() * 0.7); x = T0.x + Math.cos(p[0] * Math.PI / 180) * p[1] + Math.cos(a) * rr; z = T0.z + Math.sin(p[0] * Math.PI / 180) * p[1] + Math.sin(a) * rr; y = p[2] - 2.5 + rand() * 7.5; }
    flies.setMatrixAt(i, M.makeTranslation(x, y, z)); flies.setColorAt(i, C.set(FC[i % 4]).multiplyScalar(0.8 + rand() * 0.3));
  }
  flies.instanceMatrix.needsUpdate = true; flies.instanceColor.needsUpdate = true; flies.frustumCulled = false; g.add(flies);
  /* ---- lanterns: a string, a cap and a glowing body in one geometry (vertex colours), hung from the branches and swinging about the hook in the vertex shader ---- */
  const part = (geo, y, c) => { geo.translate(0, y, 0); const n = geo.attributes.position.count, a = new Float32Array(n * 3); for(let i = 0; i < n; i++){ a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } geo.setAttribute('color', new T.BufferAttribute(a, 3)); return geo.toNonIndexed(); };
  const parts = [part(new T.CylinderGeometry(0.03, 0.03, 1.3, 4), -0.65, [0.2, 0.14, 0.09]), part(new T.CylinderGeometry(0.05, 0.3, 0.14, 6), -1.37, [0.25, 0.17, 0.1]), part(new T.CylinderGeometry(0.27, 0.2, 0.52, 6), -1.7, [1.0, 0.55, 0.16]), part(new T.CylinderGeometry(0.1, 0.05, 0.1, 6), -2.0, [0.25, 0.17, 0.1])];
  const pos = [], nor = [], col = [];
  parts.forEach(gm => { pos.push(...gm.attributes.position.array); nor.push(...gm.attributes.normal.array); col.push(...gm.attributes.color.array); gm.dispose(); });
  const lanG = K.geo(new T.BufferGeometry()); lanG.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); lanG.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); lanG.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  const lanMat = K.std('#ffffff', { vertexColors: true, emissive: '#ffffff', emissiveIntensity: 1, roughness: 0.5 });
  lanMat.onBeforeCompile = s => {
    s.uniforms.uT = tU;
    s.vertexShader = 'uniform float uT;\nvarying float vFly;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      ${HASH}
      float a1 = sin( uT * 0.9 + ph * 20.0 ) * 0.1 + sin( uT * 1.7 + ph * 9.0 ) * 0.04, a2 = sin( uT * 0.7 + ph * 33.0 ) * 0.08;
      transformed.x += a1 * -transformed.y; transformed.z += a2 * -transformed.y;
      vFly = 0.88 + 0.12 * sin( uT * 3.1 + ph * 60.0 );`);
    s.fragmentShader = glowFrag(s.fragmentShader);
  };
  lanMat.customProgramCacheKey = () => 'sprag-worldtree-lantern';
  const NLN = Math.min(opt.lanterns, limbs.length * 2), lan = K.instanced(lanG, lanMat, NLN);
  for(let i = 0; i < NLN; i++){
    const p = limbs[i % limbs.length].getPoint(i < limbs.length ? 0.5 : 0.8), sc = 1.1 + rand() * 0.35;
    lan.setMatrixAt(i, M.compose(P.set(p.x, p.y - 0.15, p.z), Q.identity(), S.set(sc, sc, sc))); lan.setColorAt(i, C.setRGB(1, 1, 1).multiplyScalar(0.9 + rand() * 0.15));
  }
  lan.instanceMatrix.needsUpdate = true; lan.instanceColor.needsUpdate = true; lan.frustumCulled = false; g.add(lan);
  /* ---- mushrooms and moss between the roots round the server ---- */
  { const cap = ['#e8505b', '#f2c14e', '#f4ead8'];
    [[sv.x - 2.8, sv.z + 1.3, 1.0], [sv.x - 2.3, sv.z + 1.9, 0.7], [sv.x - 3.0, sv.z + 2.0, 0.5], [sv.x + 2.6, sv.z - 0.5, 0.8], [sv.x + 2.2, sv.z - 1.0, 0.6], [sv.x + 2.8, sv.z - 1.1, 0.5]].forEach(([x, z, k], i) => {
      const st = K.mesh(new T.CylinderGeometry(0.05 * k, 0.08 * k, 0.34 * k, 6), K.std('#f4ead8')), cp = K.mesh(new T.SphereGeometry(0.2 * k, 10, 6), K.std(cap[i % 3], { emissive: cap[i % 3], emissiveIntensity: 0.12 }));
      st.position.set(x, 0.17 * k, z); cp.scale.y = 0.62; cp.position.set(x, 0.38 * k, z); g.add(st, cp);
    });
    [[sv.x + 2.35, sv.z - 0.1, 0.8], [sv.x - 2.15, sv.z + 0.4, 0.7], [sv.x + 1.6, sv.z - 1.6, 0.6], [sv.x - 1.7, sv.z - 1.5, 0.6]].forEach(([x, z, k], i) => {
      const mo = K.mesh(new T.SphereGeometry(1, 8, 5), K.std(i % 2 ? '#92b65a' : '#6d9a46', { roughness: 1 })); mo.scale.set(0.7 * k, 0.1, 0.5 * k); mo.position.set(x, 0.05, z); g.add(mo);
    }); }
  /* ---- leaves on the ground and in the air ---- */
  const spots = list => list.flatMap(a => Array.from({ length: a.n }, () => ({ x: a.x0 + (a.x1 - a.x0) * rand(), z: a.z0 + (a.z1 - a.z0) * rand(), y: a.y, k: rand() })));
  const dense = list => list.flatMap(a => { const out = []; for(let tries = 0; out.length < a.n && tries < a.n * 60; tries++){
    const rho = opt.carpetR * Math.pow(rand(), 1.4), th = rand() * 6.283, x = Math.cos(th) * rho, z = Math.sin(th) * rho;
    if(x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) out.push({ x, z, y: a.y, k: rand() }); } return out; });
  const flat = dense(opt.carpet).concat(spots(opt.floor)), carpet = flat.length ? K.instanced(leafG, leafM, flat.length) : null;
  if(carpet){
    flat.forEach((l, i) => { const sc = 0.28 + rand() * 0.2; E.set(-Math.PI / 2 + (rand() - 0.5) * 0.15, rand() * 6.283, 0, 'YXZ'); Q.setFromEuler(E);
      carpet.setMatrixAt(i, M.compose(P.set(l.x, l.y + i * 0.0003, l.z), Q, S.set(sc, sc, sc))); carpet.setColorAt(i, C.set(LEAF[i % 4]).multiplyScalar(0.92 + rand() * 0.1)); });
    carpet.instanceMatrix.needsUpdate = true; carpet.instanceColor.needsUpdate = true; carpet.receiveShadow = false; g.add(carpet);
  }
  const fl = spots(opt.fall), fall = fl.length ? K.instanced(leafG, leafM, fl.length) : null;
  if(fall){ fl.forEach((l, i) => { l.ph = rand(); l.v = 0.35 + rand() * 0.35; l.sc = 0.3 + rand() * 0.15; fall.setColorAt(i, C.set(LEAF[i % 4])); }); fall.instanceColor.needsUpdate = true; g.add(fall); }
  const col2 = new T.Color(), TOP = 10.5;
  g.userData.tick = (t, night) => {
    tU.value = t;   /* wind, fireflies and lanterns all follow this one number */
    const n = nightOf(night), glow = 1 + n * 0.25;
    crownMat.emissiveIntensity = 0.16 + 0.2 * n;
    flyMat.emissiveIntensity = 0.7 + 3.2 * n;   /* faint by day, bright enough at night for the bloom pass to spread them */
    lanMat.emissiveIntensity = 0.9 + 2.6 * n;
    for(let i = 0; i < li; i++){ const f = 0.5 + 0.5 * Math.sin(t * lsp[i] + lph[i]); bulbs.setColorAt(i, col2.copy(lcol[i]).multiplyScalar((0.35 + 0.65 * f) * glow)); }
    bulbs.instanceColor.needsUpdate = true; bulbMat.emissiveIntensity = 0.85 + 0.3 * n;
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
