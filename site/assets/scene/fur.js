/* Plush look for the cast models (three r160), shared by the office and the town.
 *
 *   const fur = makeFur(T, { shells: 16 });   shells: 0 keeps the lighting only (no extra draw call)
 *   fur.apply(model);                          shell fur on the baked skin: N instanced shells per furred mesh
 *   fur.setNight(n);                           cast brightness gain, warm by day and almost neutral at night
 *   fur.lod(pxPerUnit);                        shell count from the on-screen size, call it every frame
 *   softLook(T, material);                     the same soft lighting for a scene material (trees, bushes)
 *
 * Lighting on every furred mesh and its shells: the wrap goes on the diffuse term only. Wrapping the shared dotNL also fed the GGX lobe,
 * whose visibility term is about 5e5 where both N.L and N.V are zero, so silhouettes got infinite pixels and white dots under the half-float
 * post chain. A gain lifts the cast towards the soft reference look (measured 1.2 to 1.5 times brighter than the plain render).
 *
 * What grows fur is decided in three steps at load time, once per geometry (the vertex attribute aFur, 0..1):
 *   1. by material name: only the baked body "skin", wings and tail tips;
 *   2. by distance: no fur next to any other mesh of the model (eyes, nose, mouth, badge and accessories float just above the skin);
 *   3. by texture colour: the clothes are baked into the skin texture, so green, saturated blue and purple count as cloth.
 * Step 3 is a heuristic that was checked by eye on all thirty species. A warm-coloured cloth would grow fur. */

const FURRY = /^(skin|wing|wingc|tailf|tailtip)$/;   /* material names that grow fur */
export const isFurMaterial = name => FURRY.test(String(name || '').replace(/\.\d+$/, ''));
/* Cloth colours in sRGB bytes: green or teal, a saturated blue, or purple and lavender (blue over red over green). The grey-blue fur of the
 * wolf and the husky has green over red, so it stays fur. Measured on the textures of 13 species. */
export const isClothRgb = (r, g, b) => (g > r * 1.06 + 5 && g >= b - 3) || b > r * 1.3 + 3 || (b > r * 1.12 + 3 && r > g + 4);
/* Shell count: about one shell per screen pixel of fur length, 4 to `shells`; none when the fur is shorter than minPx on screen.
 * px is screen pixels per model unit (camera scale times the model's scale). */
export function furShellCount(len, px, shells, minShells = 4, minPx = 1.6){
  if(!(shells > 0) || !(px > 0) || len * px < minPx) return 0;
  return Math.max(Math.min(minShells, shells), Math.min(shells, Math.round(len * px * 1.1)));
}
export const GAIN_DAY = [1.16, 1.12, 1.04], GAIN_NIGHT = [1.04, 1.02, 1.0];
/* the cast gain for a night share n (0 day, 1 night) */
export const castGain = n => { const k = Math.min(1, Math.max(0, +n || 0)); return GAIN_DAY.map((d, i) => d + (GAIN_NIGHT[i] - d) * k); };

const clones = new WeakMap();                         /* source material -> { key: patched clone } */
function cloneOnce(src, key, make){
  let m = clones.get(src); if(!m) clones.set(src, m = {});
  return m[key] || (m[key] = make(src));
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* Strand height field, 96^3, one byte per voxel, tileable: one paraboloid per cell of a jittered grid, each with its own height.
 * A shell at height h shows the texels above h, so every strand is a blunt cone: wide at the root, a point at its own tip. */
let furTex = null;
export function furTexture(T){
  if(furTex) return furTex;
  const S = 96, C = 6, G = S / C, f = new Float32Array(S * S * S), d = new Uint8Array(S * S * S);
  let s = 20261112;
  const rnd = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const w = v => ((v % S) + S) % S;
  for(let k = 0; k < G; k++) for(let j = 0; j < G; j++) for(let i = 0; i < G; i++){
    const cx = (i + 0.5 + (rnd() - 0.5) * 0.85) * C, cy = (j + 0.5 + (rnd() - 0.5) * 0.85) * C, cz = (k + 0.5 + (rnd() - 0.5) * 0.85) * C;
    const r = C * (0.6 + 0.22 * rnd()), h = 0.32 + 0.68 * Math.pow(rnd(), 0.8), R = Math.ceil(r), r2 = r * r;
    for(let z = Math.floor(cz - R); z <= cz + R; z++) for(let y = Math.floor(cy - R); y <= cy + R; y++) for(let x = Math.floor(cx - R); x <= cx + R; x++){
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz, q = (dx * dx + dy * dy + dz * dz) / r2; if(q >= 1) continue;
      const v = h * (1 - q), n = (w(z) * S + w(y)) * S + w(x); if(v > f[n]) f[n] = v;
    }
  }
  for(let i = 0; i < f.length; i++) d[i] = Math.round(f[i] * 255);
  const t = new T.Data3DTexture(d, S, S, S);
  t.format = T.RedFormat; t.type = T.UnsignedByteType; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = T.RepeatWrapping; t.generateMipmaps = true; t.unpackAlignment = 1; t.needsUpdate = true;
  return furTex = t;
}

/* points in a hash grid: cell size r, so a search of the 27 cells round a point finds everything within r */
function grid3(r){
  const m = new Map(), ck = v => Math.floor(v / r) + 512, key = (x, y, z) => x + y * 1024 + z * 1048576;
  return {
    put(x, y, z, ...extra){ const k = key(ck(x), ck(y), ck(z)); let l = m.get(k); if(!l) m.set(k, l = []); l.push(x, y, z, ...extra); },
    near(x, y, z, stride, fn){
      const x0 = ck(x), y0 = ck(y), z0 = ck(z);
      for(let c = z0 - 1; c <= z0 + 1; c++) for(let b = y0 - 1; b <= y0 + 1; b++) for(let a = x0 - 1; a <= x0 + 1; a++){
        const l = m.get(key(a, b, c)); if(!l) continue;
        for(let n = 0; n < l.length; n += stride){ const dx = l[n] - x, dy = l[n + 1] - y, dz = l[n + 2] - z; fn(dx * dx + dy * dy + dz * dz, l, n); }
      }
    }
  };
}
/* RGBA bytes of a texture image at up to 512 px (the downscale also evens out JPEG noise), cached on the texture */
function texPixels(tex){
  const im = tex && tex.image; if(!im || !im.width) return null;
  if(tex.userData.furPx) return tex.userData.furPx;
  const w = Math.min(512, im.width), h = Math.min(512, im.height);
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, w, h);
  return tex.userData.furPx = { w, h, d: x.getImageData(0, 0, w, h).data, flip: tex.flipY };
}
const cool = (d, i) => isClothRgb(d[i], d[i + 1], d[i + 2]);

/* How much fur each vertex of a furred mesh grows (0..1), stored on the shared geometry as the attribute aFur. See the three steps above. */
function furMask(T, mesh, model, P){
  const g = mesh.geometry; if(g.getAttribute('aFur')) return;
  model.updateMatrixWorld(true);
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv'), ix = g.index, n = pos.count, out = new Float32Array(n).fill(1);
  const inv = new T.Matrix4().copy(mesh.matrixWorld).invert(), M = new T.Matrix4(), v = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const feat = grid3(P.d1);
  model.traverse(o => {
    if(!o.isMesh || o === mesh || o.userData.fur || o.isInstancedMesh || o.userData.furry) return;   /* another furred part (wing, tail tip) is no obstacle: the two coats run into each other */
    const p = o.geometry.getAttribute('position'), oi = o.geometry.index; M.multiplyMatrices(inv, o.matrixWorld);
    for(let i = 0; i < p.count; i++){ v.fromBufferAttribute(p, i).applyMatrix4(M); feat.put(v.x, v.y, v.z); }
    if(oi) for(let i = 0; i < oi.count; i += 3){
      a.fromBufferAttribute(p, oi.getX(i)); b.fromBufferAttribute(p, oi.getX(i + 1)); c.fromBufferAttribute(p, oi.getX(i + 2));
      v.copy(a).add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(M); feat.put(v.x, v.y, v.z);
    }
  });
  for(let i = 0; i < n; i++){
    let best = P.d1 * P.d1; feat.near(pos.getX(i), pos.getY(i), pos.getZ(i), 3, q => { if(q < best) best = q; });
    out[i] = sstep(P.d0, P.d1, Math.sqrt(best));
  }
  /* cloth by texture colour: the area-weighted share of cool-coloured triangles within P.clothR of the vertex */
  const px = P.cloth ? texPixels(mesh.material.map) : null;
  if(px && uv && ix){
    const tri = grid3(P.clothR);
    const at = (u, w) => { const x = Math.min(px.w - 1, Math.max(0, Math.floor(u * px.w))), y = Math.min(px.h - 1, Math.max(0, Math.floor((px.flip ? 1 - w : w) * px.h))); return cool(px.d, (y * px.w + x) * 4) ? 0.25 : 0; };
    for(let i = 0; i < ix.count; i += 3){
      const ia = ix.getX(i), ib = ix.getX(i + 1), ic = ix.getX(i + 2), ua = uv.getX(ia), va = uv.getY(ia), ub = uv.getX(ib), vb = uv.getY(ib), uc = uv.getX(ic), vc = uv.getY(ic);
      const share = at((ua + ub + uc) / 3, (va + vb + vc) / 3) + at(ua * 0.6 + ub * 0.2 + uc * 0.2, va * 0.6 + vb * 0.2 + vc * 0.2) + at(ua * 0.2 + ub * 0.6 + uc * 0.2, va * 0.2 + vb * 0.6 + vc * 0.2) + at(ua * 0.2 + ub * 0.2 + uc * 0.6, va * 0.2 + vb * 0.2 + vc * 0.6);
      a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
      const area = v.copy(b).sub(a).cross(c.clone().sub(a)).length() * 0.5 + 1e-9;
      tri.put((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3, share, area);
    }
    const r2 = P.clothR * P.clothR;
    for(let i = 0; i < n; i++){
      let num = 0, den = 0; tri.near(pos.getX(i), pos.getY(i), pos.getZ(i), 5, (q, l, k) => { if(q >= r2) return; const w = l[k + 4] * (1 - Math.sqrt(q) / P.clothR); num += w * l[k + 3]; den += w; });
      if(den > 0) out[i] *= 1 - sstep(0.04, 0.24, num / den);
    }
  }
  /* thin parts and creases: where a surface that faces the other way is close (the far side of a leg, an ear, the chin over the chest),
   * the fur is shortened in proportion, so a thin leg does not turn into a bottle brush and fur does not poke through a neighbour */
  if(P.thin > 0 && nor){
    const all = grid3(P.thin); for(let i = 0; i < n; i++) all.put(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
    for(let i = 0; i < n; i++){
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i); let best = P.thin * P.thin;
      all.near(pos.getX(i), pos.getY(i), pos.getZ(i), 6, (q, l, k) => { if(q < best && l[k + 3] * nx + l[k + 4] * ny + l[k + 5] * nz < -0.25) best = q; });
      out[i] *= Math.max(P.thinMin, Math.min(1, Math.sqrt(best) / P.thin));
    }
  }
  g.setAttribute('aFur', new T.BufferAttribute(out, 1));
}

const V_PARS = `
attribute float aFur;
uniform float uFurLen, uFurShells, uFurNB;
uniform vec3 uFurDroop;
varying vec3 vFurP; varying float vFurH; varying float vFurMask;`;
const V_MAIN = `
vFurP = position; vFurMask = aFur; vFurH = 0.0;
#ifdef FUR_SHELL
  vFurH = ( float( gl_InstanceID ) + 1.0 ) / uFurShells;
  transformed += normalize( objectNormal ) * ( uFurLen * aFur * vFurH ) + uFurDroop * ( aFur * vFurH * vFurH );
#endif`;
const F_PARS = `
uniform mediump sampler3D tFur;
uniform mat3 uFurRot;
uniform vec3 uCastGain;
uniform float uFurFreq, uFurRoot, uFurTip, uFurTipWhite, uFurClump, uFurUnder, uFurWrap, uFuzz, uFuzzPow, uGrain, uFurSoft, uFurCloth;
varying vec3 vFurP; varying float vFurH; varying float vFurMask;`;
const F_MAP = `
{
  vec3 fq = uFurRot * vFurP * uFurFreq;
  /* cloth is baked into the same texture: green, saturated blue and purple grow no fur (the same rule as isClothRgb, on sRGB values) */
  vec3 fc = pow( max( diffuseColor.rgb, vec3( 1e-4 ) ), vec3( 0.4545 ) );
  float fGreen = smoothstep( 0.0, 0.03, fc.g - fc.r * 1.06 - 0.02 ) * step( fc.b - 0.012, fc.g );
  float fBlue = smoothstep( 0.0, 0.03, fc.b - fc.r * 1.3 - 0.012 );
  float fPurple = smoothstep( 0.0, 0.03, fc.b - fc.r * 1.12 - 0.012 ) * smoothstep( 0.0, 0.03, fc.r - fc.g - 0.016 );
  float fCool = uFurCloth * max( fGreen, max( fBlue, fPurple ) );
  float fOn = smoothstep( 0.02, 0.2, vFurMask ) * ( 1.0 - fCool );
  float fLum = dot( diffuseColor.rgb, vec3( 0.3, 0.6, 0.1 ) );
  float fRoot = mix( uFurRoot, 1.0, 0.55 * fLum );   /* pale fur keeps pale roots, or white turns grey */
  /* seen from far away a strand is smaller than a pixel and the dark roots only read as dirt: the shading flattens with the on-screen size */
  float fDet = 1.0 - smoothstep( 0.035, 0.085, length( fwidth( fq ) ) );
  fRoot = mix( 1.0, fRoot, 0.4 + 0.6 * fDet );
  #ifdef FUR_SHELL
    float fS = texture( tFur, fq ).r;
    float fC = texture( tFur, fq * 0.23 + vec3( 0.37, 0.11, 0.73 ) ).r;
    float fT = vFurH / mix( 1.0 - uFurClump, 1.0, smoothstep( 0.02, 0.45, fC ) );
    float fW = clamp( fwidth( fS ) * 0.8, uFurSoft, 0.3 );
    float fA = smoothstep( fT - fW, fT + fW, fS ) * fOn;
    if ( fA < 0.004 ) discard;
    float fK = pow( vFurH, 0.8 );
    diffuseColor.rgb *= mix( fRoot, uFurTip, fK );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), uFurTipWhite * fK * fK );
    diffuseColor.a *= fA;
  #else
    diffuseColor.rgb *= mix( 1.0, fRoot, fOn * uFurUnder );
    if ( uGrain > 0.0 ) diffuseColor.rgb *= 1.0 + uGrain * fOn * ( texture( tFur, fq ).r - 0.3 );
  #endif
  diffuseColor.rgb *= uCastGain;
}`;
const F_FUZZ = `
{
  float fF = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), uFuzzPow );
  #ifdef FUR_SHELL
    fF *= 0.35 + 0.65 * vFurH;
  #endif
  outgoingLight += ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse ) * fF * uFuzz;
}`;
/* The shells are drawn many times over each other, so their sun shadow is a 2 by 2 bilinear lookup (4 fetches) instead of the 16 of PCF soft. */
const F_SHADOW = `
#ifdef USE_SHADOWMAP
float furShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  shadowCoord.xyz /= shadowCoord.w; shadowCoord.z += shadowBias;
  if ( shadowCoord.x < 0.0 || shadowCoord.x > 1.0 || shadowCoord.y < 0.0 || shadowCoord.y > 1.0 || shadowCoord.z > 1.0 ) return 1.0;
  vec2 texel = 1.0 / shadowMapSize, uv = shadowCoord.xy, f = fract( uv * shadowMapSize + 0.5 ); uv -= f * texel;
  float a = texture2DCompare( shadowMap, uv, shadowCoord.z ), b = texture2DCompare( shadowMap, uv + vec2( texel.x, 0.0 ), shadowCoord.z );
  float c = texture2DCompare( shadowMap, uv + vec2( 0.0, texel.y ), shadowCoord.z ), d = texture2DCompare( shadowMap, uv + texel, shadowCoord.z );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
#endif`;
const DOT_NL = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
const WRAP_NL = 'float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + uFurWrap ) / ( 1.0 + uFurWrap ) );';
const DIFFUSE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
const WRAP_DIFFUSE = 'reflectedLight.directDiffuse += saturate( ( dot( geometryNormal, directLight.direction ) + uFurWrap ) / ( 1.0 + uFurWrap ) ) * directLight.color * BRDF_Lambert( material.diffuseColor );';
const NB = 'directionalLightShadows[ i ].shadowNormalBias';
const SUN_SHADOW = 'getShadow( directionalShadowMap[ i ]';

export function makeFur(T, o = {}){
  const P = { shells: 16, len: 0.056, freq: 6, root: 0.62, tip: 1.06, tipWhite: 0.14, clump: 0.42, droop: 0.22, under: 1, soft: 0.07,
    wrap: 0.3, nb: 0.07, fuzz: 0.3, fuzzPow: 2.5, grain: 0, d0: 0.012, d1: 0.075, cloth: 1, clothR: 0.05, thin: 0.16, thinMin: 0.3, lite: 1, minShells: 4, minPx: 1.6, ...o };
  const rot = new T.Matrix3().setFromMatrix4(new T.Matrix4().makeRotationAxis(new T.Vector3(1, 2, 3).normalize(), 0.9));
  const U = { tFur: { value: furTexture(T) }, uFurRot: { value: rot }, uFurFreq: { value: P.freq }, uFurLen: { value: P.len }, uFurShells: { value: Math.max(1, P.shells) },
    uFurRoot: { value: P.root }, uFurTip: { value: P.tip }, uFurTipWhite: { value: P.tipWhite }, uFurClump: { value: P.clump }, uFurUnder: { value: P.shells > 0 ? P.under : 0 },
    uFurDroop: { value: new T.Vector3(0, -P.droop * P.len, 0) }, uFurWrap: { value: P.wrap }, uFurNB: { value: P.nb }, uFuzz: { value: P.fuzz }, uFuzzPow: { value: P.fuzzPow },
    uGrain: { value: P.grain }, uFurSoft: { value: P.soft }, uFurCloth: { value: P.cloth ? 1 : 0 }, uCastGain: { value: new T.Vector3(...GAIN_DAY) } };
  const id = 'fur' + (makeFur.n = (makeFur.n || 0) + 1);
  const warn = (s, a, what) => { if(!s.includes(a)) console.warn('fur: patch point missing', what); return s; };
  function patch(mt, shell){
    if(shell) mt.defines = { ...mt.defines, FUR_SHELL: '' };
    mt.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      /* function replacements: a plain string would have its dollar signs read as replacement patterns */
      const sub = (s, a, b) => warn(s, a, a).replace(a, () => b);
      const shadowV = warn(T.ShaderChunk.shadowmap_vertex, NB, 'normal bias').split(NB).join('( ' + NB + ' + uFurNB )');
      const lk = mt.isMeshLambertMaterial ? 'lights_lambert_pars_fragment' : 'lights_physical_pars_fragment';
      const lightsF = mt.isMeshLambertMaterial ? sub(T.ShaderChunk[lk], DOT_NL, WRAP_NL) : sub(T.ShaderChunk[lk], DIFFUSE, WRAP_DIFFUSE);
      let vs = sh.vertexShader, fs = sh.fragmentShader;
      vs = sub(vs, '#include <common>', '#include <common>\n' + V_PARS);
      vs = sub(vs, '#include <begin_vertex>', '#include <begin_vertex>\n' + V_MAIN);
      vs = sub(vs, '#include <shadowmap_vertex>', shadowV);
      fs = sub(fs, '#include <common>', '#include <common>\n' + F_PARS);
      fs = sub(fs, '#include <map_fragment>', '#include <map_fragment>\n' + F_MAP);
      fs = sub(fs, '#include <' + lk + '>', lightsF);
      if(shell && P.lite){
        fs = sub(fs, '#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + F_SHADOW);
        fs = sub(fs, '#include <lights_fragment_begin>', sub(T.ShaderChunk.lights_fragment_begin, SUN_SHADOW, 'furShadow( directionalShadowMap[ i ]'));
      }
      fs = sub(fs, '#include <opaque_fragment>', F_FUZZ + '\n#include <opaque_fragment>');
      sh.vertexShader = vs; sh.fragmentShader = fs;
    };
    mt.customProgramCacheKey = () => id + (shell ? ':shell' : ':base');
    mt.userData = { ...mt.userData, looked: true }; mt.needsUpdate = true;
    return mt;
  }
  const base = src => cloneOnce(src, id + ':base', s => patch(s.clone(), false));
  /* the shell material: Lambert (the skin is fully rough, so its specular lobe adds nothing but cost), blended, no depth write, front faces only */
  const shellM = src => cloneOnce(src, id + ':shell', s => {
    const m = P.lite ? new T.MeshLambertMaterial({ color: s.color.clone(), map: s.map || null }) : s.clone();
    m.name = s.name; if(!P.lite) m.normalMap = null;
    m.transparent = true; m.depthWrite = false; m.side = T.FrontSide; return patch(m, true);
  });
  const ims = new Set(), uses = new Map(), srcOf = new WeakMap();   /* uses: source material -> furred meshes still holding its patched clones */
  return {
    P, U,
    /* fur lighting (and shells when P.shells > 0) on every mesh of the model whose material name matches */
    apply(model){
      const list = []; model.traverse(c => { if(c.isMesh && !c.isInstancedMesh && !c.userData.fur && c.material && isFurMaterial(c.material.name)) list.push(c); });
      list.forEach(c => { c.userData.furry = true; });
      list.forEach(c => {
        furMask(T, c, model, P);
        const src = c.material; c.material = base(src); srcOf.set(c, src); uses.set(src, (uses.get(src) || 0) + 1);
        if(P.shells > 0){
          const im = new T.InstancedMesh(c.geometry, shellM(src), P.shells);
          im.name = 'fur'; im.userData.fur = true; im.castShadow = false; im.receiveShadow = true; im.raycast = () => {};
          if(!c.geometry.boundingSphere) c.geometry.computeBoundingSphere();
          im.boundingSphere = c.geometry.boundingSphere.clone(); im.boundingSphere.radius += P.len * 1.5;
          c.add(im); ims.add(im);
        }
      });
      return model;
    },
    /* a model leaves the scene: its shell meshes free their instance buffers; the patched materials, shared by every model of the species, go
     * only when the last furred mesh using them is released (the geometry belongs to the glTF cache, whose owner disposes it) */
    release(root){
      const gone = [], meshes = [];
      root.traverse(c => { if(ims.has(c)) gone.push(c); else if(srcOf.has(c)) meshes.push(c); });
      gone.forEach(im => { ims.delete(im); if(im.parent) im.parent.remove(im); im.dispose(); });
      meshes.forEach(c => {
        const src = srcOf.get(c); srcOf.delete(c); const n = (uses.get(src) || 1) - 1;
        if(n > 0){ uses.set(src, n); return; }
        uses.delete(src); const m = clones.get(src);
        if(m) Object.keys(m).forEach(k => { if(k.startsWith(id + ':')){ m[k].dispose(); delete m[k]; } });
      });
      if(!uses.size && furTex) furTex.dispose();
    },
    /* brightness gain of the cast for a night share n (0 day, 1 night) */
    setNight(n){ const g = castGain(n); U.uCastGain.value.set(g[0], g[1], g[2]); },
    /* level of detail: sets InstancedMesh.count and one uniform, cheap enough for every frame. Returns the shell count in use. */
    lod(px){
      const n = furShellCount(P.len, px, P.shells, P.minShells, P.minPx);
      ims.forEach(im => { im.count = n; im.visible = n > 0; }); if(n > 0) U.uFurShells.value = n;
      return n;
    },
    shellMeshes: ims
  };
}

/* Soft lighting for a scene material (MeshStandardMaterial: tree crowns, bushes): diffuse wrap, a warm bounce on faces that look down (the
 * underside of a leaf mass catching light from the ground) and a faint rim. Wrap is on the diffuse term only, see the header. It chains
 * after an onBeforeCompile the material already has (wind in the tree crown). */
const SOFT = { uSoftNight: { value: 0 } };
export function softNight(n){ SOFT.uSoftNight.value = Math.min(1, Math.max(0, +n || 0)); }
export function softLook(T, mat, o = {}){
  if(!mat || mat.userData.soft || mat.isMeshBasicMaterial) return mat;
  const wrap = (o.wrap != null ? o.wrap : 0.28).toFixed(3), under = (o.under != null ? o.under : 0.16).toFixed(3), rim = (o.rim != null ? o.rim : 0.1).toFixed(3);
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    if(prev) prev.call(mat, sh, r);
    sh.uniforms.uSoftNight = SOFT.uSoftNight;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', () => '#include <common>\nuniform float uSoftNight;')
      .replace('#include <lights_physical_pars_fragment>', () => T.ShaderChunk.lights_physical_pars_fragment.replace(DIFFUSE, () =>
        'reflectedLight.directDiffuse += saturate( ( dot( geometryNormal, directLight.direction ) + ' + wrap + ' ) / ( 1.0 + ' + wrap + ' ) ) * directLight.color * BRDF_Lambert( material.diffuseColor );'))
      .replace('#include <opaque_fragment>', () => `{
  vec3 sUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float sUnder = saturate( -dot( normal, sUp ) * 0.9 + 0.1 ) * ( 1.0 - 0.7 * uSoftNight );
  float sRim = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), 3.0 );
  outgoingLight += diffuseColor.rgb * vec3( 1.0, 0.78, 0.5 ) * sUnder * ${under} + diffuseColor.rgb * vec3( 1.0, 0.92, 0.8 ) * sRim * ${rim} * ( 1.0 - 0.6 * uSoftNight );
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'soft' + wrap + under + rim + (prevKey ? prevKey.call(mat) : prev ? String(prev) : '');
  mat.userData.soft = true; mat.needsUpdate = true;
  return mat;
}
