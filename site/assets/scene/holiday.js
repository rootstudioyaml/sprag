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
/* Nov 15 through Jan 6, both ends included */
export function inHolidaySeason(month, day){
  return (month === 11 && day >= 15) || month === 12 || (month === 1 && day <= 6);
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

export function makeTree(T){
  const K = kit(T), rand = rng(1225), g = new T.Group();
  /* pot and trunk */
  const pot = K.mesh(new T.CylinderGeometry(0.5, 0.38, 0.5, 18), K.std('#d9534f', { roughness: 0.6 })); pot.position.y = 0.25; g.add(pot);
  const rim = K.mesh(new T.CylinderGeometry(0.54, 0.54, 0.09, 18), K.std('#f5c542', { roughness: 0.35, metalness: 0.4 })); rim.position.y = 0.5; g.add(rim);
  const soil = K.mesh(new T.CylinderGeometry(0.46, 0.46, 0.03, 18), K.std('#6b4a35', { roughness: 1 })); soil.position.y = 0.53; g.add(soil);
  const trunk = K.mesh(new T.CylinderGeometry(0.13, 0.17, 0.8, 10), K.std('#8a5a3c', { roughness: 0.95 })); trunk.position.y = 0.85; g.add(trunk);
  /* foliage: lathe tiers, faceted and rough so the light breaks up like a low-poly tree */
  TIERS.forEach((t, i) => {
    const prof = tierProfile(t).map(([r, y]) => new T.Vector2(r, y));
    const m = K.mesh(new T.LatheGeometry([new T.Vector2(0, 0), ...prof], 11), K.std(GREENS[i], { roughness: 1, flatShading: true }));
    m.position.y = t.y; m.rotation.y = i * 0.45; m.castShadow = true; m.receiveShadow = true; g.add(m);
  });
  /* star on top */
  const sh = new T.Shape(), OUT = 0.23, INN = 0.105;
  for(let i = 0; i < 10; i++){ const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? INN : OUT; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  sh.closePath();
  const sg = new T.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 1 }); sg.center();
  const starMat = K.std('#ffd35a', { roughness: 0.3, metalness: 0.5, emissive: '#ffb938', emissiveIntensity: 0.5 });
  const star = K.mesh(sg, starMat); star.position.y = 3.1; star.castShadow = true; g.add(star);
  /* ornaments: golden-angle spread over the tiers, weighted by tier size */
  const NO = 30, orn = K.instanced(new T.SphereGeometry(0.075, 10, 8), K.std('#ffffff', { roughness: 0.22, metalness: 0.35 }), NO);
  const wsum = TIERS.reduce((s, t) => s + t.r * t.h, 0), M = new T.Matrix4(), C = new T.Color();
  for(let i = 0; i < NO; i++){
    let w = rand() * wsum, ti = 0; while(ti < TIERS.length - 1 && w > TIERS[ti].r * TIERS[ti].h){ w -= TIERS[ti].r * TIERS[ti].h; ti++; }
    const t = TIERS[ti], yl = t.h * (0.16 + 0.48 * rand()), a = i * 2.39996 + rand() * 0.5, r = tierRadius(t, yl) + 0.03;
    M.makeTranslation(Math.cos(a) * r, t.y + yl, Math.sin(a) * r); orn.setMatrixAt(i, M);
    orn.setColorAt(i, C.set(ORN[(i + (rand() < 0.2 ? 1 : 0)) % 4]));
  }
  orn.instanceMatrix.needsUpdate = true; orn.instanceColor.needsUpdate = true; g.add(orn);
  /* string lights spiralling up */
  const NL = 48, bulbMat = K.glow(0.9), bulbs = K.instanced(new T.SphereGeometry(0.045, 8, 6), bulbMat, NL), lph = [], lsp = [], lcol = [];
  for(let i = 0; i < NL; i++){
    const s = i / (NL - 1), y = 0.8 + s * 2.0, a = s * Math.PI * 2 * 5, r = (surfaceRadius(y) || 0.1) + 0.05;
    M.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r); bulbs.setMatrixAt(i, M);
    lcol.push(new T.Color(BULB[i % BULB.length])); lph.push(rand() * 6.283); lsp.push(1.3 + (i % 7) * 0.22);
    bulbs.setColorAt(i, lcol[i]);
  }
  bulbs.instanceMatrix.needsUpdate = true; bulbs.instanceColor.needsUpdate = true; g.add(bulbs);
  /* presents */
  const PRES = [
    [0.55, 0.42, 0.5, -0.85, 0.75, 0.3, '#f08a9b', '#fffaf0'], [0.4, 0.34, 0.4, -0.35, 1.05, -0.2, '#7fb7e6', '#f5c542'],
    [0.5, 0.3, 0.7, 0.55, 0.95, 0.15, '#f6d36b', '#e8505b'], [0.3, 0.3, 0.3, 1.05, 0.5, -0.4, '#9bd6a8', '#fffaf0'],
    [0.36, 0.5, 0.36, -1.15, 0.1, 0.5, '#c4a6ee', '#f5c542'], [0.28, 0.22, 0.28, 0.12, 1.35, 0.1, '#ff9d76', '#fffaf0'],
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
  pot.castShadow = true; rim.castShadow = true; trunk.castShadow = true; pot.receiveShadow = true;

  const col = new T.Color();
  g.userData.tick = (t, night) => {
    const n = nightOf(night), glow = 1 + n * 0.6;
    for(let i = 0; i < NL; i++){
      const f = 0.5 + 0.5 * Math.sin(t * lsp[i] + lph[i]);
      bulbs.setColorAt(i, col.copy(lcol[i]).multiplyScalar((0.3 + 0.7 * f) * glow));
    }
    bulbs.instanceColor.needsUpdate = true;
    bulbMat.emissiveIntensity = 0.9 + 0.7 * n;
    const pulse = Math.sin(t * 1.4);
    starMat.emissiveIntensity = (0.45 + 0.9 * n) * (1 + 0.25 * pulse);
    star.scale.setScalar(1 + 0.04 * pulse); star.rotation.y = 0.35 * Math.sin(t * 0.6);
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
