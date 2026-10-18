/* Sprag town: an animated three.js overview of ALL companies for the operator (site/ops list view only, never site/team).
 *
 *   const ctl = mountTownScene(container, townSceneData({...}), { onOpenOrg(id), onFail(reason) });   // ctl = { update(data), destroy() }
 *
 * Sprag HQ in the middle, one office building per company on a ring around it. Footprint and height follow the contracted seats,
 * every window is a seat (warm lit = in use, dark = unused), delivery bots fly to HQ, suspended companies are shuttered and grey.
 * Shared pieces (loader, WebGL check, styles, fullscreen button and drawer) come from office-scene.js.
 *
 * Day/night follows the viewer's local clock (dawn 5-7, day 7-17, dusk 17-19, night 19-5, smooth blends, re-evaluated every minute).
 * Weather comes from Open-Meteo for Seoul (fixed coordinates, no key, no geolocation, cached 30 min, 4 s timeout, silent fallback to clear).
 * Debug overrides for screenshots only (also honoured in ?demo=1):  ?tod=night|dawn|dusk|day   ?wx=clear|clouds|fog|rain|snow|storm
 * opts.probe(api) is a test hook that receives { T, renderer, camera, scene, view, bld(), info() } once the scene is built. */
import { THREE_LIB, OF_CSS, webglOk, esc, hash, makeChrome, makeView, kit } from './office-scene.js';

const MAXC = 40, LIT = '#ffd37a', DARK = '#5f6a88';
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
        [t('tn.members'), String(r.members)], [t('tn.teams'), String(r.teams)], [t('tn.paused'), String(r.paused)], [t('tn.late'), String(r.late)], [t('tn.created'), day(r.created)]], status: r.closed ? t('of.tag.closed') : '',
        utilTip: t('tn.d.utilTip', { u: r.used, l: r.limit, p: pc(util) }, true), freeTip: t('tn.d.freeTip', { n: Math.max(0, r.limit - r.used) }, true) } };
  });
  const all = o.orgs || [], sum = k => all.reduce((a, g) => a + (Number(g[k]) || 0), 0), pro = all.filter(g => g.plan !== 'enterprise').length, ent = all.length - pro;
  const rev = all.reduce((a, g) => a + o.revenue(g), 0);
  return { companies: list, more: Math.max(0, more), moreLabel: more > 0 ? t('tn.more', { n: more }, true) : '',
    hud: { title: t('tn.title'), stats: t('tn.hud', { n: all.length, p: pro, e: ent, r: o.money(rev), u: sum('seats_used'), l: sum('seat_limit') }, true) },
    legend: [{ c: LIT, label: t('tn.lg.lit') }, { c: DARK, label: t('tn.lg.dark') }, { c: '#c4b5fd', label: t('tn.lg.bot') }, { c: '#aaa8b6', label: t('tn.lg.shut') }],
    ui: Object.assign(Object.fromEntries(Object.entries({ fs: 'of.fs', fsExit: 'of.fs.exit', close: 'of.close', hint: 'of.hint', reset: 'of.reset', zoomIn: 'of.zoomIn', zoomOut: 'of.zoomOut', spent: 'of.spent', saved: 'of.saved', daily: 'of.d.daily', org: 'tn.open',
      dFail: 'tn.d.fail', dLoading: 'tn.d.loading', dSignals: 'tn.d.signals', dTeams: 'tn.d.teams', dTop: 'tn.d.top', dUtil: 'tn.d.util' }).map(([k, v]) => [k, t(v)]))), aria: t('tn.aria', { n: all.length }, true) };
}

/* Lazy per-company details for the drawer, built from existing superuser RPCs: o: { rows (org_seats), summary (org_summary), usage ({member_id: team_member_usage row}), t, money, rel } */
export function townDetailData(o){
  const t = o.t, money = o.money, rows = (o.rows || []).filter(r => ['ok', 'late', 'paused', 'silent'].includes(r.signal)), usage = o.usage || {};
  const SIG = { ok: '#2f9e6f', late: '#d89212', paused: '#5b6bd6', silent: '#8a8794' }, cnt = { ok: 0, late: 0, paused: 0, silent: 0 }; rows.forEach(r => { cnt[r.signal]++; });
  const sig = Object.keys(cnt).map(k => ({ v: cnt[k], color: SIG[k], label: t('sr.s.' + k), tip: t('sr.s.' + k) + ' · ' + cnt[k] }));
  const ids = new Set((o.rows || []).map(r => r.member_id)), people = new Map();
  rows.forEach(r => { const key = r.seat_of && ids.has(r.seat_of) ? r.seat_of : r.member_id, p = people.get(key) || { name: '', spent: 0 }; if(!p.name || r.member_id === key) p.name = r.display_name || r.member_id; p.spent += Number((usage[r.member_id] || {}).spent) || 0; people.set(key, p); });
  const top = [...people.values()].sort((a, b) => b.spent - a.spent).slice(0, 5).map(p => ({ name: p.name, v: p.spent, txt: money(p.spent), color: '#8b7cf0' }));
  const days = {}; Object.values(usage).forEach(u => (u.series || []).forEach(q => { const d = days[q.day] || (days[q.day] = [0, 0]); d[0] += Number(q.spent) || 0; d[1] += Number(q.saved) || 0; }));
  const dd = Object.keys(days).sort(), tm = ((o.summary && o.summary.teams) || []).map(x => ({ name: x.name, v: Number(x.members_active) || 0, txt: String(Number(x.members_active) || 0), color: '#8ec5fb' }));
  return { sig, top, teams: tm, days: dd, spent: dd.map(d => days[d][0]), saved: dd.map(d => days[d][1]), fmt: money };
}

/* ── building styles ─────────────────────────────────────────────────── */
const STY = {
  brick:  { key: 'brick', wall: ['#cf7f5d', '#c46f50', '#d78c68', '#b9654a'], trim: '#f2e9d8', frame: '#f7f0e2', fw: 0.78, fh: 0.9, bd: 0.1, S: 1.0, acc: ['#4f7f78', '#7a5a8a', '#b84a3e', '#3f6f9a'], roof: '#bdb8b0', tile: 3, lintel: true, sill: true },
  stucco: { key: 'stucco', wall: ['#f8f1e2', '#f3e8d2', '#faf4ea'], trim: '#e6d9bd', frame: '#ffffff', fw: 0.62, fh: 0.86, bd: 0.07, S: 1.1, acc: ['#6f9c8a', '#6d8fb3', '#c98b6b', '#8a7bb8'], roof: '#c46a4a', tile: 4, shut: true, sill: true },
  timber: { key: 'wood', wall: ['#c9976a', '#be8a5c', '#d2a276'], trim: '#a9774b', frame: '#6e4a2c', fw: 0.72, fh: 0.84, bd: 0.08, S: 1.0, acc: ['#d86f4a', '#3f8a7a', '#e0a43c'], roof: '#7a5236', tile: 2.1, band: '#c8693f', sill: true },
  color:  { key: 'stucco', wall: PASTEL, trim: '#ffffff', frame: '#ffffff', fw: 0.74, fh: 0.88, bd: 0.08, S: 1.05, acc: ['#f2796b', '#5aa7d9', '#f2b84b', '#6cc29a'], roof: '#e9e3da', tile: 4, cross: true, sill: true },
  glass:  { key: 'g', wall: ['#6aa8d6', '#78b6c8', '#8296d6'], trim: '#e6edf4', frame: '#dbe4ee', fh: 0.88, bd: 0.05, S: 0.9, acc: ['#8a94f2', '#6c78dc'], roof: '#cfd6e0', tile: 0 }
};
STY.podium = STY.glass;

const rng = seed => { let s = Math.floor(hash(seed) * 4294967296) >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = u => u * u * (3 - 2 * u);

/* ── day / night + weather ───────────────────────────────────────────── */
const ANC = {
  night: { c0: '#2b3a78', c1: '#0b1030', sc: '#8fa8ff', si: 0.62, sp: [16, 32, 18], hs: '#4a5c9c', hg: '#232a50', hi: 0.7, fi: 0.1, ex: 1.05, n: 1 },
  dawn:  { c0: '#ffe0cf', c1: '#f0bfae', sc: '#ffb58a', si: 1.5, sp: [-28, 20, 14], hs: '#ffe2d0', hg: '#e8c4a6', hi: 0.95, fi: 0.25, ex: 1.08, n: 0.3 },
  day:   { c0: '#fffaf0', c1: '#f6ead2', sc: '#fff0d4', si: 2.0, sp: [-12, 34, 16], hs: '#eaf3ff', hg: '#f0e2c8', hi: 1.0, fi: 0.4, ex: 1.1, n: 0 },
  dusk:  { c0: '#ffd5b0', c1: '#e5a186', sc: '#ff9460', si: 1.6, sp: [30, 17, 10], hs: '#ffd9c0', hg: '#d9b0a0', hi: 0.9, fi: 0.2, ex: 1.05, n: 0.45 }
};
const TL = [[0, 'night'], [4.5, 'night'], [6, 'dawn'], [7.5, 'day'], [16.5, 'day'], [18, 'dusk'], [19.5, 'night'], [24, 'night']];
const WXK = { clear: ['맑음', 'Clear', '☀'], clouds: ['흐림', 'Cloudy', '☁'], fog: ['안개', 'Fog', '🌫'], rain: ['비', 'Rain', '🌧'], snow: ['눈', 'Snow', '❄'], storm: ['뇌우', 'Storm', '⛈'] };
const WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=37.57&longitude=126.98&current=weather_code,cloud_cover,precipitation,wind_speed_10m,is_day,temperature_2m';
let wxMem = null, wxPromise = null;
function wxLoad(){
  const now = Date.now();
  if(wxMem && now - wxMem.t < 1800e3) return Promise.resolve(wxMem.d);
  try{ const s = JSON.parse(sessionStorage.getItem('sprag-town-wx') || 'null'); if(s && s.d && now - s.t < 1800e3){ wxMem = s; return Promise.resolve(s.d); } }catch(e){}
  if(wxPromise) return wxPromise;
  wxPromise = new Promise(res => {
    let to = 0;
    try{
      const ac = new AbortController(); to = setTimeout(() => ac.abort(), 4000);
      fetch(WX_URL, { signal: ac.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }).then(r => (r.ok ? r.json() : null)).then(j => {
        const c = j && j.current; if(!c) return res(null);
        const d = { code: Number(c.weather_code) || 0, cloud: Number(c.cloud_cover) || 0, precip: Number(c.precipitation) || 0, wind: Number(c.wind_speed_10m) || 0, temp: c.temperature_2m == null ? null : Number(c.temperature_2m) };
        wxMem = { t: Date.now(), d }; try{ sessionStorage.setItem('sprag-town-wx', JSON.stringify(wxMem)); }catch(e){} res(d);
      }).catch(() => res(null)).finally(() => { clearTimeout(to); wxPromise = null; });
    }catch(e){ clearTimeout(to); wxPromise = null; res(null); }
  });
  return wxPromise;
}
/* WMO weather_code to a scene state. cloud 0..1, wind km/h, rain 0..1 */
function wxClass(d){
  if(!d) return { kind: 'clear', cloud: 0.12, wind: 6, temp: null, rain: 0 };
  const c = d.code, cv = clampN(d.cloud / 100, 0, 1), w = d.wind || 0, ra = clampN(d.precip / 4, 0.25, 1);
  if(c >= 95) return { kind: 'storm', cloud: Math.max(cv, 0.95), wind: w, temp: d.temp, rain: 1 };
  if((c >= 71 && c <= 77) || c === 85 || c === 86) return { kind: 'snow', cloud: Math.max(cv, 0.8), wind: w, temp: d.temp, rain: ra };
  if((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return { kind: 'rain', cloud: Math.max(cv, 0.85), wind: w, temp: d.temp, rain: c >= 61 || c >= 80 ? Math.max(ra, 0.6) : 0.4 };
  if(c === 45 || c === 48) return { kind: 'fog', cloud: Math.max(cv, 0.5), wind: w, temp: d.temp, rain: 0 };
  if(c === 2 || c === 3) return { kind: 'clouds', cloud: Math.max(cv, c === 3 ? 0.85 : 0.5), wind: w, temp: d.temp, rain: 0 };
  return { kind: 'clear', cloud: Math.min(cv, 0.3), wind: w, temp: d.temp, rain: 0 };
}
const WX_DBG = { clear: { kind: 'clear', cloud: 0.12, wind: 6, temp: 22, rain: 0 }, clouds: { kind: 'clouds', cloud: 0.75, wind: 14, temp: 18, rain: 0 }, fog: { kind: 'fog', cloud: 0.55, wind: 3, temp: 8, rain: 0 },
  rain: { kind: 'rain', cloud: 0.9, wind: 16, temp: 12, rain: 0.8 }, snow: { kind: 'snow', cloud: 0.85, wind: 8, temp: -2, rain: 0.7 }, storm: { kind: 'storm', cloud: 1, wind: 34, temp: 20, rain: 1 } };
const TOD_DBG = { dawn: 6, day: 12, dusk: 18, night: 0 };

/* ── geometry buffers: everything static is merged per material key ──── */
function boxG(T, sx, sy, sz, r){
  if(!r){ const g = new T.BoxGeometry(sx, sy, sz); g.userData.per = 4; return g; }
  r = Math.min(r, sx * 0.45, sy * 0.45, sz * 0.45);
  const g = new T.BoxGeometry(sx, sy, sz, 3, 3, 3), p = g.attributes.position, n = g.attributes.normal, hx = sx / 2 - r, hy = sy / 2 - r, hz = sz / 2 - r;
  for(let i = 0; i < p.count; i++){
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if(Math.abs(x) < sx / 2 - 1e-6) x = Math.sign(x) * hx; if(Math.abs(y) < sy / 2 - 1e-6) y = Math.sign(y) * hy; if(Math.abs(z) < sz / 2 - 1e-6) z = Math.sign(z) * hz;
    const ix = clampN(x, -hx, hx), iy = clampN(y, -hy, hy), iz = clampN(z, -hz, hz);
    let dx = x - ix, dy = y - iy, dz = z - iz; const l = Math.hypot(dx, dy, dz);
    if(l > 1e-6){ dx /= l; dy /= l; dz /= l; p.setXYZ(i, ix + dx * r, iy + dy * r, iz + dz * r); n.setXYZ(i, dx, dy, dz); } else p.setXYZ(i, x, y, z);
  }
  g.userData.per = 16; return g;
}

const TW_CSS = `.tw-chip{display:inline-block;margin-top:4px;padding:1px 9px;border-radius:999px;background:rgba(255,255,255,.8);border:1px solid rgba(120,90,60,.16);font-size:11px;font-weight:600;color:#6a5a4a;pointer-events:none}
.tw-chip[hidden]{display:none}
.tw-stars{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 1.2s;background-repeat:no-repeat,repeat-x;background-position:0 0,0 0;background-size:100% 100%,640px 420px}
.of-stage.tw-night .of-hud,.of-stage.tw-night .of-hud b{color:#e8ecff}
.of-stage.tw-night .tw-chip{background:rgba(30,38,80,.7);border-color:rgba(160,180,255,.3);color:#dfe5ff}`;

export function mountTownScene(container, data, opts = {}){
  const noop = { update(){}, destroy(){} };
  if(!container) return noop;
  if(!webglOk()){ if(opts.onFail) opts.onFail('webgl'); return noop; }
  if(!document.getElementById('of-style')){ const s = document.createElement('style'); s.id = 'of-style'; s.textContent = OF_CSS; document.head.appendChild(s); }
  if(!document.getElementById('tw-style')){ const s = document.createElement('style'); s.id = 'tw-style'; s.textContent = TW_CSS; document.head.appendChild(s); }
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const qs = new URLSearchParams(location.search), DBG_TOD = qs.get('tod'), DBG_WX = qs.get('wx');
  container.innerHTML = '<div class="of-stage"><div class="of-hud"></div><div class="of-legend"></div></div>';
  const stage = container.querySelector('.of-stage'), elHud = stage.querySelector('.of-hud'), elLegend = stage.querySelector('.of-legend');
  const elLabels = document.createElement('div'); stage.appendChild(elLabels);
  const elChip = document.createElement('div'); elChip.className = 'tw-chip'; elChip.hidden = true;
  let T = null, renderer = null, scene = null, camera = null, world = null, canvas = null, ro = null, io = null, sun = null, fill = null, hemi = null, M4 = null, V1 = null, V2 = null, TMP = null;
  let cur = data, destroyed = false, visible = false, raf = 0, rr = 0, last = 0, time = 0, W = 0, H = 0, started = false, frames = 0, scale = 10, hover = null, view = null, cache = new Map();
  let boardW = 5, bld = [], bots = [], hq = { x: 0, z: 0, top: 9.2 }, bb = { pts: [[-9, 0, -9], [9, 12, 9]], x1: 9, z1: 9, h: 8 }, sel = null, selId = null, ring = null, moreLbl = null, hqFlash = 0, meshes = {}, dyn = [];
  let TX = {}, MT = {}, envTex = null, GB = {}, WL = [], SH = [], billboards = [], peds = [], clouds = [], parts = null, stars = null, tick = 0, minuteT = 0;
  let wx = DBG_WX && WX_DBG[DBG_WX] ? WX_DBG[DBG_WX] : { kind: 'clear', cloud: 0.12, wind: 6, temp: null, rain: 0 }, wxDbg = !!(DBG_WX && WX_DBG[DBG_WX]), night = 0, flash = 0, lightT = 6, baseHemi = 1, baseEx = 1, extent = 40, builtSnow = false;
  const mobile = () => W < 520, v3 = () => new T.Vector3(), C = h => new T.Color(h), track = o => { dyn.push(o); return o; };
  const chrome = makeChrome(stage, container, { ui: () => cur.ui, request: () => request(), onZoom: f => view && view.zoomBy(f), onReset: () => view && view.reset(), onClose: () => { sel = null; selId = null; if(ring) ring.visible = false; },
    onAction: a => { if(a === 'org' && sel && opts.onOpenOrg) opts.onOpenOrg(sel.c.id); } });
  kit.bind(chrome.el);

  function clear(){ dyn.forEach(o => { if(o.isObject3D){ if(o.parent) o.parent.remove(o); if(o.isInstancedMesh) o.dispose(); } else if(o.dispose) o.dispose(); }); world.clear(); dyn = []; elLabels.innerHTML = ''; bld = []; bots = []; moreLbl = null; billboards = []; peds = []; clouds = []; parts = null; }
  function mk(geo, mat, n, shadow = true, recv = true){ const m = track(new T.InstancedMesh(geo, mat, Math.max(1, n))); m.count = n; m.castShadow = shadow; m.receiveShadow = recv; m.frustumCulled = false; world.add(m); return m; }
  const std = o => track(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, ...o }));
  function setM(m, i, x, y, z, rx = 0, ry = 0, sx = 1, sy = 1, sz = 1){ M4.position.set(x, y, z); M4.rotation.set(rx, ry, 0); M4.scale.set(sx, sy, sz); M4.updateMatrix(); m.setMatrixAt(i, M4.matrix); }
  function tex(c){ const t2 = track(new T.CanvasTexture(c)); t2.colorSpace = T.SRGBColorSpace; t2.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t2; }
  const colorAll = (m, list) => { list.forEach((c, i) => m.setColorAt(i, c)); m.instanceMatrix.needsUpdate = true; if(m.instanceColor) m.instanceColor.needsUpdate = true; };

  /* ── merged static geometry ── */
  const gb = key => GB[key] || (GB[key] = { p: [], n: [], u: [], c: [], i: [], v: 0 });
  let eu, qq, mm, nm, va, vb, ONE;
  function put(key, g, x, y, z, rx, ry, rz, col, tile){
    const b = gb(key), pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, ix = g.index, per = g.userData.per || 0, o = b.v;
    eu.set(rx || 0, ry || 0, rz || 0); qq.setFromEuler(eu); mm.compose(va.set(x, y, z), qq, ONE); nm.getNormalMatrix(mm);
    for(let i = 0; i < pa.count; i++){
      va.fromBufferAttribute(pa, i).applyMatrix4(mm); vb.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      b.p.push(va.x, va.y, va.z); b.n.push(vb.x, vb.y, vb.z); b.c.push(col.r, col.g, col.b);
      if(tile && per){ const f = Math.floor(i / per); if(f < 2) b.u.push(va.z / tile, va.y / tile); else if(f < 4) b.u.push(va.x / tile, va.z / tile); else b.u.push(va.x / tile, va.y / tile); }
      else if(ua) b.u.push(ua.getX(i), ua.getY(i)); else b.u.push(0, 0);
    }
    if(ix) for(let i = 0; i < ix.count; i++) b.i.push(ix.getX(i) + o); else for(let i = 0; i < pa.count; i++) b.i.push(i + o);
    b.v += pa.count;
  }
  const B = (key, x, y, z, sx, sy, sz, col, r = 0, ry = 0, rx = 0, tile = 0) => { const g = boxG(T, sx, sy, sz, r); put(key, g, x, y, z, rx, ry, 0, col, tile); g.dispose(); };
  const Cy = (key, x, y, z, rt, rb, h, seg, col, rx = 0, rz = 0) => { const g = new T.CylinderGeometry(rt, rb, h, seg); put(key, g, x, y, z, rx, 0, rz, col, 0); g.dispose(); };
  const Sph = (key, x, y, z, sx, sy, sz, col) => { const g = new T.SphereGeometry(1, 14, 10); g.scale(sx, sy, sz); put(key, g, x, y, z, 0, 0, 0, col, 0); g.dispose(); };
  const Flat = (key, x, y, z, g, col) => { g.rotateX(-Math.PI / 2); put(key, g, x, y, z, 0, 0, 0, col, 0); g.dispose(); };
  const Pl = (key, x, y, z, w, d, col) => Flat(key, x, y, z, new T.PlaneGeometry(w, d), col);
  const rot = (lx, lz, a) => [lx * Math.cos(a) + lz * Math.sin(a), -lx * Math.sin(a) + lz * Math.cos(a)];
  const WHITE = () => C('#ffffff');

  function flushGB(){
    const CAST = { ao: false, glow: false, cs: false };
    Object.entries(GB).forEach(([k, b]) => {
      if(!b.v) return; const g = track(new T.BufferGeometry());
      g.setAttribute('position', new T.Float32BufferAttribute(b.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(b.n, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(b.u, 2)); g.setAttribute('color', new T.Float32BufferAttribute(b.c, 3));
      g.setIndex(b.v > 65535 ? new T.Uint32BufferAttribute(b.i, 1) : new T.Uint16BufferAttribute(b.i, 1));
      const m = track(new T.Mesh(g, k === 'cs' ? meshes.csMat : MT[k])); m.castShadow = CAST[k] !== false; m.receiveShadow = k !== 'ao' && k !== 'glow'; m.frustumCulled = false; if(k === 'ao') m.renderOrder = 1; world.add(m);
    });
    GB = {};
  }

  /* ── textures, environment, shared materials (created once) ── */
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
  function rep(c){ const t2 = new T.CanvasTexture(c); t2.colorSpace = T.SRGBColorSpace; t2.wrapS = t2.wrapT = T.RepeatWrapping; t2.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t2; }
  function makeTextures(){
    { const [c, x] = cv(256, 256); x.fillStyle = '#d6cfc3'; x.fillRect(0, 0, 256, 256); const rn = rng('brick'), rows = 14, rh = 256 / rows, bw = 256 / 6;
      for(let r = 0; r < rows; r++) for(let k = -1; k < 7; k++){ const v = 226 + Math.floor(rn() * 29); x.fillStyle = `rgb(${v},${v - 5},${v - 10})`; x.fillRect(k * bw + (r % 2 ? bw / 2 : 0) + 1.6, r * rh + 1.6, bw - 3.2, rh - 3.2); }
      TX.brick = rep(c); }
    { const [c, x] = cv(256, 256); x.fillStyle = '#f4f1ea'; x.fillRect(0, 0, 256, 256); const rn = rng('stucco'); for(let i = 0; i < 1400; i++){ const v = 200 + Math.floor(rn() * 55); x.fillStyle = `rgba(${v},${v - 4},${v - 10},.35)`; x.fillRect(rn() * 256, rn() * 256, 1 + rn() * 3, 1 + rn() * 3); }
      TX.stucco = rep(c); }
    { const [c, x] = cv(256, 256), rn = rng('wood'); for(let k = 0; k < 6; k++){ const v = 226 + Math.floor(rn() * 29); x.fillStyle = `rgb(${v},${v - 6},${v - 14})`; x.fillRect(k * 42.67, 0, 42.67, 256); x.fillStyle = 'rgba(70,40,20,.5)'; x.fillRect(k * 42.67, 0, 2.2, 256);
        for(let g = 0; g < 7; g++){ x.fillStyle = 'rgba(90,55,30,.14)'; x.fillRect(k * 42.67 + 4 + rn() * 34, 0, 1, 256); } }
      TX.wood = rep(c); }
    { const [c, x] = cv(64, 128); for(let k = 0; k < 8; k++){ const g = x.createLinearGradient(0, k * 16, 0, k * 16 + 16); g.addColorStop(0, '#f2f2f6'); g.addColorStop(0.8, '#cfcfd8'); g.addColorStop(1, '#9d9dab'); x.fillStyle = g; x.fillRect(0, k * 16, 64, 16); }
      TX.shutter = rep(c); }
    { const [c, x] = cv(256, 256); x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256); const rn = rng('grass');
      for(let i = 0; i < 70; i++){ const g = x.createRadialGradient(0, 0, 0, 0, 0, 1); const px = rn() * 256, py = rn() * 256, rd = 20 + rn() * 50; x.save(); x.translate(px, py); x.scale(rd, rd); const gr = x.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, i % 2 ? 'rgba(120,170,90,.14)' : 'rgba(255,255,230,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(-1, -1, 2, 2); x.restore(); }
      TX.grass = rep(c); TX.grass.repeat.set(10, 10); }
    { const [c, x] = cv(64, 64), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); TX.glow = new T.CanvasTexture(c); TX.glow.colorSpace = T.SRGBColorSpace; }
    { const [c, x] = cv(128, 128); for(let i = 0; i < 22; i++){ const a = 0.034, ins = i * 2.6; x.fillStyle = `rgba(40,30,50,${a})`; x.beginPath(); x.roundRect ? x.roundRect(ins, ins, 128 - 2 * ins, 128 - 2 * ins, 18) : x.rect(ins, ins, 128 - 2 * ins, 128 - 2 * ins); x.fill(); } TX.ao = new T.CanvasTexture(c); TX.ao.colorSpace = T.SRGBColorSpace; }
    { const [c, x] = cv(640, 420), rn = rng('stars'); for(let i = 0; i < 120; i++){ const s = rn() < 0.1 ? 2.2 : rn() < 0.4 ? 1.4 : 0.9; x.fillStyle = `rgba(255,255,${230 + Math.floor(rn() * 25)},${0.35 + rn() * 0.65})`; x.beginPath(); x.arc(rn() * 640, rn() * 330, s, 0, 6.283); x.fill(); } meshes.starUrl = c.toDataURL(); }
  }
  function makeEnv(){
    const pm = new T.PMREMGenerator(renderer), sc = new T.Scene(), g = new T.SphereGeometry(30, 24, 16), p = g.attributes.position, col = new Float32Array(p.count * 3), top = C('#8fbdf0'), hor = C('#fff4e0'), low = C('#cfe0ef'), t3 = C('#000');
    for(let i = 0; i < p.count; i++){ const u = p.getY(i) / 30; if(u > 0) t3.copy(hor).lerp(top, Math.pow(u, 0.7)); else t3.copy(hor).lerp(low, Math.min(1, -u * 2)); col[i * 3] = t3.r; col[i * 3 + 1] = t3.g; col[i * 3 + 2] = t3.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3)); const sm = new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide }); sc.add(new T.Mesh(g, sm));
    const sg = new T.SphereGeometry(4, 12, 8), sn = new T.MeshBasicMaterial({ color: new T.Color(7, 6.2, 4.6) }), s2 = new T.Mesh(sg, sn); s2.position.set(-12, 20, 16); sc.add(s2);
    const rt = pm.fromScene(sc, 0.03); g.dispose(); sg.dispose(); sm.dispose(); sn.dispose(); pm.dispose(); return rt.texture;
  }
  function makeMaterials(){
    const sM = (o, env = 0.3) => { const m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, envMap: envTex, envMapIntensity: env, ...o }); m.userData.e = env; return m; };
    MT = { p: sM({ vertexColors: true }), brick: sM({ vertexColors: true, map: TX.brick }), stucco: sM({ vertexColors: true, map: TX.stucco }), wood: sM({ vertexColors: true, map: TX.wood }), shutter: sM({ vertexColors: true, map: TX.shutter, roughness: 0.55, metalness: 0.3 }, 0.6),
      g: sM({ vertexColors: true, roughness: 0.1, metalness: 0.35 }, 1.15), m: sM({ vertexColors: true, roughness: 0.35, metalness: 0.55 }, 0.8), road: sM({ vertexColors: true, roughness: 0.92 }, 0.25),
      glow: new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), ao: new T.MeshBasicMaterial({ map: TX.ao, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, color: 0x000000 }),
      inst: sM({}, 0.3), dark: sM({ roughness: 0.18, metalness: 0 }, 0.22), lit: new T.MeshBasicMaterial({ toneMapped: false }),
      halo: new T.MeshBasicMaterial({ map: TX.glow, color: 0xffb347, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }),
      bulb: new T.MeshBasicMaterial({ color: 0xd9d3c0, toneMapped: false }), pool: new T.MeshBasicMaterial({ map: TX.glow, color: 0xffd58a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      grassTop: sM({ map: TX.grass, color: 0xc4e6a6 }, 0.1), side: sM({}, 0.1), cloud: sM({ flatShading: true, transparent: true, opacity: 0.92, roughness: 1 }, 0.2),
      rain: new T.MeshBasicMaterial({ color: 0xdbe8fa, transparent: true, opacity: 0.65, depthWrite: false }), snow: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }) };
  }

  /* ── company signboard (3D board on a post, text on a canvas) ── */
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
  /* small lit rooftop sign for the full-seats badge */
  function fullSign(text){
    const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = 420; c.height = 170;
    x.fillStyle = '#1d6f4d'; x.beginPath(); x.roundRect ? x.roundRect(4, 4, 412, 162, 34) : x.rect(4, 4, 412, 162); x.fill(); x.lineWidth = 8; x.strokeStyle = '#bff0d6'; x.stroke();
    for(let i = 0; i < 14; i++){ x.fillStyle = '#fff3b0'; x.beginPath(); x.arc(26 + i * 29.5, 16, 4.5, 0, 6.283); x.arc(26 + i * 29.5, 154, 4.5, 0, 6.283); x.fill(); }
    x.fillStyle = '#ffffff'; x.shadowColor = '#c8ffe0'; x.shadowBlur = 18; x.font = '800 96px "Noto Sans KR","Geist",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 210, 90);
    return c;
  }

  function build(d){
    cur = d; clear(); cache.clear(); bb.h = 8; GB = {}; WL = []; SH = []; builtSnow = wx.kind === 'snow';
    const cs = d.companies || [];
    elHud.innerHTML = `<b>${esc(d.hud.title)}</b>${esc(d.hud.stats)}`; elHud.appendChild(elChip); renderChip();
    elLegend.innerHTML = (d.legend || []).map(l => `<span><i style="background:${l.c}"></i>${esc(l.label)}</span>`).join('');
    if(canvas) canvas.setAttribute('aria-label', d.aria || '');
    (container.closest('.of-card') || container).setAttribute('aria-label', d.hud.title);
    const snowy = wx.kind === 'snow', GREYC = C('#c9c8d0'), SNOWC = C('#f6f9ff');
    const LOTY = 0.1, LOT = 1.25, PLAZA = 8.2;

    /* ring layout: the biggest revenue sits closest to HQ */
    let ri = 1, k0 = 0; const pos = [];
    while(k0 < cs.length){
      const cap = 6 * ri, n = Math.min(cap, cs.length - k0), R = 17 + 13 * (ri - 1);
      for(let k = 0; k < n; k++){ const a = Math.PI / 2 + (k + 0.5) / n * Math.PI * 2 + ri * 0.4, u = Math.cos(a) * R * 1.75, v = Math.sin(a) * R * 0.85; pos.push({ x: (u + v) * 0.7071, z: (v - u) * 0.7071, a, ring: ri }); }   /* ellipse stretched along the screen-horizontal diagonal */
      k0 += n; ri++;
    }
    const lots = [], signs = [], fulls = [];

    /* ── buildings ── */
    function roofGear(bx, bz, w, y, R, K, acc){
      const slots = [[-1, -1], [1, -1], [-1, 1], [1, 1]].sort(() => R() - 0.5), kinds = ['ac', 'tank', 'garden', 'solar', 'antenna', 'stair'].sort(() => R() - 0.5), n = w < 4.6 ? 2 : 2 + (R() < 0.5 ? 1 : 0), q = w / 4;
      for(let i = 0; i < n; i++){
        const cx = bx + slots[i][0] * q * 0.92, cz = bz + slots[i][1] * q * 0.92, k = kinds[i];
        if(k === 'ac'){ for(let j = 0; j < 2; j++){ const ox = (j - 0.5) * 0.75; B('p', cx + ox, y + 0.2, cz, 0.65, 0.4, 0.5, K('#d9dde3'), 0.04); Cy('p', cx + ox, y + 0.2, cz + 0.26, 0.17, 0.17, 0.03, 12, K('#5c6070'), Math.PI / 2); } }
        else if(k === 'tank'){ for(const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) Cy('p', cx + lx * 0.24, y + 0.25, cz + lz * 0.24, 0.025, 0.025, 0.5, 5, K('#6d6a78')); Cy('wood', cx, y + 0.9, cz, 0.36, 0.36, 0.8, 14, K('#b78a5c')); Cy('p', cx, y + 0.8, cz, 0.375, 0.375, 0.05, 14, K('#6d6a78')); Cy('p', cx, y + 1.45, cz, 0.0, 0.4, 0.3, 14, K('#8f939e')); }
        else if(k === 'garden'){ B('p', cx, y + 0.05, cz, 1.4, 0.1, 1.4, K('#a9cf8e'), 0.03); for(const [bx2, bz2, sx, sz] of [[0, -0.72, 1.5, 0.08], [0, 0.72, 1.5, 0.08], [-0.72, 0, 0.08, 1.4], [0.72, 0, 0.08, 1.4]]) B('p', cx + bx2, y + 0.1, cz + bz2, sx, 0.14, sz, K('#a9774b'));
          for(let j = 0; j < 4; j++) SH.push([cx + (j % 2 - 0.5) * 0.7, y + 0.28, cz + (Math.floor(j / 2) - 0.5) * 0.6, 0.27, j === 1 ? '#f4a9c0' : '#6fb067']); }
        else if(k === 'solar'){ for(let j = 0; j < 2; j++){ B('g', cx, y + 0.3, cz + (j - 0.5) * 0.75, 1.3, 0.05, 0.6, K('#33508f'), 0.01, 0, 0.5); B('p', cx, y + 0.14, cz + (j - 0.5) * 0.75 - 0.05, 1.2, 0.2, 0.05, K('#9aa0ac')); } }
        else if(k === 'antenna'){ Cy('m', cx, y + 0.9, cz, 0.03, 0.03, 1.8, 6, K('#9aa0ac')); for(let j = 0; j < 3; j++) B('m', cx, y + 0.8 + j * 0.3, cz, 0.7 - j * 0.18, 0.025, 0.025, K('#9aa0ac')); Sph('p', cx + 0.3, y + 0.45, cz + 0.2, 0.2, 0.08, 0.2, K('#e8ecf2')); }
        else { B('p', cx, y + 0.3, cz, 0.95, 0.6, 0.8, K('#e6dcc8'), 0.04); B('p', cx, y + 0.65, cz, 1.05, 0.08, 0.9, K('#8f939e')); B('p', cx, y + 0.22, cz + 0.41, 0.34, 0.44, 0.03, acc); }
      }
    }
    function building(c, p){
      const R = rng(c.id), grey = c.closed, lim = Math.max(1, c.limit), bx = p.x, bz = p.z;
      const K = hex => { const k = C(hex); return grey ? k.lerp(GREYC, 0.6) : k; }, Ks = hex => { const k = K(hex); return snowy ? k.lerp(SNOWC, 0.88) : k; };
      const w = Math.max(3.8, Math.min(10, 3.4 + Math.sqrt(lim) * 0.7));
      const kind = c.ent ? (lim >= 24 && R() < 0.5 ? 'podium' : 'glass') : ['brick', 'stucco', 'timber', 'color'][Math.floor(R() * 4)];
      const S = STY[kind], isG = kind === 'glass' || kind === 'podium', wall = S.wall[Math.floor(R() * S.wall.length)], acc = S.acc[Math.floor(R() * S.acc.length)];
      const G = c.ent ? 1.4 : 1.0, FH = 1.15, Y0 = LOTY, wt = kind === 'podium' ? Math.max(3.0, Math.round(w * 0.74 * 2) / 2) : w;
      const wvOf = r => (kind === 'podium' && r >= 2 ? wt : w), colsOf = r => Math.max(2, Math.floor((wvOf(r) - 0.5) / S.S));
      let per = 1, nWin, rows;
      for(;;){ nWin = Math.ceil(lim / per); rows = 0; let slots = 0; while(slots < nWin && rows < 12){ slots += 2 * colsOf(rows); rows++; } if(slots >= nWin) break; per++; }
      if(kind === 'podium') rows = Math.max(rows, 4);
      const lit = grey ? 0 : Math.min(nWin, Math.ceil(c.used / per)), Hb = G + rows * FH, top = Y0 + Hb;
      const wallC = K(wall), trimC = K(S.trim), accC = K(acc), fz = bz + w / 2, fx = bx + w / 2, wvTop = wvOf(rows - 1);

      /* lot, contact shadow, base course */
      B('road', bx, LOTY / 2, bz, w + 2 * LOT, LOTY, w + 2 * LOT, K('#ece3d0'), 0.03); B('road', bx, 0.03, bz, w + 2 * LOT + 0.3, 0.06, w + 2 * LOT + 0.3, K('#d3c8b0'));
      Pl('ao', bx, LOTY + 0.006, bz, w + 2.8, w + 2.8, WHITE());
      B('p', bx, Y0 + 0.18, bz, w + 0.16, 0.36, w + 0.16, K('#a99d90'), 0.04);
      lots.push({ x: bx, z: bz, h: w / 2 + LOT });

      /* walls */
      if(!isG){
        B(S.key, bx, Y0 + Hb / 2, bz, w, Hb, w, wallC, 0.09, 0, 0, S.tile);
        for(let r = 0; r < rows; r++) B('p', bx, Y0 + G + FH * r, bz, w + 0.07, 0.07, w + 0.07, kind === 'timber' ? K(S.band) : trimC);
        if(kind !== 'timber') for(const sx of [-1, 1]) for(const sz of [-1, 1]) B('p', bx + sx * (w / 2 - 0.06), Y0 + Hb / 2, bz + sz * (w / 2 - 0.06), 0.3, Hb, 0.3, trimC, 0.04);
      } else {
        const bY = kind === 'podium' ? G + 2 * FH : Hb;
        if(kind === 'podium'){
          B('p', bx, Y0 + bY / 2, bz, w, bY, w, K('#e7dcc8'), 0.08); for(let r = 0; r < 2; r++) B('p', bx, Y0 + G + FH * r, bz, w + 0.07, 0.07, w + 0.07, K('#cdbf9f'));
          B('g', bx, Y0 + bY + (Hb - bY) / 2, bz, wt, Hb - bY, wt, wallC, 0.06);
          /* podium terrace */
          B('p', bx, Y0 + bY + 0.05, bz, w - 0.1, 0.1, w - 0.1, K('#e9e1d0'));
          for(const sx of [-1, 1]){ const gx = bx + sx * ((w + wt) / 4); B('p', gx, Y0 + bY + 0.14, bz, Math.max(0.5, (w - wt) / 2 - 0.5), 0.1, w - 1.2, K('#a9cf8e'), 0.03); for(let j = 0; j < 3; j++) SH.push([gx, Y0 + bY + 0.36, bz + (j - 1) * Math.min(1.6, (w - 1.6) / 2.6), 0.32, j === 1 ? '#f4a9c0' : '#6fb067']); }
          for(const [rx2, rz2, sx2, sz2] of [[0, 1, w, 0.03], [0, -1, w, 0.03], [1, 0, 0.03, w], [-1, 0, 0.03, w]]) B('g', bx + rx2 * (w / 2 - 0.08), Y0 + bY + 0.4, bz + rz2 * (w / 2 - 0.08), sx2 === 0.03 ? 0.03 : sx2 - 0.2, 0.55, sz2 === 0.03 ? 0.03 : sz2 - 0.2, K('#c9e6f4'));
        } else B('g', bx, Y0 + Hb / 2, bz, w, Hb, w, wallC, 0.06);
        B('g', bx, Y0 + G / 2, bz, w + 0.03, G, w + 0.03, K('#5f86a8'));   /* darker lobby glazing */
        const mullC = K('#eef2f7');
        const vols = kind === 'podium' ? [{ wv: wt, ya: G + 2 * FH, yb: Hb, r0: 2 }] : [{ wv: w, ya: G, yb: Hb, r0: 0 }];
        vols.forEach(v => {
          const cols = colsOf(v.r0), sp = (v.wv - 0.7) / cols, hgt = v.yb - v.ya;
          for(let kk = 0; kk <= cols; kk++){ const t = -cols / 2 * sp + kk * sp, e = v.wv / 2 + 0.03;
            B('m', bx + t, Y0 + v.ya + hgt / 2, bz + e, 0.06, hgt, 0.06, mullC); B('m', bx + t, Y0 + v.ya + hgt / 2, bz - e, 0.06, hgt, 0.06, mullC); B('m', bx + e, Y0 + v.ya + hgt / 2, bz + t, 0.06, hgt, 0.06, mullC); B('m', bx - e, Y0 + v.ya + hgt / 2, bz + t, 0.06, hgt, 0.06, mullC); }
          for(let r = v.ya; r <= v.yb + 0.001; r += FH) B('m', bx, Y0 + r, bz, v.wv + 0.06, 0.1, v.wv + 0.06, mullC);
        });
      }

      /* entrance on the front (+z) face */
      const dw = 1.2, dh = G - 0.12;
      B('p', bx, Y0 + dh / 2 + 0.02, fz + 0.03, dw + 0.2, dh + 0.1, 0.1, isG ? K('#eef2f7') : accC);
      B('g', bx - 0.27, Y0 + dh / 2, fz + 0.085, 0.5, dh - 0.05, 0.04, K('#a9d8ec')); B('g', bx + 0.27, Y0 + dh / 2, fz + 0.085, 0.5, dh - 0.05, 0.04, K('#a9d8ec'));
      B('p', bx, Y0 + 0.035, fz + 0.5, 1.7, 0.07, 0.7, K('#e4dbc8')); B('p', bx, Y0 + 0.07, fz + 0.38, 1.4, 0.07, 0.5, K('#ddd3bd'));
      const cw = c.ent ? 2.6 : 2.0;
      B(isG ? 'm' : 'p', bx, Y0 + G - 0.03, fz + 0.62, cw, 0.08, 1.2, isG ? K('#f5f7fa') : accC, 0.025);
      for(const sx of [-1, 1]) Cy('m', bx + sx * (cw / 2 - 0.1), Y0 + (G - 0.03) / 2, fz + 1.1, 0.035, 0.035, G - 0.03, 6, K('#f5f7fa'));
      if(!isG){
        if(w >= 5){
          const ww = (w - dw - 1.3) / 2, hh = G - 0.4, aw = R() < 0.55;
          for(const sx of [-1, 1]){ const cx = bx + sx * (dw / 2 + 0.35 + ww / 2), cy = Y0 + G / 2 + 0.02;
            B('p', cx, cy, fz + 0.02, ww + 0.16, hh + 0.16, 0.06, trimC); B('g', cx, cy, fz + 0.055, ww, hh, 0.04, K('#9fd0e6'));
            if(aw) for(let j = 0; j < 5; j++) B('p', cx - ww / 2 - 0.05 + (j + 0.5) * (ww + 0.1) / 5, Y0 + G - 0.12, fz + 0.3, (ww + 0.1) / 5, 0.04, 0.6, j % 2 ? K('#fff6e6') : accC, 0, 0, 0.45); }
        }
        B('p', fx + 0.03, Y0 + G - 0.12, bz, 0.07, 0.24, w - 0.8, accC);
        for(let j = 0; j < 4; j++) B('p', fx + 0.07, Y0 + G - 0.12, bz - w / 2 + 1.1 + j * ((w - 2.2) / 3), 0.03, 0.12, 0.34, K('#fff8e8'));
        const np = Math.max(1, Math.floor((w - 1.2) / 1.5)), sp2 = (w - 1) / np;
        for(let j = 0; j < np; j++){ const zc = bz - (w - 1) / 2 + (j + 0.5) * sp2; B('p', fx + 0.015, Y0 + G / 2 - 0.1, zc, 0.05, G - 0.38, sp2 - 0.1, trimC); B('g', fx + 0.05, Y0 + G / 2 - 0.1, zc, 0.04, G - 0.5, sp2 - 0.26, K('#9fd0e6')); }
        if(rows >= 3 && R() < 0.65){
          const rb = 1 + Math.floor(R() * (rows - 2)), cols = colsOf(0), sp = (w - 0.7) / cols, bwid = Math.min(2 * sp, w - 1), y = Y0 + G + FH * rb, rc = K('#4c4a58');
          B('p', bx, y + 0.02, fz + 0.3, bwid, 0.09, 0.6, trimC, 0.02); B('p', bx, y + 0.36, fz + 0.58, bwid, 0.035, 0.035, rc); B('p', bx, y + 0.12, fz + 0.58, bwid, 0.03, 0.03, rc);
          for(let j = 0; j < 6; j++) B('p', bx - bwid / 2 + 0.05 + j * (bwid - 0.1) / 5, y + 0.24, fz + 0.58, 0.03, 0.24, 0.03, rc);
        }
      }
      /* rear and left faces: down pipe, vents, maintenance ladder */
      B('p', bx - w / 2 - 0.03, Y0 + Hb / 2, bz - w / 2 - 0.03, 0.09, Hb, 0.09, K('#8c8f99'));
      for(let j = 0; j < 3; j++){ const r = Math.floor(R() * rows), off = (R() - 0.5) * (w - 1.4), y = Y0 + G + FH * (r + 0.5); B('p', bx + off, y, bz - w / 2 - 0.03, 0.5, 0.3, 0.06, K('#6d6a78')); B('p', bx + off, y, bz - w / 2 - 0.065, 0.42, 0.03, 0.02, K('#a29fb0')); B('p', bx - w / 2 - 0.03, y, bz + off, 0.06, 0.3, 0.5, K('#6d6a78')); }
      if(kind === 'brick' || kind === 'timber'){ for(const sx of [-1, 1]) B('p', bx + sx * 0.3, Y0 + (G + Hb) / 2, bz - w / 2 - 0.14, 0.04, Hb - G, 0.04, K('#4c4a58')); for(let y = G + 0.2; y < Hb; y += 0.32) B('p', bx, Y0 + y, bz - w / 2 - 0.14, 0.6, 0.025, 0.025, K('#4c4a58')); }

      /* rooftop */
      let H;
      if(!isG){
        B('p', bx, top + 0.06, bz, w + 0.22, 0.12, w + 0.22, trimC); B('p', bx, top + 0.17, bz, w + 0.4, 0.1, w + 0.4, kind === 'timber' ? K('#8a5a3a') : trimC);
        B('p', bx, top + 0.2, bz, w - 0.1, 0.06, w - 0.1, Ks(S.roof));
        for(const [a, b2, sx, sz] of [[0, 1, w + 0.1, 0.14], [0, -1, w + 0.1, 0.14], [1, 0, 0.14, w - 0.2], [-1, 0, 0.14, w - 0.2]]) B('p', bx + a * (w / 2 - 0.05), top + 0.37, bz + b2 * (w / 2 - 0.05), sx, 0.3, sz, Ks(S.trim));
        roofGear(bx, bz, w, top + 0.23, R, K, accC); H = top + 1.0;
      } else {
        const wvt = wvTop, cy = top;
        B('p', bx, cy + 0.04, bz, wvt + 0.1, 0.08, wvt + 0.1, Ks('#cfd6e0'));
        B('m', bx, cy + 0.6, bz, wvt * 0.8, 1.0, wvt * 0.8, K('#c9d3de'), 0.05);
        for(let j = 0; j < 5; j++){ B('p', bx, cy + 0.25 + j * 0.18, bz + wvt * 0.4 + 0.01, wvt * 0.7, 0.05, 0.02, K('#6d7a8c')); B('p', bx + wvt * 0.4 + 0.01, cy + 0.25 + j * 0.18, bz, 0.02, 0.05, wvt * 0.7, K('#6d7a8c')); }
        for(const [gx, gz, gsx, gsz] of [[0, 1, 1, 0], [0, -1, 1, 0], [1, 0, 0, 1], [-1, 0, 0, 1]]){ const ww2 = wvt * 0.8 + 0.06; B('glow', bx + gx * ww2 / 2, cy + 1.12, bz + gz * ww2 / 2, gsx ? ww2 : 0.07, 0.07, gsz ? ww2 : 0.07, accC); }
        B('m', bx, cy + 1.4, bz, wvt * 0.5, 0.55, wvt * 0.5, K('#e6edf4'), 0.05);
        Cy('m', bx - wvt * 0.22, cy + 2.5, bz - wvt * 0.22, 0.02, 0.09, 2.2, 8, K('#d9dfe8'));
        const mx = bx + wvt * 0.36, mz = bz + wvt * 0.36;
        Cy('m', mx, cy + 1.9, mz, 0.03, 0.03, 1.8, 6, K('#f2f4f8')); B('p', mx + 0.3, cy + 2.55, mz, 0.6, 0.36, 0.02, accC); B('p', mx + 0.12, cy + 2.55, mz, 0.2, 0.36, 0.025, K('#ffffff')); B('p', mx + 0.68, cy + 2.52, mz, 0.2, 0.3, 0.02, accC, 0, 0.3);
        H = cy + 3.2;
      }
      const lg = isG ? 1.1 : 0;   /* rooftop sign legs */
      if(c.full && !grey) fulls.push({ x: bx, y: (isG ? top + 2.6 : top + 1.5 + 0.9), z: bz, base: isG ? top + 1.4 : top + 0.23, c });
      if(c.full && !grey){ for(const sx of [-1, 1]) B('p', bx + sx * 0.7, (isG ? top + 1.4 : top + 0.23) + 0.5, bz, 0.06, 1.0 + lg * 0.2, 0.06, K('#5b5668')); }

      /* windows: one per seat */
      let g = 0;
      for(let r = 0; r < rows && g < nWin; r++){
        const wv = wvOf(r), cols = colsOf(r), sp = (wv - 0.7) / cols, y = Y0 + G + FH * (r + 0.5);
        for(let cc = 0; cc < cols; cc++) for(let f = 0; f < 2; f++){
          if(g >= nWin) break;
          const off = -(cols - 1) * sp / 2 + cc * sp, L = g < lit; g++;
          const e = { y, lit: L, fw: isG ? sp * 0.97 : S.fw, fh: isG ? FH * 0.88 : S.fh, bd: S.bd, fc: K(S.frame), cross: !!(S.cross || kind === 'brick'), sill: !!S.sill && !isG, lintel: !!S.lintel, shut: S.shut ? K(acc) : null, grey };
          if(f === 0){ e.x = bx + off; e.z = bz + wv / 2; e.ry = 0; } else { e.x = bx + wv / 2; e.z = bz + off; e.ry = Math.PI / 2; }
          WL.push(e);
        }
      }
      /* suspended: roller shutters over the ground floor and a board on the door */
      if(grey){
        B('shutter', bx, Y0 + (G - 0.1) / 2 + 0.02, fz + 0.14, w - 0.3, G - 0.14, 0.05, K('#cfcdd8'), 0, 0, 0, 0.5); B('p', bx, Y0 + G - 0.06, fz + 0.15, w - 0.2, 0.14, 0.18, K('#8d8b99'), 0.03);
        B('shutter', fx + 0.12, Y0 + (G - 0.1) / 2 + 0.02, bz, 0.05, G - 0.14, w - 0.3, K('#cfcdd8'), 0, 0, 0, 0.5); B('p', fx + 0.13, Y0 + G - 0.06, bz, 0.18, 0.14, w - 0.2, K('#8d8b99'), 0.03);
        for(const sx of [-1, 1]) B('p', bx + sx * 0.45, Y0 + 0.78, fz + 0.2, 0.015, 0.2, 0.015, C('#6d6a78'));
        const g2 = new T.PlaneGeometry(1.3, 0.52); put('cs', g2, bx, Y0 + 0.5, fz + 0.24, 0, 0, 0, WHITE(), 0); g2.dispose();
      }
      /* plant pots by the door */
      if(!isG) for(const sx of [-1, 1]){ B('p', bx + sx * 1.05, Y0 + 0.2, fz + 0.5, 0.4, 0.4, 0.4, K('#c98b6b'), 0.05); SH.push([bx + sx * 1.05, Y0 + 0.55, fz + 0.5, 0.26, '#6fb067']); }
      SH.push([bx - w / 2 - 0.9, 0.55, bz + w / 2 + 0.6, 0.6, '#9fd49a']); SH.push([bx - w / 2 - 0.8, 1.05, bz + w / 2 + 0.8, 0.1, '#ffb3c7']);
      bld.push({ c, x: bx, z: bz, w, H, a: p.a, ph: hash(c.id) * 6.28, ring: p.ring });
      bb.h = Math.max(bb.h, H + 3.5);
    }
    let ext = 12;
    cs.forEach((c, i) => { building(c, pos[i]); ext = Math.max(ext, Math.hypot(pos[i].x, pos[i].z) + bld[i].w); });

    /* ── streets: each building hangs off the nearest building one ring closer (ring 1 hangs off the HQ plaza) ── */
    const edges = [], ASPH = C('#a9a7b4'), SIDE = C('#efe7d6'), CURB = C('#f8f3e8'), LINE = C('#ffffff');
    bld.forEach((b, i) => {
      let par = null, bd2 = 1e9;
      if(b.ring > 1) bld.forEach(o => { if(o.ring === b.ring - 1){ const dd = Math.hypot(o.x - b.x, o.z - b.z); if(dd < bd2){ bd2 = dd; par = o; } } });
      edges.push({ ax: par ? par.x : 0, az: par ? par.z : 0, bx: b.x, bz: b.z, hq: !par, b });
    });
    const lampPts = [];
    edges.forEach(e => {
      const dx = e.bx - e.ax, dz = e.bz - e.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, ry = -Math.atan2(uz, ux), s0 = e.hq ? PLAZA - 0.3 : 0, len = L - s0, mid = s0 + len / 2, px = -uz, pz = ux;
      const gray = e.b.c.closed; const tint = c2 => (gray ? C(c2).lerp(GREYC, 0.3) : C(c2));
      e.ux = ux; e.uz = uz; e.L = L; e.s0 = s0; e.px = px; e.pz = pz;
      const cx = e.ax + ux * mid, cz = e.az + uz * mid;
      B('road', cx, 0.02, cz, len, 0.04, 2.2, tint('#a9a7b4'), 0, ry);
      for(const sg of [-1, 1]){ B('road', cx + px * sg * 1.5, 0.04, cz + pz * sg * 1.5, len, 0.08, 0.8, SIDE, 0, ry); B('road', cx + px * sg * 1.14, 0.05, cz + pz * sg * 1.14, len, 0.1, 0.1, CURB, 0, ry); }
      const nd = Math.floor(len / 2.4); for(let j = 0; j < nd; j++){ const s = s0 + (j + 0.5) * len / nd; B('road', e.ax + ux * s, 0.046, e.az + uz * s, 0.9, 0.012, 0.1, LINE, 0, ry); }
      const entry = e.b.w / 2 + LOT, ent = entry / Math.max(Math.abs(ux), Math.abs(uz)) + 1.4;
      for(const s of [s0 + 1.5, L - ent]) if(s > s0 + 0.5 && s < L - 1) for(let j = -2; j <= 2; j++) B('road', e.ax + ux * s + px * j * 0.42, 0.046, e.az + uz * s + pz * j * 0.42, 1.0, 0.012, 0.24, LINE, 0, ry);
      e.end = L - ent - 1.2;
      for(let s = s0 + 3.2, k = 0; s < L - ent - 1.5; s += 6.8, k++){ const side = k % 2 ? 1 : -1, lx = e.ax + ux * s + px * side * 1.95, lz = e.az + uz * s + pz * side * 1.95;
        if(lots.some(l => Math.abs(lx - l.x) < l.h + 0.4 && Math.abs(lz - l.z) < l.h + 0.4)) continue; lampPts.push([lx, lz]); }
    });

    /* ── HQ landmark and plaza ── */
    hq = { x: 0, z: 0, top: 9.2 };
    { const cream = C('#fff1da'), cream2 = C('#f6e6cc'), purple = C('#5e6ad2'), stone = C('#efe5d1'), stone2 = C('#e3d6bb');
      for(let k = 0; k < 16; k++){ const g = new T.CircleGeometry(PLAZA, 2, k * Math.PI / 8, Math.PI / 8); g.rotateX(-Math.PI / 2); g.scale(1, 1, 1); put('road', g, 0, LOTY - 0.04, 0, 0, 0, 0, k % 2 ? stone : stone2, 0); g.dispose(); }
      { const g = new T.RingGeometry(PLAZA - 0.5, PLAZA, 64); g.rotateX(-Math.PI / 2); put('road', g, 0, LOTY - 0.035, 0, 0, 0, 0, C('#cdbf9f'), 0); g.dispose(); }
      { const g = new T.RingGeometry(5.3, 5.6, 64); g.rotateX(-Math.PI / 2); put('road', g, 0, LOTY - 0.03, 0, 0, 0, 0, C('#cfc6f2'), 0); g.dispose(); }
      for(let k = 0; k < 16; k++){ const a = k * Math.PI / 8; B('road', Math.cos(a) * 6.8, LOTY - 0.032, Math.sin(a) * 6.8, 2.2, 0.006, 0.06, C('#cdbf9f'), 0, -a); }
      Cy('road', 0, 0.025, 0, PLAZA + 0.3, PLAZA + 0.3, 0.05, 64, C('#d3c8b0'));
      Pl('ao', 0, LOTY - 0.02, 0, 11.4, 11.4, WHITE());
      Cy('road', 0, 0.12, 0, 5.15, 5.15, 0.12, 48, stone); Cy('road', 0, 0.2, 0, 4.7, 4.7, 0.1, 48, C('#f5eddc'));
      const bodyH = (y0, y1, r, col, seg = 40) => Cy('p', 0, (y0 + y1) / 2, 0, r, r, y1 - y0, seg, col);
      bodyH(0.25, 2.5, 4.3, cream); Cy('g', 0, 1.15, 0, 4.34, 4.34, 1.2, 40, C('#8fc5ea')); for(let k = 0; k < 28; k++){ const a = k / 28 * Math.PI * 2; B('m', Math.cos(a) * 4.38, 1.15, Math.sin(a) * 4.38, 0.1, 1.2, 0.1, C('#ffffff'), 0, -a); }
      Cy('p', 0, 2.55, 0, 4.5, 4.5, 0.18, 40, stone);
      bodyH(2.5, 5.2, 3.5, cream2); Cy('g', 0, 3.8, 0, 3.55, 3.55, 1.6, 40, C('#7fb8e6'));
      for(let k = 0; k < 20; k++){ const a = k / 20 * Math.PI * 2; B('m', Math.cos(a) * 3.58, 3.8, Math.sin(a) * 3.58, 0.09, 1.6, 0.09, C('#ffffff'), 0, -a); B('p', Math.cos(a) * 3.57, 3.8, Math.sin(a) * 3.57, 0.1, 1.9, 0.16, cream, 0.03, -a); }
      Cy('p', 0, 5.3, 0, 3.7, 3.7, 0.28, 40, purple);
      bodyH(5.4, 7.2, 2.6, cream); Cy('p', 0, 7.25, 0, 2.78, 2.78, 0.14, 40, stone);
      { const g = new T.SphereGeometry(2.45, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, 0.28, 1); put('p', g, 0, 7.3, 0, 0, 0, 0, C('#e8e4ff'), 0); g.dispose(); }
      Cy('p', 0, 8.0, 0, 1.0, 1.1, 0.12, 28, purple); { const g = new T.TorusGeometry(0.85, 0.035, 6, 32); g.rotateX(Math.PI / 2); put('glow', g, 0, 8.09, 0, 0, 0, 0, C('#cfc6ff'), 0); g.dispose(); }
      Cy('m', 0, 8.65, 0, 0.04, 0.07, 1.2, 8, C('#ffffff')); for(let j = 0; j < 2; j++) B('m', 0, 8.55 + j * 0.3, 0, 0.7 - j * 0.25, 0.03, 0.03, C('#ffffff'));
      for(let k = 0; k < 10; k++){ const a = k / 10 * Math.PI * 2 + 0.15; WL.push({ x: Math.cos(a) * 2.6, z: Math.sin(a) * 2.6, ry: Math.PI / 2 - a, y: 6.3, lit: true, fw: 0.62, fh: 0.8, bd: 0.08, fc: C('#ffffff'), cross: false, hq: true }); }
      /* fountain, planters, benches */
      const fx0 = 4.6, fz0 = 4.6; Cy('p', fx0, 0.3, fz0, 1.0, 1.05, 0.34, 28, stone); Cy('g', fx0, 0.43, fz0, 0.85, 0.85, 0.06, 28, C('#7fd0f0')); Cy('p', fx0, 0.6, fz0, 0.14, 0.2, 0.5, 10, stone); Cy('g', fx0, 0.9, fz0, 0.3, 0.12, 0.08, 14, C('#a8e2f5')); Cy('g', fx0, 1.15, fz0, 0.03, 0.12, 0.55, 8, C('#d6f3fc'));
      for(const [dx2, dz2] of [[0.5, 0], [-0.5, 0.2], [0.1, -0.5]]) Sph('g', fx0 + dx2, 0.55, fz0 + dz2, 0.07, 0.07, 0.07, C('#d6f3fc'));
      for(const a of [0.15, 1.35, 2.25, 3.4, 4.6, 5.55]){ const x = Math.cos(a) * 7.0, z = Math.sin(a) * 7.0; Cy('p', x, 0.3, z, 0.58, 0.5, 0.4, 14, stone); Cy('p', x, 0.5, z, 0.5, 0.5, 0.04, 14, C('#7a5a3a')); SH.push([x, 0.8, z, 0.46, '#6fb067'], [x + 0.18, 1.1, z + 0.1, 0.12, '#f4a9c0'], [x - 0.2, 1.05, z - 0.1, 0.1, '#ffd36a']); }
      for(const a of [0.75, 2.4, 3.9, 5.2]){ const x = Math.cos(a) * 5.9, z = Math.sin(a) * 5.9, ry2 = -a + Math.PI / 2;
        B('wood', x, 0.42, z, 1.1, 0.07, 0.36, C('#c9976a'), 0.02, ry2, 0, 2.1); const [bx2, bz2] = rot(0, -0.17, ry2); B('wood', x + bx2, 0.65, z + bz2, 1.1, 0.34, 0.05, C('#c9976a'), 0.02, ry2, 0, 2.1);
        for(const sx of [-0.45, 0.45]){ const [lx2, lz2] = rot(sx, 0, ry2); B('m', x + lx2, 0.2, z + lz2, 0.06, 0.4, 0.34, C('#5b5668'), 0, ry2); } }
      for(let k = 0; k < 4; k++){ const a = k * Math.PI / 2 + Math.PI / 4 + 0.2, x = Math.cos(a) * 7.5, z = Math.sin(a) * 7.5; lampPts.push([x, z]); }
    }
    /* cars parked along some streets */
    { const R = rng('cars'), cols = ['#e4574f', '#4f8fe4', '#f2c04b', '#5cb98a', '#f2f0ea', '#8a6fd9'], cand = edges.filter(e => e.end - e.s0 > 6);
      for(let i = 0, n = Math.min(10, Math.ceil(cand.length * 0.5)); i < n && cand.length; i++){
        const e = cand[Math.floor(R() * cand.length)], s = e.s0 + 3 + R() * (e.end - e.s0 - 5), lane = R() < 0.5 ? -1 : 1, x = e.ax + e.ux * s + e.px * lane * 0.55, z = e.az + e.uz * s + e.pz * lane * 0.55, ry = -Math.atan2(e.uz, e.ux) + (lane > 0 ? Math.PI : 0), col = C(cols[Math.floor(R() * cols.length)]);
        B('p', x, 0.25, z, 1.45, 0.28, 0.76, col, 0.1, ry); const [cx2, cz2] = rot(-0.05, 0, ry); B('p', x + cx2, 0.5, z + cz2, 0.8, 0.26, 0.68, col, 0.09, ry); B('g', x + cx2, 0.51, z + cz2, 0.82, 0.18, 0.69, C('#2f3d55'), 0.05, ry);
        for(const [lx, lz] of [[-0.45, -0.38], [0.45, -0.38], [-0.45, 0.38], [0.45, 0.38]]){ const [wx2, wz2] = rot(lx, lz, ry); Cy('p', x + wx2, 0.12, z + wz2, 0.12, 0.12, 0.1, 10, C('#33323c'), Math.PI / 2, 0); }
      }
    }

    /* ── island ── */
    let gu = 8, gv = 8; const pts = [];
    bld.forEach(b => { gu = Math.max(gu, Math.abs((b.x - b.z) * 0.7071) + b.w * 0.8 + 4.2); gv = Math.max(gv, Math.abs((b.x + b.z) * 0.7071) + b.w * 0.8 + 4.2);
      for(const dx of [-1, 1]) for(const dz of [-1, 1]) for(const y of [0, b.H + 3.6]) pts.push([b.x + dx * (b.w / 2 + 1.5), y, b.z + dz * (b.w / 2 + 1.5)]); });
    for(const dx of [-1, 1]) for(const dz of [-1, 1]) for(const y of [0, 12]) pts.push([dx * 7, y, dz * 7]);
    gu = Math.max(gu, 14); gv = Math.max(gv, 14);
    const isl = (rad, y, h, mats) => { const m = track(new T.Mesh(track(new T.CylinderGeometry(1, 1, h, 96)), mats)); m.scale.set(rad[0], 1, rad[1]); m.rotation.y = Math.PI / 4; m.position.y = y; m.receiveShadow = true; m.castShadow = false; world.add(m); return m; };
    { const gt = isl([gu, gv], -0.2, 0.4, [MT.side, MT.grassTop, MT.side]); 
      const sc = (hex) => { const m = std({ color: hex, roughness: 0.95 }); return m; };
      isl([gu + 0.3, gv + 0.3], -0.5, 0.2, sc('#ece1c8')); isl([gu - 0.3, gv - 0.3], -1.0, 0.8, sc('#bd9b72')); isl([gu - 1.4, gv - 1.4], -1.7, 0.6, sc('#8f7b66')); }
    /* soil colour of the grass edge */
    MT.side.color.set('#b6dc9b');
    bb = { pts, gu, gv, h: bb.h, x1: gu * 0.7, z1: gv * 0.7 };
    extent = Math.max(gu, gv) + 10;
    const sh = sun.shadow.camera; sh.left = -extent; sh.right = extent; sh.top = extent; sh.bottom = -extent; sh.near = 1; sh.far = 320; sh.updateProjectionMatrix();

    /* ── trees, hedges, lamps, people ── */
    const TR = [], CAN = [], R2 = rng('trees'), greens = ['#7fbf72', '#8fcf7f', '#6fb067', '#9bd48a', '#5fa66a'], tcount = Math.min(90, Math.floor(Math.PI * gu * gv / 44));
    const sgPos = bld.map(b => [b.x + b.w * 0.5 + 0.9, b.z + b.w * 0.5 + 1.9]);
    const segDist = (x, z, e) => { const t = clampN(((x - e.ax) * e.ux + (z - e.az) * e.uz), e.s0, e.L), qx = e.ax + e.ux * t, qz = e.az + e.uz * t; return Math.hypot(x - qx, z - qz); };
    for(let tries = 0; tries < 900 && TR.length < tcount; tries++){
      const u = (R2() * 2 - 1) * gu, v = (R2() * 2 - 1) * gv; if((u / (gu - 2.2)) ** 2 + (v / (gv - 2.2)) ** 2 > 1) continue;
      const x = (u + v) * 0.7071, z = (v - u) * 0.7071;
      if(Math.hypot(x, z) < PLAZA + 1.2) continue;
      if(lots.some(l => Math.abs(x - l.x) < l.h + 1.1 && Math.abs(z - l.z) < l.h + 1.1)) continue;
      if(edges.some(e => segDist(x, z, e) < 2.9)) continue;
      if(sgPos.some(s => Math.hypot(x - s[0], z - s[1]) < 2.6)) continue;
      if(TR.some(q => Math.hypot(x - q[0], z - q[1]) < 2.3)) continue;
      TR.push([x, z, R2()]);
    }
    const tint = hex => (snowy ? C(hex).lerp(SNOWC, 0.45) : C(hex));
    const treeCol = () => { const r = R2(); return r < 0.06 ? '#f4b3c8' : r < 0.14 ? '#e5a24a' : greens[Math.floor(R2() * greens.length)]; };
    const trk = [];
    TR.forEach(([x, z, r]) => {
      const kind = r < 0.5 ? 0 : r < 0.75 ? 1 : 2, s = 0.85 + R2() * 0.5, col = treeCol();
      if(kind === 0){ trk.push([x, z, 1.1 * s, 0.13]); CAN.push(['s', x, 1.5 * s + 0.4, z, 1.0 * s, 0.9 * s, 1.0 * s, col], ['s', x + 0.35 * s, 1.2 * s + 0.4, z - 0.2 * s, 0.62 * s, 0.6 * s, 0.62 * s, col]); }
      else if(kind === 1){ trk.push([x, z, 0.7 * s, 0.1]); CAN.push(['c', x, 1.1 * s + 0.2, z, 1.0 * s, 1.5 * s, 1.0 * s, '#4f9a62'], ['c', x, 2.0 * s + 0.2, z, 0.72 * s, 1.2 * s, 0.72 * s, '#5fae70']); }
      else CAN.push(['s', x, 0.42 * s, z, 0.7 * s, 0.55 * s, 0.7 * s, col]);
    });
    for(let q = 0; q < Math.floor(Math.PI * (gu + gv) / 3.6); q++){ const a = q / Math.floor(Math.PI * (gu + gv) / 3.6) * Math.PI * 2, u = Math.cos(a) * (gu - 1.1), v = Math.sin(a) * (gv - 1.1); SH.push([(u + v) * 0.7071, 0.45 + R2() * 0.1, (v - u) * 0.7071, 0.6 + R2() * 0.35, ['#9fd49a', '#b5e0a0', '#8fcf9b'][q % 3]]); }
    SH.forEach(s => CAN.push(['s', s[0], s[1], s[2], s[3], s[3] * 0.85, s[3], s[4]]));
    if(GB.cs){ const cc3 = cs.find(c => c.closed), cvs = document.createElement('canvas'), x3 = cvs.getContext('2d'); cvs.width = 260; cvs.height = 104; x3.fillStyle = '#f3ecd9'; x3.fillRect(0, 0, 260, 104); x3.lineWidth = 8; x3.strokeStyle = '#b4443f'; x3.strokeRect(6, 6, 248, 92); x3.fillStyle = '#b4443f'; x3.font = '800 54px "Noto Sans KR","Geist",sans-serif'; x3.textAlign = 'center'; x3.textBaseline = 'middle'; x3.fillText(cc3 ? cc3.sign.seats : 'Closed', 130, 56);
      meshes.csMat = track(new T.MeshBasicMaterial({ map: tex(cvs), toneMapped: false })); }
    flushGB();
    { const tr = mk(meshes.cyl, MT.inst, trk.length, true); trk.forEach((t, i) => { setM(tr, i, t[0], t[2] / 2, t[1], 0, 0, t[3], t[2], t[3]); tr.setColorAt(i, C('#8a6a4a')); }); tr.instanceMatrix.needsUpdate = true; if(tr.instanceColor) tr.instanceColor.needsUpdate = true; }
    { const cs2 = CAN.filter(q => q[0] === 's'), cc2 = CAN.filter(q => q[0] === 'c');
      const a = mk(meshes.ico, MT.inst, cs2.length, true); cs2.forEach((q, i) => setM(a, i, q[1], q[2], q[3], 0, i * 0.7, q[4], q[5], q[6])); colorAll(a, cs2.map(q => tint(q[7])));
      const b2 = mk(meshes.cone, MT.inst, cc2.length, true); cc2.forEach((q, i) => setM(b2, i, q[1], q[2], q[3], 0, i, q[4], q[5], q[6])); colorAll(b2, cc2.map(q => tint(q[7]))); }
    /* lamps */
    { const lp = lampPts; const pole = mk(meshes.cyl, MT.inst, lp.length, true), head = mk(meshes.sph, MT.bulb, lp.length, false, false), pool = mk(meshes.plane, MT.pool, lp.length, false, false);
      lp.forEach(([x, z], i) => { setM(pole, i, x, 1.1, z, 0, 0, 0.07, 2.2, 0.07); pole.setColorAt(i, C('#5b5668')); setM(head, i, x, 2.28, z, 0, 0, 0.19, 0.19, 0.19); setM(pool, i, x, 0.092, z, -Math.PI / 2, 0, 6.5, 6.5, 1); });
      pole.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = pool.instanceMatrix.needsUpdate = true; if(pole.instanceColor) pole.instanceColor.needsUpdate = true; meshes.pool = pool; }
    /* people (static low poly, gentle idle sway and a slow stroll) */
    { const R = rng('peds'), n = Math.min(14, 3 + Math.floor(bld.length * 0.8)), pc = ['#e4574f', '#4f8fe4', '#f2c04b', '#5cb98a', '#8a6fd9', '#f2f0ea'];
      for(let i = 0; i < n; i++){ const e = edges[Math.floor(R() * edges.length)], side = R() < 0.5 ? -1 : 1; peds.push({ e, side, ph: R() * 6.28, sp: 0.03 + R() * 0.04, s0: e.s0 + 2 + R() * Math.max(0.1, e.end - e.s0 - 3), col: pc[i % pc.length] }); }
      const body = mk(meshes.cyl, MT.inst, peds.length, true), headm = mk(meshes.sph, MT.inst, peds.length, true); meshes.pb = body; meshes.ph = headm;
      colorAll(body, peds.map(p => C(p.col))); colorAll(headm, peds.map(() => C('#f3d2b4'))); }

    /* ── windows ── */
    { const lit = WL.filter(q => q.lit), drk = WL.filter(q => !q.lit), nW = WL.length;
      const fr = mk(meshes.frame, MT.inst, nW, false), gl = mk(meshes.plane, MT.lit, lit.length, false), gd = mk(meshes.plane, MT.dark, drk.length, false), ha = mk(meshes.plane, MT.halo, lit.length, false, false);
      const xs = WL.filter(q => q.cross), sl = WL.filter(q => q.sill), li = WL.filter(q => q.lintel), sh2 = WL.filter(q => q.shut);
      const cr = mk(meshes.cross, MT.inst, xs.length, false), tr2 = mk(meshes.box, MT.inst, sl.length + li.length, false), shm = mk(meshes.box, MT.inst, sh2.length * 2, false);
      let i1 = 0, i2 = 0, ti = 0, si = 0, xi = 0;
      const frc = [], dkc = [], lcc = [], xc = [], tc = [], shc = [], rn = rng('lit');
      WL.forEach((q, i) => {
        const s = Math.sin(q.ry), c2 = Math.cos(q.ry), tx = c2, tz = -s, P = (o, dx = 0) => [q.x + s * o + tx * dx, q.z + c2 * o + tz * dx];
        let [px, pz] = P(0.03); setM(fr, i, px, q.y, pz, 0, q.ry, q.fw, q.fh, 0.1); frc.push(q.fc);
        const gw = q.fw - 2 * q.bd, gh = q.fh - 2 * q.bd; [px, pz] = P(0.045);
        if(q.lit){ setM(gl, i1, px, q.y, pz, 0, q.ry, gw, gh, 1); lcc.push(C(rn() < 0.25 ? '#ffe9b0' : '#ffd37a')); [px, pz] = P(0.115); setM(ha, i1, px, q.y, pz, 0, q.ry, q.fw * 2.0, q.fh * 1.9, 1); i1++; }
        else { setM(gd, i2, px, q.y, pz, 0, q.ry, gw, gh, 1); dkc.push(C(q.grey ? '#7c8294' : DARK).multiplyScalar(0.85 + rn() * 0.3)); i2++; }
        if(q.cross){ [px, pz] = P(0.065); setM(cr, xi++, px, q.y, pz, 0, q.ry, gw, gh, 0.03); xc.push(q.fc); }
        if(q.sill){ [px, pz] = P(0.09); setM(tr2, ti++, px, q.y - q.fh / 2 - 0.04, pz, 0, q.ry, q.fw + 0.2, 0.07, 0.2); tc.push(q.fc); }
        if(q.lintel){ [px, pz] = P(0.06); setM(tr2, ti++, px, q.y + q.fh / 2 + 0.05, pz, 0, q.ry, q.fw + 0.2, 0.1, 0.14); tc.push(q.fc); }
        if(q.shut){ for(const sg of [-1, 1]){ [px, pz] = P(0.05, sg * (q.fw / 2 + 0.11)); setM(shm, si++, px, q.y, pz, 0, q.ry, 0.2, q.fh, 0.05); shc.push(q.shut); } }
      });
      colorAll(fr, frc); colorAll(gl, lcc); colorAll(gd, dkc); colorAll(cr, xc); colorAll(tr2, tc); colorAll(shm, shc); ha.instanceMatrix.needsUpdate = true;
      /* fix instance counts: cross bars were written by index in the filtered list */
      meshes.win = { lit: lit.length, dark: drk.length };
    }

    /* ── signboards, rooftop signs, HQ sign ── */
    const sw = boardW = Math.max(4.2, Math.min(7.5, gu * 0.15));
    bld.forEach(b => {
      const m = board(b.c.sign, sw, b.c.closed); m.rotation.y = Math.PI / 4; const hgt = sw * 400 / 900; m.position.set(b.x + b.w * 0.5 + 0.9, 1.2 + hgt / 2, b.z + b.w * 0.5 + 1.9); world.add(m);
      b.board = m; billboards.push(m);
      const sb2 = track(new T.Mesh(meshes.box, std({ color: '#b98b5a' }))); sb2.scale.set(0.16, 1.4, 0.16); sb2.position.set(m.position.x, 0.7, m.position.z); sb2.castShadow = true; world.add(sb2);
    });
    if(fulls.length){ const ft = tex(fullSign(fulls[0].c.sign.full)); fulls.forEach(f => { const m = track(new T.Mesh(meshes.plane, track(new T.MeshBasicMaterial({ map: ft, toneMapped: false, transparent: true })))); m.scale.set(2.6, 1.05, 1); m.position.set(f.x, f.base + 1.0 + 0.55, f.z); world.add(m); billboards.push(m); }); }
    { const c2 = document.createElement('canvas'), x2 = c2.getContext('2d'); c2.width = 700; c2.height = 220; x2.fillStyle = '#5e6ad2'; x2.beginPath(); x2.roundRect ? x2.roundRect(6, 6, 688, 208, 60) : x2.rect(6, 6, 688, 208); x2.fill();
      x2.lineWidth = 8; x2.strokeStyle = '#a5adf5'; x2.stroke(); x2.fillStyle = '#fff'; x2.font = '800 130px "Geist","Noto Sans KR",-apple-system,sans-serif'; x2.textBaseline = 'middle'; x2.textAlign = 'center'; x2.fillText('Sprag', 350, 116);
      const grp = track(new T.Group()), hb = track(new T.Mesh(track(new T.PlaneGeometry(5.4, 5.4 * 220 / 700)), track(new T.MeshBasicMaterial({ map: tex(c2), toneMapped: false, transparent: true }))));
      const halo = track(new T.Mesh(meshes.plane, MT.signHalo)); halo.scale.set(9, 5, 1); halo.position.z = -0.05; hb.position.z = 0.02; grp.add(halo, hb); grp.position.set(0, 10.9, 0); meshes.hqSign = grp; world.add(grp); }
    { const tip = track(new T.Mesh(track(new T.SphereGeometry(0.2, 10, 8)), track(new T.MeshBasicMaterial({ color: '#8b7cf0', toneMapped: false })))); tip.position.y = 9.2; world.add(tip); meshes.tip = tip; }

    /* ── delivery bots: orbit their roof, fly to HQ now and then; more bots and flights for busier companies ── */
    const bl = []; bld.forEach(b => { for(let j = 0; j < b.c.bots; j++) bl.push({ b, j }); });
    const bm = mk(meshes.sph, track(new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })), bl.length, false), gl2 = mk(meshes.sph, track(new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.25, depthWrite: false })), bl.length, false);
    bl.forEach((q, i) => { const c = C(q.b.c.ent ? '#c4b5fd' : '#8fe0bb'); bm.setColorAt(i, c); gl2.setColorAt(i, c);
      bots.push({ i, b: q.b, j: q.j, a0: hash(q.b.c.id + q.j) * 6.28, st: 0, t: 0, next: 1 + hash(q.b.c.id + 'n' + q.j) * 8 / (0.6 + q.b.c.act), per: 5 + 7 * (1 - q.b.c.act), pos: v3(), p0: v3() }); });
    if(bl.length){ bm.instanceColor.needsUpdate = gl2.instanceColor.needsUpdate = true; }
    meshes.bm = bm; meshes.gl = gl2;
    ring = track(new T.Group()); { const rg = track(new T.RingGeometry(1, 1.25, 48)); rg.rotateX(-Math.PI / 2); const m1 = track(new T.Mesh(rg, track(new T.MeshBasicMaterial({ color: '#7c6cf0', transparent: true, opacity: 0.85, depthWrite: false })))); ring.add(m1); ring.visible = false; world.add(ring); }
    if(d.more){ moreLbl = document.createElement('div'); moreLbl.className = 'of-lbl'; moreLbl.textContent = d.moreLabel; elLabels.appendChild(moreLbl); }
    buildWeather();
    sel = selId ? bld.find(b => b.c.id === selId) || null : null; if(sel){ renderDrawer(); ring.visible = true; } else if(selId) chrome.close();
    applyEnv(); fit(); frames = 0; renderer.shadowMap.needsUpdate = true; chrome.syncFs(); step(0); request();
  }

  /* ── day / night and weather ── */
  const todHour = () => { if(DBG_TOD && DBG_TOD in TOD_DBG) return TOD_DBG[DBG_TOD]; const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  function todAt(h){
    let i = 0; while(i < TL.length - 2 && h >= TL[i + 1][0]) i++;
    const a = TL[i], b = TL[i + 1], k = smooth(clampN((h - a[0]) / (b[0] - a[0]), 0, 1)), A = ANC[a[1]], Bn = ANC[b[1]], col = f => C(A[f]).lerp(C(Bn[f]), k), num = f => A[f] + (Bn[f] - A[f]) * k;
    return { c0: col('c0'), c1: col('c1'), sc: col('sc'), hs: col('hs'), hg: col('hg'), si: num('si'), hi: num('hi'), fi: num('fi'), ex: num('ex'), n: num('n'), sp: A.sp.map((v, j) => v + (Bn.sp[j] - v) * k) };
  }
  function applyEnv(){
    if(!renderer || !sun) return;
    const P = todAt(todHour()), cl = wx.cloud, st = wx.kind, wet = st === 'rain' || st === 'storm', snow = st === 'snow';
    night = P.n; const dim = 1 - 0.5 * cl - (st === 'storm' ? 0.18 : 0), dayK = 1 - night;
    sun.color.copy(P.sc); sun.intensity = P.si * dim; sun.position.set(P.sp[0], P.sp[1], P.sp[2]).normalize().multiplyScalar(90); sun.shadow.radius = 3 + 3 * night;
    fill.intensity = P.fi * dim; hemi.color.copy(P.hs); hemi.groundColor.copy(P.hg); baseHemi = hemi.intensity = P.hi * (1 + 0.25 * cl) * (st === 'storm' ? 0.78 : 1); baseEx = renderer.toneMappingExposure = P.ex * (1 - 0.05 * cl);
    const dull = clampN(cl * 0.8 + (st === 'fog' ? 0.2 : 0), 0, 1), gr = c => { const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; return c.clone().lerp(new T.Color(l * 0.9, l * 0.93, l), dull * (0.35 + 0.65 * dayK)).multiplyScalar(1 - 0.1 * dull * dayK); };
    const s0 = gr(P.c0), s1 = gr(P.c1);
    stage.style.background = `radial-gradient(ellipse at 50% 35%, #${s0.getHexString()} 0, #${s1.getHexString()} 80%)`;
    stage.classList.toggle('tw-night', night > 0.55);
    if(stars) stars.style.opacity = String(clampN((night - 0.5) * 2.2, 0, 1) * (1 - cl * 0.75));
    scene.fog.color.copy(s0).lerp(s1, 0.5); scene.fog.density = st === 'fog' ? 0.013 : wet ? 0.0045 : 0.0012;
    Object.values(MT).forEach(m => { if(m.userData && m.userData.e != null) m.envMapIntensity = m.userData.e * (1 - 0.78 * night); });
    MT.road.roughness = wet ? 0.26 : 0.92; MT.road.envMapIntensity = MT.road.userData.e * (1 - 0.78 * night) * (wet ? 3.4 : 1); MT.road.color.setScalar(wet ? 0.82 : 1);
    MT.grassTop.color.copy(C('#c4e6a6')).lerp(C('#f2f7fb'), snow ? 0.82 : 0); MT.side.color.copy(C('#b6dc9b')).lerp(C('#e9f1f6'), snow ? 0.6 : 0);
    MT.cloud.color.copy(C('#ffffff')).lerp(C('#6d7aa8'), night * 0.85).lerp(C('#c9ced8'), wet ? 0.5 : 0);
    MT.bulb.color.copy(C('#d9d3c0')).lerp(C('#ffe8a6'), night); MT.pool.opacity = night * 0.55; if(meshes.pool) meshes.pool.visible = night > 0.03;
    MT.halo.opacity = 0.26 + 0.5 * night; MT.signHalo.opacity = 0.1 + 0.6 * night;
    renderer.shadowMap.needsUpdate = true; request();
  }
  function renderChip(){
    if(wx.temp == null){ elChip.hidden = true; return; }
    const ko = /[가-힣]/.test((cur && cur.hud && cur.hud.title) || ''), k = WXK[wx.kind];
    elChip.hidden = false; elChip.textContent = `${ko ? '서울' : 'Seoul'} · ${k[2]} ${Math.round(wx.temp)}°C`; elChip.title = k[ko ? 0 : 1];
  }
  let wxObjs = [];
  function buildWeather(){
    wxObjs.forEach(o => { if(o.parent) o.parent.remove(o); if(o.isInstancedMesh) o.dispose(); }); wxObjs = []; parts = null; clouds = [];
    const st = wx.kind, R = rng('clouds'), k = clampN(extent / 38, 1, 1.9);
    const nc = Math.round(wx.cloud * (st === 'clear' ? 5 : 9));
    if(nc){
      const mesh = mk(meshes.ico, MT.cloud, nc * 4, true, false); wxObjs.push(mesh);
      for(let i = 0; i < nc; i++){ const bl = []; for(let j = 0; j < 4; j++) bl.push([(j - 1.5) * 1.5 * k + (R() - 0.5), (j === 1 || j === 2 ? 0.55 : 0) * k, (R() - 0.5) * 1.3 * k, (j === 1 || j === 2 ? 2.0 : 1.5) * k * (0.85 + R() * 0.3)]); clouds.push({ x: (R() * 2 - 1) * extent * 1.15, z: (R() * 2 - 1) * extent * 1.15, y: 15 + R() * 6, sp: 0.5 + R() * 0.5, bl, i0: i * 4 }); }
      colorAll(mesh, Array.from({ length: nc * 4 }, () => C('#ffffff'))); meshes.cl = mesh;
    }
    if(!reduced && (st === 'rain' || st === 'storm' || st === 'snow')){
      const snow = st === 'snow', n = Math.min(1500, Math.floor((snow ? 900 : 700) + 800 * wx.rain)), half = Math.min(extent, 75), m = mk(snow ? meshes.flake : meshes.box, snow ? MT.snow : MT.rain, n, false, false); wxObjs.push(m);
      const p = { snow, n, half, k, m, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), v: new Float32Array(n), ph: new Float32Array(n) }, r2 = rng('parts');
      for(let i = 0; i < n; i++){ p.x[i] = (r2() * 2 - 1) * half; p.z[i] = (r2() * 2 - 1) * half; p.y[i] = r2() * 38; p.v[i] = snow ? 1.3 + r2() * 1.2 : 26 + r2() * 12; p.ph[i] = r2() * 6.28; }
      parts = p;
    }
  }
  function stepWx(dt){
    if(parts){
      const p = parts, tilt = clampN(wx.wind / 40, 0, 1) * 0.55, drift = Math.tan(tilt) * (p.snow ? 0.8 : 1);
      for(let i = 0; i < p.n; i++){
        p.y[i] -= p.v[i] * dt; p.x[i] += (p.snow ? Math.sin(time * 0.9 + p.ph[i]) * 0.5 * dt + drift * 1.6 * dt : drift * p.v[i] * dt);
        if(p.y[i] < 0.1){ p.y[i] = 38; p.x[i] = (Math.random() * 2 - 1) * p.half - drift * 6; p.z[i] = (Math.random() * 2 - 1) * p.half; }
        if(p.x[i] > p.half) p.x[i] -= 2 * p.half;
        M4.position.set(p.x[i], p.y[i], p.z[i]); M4.rotation.set(0, 0, p.snow ? 0 : tilt); if(p.snow) M4.scale.setScalar(0.17 * p.k); else M4.scale.set(0.035 * p.k, 1.3 * p.k, 0.035 * p.k); M4.updateMatrix(); p.m.setMatrixAt(i, M4.matrix);
      }
      p.m.instanceMatrix.needsUpdate = true;
    }
    if(wx.kind === 'storm' && !reduced){ lightT -= dt; if(lightT < 0){ flash = 1; lightT = 5 + Math.random() * 9; } }
    if(flash > 0){ flash = Math.max(0, flash - dt * 4.5); hemi.intensity = baseHemi + flash * 2.4 * (Math.random() < 0.7 ? 1 : 0.4); renderer.toneMappingExposure = baseEx * (1 + flash * 0.5); stage.style.filter = flash > 0.02 ? `brightness(${(1 + flash * 0.35).toFixed(2)})` : ''; }
  }
  function placeClouds(dt){
    if(!clouds.length) return;
    const sp = (0.5 + wx.wind * 0.06) * dt, lim = extent * 1.3;
    clouds.forEach(c => { c.x += sp * c.sp; if(c.x > lim) c.x = -lim; c.bl.forEach((b, j) => setM(meshes.cl, c.i0 + j, c.x + b[0], c.y + b[1], c.z + b[2], 0, j, b[3], b[3] * 0.62, b[3])); });
    meshes.cl.instanceMatrix.needsUpdate = true;
  }

  function renderDrawer(){
    if(!sel) return; const c = sel.c, ui = cur.ui || {}, d = sel.det, fm = d && d.fmt || (v => String(v)), id = 't-' + c.id;
    const sec = (title, html) => html ? `<div class="sec"><h4>${esc(title)}</h4>${html}</div>` : '';
    const util = kit.stack([{ v: c.used, color: '#7c6cf0', tip: c.detail.utilTip }, { v: Math.max(0, c.limit - c.used), color: '#e2d8c2', tip: c.detail.freeTip }]);
    let more = `<div class="ld">${esc(d === false ? ui.dFail : ui.dLoading)}</div>`;
    if(d){
      more = sec(ui.dSignals, kit.stack(d.sig) + `<div class="famt">${d.sig.filter(q => q.v).map(q => `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:${q.color}"></i>${esc(q.label)} ${q.v}</span>`).join('')}</div>`)
        + sec(ui.daily, d.days.length ? kit.chart(id + '-d', d.days, [{ name: ui.spent, color: '#8b7cf0', kind: 'bar', vals: d.spent, fmt: fm }, { name: ui.saved, color: '#2f9e6f', kind: 'line', vals: d.saved, fmt: fm }]) : '')
        + sec(ui.dTeams, kit.cmp([{ label: '', items: d.teams }])) + sec(ui.dTop, kit.cmp([{ label: '', items: d.top }]));
    }
    chrome.setHtml(`<div class="hd"><div><b title="${esc(c.name)}">${esc(c.name)}<span class="badge">${esc(c.plan)}</span></b><small>${esc(c.detail.status || '')}</small></div><button type="button" class="x" data-a="close" aria-label="${esc(ui.close)}">×</button></div>`
      + `<div class="bd"><div class="sec"><div class="grid">${c.detail.rows.map(r => `<div class="kv"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div></div>`
      + sec(ui.dUtil, util) + more + `</div><div class="ft"><button type="button" class="of-dbtn pri" data-a="org">${esc(ui.org)}</button></div>`);
  }

  const ease = u => u * u * (3 - 2 * u);
  function arc(a, b, u, out){ out.lerpVectors(a, b, ease(u)); out.y += Math.sin(Math.PI * u) * 3.2; return out; }
  function step(dt){
    time += dt;
    view.update(dt, time);
    const az = view.azimuth(); bld.forEach(b => { b.board.rotation.y = az; }); billboards.forEach(m => { m.rotation.y = az; }); if(meshes.hqSign) meshes.hqSign.rotation.y = az;   /* signs always face the camera */
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
    if(peds.length){ peds.forEach((p, i) => { const e = p.e, lo = e.s0 + 2, hi = Math.max(lo + 1, e.end), s = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(time * p.sp + p.ph)), bob = Math.abs(Math.sin(time * 5 + p.ph)) * 0.025 * (reduced ? 0 : 1);
        const x = e.ax + e.ux * s + e.px * p.side * 1.5, z = e.az + e.uz * s + e.pz * p.side * 1.5; setM(meshes.pb, i, x, 0.3 + bob, z, 0, 0, 0.11, 0.44, 0.11); setM(meshes.ph, i, x, 0.64 + bob, z, 0, 0, 0.11, 0.11, 0.11); });
      meshes.pb.instanceMatrix.needsUpdate = meshes.ph.instanceMatrix.needsUpdate = true; }
    if(!reduced || time === 0){ placeClouds(reduced ? 0 : dt); }
    if(!reduced) stepWx(dt);
    if(sel && ring){ const s = sel.w * 0.62 + 0.9 + (reduced ? 0 : 0.05 * Math.sin(time * 3)); ring.position.set(sel.x, 0.2, sel.z); ring.scale.set(s, 1, s); }
    world.updateMatrixWorld(true);
  }
  function proj(v, out){ out.copy(v).applyMatrix4(world.matrixWorld).project(camera); return [(out.x * 0.5 + 0.5) * W, (-out.y * 0.5 + 0.5) * H]; }
  function render(){
    renderer.render(scene, camera);
    if(moreLbl){ const [x, y] = proj(V1.set(bb.x1 - 2, 0.3, bb.z1 - 1), TMP); const off = x < -30 || x > W + 30 || y < -30 || y > H + 30; moreLbl.style.display = off ? 'none' : ''; moreLbl.style.transform = `translate(${Math.round(Math.min(W - moreLbl.offsetWidth - 4, Math.max(4, x)))}px,${Math.round(Math.min(H - 40, y))}px)`; }
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
    const dc = view.defaultCam(), inv = dc.matrixWorldInverse, v = v3();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for(const yw of [-0.1, 0, 0.1]) for(const q of bb.pts){
      v.set(q[0] * Math.cos(yw) + q[2] * Math.sin(yw), q[1], -q[0] * Math.sin(yw) + q[2] * Math.cos(yw)).applyMatrix4(inv); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const padT = Math.round(elHud.offsetHeight * 0.4) + 6, padB = elLegend.offsetHeight + 4, padX = mobile() ? 4 : 16;
    const s = Math.min((W - 2 * padX) / (x1 - x0), (H - padT - padB) / (y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, py = padT + (H - padT - padB) / 2;
    scale = s; Object.assign(camera, { left: cx - W / 2 / s, right: cx + W / 2 / s, top: cy + py / s, bottom: cy - (H - py) / s }); view.apply();
  }
  function resize(){
    const w = stage.clientWidth, h = (canvas && canvas.clientHeight) || stage.clientHeight;   /* the canvas keeps its height when a phone drawer grows the stage */ if(!w || !h || !renderer) return;
    const was = mobile(); W = w; H = h; renderer.setSize(w, h, false); if(was !== mobile() && cur) return build(cur); fit(); request();
  }
  /* pointer: drag rotates; a click on a building or its sign opens the drawer, a click on empty ground closes it */
  function nearest(px, py){
    let best = null, bd = 1e9;
    bld.forEach(b => { for(const [pt, r] of [[V1.set(b.x, b.H * 0.5, b.z), b.w * scale * view.zoom() * 0.75 + 6], [V1.set(b.board.position.x, b.board.position.y, b.board.position.z), boardW * scale * view.zoom() * 0.45]]){
      const [x, y] = proj(pt, TMP), d = Math.hypot(x - px, y - py); if(d < r && d < bd){ bd = d; best = b; } } });
    return best;
  }
  function select(b){
    sel = b; selId = b.c.id; renderDrawer(); chrome.open(); ring.visible = true;
    if(!opts.loadDetail) return;
    let pr = cache.get(b.c.id); if(!pr){ pr = Promise.resolve(opts.loadDetail(b.c.id)).catch(() => null); cache.set(b.c.id, pr); }
    pr.then(d => { b.det = d || false; if(sel === b) renderDrawer(); });
  }
  function bindView(){
    view = makeView({ T, canvas, stage, camera, target0: [0, 2, 0], theta0: Math.PI / 4, phi0: Math.atan2(Math.hypot(30, 30), 24), dist: Math.hypot(30, 24, 30), reduced,
      bounds: () => ({ x0: -bb.x1, x1: bb.x1, z0: -bb.z1, z1: bb.z1 }), size: () => [W, H], ppu: () => scale, isFs: () => chrome.fsOn(), request,
      onFocus: () => chrome.hideHint(), onEnter: () => chrome.showHint(),
      onMove: (px, py) => { const h = nearest(px, py); if(hover !== h){ hover = h; canvas.classList.toggle('hit', !!h); } },
      onLeave: () => { hover = null; canvas.classList.remove('hit'); },
      onTap: (px, py) => { const b = nearest(px, py); if(!b || sel === b){ chrome.close(); return; } select(b); } });
  }
  let minuteTimer = 0, shared = [];
  async function init(){
    if(started || destroyed) return; started = 'loading';
    try{ T = await import(THREE_LIB); }catch(e){ started = false; if(opts.onFail) opts.onFail('load'); return; }
    if(destroyed) return;
    try{ renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); }catch(e){ started = false; if(opts.onFail) opts.onFail('webgl'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1; renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    canvas = renderer.domElement; canvas.setAttribute('role', 'img'); stage.insertBefore(canvas, stage.firstChild);
    stars = document.createElement('div'); stars.className = 'tw-stars'; stage.insertBefore(stars, canvas); makeTextures(); stars.style.backgroundImage = `radial-gradient(circle at 70% 15%, #fff8e0 0 13px, rgba(255,248,224,.3) 14px 26px, rgba(255,248,224,0) 40px), url(${meshes.starUrl})`;
    scene = new T.Scene(); scene.fog = new T.FogExp2(0xffffff, 0.001); world = new T.Group(); scene.add(world); M4 = new T.Object3D(); V1 = v3(); V2 = v3(); TMP = v3();
    eu = new T.Euler(); qq = new T.Quaternion(); mm = new T.Matrix4(); nm = new T.Matrix3(); va = new T.Vector3(); vb = new T.Vector3(); ONE = new T.Vector3(1, 1, 1);
    camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
    hemi = new T.HemisphereLight('#eaf3ff', '#f0e2c8', 1.0); sun = new T.DirectionalLight('#fff0d4', 2.0); sun.position.set(-12, 34, 16); sun.castShadow = true; const ms = mobile() ? 2048 : 4096; sun.shadow.mapSize.set(ms, ms); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
    fill = new T.DirectionalLight('#bcd4ff', 0.4); fill.position.set(40, 14, 12);
    scene.add(hemi, sun, sun.target, fill);
    envTex = makeEnv(); makeMaterials(); MT.signHalo = new T.MeshBasicMaterial({ map: TX.glow, color: 0x8b7cf0, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false });
    const fg = [], bxg = (a, b, c, x, y, z) => new T.BoxGeometry(a, b, c).translate(x, y, z), t = 0.13;
    fg.push(bxg(1, t, 1, 0, 0.5 - t / 2, 0), bxg(1, t, 1, 0, -0.5 + t / 2, 0), bxg(t, 1 - 2 * t, 1, 0.5 - t / 2, 0, 0), bxg(t, 1 - 2 * t, 1, -0.5 + t / 2, 0, 0));
    const merge = gs => { const P = [], N = [], U = [], I = []; let o = 0; gs.forEach(g => { const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv; for(let i = 0; i < p.count; i++){ P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); U.push(u.getX(i), u.getY(i)); } for(let i = 0; i < g.index.count; i++) I.push(g.index.getX(i) + o); o += p.count; g.dispose(); });
      const r = new T.BufferGeometry(); r.setAttribute('position', new T.Float32BufferAttribute(P, 3)); r.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); r.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); r.setIndex(I); return r; };
    meshes = { box: new T.BoxGeometry(1, 1, 1), sph: new T.SphereGeometry(1, 14, 10), plane: new T.PlaneGeometry(1, 1), cyl: new T.CylinderGeometry(1, 1, 1, 8), cone: new T.ConeGeometry(1, 1, 8), ico: new T.IcosahedronGeometry(1, 1), flake: new T.IcosahedronGeometry(1, 0),
      frame: merge(fg), cross: merge([bxg(0.07, 1, 1, 0, 0, 0), bxg(1, 0.07, 1, 0, 0, 0)]) };
    started = true; bindView(); ro = new ResizeObserver(resize); ro.observe(stage);
    W = stage.clientWidth; H = stage.clientHeight; renderer.setSize(W, H, false); build(cur); request();
    if(opts.probe) opts.probe({ T, renderer, camera, scene, view, bld: () => bld, info: () => renderer.info });
    minuteTimer = setInterval(() => { if(started === true && !destroyed) applyEnv(); }, 60000);
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if(started === true && !destroyed) build(cur); });
  }
  io = new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); if(visible && !started) init(); else if(visible) request(); }, { threshold: 0.05 });
  io.observe(container);
  const onVis = () => { if(!document.hidden) request(); }; document.addEventListener('visibilitychange', onVis);
  elHud.innerHTML = `<b>${esc(data.hud.title)}</b>`; chrome.syncFs();
  /* real weather once on mount (Seoul, no key); any failure leaves the clear default */
  if(!wxDbg) wxLoad().then(d => {
    if(destroyed || !d) return; wx = wxClass(d);
    if(started === true){ if((wx.kind === 'snow') !== builtSnow) build(cur); else { buildWeather(); applyEnv(); renderChip(); request(); } }
  });
  return {
    update(d){ cur = d; if(started === true) build(d); },
    destroy(){
      destroyed = true; if(raf) cancelAnimationFrame(raf); if(rr) cancelAnimationFrame(rr); if(io) io.disconnect(); if(ro) ro.disconnect(); clearInterval(minuteTimer);
      document.removeEventListener('visibilitychange', onVis); chrome.destroy();
      if(started === true){ clear(); wxObjs.forEach(o => { if(o.isInstancedMesh) o.dispose(); }); Object.values(meshes).forEach(o => o && o.dispose && o.dispose()); Object.values(MT).forEach(m => m && m.dispose && m.dispose()); Object.values(TX).forEach(x => x && x.dispose && x.dispose()); if(envTex) envTex.dispose();
        renderer.dispose(); const x = renderer.getContext().getExtension('WEBGL_lose_context'); if(x) x.loseContext(); if(canvas.parentNode) canvas.parentNode.removeChild(canvas); }
      container.innerHTML = '';
    }
  };
}
