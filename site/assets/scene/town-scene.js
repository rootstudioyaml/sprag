/* Sprag town: an animated three.js overview of ALL companies for the operator (site/ops list view only, never site/team).
 *
 *   const ctl = mountTownScene(container, townSceneData({...}), { onOpenOrg(id), onFail(reason) });   // ctl = { update(data), destroy() }
 *
 * Sprag HQ in the middle, one office building per company on a ring around it. Footprint and height follow the contracted seats,
 * every window is a seat (warm lit = in use, dark = unused), delivery bots fly to HQ, suspended companies are shuttered and grey.
 * Shared pieces (loader, WebGL check, styles, fullscreen button and drawer) come from office-scene.js. */
import { THREE_LIB, OF_CSS, webglOk, esc, hash, makeChrome } from './office-scene.js';

const MAXC = 40, LIT = '#ffd37a', DARK = '#6f6c82';
const PASTEL = ['#f9d9c4', '#d7ecd9', '#e6dcf8', '#d3e8f7', '#fbe9b9', '#f7d6e4'];

/* o: { orgs (ops_orgs rows), attention ({paused, late} rows), totals, rangeLabel, t(key, vars, raw), money(n), revenue(org), rel(iso) } */
export function townSceneData(o){
  const t = o.t, att = o.attention || {}, cnt = (list, id) => (list || []).filter(r => r.org_id === id).length;
  const rows = (o.orgs || []).map(g => {
    const closed = g.status === 'suspended', used = Number(g.seats_used) || 0, limit = Number(g.seat_limit) || 0, spent = Number(g.spent ?? g.spent_30d) || 0, saved = Number(g.saved ?? g.saved_30d) || 0;
    const paused = g.seats_paused ?? cnt(att.paused, g.id), late = g.seats_late ?? cnt(att.late, g.id), rev = o.revenue(g);
    return { id: g.id, name: g.name, ent: g.plan === 'enterprise', closed, used, limit, spent, saved, paused, late, rev, members: Number(g.members_total) || 0, created: g.created_at, teams: Number(g.teams) || 0 };
  }).sort((a, b) => b.rev - a.rev || b.limit - a.limit);
  const maxSpend = Math.max(1, ...rows.map(r => r.spent)), shown = rows.slice(0, MAXC), more = rows.length - shown.length;
  const pc = x => Math.round(x * 100) + '%', day = d => (d ? String(d).slice(0, 10) : '—');
  const list = shown.map(r => {
    const util = r.limit ? r.used / r.limit : 0, bad = r.used + r.paused + r.late ? (r.paused + r.late) / (r.used + r.paused + r.late) : 0, act = r.closed ? 0 : Math.min(1, r.spent / maxSpend * 0.6 + util * 0.4);
    const bots = r.closed ? 0 : bad > 0.4 ? 1 : Math.max(1, Math.min(4, Math.round(1 + 3 * act))), full = r.limit > 0 && r.used >= r.limit;
    const plan = t(r.ent ? 'plan.enterprise' : 'plan.pro');
    return { ...r, util, act, bots, full, plan,
      sign: { name: r.name, seats: r.closed ? t('of.tag.closed') : r.used + ' / ' + r.limit, rev: t('tn.rev', { v: o.money(r.rev) }, true), full: full && !r.closed ? t('tn.full') : '', warn: r.closed ? 0 : r.paused + r.late },
      detail: { rows: [[t('tn.plan'), plan], [t('tn.seats'), r.used + ' / ' + r.limit + ' · ' + pc(util)], [t('tn.revm'), o.money(r.rev)], [t('of.spent') + ' · ' + o.rangeLabel, o.money(r.spent)], [t('of.saved') + ' · ' + o.rangeLabel, o.money(r.saved)],
        [t('tn.members'), String(r.members)], [t('tn.paused'), String(r.paused)], [t('tn.late'), String(r.late)], [t('tn.created'), day(r.created)]], status: r.closed ? t('of.tag.closed') : '' } };
  });
  const all = o.orgs || [], sum = k => all.reduce((a, g) => a + (Number(g[k]) || 0), 0), pro = all.filter(g => g.plan !== 'enterprise').length, ent = all.length - pro;
  const rev = all.reduce((a, g) => a + o.revenue(g), 0);
  return { companies: list, more: Math.max(0, more), moreLabel: more > 0 ? t('tn.more', { n: more }, true) : '',
    hud: { title: t('tn.title'), stats: t('tn.hud', { n: all.length, p: pro, e: ent, r: o.money(rev), u: sum('seats_used'), l: sum('seat_limit') }, true) },
    legend: [{ c: LIT, label: t('tn.lg.lit') }, { c: DARK, label: t('tn.lg.dark') }, { c: '#c4b5fd', label: t('tn.lg.bot') }, { c: '#aaa8b6', label: t('tn.lg.shut') }],
    ui: { fs: t('of.fs'), fsExit: t('of.fs.exit'), close: t('of.close'), org: t('tn.open') }, aria: t('tn.aria', { n: all.length }, true) };
}

export function mountTownScene(container, data, opts = {}){
  const noop = { update(){}, destroy(){} };
  if(!container) return noop;
  if(!webglOk()){ if(opts.onFail) opts.onFail('webgl'); return noop; }
  if(!document.getElementById('of-style')){ const s = document.createElement('style'); s.id = 'of-style'; s.textContent = OF_CSS; document.head.appendChild(s); }
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  container.innerHTML = '<div class="of-stage"><div class="of-hud"></div><div class="of-legend"></div></div>';
  const stage = container.querySelector('.of-stage'), elHud = stage.querySelector('.of-hud'), elLegend = stage.querySelector('.of-legend');
  const elLabels = document.createElement('div'); stage.appendChild(elLabels);
  let T = null, renderer = null, scene = null, camera = null, world = null, canvas = null, ro = null, io = null, sun = null, hemi = null, M4 = null, V1 = null, V2 = null, TMP = null;
  let cur = data, destroyed = false, visible = false, raf = 0, rr = 0, last = 0, time = 0, W = 0, H = 0, started = false, frames = 0, drag = null, yawD = 0, lastTouch = -9, scale = 10, hover = null;
  let boardW = 5, bld = [], bots = [], hq = { x: 0, z: 0, top: 7 }, bb = { pts: [[-9, 0, -9], [9, 12, 9]], x1: 9, z1: 9, h: 8 }, sel = null, selId = null, ring = null, moreLbl = null, hqFlash = 0, meshes = {}, dyn = [];
  const mobile = () => W < 520, v3 = () => new T.Vector3(), C = h => new T.Color(h), track = o => { dyn.push(o); return o; };
  const chrome = makeChrome(stage, container, { ui: () => cur.ui, request: () => request(), onClose: () => { sel = null; selId = null; if(ring) ring.visible = false; },
    onAction: a => { if(a === 'org' && sel && opts.onOpenOrg) opts.onOpenOrg(sel.c.id); } });

  function clear(){ dyn.forEach(o => { if(o.isObject3D){ if(o.parent) o.parent.remove(o); if(o.isInstancedMesh) o.dispose(); } else if(o.dispose) o.dispose(); }); world.clear(); dyn = []; elLabels.innerHTML = ''; bld = []; bots = []; moreLbl = null; }
  function mk(geo, mat, n, shadow = true){ const m = track(new T.InstancedMesh(geo, mat, Math.max(1, n))); m.count = n; m.castShadow = m.receiveShadow = shadow; m.frustumCulled = false; world.add(m); return m; }
  const std = o => track(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, ...o })), bas = o => track(new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, ...o }));
  function setM(m, i, x, y, z, rx = 0, ry = 0, sx = 1, sy = 1, sz = 1){ M4.position.set(x, y, z); M4.rotation.set(rx, ry, 0); M4.scale.set(sx, sy, sz); M4.updateMatrix(); m.setMatrixAt(i, M4.matrix); }
  function tex(c){ const t2 = track(new T.CanvasTexture(c)); t2.colorSpace = T.SRGBColorSpace; t2.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t2; }

  /* company signboard: a 3D board on a post, facing the camera, text painted on a canvas texture */
  function board(sg, w, closed){
    const cw = 900, ch = 400, c = document.createElement('canvas'), x = c.getContext('2d'); c.width = cw; c.height = ch;
    const F = '"Noto Sans KR","Geist",-apple-system,"Segoe UI",sans-serif', rr2 = (px, py, pw, ph, r) => { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + pw, py, px + pw, py + ph, r); x.arcTo(px + pw, py + ph, px, py + ph, r); x.arcTo(px, py + ph, px, py, r); x.arcTo(px, py, px + pw, py, r); x.closePath(); };
    x.fillStyle = closed ? '#d9d6de' : '#f6e2bb'; rr2(6, 6, cw - 12, ch - 12, 44); x.fill(); x.lineWidth = 10; x.strokeStyle = closed ? '#9d9aa8' : '#b98b5a'; x.stroke();
    x.fillStyle = '#4a3a2a'; x.textBaseline = 'middle'; let px = 108; x.font = `800 ${px}px ${F}`; let nm = sg.name;
    if(x.measureText(nm).width > cw - 80){ while(nm.length > 1 && x.measureText(nm + '…').width > cw - 80) nm = nm.slice(0, -1); nm += '…'; }
    x.fillText(nm, 40, 100);
    x.font = `700 92px ${F}`; x.fillStyle = closed ? '#b4443f' : '#4a3a2a'; x.fillText(sg.seats, 40, 215);
    let cx = 40 + x.measureText(sg.seats).width + 28;
    if(sg.full){ x.font = `800 60px ${F}`; const tw = x.measureText(sg.full).width; x.fillStyle = '#4caf82'; rr2(cx, 172, tw + 44, 86, 43); x.fill(); x.fillStyle = '#fff'; x.fillText(sg.full, cx + 22, 217); cx += tw + 72; }
    if(sg.warn){ x.fillStyle = '#b4443f'; x.fillRect(cx, 180, 16, 70); x.fillRect(cx + 28, 180, 16, 70); x.font = `800 80px ${F}`; x.fillText(String(sg.warn), cx + 62, 217); }
    x.font = `700 80px ${F}`; x.fillStyle = closed ? '#8a8794' : '#2f7a56'; x.fillText(sg.rev, 40, 320);
    const g = track(new T.PlaneGeometry(w, w * ch / cw)), m = track(new T.Mesh(g, track(new T.MeshBasicMaterial({ map: tex(c), toneMapped: false, transparent: true, depthTest: false }))));
    m.renderOrder = 10;   /* signs stay readable even when a taller building stands in front */
    return m;
  }

  function build(d){
    cur = d; clear(); bb.h = 8;
    const cs = d.companies || [], closedAll = false;
    elHud.innerHTML = `<b>${esc(d.hud.title)}</b>${esc(d.hud.stats)}`;
    elLegend.innerHTML = (d.legend || []).map(l => `<span><i style="background:${l.c}"></i>${esc(l.label)}</span>`).join('');
    if(canvas) canvas.setAttribute('aria-label', d.aria || '');
    (container.closest('.of-card') || container).setAttribute('aria-label', d.hud.title);
    hemi.intensity = 1.25; sun.intensity = 0.85;

    /* ring layout: the biggest revenue sits closest to HQ */
    const CELL = 12.5; let ri = 1, k0 = 0; const pos = [];
    while(k0 < cs.length){
      const cap = 6 * ri, n = Math.min(cap, cs.length - k0), R = 15 + 12 * (ri - 1);
      for(let k = 0; k < n; k++){ const a = Math.PI / 2 + (k + 0.5) / n * Math.PI * 2 + ri * 0.4, u = Math.cos(a) * R * 1.75, v = Math.sin(a) * R * 0.85; pos.push({ x: (u + v) * 0.7071, z: (v - u) * 0.7071, a }); }   /* ellipse stretched along the screen-horizontal diagonal */
      k0 += n; ri++;
    }
    const sb = [], B = (c, w, h, dd, x, y, z, ry = 0) => sb.push([c, w, h, dd, x, y, z, ry]), sp = [], Sp = (c, r, x, y, z, sx = 1, sy = 1, sz = 1) => sp.push([c, r, x, y, z, sx, sy, sz]);
    const win = [];   /* [x,y,z, face(0 front,1 right), lit] */
    let ext = 12;
    cs.forEach((c, i) => {
      const p = pos[i], lim = Math.max(1, c.limit), w = Math.max(3.8, Math.min(10, 3.4 + Math.sqrt(lim) * 0.7)), cols = Math.max(2, Math.floor((w - 0.5) / 0.95));
      let floors = Math.ceil(lim / 2 / cols), per = 1; if(floors > 12){ per = Math.ceil(lim / (2 * cols * 12)); floors = Math.ceil(lim / per / 2 / cols); }
      const nWin = Math.ceil(lim / per), lit = c.closed ? 0 : Math.min(nWin, Math.ceil(c.used / per)), Hh = floors * 1.15 + 0.7, bx = p.x, bz = p.z, grey = c.closed;
      const col = hex => grey ? C(hex).lerp(C('#cfcfd6'), 0.55).getStyle() : hex;
      const body = c.ent ? '#cfe6f6' : PASTEL[Math.floor(hash(c.id) * PASTEL.length)];
      ext = Math.max(ext, Math.hypot(p.x, p.z) + w);
      B(col('#c3e7a6'), w + 2, 0.16, w + 2, bx, 0.08, bz);                                      /* plot */
      B(col(body), w, Hh, w, bx, 0.16 + Hh / 2, bz);
      B(col(c.ent ? '#8a94f2' : '#e6d3b6'), w + 0.35, 0.3, w + 0.35, bx, 0.16 + Hh + 0.15, bz);  /* roof slab, accent from the plan tag colour */
      B(col('#f4efe6'), 0.9, 1.0, 0.1, bx, 0.66, bz + w / 2 + 0.03);                           /* door */
      if(c.ent){ B('#e8e6f0', 0.1, 1.8, 0.1, bx + w / 2 - 0.5, 0.16 + Hh + 1.2, bz + w / 2 - 0.5); B(col('#8a94f2'), 0.9, 0.5, 0.06, bx + w / 2 - 0.05, 0.16 + Hh + 1.85, bz + w / 2 - 0.5); }
      for(let g = 0; g < nWin; g++){
        const face = g % 2, idx = Math.floor(g / 2), row = Math.floor(idx / cols), cc = idx % cols, y = 1.45 + row * 1.15, off = -((cols - 1) * 0.95) / 2 + cc * 0.95;
        win.push(face === 0 ? [bx + off, y, bz + w / 2 + 0.04, 0, g < lit] : [bx + w / 2 + 0.04, y, bz + off, 1, g < lit]);
      }
      if(grey){ [0, 1].forEach(face => { const px = face ? bx + w / 2 + 0.07 : bx, pz = face ? bz : bz + w / 2 + 0.07;
        B('#b4b2c0', face ? 0.08 : w - 0.3, Hh - 0.6, face ? w - 0.3 : 0.08, px, 0.16 + Hh / 2 + 0.1, pz);
        for(let q = 0; q < Hh / 0.45; q++) B('#9a98a8', face ? 0.1 : w - 0.3, 0.05, face ? w - 0.3 : 0.1, px + (face ? 0.02 : 0), 0.7 + q * 0.45, pz + (face ? 0 : 0.02)); }); }
      /* path to HQ */
      const dist = Math.hypot(p.x, p.z), phi = Math.atan2(p.z, p.x), L = dist - 5 - (w / 2 + 1), mid = 5 + L / 2; B('#efe2c4', L, 0.05, 1.3, Math.cos(phi) * mid, 0.03, Math.sin(phi) * mid, -phi);
      Sp('#9fd49a', 0.6, bx - w / 2 - 0.9, 0.55, bz + w / 2 + 0.6, 1, 0.85, 1); Sp('#ffb3c7', 0.1, bx - w / 2 - 0.8, 1.05, bz + w / 2 + 0.8);
      bld.push({ c, x: bx, z: bz, w, H: Hh + 0.5, a: p.a, ph: hash(c.id) * 6.28 });
      bb.h = Math.max(bb.h, Hh + 3.5);
    });
    /* HQ: rounded building in the Sprag logo colour */
    const R0 = 4; hq = { x: 0, z: 0, top: 9.2 };
    const hqBody = track(new T.Mesh(track(new T.CylinderGeometry(R0, R0, 6, 28)), std({ color: '#fff4e0' }))); hqBody.position.y = 3.1; hqBody.castShadow = hqBody.receiveShadow = true; world.add(hqBody);
    const band = track(new T.Mesh(track(new T.CylinderGeometry(R0 + 0.06, R0 + 0.06, 0.7, 28)), std({ color: '#5e6ad2' }))); band.position.y = 4.3; world.add(band);
    const dome = track(new T.Mesh(track(new T.SphereGeometry(R0, 24, 14)), std({ color: '#e8e4ff' }))); dome.scale.y = 0.55; dome.position.y = 6.1; dome.castShadow = true; world.add(dome);
    meshes.dome = dome;
    const ant = track(new T.Mesh(track(new T.CylinderGeometry(0.06, 0.06, 1.6, 6)), std({ color: '#ffffff' }))); ant.position.y = 8.3; world.add(ant);
    const tip = track(new T.Mesh(track(new T.SphereGeometry(0.2, 10, 8)), bas({ color: '#8b7cf0' }))); tip.position.y = 9.2; world.add(tip); meshes.tip = tip;
    for(let q = 0; q < 12; q++){ const a = q / 12 * Math.PI * 2; win.push([Math.cos(a) * (R0 + 0.04), 1.8, Math.sin(a) * (R0 + 0.04), 2, true, a]); }
    { const c2 = document.createElement('canvas'), x2 = c2.getContext('2d'); c2.width = 700; c2.height = 220; x2.fillStyle = '#5e6ad2'; x2.beginPath(); x2.roundRect ? x2.roundRect(6, 6, 688, 208, 60) : x2.rect(6, 6, 688, 208); x2.fill();
      x2.fillStyle = '#fff'; x2.font = '800 130px "Geist","Noto Sans KR",-apple-system,sans-serif'; x2.textBaseline = 'middle'; x2.textAlign = 'center'; x2.fillText('Sprag', 350, 116);
      const hb = track(new T.Mesh(track(new T.PlaneGeometry(5.4, 5.4 * 220 / 700)), track(new T.MeshBasicMaterial({ map: tex(c2), toneMapped: false, transparent: true })))); hb.position.set(0, 6.9, 0); hb.rotation.y = Math.PI / 4; hb.position.y = 10.6; world.add(hb); }
    /* grass island, scaled to the ring */
    let gu = 8, gv = 8; const pts = [];
    bld.forEach(b => { gu = Math.max(gu, Math.abs((b.x - b.z) * 0.7071) + b.w * 0.8 + 5); gv = Math.max(gv, Math.abs((b.x + b.z) * 0.7071) + b.w * 0.8 + 5);
      for(const dx of [-1, 1]) for(const dz of [-1, 1]) for(const y of [0, b.H + 3.6]) pts.push([b.x + dx * (b.w / 2 + 1.5), y, b.z + dz * (b.w / 2 + 1.5)]); });
    for(const dx of [-1, 1]) for(const dz of [-1, 1]) for(const y of [0, 12]) pts.push([dx * 5.5, y, dz * 5.5]);
    const isl = (rad, y, h, c) => { const m = track(new T.Mesh(track(new T.CylinderGeometry(1, 1, h, 56)), std({ color: c }))); m.scale.set(rad[0], 1, rad[1]); m.rotation.y = Math.PI / 4; m.position.y = y; m.receiveShadow = true; world.add(m); };
    isl([gu, gv], -0.25, 0.5, '#cfe8b5'); isl([gu - 0.5, gv - 0.5], -0.65, 0.3, '#b99a73');
    for(let q = 0; q < 34; q++){ const a = q / 34 * Math.PI * 2, u = Math.cos(a) * (gu - 1.4), v = Math.sin(a) * (gv - 1.4); Sp(['#9fd49a', '#b5e0a0', '#8fcf9b'][q % 3], 0.7 + hash('s' + q) * 0.4, (u + v) * 0.7071, 0.6, (v - u) * 0.7071, 1, 0.85, 1); }
    bb = { pts, gu, h: bb.h, x1: gu * 0.7, z1: gv * 0.7 };

    const sm = mk(meshes.box, std({}), sb.length); sb.forEach((b, i) => { setM(sm, i, b[4], b[5], b[6], 0, b[7], b[1], b[2], b[3]); sm.setColorAt(i, C(b[0])); }); sm.instanceMatrix.needsUpdate = true; sm.instanceColor.needsUpdate = true;
    const sh = mk(meshes.sph, std({}), sp.length); sp.forEach((b, i) => { setM(sh, i, b[2], b[3], b[4], 0, 0, b[1] * b[5], b[1] * b[6], b[1] * b[7]); sh.setColorAt(i, C(b[0])); }); sh.instanceMatrix.needsUpdate = true; sh.instanceColor.needsUpdate = true;
    const wm = mk(meshes.box, bas({}), win.length, false);
    win.forEach((q, i) => { const face = q[3], hqw = face === 2; setM(wm, i, q[0], q[1], q[2], 0, hqw ? -q[5] + Math.PI / 2 : 0, face === 1 ? 0.06 : 0.55, 0.62, face === 1 ? 0.55 : 0.06); wm.setColorAt(i, C(q[4] ? LIT : DARK)); });
    wm.instanceMatrix.needsUpdate = true; wm.instanceColor.needsUpdate = true;

    /* signboards: standing on the lawn in front of each building, facing the camera */
    const sw = boardW = Math.max(4.2, Math.min(9, gu * 0.19));
    bld.forEach(b => {
      const m = board(b.c.sign, sw, b.c.closed); m.rotation.y = Math.PI / 4; const hgt = sw * 400 / 900; m.position.set(b.x + b.w * 0.5 + 0.9, 1.2 + hgt / 2, b.z + b.w * 0.5 + 1.6); world.add(m);
      b.board = m;
      const sb2 = track(new T.Mesh(meshes.box, std({ color: '#b98b5a' }))); sb2.scale.set(0.16, 1.4, 0.16); sb2.position.set(m.position.x, 0.7, m.position.z); sb2.castShadow = true; world.add(sb2);
    });

    /* delivery bots: orbit their roof, fly to HQ now and then; more bots and flights for busier companies */
    const bl = []; bld.forEach(b => { for(let j = 0; j < b.c.bots; j++) bl.push({ b, j }); });
    const bm = mk(meshes.sph, bas({}), bl.length, false), gl = mk(meshes.sph, bas({ transparent: true, opacity: 0.25, depthWrite: false }), bl.length, false);
    bl.forEach((q, i) => { const c = C(q.b.c.ent ? '#c4b5fd' : '#8fe0bb'); bm.setColorAt(i, c); gl.setColorAt(i, c);
      bots.push({ i, b: q.b, j: q.j, a0: hash(q.b.c.id + q.j) * 6.28, st: 0, t: 0, next: 1 + hash(q.b.c.id + 'n' + q.j) * 8 / (0.6 + q.b.c.act), per: 5 + 7 * (1 - q.b.c.act), pos: v3(), p0: v3() }); });
    if(bl.length){ bm.instanceColor.needsUpdate = gl.instanceColor.needsUpdate = true; }
    meshes.bm = bm; meshes.gl = gl;
    ring = track(new T.Group()); { const rg = track(new T.RingGeometry(1, 1.25, 48)); rg.rotateX(-Math.PI / 2); const m1 = track(new T.Mesh(rg, track(new T.MeshBasicMaterial({ color: '#7c6cf0', transparent: true, opacity: 0.85, depthWrite: false })))); ring.add(m1); ring.visible = false; world.add(ring); }
    if(d.more){ moreLbl = document.createElement('div'); moreLbl.className = 'of-lbl'; moreLbl.textContent = d.moreLabel; elLabels.appendChild(moreLbl); }
    sel = selId ? bld.find(b => b.c.id === selId) || null : null; if(sel){ renderDrawer(); ring.visible = true; } else if(selId) chrome.close();
    fit(); frames = 0; renderer.shadowMap.needsUpdate = true; chrome.syncFs(); step(0); request();
  }
  function renderDrawer(){
    if(!sel) return; const c = sel.c, ui = cur.ui || {};
    chrome.setHtml(`<div class="hd"><div><b title="${esc(c.name)}">${esc(c.name)}</b><small>${esc(c.plan)}${c.detail.status ? ' · ' + esc(c.detail.status) : ''}</small></div><button type="button" class="x" data-a="close" aria-label="${esc(ui.close)}">×</button></div>`
      + `<div class="bd"><dl>${c.detail.rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl></div><div class="ft"><button type="button" class="of-dbtn pri" data-a="org">${esc(ui.org)}</button></div>`);
  }

  const ease = u => u * u * (3 - 2 * u);
  function arc(a, b, u, out){ out.lerpVectors(a, b, ease(u)); out.y += Math.sin(Math.PI * u) * 3.2; return out; }
  function step(dt){
    time += dt;
    if(!drag && time - lastTouch > 2.5) yawD *= Math.exp(-dt * 1.2);
    world.rotation.y = yawD + (reduced ? 0 : 0.04 * Math.sin(time * 0.2));
    const HQ = V2.set(hq.x, hq.top, hq.z);
    bots.forEach(b => {
      const o = b.b, a = b.a0 + time * 0.6 * (b.j % 2 ? -1 : 1), roof = o.H + 1.2 + b.j * 0.3;
      if(b.st === 0){
        b.pos.set(o.x + Math.cos(a) * (o.w * 0.45), roof + Math.sin(time * 2 + b.a0) * 0.12, o.z + Math.sin(a) * (o.w * 0.45));
        if(!reduced && time >= b.next && !o.c.closed){ b.st = 1; b.t = 0; b.p0.copy(b.pos); }
      } else if(b.st === 1){ b.t += dt / 2.6; if(b.t >= 1){ b.st = 2; b.t = 0; hqFlash = 1; b.pos.copy(HQ); } else arc(b.p0, HQ, b.t, b.pos); }
      else if(b.st === 2){ b.t += dt / 0.5; b.pos.copy(HQ); b.pos.y += Math.sin(time * 6) * 0.08; if(b.t >= 1){ b.st = 3; b.t = 0; } }
      else { b.t += dt / 2.6; TMP.set(o.x + Math.cos(a) * (o.w * 0.45), roof, o.z + Math.sin(a) * (o.w * 0.45)); if(b.t >= 1){ b.st = 0; b.next = time + b.per * (0.7 + hash(o.c.id + time) * 0.6); b.pos.copy(TMP); } else arc(HQ, TMP, b.t, b.pos); }
      setM(meshes.bm, b.i, b.pos.x, b.pos.y, b.pos.z, 0, 0, 0.3, 0.3, 0.3); setM(meshes.gl, b.i, b.pos.x, b.pos.y, b.pos.z, 0, 0, 0.6, 0.6, 0.6);
    });
    if(bots.length){ meshes.bm.instanceMatrix.needsUpdate = meshes.gl.instanceMatrix.needsUpdate = true; }
    hqFlash = Math.max(0, hqFlash - dt * 1.6); if(meshes.tip) meshes.tip.scale.setScalar(1 + hqFlash * 1.6);
    if(sel && ring){ const s = sel.w * 0.62 + 0.9 + (reduced ? 0 : 0.05 * Math.sin(time * 3)); ring.position.set(sel.x, 0.2, sel.z); ring.scale.set(s, 1, s); }
    world.updateMatrixWorld(true);
  }
  function proj(v, out){ out.copy(v).applyMatrix4(world.matrixWorld).project(camera); return [(out.x * 0.5 + 0.5) * W, (-out.y * 0.5 + 0.5) * H]; }
  function render(){
    renderer.render(scene, camera);
    if(moreLbl){ const [x, y] = proj(V1.set(bb.x1 - 2, 0.3, bb.z1 - 1), TMP); moreLbl.style.transform = `translate(${Math.round(Math.min(W - moreLbl.offsetWidth - 4, Math.max(4, x)))}px,${Math.round(Math.min(H - 40, y))}px)`; }
  }
  function frame(now){
    raf = 0; if(started !== true || destroyed || !visible || document.hidden) return;
    const t = now || performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
    step(dt); if(++frames % 30 === 0) renderer.shadowMap.needsUpdate = true; render(); raf = requestAnimationFrame(frame);
  }
  function request(){
    if(started !== true || destroyed) return;
    if(reduced){ if(rr) return; rr = requestAnimationFrame(() => { rr = 0; if(destroyed) return; step(0); render(); }); return; }
    if(visible && !document.hidden && !raf){ last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function fit(){
    if(!camera || !W || !H) return;
    const inv = camera.matrixWorldInverse, v = v3(); camera.updateMatrixWorld(); inv.copy(camera.matrixWorld).invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for(const yw of [-0.1, 0, 0.1]) for(const q of bb.pts){
      v.set(q[0] * Math.cos(yw) + q[2] * Math.sin(yw), q[1], -q[0] * Math.sin(yw) + q[2] * Math.cos(yw)).applyMatrix4(inv); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const padT = Math.round(elHud.offsetHeight * 0.4) + 6, padB = elLegend.offsetHeight + 4, padX = mobile() ? 4 : 16;
    const s = Math.min((W - 2 * padX) / (x1 - x0), (H - padT - padB) / (y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, py = padT + (H - padT - padB) / 2;
    scale = s; Object.assign(camera, { left: cx - W / 2 / s, right: cx + W / 2 / s, top: cy + py / s, bottom: cy - (H - py) / s }); camera.updateProjectionMatrix();
  }
  function resize(){
    const w = stage.clientWidth, h = stage.clientHeight; if(!w || !h || !renderer) return;
    const was = mobile(); W = w; H = h; renderer.setSize(w, h, false); if(was !== mobile() && cur) return build(cur); fit(); request();
  }
  /* pointer: drag rotates within +-35 degrees; a click on a building or its sign opens the drawer, a click on empty ground closes it */
  function nearest(px, py){
    let best = null, bd = 1e9;
    bld.forEach(b => { for(const [pt, r] of [[V1.set(b.x, b.H * 0.5, b.z), b.w * scale * 0.75 + 6], [V1.set(b.board.position.x, b.board.position.y, b.board.position.z), boardW * scale * 0.45]]){
      const [x, y] = proj(pt, TMP), d = Math.hypot(x - px, y - py); if(d < r && d < bd){ bd = d; best = b; } } });
    return best;
  }
  const pt = ev => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  function bindPointer(){
    canvas.addEventListener('pointerdown', ev => { drag = { x: ev.clientX, moved: false, y0: yawD }; lastTouch = time; canvas.setPointerCapture(ev.pointerId); });
    canvas.addEventListener('pointermove', ev => {
      if(drag){ const dx = ev.clientX - drag.x; if(!drag.moved && Math.abs(dx) > 5){ drag.moved = true; canvas.classList.add('drag'); } if(drag.moved){ yawD = Math.max(-0.61, Math.min(0.61, drag.y0 + dx * 0.006)); lastTouch = time; request(); } return; }
      if(ev.pointerType !== 'touch'){ const [px, py] = pt(ev), h = nearest(px, py); if(hover !== h){ hover = h; canvas.classList.toggle('hit', !!h); } }
    });
    const end = ev => {
      const d = drag; drag = null; canvas.classList.remove('drag'); lastTouch = time; if(!d || d.moved || ev.type === 'pointercancel') return;
      const [px, py] = pt(ev), b = nearest(px, py);
      if(!b){ chrome.close(); return; }
      if(sel === b){ chrome.close(); return; }
      sel = b; selId = b.c.id; renderDrawer(); chrome.open(); ring.visible = true;
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { if(!drag){ hover = null; canvas.classList.remove('hit'); } });
  }
  async function init(){
    if(started || destroyed) return; started = 'loading';
    try{ T = await import(THREE_LIB); }catch(e){ started = false; if(opts.onFail) opts.onFail('load'); return; }
    if(destroyed) return;
    try{ renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); }catch(e){ started = false; if(opts.onFail) opts.onFail('webgl'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    canvas = renderer.domElement; canvas.setAttribute('role', 'img'); stage.insertBefore(canvas, stage.firstChild);
    scene = new T.Scene(); world = new T.Group(); scene.add(world); M4 = new T.Object3D(); V1 = v3(); V2 = v3(); TMP = v3();
    camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 400); camera.position.set(30, 26, 30); camera.lookAt(0, 2, 0);
    hemi = new T.HemisphereLight('#fff7e6', '#e8dcc4', 1.25); sun = new T.DirectionalLight('#fff0d4', 0.85); sun.position.set(14, 30, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0008; sun.shadow.radius = 4;
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 160 }); sun.shadow.camera.updateProjectionMatrix(); scene.add(hemi, sun, sun.target);
    meshes = { box: new T.BoxGeometry(1, 1, 1), sph: new T.SphereGeometry(1, 16, 12) };
    started = true; bindPointer(); ro = new ResizeObserver(resize); ro.observe(stage);
    W = stage.clientWidth; H = stage.clientHeight; renderer.setSize(W, H, false); build(cur); request();
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if(started === true && !destroyed) build(cur); });
  }
  io = new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); if(visible && !started) init(); else if(visible) request(); }, { threshold: 0.05 });
  io.observe(container);
  const onVis = () => { if(!document.hidden) request(); }; document.addEventListener('visibilitychange', onVis);
  elHud.innerHTML = `<b>${esc(data.hud.title)}</b>`; chrome.syncFs();
  return {
    update(d){ cur = d; if(started === true) build(d); },
    destroy(){
      destroyed = true; if(raf) cancelAnimationFrame(raf); if(rr) cancelAnimationFrame(rr); if(io) io.disconnect(); if(ro) ro.disconnect();
      document.removeEventListener('visibilitychange', onVis); chrome.destroy();
      if(started === true){ clear(); [meshes.box, meshes.sph].forEach(o => o && o.dispose()); renderer.dispose(); const x = renderer.getContext().getExtension('WEBGL_lose_context'); if(x) x.loseContext(); if(canvas.parentNode) canvas.parentNode.removeChild(canvas); }
      container.innerHTML = '';
    }
  };
}
