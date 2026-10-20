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
 * The scene keeps its own bright palette in both page themes. three.js is imported lazily the first time the container scrolls into view.
 * The returned handle also carries view, ready(), people(), server() and selectPerson(id) / closeDrawer() for scripted recordings (video/tour).
 * Day/night and Seoul weather come from sky.js (shared with the town): the light, the backdrop and the lawn follow the local clock, warm lamps and
 * glowing screens take over in the evening, rain/snow/fog/storm play outside the walls, and the HUD chip shows the weather. ?tod= and ?wx= override both. */
import { hourOf, blendAnchors, fetchWeather, weatherFromCode, parseOverrides, chipText, injectSkyCss, starsBackground, clampN, WX_CLEAR } from './sky.js';
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
/* office light per time of day (blended by sky.js): hemisphere sky/ground/intensity, sun colour/intensity/position, backdrop c0/c1,
 * outside tint for the lawn and shrubs, warm interior lamps 0..1, night amount. The day row is the original cozy daylight; hi never drops
 * low enough to lose the faces (applyEnv also clamps it). Exposure is folded into the intensities (the renderer has no tone mapping). */
const OANC = {
  night: { hs: '#a3acd8', hg: '#6a6585', hi: 1.1, sc: '#aebfff', si: 0.3, sp: [6, 18, 10], c0: '#2b3a78', c1: '#0b1030', out: '#b4bde0', lamp: 1, n: 1 },
  dawn:  { hs: '#ffe6d6', hg: '#e8cdb0', hi: 1.15, sc: '#ffb58a', si: 0.72, sp: [2, 10, 14], c0: '#ffe0cf', c1: '#f0bfae', out: '#fbeee6', lamp: 0.3, n: 0.3 },
  day:   { hs: '#fff7e6', hg: '#e8dcc4', hi: 1.25, sc: '#fff0d4', si: 0.85, sp: [8, 18, 6], c0: '#fffaf0', c1: '#f6ead2', out: '#ffffff', lamp: 0, n: 0 },
  dusk:  { hs: '#ffd9c0', hg: '#d9b0a0', hi: 1.1, sc: '#ff9460', si: 0.8, sp: [14, 10, 2], c0: '#ffd5b0', c1: '#e5a186', out: '#f0d6cc', lamp: 0.65, n: 0.45 }
};
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
.of-sign{color:#b4443f;font-size:14px}
.of-bub{pointer-events:none;font-size:11px;line-height:1;color:#3a2f27;background:#fff;padding:5px 10px;border-radius:999px;box-shadow:0 2px 8px rgba(90,60,30,.22);opacity:0;transition:opacity .35s ease}
.of-bub.ai{background:#f1ebff;color:#4c1d95}.of-bub.on{opacity:1}
.of-tip{position:absolute;left:0;top:0;z-index:4;pointer-events:none;min-width:170px;max-width:260px;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.55;background:#fff;border:1px solid rgba(120,90,60,.16);color:#3a2f27;box-shadow:0 8px 24px rgba(90,60,30,.22)}
.of-tip b{display:block;font-weight:600;overflow-wrap:anywhere}
.of-tip div{display:flex;justify-content:space-between;gap:12px;color:#6a5a4a}
.of-tip div span:last-child{color:#3a2f27;text-align:right}
.of-tip .tier{margin-top:2px;font-weight:600}
.of-tip .t-power{color:#6d28d9}.of-tip .t-active{color:#1d6fb8}.of-tip .t-normal{color:#6b6256}.of-tip .t-low{color:#b45309}.of-tip .t-nodata{color:#6b7280}
.of-tools{position:absolute;top:10px;right:10px;z-index:6;display:flex;gap:6px;transition:right .28s cubic-bezier(.23,1,.32,1)}
.of-tb{width:32px;height:32px;border-radius:50%;border:1px solid rgba(120,90,60,.18);background:rgba(255,255,255,.94);color:#3a2f27;box-shadow:0 2px 6px rgba(90,60,30,.16);display:grid;place-items:center;padding:0;font:600 17px/1 inherit}
.of-tb:hover,.of-tb:focus-visible{border-color:#8b7cf0}.of-tb svg{width:16px;height:16px}
.of-hint{position:absolute;left:50%;bottom:46px;transform:translateX(-50%);z-index:6;background:rgba(58,47,39,.88);color:#fff;font-size:12px;padding:5px 12px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .4s;white-space:nowrap}.of-hint.on{opacity:1}
.of-card:fullscreen,.of-card:-webkit-full-screen{width:100%;height:100%;margin:0;border-radius:0;background:#f6ead2}
.of-card:fullscreen .of-stage,.of-card:-webkit-full-screen .of-stage,.of-card.of-fsx .of-stage{height:100vh;height:100dvh}
.of-card.of-fsx{position:fixed;inset:0;z-index:1000;margin:0;border-radius:0;border:0;background:#f6ead2}
.of-drawer{position:absolute;top:0;right:0;bottom:0;width:420px;max-width:100%;z-index:5;display:flex;flex-direction:column;background:#fffdf8;border-left:1px solid rgba(120,90,60,.16);box-shadow:-8px 0 24px rgba(90,60,30,.16);color:#3a2f27;font-size:12.5px;line-height:1.5;transform:translateX(100%);visibility:hidden;transition:transform .28s cubic-bezier(.23,1,.32,1),visibility 0s .28s}
.of-drawer.open{transform:none;visibility:visible;transition:transform .28s cubic-bezier(.23,1,.32,1)}
.of-drawer .hd{display:flex;align-items:center;gap:10px;padding:14px 14px 10px;border-bottom:1px solid rgba(120,90,60,.12)}
.of-drawer .hd svg{width:30px;height:30px;flex:none}.of-drawer .hd div{min-width:0;flex:1}
.of-drawer .hd b{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.of-drawer .hd small{display:block;color:#6a5a4a;font-size:11.5px}
.of-drawer .x{border:0;background:none;font-size:20px;line-height:1;color:#6a5a4a;padding:4px 8px;border-radius:8px}.of-drawer .x:hover{background:rgba(120,90,60,.1)}
.of-drawer .bd{flex:1;overflow-y:auto;padding:10px 14px}
.of-drawer dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:0 0 10px}.of-drawer dt{color:#6a5a4a}.of-drawer dd{margin:0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.of-drawer h4{margin:10px 0 4px;font-size:11px;font-weight:600;color:#6a5a4a}
.of-drawer .fam{display:flex;height:12px;border-radius:6px;overflow:hidden;background:#eee6d6}.of-drawer .fam i{display:block;height:100%}
.of-drawer .famt{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#6a5a4a;margin-top:4px}
.of-drawer .sec{margin:0 0 16px}.of-drawer .sec>h4{margin:0 0 6px}
.of-drawer .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.of-drawer .kv{background:#f7f1e4;border-radius:10px;padding:6px 10px;min-width:0}.of-drawer .kv span{display:block;font-size:11px;color:#6a5a4a}.of-drawer .kv b{font-size:13.5px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.of-drawer .badge{display:inline-block;padding:0 8px;border-radius:999px;font-size:11px;font-weight:600;background:#f1ebff;color:#4c1d95;margin-left:6px;vertical-align:1px}
.of-drawer .why{margin:8px 0 12px;padding:8px 10px;border-radius:10px;background:#f1ebff;color:#3b2a78;font-size:12px}
.of-drawer .ch{position:relative;height:96px;touch-action:pan-y;outline-offset:3px;border-radius:6px}.of-drawer .ch svg{width:100%;height:100%;display:block}
.of-drawer .cx{position:absolute;top:0;bottom:0;width:1px;background:rgba(58,47,39,.45);pointer-events:none;display:none}
.of-drawer .ct{position:absolute;top:2px;z-index:3;pointer-events:none;background:#3a2f27;color:#fff;font-size:11px;line-height:1.45;padding:4px 8px;border-radius:8px;white-space:nowrap;display:none}
.of-dtip{position:absolute;z-index:9;pointer-events:none;background:#3a2f27;color:#fff;font-size:11px;padding:4px 8px;border-radius:8px;white-space:nowrap;display:none}
.of-drawer .leg{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#6a5a4a;margin-top:4px}.of-drawer .leg i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.of-drawer .cmp{margin-bottom:10px}.of-drawer .cmp .ml{font-size:11.5px;font-weight:600;margin-bottom:2px}
.of-drawer .cr{display:grid;grid-template-columns:76px 1fr 64px;align-items:center;gap:6px;font-size:11px;color:#6a5a4a;outline-offset:2px;border-radius:4px}.of-drawer .cr .tr{height:7px;background:#eee6d6;border-radius:4px;overflow:hidden}.of-drawer .cr .tr i{display:block;height:100%}.of-drawer .cr span{text-align:right;color:#3a2f27;font-variant-numeric:tabular-nums}
.of-drawer .mrow{border:1px solid rgba(120,90,60,.14);border-radius:10px;padding:7px 10px;margin-bottom:6px;font-size:11.5px;line-height:1.55}.of-drawer .mrow b{font-size:12.5px}.of-drawer .mrow small{color:#6a5a4a;display:block}
.of-drawer .sig{display:inline-block;padding:0 7px;border-radius:999px;font-size:10.5px;font-weight:600;color:#fff;margin-left:6px}
.of-drawer .evr{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:4px 0;border-bottom:1px dashed rgba(120,90,60,.18)}.of-drawer .evr span:last-child{color:#6a5a4a;white-space:nowrap}
.of-drawer .fam{outline-offset:2px}.of-drawer .fam i{outline-offset:-2px}
.of-drawer .ld{color:#6a5a4a;font-size:12px;padding:8px 0}
.of-drawer .ft{display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px 14px;border-top:1px solid rgba(120,90,60,.12)}
.of-dbtn{flex:1;min-width:120px;font:inherit;font-size:12.5px;font-weight:600;padding:8px 12px;border-radius:999px;border:1px solid #cfc3f7;background:#f1ebff;color:#4c1d95}
.of-dbtn.pri{background:#6d5ce7;border-color:#6d5ce7;color:#fff}.of-dbtn:hover{filter:brightness(.96)}
.of-stage.has-drawer .of-tools{right:430px}
@media (max-width:480px){.of-drawer{top:auto;left:0;right:0;width:auto;height:72%;border-left:0;border-top:1px solid rgba(120,90,60,.16);border-radius:16px 16px 0 0;box-shadow:0 -8px 24px rgba(90,60,30,.18);transform:translateY(100%)}.of-stage.has-drawer .of-tools{right:10px}}
@media (max-width:480px){.of-card:not(:fullscreen):not(.of-fsx) .of-stage.has-drawer{height:640px}.of-card:not(:fullscreen):not(.of-fsx) .of-stage.has-drawer canvas{height:300px}.of-card:not(:fullscreen):not(.of-fsx) .of-stage.has-drawer .of-drawer{height:calc(100% - 300px)}}
@media (prefers-reduced-motion:reduce){.of-drawer,.of-drawer.open,.of-fs{transition:none}}
@media (max-width:640px){.of-tb{width:28px;height:28px}.of-tools{gap:4px}.of-stage{height:300px}.of-hud{left:12px;right:150px;top:8px;font-size:11px}.of-hud b{font-size:13px}.of-legend{left:8px;bottom:6px;font-size:10px;gap:0 10px;padding:3px 8px;max-width:calc(100% - 16px)}.of-btn,.of-lbl{font-size:11px;padding:4px 8px}}
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

/* Orbit / pan / zoom for the orthographic cameras of both scenes. The camera orbits a target: azimuth is free (360 degrees, with inertia),
 * polar angle is clamped to 20-70 degrees from the horizon, right-drag or shift-drag pans inside the bounds, the wheel and pinch zoom toward the pointer.
 * cfg: { T, canvas, stage, camera, target0:[x,y,z], theta0, phi0, dist, bounds(), size():[W,H], ppu(), isFs(), reduced, request(), onTap(px,py,ev), onMove(px,py,ev), onLeave(), onDrag(bool), onFocus(), onEnter() } */
export function makeView(cfg){
  const T = cfg.T, cam = cfg.camera, tgt = new T.Vector3(...cfg.target0), tgt0 = tgt.clone(), rc = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), V = new T.Vector3(), V2 = new T.Vector3(), N = new T.Vector2();
  const PMIN = 0.35, PMAX = 1.22, ZMIN = 0.6, ZMAX = 4, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let th = cfg.theta0, ph = cfg.phi0, zoom = 1, zT = 1, vth = 0, vph = 0, last = -99, now = 0, swayAmp = 1, focused = false, g = null, anchor = null, thEff = th;
  const ptrs = new Map();
  const pick = (px, py, out) => { const [W, H] = cfg.size(); plane.constant = -tgt.y; N.set(px / W * 2 - 1, -(py / H) * 2 + 1); rc.setFromCamera(N, cam); return rc.ray.intersectPlane(plane, out); };
  function clampT(){ const b = cfg.bounds(); tgt.x = clamp(tgt.x, b.x0, b.x1); tgt.z = clamp(tgt.z, b.z0, b.z1); }
  function pose(){
    const sp = Math.sin(ph), d = cfg.dist;
    cam.position.set(tgt.x + d * sp * Math.sin(thEff), tgt.y + d * Math.cos(ph), tgt.z + d * sp * Math.cos(thEff)); cam.lookAt(tgt); cam.zoom = zoom; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }
  function zoomStep(){
    if(Math.abs(zT - zoom) < 1e-4) return false;
    const a = anchor || (() => { const [W, H] = cfg.size(); return [W / 2, H / 2]; })(); pick(a[0], a[1], V);
    zoom += (zT - zoom) * 0.35; if(Math.abs(zT - zoom) < 1e-3) zoom = zT; cam.zoom = zoom; cam.updateProjectionMatrix();
    if(pick(a[0], a[1], V2)){ tgt.add(V.sub(V2)); clampT(); } pose(); return true;
  }
  const mark = () => { last = now; };
  function zoomAt(f, px, py){ zT = clamp(zT * f, ZMIN, ZMAX); anchor = px == null ? null : [px, py]; mark(); cfg.request(); }
  function update(dt, time){
    now = time; const idle = time - last > 20;
    swayAmp += ((idle && !cfg.reduced ? 1 : 0) - swayAmp) * Math.min(1, dt * 1.5);
    if(!g && !cfg.reduced && (Math.abs(vth) > 1e-3 || Math.abs(vph) > 1e-3)){ th += vth * dt; ph = clamp(ph + vph * dt, PMIN, PMAX); const k = Math.exp(-dt * 3); vth *= k; vph *= k; }
    thEff = th + swayAmp * 0.05 * Math.sin(time * 0.22); cfg.canvas.style.touchAction = cfg.isFs() ? 'none' : 'pan-y';
    pose(); zoomStep();
  }
  function reset(){ th = cfg.theta0; ph = cfg.phi0; zoom = zT = 1; vth = vph = 0; tgt.copy(tgt0); thEff = th; mark(); pose(); cfg.request(); }
  const rect = () => cfg.canvas.getBoundingClientRect(), pt = ev => { const r = rect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  cfg.canvas.addEventListener('pointerdown', ev => {
    cfg.canvas.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]); focused = true; if(cfg.onFocus) cfg.onFocus(); mark();
    if(ptrs.size === 2){ const [a, b] = [...ptrs.values()]; g = { mode: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: zT, moved: true }; vth = vph = 0; }
    else g = { mode: ev.button === 2 || ev.shiftKey ? 'pan' : 'orbit', lx: ev.clientX, ly: ev.clientY, sx: ev.clientX, sy: ev.clientY, moved: false, t: performance.now() };
  });
  cfg.canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  cfg.canvas.addEventListener('pointermove', ev => {
    if(ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if(!g){ if(ev.pointerType !== 'touch') cfg.onMove(...pt(ev), ev); return; }
    if(g.mode === 'pinch'){ if(ptrs.size < 2) return; const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = rect(); zT = clamp(g.z0 * d / g.d0, ZMIN, ZMAX); anchor = [(a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top]; mark(); cfg.request(); return; }
    const dx = ev.clientX - g.lx, dy = ev.clientY - g.ly;
    if(!g.moved && Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > 5){ g.moved = true; cfg.canvas.classList.add('drag'); if(cfg.onDrag) cfg.onDrag(true); }
    if(!g.moved) return;
    const tNow = performance.now(), dts = Math.max(0.008, (tNow - g.t) / 1000); g.t = tNow; g.lx = ev.clientX; g.ly = ev.clientY; mark();
    if(g.mode === 'pan'){
      const u = 1 / (cfg.ppu() * zoom), sp = Math.sin(th), cp = Math.cos(th);
      tgt.x += -cp * dx * u - sp * dy * u / Math.max(0.3, Math.cos(ph)); tgt.z += sp * dx * u - cp * dy * u / Math.max(0.3, Math.cos(ph)); clampT();
    } else { const dth = -dx * 0.008, dph = -dy * 0.006; th += dth; ph = clamp(ph + dph, PMIN, PMAX); vth = vth * 0.5 + 0.5 * dth / dts; vph = vph * 0.5 + 0.5 * dph / dts; }
    cfg.request();
  });
  const end = ev => {
    ptrs.delete(ev.pointerId); const gg = g;
    if(ptrs.size === 0){ g = null; cfg.canvas.classList.remove('drag'); if(cfg.onDrag) cfg.onDrag(false); }
    else if(ptrs.size === 1 && gg && gg.mode === 'pinch') g = null;
    if(!gg || gg.moved || ev.type === 'pointercancel' || gg.mode !== 'orbit') return;
    cfg.onTap(...pt(ev), ev);
  };
  cfg.canvas.addEventListener('pointerup', end); cfg.canvas.addEventListener('pointercancel', end);
  cfg.canvas.addEventListener('wheel', ev => {
    if(!(cfg.isFs() || ev.ctrlKey || ev.metaKey || focused)) return;
    ev.preventDefault(); const [px, py] = pt(ev); zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)), px, py);
  }, { passive: false });
  cfg.stage.addEventListener('pointerenter', () => { if(!focused && !cfg.isFs() && cfg.onEnter) cfg.onEnter(); });
  cfg.stage.addEventListener('pointerleave', () => { focused = false; if(!g) cfg.onLeave(); });
  /* programmatic pose for tests and screenshots: { th, ph, zoom, x, z } (all optional) */
  function setPose(o){
    if(o.th != null){ th = o.th; thEff = th; } if(o.ph != null) ph = clamp(o.ph, PMIN, PMAX); if(o.zoom != null) zoom = zT = clamp(o.zoom, ZMIN, ZMAX);
    if(o.x != null) tgt.x = o.x; if(o.z != null) tgt.z = o.z; vth = vph = 0; mark(); pose(); cfg.request();
  }
  return { update, reset, setPose, zoomBy: f => zoomAt(f), azimuth: () => thEff, zoom: () => zoom, apply: pose,
    defaultCam(far){ const c = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, far || 400), sp = Math.sin(cfg.phi0); c.position.set(tgt0.x + cfg.dist * sp * Math.sin(cfg.theta0), tgt0.y + cfg.dist * Math.cos(cfg.phi0), tgt0.z + cfg.dist * sp * Math.cos(cfg.theta0)); c.lookAt(tgt0); c.updateMatrixWorld(); return c; } };
}

/* Drawer widgets shared by both scenes: charts with a crosshair tooltip, segmented bars and comparison bars with hover tooltips (all keyboard focusable). */
const kreg = {};
export const kit = {
  chart(id, days, series, w = 380, h = 96){
    kreg[id] = { days, series };
    const n = days.length, mx = Math.max(1e-9, ...series.flatMap(s => s.vals)), pad = 4, bw = (w - 2 * pad) / Math.max(1, n), X = i => pad + (i + 0.5) * bw, Y = v => h - 4 - (v / mx) * (h - 12);
    let gs = '';
    series.forEach(s => { if(s.kind === 'bar') s.vals.forEach((v, i) => { const y = Y(v); gs += `<rect x="${(X(i) - bw * 0.36).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${Math.max(0, h - 4 - y).toFixed(1)}" rx="1.5" fill="${s.color}" opacity=".85"/>`; });
      else gs += `<polyline points="${s.vals.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`; });
    return `<div class="ch" data-ch="${esc(id)}" tabindex="0" role="img" aria-label="${esc(days.length ? days[0] + ' – ' + days[days.length - 1] : '')}"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${gs}</svg><div class="cx"></div><div class="ct"></div></div>`
      + `<div class="leg">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  },
  stack(parts){ const tot = parts.reduce((a, q) => a + q.v, 0) || 1; return `<div class="fam">${parts.filter(q => q.v > 0).map(q => `<i tabindex="0" style="width:${(q.v / tot * 100).toFixed(2)}%;background:${q.color}" data-tip="${esc(q.tip)}"></i>`).join('')}</div>`; },
  cmp(rows){   /* rows: [{label, items:[{name, v, txt, color}]}] */
    return rows.map(r => { const mx = Math.max(1e-9, ...r.items.map(q => q.v)); return `<div class="cmp"><div class="ml">${esc(r.label)}</div>${r.items.map(q => `<div class="cr" tabindex="0" data-tip="${esc(q.name + ' · ' + q.txt)}"><em style="font-style:normal">${esc(q.name)}</em><div class="tr"><i style="width:${(q.v / mx * 100).toFixed(1)}%;background:${q.color}"></i></div><span>${esc(q.txt)}</span></div>`).join('')}</div>`; }).join('');
  },
  bind(root){
    if(root.__kit) return; root.__kit = true;
    const tip = document.createElement('div'); tip.className = 'of-dtip'; root.appendChild(tip);
    const showChart = (ch, i) => {
      const d = kreg[ch.dataset.ch]; if(!d || !d.days.length) return; i = Math.max(0, Math.min(d.days.length - 1, i)); ch.__i = i;
      const r = ch.getBoundingClientRect(), x = (i + 0.5) / d.days.length * r.width, cx = ch.querySelector('.cx'), ct = ch.querySelector('.ct');
      cx.style.display = 'block'; cx.style.left = x + 'px'; ct.innerHTML = `<b>${esc(d.days[i])}</b>` + d.series.map(s => `<div><span style="color:${s.color}">●</span> ${esc(s.name)} ${esc(s.fmt(s.vals[i]))}</div>`).join(''); ct.style.display = 'block';
      ct.style.left = Math.max(0, Math.min(r.width - ct.offsetWidth, x - ct.offsetWidth / 2)) + 'px';
    };
    const hideChart = ch => { ch.querySelector('.cx').style.display = 'none'; ch.querySelector('.ct').style.display = 'none'; };
    const showTip = el => { if(!tip.isConnected) root.appendChild(tip); const r = el.getBoundingClientRect(), rr = root.getBoundingClientRect(); tip.textContent = el.dataset.tip; tip.style.display = 'block';
      tip.style.left = Math.max(4, Math.min(rr.width - tip.offsetWidth - 4, r.left - rr.left + r.width / 2 - tip.offsetWidth / 2)) + 'px'; tip.style.top = Math.max(2, r.top - rr.top - tip.offsetHeight - 6) + 'px'; };
    const hideTip = () => { tip.style.display = 'none'; };
    const move = ev => {
      const ch = ev.target.closest('.ch'); root.querySelectorAll('.ch').forEach(c => { if(c !== ch) hideChart(c); });
      if(ch){ const r = ch.getBoundingClientRect(); showChart(ch, Math.floor((ev.clientX - r.left) / r.width * kreg[ch.dataset.ch].days.length)); }
      const t = ev.target.closest('[data-tip]'); if(t) showTip(t); else hideTip();
    };
    root.addEventListener('pointermove', move); root.addEventListener('pointerdown', move);
    root.addEventListener('pointerleave', () => { root.querySelectorAll('.ch').forEach(hideChart); hideTip(); });
    root.addEventListener('focusin', ev => { const ch = ev.target.closest && ev.target.closest('.ch'); if(ch) showChart(ch, ch.__i ?? 0); const t = ev.target.closest && ev.target.closest('[data-tip]'); if(t) showTip(t); });
    root.addEventListener('focusout', () => { root.querySelectorAll('.ch').forEach(hideChart); hideTip(); });
    root.addEventListener('keydown', ev => { const ch = ev.target.closest && ev.target.closest('.ch'); if(!ch || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return; ev.preventDefault(); const n = kreg[ch.dataset.ch].days.length; showChart(ch, ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : (ch.__i ?? 0) + (ev.key === 'ArrowRight' ? 1 : -1)); });
  }
};

/* Shared stage chrome for the office and town scenes: the fullscreen button (Fullscreen API on the card, fixed overlay where it is missing)
 * and the slide-in drawer (bottom sheet on phones). o: { ui: () => ({fs, fsExit, close}), request(), onClose(), onAction(name) }. */
export function makeChrome(stage, container, o){
  const drawer = document.createElement('aside'); drawer.className = 'of-drawer'; drawer.setAttribute('aria-hidden', 'true'); stage.appendChild(drawer);
  const tools = document.createElement('div'); tools.className = 'of-tools'; stage.appendChild(tools);
  const mkBtn = (cls, html, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'of-tb ' + cls; b.innerHTML = html; b.addEventListener('click', fn); tools.appendChild(b); return b; };
  const RESET = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.8-4.1M2.5 2.5v3.2h3.2"/></svg>';
  const bReset = mkBtn('of-rs', RESET, () => o.onReset && o.onReset()), bOut = mkBtn('of-zo', '−', () => o.onZoom && o.onZoom(1 / 1.35)), bIn = mkBtn('of-zi', '+', () => o.onZoom && o.onZoom(1.35));
  const fs = mkBtn('of-fs', '', () => toggleFs());
  const hint = document.createElement('div'); hint.className = 'of-hint'; stage.appendChild(hint); let hintT = 0;
  const hideHint = () => { clearTimeout(hintT); hint.classList.remove('on'); };
  const showHint = () => { if(fsOn()) return; hint.textContent = (o.ui() || {}).hint || ''; hint.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(hideHint, 2600); };
  const card = container.closest('.of-card') || container;
  let fsX = false;
  const nativeFs = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fsOn = () => fsX || nativeFs() === card;
  const IN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>';
  const OUT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"/></svg>';
  function syncFs(){
    const on = fsOn(), ui = o.ui() || {}, lbl = on ? ui.fsExit : ui.fs;
    fs.innerHTML = on ? OUT : IN; fs.setAttribute('aria-label', lbl || ''); fs.title = lbl || ''; fs.setAttribute('aria-pressed', String(on));
    [[bReset, ui.reset], [bOut, ui.zoomOut], [bIn, ui.zoomIn]].forEach(([b, l]) => { b.setAttribute('aria-label', l || ''); b.title = l || ''; });
    if(on) hideHint(); o.request(); if(o.onFsChange) o.onFsChange(on);
  }
  function overlay(on){ fsX = on; card.classList.toggle('of-fsx', on); document.documentElement.style.overflow = on ? 'hidden' : ''; syncFs(); }
  function exitFs(){ if(nativeFs() === card) (document.exitFullscreen || document.webkitExitFullscreen).call(document); if(fsX) overlay(false); }
  function toggleFs(){
    if(fsOn()) exitFs();
    else if(card.requestFullscreen) card.requestFullscreen().catch(() => overlay(true));
    else if(card.webkitRequestFullscreen) card.webkitRequestFullscreen();
    else overlay(true);
  }
  const onFs = () => syncFs();
  document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
  const isOpen = () => drawer.classList.contains('open');
  function close(){ if(!isOpen()) return; drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); stage.classList.remove('has-drawer'); o.onClose(); o.request(); }
  drawer.addEventListener('click', ev => { const b = ev.target.closest('[data-a]'); if(!b) return; if(b.dataset.a === 'close') close(); else { if(fsOn()) exitFs(); o.onAction(b.dataset.a); } });
  const onKey = ev => { if(ev.key !== 'Escape') return; if(isOpen()){ close(); ev.stopPropagation(); } else if(fsX) overlay(false); };
  document.addEventListener('keydown', onKey);
  return { el: drawer, showHint, hideHint, fsOn, syncFs, isOpen, close, setHtml(h){ drawer.innerHTML = h; }, open(){ drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); stage.classList.add('has-drawer'); o.request(); },
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
  /* sky: stars behind the canvas (the stage is a stacking context), haze over it for fog, the weather chip on its own HUD line */
  injectSkyCss();
  const ov = parseOverrides();
  const elStars = document.createElement('div'); elStars.className = 'sk-stars'; elStars.style.zIndex = '-1'; stage.insertBefore(elStars, stage.firstChild);
  const elHaze = document.createElement('div'); elHaze.className = 'sk-haze'; stage.appendChild(elHaze);
  const elChip = document.createElement('div'); elChip.className = 'sk-chip'; elChip.hidden = true;
  let wx = ov.weather || { ...WX_CLEAR }, builtSnow = false, envN = 0, flash = 0, lightT = 4, baseHemi = 1, minuteTimer = 0, lamps = [], wxs = null, flakeG = null;
  let sel = null, selId = null, ring = null;
  const chrome = makeChrome(stage, container, { ui: () => cur.ui, onZoom: f => view && view.zoomBy(f), onReset: () => view && view.reset(), request: () => request(), onClose: () => { sel = null; selId = null; if(ring) ring.visible = false; },
    onAction: a => { if(!sel) return; const id = sel.p.id; if(a === 'seats' && opts.onSeats) opts.onSeats(id); else if(a === 'prompts' && opts.onPrompts) opts.onPrompts(id); } });
  const syncFs = () => chrome.syncFs();
  kit.bind(chrome.el);

  let T = null, renderer = null, scene = null, camera = null, world = null, canvas = null, ro = null, io = null, sun = null, hemi = null;
  let cur = data, destroyed = false, visible = false, raf = 0, rr = 0, last = 0, time = 0, W = 0, H = 0, started = false, frames = 0;
  let statics = [], dyn = [], hover = null, scale = 10, view = null, wallIdx = { z: [], x: [] }, wallHid = { z: false, x: false }, decals = [], signs = [], decFlip = false;
  let people = [], bots = [], trails = [], zones = [], sets = null, scr = null, srvLights = [], srv = null, lab = { zones: [], tags: [], server: null, more: null, sign: null }, bubs = [], nextBub = 1.2, sFlash = 0, FW = 10, FD = 10, sparks = [], hudBox = null, BB = { x0: -5, x1: 5, z0: -5, z1: 5 };
  let TMP2 = null, M4 = null, S = null, TMP = null, PT = null, HP = null, Mh = null, Mp = null, Q1 = null, E1 = null, V1 = null, V2 = null, ONE = null;
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
    world.clear(); dyn = []; decals = []; signs = []; decFlip = false; elLabels.innerHTML = ''; people = []; bots = []; trails = []; srvLights = []; bubs = []; sparks = []; hover = null; elTip.hidden = true;
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
  /* Where a head looks: mostly at the monitor (yaw 0 faces the screen), with a
     glance at a neighbour on either side or toward the room every few seconds,
     eased in and out. Chicks on a coffee break look around more often. A still
     frame (reduced motion) uses the room-facing pose so the faces show. */
  function headYaw(o, low, mv, dt){
    if(!mv) return HEAD_YAW;
    const L = o.look || (o.look = { yaw: 0, to: 0, next: 1 + Math.random() * 4 });
    L.next -= dt;
    if(L.next <= 0){
      if(L.to !== 0 && Math.random() < 0.85){ L.to = 0; L.next = (low ? 1.5 : 3) + Math.random() * (low ? 3 : 6); }
      else {
        const r = Math.random();
        L.to = r < 0.35 ? -1.1 : r < 0.7 ? 1.1 : HEAD_YAW;
        L.to += (Math.random() - 0.5) * 0.4;
        L.next = 0.8 + Math.random() * 1.8;
      }
    }
    L.yaw += (L.to - L.yaw) * Math.min(1, dt * 4);
    return L.yaw + Math.sin(time * 0.6 + o.ph) * 0.05;
  }
  const setK = (m, i, o, x, y, z, rx, sx = 1, sy = 1, sz = 1) => { fpt(o, x, y, z, TMP); setM(m, i, TMP.x, TMP.y, TMP.z, rx, 0, sx * K, sy * K, sz * K); };

  /* ── 3D text: one upright board per zone, a canvas texture that always faces the camera. The zone name used to be painted on the
     floor, where a long name was cut to "…" and the rest read skewed and faint at this viewing angle; the board carries the whole name
     on up to two lines, and for a team a small ghost badge with the number of people who have no data. ── */
  function teamSign(name, gh, ink){
    const cw = 1024, chh = 400, c = document.createElement('canvas'), x = c.getContext('2d'); c.width = cw; c.height = chh;
    const rr = (X, Y, Wd, Hh, r) => { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + Wd, Y, X + Wd, Y + Hh, r); x.arcTo(X + Wd, Y + Hh, X, Y + Hh, r); x.arcTo(X, Y + Hh, X, Y, r); x.arcTo(X, Y, X + Wd, Y, r); x.closePath(); };
    x.fillStyle = '#f7e9cc'; rr(0, 0, cw, chh, 44); x.fill(); x.lineWidth = 14; x.strokeStyle = '#c9a26a'; rr(7, 7, cw - 14, chh - 14, 40); x.stroke();
    const fam = '"Noto Sans KR","Geist",-apple-system,"Segoe UI",sans-serif', maxW = cw - 120 - (gh ? 200 : 0);
    const wrap = (txt, fs) => {
      x.font = `800 ${fs}px ${fam}`;
      const lines = []; let cur = '';
      for(const w of String(txt).split(/\s+/).filter(Boolean)){
        const tr = cur ? cur + ' ' + w : w;
        if(x.measureText(tr).width <= maxW){ cur = tr; continue; }
        if(cur) lines.push(cur);
        cur = w;
        while(x.measureText(cur).width > maxW && cur.length > 1){ let k = cur.length; while(k > 1 && x.measureText(cur.slice(0, k)).width > maxW) k--; lines.push(cur.slice(0, k)); cur = cur.slice(k); }
      }
      if(cur) lines.push(cur);
      return lines;
    };
    const words = String(name).split(/\s+/).filter(Boolean);
    const longest = f => { x.font = `800 ${f}px ${fam}`; return Math.max(0, ...words.map(w => x.measureText(w).width)); };
    let fs = 176, lines = wrap(name, fs);
    /* shrink the type before a word gets broken in two, but never below 112px: a board nobody can read is no board */
    while((lines.length > 2 || longest(fs) > maxW) && fs > 112){ fs -= 8; lines = wrap(name, fs); }
    if(lines.length > 2){ lines = lines.slice(0, 2); lines[1] = lines[1].slice(0, -1) + '…'; }
    x.fillStyle = ink; x.textBaseline = 'middle'; x.textAlign = 'left'; x.font = `800 ${fs}px ${fam}`;
    const lh = fs * 1.1, y0 = chh / 2 - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => x.fillText(l, 60, y0 + i * lh));
    if(gh){
      const bx = cw - 60 - 170, by = chh / 2;
      x.fillStyle = '#ffffff'; rr(bx, by - 54, 170, 108, 54); x.fill(); x.lineWidth = 4; x.strokeStyle = '#d6d0c4'; x.stroke();
      x.fillStyle = '#ffffff'; x.strokeStyle = '#b8b2a6'; x.lineWidth = 5;
      x.beginPath(); x.arc(bx + 46, by - 4, 24, Math.PI, 0); x.lineTo(bx + 70, by + 24); x.lineTo(bx + 60, by + 15); x.lineTo(bx + 50, by + 24); x.lineTo(bx + 40, by + 15); x.lineTo(bx + 30, by + 24); x.lineTo(bx + 22, by + 15); x.lineTo(bx + 22, by - 4); x.closePath(); x.fill(); x.stroke();
      x.fillStyle = '#8a8f9c'; x.beginPath(); x.arc(bx + 38, by - 8, 4.5, 0, 6.3); x.fill(); x.beginPath(); x.arc(bx + 54, by - 8, 4.5, 0, 6.3); x.fill();
      x.fillStyle = '#5a4630'; x.font = `800 66px ${fam}`; x.fillText(String(gh), bx + 86, by);
    }
    const tex = track(new T.CanvasTexture(c)); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return track(new T.Mesh(track(new T.PlaneGeometry(4.1, 1.6)), track(new T.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }))));
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
  function renderDrawer(){
    if(!sel) return;
    const p = sel.p, dt = p.detail || {}, ui = cur.ui || {}, fam = dt.fam, tot = fam ? fam.haiku + fam.sonnet + fam.opus : 0, fm = dt.fmt || (v => String(v)), id = 'o-' + p.id;
    const sec = (title, html) => html ? `<div class="sec"><h4>${esc(title)}</h4>${html}</div>` : '';
    const famHtml = tot ? kit.stack(['haiku', 'sonnet', 'opus'].map(f => ({ v: fam[f], color: FAMC[f], tip: `${f} · ${fam[f]} · ${Math.round(fam[f] / tot * 100)}%` })))
      + `<div class="famt">${['haiku', 'sonnet', 'opus'].filter(f => fam[f]).map(f => `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:${FAMC[f]}"></i>${f} ${fam[f]}</span>`).join('')}</div>` : '';
    const daily = dt.days && dt.days.length ? kit.chart(id + '-d', dt.days, [{ name: ui.spent, color: '#8b7cf0', kind: 'bar', vals: dt.spent, fmt: fm }, { name: ui.saved, color: '#2f9e6f', kind: 'line', vals: dt.saved, fmt: fm }]) : '';
    const pdaily = dt.pdays && dt.pdays.length ? kit.chart(id + '-p', dt.pdays, [{ name: ui.pname || '', color: '#e0a23c', kind: 'bar', vals: dt.pvals, fmt: v => String(Math.round(v)) }]) : '';
    chrome.setHtml(`<div class="hd">${iconSvg(sel.ghost ? 'ghost' : p.tier)}<div><b title="${esc(p.name)}">${esc(p.name)}<span class="badge">${esc(p.tierText)}</span></b><small>${esc(p.teamName)}</small></div><button type="button" class="x" data-a="close" aria-label="${esc(ui.close)}">×</button></div>`
      + `<div class="bd"><div class="why">${esc(dt.why)}</div>`
      + (dt.grid && dt.grid.length ? `<div class="sec"><div class="grid">${dt.grid.map(r => `<div class="kv"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div></div>` : '')
      + sec(ui.runs, famHtml) + sec(ui.cmp, kit.cmp(dt.cmp || [])) + sec(ui.daily, daily) + sec(ui.pdaily, pdaily)
      + sec(ui.machines, (dt.machines || []).map(m => `<div class="mrow"><b>${esc(m.name)}</b><span class="sig" style="background:${m.color}">${esc(m.sig)}</span><small>${esc(m.os)}${m.ver ? ' · ' + esc(m.ver) : ''} · ${esc(m.sw)}</small><small>${esc(ui.up)} ${esc(m.up)} · ${esc(ui.seen)} ${esc(m.seen)}</small></div>`).join(''))
      + sec(ui.events, (dt.events || []).map(e => `<div class="evr"><span>${esc(e.text)}</span><span>${esc(e.when)}</span></div>`).join('')) + `</div>`
      + `<div class="ft"><button type="button" class="of-dbtn pri" data-a="seats">${esc(ui.seats)}</button>${dt.canPrompts ? `<button type="button" class="of-dbtn" data-a="prompts">${esc(ui.prompts)}</button>` : ''}</div>`);
  }
  function openDrawer(o){ sel = o; selId = o.p.id; renderDrawer(); chrome.open(); if(ring) ring.visible = true; }
  const closeDrawer = () => chrome.close();

  function build(d){
    cur = d; clear();
    const closed = !!d.closed, pl = d.people || [];
    elHud.innerHTML = `<b>${esc(d.hud.title)}${closed ? `<em>${esc(d.hud.closed)}</em>` : ''}</b>${esc(d.hud.stats)}`; elHud.appendChild(elChip); renderChip();
    elLegend.innerHTML = (d.legend || []).map(l => `<span>${l.k ? iconSvg(l.k) : l.c ? `<i style="background:${l.c}"></i>` : ''}${esc(l.label)}</span>`).join('');
    if(canvas) canvas.setAttribute('aria-label', d.aria || '');
    (container.closest('.of-card') || container).setAttribute('aria-label', d.hud.title);
    zones = layout(d);
    /* lights, backdrop and lawn follow the time of day and the weather in applyEnv(); a suspended office stays grey there too */
    const R = Math.hypot(FW, FD) / 2 + 4; Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R }); sun.shadow.camera.updateProjectionMatrix();
    const grey = C('#dcdce2'), col = c => closed ? C(c).lerp(grey, 0.5) : C(c);
    const snowy = builtSnow = wx.kind === 'snow', SNOW = '#f7faff';
    const W0 = wxs = { outB: [], outS: [], glass: [], patch: [], wins: [], lamps: [], stones: [], glassBase: [] };

    let ws = null; wallIdx = { z: [], x: [] }; wallHid = { z: false, x: false };
    const sb = [], B = (c, w, h, dd, x, y, z) => { sb.push([c, w, h, dd, x, y, z]); if(ws) wallIdx[ws].push(sb.length - 1); };       /* static boxes */
    const sp = [], Sp = (c, r, x, y, z, sx = 1, sy = 1, sz = 1) => sp.push([c, r, x, y, z, sx, sy, sz]);   /* static spheres */
    const OB = (kind, ...a) => { B(...a); W0.outB.push([sb.length - 1, col(a[0]), kind]); }, OS = (kind, ...a) => { Sp(...a); W0.outS.push([sp.length - 1, col(a[0]), kind]); };   /* outdoors: tinted by applyEnv */
    const IW = FW + 4, ID = FD + 4;
    OB('lawn', '#cfe8b5', IW, 0.5, ID, 0, -0.45, 0);                                  /* garden island */
    OB('soil', '#b99a73', IW - 0.6, 0.3, ID - 0.6, 0, -0.85, 0);
    B('#e9c99a', FW, 0.4, FD, 0, -0.2, 0);                                            /* wood floor, plank stripes */
    for(let k = 0; k * 1.2 < FD - 0.2; k++) B(k % 2 ? '#e2bf8c' : '#f0d2a6', FW, 0.03, 1.2, 0, 0.015, -FD / 2 + 0.6 + k * 1.2);
    ws = 'z'; B('#f6ecd6', FW, 2.2, 0.3, 0, 1.1, -FD / 2); B('#fffaf0', FW, 0.12, 0.4, 0, 2.26, -FD / 2); if(snowy) B(SNOW, FW + 0.06, 0.1, 0.46, 0, 2.37, -FD / 2);
    ws = 'x'; B('#d3ecdc', 0.3, 2.2, FD, -FW / 2, 1.1, 0); B('#fffaf0', 0.4, 0.12, FD, -FW / 2, 2.26, 0); if(snowy) B(SNOW, 0.46, 0.1, FD + 0.06, -FW / 2, 2.37, 0); ws = null;   /* walls that end up between the camera and the room are flattened in updateWalls() */
    const win = (x, z, alongX) => {                                                    /* window with blinds (closed) or glass (open) and a light patch */
      const gx = alongX ? 2.2 : 0.1, gz = alongX ? 0.1 : 2.2, fx = alongX ? 2.5 : 0.08, fz = alongX ? 0.08 : 2.5, ox = alongX ? 0 : 0.2, oz = alongX ? 0.2 : 0;
      B('#ffffff', fx, 1.3, fz, x + ox - (alongX ? 0 : 0.02), 1.3, z + oz - (alongX ? 0.02 : 0));
      B(closed ? '#d6d6dc' : '#bfe3f5', gx, 1.0, gz, x + ox + (alongX ? 0 : 0.04), 1.3, z + oz + (alongX ? 0.04 : 0)); if(!closed) W0.glass.push(sb.length - 1);
      W0.wins.push({ x: x + ox + (alongX ? 0 : 0.11), z: z + oz + (alongX ? 0.11 : 0), alongX, ws });   /* inner glass face, for raindrops */
      if(snowy) B(SNOW, alongX ? 2.5 : 0.34, 0.07, alongX ? 0.34 : 2.5, x + ox + (alongX ? 0 : 0.06), 0.68, z + oz + (alongX ? 0.06 : 0));   /* snow on the sill */
      if(closed) for(let q = 0; q < 4; q++) B('#b7b7c2', alongX ? 2.2 : 0.12, 0.04, alongX ? 0.12 : 2.2, x + ox + (alongX ? 0 : 0.05), 1.02 + q * 0.25, z + oz + (alongX ? 0.05 : 0));
      else { B('#f8e2b0', alongX ? 2.2 : 2.6, 0.02, alongX ? 2.6 : 2.2, alongX ? x : x + 1.5, 0.04, alongX ? z + 1.6 : z); W0.patch.push(sb.length - 1); }
    };
    ws = 'z'; for(let x = -FW / 2 + 3.5; x < FW / 2 - 1.5; x += 6.5) win(x, -FD / 2 + 0.15, true);
    ws = 'x'; for(let z = -FD / 2 + 3.5; z < FD / 2 - 1.5; z += 6.5) win(-FW / 2 + 0.15, z, false); ws = null;
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
        /* the zone's name board on a post at the front-right corner, ink in a darker shade of the rug colour; a team's board also counts its ghosts */
        const hsl = {}; C(rc).getHSL(hsl); const ink = zn.kind === 'free' ? C('#8a7a66') : C().setHSL(hsl.h, Math.min(0.62, hsl.s + 0.2), 0.3);
        zn.dw = 0;
        zn.gh = zn.kind === 'team' ? zn.ps.filter(q => q.tag).length : 0;
        const sx = zn.cx + zn.w / 2 - 0.9, sz = zn.cz + zn.d / 2 - 0.6; zn.sign = { x: sx, z: sz };
        B('#b98b5a', 0.14, 1.6, 0.14, sx, 0.8, sz); B(CH[(zi + 5) % CH.length], 0.14, 0.3, 0.15, sx, 1.2, sz);
        const sm2 = teamSign(zn.name, zn.gh, (closed ? ink.clone().lerp(grey, 0.5) : ink).getStyle()); sm2.position.set(sx, 2.35, sz); world.add(sm2); signs.push(sm2);
        if(zn.kind === 'team'){
          zi2.push(zn);
          /* floor lamp in the aisle at the back-left corner of the rug; lit in the evening with a warm pool over the team */
          const lx = zn.cx - zn.w / 2 - 0.55, lz = zn.cz - zn.d / 2 + 0.5;
          B('#8a7a66', 0.42, 0.06, 0.42, lx, 0.03, lz); B('#8a7a66', 0.07, 2.4, 0.07, lx, 1.2, lz);
          W0.lamps.push({ x: lx, z: lz, cx: zn.cx, cz: zn.cz, r: Math.min(zn.w, zn.d) * 0.5, n: zn.n });
        }
      }
    });
    /* garden: round bushes with little flowers around the building, bushy plants inside the corners */
    const GR = ['#9fd49a', '#b5e0a0', '#8fcf9b'], FL = ['#ffb3c7', '#fff08a', '#ffffff'], bush = (x, z, k) => {
      const r = 0.55 + hash(k) * 0.35; OS('bush', GR[k % 3], r, x, r * 0.8, z, 1, 0.85, 1); OS('bush', GR[(k + 1) % 3], r * 0.7, x + r * 0.8, r * 0.55, z + 0.2, 1, 0.85, 1);
      if(snowy){ OS('snow', SNOW, r * 0.86, x, r * 1.22, z, 1, 0.42, 1); OS('snow', SNOW, r * 0.6, x + r * 0.8, r * 0.86, z + 0.2, 1, 0.42, 1); return; }   /* white caps hide the flowers */
      OS('flower', FL[k % 3], 0.1, x + 0.15, r * 1.5, z + 0.3); OS('flower', FL[(k + 1) % 3], 0.1, x - 0.3, r * 1.35, z + 0.2); OS('flower', FL[(k + 2) % 3], 0.09, x + 0.4, r * 1.2, z - 0.2);
    };
    let bk = 0;
    /* stepping stones from the open front edge to the lawn edge, between two shrubs; they go dark and glossy in the rain */
    { const xp = -FW / 2 + 4.4 * (Math.max(0, Math.round(FW / 2 / 4.4 - 0.5)) + 0.5); [0.42, 1.02, 1.62].forEach((dz, i) => W0.stones.push([xp + (i % 2 ? 0.12 : -0.08), FD / 2 + dz, i])); }
    for(let x = -FW / 2; x <= FW / 2; x += 4.4){ bush(x, FD / 2 + 1.1, bk++); bush(x + 1.4, -FD / 2 - 1.1, bk++); }
    for(let z = -FD / 2 + 2; z <= FD / 2 - 1; z += 4.4){ bush(FW / 2 + 1.1, z, bk++); bush(-FW / 2 - 1.1, z + 1.2, bk++); }
    [[-FW / 2 + 1, -FD / 2 + 1], [FW / 2 - 1, -FD / 2 + 1], [-FW / 2 + 1, FD / 2 - 1]].forEach(([x, z], i) => {
      B('#e8a77f', 0.7, 0.6, 0.7, x, 0.3, z); Sp('#8fcf9b', 0.6, x, 1.2, z); Sp('#a8dba0', 0.45, x + 0.3, 1.6, z - 0.1); Sp('#9fd49a', 0.42, x - 0.3, 1.5, z + 0.1);
    });
    const sm = sets.sm = mk(sets.box, std({}), sb.length); tintZ = null; sets.sb = sb; sb.forEach((b, i) => { setM(sm, i, b[4], b[5], b[6], 0, 0, b[1], b[2], b[3]); sm.setColorAt(i, col(b[0])); });
    sm.instanceMatrix.needsUpdate = true; sm.instanceColor.needsUpdate = true;
    const sh = sets.sh = mk(sets.sph, std({}), sp.length); sp.forEach((b, i) => { setM(sh, i, b[2], b[3], b[4], 0, 0, b[1] * b[5], b[1] * b[6], b[1] * b[7]); sh.setColorAt(i, col(b[0])); });
    sh.instanceMatrix.needsUpdate = true; sh.instanceColor.needsUpdate = true;
    buildEnv(W0, col);

    /* animals: torso + arms + a list of head and body parts per person, instanced per geometry; ghosts are translucent white */
    const fig = (arr, ghost) => {
      const n = arr.length, mt = o => std(ghost ? { transparent: true, opacity: 0.3, depthWrite: false, ...o } : o);
      const f = { arr, ghost, torso: mk(sets.torso, mt({}), n, !ghost), arm: mk(sets.arm, mt({}), n * 2, !ghost), sph: null, cone: null, cnt: { sph: 0, cone: 0 } };
      if(ghost){ const rm = bas({ color: '#9cc6f5', transparent: true, opacity: 0.16, side: T.BackSide, depthWrite: false }); f.rimH = mk(sets.sph, rm, n, false); f.rimT = mk(sets.torso, rm, n, false); }
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

    /* HTML anchors: server label, "+N more", suspended sign. Ghosts get no pill: the faded figure says it, the hover tip and drawer say why. */
    if(srv){
      const b = label('of-btn srv', d.server.label, 'button'); b.title = d.server.label; b.addEventListener('click', () => opts.onServer && opts.onServer());
      lab.server = { el: b, pos: v3().set(srv.x, 4.2, srv.z) };
    }
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
    applyEnv();
    fit(); frames = 0; renderer.shadowMap.needsUpdate = true;
    step(0); request();
  }
  /* ── day / night and weather (logic shared through sky.js): meshes are made per build, colours and intensities are set in applyEnv()
     (every build and every minute), motion runs in stepWx(). Particles exist only while animating; reduced motion keeps clouds and snow cover. ── */
  const LAMP_I = 11;
  function buildEnv(W0, col){
    const st = wx.kind, wet = st === 'rain' || st === 'storm', snow = st === 'snow', LP = W0.lamps, S = W0.stones;
    W0.white = C('#f4f6ff'); W0.R = Math.hypot(FW, FD) / 2 + 16;
    if(LP.length){   /* lamp shades, a halo round each bulb and a soft warm pool over the team */
      W0.lampM = mk(sets.sph, bas({}), LP.length, false);
      W0.haloM = mk(sets.sph, bas({ color: '#ffcf7a', transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }), LP.length, false);
      W0.poolM = mk(sets.disc, bas({ color: '#ffb35c', map: sets.soft, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }), LP.length, false);
      LP.forEach((l, i) => { setM(W0.lampM, i, l.x, 2.52, l.z, 0, 0, 0.3, 0.24, 0.3); setM(W0.haloM, i, l.x, 2.52, l.z, 0, 0, 0.7, 0.7, 0.7); setM(W0.poolM, i, l.cx, 0.1, l.cz, 0, 0, l.r * 2.2, 1, l.r * 2.2); });
    }
    W0.lit = [...LP].sort((a, b) => b.n - a.n).slice(0, lamps.length);   /* the biggest teams get a real warm point light */
    W0.path = mk(sets.box, std({ roughness: 0.9 }), S.length, false); W0.path.receiveShadow = true;
    W0.pud = mk(sets.disc, bas({ map: sets.soft, transparent: true, opacity: 0.5, depthWrite: false }), S.length, false); W0.pud.visible = wet || snow;
    S.forEach(([x, z, i]) => { setM(W0.path, i, x, -0.17, z, 0, 0.12 * (i - 1), 0.78, 0.06, 0.48); W0.path.setColorAt(i, col(i % 2 ? '#dcd2c2' : '#e8dfd0')); setM(W0.pud, i, x + 0.04, -0.135, z, 0, 0.3 * i, snow ? 0.95 : 0.62, 1, snow ? 0.62 : 0.36); });
    if(S.length) W0.path.instanceColor.needsUpdate = true;
    if(wx.cloud > 0.3 && st !== 'clear'){   /* soft cloud shadows drifting over the floor (clipped to it) */
      const pl = [[1, 0, FW / 2], [-1, 0, FW / 2], [0, 1, FD / 2], [0, -1, FD / 2]].map(([a, c, k]) => new T.Plane(new T.Vector3(a, 0, c), k)), n = 5;
      const m = mk(sets.disc, bas({ color: '#1c2238', map: sets.soft, transparent: true, opacity: 0.07 + 0.1 * wx.cloud, depthWrite: false, clippingPlanes: pl }), n, false);
      W0.cs = { m, list: Array.from({ length: n }, (_, i) => ({ x: -FW / 2 - 2 + (i + hash('cs' + i)) / n * (FW + 4), z: -FD / 2 + (0.1 + 0.8 * hash('cz' + i)) * FD, sx: 4 + hash('sx' + i) * 3, sz: 2.6 + hash('sz' + i) * 2, sp: 0.7 + hash('sp' + i) * 0.6 })) };
    }
    if(!reduced && (wet || snow)){   /* rain streaks or flakes around the building, never over the desks */
      const n = Math.min(1200, Math.floor((snow ? 650 : 520) + 600 * wx.rain));
      const m = mk(snow ? flakeG : sets.box, bas({ color: snow ? '#ffffff' : '#cfdcf2', transparent: true, opacity: snow ? 0.92 : 0.5, depthWrite: false }), n, false);
      const p = W0.parts = { snow, n, m, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), v: new Float32Array(n), ph: new Float32Array(n), g: new Float32Array(n), ox: FW / 2 + 2.6, oz: FD / 2 + 2.6, ix: FW / 2 + 0.35, iz: FD / 2 + 0.35, top: 7.5 };
      for(let i = 0; i < n; i++){ dropAt(p, i, false); p.v[i] = snow ? 0.9 + Math.random() * 0.8 : 13 + Math.random() * 6; p.ph[i] = Math.random() * 6.28; }
    }
    if(!reduced && wet && W0.wins.length){   /* drops running down the inside of the glass */
      const per = 5, n = W0.wins.length * per, m = mk(sets.box, bas({ color: '#eef5ff', transparent: true, opacity: 0.6, depthWrite: false }), n, false);
      W0.drip = { m, list: Array.from({ length: n }, (_, i) => ({ w: W0.wins[Math.floor(i / per)], u: Math.random() * 1.9 - 0.95, y: 0.85 + Math.random() * 0.9, v: 0.2 + Math.random() * 0.45 })) };
    }
  }
  function dropAt(p, i, top){
    let x = 0, z = 0;
    for(let k = 0; k < 12; k++){ x = (Math.random() * 2 - 1) * p.ox; z = (Math.random() * 2 - 1) * p.oz; if(Math.abs(x) > p.ix || Math.abs(z) > p.iz) break; }
    if(Math.abs(x) <= p.ix && Math.abs(z) <= p.iz) z = -p.iz - 0.6;
    /* on the camera side a drop starts low, so its streak never crosses the desks on screen */
    const az = view ? view.azimuth() : Math.PI / 4, near = x * Math.sin(az) + z * Math.cos(az) > 0, hTop = near ? 0.8 : p.top;
    p.x[i] = x; p.z[i] = z; p.y[i] = top ? hTop : Math.random() * hTop;
    p.g[i] = Math.abs(x) < FW / 2 + 2 && Math.abs(z) < FD / 2 + 2 ? -0.2 : -1.1;
  }
  function applyEnv(){
    const w = wxs; if(!renderer || !w || !sets || !sets.sm) return;
    const P = blendAnchors(OANC, ov.hour != null ? ov.hour : hourOf(), T), closed = !!cur.closed, st = wx.kind, wet = st === 'rain' || st === 'storm', snow = st === 'snow', fog = st === 'fog';
    const n = envN = P.n, dayK = 1 - n, ovc = clampN((wx.cloud - 0.15) / 0.85, 0, 1), lamp = closed ? 0 : P.lamp;
    /* sky and sun: dimmer under cloud and storm, the hemisphere never drops below the floor that keeps the faces readable */
    hemi.color.copy(P.hs); hemi.groundColor.copy(P.hg); sun.color.copy(P.sc);
    let hi = P.hi * (1 - 0.1 * ovc), si = P.si * (1 - 0.5 * ovc - (st === 'storm' ? 0.15 : 0));
    if(closed){ hemi.color.lerp(C('#e6e7ec'), 0.7); hemi.groundColor.lerp(C('#d2d3da'), 0.7); sun.color.lerp(C('#e8e8ee'), 0.7); hi *= 0.92; si *= 0.53; }
    baseHemi = hemi.intensity = Math.max(0.85, hi); sun.intensity = si; sun.position.set(P.sp[0], P.sp[1], P.sp[2]).normalize().multiplyScalar(w.R);
    lamps.forEach((L, i) => { const q = w.lit[i]; L.intensity = q ? lamp * LAMP_I : 0; if(q) L.position.set(q.cx, 3.4, q.cz); });
    if(w.lampM){
      w.lampM.material.color.set('#f1e6d0').lerp(C('#ffd98c'), lamp).multiplyScalar(1 - 0.55 * n * (1 - lamp));
      w.haloM.material.opacity = 0.3 * lamp; w.poolM.material.opacity = 0.3 * lamp; w.haloM.visible = w.poolM.visible = lamp > 0.02;
    }
    /* backdrop, stars and haze */
    const dull = clampN((wx.cloud - 0.15) * 0.95 + (fog ? 0.2 : 0), 0, 1), gr = c => { const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; return c.clone().lerp(new T.Color(l * 0.9, l * 0.93, l), dull * (0.35 + 0.65 * dayK)).multiplyScalar(1 - 0.1 * dull * dayK); };
    const dark = st === 'storm' ? 0.76 : wet ? 0.9 : 1, s0 = gr(P.c0).multiplyScalar(dark), s1 = gr(P.c1).multiplyScalar(dark);
    stage.style.background = `radial-gradient(ellipse at 50% 35%, #${s0.getHexString()} 0, #${s1.getHexString()} 80%)`;
    stage.classList.toggle('sk-night', n > 0.55); renderChip();
    elStars.style.opacity = String(clampN((n - 0.5) * 2.2, 0, 1) * (1 - clampN((wx.cloud - 0.25) / 0.5, 0, 1)));   /* overcast skies hide the stars and the moon */
    const fogC = s0.clone().lerp(s1, 0.4).lerp(C('#e9edf2'), 0.55 * dayK), rgb = fogC.getStyle().replace(/^rgb\(|\)$/g, '');
    elHaze.style.background = `radial-gradient(ellipse at 50% 52%, rgba(${rgb},0) 26%, rgba(${rgb},.72) 74%, rgba(${rgb},.9) 100%)`;
    elHaze.style.opacity = String(fog ? 1 : wet ? 0.38 : snow ? 0.3 : 0);
    /* outdoors: lawn, soil and shrubs take the time-of-day tint, go white under snow, darker in the rain, milky in fog */
    const WH = C('#f4f8fc'), SN = C('#d4e0ff').multiplyScalar(1 + 0.5 * (1 - Math.abs(dayK * 2 - 1))), tint = snow ? P.out.clone().lerp(WH, 0.65 * dayK) : P.out, tmp = new T.Color();   /* snow stays pale at dusk, blue at night */
    w.outB.forEach(([i, base, kind]) => { tmp.copy(base); if(snow && kind === 'lawn') tmp.lerp(SN, 0.94).multiplyScalar(1.3);   /* snow under an overcast sky still reads white */ if(wet && kind === 'lawn') tmp.multiplyScalar(0.86); tmp.multiply(tint); if(fog) tmp.lerp(fogC, 0.45); sets.sm.setColorAt(i, tmp); });
    w.outS.forEach(([i, base, kind]) => { tmp.copy(base); if(snow && kind === 'bush') tmp.lerp(WH, 0.25); if(kind === 'snow') tmp.copy(SN).multiplyScalar(1.3); if(wet && kind !== 'snow') tmp.multiplyScalar(0.86); tmp.multiply(tint); if(fog) tmp.lerp(fogC, 0.45); sets.sh.setColorAt(i, tmp); });
    w.glassBase = w.glass.map(() => { const c = C('#bfe3f5').lerp(C('#2f3a6c'), n * 0.85).lerp(C('#b3bdc8'), ovc * 0.5 * dayK); if(fog) c.lerp(fogC, 0.5); if(snow) c.lerp(WH, 0.25 * dayK); return c; });
    w.patch.forEach(i => sets.sm.setColorAt(i, C('#f8e2b0').lerp(C('#e9c99a'), clampN(n * 1.7 + ovc * 0.8, 0, 1))));
    paintGlass(flash); sets.sh.instanceColor.needsUpdate = true;
    if(w.path){
      const pm = w.path.material; pm.color.setScalar(wet ? 0.58 : 1).multiply(tint); pm.roughness = wet ? 0.16 : 0.9; pm.metalness = wet ? 0.2 : 0;
      w.pud.material.color.copy(snow ? WH : C('#d6e6f7').lerp(C('#5a6aa8'), n)); if(snow) w.pud.material.color.multiply(tint); w.pud.material.opacity = snow ? 0.95 : 0.55;
    }
    if(w.parts && !w.parts.snow) w.parts.m.material.color.set('#6f819e').lerp(C('#cfdcf2'), n);   /* streaks stay visible against a pale day sky */
    if(w.cs) w.cs.m.material.opacity = (0.07 + 0.1 * wx.cloud) * (1 - 0.75 * n);
    /* painted floor text and signs are unlit, so they dim with the room; helper bots glow stronger at night */
    const dk = 1 - 0.42 * n * (1 - 0.35 * lamp);
    decals.forEach(m => { m.material.color.setScalar(dk); m.children.forEach(c => c.material && c.material.color.setScalar(dk)); }); signs.forEach(m => m.material.color.setScalar(Math.max(dk, 0.82)));
    if(sets.gl) sets.gl.material.opacity = 0.22 + 0.3 * n;
    renderer.shadowMap.needsUpdate = true; request();
  }
  function paintGlass(f){
    const w = wxs; if(!w || !w.glassBase || !sets.sm) return;
    const c = new T.Color(); w.glass.forEach((i, k) => sets.sm.setColorAt(i, c.copy(w.glassBase[k]).lerp(w.white, f))); sets.sm.instanceColor.needsUpdate = true;
  }
  function renderChip(){
    const c = chipText(wx, document.documentElement.lang || (/[가-힣]/.test((cur && cur.hud && cur.hud.title) || '') ? 'ko' : 'en'), envN > 0.55);
    elChip.hidden = !c; if(c){ elChip.textContent = c.text; elChip.title = c.title; }
  }
  function stepWx(dt){
    const w = wxs; if(!w) return;
    if(w.cs){ const sp = (0.2 + wx.wind * 0.02) * dt; w.cs.list.forEach((b, i) => { b.x += sp * b.sp; if(b.x - b.sx / 2 > FW / 2) b.x = -FW / 2 - b.sx / 2; setM(w.cs.m, i, b.x, 0.1, b.z, 0, 0, b.sx, 1, b.sz); }); w.cs.m.instanceMatrix.needsUpdate = true; }
    const p = w.parts;
    if(p){
      const tilt = clampN(wx.wind / 40, 0, 1) * 0.5, drift = Math.tan(tilt);
      for(let i = 0; i < p.n; i++){
        p.y[i] -= p.v[i] * dt; p.x[i] += p.snow ? (Math.sin(time * 0.9 + p.ph[i]) * 0.4 + drift * 1.2) * dt : drift * p.v[i] * dt;
        if(p.y[i] < p.g[i] || Math.abs(p.x[i]) > p.ox || (Math.abs(p.x[i]) < p.ix && Math.abs(p.z[i]) < p.iz)) dropAt(p, i, true);
        M4.position.set(p.x[i], p.y[i], p.z[i]); M4.rotation.set(0, 0, p.snow ? 0 : tilt); if(p.snow) M4.scale.setScalar(0.07); else M4.scale.set(0.022, 0.42, 0.022);
        M4.updateMatrix(); p.m.setMatrixAt(i, M4.matrix);
      }
      p.m.instanceMatrix.needsUpdate = true;
    }
    if(w.drip){
      w.drip.list.forEach((q, i) => { q.y -= q.v * dt; if(q.y < 0.84){ q.y = 1.76; q.u = Math.random() * 1.9 - 0.95; } const g = q.w, s = wallHid[g.ws] ? 0 : 1;
        setM(w.drip.m, i, g.alongX ? g.x + q.u : g.x, q.y, g.alongX ? g.z : g.z + q.u, 0, 0, 0.016 * s, 0.11 * s, 0.016 * s); });
      w.drip.m.instanceMatrix.needsUpdate = true;
    }
    if(wx.kind === 'storm' && !reduced){ lightT -= dt; if(lightT < 0){ flash = 1; lightT = 4 + Math.random() * 8; } }
    if(flash > 0){
      flash = Math.max(0, flash - dt * 4); const f = flash * (Math.random() < 0.7 ? 1 : 0.45);
      hemi.intensity = baseHemi + f * 1.4; paintGlass(f); stage.style.filter = flash > 0.02 ? `brightness(${(1 + f * 0.28).toFixed(2)})` : '';
    }
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
  function updateWalls(){
    if(!sets.sm || !view) return; const a = view.azimuth(), want = { z: Math.cos(a) < -0.05, x: Math.sin(a) < -0.05 };
    ['z', 'x'].forEach(k => { if(want[k] === wallHid[k]) return; wallHid[k] = want[k];
      wallIdx[k].forEach(i => { const b = sets.sb[i]; setM(sets.sm, i, b[4], b[5], b[6], 0, 0, b[1], want[k] ? 0.001 : b[2], b[3]); }); sets.sm.instanceMatrix.needsUpdate = true; });
  }
  function step(dt){
    time += dt;
    view.update(dt, time); updateWalls();
    { const az = view.azimuth(), flip = Math.cos(az) < 0;   /* floor text flips 180 degrees when the camera is on the far side, signs face the camera */
      if(flip !== decFlip){ decFlip = flip; decals.forEach(m => { m.rotation.y = flip ? Math.PI : 0; }); } signs.forEach(m => { m.rotation.y = az; }); }
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
        const hy = 1.7 + (mv ? Math.sin(tt * 1.3 + ph) * 0.015 : 0), yaw = headYaw(o, low, mv, dt), hz = o.z + 0.3 + (low ? 0.15 : -0.05);
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
    /* monitors flicker subtly; in the evening the lit ones glow brighter and the dark ones sink into the room */
    const c = new T.Color(), WHT = TMP2 || (TMP2 = new T.Color('#ffffff'));
    scr.list.forEach((s, i) => {
      const key = s[3], tv = TV[key === 'off' ? 'nodata' : key], flick = reduced || key === 'off' ? 1 : 1 + 0.06 * Math.sin(time * 23 + s[4] * 7) * (Math.sin(time * 3.1 + s[4]) > 0.55 ? 1 : 0.25);
      c.set(key === 'off' || closed ? '#59566a' : tv.scr).multiplyScalar(key === 'off' || closed ? 1 - 0.45 * envN : tv.bri * flick); if(envN && key !== 'off' && !closed) c.lerp(WHT, 0.16 * envN); scr.m.setColorAt(i, c);
    });
    if(scr.list.length) scr.m.instanceColor.needsUpdate = true;
    /* server lights: blink rate follows org activity, brighter at night */
    if(srv){
      const rate = 0.6 + 2.4 * (sets.act || 0), cc = new T.Color();
      srvLights.forEach((l, i) => {
        const on = closed ? 0 : Math.sin((time * rate / l.per + l.ph) * 6.28) > (-0.1 + 0.5 * (1 - (sets.act || 0)) * 0.6);
        cc.copy(l.c); if(closed) cc.set('#7a7690'); else if(!on) cc.lerp(C('#6a6384'), 0.8 - 0.3 * envN); else { cc.multiplyScalar(1 + sFlash * 0.3); if(envN) cc.lerp(WHT, 0.22 * envN); } srv.lights.setColorAt(i, cc);
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
      setM(sets.bm, b.i, pos.x, pos.y, pos.z, 0, 0, 0.24, 0.24, 0.24); setM(sets.gl, b.i, pos.x, pos.y, pos.z, 0, 0, 0.46 + 0.16 * envN, 0.46 + 0.16 * envN, 0.46 + 0.16 * envN);
      setM(sets.an, b.i, pos.x, pos.y + 0.32, pos.z, 0, 0, 0.03, 0.2, 0.03); setM(sets.tp, b.i, pos.x, pos.y + 0.46, pos.z, 0, 0, 0.06, 0.06, 0.06);
    });
    if(bots.length){ [sets.bm, sets.gl, sets.an, sets.tp].forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
    stepWx(dt);
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
      const [x, y] = proj(v, PT);
      if(x < -30 || x > W + 30 || y < -30 || y > H + 30){ el.style.display = 'none'; return; }   /* anchors that scroll out of view hide instead of sticking to the edge */
      el.style.display = '';
      const w = el.offsetWidth, h = el.offsetHeight, px = Math.round(clampX(x + dx - w / 2, w));
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
    const dc = view.defaultCam(), inv = dc.matrixWorldInverse, v = v3(), m = mobile() ? 0.2 : 1.5, xs = [BB.x0 - m, BB.x1 + m], zs2 = [BB.z0 - m, BB.z1 + m];
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for(const yw of [-0.1, 0, 0.1]) for(const x of xs) for(const y of [-0.2, 4.6]) for(const z of zs2){
      v.set(x * Math.cos(yw) + z * Math.sin(yw), y, -x * Math.sin(yw) + z * Math.cos(yw)).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    { const rg = document.createRange(); rg.selectNodeContents(elHud); const hb = rg.getBoundingClientRect(), sb = stage.getBoundingClientRect(); hudBox = hb.width ? [hb.left - sb.left, hb.top - sb.top, hb.width, hb.height] : null; }
    const padT = Math.round(elHud.offsetHeight * 0.4) + 6, padB = elLegend.offsetHeight + 4, padX = mobile() ? 4 : 16;
    const s = Math.min((W - 2 * padX) / (x1 - x0), (H - padT - padB) / (y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, py = padT + (H - padT - padB) / 2;
    scale = s; Object.assign(camera, { left: cx - W / 2 / s, right: cx + W / 2 / s, top: cy + py / s, bottom: cy - (H - py) / s });
    view.apply();
  }
  function resize(){
    const w = stage.clientWidth, h = (canvas && canvas.clientHeight) || stage.clientHeight;   /* the canvas keeps its height when a phone drawer grows the stage */
    if(!w || !h || !renderer) return;
    const was = mobile(); W = w; H = h; renderer.setSize(w, h, false);
    if(was !== mobile() && cur) return build(cur);
    fit(); request();
  }

  /* ── pointer: drag rotates within +-35 degrees, hover tooltip, click opens the person ── */
  function nearest(px, py){
    let best = null, bd = 1e9; const rad = Math.max(16, Math.min(46, scale * view.zoom() * 0.9));
    people.forEach(o => { const [x, y] = proj(HP.set(o.x, 2.0, o.z + 0.2), PT), dd = Math.hypot(x - px, y - py); if(dd < rad && dd < bd){ bd = dd; best = o; } });
    if(best) return { person: best };
    const f = zoneAt(px, py), q = f && f.q;
    if(q){ const z = zones.find(z => z.dw && q.x >= z.dx && q.x <= z.dx + z.dw && q.z >= z.cz + z.d / 2 - LANE && q.z <= z.cz + z.d / 2) || zones.find(z => z.sign && Math.hypot(q.x - z.sign.x, q.z - z.sign.z) < 1.1); if(z && z.kind === 'team') return { team: z }; }
    if(srv){ const [x, y] = proj(HP.set(srv.x, 1.8, srv.z), PT); if(Math.hypot(x - px, y - py) < Math.max(26, scale * view.zoom() * 1.8)) return { server: true }; }
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
  function bindView(){
    view = makeView({ T, canvas, stage, camera, target0: [0, 0.9, 0], theta0: Math.PI / 4, phi0: Math.atan2(Math.hypot(20, 20), 16.6), dist: Math.hypot(20, 16.6, 20), reduced,
      bounds: () => ({ x0: BB.x0, x1: BB.x1, z0: BB.z0, z1: BB.z1 }), size: () => [W, H], ppu: () => scale, isFs: () => chrome.fsOn(), request,
      onFocus: () => chrome.hideHint(), onEnter: () => chrome.showHint(), onDrag: on => { if(on) setHover(null); },
      onMove: (px, py) => { const h = nearest(px, py); setHover(h, px, py); const f = zoneAt(px, py); setTint(f && f.zn && f.zn.kind === 'team' ? f.zn : null); },
      onLeave: () => { setHover(null); setTint(null); },
      onTap: (px, py) => {
        const h = nearest(px, py);
        if(!h){ setHover(null); if(sel) closeDrawer(); return; }
        if(h.server){ if(opts.onServer) opts.onServer(); return; }
        if(h.team){ if(opts.onTeam) opts.onTeam(h.team.id); return; }
        setHover(null); if(sel === h.person) closeDrawer(); else openDrawer(h.person);
      } });
  }

  async function init(){
    if(started || destroyed) return; started = 'loading';
    try{ T = await import(THREE_URL); }catch(e){ started = false; if(opts.onFail) opts.onFail('load'); return; }
    if(destroyed) return;
    try{ renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); }
    catch(e){ started = false; if(opts.onFail) opts.onFail('webgl'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.localClippingEnabled = true;
    canvas = renderer.domElement; canvas.setAttribute('role', 'img'); stage.insertBefore(canvas, stage.firstChild);
    scene = new T.Scene(); world = new T.Group(); scene.add(world); rcast = new T.Raycaster(); rplane = new T.Plane(new T.Vector3(0, 1, 0), -0.07);
    M4 = new T.Object3D(); S = v3(); TMP = v3(); PT = v3(); HP = v3(); Mh = new T.Matrix4(); Mp = new T.Matrix4(); Q1 = new T.Quaternion(); E1 = new T.Euler(); V1 = v3(); V2 = v3(); ONE = v3().set(1, 1, 1);
    camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    hemi = new T.HemisphereLight('#fff7e6', '#e8dcc4', 1.25); sun = new T.DirectionalLight('#fff0d4', 0.85); sun.position.set(8, 18, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0008; sun.shadow.radius = 4;
    scene.add(hemi, sun, sun.target);
    for(let i = 0; i < 4; i++){ const L = new T.PointLight('#ffc98a', 0, 0, 2); scene.add(L); lamps.push(L); }   /* evening lamps: a fixed count, so no shader recompiles */
    sets = { box: new T.BoxGeometry(1, 1, 1), sph: new T.SphereGeometry(1, 16, 12), cone: new T.ConeGeometry(1, 2, 10), torso: new T.CapsuleGeometry(0.3, 0.32, 4, 10), arm: new T.CapsuleGeometry(0.1, 0.26, 3, 6), disc: new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
    { const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = c.height = 64; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);   /* soft round blob for pools, puddles and cloud shadows */
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); sets.soft = new T.CanvasTexture(c); }
    flakeG = new T.IcosahedronGeometry(1, 0);
    statics.push(sets.box, sets.sph, sets.cone, sets.torso, sets.arm, sets.disc, sets.soft, flakeG);
    elStars.style.backgroundImage = starsBackground();
    minuteTimer = setInterval(() => { if(started === true && !destroyed) applyEnv(); }, 60000);   /* the clock moves the light every minute */
    started = true; bindView();
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
  /* real Seoul weather once per mount (cached 30 min, shared with the town); a failure leaves the clear default and hides the chip */
  if(!ov.weather) fetchWeather().then(d => { if(destroyed || !d) return; wx = weatherFromCode(d); renderChip(); if(started === true) build(cur); });
  const onVis = () => { if(!document.hidden) request(); };
  document.addEventListener('visibilitychange', onVis);
  elHud.innerHTML = `<b>${esc(data.hud.title)}</b>`; elHud.appendChild(elChip); renderChip(); syncFs();

  return {
    update(d){ cur = d; if(started === true) build(d); },
    get view(){ return view; },
    ready: () => started === true && !!view,
    people: () => people.map(o => ({ id: o.p.id, name: o.p.name, tier: o.p.tier, ghost: o.ghost, x: o.x, z: o.z })),
    server: () => (srv ? { x: srv.x, z: srv.z } : null),
    selectPerson(id){ const o = people.find(q => q.p.id === id); if(o) openDrawer(o); return !!o; },
    closeDrawer: () => chrome.close(),
    destroy(){
      destroyed = true; if(raf) cancelAnimationFrame(raf); if(rr) cancelAnimationFrame(rr); clearInterval(minuteTimer);
      if(io) io.disconnect(); if(ro) ro.disconnect();
      document.removeEventListener('visibilitychange', onVis); chrome.destroy();
      if(started === true){
        clear(); wxs = null; lamps.forEach(L => { scene.remove(L); L.dispose(); }); lamps = []; statics.forEach(o => o.dispose && o.dispose()); renderer.dispose();
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
    let spent = 0, saved = 0, runs = 0, fam = false, today = 0, errors = 0; const days = {};
    rs.forEach(r => {
      ((usage[r.member_id] || {}).series || []).forEach(q => { const d = days[q.day] || (days[q.day] = [0, 0]); d[0] += Number(q.spent) || 0; d[1] += Number(q.saved) || 0; });
      today += Number((usage[r.member_id] || {}).spent_today) || 0; errors += Number((usage[r.member_id] || {}).errors) || 0;
      const u = usage[r.member_id] || {}; spent += Number(u.spent) || 0; saved += Number(u.saved) || 0; runs += Number(u.delegated) || 0;
      const f = u.families; if(f) Object.keys(mix).forEach(k => { const n = Number(f[k]) || 0; if(n){ mix[k] += n; orgMix[k] += n; fam = true; } });
    });
    let prompts = 0, promptId = null, chars = 0, lastPrompt = null; const pdays = {};
    if(pr) rs.forEach(r => { const p = pr.find(x => x.member_id === r.member_id) || pr.find(x => x.display_name && x.display_name === r.display_name); if(p){ prompts += Number(p.prompts) || 0; chars += Number(p.chars) || 0; promptId = promptId || p.member_id;
      if(p.last_prompt_at && (!lastPrompt || p.last_prompt_at > lastPrompt)) lastPrompt = p.last_prompt_at; (p.by_day || []).forEach(q => { pdays[q.day] = (pdays[q.day] || 0) + (Number(q.prompts) || 0); }); } });
    return { id: key, host, rs, spent, saved, runs, today, errors, days, pdays, chars, lastPrompt, mix: fam ? mix : null, prompts, promptId, ok: !closed && rs.some(r => r.signal === 'ok'), dlg: spent + saved > 0 ? saved / (spent + saved) : 0 };
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
  const median = a => { if(!a.length) return 0; const q = [...a].sort((x, y) => x - y), m = Math.floor(q.length / 2); return q.length % 2 ? q[m] : (q[m - 1] + q[m]) / 2; };
  const orgM = { spent: median(sp), dlg: median(dl), prompts: median(pm) }, teamM = {};
  teams.forEach(tm => { const r = ranked.filter(x => x.host.team_id === tm.id); teamM[tm.id] = { spent: median(r.map(x => x.spent)), dlg: median(r.map(x => x.dlg)), prompts: median(r.map(x => x.prompts)) }; });
  const SIG = { ok: '#2f9e6f', late: '#d89212', paused: '#5b6bd6', silent: '#8a8794' };
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
      detail: (() => {
        const ids2 = new Set(p.rs.map(r => r.member_id)), tm = teamM[p.host.team_id] || { spent: 0, dlg: 0, prompts: 0 }, dd = Object.keys(p.days).sort(), pd = Object.keys(p.pdays).sort();
        const lastP = p.lastPrompt ? o.rel(p.lastPrompt) : t('never');
        const hasData = !nodata && !closed;
        const grid = hasData ? [[t('of.spent'), money(p.spent)], [t('of.saved'), money(p.saved)], [t('of.deleg'), pc(p.dlg)], [t('of.d.today'), money(p.today)], [t('of.runs'), String(p.runs)], [t('of.d.errors'), String(p.errors)]]
          .concat(pr ? [[t('of.prompts'), String(p.prompts)], [t('of.d.days'), String(pd.length)], [t('of.d.avg'), p.prompts ? t('pu.chars', { n: Math.round(p.chars / p.prompts) }, true) : '—'], [t('of.d.lastp'), lastP]] : []) : [];
        const mk3 = (v1, v2, v3, f, nm) => [{ name: t('of.d.me'), v: v1, txt: f(v1), color: '#7c6cf0' }, { name: t('of.d.team'), v: v2, txt: f(v2), color: '#8ec5fb' }, { name: t('of.d.org'), v: v3, txt: f(v3), color: '#d4c7a8' }];
        const cmp = hasData ? [{ label: t('of.spent'), items: mk3(p.spent, tm.spent, orgM.spent, money) }, { label: t('of.deleg'), items: mk3(p.dlg, tm.dlg, orgM.dlg, pc) }].concat(pr ? [{ label: t('of.prompts'), items: mk3(p.prompts, tm.prompts, orgM.prompts, v => String(Math.round(v))) }] : []) : [];
        const evs = (o.events || []).filter(e => ids2.has(e.member_id)).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8).map(e => ({ text: t('of.ev.' + e.event) === 'of.ev.' + e.event ? String(e.event) : t('of.ev.' + e.event), when: o.rel(e.at) }));
        return { why: hasData ? t('of.d.why', { a: Math.max(1, Math.round((1 - rank(sp, p.spent)) * 100)), b: pc(p.dlg), c: pc(orgM.dlg) }, true) : closed ? t('of.tag.closed') : t('of.why') + ': ' + why,
          grid, cmp, fam: p.mix, fmt: money, days: hasData ? dd : [], spent: dd.map(d => p.days[d][0]), saved: dd.map(d => p.days[d][1]),
          pdays: hasData && pr ? pd : [], pvals: pd.map(d => p.pdays[d]),
          machines: p.rs.map(r => ({ name: r.display_name || r.member_id, os: o.os(r), ver: r.sprag_version ? 'v' + r.sprag_version : '', color: SIG[r.signal] || '#8a8794', sig: t('sr.s.' + r.signal), sw: t('sr.sw.' + (r.switch === 'off' ? 'off' : 'on')), up: r.last_upload_at ? o.rel(r.last_upload_at) : t('never'), seen: r.last_seen ? o.rel(r.last_seen) : t('never') })),
          events: evs, canPrompts: !!(pr && p.promptId) };
      })(),
      tierText: closed ? t('of.tag.closed') : t('of.tier.' + p.tier), tag: closed ? '' : nodata ? t(late ? 'of.tag.late' : 'of.tag.off') : '', bots: nodata ? [] : botsFor(p), bubbles };
  });
  const cnt = k => people.filter(m => m.tier === k).length, used = Number(o.used) || 0, limit = Number(o.limit) || 0, free = limit > used ? limit - used : 0;
  const active = people.length - cnt('nodata'), act = ranked.length ? (cnt('power') + 0.6 * cnt('active') + 0.25 * cnt('normal')) / ranked.length : 0;
  const stats = closed ? t('of.hud.closed', { u: used, limit }, true)
    : t('of.hud', { n: active, p: cnt('power'), l: cnt('low'), o: cnt('nodata'), u: used, limit }, true);
  const fam = mixTot > 0 || people.some(p => p.bots.some(b => b !== 'any'));
  const legend = closed ? [] : ['power', 'active', 'normal', 'low', 'ghost'].map(k => ({ k, label: t('of.lg.' + k) }))
    .concat(fam ? ['haiku', 'sonnet', 'opus'].map(f => ({ c: FAMC[f], label: t('of.lg.bot', { m: f }, true) })) : [{ c: '#c4b5fd', label: t('of.lg.any') }], [{ label: t('of.lg.screen') }]);
  const ui = Object.fromEntries(Object.entries({ fs: 'of.fs', fsExit: 'of.fs.exit', close: 'of.close', hint: 'of.hint', reset: 'of.reset', zoomIn: 'of.zoomIn', zoomOut: 'of.zoomOut', runs: 'of.runs', daily: 'of.d.daily', pdaily: 'of.d.pdaily', seats: 'of.d.seats', prompts: 'of.d.prompts', cmp: 'of.d.cmp', machines: 'of.d.machines', up: 'of.d.up', seen: 'of.d.seen', events: 'of.d.events', spent: 'of.spent', saved: 'of.saved', none: 'of.d.none', pname: 'of.prompts' }).map(([k, v]) => [k, t(v)]));
  return { ui, teams, people, free, freeLabel: free ? t('of.free', { n: free }, true) : '', more: Math.max(0, more), moreLabel: more > 0 ? t('of.more', { n: more }, true) : '', closed,
    server: { label: closed ? t('of.server') + ' · ' + t('of.tag.closed') : t('of.server') + ' · ' + t('of.spent') + ' ' + money(totSpent) + ' · ' + t('of.saved') + ' ' + money(totSaved) },
    activity: act, hud: { title: o.orgName + ' ' + t('of.town') + ' · ' + o.rangeLabel, stats, closed: t('of.tag.closed') }, legend,
    aria: t('of.aria', { n: people.length, teams: teams.length, used, limit }, true) };
}
