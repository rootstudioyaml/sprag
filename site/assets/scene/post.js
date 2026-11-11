/* Post-processing for the town and office scenes: ambient occlusion (GTAO), bloom that grows at night, a tilt-shift blur that
 * makes the island read as a miniature diorama, and a light colour grade with a vignette.
 *
 * makePost(T, renderer, scene, camera, opts) loads the passes from the same three@0.160.0 build the scenes use and resolves to
 * { render(), setSize(w, h), setNight(n), on, dispose() }, or to null when the effects are off for this device.
 * The effects are off on narrow screens, when ?fx=0 is in the URL, and they switch themselves off for good (on = false) when
 * the frame interval stays over 34 ms for two seconds. ?fx=1 forces them on and skips that check (recordings, screenshots).
 *
 * The canvas is transparent over a CSS sky, so every pass keeps alpha: the frame is premultiplied (NormalBlending into a cleared
 * target gives rgb * a, a), the blur averages premultiplied texels and the grade works on unpremultiplied colour.
 * Objects that should not cast occlusion (signboards drawn on top, labels, glow sprites, anything transparent) are hidden from the
 * GTAO normal and depth pass; mark extra ones with userData.noAO. */
const ADDON = p => import(`https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/${p}.js/+esm`);

export function fxMode(){
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('fx') : null;
  return q === '0' ? 'off' : q === '1' ? 'force' : 'auto';
}

const GRADE = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.12 }, contrast: { value: 1.05 }, vig: { value: 0.28 }, warm: { value: 0.025 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, contrast, vig, warm; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv); float a = c.a; if(a < 0.002){ gl_FragColor = c; return; }
      vec3 s = c.rgb / a; float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
      s = mix(vec3(l), s, sat); s = (s - 0.5) * contrast + 0.5; s += vec3(warm, warm * 0.4, -warm);
      float d = distance(vUv, vec2(0.5)); s *= mix(1.0, smoothstep(0.95, 0.35, d), vig);
      gl_FragColor = vec4(clamp(s, 0.0, 1.0) * a, a);
    }`
};
/* one-direction tilt-shift: 9 taps along dir, the radius grows with the distance from the focus band [f0, f1] in screen y */
const TILT = {
  uniforms: { tDiffuse: { value: null }, dir: { value: [0, 0] }, f0: { value: 0.3 }, f1: { value: 0.72 }, amt: { value: 1 } },
  vertexShader: GRADE.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 dir; uniform float f0, f1, amt; varying vec2 vUv;
    void main(){
      float k = amt * (vUv.y < f0 ? (f0 - vUv.y) / f0 : vUv.y > f1 ? (vUv.y - f1) / (1.0 - f1) : 0.0);
      if(k <= 0.0){ gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 o = dir * k * k * 4.0; vec4 s = vec4(0.0);
      s += texture2D(tDiffuse, vUv - 4.0 * o) * 0.051; s += texture2D(tDiffuse, vUv - 3.0 * o) * 0.0918; s += texture2D(tDiffuse, vUv - 2.0 * o) * 0.12245;
      s += texture2D(tDiffuse, vUv - o) * 0.1531; s += texture2D(tDiffuse, vUv) * 0.1633; s += texture2D(tDiffuse, vUv + o) * 0.1531;
      s += texture2D(tDiffuse, vUv + 2.0 * o) * 0.12245; s += texture2D(tDiffuse, vUv + 3.0 * o) * 0.0918; s += texture2D(tDiffuse, vUv + 4.0 * o) * 0.051;
      gl_FragColor = s;
    }`
};

export async function makePost(T, renderer, scene, camera, opts = {}){
  const mode = fxMode();
  if(mode === 'off' || (mode === 'auto' && opts.mobile && opts.mobile())) return null;
  if(!renderer.capabilities.isWebGL2) return null;
  const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all(
    ['postprocessing/EffectComposer', 'postprocessing/RenderPass', 'postprocessing/GTAOPass', 'postprocessing/UnrealBloomPass', 'postprocessing/OutputPass', 'postprocessing/ShaderPass'].map(ADDON));
  const o = { ao: 1, aoRadius: 4, bloom: 0.9, tilt: 1, sat: 1.12, aoview: 0, aoscale: 1.5, aothick: 10, ...opts.look };
  /* ?fxl=ao:0.5,tilt:0 overrides the look numbers (tuning only) */
  const fxl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('fxl') : null;
  if(fxl) fxl.split(',').forEach(kv => { const [k, v] = kv.split(':'); if(k in o && isFinite(+v)) o[k] = +v; });
  const size = new T.Vector2(); renderer.getSize(size);
  const rt = new T.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: T.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));

  const ao = new GTAOPass(scene, camera, size.x, size.y);
  /* three 0.160 sets gtaoMaterial.definesPERSPECTIVE_CAMERA (typo), so an orthographic camera is read as perspective */
  ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = camera.isPerspectiveCamera ? 1 : 0;
  /* and the view direction is taken from the pixel position, which only holds for a perspective camera */
  ao.gtaoMaterial.fragmentShader = ao.gtaoMaterial.fragmentShader.replace('vec3 viewDir = normalize(-viewPos.xyz);',
    '\n#if PERSPECTIVE_CAMERA == 1\nvec3 viewDir = normalize(-viewPos.xyz);\n#else\nvec3 viewDir = vec3(0., 0., 1.);\n#endif\n');
  ao.gtaoMaterial.needsUpdate = true;
  ao.updateGtaoMaterial({ radius: o.aoRadius, distanceExponent: 1.6, thickness: o.aothick, distanceFallOff: 1, scale: o.aoscale, samples: 12 });
  if(o.aoview) ao.output = GTAOPass.OUTPUT.Denoise;
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  ao.blendIntensity = o.ao;
  const ovr = ao.overrideVisibility.bind(ao);
  ao.overrideVisibility = function(){
    ovr();
    scene.traverse(x => { const m = x.material; if(x.userData.noAO || x.isSprite || (m && !Array.isArray(m) && (m.transparent || m.depthTest === false || (m.isMeshBasicMaterial && m.toneMapped === false)))) x.visible = false; });   /* unlit glow strips carry no usable normals and came out black */
  };
  ao.enabled = o.ao > 0; composer.addPass(ao);

  const bloom = new UnrealBloomPass(new T.Vector2(size.x, size.y), o.bloom, 0.55, 0.82);
  /* the blur mips are written with alpha 1, so the stock additive blend turned the transparent sky opaque black at night:
   * add the glow to rgb only and keep the frame's alpha (glow over the sky composites additively on the page) */
  Object.assign(bloom.blendMaterial, { blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor });
  bloom.enabled = false; composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const th = new ShaderPass(TILT), tv = new ShaderPass(TILT);
  composer.addPass(th); composer.addPass(tv);
  const grade = new ShaderPass(GRADE); grade.uniforms.sat.value = o.sat; composer.addPass(grade);

  let W = size.x, H = size.y, last = 0, slow = 0, dead = false, zm = 1;
  /* zoomed in, the world-space AO radius covers many screen pixels and its sampling noise shows as grain on walls and desk legs,
   * and the tilt-shift starts blurring the very desks being looked at: both shrink with the zoom factor */
  const zk = () => Math.max(1, zm);
  function tilt(){
    const amt = 0.9 * o.tilt / Math.sqrt(zk());
    th.uniforms.dir.value = [amt / W, 0]; tv.uniforms.dir.value = [0, amt / H];
    th.enabled = tv.enabled = o.tilt > 0;
  }
  const api = {
    on: true,
    setSize(w, h){ W = w; H = h; composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); tilt(); },
    /* n: 0 day .. 1 night. Bloom only runs when there is something to glow (lit windows, lamps). */
    setNight(n){ bloom.enabled = n > 0.08; bloom.strength = o.bloom * n; grade.uniforms.warm.value = 0.025 * (1 - n) - 0.01 * n; grade.uniforms.sat.value = o.sat + 0.06 * n; },
    setLook(l){ Object.assign(o, l); ao.blendIntensity = o.ao / Math.sqrt(zk()); ao.updateGtaoMaterial({ radius: o.aoRadius / zk() }); grade.uniforms.sat.value = o.sat; api.setSize(W, H); },
    /* camera zoom (1 = the fitted overview); cheap to call every frame, it only acts on a real change */
    setZoom(z){ if(!(z > 0) || Math.abs(z - zm) < 0.02 * zm) return; zm = z; ao.updateGtaoMaterial({ radius: o.aoRadius / zk() }); ao.blendIntensity = o.ao / Math.sqrt(zk()); tilt(); },
    render(){
      if(!api.on){ camera.layers.mask = 3; renderer.render(scene, camera); return; }
      const t = performance.now();
      if(mode === 'auto' && last){ const d = t - last; slow = d > 34 && d < 500 ? slow + d : Math.max(0, slow - d); if(slow > 2000){ api.on = false; if(opts.onSlow) opts.onSlow(); } }
      last = t;
      /* overlays (signboards) skip the passes so their text stays sharp: they move to layer 1 and are drawn on top afterwards */
      const ov = opts.overlay ? opts.overlay() : [];
      ov.forEach(m => { if(m && !m.userData.ovl){ m.userData.ovl = 1; m.traverse(c => c.layers.set(1)); } });
      camera.layers.set(0); composer.render();
      /* the full-screen passes leave depth 0 behind, so clear it first: overlays are depth-tested only against each other */
      if(ov.length){ camera.layers.set(1); const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, camera); renderer.autoClear = ac; }
      camera.layers.mask = 3;
    },
    /* call when the loop stops (a still scene renders on request), so the gap is not counted as a slow frame */
    idle(){ last = 0; },
    dispose(){ if(dead) return; dead = true; api.on = false; composer.passes.forEach(p => p.dispose && p.dispose()); rt.dispose(); composer.dispose && composer.dispose(); }
  };
  api.setSize(W, H);
  return api;
}
