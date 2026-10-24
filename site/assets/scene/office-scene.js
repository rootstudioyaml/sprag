/* Virtual office: an animated three.js hero for the organization detail screens (site/team and site/ops).
 *
 *   const ctl = mountOfficeScene(container, data, opts);   // ctl = { update(data), destroy() }
 *   const data = officeSceneData({ rows, usage, promptRows, teams, used, limit, orgName, rangeLabel, t, money, rel, ... });
 *
 * One zone per team, one desk per person, AI helper bots, a server kiosk. Chunky pastel animal characters by grade (thirty species from dragon to chick, plus the ghost; see GRADES), a crown on the company's number one, bright cozy daylight, orthographic isometric camera.
 * data (all user-facing strings arrive ready-made, the host owns i18n):
 *   { teams:[{id,name}], people:[{id,name,teamId,teamName,tier:'power'|'active'|'normal'|'low'|'nodata',grade,gradeText,gradeLabel,rank,crown,tag,tierText,tip:[[k,v]],bots:['haiku'|'sonnet'|'opus'|'any'],bubbles:[{text,ai}],promptId,spent}],
 *     free, freeLabel, more, moreLabel, server:{label}, activity:0..1, closed, hud:{title,stats,closed}, legend:[{k:grade|'ghost'|'crown',label}|{c,label}|{label}], book:{title,range,found,tiers,top:{title,rows:[{id,name,k,gname,team,crown,rk}]},rows:[{k,tier,no,name,role,range,n}],note}|null, aria }
 * people[].detail feeds the side drawer (click a person); data.ui holds its strings. opts: { onSeats(id), onPrompts(id), onTeam(id), onServer(), onFail(reason) }
 * The scene keeps its own bright palette in both page themes. three.js is imported lazily the first time the container scrolls into view.
 * The returned handle also carries view, ready(), people(), server() and selectPerson(id) / closeDrawer() for scripted recordings (video/tour).
 * Day/night and Seoul weather come from sky.js (shared with the town): the light, the backdrop and the lawn follow the local clock, warm lamps and
 * glowing screens take over in the evening, rain/snow/fog/storm play outside the walls, and the HUD chip shows the weather. ?tod= and ?wx= override both. */
import { hourOf, blendAnchors, fetchWeather, weatherFromCode, parseOverrides, chipText, injectSkyCss, starsBackground, clampN, WX_CLEAR } from './sky.js';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';   /* the +esm build, so the glTF and Draco loaders below share this one three instance */
const CAST_URL = new URL('./cast/', import.meta.url).href, CAST_DRACO = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/';
export const W_FULL = [0.5, 0.3, 0.2], W_NOPR = [0.625, 0.375, 0];   /* spend, delegation, prompts rank weights (second set: prompt collection off) */
const MAXP = 60, FAMC = { haiku: '#7fe0b8', sonnet: '#8ec5fb', opus: '#f9a8d4' };
const TV = { power: { body: '#a78bfa', scr: '#d8ccff', bri: 1, sp: 15 }, active: { body: '#7cc4f2', scr: '#a8dcff', bri: 1, sp: 9 },
  normal: { body: '#d9cdb8', scr: '#8ea2b8', bri: 0.8, sp: 4.5 }, low: { body: '#f3b9a0', scr: '#4a4658', bri: 1, sp: 0 }, nodata: { body: '#ffffff', scr: '#6b6877', bri: 1, sp: 0 } };

/* Animal set: one table, swap it to change the cast. Parts are spheres ('sph') and cones ('cone'); head parts are relative to the head
 * (it looks toward -z), parts with b:true are relative to the desk. p = position, s = scale (radius), r = rotation about x. */
const P = (g, c, p, s, r = 0, b = false) => ({ g, c, p, s, r, b });
/* eyes carry a small white catchlight up and to the right, which is what makes the faces read as alive at this size */
const eyes = (z, r = 0.045, c = '#2d2323', y = 0.06, dx = 0.12) => [-dx, dx].flatMap(x => [P('sph', c, [x, y, z], [r, r, r]), P('sph', '#ffffff', [x + r * 0.35, y + r * 0.4, z - r * 0.72], [r * 0.36, r * 0.36, r * 0.3])]);
const ears = (c, y, rad, z = -0.02) => [-1, 1].map(k => P('sph', c, [0.25 * k, y, z], [rad, rad, rad * 0.8]));
const SVG = body => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`, dot = (x, y, c = '#2d2323') => `<circle cx="${x}" cy="${y}" r=".85" fill="${c}"/><circle cx="${x + 0.3}" cy="${y - 0.32}" r=".3" fill="#fff"/>`;
/* The cast: one table of species (grades) from best to worst. Everything that sorts a person into a species (the data mapper), the field guide
 * and its range text read this table and nothing else. sr = percentile of the overall score (0 lowest, 1 highest), dlg = delegation share,
 * med = the company's median delegation share. A species needs sr >= minSr (sr > minSr when gt), and needDlg also dlg >= med; the first match
 * wins, so a top scorer with a low delegation share falls through to the next rows. tier is the coarse class the rest of the scene uses. */
/* Thirty species in four tiers (6 power, 9 active, 8 normal, 7 low). The bands narrow toward the top, so the rare species stay rare. */
const G = (k, minSr, tier, x) => ({ k, minSr, tier, ...x }), D = { needDlg: true };
export const GRADES = [
  G('dragon', 0.98, 'power', D), G('unicorn', 0.95, 'power', D), G('lion', 0.92, 'power', D), G('tiger', 0.89, 'power', D), G('eagle', 0.85, 'power', D), G('wolf', 0.8, 'power', D),
  G('cheetah', 0.77, 'active'), G('fox', 0.74, 'active'), G('owl', 0.71, 'active'), G('husky', 0.68, 'active'), G('panda', 0.65, 'active'), G('koala', 0.62, 'active'),
  G('penguin', 0.58, 'active'), G('raccoon', 0.54, 'active'), G('cat', 0.5, 'active'),
  G('dog', 0.47, 'normal'), G('bear', 0.44, 'normal'), G('monkey', 0.41, 'normal'), G('deer', 0.38, 'normal'), G('elephant', 0.35, 'normal'), G('pig', 0.32, 'normal'),
  G('sheep', 0.29, 'normal'), G('rabbit', 0.25, 'normal', { gt: true }),
  G('duck', 0.22, 'low'), G('hedgehog', 0.19, 'low'), G('squirrel', 0.16, 'low'), G('hamster', 0.12, 'low'), G('frog', 0.08, 'low'), G('mouse', 0.04, 'low'), G('chick', -1, 'low')
];
export const GHOST_GRADE = { k: 'ghost', tier: 'nodata' };
export const TIERS = ['power', 'active', 'normal', 'low'];
const SR_EPS = 1e-9, TIER_GRADE = { power: 'lion', active: 'fox', normal: 'bear', low: 'chick', nodata: 'ghost' };
export const gradeIndex = k => GRADES.findIndex(g => g.k === k);
/* idle: no spend (and no prompts) in the period, which is always the last row */
export function gradeOf(sr, dlg, med, idle){
  if(idle) return GRADES[GRADES.length - 1].k;
  const g = GRADES.find(x => (x.gt ? sr > x.minSr + SR_EPS : sr >= x.minSr - SR_EPS) && (!x.needDlg || dlg >= med));
  return (g || GRADES[GRADES.length - 1]).k;
}
export const tierOfGrade = k => (k === 'ghost' ? GHOST_GRADE : GRADES.find(g => g.k === k) || GRADES[GRADES.length - 1]).tier;
/* The numbers behind each row's range text, all derived from GRADES: a..b = "top a to b %", c = bottom share of the last row, d = the power cut ("top d %").
 * rk names the range text: top (first row), fall (the first row without the delegation rule, where top scorers below the median land), last, or band; '.d' adds the delegation rule. */
export function gradeBands(){
  const pct = v => Math.round((1 - v) * 100), pw = Math.min(...GRADES.filter(g => g.needDlg).map(g => g.minSr)), fall = GRADES.findIndex(g => !g.needDlg);
  return GRADES.map((g, i) => {
    const hi = i ? GRADES[i - 1].minSr : 1, a = pct(hi), rk = i === GRADES.length - 1 ? 'last' : i === 0 ? 'top' : i === fall && fall > 0 ? 'fall' : 'band';
    return { k: g.k, no: i + 1, tier: g.tier, needDlg: !!g.needDlg, rk: rk + (g.needDlg ? '.d' : ''), a, b: Math.min(100, pct(g.minSr)), c: 100 - a, d: pct(pw) };
  });
}
const gradeKey = p => (p && (p.grade || TIER_GRADE[p.tier])) || 'ghost';
const ANIMALS = {
  lion: { name: 'lion', icon: SVG('<circle cx="8" cy="8" r="7.2" fill="#e0a23c"/><circle cx="8" cy="8" r="4.8" fill="#f6cf7a"/>' + dot(6.3, 7.6) + dot(9.7, 7.6) + '<ellipse cx="8" cy="10" rx="1.8" ry="1.2" fill="#fff0cf"/>'),
    parts: () => [P('sph', '#e5a63f', [0, 0, 0.14], [0.54, 0.54, 0.24]), ...Array.from({ length: 9 }, (_, k) => P('sph', '#e0a23c', [Math.cos(k / 9 * 6.283) * 0.45, Math.sin(k / 9 * 6.283) * 0.45, 0.02], [0.14, 0.14, 0.14])),
      P('sph', '#f6cf7a', [0, 0, 0], [0.34, 0.34, 0.34]), ...ears('#f6cf7a', 0.3, 0.1), P('sph', '#fff0cf', [0, -0.1, -0.29], [0.15, 0.11, 0.1]), P('sph', '#c0626b', [0, -0.03, -0.39], [0.045, 0.035, 0.035]), ...eyes(-0.31)] },
  tiger: { name: 'tiger', icon: SVG('<polygon points="2.5,2 6.5,4.6 3,8" fill="#f0913a"/><polygon points="13.5,2 9.5,4.6 13,8" fill="#f0913a"/><circle cx="8" cy="9" r="6" fill="#f0913a"/><path d="M6.4 4.4v2M8 4v2.3M9.6 4.4v2M2.7 9h1.5M2.9 11h1.4M13.3 9h-1.5M13.1 11h-1.4" stroke="#3b2a1e" stroke-width="1" stroke-linecap="round"/><ellipse cx="8" cy="11.4" rx="2.6" ry="1.9" fill="#fff6ea"/>' + dot(6, 8.6) + dot(10, 8.6)),
    parts: () => [P('sph', '#f0913a', [0, 0, 0], [0.34, 0.34, 0.34]), ...ears('#f0913a', 0.3, 0.1), ...[-1, 1].map(k => P('sph', '#fff3e0', [0.25 * k, 0.3, -0.06], [0.06, 0.06, 0.04])),
      ...[-0.13, 0, 0.13].map((x, j) => P('sph', '#3b2a1e', [x, 0.27 + (j === 1 ? 0.02 : 0), -0.2], [0.035, 0.1, 0.03])),
      ...[-1, 1].flatMap(k => [P('sph', '#3b2a1e', [0.31 * k, 0.02, -0.12], [0.04, 0.025, 0.1]), P('sph', '#3b2a1e', [0.3 * k, -0.07, -0.12], [0.04, 0.025, 0.09])]),
      P('sph', '#fff3e0', [0, -0.1, -0.3], [0.16, 0.11, 0.1]), P('sph', '#3b2f2f', [0, -0.04, -0.39], [0.045, 0.035, 0.035]), ...eyes(-0.31)] },
  fox: { name: 'fox', icon: SVG('<polygon points="2,1 6.5,5 2.5,8" fill="#f4a261"/><polygon points="14,1 9.5,5 13.5,8" fill="#f4a261"/><circle cx="8" cy="9" r="5.6" fill="#f4a261"/><ellipse cx="8" cy="11.3" rx="3" ry="2.2" fill="#fff3e0"/>' + dot(6, 8.3) + dot(10, 8.3)),
    parts: () => [P('sph', '#f4a261', [0, 0, 0], [0.34, 0.34, 0.34]), ...[-1, 1].flatMap(k => [P('cone', '#f4a261', [0.2 * k, 0.4, 0], [0.13, 0.17, 0.1]), P('cone', '#fff0e0', [0.2 * k, 0.37, -0.05], [0.07, 0.1, 0.06]), P('sph', '#fff3e0', [0.2 * k, -0.1, -0.2], [0.13, 0.11, 0.12])]),
      P('sph', '#fff3e0', [0, -0.1, -0.3], [0.14, 0.1, 0.1]), P('sph', '#3b2f2f', [0, -0.04, -0.39], [0.045, 0.035, 0.035]), ...eyes(-0.31),
      P('sph', '#f4a261', [0.55, 0.8, 0.7], [0.14, 0.14, 0.3], 0, true), P('sph', '#fff3e0', [0.55, 0.8, 1.0], [0.11, 0.11, 0.11], 0, true)] },
  penguin: { name: 'penguin', icon: SVG('<circle cx="8" cy="8.6" r="6.2" fill="#2f3a66"/><ellipse cx="8" cy="9.6" rx="4.1" ry="3.8" fill="#ffffff"/>' + dot(6.2, 8.6) + dot(9.8, 8.6) + '<polygon points="6.9,10.2 9.1,10.2 8,12" fill="#f59e3a"/>'),
    parts: () => [P('sph', '#2f3a66', [0, 0, 0], [0.33, 0.33, 0.33]), P('sph', '#ffffff', [0, -0.04, -0.2], [0.23, 0.21, 0.16]),
      P('cone', '#f59e3a', [0, -0.07, -0.37], [0.06, 0.08, 0.06], -Math.PI / 2), ...eyes(-0.335, 0.04)] },
  bear: { name: 'bear', icon: SVG('<circle cx="3.5" cy="3.5" r="2.4" fill="#c8a98a"/><circle cx="12.5" cy="3.5" r="2.4" fill="#c8a98a"/><circle cx="8" cy="9" r="6" fill="#c8a98a"/><ellipse cx="8" cy="11" rx="2.6" ry="2" fill="#e6d3bd"/>' + dot(6, 8) + dot(10, 8)),
    parts: () => [P('sph', '#c8a98a', [0, 0, 0], [0.35, 0.35, 0.35]), ...ears('#c8a98a', 0.28, 0.13), ...[-1, 1].map(k => P('sph', '#e6d3bd', [0.25 * k, 0.28, -0.08], [0.07, 0.07, 0.05])),
      P('sph', '#e6d3bd', [0, -0.1, -0.3], [0.15, 0.11, 0.1]), P('sph', '#3b2f2f', [0, -0.04, -0.39], [0.05, 0.04, 0.04]), ...eyes(-0.32)] },
  rabbit: { name: 'rabbit', icon: SVG('<ellipse cx="5.6" cy="3.8" rx="1.7" ry="3.6" fill="#fffaf5" stroke="#e8dcd0" stroke-width=".5"/><ellipse cx="10.4" cy="3.8" rx="1.7" ry="3.6" fill="#fffaf5" stroke="#e8dcd0" stroke-width=".5"/><ellipse cx="5.6" cy="4" rx=".8" ry="2.3" fill="#ffc2d4"/><ellipse cx="10.4" cy="4" rx=".8" ry="2.3" fill="#ffc2d4"/><circle cx="8" cy="10" r="5.4" fill="#fffaf5" stroke="#e8dcd0" stroke-width=".5"/>' + dot(6.2, 9.4) + dot(9.8, 9.4) + '<ellipse cx="8" cy="11.3" rx=".9" ry=".7" fill="#ff9ab5"/>'),
    parts: () => [P('sph', '#fffaf5', [0, 0, 0], [0.33, 0.33, 0.33]), ...[-1, 1].flatMap(k => [P('sph', '#fffaf5', [0.15 * k, 0.55, 0], [0.08, 0.27, 0.06]), P('sph', '#ffc2d4', [0.15 * k, 0.54, -0.04], [0.045, 0.2, 0.03]), P('sph', '#ffc2d4', [0.2 * k, -0.06, -0.26], [0.07, 0.05, 0.04])]),
      P('sph', '#fffaf5', [0, -0.1, -0.28], [0.1, 0.07, 0.08]), P('sph', '#ff9ab5', [0, -0.04, -0.34], [0.045, 0.035, 0.035]), ...eyes(-0.3, 0.04)] },
  chick: { name: 'chick', icon: SVG('<circle cx="8" cy="9" r="6" fill="#ffe27a"/><polygon points="6.6,10 9.4,10 8,12.2" fill="#f59e3a"/>' + dot(6, 8) + dot(10, 8)),
    parts: () => [P('sph', '#ffe27a', [0, 0, 0], [0.3, 0.3, 0.3]), P('sph', '#ffe27a', [0, 0.32, 0], [0.07, 0.07, 0.07]), P('sph', '#ffe27a', [-0.08, 0.3, 0.02], [0.06, 0.06, 0.06]), P('sph', '#ffe27a', [0.08, 0.3, 0.02], [0.06, 0.06, 0.06]),
      P('cone', '#f59e3a', [0, -0.04, -0.34], [0.07, 0.09, 0.07], -Math.PI / 2), ...[-1, 1].map(k => P('sph', '#ffb3c7', [0.17 * k, -0.06, -0.24], [0.06, 0.06, 0.05])), ...eyes(-0.27, 0.04)] },
};
/* arms are paws in the species' fur; the torso keeps the tier colour as a shirt */
Object.entries({ lion: '#f6cf7a', tiger: '#f0913a', fox: '#f4a261', penguin: '#2f3a66', bear: '#c8a98a', rabbit: '#fffaf5', chick: '#ffe27a' }).forEach(([k, c]) => { ANIMALS[k].arm = c; });

/* Builder for the other species: a round head with ear, muzzle, nose and cheek presets, plus per-species extras.
 * s: { fur, r (head radius), ear: round|point|small|none, earC, earIn, muz, nose, cheek, eyeC, noEyes, arm, x() head parts, tail() desk parts,
 *      body (torso fur, defaults to arm), icon layers: ixB (behind the head), ix (over the head), ixF (over the face), stroke (outline for pale heads) } */
const EAR = {
  round: (c, i) => [-1, 1].flatMap(k => [P('sph', c, [0.25 * k, 0.28, -0.02], [0.12, 0.12, 0.1]), P('sph', i, [0.25 * k, 0.28, -0.08], [0.065, 0.065, 0.04])]),
  point: (c, i) => [-1, 1].flatMap(k => [P('cone', c, [0.2 * k, 0.4, 0], [0.12, 0.16, 0.1]), P('cone', i, [0.2 * k, 0.37, -0.05], [0.065, 0.09, 0.05])]),
  small: (c, i) => [-1, 1].flatMap(k => [P('sph', c, [0.24 * k, 0.29, 0], [0.08, 0.08, 0.06]), P('sph', i, [0.24 * k, 0.29, -0.04], [0.045, 0.045, 0.03])]),
  none: () => []
};
const ICON_EAR = {
  round: (c, i) => `<circle cx="3.6" cy="4" r="2.3" fill="${c}"/><circle cx="12.4" cy="4" r="2.3" fill="${c}"/><circle cx="3.6" cy="4" r="1.1" fill="${i}"/><circle cx="12.4" cy="4" r="1.1" fill="${i}"/>`,
  point: (c, i) => `<polygon points="2.4,1.4 6.6,5 2.8,8" fill="${c}"/><polygon points="13.6,1.4 9.4,5 13.2,8" fill="${c}"/><polygon points="3.2,3 5.4,5.2 3.4,6.6" fill="${i}"/><polygon points="12.8,3 10.6,5.2 12.6,6.6" fill="${i}"/>`,
  small: c => `<circle cx="4" cy="4.6" r="1.7" fill="${c}"/><circle cx="12" cy="4.6" r="1.7" fill="${c}"/>`,
  none: () => ''
};
function beast(s){
  const r = s.r || 0.34, ear = s.ear || 'round', ec = s.eyeC || '#2d2323', ein = s.earIn || s.muz || s.fur, line = s.stroke ? ' stroke="#e3d6c8" stroke-width=".5"' : '';
  return { arm: s.arm || s.fur, body: s.body || s.arm || s.fur,
    icon: SVG((s.ixB || '') + ICON_EAR[ear](s.earC || s.fur, ein) + `<circle cx="8" cy="9" r="6" fill="${s.fur}"${line}/>` + (s.muz ? `<ellipse cx="8" cy="11.2" rx="2.7" ry="2" fill="${s.muz}"/>` : '') + (s.ix || '')
      + (s.noEyes ? '' : dot(6, 8.4, ec) + dot(10, 8.4, ec)) + (s.nose ? `<ellipse cx="8" cy="10.3" rx=".9" ry=".65" fill="${s.nose}"/>` : '')
      + (s.cheek ? `<circle cx="4.7" cy="11" r=".9" fill="${s.cheek}" opacity=".75"/><circle cx="11.3" cy="11" r=".9" fill="${s.cheek}" opacity=".75"/>` : '') + (s.ixF || '')),
    parts: () => [P('sph', s.fur, [0, 0, 0], [r, r, r]), ...EAR[ear](s.earC || s.fur, ein),
      ...(s.muz ? [P('sph', s.muz, [0, -0.1, -(r - 0.05)], [0.15, 0.11, 0.1])] : []), ...(s.nose ? [P('sph', s.nose, [0, -0.04, -(r + 0.05)], [0.045, 0.035, 0.035])] : []),
      ...(s.cheek ? [-1, 1].map(k => P('sph', s.cheek, [0.2 * k, -0.08, -(r - 0.09)], [0.06, 0.045, 0.04])) : []),
      ...(s.noEyes ? [] : eyes(-(r - 0.03), 0.045, ec)), ...(s.x ? s.x() : []), ...(s.tail ? s.tail() : [])] };
}
const both = f => [-1, 1].flatMap(f), T_ = (c, p, s, r = 0) => P('sph', c, p, s, r, true), TC = (c, p, s, r = 0) => P('cone', c, p, s, r, true);
const whiskers = c => both(k => [P('sph', c, [0.25 * k, -0.08, -0.27], [0.1, 0.007, 0.007]), P('sph', c, [0.25 * k, -0.12, -0.26], [0.1, 0.007, 0.007])]);
Object.assign(ANIMALS, {
  dragon: beast({ fur: '#6fcf8f', ear: 'none', muz: '#c8f2d2', cheek: '#ffb3c7', arm: '#5bbf7d',
    x: () => [...both(k => [P('cone', '#ffd36b', [0.16 * k, 0.4, 0.06], [0.075, 0.18, 0.075], 0.45), P('sph', '#2f6b45', [0.05 * k, -0.07, -0.395], [0.018, 0.018, 0.012])]),
      P('cone', '#ffb347', [0, 0.3, 0.2], [0.05, 0.08, 0.05], 0.9), P('cone', '#ffb347', [0, 0.13, 0.32], [0.05, 0.08, 0.05], 1.4), P('cone', '#ffb347', [0, -0.06, 0.34], [0.045, 0.07, 0.045], 1.8)],
    tail: () => [...both(k => [T_('#3f9e63', [0.46 * k, 1.52, 0.6], [0.06, 0.36, 0.3], 0.35), T_('#a8e8bc', [0.5 * k, 1.47, 0.62], [0.03, 0.28, 0.23], 0.35)]),
      TC('#ffb347', [0, 1.55, 0.56], [0.06, 0.11, 0.06], 1.1), TC('#ffb347', [0, 1.37, 0.6], [0.06, 0.11, 0.06], 1.3), T_('#6fcf8f', [0.55, 0.78, 0.85], [0.13, 0.13, 0.26]), TC('#ffb347', [0.55, 0.78, 1.17], [0.08, 0.1, 0.06], Math.PI / 2)],
    ixB: '<polygon points="4.2,0.8 6.6,4.6 3.8,4.9" fill="#ffd36b"/><polygon points="11.8,0.8 9.4,4.6 12.2,4.9" fill="#ffd36b"/>', ixF: '<circle cx="7.3" cy="11" r=".4" fill="#2f6b45"/><circle cx="8.7" cy="11" r=".4" fill="#2f6b45"/>' }),
  unicorn: beast({ fur: '#fffaff', ear: 'point', earIn: '#ffc6df', muz: '#ffeef6', nose: '#ffa8c8', cheek: '#ffb3d1', arm: '#fbf2fa', stroke: true,
    x: () => [P('cone', '#ffd36b', [0, 0.46, -0.17], [0.065, 0.22, 0.065], -0.45), P('sph', '#ffb3d9', [0, 0.3, 0.12], [0.12, 0.12, 0.12]), P('sph', '#b8d8ff', [0.02, 0.17, 0.27], [0.11, 0.11, 0.11]),
      P('sph', '#d4c2ff', [0, 0, 0.32], [0.1, 0.1, 0.1]), P('sph', '#fff1a8', [0.03, 0.34, -0.06], [0.08, 0.08, 0.08])],
    tail: () => [T_('#ffb3d9', [0, 1.48, 0.56], [0.13, 0.14, 0.1]), T_('#b8d8ff', [0, 1.32, 0.6], [0.11, 0.12, 0.09]), T_('#ffb3d9', [0.55, 0.8, 0.78], [0.11, 0.11, 0.18]), T_('#b8d8ff', [0.55, 0.72, 0.98], [0.1, 0.1, 0.16]), T_('#d4c2ff', [0.55, 0.62, 1.14], [0.08, 0.08, 0.12])],
    ix: '<circle cx="11.6" cy="4.4" r="2" fill="#ffb3d9"/><circle cx="13.4" cy="6.9" r="1.6" fill="#b8d8ff"/><circle cx="13.6" cy="9.6" r="1.3" fill="#d4c2ff"/>', ixF: '<polygon points="7,4.2 9,4.2 8,0.3" fill="#ffd36b"/>' }),
  eagle: beast({ fur: '#ffffff', ear: 'none', arm: '#7a5235', body: '#7a5235', eyeC: '#3a2a14', stroke: true,
    x: () => [P('cone', '#ffc23d', [0, -0.07, -0.37], [0.075, 0.12, 0.07], -Math.PI / 2), P('sph', '#e8a21a', [0, -0.12, -0.45], [0.035, 0.04, 0.03]),
      ...both(k => [P('sph', '#e9e4da', [0.12 * k, 0.13, -0.29], [0.08, 0.03, 0.04])]), P('sph', '#7a5235', [0, -0.3, 0.02], [0.3, 0.12, 0.28])],
    tail: () => [...both(k => [T_('#7a5235', [0.44 * k, 1.35, 0.55], [0.06, 0.26, 0.2], 0.2)]), T_('#ffffff', [0.5, 0.85, 0.82], [0.16, 0.05, 0.24])],
    ixF: '<path d="M4.6 7.2l2.4.6M11.4 7.2 9 7.8" stroke="#b9ad98" stroke-width=".8" stroke-linecap="round"/><polygon points="6.4,9.8 9.6,9.8 8.4,13 7.6,12.4" fill="#ffc23d"/>' }),
  wolf: beast({ fur: '#8e98a9', ear: 'point', earIn: '#e9edf2', muz: '#eef1f5', nose: '#2f2f38',
    x: () => [...both(k => [P('sph', '#eef1f5', [0.27 * k, -0.12, -0.08], [0.12, 0.1, 0.12])]), P('sph', '#6d7687', [0, 0.22, -0.24], [0.1, 0.06, 0.06])],
    tail: () => [T_('#8e98a9', [0.55, 0.8, 0.75], [0.14, 0.14, 0.3]), T_('#eef1f5', [0.55, 0.8, 1.05], [0.1, 0.1, 0.1])],
    ix: '<polygon points="1.8,10.5 4,8 4.6,12.6" fill="#eef1f5"/><polygon points="14.2,10.5 12,8 11.4,12.6" fill="#eef1f5"/>' }),
  cheetah: beast({ fur: '#f3c46c', ear: 'small', muz: '#fff6e2', nose: '#3b2a1e',
    x: () => [...[[0.16, 0.22, -0.22], [-0.18, 0.2, -0.22], [0.02, 0.3, -0.14], [0.27, 0.06, -0.16], [-0.27, 0.05, -0.16], [0.1, 0.3, 0.05], [-0.12, 0.28, 0.1], [0, 0.15, 0.3], [0.25, 0.12, 0.2], [-0.24, 0.15, 0.18]]
      .map(p => P('sph', '#4a3324', p, [0.035, 0.035, 0.025])), ...both(k => [P('sph', '#3b2a1e', [0.13 * k, -0.06, -0.31], [0.018, 0.07, 0.02])])],
    tail: () => [T_('#f3c46c', [0.55, 0.78, 0.85], [0.08, 0.08, 0.3]), T_('#3b2a1e', [0.55, 0.78, 1.12], [0.07, 0.07, 0.07])],
    ix: '<circle cx="5" cy="5.6" r=".6" fill="#4a3324"/><circle cx="10.8" cy="5.2" r=".6" fill="#4a3324"/><circle cx="8" cy="4.4" r=".5" fill="#4a3324"/><circle cx="3.4" cy="9" r=".5" fill="#4a3324"/><circle cx="12.6" cy="9" r=".5" fill="#4a3324"/>',
    ixF: '<path d="M5.7 9.4l.4 2M10.3 9.4l-.4 2" stroke="#3b2a1e" stroke-width=".75" stroke-linecap="round"/>' }),
  owl: beast({ fur: '#a5806a', ear: 'none', arm: '#8f6b55', noEyes: true,
    x: () => [...both(k => [P('cone', '#8f6b55', [0.2 * k, 0.37, 0], [0.07, 0.12, 0.06]), P('sph', '#f1e3cf', [0.12 * k, 0.02, -0.22], [0.14, 0.15, 0.12]),
      P('sph', '#ffd35c', [0.12 * k, 0.03, -0.32], [0.075, 0.075, 0.04]), P('sph', '#2d2323', [0.12 * k, 0.03, -0.35], [0.045, 0.045, 0.03]), P('sph', '#ffffff', [0.12 * k + 0.018, 0.052, -0.377], [0.016, 0.016, 0.012])]),
      P('cone', '#f2a33a', [0, -0.09, -0.35], [0.045, 0.07, 0.04], -2.4)],
    ixB: '<polygon points="3,1.6 6,4.4 3.4,5.6" fill="#8f6b55"/><polygon points="13,1.6 10,4.4 12.6,5.6" fill="#8f6b55"/>',
    ixF: '<circle cx="5.9" cy="8.6" r="2.4" fill="#f1e3cf"/><circle cx="10.1" cy="8.6" r="2.4" fill="#f1e3cf"/><circle cx="5.9" cy="8.6" r="1.5" fill="#ffd35c"/><circle cx="10.1" cy="8.6" r="1.5" fill="#ffd35c"/>' + dot(5.9, 8.6) + dot(10.1, 8.6) + '<polygon points="7.2,10.4 8.8,10.4 8,12.2" fill="#f2a33a"/>' }),
  husky: beast({ fur: '#6f7b8e', ear: 'point', earIn: '#f4f6fa', nose: '#2a2a30', eyeC: '#2f7fc4',
    x: () => [P('sph', '#f4f6fa', [0, -0.07, -0.13], [0.27, 0.22, 0.2]), P('sph', '#ffffff', [0, -0.11, -0.3], [0.14, 0.1, 0.1]), ...both(k => [P('sph', '#ffffff', [0.12 * k, 0.15, -0.28], [0.05, 0.03, 0.03])])],
    tail: () => [T_('#6f7b8e', [0.5, 1.05, 0.85], [0.12, 0.2, 0.12], 0.6), T_('#f4f6fa', [0.5, 1.22, 0.78], [0.08, 0.08, 0.08])],
    ix: '<path d="M3 10c1.5-2.6 3-2.2 5 0 2-2.2 3.5-2.6 5 0-.8 3-2.8 4.7-5 4.7S3.8 13 3 10z" fill="#f4f6fa"/>' }),
  panda: beast({ fur: '#ffffff', earC: '#2d2d33', earIn: '#2d2d33', muz: '#ffffff', nose: '#2d2d33', arm: '#2d2d33', body: '#f4f4f6', eyeC: '#141418', stroke: true,
    x: () => both(k => [P('sph', '#2d2d33', [0.12 * k, 0.05, -0.28], [0.075, 0.095, 0.05])]),
    ix: '<ellipse cx="5.9" cy="8.6" rx="1.7" ry="2.1" fill="#2d2d33" transform="rotate(25 5.9 8.6)"/><ellipse cx="10.1" cy="8.6" rx="1.7" ry="2.1" fill="#2d2d33" transform="rotate(-25 10.1 8.6)"/>' }),
  koala: beast({ fur: '#a9aeb8', ear: 'none',
    x: () => [...both(k => [P('sph', '#a9aeb8', [0.3 * k, 0.22, 0], [0.17, 0.17, 0.12]), P('sph', '#eef0f4', [0.3 * k, 0.22, -0.06], [0.1, 0.1, 0.06])]), P('sph', '#3b3b46', [0, -0.06, -0.35], [0.07, 0.095, 0.06])],
    ixB: '<circle cx="3" cy="5" r="3" fill="#a9aeb8"/><circle cx="13" cy="5" r="3" fill="#a9aeb8"/><circle cx="3" cy="5" r="1.7" fill="#eef0f4"/><circle cx="13" cy="5" r="1.7" fill="#eef0f4"/>',
    ixF: '<ellipse cx="8" cy="10.6" rx="1.4" ry="1.9" fill="#3b3b46"/>' }),
  raccoon: beast({ fur: '#a3a3ad', ear: 'small', earIn: '#ffffff', muz: '#ffffff', nose: '#2d2d33', arm: '#7c7c88',
    x: () => [P('sph', '#3e3e48', [0, 0.05, -0.25], [0.25, 0.075, 0.08]), ...both(k => [P('sph', '#ffffff', [0.12 * k, 0.15, -0.29], [0.075, 0.03, 0.03])])],
    tail: () => [0, 1, 2, 3].map(j => T_(j % 2 ? '#3e3e48' : '#a3a3ad', [0.55, 0.8, 0.68 + j * 0.13], [0.12 - j * 0.01, 0.12 - j * 0.01, 0.09])),
    ix: '<rect x="2.6" y="7" width="10.8" height="3" rx="1.5" fill="#3e3e48"/><path d="M4.6 6l2.4.3M11.4 6 9 6.3" stroke="#fff" stroke-width=".8" stroke-linecap="round"/>' }),
  cat: beast({ fur: '#bdb6c4', ear: 'point', earIn: '#ffc2d4', muz: '#f5f1f7', nose: '#ff9ab5', cheek: '#ffc2d4',
    x: () => [...[-0.09, 0, 0.09].map((x, j) => P('sph', '#8e86a0', [x, 0.24 + (j === 1 ? 0.03 : 0), -0.24], [0.025, 0.07, 0.025])), ...whiskers('#ffffff')],
    tail: () => [T_('#bdb6c4', [0.55, 0.75, 0.8], [0.07, 0.07, 0.26], -0.5), T_('#8e86a0', [0.55, 0.92, 1.02], [0.07, 0.07, 0.07])],
    ix: '<path d="M6.8 4.2v1.6M8 3.8v2M9.2 4.2v1.6" stroke="#8e86a0" stroke-width=".8" stroke-linecap="round"/>' }),
  dog: beast({ fur: '#eab86e', ear: 'none', muz: '#fff1d6', nose: '#2d2323',
    x: () => [...both(k => [P('sph', '#c98f45', [0.31 * k, 0.06, 0], [0.09, 0.2, 0.13])]), P('sph', '#ff8fa3', [0, -0.2, -0.33], [0.045, 0.055, 0.025])],
    tail: () => [T_('#eab86e', [0.55, 0.95, 0.82], [0.08, 0.2, 0.08], 0.7)],
    ix: '<ellipse cx="2.9" cy="8.6" rx="1.8" ry="3.6" fill="#c98f45"/><ellipse cx="13.1" cy="8.6" rx="1.8" ry="3.6" fill="#c98f45"/>', ixF: '<ellipse cx="8" cy="12.9" rx=".9" ry="1.1" fill="#ff8fa3"/>' }),
  monkey: beast({ fur: '#9a6a49', ear: 'none', noEyes: true,
    x: () => [P('sph', '#f3d4b3', [0, -0.03, -0.17], [0.24, 0.22, 0.18]), ...eyes(-0.355), ...both(k => [P('sph', '#9a6a49', [0.33 * k, 0.02, 0], [0.1, 0.1, 0.07]), P('sph', '#f3d4b3', [0.33 * k, 0.02, -0.04], [0.06, 0.06, 0.04]),
      P('sph', '#7a4f35', [0.03 * k, -0.08, -0.36], [0.015, 0.015, 0.01])]), P('sph', '#7a4f35', [0, -0.15, -0.34], [0.06, 0.012, 0.012]), P('sph', '#9a6a49', [0, 0.33, -0.05], [0.06, 0.08, 0.06])],
    tail: () => [T_('#9a6a49', [0.55, 0.9, 0.85], [0.05, 0.25, 0.05], 0.4), T_('#9a6a49', [0.55, 1.13, 0.75], [0.07, 0.07, 0.07])],
    ixB: '<circle cx="1.9" cy="9" r="1.8" fill="#9a6a49"/><circle cx="14.1" cy="9" r="1.8" fill="#9a6a49"/><circle cx="1.9" cy="9" r=".9" fill="#f3d4b3"/><circle cx="14.1" cy="9" r=".9" fill="#f3d4b3"/>',
    ix: '<path d="M8 6.3c1-1.4 3.6-1.2 3.9.9.3 1.6-.4 2.2-.4 3 .5 2-1.4 3.6-3.5 3.6S4 12.2 4.5 10.2c0-.8-.7-1.4-.4-3C4.4 5.1 7 4.9 8 6.3z" fill="#f3d4b3"/>' + dot(6.3, 8.6) + dot(9.7, 8.6) + '<path d="M7 12h2" stroke="#7a4f35" stroke-width=".6" stroke-linecap="round"/>' }),
  deer: beast({ fur: '#c98d58', ear: 'none', muz: '#f3dfc6', nose: '#2d2323',
    x: () => [...both(k => [P('sph', '#c98d58', [0.31 * k, 0.2, 0.02], [0.11, 0.06, 0.05]), P('sph', '#f3dfc6', [0.31 * k, 0.2, -0.01], [0.07, 0.035, 0.03]),
      P('cone', '#8b6441', [0.13 * k, 0.44, 0.04], [0.03, 0.14, 0.03]), P('cone', '#8b6441', [0.21 * k, 0.48, 0.02], [0.025, 0.1, 0.025]), P('sph', '#8b6441', [0.17 * k, 0.4, 0.03], [0.045, 0.03, 0.03])]),
      ...[[0.1, 0.26, 0.1], [-0.12, 0.23, 0.15], [0, 0.12, 0.3]].map(p => P('sph', '#fff6ea', p, [0.035, 0.035, 0.025]))],
    tail: () => [T_('#ffffff', [0.5, 0.75, 0.82], [0.07, 0.08, 0.07])],
    ixB: '<path d="M5.2 4.4 4 1M4.5 2.6 2.4 1.8M10.8 4.4 12 1M11.5 2.6l2.1-.8" stroke="#8b6441" stroke-width="1.1" stroke-linecap="round"/><ellipse cx="2.4" cy="6.4" rx="2" ry="1.1" fill="#c98d58"/><ellipse cx="13.6" cy="6.4" rx="2" ry="1.1" fill="#c98d58"/>' }),
  elephant: beast({ fur: '#aab6ca', ear: 'none',
    x: () => [...both(k => [P('sph', '#aab6ca', [0.36 * k, 0.02, 0.05], [0.22, 0.25, 0.06]), P('sph', '#f2c4d2', [0.36 * k, 0.02, 0.01], [0.14, 0.17, 0.03]), P('cone', '#fffaf0', [0.12 * k, -0.2, -0.3], [0.03, 0.06, 0.03], -2.4)]),
      P('sph', '#aab6ca', [0, -0.1, -0.34], [0.085, 0.09, 0.08]), P('sph', '#aab6ca', [0, -0.22, -0.39], [0.07, 0.1, 0.065]), P('sph', '#9aa6ba', [0, -0.32, -0.42], [0.06, 0.04, 0.055])],
    tail: () => [T_('#aab6ca', [0.5, 0.75, 0.85], [0.03, 0.03, 0.16])],
    ixB: '<circle cx="2.6" cy="8.4" r="3" fill="#aab6ca"/><circle cx="13.4" cy="8.4" r="3" fill="#aab6ca"/><circle cx="2.6" cy="8.4" r="1.8" fill="#f2c4d2"/><circle cx="13.4" cy="8.4" r="1.8" fill="#f2c4d2"/>',
    ixF: '<path d="M8 10v3.4c0 .9.9 1.3 1.6.6" stroke="#8d9ab0" stroke-width="2" fill="none" stroke-linecap="round"/>' }),
  pig: beast({ fur: '#ffbccb', ear: 'small', earC: '#ffbccb', earIn: '#ff9fb4', cheek: '#ff9fb4',
    x: () => [...both(k => [P('cone', '#ffaabd', [0.25 * k, 0.33, -0.04], [0.08, 0.08, 0.06], -0.7)]), P('sph', '#ff9fb4', [0, -0.08, -0.35], [0.12, 0.09, 0.06]), ...both(k => [P('sph', '#c75c78', [0.04 * k, -0.08, -0.405], [0.02, 0.03, 0.01])])],
    tail: () => [T_('#ffbccb', [0.45, 0.85, 0.88], [0.05, 0.05, 0.05]), T_('#ffbccb', [0.45, 0.92, 0.93], [0.04, 0.04, 0.04]), T_('#ffbccb', [0.45, 0.88, 0.99], [0.035, 0.035, 0.035])],
    ixF: '<ellipse cx="8" cy="11.2" rx="2.2" ry="1.5" fill="#ff9fb4"/><circle cx="7.2" cy="11.2" r=".45" fill="#c75c78"/><circle cx="8.8" cy="11.2" r=".45" fill="#c75c78"/>' }),
  sheep: beast({ fur: '#f6ece0', r: 0.3, ear: 'none', nose: '#b07a80', cheek: '#ffc2d4', arm: '#fffdf8',
    x: () => [...[[0, 0.3, 0], [0.17, 0.27, 0.02], [-0.17, 0.27, 0.02], [0.09, 0.33, 0.12], [-0.09, 0.33, 0.12], [0, 0.25, 0.22], [0.25, 0.12, 0.12], [-0.25, 0.12, 0.12], [0, 0.08, 0.3], [0.2, 0, 0.22], [-0.2, 0, 0.22]]
      .map(p => P('sph', '#fffdf8', p, [0.13, 0.13, 0.13])), ...both(k => [P('sph', '#e6d5c3', [0.33 * k, 0.03, 0], [0.12, 0.05, 0.07])])],
    ixB: [[3.6, 4.6], [8, 3], [12.4, 4.6], [2.4, 8], [13.6, 8]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="#fffdf8" stroke="#e3d6c8" stroke-width=".5"/>`).join('') }),
  duck: beast({ fur: '#ffffff', ear: 'none', cheek: '#ffc2d4', stroke: true,
    x: () => [P('sph', '#ff9f40', [0, -0.08, -0.34], [0.14, 0.045, 0.11]), P('sph', '#ffffff', [0, 0.36, 0.02], [0.05, 0.08, 0.05], 0.4)],
    tail: () => [TC('#ffffff', [0.45, 0.8, 0.85], [0.08, 0.12, 0.06], 1.2)],
    ixF: '<ellipse cx="8" cy="11" rx="2.6" ry="1.1" fill="#ff9f40"/>' }),
  hedgehog: beast({ fur: '#f2dcc3', ear: 'small', earC: '#e4c6a4', earIn: '#ffc2d4', nose: '#2d2323', cheek: '#ffb3c7', body: '#a07f62',
    x: () => [P('sph', '#a07f62', [0, 0.05, 0.08], [0.33, 0.33, 0.3]), ...[[0, 0.32, 0.05, 0.2], [0.18, 0.27, 0.08, 0.4], [-0.18, 0.27, 0.08, 0.4], [0, 0.22, 0.24, 0.9], [0.2, 0.15, 0.22, 0.9], [-0.2, 0.15, 0.22, 0.9],
      [0.3, 0.05, 0.1, 0.6], [-0.3, 0.05, 0.1, 0.6], [0, 0.02, 0.33, 1.4], [0.18, -0.05, 0.28, 1.4], [-0.18, -0.05, 0.28, 1.4]].map(([x, y, z, r]) => P('cone', '#8a6a52', [x, y, z], [0.07, 0.12, 0.07], r))],
    ixB: '<path d="M2 9 .8 5.5l2.8.5-.1-3.4L6 4.4 8 1.2l2 3.2 2.5-1.8-.1 3.4 2.8-.5L14 9z" fill="#8a6a52"/>' }),
  squirrel: beast({ fur: '#d9894d', ear: 'point', earIn: '#fff1de', muz: '#fff1de', nose: '#3b2a1e', cheek: '#ffb3a0',
    x: () => both(k => [P('sph', '#b86a34', [0.2 * k, 0.55, 0], [0.03, 0.05, 0.03])]),
    tail: () => [T_('#d9894d', [0.5, 1.0, 0.88], [0.17, 0.4, 0.17], 0.25), T_('#fff1de', [0.5, 1.32, 0.8], [0.09, 0.1, 0.09])],
    ixB: '<ellipse cx="13.4" cy="9" rx="2.6" ry="5.8" fill="#c97a40"/>' }),
  hamster: beast({ fur: '#f3c18c', ear: 'small', earIn: '#ffc2d4', nose: '#ff9ab5', cheek: '#ffb3c7',
    x: () => [P('sph', '#fff7ec', [0, -0.1, -0.12], [0.3, 0.22, 0.25]), ...both(k => [P('sph', '#fff7ec', [0.22 * k, -0.1, -0.17], [0.14, 0.12, 0.13])]), P('sph', '#c98a6a', [0, -0.11, -0.36], [0.025, 0.012, 0.01])],
    ix: '<ellipse cx="8" cy="11.6" rx="5.2" ry="3.2" fill="#fff7ec"/>' }),
  frog: beast({ fur: '#8fd46e', ear: 'none', cheek: '#ffb3c7', arm: '#7cc65a', noEyes: true,
    x: () => [P('sph', '#d8f2b8', [0, -0.14, -0.2], [0.22, 0.12, 0.15]), P('sph', '#4f9a3a', [0, -0.06, -0.335], [0.16, 0.012, 0.02]),
      ...both(k => [P('sph', '#8fd46e', [0.15 * k, 0.24, -0.12], [0.12, 0.12, 0.12]), P('sph', '#ffffff', [0.15 * k, 0.26, -0.2], [0.07, 0.07, 0.05]), P('sph', '#2d2323', [0.15 * k, 0.26, -0.245], [0.04, 0.04, 0.025]),
        P('sph', '#ffffff', [0.15 * k + 0.014, 0.278, -0.27], [0.014, 0.014, 0.01])])],
    ixB: '<circle cx="4.6" cy="5" r="2.7" fill="#8fd46e"/><circle cx="11.4" cy="5" r="2.7" fill="#8fd46e"/>',
    ixF: '<circle cx="4.6" cy="5" r="1.6" fill="#fff"/><circle cx="11.4" cy="5" r="1.6" fill="#fff"/>' + dot(4.6, 5.1) + dot(11.4, 5.1) + '<path d="M5.4 10.6q2.6 1.8 5.2 0" stroke="#4f9a3a" stroke-width=".7" fill="none" stroke-linecap="round"/>' }),
  mouse: beast({ fur: '#c9c4cf', ear: 'none', muz: '#f3f0f5', nose: '#ff9ab5', cheek: '#ffc2d4',
    x: () => [...both(k => [P('sph', '#c9c4cf', [0.27 * k, 0.3, 0], [0.16, 0.16, 0.07]), P('sph', '#ffc2d4', [0.27 * k, 0.3, -0.04], [0.1, 0.1, 0.04])]), ...whiskers('#8a8494')],
    tail: () => [T_('#ffb3c7', [0.5, 0.7, 0.95], [0.025, 0.025, 0.3], 0.3)],
    ixB: '<circle cx="3.4" cy="4" r="3" fill="#c9c4cf"/><circle cx="12.6" cy="4" r="3" fill="#c9c4cf"/><circle cx="3.4" cy="4" r="1.8" fill="#ffc2d4"/><circle cx="12.6" cy="4" r="1.8" fill="#ffc2d4"/>' })
});
/* the crown sits on the company's number one for the period; crownY lifts it over horns and tall ears */
const CROWN_Y = { dragon: 0.46, unicorn: 0.46, deer: 0.5, rabbit: 0.42, owl: 0.42, sheep: 0.44, mouse: 0.42, koala: 0.4 };
const crownParts = k => { const y = CROWN_Y[k] || 0.37;
  return [P('sph', '#ffcf3f', [0, y, 0.02], [0.16, 0.04, 0.16]), ...[-0.1, 0, 0.1].map(x => P('cone', '#ffcf3f', [x, y + (x ? 0.06 : 0.08), 0.02], [0.04, x ? 0.06 : 0.08, 0.04])),
    P('sph', '#ff5d7a', [0, y + 0.01, -0.14], [0.03, 0.03, 0.02]), ...[-1, 1].map(k2 => P('sph', '#7fd3ff', [0.11 * k2, y + 0.01, -0.11], [0.022, 0.022, 0.016]))]; };
/* read-only access for tests: the parts and icon of a species */
export const speciesArt = k => ANIMALS[k] || null;
const CROWN_ICON = SVG('<path d="M2 12.5 1.2 4.6l3.9 3.2L8 2.4l2.9 5.4 3.9-3.2-.8 7.9z" fill="#ffcf3f" stroke="#d99a1a" stroke-width=".6" stroke-linejoin="round"/><circle cx="8" cy="10" r="1.1" fill="#ff5d7a"/>');
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
const HS = 1.3, HEAD_Y = 1.84;   /* heads are drawn 1.3 times bigger than the body (chibi proportions), so ears, horns and manes stay readable at the default zoom */
const BOT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2v2" stroke="#8b7cf0" stroke-width="1.2" stroke-linecap="round"/><circle cx="8" cy="2" r="1.1" fill="#8b7cf0"/><circle cx="8" cy="9.4" r="5.4" fill="#c4b5fd"/><circle cx="6.1" cy="9" r="1" fill="#fff"/><circle cx="9.9" cy="9" r="1" fill="#fff"/></svg>';
const BOOK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.2c2-.8 3.9-.6 5.5.6v9c-1.6-1.2-3.5-1.4-5.5-.6zM13.5 3.2c-2-.8-3.9-.6-5.5.6v9c1.6-1.2 3.5-1.4 5.5-.6z"/></svg>';
const iconSvg = k => (k === 'crown' ? CROWN_ICON : (k === 'ghost' ? GHOST : ANIMALS[k] || { icon: '' }).icon);

export const OF_CSS = `
.of-card{padding:0!important;overflow:hidden;margin-bottom:var(--s4,16px)}
.of-stage{position:relative;height:520px;overflow:hidden;contain:layout paint;background:radial-gradient(ellipse at 50% 35%,#fffaf0 0,#f6ead2 80%);color:#6a5a4a}
.of-stage canvas{display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab}
.of-stage canvas.drag{cursor:grabbing}.of-stage canvas.hit{cursor:pointer}
.of-hud{position:absolute;left:16px;top:12px;right:16px;pointer-events:none;font-size:12px;line-height:1.45;z-index:2;color:#6a5a4a}
.of-hud b{display:block;font-size:15px;font-weight:600;color:#3a2f27;letter-spacing:-.01em}
.of-hud em{font-style:normal;margin-left:8px;font-size:11px;font-weight:600;color:#b4443f;border:1px solid currentColor;border-radius:999px;padding:1px 8px;vertical-align:2px;background:#fff}
.of-legend{position:absolute;left:12px;right:auto;max-width:calc(100% - 24px);bottom:8px;display:flex;flex-direction:column;align-items:flex-start;background:rgba(255,248,235,.85);border-radius:12px;padding:4px 10px;flex-wrap:wrap;gap:2px 16px;font-size:11.5px;line-height:1.5;color:#6a5a4a;pointer-events:none;z-index:2}
.of-legend:empty{display:none}
.of-legend .keys{display:flex;flex-wrap:wrap;gap:2px 14px}.of-legend .keys .fm{margin:0 3px 0 8px}
.of-strip{pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;gap:3px 12px;font:inherit;color:inherit;background:none;border:0;padding:2px 0 4px;margin:0;cursor:pointer;text-align:left;border-bottom:1px dashed rgba(120,90,60,.22)}
.of-strip:hover b,.of-strip:focus-visible b{color:#6d28d9}.of-strip b{font-weight:600;color:#3a2f27;white-space:nowrap}.of-strip b svg{width:14px;height:14px;margin-right:4px;vertical-align:-2px}
.of-strip .tg{display:inline-flex;align-items:center;gap:1px;white-space:nowrap}.of-strip .tg em{font-style:normal;font-weight:600;font-size:10.5px;margin-right:4px}
.of-strip .t-power em{color:#b7791f}.of-strip .t-active em{color:#1d6fb8}.of-strip .t-normal em{color:#7a6c58}.of-strip .t-low em{color:#c2410c}
.of-strip .sp svg{width:17px;height:17px;margin:0;vertical-align:-4px}.of-strip .sp.z svg{filter:grayscale(1);opacity:.32}
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
/* field guide */
.of-drawer .bkn{margin:0 0 10px;font-size:12px;color:#6a5a4a}
.of-drawer .bkr{display:grid;grid-template-columns:28px 1fr auto;grid-template-areas:'i n c' 'i r r';gap:1px 10px;align-items:center;width:100%;text-align:left;font:inherit;color:#3a2f27;background:#f7f1e4;border:1px solid transparent;border-radius:12px;padding:8px 10px;margin:0 0 6px;cursor:pointer}
.of-drawer .bkr:hover,.of-drawer .bkr:focus-visible{border-color:#8b7cf0}
.of-drawer .bkr svg{grid-area:i;width:26px;height:26px}.of-drawer .bkr .nm{grid-area:n;font-weight:600;font-size:13px}.of-drawer .bkr .nm small{font-weight:400;font-size:11.5px;color:#6a5a4a;margin-left:6px}
.of-drawer .bkr .rg{grid-area:r;font-size:11.5px;color:#6a5a4a}.of-drawer .bkr .ct2{grid-area:c;font-weight:600;font-variant-numeric:tabular-nums;font-size:13px}
.of-drawer .bkr.z{opacity:.5}.of-drawer .bkr.z svg{filter:grayscale(1) brightness(.6) contrast(.6)}
.of-drawer .bkr .no{display:inline-block;min-width:40px;margin:0 6px 0 0;font-weight:600;font-size:11px;color:#8b7cf0;font-variant-numeric:tabular-nums}
.of-drawer .bkh{margin:14px 0 6px;font-size:11.5px;color:#3a2f27}
.of-drawer .bkt{margin:0 0 6px;padding:8px 10px 4px;border-radius:12px;background:linear-gradient(135deg,#fff4d6,#f1ebff)}.of-drawer .bkt h4{margin:0 0 6px;font-size:11.5px;color:#3a2f27}
.of-drawer .bkp{display:grid;grid-template-columns:30px 24px 1fr auto;align-items:center;gap:8px;width:100%;text-align:left;font:inherit;color:#3a2f27;background:rgba(255,255,255,.7);border:1px solid transparent;border-radius:10px;padding:5px 8px;margin:0 0 4px;cursor:pointer}
.of-drawer .bkp:hover,.of-drawer .bkp:focus-visible{border-color:#8b7cf0}.of-drawer .bkp svg{width:22px;height:22px}.of-drawer .bkp .rk{font-weight:700;font-size:12.5px;font-variant-numeric:tabular-nums;color:#6d28d9}
.of-drawer .bkp .nm{min-width:0;font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.of-drawer .bkp .nm small{display:block;font-weight:400;font-size:11px;color:#6a5a4a}
.of-drawer .nx{margin:-4px 0 12px;padding:8px 10px;border-radius:10px;background:#fff4d6;color:#5a3d0a;font-size:12px}.of-drawer .nx .h{font-weight:600}
.of-drawer .hd b svg{width:16px;height:16px;margin-right:4px;vertical-align:-2px}
.of-drawer .bknote{margin:12px 0 0;padding:8px 10px;border-radius:10px;background:#f1ebff;color:#3b2a78;font-size:12px}
.of-drawer .grp{margin:0 0 14px}.of-drawer .grp+.grp{margin-top:18px;padding-top:12px;border-top:1px dashed rgba(120,90,60,.22)}.of-drawer .grp>h4{margin:0 0 6px;font-size:11.5px;color:#3a2f27}
@media (prefers-reduced-motion:reduce){.of-drawer,.of-drawer.open,.of-fs{transition:none}}
@media (max-width:640px){.of-legend .keys,.of-strip .tg em,.of-strip b{display:none}.of-strip .sp svg{width:12px;height:12px}.of-tb{width:28px;height:28px}.of-tools{gap:4px}.of-stage{height:300px}.of-hud{left:12px;right:150px;top:8px;font-size:11px}.of-hud b{font-size:13px}.of-legend{left:8px;bottom:6px;font-size:10px;gap:0 10px;padding:3px 8px;max-width:calc(100% - 16px)}.of-btn,.of-lbl{font-size:11px;padding:4px 8px}}
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
 * and the slide-in drawer (bottom sheet on phones). o: { ui: () => ({fs, fsExit, close, book}), request(), onClose(), onAction(name), onBook() (optional: adds the field-guide button) }. */
export function makeChrome(stage, container, o){
  const drawer = document.createElement('aside'); drawer.className = 'of-drawer'; drawer.setAttribute('aria-hidden', 'true'); stage.appendChild(drawer);
  const tools = document.createElement('div'); tools.className = 'of-tools'; stage.appendChild(tools);
  const mkBtn = (cls, html, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'of-tb ' + cls; b.innerHTML = html; b.addEventListener('click', fn); tools.appendChild(b); return b; };
  const RESET = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.8-4.1M2.5 2.5v3.2h3.2"/></svg>';
  const bReset = mkBtn('of-rs', RESET, () => o.onReset && o.onReset()), bOut = mkBtn('of-zo', '−', () => o.onZoom && o.onZoom(1 / 1.35)), bIn = mkBtn('of-zi', '+', () => o.onZoom && o.onZoom(1.35));
  const BOOK = BOOK_ICON;
  const bBook = o.onBook ? mkBtn('of-bk', BOOK, () => o.onBook()) : null;
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
    [[bReset, ui.reset], [bOut, ui.zoomOut], [bIn, ui.zoomIn], [bBook, ui.book]].forEach(([b, l]) => { if(b){ b.setAttribute('aria-label', l || ''); b.title = l || ''; } });
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
  return { el: drawer, bookBtn: bBook, showHint, hideHint, fsOn, syncFs, isOpen, close, setHtml(h){ drawer.innerHTML = h; }, open(){ drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); stage.classList.add('has-drawer'); o.request(); },
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
  let sel = null, selId = null, ring = null, bookOpen = false, pulse = null;
  const chrome = makeChrome(stage, container, { ui: () => cur.ui, onZoom: f => view && view.zoomBy(f), onReset: () => view && view.reset(), request: () => request(), onClose: () => { sel = null; selId = null; bookOpen = false; if(ring) ring.visible = false; }, onBook: () => openBook(),
    onAction: a => { if(!sel) return; const id = sel.p.id; if(a === 'seats' && opts.onSeats) opts.onSeats(id); else if(a === 'prompts' && opts.onPrompts) opts.onPrompts(id); } });
  const syncFs = () => chrome.syncFs();
  kit.bind(chrome.el);
  chrome.el.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('[data-bk]'); if(b) pulseGrade(b.dataset.bk);
    const pp = ev.target.closest && ev.target.closest('[data-pp]'); if(pp){ const o = people.find(q => q.p.id === pp.dataset.pp); if(o) openDrawer(o); }   /* leaderboard row opens that person */
  });

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
    V2.multiplyScalar(HS); fpt(o, o.x, hy, hz, V1); Mh.compose(V1, Q1.setFromEuler(E1.set(o.hp || 0, yaw, o.hr || 0)), ONE);
    V1.set(pt.p[0] * K * HS, pt.p[1] * K * HS, pt.p[2] * K * HS); E1.set(pt.r || 0, 0, 0); Mp.compose(V1, Q1.setFromEuler(E1), V2); Mp.premultiply(Mh); mesh.setMatrixAt(i, Mp);
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
    const kvGrid = rows => `<div class="grid">${rows.map(r => `<div class="kv"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div>`;
    const sec = (title, html) => html ? `<div class="sec"><h4>${esc(title)}</h4>${html}</div>` : '';
    const famHtml = tot ? kit.stack(['haiku', 'sonnet', 'opus'].map(f => ({ v: fam[f], color: FAMC[f], tip: `${f} · ${fam[f]} · ${Math.round(fam[f] / tot * 100)}%` })))
      + `<div class="famt">${['haiku', 'sonnet', 'opus'].filter(f => fam[f]).map(f => `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:${FAMC[f]}"></i>${f} ${fam[f]}</span>`).join('')}</div>` : '';
    const daily = dt.days && dt.days.length ? kit.chart(id + '-d', dt.days, [{ name: ui.spent, color: '#8b7cf0', kind: 'bar', vals: dt.spent, fmt: fm }, { name: ui.saved, color: '#2f9e6f', kind: 'line', vals: dt.saved, fmt: fm }]) : '';
    const pdaily = dt.pdays && dt.pdays.length ? kit.chart(id + '-p', dt.pdays, [{ name: ui.pname || '', color: '#e0a23c', kind: 'bar', vals: dt.pvals, fmt: v => String(Math.round(v)) }]) : '';
    chrome.setHtml(`<div class="hd">${iconSvg(sel.gk)}<div><b title="${esc(p.name)}">${p.crown ? CROWN_ICON : ''}${esc(p.name)}<span class="badge">${esc(p.gradeLabel || p.tierText)}</span></b><small>${esc(p.teamName)}</small></div><button type="button" class="x" data-a="close" aria-label="${esc(ui.close)}">×</button></div>`
      + `<div class="bd"><div class="why">${esc(dt.why)}</div>`
      + ((dt.next || []).length ? `<div class="nx">${dt.next.map((l, i) => `<div${i ? '' : ' class="h"'}>${esc(l)}</div>`).join('')}</div>` : '')
      + (dt.groups && dt.groups.length ? `<div class="sec">${dt.groups.map(g => `<div class="grp"><h4>${esc(g.title)}</h4>${kvGrid(g.rows)}</div>`).join('')}</div>`
        : dt.grid && dt.grid.length ? `<div class="sec">${kvGrid(dt.grid)}</div>` : '')
      + sec(ui.runs, famHtml) + sec(ui.cmp, kit.cmp(dt.cmp || [])) + sec(ui.daily, daily) + sec(ui.pdaily, pdaily)
      + sec(ui.machines, (dt.machines || []).map(m => `<div class="mrow"><b>${esc(m.name)}</b><span class="sig" style="background:${m.color}">${esc(m.sig)}</span><small>${esc(m.os)}${m.ver ? ' · ' + esc(m.ver) : ''} · ${esc(m.sw)}</small><small>${esc(ui.up)} ${esc(m.up)} · ${esc(ui.seen)} ${esc(m.seen)}</small></div>`).join(''))
      + sec(ui.events, (dt.events || []).map(e => `<div class="evr"><span>${esc(e.text)}</span><span>${esc(e.when)}</span></div>`).join('')) + `</div>`
      + `<div class="ft"><button type="button" class="of-dbtn pri" data-a="seats">${esc(ui.seats)}</button>${dt.canPrompts ? `<button type="button" class="of-dbtn" data-a="prompts">${esc(ui.prompts)}</button>` : ''}</div>`);
  }
  /* the field guide: the same drawer, one row per species, a click blinks a ring under everyone of that species */
  function renderBook(){
    const b = cur.book; if(!b) return;
    const top = b.top && b.top.rows.length ? `<div class="bkt"><h4>${esc(b.top.title)}</h4>${b.top.rows.map(r => `<button type="button" class="bkp" data-pp="${esc(r.id)}"><span class="rk">${esc(r.rk)}</span>${iconSvg(r.k)}<span class="nm">${esc(r.name)}<small>${esc(r.gname)}${r.team ? ' · ' + esc(r.team) : ''}</small></span>${r.crown ? CROWN_ICON : ''}</button>`).join('')}</div>` : '';
    let tier = null, rows = '';
    b.rows.forEach(r => {
      if(b.tiers && r.tier !== tier){ tier = r.tier; rows += `<h4 class="bkh">${esc(b.tiers[r.tier] || r.role)}</h4>`; }
      rows += `<button type="button" class="bkr${r.n ? '' : ' z'}" data-bk="${esc(r.k)}">${iconSvg(r.k)}<span class="nm">${r.no ? `<small class="no">${esc(r.no)}</small>` : ''}${esc(r.name)}${b.tiers ? '' : `<small>${esc(r.role)}</small>`}</span><span class="ct2">${esc(r.nText != null ? r.nText : r.n)}</span><span class="rg">${esc(r.range)}</span></button>`;
    });
    chrome.setHtml(`<div class="hd">${BOOK_ICON}<div><b>${esc(b.title)}</b><small>${esc(b.range)}${b.found ? ' · ' + esc(b.found) : ''}</small></div><button type="button" class="x" data-a="close" aria-label="${esc((cur.ui || {}).close)}">×</button></div>`
      + `<div class="bd">${top}${rows}<p class="bknote">${esc(b.note)}</p></div>`);
  }
  function openBook(){
    if(!cur.book) return;
    if(bookOpen && chrome.isOpen()){ chrome.close(); return; }
    sel = null; selId = null; if(ring) ring.visible = false; bookOpen = true; renderBook(); chrome.open();
  }
  function pulseGrade(k){
    if(!sets || !sets.pul) return;
    pulse = { k, t0: performance.now() }; request();
    if(reduced) setTimeout(() => { pulse = null; request(); }, 2500);
  }
  function openDrawer(o){ bookOpen = false; sel = o; selId = o.p.id; renderDrawer(); chrome.open(); if(ring) ring.visible = true; }
  const closeDrawer = () => chrome.close();

  function build(d){
    cur = d; clear();
    const closed = !!d.closed, pl = d.people || [];
    elHud.innerHTML = `<b>${esc(d.hud.title)}${closed ? `<em>${esc(d.hud.closed)}</em>` : ''}</b>${esc(d.hud.stats)}`; elHud.appendChild(elChip); renderChip();
    elLegend.innerHTML = (d.strip ? `<button type="button" class="of-strip" aria-label="${esc(d.strip.title)}"><b>${BOOK_ICON}${esc(d.strip.title)}</b>${d.strip.tiers.map(g => `<span class="tg t-${g.tier}"><em>${esc(g.label)}</em>${g.items.map(q => `<span class="sp${q.n ? '' : ' z'}" title="${esc(q.name + (q.n ? ' · ' + q.n : ''))}">${iconSvg(q.k)}</span>`).join('')}</span>`).join('')}</button>` : '')
      + `<div class="keys">${(d.legend || []).map(l => `<span>${l.k ? iconSvg(l.k) : l.bots ? BOT_ICON : l.c ? `<i style="background:${l.c}"></i>` : ''}${esc(l.label)}${(l.fams || []).map(f => `<i class="fm" style="background:${f.c}"></i>${esc(f.label)}`).join('')}</span>`).join('')}</div>`;
    { const sb = elLegend.querySelector('.of-strip'); if(sb) sb.addEventListener('click', () => openBook()); }
    if(chrome.bookBtn) chrome.bookBtn.style.display = d.book ? '' : 'none';
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
        const ghost = closed || p.tier === 'nodata', key = ghost ? 'nodata' : p.tier, gk = ghost ? 'ghost' : gradeKey(p);
        const o = { x, z, p, gk, tv: TV[key], an: ghost ? GHOST : ANIMALS[gk] || ANIMALS[TIER_GRADE[p.tier]], ghost, dy: 0, ph: hash(p.id) * 6.28 };
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
    people.forEach(o => {   /* the nearest desk in the same row: whom to glance at */
      let best = null, bd = 4; people.forEach(q => { if(q !== o && Math.abs(q.z - o.z) < 0.5 && Math.abs(q.x - o.x) < bd){ bd = Math.abs(q.x - o.x); best = q; } });
      o.nb = best ? Math.sign(best.x - o.x) : hash(o.p.id + 'nb') < 0.5 ? -1 : 1;
    });
    const sm = sets.sm = mk(sets.box, std({}), sb.length); tintZ = null; sets.sb = sb; sb.forEach((b, i) => { setM(sm, i, b[4], b[5], b[6], 0, 0, b[1], b[2], b[3]); sm.setColorAt(i, col(b[0])); });
    sm.instanceMatrix.needsUpdate = true; sm.instanceColor.needsUpdate = true;
    const sh = sets.sh = mk(sets.sph, std({}), sp.length); sp.forEach((b, i) => { setM(sh, i, b[2], b[3], b[4], 0, 0, b[1] * b[5], b[1] * b[6], b[1] * b[7]); sh.setColorAt(i, col(b[0])); });
    sh.instanceMatrix.needsUpdate = true; sh.instanceColor.needsUpdate = true;
    buildEnv(W0, col);

    /* animals: torso + arms + a list of head and body parts per person, instanced per geometry; ghosts are translucent white */
    const fig = (arr, ghost) => {
      const n = arr.length, mt = o => std(ghost ? { transparent: true, opacity: 0.3, depthWrite: false, ...o } : o);
      const f = { arr, ghost, torso: mk(sets.torso, mt({}), n, !ghost), arm: mk(sets.arm, mt({}), n * 2, !ghost), scarf: mk(sets.sphHi, mt({}), n, !ghost), sph: null, cone: null, cnt: { sph: 0, cone: 0 } };
      if(ghost){ const rm = bas({ color: '#9cc6f5', transparent: true, opacity: 0.16, side: T.BackSide, depthWrite: false }); f.rimH = mk(sets.sphHi, rm, n, false); f.rimT = mk(sets.torso, rm, n, false); }
      arr.forEach(o => { o.parts = o.an.parts().concat(!ghost && o.p.crown ? crownParts(o.gk) : []); o.parts.forEach(pt => { f.cnt[pt.g]++; }); });
      f.sph = mk(sets.sphHi, mt({}), f.cnt.sph, !ghost); f.cone = mk(sets.coneHi, mt({}), f.cnt.cone, !ghost);
      const ix = { sph: 0, cone: 0 };
      arr.forEach((o, i) => {
        const tc = ghost ? '#ffffff' : o.tv.body, ac = ghost ? tc : o.an.arm || tc, bc = ghost ? tc : o.an.body || ac;   /* body in fur, scarf in the tier colour */
        f.torso.setColorAt(i, C(bc)); f.arm.setColorAt(i * 2, C(ac)); f.arm.setColorAt(i * 2 + 1, C(ac)); f.scarf.setColorAt(i, C(tc));
        o.rimPt = { p: [0, 0, 0], s: [0.415, 0.415, 0.415], r: 0 };
        o.pl = o.parts.map(pt => { const k = ix[pt.g]++; f[pt.g].setColorAt(k, C(pt.c)); return { m: f[pt.g], i: k, pt }; });
      });
      if(n){ f.torso.instanceColor.needsUpdate = f.arm.instanceColor.needsUpdate = f.scarf.instanceColor.needsUpdate = true; }
      ['sph', 'cone'].forEach(g => { if(f.cnt[g]) f[g].instanceColor.needsUpdate = true; });
      return f;
    };
    sets.f = [fig(solids, false), fig(ghosts, true)];
    sets.mug = mk(sets.box, std({}), solids.length);   /* the coffee mug, shown in the hand during the coffee action */
    solids.forEach((o, i) => { sets.mug.setColorAt(i, C('#fff6e8')); setM(sets.mug, i, o.x, 0, o.z, 0, 0, 0.0001, 0.0001, 0.0001); });
    if(solids.length){ sets.mug.instanceColor.needsUpdate = true; sets.mug.instanceMatrix.needsUpdate = true; }
    if(opts.cast !== false) placeCast(solids, ghosts);
    { const pg = track(new T.RingGeometry(0.75, 1.0, 40)); pg.rotateX(-Math.PI / 2);   /* blink ring for the field guide */
      sets.pul = mk(pg, bas({ color: '#ff8a3d', transparent: true, opacity: 0.9, depthWrite: false }), people.length, false);
      people.forEach((o, j) => setM(sets.pul, j, o.x, 0.1, o.z + 0.3, 0, 0, 0.0001, 1, 0.0001)); sets.pul.instanceMatrix.needsUpdate = true; }
    scr = { m: mk(sets.box, bas({}), screens.length, false), list: screens };
    screens.forEach((s, i) => { setM(scr.m, i, s[0], s[1], s[2] + 0.03, 0, 0, 1.05, 0.65, 0.06); scr.m.setColorAt(i, C('#000000')); });
    if(screens.length) scr.m.instanceMatrix.needsUpdate = true;
    const sl = mk(sets.sph, bas({}), srvLights.length, false); srvLights.forEach((l, i) => { setM(sl, i, l.x, l.y, l.z, 0, 0, 0.1, 0.1, 0.04); sl.setColorAt(i, l.c); }); sl.instanceMatrix.needsUpdate = true; srv.lights = sl;
    /* sparkles around the power users: three for the two rarest species, two for the next two, one for the rest; four for the crown */
    sparks = [];
    solids.filter(o => o.p.tier === 'power').forEach(o => { const gi = gradeIndex(o.gk), n = o.p.crown ? 4 : gi < 2 ? 3 : gi < 4 ? 2 : 1; for(let k = 0; k < n; k++) sparks.push({ o, k }); });
    sets.spk = mk(sets.sph, bas({}), sparks.length, false); sparks.forEach((q, i) => sets.spk.setColorAt(i, C(q.k === 3 ? '#ffd36b' : '#fff0a0'))); if(sparks.length) sets.spk.instanceColor.needsUpdate = true;

    /* helper bots: round pastel bodies with an antenna and a soft glow, one orbiting each owner, flying to the server now and then */
    const fl = [];
    if(!closed) solids.forEach(o => (o.p.bots || []).forEach((fam, j) => fl.push({ o, fam, j })));
    const bm = mk(sets.sph, bas({}), fl.length, false), gl = mk(sets.sph, bas({ transparent: true, opacity: 0.22, depthWrite: false }), fl.length, false), an = mk(sets.box, bas({}), fl.length, false), tp = mk(sets.sph, bas({}), fl.length, false);
    fl.forEach((b, i) => {
      const c = C(b.fam === 'any' ? '#c4b5fd' : FAMC[b.fam]);
      bm.setColorAt(i, c); gl.setColorAt(i, c); an.setColorAt(i, C('#ffffff')); tp.setColorAt(i, C('#ffffff'));
      bots.push({ i, o: b.o, a0: hash(b.o.p.id + b.j) * 6.28, rad: 1.5 + b.j * 0.25, sp: (b.o.p.tier === 'power' ? 0.7 : 0.45) * (b.j % 2 ? -1 : 1), hy: 3.25 + b.j * 0.25, st: 0, t: 0, next: 1.5 + hash(b.o.p.id + 'n' + b.j) * 9, pos: v3(), p0: v3(), col: c.clone().multiplyScalar(0.8) });
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
    if(bookOpen){ if(d.book) renderBook(); else chrome.close(); }
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
  /* Seated behaviour: typing is the base pose; every few seconds a person plays one short action over it. The schedule is a pure function of the
     person's id and the round number (no random numbers), so a recording with a virtual clock replays it exactly. Power users type more and act
     less often, chicks the other way round; dozing suits the calm animals, bouncing the lively ones. Poses blend in and out over 0.3 s. */
  const SCH = { power: { gap: 1.7, skip: 0.5 }, active: { gap: 1.2, skip: 0.25 }, normal: { gap: 1, skip: 0.1 }, low: { gap: 0.6, skip: 0 } };
  const ACT_ALL = ['stretch', 'coffee', 'think', 'look', 'wave'], CALM = new Set(['normal', 'low']);   /* the top eight species bounce, normal and low tiers doze */
  function planAct(o, n, prev){
    const sc = SCH[o.p.tier] || SCH.normal, id = o.p.id, gap = (4 + 8 * hash(id + 'g' + n)) * sc.gap, dur = 2 + 3 * hash(id + 'd' + n);
    const gi = gradeIndex(o.gk), list = ACT_ALL.concat(CALM.has(o.p.tier) ? ['doze'] : [], gi >= 0 && gi < 8 ? ['bounce'] : []);
    const kind = hash(id + 's' + n) < sc.skip ? null : list[Math.floor(hash(id + 'k' + n) * list.length)];
    return { n, t0: prev + gap, t1: prev + gap + dur, kind };
  }
  function arcTo(a, b, u, out){ const e = ease(u); out.lerpVectors(a, b, e); out.y += Math.sin(Math.PI * u) * 2.1; return out; }
  function updateWalls(){
    if(!sets.sm || !view) return; const a = view.azimuth(), want = { z: Math.cos(a) < -0.05, x: Math.sin(a) < -0.05 };
    ['z', 'x'].forEach(k => { if(want[k] === wallHid[k]) return; wallHid[k] = want[k];
      wallIdx[k].forEach(i => { const b = sets.sb[i]; setM(sets.sm, i, b[4], b[5], b[6], 0, 0, b[1], want[k] ? 0.001 : b[2], b[3]); }); sets.sm.instanceMatrix.needsUpdate = true; });
  }
  /* The cast: one sculpted glTF character per species (site/assets/scene/cast/<grade>.glb, made in Blender, Draco-compressed). The primitive
     figures stay on screen until every model has loaded and come back if any fails, so the office never shows an empty chair. */
  let castOn = false, castGen = 0, castLoad = null;   /* castGen: a rebuild (weather, range, data) while models load must not let the older build add its set too */
  const castCache = {};
  function castCrown(T){   /* a small gold crown on top of the head, in model units (the model is scaled after) */
    const g = new T.Group(), gold = new T.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.3, metalness: 0.6 }), gem = new T.MeshStandardMaterial({ color: '#ff6f91', roughness: 0.25 });
    const band = new T.Mesh(new T.CylinderGeometry(0.13, 0.14, 0.07, 20, 1, true), gold); band.material.side = T.DoubleSide; g.add(band);
    for(let i = 0; i < 5; i++){ const a = i / 5 * Math.PI * 2, c = new T.Mesh(new T.ConeGeometry(0.032, 0.075, 8), gold); c.position.set(Math.sin(a) * 0.125, 0.07, Math.cos(a) * 0.125); g.add(c);
      const b = new T.Mesh(new T.SphereGeometry(0.014, 8, 6), gem); b.position.set(Math.sin(a) * 0.137, 0.0, Math.cos(a) * 0.137); g.add(b); }
    g.position.set(0, 1.04, -0.02); g.rotation.x = -0.12; return g;
  }
  async function placeCast(solids, ghosts){
    const gen = ++castGen; castOn = false;
    const all = solids.concat(ghosts); if(!all.length) return;
    try{
      castLoad = castLoad || Promise.all([import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm'), import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/DRACOLoader.js/+esm')])
        .then(([{ GLTFLoader }, { DRACOLoader }]) => { const l = new GLTFLoader(), dr = new DRACOLoader(); dr.setDecoderPath(CAST_DRACO); l.setDRACOLoader(dr); return l; });
      const loader = await castLoad, load = k => castCache[k] || (castCache[k] = loader.loadAsync(CAST_URL + k + '.glb'));   /* one download per species for the page's lifetime */
      const SC = 1.6;   /* big enough that the head clears the monitor; every model is built at one body size, so one scale keeps bodies equal while ears, horns and manes stick out */
      const ms = await Promise.all(all.map(async o => {
        const g = await load(o.ghost ? 'ghost' : o.gk), m = g.scene.clone(true), box = new T.Box3().setFromObject(m);
        m.scale.setScalar(SC); o.y0 = 0.42 - box.min.y * SC; m.position.set(o.x, o.y0, o.z + 0.3); m.rotation.y = Math.PI;
        m.traverse(c => { if(c.isMesh){ c.castShadow = true; c.receiveShadow = true; } });
        if(!o.ghost && o.p.crown) m.add(castCrown(T));   /* the primitive crown is hidden with the primitive figures */
        return [o, m];
      }));
      if(gen !== castGen) return;   /* a newer build owns the scene now */
      ms.forEach(([o, m]) => { o.glb = m; world.add(m); });
      sets.f.forEach(f => { [f.torso, f.arm, f.scarf, f.sph, f.cone, f.rimH, f.rimT].forEach(m => { if(m) m.visible = false; }); });
      if(sets.mug) sets.mug.visible = false;
      castOn = true; request();
    }catch(e){ if(gen === castGen) castOn = false; }
  }
  function stepCast(){
    if(!castOn) return;
    people.forEach(o => { const m = o.glb; if(!m) return;
      const breathe = reduced ? 0 : Math.sin(time * 2.1 + o.ph) * 0.012;
      m.position.y = o.y0 + (o.dy || 0) + breathe; m.rotation.y = Math.PI + (o.turn || 0) * 0.45; });
  }
  function step(dt){
    time += dt;
    view.update(dt, time); updateWalls();
    { const az = view.azimuth(), flip = Math.cos(az) < 0;   /* floor text flips 180 degrees when the camera is on the far side, signs face the camera */
      if(flip !== decFlip){ decFlip = flip; decals.forEach(m => { m.rotation.y = flip ? Math.PI : 0; }); } signs.forEach(m => { m.rotation.y = az; }); }
    const closed = !!cur.closed;
    /* people: typing arms, the head turns toward the room now and then, and one scheduled action at a time (see planAct) */
    sets.f.forEach(f => {
      const mv = !reduced && !f.ghost;
      f.arr.forEach((o, i) => {
        const tier = o.ghost ? 'nodata' : o.p.tier, low = tier === 'low', sp = o.tv.sp, ph = o.ph, tt = mv ? time : 0;
        const bob = sp ? Math.sin(tt * sp + ph) * 0.05 : 0, base = low ? -0.3 + Math.sin(tt * 0.8 + ph) * 0.02 : 0.08;
        const L = low ? [0.36, 1.2, 0.12, 0, 1] : [-0.3, 1.1 + bob, -0.12, Math.PI / 2, 1], R = low ? [-0.34, 1.0, 0.1, Math.PI / 2, 0.8] : [0.3, 1.1 - bob, -0.12, Math.PI / 2, 1];
        let lean = base, hp = 0, hr = 0, dyB = 0, mug = 0, yw = 0, yk = 0;
        if(mv){
          if(!o.act) o.act = planAct(o, 0, hash(o.p.id + 'i') * 2);
          while(time >= o.act.t1) o.act = planAct(o, o.act.n + 1, o.act.t1);
          const a = o.act, u = time - a.t0, e = a.kind && u > 0 ? ease(Math.max(0, Math.min(1, u / 0.3, (a.t1 - time) / 0.3))) : 0;
          if(e > 0){
            const mixA = (A, B2) => { for(let q = 0; q < 5; q++) A[q] += (B2[q] - A[q]) * e; };
            switch(a.kind){
              case 'stretch': { const w = Math.sin(u * 4) * 0.03; mixA(L, [-0.38, 1.6 + w, -0.1, 0, 1]); mixA(R, [0.38, 1.6 - w, -0.1, 0, 1]); lean += (-0.3 - lean) * e; hp = 0.25 * e; break; }
              case 'coffee': { mixA(R, [0.2, 1.45, -0.02, 0.9, 1]); hp = 0.12 * e * Math.max(0, Math.sin(u * 2.4)); mug = e; break; }
              case 'think': { mixA(R, [0.08, 1.5, -0.12, 0.5, 1]); hr = 0.28 * e; hp = -0.05 * e; yw = -0.25; yk = e; break; }
              case 'look': yw = -o.nb * 0.95; yk = e; break;
              case 'wave': { mixA(R, [0.42 + Math.sin(u * 9) * 0.12, 1.55, -0.05, 0, 1]); yw = HEAD_YAW; yk = 0.7 * e; break; }
              case 'doze': { hp = -(0.32 + Math.sin(u * 2.2) * 0.1) * e; lean += 0.1 * e; break; }
              case 'bounce': { dyB = 0.05 * Math.abs(Math.sin(u * 6)) * e; L[1] += Math.sin(u * 12) * 0.05 * e; R[1] -= Math.sin(u * 12) * 0.05 * e; break; }
            }
          }
        }
        o.dy = o.ghost ? 0.14 + (mv || !reduced ? Math.sin(time * 1.6 + ph) * 0.08 : 0) : dyB; o.hp = hp; o.hr = hr;
        setK(f.torso, i, o, o.x, 1.05, o.z + 0.3, lean);
        setK(f.scarf, i, o, o.x, 1.05 + 0.4 * Math.cos(lean), o.z + 0.3 + 0.4 * Math.sin(lean), lean, f.ghost ? 0.0001 : 0.34, 0.09, f.ghost ? 0.0001 : 0.34);
        setK(f.arm, i * 2, o, o.x + L[0], L[1], o.z + L[2], L[3], 1, 1, L[4]); setK(f.arm, i * 2 + 1, o, o.x + R[0], R[1], o.z + R[2], R[3], 1, 1, R[4]);
        const by = headYaw(o, low, mv, dt), hy = HEAD_Y + (mv ? Math.sin(tt * 1.3 + ph) * 0.015 : 0), yaw = by + (yw - by) * yk, hz = o.z + 0.3 + (low ? 0.15 : -0.05) - (lean - base) * 0.35;
        o.pl.forEach(q => putPart(q.m, q.i, q.pt, o, hy, hz, yaw)); o.turn = yaw;   /* a glTF character turns its whole body a little where a primitive one turns its head */
        if(!f.ghost && sets.mug){
          if(mug > 0.05){ fpt(o, o.x + R[0], R[1] + 0.17, o.z + R[2] - 0.08, TMP); setM(sets.mug, o.idx, TMP.x, TMP.y, TMP.z, 0, 0, 0.1 * K, 0.13 * K, 0.1 * K); }
          else setM(sets.mug, o.idx, o.x, 0, o.z, 0, 0, 0.0001, 0.0001, 0.0001);
        }
        if(f.ghost){ putPart(f.rimH, i, o.rimPt, o, hy, hz, yaw); setK(f.rimT, i, o, o.x, 1.05, o.z + 0.3, lean, 1.12, 1.1, 1.12); }
      });
      if(f.arr.length){ [f.torso, f.arm, f.scarf, f.sph, f.cone].concat(f.ghost ? [f.rimH, f.rimT] : [sets.mug]).forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
    });
    stepCast();
    if(sets.pul){   /* field guide: rings blink under everyone of the picked species for 2.4 s */
      const now = performance.now(), on = !!pulse && now - pulse.t0 < 2400, blink = on && (reduced || Math.floor((now - pulse.t0) / 300) % 2 === 0);
      people.forEach((o, j) => { const hit = blink && o.gk === pulse.k; setM(sets.pul, j, o.x, 0.1, o.z + 0.3, 0, 0, hit ? 1 : 0.0001, 1, hit ? 1 : 0.0001); });
      sets.pul.instanceMatrix.needsUpdate = true; if(pulse && !on) pulse = null;
    }
    if(sel && ring){ ring.position.set(sel.x, 0.09, sel.z + 0.3); ring.scale.setScalar(1 + (reduced ? 0 : 0.04 * Math.sin(time * 3))); }
    sparks.forEach((q, i) => {
      const a = (reduced ? 0 : time * 1.6) + q.k * 2.1 + q.o.ph, tw = reduced ? 0.7 : 0.55 + 0.45 * Math.sin(time * 5 + q.k * 2 + q.o.ph), r = 0.85 + q.k * 0.08;
      setM(sets.spk, i, q.o.x + Math.cos(a) * r, 3.1 + q.k * 0.22 + Math.sin(a * 2) * 0.06, q.o.z + 0.25 + Math.sin(a) * r * 0.7, 0, 0, 0.09 * tw, 0.09 * tw, 0.09 * tw);
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
    bubs.forEach(b => { if(!b.o) return; HP.set(b.o.x, 3.7, b.o.z); place(b.el, HP, 0, -20); });
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
    elTip.innerHTML = h.team ? `<b>${esc(h.team.name)}</b>` + (h.team.gh ? `<div><span>⏸</span><span>${h.team.gh}</span></div>` : '') : `<b>${esc(p.name)}</b>` + (p.tip || []).map(r => `<div><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('') + `<div class="tier t-${p.tier}"><span>${esc(p.gradeLabel || p.tierText)}</span></div>`;
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
    M4 = new T.Object3D(); S = v3(); TMP = v3(); PT = v3(); HP = v3(); Mh = new T.Matrix4(); Mp = new T.Matrix4(); Q1 = new T.Quaternion(); E1 = new T.Euler(0, 0, 0, 'YXZ'); V1 = v3(); V2 = v3(); ONE = v3().set(1, 1, 1);
    camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    hemi = new T.HemisphereLight('#fff7e6', '#e8dcc4', 1.25); sun = new T.DirectionalLight('#fff0d4', 0.85); sun.position.set(8, 18, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0008; sun.shadow.radius = 4;
    scene.add(hemi, sun, sun.target);
    for(let i = 0; i < 4; i++){ const L = new T.PointLight('#ffc98a', 0, 0, 2); scene.add(L); lamps.push(L); }   /* evening lamps: a fixed count, so no shader recompiles */
    sets = { box: new T.BoxGeometry(1, 1, 1), sph: new T.SphereGeometry(1, 16, 12), cone: new T.ConeGeometry(1, 2, 10), torso: new T.CapsuleGeometry(0.3, 0.32, 6, 16), arm: new T.CapsuleGeometry(0.1, 0.26, 4, 10), sphHi: new T.SphereGeometry(1, 20, 14), coneHi: new T.ConeGeometry(1, 2, 16), disc: new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
    { const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = c.height = 64; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);   /* soft round blob for pools, puddles and cloud shadows */
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); sets.soft = new T.CanvasTexture(c); }
    flakeG = new T.IcosahedronGeometry(1, 0);
    statics.push(sets.box, sets.sph, sets.cone, sets.sphHi, sets.coneHi, sets.torso, sets.arm, sets.disc, sets.soft, flakeG);
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
 * Grades (see GRADES): percentile score = .5 spend + .3 delegation share (saved / (spent + saved)) + .2 prompts (renormalized without prompts, W_NOPR);
 *   the tier follows the grade: power = top 20% with delegation >= median, active = top half, normal = above the bottom 25%, low = bottom 25% or no spend and no prompts.
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
    let spent = 0, saved = 0, runs = 0, fam = false, today = 0, errors = 0, savedToday = 0, delToday = null; const days = {};
    rs.forEach(r => {
      ((usage[r.member_id] || {}).series || []).forEach(q => { const d = days[q.day] || (days[q.day] = [0, 0]); d[0] += Number(q.spent) || 0; d[1] += Number(q.saved) || 0; });
      { const u1 = usage[r.member_id] || {}; savedToday += Number(u1.saved_today) || 0; if(u1.delegated_today != null) delToday = (delToday || 0) + (Number(u1.delegated_today) || 0); }
      today += Number((usage[r.member_id] || {}).spent_today) || 0; errors += Number((usage[r.member_id] || {}).errors) || 0;
      const u = usage[r.member_id] || {}; spent += Number(u.spent) || 0; saved += Number(u.saved) || 0; runs += Number(u.delegated) || 0;
      const f = u.families; if(f) Object.keys(mix).forEach(k => { const n = Number(f[k]) || 0; if(n){ mix[k] += n; orgMix[k] += n; fam = true; } });
    });
    let prompts = 0, promptId = null, chars = 0, lastPrompt = null; const pdays = {};
    if(pr) rs.forEach(r => { const p = pr.find(x => x.member_id === r.member_id) || pr.find(x => x.display_name && x.display_name === r.display_name); if(p){ prompts += Number(p.prompts) || 0; chars += Number(p.chars) || 0; promptId = promptId || p.member_id;
      if(p.last_prompt_at && (!lastPrompt || p.last_prompt_at > lastPrompt)) lastPrompt = p.last_prompt_at; (p.by_day || []).forEach(q => { pdays[q.day] = (pdays[q.day] || 0) + (Number(q.prompts) || 0); }); } });
    return { id: key, host, rs, spent, saved, runs, today, savedToday, delToday, errors, days, pdays, chars, lastPrompt, mix: fam ? mix : null, prompts, promptId, ok: !closed && rs.some(r => r.signal === 'ok'), dlg: spent + saved > 0 ? saved / (spent + saved) : 0 };
  });
  all.sort((a, b) => b.spent - a.spent);
  const shown = all.slice(0, MAXP), more = all.length - shown.length;
  const ranked = all.filter(p => p.ok), n = ranked.length;
  const rank = (arr, v) => { if(n < 2) return 0.5; let lo = 0, eq = 0; arr.forEach(x => { if(x < v) lo++; else if(x === v) eq++; }); return (lo + (eq - 1) / 2) / (n - 1); };
  const sp = ranked.map(p => p.spent), dl = ranked.map(p => p.dlg), pm = ranked.map(p => p.prompts), w = pr ? W_FULL : W_NOPR;
  ranked.forEach(p => { p.score = w[0] * rank(sp, p.spent) + w[1] * rank(dl, p.dlg) + (pr ? w[2] * rank(pm, p.prompts) : 0); });
  const sc = ranked.map(p => p.score), med = [...dl].sort((a, b) => a - b)[Math.floor(n / 2)] || 0;
  ranked.forEach(p => { p.sr = rank(sc, p.score); p.idle = p.spent < 0.01 && (!pr || !p.prompts); p.grade = gradeOf(p.sr, p.dlg, med, p.idle); p.tier = tierOfGrade(p.grade); });
  /* standings: rank 1 is the highest score (ties share a rank); the crown goes to rank 1 when at least two people are ranked and they spent something */
  ranked.forEach(p => { p.rank = 1 + ranked.filter(q => q.score > p.score + 1e-12).length; p.crown = n >= 2 && p.rank === 1 && !p.idle; });
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
  /* the drawer's standings lines: overall rank, the crown, and what it takes to reach the next species up.
     People to pass = how far the score percentile is below the next row's floor, in people; a row with the delegation rule also needs the median. */
  const gn = k => t('of.g.' + k);
  const standing = p => {
    const gi = gradeIndex(p.grade); if(gi < 0) return [];
    const out = [t('of.d.rank', { r: p.rank, n }, true)];
    if(p.crown) out.push(t('of.d.crown'));
    if(p.idle){ out.push(t('of.d.next.idle')); return out; }
    if(gi === 0){ out.push(t('of.d.top')); return out; }
    const g = GRADES[gi - 1], x = Math.max(0, Math.ceil((g.minSr - p.sr) * (n - 1) - 1e-6)), dl = g.needDlg && p.dlg < med, v = { x: Math.max(1, x), s: gn(g.k), c: pc(med) };
    out.push(t(dl ? (x ? 'of.d.next.xd' : 'of.d.next.d') : 'of.d.next', v, true));
    return out;
  };
  let demoI = 0;
  const people = shown.map(p => {
    const nodata = !p.ok; p.tier = nodata ? 'nodata' : p.tier; p.grade = nodata ? 'ghost' : p.grade;
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
    const no = gradeIndex(p.grade) + 1, noText = no ? t('of.g.no', { n: String(no).padStart(2, '0') }, true) + ' ' : '';
    if(!nodata && !closed) tip.push([t('of.d.rankk'), t('of.book.rank', { r: p.rank }, true) + ' / ' + n]);
    return { id: p.id, name: p.host.display_name || p.id, teamId: p.host.team_id, teamName: p.host.team_name || '', tier: p.tier, grade: p.grade, gradeText: t('of.g.' + p.grade),
      gradeLabel: closed ? t('of.tag.closed') : noText + t('of.g.' + p.grade) + ' · ' + t('of.tier.' + p.tier), rank: nodata ? 0 : p.rank, crown: !nodata && !closed && !!p.crown, spent: p.spent, promptId: p.promptId, tip,
      detail: (() => {
        const ids2 = new Set(p.rs.map(r => r.member_id)), tm = teamM[p.host.team_id] || { spent: 0, dlg: 0, prompts: 0 }, dd = Object.keys(p.days).sort(), pd = Object.keys(p.pdays).sort();
        const lastP = p.lastPrompt ? o.rel(p.lastPrompt) : t('never');
        const hasData = !nodata && !closed;
        const pRows = [[t('of.spent'), money(p.spent)], [t('of.saved'), money(p.saved)], [t('of.deleg'), pc(p.dlg)], [t('of.runs'), String(p.runs)], [t('of.d.errors'), String(p.errors)]]
          .concat(pr ? [[t('of.prompts'), String(p.prompts)], [t('of.d.days'), String(pd.length)], [t('of.d.avg'), p.prompts ? t('pu.chars', { n: Math.round(p.chars / p.prompts) }, true) : '—'], [t('of.d.lastp'), lastP]] : []);
        const tRows = [[t('of.d.today'), money(p.today)], [t('of.d.today.s'), money(p.savedToday)], [t('of.d.today.r'), p.delToday == null ? '—' : String(p.delToday)]];
        const groups = hasData ? [{ title: t('of.d.period', { x: o.rangeLabel }, true), rows: pRows }, { title: t('of.d.today.h'), rows: tRows }] : [], grid = hasData ? pRows.concat(tRows) : [];
        const mk3 = (v1, v2, v3, f, nm) => [{ name: t('of.d.me'), v: v1, txt: f(v1), color: '#7c6cf0' }, { name: t('of.d.team'), v: v2, txt: f(v2), color: '#8ec5fb' }, { name: t('of.d.org'), v: v3, txt: f(v3), color: '#d4c7a8' }];
        const cmp = hasData ? [{ label: t('of.spent'), items: mk3(p.spent, tm.spent, orgM.spent, money) }, { label: t('of.deleg'), items: mk3(p.dlg, tm.dlg, orgM.dlg, pc) }].concat(pr ? [{ label: t('of.prompts'), items: mk3(p.prompts, tm.prompts, orgM.prompts, v => String(Math.round(v))) }] : []) : [];
        const evs = (o.events || []).filter(e => ids2.has(e.member_id)).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8).map(e => ({ text: t('of.ev.' + e.event) === 'of.ev.' + e.event ? String(e.event) : t('of.ev.' + e.event), when: o.rel(e.at) }));
        return { next: hasData ? standing(p) : [], why: hasData ? t('of.d.why', { a: Math.max(1, Math.round((1 - rank(sp, p.spent)) * 100)), b: pc(p.dlg), c: pc(orgM.dlg) }, true) : closed ? t('of.tag.closed') : t('of.why') + ': ' + why,
          grid, groups, cmp, fam: p.mix, fmt: money, days: hasData ? dd : [], spent: dd.map(d => p.days[d][0]), saved: dd.map(d => p.days[d][1]),
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
  const gl = k => t('of.g.' + k), cntG = k => people.filter(m => m.grade === k).length, fw = v => String(Math.round(v * 1000) / 10);
  /* the legend has two rows: the field-guide strip (all thirty species by tier, the ones nobody holds greyed out; a click opens the guide) and the symbol keys */
  const bands = gradeBands(), tierN = tr => bands.filter(b => b.tier === tr).length, found = bands.filter(b => cntG(b.k)).length;
  const strip = closed ? null : { title: t('of.lg.strip', { f: found, n: GRADES.length }, true),
    tiers: TIERS.map(tr => ({ tier: tr, label: t('of.tier.' + tr), items: bands.filter(b => b.tier === tr).map(b => ({ k: b.k, name: gl(b.k), n: cntG(b.k) })) })) };
  const legend = closed ? [] : (people.some(m => m.crown) ? [{ k: 'crown', label: t('of.lg.crown') }] : []).concat([{ k: 'ghost', label: t('of.lg.ghost') },
    { bots: true, label: t('of.lg.bots'), fams: fam ? ['haiku', 'sonnet', 'opus'].map(f => ({ c: FAMC[f], label: f })) : [] }, { label: t('of.lg.screen') }]);
  const book = closed ? null : { title: t('of.book'), range: o.rangeLabel, found: t('of.book.found', { f: found, n: GRADES.length }, true),
    tiers: Object.fromEntries(TIERS.map(tr => [tr, t('of.book.tier', { t: t('of.tier.' + tr), n: tierN(tr) }, true)]).concat([['nodata', t('of.tier.nodata')]])),
    top: { title: t('of.book.top'), rows: people.filter(m => m.rank).sort((a, b) => a.rank - b.rank).slice(0, 5)
      .map(m => ({ id: m.id, name: m.name, k: m.grade, gname: gl(m.grade), team: m.teamName, crown: m.crown, rk: t('of.book.rank', { r: m.rank }, true) })) },
    rows: bands.map(b => ({ k: b.k, tier: b.tier, no: t('of.g.no', { n: String(b.no).padStart(2, '0') }, true), name: gl(b.k), role: t('of.tier.' + b.tier), range: t('of.gr.' + b.rk, { a: b.a, b: b.b, c: b.c, d: b.d }, true), n: cntG(b.k) }))
      .concat([{ k: 'ghost', tier: 'nodata', no: '', name: gl('ghost'), role: t('of.tier.nodata'), range: t('of.gr.ghost'), n: cntG('ghost') }]).map(r => ({ ...r, nText: t('of.book.n', { n: r.n }, true) })),
    note: t('of.book.note', { s: fw(W_FULL[0]), d: fw(W_FULL[1]), p: fw(W_FULL[2]), s2: fw(W_NOPR[0]), d2: fw(W_NOPR[1]) }, true) };
  const ui = Object.fromEntries(Object.entries({ fs: 'of.fs', fsExit: 'of.fs.exit', close: 'of.close', hint: 'of.hint', reset: 'of.reset', zoomIn: 'of.zoomIn', zoomOut: 'of.zoomOut', runs: 'of.runs', daily: 'of.d.daily', pdaily: 'of.d.pdaily', seats: 'of.d.seats', prompts: 'of.d.prompts', cmp: 'of.d.cmp', machines: 'of.d.machines', up: 'of.d.up', seen: 'of.d.seen', events: 'of.d.events', spent: 'of.spent', saved: 'of.saved', none: 'of.d.none', pname: 'of.prompts', book: 'of.book' }).map(([k, v]) => [k, t(v)]));
  return { ui, teams, people, free, freeLabel: free ? t('of.free', { n: free }, true) : '', more: Math.max(0, more), moreLabel: more > 0 ? t('of.more', { n: more }, true) : '', closed,
    server: { label: closed ? t('of.server') + ' · ' + t('of.tag.closed') : t('of.server') + ' · ' + t('of.spent') + ' ' + money(totSpent) + ' · ' + t('of.saved') + ' ' + money(totSaved) },
    activity: act, book, hud: { title: o.orgName + ' ' + t('of.town') + ' · ' + o.rangeLabel, stats, closed: t('of.tag.closed') }, legend, strip,
    aria: t('of.aria', { n: people.length, teams: teams.length, used, limit }, true) };
}
