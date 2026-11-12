/* 2D sprites for the seated office cast. Each species and variant has a sheet (sprites/<species>-<variant>.webp): one row of 5 cells (cell 384x448) of the seated
 * glb, furred with Blender Cycles, seen from azimuth theta0 + cols[k] degrees with an orthographic camera at the office elevation. sprites/manifest.json describes them.
 * The first half of this file is pure (no three, no DOM) so test/office-sprites.test.js can pin it. makeSpriteKit() at the bottom takes the three module as an argument. */
export const SPRITE_THETA0 = Math.PI / 4, SPRITE_MAX_REL_DEG = 42, SPRITE_MAX_ELEV_DEG = 12, SPRITE_HYST_DEG = 2;
export const SPRITE_MIN_ZOOM = 2.0, SPRITE_ZOOM_HYST = 0.15;   /* the overview (zoom 1) keeps the glb with its shell fur for everyone: sprites are for the close views, where the Cycles fur pays off */
const D2R = Math.PI / 180, clamp01 = x => Math.max(0, Math.min(1, x));

/* wrap an angle to (-PI, PI] */
export function wrapPi(a){ a = (a + Math.PI) % (2 * Math.PI); if(a < 0) a += 2 * Math.PI; return a - Math.PI; }
/* the camera azimuth seen from the body: camera azimuth - default azimuth - body yaw (the glb's rotation.y) */
export function relAzimuth(az, bodyYaw, theta0 = SPRITE_THETA0){ return wrapPi(az - theta0 - (bodyYaw || 0)); }
/* The nearest cell of a relative azimuth (radians). glb is true beyond maxDeg: the sprite would look wrong there, so the glb is drawn instead.
 * prev (the last answer) adds a small hysteresis so a camera that rests on a boundary does not flicker between two cells or between sprite and glb. */
export function pickCell(rel, cols, maxDeg = SPRITE_MAX_REL_DEG, prev = null){
  const d = wrapPi(rel) / D2R, a = Math.abs(d); let k = 0, best = Infinity;
  cols.forEach((c, i) => { const e = Math.abs(d - c); if(e < best){ best = e; k = i; } });
  if(prev && !prev.glb && prev.k >= 0 && prev.k < cols.length && prev.k !== k && Math.abs(d - cols[prev.k]) <= best + SPRITE_HYST_DEG) k = prev.k;
  return { k, glb: a > (prev && prev.glb ? maxDeg - SPRITE_HYST_DEG : maxDeg) };
}
/* the camera elevation (radians above the horizon) is close enough to the elevation the sheets were made at (degrees) */
export function elevOk(camElev, elevDeg, maxDeg = SPRITE_MAX_ELEV_DEG){ return Math.abs(camElev / D2R - elevDeg) <= maxDeg; }
/* sprites from SPRITE_MIN_ZOOM up; once on they stay until the zoom drops below SPRITE_MIN_ZOOM - SPRITE_ZOOM_HYST, so a zoom that rests on the boundary does not flicker */
export function zoomOk(zoom, wasOn){ return zoom >= (wasOn ? SPRITE_MIN_ZOOM - SPRITE_ZOOM_HYST : SPRITE_MIN_ZOOM); }
/* The two neighbouring card frames of a model yaw and the mix factor between them (frame i at t 0, frame j at t 1). The yaw clamps at both ends, where i === j.
 * An exact hit gives t 0 on frame i, so the reduced-motion yaw shows one frame untouched. */
export function cardBlend(yaw, yaws){
  const n = yaws.length;
  if(n < 2 || !(yaw > yaws[0])) return { i: 0, j: 0, t: 0 };
  if(yaw >= yaws[n - 1]) return { i: n - 1, j: n - 1, t: 0 };
  let i = 0; while(i + 2 < n && yaw >= yaws[i + 1]) i++;
  return { i, j: i + 1, t: (yaw - yaws[i]) / (yaws[i + 1] - yaws[i]) };
}

/* The sheet variant a person wants. kind is the year-end choice of the office ('crown', 'santa', 'rudolph' or null outside the season), antlerSkip and noNose are the
 * species sets of office-scene.js. A crown keeps its 3D crown and takes only the red nose, so it wants the nose sheet. */
export function wantVariant(kind, species, antlerSkip, noNose){
  if(!kind) return 'plain';
  if(kind === 'santa') return 'santa';
  if(kind === 'crown') return noNose.has(species) ? 'plain' : 'nose';
  return antlerSkip.has(species) ? 'nose' : 'reindeer';
}

const num = x => typeof x === 'number' && isFinite(x), pair = a => Array.isArray(a) && a.length === 2 && a.every(num), triple = a => Array.isArray(a) && a.length === 3 && a.every(num), NAME = /^[a-z0-9-]+$/;
/* The optional card block: baked profile-card frames per species (sprites/<species>-card.webp, the frames side by side in yaw order). A broken block means no cards, the sprites are unaffected. */
function parseCard(c){
  if(!c || typeof c !== 'object' || !pair(c.cell) || c.cell[0] <= 0 || c.cell[1] <= 0 || !num(c.fov) || c.fov <= 0 || c.fov >= 170) return null;
  const y = c.yaws; if(!Array.isArray(y) || !y.length || !y.every(num) || y.some((v, i) => i && v <= y[i - 1])) return null;
  const species = {};
  Object.keys(c.species || {}).forEach(k => { const s = c.species[k]; if(s && NAME.test(k) && triple(s.cam) && triple(s.at)) species[k] = { cam: s.cam.slice(), at: s.at.slice() }; });
  return Object.keys(species).length ? { cell: c.cell.slice(), yaws: y.slice(), fov: c.fov, species } : null;
}
/* manifest.json -> a checked copy, or null when it is unusable (the office then keeps the glb for everyone) */
export function parseManifest(raw, base = ''){
  if(!raw || typeof raw !== 'object' || !num(raw.v)) return null;
  const cell = raw.cell, cols = raw.cols, upp = raw.unitsPerPx;
  if(!pair(cell) || cell[0] <= 0 || cell[1] <= 0 || !Array.isArray(cols) || !cols.length || !cols.every(num) || !num(raw.elev) || !num(upp) || upp <= 0) return null;
  const species = {};
  Object.keys(raw.species || {}).forEach(k => {
    const s = raw.species[k], vs = s && Array.isArray(s.variants) ? s.variants.filter(v => typeof v === 'string' && NAME.test(v)) : [];
    if(s && pair(s.anchor) && vs.includes('plain') && NAME.test(k)) species[k] = { anchor: s.anchor.slice(), variants: vs };
  });
  return { v: raw.v, base, cell: cell.slice(), cols: cols.slice(), elev: raw.elev, upp, species, card: parseCard(raw.card) };
}
/* the variant to draw: the wanted one when its sheet exists, plain otherwise (exact false: the caller keeps the 3D accessories), null when the species has no sheet */
export function pickVariant(man, species, want){
  const s = man && man.species[species]; if(!s) return null;
  if(s.variants.includes(want)) return { variant: want, exact: true };
  return { variant: 'plain', exact: want === 'plain' };
}
/* every asset URL carries the manifest's v, because the CDN keeps files for 4 hours */
export const sheetUrl = (man, species, variant) => `${man.base}${species}-${variant}.webp?v=${man.v}`;
/* the card of a species: its sheet URL, the camera it was baked from (three coordinates of the unscaled pose model) and the frame yaws, or null (no card, the live 3D portrait stays) */
export const cardUrl = (man, species) => `${man.base}${species}-card.webp?v=${man.v}`;
export function cardOf(man, species){
  const c = man && man.card, s = c && c.species[species]; if(!s) return null;
  return { url: cardUrl(man, species), cam: s.cam, at: s.at, yaws: c.yaws, fov: c.fov, cell: c.cell };
}
/* A vertical plane that shows an image made by an orthographic camera at elevation elevDeg: the image is in screen units, so the height is divided by cos(elev).
 * The offsets (dx, dy) move the plane so that its origin is the anchor pixel (the projected model origin). upp is scene units per pixel. */
export function planeSpec(size, anchor, upp, elevDeg){
  const c = Math.cos(elevDeg * D2R), w = size[0] * upp, h = size[1] * upp / c;
  return { w, h, dx: w / 2 - anchor[0] * upp, dy: anchor[1] * upp / c - h / 2 };
}
/* uv rectangle of cell k in a sheet of n cells, in PlaneGeometry vertex order (top-left, top-right, bottom-left, bottom-right) */
export const cellUv = (k, n) => [k / n, 1, (k + 1) / n, 1, k / n, 0, (k + 1) / n, 0];
/* The colour factor that stands in for light on an unlit sprite: 1 by day, about 0.55 and a little warm at night, lifted by lamps, a touch duller under cloud */
export function nightTint(n, lamp = 0, cloud = 0){
  const k = 1 - 0.45 * n * (1 - 0.35 * lamp), dim = 1 - 0.08 * clamp01(cloud) * (1 - n);
  return [k * (1 + 0.06 * n) * dim, k * dim, k * (1 - 0.1 * n) * dim];
}

/* ── the three-dependent part ── */
export function makeSpriteKit(T, man){
  const loader = new T.TextureLoader(), texs = new Map(), mats = new Map(), geos = new Map(), shadowMats = new Map(), depthMats = new Map(), cards = new Map(), cardQuads = [];
  let tint = [1, 1, 1];
  const tex = url => {
    if(!texs.has(url)){
      const p = loader.loadAsync(url).then(t => { t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t; });
      texs.set(url, p); p.catch(() => { if(texs.get(url) === p) texs.delete(url); });
    }
    return texs.get(url);
  };
  const basic = map => { const m = new T.MeshBasicMaterial({ map, alphaTest: 0.5, alphaToCoverage: true, transparent: false, depthWrite: true }); m.color.setRGB(tint[0], tint[1], tint[2]); return m; };
  /* the glb of a person who is drawn as a sprite stays in the scene for its shadow only: a material of the kit's own that writes neither colour nor depth (one per side,
   * because the shadow pass follows the material's side). The species materials are never touched, the town shares them. */
  const shadowMat = side => {
    if(!shadowMats.has(side)) shadowMats.set(side, new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side }));
    return shadowMats.get(side);
  };
  /* the profile card's stand-in for a model's colours: it writes depth only, so the 3D accessories on top are hidden exactly where the body is in front of them */
  const depthMat = side => {
    if(!depthMats.has(side)) depthMats.set(side, new T.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side }));
    return depthMats.get(side);
  };
  const CARD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';   /* clip space: the quad fills the camera view whatever the camera does */
  /* two neighbouring frames of the sheet mixed by t. The mix runs on premultiplied colour, so a transparent texel's colour (black in the file) does not darken the fringe;
   * the result goes out premultiplied because the card's canvas is premultiplied. The texture is sRGB (decoded to linear on sampling), so the colour is encoded again on the way out. */
  const CARD_FS = `uniform sampler2D uMap; uniform float uI, uJ, uT, uN, uHalf; varying vec2 vUv;
    vec4 cell(float k){ return texture2D(uMap, vec2((k + clamp(vUv.x, uHalf, 1.0 - uHalf)) / uN, vUv.y)); }
    void main(){
      vec4 a = cell(uI), b = cell(uJ), p = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), uT);
      vec3 c = p.a > 0.0 ? p.rgb / p.a : vec3(0.0);
      gl_FragColor = vec4(linearToOutputTexel(vec4(c, 1.0)).rgb * p.a, p.a);
    }`;
  return {
    /* the card sheet of a species, loaded on first ask and kept: {t: texture or null, bad: it failed, p: promise}. A failure is remembered so a missing sheet is not asked for again. */
    card(species){
      if(!cards.has(species)){
        const st = { t: null, bad: false, p: null };
        st.p = tex(cardUrl(man, species)).then(t => { st.t = t; return t; }, () => { st.bad = true; return null; });
        cards.set(species, st);
      }
      return cards.get(species);
    },
    /* the full-view quad of the profile card: show(texture, card) points it at a sheet, blend(yaw) picks the frames. Draw it first (renderOrder -2, no depth). */
    cardQuad(){
      const g = new T.PlaneGeometry(2, 2), m = new T.ShaderMaterial({ vertexShader: CARD_VS, fragmentShader: CARD_FS, depthTest: false, depthWrite: false,
        uniforms: { uMap: { value: null }, uI: { value: 0 }, uJ: { value: 0 }, uT: { value: 0 }, uN: { value: 1 }, uHalf: { value: 0 } } });
      const mesh = new T.Mesh(g, m); mesh.renderOrder = -2; mesh.frustumCulled = false;
      const q = {
        mesh, yaws: null,
        show(t, card){ m.uniforms.uMap.value = t; m.uniforms.uN.value = card.yaws.length; m.uniforms.uHalf.value = 0.5 / card.cell[0]; q.yaws = card.yaws; q.blend(card.yaws[Math.min(2, card.yaws.length - 1)]); },
        blend(yaw){ const b = cardBlend(yaw, q.yaws), u = m.uniforms; u.uI.value = b.i; u.uJ.value = b.j; u.uT.value = b.t; },
        dispose(){ g.dispose(); m.dispose(); },
      };
      cardQuads.push(q); return q;
    },
    /* a clone of the pose model for the card: every part that is not under a keepLook node writes depth only and draws first (renderOrder -1), so the baked image shows through
     * and the kept accessories (crown, hat, antlers, nose) are hidden behind the body where they should be. The originals' materials are never touched. */
    depthOnly(root){
      root.traverse(x => {
        if(!x.isMesh || x.userData.fur) return;
        for(let p = x; p; p = p.parent){ if(p.userData.keepLook) return; if(p === root) break; }
        x.material = depthMat(x.material.side); x.renderOrder = -1;
      });
    },
    /* the shared material of a species and variant: a promise (null when the sheet fails to load, so the species keeps its glb), and a synchronous peek */
    material(species, variant){
      const key = species + '-' + variant;
      if(!mats.has(key)){
        const p = tex(sheetUrl(man, species, variant)).then(t => { const m = basic(t); p.m = m; return m; }, () => { mats.delete(key); return null; });
        mats.set(key, p);
      }
      return mats.get(key);
    },
    cached(species, variant){ const p = mats.get(species + '-' + variant); return p && p.m ? p.m : null; },
    /* one plane geometry per species and cell, shared by everyone (sc: the scene scale of the glb) */
    geometry(species, k, sc){
      const key = species + ':' + k;
      if(!geos.has(key)){
        const s = man.species[species], sp = planeSpec(man.cell, s.anchor, man.upp * sc, man.elev), g = new T.PlaneGeometry(sp.w, sp.h);
        g.translate(sp.dx, sp.dy, 0); g.getAttribute('uv').set(cellUv(k, man.cols.length)); geos.set(key, g);
      }
      return geos.get(key);
    },
    setTint(c){ tint = c; mats.forEach(p => { if(p.m) p.m.color.setRGB(c[0], c[1], c[2]); }); },
    /* on: the glb draws nothing but its shadow (parts under a keepLook node, the crown and the kept accessories, stay drawn); off: it is whole again.
     * The fur shells move to layer 2, which no camera looks at: the fur lod toggles their visible flag every frame, so that flag cannot be used. */
    shadowOnly(root, on){
      root.traverse(x => {
        if(!x.isMesh) return;
        if(x.userData.fur){ x.layers.set(on ? 2 : 0); return; }
        if(on){
          if(x.userData.sprMat0) return;
          for(let p = x; p && p !== root.parent; p = p.parent) if(p.userData.keepLook) return;
          x.userData.sprMat0 = x.material; x.material = shadowMat(x.material.side);
        }else if(x.userData.sprMat0){ x.material = x.userData.sprMat0; x.userData.sprMat0 = null; }
      });
    },
    dispose(){
      cardQuads.forEach(q => q.dispose()); cardQuads.length = 0; depthMats.forEach(m => m.dispose()); depthMats.clear(); cards.clear();
      geos.forEach(g => g.dispose()); geos.clear(); shadowMats.forEach(m => m.dispose()); shadowMats.clear();
      mats.forEach(p => { if(p.m) p.m.dispose(); }); mats.clear();
      texs.forEach(p => p.then(t => t.dispose(), () => {})); texs.clear();
    },
  };
}
