/* Virtual office: an animated three.js hero for the organization detail screens (site/team and site/ops).
 *
 *   const ctl = mountOfficeScene(container, data, opts);   // ctl = { update(data), destroy() }
 *   const data = officeSceneData({ rows, usage, promptRows, teams, used, limit, orgName, rangeLabel, t, money, rel, ... });
 *
 * One zone per team, one desk per person, AI helper bots, a server kiosk. Chunky pastel animal characters by tier (lion, fox, bear, chick, ghost), bright cozy daylight, orthographic isometric camera.
 * data (all user-facing strings arrive ready-made, the host owns i18n):
 *   { teams:[{id,name}], people:[{id,name,teamId,teamName,tier:'power'|'active'|'normal'|'low'|'nodata',tag,tierText,tip:[[k,v]],bots:['haiku'|'sonnet'|'opus'|'any'],bubbles:[{text,ai}],promptId,spent}],
 *     free, freeLabel, more, moreLabel, server:{label}, activity:0..1, closed, hud:{title,stats,closed}, legend:[{k:tier|'ghost',label}|{c,label}|{label}], aria }
 * people[].detail feeds the side drawer (click a person); data.ui holds its strings. opts: { onSeats(id), onPrompts(id), onTeam(id), onServer(), onFail(reason) }
 * The scene keeps its own bright palette in both page themes. three.js is imported lazily the first time the container scrolls into view. */
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const MAXP = 60, FAMC = { haiku: '#7fe0b8', sonnet: '#8ec5fb', opus: '#f9a8d4' };
const TV = { power: { body: '#a78bfa', scr: '#d8ccff', bri: 1, sp: 15 }, active: { body: '#7cc4f2', scr: '#a8dcff', bri: 1, sp: 9 },
  normal: { body: '#d9cdb8', scr: '#8ea2b8', bri: 0.8, sp: 4.5 }, low: { body: '#f3b9a0', scr: '#4a4658', bri: 1, sp: 0 }, nodata: { body: '#ffffff', scr: '#6b6877', bri: 1, sp: 0 } };

/* Animal set: one table, swap it to change the cast. Parts are spheres ('sph') and cones ('cone'); head parts are relative to the head
 * (it looks toward -z), parts with b:true are relative to the desk. p = position, s = scale (radius), r = rotation about x. */
const P = (g, c, p, s, r = 0, b = false) => ({ g, c, p, s, r, b });
const eyes = (z, r = 0.045, c = '#2d2323') => [-0.12, 0.12].map(x => P('sph', c, [x, 0.06, z], [r, r, r]));
const ears = (c, y, rad, z = -0.02) => [-1, 1].map(k => P('sph', c, [0.25 * k, y, z], [rad, rad, rad * 0.8]));
const SVG = body => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`, dot = (x, y, c = '#2d2323') => `<circle cx="${x}" cy="${y}" r=".85" fill="${c}"/>`;
const ANIMALS = {
  power: { name: 'lion', icon: SVG('<circle cx="8" cy="8" r="7.2" fill="#e0a23c"/><circle cx="8" cy="8" r="4.8" fill="#f6cf7a"/>' + dot(6.3, 7.6) + dot(9.7, 7.6) + '<ellipse cx="8" cy="10" rx="1.8" ry="1.2" fill="#fff0cf"/>'),
    parts: () => [P('sph', '#e5a63f', [0, 0, 0.14], [0.54, 0.54, 0.24]), ...Array.from({ length: 9 }, (_, k) => P('sph', '#e0a23c', [Math.cos(k / 9 * 6.283) * 0.45, Math.sin(k / 9 * 6.283) * 0.45, 0.02], [0.14, 0.14, 0.14])),
      P('sph', '#f6cf7a', [0, 0, 0], [0.34, 0.34, 0.34]), ...ears('#f6cf7a', 0.3, 0.1), P('sph', '#fff0cf', [0, -0.1, -0.29], [0.15, 0.11, 0.1]), P('sph', '#c0626b', [0, -0.03, -0.39], [0.045, 0.035, 0.035]), ...eyes(-0.31)] },
  active: { name: 'fox', icon: SVG('<polygon points="2,1 6.5,5 2.5,8" fill="#f4a261"/><polygon points="14,1 9.5,5 13.5,8" fill="#f4a261"/><circle cx="8" cy="9" r="5.6" fill="#f4a261"/><ellipse cx="8" cy="11.3" rx="3" ry="2.2" fill="#fff3e0"/>' + dot(6, 8.3) + dot(10, 8.3)),
    parts: () => [P('sph', '#f4a261', [0, 0, 0], [0.34, 0.34, 0.34]), ...[-1, 1].flatMap(k => [P('cone', '#f4a261', [0.2 * k, 0.4, 0], [0.13, 0.17, 0.1]), P('cone', '#fff0e0', [0.2 * k, 0.37, -0.05], [0.07, 0.1, 0.06]), P('sph', '#fff3e0', [0.2 * k, -0.1, -0.2], [0.13, 0.11, 0.12])]),
      P('sph', '#fff3e0', [0, -0.1, -0.3], [0.14, 0.1, 0.1]), P('sph', '#3b2f2f', [0, -0.04, -0.39], [0.045, 0.035, 0.035]), ...eyes(-0.31),
      P('sph', '#f4a261', [0.55, 0.8, 0.7], [0.14, 0.14, 0.3], 0, true), P('sph', '#fff3e0', [0.55, 0.8, 1.0], [0.11, 0.11, 0.11], 0, true)] },
  normal: { name: 'bear', icon: SVG('<circle cx="3.5" cy="3.5" r="2.4" fill="#c8a98a"/><circle cx="12.5" cy="3.5" r="2.4" fill="#c8a98a"/><circle cx="8" cy="9" r="6" fill="#c8a98a"/><ellipse cx="8" cy="11" rx="2.6" ry="2" fill="#e6d3bd"/>' + dot(6, 8) + dot(10, 8)),
    parts: () => [P('sph', '#c8a98a', [0, 0, 0], [0.35, 0.35, 0.35]), ...ears('#c8a98a', 0.28, 0.13), ...[-1, 1].map(k => P('sph', '#e6d3bd', [0.25 * k, 0.28, -0.08], [0.07, 0.07, 0.05])),
      P('sph', '#e6d3bd', [0, -0.1, -0.3], [0.15, 0.11, 0.1]), P('sph', '#3b2f2f', [0, -0.04, -0.39], [0.05, 0.04, 0.04]), ...eyes(-0.32)] },
  low: { name: 'chick', icon: SVG('<circle cx="8" cy="9" r="6" fill="#ffe27a"/><polygon points="6.6,10 9.4,10 8,12.2" fill="#f59e3a"/>' + dot(6, 8) + dot(10, 8)),
    parts: () => [P('sph', '#ffe27a', [0, 0, 0], [0.3, 0.3, 0.3]), P('sph', '#ffe27a', [0, 0.32, 0], [0.07, 0.07, 0.07]), P('sph', '#ffe27a', [-0.08, 0.3, 0.02], [0.06, 0.06, 0.06]), P('sph', '#ffe27a', [0.08, 0.3, 0.02], [0.06, 0.06, 0.06]),
      P('cone', '#f59e3a', [0, -0.04, -0.34], [0.07, 0.09, 0.07], -Math.PI / 2), ...[-1, 1].map(k => P('sph', '#ffb3c7', [0.17 * k, -0.06, -0.24], [0.06, 0.06, 0.05])), ...eyes(-0.27, 0.04)] },
};
const GHOST = { name: 'ghost', icon: SVG('<path d="M3 14V8a5 5 0 0110 0v6l-1.7-1.4L9.7 14 8 12.6 6.3 14l-1.6-1.4z" fill="#fff" stroke="#b8b2a6"/>' + dot(6.3, 8, '#8a8f9c') + dot(9.7, 8, '#8a8f9c')),
  parts: () => [P('sph', '#ffffff', [0, 0, 0], [0.36, 0.36, 0.36]), ...eyes(-0.33, 0.045, '#8a8f9c')] };
const HEAD_YAW = -1.75;   /* heads glance toward the room so the faces show to the isometric camera */
const iconSvg = k => (k === 'ghost' ? GHOST : ANIMALS[k] || { icon: '' }).icon;

export const OF_CSS = `
.of-card{padding:0!important;overflow:hidden;margin-bottom:var(--s4,16px)}
.of-stage{position:relative;height:460px;overflow:hidden;contain:layout paint;background:radial-gradient(ellipse at 50% 35%,#fffaf0 0,#f6ead2 80%);color:#6a5a4a}
.of-stage canvas{display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab}
.of-stage canvas.drag{cursor:grabbing}.of-stage canvas.hit{cursor:pointer}
.of-hud{position:absolute;left:16px;top:12px;right:16px;pointer-events:none;font-size:12px;line-height:1.45;z-index:2;color:#6a5a4a}
.of-hud b{display:block;font-size:15px;font-weight:600;color:#3a2f27;letter-spacing:-.01em}
.of-hud em{font-style:normal;margin-left:8px;font-size:11px;font-weight:600;color:#b4443f;border:1px solid currentColor;border-radius:999px;padding:1px 8px;vertical-align:2px;background:#fff}
.of-legend{position:absolute;left:12px;right:auto;max-width:calc(100% - 24px);bottom:8px;display:flex;background:rgba(255,248,235,.85);border-radius:12px;padding:4px 10px;flex-wrap:wrap;gap:2px 16px;font-size:11.5px;line-height:1.5;color:#6a5a4a;pointer-events:none;z-index:2}
.of-legend:empty{display:none}
.of-legend span{white-space:nowrap}
.of-legend svg{width:16px;height:16px;vertical-align:-4px;margin-right:5px}
.of-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:-1px;box-shadow:0 0 0 2px rgba(255,255,255,.7)}
.of-lbl,.of-btn,.of-bub,.of-tag{position:absolute;left:0;top:0;white-space:nowrap;will-change:transform;z-index:1}
.of-lbl,.of-btn,.of-tag{font:inherit;font-size:12px;font-weight:600;line-height:1;color:#3a2f27;padding:5px 10px;border-radius:999px;border:1px solid rgba(120,90,60,.16);background:rgba(255,255,255,.94);box-shadow:0 2px 6px rgba(90,60,30,.16)}
.of-lbl{pointer-events:none;background:none;border:0;box-shadow:none;padding:2px 4px;color:#6a5a4a;text-shadow:0 0 4px #fff7e6,0 0 2px #fff7e6}
.of-btn:hover,.of-btn:focus-visible{border-color:#8b7cf0;box-shadow:0 2px 8px rgba(120,100,240,.3)}
.of-btn{max-width:240px;overflow:hidden;text-overflow:ellipsis;z-index:2}.of-btn.srv{max-width:none;background:#5a5270;color:#fff;border-radius:9px;border-color:rgba(255,255,255,.35)}
.of-gi{position:absolute;left:0;top:0;z-index:1;pointer-events:none;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.95);box-shadow:0 1px 5px rgba(60,90,140,.35);display:grid;place-items:center;will-change:transform}.of-gi svg{width:15px;height:15px}
.of-sign{color:#b4443f;font-size:14px}
.of-bub{pointer-events:none;font-size:11px;line-height:1;color:#3a2f27;background:#fff;padding:5px 10px;border-radius:999px;box-shadow:0 2px 8px rgba(90,60,30,.22);opacity:0;transition:opacity .35s ease}
.of-bub.ai{background:#f1ebff;color:#4c1d95}.of-bub.on{opacity:1}
.of-tip{position:absolute;left:0;top:0;z-index:4;pointer-events:none;min-width:170px;max-width:260px;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.55;background:#fff;border:1px solid rgba(120,90,60,.16);color:#3a2f27;box-shadow:0 8px 24px rgba(90,60,30,.22)}
.of-tip b{display:block;font-weight:600;overflow-wrap:anywhere}
.of-tip div{display:flex;justify-content:space-between;gap:12px;color:#6a5a4a}
.of-tip div span:last-child{color:#3a2f27;text-align:right}
.of-tip .tier{margin-top:2px;font-weight:600}
.of-tip .t-power{color:#6d28d9}.of-tip .t-active{color:#1d6fb8}.of-tip .t-normal{color:#6b6256}.of-tip .t-low{color:#b45309}.of-tip .t-nodata{color:#6b7280}
.of-fs{position:absolute;top:10px;right:10px;z-index:6;width:32px;height:32px;border-radius:50%;border:1px solid rgba(120,90,60,.18);background:rgba(255,255,255,.94);color:#3a2f27;box-shadow:0 2px 6px rgba(90,60,30,.16);display:grid;place-items:center;padding:0;transition:right .28s cubic-bezier(.23,1,.32,1)}
.of-fs:hover,.of-fs:focus-visible{border-color:#8b7cf0}.of-fs svg{width:16px;height:16px}
.of-card:fullscreen,.of-card:-webkit-full-screen{width:100%;height:100%;margin:0;border-radius:0;background:#f6ead2}
.of-card:fullscreen .of-stage,.of-card:-webkit-full-screen .of-stage,.of-card.of-fsx .of-stage{height:100vh;height:100dvh}
.of-card.of-fsx{position:fixed;inset:0;z-index:1000;margin:0;border-radius:0;border:0;background:#f6ead2}
.of-drawer{position:absolute;top:0;right:0;bottom:0;width:340px;max-width:100%;z-index:5;display:flex;flex-direction:column;background:#fffdf8;border-left:1px solid rgba(120,90,60,.16);box-shadow:-8px 0 24px rgba(90,60,30,.16);color:#3a2f27;font-size:12.5px;line-height:1.5;transform:translateX(100%);visibility:hidden;transition:transform .28s cubic-bezier(.23,1,.32,1),visibility 0s .28s}
.of-drawer.open{transform:none;visibility:visible;transition:transform .28s cubic-bezier(.23,1,.32,1)}
.of-drawer .hd{display:flex;align-items:center;gap:10px;padding:14px 14px 10px;border-bottom:1px solid rgba(120,90,60,.12)}
.of-drawer .hd svg{width:30px;height:30px;flex:none}.of-drawer .hd div{min-width:0;flex:1}
.of-drawer .hd b{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.of-drawer .hd small{display:block;color:#6a5a4a;font-size:11.5px}
.of-drawer .x{border:0;background:none;font-size:20px;line-height:1;color:#6a5a4a;padding:4px 8px;border-radius:8px}.of-drawer .x:hover{background:rgba(120,90,60,.1)}
.of-drawer .bd{flex:1;overflow-y:auto;padding:10px 14px}
.of-drawer dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:0 0 10px}.of-drawer dt{color:#6a5a4a}.of-drawer dd{margin:0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.of-drawer h4{margin:10px 0 4px;font-size:11px;font-weight:600;color:#6a5a4a}
.of-drawer .fam{display:flex;height:10px;border-radius:5px;overflow:hidden;background:#eee6d6}.of-drawer .fam i{display:block;height:100%}
.of-drawer .famt{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#6a5a4a;margin-top:4px}
.of-drawer svg.sp{width:100%;height:40px;display:block}
.of-drawer .ft{display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px 14px;border-top:1px solid rgba(120,90,60,.12)}
.of-dbtn{flex:1;min-width:120px;font:inherit;font-size:12.5px;font-weight:600;padding:8px 12px;border-radius:999px;border:1px solid #cfc3f7;background:#f1ebff;color:#4c1d95}
.of-dbtn.pri{background:#6d5ce7;border-color:#6d5ce7;color:#fff}.of-dbtn:hover{filter:brightness(.96)}
.of-stage.has-drawer .of-fs{right:350px}
@media (max-width:480px){.of-drawer{top:auto;left:0;right:0;width:auto;height:72%;border-left:0;border-top:1px solid rgba(120,90,60,.16);border-radius:16px 16px 0 0;box-shadow:0 -8px 24px rgba(90,60,30,.18);transform:translateY(100%)}.of-stage.has-drawer .of-fs{right:10px}}
@media (prefers-reduced-motion:reduce){.of-drawer,.of-drawer.open,.of-fs{transition:none}}
@media (max-width:640px){.of-stage{height:300px}.of-hud{left:12px;right:12px;top:8px;font-size:11px}.of-hud b{font-size:13px}.of-legend{left:8px;bottom:6px;font-size:10px;gap:0 10px;padding:3px 8px;max-width:calc(100% - 16px)}.of-btn,.of-lbl{font-size:11px;padding:4px 8px}}
`;

export function webglOk(){
  try{
    const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl');
    if(!g) return false;
    const x = g.getExtension('WEBGL_lose_context'); if(x) x.loseContext();
    return true;
  }catch(e){ return false; }
}
export const THREE_LIB = THREE_URL;
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const hash = s => { let h = 2166136261; for(const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };

/* Shared stage chrome for the office and town scenes: the fullscreen button (Fullscreen API on the card, fixed overlay where it is missing)
 * and the slide-in drawer (bottom sheet on phones). o: { ui: () => ({fs, fsExit, close}), request(), onClose(), onAction(name) }. */
export function makeChrome(stage, container, o){
  const drawer = document.createElement('aside'); drawer.className = 'of-drawer'; drawer.setAttribute('aria-hidden', 'true'); stage.appendChild(drawer);
  const fs = document.createElement('button'); fs.type = 'button'; fs.className = 'of-fs'; stage.appendChild(fs);
  const card = container.closest('.of-card') || container;
  let fsX = false;
  const nativeFs = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fsOn = () => fsX || nativeFs() === card;
  const IN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>';
  const OUT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"/></svg>';
  function syncFs(){
    const on = fsOn(), ui = o.ui() || {}, lbl = on ? ui.fsExit : ui.fs;
    fs.innerHTML = on ? OUT : IN; fs.setAttribute('aria-label', lbl || ''); fs.title = lbl || ''; fs.setAttribute('aria-pressed', String(on)); o.request();
  }
  function overlay(on){ fsX = on; card.classList.toggle('of-fsx', on); document.documentElement.style.overflow = on ? 'hidden' : ''; syncFs(); }
  function exitFs(){ if(nativeFs() === card) (document.exitFullscreen || document.webkitExitFullscreen).call(document); if(fsX) overlay(false); }
  function toggleFs(){
    if(fsOn()) exitFs();
    else if(card.requestFullscreen) card.requestFullscreen().catch(() => overlay(true));
    else if(card.webkitRequestFullscreen) card.webkitRequestFullscreen();
    else overlay(true);
  }
  fs.addEventListener('click', toggleFs);
  const onFs = () => syncFs();
  document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
  const isOpen = () => drawer.classList.contains('open');
  function close(){ if(!isOpen()) return; drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); stage.classList.remove('has-drawer'); o.onClose(); o.request(); }
  drawer.addEventListener('click', ev => { const b = ev.target.closest('[data-a]'); if(!b) return; if(b.dataset.a === 'close') close(); else { if(fsOn()) exitFs(); o.onAction(b.dataset.a); } });
  const onKey = ev => { if(ev.key !== 'Escape') return; if(isOpen()){ close(); ev.stopPropagation(); } else if(fsX) overlay(false); };
  document.addEventListener('keydown', onKey);
  return { fsOn, syncFs, isOpen, close, setHtml(h){ drawer.innerHTML = h; }, open(){ drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); stage.classList.add('has-drawer'); o.request(); },
    destroy(){ document.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); exitFs(); } };
}

export function mountOfficeScene(container, data, opts = {}){
  const noop = { update(){}, destroy(){} };
  if(!container) return noop;
  if(!webglOk()){ if(opts.onFail) opts.onFail('webgl'); return noop; }
  if(!document.getElementById('of-style')){ const s = document.createElement('style'); s.id = 'of-style'; s.textContent = OF_CSS; document.head.appendChild(s); }

  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  container.innerHTML = '<div class="of-stage"><div class="of-hud"></div><div class="of-legend"></div></div>';
  const stage = container.querySelector('.of-stage'), elHud = stage.querySelector('.of-hud'), elLegend = stage.querySelector('.of-legend');
  const elLabels = document.createElement('div'); stage.appendChild(elLabels);
  const elTip = document.createElement('div'); elTip.className = 'of-tip'; elTip.hidden = true; stage.appendChild(elTip);
  let sel = null, selId = null, ring = null;
  const chrome = makeChrome(stage, container, { ui: () => cur.ui, request: () => request(), onClose: () => { sel = null; selId = null; if(ring) ring.visible = false; },
    onAction: a => { if(!sel) return; const id = sel.p.id; if(a === 'seats' && opts.onSeats) opts.onSeats(id); else if(a === 'prompts' && opts.onPrompts) opts.onPrompts(id); } });
  const syncFs = () => chrome.syncFs();

  let T = null, renderer = null, scene = null, camera = null, world = null, canvas = null, ro = null, io = null, sun = null, hemi = null;
  let cur = data, destroyed = false, visible = false, raf = 0, rr = 0, last = 0, time = 0, W = 0, H = 0, started = false, frames = 0;
  let statics = [], dyn = [], drag = null, yawD = 0, lastTouch = -9, hover = null, scale = 10;
  let people = [], bots = [], trails = [], zones = [], sets = null, scr = null, srvLights = [], srv = null, lab = { zones: [], tags: [], server: null, more: null, sign: null }, bubs = [], nextBub = 1.2, sFlash = 0, FW = 10, FD = 10, sparks = [], hudBox = null, BB = { x0: -5, x1: 5, z0: -5, z1: 5 };
  let M4 = null, S = null, TMP = null, PT = null, HP = null, Mh = null, Mp = null, Q1 = null, E1 = null, V1 = null, V2 = null, ONE = null;
  const v3 = () => new T.Vector3();
  const track = o => { dyn.push(o); return o; };
  const mobile = () => W < 520;
  const C = h => new T.Color(h);

  /* ── layout: one zone per team, desks in a grid inside, zones shelf-packed, server first (back corner) ── */
  const GX = 2.9, GZ = 3.1, GAP = 2.8, K = 1.4, MAXFREE = 6, LANE = 2.0;   /* LANE: floor strip at the front of a rug that carries the name decal */
  function zoneOf(kind, id, name, n, size){
    const cols = kind === 'free' ? Math.max(1, Math.min(3, n)) : Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n * 1.3)))), rows = Math.max(1, Math.ceil(n / cols));
    return { kind, id, name, n, cols, rows, w: size ? size[0] : cols * GX + 0.9, d: size ? size[1] : rows * GZ + 0.9 + LANE, seats: [] };
  }
  function layout(d){
    const zs = [zoneOf('server', '', '', 0, [4.8, 4.4])], pl = d.people || [];
    (d.teams || []).forEach(tm => { const ps = pl.filter(p => p.teamId === tm.id); if(ps.length) zs.push(Object.assign(zoneOf('team', tm.id, tm.name, ps.length), { ps })); });
    const known = new Set((d.teams || []).map(x => x.id)), lone = pl.filter(p => !known.has(p.teamId));
    if(lone.length) zs.push(Object.assign(zoneOf('team', '', lone[0].teamName || '', lone.length), { ps: lone }));
    const nFree = Math.min(d.free || 0, MAXFREE);
    if(nFree) zs.push(Object.assign(zoneOf('free', '', d.freeLabel || '', nFree), { ps: [] }));
    const area = zs.reduce((a, z) => a + (z.w + GAP) * (z.d + GAP), 0), maxW = Math.max(...zs.map(z => z.w), Math.sqrt(area * 1.45));
    let x = 0, z = 0, rh = 0, tw = 0;
    zs.forEach(zn => { if(x > 0 && x + zn.w > maxW){ x = 0; z += rh + GAP; rh = 0; } zn.x0 = x; zn.z0 = z; x += zn.w + GAP; rh = Math.max(rh, zn.d); tw = Math.max(tw, x - GAP); });
    const th = z + rh;
    zs.forEach(zn => {
      zn.cx = zn.x0 + zn.w / 2 - tw / 2; zn.cz = zn.z0 + zn.d / 2 - th / 2;
      const n = zn.kind === 'free' ? Math.min(d.free || 0, MAXFREE) : zn.n;
      for(let k = 0; k < n; k++){
        const c = k % zn.cols, r = Math.floor(k / zn.cols);
        zn.seats.push({ x: zn.cx - zn.w / 2 + 0.45 + GX * (c + 0.5), z: zn.cz - zn.d / 2 + 0.45 + GZ * (r + 0.5) + 0.3, p: zn.kind === 'team' ? zn.ps[k] : null });
      }
    });
    FW = tw + 2.4; FD = th + 2.4;
    BB = { x0: Math.min(...zs.map(z => z.cx - z.w / 2)), x1: Math.max(...zs.map(z => z.cx + z.w / 2)), z0: Math.min(...zs.map(z => z.cz - z.d / 2)), z1: Math.max(...zs.map(z => z.cz + z.d / 2)) };
    return zs;
  }

  /* ── scene construction (re-run on every update) ── */
  function clear(){
    dyn.forEach(o => { if(o.isObject3D){ if(o.parent) o.parent.remove(o); if(o.isInstancedMesh) o.dispose(); } else if(o.dispose) o.dispose(); });
    world.clear(); dyn = []; elLabels.innerHTML = ''; people = []; bots = []; trails = []; srvLights = []; bubs = []; sparks = []; hover = null; elTip.hidden = true;
    lab = { zones: [], tags: [], server: null, more: null, sign: null };
  }
  function mk(geo, mat, n, shadow = true){
    const m = track(new T.InstancedMesh(geo, mat, Math.max(1, n))); m.count = n; m.castShadow = shadow; m.receiveShadow = shadow; m.frustumCulled = false; world.add(m); return m;
  }
  const std = o => track(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, ...o }));
  const bas = o => track(new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, ...o }));
  function setM(m, i, x, y, z, rx = 0, ry = 0, sx = 1, sy = 1, sz = 1){
    M4.position.set(x, y, z); M4.rotation.set(rx, ry, 0); M4.scale.set(sx, sy, sz); M4.updateMatrix(); m.setMatrixAt(i, M4.matrix);
  }
  function label(cls, text, tag = 'div'){ const e = document.createElement(tag); e.className = cls; e.textContent = text; if(tag === 'button') e.type = 'button'; elLabels.appendChild(e); return e; }
  /* characters are drawn K times bigger than the desks, scaled around the seat; ghosts float (o.dy) */
  const fpt = (o, x, y, z, out) => out.set(o.x + K * (x - o.x), 0.65 + K * (y - 0.65) + o.dy, o.z + 0.3 + K * (z - o.z - 0.3));
  function putPart(mesh, i, pt, o, hy, hz, yaw){
    E1.set(pt.r || 0, 0, 0); V2.set(pt.s[0] * K, pt.s[1] * K, pt.s[2] * K);
    if(pt.b){ fpt(o, o.x + pt.p[0], pt.p[1], o.z + pt.p[2], V1); Mp.compose(V1, Q1.setFromEuler(E1), V2); mesh.setMatrixAt(i, Mp); return; }
    fpt(o, o.x, hy, hz, V1); Mh.compose(V1, Q1.setFromEuler(E1.set(0, yaw, 0)), ONE);
    V1.set(pt.p[0] * K, pt.p[1] * K, pt.p[2] * K); E1.set(pt.r || 0, 0, 0); Mp.compose(V1, Q1.setFromEuler(E1), V2); Mp.premultiply(Mh); mesh.setMatrixAt(i, Mp);
  }
  const setK = (m, i, o, x, y, z, rx, sx = 1, sy = 1, sz = 1) => { fpt(o, x, y, z, TMP); setM(m, i, TMP.x, TMP.y, TMP.z, rx, 0, sx * K, sy * K, sz * K); };

  /* ── 3D text: floor decals and signpost boards are canvas textures, so no HTML pills compete with the speech bubbles ── */
  function decal(text, width, height, color){
    const cw = 1024, ch = Math.round(cw * height / width), c = document.createElement('canvas'), x = c.getContext('2d'); c.width = cw; c.height = ch;
    x.font = `800 ${Math.round(ch * 0.78)}px "Noto Sans KR","Geist",-apple-system,"Segoe UI",sans-serif`; x.textBaseline = 'middle'; x.fillStyle = color;
    let tx = text; if(x.measureText(tx).width > cw - 32){ while(tx.length > 1 && x.measureText(tx + '…').width > cw - 32) tx = tx.slice(0, -1); tx += '…'; }
    x.fillText(tx, 16, ch * 0.54);
    const tex = track(new T.CanvasTexture(c)); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const g = track(new T.PlaneGeometry(width, height)); g.rotateX(-Math.PI / 2);
    const m = track(new T.Mesh(g, track(new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })))); world.add(m);
    const see = track(new T.Mesh(g, track(new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.32, depthWrite: false, depthTest: false, toneMapped: false })))); see.renderOrder = 5; m.add(see);   /* faint see-through copy where desks or people stand in front */
    return m;
  }
  function signTex(n){
    const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = 256; c.height = 128;
    x.fillStyle = '#f3dcae'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#5a4630'; x.fillRect(58, 34, 14, 60); x.fillRect(84, 34, 14, 60);
    x.font = '800 78px "Geist","Noto Sans KR",-apple-system,sans-serif'; x.textBaseline = 'middle'; x.fillText(String(n), 118, 66);
    const tex = track(new T.CanvasTexture(c)); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return track(new T.Mesh(track(new T.PlaneGeometry(1.2, 0.6)), track(new T.MeshBasicMaterial({ map: tex, toneMapped: false }))));
  }
  let tintZ = null, rcast = null, rplane = null;
  function floorPt(px, py){
    V1.set(px / W * 2 - 1, -(py / H) * 2 + 1, 0); rcast.setFromCamera(V1, camera);
    const hit = rcast.ray.intersectPlane(rplane, V2); if(!hit) return null; return world.worldToLocal(V2.clone());
  }
  function zoneAt(px, py){ const q = floorPt(px, py); return q ? { q, zn: zones.find(z => z.kind !== 'server' && Math.abs(q.x - z.cx) <= z.w / 2 && Math.abs(q.z - z.cz) <= z.d / 2) } : null; }
  function setTint(zn){
    if(tintZ === zn || !sets.sm) return;
    const put = (z, c) => { if(z && z.rugIdx != null){ sets.sm.setColorAt(z.rugIdx, c); sets.sm.instanceColor.needsUpdate = true; } };
    put(tintZ, C(tintZ && tintZ.rugCol).lerp(cur.closed ? C('#dcdce2') : C('#ffffff'), 0)); if(tintZ && cur.closed) put(tintZ, C(tintZ.rugCol).lerp(C('#dcdce2'), 0.5));
    tintZ = zn; if(zn) put(zn, C(zn.rugCol).lerp(C('#8b7cf0'), 0.2)); request();
  }

  /* ── the person drawer (fullscreen and drawer plumbing live in makeChrome) ── */
  function sparkSvg(v){
    if(!v || v.length < 2 || !v.some(x => x > 0)) return '';
    const mx = Math.max(...v), pts = v.map((x, i) => [i / (v.length - 1) * 300, 36 - (mx ? x / mx : 0) * 32]), line = pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
    return `<svg class="sp" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,38 ${line} 300,38" fill="rgba(139,124,240,.18)"/><polyline points="${line}" fill="none" stroke="#6d5ce7" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  function renderDrawer(){
    if(!sel) return;
    const p = sel.p, dt = p.detail || {}, ui = cur.ui || {}, fam = dt.fam, tot = fam ? fam.haiku + fam.sonnet + fam.opus : 0;
    chrome.setHtml(`<div class="hd">${iconSvg(sel.ghost ? 'ghost' : p.tier)}<div><b title="${esc(p.name)}">${esc(p.name)}</b><small>${esc(p.teamName)} · ${esc(p.tierText)}</small></div><button type="button" class="x" data-a="close" aria-label="${esc(ui.close)}">×</button></div>`
      + `<div class="bd"><dl>${(dt.rows || []).map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>`
      + (tot ? `<h4>${esc(ui.runs)}</h4><div class="fam">${['haiku', 'sonnet', 'opus'].map(f => fam[f] ? `<i style="width:${(fam[f] / tot * 100).toFixed(1)}%;background:${FAMC[f]}"></i>` : '').join('')}</div><div class="famt">${['haiku', 'sonnet', 'opus'].filter(f => fam[f]).map(f => `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:${FAMC[f]}"></i>${f} ${fam[f]}</span>`).join('')}</div>` : '')
      + (sparkSvg(dt.series) ? `<h4>${esc(ui.daily)}</h4>${sparkSvg(dt.series)}` : '') + `</div>`
      + `<div class="ft"><button type="button" class="of-dbtn pri" data-a="seats">${esc(ui.seats)}</button>${dt.canPrompts ? `<button type="button" class="of-dbtn" data-a="prompts">${esc(ui.prompts)}</button>` : ''}</div>`);
  }
  function openDrawer(o){ sel = o; selId = o.p.id; renderDrawer(); chrome.open(); if(ring) ring.visible = true; }
  const closeDrawer = () => chrome.close();

  function build(d){
    cur = d; clear();
    const closed = !!d.closed, pl = d.people || [];
    elHud.innerHTML = `<b>${esc(d.hud.title)}${closed ? `<em>${esc(d.hud.closed)}</em>` : ''}</b>${esc(d.hud.stats)}`;
    elLegend.innerHTML = (d.legend || []).map(l => `<span>${l.k ? iconSvg(l.k) : l.c ? `<i style="background:${l.c}"></i>` : ''}${esc(l.label)}</span>`).join('');
    if(canvas) canvas.setAttribute('aria-label', d.aria || '');
    (container.closest('.of-card') || container).setAttribute('aria-label', d.hud.title);
    zones = layout(d);
    /* warm daylight, softer and greyer when the organization is suspended */
    hemi.color.set(closed ? '#eceef2' : '#fff7e6'); hemi.groundColor.set(closed ? '#d2d3da' : '#e8dcc4'); hemi.intensity = closed ? 1.15 : 1.25;
    sun.color.set(closed ? '#e8e8ee' : '#fff0d4'); sun.intensity = closed ? 0.45 : 0.85;
    const R = Math.hypot(FW, FD) / 2 + 4; Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R }); sun.shadow.camera.updateProjectionMatrix();
    const grey = C('#dcdce2'), col = c => closed ? C(c).lerp(grey, 0.5) : C(c);

    const sb = [], B = (c, w, h, dd, x, y, z) => sb.push([c, w, h, dd, x, y, z]);       /* static boxes */
    const sp = [], Sp = (c, r, x, y, z, sx = 1, sy = 1, sz = 1) => sp.push([c, r, x, y, z, sx, sy, sz]);   /* static spheres */
    const IW = FW + 4, ID = FD + 4;
    B('#cfe8b5', IW, 0.5, ID, 0, -0.45, 0);                                           /* garden island */
    B('#b99a73', IW - 0.6, 0.3, ID - 0.6, 0, -0.85, 0);
    B('#e9c99a', FW, 0.4, FD, 0, -0.2, 0);                                            /* wood floor, plank stripes */
    for(let k = 0; k * 1.2 < FD - 0.2; k++) B(k % 2 ? '#e2bf8c' : '#f0d2a6', FW, 0.03, 1.2, 0, 0.015, -FD / 2 + 0.6 + k * 1.2);
    B('#f6ecd6', FW, 2.2, 0.3, 0, 1.1, -FD / 2); B('#d3ecdc', 0.3, 2.2, FD, -FW / 2, 1.1, 0);
    B('#fffaf0', FW, 0.12, 0.4, 0, 2.26, -FD / 2); B('#fffaf0', 0.4, 0.12, FD, -FW / 2, 2.26, 0);
    const win = (x, z, alongX) => {                                                    /* window with blinds (closed) or glass (open) and a light patch */
      const gx = alongX ? 2.2 : 0.1, gz = alongX ? 0.1 : 2.2, fx = alongX ? 2.5 : 0.08, fz = alongX ? 0.08 : 2.5, ox = alongX ? 0 : 0.2, oz = alongX ? 0.2 : 0;
      B('#ffffff', fx, 1.3, fz, x + ox - (alongX ? 0 : 0.02), 1.3, z + oz - (alongX ? 0.02 : 0));
      B(closed ? '#d6d6dc' : '#bfe3f5', gx, 1.0, gz, x + ox + (alongX ? 0 : 0.04), 1.3, z + oz + (alongX ? 0.04 : 0));
      if(closed) for(let q = 0; q < 4; q++) B('#b7b7c2', alongX ? 2.2 : 0.12, 0.04, alongX ? 0.12 : 2.2, x + ox + (alongX ? 0 : 0.05), 1.02 + q * 0.25, z + oz + (alongX ? 0.05 : 0));
      else B('#f8e2b0', alongX ? 2.2 : 2.6, 0.02, alongX ? 2.6 : 2.2, alongX ? x : x + 1.5, 0.04, alongX ? z + 1.6 : z);
    };
    for(let x = -FW / 2 + 3.5; x < FW / 2 - 1.5; x += 6.5) win(x, -FD / 2 + 0.15, true);
    for(let z = -FD / 2 + 3.5; z < FD / 2 - 1.5; z += 6.5) win(-FW / 2 + 0.15, z, false);
    const RUG = ['#ffd6c9', '#c9ecd6', '#e3d7fa', '#cde8f8', '#fde9b8', '#f9d4e4'], CH = ['#f7a98f', '#8fd6ac', '#b7a2ee', '#8cc7ee', '#f3cd7a', '#f0a8c8'];
    let zi = 0; const zi2 = []; const screens = [], ghosts = [], solids = [];
    zones.forEach(zn => {
      if(zn.kind === 'server'){                                                         /* cute rounded kiosk */
        B('#f4ecff', 2.4, 3.0, 1.4, zn.cx, 1.5, zn.cz); Sp('#f4ecff', 1, zn.cx, 3.0, zn.cz, 1.2, 0.55, 0.7); B('#5a5270', 1.9, 2.4, 0.1, zn.cx, 1.65, zn.cz + 0.72);
        B('#e0d4f5', 2.6, 0.2, 1.6, zn.cx, 0.1, zn.cz); Sp('#ffffff', 1, zn.cx - 0.45, 3.1, zn.cz + 0.5, 0.12, 0.12, 0.12); Sp('#ffffff', 1, zn.cx + 0.45, 3.1, zn.cz + 0.5, 0.12, 0.12, 0.12);
        srv = { x: zn.cx, z: zn.cz };
        for(let i = 0; i < 7; i++) for(let j = 0; j < 4; j++) srvLights.push({ x: zn.cx - 0.66 + j * 0.44, y: 0.75 + i * 0.33, z: zn.cz + 0.8, c: C(['#7fe0b8', '#c4b5fd', '#8ec5fb', '#fcd34d', '#f9a8d4'][(i * 2 + j) % 5]), ph: hash(i * 7 + j), per: 0.6 + hash(i * 3 + j * 11) * 1.4 });
        return;
      }
      const rc = zn.kind === 'free' ? '#efe6d6' : RUG[zi % RUG.length], chair = zn.kind === 'free' ? '#d9cdb8' : CH[zi % CH.length];
      if(zn.kind !== 'free') zi++;
      zn.rugIdx = sb.length; zn.rugCol = rc; B(rc, zn.w, 0.04, zn.d, zn.cx, 0.05, zn.cz);
      zn.seats.forEach(s => {
        const x = s.x, z = s.z, p = s.p;
        B('#f3d9ae', 2.2, 0.12, 1.2, x, 1.0, z - 0.55); B('#e0bd8a', 0.1, 1.0, 1.0, x - 0.95, 0.5, z - 0.55); B('#e0bd8a', 0.1, 1.0, 1.0, x + 0.95, 0.5, z - 0.55);
        B('#f2efe9', 1.2, 0.8, 0.05, x, 1.55, z - 1.0); B('#d6cfc4', 0.12, 0.3, 0.12, x, 1.2, z - 0.95);
        B(chair, 0.8, 0.12, 0.8, x, 0.6, z + 0.35); B(chair, 0.8, 0.8, 0.12, x, 1.0, z + 0.78); B('#d6cfc4', 0.1, 0.6, 0.1, x, 0.3, z + 0.35);
        if(!p){ screens.push([x, 1.55, z - 0.95, 'off', 0]); return; }
        B('#fbf6ec', 0.9, 0.04, 0.3, x, 1.08, z - 0.3);
        const ghost = closed || p.tier === 'nodata', key = ghost ? 'nodata' : p.tier;
        const o = { x, z, p, tv: TV[key], an: ghost ? GHOST : ANIMALS[key], ghost, dy: 0, ph: hash(p.id) * 6.28 };
        o.idx = (ghost ? ghosts : solids).length; (ghost ? ghosts : solids).push(o); people.push(o);
        screens.push([x, 1.55, z - 0.95, key, o.ph]);
        if(ghost){ B('#ffffff', 0.08, 0.26, 0.03, x - 0.1, 1.55, z - 0.91); B('#ffffff', 0.08, 0.26, 0.03, x + 0.1, 1.55, z - 0.91); }
        if(p.tier === 'low' && !ghost){ fpt(o, x + 0.38, 1.5, z + 0.04, TMP); B('#fffaf0', 0.22, 0.28, 0.22, TMP.x, TMP.y + 0.02, TMP.z); }
      });
      if(zn.kind === 'team' || zn.kind === 'free'){
        /* name painted on the rug (floor decal), darker shade of the rug colour; a signpost carries the ghost count when there is one */
        const hsl = {}; C(rc).getHSL(hsl); const ink = zn.kind === 'free' ? C('#8a7a66') : C().setHSL(hsl.h, Math.min(0.62, hsl.s + 0.2), 0.3);
        zn.dw = Math.min(zn.w - 0.8, 9); zn.dx = zn.cx - zn.w / 2 + 0.4;
        const dm = decal(zn.name, zn.dw, LANE - 0.3, closed ? ink.clone().lerp(grey, 0.5).getStyle() : ink.getStyle()); dm.position.set(zn.dx + zn.dw / 2, 0.085, zn.cz + zn.d / 2 - LANE / 2);
        zn.gh = zn.kind === 'team' ? zn.ps.filter(q => q.tag).length : 0;
        if(zn.gh){
          const sx = zn.cx + zn.w / 2 - 0.8, sz = zn.cz + zn.d / 2 - 0.6; zn.sign = { x: sx, z: sz };
          B('#b98b5a', 0.14, 1.5, 0.14, sx, 0.75, sz); B('#c9976a', 1.3, 0.75, 0.1, sx, 1.75, sz); B(CH[(zi + 5) % CH.length], 0.14, 0.3, 0.15, sx, 1.15, sz);
          const sm2 = signTex(zn.gh); sm2.position.set(sx, 1.75, sz + 0.06); world.add(sm2);
        }
        if(zn.kind === 'team') zi2.push(zn);
      }
    });
    /* garden: round bushes with little flowers around the building, bushy plants inside the corners */
    const GR = ['#9fd49a', '#b5e0a0', '#8fcf9b'], FL = ['#ffb3c7', '#fff08a', '#ffffff'], bush = (x, z, k) => {
      const r = 0.55 + hash(k) * 0.35; Sp(GR[k % 3], r, x, r * 0.8, z, 1, 0.85, 1); Sp(GR[(k + 1) % 3], r * 0.7, x + r * 0.8, r * 0.55, z + 0.2, 1, 0.85, 1);
      Sp(FL[k % 3], 0.1, x + 0.15, r * 1.5, z + 0.3); Sp(FL[(k + 1) % 3], 0.1, x - 0.3, r * 1.35, z + 0.2); Sp(FL[(k + 2) % 3], 0.09, x + 0.4, r * 1.2, z - 0.2);
    };
    let bk = 0;
    for(let x = -FW / 2; x <= FW / 2; x += 4.4){ bush(x, FD / 2 + 1.1, bk++); bush(x + 1.4, -FD / 2 - 1.1, bk++); }
    for(let z = -FD / 2 + 2; z <= FD / 2 - 1; z += 4.4){ bush(FW / 2 + 1.1, z, bk++); bush(-FW / 2 - 1.1, z + 1.2, bk++); }
    [[-FW / 2 + 1, -FD / 2 + 1], [FW / 2 - 1, -FD / 2 + 1], [-FW / 2 + 1, FD / 2 - 1]].forEach(([x, z], i) => {
      B('#e8a77f', 0.7, 0.6, 0.7, x, 0.3, z); Sp('#8fcf9b', 0.6, x, 1.2, z); Sp('#a8dba0', 0.45, x + 0.3, 1.6, z - 0.1); Sp('#9fd49a', 0.42, x - 0.3, 1.5, z + 0.1);
    });
    const sm = sets.sm = mk(sets.box, std({}), sb.length); tintZ = null; sb.forEach((b, i) => { setM(sm, i, b[4], b[5], b[6], 0, 0, b[1], b[2], b[3]); sm.setColorAt(i, col(b[0])); });
    sm.instanceMatrix.needsUpdate = true; sm.instanceColor.needsUpdate = true;
    const sh = mk(sets.sph, std({}), sp.length); sp.forEach((b, i) => { setM(sh, i, b[2], b[3], b[4], 0, 0, b[1] * b[5], b[1] * b[6], b[1] * b[7]); sh.setColorAt(i, col(b[0])); });
    sh.instanceMatrix.needsUpdate = true; sh.instanceColor.needsUpdate = true;

    /* animals: torso + arms + a list of head and body parts per person, instanced per geometry; ghosts are translucent white */
    const fig = (arr, ghost) => {
      const n = arr.length, mt = o => std(ghost ? { transparent: true, opacity: 0.58, depthWrite: false, ...o } : o);
      const f = { arr, ghost, torso: mk(sets.torso, mt({}), n, !ghost), arm: mk(sets.arm, mt({}), n * 2, !ghost), sph: null, cone: null, cnt: { sph: 0, cone: 0 } };
      if(ghost){ const rm = bas({ color: '#9cc6f5', transparent: true, opacity: 0.5, side: T.BackSide, depthWrite: false }); f.rimH = mk(sets.sph, rm, n, false); f.rimT = mk(sets.torso, rm, n, false); }
      arr.forEach(o => { o.parts = o.an.parts(); o.parts.forEach(pt => { f.cnt[pt.g]++; }); });
      f.sph = mk(sets.sph, mt({}), f.cnt.sph, !ghost); f.cone = mk(sets.cone, mt({}), f.cnt.cone, !ghost);
      const ix = { sph: 0, cone: 0 };
      arr.forEach((o, i) => {
        const bc = ghost ? '#ffffff' : o.tv.body; f.torso.setColorAt(i, C(bc)); f.arm.setColorAt(i * 2, C(bc)); f.arm.setColorAt(i * 2 + 1, C(bc));
        o.rimPt = { p: [0, 0, 0], s: [0.415, 0.415, 0.415], r: 0 };
        o.pl = o.parts.map(pt => { const k = ix[pt.g]++; f[pt.g].setColorAt(k, C(pt.c)); return { m: f[pt.g], i: k, pt }; });
      });
      if(n){ f.torso.instanceColor.needsUpdate = f.arm.instanceColor.needsUpdate = true; }
      ['sph', 'cone'].forEach(g => { if(f.cnt[g]) f[g].instanceColor.needsUpdate = true; });
      return f;
    };
    sets.f = [fig(solids, false), fig(ghosts, true)];
    scr = { m: mk(sets.box, bas({}), screens.length, false), list: screens };
    screens.forEach((s, i) => { setM(scr.m, i, s[0], s[1], s[2] + 0.03, 0, 0, 1.05, 0.65, 0.06); scr.m.setColorAt(i, C('#000000')); });
    if(screens.length) scr.m.instanceMatrix.needsUpdate = true;
    const sl = mk(sets.sph, bas({}), srvLights.length, false); srvLights.forEach((l, i) => { setM(sl, i, l.x, l.y, l.z, 0, 0, 0.1, 0.1, 0.04); sl.setColorAt(i, l.c); }); sl.instanceMatrix.needsUpdate = true; srv.lights = sl;
    /* sparkles around the lions */
    const lions = solids.filter(o => o.p.tier === 'power'); sparks = [];
    lions.forEach(o => { for(let k = 0; k < 3; k++) sparks.push({ o, k }); });
    sets.spk = mk(sets.sph, bas({}), sparks.length, false); sparks.forEach((q, i) => sets.spk.setColorAt(i, C('#fff0a0'))); if(sparks.length) sets.spk.instanceColor.needsUpdate = true;

    /* helper bots: round pastel bodies with an antenna and a soft glow, one orbiting each owner, flying to the server now and then */
    const fl = [];
    if(!closed) solids.forEach(o => (o.p.bots || []).forEach((fam, j) => fl.push({ o, fam, j })));
    const bm = mk(sets.sph, bas({}), fl.length, false), gl = mk(sets.sph, bas({ transparent: true, opacity: 0.22, depthWrite: false }), fl.length, false), an = mk(sets.box, bas({}), fl.length, false), tp = mk(sets.sph, bas({}), fl.length, false);
    fl.forEach((b, i) => {
      const c = C(b.fam === 'any' ? '#c4b5fd' : FAMC[b.fam]);
      bm.setColorAt(i, c); gl.setColorAt(i, c); an.setColorAt(i, C('#ffffff')); tp.setColorAt(i, C('#ffffff'));
      bots.push({ i, o: b.o, a0: hash(b.o.p.id + b.j) * 6.28, rad: 1.5 + b.j * 0.25, sp: (b.o.p.tier === 'power' ? 0.7 : 0.45) * (b.j % 2 ? -1 : 1), hy: 2.95 + b.j * 0.25, st: 0, t: 0, next: 1.5 + hash(b.o.p.id + 'n' + b.j) * 9, pos: v3(), p0: v3(), col: c.clone().multiplyScalar(0.8) });
    });
    if(fl.length){ [bm, gl, an, tp].forEach(m => { m.instanceColor.needsUpdate = true; }); }
    Object.assign(sets, { bm, gl, an, tp });
    for(let i = 0; i < 6 && bots.length; i++){
      const g = track(new T.BufferGeometry().setFromPoints(Array.from({ length: 25 }, () => v3())));
      const ln = track(new T.Line(g, track(new T.LineDashedMaterial({ color: 0xffffff, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0 })))); ln.frustumCulled = false; ln.visible = false; world.add(ln); trails.push({ ln, busy: false });
    }

    /* HTML anchors: server label, ghost tags, "+N more", suspended sign */
    if(srv){
      const b = label('of-btn srv', d.server.label, 'button'); b.title = d.server.label; b.addEventListener('click', () => opts.onServer && opts.onServer());
      lab.server = { el: b, pos: v3().set(srv.x, 4.2, srv.z) };
    }
    people.forEach(o => { if(o.p.tag){ const e = label('of-gi', ''); e.innerHTML = iconSvg('ghost'); e.title = o.p.tag; lab.tags.push({ el: e, pos: v3().set(o.x, 3.35, o.z + 0.1), dyn: o }); } });
    if(d.more){ lab.more = { el: label('of-lbl', d.moreLabel), pos: v3().set(FW / 2 - 2.2, 0.2, FD / 2 - 0.6) }; }
    if(closed) lab.sign = { el: label('of-lbl of-sign', d.hud.closed), pos: v3().set(0, 0.2, FD / 2 + 0.2) };
    const cand = closed ? [] : solids.filter(o => (o.p.tier === 'power' || o.p.tier === 'active') && o.p.bubbles && o.p.bubbles.length);
    bubs = Array.from({ length: mobile() ? 0 : 4 }, () => ({ el: Object.assign(document.createElement('div'), { className: 'of-bub' }), o: null, until: 0 }));
    bubs.forEach(b => elLabels.appendChild(b.el));
    sets.cand = cand;
    if(reduced){ const sh = []; cand.forEach(o => { if(sh.length < 3 && sh.every(q => Math.hypot(q.x - o.x, q.z - o.z) > 5)) sh.push(o); }); sh.forEach((o, i) => { if(bubs[i]) showBub(bubs[i], o, 0); }); }
    ring = track(new T.Group());
    { const rg = track(new T.RingGeometry(1.15, 1.45, 48)); rg.rotateX(-Math.PI / 2); const dg = track(new T.CircleGeometry(1.45, 40)); dg.rotateX(-Math.PI / 2);
      const m1 = track(new T.Mesh(rg, track(new T.MeshBasicMaterial({ color: '#7c6cf0', transparent: true, opacity: 0.85, depthWrite: false })))), m2 = track(new T.Mesh(dg, track(new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, depthWrite: false }))));
      m2.position.y = -0.01; ring.add(m1, m2); ring.visible = false; world.add(ring); }
    sel = selId ? people.find(o => o.p.id === selId) || null : null;
    if(sel){ renderDrawer(); ring.visible = true; } else if(selId) closeDrawer();
    syncFs();
    sets.act = Math.max(0, Math.min(1, d.activity || 0));
    fit(); frames = 0; renderer.shadowMap.needsUpdate = true;
    step(0); request();
  }
  function showBub(b, o, now){
    const L = o.p.bubbles, bb = L[(o.bi = ((o.bi ?? -1) + 1) % L.length)];
    b.o = o; b.el.textContent = bb.text; b.el.classList.toggle('ai', !!bb.ai); b.until = now + 4.4; b.at = now; b.el.classList.add('on');
  }

  /* ── animation ── */
  function orbit(b, out){
    const a = b.a0 + time * b.sp;
    return out.set(b.o.x + Math.cos(a) * b.rad, b.hy + Math.sin(time * 2 + b.a0) * 0.12, b.o.z + 0.1 + Math.sin(a) * b.rad * 0.8);
  }
  const ease = u => u * u * (3 - 2 * u);
  function arcTo(a, b, u, out){ const e = ease(u); out.lerpVectors(a, b, e); out.y += Math.sin(Math.PI * u) * 2.1; return out; }
  function step(dt){
    time += dt;
    const idle = !drag && time - lastTouch > 2.5;
    if(idle) yawD *= Math.exp(-dt * 1.2);
    world.rotation.y = yawD + (reduced ? 0 : 0.05 * Math.sin(time * 0.22));
    const closed = !!cur.closed;
    /* people: arms bob while typing, the head turns toward the room now and then */
    sets.f.forEach(f => {
      const mv = !reduced && !f.ghost;
      f.arr.forEach((o, i) => {
        const tier = o.ghost ? 'nodata' : o.p.tier, low = tier === 'low', sp = o.tv.sp, ph = o.ph, tt = mv ? time : 0;
        const bob = sp ? Math.sin(tt * sp + ph) * 0.05 : 0, lean = low ? -0.3 + Math.sin(tt * 0.8 + ph) * 0.02 : 0.08;
        o.dy = o.ghost ? 0.14 + (mv || !reduced ? Math.sin(time * 1.6 + ph) * 0.08 : 0) : 0;
        setK(f.torso, i, o, o.x, 1.05, o.z + 0.3, lean);
        if(low){ setK(f.arm, i * 2, o, o.x + 0.36, 1.2, o.z + 0.12, 0); setK(f.arm, i * 2 + 1, o, o.x - 0.34, 1.0, o.z + 0.1, Math.PI / 2, 1, 1, 0.8); }
        else { setK(f.arm, i * 2, o, o.x - 0.3, 1.1 + bob, o.z - 0.12, Math.PI / 2); setK(f.arm, i * 2 + 1, o, o.x + 0.3, 1.1 - bob, o.z - 0.12, Math.PI / 2); }
        const hy = 1.7 + (mv ? Math.sin(tt * 1.3 + ph) * 0.015 : 0), yaw = HEAD_YAW + (mv ? Math.sin(tt * 0.6 + ph) * 0.18 : 0), hz = o.z + 0.3 + (low ? 0.15 : -0.05);
        o.pl.forEach(q => putPart(q.m, q.i, q.pt, o, hy, hz, yaw));
        if(f.ghost){ putPart(f.rimH, i, o.rimPt, o, hy, hz, yaw); setK(f.rimT, i, o, o.x, 1.05, o.z + 0.3, lean, 1.12, 1.1, 1.12); }
      });
      if(f.arr.length){ [f.torso, f.arm, f.sph, f.cone].concat(f.ghost ? [f.rimH, f.rimT] : []).forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
    });
    if(sel && ring){ ring.position.set(sel.x, 0.09, sel.z + 0.3); ring.scale.setScalar(1 + (reduced ? 0 : 0.04 * Math.sin(time * 3))); }
    sparks.forEach((q, i) => {
      const a = (reduced ? 0 : time * 1.6) + q.k * 2.1 + q.o.ph, tw = reduced ? 0.7 : 0.55 + 0.45 * Math.sin(time * 5 + q.k * 2 + q.o.ph), r = 0.85 + q.k * 0.08;
      setM(sets.spk, i, q.o.x + Math.cos(a) * r, 2.45 + q.k * 0.25 + Math.sin(a * 2) * 0.06, q.o.z + 0.25 + Math.sin(a) * r * 0.7, 0, 0, 0.09 * tw, 0.09 * tw, 0.09 * tw);
    });
    if(sparks.length) sets.spk.instanceMatrix.needsUpdate = true;
    /* monitors flicker subtly */
    const c = new T.Color();
    scr.list.forEach((s, i) => {
      const key = s[3], tv = TV[key === 'off' ? 'nodata' : key], flick = reduced || key === 'off' ? 1 : 1 + 0.06 * Math.sin(time * 23 + s[4] * 7) * (Math.sin(time * 3.1 + s[4]) > 0.55 ? 1 : 0.25);
      c.set(key === 'off' || closed ? '#59566a' : tv.scr).multiplyScalar(key === 'off' || closed ? 1 : tv.bri * flick); scr.m.setColorAt(i, c);
    });
    if(scr.list.length) scr.m.instanceColor.needsUpdate = true;
    /* server lights: blink rate follows org activity */
    if(srv){
      const rate = 0.6 + 2.4 * (sets.act || 0), cc = new T.Color();
      srvLights.forEach((l, i) => {
        const on = closed ? 0 : Math.sin((time * rate / l.per + l.ph) * 6.28) > (-0.1 + 0.5 * (1 - (sets.act || 0)) * 0.6);
        cc.copy(l.c); if(closed) cc.set('#7a7690'); else if(!on) cc.lerp(C('#6a6384'), 0.8); else cc.multiplyScalar(1 + sFlash * 0.3); srv.lights.setColorAt(i, cc);
      });
      srv.lights.instanceColor.needsUpdate = true; sFlash = Math.max(0, sFlash - dt * 1.5);
      S.set(srv.x, 3.4, srv.z + 0.3);
    }
    /* bots */
    let flying = bots.filter(b => b.st).length;
    bots.forEach(b => {
      const pos = b.pos;
      if(b.st === 0){
        orbit(b, pos);
        if(!reduced && time >= b.next && flying < 6){ const tr = trails.find(x => !x.busy); if(tr){ b.st = 1; b.t = 0; b.p0.copy(pos); b.tr = tr; tr.busy = true; flying++;
          const a = tr.ln.geometry.attributes.position; for(let k = 0; k <= 24; k++){ arcTo(b.p0, S, k / 24, TMP); a.setXYZ(k, TMP.x, TMP.y, TMP.z); } a.needsUpdate = true;
          tr.ln.material.color.copy(b.col); tr.ln.computeLineDistances(); tr.ln.visible = true; } else b.next = time + 3; }
      } else if(b.st === 1){ b.t += dt / 2; if(b.t >= 1){ b.st = 2; b.t = 0; sFlash = 1; pos.copy(S); } else arcTo(b.p0, S, b.t, pos); b.tr.ln.material.opacity = 0.9; }
      else if(b.st === 2){ b.t += dt / 0.6; pos.copy(S); pos.y += Math.sin(time * 6) * 0.05; if(b.t >= 1){ b.st = 3; b.t = 0; } }
      else { b.t += dt / 2; orbit(b, TMP); if(b.t >= 1){ b.st = 0; b.tr.busy = false; b.tr.ln.visible = false; b.next = time + (b.o.p.tier === 'power' ? 5 : 11) + hash(b.o.p.id + time) * 7; orbit(b, pos); } else { arcTo(S, TMP, b.t, pos); b.tr.ln.material.opacity = 0.9 * (1 - b.t); } }
      setM(sets.bm, b.i, pos.x, pos.y, pos.z, 0, 0, 0.24, 0.24, 0.24); setM(sets.gl, b.i, pos.x, pos.y, pos.z, 0, 0, 0.46, 0.46, 0.46);
      setM(sets.an, b.i, pos.x, pos.y + 0.32, pos.z, 0, 0, 0.03, 0.2, 0.03); setM(sets.tp, b.i, pos.x, pos.y + 0.46, pos.z, 0, 0, 0.06, 0.06, 0.06);
    });
    if(bots.length){ [sets.bm, sets.gl, sets.an, sets.tp].forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
    /* bubbles: at most 4 at once, a new one every few seconds among power and active people */
    if(!reduced && bubs.length){
      bubs.forEach(b => { if(b.o && time > b.until - 0.5) b.el.classList.remove('on'); if(b.o && time > b.until){ b.o = null; } });
      if(time >= nextBub && sets.cand.length){
        const free = bubs.find(b => !b.o), pool = sets.cand.filter(o => bubs.every(b => !b.o || Math.hypot(b.o.x - o.x, b.o.z - o.z) > 5)), pick = pool[Math.floor(Math.random() * pool.length)];
        if(free && pick) showBub(free, pick, time);
        nextBub = time + 1.6 + Math.random() * 1.6;
      }
    }
    world.updateMatrixWorld(true);
  }
  function proj(v, out){ out.copy(v).applyMatrix4(world.matrixWorld).project(camera); return [(out.x * 0.5 + 0.5) * W, (-out.y * 0.5 + 0.5) * H]; }
  function labels(){
    const placed = [], clampX = (x, w) => Math.min(W - w - 4, Math.max(4, x));
    if(hudBox) placed.push(hudBox);
    /* every HTML label is nudged upward until it no longer overlaps one placed before it */
    const place = (el, v, dx, dy, nudge = true, yo = 0) => {
      const [x, y] = proj(v, PT), w = el.offsetWidth, h = el.offsetHeight, px = Math.round(clampX(x + dx - w / 2, w));
      let py = Math.round(Math.min(H - 26, Math.max(4, y + dy + yo)));
      for(let k = 0; nudge && k < 8; k++){
        const hit = placed.find(r => px < r[0] + r[2] + 2 && px + w + 2 > r[0] && py < r[1] + r[3] + 2 && py + h + 2 > r[1]);
        if(!hit) break; py = hit === hudBox ? Math.round(hit[1] + hit[3] + 3) : Math.round(hit[1] - h - 3);
      }
      placed.push([px, py, w, h]); el.style.transform = `translate(${px}px,${py}px)`;
    };
    if(lab.server) place(lab.server.el, lab.server.pos, 0, -12);
    if(lab.more) place(lab.more.el, lab.more.pos, 0, -8);
    if(lab.sign) place(lab.sign.el, lab.sign.pos, 0, -8);
    lab.tags.forEach(l => place(l.el, l.pos, 0, -12, false, l.dyn ? l.dyn.dy * scale * 0.7 * -1 : 0));
    bubs.forEach(b => { if(!b.o) return; HP.set(b.o.x, 3.3, b.o.z); place(b.el, HP, 0, -20); });
  }
  function render(){ renderer.render(scene, camera); labels(); }
  function frame(now){
    raf = 0; if(started !== true || destroyed || !visible || document.hidden) return;
    const t = now || performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
    step(dt); if(++frames % 20 === 0) renderer.shadowMap.needsUpdate = true; render(); raf = requestAnimationFrame(frame);
  }
  function request(){
    if(started !== true || destroyed) return;
    if(reduced){ if(rr) return; rr = requestAnimationFrame(() => { rr = 0; if(destroyed) return; step(0); render(); }); return; }
    if(visible && !document.hidden && !raf){ last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  /* ── camera: fixed isometric, frustum fitted to the island box (with room for HUD and legend) ── */
  function fit(){
    if(!camera || !W || !H || !world) return;
    const inv = camera.matrixWorldInverse, v = v3(), m = mobile() ? 0.2 : 1.5, xs = [BB.x0 - m, BB.x1 + m], zs2 = [BB.z0 - m, BB.z1 + m];
    camera.updateMatrixWorld(); inv.copy(camera.matrixWorld).invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for(const yw of [-0.1, 0, 0.1]) for(const x of xs) for(const y of [-0.2, 4.6]) for(const z of zs2){
      v.set(x * Math.cos(yw) + z * Math.sin(yw), y, -x * Math.sin(yw) + z * Math.cos(yw)).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    { const rg = document.createRange(); rg.selectNodeContents(elHud); const hb = rg.getBoundingClientRect(), sb = stage.getBoundingClientRect(); hudBox = hb.width ? [hb.left - sb.left, hb.top - sb.top, hb.width, hb.height] : null; }
    const padT = Math.round(elHud.offsetHeight * 0.4) + 6, padB = elLegend.offsetHeight + 4, padX = mobile() ? 4 : 16;
    const s = Math.min((W - 2 * padX) / (x1 - x0), (H - padT - padB) / (y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, py = padT + (H - padT - padB) / 2;
    scale = s; Object.assign(camera, { left: cx - W / 2 / s, right: cx + W / 2 / s, top: cy + py / s, bottom: cy - (H - py) / s });
    camera.updateProjectionMatrix();
  }
  function resize(){
    const w = stage.clientWidth, h = stage.clientHeight;
    if(!w || !h || !renderer) return;
    const was = mobile(); W = w; H = h; renderer.setSize(w, h, false);
    if(was !== mobile() && cur) return build(cur);
    fit(); request();
  }

  /* ── pointer: drag rotates within +-35 degrees, hover tooltip, click opens the person ── */
  function nearest(px, py){
    let best = null, bd = 1e9; const rad = Math.max(16, Math.min(46, scale * 0.9));
    people.forEach(o => { const [x, y] = proj(HP.set(o.x, 2.0, o.z + 0.2), PT), dd = Math.hypot(x - px, y - py); if(dd < rad && dd < bd){ bd = dd; best = o; } });
    if(best) return { person: best };
    const f = zoneAt(px, py), q = f && f.q;
    if(q){ const z = zones.find(z => z.dw && q.x >= z.dx && q.x <= z.dx + z.dw && q.z >= z.cz + z.d / 2 - LANE && q.z <= z.cz + z.d / 2) || zones.find(z => z.sign && Math.hypot(q.x - z.sign.x, q.z - z.sign.z) < 1.1); if(z && z.kind === 'team') return { team: z }; }
    if(srv){ const [x, y] = proj(HP.set(srv.x, 1.8, srv.z), PT); if(Math.hypot(x - px, y - py) < Math.max(26, scale * 1.8)) return { server: true }; }
    return null;
  }
  function showTip(h, px, py){
    if(!h || !(h.person || h.team)){ elTip.hidden = true; return; }
    const p = h.person && h.person.p;
    elTip.innerHTML = h.team ? `<b>${esc(h.team.name)}</b>` + (h.team.gh ? `<div><span>⏸</span><span>${h.team.gh}</span></div>` : '') : `<b>${esc(p.name)}</b>` + (p.tip || []).map(r => `<div><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('') + `<div class="tier t-${p.tier}"><span>${esc(p.tierText)}</span></div>`;
    elTip.hidden = false;
    const tw = elTip.offsetWidth, th = elTip.offsetHeight;
    elTip.style.transform = `translate(${Math.round(Math.max(6, Math.min(W - tw - 6, px + 14)))}px,${Math.round(Math.max(6, Math.min(H - th - 6, py + 14)))}px)`;
  }
  function setHover(h, px, py){
    const key = h && (h.person || h.team || 'srv');
    if(hover !== key){ hover = key; canvas.classList.toggle('hit', !!h); }
    showTip(h, px, py);
  }
  const pt = ev => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  function bindPointer(){
    canvas.addEventListener('pointerdown', ev => { drag = { x: ev.clientX, y: ev.clientY, moved: false, y0: yawD }; lastTouch = time; canvas.setPointerCapture(ev.pointerId); });
    canvas.addEventListener('pointermove', ev => {
      const [px, py] = pt(ev);
      if(drag){
        const dx = ev.clientX - drag.x;
        if(!drag.moved && Math.abs(dx) > 5){ drag.moved = true; canvas.classList.add('drag'); setHover(null); }
        if(drag.moved){ yawD = Math.max(-0.61, Math.min(0.61, drag.y0 + dx * 0.006)); lastTouch = time; request(); }
        return;
      }
      if(ev.pointerType !== 'touch'){ const h = nearest(px, py); setHover(h, px, py); const f = zoneAt(px, py); setTint(f && f.zn && f.zn.kind === 'team' ? f.zn : null); }
    });
    const end = ev => {
      const d = drag; drag = null; canvas.classList.remove('drag'); lastTouch = time;
      if(!d || d.moved || ev.type === 'pointercancel') return;
      const [px, py] = pt(ev), h = nearest(px, py);
      if(!h){ setHover(null); if(sel) closeDrawer(); return; }
      if(h.server){ if(opts.onServer) opts.onServer(); return; }
      if(h.team){ if(opts.onTeam) opts.onTeam(h.team.id); return; }
      setHover(null); if(sel === h.person) closeDrawer(); else openDrawer(h.person);
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { if(!drag){ setHover(null); setTint(null); } });
  }

  async function init(){
    if(started || destroyed) return; started = 'loading';
    try{ T = await import(THREE_URL); }catch(e){ started = false; if(opts.onFail) opts.onFail('load'); return; }
    if(destroyed) return;
    try{ renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); }
    catch(e){ started = false; if(opts.onFail) opts.onFail('webgl'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    canvas = renderer.domElement; canvas.setAttribute('role', 'img'); stage.insertBefore(canvas, stage.firstChild);
    scene = new T.Scene(); world = new T.Group(); scene.add(world); rcast = new T.Raycaster(); rplane = new T.Plane(new T.Vector3(0, 1, 0), -0.07);
    M4 = new T.Object3D(); S = v3(); TMP = v3(); PT = v3(); HP = v3(); Mh = new T.Matrix4(); Mp = new T.Matrix4(); Q1 = new T.Quaternion(); E1 = new T.Euler(); V1 = v3(); V2 = v3(); ONE = v3().set(1, 1, 1);
    camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 200); camera.position.set(20, 17.5, 20); camera.lookAt(0, 0.9, 0);
    hemi = new T.HemisphereLight('#fff7e6', '#e8dcc4', 1.25); sun = new T.DirectionalLight('#fff0d4', 0.85); sun.position.set(8, 18, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0008; sun.shadow.radius = 4;
    scene.add(hemi, sun, sun.target);
    sets = { box: new T.BoxGeometry(1, 1, 1), sph: new T.SphereGeometry(1, 16, 12), cone: new T.ConeGeometry(1, 2, 10), torso: new T.CapsuleGeometry(0.3, 0.32, 4, 10), arm: new T.CapsuleGeometry(0.1, 0.26, 3, 6) };
    statics.push(sets.box, sets.sph, sets.cone, sets.torso, sets.arm);
    started = true; bindPointer();
    ro = new ResizeObserver(resize); ro.observe(stage);
    W = stage.clientWidth; H = stage.clientHeight; renderer.setSize(W, H, false);
    build(cur); request();
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if(started === true && !destroyed) build(cur); });
  }
  io = new IntersectionObserver(es => {
    visible = es.some(e => e.isIntersecting);
    if(visible && !started) init(); else if(visible) request();
  }, { threshold: 0.05 });
  io.observe(container);
  const onVis = () => { if(!document.hidden) request(); };
  document.addEventListener('visibilitychange', onVis);
  elHud.innerHTML = `<b>${esc(data.hud.title)}</b>`; syncFs();

  return {
    update(d){ cur = d; if(started === true) build(d); },
    destroy(){
      destroyed = true; if(raf) cancelAnimationFrame(raf); if(rr) cancelAnimationFrame(rr);
      if(io) io.disconnect(); if(ro) ro.disconnect();
      document.removeEventListener('visibilitychange', onVis); chrome.destroy();
      if(started === true){
        clear(); statics.forEach(o => o.dispose && o.dispose()); renderer.dispose();
        const x = renderer.getContext().getExtension('WEBGL_lose_context'); if(x) x.loseContext();
        if(canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
      container.innerHTML = '';
    }
  };
}

/* Shared data mapper for both pages: one person per seat host (a host plus the machines merged into it), over the page's date range.
 * o: { rows (org_seats), usage ({machine member_id: {spent, saved, delegated, families?}}), promptRows (org_prompt_usage members, or null),
 *      teams, used, limit, orgName, rangeLabel, closed, demoBubbles ([{text, ai}] or null), t(key, vars, raw), rel(iso) }
 * Tiers: percentile score = .5 spend + .3 delegation share (saved / (spent + saved)) + .2 prompts (renormalized without prompts);
 *   low = bottom 25% or no spend and no prompts, power = top 20% with delegation >= median, active = top half, else normal.
 * No data: a person without a machine in signal ok (paused, late, silent) is 'nodata' and stays out of the ranking. */
export function officeSceneData(o){
  const money = v => '$' + (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
  const t = o.t, usage = o.usage || {}, pr = Array.isArray(o.promptRows) ? o.promptRows : null, closed = !!o.closed;
  const teams = (o.teams || []).map(x => ({ id: x.id, name: x.name })), known = new Set(teams.map(x => x.id));
  const live = (o.rows || []).filter(r => ['ok', 'late', 'paused', 'silent'].includes(r.signal));
  const ids = new Set((o.rows || []).map(r => r.member_id)), groups = new Map();
  live.forEach(r => {
    if(r.team_id && !known.has(r.team_id)){ known.add(r.team_id); teams.push({ id: r.team_id, name: r.team_name || '?' }); }
    const key = r.seat_of && ids.has(r.seat_of) ? r.seat_of : r.member_id;
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const orgMix = { haiku: 0, sonnet: 0, opus: 0 };
  let totSpent = 0, totSaved = 0;
  Object.values(usage).forEach(u => { totSpent += Number(u.spent) || 0; totSaved += Number(u.saved) || 0; });
  const all = [...groups.entries()].map(([key, rs]) => {
    rs.sort((a, b) => (a.member_id === key ? -1 : 0) - (b.member_id === key ? -1 : 0));
    const host = rs[0], mix = { haiku: 0, sonnet: 0, opus: 0 };
    let spent = 0, saved = 0, runs = 0, fam = false; const days = {};
    rs.forEach(r => {
      ((usage[r.member_id] || {}).series || []).forEach(q => { days[q.day] = (days[q.day] || 0) + (Number(q.spent) || 0); });
      const u = usage[r.member_id] || {}; spent += Number(u.spent) || 0; saved += Number(u.saved) || 0; runs += Number(u.delegated) || 0;
      const f = u.families; if(f) Object.keys(mix).forEach(k => { const n = Number(f[k]) || 0; if(n){ mix[k] += n; orgMix[k] += n; fam = true; } });
    });
    let prompts = 0, promptId = null;
    if(pr) rs.forEach(r => { const p = pr.find(x => x.member_id === r.member_id) || pr.find(x => x.display_name && x.display_name === r.display_name); if(p){ prompts += Number(p.prompts) || 0; promptId = promptId || p.member_id; } });
    return { id: key, host, rs, spent, saved, runs, series: Object.keys(days).sort().map(d => days[d]), mix: fam ? mix : null, prompts, promptId, ok: !closed && rs.some(r => r.signal === 'ok'), dlg: spent + saved > 0 ? saved / (spent + saved) : 0 };
  });
  all.sort((a, b) => b.spent - a.spent);
  const shown = all.slice(0, MAXP), more = all.length - shown.length;
  const ranked = all.filter(p => p.ok), n = ranked.length;
  const rank = (arr, v) => { if(n < 2) return 0.5; let lo = 0, eq = 0; arr.forEach(x => { if(x < v) lo++; else if(x === v) eq++; }); return (lo + (eq - 1) / 2) / (n - 1); };
  const sp = ranked.map(p => p.spent), dl = ranked.map(p => p.dlg), pm = ranked.map(p => p.prompts), w = pr ? [0.5, 0.3, 0.2] : [0.625, 0.375, 0];
  ranked.forEach(p => { p.score = w[0] * rank(sp, p.spent) + w[1] * rank(dl, p.dlg) + (pr ? w[2] * rank(pm, p.prompts) : 0); });
  const sc = ranked.map(p => p.score), med = [...dl].sort((a, b) => a - b)[Math.floor(n / 2)] || 0;
  ranked.forEach(p => { const sr = rank(sc, p.score); p.tier = sr <= 0.25 || (p.spent < 0.01 && (!pr || !p.prompts)) ? 'low' : sr >= 0.8 && p.dlg >= med ? 'power' : sr >= 0.5 ? 'active' : 'normal'; });
  const pc = x => Math.round(x * 100) + '%', mixTot = Object.values(orgMix).reduce((a, b) => a + b, 0);
  const famOf = m => { const s = m ? Object.entries(m).sort((a, b) => b[1] - a[1]) : []; return s[0] && s[0][1] > 0 ? s[0][0] : null; };
  const botsFor = p => {
    const cap = p.tier === 'power' ? 3 : p.tier === 'active' ? 1 : 0;
    let k = p.runs <= 0 ? 0 : p.runs < 5 ? 1 : p.runs < 20 ? 2 : 3;
    k = p.tier === 'power' ? Math.max(2, Math.min(3, k)) : Math.min(cap, k);
    const m = p.mix || (mixTot ? orgMix : null), tot = m ? Object.values(m).reduce((a, b) => a + b, 0) : 0;
    return Array.from({ length: k }, (_, j) => {
      if(!tot) return 'any';
      let acc = 0; const x = (j + 0.5) / k * tot;
      for(const [f, v] of Object.entries(m).sort((a, b) => b[1] - a[1])){ acc += v; if(x <= acc && v > 0) return f; }
      return 'any';
    });
  };
  let demoI = 0;
  const people = shown.map(p => {
    const nodata = !p.ok; p.tier = nodata ? 'nodata' : p.tier;
    const paused = p.rs.find(r => r.signal === 'paused'), lastUp = p.rs.map(r => r.last_upload_at).filter(Boolean).sort().pop();
    const why = paused ? t('of.why.paused', { x: o.rel(paused.sync_state_at) }, true) : t('of.why.last', { x: lastUp ? o.rel(lastUp) : t('never') }, true);
    const tip = [[t('of.team'), p.host.team_name || '']];
    if(closed) tip.push([t('of.spent'), money(p.spent)]);
    else if(nodata) tip.push([t('of.why'), why]);
    else { tip.push([t('of.spent'), money(p.spent)]); if(pr) tip.push([t('of.prompts'), String(p.prompts)]); tip.push([t('of.deleg'), pc(p.dlg)]); }
    const bubbles = [];
    if(o.demoBubbles && (p.tier === 'power' || p.tier === 'active')) bubbles.push(o.demoBubbles[demoI++ % o.demoBubbles.length]);
    else if(!nodata){
      const f = famOf(p.mix);
      if(p.runs > 0) bubbles.push({ text: f ? t('of.b.deleg', { m: f, n: p.runs }, true) : t('of.b.deleg0', { n: p.runs }, true), ai: true });
      if(pr && p.prompts > 0) bubbles.push({ text: t('of.b.prompts', { n: p.prompts }, true) });
    }
    const late = p.rs.some(r => r.signal === 'late' || r.signal === 'silent') && !paused;
    return { id: p.id, name: p.host.display_name || p.id, teamId: p.host.team_id, teamName: p.host.team_name || '', tier: p.tier, spent: p.spent, promptId: p.promptId, tip,
      detail: { rows: [[t('of.d.os'), [...new Set(p.rs.map(r => o.os(r)))].join(', ')]].concat(nodata && !closed ? [[t('of.why'), why], [t('of.d.last'), lastUp ? o.rel(lastUp) : t('never')]]
          : [[t('of.spent'), money(p.spent)], [t('of.saved'), money(p.saved)], [t('of.deleg'), pc(p.dlg)], [t('of.runs'), String(p.runs)]].concat(pr ? [[t('of.prompts'), String(p.prompts)]] : [])),
        fam: p.mix, series: nodata ? null : p.series, canPrompts: !!(pr && p.promptId) },
      tierText: closed ? t('of.tag.closed') : t('of.tier.' + p.tier), tag: closed ? '' : nodata ? t(late ? 'of.tag.late' : 'of.tag.off') : '', bots: nodata ? [] : botsFor(p), bubbles };
  });
  const cnt = k => people.filter(m => m.tier === k).length, used = Number(o.used) || 0, limit = Number(o.limit) || 0, free = limit > used ? limit - used : 0;
  const active = people.length - cnt('nodata'), act = ranked.length ? (cnt('power') + 0.6 * cnt('active') + 0.25 * cnt('normal')) / ranked.length : 0;
  const stats = closed ? t('of.hud.closed', { u: used, limit }, true)
    : t('of.hud', { n: active, p: cnt('power'), l: cnt('low'), o: cnt('nodata'), u: used, limit }, true);
  const fam = mixTot > 0 || people.some(p => p.bots.some(b => b !== 'any'));
  const legend = closed ? [] : ['power', 'active', 'normal', 'low', 'ghost'].map(k => ({ k, label: t('of.lg.' + k) }))
    .concat(fam ? ['haiku', 'sonnet', 'opus'].map(f => ({ c: FAMC[f], label: t('of.lg.bot', { m: f }, true) })) : [{ c: '#c4b5fd', label: t('of.lg.any') }], [{ label: t('of.lg.screen') }]);
  const ui = { fs: t('of.fs'), fsExit: t('of.fs.exit'), close: t('of.close'), runs: t('of.runs'), daily: t('of.d.daily'), seats: t('of.d.seats'), prompts: t('of.d.prompts') };
  return { ui, teams, people, free, freeLabel: free ? t('of.free', { n: free }, true) : '', more: Math.max(0, more), moreLabel: more > 0 ? t('of.more', { n: more }, true) : '', closed,
    server: { label: closed ? t('of.server') + ' · ' + t('of.tag.closed') : t('of.server') + ' · ' + t('of.spent') + ' ' + money(totSpent) + ' · ' + t('of.saved') + ' ' + money(totSaved) },
    activity: act, hud: { title: o.orgName + ' ' + t('of.town') + ' · ' + o.rangeLabel, stats, closed: t('of.tag.closed') }, legend,
    aria: t('of.aria', { n: people.length, teams: teams.length, used, limit }, true) };
}
