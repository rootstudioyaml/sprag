/* Virtual office: an animated three.js hero for the organization detail screens (site/team and site/ops).
 *
 *   const ctl = mountOfficeScene(container, data, opts);   // ctl = { update(data), destroy() }
 *   const data = officeSceneData({ rows, usage, promptRows, teams, used, limit, orgName, rangeLabel, t, money, rel, ... });
 *
 * One zone per team, one desk per person (the animal sits behind its desk and faces the camera, at an open laptop whose lid back carries a logo by OS: apple, windows or a plain dot), AI helper bots, a server kiosk. Chunky pastel animal characters by grade (thirty species from dragon to chick, plus the ghost; see GRADES), a crown on the company's number one, bright cozy daylight, orthographic isometric camera.
 * data (all user-facing strings arrive ready-made, the host owns i18n):
 *   { teams:[{id,name}], people:[{id,name,teamId,teamName,tier:'power'|'active'|'normal'|'low'|'nodata',grade,gradeText,gradeLabel,rank,crown,tag,tierText,tip:[[k,v]],bots:['haiku'|'sonnet'|'opus'|'any'],bubbles:[{text,ai}],promptId,spent,os,self,pet}],
 *     free, freeLabel, more, moreLabel, server:{label}, activity:0..1, closed, hud:{title,stats,closed}, legend:[{k:grade|'ghost'|'crown',label}|{c,label}|{label}], book:{title,range,found,tiers,top:{title,rows:[{id,name,k,gname,team,crown,rk}]},rows:[{k,tier,no,name,role,range,n}],note}|null, aria }
 * people[].os is the OS name of the person's most recently seen machine; it picks the lid colour and logo (see laptopKind).
 * people[].pet (optional) is the member's pet: a pets.js look { kind, coat, pattern, ear, tail, size, fluff, name? } plus photo (an image or data URL for the
 * desk frame). Ghosts and a closed organization show no pets; at most PET_MAX are drawn, the viewer's own (people[].self) first. See the pets section in mountOfficeScene.
 * Cosmetics (see cosmeticsOf): people[].lvl (0..6, the unlock level), people[].gear ({ head, back, desk }: gear.js ids or null), people[].petToys (the pet may fetch
 * and play with toys). data.shop (the viewer's own unlock state, member town only) together with opts.shop = { save(change, extra) } shows the unlock block
 * and the shop in the viewer's own drawer; change is { gear }, { pet } or { petClear: true }, extra carries { photo } for a pet saved from a photo (kept
 * by the page in this browser only), and save resolves { level, gear, pet } or rejects { code, message }.
 * people[].detail feeds the side drawer (click a person); data.ui holds its strings. opts: { onSeats(id), onPrompts(id), onTeam(id), onServer(), onFail(reason), readOnly }
 * readOnly (the member town, see memberTownData): no Seats / Prompts buttons and no team or server clicks. A person whose detail.redacted is true gets a drawer with a note
 * (ui.redacted) and nothing else, because the server never sent that person's figures.
 * The scene keeps its own bright palette in both page themes. three.js is imported lazily the first time the container scrolls into view.
 * The returned handle also carries view, ready(), people(), server() and selectPerson(id) / closeDrawer() for scripted recordings (video/tour).
 * Day/night and Seoul weather come from sky.js (shared with the town): the light, the backdrop and the lawn follow the local clock, warm lamps and
 * glowing laptop logos take over in the evening, rain/snow/fog/storm play outside the walls, and the HUD chip shows the weather. ?tod= and ?wx= override both. */
import { makePost } from './post.js';
import { makeFur, softNight } from './fur.js?v=f1';
import { parseManifest, pickVariant, pickCell, relAzimuth, elevOk, nightTint, wantVariant, makeSpriteKit, zoomOk, cardOf } from './sprites.js?v=s2';   /* Blender fur sprites of the seated animals; the query keeps the module in step with this file */
import { holidayOn, makeWorldTree, makePresents, makeGarland, makeWreath, santaHat, reindeerAntlers, rudolphNose, noseTipOf } from './holiday.js?v=g6';   /* holiday.js changes often this season and the CDN keeps it 4 h: the query keeps it in step with this file */
import { normalizePetLook, pickPets, petPlan, petHash, makePet, makeBowls, makeToy, makeToyBasket, makePhotoFrame, disposePetShared, PET_MAX, petLookFromPixels, PET_KINDS, PET_PATTERNS, PET_EARS, PET_TAILS, PET_SIZES, PET_NAME_MAX, PET_COAT_MAX, PET_DEFAULTS,
  petPlaySeq, petPlayAt, petSpeedStep, petGait, petRecolor, easeIO, PET_STRIDE, PET_PLAY_Z, mixHex, PET_MARKS, PET_NUMS, petCoatRoles, petApplyBreed, PET_TOYS, PET_TAGS, PET_BODIES, PET_HATS, PET_WINGS } from './pets.js?v=p10';
import * as PETS_NS from './pets.js?v=p10';   /* the same module: read for exports a newer pets.js adds (PET_FURS), without failing to link against an older one */
import { GEAR_ITEMS, makeHeadGear, headGearFit, headGearSkips, placeHeadGear, makeBackGear, backGearFit, backGearSkips, backAnchorOf, placeBackGear, makeDeskItem, disposeGearShared } from './gear.js?v=g5';   /* unlockable head, wing and desk gear; the query keeps the module in step with this file */
import { hourOf, blendAnchors, fetchWeather, weatherFromCode, parseOverrides, chipText, injectSkyCss, starsBackground, clampN, WX_CLEAR } from './sky.js';
/* the gear.js makers a pet's hat and wings are built with (pets.js imports none of them, so the scene hands them in) */
const PET_GEAR = { gear: { head: makeHeadGear, back: makeBackGear, placeHead: placeHeadGear, headFit: headGearFit, placeBack: placeBackGear, backFit: backGearFit } };
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';   /* the +esm build, so the glTF and Draco loaders below share this one three instance */
export const CAST_URL = new URL('./cast/', import.meta.url).href;
export const CAST_Q = '?v=3.127.0-2';   /* the model files change in place and the CDN keeps them 4 h: bump this with the files */
const SPRITE_URL = new URL('./sprites/', import.meta.url).href, SPRITE_Q = new URL(import.meta.url).searchParams.get('v') || '0';   /* the page's query for this file doubles as the manifest's, whose own v is only known after reading it */
let spriteManP = null;
function spriteManifest(){   /* sprites/manifest.json, read once per page; a missing or broken one resolves null and every animal stays a glb */
  if(!spriteManP){
    const p = spriteManP = fetch(SPRITE_URL + 'manifest.json?v=' + SPRITE_Q).then(r => (r.ok ? r.json() : null)).then(j => parseManifest(j, SPRITE_URL)).catch(() => null);
    p.then(m => { if(!m && spriteManP === p) spriteManP = null; });
  }
  return spriteManP;
}
const CAST_DRACO = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/';
/* One glTF loader with the Draco decoder for the cast models, shared by the office and the town (same three build as THREE_URL).
 * A failed import is forgotten, so the next mount tries again. */
let castLoaderP = null;
export function castLoader(){
  if(castLoaderP) return castLoaderP;
  const p = castLoaderP = Promise.all([import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm'), import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/DRACOLoader.js/+esm')])
    .then(([{ GLTFLoader }, { DRACOLoader }]) => { const l = new GLTFLoader(), dr = new DRACOLoader(); dr.setDecoderPath(CAST_DRACO); l.setDRACOLoader(dr); return l; });
  p.catch(() => { if(castLoaderP === p) castLoaderP = null; });
  return p;
}
/* a small gold crown on top of a cast model's head, in model units (the model is scaled after) */
export function castCrown(T){
  const g = new T.Group(), gold = new T.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.3, metalness: 0.6 }), gem = new T.MeshStandardMaterial({ color: '#ff6f91', roughness: 0.25 });
  const band = new T.Mesh(new T.CylinderGeometry(0.13, 0.14, 0.07, 20, 1, true), gold); band.material.side = T.DoubleSide; g.add(band);
  for(let i = 0; i < 5; i++){ const a = i / 5 * Math.PI * 2, c = new T.Mesh(new T.ConeGeometry(0.032, 0.075, 8), gold); c.position.set(Math.sin(a) * 0.125, 0.07, Math.cos(a) * 0.125); g.add(c);
    const b = new T.Mesh(new T.SphereGeometry(0.014, 8, 6), gem); b.position.set(Math.sin(a) * 0.137, 0.0, Math.cos(a) * 0.137); g.add(b); }
  g.position.set(0, 1.04, -0.02); g.rotation.x = -0.12; g.userData.keepLook = true; return g;   /* keepLook: stays drawn in 3D over a sprite (sprites.js shadowOnly) */
}
/* Shared look for every placed cast model (office desks, the picked pose, the town crowd): shadows on, the baked normal map softened
 * (at full strength its noise read as sandy grain on pale fur), and the ghost turned into a pale see-through spirit instead of grey clay.
 * Materials are shared by every clone of a species, so each one is adjusted once (userData.looked). */
/* Shared cast lighting and fur (fur.js): castFxInit runs once three is loaded, then castLook gives every placed model the soft lighting and,
 * where shells are on, the fur. Shells are off on phones and with ?fx=0 (the lighting stays). */
let castFx = null;
export const castFurShells = () => typeof window !== 'undefined' && window.innerWidth >= 520 && !/[?&](fx|fur)=0(&|$)/.test(location.search) ? 16 : 0;
export function castFxInit(T, shells){ if(!castFx || castFx.T !== T || castFx.shells !== shells) castFx = { T, shells, fur: makeFur(T, { shells }) }; return castFx.fur; }
export function castFxNight(n){ if(castFx) castFx.fur.setNight(n); softNight(n); }
export function castFxRelease(root){ if(castFx && root) castFx.fur.release(root); }
export function castFxLod(px){ return castFx ? castFx.fur.lod(px) : 0; }
export function castLook(m, ghost){
  m.traverse(c => {
    if(!c.isMesh) return;
    c.castShadow = !ghost; c.receiveShadow = true;
    const mt = c.material; if(!mt || mt.userData.looked) return; mt.userData.looked = true;
    if(mt.normalMap) mt.normalScale.set(0.55, 0.55);
    if(ghost && mt.map){ mt.normalMap = null; mt.color.set('#eef1ff'); mt.emissive.set('#b9c4ff'); mt.emissiveIntensity = 0.25; mt.transparent = true; mt.opacity = 0.72; mt.needsUpdate = true; }
  });
  if(!ghost && castFx) castFx.fur.apply(m);
  return m;
}
export const W_FULL = [0.5, 0.3, 0.2], W_NOPR = [0.625, 0.375, 0];   /* spend, delegation, prompts rank weights (second set: prompt collection off) */
const MAXP = 500, FAMC = { haiku: '#7fe0b8', sonnet: '#8ec5fb', opus: '#f9a8d4' };
/* spend per model: fixed colours for the known families, grey for any other raw name; known ones first in this order, the rest by value */
export const MODELC = { fable: '#fcd34d', mythos: '#c4b5fd', opus: '#f9a8d4', sonnet: '#8ec5fb', haiku: '#7fe0b8' };
export function modelParts(models){
  if(!models || typeof models !== 'object') return [];
  const ord = Object.keys(MODELC), ents = Object.entries(models).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v) && v > 0);
  const known = ord.map(k => ents.find(e => e[0] === k)).filter(Boolean), rest = ents.filter(e => !ord.includes(e[0])).sort((a, b) => b[1] - a[1]);
  return known.concat(rest).map(([k, v]) => ({ k, v, color: MODELC[k] || '#cbd5e1' }));
}
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
 * and its range text read this table and nothing else. sr = percentile of the overall score (0 lowest, 1 highest), dlg = delegation share
 * (null when unknown), med = the company's median delegation share. A species needs sr >= minSr (sr > minSr when gt), and needDlg also a known
 * dlg >= med (an unknown share never passes it); the first match
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
/* Below SMALL_TEAM.n ranked people the score percentile is squeezed into [lo, hi]: with two people the bottom one would otherwise get 0, the chick, whatever it spent.
 * Copied to src/office-species.js (pinned by test/office-species.test.js). */
export const SMALL_TEAM = { n: 5, lo: 0.3, hi: 0.7 };
export function squeezeSr(sr, n){ return n < SMALL_TEAM.n ? SMALL_TEAM.lo + (SMALL_TEAM.hi - SMALL_TEAM.lo) * sr : sr; }
export const GHOST_GRADE = { k: 'ghost', tier: 'nodata' };
export const TIERS = ['power', 'active', 'normal', 'low'];
const SR_EPS = 1e-9, TIER_GRADE = { power: 'lion', active: 'fox', normal: 'bear', low: 'chick', nodata: 'ghost' };
export const gradeIndex = k => GRADES.findIndex(g => g.k === k);
/* idle: no spend (and no prompts) in the period, which is always the last row */
export function gradeOf(sr, dlg, med, idle){
  if(idle) return GRADES[GRADES.length - 1].k;
  const g = GRADES.find(x => (x.gt ? sr > x.minSr + SR_EPS : sr >= x.minSr - SR_EPS) && (!x.needDlg || (dlg != null && dlg >= med)));
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
 * low enough to lose the faces (applyEnv also clamps it). Exposure is folded into the intensities (the renderer has no tone mapping).
 * 2026-11-11: the sun now outweighs the sky (it used to be the other way round, so a shadow was only about a third darker than the lit side and the
 * room looked flat); the sky is a touch cooler than the sun, and a shadowless rim light from behind the default camera outlines heads and desks. */
const OANC = {
  night: { hs: '#a3acd8', hg: '#6a6585', hi: 0.86, sc: '#aebfff', si: 0.48, sp: [6, 18, 10], c0: '#2b3a78', c1: '#0b1030', out: '#b4bde0', lamp: 1, n: 1 },
  dawn:  { hs: '#f6e8f0', hg: '#e8cdb0', hi: 0.88, sc: '#ffb58a', si: 1.15, sp: [2, 10, 14], c0: '#ffe0cf', c1: '#f0bfae', out: '#fbeee6', lamp: 0.3, n: 0.3 },
  day:   { hs: '#f3f1ff', hg: '#e8dcc4', hi: 0.95, sc: '#fff0d4', si: 1.35, sp: [8, 18, 6], c0: '#fffaf0', c1: '#f6ead2', out: '#ffffff', lamp: 0, n: 0 },
  dusk:  { hs: '#f2dcd6', hg: '#d9b0a0', hi: 0.86, sc: '#ff9460', si: 1.28, sp: [14, 10, 2], c0: '#ffd5b0', c1: '#e5a186', out: '#f0d6cc', lamp: 0.65, n: 0.45 }
};
const HEAD_YAW = 0;   /* straight at the camera: the seats face +z, so a resting head already shows its face */
/* The laptop on every desk: its lid back faces the camera and carries a logo that follows the person's OS. mac and darwin get the apple, windows the four panes, anything else (linux, unknown, empty) a plain dot. */
export function laptopKind(os){
  const v = String(os == null ? '' : os).toLowerCase();
  if(/mac|darwin|os\s*x/.test(v)) return 'mac';   /* before the windows test: "darwin" contains "win" */
  if(/win/.test(v)) return 'win';
  return 'other';
}
const LAPTOP_COL = { mac: '#d4d7dc', win: '#3a3f48', other: '#a3a8b2' };
/* logo outlines in a unit box (about -0.5..0.5 on both axes), scaled per kind; ShapeGeometry lies in the XY plane and faces +z */
function appleShapes(T){
  const a = new T.Shape(), l = new T.Shape();
  a.moveTo(0.02, 0.30);
  a.bezierCurveTo(-0.12, 0.43, -0.48, 0.38, -0.49, -0.04); a.bezierCurveTo(-0.50, -0.32, -0.31, -0.57, -0.16, -0.55);
  a.bezierCurveTo(-0.08, -0.54, -0.04, -0.47, 0.04, -0.47); a.bezierCurveTo(0.12, -0.47, 0.17, -0.55, 0.27, -0.55);
  a.bezierCurveTo(0.40, -0.54, 0.52, -0.34, 0.51, -0.24);
  a.bezierCurveTo(0.33, -0.18, 0.31, 0.06, 0.47, 0.12);   /* the bite */
  a.bezierCurveTo(0.44, 0.32, 0.18, 0.42, 0.02, 0.30);
  l.moveTo(0.04, 0.34); l.bezierCurveTo(0.04, 0.52, 0.14, 0.62, 0.30, 0.62); l.bezierCurveTo(0.30, 0.46, 0.20, 0.34, 0.04, 0.34);
  return [a, l];
}
function paneShapes(T){
  return [[-0.5, 0.04], [0.04, 0.04], [-0.5, -0.5], [0.04, -0.5]].map(([x, y]) => { const r = new T.Shape(); r.moveTo(x, y); r.lineTo(x + 0.46, y); r.lineTo(x + 0.46, y + 0.46); r.lineTo(x, y + 0.46); r.closePath(); return r; });
}
function dotShape(T){ const c = new T.Shape(); c.absarc(0, 0, 0.5, 0, Math.PI * 2, false); return [c]; }
const HS = 1.3, HEAD_Y = 1.84;   /* heads are drawn 1.3 times bigger than the body (chibi proportions), so ears, horns and manes stay readable at the default zoom */
const BOT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2v2" stroke="#8b7cf0" stroke-width="1.2" stroke-linecap="round"/><circle cx="8" cy="2" r="1.1" fill="#8b7cf0"/><circle cx="8" cy="9.4" r="5.4" fill="#c4b5fd"/><circle cx="6.1" cy="9" r="1" fill="#fff"/><circle cx="9.9" cy="9" r="1" fill="#fff"/></svg>';
const PAW_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="10.6" rx="3.4" ry="2.8" fill="currentColor"/><circle cx="3.6" cy="7" r="1.5" fill="currentColor"/><circle cx="6.1" cy="4.4" r="1.5" fill="currentColor"/><circle cx="9.9" cy="4.4" r="1.5" fill="currentColor"/><circle cx="12.4" cy="7" r="1.5" fill="currentColor"/></svg>';
const BOOK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.2c2-.8 3.9-.6 5.5.6v9c-1.6-1.2-3.5-1.4-5.5-.6zM13.5 3.2c-2-.8-3.9-.6-5.5.6v9c1.6-1.2 3.5-1.4 5.5-.6z"/></svg>';
export const iconSvg = k => (k === 'crown' ? CROWN_ICON : (k === 'ghost' ? GHOST : ANIMALS[k] || { icon: '' }).icon);
/* 3D thumbnails of the cast: one atlas rendered in Blender from the standing models (tools/blender/render_thumbs.py), 8 columns x 4 rows of
 * 160 px cells in GRADES order, then the ghost. speciesThumb(k) is a span showing that cell; each place sets its size with --px in CSS.
 * The SVG icon inside it shows only when the atlas fails to load (class of-noatlas on <html>), so a blocked file never leaves blanks. */
export const ATLAS_URL = CAST_URL + 'atlas.webp' + CAST_Q, ATLAS_KEYS = GRADES.map(g => g.k).concat('ghost');
let atlasProbe = false;
export function speciesThumb(k, style = ''){
  if(!atlasProbe && typeof Image !== 'undefined'){ atlasProbe = true; const im = new Image(); im.onerror = () => document.documentElement.classList.add('of-noatlas'); im.src = ATLAS_URL; }
  const i = ATLAS_KEYS.indexOf(k); if(i < 0) return iconSvg(k);
  return `<span class="of-th" style="--c:${i % 8};--r:${Math.floor(i / 8)}${style ? ';' + style : ''}" aria-hidden="true">${iconSvg(k)}</span>`;
}

export const OF_CSS = `
.of-th{--px:24px;display:inline-block;flex:none;width:var(--px);height:var(--px);vertical-align:middle;background:url("${ATLAS_URL}") no-repeat;background-size:calc(var(--px) * 8) calc(var(--px) * 4);background-position:calc(var(--px) * var(--c) * -1) calc(var(--px) * var(--r) * -1)}
.of-th svg{display:none}.of-noatlas .of-th{background-image:none}.of-noatlas .of-th svg{display:block;width:100%;height:100%}
.of-strip .sp .of-th{--px:24px;margin:-3px 0;vertical-align:-7px}.of-strip .sp.z .of-th{filter:brightness(0);opacity:.34}
.of-legend .keys .of-th{--px:18px;margin-right:5px;vertical-align:-4px}
.of-drawer .hd .of-th{--px:48px;border-radius:50%;background-color:#f7f1e4;box-shadow:0 0 0 2px #fffdf8,0 0 0 4px var(--tc,#d9cdb8)}
.of-drawer .bkp .of-th{--px:30px;border-radius:50%;background-color:#f7f1e4}
.of-drawer .bkr .of-th{--px:46px;grid-area:i;border-radius:12px;background-color:rgba(255,255,255,.75)}.of-drawer .bkr.z .of-th{filter:brightness(0);opacity:.14}
.of-card{padding:0!important;overflow:hidden;margin-bottom:var(--s4,16px)}
.of-stage{position:relative;height:520px;overflow:hidden;contain:layout paint;background:#fffaf0;color:#6a5a4a}
.of-stage canvas{display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab}
.of-stage canvas:focus:not(:focus-visible){outline:none}
.of-stage canvas.drag{cursor:grabbing}.of-stage canvas.hit{cursor:pointer}
.of-hud{position:absolute;left:16px;top:12px;right:16px;pointer-events:none;font-size:12px;line-height:1.45;z-index:2;color:#6a5a4a;text-shadow:0 0 3px #fffaf0,0 0 9px #fffaf0}
.of-stage.sk-night .of-hud{text-shadow:0 0 3px #10142e,0 0 9px #10142e}
.of-hud b{display:block;font-size:15px;font-weight:600;color:#3a2f27;letter-spacing:-.01em}
.of-hud em{font-style:normal;margin-left:8px;font-size:11px;font-weight:600;color:#b4443f;border:1px solid currentColor;border-radius:999px;padding:1px 8px;vertical-align:2px;background:#fff}
.of-legend{position:absolute;left:12px;right:auto;max-width:calc(100% - 24px);bottom:8px;display:flex;flex-direction:column;align-items:flex-start;background:#fff;border:1px solid rgba(16,24,32,.18);border-radius:12px;padding:5px 12px;flex-wrap:wrap;gap:3px 16px;font-size:12.5px;line-height:1.5;color:#3a2f27;pointer-events:none;z-index:2}
.of-legend:empty,.of-legend:has(>.keys:empty:only-child){display:none}
.of-stage.sk-night .of-legend.of-legend{background:#1e2650;border-color:rgba(160,180,255,.3);color:#e8ecff}.of-stage.sk-night .of-strip b{color:#f2f4ff}.of-stage.sk-night .of-strip{border-bottom-color:rgba(160,180,255,.28)}
.of-stage.sk-night .of-strip .t-power em{color:#ffd27a}.of-stage.sk-night .of-strip .t-active em{color:#9fd0ff}.of-stage.sk-night .of-strip .t-normal em{color:#ddd3c4}.of-stage.sk-night .of-strip .t-low em{color:#ffb08a}
.of-stage.sk-night .of-strip .sp.z .of-th{filter:brightness(0) invert(1);opacity:.42}
.of-legend .keys{display:flex;flex-wrap:wrap;gap:2px 14px}.of-legend .keys .fm{margin:0 3px 0 8px}
.of-strip{pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;gap:3px 12px;font:inherit;color:inherit;background:none;border:0;padding:2px 0 4px;margin:0;cursor:pointer;text-align:left;border-bottom:1px solid rgba(120,90,60,.22)}
.of-strip .sbk,.of-strip button.sp{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;border-radius:6px}.of-strip button.sp:hover,.of-strip button.sp:focus-visible{background:rgba(124,108,240,.16);outline:none}.of-strip button.sp:hover svg{transform:scale(1.18)}.of-strip .sp svg{transition:transform .15s}
.of-strip .sbk:hover b,.of-strip .sbk:focus-visible b{color:#6d28d9}.of-strip b{font-weight:600;color:#3a2f27;white-space:nowrap}.of-strip b svg{width:14px;height:14px;margin-right:4px;vertical-align:-2px}
.of-strip .tg{display:inline-flex;align-items:center;gap:1px;white-space:nowrap}.of-strip .tg em{font-style:normal;font-weight:700;font-size:12px;margin-right:5px}
.of-strip .t-power em{color:#8f5a0b}.of-strip .t-active em{color:#14599a}.of-strip .t-normal em{color:#5a4d3d}.of-strip .t-low em{color:#a8360a}
.of-strip .sp svg{width:17px;height:17px;margin:0;vertical-align:-4px}.of-strip .sp.z svg{filter:grayscale(1);opacity:.5}
.of-legend span{white-space:nowrap}
.of-legend svg{width:16px;height:16px;vertical-align:-4px;margin-right:5px}
.of-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:-1px;box-shadow:0 0 0 2px rgba(255,255,255,.7)}
.of-lbl,.of-btn,.of-bub,.of-tag{position:absolute;left:0;top:0;white-space:nowrap;will-change:transform;z-index:1}
.of-lbl,.of-btn,.of-tag{font:inherit;font-size:12px;font-weight:600;line-height:1;color:#3a2f27;padding:5px 10px;border-radius:999px;border:1px solid rgba(120,90,60,.16);background:rgba(255,255,255,.94);box-shadow:none}
.of-lbl{pointer-events:none;background:none;border:0;box-shadow:none;padding:2px 4px;color:#6a5a4a;}
.of-btn:hover,.of-btn:focus-visible{border-color:#8b7cf0;box-shadow:none}
.of-btn{max-width:240px;overflow:hidden;text-overflow:ellipsis;z-index:2}.of-btn.srv{max-width:none;background:var(--accent,#6667AB);color:#fff;border-radius:9px;border-color:rgba(255,255,255,.35)}
.of-sign{color:#b4443f;font-size:14px}
.of-bub{pointer-events:none;font-size:11px;line-height:1;color:#3a2f27;background:#fff;padding:5px 10px;border-radius:999px;box-shadow:none;opacity:0;transition:opacity .35s ease}
.of-bub.ai{background:#f1ebff;color:#4c1d95}.of-bub.on{opacity:1}
.of-tip{position:absolute;left:0;top:0;z-index:4;pointer-events:none;min-width:170px;max-width:260px;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.55;background:#fff;border:1px solid rgba(120,90,60,.16);color:#3a2f27;box-shadow:none}
.of-tip b{display:block;font-weight:600;overflow-wrap:anywhere}
.of-tip div{display:flex;justify-content:space-between;gap:12px;color:#6a5a4a}
.of-tip div span:last-child{color:#3a2f27;text-align:right}
.of-tip .tier{margin-top:2px;font-weight:600}
.of-tip .t-power{color:#6d28d9}.of-tip .t-active{color:#1d6fb8}.of-tip .t-normal{color:#6b6256}.of-tip .t-low{color:#b45309}.of-tip .t-nodata{color:#6b7280}
.of-tools{position:absolute;top:10px;right:10px;z-index:6;display:flex;gap:6px;transition:right .28s cubic-bezier(.23,1,.32,1)}
.of-tb{width:32px;height:32px;border-radius:50%;border:1px solid rgba(120,90,60,.18);background:rgba(255,255,255,.94);color:#3a2f27;box-shadow:none;display:grid;place-items:center;padding:0;font:600 17px/1 inherit}
.of-tb:hover,.of-tb:focus-visible{border-color:#8b7cf0}.of-tb svg{width:16px;height:16px}
.of-hint{position:absolute;left:50%;bottom:46px;transform:translateX(-50%);z-index:6;background:#101820;color:#fff;font-size:12px;padding:5px 12px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .4s;white-space:nowrap}.of-hint.on{opacity:1}
.of-card:fullscreen,.of-card:-webkit-full-screen{width:100%;height:100%;margin:0;border-radius:0;background:#f6ead2}
.of-card:fullscreen .of-stage,.of-card:-webkit-full-screen .of-stage,.of-card.of-fsx .of-stage{height:100vh;height:100dvh}
.of-card.of-fsx{position:fixed;inset:0;z-index:1000;margin:0;border-radius:0;border:0;background:#f6ead2}
.of-drawer{position:absolute;top:0;right:0;bottom:0;width:420px;max-width:100%;z-index:5;display:flex;flex-direction:column;background:#fffdf8;border-left:1px solid rgba(120,90,60,.16);box-shadow:none;color:#3a2f27;font-size:12.5px;line-height:1.5;transform:translateX(100%);visibility:hidden;transition:transform .28s cubic-bezier(.23,1,.32,1),visibility 0s .28s}
.of-drawer.open{transform:none;visibility:visible;transition:transform .28s cubic-bezier(.23,1,.32,1)}
.of-drawer .hd{display:flex;align-items:center;gap:10px;padding:14px 14px 10px;border-bottom:1px solid rgba(120,90,60,.12)}
.of-drawer .hd svg{width:30px;height:30px;flex:none}.of-drawer .hd div{min-width:0;flex:1}
.of-drawer .hd b{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.of-drawer .hd small{display:block;color:#6a5a4a;font-size:11.5px}
.of-drawer .bkbar{padding:8px 14px 0}.of-drawer .bk{flex:none;border:1px solid rgba(120,90,60,.22);background:#fff;font:inherit;font-size:12px;font-weight:600;color:#3a2f27;padding:5px 11px;border-radius:999px;white-space:nowrap;cursor:pointer}.of-drawer .bk:hover{border-color:#8b7cf0}
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
.of-drawer .ch .vl{position:absolute;transform:translate(-50%,-100%);margin-top:-2px;font-size:10px;line-height:1;font-weight:600;color:#5a4a3c;white-space:nowrap;pointer-events:none;font-variant-numeric:tabular-nums}.of-drawer .ch .vl.last{transform:translate(-80%,-100%)}
.of-drawer .ax{display:flex;justify-content:space-between;font-size:10px;color:#9a8a7a;margin-top:2px;font-variant-numeric:tabular-nums}.of-drawer .leg b{font-weight:600;color:#3a2f27;margin-left:2px}
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
.of-dbtn.out{background:#fff;border-color:#bfb2f2;color:#4c1d95}.of-dbtn.plain{background:#fff;border-color:#d9cdb8;color:#3a2f27}   /* out: a secondary action (Decorate); plain: a neutral one (Cancel), never read as a disabled Save */
.of-stage.has-drawer .of-tools{right:430px}
.of-stage .of-pcard{position:absolute;right:430px;top:50%;width:252px;height:352px;box-sizing:border-box;padding:7px;transform:translate(16px,-50%);opacity:0;z-index:4;pointer-events:none;border-radius:16px;--tc:#d9cdb8;--rx:0deg;--ry:0deg;--mx:50%;--my:50%;background:linear-gradient(145deg,color-mix(in srgb,var(--tc) 50%,#fff) 0,color-mix(in srgb,var(--tc) 80%,#5a4630) 50%,color-mix(in srgb,var(--tc) 45%,#fff) 100%);box-shadow:0 14px 34px rgba(60,40,20,.28),0 0 0 1px rgba(60,40,20,.28),inset 0 0 0 1px rgba(255,255,255,.6);transition:opacity .3s,transform .3s cubic-bezier(.23,1,.32,1),--mx .3s cubic-bezier(.23,1,.32,1),--my .3s cubic-bezier(.23,1,.32,1);color:#2e241c;font-size:11px;line-height:1.3}
.of-stage .of-pcard.on{opacity:1;pointer-events:auto;transform:translate(0,-50%) perspective(900px) rotateX(var(--rx)) rotateY(var(--ry))}
.of-stage .of-pcard.tilt{transition:opacity .3s,transform .08s linear,--mx 0s,--my 0s}
@property --mx{syntax:'<percentage>';inherits:true;initial-value:50%}
@property --my{syntax:'<percentage>';inherits:true;initial-value:50%}   /* registered so that on pointer leave the glare and the foil ease back to the middle with the tilt */
.of-pcard.t-power,.of-pcard.crown{background:linear-gradient(125deg,#f3cf6e 0,#fff4c8 22%,#d9b8ff 45%,#9fdcff 62%,#fff1b8 80%,#e2b452 100%)}
.of-pcard .pc-in{position:relative;height:100%;box-sizing:border-box;border-radius:10px;padding:6px 8px 5px;display:flex;flex-direction:column;gap:4px;overflow:hidden;background:linear-gradient(180deg,color-mix(in srgb,var(--tc) 28%,#fffdf6) 0,#fffaf0 55%,color-mix(in srgb,var(--tc) 18%,#fffaf0) 100%)}
.of-pcard .pc-hd{display:flex;align-items:center;gap:6px;min-height:20px}
.of-pcard .pc-hd b{flex:1;min-width:0;font-size:14.5px;font-weight:800;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.of-pcard .rk{flex:none;display:flex;align-items:center;gap:1px;font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;color:color-mix(in srgb,var(--tc) 35%,#3a1f10)}.of-pcard .rk small{font-size:11px;font-weight:700;opacity:.7}.of-pcard .rk svg{width:15px;height:15px;margin-right:2px}
.of-pcard .pc-art{position:relative;height:196px;flex:none;border-radius:4px;overflow:hidden;background:radial-gradient(ellipse 70% 62% at 50% 44%,#fffef8 0,color-mix(in srgb,var(--tc) 42%,#fff6e6) 68%,color-mix(in srgb,var(--tc) 72%,#8a6a48) 100%)}
.of-pcard .pc-art::before{content:"";position:absolute;inset:-40%;background:repeating-conic-gradient(from 0deg at 50% 46%,rgba(255,255,255,.26) 0 5deg,transparent 5deg 15deg)}
.of-pcard .pc-art::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--tc) 60%,#8a6a48),inset 0 0 0 3px rgba(255,255,255,.6),inset 0 8px 16px rgba(60,40,20,.16)}
.of-pcard .pc-holo{position:absolute;inset:0;display:none;background:repeating-linear-gradient(115deg,#ff9ad5 0,#ffe28a 6%,#9dffb5 12%,#8fd8ff 18%,#c8a2ff 24%,#ff9ad5 30%);background-size:300% 300%;background-position:var(--mx) var(--my);mix-blend-mode:multiply;opacity:.32;animation:pc-holo 9s linear infinite}
.of-pcard.t-power .pc-holo,.of-pcard.crown .pc-holo{display:block}.of-pcard.tilt .pc-holo{animation:none}
@keyframes pc-holo{from{background-position:0 50%}to{background-position:300% 50%}}
.of-pcard .pc-floor{position:absolute;left:50%;bottom:6px;width:130px;height:20px;margin-left:-65px;border-radius:50%;background:radial-gradient(closest-side,rgba(60,40,20,.3),transparent)}
.of-pcard canvas{position:absolute;left:27px;top:-16px;width:168px;height:224px}
.of-pcard .pc-sp{display:flex;gap:8px;justify-content:center;font-size:9.5px;font-style:italic;font-weight:600;color:#6a5a4a;white-space:nowrap;overflow:hidden;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--tc) 40%,#fff3dc),transparent)}
.of-pcard .pc-mv{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
.of-pcard .pc-mv div{display:flex;align-items:center;gap:7px;padding:3px 2px;border-bottom:1px solid rgba(90,60,30,.14)}.of-pcard .pc-mv div:last-child{border-bottom:0}
.of-pcard .pc-mv i{flex:none;width:13px;height:13px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff 0,var(--tc) 55%,color-mix(in srgb,var(--tc) 60%,#3a2410) 100%);box-shadow:0 0 0 1px rgba(60,40,20,.3)}
.of-pcard .pc-mv span{flex:1;min-width:0;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.of-pcard .pc-mv b{flex:none;font-size:13px;font-weight:800;font-variant-numeric:tabular-nums}
.of-pcard .pc-ft{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:9px;font-weight:600;color:#7a6a5a;white-space:nowrap}.of-pcard .rar{font-size:10px;letter-spacing:1px;color:color-mix(in srgb,var(--tc) 45%,#3a2410)}
.of-pcard .pc-glare{position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .3s;mix-blend-mode:soft-light;background:radial-gradient(circle at var(--mx) var(--my),rgba(255,255,255,.7) 0,rgba(255,255,255,0) 50%)}.of-pcard.tilt .pc-glare{opacity:1}
@media (prefers-reduced-motion:reduce){.of-pcard .pc-holo{animation:none}}
@media (max-width:899px){.of-stage .of-pcard{display:none}}
@media (max-width:480px){.of-drawer{top:auto;left:0;right:0;width:auto;height:72%;border-left:0;border-top:1px solid rgba(120,90,60,.16);border-radius:16px 16px 0 0;box-shadow:none;transform:translateY(100%)}.of-stage.has-drawer .of-tools{right:10px}}
@media (max-width:480px){.of-card:not(:fullscreen):not(.of-fsx) .of-stage.has-drawer{height:640px}.of-card:not(:fullscreen):not(.of-fsx) .of-stage.has-drawer canvas{height:300px}.of-card:not(:fullscreen):not(.of-fsx) .of-stage.has-drawer .of-drawer{height:calc(100% - 300px)}}
/* field guide */
.of-drawer .bkn{margin:0 0 10px;font-size:12px;color:#6a5a4a}
.of-drawer .bkr{display:grid;grid-template-columns:46px 1fr auto;grid-template-areas:'i n c' 'i r r';gap:1px 10px;align-items:center;width:100%;text-align:left;font:inherit;color:#3a2f27;background:#f7f1e4;border:1px solid transparent;border-radius:12px;padding:8px 10px;margin:0 0 6px;cursor:pointer}
.of-drawer .bkr:hover,.of-drawer .bkr:focus-visible{border-color:#8b7cf0}
.of-drawer .bkr svg{grid-area:i;width:26px;height:26px}.of-drawer .bkr .nm{grid-area:n;font-weight:600;font-size:13px}.of-drawer .bkr .nm small{font-weight:400;font-size:11.5px;color:#6a5a4a;margin-left:6px}
.of-drawer .bkr .rg{grid-area:r;font-size:11.5px;color:#6a5a4a}.of-drawer .bkr .ct2{grid-area:c;font-weight:600;font-variant-numeric:tabular-nums;font-size:13px}
.of-drawer .bkr.z{opacity:.5}.of-drawer .bkr.z svg{filter:grayscale(1) brightness(.6) contrast(.6)}
.of-drawer .bkr .no{display:inline-block;min-width:40px;margin:0 6px 0 0;font-weight:600;font-size:11px;color:#8b7cf0;font-variant-numeric:tabular-nums}
.of-drawer .bkh{margin:14px 0 6px;font-size:11.5px;color:#3a2f27}
.of-drawer .bkt{margin:0 0 6px;padding:8px 10px 4px;border-radius:12px;background:#fff4d6}.of-drawer .bkt h4{margin:0 0 6px;font-size:11.5px;color:#3a2f27}
.of-drawer .bkp{display:grid;grid-template-columns:30px 30px 1fr auto;align-items:center;gap:8px;width:100%;text-align:left;font:inherit;color:#3a2f27;background:rgba(255,255,255,.7);border:1px solid transparent;border-radius:10px;padding:5px 8px;margin:0 0 4px;cursor:pointer}
.of-drawer .bkp:hover,.of-drawer .bkp:focus-visible{border-color:#8b7cf0}.of-drawer .bkp svg{width:22px;height:22px}.of-drawer .bkp .rk{font-weight:700;font-size:12.5px;font-variant-numeric:tabular-nums;color:#6d28d9}
.of-drawer .bkp .nm{min-width:0;font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.of-drawer .bkp .nm small{display:block;font-weight:400;font-size:11px;color:#6a5a4a}
.of-drawer .nx{margin:-4px 0 12px;padding:8px 10px;border-radius:10px;background:#fff4d6;color:#5a3d0a;font-size:12px}.of-drawer .nx .h{font-weight:600}
.of-drawer .hd b svg{width:16px;height:16px;margin-right:4px;vertical-align:-2px}
.of-drawer .bknote{margin:12px 0 0;padding:8px 10px;border-radius:10px;background:#f1ebff;color:#3b2a78;font-size:12px}
.of-drawer .grp{margin:0 0 14px}.of-drawer .grp+.grp{margin-top:18px;padding-top:12px;border-top:1px dashed rgba(120,90,60,.22)}.of-drawer .grp>h4{margin:0 0 6px;font-size:11.5px;color:#3a2f27}
/* unlock levels on the profile card (lv-1..lv-6 sit beside the tier and crown classes), each one told apart in a still image of the same tier:
   1 a soft inner border; 2 a double border with corner studs; 3 a gold foil frame with the studs and a sheen that follows the pointer; 4 a holographic frame,
   jewelled corners and a border of small stars; 5 the same frame turning faster in brighter colours with a glow that pulses; 6 a gold and flame frame turning
   with a golden glow that pulses. The frame layers (pc-foil, pc-star) are masked to the 7 px frame, so the art and the text never change.
   The hologram is one pre-drawn conic layer turned by a transform (no repaint per frame), paused while the card is tilted like pc-holo */
.of-pcard .pc-orn,.of-pcard .pc-foil,.of-pcard .pc-spk,.of-pcard .pc-star{position:absolute;inset:0;border-radius:inherit;pointer-events:none;display:none}
.of-pcard .pc-foil,.of-pcard .pc-star{padding:7px;overflow:hidden;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}
.of-pcard.lv-1 .pc-in{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--tc) 55%,#fff),inset 0 0 10px color-mix(in srgb,var(--tc) 35%,transparent)}
.of-pcard.lv-2 .pc-in,.of-pcard.lv-3 .pc-in,.of-pcard.lv-4 .pc-in,.of-pcard.lv-5 .pc-in,.of-pcard.lv-6 .pc-in{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--tc) 60%,#8a6a48),inset 0 0 0 4px #fffaf0,inset 0 0 0 5px color-mix(in srgb,var(--tc) 70%,#c99a3e)}
.of-pcard.lv-2 .pc-orn,.of-pcard.lv-3 .pc-orn{display:block;z-index:2;--oc:color-mix(in srgb,var(--tc) 30%,#b9852a);background:radial-gradient(circle at 8.5px 8.5px,#fffaf0 0 1.3px,var(--oc) 1.7px 3.4px,transparent 3.9px),radial-gradient(circle at calc(100% - 8.5px) 8.5px,#fffaf0 0 1.3px,var(--oc) 1.7px 3.4px,transparent 3.9px),radial-gradient(circle at 8.5px calc(100% - 8.5px),#fffaf0 0 1.3px,var(--oc) 1.7px 3.4px,transparent 3.9px),radial-gradient(circle at calc(100% - 8.5px) calc(100% - 8.5px),#fffaf0 0 1.3px,var(--oc) 1.7px 3.4px,transparent 3.9px)}
.of-pcard.lv-3 .pc-foil{display:block;z-index:0;background:linear-gradient(115deg,transparent 34%,rgba(255,255,255,.9) 47%,transparent 60%) var(--mx) var(--my)/240% 240%,linear-gradient(135deg,#f6e3a1 0,#c9952e 20%,#fff1c2 40%,#b07f22 58%,#f3d27a 78%,#c08a2a 100%)}
.of-pcard.lv-4 .pc-foil,.of-pcard.lv-5 .pc-foil,.of-pcard.lv-6 .pc-foil{display:block;z-index:0;background:#efe4ff}
.of-pcard.lv-6 .pc-foil{background:#3b0d05}
.of-pcard.lv-4 .pc-foil::before,.of-pcard.lv-5 .pc-foil::before,.of-pcard.lv-6 .pc-foil::before{content:"";position:absolute;left:50%;top:50%;width:190%;aspect-ratio:1;background:conic-gradient(#ff8fcf,#ffd96b,#8ff0a8,#7fd0ff,#b996ff,#ff8fcf);transform:translate(-50%,-50%);animation:pc-spin 14s linear infinite}
.of-pcard.lv-4 .pc-foil::after,.of-pcard.lv-5 .pc-foil::after,.of-pcard.lv-6 .pc-foil::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 34%,rgba(255,255,255,.75) 47%,transparent 60%) var(--mx) var(--my)/240% 240%}
.of-pcard.lv-5 .pc-foil::before{background:conic-gradient(#ff4fc0,#ffe84a,#4dffa0,#3fd0ff,#8a63ff,#ff4fc0);animation-duration:8s}
.of-pcard.lv-6 .pc-foil::before{background:conic-gradient(#ffd24a,#ff7a1a,#e0112b,#ff7a1a,#ffd24a,#fff3b0,#ffd24a);animation-duration:7s}
.of-pcard.lv-6 .pc-foil::after{background:linear-gradient(115deg,transparent 34%,rgba(255,244,196,.85) 47%,transparent 60%) var(--mx) var(--my)/240% 240%}
.of-pcard.tilt .pc-foil::before{animation-play-state:paused}
.of-pcard.lv-4 .pc-star,.of-pcard.lv-5 .pc-star,.of-pcard.lv-6 .pc-star{display:block;z-index:1;--st:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M5 .6l1.3 2.7 3 .4-2.2 2.1.5 3L5 7.4 2.4 8.8l.5-3L.7 3.7l3-.4z' fill='%23fff' stroke='%23b8862a' stroke-width='.6'/%3E%3C/svg%3E");background:var(--st) 0 0/7px 7px space no-repeat,var(--st) 0 100%/7px 7px space no-repeat,var(--st) 0 0/7px 7px no-repeat space,var(--st) 100% 0/7px 7px no-repeat space;opacity:.95}
.of-pcard.lv-4 .pc-orn,.of-pcard.lv-5 .pc-orn,.of-pcard.lv-6 .pc-orn{display:block;z-index:2;background:radial-gradient(circle at 10px 10px,#fff 0 1.2px,#ff5c8a 1.8px 3.2px,#a3123f 4.6px,#f6d77c 5px 6.4px,#8a5a12 6.9px,transparent 7.3px),radial-gradient(circle at calc(100% - 10px) 10px,#fff 0 1.2px,#5cb8ff 1.8px 3.2px,#124a8a 4.6px,#f6d77c 5px 6.4px,#8a5a12 6.9px,transparent 7.3px),radial-gradient(circle at 10px calc(100% - 10px),#fff 0 1.2px,#5fe3a0 1.8px 3.2px,#0f6b43 4.6px,#f6d77c 5px 6.4px,#8a5a12 6.9px,transparent 7.3px),radial-gradient(circle at calc(100% - 10px) calc(100% - 10px),#fff 0 1.2px,#c58cff 1.8px 3.2px,#5a1fa0 4.6px,#f6d77c 5px 6.4px,#8a5a12 6.9px,transparent 7.3px)}
.of-pcard.lv-4 .pc-spk,.of-pcard.lv-5 .pc-spk,.of-pcard.lv-6 .pc-spk{display:block;z-index:3}
.of-pcard.lv-4 .pc-spk::before,.of-pcard.lv-4 .pc-spk::after,.of-pcard.lv-5 .pc-spk::before,.of-pcard.lv-5 .pc-spk::after,.of-pcard.lv-6 .pc-spk::before,.of-pcard.lv-6 .pc-spk::after{content:"";position:absolute;inset:0;border-radius:inherit;animation:pc-spk 3.6s ease-in-out infinite}
.of-pcard.lv-4 .pc-spk::before,.of-pcard.lv-5 .pc-spk::before,.of-pcard.lv-6 .pc-spk::before{background:radial-gradient(circle,#fff 0 1.4px,transparent 2px) 6% 18%/9px 9px no-repeat,radial-gradient(circle,#fff6c8 0 1.5px,transparent 2px) 3% 78%/9px 9px no-repeat,radial-gradient(circle,#fff 0 1.2px,transparent 1.8px) 50% 1.5%/8px 8px no-repeat}
.of-pcard.lv-4 .pc-spk::after,.of-pcard.lv-5 .pc-spk::after,.of-pcard.lv-6 .pc-spk::after{background:radial-gradient(circle,#fff6c8 0 1.6px,transparent 2.2px) 96% 40%/10px 10px no-repeat,radial-gradient(circle,#fff 0 1.3px,transparent 1.9px) 94% 92%/9px 9px no-repeat,radial-gradient(circle,#fff 0 1.2px,transparent 1.8px) 30% 99%/8px 8px no-repeat;animation-duration:4.4s;animation-delay:-1.9s}
@keyframes pc-spin{to{transform:translate(-50%,-50%) rotate(360deg)}}
@keyframes pc-spk{0%,100%{opacity:.2}50%{opacity:1}}
.of-pcard.lv-5{animation:pc-glow5 3.2s ease-in-out infinite}.of-pcard.lv-6{animation:pc-glow6 2.6s ease-in-out infinite}
@keyframes pc-glow5{0%,100%{box-shadow:0 14px 34px rgba(60,40,20,.28),0 0 0 1px rgba(60,40,20,.28),inset 0 0 0 1px rgba(255,255,255,.6),0 0 8px 0 rgba(168,120,255,.3)}50%{box-shadow:0 14px 34px rgba(60,40,20,.28),0 0 0 1px rgba(60,40,20,.28),inset 0 0 0 1px rgba(255,255,255,.6),0 0 20px 3px rgba(255,120,220,.55)}}
@keyframes pc-glow6{0%,100%{box-shadow:0 14px 34px rgba(60,40,20,.28),0 0 0 1px rgba(60,40,20,.28),inset 0 0 0 1px rgba(255,255,255,.6),0 0 10px 1px rgba(255,190,60,.4)}50%{box-shadow:0 14px 34px rgba(60,40,20,.28),0 0 0 1px rgba(60,40,20,.28),inset 0 0 0 1px rgba(255,255,255,.6),0 0 26px 5px rgba(255,150,30,.7)}}
.of-pcard .lvb{flex:none;padding:1px 6px;border-radius:999px;font-size:10.5px;line-height:1.25;font-weight:800;color:#fff;background:#5b46d6}
.of-pcard.lv-3 .lvb,.of-pcard.lv-4 .lvb,.of-pcard.lv-5 .lvb,.of-pcard.lv-6 .lvb{color:#ffe08a;background:#3a2410;box-shadow:inset 0 0 0 1px #c99a3e}
@media (prefers-reduced-motion:reduce){.of-pcard.lv-4 .pc-foil,.of-pcard.lv-4 .pc-spk,.of-pcard.lv-5,.of-pcard.lv-6{animation:none}.of-pcard.lv-4 .pc-foil::before,.of-pcard.lv-5 .pc-foil::before,.of-pcard.lv-6 .pc-foil::before,.of-pcard.lv-4 .pc-spk::before,.of-pcard.lv-4 .pc-spk::after,.of-pcard.lv-5 .pc-spk::before,.of-pcard.lv-5 .pc-spk::after,.of-pcard.lv-6 .pc-spk::before,.of-pcard.lv-6 .pc-spk::after{animation:none}.of-pcard.lv-4 .pc-spk::before,.of-pcard.lv-4 .pc-spk::after,.of-pcard.lv-5 .pc-spk::before,.of-pcard.lv-5 .pc-spk::after,.of-pcard.lv-6 .pc-spk::before,.of-pcard.lv-6 .pc-spk::after{opacity:.8}}
.of-drawer .badge.lvb{background:#5b46d6;color:#fff}
/* the unlock block and the shop (the viewer's own drawer on the member page) */
.of-drawer .ulk{margin:0 0 16px;padding:10px 12px 12px;border-radius:12px;background:#fff;border:1px solid rgba(120,90,60,.22);box-shadow:0 1px 2px rgba(60,40,20,.06)}   /* neutral, so it reads apart from the lavender strip under it */
.of-drawer .ulk-h{display:flex;align-items:center;flex-wrap:wrap;gap:4px 6px;margin:0 0 6px;font-size:12.5px}.of-drawer .ulk-h .badge{margin-left:0}.of-drawer .ulk-h small{flex:1 1 auto;text-align:right;font-size:11px;color:#6a5a4a}
.of-drawer .ulk-r{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:#5a4a3c;margin-top:6px}.of-drawer .ulk-r b{font-weight:600;color:#3a2f27;font-variant-numeric:tabular-nums;white-space:nowrap}
.of-drawer .ulk-bar{height:7px;border-radius:4px;background:#efe8db;overflow:hidden;margin-top:3px}.of-drawer .ulk-bar i{display:block;height:100%;background:linear-gradient(90deg,#a78bfa,#6d5ce7);transform-origin:0 50%;transform:scaleX(var(--k,0));animation:ulk-fill .3s ease-out}
@keyframes ulk-fill{from{transform:scaleX(0)}}
.of-drawer .ulk-n{margin:8px 0 0;font-size:12px;color:#3a2f27}.of-drawer .ulk-n+.ulk-n{margin-top:4px;color:#5a4a3c}
.of-drawer .ulk-g{margin:8px 0 0;padding:6px 8px;border-radius:8px;background:#f4f1ea;font-size:11.5px;color:#4a3d31}
.of-drawer .ulk .of-dbtn{margin-top:10px;width:100%}
.of-drawer button:focus-visible,.of-drawer input:focus-visible,.of-drawer select:focus-visible,.of-drawer [tabindex]:focus-visible{outline:2px solid #6d5ce7;outline-offset:2px}
.of-drawer .sh-tabs{display:flex;gap:4px;margin:0 0 10px;padding:3px;border-radius:999px;background:#f1ebff}
.of-drawer .sh-tabs button{flex:1;font:inherit;font-size:12px;font-weight:600;border:0;border-radius:999px;padding:6px 8px;background:none;color:#4c1d95;cursor:pointer}.of-drawer .sh-tabs button:hover{background:rgba(255,255,255,.65)}
.of-drawer .sh-tabs button[aria-selected="true"]{background:#6d5ce7;color:#fff;box-shadow:0 1px 3px rgba(60,40,120,.25)}
.of-drawer .sh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px}
.of-drawer .sh-tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;font:inherit;font-size:11px;color:#3a2f27;background:#f7f1e4;border:2px solid transparent;border-radius:12px;padding:6px 4px 5px;cursor:pointer;transition:border-color .12s,background-color .12s}
.of-drawer .sh-tile img,.of-drawer .sh-tile .ph{width:56px;height:56px;display:block}.of-drawer .sh-tile .ph{display:grid;place-items:center;color:#a8987f}.of-drawer .sh-tile .ph svg{width:34px;height:34px}
.of-drawer .sh-tile .nm{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.of-drawer .sh-tile:not([aria-disabled="true"]):hover{border-color:#d4c9f6;background:#fbf8ff}
.of-drawer .sh-tile[aria-pressed="true"],.of-drawer .sh-tile[aria-pressed="true"]:hover{border-color:#6d5ce7;background:#ebe4ff;box-shadow:0 0 0 1px #6d5ce7}.of-drawer .sh-tile[aria-pressed="true"] .nm{color:#3b1d86}
.of-drawer .sh-tile[aria-disabled="true"]{cursor:not-allowed;color:#5a4a3c;background:#f3eee4}.of-drawer .sh-tile[aria-disabled="true"] img{filter:grayscale(.85) opacity(.62)}
.of-drawer .sh-tile .lk{position:absolute;top:3px;right:4px;display:flex;align-items:center;gap:2px;padding:0 4px;border-radius:999px;font-size:10px;font-weight:600;color:#5a4a3c;background:#f3eee4}.of-drawer .sh-tile .lk svg{width:10px;height:10px}
.of-drawer .sh-tile .sk{position:absolute;top:4px;left:5px;display:flex;color:#8a6a2a}.of-drawer .sh-tile .sk svg{width:13px;height:13px}
.of-drawer .of-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.of-drawer .sh-foot{flex:none;padding:6px 14px 12px;border-top:1px solid rgba(120,90,60,.12);background:#fffdf8}   /* Save and Cancel stay on the drawer's bottom edge while the panel scrolls */
.of-drawer .sh-msg{min-height:18px;margin:0;font-size:12px;color:#2f6b4f}.of-drawer .sh-msg:empty{min-height:0}.of-drawer .sh-msg.err{color:#b42318}
.of-drawer .sh-act{display:flex;gap:8px;margin-top:6px}.of-drawer .sh-act .of-dbtn{min-width:90px}.of-drawer .of-dbtn:disabled{opacity:1;cursor:default;background:#f1ede6;border-color:#e2d9cb;color:#9a8c7c;filter:none}
.of-drawer .sh-note{margin:6px 0 0;font-size:11.5px;color:#5a4a3c}.of-drawer .sh-note.pv{padding:7px 9px;border-radius:10px;background:#eef7f1;color:#25553c}.of-drawer .sh-note.sk{padding:7px 9px;border-radius:10px;background:#fff4d6;color:#5a3d0a;margin-top:10px}
.of-drawer .pet-wrap{display:grid;grid-template-columns:minmax(0,1fr) 132px;gap:10px;align-items:start}
.of-drawer .pet-wrap>.pet-pvc{position:sticky;top:0;z-index:1}   /* the preview stays in view while the form scrolls (.bd scrolls, the grid spans the form) */
.of-drawer .pet-ph{display:flex;flex-direction:column;gap:6px;min-width:0}
.of-drawer .pet-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:132px;box-sizing:border-box;padding:8px;border:2px dashed #cdbfa6;border-radius:12px;text-align:center;font-size:11.5px;color:#5a4a3c;background:#fffaf0}
.of-drawer .pet-ph.on .pet-drop{border-color:#6d5ce7;background-color:#f1ebff}.of-drawer .pet-ph.on .pet-img{box-shadow:inset 0 0 0 3px #6d5ce7}.of-drawer .pet-drop p{margin:0}
.of-drawer .pet-drop .tc{display:none}@media (hover:none) and (pointer:coarse){.of-drawer .pet-drop .dk{display:none}.of-drawer .pet-drop .tc{display:inline}}   /* touch screens never say drop */
.of-drawer .pet-img{height:104px;border-radius:12px;background:#efe4cf center/contain no-repeat;box-shadow:inset 0 0 0 1px rgba(60,40,20,.12)}
.of-drawer .pet-ph label,.of-drawer .pet-drop label{display:inline-block;flex:none;min-width:0;cursor:pointer;position:relative}.of-drawer .pet-ph input[type=file]{position:absolute;width:1px;height:1px;opacity:0}
.of-drawer .pet-ph .of-dbtn.sm{align-self:flex-start;flex:none;min-width:0;padding:4px 10px;font-size:11.5px}
.of-drawer .pet-ph label:focus-within{outline:2px solid #6d5ce7;outline-offset:2px}
.of-drawer .pet-pvc{display:flex;flex-direction:column;gap:4px}
.of-drawer .pet-pv{width:132px;height:132px;border-radius:12px;background:radial-gradient(ellipse 70% 60% at 50% 45%,#fffef8,#efe4cf);overflow:hidden}.of-stage .of-drawer .pet-pv canvas{width:100% !important;height:100% !important;display:block}   /* the phone rule for the scene canvas (.of-stage canvas) must not reach the preview */
.of-drawer .pet-toy{display:flex;align-items:flex-start;gap:4px;font-size:11px;line-height:1.35;color:#5a4a3c}.of-drawer .pet-toy svg{flex:none;width:12px;height:12px;margin-top:1px;color:#b0802a}.of-drawer .pet-toy.off{color:#6a5a4a}.of-drawer .pet-toy.off svg{color:#9a8a7a}
.of-drawer .pet-f{display:flex;flex-direction:column;gap:8px;min-width:0;font-size:12px}
.of-drawer .pet-row{display:flex;flex-direction:column;gap:3px;min-width:0}.of-drawer .pet-row>label,.of-drawer .pet-row>span{color:#5a4a3c;font-weight:600;font-size:11.5px}
.of-drawer .pet-g{border:1px solid #eadfcb;border-radius:12px;background:#fffaf2}.of-drawer .pet-g>summary{cursor:pointer;font-weight:700;font-size:12.5px;color:#3a2f27;padding:8px 10px;border-radius:12px}
.of-drawer .pet-g>summary:focus-visible{outline:2px solid #6d5ce7;outline-offset:-2px}.of-drawer .pet-g[open]>summary{border-bottom:1px solid #f0e6d4;border-radius:12px 12px 0 0}
.of-drawer .pet-gb{display:flex;flex-direction:column;gap:9px;padding:8px 10px 10px}
.of-drawer .pet-rng{display:grid;grid-template-columns:1fr 1fr;font-size:10.5px;color:#6a5a4a}.of-drawer .pet-rng input{grid-column:1/-1;margin:0}.of-drawer .pet-rng span:last-child{text-align:right}
.of-drawer .pet-vis,.of-drawer .pet-mk{border:0;margin:0;padding:0;min-width:0;display:flex;flex-direction:column;gap:4px}.of-drawer .pet-vis legend,.of-drawer .pet-mk legend{padding:0;margin:0 0 3px;font-weight:600;font-size:11.5px;color:#5a4a3c}
.of-drawer .pet-vis .vd{margin:-2px 0 2px 20px;font-size:11px;line-height:1.4;color:#5a4a3c}
.of-drawer .pet-ex{display:flex;align-items:center;gap:8px;margin:0 0 2px 20px;font-size:11px;color:#5a4a3c}.of-drawer .pet-ex i{flex:none;width:34px;height:42px;box-sizing:border-box;border:4px solid #f5e6d3;box-shadow:0 0 0 1px rgba(60,40,20,.25),0 2px 4px rgba(60,40,20,.18);background:#efe4cf center/cover no-repeat}
.of-drawer .pet-rng{position:relative}.of-drawer .pet-rng::before{content:"";position:absolute;left:50%;top:17px;width:1px;height:5px;margin-left:-.5px;background:#a8987f;pointer-events:none}   /* the default, 0.5 */
.of-drawer .pg-s{display:flex;flex-direction:column;gap:6px}.of-drawer .pg-h{margin:2px 0 0;font-size:12px;font-weight:700;color:#3a2f27}.of-drawer .pet-pv{cursor:zoom-in}.of-drawer .sh-note.bn{margin:0;font-size:11px;color:#5a4a3c}
.of-drawer .ck{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:#3a2f27}.of-drawer input[type=radio],.of-drawer .ck input[type=checkbox]{accent-color:#6d5ce7;width:14px;height:14px;margin:0;flex:none}
.of-drawer .ck:has(input:disabled){cursor:default;color:#8a7a6a}
.of-drawer .pet-cks{display:grid;grid-template-columns:1fr 1fr;gap:5px 8px}.of-drawer .pet-c.in{margin-top:4px}
.of-drawer .pet-inl{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.of-drawer .pet-inl input[type=color]{width:44px;height:26px;padding:2px;box-sizing:border-box;border:1px solid #d9cdb8;border-radius:8px;background:#fff;cursor:pointer}.of-drawer .pet-inl input[type=color]:disabled{opacity:.35;cursor:default}
.of-drawer .pet-mk input[type=color]{width:44px;height:26px;padding:2px;box-sizing:border-box;border:1px solid #d9cdb8;border-radius:8px;background:#fff;cursor:pointer}
.of-drawer .petln{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 10px;padding:7px 10px;border-radius:10px;background:#f7f1e4;font-size:12px}.of-drawer .petln svg{width:14px;height:14px;color:#b0802a;flex:none}.of-drawer .petln span{color:#6a5a4a}
.of-tip.one{min-width:0;padding:6px 10px;white-space:nowrap}.of-tip.one small{display:block;font-size:11px;color:#6a5a4a}
.of-vwb{position:absolute;inset:0;z-index:7;background:rgba(40,28,18,.3);opacity:0;pointer-events:none;transition:opacity .18s ease-out}.of-vwb.on{opacity:1;pointer-events:auto}
.of-view{position:absolute;left:50%;top:50%;z-index:8;--vw:420px;width:calc(var(--vw) + 28px);max-width:calc(100% - 12px);box-sizing:border-box;padding:12px 14px 10px;border-radius:18px;background:#fffdf8;border:1px solid rgba(120,90,60,.2);color:#3a2f27;
  transform:translate(-50%,-48%) scale(.97);opacity:0;visibility:hidden;transition:opacity .18s ease-out,transform .22s cubic-bezier(.23,1,.32,1),visibility 0s .22s}
.of-view.on{opacity:1;visibility:visible;transform:translate(-50%,-50%);transition:opacity .18s ease-out,transform .22s cubic-bezier(.23,1,.32,1)}
.of-view .vw-hd{display:flex;align-items:flex-start;gap:8px;margin:0 0 8px}.of-view .vw-tt{flex:1;min-width:0}.of-view .vw-tt b{display:block;font-size:15px;font-weight:700;line-height:1.35;overflow-wrap:anywhere}
.of-view .vw-tt small{display:flex;flex-wrap:wrap;gap:0 10px;color:#6a5a4a;font-size:12px}
.of-view .x{flex:none;width:32px;height:32px;display:grid;place-items:center;padding:0;border:1px solid rgba(120,90,60,.18);background:rgba(255,255,255,.94);font:600 20px/1 inherit;color:#3a2f27;cursor:pointer}
.of-view .x:hover{border-color:#8b7cf0}.of-view .x:focus-visible{outline:2px solid #6d5ce7;outline-offset:1px}
.of-stage .of-view{border-radius:16px!important}.of-stage .of-view .vw-art{border-radius:10px!important}
.of-view .vw-art{position:relative;width:var(--vw);height:var(--vw);max-width:100%;background:radial-gradient(ellipse 70% 60% at 50% 45%,#fffef8,#efe4cf);overflow:hidden;display:flex;align-items:center;justify-content:center}
.of-view .vw-pin{position:absolute;left:12px;bottom:12px;width:26%;max-width:110px;aspect-ratio:4/5;object-fit:cover;box-sizing:border-box;border:6px solid #f5e6d3;box-shadow:0 1px 0 #c9b391,0 4px 10px rgba(60,40,20,.22),inset 0 0 0 1px rgba(60,40,20,.18);background:#efe4cf;display:none!important}
.of-view.pin .vw-pin{display:block!important}
.of-stage .of-view canvas{width:100% !important;height:100% !important;display:block;cursor:grab;touch-action:none}.of-stage .of-view canvas.drag{cursor:grabbing}   /* the phone rule for the scene canvas (.of-stage canvas) must not reach the viewer */
.of-view .vw-main{display:none}.of-view.photo canvas{display:none !important}
.of-view.photo .vw-main{display:block;border:12px solid #f5e6d3;border-radius:4px;box-shadow:0 1px 0 #c9b391,0 6px 14px rgba(60,40,20,.22),inset 0 0 0 1px rgba(60,40,20,.18);background:#efe4cf}
.of-view .vw-drag{margin:6px 0 0;font-size:11.5px;color:#6a5a4a;text-align:center;min-height:1.4em}   /* always there, so the three kinds share one height */
@media (prefers-reduced-motion:reduce){.of-view,.of-view.on,.of-vwb{transition:none}}
.of-drawer .pet-f select,.of-drawer .pet-f input[type=text]{font:inherit;font-size:12px;height:30px;box-sizing:border-box;padding:4px 8px;border:1px solid #d9cdb8;border-radius:8px;background:#fff;color:#3a2f27;min-width:0}
.of-drawer .pet-f select{-webkit-appearance:none;appearance:none;padding-right:26px;cursor:pointer;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236d5ce7' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") right 9px center/10px 6px no-repeat}
.of-drawer .pet-f select:hover,.of-drawer .pet-f input[type=text]:hover{border-color:#bfb2f2}
.of-drawer .pet-f input[type=range]{width:100%;accent-color:#6d5ce7}.of-drawer .pet-f input[type=checkbox]{accent-color:#6d5ce7;width:14px;height:14px;margin:0}
.of-drawer .pet-cols{display:flex;gap:10px;flex-wrap:wrap}
.of-drawer .pet-c{display:flex;flex-direction:column;align-items:flex-start;gap:3px;font-size:11px;color:#5a4a3c}.of-drawer .pet-c label{display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer}
.of-drawer .pet-c input[type=color]{width:44px;height:26px;padding:2px;box-sizing:border-box;border:1px solid #d9cdb8;border-radius:8px;background:#fff;cursor:pointer}.of-drawer .pet-c input[type=color]:disabled{opacity:.35;cursor:default}
.of-drawer .sh-rm{margin-top:14px;padding-top:10px;border-top:1px dashed rgba(120,90,60,.22);font-size:12px;color:#5a4a3c}
.of-drawer .lnk{font:inherit;font-size:12px;font-weight:600;background:none;border:0;padding:2px 0;cursor:pointer;color:#9b2c1f;text-decoration:underline;text-underline-offset:2px}.of-drawer .lnk:disabled{opacity:.55;cursor:default}
.of-drawer .sh-rm .row{display:flex;gap:8px;margin-top:6px}.of-drawer .sh-rm .of-dbtn{flex:none;min-width:0}.of-drawer .of-dbtn.warn{background:#fff;border-color:#e3b4ad;color:#9b2c1f}
.of-drawer.shop .bd{padding-bottom:12px}.of-drawer.shop .bkbar{flex:none;padding-bottom:8px;background:#fffdf8;border-bottom:1px solid rgba(120,90,60,.12)}
@media (max-width:480px){.of-drawer .hd b{white-space:normal}.of-drawer .hd b .badge{margin:2px 4px 0 0}.of-drawer .pet-wrap{grid-template-columns:minmax(0,1fr) 104px}.of-drawer .pet-pv{width:104px;height:104px}.of-drawer .pet-drop{min-height:104px}.of-drawer .pet-img{height:78px}.of-drawer .sh-grid{grid-template-columns:repeat(3,1fr)}
  .of-drawer.shop .hd{padding:8px 12px 7px;gap:8px}.of-drawer.shop .hd .of-th{--px:30px;box-shadow:0 0 0 2px #fffdf8,0 0 0 3px var(--tc,#d9cdb8)}.of-drawer.shop .hd small,.of-drawer.shop .hd b .badge:not(.lvb){display:none}.of-drawer.shop .hd b{white-space:nowrap}.of-drawer.shop .hd b .badge{margin:0 0 0 6px}
  .of-drawer.shop .bkbar{padding:6px 12px 0}.of-drawer.shop .bk{padding:3px 10px}.of-drawer.shop .bd{padding:8px 12px}.of-drawer.shop .sh-tabs{margin-bottom:8px}.of-drawer.shop .sh-foot{padding:6px 12px 10px}
}
/* the shop under 520 px is a sheet over the whole page (of-sheet, see sheetSync): the stage underneath keeps the size it had with the profile drawer, so closing
   the sheet returns to that page as it was. contain is lifted while it is open because contain makes the stage the containing block of fixed children.
   Pinned rows (Back, the preview, Save) are opaque with a border, so the scrolling form never shows through them. */
.of-stage.of-sheet{contain:none}html.of-sheet-on,html.of-sheet-on body{overflow:hidden}
.of-card .of-stage.of-sheet .of-drawer.shop{position:fixed;inset:0;top:0;width:auto;max-width:none;height:auto!important;z-index:1001;border:0;border-radius:0!important;transform:none;padding-top:env(safe-area-inset-top)}
.of-card .of-stage.of-sheet .of-drawer.shop:not(.open){transform:translateY(100%)}
.of-stage.of-sheet .of-drawer.shop .bd{padding-top:0}.of-stage.of-sheet .of-drawer.shop .sh-tabs{margin-top:8px}
.of-stage.of-sheet .of-drawer.shop .sh-foot{padding-bottom:calc(10px + env(safe-area-inset-bottom))}
.of-stage.of-sheet .of-drawer .pet-wrap{display:flex;flex-direction:column;align-items:stretch;gap:10px}
.of-stage.of-sheet .of-drawer .pet-wrap>.pet-pvc{order:-1;position:sticky;top:0;z-index:2;margin:0 -12px;padding:8px 12px;background:#fffdf8;border-bottom:1px solid rgba(120,90,60,.16);flex-direction:row;align-items:center;gap:12px}
.of-stage.of-sheet .of-drawer .pet-pv{width:124px;height:124px;flex:none}.of-stage.of-sheet .of-drawer .pet-toy{flex:1}
@media (prefers-reduced-motion:reduce){.of-drawer .ulk-bar i{animation:none}}
/* the collection tab: a count with a bar, then one card per level. The level badge borrows the look of that level's profile frame (1 a soft border, 2 a double border,
   3 gold foil, 4 hologram, 5 a faster prism, 6 gold and flame); the hologram is one conic layer turned by a transform, stopped under reduced motion */
.of-drawer .bk-sum{margin:0 0 10px;padding:8px 10px 10px;border-radius:12px;background:#fff;border:1px solid rgba(120,90,60,.22);font-size:12.5px;color:#3a2f27}.of-drawer .bk-sum b{display:block;margin:0 0 4px;font-weight:700}.of-drawer .bk-sum .ulk-bar{margin-top:0}
.of-drawer .bk-card{position:relative;margin:0 0 10px;padding:10px;border-radius:12px;background:#fff;border:1px solid rgba(120,90,60,.22);box-shadow:0 1px 2px rgba(60,40,20,.06)}
.of-drawer .bk-card.next{border-color:#6d5ce7;box-shadow:0 0 0 2px rgba(109,92,231,.28),0 2px 8px rgba(60,40,120,.12)}
.of-drawer .bk-card.locked{background:#f7f3ea}.of-drawer .bk-card.locked .bk-hd b,.of-drawer .bk-card.locked .bk-t .nm{color:#7a6a58}
.of-drawer .bk-hd{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;margin:0 0 4px}.of-drawer .bk-hd b{flex:1 1 130px;min-width:0;font-size:12px;line-height:1.35;color:#3a2f27;font-weight:700}
.of-drawer .bk-lv{position:relative;isolation:isolate;overflow:hidden;flex:none;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800;line-height:1.3;color:#4c1d95;background:#efe9ff;box-shadow:inset 0 0 0 1.5px #b9a8f0}
.of-drawer .bk-lv.lv-2{background:#fffaf0;color:#6b4a14;box-shadow:inset 0 0 0 1.5px #8a6a48,inset 0 0 0 3px #fffaf0,inset 0 0 0 4px #c99a3e}
.of-drawer .bk-lv.lv-3{background:linear-gradient(135deg,#f6e3a1 0,#c9952e 22%,#fff1c2 42%,#b07f22 60%,#f3d27a 80%,#c08a2a 100%);color:#3a2410;box-shadow:inset 0 0 0 1px #8a5a12}
.of-drawer .bk-lv.lv-4,.of-drawer .bk-lv.lv-5,.of-drawer .bk-lv.lv-6{color:#2b1a5e;text-shadow:0 0 3px rgba(255,255,255,.9);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.8),0 0 0 1px #c99a3e}
.of-drawer .bk-lv.lv-4::before,.of-drawer .bk-lv.lv-5::before,.of-drawer .bk-lv.lv-6::before{content:"";position:absolute;left:50%;top:50%;width:300%;aspect-ratio:1;z-index:-1;background:conic-gradient(#ff8fcf,#ffd96b,#8ff0a8,#7fd0ff,#b996ff,#ff8fcf);transform:translate(-50%,-50%);animation:pc-spin 14s linear infinite}
.of-drawer .bk-lv.lv-5::before{background:conic-gradient(#ff4fc0,#ffe84a,#4dffa0,#3fd0ff,#8a63ff,#ff4fc0);animation-duration:8s}
.of-drawer .bk-lv.lv-6{color:#3a1203;text-shadow:0 0 3px rgba(255,236,160,.95)}.of-drawer .bk-lv.lv-6::before{background:conic-gradient(#ffd24a,#ff7a1a,#e0112b,#ff7a1a,#ffd24a,#fff3b0,#ffd24a);animation-duration:7s}
.of-drawer .bk-lv.lv-4::after,.of-drawer .bk-lv.lv-5::after,.of-drawer .bk-lv.lv-6::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.8) 48%,transparent 62%) 150% 0/250% 100% no-repeat;animation:bk-shine 3.2s ease-in-out infinite}
@keyframes bk-shine{0%{background-position:150% 0}60%,100%{background-position:-50% 0}}
.of-drawer .bk-stamp{display:inline-grid;place-items:center;flex:none;min-width:42px;height:42px;padding:0 3px;box-sizing:border-box;border-radius:50%;border:2px solid #2f8f5b;color:#2f8f5b;font-size:10.5px;font-weight:800;line-height:1.1;text-align:center;transform:rotate(-12deg);box-shadow:inset 0 0 0 2px #fff,inset 0 0 0 3px rgba(47,143,91,.45)}
.of-drawer .bk-nx{flex:none;padding:2px 9px;border-radius:999px;background:#6d5ce7;color:#fff;font-size:10.5px;font-weight:800}
.of-drawer .bk-lk{display:inline-flex;align-items:center;gap:3px;flex:none;font-size:10.5px;font-weight:700;color:#6a5a4a}.of-drawer .bk-lk svg{width:11px;height:11px}
.of-drawer .bk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;margin-top:8px}
.of-drawer .bk-t{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;font:inherit;font-size:10.5px;color:#3a2f27;background:#f7f1e4;border:2px solid transparent;border-radius:12px;padding:12px 3px 5px;cursor:pointer;transition:border-color .12s,background-color .12s}
.of-drawer .bk-t:hover{border-color:#d4c9f6;background:#fbf8ff}.of-drawer .bk-t:focus-visible{outline:2px solid #6d5ce7;outline-offset:1px}
.of-drawer .bk-t img,.of-drawer .bk-t .ph{width:100%;max-width:56px;aspect-ratio:1;display:block}
.of-drawer .bk-t .ph svg{display:block;width:62%;height:62%;margin:19%;color:#b7791f}
.of-drawer .bk-t .nm{max-width:100%;font-weight:600;line-height:1.2;text-align:center;overflow-wrap:anywhere}
.of-drawer .bk-t.lock img{filter:brightness(0);opacity:.62}.of-drawer .bk-t.lock .ph{opacity:.5}
.of-drawer .bk-sl{position:absolute;top:3px;left:5px;font-size:9px;font-weight:700;color:#8a6a2a}
.of-drawer .ph.tx{display:grid;place-items:center;font-size:11px;font-weight:700;color:#6a5a4a;text-align:center;line-height:1.2}.of-drawer .sh-tile .ph.tx{width:56px;height:56px}
@media (max-width:480px){.of-drawer .bk-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.of-drawer .sh-tabs button{padding:6px 3px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
@media (prefers-reduced-motion:reduce){.of-drawer .bk-lv::before,.of-drawer .bk-lv::after{animation:none}}
@media (prefers-reduced-motion:reduce){.of-drawer,.of-drawer.open,.of-fs{transition:none}}
@media (max-width:640px){.of-strip .sp .of-th{--px:15px;margin:0;vertical-align:-3px}}
@media (max-width:640px){.of-legend .keys,.of-strip .tg em,.of-strip b{display:none}.of-strip .sp svg{width:12px;height:12px}.of-tb{width:28px;height:28px}.of-tools{gap:4px}.of-stage{height:300px}.of-hud{left:12px;right:12px;top:46px;font-size:11px;background:#fff;padding:5px 8px;border:1px solid rgba(16,24,32,.14)}.of-hud b{font-size:13px}.of-legend{left:8px;bottom:6px;font-size:11px;gap:0 10px;padding:3px 8px;max-width:calc(100% - 16px)}.of-btn,.of-lbl{font-size:11px;padding:4px 8px}}
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
 * polar angle is clamped to 20-70 degrees from the horizon. A plain drag pans inside the bounds like a map, right-drag, shift-drag or alt-drag orbits,
 * two fingers pinch-zoom and pan together, the arrow keys pan and Q/E turn while the stage has focus, and the wheel zooms toward the pointer.
 * cfg: { T, canvas, stage, camera, target0:[x,y,z], theta0, phi0, dist, bounds(), size():[W,H], ppu(), isFs(), reduced, request(), onTap(px,py,ev), onMove(px,py,ev), onLeave(), onDrag(bool), onFocus(), onEnter() } */
export function makeView(cfg){
  const T = cfg.T, cam = cfg.camera, tgt = new T.Vector3(...cfg.target0), tgt0 = tgt.clone(), rc = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), V = new T.Vector3(), V2 = new T.Vector3(), N = new T.Vector2();
  const PMIN = 0.35, PMAX = 1.22, ZMIN = 0.6, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /* the closest zoom: 4, or closer when cfg.near (world units) is given, until that span fills the shorter side of the canvas (one desk for the office) */
  const ZMAX = () => { const [W, H] = cfg.size(), u = cfg.near > 0 ? Math.min(W, H) / (cfg.near * cfg.ppu()) : 0; return Math.max(4, Number.isFinite(u) ? u : 0); };
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
  function panBy(dx, dy){   /* screen pixels to a ground move: the target follows the drag so the floor stays under the pointer */
    const u = 1 / (cfg.ppu() * zoom), sp = Math.sin(th), cp = Math.cos(th), k = 1 / Math.max(0.3, Math.cos(ph));
    tgt.x += -cp * dx * u - sp * dy * u * k; tgt.z += sp * dx * u - cp * dy * u * k; clampT();
  }
  function zoomAt(f, px, py){ zT = clamp(zT * f, ZMIN, ZMAX()); anchor = px == null ? null : [px, py]; mark(); cfg.request(); }
  function update(dt, time){
    now = time; const idle = time - last > 20;
    swayAmp += ((idle && !cfg.reduced ? 1 : 0) - swayAmp) * Math.min(1, dt * 1.5);
    if(!g && !cfg.reduced && (Math.abs(vth) > 1e-3 || Math.abs(vph) > 1e-3)){ th += vth * dt; ph = clamp(ph + vph * dt, PMIN, PMAX); const k = Math.exp(-dt * 3); vth *= k; vph *= k; }
    flyStep(dt); thEff = fly ? th : th + swayAmp * 0.05 * Math.sin(time * 0.22); cfg.canvas.style.touchAction = cfg.isFs() ? 'none' : 'pan-y';
    pose(); zoomStep();
  }
  function reset(){ fly = null; th = cfg.theta0; ph = cfg.phi0; zoom = zT = 1; vth = vph = 0; tgt.copy(tgt0); thEff = th; mark(); pose(); cfg.request(); }
  const rect = () => cfg.canvas.getBoundingClientRect(), pt = ev => { const r = rect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  cfg.canvas.addEventListener('pointerdown', ev => {
    fly = null; cfg.canvas.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]); focused = true; if(cfg.onFocus) cfg.onFocus(); mark();
    if(ptrs.size === 2){ const [a, b] = [...ptrs.values()]; g = { mode: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: zT, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, ang: Math.atan2(b[1] - a[1], b[0] - a[0]), moved: true }; vth = vph = 0; }
    else g = { mode: ev.button === 2 || ev.shiftKey || ev.altKey ? 'orbit' : 'pan', lx: ev.clientX, ly: ev.clientY, sx: ev.clientX, sy: ev.clientY, moved: false, t: performance.now() };
    if(ptrs.size === 1 && cfg.onDown) cfg.onDown(...pt(ev), ev);   /* what is under the press (the office takes its object candidate here) */
  });
  cfg.canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  cfg.canvas.addEventListener('pointermove', ev => {
    if(ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if(!g){ if(ev.pointerType !== 'touch') cfg.onMove(...pt(ev), ev); return; }
    if(g.mode === 'pinch'){ if(ptrs.size < 2) return; const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = rect(), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      panBy(mx - g.mx, my - g.my); g.mx = mx; g.my = my;   /* the two fingers' midpoint drags the floor while their spread zooms */
      const an = Math.atan2(b[1] - a[1], b[0] - a[0]); let da = an - g.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); th -= da; g.ang = an;   /* and a twist turns */
      zT = clamp(g.z0 * d / g.d0, ZMIN, ZMAX()); anchor = [mx - r.left, my - r.top]; mark(); cfg.request(); return; }
    const dx = ev.clientX - g.lx, dy = ev.clientY - g.ly;
    if(!g.moved && Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > 5){ g.moved = true; cfg.canvas.classList.add('drag'); if(cfg.onDrag) cfg.onDrag(true); }
    if(!g.moved) return;
    const tNow = performance.now(), dts = Math.max(0.008, (tNow - g.t) / 1000); g.t = tNow; g.lx = ev.clientX; g.ly = ev.clientY; mark();
    if(g.mode === 'pan') panBy(dx, dy);
    else { const dth = -dx * 0.008, dph = -dy * 0.006; th += dth; ph = clamp(ph + dph, PMIN, PMAX); vth = vth * 0.5 + 0.5 * dth / dts; vph = vph * 0.5 + 0.5 * dph / dts; }
    cfg.request();
  });
  const end = ev => {
    ptrs.delete(ev.pointerId); const gg = g;
    if(ptrs.size === 0){ g = null; cfg.canvas.classList.remove('drag'); if(cfg.onDrag) cfg.onDrag(false); }
    else if(ptrs.size === 1 && gg && gg.mode === 'pinch') g = null;
    if(!gg || gg.moved || ev.type === 'pointercancel' || gg.mode === 'pinch' || ev.button === 2) return;   /* a click that did not move is a tap, whichever drag it would have started */
    cfg.onTap(...pt(ev), ev);
  };
  cfg.canvas.addEventListener('pointerup', end); cfg.canvas.addEventListener('pointercancel', end);
  cfg.canvas.addEventListener('wheel', ev => {
    if(!(cfg.isFs() || ev.ctrlKey || ev.metaKey || focused)) return;
    ev.preventDefault(); fly = null; const [px, py] = pt(ev);
    if(!ev.ctrlKey && Math.abs(ev.deltaX) > Math.abs(ev.deltaY)){ th -= ev.deltaX * 0.005; vth = 0; mark(); pose(); cfg.request(); return; }   /* a sideways two-finger swipe (or shift-wheel) turns */
    zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)), px, py);
  }, { passive: false });
  cfg.canvas.tabIndex = cfg.canvas.tabIndex >= 0 ? cfg.canvas.tabIndex : 0;
  cfg.canvas.addEventListener('keydown', ev => {   /* arrows pan a tenth of the view, Q and E turn by 15 degrees */
    const [W, H] = cfg.size(), step = Math.min(W, H) * 0.1, m = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[ev.key];
    if(m){ ev.preventDefault(); fly = null; panBy(m[0], m[1]); }
    else if(ev.key === 'q' || ev.key === 'e' || ev.key === 'Q' || ev.key === 'E'){ ev.preventDefault(); th += (ev.key.toLowerCase() === 'q' ? 1 : -1) * Math.PI / 12; vth = 0; }
    else return;
    mark(); pose(); cfg.request();
  });
  cfg.stage.addEventListener('pointerenter', () => { if(!focused && !cfg.isFs() && cfg.onEnter) cfg.onEnter(); });
  cfg.stage.addEventListener('pointerleave', () => { focused = false; if(!g) cfg.onLeave(); });
  /* programmatic pose for tests and screenshots: { th, ph, zoom, x, z } (all optional) */
  function setPose(o){
    fly = null;   /* a scripted pose (tests, the video recorder) wins over a glide in progress */
    if(o.th != null){ th = o.th; thEff = th; } if(o.ph != null) ph = clamp(o.ph, PMIN, PMAX); if(o.zoom != null) zoom = zT = clamp(o.zoom, ZMIN, ZMAX());
    if(o.x != null) tgt.x = o.x; if(o.z != null) tgt.z = o.z; vth = vph = 0; mark(); pose(); cfg.request();
  }
  function turnBy(a){ fly = null; if(cfg.reduced) th += a; else vth += a * 3; mark(); cfg.request(); }
  /* glide to look at ground point (x, z) from azimuth th (the nearest turn of it), polar ph and zoom; ox shifts the point ox pixels left of centre (room for a side panel) */
  let fly = null;
  function flyTo(o){
    const zt = clamp(o.zoom ?? zT, ZMIN, ZMAX()), th1 = th + Math.atan2(Math.sin(o.th - th), Math.cos(o.th - th)), u = 1 / (cfg.ppu() * zt), ox = o.ox || 0;
    const to = { x: o.x + Math.cos(th1) * ox * u, z: o.z - Math.sin(th1) * ox * u, th: th1, ph: clamp(o.ph ?? ph, PMIN, PMAX), zoom: zt };
    fly = { t: cfg.reduced ? 1 : 0, f: { x: tgt.x, z: tgt.z, th, ph, zoom }, to }; vth = vph = 0; anchor = null; mark(); cfg.request();
  }
  function flyStep(dt){
    if(!fly) return; fly.t = Math.min(1, fly.t + dt / 0.8); const k = 1 - Math.pow(1 - fly.t, 3), f = fly.f, q = fly.to, L = (a, b) => a + (b - a) * k;
    tgt.x = L(f.x, q.x); tgt.z = L(f.z, q.z); th = L(f.th, q.th); ph = L(f.ph, q.ph); zoom = zT = L(f.zoom, q.zoom); thEff = th;
    if(fly.t >= 1) fly = null; mark();
  }   /* inertia decays as e^-3t, so a 3a kick turns by a */
  return { update, reset, setPose, zoomBy: f => zoomAt(f), turnBy, flyTo, flying: () => !!fly, getPose: () => ({ x: tgt.x, z: tgt.z, th, ph, zoom: zT }), azimuth: () => thEff, zoom: () => zoom, zoomMax: () => ZMAX(), apply: pose,
    defaultCam(far){ const c = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, far || 400), sp = Math.sin(cfg.phi0); c.position.set(tgt0.x + cfg.dist * sp * Math.sin(cfg.theta0), tgt0.y + cfg.dist * Math.cos(cfg.phi0), tgt0.z + cfg.dist * sp * Math.cos(cfg.theta0)); c.lookAt(tgt0); c.updateMatrixWorld(); return c; } };
}

/* Drawer widgets shared by both scenes: charts with a crosshair tooltip, segmented bars and comparison bars with hover tooltips (all keyboard focusable). */
const kreg = {};
export const kit = {
  chart(id, days, series, w = 380, h = 96, o = {}){
    kreg[id] = { days, series };
    const n = days.length, mx = Math.max(1e-9, ...series.flatMap(s => s.vals)), pad = 4, bw = (w - 2 * pad) / Math.max(1, n), X = i => pad + (i + 0.5) * bw, Y = v => h - 4 - (v / mx) * (h - 24);   /* headroom for the value labels */
    let gs = '';
    series.forEach(s => { if(s.kind === 'bar') s.vals.forEach((v, i) => { const y = Y(v); gs += `<rect x="${(X(i) - bw * 0.36).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${Math.max(0, h - 4 - y).toFixed(1)}" rx="1.5" fill="${s.color}" opacity=".85"/>`; });
      else gs += `<polyline points="${s.vals.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`; });
    /* numbers without hovering: every bar's value when there are few, otherwise the peak and the latest day; the scale top; the first and last day; each series' total */
    const bars = series.find(s => s.kind === 'bar'), lab = new Set();
    const fits = bars && (n <= 10 || w / Math.max(1, n) >= bars.fmt(mx).length * 6.2 + 4);   /* every label fits over its own bar */
    if(bars){ if(fits) bars.vals.forEach((v, i) => { if(v > 0) lab.add(i); }); else { const pk = bars.vals.indexOf(Math.max(...bars.vals)); if(bars.vals[pk] > 0) lab.add(pk); if(bars.vals[n - 1] > 0) lab.add(n - 1); } }
    const vl = bars ? [...lab].map(i => `<span class="vl${i === n - 1 ? ' last' : ''}" style="left:${(X(i) / w * 100).toFixed(2)}%;top:${(Y(bars.vals[i]) / h * 100).toFixed(2)}%">${esc(bars.fmt(bars.vals[i]))}</span>`).join('') : '';
    const sum = v => v.reduce((a, b) => a + b, 0);
    const ax = n ? `<div class="ax"><span>${esc(days[0])}</span><span>${esc(days[n - 1])}</span></div>` : '';
    return `<div class="ch" data-ch="${esc(id)}" tabindex="0" role="img" aria-label="${esc(days.length ? days[0] + ' – ' + days[days.length - 1] : '')}"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${gs}</svg>${vl}<div class="cx"></div><div class="ct"></div></div>${ax}`
      + `<div class="leg">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}${o.total ? ` <b>${esc(o.total)} ${esc(s.fmt(sum(s.vals)))}</b>` : ''}</span>`).join('')}</div>`;
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
  const TL = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 9.5A5 5 0 1 1 8 3.5h3M9.5 1.5 11.5 3.5 9.5 5.5"/></svg>';
  const TR = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5A5 5 0 1 0 8 3.5H5M6.5 1.5 4.5 3.5 6.5 5.5"/></svg>';
  const bReset = mkBtn('of-rs', RESET, () => o.onReset && o.onReset()), bTL = mkBtn('of-tl', TL, () => o.onTurn && o.onTurn(Math.PI / 4)), bTR = mkBtn('of-tr', TR, () => o.onTurn && o.onTurn(-Math.PI / 4)), bOut = mkBtn('of-zo', '−', () => o.onZoom && o.onZoom(1 / 1.35)), bIn = mkBtn('of-zi', '+', () => o.onZoom && o.onZoom(1.35));
  const BOOK = BOOK_ICON;
  const bBook = o.onBook ? mkBtn('of-bk', BOOK, () => o.onBook()) : null;
  const fs = mkBtn('of-fs', '', () => toggleFs());
  const hint = document.createElement('div'); hint.className = 'of-hint'; stage.appendChild(hint); let hintT = 0;
  const hideHint = () => { clearTimeout(hintT); hint.classList.remove('on'); };
  const showHint = () => { if(fsOn()) return; hint.textContent = (o.ui() || {}).hint || '';
    { const lg = stage.querySelector('.of-legend'), lh = lg && lg.offsetParent ? lg.offsetHeight : 0; hint.style.bottom = (lh ? lh + 16 : 46) + 'px'; }   /* above the legend row, however many lines it wraps to */ hint.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(hideHint, 2600); };
  const card = container.closest('.of-card') || container;
  let fsX = false;
  const nativeFs = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fsOn = () => fsX || nativeFs() === card;
  const IN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>';
  const OUT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"/></svg>';
  function syncFs(){
    const on = fsOn(), ui = o.ui() || {}, lbl = on ? ui.fsExit : ui.fs;
    fs.innerHTML = on ? OUT : IN; fs.setAttribute('aria-label', lbl || ''); fs.title = lbl || ''; fs.setAttribute('aria-pressed', String(on));
    [[bReset, ui.reset], [bTL, ui.turnL], [bTR, ui.turnR], [bOut, ui.zoomOut], [bIn, ui.zoomIn], [bBook, ui.book]].forEach(([b, l]) => { if(b){ b.setAttribute('aria-label', l || ''); b.title = l || ''; } });
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

/* ── what the 3D room is built from ──
 * sceneKey(d) is the data minus the fields that are only text and figures: the HUD, legend, strip, field guide, aria label, shop and ui strings, and per person the
 * drawer detail, the tip rows, spent, rank, the grade and tier labels and the prompt id. All of those are read after the build (drawer, card, tooltip, chrome), never
 * while the room is made, so update() repaints them in place when two data sets share a key. Everything else stays in the key, so a new tier, grade, crown, gear,
 * pet, os, team or seat rebuilds the room. Two reads at build time are kept in a smaller form: the bubble list as its length (only "has bubbles" picks who talks;
 * the text is read when a bubble opens) and a pet photo as its length plus both ends (a data URL can be hundreds of kilobytes). hud.closed is the suspended sign's text,
 * and whether a field guide exists decides whether an open one may stay. */
const SOFT_TOP = new Set(['hud', 'legend', 'strip', 'book', 'aria', 'shop', 'ui']), SOFT_PERSON = new Set(['detail', 'tip', 'spent', 'rank', 'gradeLabel', 'tierText', 'promptId']);
const photoKey = s => (typeof s === 'string' && s.length > 80 ? s.length + ':' + s.slice(0, 32) + ':' + s.slice(-32) : s);
export function sceneKey(d){
  const k = {};
  Object.keys(d || {}).forEach(n => { if(!SOFT_TOP.has(n) && n !== 'people') k[n] = d[n]; });
  k.hudClosed = d && d.hud ? d.hud.closed : undefined; k.hasBook = !!(d && d.book);   /* build() closes an open field guide that the new data no longer has */
  k.people = ((d && d.people) || []).map(p => {
    const q = {};
    Object.keys(p || {}).forEach(n => { if(!SOFT_PERSON.has(n)) q[n] = p[n]; });
    if(Array.isArray(p.bubbles)) q.bubbles = p.bubbles.length;
    if(p.pet && typeof p.pet === 'object' && typeof p.pet.photo === 'string') q.pet = { ...p.pet, photo: photoKey(p.pet.photo) };
    return q;
  });
  return JSON.stringify(k);
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
  const chrome = makeChrome(stage, container, { ui: () => cur.ui, onZoom: f => view && view.zoomBy(f), onTurn: a => view && view.turnBy(a), onReset: () => view && view.reset(), request: () => request(), onClose: () => { shopReset(); sheetSync(false); unpose(sel); sel = null; selId = null; bookOpen = false; if(ring) ring.visible = false; hidePortrait(); if(homePose && view){ const h = homePose; homePose = null; view.flyTo(h); } },   /* back to the view before the pick */ onBook: () => openBook(),
    onAction: a => { if(!sel || opts.readOnly) return; const id = sel.p.id; if(a === 'seats' && opts.onSeats) opts.onSeats(id); else if(a === 'prompts' && opts.onPrompts) opts.onPrompts(id); } });
  const syncFs = () => chrome.syncFs();
  kit.bind(chrome.el);
  chrome.el.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('[data-bk]'); if(b) pulseGrade(b.dataset.bk);
    const pp = ev.target.closest && ev.target.closest('[data-pp]'); if(pp){ const o = people.find(q => q.p.id === pp.dataset.pp); if(o) openDrawer(o); }   /* leaderboard row opens that person */
  });

  let T = null, renderer = null, scene = null, camera = null, world = null, canvas = null, ro = null, io = null, sun = null, hemi = null, rim = null;
  let post = null;   /* post-processing chain (post.js): null until it loads, on phones and with ?fx=0 */
  let builtKey = null;   /* sceneKey of the data the room was last built from: update() rebuilds only when the next data's key differs */
  const keyOf = d => sceneKey(d) + (holidayOn() ? '|xmas' : '');   /* the year-end dressing is part of what is built */
  let cur = data, destroyed = false, visible = false, raf = 0, rr = 0, last = 0, time = 0, W = 0, H = 0, started = false, frames = 0;
  let statics = [], dyn = [], hover = null, scale = 10, view = null, wallIdx = { z: [], x: [] }, wallHid = { z: false, x: false }, decals = [], decFlip = false;
  let people = [], bots = [], trails = [], zones = [], sets = null, scr = null, srvLights = [], srv = null, lab = { zones: [], tags: [], server: null, more: null, sign: null }, bubs = [], nextBub = 1.2, sFlash = 0, FW = 10, FD = 10, sparks = [], hudBox = null, BB = { x0: -5, x1: 5, z0: -5, z1: 5 };
  let TMP2 = null, M4 = null, S = null, TMP = null, PT = null, HP = null, Mh = null, Mp = null, Q1 = null, E1 = null, V1 = null, V2 = null, ONE = null;
  const v3 = () => new T.Vector3();
  let sprOn = opts.sprite !== false && !(typeof location !== 'undefined' && /[?&]sprite=0(?:&|$)/.test(location.search || '')), sprMan = null, sprKit = null, sprZoom = false;   /* sprites.js: ?sprite=0 keeps the glb (and the live 3D profile card) for everyone; sprZoom: the zoom gate's state, shared so its hysteresis is one decision per frame */
  let gearBits = [];   /* desk items (gear.js) on this build's desks: ticked in step(), freed on every rebuild like the pets */
  const ownDispose = g => { if(typeof g.userData.dispose !== 'function') g.userData.dispose = () => {}; return g; };
  const lvText = n => String((cur && cur.ui && cur.ui.lv) || 'Lv.{n}').split('{n}').join(String(n));
  let loungeObs = { rects: [], occ: [] };   /* the lounge's footprints for the pets' floor grid and their view test (set by build) */
  let pets = [], petBits = [], petNav = null, petCtx = null, petFurCalls = 0;   /* pets (pets.js): pets holds each pet's state, petBits every Group to dispose, petNav the floor grid they walk on */
  let xmas = false, hol = [], holWall = null, holFit = null;   /* year-end dressing (holiday.js): on from Nov 1 to Dec 30 Seoul time or with ?season=xmas; hol holds every Group to tick and dispose */
  /* Who wears what, only while HOL_HEADS is on (off by default): a crown gets only the red nose, a person without one gets a Santa hat or the Rudolph set (antlers band and red nose) by a hash of the id.
   * HOL_HAT_SKIP (module level, used by headDress): species that always take the Rudolph set instead of a Santa hat; empty since the cast lost its built-in hats. ANTLER_SKIP: the band would tangle with horns or antlers of their own, so the nose goes on alone.
   * NO_NOSE: species where a red ball on the nose looks wrong (the eagle's hooked beak). Species with no nose or beak mesh (frog, elephant) get no ball anyway. */
  const ANTLER_SKIP = new Set(['deer', 'unicorn']), NO_NOSE = new Set(['eagle']), noseTips = {}, backAnchors = {};   /* backAnchors: the wing anchor of a loaded model, by pose and species, like noseTips */
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
    hol.forEach(h => { if(h.parent) h.parent.remove(h); h.userData.dispose(); }); hol = []; holWall = null; holFit = null;
    pets.forEach(pt => { if(pt.blobMat) pt.blobMat.dispose(); }); petBits.forEach(h => { if(h.parent) h.parent.remove(h); h.userData.dispose(); }); petBits = []; pets = []; petNav = null; petCtx = null;
    gearBits.forEach(h => { if(h.parent) h.parent.remove(h); h.userData.dispose(); }); gearBits = [];
    dyn.forEach(o => { if(o.isObject3D){ if(o.parent) o.parent.remove(o); if(o.isInstancedMesh) o.dispose(); } else if(o.dispose) o.dispose(); });
    castFxRelease(world); world.clear(); dyn = []; decals = []; decFlip = false; elLabels.innerHTML = ''; people = []; bots = []; trails = []; srvLights = []; bubs = []; sparks = []; hover = null; elTip.hidden = true;
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
  /* Every procedural figure part is laid out as if the person sat facing -z (arms, scarf, head offsets). faceCam then turns the finished instance matrix half a
     turn about the seat centre (x, z + 0.3): F = translate(x,0,pz) rotY(pi) translate(-x,0,-pz), so the figure faces the camera side (+z) like the glTF cast. */
  let Mf = null, Mq = null;
  function faceCam(mesh, i, o){
    Mf = Mf || new T.Matrix4(); Mq = Mq || new T.Matrix4();
    mesh.getMatrixAt(i, Mq); Mf.set(-1, 0, 0, 2 * o.x, 0, 1, 0, 0, 0, 0, -1, 2 * (o.z + 0.3), 0, 0, 0, 1); Mq.premultiply(Mf); mesh.setMatrixAt(i, Mq);
  }
  function putPart(mesh, i, pt, o, hy, hz, yaw){
    E1.set(pt.r || 0, 0, 0); V2.set(pt.s[0] * K, pt.s[1] * K, pt.s[2] * K);
    if(pt.b){ fpt(o, o.x + pt.p[0], pt.p[1], o.z + pt.p[2], V1); Mp.compose(V1, Q1.setFromEuler(E1), V2); mesh.setMatrixAt(i, Mp); faceCam(mesh, i, o); return; }
    V2.multiplyScalar(HS); fpt(o, o.x, hy, hz, V1); Mh.compose(V1, Q1.setFromEuler(E1.set(o.hp || 0, yaw, o.hr || 0)), ONE);
    V1.set(pt.p[0] * K * HS, pt.p[1] * K * HS, pt.p[2] * K * HS); E1.set(pt.r || 0, 0, 0); Mp.compose(V1, Q1.setFromEuler(E1), V2); Mp.premultiply(Mh); mesh.setMatrixAt(i, Mp); faceCam(mesh, i, o);
  }
  /* Where a head looks: mostly straight ahead at the camera (yaw 0), with a
     glance at a neighbour on either side every few seconds, eased in and out.
     Chicks on a coffee break look around more often. A still frame (reduced
     motion) uses HEAD_YAW, which is the same straight-ahead pose. */
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
  const setK = (m, i, o, x, y, z, rx, sx = 1, sy = 1, sz = 1) => { fpt(o, x, y, z, TMP); setM(m, i, TMP.x, TMP.y, TMP.z, rx, 0, sx * K, sy * K, sz * K); faceCam(m, i, o); };

  /* ── 3D text: each zone's name is painted on the floor strip (LANE) in front of its rug. An upright board on a post used to carry it (2026-10-20 to
     2026-11-15), but the board stood over the front desks and hid them. The name gets the whole strip: the type shrinks before the name is cut (down to
     0.45 of the strip, then "…"). The ghost count stays off the floor (a badge there shrank the name); hovering the name shows it. A faint copy drawn
     without depth keeps the name readable where a desk or a person stands in front of it. ── */
  function decal(text, width, height, color){
    const cw = 2048, ch = Math.round(cw * height / width), c = document.createElement('canvas'), x = c.getContext('2d'); c.width = cw; c.height = ch;
    const fam = '"Noto Sans KR","Geist",-apple-system,"Segoe UI",sans-serif', pad = 32, maxW = cw - 2 * pad;
    let fs = Math.round(ch * 0.7); x.font = `800 ${fs}px ${fam}`;
    const fit = () => x.measureText(String(text)).width <= maxW;
    while(!fit() && fs > ch * 0.45){ fs -= 4; x.font = `800 ${fs}px ${fam}`; }
    let tx = String(text); if(!fit()){ while(tx.length > 1 && x.measureText(tx + '…').width > maxW) tx = tx.slice(0, -1); tx += '…'; }
    x.textBaseline = 'middle'; x.fillStyle = color; x.fillText(tx, pad, ch * 0.54);
    const tex = track(new T.CanvasTexture(c)); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const g = track(new T.PlaneGeometry(width, height)); g.rotateX(-Math.PI / 2);
    const m = track(new T.Mesh(g, track(new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })))); world.add(m);
    const see = track(new T.Mesh(g, track(new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.32, depthWrite: false, depthTest: false, toneMapped: false })))); see.renderOrder = 5; m.add(see);
    return m;
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
    const mp = modelParts(dt.models), mtot = mp.reduce((a, q) => a + q.v, 0), mpc = q => Math.round(q.v / mtot * 100);
    const modelsHtml = mp.length ? kit.stack(mp.map(q => ({ v: q.v, color: q.color, tip: `${q.k} · ${fm(q.v)} · ${mpc(q)}%` })))
      + `<div class="famt">${mp.map(q => `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:${q.color}"></i>${esc(q.k)} ${esc(fm(q.v))} (${mpc(q)}%)</span>`).join('')}</div>`
      : dt.modelsMissing ? `<div class="famt">${esc(ui.modelsNone)}</div>` : '';
    const daily = dt.days && dt.days.length ? kit.chart(id + '-d', dt.days, [{ name: ui.spent, color: '#8b7cf0', kind: 'bar', vals: dt.spent, fmt: fm }, { name: ui.saved, color: '#2f9e6f', kind: 'line', vals: dt.saved, fmt: fm }], undefined, undefined, { total: ui.total }) : '';
    const pdaily = dt.pdays && dt.pdays.length ? kit.chart(id + '-p', dt.pdays, [{ name: ui.pname || '', color: '#e0a23c', kind: 'bar', vals: dt.pvals, fmt: v => String(Math.round(v)) }], undefined, undefined, { total: ui.total }) : '';
    const hdr = `<div class="hd">${speciesThumb(sel.gk, '--tc:' + (sel.tv ? sel.tv.body : '#d9cdb8'))}<div><b title="${esc(p.name)}">${p.crown ? CROWN_ICON : ''}${esc(p.name)}<span class="badge">${esc(p.gradeLabel || p.tierText)}</span>${lvOf(p.lvl) && !sel.ghost ? `<span class="badge lvb">${esc(lvText(lvOf(p.lvl)))}</span>` : ''}</b><small>${esc(p.teamName)}</small></div><button type="button" class="x" data-a="close" aria-label="${esc(ui.close)}">×</button></div><div class="bkbar"><button type="button" class="bk" data-a="close">← ${esc(ui.back || ui.close)}</button></div>`;
    const inShop = shopFor(sel) && shop && shop.open; chrome.el.classList.toggle('shop', !!inShop); stage.classList.toggle('of-shop', !!inShop); sheetSync(inShop);   /* a phone gives the shop a one line header, under 520 px a sheet */
    if(inShop){ chrome.setHtml(hdr.replace(/<div class="bkbar">[\s\S]*$/, '') + shopHtml()); shopAfter(); return; }
    const ulk = shopFor(sel) ? unlockHtml() : naNote && p.self ? `<div class="why">${esc(((cur.shop || {}).ui || {})['err.na'] || '')}</div>` : '';
    /* someone else's pet: its name, and its breed once the breed list is in (asked for here when the look names one) */
    const pl = !p.self && !sel.ghost ? normalizePetLook(p.pet) : null, bn = pl && pl.breed ? breedOf(pl.breed) : '';
    if(pl && pl.breed && !breedRows) breedsLoad();
    const petLn = pl ? `<div class="petln">${PAW_SVG}<b>${esc(petTitle(pl))}</b>${bn ? `<span>${esc(bn)}</span>` : ''}</div>` : '';
    if(dt.redacted){ chrome.setHtml(hdr + `<div class="bd">${petLn}${dt.why ? `<div class="why">${esc(dt.why)}</div>` : ''}<div class="why">${esc(ui.redacted || '')}</div></div>`); return; }
    chrome.setHtml(hdr
      + `<div class="bd">${ulk}${petLn}${dt.why ? `<div class="why">${esc(dt.why)}</div>` : ''}`
      + ((dt.next || []).length ? `<div class="nx">${dt.next.map((l, i) => `<div${i ? '' : ' class="h"'}>${esc(l)}</div>`).join('')}</div>` : '')
      + (dt.groups && dt.groups.length ? `<div class="sec">${dt.groups.map(g => `<div class="grp"><h4>${esc(g.title)}</h4>${kvGrid(g.rows)}</div>`).join('')}</div>`
        : dt.grid && dt.grid.length ? `<div class="sec">${kvGrid(dt.grid)}</div>` : '')
      + sec(ui.models, modelsHtml) + sec(ui.runs, famHtml) + sec(ui.cmp, kit.cmp(dt.cmp || [])) + sec(ui.daily, daily) + sec(ui.pdaily, pdaily)
      + sec(ui.machines, (dt.machines || []).map(m => `<div class="mrow"><b>${esc(m.name)}</b><span class="sig" style="background:${m.color}">${esc(m.sig)}</span><small>${esc(m.os)}${m.ver ? ' · ' + esc(m.ver) : ''} · ${esc(m.sw)}</small><small>${esc(ui.up)} ${esc(m.up)} · ${esc(ui.seen)} ${esc(m.seen)}</small></div>`).join(''))
      + sec(ui.events, (dt.events || []).map(e => `<div class="evr"><span>${esc(e.text)}</span><span>${esc(e.when)}</span></div>`).join('')) + `</div>`
      + (opts.readOnly ? '' : `<div class="ft"><button type="button" class="of-dbtn pri" data-a="seats">${esc(ui.seats)}</button>${dt.canPrompts ? `<button type="button" class="of-dbtn" data-a="prompts">${esc(ui.prompts)}</button>` : ''}</div>`));
  }
  /* the field guide: the same drawer, one row per species, a click blinks a ring under everyone of that species */
  function renderBook(){
    const b = cur.book; if(!b) return;
    const top = b.top && b.top.rows.length ? `<div class="bkt"><h4>${esc(b.top.title)}</h4>${b.top.rows.map(r => `<button type="button" class="bkp" data-pp="${esc(r.id)}"><span class="rk">${esc(r.rk)}</span>${speciesThumb(r.k)}<span class="nm">${esc(r.name)}<small>${esc(r.gname)}${r.team ? ' · ' + esc(r.team) : ''}</small></span>${r.crown ? CROWN_ICON : ''}</button>`).join('')}</div>` : '';
    let tier = null, rows = '';
    b.rows.forEach(r => {
      if(b.tiers && r.tier !== tier){ tier = r.tier; rows += `<h4 class="bkh">${esc(b.tiers[r.tier] || r.role)}</h4>`; }
      rows += `<button type="button" class="bkr${r.n ? '' : ' z'}" data-bk="${esc(r.k)}">${speciesThumb(r.k)}<span class="nm">${r.no ? `<small class="no">${esc(r.no)}</small>` : ''}${esc(r.name)}${b.tiers ? '' : `<small>${esc(r.role)}</small>`}</span><span class="ct2">${esc(r.nText != null ? r.nText : r.n)}</span><span class="rg">${esc(r.range)}</span></button>`;
    });
    chrome.setHtml(`<div class="hd">${BOOK_ICON}<div><b>${esc(b.title)}</b><small>${esc(b.range)}${b.found ? ' · ' + esc(b.found) : ''}</small></div><button type="button" class="x" data-a="close" aria-label="${esc((cur.ui || {}).close)}">×</button></div>`
      + `<div class="bd">${top}${rows}<p class="bknote">${esc(b.note)}</p>${b.small ? `<p class="bknote">${esc(b.small)}</p>` : ''}</div>`);
  }
  function openBook(){
    if(!cur.book) return;
    if(bookOpen && chrome.isOpen()){ chrome.close(); return; }
    shopReset(); unpose(sel); sel = null; selId = null; if(ring) ring.visible = false; hidePortrait(); bookOpen = true; renderBook(); chrome.open();
  }
  function pulseGrade(k){
    if(!sets || !sets.pul) return;
    pulse = { k, t0: performance.now() }; request();
    if(reduced) setTimeout(() => { pulse = null; request(); }, 2500);
  }
  function openDrawer(o, fly = true){ if(sel && sel !== o){ shopReset(); unpose(sel); } bookOpen = false; sel = o; selId = o.p.id; renderDrawer(); chrome.open(); if(ring) ring.visible = true; portrait(o); if(fly) focusOn(o); posePerson(o); }
  /* Look at the selected person's desk from the camera side, where the standing model faces us beside the laptop, at the closest zoom
     (view.zoomMax: the desk fills the view) and centred in the room the drawer and the portrait leave */
  function focusOn(o){
    if(!view) return; if(!homePose) homePose = view.getPose();   /* where to fly back to when the drawer closes */
    const W = stage.clientWidth, side = W > 480 ? 420 + (pr && pr.on ? PC_W + 10 : 0) : 0;
    view.flyTo({ x: o.x + POSE_X / 2, z: o.z + POSE_Z + 0.6, th: 0, ph: 1.05, zoom: view.zoomMax(), ox: side / 2 });
  }
  /* The selected character as a collectible card left of the drawer: a tier-coloured frame, the name and rank on top, the character in an art window
     (its own renderer, scene and three-point light, turned a quarter towards the drawer), the species line, up to three rows of the person's tip and a
     footer with the tier, rarity stars and the field guide number. The power tier and the crown get a holographic art background. PR_W x PR_H is the
     drawing buffer, the same 3:4 as the baked card frames; CSS shows it at 168 x 224 so the whole animal fits the 196 px art window. */
  const PR_W = 240, PR_H = 320, PC_W = 252; let pr = null, homePose = null;
  const pad3 = n => String(n).padStart(3, '0');
  function portrait(o){
    if(!castOn || !o.glb || stage.clientWidth < 900){ hidePortrait(); return; }
    if(!pr){
      const el = document.createElement('div'); el.className = 'of-pcard'; el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<i class="pc-foil"></i><i class="pc-star"></i><div class="pc-in"><div class="pc-hd"></div><div class="pc-art"><i class="pc-holo"></i><i class="pc-floor"></i><canvas></canvas></div><div class="pc-sp"></div><div class="pc-mv"></div><div class="pc-ft"></div></div><i class="pc-orn"></i><i class="pc-spk"></i><i class="pc-glare"></i>';
      const c = el.querySelector('canvas'); stage.appendChild(el);
      let r; try{ r = new T.WebGLRenderer({ canvas: c, antialias: true, alpha: true }); }catch(e){ el.remove(); return; }
      /* the pointer tilts the card a few degrees and moves the glare and the foil; the card swallows its own presses so they do not orbit the room */
      ['pointerdown', 'wheel', 'click'].forEach(ev => el.addEventListener(ev, e => e.stopPropagation()));
      if(!reduced){
        el.addEventListener('pointermove', e => { const b = el.getBoundingClientRect(), x = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y = Math.max(0, Math.min(1, (e.clientY - b.top) / b.height));
          el.classList.add('tilt'); el.style.setProperty('--ry', ((x - 0.5) * 16).toFixed(2) + 'deg'); el.style.setProperty('--rx', ((0.5 - y) * 16).toFixed(2) + 'deg'); el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%'); });
        el.addEventListener('pointerleave', () => { el.classList.remove('tilt'); ['--rx', '--ry', '--mx', '--my'].forEach(k => el.style.removeProperty(k)); });
      }
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.setSize(PR_W, PR_H, false); r.setClearColor(0x000000, 0);
      const sc = new T.Scene(), key = new T.DirectionalLight('#fff0d4', 2.0), rl = new T.DirectionalLight('#e6ecff', 1.0); key.position.set(-2, 3, 4); rl.position.set(2.5, 2, -3); sc.add(new T.HemisphereLight('#f3f1ff', '#e8dcc4', 0.9), key, rl);
      pr = { el, c, r, sc, cam: new T.PerspectiveCamera(26, PR_W / PR_H, 0.1, 50), m: null, q: null, card: null, raf: 0, on: false };
    }
    if(pr.m) pr.sc.remove(pr.m);
    if(pr.q) pr.sc.remove(pr.q.mesh);
    sprReveal(o);
    const m = pr.m = (o.pose || o.glb).clone(true); m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.setScalar(1); pr.sc.add(m);
    m.traverse(c => { if(c.userData && c.userData.fur) c.visible = false; });   /* the card is a close-up: shell fur read as tangled noise there, the plush texture alone stays clean */
    m.userData.flaps = [m.getObjectByName('flap_L'), m.getObjectByName('flap_R')];
    /* A baked Cycles image replaces the model's colours when the manifest has a card for the species and the standing model is in (the card was baked from it).
     * For a ghost, or when the sheet or the standing model fails, the live 3D model below is what shows. */
    const ca = !o.ghost && sprOn && sprKit && sprMan ? cardOf(sprMan, o.gk) : null, cs = ca ? sprKit.card(o.gk) : null, cd = ca && o.pose ? ca : null;
    /* While the sheet or the standing model is still on its way the art window stays empty. Showing the seated model first and swapping in the baked
     * image a moment later read as 3D turning into 2D. The sheet is asked for here, at the click, so it downloads alongside the standing model;
     * posePerson() calls portrait() again when the model is in, and the sheet's promise does the same. */
    if(cs && !cs.bad && (!cs.t || (!o.pose && !o.poseFailed))){ m.visible = false; if(!cs.t){ const pk = o; cs.p.then(() => { if(sel === pk && pr && pr.on && !destroyed) portrait(pk); }); } }
    pr.card = null;
    if(cd && cs.t){
      m.traverse(c => { if(c.userData && c.userData.holPiece) c.userData.keepLook = true; });
      sprKit.depthOnly(m);   /* depth only: the accessories stay 3D on top of the image and the body hides them where it should */
      pr.q = pr.q || sprKit.cardQuad(); pr.q.show(cs.t, cd); pr.sc.add(pr.q.mesh); pr.card = cd;
      /* The card holds its middle frame: five frames 6 degrees apart swaying back and forth stepped visibly from one to the next */
      m.rotation.y = pr.q.blend(cd.yaws[Math.min(2, cd.yaws.length - 1)]);
      pr.cam.fov = cd.fov; pr.cam.position.set(cd.cam[0], cd.cam[1], cd.cam[2]); pr.cam.lookAt(cd.at[0], cd.at[1], cd.at[2]);
    }else{
      /* whole body in the card: fit the height and the turning width (the model sways about y) with a small margin */
      const box = new T.Box3().setFromObject(m), sz = box.getSize(new T.Vector3()), hgt = sz.y, cy = box.min.y + hgt * 0.5;
      pr.cam.fov = 26;
      const tn = Math.tan(pr.cam.fov * Math.PI / 360), rw = Math.hypot(sz.x, sz.z) / 2;
      const dist = Math.max(hgt * 0.56 / tn, rw * 1.08 / (tn * pr.cam.aspect)) + rw;
      pr.cam.position.set(0, cy + hgt * 0.12, dist); pr.cam.lookAt(0, cy, 0);
    }
    pr.cam.updateProjectionMatrix();
    pcFill(o); pr.on = true; pr.el.classList.add('on');
    if(!pr.raf){ const t0 = performance.now(), loop = () => { if(!pr || !pr.on || destroyed){ if(pr) pr.raf = 0; return; }
      const ts = (performance.now() - t0) / 1000; if(pr.m && !pr.card){ pr.m.rotation.y = 0.44 + (reduced ? 0 : Math.sin(ts * 0.7) * 0.22); flapAt(pr.m, ts); } pr.r.render(pr.sc, pr.cam); pr.raf = reduced || pr.card ? 0 : requestAnimationFrame(loop); };
      loop(); }
  }
  /* the card's text: rows that repeat the team (the member town's tip for others) are left out, the field guide number is the species' place in GRADES */
  function pcFill(o){
    const p = o.p || {}, el = pr.el, tier = o.ghost ? 'nodata' : p.tier, ti = TIERS.indexOf(tier), no = o.ghost ? 0 : gradeIndex(o.gk) + 1, on = el.classList.contains('on');
    const lv = o.ghost ? 0 : lvOf(p.lvl);
    el.className = 'of-pcard t-' + (tier || 'nodata') + (p.crown ? ' crown' : '') + (lv ? ' lv-' + lv : '') + (on ? ' on' : ''); el.style.setProperty('--tc', o.tv ? o.tv.body : '#d9cdb8');
    el.querySelector('.pc-hd').innerHTML = `<b>${esc(p.name || '')}</b>` + (lv ? `<span class="lvb">${esc(lvText(lv))}</span>` : '') + (p.rank ? `<span class="rk">${p.crown ? CROWN_ICON : ''}<small>#</small>${p.rank}</span>` : '');
    el.querySelector('.pc-sp').innerHTML = (no > 0 ? `<span>No.${pad3(no)}</span>` : '') + `<span>${esc(p.gradeText || '')}</span>` + (p.teamName ? `<span>${esc(p.teamName)}</span>` : '');
    el.querySelector('.pc-mv').innerHTML = (p.tip || []).filter(r => r[1] !== p.teamName).slice(0, 3).map(r => `<div><i></i><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('');
    el.querySelector('.pc-ft').innerHTML = `<span>${esc(p.tierText || '')}</span><span class="rar">${ti >= 0 ? '★'.repeat(TIERS.length - ti) : ''}</span><span>${no > 0 ? pad3(no) + '/' + pad3(GRADES.length) : ''}</span>`;
  }
  function hidePortrait(){ if(!pr) return; pr.on = false; pr.el.classList.remove('on'); if(pr.raf){ cancelAnimationFrame(pr.raf); pr.raf = 0; } }
  const closeDrawer = () => chrome.close();

  /* ── the object viewer: a desk item, a photo frame or a pet seen large over the stage (an art area up to VW_MAX px, larger than the profile card, and also
     under 900 px where the card is hidden). A backdrop over the stage takes the click outside and every press and wheel, so the room neither orbits nor picks
     while it is open. Desk items and pets are fresh instances (never the scene's own objects) in a renderer of its own, made on first use and freed on
     destroy like the card's; they turn slowly (not under reduced motion) and by drag, and animated items keep ticking. The frame shows the photo itself.
     Opening it leaves the drawer and the camera alone. Keyboard: the close button takes focus, Escape closes, focus goes back to the stage. ── */
  const VW_MAX = 420, VW_ROT0 = -0.45; let vw = null;   /* VW_ROT0: the front three-quarter view every piece opens at */
  const photoSafe = s => typeof s === 'string' && s.length < PET_PHOTO_LOCAL && PET_PHOTO_RE.test(s);   /* the browser's own photo may be larger than a shared one; the pattern is the safety part */
  const vwUi = () => (cur && cur.ui && cur.ui.view) || {};
  const petTitle = look => (look && look.name) || (vwUi().kind || {})[look && look.kind] || '';
  /* what the viewer shows: one layout for the three kinds (title, a sub line naming the owner the same way, the art, a hint line that is always there). over: a
     look to show instead of the pet's own (the shop's preview opens the edited look). A pet with a photo here (own) or shared shows it beside the model. */
  function objInfo(kind, o, over){
    const pt = pets.find(q => q.o === o), ui = vwUi(), owner = (o && o.p && o.p.name) || '', of = k => fillT(ui[k], { n: owner });
    if(kind === 'desk'){ const id = o.desk && o.p.gear && o.p.gear.desk; return id ? { kind, o, title: (ui.gear || {})[id] || id, sub: [of('ownDesk')], hint: ui.drag, make: () => makeDeskItem(T, id) } : null; }
    if(kind === 'pet'){ const L = (over && over.look) || (pt && pt.look); if(!L) return null; const ph = over && over.pin !== undefined ? over.pin : petPhotoSrc(o);
      return { kind, o, title: petTitle(L), sub: [of('ownPet'), breedOf(L.breed)].filter(Boolean), hint: ui.drag, pin: photoSafe(ph) ? ph : null, make: () => makePet(T, L, PET_GEAR) }; }
    if(!pt) return null;
    if(kind === 'frame' && pt.frame && pt.photo) return { kind, o, title: fillT(ui.photo, { n: petTitle(pt.look) }), sub: [of('ownDesk')], photo: pt.photo,
      hint: o.p.self ? ui[cur.shop && cur.shop.photoShared === true ? 'mineShared' : 'mine'] : of('shared') };
    return null;
  }
  const vwSize = () => Math.round(Math.max(150, Math.min(VW_MAX, stage.clientWidth - 44, stage.clientHeight - 104)));
  const vwKey = e => { if(!vw || !vw.on) return; if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); viewClose(); } else if(e.key === 'Tab' && vw.el.contains(e.target)){ e.preventDefault(); vw.x.focus(); } };   /* the close button is the dialog's one stop */
  function vwMake(){
    const bg = document.createElement('div'), el = document.createElement('div'); bg.className = 'of-vwb'; el.className = 'of-view';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'o-vw-t'); el.setAttribute('aria-describedby', 'o-vw-s');
    el.innerHTML = '<div class="vw-hd"><div class="vw-tt"><b id="o-vw-t"></b><small id="o-vw-s"></small></div><button type="button" class="x">×</button></div><div class="vw-art"><canvas aria-hidden="true"></canvas><img class="vw-main" alt=""><img class="vw-pin" alt=""></div><p class="vw-drag"></p>';
    stage.append(bg, el);
    ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'contextmenu'].forEach(ev => [bg, el].forEach(n => n.addEventListener(ev, e => e.stopPropagation())));
    [bg, el].forEach(n => n.addEventListener('wheel', e => { e.stopPropagation(); e.preventDefault(); }, { passive: false }));
    bg.addEventListener('click', () => viewClose());
    const c = el.querySelector('canvas'); let r = null;
    try{ r = new T.WebGLRenderer({ canvas: c, antialias: true, alpha: true }); r.setClearColor(0x000000, 0); }catch(e){ r = null; }
    const sc = new T.Scene(), key = new T.DirectionalLight('#fff0d4', 2.0), rl = new T.DirectionalLight('#e6ecff', 1.0); key.position.set(-2, 3, 4); rl.position.set(2.5, 2, -3); sc.add(new T.HemisphereLight('#f3f1ff', '#e8dcc4', 0.95), key, rl);
    const pivot = new T.Group(); sc.add(pivot);
    /* a soft contact shadow on y = 0 under the piece (round, so it is not turned with it) */
    const cs = document.createElement('canvas'); cs.width = cs.height = 64; { const x = cs.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(60,40,20,.38)'); gr.addColorStop(0.55, 'rgba(60,40,20,.15)'); gr.addColorStop(1, 'rgba(60,40,20,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); }
    const shade = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ map: new T.CanvasTexture(cs), transparent: true, depthWrite: false })); shade.renderOrder = -1; shade.position.y = 0.002; sc.add(shade);
    vw = { bg, el, c, r, sc, pivot, shade, cam: new T.PerspectiveCamera(30, 1, 0.01, 50), img: el.querySelector('.vw-main'), pin: el.querySelector('.vw-pin'), x: el.querySelector('.x'), tt: el.querySelector('#o-vw-t'), st: el.querySelector('#o-vw-s'), hint: el.querySelector('.vw-drag'),
      g: null, info: null, on: false, raf: 0, rot: VW_ROT0, sp: 0, hold: 0, clr: 0, drag: null, t0: 0, last: 0, ppu: 0, s: 0 };
    vw.x.addEventListener('click', () => viewClose());
    /* drag turns the piece; the pointer is captured so a drag that leaves the art area keeps turning it */
    c.addEventListener('pointerdown', e => { if(!vw.g) return; vw.drag = { x: e.clientX, r: vw.rot }; try{ c.setPointerCapture(e.pointerId); }catch(er){} c.classList.add('drag'); });
    c.addEventListener('pointermove', e => { if(!vw.drag) return; vw.rot = vw.drag.r + (e.clientX - vw.drag.x) * 0.012; if(reduced) vwDraw(); });
    const up = () => { if(vw.drag){ vw.sp = 0; vw.hold = performance.now() + 2000; } vw.drag = null; c.classList.remove('drag'); vw.last = performance.now(); }; c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);   /* after a drag the auto-turn waits 2 s, then eases back in */
    window.addEventListener('keydown', vwKey, true);   /* capture: Escape closes the viewer before the drawer's own Escape handler sees it */
  }
  function vwFit(){
    const s = vw.s = vwSize(); vw.el.style.setProperty('--vw', s + 'px');
    if(vw.info && vw.info.photo){ const im = vw.img, w = im.naturalWidth, h = im.naturalHeight, m = s - 52; if(w && h){ const k = Math.min(m / w, m / h); im.style.width = Math.round(w * k) + 'px'; im.style.height = Math.round(h * k) + 'px'; } return; }
    if(!vw.g || !vw.r) return;
    const pr = Math.min(window.devicePixelRatio || 1, 2); vw.r.setPixelRatio(pr); vw.r.setSize(s, s, false);
    const g = vw.g; vw.pivot.rotation.y = 0; g.position.set(0, 0, 0); g.updateMatrixWorld(true);
    const b = new T.Box3().setFromObject(g, true), c = b.getCenter(new T.Vector3()), R = Math.max(1e-3, b.getBoundingSphere(new T.Sphere()).radius), h = b.max.y - b.min.y;
    g.position.set(-c.x, -b.min.y, -c.z);   /* turns about its own middle, standing on y = 0 */
    { const sz = b.getSize(new T.Vector3()), f = Math.max(sz.x, sz.z) * 1.15; vw.shade.scale.set(f, 1, f); }
    const fov = vw.cam.fov * Math.PI / 180, d = R / Math.sin(fov / 2) * 1.04;   /* the bounding sphere fits, so no turn crops it */
    vw.cam.aspect = 1; vw.cam.near = d / 50; vw.cam.far = d * 4; vw.cam.position.set(0, h / 2 + d * 0.3, d * 0.954); vw.cam.lookAt(0, h / 2, 0); vw.cam.updateProjectionMatrix();
    vw.ppu = s * pr / (2 * d * Math.tan(fov / 2));
    if(reduced && vw.on) requestAnimationFrame(() => vwDraw());   /* reduced motion has no loop: a resize redraws once */
  }
  /* opening starts the panel's transition first and builds the model on the next frame, so the fade is not held up by the build */
  function viewOpen(kind, o, over){
    const info = o && T ? objInfo(kind, o, over) : null; if(!info) return false;
    if(!vw) vwMake();
    if(!info.photo && !vw.r) return false;
    clearTimeout(vw.clr); vw.clr = 0; if(vw.raf){ cancelAnimationFrame(vw.raf); vw.raf = 0; }
    viewClear(); vw.info = info;
    const ui = vwUi(); vw.tt.textContent = info.title; vw.st.innerHTML = info.sub.map(x => `<span>${esc(x)}</span>`).join(''); vw.x.setAttribute('aria-label', ui.close || 'Close'); vw.hint.textContent = info.hint || '';
    vw.el.classList.toggle('photo', !!info.photo); vw.el.classList.toggle('pin', !!info.pin); if(info.pin){ vw.pin.alt = fillT(ui.photo, { n: info.title }); vw.pin.src = info.pin; }
    if(info.photo){ vw.img.alt = info.title; vw.img.onload = () => { if(vw && vw.info === info) vwFit(); }; vw.img.src = info.photo; }
    vwFit(); setHover(null);
    vw.on = true; vw.bg.classList.add('on'); vw.el.classList.add('on'); vw.x.focus({ preventScroll: true });
    if(!info.photo) vw.raf = requestAnimationFrame(() => {
      vw.raf = 0; if(!vw || !vw.on || vw.info !== info || destroyed) return;
      const g = info.make(); vw.g = g; vw.pivot.add(g); vw.rot = VW_ROT0; vw.sp = 0; vw.hold = performance.now() + 1200;   /* front three-quarter, held a moment before it turns */
      if(kind === 'pet') g.userData.pose(reduced ? 'sit' : 'stand', 0, 0, { blend: 0 }); else if(g.userData.tick) g.userData.tick(0, envN, true);
      vwFit(); vw.t0 = vw.last = performance.now();
      const loop = now => { vw.raf = 0; if(!vw || !vw.on || destroyed) return; vwDraw(now); if(!reduced) vw.raf = requestAnimationFrame(loop); }; loop(performance.now());
    });
    return true;
  }
  function vwDraw(now = performance.now()){
    if(!vw || !vw.on || !vw.g || !vw.r) return;
    const dt = Math.min(0.05, Math.max(0, (now - vw.last) / 1000)), ts = (now - vw.t0) / 1000, u = vw.g.userData; vw.last = now;
    if(!reduced && !vw.drag){ vw.sp += ((now >= vw.hold ? 0.45 : 0) - vw.sp) * Math.min(1, dt * 1.6); vw.rot += vw.sp * dt; }   /* eases in, never jumps to speed */
    vw.pivot.rotation.y = vw.rot;
    if(vw.info.kind === 'pet'){ u.pose(reduced ? 'sit' : 'stand', 0, reduced ? 0 : ts, { blend: reduced ? 0 : undefined }); (u.gearParts || []).forEach(h => { if(h.userData.tick) h.userData.tick(ts, envN, reduced); }); u.fur(vw.ppu); }   /* fur stays on under reduced motion: it is a still look, not motion */
    else if(u.tick) u.tick(ts, envN, reduced);
    vw.r.render(vw.sc, vw.cam);
  }
  function viewClear(){ if(!vw) return; if(vw.g){ vw.pivot.remove(vw.g); vw.g.userData.dispose(); vw.g = null; } vw.img.onload = null; vw.img.removeAttribute('src'); vw.pin.removeAttribute('src'); vw.img.style.width = vw.img.style.height = ''; vw.drag = null; }
  /* closing fades the panel with its content and clears it after the fade (0.22 s), unless it was opened again meanwhile */
  function viewClose(focus = true){
    if(!vw || !vw.on) return;
    vw.on = false; vw.el.classList.remove('on'); vw.bg.classList.remove('on'); if(vw.raf){ cancelAnimationFrame(vw.raf); vw.raf = 0; }
    clearTimeout(vw.clr); vw.clr = setTimeout(() => { if(vw && !vw.on){ vw.clr = 0; viewClear(); vw.info = null; } }, reduced ? 0 : 240);
    if(focus && canvas) canvas.focus({ preventScroll: true });
  }
  function viewKill(){ if(!vw) return; viewClose(false); clearTimeout(vw.clr); viewClear(); window.removeEventListener('keydown', vwKey, true); if(vw.r){ vw.r.dispose(); vw.r.forceContextLoss(); } vw.shade.geometry.dispose(); vw.shade.material.map.dispose(); vw.shade.material.dispose(); vw.el.remove(); vw.bg.remove(); vw = null; }
  /* the clickable objects with their projected centre and pick radius (OBJ_R of the bounding sphere, close to the silhouette, so a passing pet does not take a
     click meant for the person behind it). Desk items and frames stand still, so their sphere is kept; a pet's centre comes from where it is and its
     standing height (pt.bs, petModel), never from a bounding box per pointer move. */
  function objList(){
    if(!view || !T) return [];
    const k = scale * view.zoom(), out = [], b = new T.Box3();
    const add = (kind, o, g) => { if(!g || !g.visible || !g.parent) return; let sp = g.userData.vbs;
      if(!sp){ g.updateMatrixWorld(true); sp = g.userData.vbs = b.setFromObject(g).getBoundingSphere(new T.Sphere()); }
      const [x, y] = proj(HP.copy(sp.center), PT); out.push({ kind, o, x, y, r: sp.radius * k * OBJ_R }); };
    people.forEach(o => { if(o.desk && !o.ghost) add('desk', o, o.desk); });
    pets.forEach(pt => { if(pt.frame && pt.frame.visible) add('frame', pt.o, pt.frame); if(!pt.g.visible) return;
      const s = pt.g.scale.y, bs = pt.bs || { h: 0.5, r: 0.4 }, [x, y] = proj(HP.set(pt.x, pt.y + bs.h * s * 0.5, pt.z), PT); out.push({ kind: 'pet', o: pt.o, x, y, r: bs.r * s * k * OBJ_R }); });
    return out;
  }

  /* ── breeds (opts.shop.breeds, else opts.breeds: an async function the page supplies, read once): the shop's breed select and the breed name under a pet ── */
  let breedRows = null, breedP = null;
  function breedsLoad(){
    const fn = (opts.shop && typeof opts.shop.breeds === 'function' && opts.shop.breeds) || (typeof opts.breeds === 'function' && opts.breeds) || null;
    if(breedP || !fn) return breedP || Promise.resolve([]);
    return (breedP = Promise.resolve().then(fn).then(r => breedList(r), () => []).then(list => { breedRows = list; if(destroyed) return list;
      if(shop && shop.tab === 'pet') rerender(); else if(sel && chrome.isOpen() && !shop) renderDrawer(); return list; }));
  }
  const breedOf = key => { const b = key && breedRows ? breedRows.find(r => r.key === key) : null; return breedName(b, document.documentElement.lang || 'en'); };

  /* ── the shop (member page, the viewer's own drawer only): an unlock block above the usage sections, and a panel that replaces the drawer's body
     with three tabs. Head and desk tiles preview on the viewer's character at once (o.p.gear is swapped and the standing model, the desk item and
     the card are redressed); Save calls opts.shop.save, Cancel and a failure put the saved choice back. The pet tab reads a photo in this browser
     (petLookFromPixels) into a form with a small turning preview; the photo itself goes to the page through save's extra argument and stays local. ── */
  let shop = null, shopNa = false, naNote = false, thumbR = null, pv = null; const thumbs = {};
  const SHOP_TABS = ['book', 'head', 'back', 'desk', 'pet', 'petgear'];   /* the collection comes first, then the three gear slots, the pet and its goods */
  const petTab = t => t === 'pet' || t === 'petgear';   /* the two tabs edit one look (shop.pet), with one preview and one save */
  const shopFor = o => !!(o && o.p && o.p.self && cur.shop && opts.shop && typeof opts.shop.save === 'function' && !shopNa && !cur.closed);
  const fillT = (s, v) => { let r = String(s || ''); for(const k in v) r = r.split('{' + k + '}').join(String(v[k])); return r; };
  const listOf = a => { const lang = document.documentElement.lang || 'en'; if(/^ko/.test(lang)) return a.join(', ');   /* Korean lists join with commas, never with 및 */
    try{ return new Intl.ListFormat(lang, { type: 'conjunction' }).format(a); }catch(e){ return a.join(', '); } };
  const PET_SPARE = ['#d9b48f', '#f3efe8', '#5a4a3c'];
  function petState(){
    const u = cur.shop || {}, look = normalizePetLook(u.pet);
    /* share: the photo visibility choice (the server's state to begin with); mem: the last colour per coat position, so a pattern switched back gets it again;
       open: which form groups are expanded (kept across re-renders) */
    return { look: look || { ...PET_DEFAULTS, coat: [PET_SPARE[0]] }, had: !!look, photo: null, shown: (u.pet && typeof u.pet.photo === 'string' && u.pet.photo) || null, read: false, dirty: false,
      share: u.photoShared === true, mem: (look ? look.coat : [PET_SPARE[0]]).slice(), hex: {}, open: (shop && shop.pet && shop.pet.open) || { basic: true, coat: true, shape: false, face: false } };
  }
  /* under 520 px the open shop is a sheet over the page (CSS .of-sheet): the page under it stops scrolling until it closes */
  function sheetSync(on){ const s = !!on && window.innerWidth < 520; stage.classList.toggle('of-sheet', s); document.documentElement.classList.toggle('of-sheet-on', s); }
  function shopStart(){ const g = gearOf(cur.shop.gear); shop = { open: true, tab: 'book', base: g, draft: { ...g }, pet: petState(), busy: false, msg: null }; }
  const gearDirty = () => !!shop && (shop.draft.head !== shop.base.head || shop.draft.back !== shop.base.back || shop.draft.desk !== shop.base.desk);
  function previewGear(){
    const o = sel; if(!o || !shop) return;
    o.p.gear = { ...shop.draft };
    if(o.pose) redress(o.pose, o, 'pose-'); else if(o.glb) redress(o.glb, o, '');
    placeDesk(o); if(pr && pr.on) portrait(o); if(renderer) renderer.shadowMap.needsUpdate = true; request();
  }
  /* leaving the shop (back, another person, closing the drawer): an unsaved preview goes back to the saved choice */
  function shopReset(){ if(!shop) return; if(gearDirty()){ shop.draft = { ...shop.base }; previewGear(); } const live = shop.pet && (shop.pet.dirty || shop.pet.had); shop = null; pvStop(); if(live) petLive(null); }
  function rerender(){
    if(!sel) return;
    const a = document.activeElement, kf = e => [e.dataset.sh, e.dataset.v, e.dataset.pf].map(x => x || '').join('|'), key = a && chrome.el.contains(a) && a.dataset ? kf(a) : null;
    const bd = chrome.el.querySelector('.bd'), top = bd ? bd.scrollTop : 0;
    renderDrawer();
    const bd2 = chrome.el.querySelector('.bd'); if(bd2) bd2.scrollTop = top;
    if(key && key !== '||'){ const m = [...chrome.el.querySelectorAll('[data-sh],[data-pf]')].find(e => kf(e) === key); if(m) m.focus({ preventScroll: true }); }
  }
  function unlockHtml(){
    const u = cur.shop, ui = u.ui || {}, x = unlockNext(u), fm = u.fmt || fmtMoney, pc1 = pctDown, pc0 = v => +(v * 100).toFixed(1) + '%';
    const bar = (label, a, b, k, id) => `<div class="ulk-r"><span id="${id}">${esc(label)}</span><b>${esc(a)} / ${esc(b)}</b></div><div class="ulk-bar" role="progressbar" aria-labelledby="${id}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(k * 100)}" aria-valuetext="${esc(a + ' / ' + b)}"><i style="--k:${k.toFixed(3)}"></i></div>`;
    let body = '';
    if(x.top) body = `<p class="ulk-n">${esc(ui.top)}</p>`;
    else if(x.next){
      /* both conditions are needed: the spend bar and either the delegation share bar or, where the level asks only for a delegation, a run count out of one */
      const dl = x.next.dlg > 0, n = x.next.lvl;
      body = bar(ui.spent, fm(moneyDown(x.spent)), fm(x.next.spent), x.spentK, 'o-ulk-s')
        + (dl ? bar(ui.dlg, pc1(x.dlg), pc0(x.next.dlg), x.dlgK, 'o-ulk-d') : bar(ui.runs, String(Math.min(x.runs, 1)), '1', x.runs > 0 ? 1 : 0, 'o-ulk-d'))
        + `<p class="ulk-n">${esc(fillT(dl ? ui.need : ui.need1, { n, s: fm(x.next.spent), d: pc0(x.next.dlg) }))}</p>`;
      if(x.opens.length) body += `<p class="ulk-n">${esc(fillT(ui.next, { n, x: listOf(x.opens.map(id => id === 'pet' ? ui['item.pet'] : id === 'toys' ? ui['item.toys'] : id.startsWith('pg:') ? fillT(ui['pg.opens'], { n: id.slice(3) }) : (ui.gear || {})[id] || id)) }))}</p>`;
    }
    const ghost = sel && sel.ghost ? `<p class="ulk-g">${esc(ui.ghost)}</p>` : '';   /* a ghost wears nothing: say why, and keep saving possible */
    return `<div class="ulk" role="group" aria-labelledby="o-ulk-h"><div class="ulk-h"><b id="o-ulk-h">${esc(ui.title)}</b><span class="badge lvb">${esc(lvText(x.level))}</span><small>${esc(ui.scope)}</small></div>${body}${ghost}<button type="button" class="of-dbtn out" data-sh="open">${esc(ui.open)}</button></div>`;
  }
  const msgHtml = () => `<p class="sh-msg${shop.msg && shop.msg.err ? ' err' : ''}" role="status" aria-live="polite">${esc(shop.msg ? shop.msg.text : (shop.busy ? cur.shop.ui.saving : ''))}</p>`;
  const SV = (vb, d) => `<svg viewBox="${vb}" aria-hidden="true">${d}</svg>`;
  const LOCK_SVG = SV('0 0 10 10', '<rect x="1.8" y="4.4" width="6.4" height="4.8" rx="1" fill="currentColor"/><path d="M3.3 4.5V3.2a1.7 1.7 0 0 1 3.4 0v1.3" fill="none" stroke="currentColor" stroke-width="1.1"/>');
  const NONE_SVG = SV('0 0 24 24', '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 18L18 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');
  const HIDE_SVG = SV('0 0 16 16', '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="currentColor"/><path d="M2.5 13.5l11-11" stroke="#fff" stroke-width="3"/><path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>');
  const TOY_SVG = SV('0 0 12 12', '<circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 4.6c2.6 1 5.4 1 8 0M2 7.4c2.6-1 5.4-1 8 0" fill="none" stroke="currentColor" stroke-width="1"/>');
  const shopFoot = (dirty, saveOk) => `<div class="sh-foot">${msgHtml()}<div class="sh-act"><button type="button" class="of-dbtn plain" data-sh="cancel"${dirty && !shop.busy ? '' : ' disabled'}>${esc(cur.shop.ui.cancel)}</button><button type="button" class="of-dbtn pri" data-sh="save"${saveOk && !shop.busy ? '' : ' disabled'}>${esc(cur.shop.ui.save)}</button></div></div>`;
  /* one slot's tiles and the bar under the panel. Head items the viewer's present animal does not draw (its horns, antlers or ears leave no room for it, gear.js headGearSkips;
     wings the same way for a species with wings of its own, backGearSkips)
     stay selectable, since the animal changes with rank; the tile and a note under the grid say so */
  /* one tile of a shop grid. o: act (the data-sh action), slot (data-slot, pet goods), id ('' is the none tile), th (the thumbnail key when it is not the id), name, noneTx (text for
     the none tile instead of the crossed circle), open, lvl, pressed, skip, dis. The gear tabs and the pet goods tab share this markup. */
  const shopTile = (ui, o) => { const sk = !!o.skip, th = o.th || o.id, tip = [o.open ? '' : fillT(ui.lockedSr, { n: o.lvl }), sk ? ui.skipSr : ''].filter(Boolean).join(' ');
    return `<button type="button" class="sh-tile" aria-pressed="${!!o.pressed}"${o.open ? '' : ' aria-disabled="true"'}${tip ? ` title="${esc(tip)}"` : ''} data-sh="${o.act}"${o.slot ? ` data-slot="${o.slot}"` : ''} data-v="${o.id || ''}"${o.dis || ''}>`
      + (o.id ? `<img alt="" data-th="${esc(th)}"${thumbs[th] ? ` src="${thumbs[th]}"` : ''}>` : o.noneTx ? `<span class="ph tx" aria-hidden="true">${esc(o.noneTx)}</span>` : `<span class="ph" aria-hidden="true">${NONE_SVG}</span>`) + `<span class="nm">${esc(o.name)}</span>`
      + (sk ? `<span class="sk" aria-hidden="true">${HIDE_SVG}</span><span class="of-sr">${esc(ui.skipSr)}</span>` : '')
      + (o.open ? '' : `<span class="lk" aria-hidden="true">${LOCK_SVG}${esc(fillT(ui.locked, { n: o.lvl }))}</span><span class="of-sr">${esc(fillT(ui.lockedSr, { n: o.lvl }))}</span>`) + '</button>'; };
  function gearHtml(slot){
    const u = cur.shop, ui = u.ui, now = shop.draft[slot], dirty = gearDirty(), skips = !sel ? [] : slot === 'head' ? headGearSkips(sel.gk) : slot === 'back' ? backGearSkips(sel.gk) : [];
    const tile = (id, name, open, lvl) => shopTile(ui, { act: 'pick', id, name, open, lvl, pressed: now === id, skip: !!id && skips.includes(id) });
    const note = now && skips.includes(now) ? `<p class="sh-note sk" role="status">${esc(ui.skip)}</p>` : '';
    return [`<div class="sh-grid" role="group" aria-label="${esc(ui['tab.' + slot])}">${tile(null, ui.none, true, 0)}${shopTiles(u, slot).map(t => tile(t.id, ui.gear[t.id] || t.id, t.open, t.lvl)).join('')}</div>` + note, shopFoot(dirty, dirty)];
  }
  /* The pet goods tab (after the pet): the pet's collar and tag, hat, wings, harness and clothes, and toys, each a grid of tiles like the gear tabs (a none tile, then every item of
     the slot, a locked one with its level). A pick edits the look the pet tab edits (shop.pet.look), so the two tabs share one draft, one preview and one save. The
     toys' none tile is Auto: the pet picks one as before. A pet is needed first: the tab says so and links to the pet tab. */
  const PG_SECTIONS = [['pet_head', 'hat', 'pg.head'], ['pet_back', 'wing', 'pg.back'], ['pet_body', 'body', 'pg.body'], ['pet_toy', 'toy', 'pg.toy']];
  function petGearHtml(){
    const u = cur.shop, ui = u.ui, lv = lvOf(u.level), pl = u.petLvl, op = ui.opt || {};
    if(pl == null || lv < pl) return [`<p class="sh-note">${esc(fillT(ui['pet.locked'], { n: pl == null ? LV_MAX : pl }))}</p>`, ''];
    const P = shop.pet, L = P.look, dis = shop.busy ? ' disabled' : '';
    if(!P.had) return [`<p class="sh-note">${esc(ui['pg.nopet'])}</p><button type="button" class="of-dbtn out" data-sh="tab" data-v="pet"${dis}>${esc(ui['pg.toPet'])}</button>`, ''];
    /* the collar and its tag come first: collar tiles (none, the collar), the colour while it is on, then the tag tiles (the round one is the default), switched off with a note while there is no collar */
    const colItems = shopTiles(u, 'pet_collar'), tagItems = shopTiles(u, 'pet_tag'), colOn = !!L.collar;
    const colHtml = !colItems.length && !tagItems.length ? '' : `<section class="pg-s"><h4 class="pg-h" id="o-pg-collar">${esc(ui['pg.collar'])}</h4>`
      + (!colItems.length ? '' : `<div class="sh-grid" role="group" aria-label="${esc(ui['pet.collar'])}">${shopTile(ui, { act: 'pgpick', slot: 'pet_collar', id: '', name: ui.none, open: true, pressed: !colOn, dis })}`
        + colItems.map(t => shopTile(ui, { act: 'pgpick', slot: 'pet_collar', id: t.id, th: 'pcol:' + t.id, name: ui['pet.collar'], open: t.open, lvl: t.lvl, pressed: colOn, dis })).join('') + '</div>')
      + (!colOn ? '' : `<div class="pet-row"><label for="o-pf-collar">${esc(ui['pet.collarColor'])}</label><div class="pet-inl"><input type="color" id="o-pf-collar" data-pf="collar" value="${esc(L.collar)}"${dis}></div></div>`)
      + (!tagItems.length ? '' : (colOn ? '' : `<p class="sh-note">${esc(ui['pg.tagNote'])}</p>`) + `<div class="sh-grid" role="group" aria-label="${esc(ui['pet.tag'])}">`
        + tagItems.map(t => shopTile(ui, { act: 'pgpick', slot: 'pet_tag', id: t.id, th: 'ptag:' + t.id, name: op['tag.' + t.id] || t.id, open: t.open, lvl: t.lvl, pressed: (L.tag || PET_TAGS[0]) === t.id, dis: dis || (colOn ? '' : ' disabled') })).join('') + '</div>') + '</section>';
    const sections = colHtml + PG_SECTIONS.map(([slot, key, hk]) => {
      const items = shopTiles(u, slot); if(!items.length) return '';
      const toy = slot === 'pet_toy', bodyS = slot === 'pet_body';
      const none = shopTile(ui, { act: 'pgpick', slot, id: '', name: toy ? ui['pet.toyAuto'] : ui.none, noneTx: toy ? ui['pet.toyAuto'] : '', open: true, pressed: !L[key], dis });
      const tiles = items.map(t => shopTile(ui, { act: 'pgpick', slot, id: t.id, th: toy ? 'toy:' + t.id : bodyS ? 'pbody:' + t.id : t.id, name: toy ? op['toy.' + t.id] || t.id : bodyS ? op['body.' + t.id] || t.id : ui.gear[t.id] || t.id,
        open: t.open, lvl: t.lvl, pressed: L[key] === t.id, dis })).join('');
      return `<section class="pg-s"><h4 class="pg-h" id="o-pg-${slot}">${esc(ui[hk])}</h4><div class="sh-grid" role="group" aria-labelledby="o-pg-${slot}">${none}${tiles}</div></section>`;
    }).join('');
    return [`<div class="pet-wrap"><div class="pet-f">${sections}</div><div class="pet-pvc"><div class="pet-pv" role="button" tabindex="0" data-sh="pvopen" aria-label="${esc(ui['pet.zoom'])}" title="${esc(ui['pet.zoom'])}"></div></div></div>`, shopFoot(P.dirty, P.dirty)];
  }
  /* The collection (the first tab): the viewer's level table as a book. One card per level the server's table lists: the level badge in the look of that
     level's profile frame, what it asks (the server's figures, formatted here), a stamp when reached, the two progress bars on the next goal, and a grid of what
     the level opens. An item that is open shows in colour, a locked one as a silhouette with its name; a tile goes to its tab and picks the item when open. */
  function bookHtml(){
    const u = cur.shop, ui = u.ui, b = bookOf(u), fm = u.fmt || fmtMoney, pc1 = pctDown, pc0 = v => +(v * 100).toFixed(1) + '%', runs = Math.min(1, Number(u.runs) || 0);
    const bar = (label, a, z, k, id) => `<div class="ulk-r"><span id="${id}">${esc(label)}</span><b>${esc(a)} / ${esc(z)}</b></div><div class="ulk-bar" role="progressbar" aria-labelledby="${id}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(k * 100)}" aria-valuetext="${esc(a + ' / ' + z)}"><i style="--k:${k.toFixed(3)}"></i></div>`;
    const tile = (key, label, open, slotLabel, thumb) => `<button type="button" class="bk-t${open ? '' : ' lock'}" data-sh="bkgo" data-v="${esc(key)}" aria-label="${esc(open ? label : label + ', ' + ui['book.locked'])}">`
      + `<span class="bk-sl" aria-hidden="true">${esc(slotLabel)}</span>${thumb}<span class="nm">${esc(label)}</span></button>`;
    const img = id => `<img alt="" data-th="${esc(id)}"${thumbs[id] ? ` src="${thumbs[id]}"` : ''}>`;
    const cards = b.pages.map(pg => {
      const dl = pg.dlg > 0, hid = 'o-bk-' + pg.lvl;
      const tiles = pg.items.map(it => tile(it.slot + '|' + it.id, (ui.gear || {})[it.id] || it.id, it.open, ui['slot.' + it.slot] || it.slot, img(it.id))).join('')
        + pg.feats.map(f => f === 'pet' ? tile('pet|pet', ui['book.pet'], pg.state === 'done', '', `<span class="ph" aria-hidden="true">${PAW_SVG}</span>`) : tile('pet|toys', ui['book.toys'], pg.state === 'done', '', img('toy:ball'))).join('');
      const mark = pg.state === 'done' ? `<span class="bk-stamp">${esc(ui['book.done'])}</span>` : pg.state === 'next' ? `<span class="bk-nx">${esc(ui['book.next'])}</span>` : `<span class="bk-lk">${LOCK_SVG}${esc(ui['book.locked'])}</span>`;
      const bars = pg.state !== 'next' ? '' : bar(ui['book.spent'], fm(moneyDown(u.spent)), fm(pg.spent), pg.spentK, hid + '-s')
        + (dl ? bar(ui['book.dlg'], pc1(u.dlg || 0), pc0(pg.dlg), pg.dlgK, hid + '-d') : bar(ui.runs, String(runs), '1', runs, hid + '-d'));
      return `<section class="bk-card ${pg.state}" aria-labelledby="${hid}"><div class="bk-hd"><span class="bk-lv lv-${pg.lvl}">${esc(lvText(pg.lvl))}</span><b id="${hid}">${esc(fillT(dl ? ui['book.need'] : ui['book.need1'], { s: fm(pg.spent), d: pc0(pg.dlg) }))}</b>${mark}</div>${bars}<div class="bk-grid">${tiles}</div></section>`;
    }).join('');
    const k = b.total ? b.got / b.total : 0;
    return [`<div class="bk-sum"><b id="o-bk-n">${esc(fillT(ui['book.got'], { n: b.got, m: b.total }))}</b><div class="ulk-bar" role="progressbar" aria-labelledby="o-bk-n" aria-valuemin="0" aria-valuemax="${b.total}" aria-valuenow="${b.got}"><i style="--k:${k.toFixed(3)}"></i></div></div>${cards}`, ''];
  }
  /* The pet tab (SPEC E): breed, the photo and who sees it, then four collapsible groups (basics, coat, shape, face and extras) left of a preview that stays in
     view while the form scrolls. Every colour input says what it paints (the pattern's coat roles, pets.js petCoatRoles); sliders carry captions at both ends. */
  const PET_RANGES = ['fluff', ...PET_NUMS], HEX_DEF = { eye: { dog: '#5a3d22', cat: '#8fae3c' }, nose: { dog: '#2d2323', cat: '#d98a8a' }, collar: '#d9534f', mark: '#f3efe8' };
  function petHtml(){
    const u = cur.shop, ui = u.ui, lv = lvOf(u.level), pl = u.petLvl, tl = u.toysLvl, toyOn = tl != null && lv >= tl, op = ui.opt || {};
    const toys = tl == null ? '' : `<p class="pet-toy${toyOn ? '' : ' off'}">${TOY_SVG}<span>${esc(toyOn ? ui['pet.toysOn'] : fillT(ui['pet.toys'], { n: tl }))}</span></p>`;
    if(pl == null || lv < pl) return [`<p class="sh-note">${esc(fillT(ui['pet.locked'], { n: pl == null ? LV_MAX : pl }))}</p>` + toys, ''];
    const P = shop.pet, L = P.look, dis = shop.busy ? ' disabled' : '', lang = document.documentElement.lang || 'en';
    const file = (cls, text) => `<label class="of-dbtn ${cls}">${esc(text)}<input type="file" accept="image/*" data-pf="file"${dis}></label>`;
    /* with a photo in, the photo shows clean and a small button under it changes it; without one, a drop area (touch screens say choose, never drop) */
    const photo = P.shown ? `<div class="pet-ph" data-drop><div class="pet-img" role="img" aria-label="${esc(ui['pet.photo'])}" style="background-image:url('${esc(P.shown)}')"></div>${file('plain sm', ui['pet.change'])}</div>`
      : `<div class="pet-ph" data-drop><div class="pet-drop"><p><span class="dk">${esc(ui['pet.drop'])}</span><span class="tc">${esc(ui['pet.add'])}</span></p>${file('out', ui['pet.file'])}</div></div>`;
    /* one line under the photo: what choosing one does (before), or what was read from it (after: with a breed only the colours, the breed keeps its pattern) */
    const phNote = !P.shown ? ui['pet.pick'] : P.read === 'coat' ? ui['pet.readBreed'] : P.read ? ui['pet.read'] : '';
    const row = (id, label, ctl, after = '') => `<div class="pet-row"><label for="${id}">${esc(label)}</label>${ctl}${after}</div>`;
    const sel1 = (k, list, pre) => row('o-pf-' + k, ui['pet.' + k], `<select id="o-pf-${k}" data-pf="${k}"${dis}>${list.map(v => `<option value="${v}"${(L[k] || (k === 'fur' ? 'plush' : null)) === v ? ' selected' : ''}>${esc(op[pre + v] || v)}</option>`).join('')}</select>`);
    const rng = k => row('o-pf-' + k, ui['pet.' + k], `<div class="pet-rng"><input type="range" id="o-pf-${k}" data-pf="${k}" min="0" max="1" step="0.05" value="${L[k] == null ? 0.5 : L[k]}" aria-describedby="o-pf-${k}-lo o-pf-${k}-hi"${dis}>`
      + `<span id="o-pf-${k}-lo">${esc(ui['pet.' + k + '.lo'])}</span><span id="o-pf-${k}-hi">${esc(ui['pet.' + k + '.hi'])}</span></div>`);
    /* breeds: grouped by kind, Custom when the look names no known breed; no list (an error or none) hides the select. One line under it says what picking does. */
    const bl = breedRows || [], known = !!L.breed && bl.some(b => b.key === L.breed);
    const breed = bl.length ? row('o-pf-breed', ui['pet.breed'], `<select id="o-pf-breed" data-pf="breed" aria-describedby="o-pf-breed-n"${dis}><option value=""${known ? '' : ' selected'}>${esc(ui['pet.custom'])}</option>`
      + PET_KINDS.map(k => { const rs = bl.filter(b => b.kind === k); return rs.length ? `<optgroup label="${esc(ui[k === 'cat' ? 'pet.cats' : 'pet.dogs'])}">${rs.map(b => `<option value="${esc(b.key)}"${L.breed === b.key ? ' selected' : ''}>${esc(breedName(b, lang))}</option>`).join('')}</optgroup>` : ''; }).join('') + '</select>',
      `<p class="sh-note bn" id="o-pf-breed-n">${esc(ui['pet.breedNote'])}</p>`) : '';
    /* who sees the photo, shown only once there is a photo here or a shared copy on the server (so it can be taken back): only me (the default) or coworkers,
       each with its own line; beside the share choice a small frame shows what coworkers would see */
    const can = !!(P.shown || u.photoShared);
    const ex = P.shown && photoSafe(P.shown) ? `<p class="pet-ex" aria-hidden="true"><i style="background-image:url('${esc(P.shown)}')"></i><span>${esc(ui['pet.visEx'])}</span></p>` : '';
    const rd = (v, text, on, desc) => `<label class="ck"><input type="radio" name="o-pf-vis" id="o-pf-vis-${v}" data-pf="vis" value="${v}" aria-describedby="o-pf-vd-${v}"${on ? ' checked' : ''}${dis}>${esc(text)}</label><p class="vd" id="o-pf-vd-${v}">${esc(desc)}</p>`;
    const vis = can ? `<fieldset class="pet-vis"><legend>${esc(ui['pet.vis'])}</legend>${rd('me', ui['pet.visMe'], !P.share, ui['pet.visMeNote'])}${rd('share', ui['pet.visShare'], P.share, ui['pet.visShareNote'])}${ex}</fieldset>` : '';
    /* coat colours by role: a required role always has its input, an optional one (the last) has a checkbox that turns it on, then its swatch, dimmed while off */
    const cols = petCoatRoles(L.pattern).map((r, i) => { const c = L.coat[i], nm = op['role.' + r.key] || r.key, on = !r.optional || !!c;
      return `<div class="pet-c">` + (r.optional ? `<label><input type="checkbox" data-pf="use${i}" id="o-pf-use${i}" aria-label="${esc(fillT(ui['pet.use'], { x: nm }))}"${c ? ' checked' : ''}${dis}>${esc(nm)}</label>` : `<label for="o-pf-c${i}">${esc(nm)}</label>`)
        + `<input type="color" id="o-pf-c${i}" data-pf="c${i}" aria-label="${esc(nm)}" value="${esc(c || P.mem[i] || PET_SPARE[i] || PET_SPARE[0])}"${on ? dis : ' disabled'}></div>`; }).join('');
    const mk = L.marks || [];
    const marks = `<fieldset class="pet-mk"><legend>${esc(ui['pet.marks'])}</legend><div class="pet-cks">${PET_MARKS.map(m => `<label class="ck"><input type="checkbox" id="o-pf-mark-${m}" data-pf="mark-${m}"${mk.includes(m) ? ' checked' : ''}${dis}>${esc(op['mark.' + m] || m)}</label>`).join('')}</div>`
      + (mk.length ? `<div class="pet-c in"><label for="o-pf-mark">${esc(ui['pet.markColor'])}</label><input type="color" id="o-pf-mark" data-pf="mark" value="${esc(L.mark || HEX_DEF.mark)}"${dis}></div>` : '') + '</fieldset>';
    /* eye and nose: Match the coat (the key absent, pets.js picks one) or a colour; checkbox first, then the swatch, dimmed while the checkbox is on */
    const hexDef = k => (typeof HEX_DEF[k] === 'object' ? HEX_DEF[k][L.kind] : HEX_DEF[k]);
    const auto = k => `<div class="pet-row" role="group" aria-labelledby="o-pf-${k}-l"><span id="o-pf-${k}-l">${esc(ui['pet.' + k])}</span><div class="pet-inl"><label class="ck"><input type="checkbox" id="o-pf-auto-${k}" data-pf="auto-${k}"${L[k] ? '' : ' checked'}${dis}>${esc(ui['pet.auto'])}</label>`
      + `<input type="color" id="o-pf-${k}" data-pf="${k}" aria-labelledby="o-pf-${k}-l" value="${esc(L[k] || P.hex[k] || hexDef(k))}"${L[k] ? dis : ' disabled'}></div></div>`;
    const grp = (k, body) => `<details class="pet-g" data-g="${k}"${P.open[k] ? ' open' : ''}><summary>${esc(ui['pet.g.' + k])}</summary><div class="pet-gb">${body}</div></details>`;
    const rm = !u.pet ? '' : `<div class="sh-rm">${P.ask ? `<p class="sh-note" role="alert">${esc(ui['pet.ask'])}</p><div class="row"><button type="button" class="of-dbtn warn" data-sh="petclear"${dis}>${esc(ui['pet.remove'])}</button><button type="button" class="of-dbtn plain" data-sh="petkeep"${dis}>${esc(ui['pet.keep'])}</button></div>`
      : `<button type="button" class="lnk" data-sh="petask"${dis}>${esc(ui['pet.remove'])}</button>`}</div>`;
    /* kind right above the breed (a breed belongs to one kind), then the photo; the preview opens the large viewer with the look being edited */
    return [`<div class="pet-wrap"><div class="pet-f">${sel1('kind', PET_KINDS, '')}${breed}${photo}${phNote ? `<p class="sh-note">${esc(phNote)}</p>` : ''}${vis}`
      + grp('basic', sel1('size', PET_SIZES, 'size.') + row('o-pf-name', ui['pet.name'], `<input type="text" id="o-pf-name" data-pf="name" maxlength="${PET_NAME_MAX}" autocomplete="off" value="${esc(L.name || '')}"${dis}>`))
      + grp('coat', sel1('pattern', PET_PATTERNS, 'pat.') + `<div class="pet-cols" role="group" aria-label="${esc(ui['pet.colors'])}">${cols}</div>` + sel1('fur', PET_FUR_LIST, 'fur.') + rng('fluff') + marks)
      + grp('shape', sel1('ear', PET_EARS, 'ear.') + rng('earsize') + sel1('tail', PET_TAILS, 'tail.') + rng('snout') + rng('legs') + rng('length') + rng('build'))
      + grp('face', auto('eye') + auto('nose')) + rm
      + `</div><div class="pet-pvc"><div class="pet-pv" role="button" tabindex="0" data-sh="pvopen" aria-label="${esc(ui['pet.zoom'])}" title="${esc(ui['pet.zoom'])}"></div>${toys}</div></div>`,
      shopFoot(P.dirty, P.dirty)];   /* save needs an edit: with no pet the form shows the default dog, and saving it untouched put a pet back right after it was taken out */
  }
  function shopHtml(){
    const ui = cur.shop.ui, tab = shop.tab, [body, foot] = tab === 'pet' ? petHtml() : tab === 'petgear' ? petGearHtml() : tab === 'book' ? bookHtml() : gearHtml(tab);
    const tl = `<div class="sh-tabs" role="tablist" aria-label="${esc(ui.tabs)}">${SHOP_TABS.map(k => `<button type="button" role="tab" id="o-sh-t-${k}" aria-controls="o-sh-p" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}" data-sh="tab" data-v="${k}">${esc(ui['tab.' + k])}</button>`).join('')}</div>`;
    const ghost = sel && sel.ghost ? `<p class="ulk-g">${esc(ui.ghost)}</p>` : '';
    return `<div class="bkbar"><button type="button" class="bk" data-sh="back">← ${esc(ui.back)}</button></div><div class="bd">${ghost}${tl}<div role="tabpanel" id="o-sh-p" aria-labelledby="o-sh-t-${tab}">${body}</div></div>${foot}`;
  }
  function shopAfter(){ if(petTab(shop.tab)){ if(shop.tab === 'pet') breedsLoad(); petPreview(); } else pvStop(); fillThumbs(); }   /* thumbnails: the gear tiles, the collection, the toy tiles */
  /* item thumbnails: each item rendered once by a small renderer of its own into a data URL, one per frame; the renderer goes once all are cached */
  /* the pet goods that are thumbnailed by dressing the default dog, and the look that does it */
  const PET_THUMBS = [...PET_BODIES.map(x => 'pbody:' + x), 'pcol:collar', ...PET_TAGS.map(x => 'ptag:' + x)];
  const petThumbLook = id => { const dog = { kind: 'dog', coat: ['#d9b48f'], fluff: 0.4 }, col = HEX_DEF.collar;
    return id.startsWith('pbody:') ? { ...dog, body: id.slice(6) } : id === 'pcol:collar' ? { ...dog, collar: col } : id.startsWith('ptag:') ? { ...dog, collar: col, tag: id.slice(5), name: 'Bori' } : null; };
  function thumbOf(id){
    if(thumbs[id] !== undefined) return thumbs[id];
    if(!T) return '';
    if(!thumbR){
      try{
        const r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(112, 112, false); r.setClearColor(0x000000, 0);
        const sc = new T.Scene(), key = new T.DirectionalLight('#fff0d4', 2.1), rl = new T.DirectionalLight('#e6ecff', 0.9); key.position.set(-2, 3, 4); rl.position.set(2.5, 2, -3); sc.add(new T.HemisphereLight('#f3f1ff', '#e8dcc4', 1.0), key, rl);
        thumbR = { r, sc, cam: new T.PerspectiveCamera(28, 1, 0.01, 50) };
      }catch(e){ return (thumbs[id] = ''); }
    }
    /* pbody:<id>, pcol:collar and ptag:<id> are the default dog wearing that body piece, the collar, or the collar with that tag (petThumbLook) */
    const toy = id.startsWith('toy:'), slot = GEAR_SLOT[id], head = slot === 'head', back = slot === 'back', pl = petThumbLook(id), pb = !!pl; let g;
    try{ g = toy ? makeToy(T, id.slice(4)) : pb ? makePet(T, pl, PET_GEAR) : head ? makeHeadGear(T, id) : back ? makeBackGear(T, id) : makeDeskItem(T, id); }catch(e){ return (thumbs[id] = ''); }
    if(g.userData.tick) g.userData.tick(1.3, 0.35, false);
    if(pb) g.userData.pose('stand', 0, 0, { blend: 0 });
    g.rotation.set(head ? 0.35 : back ? 0.12 : 0, back ? 0.35 : -0.45, 0);   /* wings from a little to the side so both show wide */ if(pb) g.rotation.y = pl.body ? 0.7 : 0.4; thumbR.sc.add(g); g.updateMatrixWorld(true);
    let c, d;
    if(pb){ c = pl.body ? new T.Vector3(0.04, 0.38, 0.08) : new T.Vector3(0.06, 0.34, 0.16); d = pl.body ? 1.12 : 0.95; }   /* centred a little toward the snout, which the turn swings to the right, so it stays in the tile */   /* about 0.5 of the pet's own units across the tile for a body piece (the neck, the chest and the back), 0.4 for the collar and the tag (the neck and the chest) */
    else{ const b = new T.Box3().setFromObject(g), sz = b.getSize(new T.Vector3()); c = b.getCenter(new T.Vector3()); d = Math.max(1e-3, sz.x, sz.y, sz.z) * 2.35; }   /* the widest side fills about 85 % of the tile */
    thumbR.cam.position.set(c.x, c.y + d * 0.3, c.z + d * 0.95); thumbR.cam.lookAt(c); thumbR.cam.updateProjectionMatrix();
    thumbR.r.render(thumbR.sc, thumbR.cam); const url = thumbR.r.domElement.toDataURL('image/png');
    thumbR.sc.remove(g); g.userData.dispose();
    if(GEAR_ITEMS.every(q => thumbs[q.id] !== undefined || q.id === id) && PET_THUMBS.every(q => thumbs[q] !== undefined || q === id)) setTimeout(thumbKill, 0);
    return (thumbs[id] = url);
  }
  function thumbKill(){ if(!thumbR) return; thumbR.r.dispose(); thumbR.r.forceContextLoss(); thumbR = null; }
  let thumbRaf = 0;
  function fillThumbs(){
    if(thumbRaf) return;
    const go = () => { thumbRaf = 0; if(destroyed) return; const im = [...chrome.el.querySelectorAll('img[data-th]')].find(i => !i.getAttribute('src')); if(!im){ thumbKill(); return; }   /* nothing left to draw on this tab: free the renderer (a later tab makes a new one) */
      const u = thumbOf(im.dataset.th); chrome.el.querySelectorAll(`img[data-th="${im.dataset.th}"]`).forEach(i => { i.setAttribute('src', u || 'data:,'); }); thumbRaf = requestAnimationFrame(go); };
    thumbRaf = requestAnimationFrame(go);
  }
  /* the pet preview: its own renderer on a canvas that survives the drawer's re-renders. The pet faces the viewer three-quarter on and sways about 35 degrees
     each way (still under reduced motion). A change of colour or pattern repaints the model in place; a change of shape (kind, ears, tail, size, fluff)
     builds a new one after a short pause, so dragging the fluff slider does not build a model per input event. The scene's own pet follows (petLive). */
  function petPreview(){
    const host = chrome.el.querySelector('.pet-pv'); if(!host || !T) return;
    if(!pv){
      try{
        const r = new T.WebGLRenderer({ antialias: true, alpha: true }); r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.setSize(132, 132, false); r.setClearColor(0x000000, 0);
        const sc = new T.Scene(), key = new T.DirectionalLight('#fff0d4', 2.0), rl = new T.DirectionalLight('#e6ecff', 1.0); key.position.set(-2, 3, 4); rl.position.set(2.5, 2, -3); sc.add(new T.HemisphereLight('#f3f1ff', '#e8dcc4', 0.9), key, rl);
        const cam = new T.PerspectiveCamera(30, 1, 0.05, 20); cam.position.set(0, 0.74, 2.15); cam.lookAt(0, 0.26, 0);   /* refitted to each model (pvFit) */
        pv = { r, sc, cam, g: null, key: '', raf: 0, t0: performance.now(), chg: 0, yaw: PV_YAW, last: performance.now() }; r.domElement.setAttribute('aria-hidden', 'true');
      }catch(e){ return; }
    }
    host.appendChild(pv.r.domElement); petPreviewSet(); pvLoop();
  }
  /* the camera fits the standing pet's bounding sphere, so a small cat fills the box as a large dog does */
  const PV_YAW = 0.5;
  function pvFit(){
    const g = pv.g; g.rotation.y = 0; g.userData.pose('stand', 0, 0, { blend: 0 }); g.updateMatrixWorld(true);
    const b = new T.Box3(); g.traverse(c => { if(c.isMesh && !c.isInstancedMesh && c.visible) b.expandByObject(c, true); }); if(b.isEmpty()) return;
    const c = b.getCenter(new T.Vector3()), R = b.getBoundingSphere(new T.Sphere()).radius, d = R / Math.sin(pv.cam.fov * Math.PI / 360) * 0.9;
    pv.cam.position.set(c.x, c.y + d * 0.3, c.z + d * 0.954); pv.cam.near = d / 40; pv.cam.far = d * 4; pv.cam.lookAt(c); pv.cam.updateProjectionMatrix();
  }
  function petPreviewSet(){
    if(!shop) return; const P = shop.pet, look = P.look, key = JSON.stringify(look);
    petLive(P.dirty || P.had ? look : null);
    if(!pv || key === pv.key) return;
    pv.chg = performance.now();   /* any change: the pet turns front three-quarter and holds there awake for 2 s */
    if(pv.g && petRecolor(pv.g, look)){ pv.key = key; if(reduced) pvLoop(true); return; }
    const make = () => { pv.tm = 0; if(!pv || !shop) return; const L = shop.pet.look, k = JSON.stringify(L); if(k === pv.key) return; pv.key = k;
      if(pv.g){ pv.sc.remove(pv.g); pv.g.userData.dispose(); } pv.g = makePet(T, L, PET_GEAR); pv.sc.add(pv.g); pvFit(); pv.chg = performance.now(); if(reduced) pvLoop(true); };
    clearTimeout(pv.tm); if(pv.g) pv.tm = setTimeout(make, 160); else make();
  }
  function pvLoop(once){
    if(!pv || (pv.raf && !once)) return;
    const loop = () => { pv.raf = 0; if(!pv || !shop || !petTab(shop.tab) || !chrome.isOpen() || !pv.r.domElement.isConnected || destroyed) return;
      const now = performance.now(), t = (now - pv.t0) / 1000, dt = Math.min(0.05, (now - pv.last) / 1000); pv.last = now;
      if(pv.g){ const held = now - pv.chg < 2000, yT = PV_YAW + (reduced || held ? 0 : 0.3 * Math.sin((now - pv.chg - 2000) / 1000 * 0.6));   /* sways 0.2 to 0.8 rad: never faces away */
        pv.yaw = reduced ? yT : pv.yaw + (yT - pv.yaw) * Math.min(1, dt * 5); pv.g.rotation.y = pv.yaw;
        pv.g.userData.pose('stand', 0, reduced ? 0 : t, { blend: reduced ? 0 : undefined }); pv.g.userData.fur(124 * pv.r.getPixelRatio());
        (pv.g.userData.gearParts || []).forEach(h => { if(h.userData.tick) h.userData.tick(t, envN, reduced); }); }
      pv.r.render(pv.sc, pv.cam); if(!reduced) pv.raf = requestAnimationFrame(loop); };
    if(once && pv.raf){ cancelAnimationFrame(pv.raf); pv.raf = 0; }
    loop();
  }
  function pvStop(){ if(pv && pv.raf){ cancelAnimationFrame(pv.raf); pv.raf = 0; } if(pv && pv.tm){ clearTimeout(pv.tm); pv.tm = 0; } }
  function shopKill(){ if(thumbRaf) cancelAnimationFrame(thumbRaf); thumbRaf = 0; thumbKill(); if(pv){ pvStop(); if(pv.g) pv.g.userData.dispose(); pv.r.dispose(); pv.r.forceContextLoss(); pv.r.domElement.remove(); pv = null; } }
  const errKey = e => { const c = e && e.code, m = String((e && e.message) || ''); return c === 'photo' ? 'err.photo' : c === 'PGRST202' ? 'err.na' : c === '28000' ? 'err.link' : c === '22023' ? 'err.input' : c === 'P0001' ? (/locked/i.test(m) ? 'err.locked' : /too many/i.test(m) ? 'err.many' : 'err.org') : 'err'; };
  async function shopSave(change, extra){
    if(!shop || shop.busy) return;
    const ui = cur.shop.ui; shop.busy = true; shop.msg = null; rerender();
    try{
      const r = await opts.shop.save(change, extra || {});
      if(!shop) return;
      shop.busy = false;
      if(change.gear){ const g = gearOf((r && r.gear) || change.gear); shop.base = g; shop.draft = { ...g }; if(sel && sel.p.self) sel.p.gear = { ...g }; shop.msg = { text: ui.saved }; }
      else { shop.pet = petState(); shop.msg = { text: ui[saveMsgKey(change, extra)] || ui.saved }; }   /* petState reads the page's new data (photoShared included); the message says who sees the photo */
    }catch(e){
      if(!shop) return;
      shop.busy = false; const k = errKey(e);
      if(k === 'err.na'){ shopNa = true; naNote = true; shopReset(); rerender(); return; }
      if(change.gear){ shop.draft = { ...shop.base }; previewGear(); }
      shop.msg = { err: true, text: change.gear ? ui.err + (k !== 'err' ? ' ' + ui[k] : '') : ui[k] || ui.err };
    }
    rerender();
  }
  const loadImage = file => new Promise((ok, no) => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); ok(im); }; im.onerror = () => { URL.revokeObjectURL(u); no(new Error('image')); }; im.src = u; });
  async function readPhoto(file){
    if(!shop) return;
    const ui = cur.shop.ui, bad = () => { if(shop){ shop.msg = { err: true, text: ui['pet.bad'] }; rerender(); } };
    if(!file || !/^image\//.test(file.type || '')) return bad();
    let im; try{ im = await loadImage(file); }catch(e){ return bad(); }
    const w0 = im.naturalWidth || im.width, h0 = im.naturalHeight || im.height; if(!w0 || !h0) return bad();
    const draw = (mx, q) => { const k = Math.min(1, mx / Math.max(w0, h0)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k)); const x = c.getContext('2d', { willReadFrequently: !q }); x.drawImage(im, 0, 0, c.width, c.height); return { c, x }; };
    let res = null, photo = null;
    /* the copy kept in this browser: up to 1024 px on the longest side, the first step that stays under PET_PHOTO_LOCAL (the desk frame, the large viewer
       and the shared copy are all drawn from it, so a 256 px copy left them blurry) */
    const keep = () => { for(const [mx, q] of PET_PHOTO_KEEP){ const u = draw(mx, true).c.toDataURL('image/jpeg', q); if(u.length < PET_PHOTO_LOCAL) return u; } return null; };
    try{ const a = draw(480); res = petLookFromPixels(a.x.getImageData(0, 0, a.c.width, a.c.height).data, a.c.width, a.c.height); photo = keep(); }catch(e){ return bad(); }
    if(!photo) return bad();
    if(!shop) return;
    const P = shop.pet; P.photo = photo; P.shown = photo; P.read = res ? (P.look.breed ? 'coat' : 'all') : false; P.dirty = true; shop.msg = null;
    /* with a breed chosen the breed keeps its pattern and the photo only recolours it, colour by colour in the pattern's order (a Shiba stays two-toned in the
       photo's own orange and cream); without one the photo also suggests the pattern */
    if(res) P.look = normalizePetLook(P.look.breed ? { ...P.look, coat: P.look.coat.map((c, i) => res.coat[i] || c) } : { ...P.look, coat: res.coat, pattern: res.pattern }) || P.look;
    rerender(); petPreviewSet();
  }
  function petField(el){
    const P = shop && shop.pet; if(!P || shop.busy) return;
    const k = el.dataset.pf, cv = h => { const c = chrome.el.querySelector(`[data-pf="${h}"]`); return c && c.value; };
    let L = { ...P.look, coat: P.look.coat.slice(), marks: (P.look.marks || []).slice() }, re = false;
    if(k === 'file') return readPhoto(el.files && el.files[0]);
    if(k === 'vis'){ if(!el.checked) return; P.share = el.value === 'share'; P.dirty = true; shop.msg = null; rerender(); return; }
    if(k === 'breed'){ const b = (breedRows || []).find(r => r.key === el.value); if(b) L = { ...petApplyBreed(L, b.look) }; else delete L.breed; L.marks = (L.marks || []).slice(); if(b) P.mem = L.coat.slice(); re = true; }
    else if(/^c\d$/.test(k)){ const i = +k[1]; L.coat[i] = el.value; P.mem[i] = el.value; }
    else if(/^use\d$/.test(k)){ const i = +k[3]; if(el.checked) L.coat[i] = cv('c' + i) || P.mem[i] || PET_SPARE[i]; else L.coat.length = Math.min(L.coat.length, i); re = true; }
    else if(k === 'pattern'){ L.pattern = el.value; L.coat = petCoatFor(L.coat, petCoatRoles(el.value), P.mem); re = true; }   /* colours stay by position, a newly required one is filled */
    else if(PET_RANGES.includes(k)) L[k] = Math.round(Number(el.value) * 100) / 100;
    else if(k === 'name') L.name = el.value;
    else if(k === 'fur'){ if(PET_FUR_LIST.includes(el.value) && el.value !== PET_FUR_LIST[0]) L.fur = el.value; else delete L.fur; }   /* the standard coat writes no key */
    else if(/^mark-/.test(k)){ const m = k.slice(5); L.marks = PET_MARKS.filter(x => (x === m ? el.checked : L.marks.includes(x))); re = true; }
    else if(/^auto-/.test(k)){ const h = k.slice(5); if(el.checked){ if(L[h]) P.hex[h] = L[h]; delete L[h]; } else L[h] = cv(h) || P.hex[h]; re = true; }
    else if(k === 'collar'){ L.collar = el.value; P.hex.collar = el.value; }   /* the colour picker in the pet goods tab, shown while the collar is on */
    else{ L[k] = el.value; if(k === 'kind') re = true; }   /* kind, size, ear, tail and the eye, nose and mark colours */
    if(L.breed && !(breedRows || []).some(b => b.key === L.breed && b.kind === L.kind)) delete L.breed;   /* another kind is no longer that breed */
    if(!L.marks.length) delete L.marks;
    L.coat = L.coat.filter(Boolean).slice(0, PET_COAT_MAX);
    const n = normalizePetLook(L); if(!n) return;
    P.look = n; P.dirty = true; shop.msg = null; petPreviewSet();
    if(re) rerender();
    else { const sv = chrome.el.querySelector('[data-sh="save"]'), cn = chrome.el.querySelector('[data-sh="cancel"]'); if(sv) sv.disabled = false; if(cn) cn.disabled = false; const m = chrome.el.querySelector('.sh-msg'); if(m){ m.textContent = ''; m.classList.remove('err'); } }
  }
  chrome.el.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('[data-sh]'); if(!b || !sel || !shopFor(sel)) return;
    const a = b.dataset.sh, v = b.dataset.v;
    if(a === 'open'){ shopStart(); renderDrawer(); const t = chrome.el.querySelector('[role="tab"][aria-selected="true"]'); if(t) t.focus({ preventScroll: true });
      return; }
    if(!shop) return;
    if(a === 'pvopen'){ if(sel) viewOpen('pet', sel, { look: normalizePetLook(shop.pet.look) || shop.pet.look, pin: photoSafe(shop.pet.shown) ? shop.pet.shown : null }); return; }   /* the preview opens the large viewer with the look being edited */
    if(a === 'back'){ shopReset(); renderDrawer(); const o2 = chrome.el.querySelector('[data-sh="open"]'); if(o2) o2.focus(); return; }
    if(shop.busy) return;
    if(a === 'tab'){ if(v !== shop.tab){ if(gearDirty()){ shop.draft = { ...shop.base }; previewGear(); } shop.tab = v; shop.msg = null; rerender(); } return; }
    if(a === 'pick'){ if(b.getAttribute('aria-disabled') === 'true') return; const slot = shop.tab; if(slot !== 'head' && slot !== 'back' && slot !== 'desk') return; shop.draft[slot] = v || null; shop.msg = null; previewGear(); rerender(); return; }
    if(a === 'pgpick'){ if(b.getAttribute('aria-disabled') === 'true') return; const k = PET_SLOT_KEY[b.dataset.slot]; if(!k) return; const P = shop.pet, L = { ...P.look };   /* a pet goods tile: '' is none (Auto for toys), a locked tile does nothing */
      if(k === 'collar'){ if(v) L.collar = P.hex.collar || HEX_DEF.collar; else { if(L.collar) P.hex.collar = L.collar; delete L.collar; } }   /* the collar is a colour: on takes the last one or the default */
      else if(k === 'tag' && v === PET_TAGS[0]) delete L.tag;   /* the round tag is the default and writes no key */
      else if(v) L[k] = v; else delete L[k];
      const n = normalizePetLook(L); if(n){ P.look = n; P.dirty = true; shop.msg = null; petPreviewSet(); rerender(); } return; }
    if(a === 'bkgo'){ const [slot, id] = String(v).split('|'), it = bookOf(cur.shop).pages.flatMap(q => q.items).find(q => q.id === id);   /* a tile in the collection: go to its tab, and pick it when it is open */
      shop.tab = slot === 'back' || slot === 'head' || slot === 'desk' ? slot : 'pet'; if(it && it.open){ shop.draft[it.slot] = id; previewGear(); } shop.msg = null; rerender(); return; }
    if(a === 'cancel'){ shop.msg = null; if(petTab(shop.tab)) shop.pet = petState(); else { shop.draft = { ...shop.base }; previewGear(); } rerender(); petPreviewSet(); return; }
    /* a pet save tells the page about the photo: this browser's photo (fresh when picked in this visit), the visibility choice and whether the server has a
       copy; the page uploads, clears or leaves the shared copy (petPhotoPlan) */
    if(a === 'save'){ if(petTab(shop.tab)){ const P = shop.pet, look = normalizePetLook(P.look); if(look && P.dirty) shopSave({ pet: look }, { photo: P.photo || P.shown || null, fresh: !!P.photo, share: !!P.share, shared: cur.shop.photoShared === true }); } else if(gearDirty()) shopSave({ gear: { ...shop.draft } }); return; }
    if(a === 'petask' || a === 'petkeep'){ shop.pet.ask = a === 'petask'; rerender(); const f = chrome.el.querySelector(a === 'petask' ? '[data-sh="petkeep"]' : '[data-sh="petask"]'); if(f) f.focus(); return; }   /* removing asks once */
    if(a === 'petclear'){ shopSave({ petClear: true }); return; }
  });
  const pfDiscrete = el => el.dataset.pf === 'file' || el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT';   /* these act on change; text, colours and sliders on every input */
  chrome.el.addEventListener('input', ev => { const el = ev.target; if(el && el.dataset && el.dataset.pf && !pfDiscrete(el)) petField(el); });
  chrome.el.addEventListener('change', ev => { const el = ev.target; if(el && el.dataset && el.dataset.pf && pfDiscrete(el)) petField(el); });
  chrome.el.addEventListener('toggle', ev => { const d = ev.target; if(shop && shop.pet && d && d.dataset && d.dataset.g) shop.pet.open[d.dataset.g] = d.open; }, true);   /* toggle does not bubble */
  chrome.el.addEventListener('keydown', ev => {
    const t = ev.target; if(!shop || !t || !t.getAttribute || t.getAttribute('role') !== 'tab') return;
    const ks = SHOP_TABS, nk = ks.length, i = ks.indexOf(t.dataset.v), j = ev.key === 'ArrowRight' ? (i + 1) % nk : ev.key === 'ArrowLeft' ? (i + nk - 1) % nk : ev.key === 'Home' ? 0 : ev.key === 'End' ? nk - 1 : -1; if(j < 0) return;
    ev.preventDefault(); if(shop.busy) return; if(gearDirty()){ shop.draft = { ...shop.base }; previewGear(); } shop.tab = ks[j]; shop.msg = null; renderDrawer(); const n = chrome.el.querySelector('#o-sh-t-' + ks[j]); if(n) n.focus();
  });
  chrome.el.addEventListener('keydown', ev => { const t = ev.target; if((ev.key === 'Enter' || ev.key === ' ') && t && t.dataset && t.dataset.sh === 'pvopen'){ ev.preventDefault(); t.click(); } });
  chrome.el.addEventListener('dragover', ev => { const d = ev.target.closest && ev.target.closest('[data-drop]'); if(!d || !shop) return; ev.preventDefault(); d.classList.add('on'); });
  chrome.el.addEventListener('dragleave', ev => { const d = ev.target.closest && ev.target.closest('[data-drop]'); if(d) d.classList.remove('on'); });
  chrome.el.addEventListener('drop', ev => { const d = ev.target.closest && ev.target.closest('[data-drop]'); if(!d || !shop) return; ev.preventDefault(); d.classList.remove('on'); if(!shop.busy) readPhoto(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]); });

  /* ── pets (pets.js): a member's own dog or cat lives round their desk. The bowls stand in the gap left of the desk (see buildPets), the photo frame on
     the desk's left end (the still life gives way to it), and the pet follows petPlan: it roams the aisle, sits and looks up at its owner, eats or drinks at
     the bowls, hops onto the desk to sleep beside the laptop, or fetches a toy from the presents pile by the server kiosk (a toy basket out of season), plays
     there and carries the toy home. Walking uses a coarse floor grid (desks, chairs with their sitters, the kiosk and the pile, plants, lamps and
     walls keep a margin for the shelves) searched with A*, and each pet keeps a small lane offset by a hash so two pets rarely overlap.
     Reduced motion: every pet sits by its desk. Per pet: 15 or 16 meshes for the animal (no shadow-map shadow: the shadow map is redrawn only now and then,
     so a walking pet's shadow would step) and one contact blob that follows it every frame; shell fur adds 6 or 7 draw calls a pet (body, head, legs, tail) when it is large on screen
     (see render). Motion: poses blend (pets.js posePet), walking eases in and out and turns on the spot before it goes, the gait follows the distance. ── */
  const PET_SC = 1.75, PET_SPEED = 1.1, PET_ACC = 5, PET_TURN = 4.5, BOWL_SC = 1.5, NAV_R = 0.2, NAV_M = 0.24, DESK_Y = 1.06;
  /* PET_SC: a medium pet stands about half as tall as a seated cast animal (pets.js sizes the small and large ones). PET_ACC: about 0.2 s from rest to
     PET_SPEED; PET_TURN: the fastest turn on the spot in rad/s */
  function petDrawn(d){
    if(d.closed) return new Set();
    const pl = (d.people || []).filter(p => p && p.tier !== 'nodata' && p.pet), me = pl.find(p => p.self);
    return new Set(pickPets(pl.map(p => ({ id: p.id, pet: p.pet })), me ? me.id : d.viewerId, PET_MAX));
  }
  const petFloorY = (x, z) => (zones.some(zn => zn.kind !== 'server' && Math.abs(x - zn.cx) < zn.w / 2 && Math.abs(z - zn.cz) < zn.d / 2) ? 0.07 : 0.03);   /* on a rug or on the planks */
  const angTo = (a, b) => { let d = (b - a) % (Math.PI * 2); if(d > Math.PI) d -= Math.PI * 2; if(d < -Math.PI) d += Math.PI * 2; return d; };
  /* the walkable floor: cells of NAV_R, each rect [x0, z0, x1, z1, margin] blocked with the pet's half width added */
  function petNavGrid(rects){
    const nx = Math.ceil(FW / NAV_R), nz = Math.ceil(FD / NAV_R), x0 = -FW / 2, z0 = -FD / 2, g = new Uint8Array(nx * nz);
    const block = (ax, az, bx, bz) => { const i0 = Math.max(0, Math.floor((ax - x0) / NAV_R)), i1 = Math.min(nx - 1, Math.floor((bx - x0) / NAV_R)), j0 = Math.max(0, Math.floor((az - z0) / NAV_R)), j1 = Math.min(nz - 1, Math.floor((bz - z0) / NAV_R));
      for(let j = j0; j <= j1; j++) for(let i = i0; i <= i1; i++) g[j * nx + i] = 1; };
    rects.forEach(([ax, az, bx, bz, m = NAV_M]) => block(ax - m, az - m, bx + m, bz + m));
    block(x0, z0, -x0, z0 + 0.95); block(x0, z0, x0 + 0.95, -z0); block(x0, -z0 - 0.4, -x0, -z0); block(-x0 - 0.4, z0, -x0, -z0);   /* back and left walls with their shelves, and the open front and right edges */
    return { g, nx, nz, x0, z0 };
  }
  /* A* over the grid (eight neighbours, no corner cutting), then string pulling along lines of sight; returns [[x, z], ...] from a to b */
  function petPath(N, ax, az, bx, bz, lane){
    const { g, nx, nz, x0, z0 } = N, R = NAV_R, ci = x => Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / R))), cj = z => Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / R)));
    const cx = k => x0 + (k % nx + 0.5) * R, cz = k => z0 + (Math.floor(k / nx) + 0.5) * R;
    const near = (x, z) => {   /* the free cell nearest to a point */
      const k0 = cj(z) * nx + ci(x); if(!g[k0]) return k0;
      const i = k0 % nx, j = (k0 - i) / nx;
      for(let r = 1; r < 16; r++){ let best = -1, bd = 1e9;
        for(let dj = -r; dj <= r; dj++) for(let di = -r; di <= r; di++){ if(Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const a = i + di, b = j + dj; if(a < 0 || b < 0 || a >= nx || b >= nz || g[b * nx + a]) continue; const dd = Math.hypot(cx(b * nx + a) - x, cz(b * nx + a) - z); if(dd < bd){ bd = dd; best = b * nx + a; } }
        if(best >= 0) return best; }
      return k0; };
    const s = near(ax, az), t = near(bx, bz), n = nx * nz, ti = t % nx, tj = (t - ti) / nx;
    const gs = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n), heap = [];
    const hx = k => { const dx = Math.abs(k % nx - ti), dz = Math.abs(Math.floor(k / nx) - tj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while(c > 0){ const p = (c - 1) >> 1; if(heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if(heap.length){ heap[0] = last; let c = 0; for(;;){ const l = 2 * c + 1, r = l + 1; let m = c; if(l < heap.length && heap[l][0] < heap[m][0]) m = l; if(r < heap.length && heap[r][0] < heap[m][0]) m = r; if(m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top[1]; };
    gs[s] = 0; push(hx(s), s);
    while(heap.length){
      const k = pop(); if(done[k]) continue; done[k] = 1; if(k === t) break;
      const i = k % nx, j = (k - i) / nx;
      for(let dj = -1; dj <= 1; dj++) for(let di = -1; di <= 1; di++){
        if(!di && !dj) continue; const a = i + di, b = j + dj; if(a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const q = b * nx + a; if(g[q] || done[q] || (di && dj && (g[j * nx + a] || g[b * nx + i]))) continue;
        const c = gs[k] + (di && dj ? 1.414 : 1); if(c < gs[q]){ gs[q] = c; from[q] = k; push(c + hx(q), q); }
      }
    }
    if(t !== s && from[t] < 0) return [[ax, az], [bx, bz]];   /* no way through (a sealed-off desk): walk straight rather than freeze */
    const cells = []; for(let k = t; k !== s && k >= 0; k = from[k]) cells.push(k); cells.push(s); cells.reverse();
    const los = (p, q) => { const n2 = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (R * 0.5)); for(let u = 1; u < n2; u++) if(g[cj(p[1] + (q[1] - p[1]) * u / n2) * nx + ci(p[0] + (q[0] - p[0]) * u / n2)]) return false; return true; };
    const pts = cells.map(k => [cx(k), cz(k)]), out = [pts[0]];
    for(let a = 0; a < pts.length - 1;){ let b = pts.length - 1; while(b > a + 1 && !los(pts[a], pts[b])) b--; out.push(pts[b]); a = b; }
    const mid = out.map(([x, z], i) => { if(!i || i === out.length - 1) return [x, z]; const lx = x + lane, lz = z + lane * 0.7; return g[cj(lz) * nx + ci(lx)] ? [x, z] : [lx, lz]; });   /* the lane offset, where it stays on free floor */
    const all = [[ax, az], ...mid, [bx, bz]], res = [all[0]];
    all.slice(1).forEach(p => { const l = res[res.length - 1]; if(Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.04) res.push(p); });
    if(res.length > 2){ const b2 = res[res.length - 1], c2 = res[res.length - 2], a2 = res[res.length - 3]; if(los(a2, b2) && Math.hypot(c2[0] - b2[0], c2[1] - b2[1]) < 0.35) res.splice(res.length - 2, 1); }   /* no little hook at the end */
    return res;
  }
  /* ── desk items (gear.js): one per person who chose one, in front of the left half of the lid. That spot is clear of the laptop, the still life and
     the photo frame on the left end, the sleeping pet (fitted to the left end, see buildPets), and the mug and the standing model on the right end. ── */
  const DESK_IT = { x: -0.3, z: 1.53, fp: 0.4, yaw: 0.35 };   /* fp: the widest footprint an item may take there */
  function placeDesk(o){
    if(o.desk){ gearBits = gearBits.filter(q => q !== o.desk); if(o.desk.parent) o.desk.parent.remove(o.desk); o.desk.userData.dispose(); o.desk = null; }
    const id = !o.ghost && o.p.gear && o.p.gear.desk; if(!id) return;
    let g; try{ g = makeDeskItem(T, id); }catch(e){ return; } if(!g) return;
    ownDispose(g); g.userData.phase = hash(String(o.p.id) + ':desk') * 10;
    const b = new T.Box3().setFromObject(g), w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1e-3), k = Math.min(1, DESK_IT.fp / w);
    g.scale.multiplyScalar(k); g.position.set(o.x + DESK_IT.x, DESK_Y, o.z + DESK_IT.z); g.rotation.y = DESK_IT.yaw;
    g.traverse(c => { if(c.isMesh && !c.material.transparent){ c.castShadow = true; c.receiveShadow = true; } });
    world.add(g); gearBits.push(g); o.desk = g;
    if(renderer) renderer.shadowMap.needsUpdate = true;
  }
  /* the pile's footprint: one rect per present (or the basket), from the meshes themselves, so pets walk round the boxes and never stand on them */
  function pileRects(pile){
    const g = hol.find(h => h.userData.pile) || petBits.find(h => h.name === 'petBasket'), out = [];
    if(!g){ out.push([pile.x - 0.55, pile.z - 0.5, pile.x + 0.55, pile.z + 0.5]); return out; }
    g.updateMatrixWorld(true);
    const parts = g.name === 'petBasket' ? [g] : g.children;
    parts.forEach(c => { const b = new T.Box3().setFromObject(c); if(!b.isEmpty()) out.push([b.min.x, b.min.z, b.max.x, b.max.z]); });
    return out;
  }
  /* the top of each present in the pile (or of the basket): where a toy comes out and goes back in (stepToy) */
  function pileTops(){
    const g = hol.find(h => h.userData.pile) || petBits.find(h => h.name === 'petBasket'); if(!g) return [];
    g.updateMatrixWorld(true);
    return (g.name === 'petBasket' ? [g] : g.children).map(c => { const b = new T.Box3().setFromObject(c); return b.isEmpty() ? null : { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, y: b.max.y, x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z }; }).filter(Boolean);
  }
  const rectDist = (rs, x, z) => Math.min(...rs.map(([a, b, c, d]) => Math.hypot(Math.max(a - x, 0, x - c), Math.max(b - z, 0, z - d))));
  const navFree = (x, z) => { const N = petNav; if(!N) return true; const i = Math.floor((x - N.x0) / NAV_R), j = Math.floor((z - N.z0) / NAV_R); return i >= 0 && j >= 0 && i < N.nx && j < N.nz && !N.g[j * N.nx + i]; };
  /* the toy's places round the pile: slots on rays out of the pile on the camera's side. Per pet and slot, the fetch spot is where its head just reaches
     over the nearest box, and the play spot is further out on open floor with room for the toy in front. A slot holds one pet at a time (petCtx.taken). */
  const PILE_RAYS = [-0.55, -0.15, 0.25, 0.65, 1.05, 1.45];
  function petSlotSpots(pt, k){
    const C = petCtx, a = PILE_RAYS[k], dx = Math.sin(a), dz = Math.cos(a), gs = pt.gs, at = r => ({ x: C.pile.x + dx * r, z: C.pile.z + dz * r });
    let fetch = null, play = null;
    for(let r = 0.2; r < 4.5 && !fetch; r += 0.04){ const p = at(r); if(rectDist(C.rects, p.x, p.z) >= 0.2 * gs) fetch = { ...p, yaw: a + Math.PI }; }
    if(!fetch) return null;
    const yaw = Math.PI / 4 + Math.max(-0.7, Math.min(0.7, angTo(Math.PI / 4, a) * 0.6)), Z = pz(pt);   /* it plays facing the camera's side, turned a little the way the ray points */
    /* the toy's area (pet units: from Z ahead to Z + 0.3 where a bat sends it, a little to each side) must be in clear view of the home camera (playSeen) */
    const area = [[0, Z], [0, Z + 0.3], [-0.1, Z + 0.15], [0.1, Z + 0.15]], cy = Math.cos(yaw), sy = Math.sin(yaw);
    for(let r = 0.5; r < 5 && !play; r += 0.05){ const p = at(r), ty = { x: p.x + sy * (Z + 0.05) * gs, z: p.z + cy * (Z + 0.05) * gs };
      if(rectDist(C.rects, p.x, p.z) >= 0.5 * gs && rectDist(C.rects, ty.x, ty.z) >= 0.12 * gs && navFree(p.x, p.z) && navFree(ty.x, ty.z) && rectDist(C.block, p.x, p.z) > 0.3 * gs
        && playSeen(area.map(([tx, tz]) => [p.x + (tx * cy + tz * sy) * gs, p.z + (-tx * sy + tz * cy) * gs]), C.occ || [])) play = { ...p, yaw }; }
    return play ? { k, fetch, play } : null;
  }
  /* a free slot for this pet, starting from its own by hash; null when all are taken (it roams instead) */
  function petSlot(pt){
    const C = petCtx, n = PILE_RAYS.length, k0 = Math.floor(petHash(pt.o.p.id + ':slot') * n);
    /* two pets at the pile keep apart: each spot of this pet clears both spots of every other pet there by their two half lengths */
    const clear = sl => [...C.taken.values()].every(o => o === pt || !o.slot || [sl.fetch, sl.play].every(a => [o.slot.fetch, o.slot.play].every(b => Math.hypot(a.x - b.x, a.z - b.z) > 0.4 * (pt.gs + o.gs))));
    for(let i = 0; i < n; i++){ const k = (k0 + i) % n, by = C.taken.get(k); if(by && by !== pt) continue; const s = petSlotSpots(pt, k); if(s && clear(s)){ C.taken.set(k, pt); pt.slot = s; return s; } }
    return null;
  }
  function petFree(pt){ if(petCtx) petCtx.taken.forEach((v, k) => { if(v === pt) petCtx.taken.delete(k); }); pt.slot = null; }
  function buildPets(lampList){
    if(!srv) return;
    const owners = people.filter(o => !o.ghost && sets.petIds.has(o.p.id) && normalizePetLook(o.p.pet));
    const pile = { x: srv.x + 1.9, z: srv.z + 1.3 };   /* where makePresents stands (see the world tree block); the basket takes the same spot out of season */
    if(!xmas && owners.some(o => o.p.petToys)){ const b = makeToyBasket(T); b.scale.setScalar(PET_SC * 1.2); b.rotation.y = 0.5; b.position.set(pile.x, petFloorY(pile.x, pile.z), pile.z); world.add(b); petBits.push(b); }
    const rects = [], pr = pileRects(pile), block = [];
    zones.forEach(zn => zn.seats.forEach(s => { rects.push([s.x - 1.1, s.z + 0.55, s.x + 1.1, s.z + 1.75], [s.x - 0.5, s.z - 0.22, s.x + 0.5, s.z + 0.72]); }));   /* desks; chairs with their sitters (the castors reach 0.47 out, the back 0.24 behind the seat) */
    rects.push([srv.x - 1.3, srv.z - 0.8, srv.x + 1.3, srv.z + 0.85], ...pr); block.push([srv.x - 1.3, srv.z - 0.8, srv.x + 1.3, srv.z + 0.85]);
    [[-FW / 2 + 1, -FD / 2 + 1], [FW / 2 - 1, -FD / 2 + 1], [-FW / 2 + 1, FD / 2 - 1]].forEach(([x, z]) => rects.push([x - 0.4, z - 0.4, x + 0.4, z + 0.4]));   /* potted plants */
    lampList.forEach(l => rects.push([l.x - 0.22, l.z - 0.22, l.x + 0.22, l.z + 0.22]));
    loungeObs.rects.forEach(r => rects.push(r));   /* the sofa, the table, the big plants and the standing lamp of the lounge */
    owners.forEach(o => { const b = petBowlAt(o); rects.push([b.x - 0.2, b.z - 0.35, b.x + 0.2, b.z + 0.35, 0.1]); });   /* the bowls, with a small margin so the pet still reaches them */
    petNav = petNavGrid(rects);
    /* rays start from the middle of the boxes (the pile's own origin is at its back edge) */
    const pc = { x: (Math.min(...pr.map(r => r[0])) + Math.max(...pr.map(r => r[2]))) / 2, z: (Math.min(...pr.map(r => r[1])) + Math.max(...pr.map(r => r[3]))) / 2 };
    /* occluders between the floor and the home camera (playSeen): desks with what stands on them, the chairs with their sitters, the kiosk, the plants and the pile */
    const occ = []; zones.forEach(zn => zn.seats.forEach(s => occ.push([s.x - 1.1, s.z + 0.55, s.x + 1.1, s.z + 1.75, 1.62], [s.x - 0.5, s.z - 0.22, s.x + 0.5, s.z + 0.72, 2.3])));
    occ.push([srv.x - 1.3, srv.z - 0.8, srv.x + 1.3, srv.z + 0.85, 2.4]); [[-FW / 2 + 1, -FD / 2 + 1], [FW / 2 - 1, -FD / 2 + 1], [-FW / 2 + 1, FD / 2 - 1]].forEach(([x, z]) => occ.push([x - 0.4, z - 0.4, x + 0.4, z + 0.4, 1.8]));
    loungeObs.occ.forEach(r => occ.push(r));
    const tops = pileTops(); tops.forEach(t => occ.push([t.x0, t.z0, t.x1, t.z1, t.y]));
    petCtx = { pile: pc, rects: pr, block, occ, tops, taken: new Map(), blobM: bas({ color: '#3a2a20', map: sets.soft, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }) };
    owners.forEach(o => petAdd(o, normalizePetLook(o.p.pet), true));
    petPhotosAsk(); if(owners.some(o => o.p.pet && o.p.pet.breed)) breedsLoad();
  }
  /* the bowls: on the floor at the right front corner of the desk, against its front edge. From the default camera that corner is in the clear (the next
     row's sitter is further left), and it is off the pets' strolling line along the aisle. The mat runs front to back with the food in front. */
  const petBowlAt = o => ({ x: o.x + 0.95, z: o.z + 2.2 });
  /* asleep on the desk the pet lies on the free left end, in front of the photo frame and left of the laptop, facing the camera's side */
  /* The left end is narrow (the laptop and the desk item take the rest), so the pet lies lengthwise, facing the front edge: the camera then sees its face three
     quarters on, and a large dog fits at 0.95 of its size with its chin at the very front edge. The back of the box stops short of the photo frame. */
  const DESK_FIT = { x0: -1.1, x1: -0.42, z0: 0.72, z1: 1.93 }, DESK_YAW = 0;
  /* The home camera looks along -x and -z, so the desk's front (+z) faces it. The pet takes off diagonally from the floor in front of the desk's middle (DESK_HOP)
     and lands on its sleeping spot on the left end, never behind the desk or past its owner. In front of the left end itself the next row's sitter hides the
     floor from that camera (only x >= -0.2 at the front edge is in view), so a straight jump from there showed no crouch and no take-off. The diagonal path
     crosses the front edge at about x -0.2, in front of the desk item and the laptop, already above the desk top. The photo frame stands in the back right
     corner (DESK_FRAME): seen from that camera nothing on the desk lies in front of it, while the sleeping pet on the left end lies across its line of sight.
     Its whole footprint, the stand's foot included, stays at least 0.05 inside the desk top (x within 1.1, z from 0.55): at x 0.98, z 0.64 the right edge
     stuck out past the side and the stand's foot hung off the back edge. */
  const DESK_HOP = { x: 0.1, z: 2.3 }, DESK_FRAME = { x: 0.84, z: 0.79 };
  const DESK_HOP_YAW = Math.atan2((DESK_FIT.x0 + DESK_FIT.x1) / 2 - DESK_HOP.x, (DESK_FIT.z0 + DESK_FIT.z1) / 2 - DESK_HOP.z);   /* facing the sleeping spot, so the hop needs no turn */
  function petFit(pt){
    const g = pt.g, o = pt.o, ud = g.userData, sc = g.scale.x, keep = [g.position.clone(), g.rotation.clone()];
    ud.pose('sleep', 0, 0, { blend: 0 }); g.rotation.set(0, DESK_YAW, 0); g.position.set(0, 0, 0); g.updateMatrixWorld(true);
    const bx = new T.Box3(); g.traverse(c => { if(c.isMesh && !c.isInstancedMesh && c.visible) bx.expandByObject(c, true); });   /* precise: the vertices, not the rotated boxes of the spheres */
    const w = Math.max(1e-3, bx.max.x - bx.min.x), d = Math.max(1e-3, bx.max.z - bx.min.z), F = DESK_FIT;
    const k = Math.min(1, (F.x1 - F.x0) / w, (F.z1 - F.z0) / d);
    pt.deskBox = [+(w / sc).toFixed(3), +(d / sc).toFixed(3)]; pt.deskK = k; pt.spots.desk = { x: o.x + (F.x0 + F.x1) / 2 - (bx.min.x + bx.max.x) / 2 * k, y: DESK_Y, z: o.z + (F.z0 + F.z1) / 2 - (bx.min.z + bx.max.z) / 2 * k, yaw: DESK_YAW };
    g.position.copy(keep[0]); g.rotation.copy(keep[1]); g.scale.setScalar(sc); ud.bkey = null; ud.bon = false;
  }
  function petModel(pt, look){
    const g = makePet(T, look, PET_GEAR); g.scale.multiplyScalar(PET_SC); g.rotation.order = 'YXZ'; pt.g = g; pt.gs = g.scale.x; pt.look = look; world.add(g); petBits.push(g);
    /* bs: the standing pet's height, bounding radius and body length in its own units (objList picks with them; the bowls' side step uses the length) */
    { g.userData.pose('stand', 0, 0, { blend: 0 }); g.position.set(0, 0, 0); g.updateMatrixWorld(true); const b = new T.Box3(), s = pt.gs; g.traverse(c => { if(c.isMesh && !c.isInstancedMesh && c.visible) b.expandByObject(c, true); });
      pt.bs = b.isEmpty() ? { h: 0.5, r: 0.4, len: 0.6 } : { h: (b.max.y - Math.max(0, b.min.y)) / s, r: b.getBoundingSphere(new T.Sphere()).radius / s, len: (b.max.z - b.min.z) / s }; }
    pt.S = pt.gs; petFit(pt);
  }
  /* the toy a pet plays with: the one chosen in its look, else the automatic one (a cat's yarn or mouse, a dog's ball or bone, by a hash of the owner) */
  const toyKindFor = (look, id) => { if(look.toy) return look.toy; const tk = petHash(id + ':toy') < 0.5; return look.kind === 'cat' ? (tk ? 'yarn' : 'mouse') : tk ? 'ball' : 'bone'; };
  /* swap a pet's toy for another kind in place (same state, place and size) */
  function petToyReplace(pt, kind){
    const t0 = pt.toy, t1 = makeToy(T, kind); t1.visible = t0.visible; t1.position.copy(t0.position); t1.rotation.copy(t0.rotation); t1.scale.copy(t0.scale);
    world.remove(t0); t0.userData.dispose(); petBits = petBits.filter(q => q !== t0); world.add(t1); petBits.push(t1); pt.toy = t1;
  }
  function petToyFix(pt, look){ if(pt && pt.toy && look){ const k = toyKindFor(look, pt.o.p.id); if(pt.toy.userData.kind !== k) petToyReplace(pt, k); } }
  /* one pet and its things; build: false when a live preview adds it after the build (its bowls then are not in the floor grid) */
  function petAdd(o, look, build){
    if(!petCtx || !look) return null;
    const id = o.p.id, b = petBowlAt(o), lane = (petHash(id + ':lane') - 0.5) * 0.24, own = { x: o.x, z: o.z + 0.3 }, face = (p, q) => Math.atan2(q.x - p.x, q.z - p.z);
    /* The pet's own corner is the gap left of the desk (x - 1.45, between this desk and the left neighbour's): it sits at the mouth of the gap looking up at
       its owner, and hops from the middle of the gap onto the desk's left end. It eats and drinks at the bowls by the right front corner, standing on their
       left and facing +x, so the camera sees its face. */
    const gx = o.x - 1.45, sit = { x: gx, z: o.z + 1.8 };   /* the mouth of the gap, level with the desk's front edge: in view of the default camera and out of the aisle */
    const pt = { o, lane, seed: id + ':pet', ph: petHash(id + ':ph') * 10, n: 0, q: [], seg: null, st: 0, x: sit.x, y: petFloorY(sit.x, sit.z), z: sit.z, yaw: 0, pose: 'sit', force: null, prev: null,
      tilt: 0, sq: 0, ks: 1, v: 0, amp: 0, phase: 0, blend: null, toys: !!o.p.petToys, toy: null, toyMode: 'pile', toyT: 0, toyA: null, play: null, slot: null, spots: null };
    pt.spots = { bowl: b, pile: petCtx.pile, sit: { ...sit, yaw: face(sit, own) }, hop: { x: o.x + DESK_HOP.x, z: o.z + DESK_HOP.z, yaw: DESK_HOP_YAW } };
    petModel(pt, look);
    const reach = 0.3 * pt.gs; pt.spots.eat = { x: b.x - reach, z: b.z + 0.11 * BOWL_SC, yaw: Math.PI / 2 }; pt.spots.drink = { x: b.x - reach, z: b.z - 0.11 * BOWL_SC, yaw: Math.PI / 2 };
    pt.yaw = pt.spots.sit.yaw;
    const bw = makeBowls(T); bw.scale.setScalar(BOWL_SC); bw.rotation.y = -Math.PI / 2; bw.position.set(b.x, petFloorY(b.x, b.z), b.z);   /* food (local +x) toward the front */ world.add(bw); petBits.push(bw); pt.bowls = bw;
    { const src = petPhotoSrc(o); if(src) petFrameAdd(pt, src); }
    if(pt.toys){ pt.toy = makeToy(T, toyKindFor(look, id)); pt.toy.visible = false; world.add(pt.toy); petBits.push(pt.toy);   /* the toy lives in the pile until the pet fetches it */
      pt.toyBlob = track(new T.Mesh(sets.disc, petCtx.blobM)); pt.toyBlob.visible = false; world.add(pt.toyBlob); }
    pt.blobMat = petCtx.blobM.clone(); pt.blob = track(new T.Mesh(sets.disc, pt.blobMat)); world.add(pt.blob);   /* its own material: it fades with the lift (stepPets) */
    pets.push(pt);
    if(!build && renderer) renderer.shadowMap.needsUpdate = true;
    return pt;
  }
  /* The desk frame's photo: the viewer's own photo kept in this browser first, else a shared copy fetched for this person (opts.petPhotos, see petPhotosAsk).
     A coworker's desk has a frame only once a shared photo arrived. */
  const photoCache = new Map();   /* person id -> data URL, or null once asked without an answer; kept for the page's lifetime */
  const petPhotoSrc = o => { const own = o.p.self && o.p.pet && typeof o.p.pet.photo === 'string' && /^data:image\//.test(o.p.pet.photo) ? o.p.pet.photo : null; return own || photoCache.get(String(o.p.id)) || null; };
  function petFrameAdd(pt, src){
    const o = pt.o, aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;   /* the photo leans back and is seen at a slant: anisotropic filtering keeps it sharp */
    const fr = makePhotoFrame(T, String(src), () => { if(renderer) renderer.shadowMap.needsUpdate = true; request(); }, aniso);
    fr.scale.setScalar(1.8); fr.rotation.y = 0.6; fr.position.set(o.x + DESK_FRAME.x, DESK_Y, o.z + DESK_FRAME.z);   /* see DESK_FRAME */
    fr.visible = !o.pose; world.add(fr); petBits.push(fr); pt.frame = fr; pt.photo = String(src);   /* hidden while its owner stands on the desk (frameShow) */
  }
  /* once per build: the drawn pets whose owner shares a photo (pet.shared) and that have no frame yet; every answer is checked (petPhotosClean) */
  function petPhotosAsk(){
    const fn = opts.petPhotos; if(typeof fn !== 'function') return;
    const ids = pets.filter(pt => pt.o.p.pet && pt.o.p.pet.shared === true && !pt.frame && !photoCache.has(String(pt.o.p.id))).map(pt => String(pt.o.p.id)).slice(0, PET_MAX);
    if(!ids.length) return;
    ids.forEach(id => photoCache.set(id, null));
    Promise.resolve().then(() => fn(ids)).then(res => {
      if(destroyed) return; const ok = petPhotosClean(res, ids);
      Object.entries(ok).forEach(([id, u]) => { photoCache.set(id, u); const pt = pets.find(q => String(q.o.p.id) === id); if(pt && !pt.frame) petFrameAdd(pt, u); });
      if(Object.keys(ok).length){ if(renderer) renderer.shadowMap.needsUpdate = true; request(); }
    }, () => {});
  }
  function petRemove(pt){
    petFree(pt);
    [pt.g, pt.bowls, pt.frame, pt.toy].forEach(h => { if(!h) return; if(h.parent) h.parent.remove(h); h.userData.dispose(); petBits = petBits.filter(q => q !== h); });
    [pt.blob, pt.toyBlob].forEach(b => { if(b && b.parent) b.parent.remove(b); }); if(pt.blobMat) pt.blobMat.dispose();
    pets = pets.filter(q => q !== pt); if(renderer) renderer.shadowMap.needsUpdate = true; request();
  }
  /* a new model for the same pet (a live preview with another shape): it keeps where it is and what it is doing */
  function petSwap(pt, look){
    const g0 = pt.g; world.remove(g0); g0.userData.dispose(); petBits = petBits.filter(q => q !== g0);
    petModel(pt, look); const reach = 0.3 * pt.gs, b = pt.spots.bowl; pt.spots.eat.x = pt.spots.drink.x = b.x - reach;
    request();
  }
  /* the toy has one size in every state (the pet's own units) and is always in the world: in the pile it is hidden, in the mouth it follows the mouth */
  const PET_TOY_K = 1.3, petToyR = 0.05 * PET_TOY_K;   /* one size table: the toy is PET_TOY_K times its pets.js size in the pet's own units, in every state */
  function petToySet(pt, mode){ pt.toyMode = mode; pt.toyT = 0; pt.toyA = pt.toy ? pt.toy.position.clone() : null; pt.toyR = pt.toy ? pt.toy.rotation.clone() : null; pt.toyQ = pt.toy ? toySpinOf(pt.toy).quaternion.clone() : null; pt.toyTop = null; pt.toyRolled = false; }
  /* the part of a toy that rolls: userData.spin (pets.js), else the whole toy as before; round: ball and yarn roll, a bone and a mouse never tip over */
  const toySpinOf = t => (t.userData && t.userData.spin) || t, toyRound = t => (t.userData && t.userData.round != null ? !!t.userData.round : t.userData.kind === 'ball' || t.userData.kind === 'yarn' || t.userData.kind === 'bell');
  const toyFlat = t => { const s = toySpinOf(t); if(s !== t) s.quaternion.identity(); else s.rotation.x = 0; };   /* upright: the spin group back to rest (never the toy's own yaw) */
  const toyCarry = t => { const v = t.userData && t.userData.carryYaw; return Number.isFinite(v) ? v : Math.PI / 2; };   /* the turn it is held at in the mouth, relative to the heading */
  const V3 = () => new T.Vector3();
  const _m = { v: null, ax: null, q: null, q0: null };
  function petMouth(pt){ const v = _m.v || (_m.v = V3()); pt.g.updateMatrixWorld(true); pt.g.userData.mouth.getWorldPosition(v); return v; }
  /* where a toy comes out of the pile and goes back in: the top of the present (or the basket) nearest to the point, never bare floor */
  function pileTop(x, z){
    const tops = (petCtx && petCtx.tops) || []; let best = null, bd = Infinity;
    tops.forEach(p => { const d = Math.hypot(p.x - x, p.z - z); if(d < bd){ bd = d; best = p; } });
    return best || { x, z, y: petFloorY(x, z) };
  }
  const TOY_POP = 0.15, TOY_UP = 0.45, TOY_DOWN = 0.4;   /* the scale-in (and out) on top of the present, then the trip to the mouth (and back) */
  function stepToy(pt, dt){
    const t = pt.toy; if(!t) return;
    pt.toyT += dt; const gs = pt.gs, m = pt.toyMode, e = k => easeIO(k), yaw = pt.yaw, full = gs * PET_TOY_K, ck = toyCarry(t);
    t.scale.setScalar(full); t.visible = m !== 'pile'; pt.toyBlob.visible = false;
    if(m === 'pile') return;
    const M = petMouth(pt), mouth = { x: M.x, y: M.y - petToyR * gs, z: M.z };
    const floor = (x, z) => petFloorY(x, z);
    if(m === 'rise' || m === 'mouth' || m === 'back'){
      let p = mouth, s = 1;
      if(m !== 'mouth'){
        /* rise: it grows out of the present's top in TOY_POP, then travels on a small arc into the mouth; back: the same in reverse */
        const top = pt.toyTop || (pt.toyTop = pileTop(M.x, M.z)), up = m === 'rise', tt = pt.toyT;
        const u = up ? Math.max(0, tt - TOY_POP) / TOY_UP : 1 - Math.min(1, tt / TOY_DOWN), k = e(Math.min(1, Math.max(0, u)));   /* k: 0 on the present, 1 in the mouth */
        s = up ? Math.min(1, tt / TOY_POP) : Math.min(1, Math.max(0, (TOY_DOWN + TOY_POP - tt) / TOY_POP));
        p = { x: top.x + (mouth.x - top.x) * k, y: top.y + (mouth.y - top.y) * k + 0.1 * gs * Math.sin(Math.PI * k), z: top.z + (mouth.z - top.z) * k };   /* the toy's origin is its base: on the present it rests on the lid */
        if(up && tt >= TOY_POP + TOY_UP) pt.toyMode = 'mouth';
        if(!up && tt >= TOY_DOWN + TOY_POP){ pt.toyMode = 'pile'; t.visible = false; return; }
      }
      t.scale.setScalar(full * Math.max(0.001, s));
      t.position.set(p.x, Math.max(p.y, floor(p.x, p.z)), p.z); t.rotation.set(0, yaw + ck, 0); toyFlat(t); return;
    }
    if(m === 'drop' || m === 'pick'){
      const k = e(pt.toyT / 0.32), Z = pz(pt), fx = pt.x + Math.sin(yaw) * Z * gs, fz = pt.z + Math.cos(yaw) * Z * gs, fl = { x: fx, y: floor(fx, fz), z: fz };
      const A = m === 'drop' ? mouth : (pt.toyA || fl), B = m === 'drop' ? fl : mouth;
      if(m === 'pick' && pt.toyA){ A.x = pt.toyA.x; A.y = pt.toyA.y; A.z = pt.toyA.z; }
      t.position.set(A.x + (B.x - A.x) * k, A.y + (B.y - A.y) * k, A.z + (B.z - A.z) * k);
      if(m === 'drop'){ t.rotation.set(0, yaw + ck * (1 - k), 0); toyFlat(t); }
      else { const r0 = pt.toyR || t.rotation; t.rotation.set(0, r0.y + angTo(r0.y, yaw + ck) * k, 0); const sp = toySpinOf(t);
        if(sp !== t && pt.toyQ){ const q0 = _m.q0 || (_m.q0 = new T.Quaternion()); sp.quaternion.copy(pt.toyQ).slerp(q0.identity(), k); } else toyFlat(t); }   /* the roll unwinds as it is picked up */
      if(pt.toyT >= 0.32){ pt.toyMode = m === 'drop' ? 'floor' : 'mouth'; pt.toyA = null; }
    }
    if(pt.toyMode === 'floor'){
      const Z = pz(pt), st = pt.play ? petPlayAt(pt.play.seq, pt.play.t, Z) : { tx: 0, tz: Z, roll: 0 }, cy = Math.cos(yaw), sy = Math.sin(yaw);
      const x = pt.x + (st.tx * cy + st.tz * sy) * gs, z = pt.z + (-st.tx * sy + st.tz * cy) * gs, sp = toySpinOf(t);
      if(toyRound(t) && sp !== t){
        /* a ball or yarn rolls by its own travel: about the horizontal axis across the move, by distance over radius, so it never slides or spins in place.
           The group keeps the yaw it was put down with (no turn about the vertical axis); the axis is turned into its frame. */
        const dx = x - t.position.x, dz = z - t.position.z, dd = Math.hypot(dx, dz), R = Math.max(1e-3, (Number(t.userData.r) || petToyR / PET_TOY_K) * t.scale.x);
        if(pt.toyRolled && dd > 1e-6 && dd < 0.6){ const ax = _m.ax || (_m.ax = V3()), q = _m.q || (_m.q = new T.Quaternion()), a = -t.rotation.y, c = Math.cos(a), s = Math.sin(a), wx = dz / dd, wz = -dx / dd;
          ax.set(wx * c + wz * s, 0, -wx * s + wz * c); q.setFromAxisAngle(ax, dd / R); sp.quaternion.premultiply(q); }
        pt.toyRolled = true; t.position.set(x, floor(x, z), z);
      } else { t.position.set(x, floor(x, z), z); t.rotation.set(0, yaw + st.roll * 0.4, 0); toyFlat(t); }   /* a bone or a mouse slides and turns flat */
    }
    if(pt.toyMode === 'floor' || pt.toyMode === 'drop' || pt.toyMode === 'pick'){ const b = pt.toyBlob, h = Math.max(0, t.position.y - floor(t.position.x, t.position.z)); b.visible = true; b.position.set(t.position.x, floor(t.position.x, t.position.z) + 0.004, t.position.z); const k = 0.13 * gs * Math.max(0.4, 1 - h / 0.4); b.scale.set(k, 1, k); }
  }
  /* for the rec hook: the lowest point of the toy's meshes (vertices, not boxes) above the floor under it, while it is out of the pile */
  function toyLow(pt){ const t = pt.toy; if(!t || !t.visible) return null; t.updateMatrixWorld(true); const b = new T.Box3().setFromObject(t, true); return b.isEmpty() ? null : b.min.y - petFloorY(t.position.x, t.position.z); }
  function petRoam(pt){ const o = pt.o, h = k => petHash(pt.seed + ':r' + pt.n + k); return [{ x: o.x - 1.3 + 1.65 * h('a'), z: o.z + 2.22 + 0.24 * h('b') }, { x: o.x - 1.3 + 1.65 * h('c'), z: o.z + 2.22 + 0.24 * h('d') }]; }
  /* the next act as a queue of steps: walk to a spot, hold a pose (turning to its heading first), hop between the floor and the desk, or do something */
  function petNext(pt){
    let kind = pt.force, dur = pt.forceDur || 1e6;
    if(!kind){ const a = petPlan(pt.seed, pt.n, 0, pt.prev); kind = a.kind === 'play' && !pt.toys ? 'roam' : a.kind; dur = a.t1 - a.t0; pt.prev = kind; }
    pt.n++;
    const S = pt.spots, q = pt.q, go = (to, gait = 'walk') => q.push({ k: 'walk', to, gait }), still = (pose, d, yaw) => q.push({ k: 'pose', pose, dur: d, yaw }), act = fn => q.push({ k: 'do', fn });
    if(kind === 'play' && pt.toys){ const sl = petSlot(pt); if(!sl) kind = 'roam'; else pt.slot = sl; }
    if(kind === 'sit') { go(S.sit); still('sit', dur, S.sit.yaw); }
    else if(kind === 'eat' || kind === 'drink'){ const to = S[kind]; if(pt.y < 0.5 && Math.hypot(to.x - pt.x, to.z - pt.z) < (pt.bs ? pt.bs.len : 0.6) * pt.gs) q.push({ k: 'side', to }); else go(to); still(kind, dur, to.yaw); }
    else if(kind === 'sleep'){ go(S.hop); q.push({ k: 'hop', to: S.desk, up: true }); still('stand', 0.3, S.desk.yaw); still('sleep', dur, S.desk.yaw); still('stand', 0.7); q.push({ k: 'hop', to: { ...S.hop, y: petFloorY(S.hop.x, S.hop.z) }, up: false }); }
    else if(kind === 'play'){
      /* fetch: to the pile, dig with the head over the boxes, the toy comes up into the mouth; carry it a few steps to open floor and put it down;
         play; pick it up, put it back in the pile and go home */
      const sl = pt.slot, play = dur < 1e5 ? Math.max(5, dur * 0.6) : 1e4;
      go(sl.fetch); still('sniff', 1.1, sl.fetch.yaw); act(p => petToySet(p, 'rise')); still('sniff', 0.5, sl.fetch.yaw); still('stand', 0.25);
      go(sl.play, 'carry'); still('stand', 0.2, sl.play.yaw); still('eat', 0.15); act(p => petToySet(p, 'drop')); still('eat', 0.35);
      act(p => { p.play = { seq: petPlaySeq(p.seed + ':' + p.n, play, pz(p)), t: 0 }; }); q.push({ k: 'play' });
      act(p => { p.play = null; }); still('eat', 0.12); act(p => petToySet(p, 'pick')); still('eat', 0.38); still('stand', 0.2);
      go(sl.fetch, 'carry'); still('sniff', 0.45, sl.fetch.yaw); act(p => petToySet(p, 'back')); still('sniff', 0.6, sl.fetch.yaw); act(petFree);
      go(S.sit); still('sit', 1.5, S.sit.yaw);
    }
    else { const r = petRoam(pt); go(r[0]); still('sniff', 0.9 + petHash(pt.seed + 'w' + pt.n), undefined); go(r[1]); still('stand', 0.8 + (dur < 1e5 ? Math.min(3, dur * 0.2) : 0), undefined); }   /* roam: two strolls along the aisle and a sniff at the floor between them */
  }
  /* petAct(): hold one behaviour (null hands the pet back to its schedule). walk: play the whole act from where the pet is (a pet on the desk is set down by
     the desk first); otherwise sleep, eat, drink, sit and play start in place, and roam strolls from the eating spot. */
  function petForce(pt, kind, walk){
    const S = pt.spots, at = (p, y) => { pt.x = p.x; pt.z = p.z; pt.y = y != null ? y : petFloorY(p.x, p.z); pt.yaw = p.yaw || 0; };
    if(kind === 'play' && !pt.toys) kind = 'roam';   /* no toys below the toys level */
    pt.v = 0; pt.tilt = 0; pt.sq = 0; pt.play = null; petFree(pt); if(pt.toy) petToySet(pt, 'pile');
    pt.force = ['roam', 'sit', 'eat', 'drink', 'sleep', 'play'].includes(kind) ? kind : null; pt.q = []; pt.seg = null; pt.st = 0;
    if(walk && kind){ if(pt.y > 0.5){ at(S.hop); pt.ks = 1; } return; }
    pt.ks = 1;
    if(kind === 'sleep'){ at(S.desk, DESK_Y); pt.ks = pt.deskK; }
    else if(kind === 'eat' || kind === 'drink') at(S[kind]);
    else if(kind === 'play'){ const sl = petSlot(pt); if(sl){ pt.slot = sl; at(sl.play); pt.pose = 'play'; pt.play = { seq: petPlaySeq(pt.seed + ':f' + pt.n, 1e4, pz(pt)), t: 0 }; if(pt.toy) petToySet(pt, 'floor'); pt.q.push({ k: 'play' }); pt.blend = 0; return; } kind = 'roam'; pt.force = 'roam'; }
    if(kind === 'roam') at({ x: S.eat.x - 0.3, z: S.eat.z + 0.2, yaw: Math.PI / 2 });
    else if(kind !== 'sleep' && kind !== 'eat' && kind !== 'drink') at(S.sit);
    pt.blend = 0;
    if(pt.force && pt.force !== 'roam') pt.q.push({ k: 'pose', pose: kind, dur: 1e6, yaw: pt.yaw });
  }
  /* turning on the spot: small steps (the gait advances with the angle turned), at most PET_TURN rad/s, easing out at the end; true once facing yawT */
  function petTurn(pt, yawT, dt){
    const e = angTo(pt.yaw, yawT), d = Math.max(-PET_TURN * dt, Math.min(PET_TURN * dt, e * 10 * dt));
    pt.yaw += d; pt.phase += Math.abs(d) * 0.16 / (PET_STRIDE * lk(pt)); pt.turning = Math.abs(e) > 0.05; return !pt.turning;
  }
  const lk = pt => { const v = pt.g.userData.legK; return Number.isFinite(v) && v > 0 ? v : 1; }, pz = pt => { const v = pt.g.userData.playZ; return Number.isFinite(v) ? Math.max(v, PET_PLAY_Z) : PET_PLAY_Z; };
  const petOnDesk = (pt, x, z) => Math.abs(x - pt.o.x) < 1.1 && z > pt.o.z + 0.55 && z < pt.o.z + 1.75;
  /* one segment for dt seconds; returns true when it is done */
  function petSeg(pt, sg, dt){
    pt.turning = false;
    if(sg.k === 'walk'){
      if(!sg.pts){ sg.pts = petPath(petNav, pt.x, pt.z, sg.to.x, sg.to.z, pt.lane); sg.i = 1; }
      if(sg.pts.length < 2){ pt.x = sg.to.x; pt.z = sg.to.z; pt.v = 0; return true; }   /* already there: petPath gives one point, and pts[1] would throw and stop the frame loop */
      let i = sg.i; while(i < sg.pts.length - 1 && Math.hypot(sg.pts[i][0] - pt.x, sg.pts[i][1] - pt.z) < 0.02) i++; sg.i = i;
      const P = sg.pts[i], dx = P[0] - pt.x, dz = P[1] - pt.z, L = Math.hypot(dx, dz);
      let rem = L; for(let j = i + 1; j < sg.pts.length; j++) rem += Math.hypot(sg.pts[j][0] - sg.pts[j - 1][0], sg.pts[j][1] - sg.pts[j - 1][1]);
      if(rem < 0.004 && pt.v < 0.05){ pt.x = sg.to.x; pt.z = sg.to.z; pt.v = 0; return true; }
      const head = L > 1e-4 ? Math.atan2(dx, dz) : pt.yaw, err = angTo(pt.yaw, head);
      const dy = Math.max(-PET_TURN * dt, Math.min(PET_TURN * dt, err * 9 * dt)); pt.yaw += dy; pt.turning = Math.abs(err) > 0.25 && pt.v < 0.2;
      pt.v = petSpeedStep(pt.v, rem, Math.abs(angTo(pt.yaw, head)), dt, PET_SPEED, PET_ACC);
      const step = Math.min(L, pt.v * dt); if(L > 1e-6){ pt.x += dx / L * step; pt.z += dz / L * step; }
      pt.phase = petGait(pt.phase, step, pt.gs * pt.ks, lk(pt)); if(pt.turning) pt.phase += Math.abs(dy) * 0.16 / (PET_STRIDE * lk(pt));   /* turning on the spot steps too */
      pt.y = petFloorY(pt.x, pt.z); pt.pose = sg.gait; return false;
    }
    if(sg.k === 'side'){
      /* closer than a body length (food to water): face the target heading, then step sideways onto it instead of walking a loop */
      if(!sg.faced){ if(!petTurn(pt, sg.to.yaw, dt)){ pt.pose = 'walk'; return false; } sg.faced = true; }
      const dx = sg.to.x - pt.x, dz = sg.to.z - pt.z, L = Math.hypot(dx, dz);
      if(L < 0.004){ pt.x = sg.to.x; pt.z = sg.to.z; pt.v = 0; return true; }
      const v = Math.min(0.35, L * 3 + 0.08), st = Math.min(L, v * dt); pt.x += dx / L * st; pt.z += dz / L * st; pt.v = v;
      pt.phase = petGait(pt.phase, st * 1.6, pt.gs * pt.ks, lk(pt)); pt.y = petFloorY(pt.x, pt.z); pt.pose = 'walk'; return false;
    }
    if(sg.k === 'pose'){
      if(sg.yaw != null && !sg.faced){ if(!petTurn(pt, sg.yaw, dt)){ pt.pose = pt.y > 0.5 ? 'walk' : (pt.toyMode === 'mouth' ? 'carry' : 'walk'); return false; } sg.faced = true; }
      pt.pose = sg.pose; sg.t = (sg.t || 0) + dt; return sg.t >= sg.dur;
    }
    if(sg.k === 'play'){
      if(!pt.play){ return true; }
      pt.pose = 'play'; pt.play.t += dt; const end = pt.play.seq.length ? pt.play.seq[pt.play.seq.length - 1].t1 : 0; return pt.play.t >= end;
    }
    if(sg.k === 'hop'){
      /* turn to the target, crouch, fly on an arc with the body pitched (nose up going up, down coming down), land with a squash. No change of scale in the air. */
      const B = sg.to, by = B.y != null ? B.y : petFloorY(B.x, B.z);
      if(!sg.ph){ sg.ph = 'turn'; sg.a = { x: pt.x, y: pt.y, z: pt.z }; sg.yaw = Math.atan2(B.x - pt.x, B.z - pt.z); }
      if(sg.ph === 'turn'){ pt.pose = 'walk'; if(petTurn(pt, sg.yaw, dt)){ sg.ph = 'crouch'; sg.t = 0; } return false; }
      sg.t += dt;
      if(sg.ph === 'crouch'){ pt.pose = 'crouch'; if(sg.t >= 0.32){ sg.ph = 'air'; sg.t = 0; } return false; }
      const T1 = sg.up ? 0.56 : 0.5, A = sg.a;
      if(sg.ph === 'air'){
        const f = Math.min(1, sg.t / T1), dy = by - A.y;
        const fh = hopAlong(f, sg.up); pt.x = A.x + (B.x - A.x) * fh; pt.z = A.z + (B.z - A.z) * fh;
        pt.y = sg.up ? A.y + dy * (2 * f - f * f) + 0.28 * 4 * f * (1 - f) : A.y + dy * f * f + 0.25 * 4 * f * (1 - f);
        pt.tilt = sg.up ? -0.5 * Math.sin(Math.PI * Math.min(1, f / 0.75)) + 0.12 * Math.sin(Math.PI * Math.max(0, (f - 0.6) / 0.4)) : 0.42 * Math.sin(Math.PI * Math.min(1, f / 0.9));
        pt.pose = 'leap'; pt.blend = 0.12;
        if(f >= 1){ pt.x = B.x; pt.z = B.z; pt.y = by; pt.tilt = 0; sg.ph = 'land'; sg.t = 0; }
        return false;
      }
      pt.pose = 'crouch'; pt.blend = 0.1; pt.sq = 0.9 * Math.sin(Math.PI * Math.min(1, sg.t / 0.28));
      if(sg.t >= 0.28){ pt.sq = 0; return true; }
      return false;
    }
    return true;
  }
  function stepPets(dt0){
    pets.forEach(pt => {
      let dt = dt0; pt.blend = null;
      if(reduced && !pt.force){ pt.seg = null; pt.q = []; Object.assign(pt, { x: pt.spots.sit.x, z: pt.spots.sit.z, yaw: pt.spots.sit.yaw, pose: 'sit', tilt: 0, sq: 0, ks: 1, v: 0 }); pt.y = petFloorY(pt.x, pt.z); if(pt.toy) pt.toyMode = 'pile'; }
      else {
        for(let guard = 0; guard < 12; guard++){
          if(!pt.seg){ if(!pt.q.length) petNext(pt); pt.seg = pt.q.shift(); }
          const sg = pt.seg;
          if(sg.k === 'do'){ sg.fn(pt); pt.seg = null; continue; }
          if(petSeg(pt, sg, dt)){ pt.seg = null; dt = 0; continue; }
          break;
        }
      }
      /* the scale for the desk (only where a large pet would not fit) changes while it settles into sleep or gets up, never in the air */
      const kT = pt.y > 0.5 && pt.pose === 'sleep' ? pt.deskK : 1, air = !!(pt.seg && pt.seg.k === 'hop' && pt.seg.ph === 'air'); if(!air) pt.ks += Math.max(-dt0 * 0.5, Math.min(dt0 * 0.5, kT - pt.ks));
      const moving = pt.pose === 'walk' || pt.pose === 'carry', ampT = moving ? Math.max(pt.v / PET_SPEED, pt.turning ? 0.65 : 0) : 0; pt.amp += (ampT - pt.amp) * Math.min(1, dt0 * 10);
      const g = pt.g, tt = time + pt.ph, sc = pt.gs * pt.ks;
      g.position.set(pt.x, pt.y, pt.z); g.rotation.set(pt.tilt, pt.yaw, 0); g.scale.set(sc * (1 + 0.1 * pt.sq), sc * (1 - 0.16 * pt.sq), sc * (1 + 0.1 * pt.sq));
      g.userData.pose(pt.pose, 0, reduced && !pt.force ? 0 : tt, { phase: pt.phase, amp: pt.amp, play: pt.pose === 'play' && pt.play ? petPlayAt(pt.play.seq, pt.play.t, pz(pt)) : null, blend: reduced && !pt.force ? 0 : pt.blend });
      { const gp = g.userData.gearParts; if(gp && gp.length) gp.forEach(h => { if(h.userData.tick) h.userData.tick(time, envN, reduced); }); }   /* the pet's hat and wings, like the people's head gear */
      stepToy(pt, dt0);
      /* the contact shadow stays on the floor until the pet is over the desk top; it shrinks and fades with the lift, the hop's and the pose's own (userData.air:
         a pounce, in the pet's units) */
      const airL = Number.isFinite(g.userData.air) ? Math.max(0, g.userData.air) * sc : 0;
      const gy = petOnDesk(pt, pt.x, pt.z) ? DESK_Y : petFloorY(pt.x, pt.z), lift = Math.max(0, pt.y - gy) + airL, k = Math.max(0.35, 1 - lift / 1.1), sl = pt.pose === 'sleep';
      pt.blob.position.set(pt.x, gy + 0.004, pt.z); pt.blob.rotation.y = pt.yaw; pt.blob.scale.set((sl ? 0.75 : 0.58) * sc * k, 1, (sl ? 0.95 : 0.9) * sc * k); if(pt.blobMat) pt.blobMat.opacity = 0.34 * (0.3 + 0.7 * k);
    });
  }
  /* the shop's live preview in the scene: the member's own pet takes the look being edited (repainted in place when only colours change, a new model
     otherwise, a new pet when there was none) and goes back to the saved one on cancel or when the shop closes. look null restores the saved pet. */
  let petLiveTm = 0;
  function petLive(look){
    const o = sel && sel.p && sel.p.self ? sel : people.find(q => q.p && q.p.self); if(!o || !petCtx) return;
    const pt = pets.find(q => q.o === o), want = look ? normalizePetLook(look) : (sets.petIds.has(o.p.id) ? normalizePetLook(o.p.pet) : null);
    clearTimeout(petLiveTm); petLiveTm = 0;
    if(!want){ if(pt) petRemove(pt); return; }
    if(pt && petRecolor(pt.g, want)){ pt.look = want; petToyFix(pt, want); request(); return; }
    const go = () => { petLiveTm = 0; if(destroyed) return; const p2 = pets.find(q => q.o === o); if(p2){ petSwap(p2, want); petToyFix(p2, want); } else petAdd(o, want, false); request(); };
    if(pt) petLiveTm = setTimeout(go, 180); else go();
  }
  /* the HUD, the legend with its strip, the field guide button and the aria labels: text only, so update() repaints them without a rebuild */
  function paintChrome(d){
    const closed = !!d.closed;
    elHud.innerHTML = `<b>${esc(d.hud.title)}${closed ? `<em>${esc(d.hud.closed)}</em>` : ''}</b>${esc(d.hud.stats)}`; elHud.appendChild(elChip); renderChip();
    elLegend.innerHTML = (d.strip ? `<div class="of-strip"><button type="button" class="sbk" aria-label="${esc(d.strip.title)}"><b>${BOOK_ICON}${esc(d.strip.title)}</b></button>${d.strip.tiers.map(g => `<span class="tg t-${g.tier}"><em>${esc(g.label)}</em>${g.items.map(q => q.n ? `<button type="button" class="sp" data-k="${esc(q.k)}" title="${esc(q.name + ' · ' + q.n)}" aria-label="${esc(q.name + ' · ' + q.n)}">${speciesThumb(q.k)}</button>` : `<span class="sp z" title="${esc(q.name)}">${speciesThumb(q.k)}</span>`).join('')}</span>`).join('')}</div>` : '')
      + `<div class="keys">${(d.legend || []).map(l => `<span>${l.k ? (l.k === 'crown' ? iconSvg(l.k) : speciesThumb(l.k)) : l.bots ? '' : l.c ? `<i style="background:${l.c}"></i>` : ''}${esc(l.label)}${(l.fams || []).map(f => `<i class="fm" style="background:${f.c}"></i>${esc(f.label)}`).join('')}</span>`).join('')}</div>`;
    { const sb = elLegend.querySelector('.of-strip .sbk'); if(sb) sb.addEventListener('click', () => openBook());
      /* a species in the strip flies to a person of that species; clicking it again moves on to the next one, best ranked first */
      elLegend.querySelectorAll('.of-strip .sp[data-k]').forEach(el => el.addEventListener('click', () => {
        const k = el.dataset.k, list = people.filter(o => !o.ghost && o.gk === k).sort((a, b) => (a.p.rank || 1e9) - (b.p.rank || 1e9)); if(!list.length) return;
        const at = list.indexOf(sel), next = list[(at + 1) % list.length]; openDrawer(next);
      })); }
    if(chrome.bookBtn) chrome.bookBtn.style.display = d.book ? '' : 'none';
    if(canvas) canvas.setAttribute('aria-label', d.aria || '');
    (container.closest('.of-card') || container).setAttribute('aria-label', d.hud.title);
  }
  function build(d){
    cur = d; clear(); loungeObs = { rects: [], occ: [] }; xmas = holidayOn();
    const closed = !!d.closed, pl = d.people || [];
    paintChrome(d);
    zones = layout(d);
    /* lights, backdrop and lawn follow the time of day and the weather in applyEnv(); a suspended office stays grey there too */
    const R = Math.hypot(FW, FD) / 2 + 4; Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R }); sun.shadow.camera.updateProjectionMatrix();
    const grey = C('#dcdce2'), col = c => closed ? C(c).lerp(grey, 0.5) : C(c);
    const snowy = builtSnow = wx.kind === 'snow', SNOW = '#f7faff';
    const W0 = wxs = { outB: [], outS: [], glass: [], patch: [], wins: [], lamps: [], stones: [], glassBase: [], ao: [] };

    let ws = null, wd = false; wallIdx = { z: [], x: [] }; wallHid = { z: false, x: false };   /* wd: trim on a wall (wainscot, rails, window bars, sills) is stored as ~index and vanishes with its wall instead of leaving a strip */
    const sb = [], B = (c, w, h, dd, x, y, z, ry = 0) => { sb.push([c, w, h, dd, x, y, z, ry]); if(ws) wallIdx[ws].push(wd ? ~(sb.length - 1) : sb.length - 1); };       /* static boxes (ry: an optional turn about y, for the lounge armchairs) */
    const sp = [], Sp = (c, r, x, y, z, sx = 1, sy = 1, sz = 1) => sp.push([c, r, x, y, z, sx, sy, sz]);   /* static spheres */
    const OB = (kind, ...a) => { B(...a); W0.outB.push([sb.length - 1, col(a[0]), kind]); }, OS = (kind, ...a) => { Sp(...a); W0.outS.push([sp.length - 1, col(a[0]), kind]); };   /* outdoors: tinted by applyEnv */
    const IW = FW + 4, ID = FD + 4;
    OB('lawn', '#cfe8b5', IW, 0.5, ID, 0, -0.45, 0);                                  /* garden island */
    OB('soil', '#b99a73', IW - 0.6, 0.3, ID - 0.6, 0, -0.85, 0);
    OB('soil', '#a98864', IW - 1.0, 0.45, ID - 1.0, 0, -1.22, 0);                     /* two more soil layers, stepping inward: the island reads as a diorama base, not a slab */
    OB('soil', '#8c7a6c', IW - 1.6, 0.4, ID - 1.6, 0, -1.64, 0);
    B('#e9c99a', FW, 0.4, FD, 0, -0.2, 0);                                            /* wood floor slab */
    B('#b48a5a', FW - 0.04, 0.008, FD - 0.04, 0, 0.004, 0);                           /* dark underlay: it shows only in the seams between the planks */
    { /* planks 0.6 wide running along x, butt joints staggered row by row, a hashed tone per plank and 0.03 seams; the outer edges stay flush with the slab, and a row never ends in a sliver */
      const PT = ['#f0d2a6', '#e9c999', '#f4dab3', '#e5c290', '#eecfa2', '#f2d6ac'], PW = 0.6, h2 = 0.015;
      for(let r = 0, z0 = -FD / 2; z0 < FD / 2 - 0.05; r++, z0 += PW){
        const z1 = FD / 2 - (z0 + PW) < 0.3 ? FD / 2 : z0 + PW, za = z0 + (r ? h2 : 0), zb = z1 - (z1 < FD / 2 ? h2 : 0);
        let k = 0, x0 = -FW / 2, x1 = x0 + 0.8 + hash('pr' + r) * 2.6;
        while(x0 < FW / 2 - 0.01){
          if(FW / 2 - x1 < 0.8) x1 = FW / 2;
          const xa = x0 + (k ? h2 : 0), xb = x1 - (x1 < FW / 2 ? h2 : 0);
          B(PT[Math.floor(hash('pc' + r + ':' + k) * PT.length)], xb - xa, 0.03, zb - za, (xa + xb) / 2, 0.015, (za + zb) / 2);
          k++; x0 = x1; x1 = x0 + 2.6 + hash('pl' + r + ':' + k) * 1.8;
        }
        if(z1 >= FD / 2) break;
      }
    }
    /* walls: a wainscot in a deeper shade below a white rail, a wooden baseboard, and the cap on top */
    ws = 'z'; B('#f6ecd6', FW, 2.2, 0.3, 0, 1.1, -FD / 2); B('#fffaf0', FW, 0.12, 0.4, 0, 2.26, -FD / 2); if(snowy) B(SNOW, FW + 0.06, 0.1, 0.46, 0, 2.37, -FD / 2);
    wd = true; B('#ecdcbc', FW, 0.86, 0.03, 0, 0.47, -FD / 2 + 0.165); B('#fffaf0', FW, 0.06, 0.06, 0, 0.92, -FD / 2 + 0.18); B('#cfa877', FW, 0.18, 0.05, 0, 0.09, -FD / 2 + 0.175); wd = false;
    ws = 'x'; B('#d3ecdc', 0.3, 2.2, FD, -FW / 2, 1.1, 0); B('#fffaf0', 0.4, 0.12, FD, -FW / 2, 2.26, 0); if(snowy) B(SNOW, 0.46, 0.1, FD + 0.06, -FW / 2, 2.37, 0);
    wd = true; B('#b5dcc3', 0.03, 0.86, FD, -FW / 2 + 0.165, 0.47, 0); B('#fffaf0', 0.06, 0.06, FD, -FW / 2 + 0.18, 0.92, 0); B('#cfa877', 0.05, 0.18, FD, -FW / 2 + 0.175, 0.09, 0); wd = false; ws = null;   /* walls that end up between the camera and the room are flattened in updateWalls() */
    const win = (x, z, alongX) => {                                                    /* window with blinds (closed) or glass (open) and a light patch */
      const gx = alongX ? 2.2 : 0.1, gz = alongX ? 0.1 : 2.2, fx = alongX ? 2.5 : 0.08, fz = alongX ? 0.08 : 2.5, ox = alongX ? 0 : 0.2, oz = alongX ? 0.2 : 0;
      B('#ffffff', fx, 1.3, fz, x + ox - (alongX ? 0 : 0.02), 1.3, z + oz - (alongX ? 0.02 : 0));
      B(closed ? '#d6d6dc' : '#bfe3f5', gx, 1.0, gz, x + ox + (alongX ? 0 : 0.04), 1.3, z + oz + (alongX ? 0.04 : 0)); if(!closed) W0.glass.push(sb.length - 1);
      W0.wins.push({ x: x + ox + (alongX ? 0 : 0.11), z: z + oz + (alongX ? 0.11 : 0), alongX, ws });   /* inner glass face, for raindrops */
      /* the glass sits inside a white frame with a mullion cross and a deep sill under it (u runs along the wall, v out from it into the room) */
      const F = (c, u, y, v, su, sy, sv) => { wd = true; B(c, alongX ? su : sv, sy, alongX ? sv : su, alongX ? x + u : x + v, y, alongX ? z + v : z + u); wd = false; };
      F('#ffffff', 0, 1.82, 0.31, 2.36, 0.09, 0.05); F('#ffffff', 0, 0.78, 0.31, 2.36, 0.09, 0.05); F('#ffffff', -1.14, 1.3, 0.31, 0.09, 1.0, 0.05); F('#ffffff', 1.14, 1.3, 0.31, 0.09, 1.0, 0.05);
      F('#ffffff', 0, 1.3, 0.31, 0.06, 0.98, 0.04); F('#ffffff', 0, 1.5, 0.31, 2.2, 0.05, 0.04);
      F('#fffaf0', 0, 0.63, 0.3, 2.72, 0.06, 0.3); F('#e6d6b8', 0, 0.58, 0.22, 2.4, 0.05, 0.12);
      if(snowy) B(SNOW, alongX ? 2.5 : 0.34, 0.07, alongX ? 0.34 : 2.5, x + ox + (alongX ? 0 : 0.06), 0.68, z + oz + (alongX ? 0.06 : 0));   /* snow on the sill */
      if(closed) for(let q = 0; q < 4; q++) B('#b7b7c2', alongX ? 2.2 : 0.12, 0.04, alongX ? 0.12 : 2.2, x + ox + (alongX ? 0 : 0.05), 1.02 + q * 0.25, z + oz + (alongX ? 0.05 : 0));
      else { B('#f8e2b0', alongX ? 2.2 : 2.6, 0.02, alongX ? 2.6 : 2.2, alongX ? x : x + 1.5, 0.04, alongX ? z + 1.6 : z); W0.patch.push(sb.length - 1); }
    };
    ws = 'z'; for(let x = -FW / 2 + 3.5; x < FW / 2 - 1.5; x += 6.5) win(x, -FD / 2 + 0.15, true);
    ws = 'x'; for(let z = -FD / 2 + 3.5; z < FD / 2 - 1.5; z += 6.5) win(-FW / 2 + 0.15, z, false); ws = null;
    if(xmas){   /* a light string under the back wall's trim and wreaths between its windows; the group hides with the wall in updateWalls() */
      holWall = new T.Group(); world.add(holWall);
      const gz = -FD / 2 + 0.24, gar = makeGarland(T, [[-FW / 2 + 0.3, 2.15, gz], [0, 2.15, gz], [FW / 2 - 0.3, 2.15, gz]], 0.14); holWall.add(gar); hol.push(gar);
      for(let x = -FW / 2 + 3.5 + 3.25, k = 0; x < FW / 2 - 1.2 && k < 3; x += 6.5, k++){ const w = makeWreath(T); w.position.set(x, 1.3, -FD / 2 + 0.28); holWall.add(w); hol.push(w); }
    }
    const RUG = ['#ffd6c9', '#c9ecd6', '#e3d7fa', '#cde8f8', '#fde9b8', '#f9d4e4'], CH = ['#f7a98f', '#8fd6ac', '#b7a2ee', '#8cc7ee', '#f3cd7a', '#f0a8c8'];
    let zi = 0; const zi2 = []; const screens = [], ghosts = [], solids = [];
    sets.petIds = petDrawn(d);
    zones.forEach(zn => {
      if(zn.kind === 'server'){                                                         /* cute rounded kiosk */
        B('#f4ecff', 2.4, 3.0, 1.4, zn.cx, 1.5, zn.cz); Sp('#f4ecff', 1, zn.cx, 3.0, zn.cz, 1.2, 0.55, 0.7); B('#5a5270', 1.9, 2.4, 0.1, zn.cx, 1.65, zn.cz + 0.72);
        B('#e0d4f5', 2.6, 0.2, 1.6, zn.cx, 0.1, zn.cz); Sp('#ffffff', 1, zn.cx - 0.45, 3.1, zn.cz + 0.5, 0.12, 0.12, 0.12); Sp('#ffffff', 1, zn.cx + 0.45, 3.1, zn.cz + 0.5, 0.12, 0.12, 0.12);
        { /* rack detail: a pale bezel round the dark front, a divider between each row of lights, vent slats on the sides, a top band and a kick plate */
          const cx = zn.cx, cz = zn.cz;
          B('#e6dcf7', 2.04, 2.54, 0.06, cx, 1.65, cz + 0.71); B('#d9cdef', 2.46, 0.1, 1.46, cx, 2.92, cz); B('#cfc2ea', 2.3, 0.16, 0.04, cx, 0.28, cz + 0.71);
          for(let i = 0; i < 6; i++) B('#6b6385', 1.8, 0.025, 0.02, cx, 0.915 + i * 0.33, cz + 0.78);
          for(const sx of [-1, 1]) for(let i = 0; i < 8; i++) B(i % 4 === 3 ? '#cfc2ea' : '#d9cdef', 0.03, 0.06, 0.9, cx + sx * 1.215, 0.62 + i * 0.22 + (i > 3 ? 0.18 : 0), cz - 0.05);
        }
        srv = { x: zn.cx, z: zn.cz };
        for(let i = 0; i < 7; i++) for(let j = 0; j < 4; j++) srvLights.push({ x: zn.cx - 0.66 + j * 0.44, y: 0.75 + i * 0.33, z: zn.cz + 0.8, c: C(['#7fe0b8', '#c4b5fd', '#8ec5fb', '#fcd34d', '#f9a8d4'][(i * 2 + j) % 5]), ph: hash(i * 7 + j), per: 0.6 + hash(i * 3 + j * 11) * 1.4 });
        return;
      }
      const rc = zn.kind === 'free' ? '#efe6d6' : RUG[zi % RUG.length], chair = zn.kind === 'free' ? '#d9cdb8' : CH[zi % CH.length];
      if(zn.kind !== 'free') zi++;
      zn.rugIdx = sb.length; zn.rugCol = rc; B(rc, zn.w, 0.04, zn.d, zn.cx, 0.05, zn.cz);
      { /* a woven border: a band in a deeper shade of the rug and a thin line inside it, flat on the pile so the hover tint (rugIdx) still reads on the field */
        const hs = {}; C(rc).getHSL(hs); const bc = '#' + C().setHSL(hs.h, Math.min(1, hs.s * 0.85 + 0.05), Math.max(0, hs.l - 0.12)).getHexString();
        const band = (ins, bw) => { const w = zn.w - 2 * ins, dd = zn.d - 2 * ins;
          B(bc, w, 0.004, bw, zn.cx, 0.072, zn.cz - dd / 2 + bw / 2); B(bc, w, 0.004, bw, zn.cx, 0.072, zn.cz + dd / 2 - bw / 2);
          B(bc, bw, 0.004, dd - 2 * bw, zn.cx - w / 2 + bw / 2, 0.072, zn.cz); B(bc, bw, 0.004, dd - 2 * bw, zn.cx + w / 2 - bw / 2, 0.072, zn.cz); };
        band(0.22, 0.13); band(0.45, 0.035);
      }
      zn.seats.forEach(s => {
        const x = s.x, z = s.z, p = s.p, mz = v => 2 * (z + 0.3) - v;   /* the person sits at z + 0.3 facing the camera (+z); desk, chair and shadows mirror around that line, so the desk is in front and the chair behind */
        const lc = LAPTOP_COL[laptopKind(p && p.os)], dz = mz(z - 0.55), cz = mz(z + 0.35);
        B('#f3d9ae', 2.2, 0.12, 1.2, x, 1.0, dz); B('#e0bd8a', 0.1, 1.0, 1.0, x - 0.95, 0.5, dz); B('#e0bd8a', 0.1, 1.0, 1.0, x + 0.95, 0.5, dz);
        B('#e3c08d', 1.8, 0.13, 0.04, x, 0.875, dz + 0.5);   /* apron under the front edge */
        B('#ecca98', 0.5, 0.86, 0.9, x - 0.65, 0.5, dz); B('#c79b66', 0.22, 0.03, 0.03, x - 0.65, 0.78, dz + 0.46); B('#c79b66', 0.22, 0.03, 0.03, x - 0.65, 0.42, dz + 0.46); B('#dcb886', 0.46, 0.012, 0.02, x - 0.65, 0.6, dz + 0.451);   /* drawer pedestal on the left, two handles */
        if(!(p && sets.petIds.has(p.id))){ /* a little still life on the free left end of the desk (the right end is where the picked one stands and the mug goes); a pet owner's left end holds the photo frame and the sleeping pet instead */
          const kd = Math.floor(hash('dk' + x.toFixed(2) + ',' + z.toFixed(2)) * 3), NB = ['#7aa6d6', '#e98a7a', '#8cc79a', '#b49be6', '#f0c060'], nb = NB[Math.floor(hash('nb' + x.toFixed(2) + z.toFixed(2)) * NB.length)];
          if(kd === 0){ B(nb, 0.36, 0.035, 0.27, x - 0.7, 1.078, dz - 0.05); B('#fffaf0', 0.33, 0.012, 0.25, x - 0.7, 1.1, dz - 0.05); B('#6f7a92', 0.1, 0.15, 0.1, x - 0.97, 1.135, dz + 0.3); B('#f3c14b', 0.02, 0.1, 0.02, x - 0.99, 1.24, dz + 0.29); B('#e46f5f', 0.02, 0.08, 0.02, x - 0.95, 1.23, dz + 0.31); }
          else if(kd === 1){ B('#e8a77f', 0.2, 0.15, 0.2, x - 0.8, 1.135, dz + 0.15); B('#6e5038', 0.17, 0.02, 0.17, x - 0.8, 1.21, dz + 0.15); Sp('#7cc48a', 0.11, x - 0.8, 1.27, dz + 0.15, 1, 0.8, 1); Sp('#9bd49a', 0.08, x - 0.74, 1.33, dz + 0.11); Sp('#6fb67d', 0.07, x - 0.86, 1.31, dz + 0.19); }
          else { B('#fffaf0', 0.34, 0.025, 0.26, x - 0.72, 1.072, dz); B('#f1ece0', 0.32, 0.025, 0.25, x - 0.69, 1.097, dz - 0.03); B(nb, 0.3, 0.05, 0.22, x - 0.72, 1.135, dz + 0.02); }
        }
        B(lc, 0.95, 0.04, 0.6, x, 1.08, z + 0.95); B(lc, 0.95, 0.5, 0.04, x, 1.35, z + 1.27);   /* laptop: base on the desk, lid standing behind it with its back to the camera */
        B(chair, 0.8, 0.12, 0.8, x, 0.6, cz); B(chair, 0.8, 0.8, 0.12, x, 1.0, mz(z + 0.78)); B('#d6cfc4', 0.1, 0.6, 0.1, x, 0.3, cz);
        B('#9a94a8', 0.84, 0.05, 0.08, x, 0.075, cz); B('#9a94a8', 0.08, 0.05, 0.84, x, 0.075, cz);   /* star base on four castors */
        [[0.42, 0], [-0.42, 0], [0, 0.42], [0, -0.42]].forEach(([ax, az]) => B('#5f5a6e', 0.1, 0.07, 0.1, x + ax, 0.035, cz + az));   /* boxes, not spheres: at this size a sphere costs 30 times the triangles for nothing visible */
        W0.ao.push([x, mz(z - 0.55), 2.6, 1.5], [x, mz(z + 0.4), 1.05, 1.05]);   /* contact shadows under the desk and the chair (drawn in buildEnv) */
        const LY = 1.36, LZ = z + 1.27 + 0.02 + 0.025;   /* the logo floats 0.025 off the lid back */
        if(!p){ screens.push([x, LY, LZ, 'off', 0, 'other', 0]); return; }
        const ghost = closed || p.tier === 'nodata', key = ghost ? 'nodata' : p.tier, gk = ghost ? 'ghost' : gradeKey(p);
        const o = { x, z, p, gk, tv: TV[key], an: ghost ? GHOST : ANIMALS[gk] || ANIMALS[TIER_GRADE[p.tier]], ghost, dy: 0, ph: hash(p.id) * 6.28 };
        o.idx = (ghost ? ghosts : solids).length; (ghost ? ghosts : solids).push(o); people.push(o);
        screens.push([x, LY, LZ, key, o.ph, laptopKind(p.os), 0]);   /* [x, y, z, tier key, phase, logo kind, index inside that kind's mesh] */
        if(p.tier === 'low' && !ghost){ fpt(o, x + 0.55, 1.04, mz(z + 0.04), TMP); B('#fffaf0', 0.22, 0.28, 0.22, TMP.x, TMP.y + 0.02, TMP.z); }   /* the coffee mug of the lowest tier, on the desk beside the laptop */
      });
      if(zn.kind === 'team' || zn.kind === 'free'){
        /* the zone's name painted on the floor strip in front of the rug (decal), ink in a darker shade of the rug colour; zn.gh (ghosts) is for the hover tip */
        const hsl = {}; C(rc).getHSL(hsl); const ink = zn.kind === 'free' ? C('#8a7a66') : C().setHSL(hsl.h, Math.min(0.62, hsl.s + 0.2), 0.3);
        zn.gh = zn.kind === 'team' ? zn.ps.filter(q => q.tag).length : 0;
        zn.dw = Math.min(zn.w - 0.8, 9); zn.dx = zn.cx - zn.w / 2 + 0.4;
        const dm = decal(zn.name, zn.dw, LANE - 0.3, (closed ? ink.clone().lerp(grey, 0.5) : ink).getStyle()); dm.position.set(zn.dx + zn.dw / 2, 0.085, zn.cz + zn.d / 2 - LANE / 2); decals.push(dm);
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
    /* each shrub is four overlapping puffs in three greens laid along its row (a along the row, b across it), so a row reads as a clipped hedge, not a string of balls */
    const GR = ['#9fd49a', '#b5e0a0', '#8fcf9b', '#84c48f'], FL = ['#ffb3c7', '#fff08a', '#ffffff'], bush = (x, z, k, alongX) => {
      const r = 0.55 + hash(k) * 0.35, A = (a, b) => (alongX ? [x + a, z + b] : [x + b, z + a]);
      const puffs = [[0, 0, r, 0.8, GR[k % 3]], [r * 0.8, 0.2, r * 0.7, 0.55, GR[(k + 1) % 3]], [-r * 0.78, -0.08, r * 0.62, 0.5, GR[3]], [r * 0.15, -0.3, r * 0.55, 1.12, GR[(k + 2) % 3]]];
      puffs.forEach(([a, b, pr, py, c]) => { const [px, pz] = A(a, b); OS('bush', c, pr, px, py * r, pz, 1, 0.85, 1); });
      if(snowy){ puffs.forEach(([a, b, pr, py]) => { const [px, pz] = A(a, b); OS('snow', SNOW, pr * 0.86, px, py * r + 0.43 * pr, pz, 1, 0.42, 1); }); return; }   /* white caps hide the flowers */
      [[0.15, 0.3, r * 1.5, 0.1], [-0.3, 0.2, r * 1.35, 0.1], [0.4, -0.2, r * 1.2, 0.09], [-r * 0.7, 0.22, r * 0.95, 0.08]].forEach(([a, b, y, fr], j) => { const [px, pz] = A(a, b); OS('flower', FL[(k + j) % 3], fr, px, y, pz); });
    };
    let bk = 0;
    /* stepping stones from the open front edge to the lawn edge, between two shrubs; they go dark and glossy in the rain */
    { const xp = -FW / 2 + 4.4 * (Math.max(0, Math.round(FW / 2 / 4.4 - 0.5)) + 0.5); [0.42, 1.02, 1.62].forEach((dz, i) => W0.stones.push([xp + (i % 2 ? 0.12 : -0.08), FD / 2 + dz, i])); }
    for(let x = -FW / 2; x <= FW / 2; x += 4.4){ bush(x, FD / 2 + 1.1, bk++, true); bush(x + 1.4, -FD / 2 - 1.1, bk++, true); }
    for(let z = -FD / 2 + 2; z <= FD / 2 - 1; z += 4.4){ bush(FW / 2 + 1.1, z, bk++, false); bush(-FW / 2 - 1.1, z + 1.2, bk++, false); }
    if(xmas && srv){
      /* The world tree (a fantasy giant grown from the old Banggye-ri ginkgo) stands on the lawn just outside the back corner, so the Sprag server is at its foot. Its trunk rises past the roof line
       * and leans a little toward the room, two thick roots arch over the corner wall and come down on both sides of the kiosk, and the crown starts at height 9 so nothing comes down to the animals
       * or the server label. It casts no shadow. The kiosk gets twinkle lights, a pile of presents, mushrooms, moss and gathered fireflies. Ginkgo leaves lie on the lawn and the floor round the kiosk.
       * holFit tells fit() to keep only the trunk and the lowest crown in frame, so the upper crown may leave the top of the screen. The garden island grows deeper along its back edge and wider along its left edge. */
      const CN = 2.2, gx = -FW / 2 - CN, gz = -FD / 2 - CN, srvAt = { x: srv.x - gx, z: srv.z - gz };
      const lawnR = (nb, nl, y) => [{ x0: -FW / 2 - 5.3 - gx, x1: Math.min(FW / 2 + 1.7, gx + 12) - gx, z0: -FD / 2 - 8.2 - gz, z1: -FD / 2 - 0.4 - gz, y, n: nb }, { x0: -FW / 2 - 5.3 - gx, x1: -FW / 2 - 0.4 - gx, z0: -FD / 2 - 0.4 - gz, z1: Math.min(FD / 2 + 1.7, gz + 12) - gz, y, n: nl }];
      const srvFloor = { x0: srvAt.x - 2.4, x1: srvAt.x + 2.4, z0: srvAt.z - 1.9, z1: srvAt.z + 2.4, y: 0.03, n: 20 }, srvFall = { ...srvFloor, n: 12 };
      /* the crown roofs the back of the room, so leaves drift down from it onto the office floor and a few lie there; the strip runs along both back walls and halfway into the room */
      const rx = Math.min(FW * 0.7, 15), rz = Math.min(FD * 0.7, 15), roomA = { x0: CN + 0.4, x1: CN + rx, z0: CN + 0.4, z1: CN + 4.5, y: 0.06 }, roomB = { x0: CN + 0.4, x1: CN + 4.5, z0: CN + 4.5, z1: CN + rz, y: 0.06 }, roomC = { x0: CN + 4.5, x1: CN + rx * 0.8, z0: CN + 4.5, z1: CN + rz * 0.8, y: 0.06 };
      const roomFall = [{ ...roomA, n: 26, top: 15 }, { ...roomB, n: 26, top: 15 }, { ...roomC, n: 34, top: 15 }], roomFloor = [{ ...roomA, n: 30 }, { ...roomB, n: 30 }, { ...roomC, n: 16 }];
      OB('lawn', '#cfe8b5', FW + 7.5, 0.5, 6.5, -1.75, -0.45, -FD / 2 - 5.25); OB('soil', '#b99a73', FW + 6.9, 0.3, 6.5, -1.75, -0.85, -FD / 2 - 4.95);
      OB('soil', '#a98864', FW + 6.5, 0.45, 6.1, -1.75, -1.22, -FD / 2 - 4.95); OB('soil', '#8c7a6c', FW + 6.1, 0.4, 5.7, -1.75, -1.64, -FD / 2 - 4.95);   /* the same two layers under the grown lawn pieces */
      OB('lawn', '#cfe8b5', 3.5, 0.5, FD + 4, -FW / 2 - 3.75, -0.45, 0); OB('soil', '#b99a73', 3.5, 0.3, FD + 3.4, -FW / 2 - 3.45, -0.85, 0);
      OB('soil', '#a98864', 3.1, 0.45, FD + 3.0, -FW / 2 - 3.45, -1.22, 0); OB('soil', '#8c7a6c', 2.7, 0.4, FD + 2.6, -FW / 2 - 3.45, -1.64, 0);
      const tr = makeWorldTree(T, { carpet: lawnR(460, 110, -0.17), fall: [...lawnR(60, 14, -0.17), srvFall, ...roomFall], floor: [srvFloor, ...roomFloor], srv: srvAt, corner: CN });
      tr.position.set(gx, 0, gz); world.add(tr); hol.push(tr); holFit = { x: gx, z: gz, pts: [[3.0, 3.2], [7.4, 4.0]] };
      const pl = makePresents(T); pl.userData.pile = true; pl.scale.setScalar(0.75); pl.rotation.y = -0.35; pl.position.set(srv.x + 1.9, 0, srv.z + 1.3); world.add(pl); hol.push(pl);   /* the present pile stands in front of the kiosk */
    }
    /* potted plants: a terracotta pot with a rolled rim round dark soil, and a different plant per kind i (0 a bushy fern, 1 a tall fiddle-leaf fig, 2 a snake plant); s scales the whole plant about its foot */
    const plant = (x, z, i, s = 1) => {
      const Bs = (c, w, h, dd, ox, y, oz) => B(c, w * s, h * s, dd * s, x + ox * s, y * s, z + oz * s), Ss = (c, r, ox, y, oz, sx = 1, sy = 1, sz = 1) => Sp(c, r * s, x + ox * s, y * s, z + oz * s, sx, sy, sz);
      Bs('#d98f68', 0.6, 0.5, 0.6, 0, 0.25, 0); Bs('#c27a56', 0.74, 0.04, 0.74, 0, 0.02, 0); Bs('#5e4330', 0.58, 0.04, 0.58, 0, 0.58, 0);   /* pot, saucer, soil */
      [[0, 0.33, 0.74, 0.08], [0, -0.33, 0.74, 0.08], [0.33, 0, 0.08, 0.58], [-0.33, 0, 0.08, 0.58]].forEach(([ox, oz, sx, sz]) => Bs('#eaa983', sx, 0.14, sz, ox, 0.55, oz));
      if(i === 0){
        Ss('#8fcf9b', 0.5, 0, 0.95, 0, 1, 0.72, 1); Ss('#7fc08c', 0.36, 0.3, 1.05, -0.12); Ss('#a8dba0', 0.34, -0.28, 1.08, 0.15);
        Ss('#9fd49a', 0.3, 0.05, 1.32, -0.06); Ss('#7fc08c', 0.24, 0.22, 1.4, 0.2); Ss('#b9e4ad', 0.2, -0.1, 1.55, 0.05);
      } else if(i === 1){
        Bs('#7a5a3a', 0.06, 1.35, 0.06, 0, 1.25, 0);
        [[0.2, 1.15, 0.06, 0.27, '#6fb67d'], [-0.2, 1.42, -0.08, 0.3, '#8fcf9b'], [0.12, 1.7, 0.1, 0.32, '#7cc48a'], [-0.1, 1.96, -0.03, 0.27, '#a8dba0'], [0.06, 2.2, 0.02, 0.18, '#9fd49a']]
          .forEach(([ox, y, oz, r, c]) => Ss(c, r, ox, y, oz, 1, 0.72, 0.85));
      } else {
        [[0, 0, 0.82, '#5f9e6e'], [0.12, 0.06, 0.66, '#79b77f'], [-0.12, 0.04, 0.72, '#6aa874'], [0.05, -0.12, 0.58, '#a9c96a'], [-0.06, 0.14, 0.52, '#79b77f'], [0.16, -0.08, 0.46, '#5f9e6e'], [-0.15, -0.1, 0.62, '#8cbf6e']]
          .forEach(([ox, oz, h, c], j) => Ss(c, 1, ox, 0.58 + h * 0.45, oz, j % 2 ? 0.05 : 0.085, h * 0.5, j % 2 ? 0.085 : 0.05));
      }
    };
    [[-FW / 2 + 1, -FD / 2 + 1], [FW / 2 - 1, -FD / 2 + 1], [-FW / 2 + 1, FD / 2 - 1]].forEach(([x, z], i) => plant(x, z, i));   /* the three corners */
    { /* lounge: the biggest open floor left between the zones, the lamps, the corner plants, the shelf strips and the present pile gets a rug, a sofa, a coffee table, a big plant and a standing lamp (no randomness: the same office always lays out the same) */
      const CS = 0.25, X0 = -FW / 2 + 0.8, Z0 = -FD / 2 + 0.8, nx = Math.floor((FW - 1.6) / CS), nz = Math.floor((FD - 1.6) / CS), occ = new Uint8Array(Math.max(0, nx * nz));
      const markR = (x0, z0, x1, z1) => { for(let k = Math.max(0, Math.floor((z0 - Z0) / CS)); k < Math.min(nz, Math.ceil((z1 - Z0) / CS)); k++) for(let i = Math.max(0, Math.floor((x0 - X0) / CS)); i < Math.min(nx, Math.ceil((x1 - X0) / CS)); i++) occ[k * nx + i] = 1; };
      const markC = (cx, cz, r) => { for(let k = Math.max(0, Math.floor((cz - r - Z0) / CS)); k < Math.min(nz, Math.ceil((cz + r - Z0) / CS)); k++) for(let i = Math.max(0, Math.floor((cx - r - X0) / CS)); i < Math.min(nx, Math.ceil((cx + r - X0) / CS)); i++){
        const ax = X0 + i * CS, az = Z0 + k * CS; if(Math.hypot(cx - Math.min(Math.max(cx, ax), ax + CS), cz - Math.min(Math.max(cz, az), az + CS)) < r) occ[k * nx + i] = 1; } };
      /* every maximal empty rectangle (histogram stack, row by row) that passes ok(w, d); the largest wins, ties go to the smaller z then x */
      const best = ok => {
        let top = null; const h = new Int32Array(nx);
        for(let k = 0; k < nz; k++){
          for(let i = 0; i < nx; i++) h[i] = occ[k * nx + i] ? 0 : h[i] + 1;
          const st = [];
          for(let i = 0; i <= nx; i++){
            const cur = i < nx ? h[i] : 0; let start = i;
            while(st.length && st[st.length - 1][1] >= cur){
              const [s0, hh] = st.pop(), w = (i - s0) * CS, d = hh * CS; start = s0;
              if(hh && ok(w, d)){ const r = { x0: X0 + s0 * CS, z0: Z0 + (k - hh + 1) * CS, w, d, a: w * d }; if(!top || r.a > top.a + 1e-9 || (Math.abs(r.a - top.a) < 1e-9 && (r.z0 < top.z0 - 1e-9 || (Math.abs(r.z0 - top.z0) < 1e-9 && r.x0 < top.x0)))) top = r; }
            }
            st.push([start, cur]);
          }
        }
        return top;
      };
      zones.forEach(zn => markR(zn.cx - zn.w / 2 - 1.2, zn.cz - zn.d / 2 - 1.2, zn.cx + zn.w / 2 + 1.2, zn.cz + zn.d / 2 + 1.2));   /* 1.2 round every zone, so the open floor found below is the inner area */
      W0.lamps.forEach(l => markC(l.x, l.z, 0.8));
      [[-FW / 2 + 1, -FD / 2 + 1], [FW / 2 - 1, -FD / 2 + 1], [-FW / 2 + 1, FD / 2 - 1]].forEach(([x, z]) => markC(x, z, 1.0));
      markR(X0 - 1, Z0 - 1, FW / 2, -FD / 2 + 1.0); markR(X0 - 1, Z0 - 1, -FW / 2 + 1.0, FD / 2);   /* the strips along the back and left walls (shelves, sills) */
      if(xmas && srv) markC(srv.x + 1.9, srv.z + 1.3, 1.6);
      const R1 = best((w, d) => w >= 4.2 && d >= 3.4);
      if(R1){
        const cx0 = R1.x0 + R1.w / 2, cz0 = R1.z0 + R1.d / 2, rw = Math.min(8, Math.max(4.2, R1.w * 0.7)), rd = Math.min(6, Math.max(3.4, R1.d * 0.7)), lx = cx0, lz = cz0;   /* the rug: 70% of the open floor, 4.2 x 3.4 to 8 x 6, in its middle */
        const rg = { x0: lx - rw / 2, x1: lx + rw / 2, z0: lz - rd / 2, z1: lz + rd / 2 }, big = rw >= 6 && rd >= 4.5, stn = rg.x1 + 0.75 <= R1.x0 + R1.w;
        const obs = (x0, z0, x1, z1, hh) => { loungeObs.rects.push([x0, z0, x1, z1]); loungeObs.occ.push([x0, z0, x1, z1, hh]); };
        const BY = (yaw, ox, oz) => (c, w, h, dd, u, y, v) => B(c, w, h, dd, ox + u * Math.cos(yaw) + v * Math.sin(yaw), y, oz - u * Math.sin(yaw) + v * Math.cos(yaw), yaw);   /* a box placed in a frame turned by yaw about its centre (local -z is the front) */
        /* rug: two overlapping boxes cut the corners, a woven border band inside */
        B('#e9dcc8', rw, 0.04, rd - 0.5, lx, 0.05, lz); B('#e9dcc8', rw - 0.5, 0.039, rd, lx, 0.0495, lz);
        [[rw - 0.6, 0.035, 0, -(rd / 2 - 0.3)], [rw - 0.6, 0.035, 0, rd / 2 - 0.3], [0.035, rd - 0.6, -(rw / 2 - 0.3), 0], [0.035, rd - 0.6, rw / 2 - 0.3, 0]].forEach(([w, d, ox, oz]) => B('#cdb899', w, 0.004, d, lx + ox, 0.072, lz + oz));
        /* three-seat sofa on the rug's back edge, facing the camera */
        const sx = lx, sz = lz - rd / 2 + 0.65;
        B('#7aa3b6', 2.3, 0.3, 0.9, sx, 0.24, sz); B('#7aa3b6', 2.3, 0.52, 0.22, sx, 0.65, sz - 0.34); B('#7aa3b6', 0.22, 0.52, 0.9, sx - 1.04, 0.6, sz); B('#7aa3b6', 0.22, 0.52, 0.9, sx + 1.04, 0.6, sz);
        [-0.62, 0, 0.62].forEach(o => { B('#8fb8c9', 0.6, 0.14, 0.62, sx + o, 0.46, sz + 0.12); B('#9cc3d3', 0.58, 0.4, 0.14, sx + o, 0.66, sz - 0.18); });
        B('#f0c060', 0.34, 0.34, 0.12, sx - 0.78, 0.66, sz + 0.0); B('#e98a7a', 0.34, 0.34, 0.12, sx + 0.8, 0.66, sz + 0.0);
        W0.ao.push([sx, sz, 2.9, 1.5]); obs(sx - 1.2, sz - 0.5, sx + 1.2, sz + 0.5, 0.95);
        /* two armchairs at the front corners of the rug, turned about 30 degrees in toward the sofa */
        const chz = lz + rd / 2 - 1.0, chx = Math.min(2.4, Math.max(1.3, rw * 0.28));
        [[-1, -Math.PI / 6], [1, Math.PI / 6]].forEach(([sg, yaw]) => {
          const cx = lx + sg * chx, P = BY(yaw, cx, chz);
          P('#d99a78', 0.9, 0.3, 0.85, 0, 0.24, 0); P('#e8b794', 0.7, 0.14, 0.62, 0, 0.46, -0.08); P('#d99a78', 0.9, 0.52, 0.2, 0, 0.65, 0.33); P('#e8b794', 0.62, 0.38, 0.12, 0, 0.66, 0.2);
          P('#d99a78', 0.18, 0.5, 0.85, -0.36, 0.6, 0); P('#d99a78', 0.18, 0.5, 0.85, 0.36, 0.6, 0);
          W0.ao.push([cx, chz, 1.3, 1.3]); obs(cx - 0.65, chz - 0.65, cx + 0.65, chz + 0.65, 0.95);
        });
        /* low coffee table in the middle, with a mug and a book */
        const tx = lx, tz = (sz + 0.45 + chz) / 2;
        B('#d9b98c', 1.2, 0.07, 0.64, tx, 0.38, tz); [[-0.52, -0.25], [0.52, -0.25], [-0.52, 0.25], [0.52, 0.25]].forEach(([ox, oz]) => B('#b98a58', 0.07, 0.32, 0.07, tx + ox, 0.22, tz + oz));
        B('#fffaf0', 0.09, 0.1, 0.09, tx - 0.3, 0.465, tz - 0.08); B('#e46f5f', 0.28, 0.04, 0.2, tx + 0.22, 0.435, tz + 0.06); B('#fffaf0', 0.25, 0.03, 0.19, tx + 0.23, 0.44, tz + 0.07);
        W0.ao.push([tx, tz, 1.6, 1.1]); obs(tx - 0.65, tz - 0.35, tx + 0.65, tz + 0.35, 0.5);
        /* two big plants (the corner plant at 1.3x) in the back corners of the rug, and a standing lamp (decoration only: it is not one of W0.lamps, so it does not light at night) */
        const px = Math.max(rw / 2 - 0.55, 1.65), pz = lz - rd / 2 + 0.55, pk = Math.floor(hash('lounge-plant') * 3);
        [[-1, pk], [1, (pk + 1) % 3]].forEach(([sg, k]) => { plant(lx + sg * px, pz, k, 1.3); W0.ao.push([lx + sg * px, pz, 1.2, 1.2]); obs(lx + sg * px - 0.45, pz - 0.45, lx + sg * px + 0.45, pz + 0.45, 2.6); });
        const lp = big ? [lx - 1.75, sz] : [lx + px, pz + 0.85];
        B('#8a7a66', 0.34, 0.05, 0.34, lp[0], 0.055, lp[1]); B('#8a7a66', 0.05, 1.5, 0.05, lp[0], 0.8, lp[1]); B('#fff1cf', 0.46, 0.32, 0.46, lp[0], 1.7, lp[1]); B('#f6e3b5', 0.3, 0.04, 0.3, lp[0], 1.88, lp[1]);
        W0.ao.push([lp[0], lp[1], 0.7, 0.7]); obs(lp[0] - 0.25, lp[1] - 0.25, lp[0] + 0.25, lp[1] + 0.25, 1.95);
        if(big){   /* a big rug (6 x 4.5 or more) also gets a side table with a small plant next to the sofa */
          const ax = lx + 1.7;
          B('#d9b98c', 0.5, 0.05, 0.5, ax, 0.52, sz); [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].forEach(([ox, oz]) => B('#b98a58', 0.05, 0.46, 0.05, ax + ox, 0.275, sz + oz));
          B('#d98f68', 0.2, 0.16, 0.2, ax, 0.62, sz); Sp('#8fcf9b', 0.15, ax, 0.8, sz, 1, 0.85, 1); Sp('#7fc08c', 0.1, ax + 0.07, 0.88, sz - 0.03);
          W0.ao.push([ax, sz, 0.8, 0.8]); obs(ax - 0.3, sz - 0.3, ax + 0.3, sz + 0.3, 1.0);
        }
        /* the coffee station stands just outside the rug's right edge, mid-depth, its front toward -x so it reads as part of the group (left out when there is no room) */
        if(stn){
          const kx = rg.x1 + 0.35, kz = lz;
          B('#c99a66', 0.5, 0.8, 1.8, kx, 0.43, kz); B('#ddb07c', 0.56, 0.04, 1.86, kx, 0.85, kz);
          [-0.45, 0, 0.45].forEach(o => B('#b98a58', 0.01, 0.6, 0.02, kx - 0.255, 0.43, kz + o));
          B('#5f5a6e', 0.32, 0.38, 0.4, kx + 0.05, 1.06, kz - 0.5); B('#e46f5f', 0.28, 0.05, 0.36, kx + 0.05, 1.275, kz - 0.5); B('#fffaf0', 0.1, 0.12, 0.1, kx - 0.05, 0.93, kz + 0.2); B('#fffaf0', 0.1, 0.12, 0.1, kx - 0.05, 0.93, kz + 0.45);
          W0.ao.push([kx, kz, 1.0, 2.2]); obs(kx - 0.3, kz - 0.95, kx + 0.3, kz + 0.95, 1.4);
        }
        /* a screen of three pots along a zone-side edge of the open floor where 3 x 3 or more is left beside the lounge: on a line 0.9 off the zone, 1.6 apart (two low pots round a big one) */
        const rb = { x0: rg.x0, x1: rg.x1 + (stn ? 0.75 : 0), z0: rg.z0, z1: rg.z1 }, E = R1.x0 + R1.w, F = R1.z0 + R1.d;
        const blocked = (x, z, r) => zones.some(zn => x > zn.cx - zn.w / 2 - r - 0.3 && x < zn.cx + zn.w / 2 + r + 0.3 && z > zn.cz - zn.d / 2 - r - 0.3 && z < zn.cz + zn.d / 2 + r + 0.3)
          || W0.lamps.some(l => Math.hypot(l.x - x, l.z - z) < r + 0.5) || [[-FW / 2 + 1, -FD / 2 + 1], [FW / 2 - 1, -FD / 2 + 1], [-FW / 2 + 1, FD / 2 - 1]].some(([a, b]) => Math.hypot(a - x, b - z) < r + 0.6)
          || x - r < -FW / 2 + 1.0 || z - r < -FD / 2 + 1.0 || x + r > FW / 2 - 0.8 || z + r > FD / 2 - 0.8 || (xmas && srv && Math.hypot(srv.x + 1.9 - x, srv.z + 1.3 - z) < r + 0.8)
          || loungeObs.rects.some(([a, b, c, d]) => x > a - r - 0.2 && x < c + r + 0.2 && z > b - r - 0.2 && z < d + r + 0.2);
        [['x', -1, rb.x0 - R1.x0, R1.d, R1.z0, F, zn => zn.cx + zn.w / 2, R1.x0 - 1.2], ['x', 1, E - rb.x1, R1.d, R1.z0, F, zn => zn.cx - zn.w / 2, E + 1.2],
          ['z', -1, rb.z0 - R1.z0, R1.w, R1.x0, E, zn => zn.cz + zn.d / 2, R1.z0 - 1.2], ['z', 1, F - rb.z1, R1.w, R1.x0, E, zn => zn.cz - zn.d / 2, F + 1.2]].forEach(([ax, sg, thick, len, a0, a1, edgeOf, want]) => {
          if(thick < 3 || len < 3) return;
          let pick = null;
          zones.forEach(zn => { if(Math.abs(edgeOf(zn) - want) > 0.4) return; const z0 = ax === 'x' ? zn.cz - zn.d / 2 : zn.cx - zn.w / 2, z1 = ax === 'x' ? zn.cz + zn.d / 2 : zn.cx + zn.w / 2, lo = Math.max(a0, z0), hi = Math.min(a1, z1); if(hi - lo >= 4 && (!pick || hi - lo > pick.hi - pick.lo)) pick = { lo, hi, line: edgeOf(zn) - sg * 0.9 }; });
          if(!pick) return;
          const m = (pick.lo + pick.hi) / 2, line = pick.line;
          [[-1.6, 0], [0, 1], [1.6, 0]].forEach(([o, bigOne], j) => {
            const x = ax === 'x' ? line : m + o, z = ax === 'x' ? m + o : line, s = bigOne ? 1.3 : 0.85, r = 0.4 * s;
            if(blocked(x, z, r)) return;
            plant(x, z, bigOne ? Math.floor(hash('row' + ax + sg) * 3) : j === 0 ? 0 : 2, s); W0.ao.push([x, z, 1.1 * s, 1.1 * s]); obs(x - r, z - r, x + r, z + r, bigOne ? 2.6 : 2.0);
          });
        });
      }
    }
    { /* low bookshelves against the back and left walls, in the gaps between windows clear of the server corner and the floor lamps; under the year-end wreaths they stay below the ring */
      const BK = ['#d9604f', '#4f86c6', '#e8b04a', '#5aa77a', '#8a6fc4', '#f1ece0', '#c45a7a', '#3f6f8a', '#e98a5a'], W = 1.9, Hh = 0.62, D = 0.42, v0 = 0.06;
      const free = (au, alongX) => (alongX ? !(srv && Math.abs(au - srv.x) < 4.6) && !W0.lamps.some(l => Math.abs(l.x - au) < 1.3 && l.z < -FD / 2 + 1.0)
        : !(srv && Math.abs(au - srv.z) < 4.4) && !W0.lamps.some(l => Math.abs(l.z - au) < 1.3 && l.x < -FW / 2 + 1.0));
      const shelf = (au, alongX, seed) => {
        const P = (c, u, y, v, su, sy, sv) => (alongX ? B(c, su, sy, sv, au + u, y, -FD / 2 + 0.15 + v) : B(c, sv, sy, su, -FW / 2 + 0.15 + v, y, au + u)), vc = v0 + D / 2;
        P('#8a6448', 0, Hh / 2, v0 + 0.02, W, Hh, 0.04); P('#c99a66', -W / 2 + 0.025, Hh / 2, vc, 0.05, Hh, D); P('#c99a66', W / 2 - 0.025, Hh / 2, vc, 0.05, Hh, D); P('#c99a66', 0, Hh / 2, vc, 0.04, Hh - 0.06, D);
        P('#b98a58', 0, 0.03, vc, W, 0.06, D); P('#c99a66', 0, 0.33, vc, W - 0.1, 0.035, D); P('#ddb07c', 0, Hh + 0.02, vc + 0.01, W + 0.06, 0.04, D + 0.04);
        [[0.06, 0.24], [0.3475, 0.25]].forEach(([yb, hm], lv) => {
          let u = -W / 2 + 0.06, n = 0;
          while(u < W / 2 - 0.1 && n < 60){
            const q = seed + ':' + lv + ':' + n++, r = hash(q), w = 0.045 + r * 0.05, h = hm * (0.68 + 0.32 * hash(q + 'h'));
            if(r < 0.1){ u += 0.1; continue; }   /* a gap now and then */
            if(u + w > W / 2 - 0.055) break;
            if(u + w > -0.025 && u < 0.025){ u = 0.025; continue; }   /* the middle divider */
            P(BK[Math.floor(hash(q + 'c') * BK.length)], u + w / 2, yb + h / 2, 0.27, w - 0.006, h, 0.32); u += w;
          }
        });
        P('#e8a77f', 0.76, Hh + 0.11, vc, 0.16, 0.14, 0.16); Sp('#8fcf9b', 0.12, ...(alongX ? [au + 0.76, Hh + 0.24, -FD / 2 + 0.15 + vc] : [-FW / 2 + 0.15 + vc, Hh + 0.24, au + 0.76]), 1, 0.85, 1);   /* a small plant and a lying stack on top */
        P(BK[Math.floor(hash(seed + 'a') * BK.length)], -0.74, Hh + 0.065, vc, 0.3, 0.05, 0.22); P(BK[Math.floor(hash(seed + 'b') * BK.length)], -0.72, Hh + 0.11, vc + 0.01, 0.26, 0.04, 0.2);
      };
      for(let x = -FW / 2 + 3.5; x + 6.5 < FW / 2 - 1.5; x += 6.5){ const u = x + 3.25; if(free(u, true)) shelf(u, true, 'bz' + u.toFixed(1)); }
      for(let z = -FD / 2 + 3.5; z + 6.5 < FD / 2 - 1.5; z += 6.5){ const u = z + 3.25; if(free(u, false)) shelf(u, false, 'bx' + u.toFixed(1)); }
      /* pictures and a clock on the wall between the windows: boxes only, tagged to their wall (ws, wd) so updateWalls() hides them with it instead of leaving them hanging in the air; the gap's own middle at y 1.3 stays clear for the year-end wreath */
      const FR = ['#fffaf0', '#c99a66', '#8a6448'], AC = ['#f2a48b', '#8fb8c9', '#f3cd7a', '#9ccf9f', '#b7a2ee', '#e98a7a'];
      const W2 = (au, alongX) => (c, u, y, v, su, sy, sv) => (alongX ? B(c, su, sy, sv, au + u, y, -FD / 2 + 0.15 + v) : B(c, sv, sy, su, -FW / 2 + 0.15 + v, y, au + u));   /* v runs from the wall's inner face into the room */
      const picture = (au, alongX, u, seed) => {
        const P = W2(au, alongX), y = 1.5, a = AC[Math.floor(hash(seed + 'a') * AC.length)], b = AC[(Math.floor(hash(seed + 'b') * (AC.length - 1)) + 1 + AC.indexOf(a)) % AC.length], kind = Math.floor(hash(seed + 'k') * 3);
        P(FR[Math.floor(hash(seed + 'f') * FR.length)], u, y, 0.02, 1.0, 0.78, 0.04); P('#fffaf0', u, y, 0.045, 0.84, 0.62, 0.01);
        if(kind === 0){ P('#cfe6f4', u, y, 0.055, 0.7, 0.48, 0.01); P(a, u - 0.16, y - 0.16, 0.065, 0.48, 0.16, 0.01); P(b, u + 0.16, y - 0.11, 0.065, 0.36, 0.26, 0.01); P('#fff2b8', u + 0.16, y + 0.13, 0.065, 0.13, 0.13, 0.01); }   /* hills and a sun */
        else if(kind === 1){ P(a, u - 0.22, y, 0.055, 0.22, 0.48, 0.01); P(b, u, y - 0.06, 0.055, 0.22, 0.36, 0.01); P('#f3cd7a', u + 0.22, y + 0.03, 0.055, 0.22, 0.42, 0.01); }   /* three bars */
        else { P(a, u, y, 0.055, 0.7, 0.48, 0.01); P(b, u, y, 0.065, 0.4, 0.32, 0.01); P('#fffaf0', u, y, 0.075, 0.16, 0.16, 0.01); }   /* nested blocks */
      };
      const clock = (au, alongX) => {   /* 0.6 across: an octagon of three overlapping boxes, a face, four ticks, two hands */
        const P = W2(au, alongX), y = 1.82;
        [[0.68, 0.46], [0.46, 0.68], [0.6, 0.6]].forEach(([w, h]) => P('#8a6448', 0, y, 0.03, w, h, 0.06));
        [[0.56, 0.34], [0.34, 0.56], [0.5, 0.5]].forEach(([w, h]) => P('#fffaf0', 0, y, 0.065, w, h, 0.02));
        [[0, 0.22], [0, -0.22], [0.22, 0], [-0.22, 0]].forEach(([ou, oy]) => P('#8a7a66', ou, y + oy, 0.08, ou ? 0.05 : 0.035, ou ? 0.035 : 0.05, 0.01));
        P('#3d3a4a', 0, y + 0.1, 0.09, 0.04, 0.2, 0.012); P('#3d3a4a', 0.08, y, 0.09, 0.16, 0.04, 0.012); P('#e46f5f', 0, y, 0.1, 0.06, 0.06, 0.012);
      };
      const gaps = [], gapsX = [];   /* gap middles that have room for decoration: same test as the shelves */
      for(let x = -FW / 2 + 3.5; x + 6.5 < FW / 2 - 1.5; x += 6.5){ const u = x + 3.25; if(free(u, true)) gaps.push(u); }
      for(let z = -FD / 2 + 3.5; z + 6.5 < FD / 2 - 1.5; z += 6.5){ const u = z + 3.25; if(free(u, false)) gapsX.push(u); }
      ws = 'z'; wd = true; gaps.forEach(u => [-1.15, 1.15].forEach(du => picture(u, true, du, 'pz' + u.toFixed(1) + ':' + du)));
      ws = 'x'; gapsX.forEach(u => [-1.15, 1.15].forEach(du => picture(u, false, du, 'px' + u.toFixed(1) + ':' + du)));
      if(gapsX.length){ ws = 'x'; clock(gapsX[0], false); } else if(gaps.length){ ws = 'z'; clock(gaps[0], true); }
      ws = null; wd = false;
    }
    people.forEach(o => {   /* the nearest desk in the same row: whom to glance at */
      let best = null, bd = 4; people.forEach(q => { if(q !== o && Math.abs(q.z - o.z) < 0.5 && Math.abs(q.x - o.x) < bd){ bd = Math.abs(q.x - o.x); best = q; } });
      o.nb = best ? Math.sign(best.x - o.x) : hash(o.p.id + 'nb') < 0.5 ? -1 : 1;
    });
    buildPets(W0.lamps);
    if(!closed) people.forEach(o => placeDesk(o));
    const sm = sets.sm = mk(sets.box, std({}), sb.length); tintZ = null; sets.sb = sb; sb.forEach((b, i) => { setM(sm, i, b[4], b[5], b[6], 0, b[7] || 0, b[1], b[2], b[3]); sm.setColorAt(i, col(b[0])); });
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
    {   /* the lid logos: one instanced mesh per kind (apple, panes, dot), coloured and flickered per laptop in step() */
      const G = { mac: [appleShapes, 0.16], win: [paneShapes, 0.16], other: [dotShape, 0.1] }, cnt = { mac: 0, win: 0, other: 0 };
      screens.forEach(s => { s[6] = cnt[s[5]]++; });
      scr = { ms: {}, list: screens };
      Object.keys(G).forEach(k => { scr.ms[k] = mk(track(new T.ShapeGeometry(G[k][0](T), 24)), bas({}), cnt[k], false); });
      screens.forEach(s => { const m = scr.ms[s[5]], sc = G[s[5]][1]; setM(m, s[6], s[0], s[1], s[2], 0, 0, sc, sc, 1); m.setColorAt(s[6], C('#000000')); });
      Object.values(scr.ms).forEach(m => { m.instanceMatrix.needsUpdate = true; });
    }
    const sl = mk(sets.sph, bas({}), srvLights.length, false); srvLights.forEach((l, i) => { setM(sl, i, l.x, l.y, l.z, 0, 0, 0.1, 0.1, 0.04); sl.setColorAt(i, l.c); }); sl.instanceMatrix.needsUpdate = true; srv.lights = sl;
    /* sparkles around the power users: three for the two rarest species, two for the next two, one for the rest; four for the crown */
    sparks = [];
    solids.filter(o => o.p.tier === 'power').forEach(o => { const gi = gradeIndex(o.gk), n = o.p.crown ? 4 : gi < 2 ? 3 : gi < 4 ? 2 : 1; for(let k = 0; k < n; k++) sparks.push({ o, k }); });
    sets.spk = mk(sets.sph, bas({}), sparks.length, false); sparks.forEach((q, i) => sets.spk.setColorAt(i, C(q.k === 3 ? '#ffd36b' : '#fff0a0'))); if(sparks.length) sets.spk.instanceColor.needsUpdate = true;

    /* helper bots: round pastel bodies with an antenna and a soft glow, one orbiting each owner, flying to the server now and then */
    const fl = [];
    if(!closed) solids.forEach(o => (o.p.bots || []).forEach((fam, j) => fl.push({ o, fam, j })));
    const bm = mk(sets.sph, bas({}), fl.length, false), gl = mk(sets.sph, bas({ transparent: true, opacity: 0.12, depthWrite: false }), fl.length, false), an = mk(sets.box, bas({}), fl.length, false), tp = mk(sets.sph, bas({}), fl.length, false);
    fl.forEach((b, i) => {
      const c = C(b.fam === 'any' ? '#c4b5fd' : FAMC[b.fam]);
      bm.setColorAt(i, c); gl.setColorAt(i, c); an.setColorAt(i, C('#ffffff')); tp.setColorAt(i, C('#ffffff'));
      bots.push({ i, o: b.o, a0: hash(b.o.p.id + b.j) * 6.28, rad: 1.85 + b.j * 0.25, sp: (b.o.p.tier === 'power' ? 0.7 : 0.45) * (b.j % 2 ? -1 : 1), hy: 3.95 + b.j * 0.22, st: 0,   /* well above the heads and wide of the seat, so a bot never sits on its owner's face */ t: 0, next: 1.5 + hash(b.o.p.id + 'n' + b.j) * 9, pos: v3(), p0: v3(), col: c.clone().multiplyScalar(0.8) });
    });
    /* a face for each bot: a dark visor with two glowing eyes, and a small ear pod on each side in a deeper shade */
    const vz = mk(sets.sph, bas({ color: '#2b2740' }), fl.length, false), ey = mk(sets.sph, bas({ color: '#e8fbff' }), fl.length * 2, false), er = mk(sets.sph, bas({}), fl.length * 2, false);
    fl.forEach((b, i) => { const c = bots[bots.length - fl.length + i].col; er.setColorAt(2 * i, c); er.setColorAt(2 * i + 1, c); });
    if(fl.length){ [bm, gl, an, tp, er].forEach(m => { m.instanceColor.needsUpdate = true; }); }
    Object.assign(sets, { bm, gl, an, tp, vz, ey, er });
    for(let i = 0; i < 6 && bots.length; i++){
      const g = track(new T.BufferGeometry().setFromPoints(Array.from({ length: 25 }, () => v3())));
      const ln = track(new T.Line(g, track(new T.LineDashedMaterial({ color: 0xffffff, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0 })))); ln.frustumCulled = false; ln.visible = false; world.add(ln); trails.push({ ln, busy: false });
    }

    /* HTML anchors: server label, "+N more", suspended sign. Ghosts get no pill: the faded figure says it, the hover tip and drawer say why. */
    if(srv){
      const b = label('of-btn srv', d.server.label, 'button'); b.title = d.server.label; b.addEventListener('click', () => !opts.readOnly && opts.onServer && opts.onServer());
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
    builtKey = keyOf(d);
    step(0); request();
  }
  /* The same room with new figures: swap each person's data in place and repaint the text (HUD, legend, drawer, card, tooltip). Nothing is cleared, so the animals,
   * the pets' places, the fur and the sprites stay as they are. A person that cannot be matched by id means the key was wrong, so the room is rebuilt. */
  function soft(d){
    const byId = new Map((d.people || []).map(q => [q.id, q])), next = people.map(o => byId.get(o.p.id));
    if(next.some(q => !q)){ build(d); return; }
    cur = d;
    people.forEach((o, i) => { const keep = shop && sel === o ? o.p.gear : null; o.p = next[i]; if(keep) o.p.gear = keep; });   /* an unsaved gear preview in the open shop stays on the desk */
    paintChrome(d); syncFs();
    if(!shop){   /* an open shop holds a draft, so the drawer is left alone while it is up */
      if(sel) rerender();   /* the drawer's own scroll position and focus come back after the repaint */
      else if(bookOpen && chrome.isOpen() && d.book){ const bd = chrome.el.querySelector('.bd'), top = bd ? bd.scrollTop : 0; renderBook(); const bd2 = chrome.el.querySelector('.bd'); if(bd2) bd2.scrollTop = top; }
    }
    if(sel && pr && pr.on){ const tilt = pr.el.classList.contains('tilt'); pcFill(sel); if(tilt) pr.el.classList.add('tilt'); }   /* only the card's text: the model and the baked image stay */
    if(!ptrAt){ hover = null; elTip.hidden = true; }   /* with a pointer over the room hoverRefresh() redraws the tooltip from the new tip within 0.15 s */
    request();
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
      LP.forEach((l, i) => { setM(W0.lampM, i, l.x, 2.52, l.z, 0, 0, 0.3, 0.24, 0.3); setM(W0.haloM, i, l.x, 2.52, l.z, 0, 0, 0.42, 0.42, 0.42); setM(W0.poolM, i, l.cx, 0.1, l.cz, 0, 0, l.r * 2.2, 1, l.r * 2.2); });
    }
    if(W0.ao.length){   /* soft contact shadows: one instanced decal per desk and chair, so furniture sits on the floor even where the sun's shadow map is coarse */
      const A = W0.ao, m = mk(sets.disc, bas({ color: '#3a2a20', map: sets.soft, transparent: true, opacity: cur.closed ? 0.24 : 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), A.length, false);
      A.forEach(([x, z, sx, sz], i) => setM(m, i, x, 0.075, z, 0, 0, sx, 1, sz)); m.renderOrder = 1; W0.aoM = m;
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
    const n = envN = P.n; castFxNight(n); const dayK = 1 - n, ovc = clampN((wx.cloud - 0.15) / 0.85, 0, 1), lamp = closed ? 0 : P.lamp;
    /* sky and sun: dimmer under cloud and storm, the hemisphere never drops below the floor that keeps the faces readable */
    hemi.color.copy(P.hs); hemi.groundColor.copy(P.hg); sun.color.copy(P.sc);
    let hi = P.hi * (1 - 0.1 * ovc), si = P.si * (1 - 0.5 * ovc - (st === 'storm' ? 0.15 : 0));
    if(closed){ hemi.color.lerp(C('#e6e7ec'), 0.7); hemi.groundColor.lerp(C('#d2d3da'), 0.7); sun.color.lerp(C('#e8e8ee'), 0.7); hi *= 0.92; si *= 0.53; }
    baseHemi = hemi.intensity = Math.max(0.85, hi); sun.intensity = si; if(rim) rim.intensity = 0.5 * (1 - 0.4 * (P.n || 0)) * (closed ? 0.6 : 1); sun.position.set(P.sp[0], P.sp[1], P.sp[2]).normalize().multiplyScalar(w.R);
    lamps.forEach((L, i) => { const q = w.lit[i]; L.intensity = q ? lamp * LAMP_I : 0; if(q) L.position.set(q.cx, 3.4, q.cz); });
    if(w.lampM){
      w.lampM.material.color.set('#f1e6d0').lerp(C('#ffd98c'), lamp).multiplyScalar(1 - 0.55 * n * (1 - lamp));
      w.haloM.material.opacity = 0.18 * lamp; w.poolM.material.opacity = 0.3 * lamp; w.haloM.visible = w.poolM.visible = lamp > 0.02;
    }
    /* backdrop, stars and haze */
    const dull = clampN((wx.cloud - 0.15) * 0.95 + (fog ? 0.2 : 0), 0, 1), gr = c => { const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; return c.clone().lerp(new T.Color(l * 0.9, l * 0.93, l), dull * (0.35 + 0.65 * dayK)).multiplyScalar(1 - 0.1 * dull * dayK); };
    const dark = st === 'storm' ? 0.76 : wet ? 0.9 : 1, s0 = gr(P.c0).multiplyScalar(dark), s1 = gr(P.c1).multiplyScalar(dark);
    stage.style.background = `#${s0.getHexString()}`;   /* a flat sky behind the island: the site uses no gradients */
    stage.classList.toggle('sk-night', n > 0.55); renderChip(); if(post) post.setNight(n);
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
    /* painted floor text is unlit, so they dim with the room; helper bots glow stronger at night */
    const dk = 1 - 0.42 * n * (1 - 0.35 * lamp);
    decals.forEach(m => { m.material.color.setScalar(dk); m.children.forEach(c => c.material && c.material.color.setScalar(dk)); });
    if(sets.gl) sets.gl.material.opacity = 0.22 + 0.3 * n;
    sprTint = nightTint(n, lamp, ovc); if(sprKit) sprKit.setTint(sprTint);   /* sprites are unlit: the night and the lamps reach them as a colour factor */
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
  function headPt(o, out){   /* just over the person's head: on the desk when it is posing, otherwise over the chair */
    return o.pose ? out.set(o.x + POSE_X, POSE_Y + 2.05, o.z + POSE_Z) : out.set(o.x, castOn ? 2.45 : 2.1, o.z + 0.3);
  }
  function orbit(b, out){
    const a = b.a0 + time * b.sp;
    const up = b.o === sel ? 1.9 : 0, wide = b.o === sel ? 1.5 : 1;   /* the picked one's bots rise and widen, clear of its face */
    return out.set(b.o.x + Math.cos(a) * b.rad * wide, b.hy + up + Math.sin(time * 2 + b.a0) * 0.12, b.o.z + 0.1 + Math.sin(a) * b.rad * 0.8 * wide);
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
      wallIdx[k].forEach(i => { const j = i < 0 ? ~i : i, b = sets.sb[j]; if(i < 0 && want[k]) setM(sets.sm, j, b[4], b[5], b[6], 0, 0, 0.0001, 0.0001, 0.0001); else setM(sets.sm, j, b[4], b[5], b[6], 0, 0, b[1], want[k] ? 0.001 : b[2], b[3]); }); sets.sm.instanceMatrix.needsUpdate = true; });
    if(holWall) holWall.visible = !wallHid.z;
  }
  /* The cast: one sculpted glTF character per species (site/assets/scene/cast/<grade>.glb, made in Blender, Draco-compressed). The primitive
     figures stay on screen until every model has loaded and come back if any fails, so the office never shows an empty chair. */
  let castOn = false, castGen = 0, castLoad = null; const CAST_SC = 1.6, POSE_X = 0.72, POSE_Z = 1.15, POSE_Y = 1.06;   /* the picked one jumps up onto its own desk, which is now in front of the seat; it stands beside the laptop (POSE_X to the right of the seat) so the lid logo stays visible */   /* castGen: a rebuild (weather, range, data) while models load must not let the older build add its set too */
  const castCache = {};
  async function placeCast(solids, ghosts){
    const gen = ++castGen; castOn = false;
    const all = solids.concat(ghosts); if(!all.length) return;
    try{
      const manP = sprOn ? spriteManifest() : Promise.resolve(null);   /* started now, read after the glbs are in: the sprites never delay the models */
      castLoad = castLoad || castLoader();
      const loader = await castLoad, load = k => castCache[k] || (castCache[k] = loader.loadAsync(CAST_URL + k + '.glb' + CAST_Q));   /* one download per species for the page's lifetime */
      const SC = CAST_SC;   /* big enough that the head clears the laptop lid; every model is built at one body size, so one scale keeps bodies equal while ears, horns and manes stick out */
      const ms = await Promise.all(all.map(async o => {
        const g = await load(o.ghost ? 'ghost' : o.gk), m = g.scene.clone(true), box = new T.Box3().setFromObject(m);
        m.scale.setScalar(SC); o.y0 = 0.42 - box.min.y * SC; m.position.set(o.x, o.y0, o.z + 0.3); m.rotation.y = 0;   /* the model's front is +z: it looks at the camera */
        o.yj = (hash(o.p.id + ':yaw') * 2 - 1) * 0.22;   /* a small fixed turn per person, so a row of backs does not look stamped */
        castLook(m, o.ghost);
        if(!o.ghost && o.p.crown) m.add(castCrown(T));   /* the primitive crown is hidden with the primitive figures */
        holDress(m, o, '');
        return [o, m];
      }));
      if(gen !== castGen) return;   /* a newer build owns the scene now */
      ms.forEach(([o, m]) => { o.glb = m; world.add(m); });
      sets.f.forEach(f => { [f.torso, f.arm, f.scarf, f.sph, f.cone, f.rimH, f.rimT].forEach(m => { if(m) m.visible = false; }); });
      if(sets.mug) sets.mug.visible = false;
      castOn = true; request(); if(sel){ if(!(pr && pr.on)) portrait(sel); posePerson(sel); }   /* a person picked while the models were loading gets the portrait now */
      const man = await manP; if(gen !== castGen || destroyed || !man) return;
      sprMan = man; if(!sprKit) sprKit = makeSpriteKit(T, man); sprKit.setTint(sprTint);
      sprPend = { gen, ms: ms.filter(([o]) => !o.ghost) }; request();   /* the sheets download on the first zoom-in (stepCast), so the overview never pays for them */
      if(sel && pr && pr.on) portrait(sel);   /* a card whose manifest arrived after the pick */
    }catch(e){ if(gen === castGen) castOn = false; }
  }
  /* ── sprites: a seated animal drawn as a camera-facing plane with its Blender fur sheet (sprites.js) ──
   * The glb stays in the scene for its shadow only while the plane shows. In the overview (zoom under SPRITE_MIN_ZOOM), past SPRITE_MAX_REL_DEG of turn or off the sheets' elevation the glb (with shell fur) is drawn instead. */
  let sprTint = [1, 1, 1], sprPend = null;   /* sprPend: the seated models waiting for their sheets until the camera first comes close */
  const SPR_PREFETCH_ZOOM = 1.5;   /* under SPRITE_MIN_ZOOM, so the sheets are usually in by the time the gate opens */
  /* what the head wears (headDress): the crown, a head gear (gear.js) or nothing, and the season's piece; holKindOf is the same choice for the sprite sheet */
  function dressOf(o){ const id = o.p.gear && o.p.gear.head, f = id ? headGearFit(id, o.gk) : null; return headDress({ ghost: o.ghost, crown: o.p.crown, head: id || null, skip: !f || !!f.skip, xmas, holHeads: HOL_HEADS, species: o.gk, coin: hash(o.p.id + ':xmas') }); }
  function holKindOf(o){ return dressOf(o).hol; }
  function sprAttach(o, m, gen){
    const hk = holKindOf(o), pv = pickVariant(sprMan, o.gk, wantVariant(hk === 'nose' ? 'crown' : hk, o.gk, ANTLER_SKIP, NO_NOSE)); if(!pv) return;   /* 'nose' (crown or head gear in the season) uses the crown's sheet: the nose alone */
    const go = mat => {
      if(!mat || gen !== castGen || destroyed || o.spr || o.glb !== m) return;
      if(!pv.exact) (m.userData.hol || []).forEach(h => { h.userData.keepLook = true; });   /* no sheet for this accessory: the 3D one stays drawn over the plain sprite */
      const mesh = new T.Mesh(sprKit.geometry(o.gk, 2, CAST_SC), mat); mesh.userData.noAO = true; mesh.frustumCulled = false; mesh.visible = false; world.add(mesh);
      o.spr = { mesh, k: -1, on: false, pick: null }; request();
    };
    const hit = sprKit.cached(o.gk, pv.variant);
    if(hit) go(hit); else sprKit.material(o.gk, pv.variant).then(go);   /* sheets already loaded (a rebuild) attach at once, so nothing flashes */
  }
  function sprReveal(o){ const s = o && o.spr; if(s && s.on){ s.on = false; s.mesh.visible = false; sprKit.shadowOnly(o.glb, false); } }   /* a clone of the glb (the profile card) must be whole */
  function stepSprite(o, m, sv){
    /* The cell follows the camera and the fixed per-person yaw (o.yj) only. The head turn also turns the glb's body by up to about 25 degrees, and feeding
     * that in made a turning person jump between cells 17 degrees apart and past SPRITE_MAX_REL_DEG back to the glb, so the figure flipped between 2D and 3D. */
    const s = o.spr, pk = pickCell(relAzimuth(sv.az, o.yj || 0), sprMan.cols, undefined, s.pick); s.pick = pk;
    const show = sv.eok && sv.zok && !pk.glb && sel !== o && !o.pose && !o.poseLoading;   /* a picked person keeps the standing glb on the desk */
    if(show !== s.on){ s.on = show; s.mesh.visible = show; sprKit.shadowOnly(m, show); }
    if(!show) return;
    if(pk.k !== s.k){ s.k = pk.k; s.mesh.geometry = sprKit.geometry(o.gk, pk.k, CAST_SC); }
    s.mesh.position.copy(m.position); s.mesh.rotation.set(-sv.tilt, sv.az, 0, 'YXZ');   /* faces the camera; a higher or lower camera leans the plane back so the image keeps its height */
    s.mesh.scale.y = reduced ? 1 : 1 + 0.015 * Math.sin(time * 2.1 + o.ph);   /* breathing: the glb's y offset plus a slight stretch */
  }
  /* Picked: the seated model gives way to a standing one (cast/<key>-pose.glb, fetched on the first pick) on its desk beside the laptop, facing the
     camera that flies in from the front; it hops and sways, and a winged one flaps (its wings are the nodes flap_L and flap_R) */
  const poseCache = {};
  function posePerson(o){
    if(!castOn || !o || !o.glb || o.pose || o.poseLoading) return;
    const key = o.ghost ? 'ghost' : o.gk; o.poseLoading = true;
    (poseCache[key] = poseCache[key] || castLoad.then(l => l.loadAsync(CAST_URL + key + '-pose.glb' + CAST_Q))).then(g => {
      o.poseLoading = false; if(sel !== o || destroyed || !o.glb) return;
      const m = g.scene.clone(true), box = new T.Box3().setFromObject(m);
      m.scale.setScalar(CAST_SC); m.position.set(o.x + POSE_X, POSE_Y - box.min.y * CAST_SC, o.z + POSE_Z); m.userData.y0 = m.position.y;
      castLook(m, o.ghost);
      if(!o.ghost && o.p.crown) m.add(castCrown(T));
      holDress(m, o, 'pose-');
      m.userData.flaps = [m.getObjectByName('flap_L'), m.getObjectByName('flap_R')];
      world.add(m); o.pose = m; o.glb.visible = false; frameShow(o); portrait(o); request();
    }).catch(() => { o.poseLoading = false; o.poseFailed = true; if(sel === o && pr && pr.on && !destroyed) portrait(o); });   /* no standing model: the seated one stays in its chair and the card shows it live */
  }
  function holDress(m, o, pose){   /* in the same model space as castCrown(); what goes on is remembered in m.userData.hol so unpose() can free it */
    if(o.ghost) return;
    const add = h => { h.userData.holPiece = true; if(pose) h.userData.keepLook = true; m.add(h); hol.push(h); (m.userData.hol = m.userData.hol || []).push(h); };   /* the standing model is never a sprite, so its pieces always stay drawn; a seated one gets keepLook from sprAttach only when its sheet lacks the piece. holPiece lets the profile card keep them either way */
    const dr = dressOf(o), kind = dr.hol;
    if(dr.head){ const g = headPiece(dr.head, o.gk, o.p.id); if(g){ add(g); g.userData.keepLook = true; } }   /* no sprite sheet carries head gear, so it always stays drawn in 3D */
    { const g = backPiece(m, o, pose); if(g) add(g); }   /* wings too: no sheet has them, and they do not depend on the crown */
    if(!kind) return;
    if(kind === 'santa') return add(santaHat(T, o.gk));
    if(kind === 'rudolph' && !ANTLER_SKIP.has(o.gk)) add(reindeerAntlers(T, o.gk));
    if(NO_NOSE.has(o.gk)) return;
    const key = pose + o.gk, tip = key in noseTips ? noseTips[key] : (noseTips[key] = noseTipOf(T, m));   /* the nose tip differs by species, so it is read off the loaded model once */
    if(tip) add(rudolphNose(T, tip));
  }
  /* a head gear piece placed for a species (headGearFit), owning a dispose() like the season's pieces */
  function headPiece(id, species, pid){
    const f = headGearFit(id, species); if(!f || f.skip) return null;
    let g; try{ g = makeHeadGear(T, id); }catch(e){ return null; } if(!g) return null;
    g.userData.phase = hash(String(pid) + ':head') * 10;   /* two people with the same piece do not move in step */
    placeHeadGear(g, f); g.userData.gearHead = true; ownDispose(g); return g;
  }
  /* wings (gear.js) for a model: hung from the back anchor read off the model once per pose and species, flapping on a phase of their own; null for a ghost, no
     wings chosen, a species with wings of its own, or a model with no back to hang them on. gearHead makes the step pass reduced motion on, like head gear. */
  function backPiece(m, o, pose){
    const id = o.p.gear && o.p.gear.back, f = id ? backGearFit(id, o.gk) : null; if(!f || f.skip) return null;
    const key = pose + o.gk, an = key in backAnchors ? backAnchors[key] : (backAnchors[key] = backAnchorOf(T, m)); if(!an) return null;
    let g; try{ g = makeBackGear(T, id); }catch(e){ return null; } if(!g) return null;
    g.userData.phase = hash(String(o.p.id) + ':back') * 10; g.userData.keepLook = true; g.userData.gearHead = true;
    placeBackGear(g, an, f); ownDispose(g); return g;
  }
  /* redress a model in place (the shop's preview): its season and gear pieces come off and go on again from o.p.gear */
  function redress(m, o, pose){
    if(!m) return;
    (m.userData.hol || []).forEach(h => { hol = hol.filter(q => q !== h); if(h.parent) h.parent.remove(h); h.userData.dispose(); }); m.userData.hol = [];
    holDress(m, o, pose);
  }
  function unpose(o){ if(!o) return; o.poseLoading = false; if(o.pose){ (o.pose.userData.hol || []).forEach(h => { hol = hol.filter(q => q !== h); h.userData.dispose(); }); castFxRelease(o.pose); world.remove(o.pose); o.pose = null; } if(o.glb) o.glb.visible = true; frameShow(o); }
  /* the picked one stands at POSE_X, POSE_Z on its own desk, across the photo frame's corner: the frame steps aside while it stands there */
  function frameShow(o){ const pt = pets.find(q => q.o === o); if(pt && pt.frame){ pt.frame.visible = !o.pose; if(renderer) renderer.shadowMap.needsUpdate = true; } }
  function flapAt(m, t){ const f = m.userData.flaps; if(!f) return; const a = reduced ? 0.25 : 0.32 + 0.38 * Math.sin(t * 13); if(f[0]) f[0].rotation.z = -a; if(f[1]) f[1].rotation.z = a; }
  function stepCast(dt){
    if(!castOn) return;
    const sv = sprMan && sprKit && view ? (() => { const ce = Math.PI / 2 - view.getPose().ph; return { az: view.azimuth(), tilt: ce - sprMan.elev * Math.PI / 180, eok: elevOk(ce, sprMan.elev), zok: (sprZoom = zoomOk(view.zoom(), sprZoom)) }; })() : null;
    if(sv && sprPend && Math.max(view.zoom(), view.getPose().zoom) >= SPR_PREFETCH_ZOOM){ const p = sprPend; sprPend = null; if(p.gen === castGen) p.ms.forEach(([o, m]) => sprAttach(o, m, p.gen)); }   /* getPose().zoom is the target, so a fly-in starts the downloads as it sets off */
    people.forEach(o => { const m = o.glb; if(!m) return;
      const breathe = reduced ? 0 : Math.sin(time * 2.1 + o.ph) * 0.012;
      if(o.pose){ const pm = o.pose, hop = reduced ? 0 : Math.abs(Math.sin(time * 4.2)); pm.position.y = pm.userData.y0 + hop * 0.16;
        pm.rotation.z = reduced ? 0 : Math.sin(time * 2.1) * 0.07; pm.scale.set(CAST_SC * (1 + 0.04 * (1 - hop)), CAST_SC * (1 - 0.05 * (1 - hop)), CAST_SC * (1 + 0.04 * (1 - hop))); flapAt(pm, time); }
      m.position.y = o.y0 + (o.dy || 0) + breathe; m.rotation.y = (o.turn || 0) * 0.45 + (o.yj || 0); if(sv && o.spr) stepSprite(o, m, sv); });   /* the head turn (o.turn) becomes a small body turn */
  }
  function step(dt){
    time += dt; if(hol.length) hol.forEach(h => { const u = h.userData; if(!u.tick) return; if(u.gearHead) u.tick(time, envN, reduced); else h.userData.tick(time, envN); });   /* head gear holds still under reduced motion */
    if(gearBits.length) gearBits.forEach(h => { if(h.userData.tick) h.userData.tick(time, envN, reduced); });
    if(pets.length) stepPets(dt);
    if(pets.length) hoverRefresh(dt);   /* a still pointer over a walking pet */
    view.update(dt, time); updateWalls();
    { const az = view.azimuth(), flip = Math.cos(az) < 0;   /* floor text flips 180 degrees when the camera is on the far side */
      if(flip !== decFlip){ decFlip = flip; decals.forEach(m => { m.rotation.y = flip ? Math.PI : 0; }); } }
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
              case 'think': { mixA(R, [0.08, 1.5, -0.12, 0.5, 1]); hr = 0.28 * e; hp = -0.05 * e; yw = 0.25; yk = e; break; }
              case 'look': yw = o.nb * 0.95; yk = e; break;
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
          if(mug > 0.05){ fpt(o, o.x + R[0], R[1] + 0.17, o.z + R[2] - 0.08, TMP); setM(sets.mug, o.idx, TMP.x, TMP.y, TMP.z, 0, 0, 0.1 * K, 0.13 * K, 0.1 * K); faceCam(sets.mug, o.idx, o); }
          else setM(sets.mug, o.idx, o.x, 0, o.z, 0, 0, 0.0001, 0.0001, 0.0001);
        }
        if(f.ghost){ putPart(f.rimH, i, o.rimPt, o, hy, hz, yaw); setK(f.rimT, i, o, o.x, 1.05, o.z + 0.3, lean, 1.12, 1.1, 1.12); }
      });
      if(f.arr.length){ [f.torso, f.arm, f.scarf, f.sph, f.cone].concat(f.ghost ? [f.rimH, f.rimT] : [sets.mug]).forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
    });
    stepCast(dt);
    if(sets.pul){   /* field guide: rings blink under everyone of the picked species for 2.4 s */
      const now = performance.now(), on = !!pulse && now - pulse.t0 < 2400, blink = on && (reduced || Math.floor((now - pulse.t0) / 300) % 2 === 0);
      people.forEach((o, j) => { const hit = blink && o.gk === pulse.k; setM(sets.pul, j, o.x, 0.1, o.z + 0.3, 0, 0, hit ? 1 : 0.0001, 1, hit ? 1 : 0.0001); });
      sets.pul.instanceMatrix.needsUpdate = true; if(pulse && !on) pulse = null;
    }
    if(sel && ring){ const pz = !!sel.pose, k = (pz ? 0.5 : 1) * (1 + (reduced ? 0 : 0.04 * Math.sin(time * 3)));   /* on the desk under a posing character, on the floor round the chair otherwise */
      ring.position.set(sel.x + (pz ? POSE_X : 0), pz ? POSE_Y + 0.02 : 0.09, sel.z + (pz ? POSE_Z : 0.3)); ring.scale.setScalar(k); }
    sparks.forEach((q, i) => {
      const a = (reduced ? 0 : time * 1.6) + q.k * 2.1 + q.o.ph, tw = reduced ? 0.7 : 0.55 + 0.45 * Math.sin(time * 5 + q.k * 2 + q.o.ph), r = 0.85 + q.k * 0.08;
      setM(sets.spk, i, q.o.x + Math.cos(a) * r, 3.1 + q.k * 0.22 + Math.sin(a * 2) * 0.06, q.o.z + 0.25 + Math.sin(a) * r * 0.7, 0, 0, 0.09 * tw, 0.09 * tw, 0.09 * tw);
    });
    if(sparks.length) sets.spk.instanceMatrix.needsUpdate = true;
    /* lid logos flicker subtly; in the evening the lit ones glow brighter (the bloom pass spreads it) and the dark ones sink into the room */
    const c = new T.Color(), WHT = TMP2 || (TMP2 = new T.Color('#ffffff'));
    scr.list.forEach(s => {
      const key = s[3], tv = TV[key === 'off' ? 'nodata' : key], flick = reduced || key === 'off' ? 1 : 1 + 0.06 * Math.sin(time * 23 + s[4] * 7) * (Math.sin(time * 3.1 + s[4]) > 0.55 ? 1 : 0.25);
      c.set(key === 'off' || closed ? '#59566a' : tv.scr).multiplyScalar(key === 'off' || closed ? 1 - 0.45 * envN : tv.bri * flick); if(envN && key !== 'off' && !closed) c.lerp(WHT, 0.16 * envN).multiplyScalar(1 + 0.7 * envN); scr.ms[s[5]].setColorAt(s[6], c);
    });
    Object.values(scr.ms).forEach(m => { if(m.instanceColor) m.instanceColor.needsUpdate = true; });
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
      /* A bot shows up only for a trip, and the trip starts and ends on its owner's head, so the dashed line joins the person and the server:
         0 hidden, 1 pops up over the head, 2 out along the line, 3 at the server, 4 home along a redrawn line, 5 shrinks away over the head */
      const head = headPt(b.o, b.h || (b.h = v3())), drawLine = (from, to) => { const ga = b.tr.ln.geometry.attributes.position, q = b.q || (b.q = v3());
        for(let k = 0; k <= 24; k++){ arcTo(from, to, k / 24, q); ga.setXYZ(k, q.x, q.y, q.z); } ga.needsUpdate = true; b.tr.ln.computeLineDistances(); };
      if(b.st === 0){
        pos.copy(head);
        if(!reduced && time >= b.next && flying < 6){ const tr = trails.find(x => !x.busy); if(tr){ b.st = 1; b.t = 0; b.p0.copy(pos); b.tr = tr; tr.busy = true; flying++;
          tr.ln.material.color.copy(b.col); tr.ln.material.opacity = 0; drawLine(head, S); tr.ln.visible = true; } else b.next = time + 3; }
      } else if(b.st === 1){ b.t += dt / 0.45; pos.copy(head); drawLine(head, S); b.tr.ln.material.opacity = 0.9 * Math.min(1, b.t);
        if(b.t >= 1){ b.st = 2; b.t = 0; b.p0.copy(head); } }
      else if(b.st === 2){ b.t += dt / 2; if(b.t >= 1){ b.st = 3; b.t = 0; sFlash = 1; pos.copy(S); } else arcTo(b.p0, S, b.t, pos); b.tr.ln.material.opacity = 0.9; }
      else if(b.st === 3){ b.t += dt / 0.6; pos.copy(S); pos.y += Math.sin(time * 6) * 0.05; drawLine(head, S); if(b.t >= 1){ b.st = 4; b.t = 0; } }
      else if(b.st === 4){ b.t += dt / 2; drawLine(S, head); arcTo(S, head, Math.min(1, b.t), pos); b.tr.ln.material.opacity = 0.9;
        if(b.t >= 1){ b.st = 5; b.t = 0; b.p0.copy(head); b.tr.busy = false; b.tr.ln.visible = false; } }
      else { b.t += dt / 0.4; pos.copy(head);
        if(b.t >= 1){ b.st = 0; b.next = time + (b.o.p.tier === 'power' ? 5 : 11) + hash(b.o.p.id + time) * 7; } }
      const sc = b.st === 0 ? 0.0001 : b.st === 1 ? Math.max(0.0001, ease(Math.min(1, b.t))) : b.st === 5 ? Math.max(0.0001, 1 - ease(Math.min(1, b.t))) : 1;   /* pop in, pop out */
      { const az = view ? view.azimuth() : 0, fx = Math.sin(az), fz = Math.cos(az), rx_ = Math.cos(az), rz_ = -Math.sin(az), i2 = 2 * b.i;   /* the face turns to the camera */
        const blink = reduced ? 1 : (Math.sin(time * 1.7 + b.a0 * 3) > 0.985 ? 0.15 : 1);
        setM(sets.vz, b.i, pos.x + fx * 0.115 * sc, pos.y + 0.015 * sc, pos.z + fz * 0.115 * sc, 0, az, 0.15 * sc, 0.105 * sc, 0.085 * sc);
        for(const [j, sd] of [[0, -1], [1, 1]]){
          setM(sets.ey, i2 + j, pos.x + (fx * 0.19 + rx_ * sd * 0.055) * sc, pos.y + 0.025 * sc, pos.z + (fz * 0.19 + rz_ * sd * 0.055) * sc, 0, az, 0.026 * sc, 0.032 * blink * sc, 0.02 * sc);
          setM(sets.er, i2 + j, pos.x + rx_ * sd * 0.185 * sc, pos.y, pos.z + rz_ * sd * 0.185 * sc, 0, az, 0.045 * sc, 0.07 * sc, 0.07 * sc);
        } }
      const gs = (0.29 + 0.1 * envN) * sc;
      setM(sets.bm, b.i, pos.x, pos.y, pos.z, 0, 0, 0.2 * sc, 0.185 * sc, 0.19 * sc); setM(sets.gl, b.i, pos.x, pos.y, pos.z, 0, 0, gs, gs, gs);   /* small body, a thin glow */
      setM(sets.an, b.i, pos.x, pos.y + 0.26 * sc, pos.z, 0, 0, 0.025 * sc, 0.16 * sc, 0.025 * sc); setM(sets.tp, b.i, pos.x, pos.y + 0.37 * sc, pos.z, 0, 0, 0.05 * sc, 0.05 * sc, 0.05 * sc);
    });
    if(bots.length){ [sets.bm, sets.gl, sets.an, sets.tp, sets.vz, sets.ey, sets.er].forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
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
  function render(){ if(stage.clientWidth !== W) resize(); if(view) castFxLod(scale * view.zoom() * CAST_SC); if(view && pets.length){ const px = castFurShells() > 0 ? scale * view.zoom() : 0; petFurCalls = 0; pets.forEach(pt => { petFurCalls += pt.g.userData.fur(px); }); } if(post && post.on){ post.setZoom(view.zoom()); post.render(); } else renderer.render(scene, camera); labels(); }   /* a drawer that just opened shrinks the stage before the ResizeObserver runs; without this one frame is drawn stretched */
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
    if(holFit){   /* the world tree: its trunk and the lowest layer of its crown must stay in view (the upper crown may leave the top of the screen) */
      for(const [y, rr] of holFit.pts){ v.set(holFit.x, y, holFit.z).applyMatrix4(inv); x0 = Math.min(x0, v.x - rr); x1 = Math.max(x1, v.x + rr); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
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
    const was = mobile(); W = w; H = h; renderer.setSize(w, h, false); if(post) post.setSize(w, h);
    if(was !== mobile() && cur) return build(cur);
    fit(); request(); if(vw && vw.on) vwFit();
    if(shop && chrome.isOpen()) sheetSync(true);   /* crossing 520 px turns the sheet on or off */
  }

  /* ── pointer: drag rotates within +-35 degrees, hover tooltip, click opens the person ── */
  function nearest(px, py, noObj){
    if(!noObj){ const ob = objPick(px, py, objList()); if(ob) return { obj: ob }; }   /* hover: a desk item, frame or pet under the pointer wins over the person behind it (a tap decides objects at the press, see onTap) */
    let best = null, bd = 1e9; const rad = Math.max(16, Math.min(46, scale * view.zoom() * 0.9));
    people.forEach(o => { const [x, y] = proj(HP.set(o.x, 2.0, o.z + 0.2), PT), dd = Math.hypot(x - px, y - py); if(dd < rad && dd < bd){ bd = dd; best = o; } });
    if(best) return { person: best };
    const f = zoneAt(px, py), q = f && f.q;
    if(q){ const z = zones.find(z => z.dw && q.x >= z.dx && q.x <= z.dx + z.dw && q.z >= z.cz + z.d / 2 - LANE && q.z <= z.cz + z.d / 2); if(z && z.kind === 'team') return { team: z }; }
    if(srv){ const [x, y] = proj(HP.set(srv.x, 1.8, srv.z), PT); if(Math.hypot(x - px, y - py) < Math.max(26, scale * view.zoom() * 1.8)) return { server: true }; }
    return null;
  }
  function showTip(h, px, py){
    if(h && h.obj){ const inf = objInfo(h.obj.kind, h.obj.o); if(!inf){ elTip.hidden = true; return; } elTip.innerHTML = `<b>${esc(inf.title)}</b><small>${esc(vwUi().tip || '')}</small>`; elTip.classList.add('one'); elTip.hidden = false;
      const tw = elTip.offsetWidth, th = elTip.offsetHeight; elTip.style.transform = `translate(${Math.round(Math.max(6, Math.min(W - tw - 6, px + 14)))}px,${Math.round(Math.max(6, Math.min(H - th - 6, py + 14)))}px)`; return; }
    elTip.classList.remove('one');
    if(!h || !(h.person || h.team)){ elTip.hidden = true; return; }
    { const o = h.person; if(o && !o.ghost && sprOn && sprKit && sprMan && cardOf(sprMan, o.gk)) sprKit.card(o.gk); }   /* hovering fetches the card sheet, so a click usually finds it loaded */
    const p = h.person && h.person.p;
    elTip.innerHTML = h.team ? `<b>${esc(h.team.name)}</b>` + (h.team.gh ? `<div><span>⏸</span><span>${h.team.gh}</span></div>` : '') : `<b>${esc(p.name)}</b>` + (p.tip || []).map(r => `<div><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('') + `<div class="tier t-${p.tier}"><span>${esc(p.gradeLabel || p.tierText)}</span></div>`;
    elTip.hidden = false;
    const tw = elTip.offsetWidth, th = elTip.offsetHeight;
    elTip.style.transform = `translate(${Math.round(Math.max(6, Math.min(W - tw - 6, px + 14)))}px,${Math.round(Math.max(6, Math.min(H - th - 6, py + 14)))}px)`;
  }
  function setHover(h, px, py){
    const key = h && (h.obj ? h.obj.kind + ':' + h.obj.o.p.id : h.person || h.team || 'srv');
    if(hover !== key){ hover = key; canvas.classList.toggle('hit', !!h); }
    showTip(h, px, py);
  }
  const pt = ev => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  let downObj = null, ptrAt = null, hoverT = 0;   /* the object under the last press; the last hover position, so the hover follows pets that walk under a still pointer */
  function hoverRefresh(dt){ if(!ptrAt || (vw && vw.on)) return; hoverT += dt; if(hoverT < 0.15) return; hoverT = 0; setHover(nearest(ptrAt[0], ptrAt[1]), ptrAt[0], ptrAt[1]); }
  function bindView(){
    view = makeView({ T, canvas, stage, camera, target0: [0, 0.9, 0], theta0: Math.PI / 4, phi0: Math.atan2(Math.hypot(20, 20), 16.6), dist: Math.hypot(20, 16.6, 20), reduced,
      bounds: () => ({ x0: BB.x0, x1: BB.x1, z0: BB.z0, z1: BB.z1 }), size: () => [W, H], ppu: () => scale, near: 6, isFs: () => chrome.fsOn(), request,
      onFocus: () => chrome.hideHint(), onEnter: () => chrome.showHint(), onDrag: on => { if(on){ setHover(null); ptrAt = null; } },
      onMove: (px, py) => { ptrAt = [px, py]; const h = nearest(px, py); setHover(h, px, py); const f = zoneAt(px, py); setTint(f && f.zn && f.zn.kind === 'team' ? f.zn : null); },
      onLeave: () => { ptrAt = null; setHover(null); setTint(null); },
      /* an object (desk item, frame, pet) is taken at the press and opens at the release only while the pointer is still near it (objTap); a press that began on
         one never falls through to the person behind it or closes the drawer. People, team names on the floor and the server pick at the release as before. */
      onDown: (px, py, ev) => { const mr = pickMinR(ev && ev.pointerType), ob = objPick(px, py, objList(), mr); downObj = ob ? { kind: ob.kind, o: ob.o, mr } : null; },
      onTap: (px, py) => {
        const d = downObj; downObj = null;
        const v = objTap(d, d ? objList().find(e => e.kind === d.kind && e.o === d.o) : null, px, py, d ? d.mr : 10);
        if(v === 'open'){ viewOpen(d.kind, d.o); return; }   /* the viewer: no drawer, no camera move */
        if(v === 'keep'){ setHover(null); return; }
        const h = nearest(px, py, true);
        if(!h){ setHover(null); if(sel) closeDrawer(); return; }
        if(h.server){ if(!opts.readOnly && opts.onServer) opts.onServer(); return; }
        if(h.team){ if(!opts.readOnly && opts.onTeam) opts.onTeam(h.team.id); return; }
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
    castFxInit(T, castFurShells());
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.localClippingEnabled = true;
    canvas = renderer.domElement; canvas.setAttribute('role', 'img'); stage.insertBefore(canvas, stage.firstChild);
    scene = new T.Scene(); world = new T.Group(); scene.add(world); rcast = new T.Raycaster(); rplane = new T.Plane(new T.Vector3(0, 1, 0), -0.07);
    M4 = new T.Object3D(); S = v3(); TMP = v3(); PT = v3(); HP = v3(); Mh = new T.Matrix4(); Mp = new T.Matrix4(); Q1 = new T.Quaternion(); E1 = new T.Euler(0, 0, 0, 'YXZ'); V1 = v3(); V2 = v3(); ONE = v3().set(1, 1, 1);
    camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    hemi = new T.HemisphereLight('#f3f1ff', '#e8dcc4', 0.95); sun = new T.DirectionalLight('#fff0d4', 1.35); sun.position.set(8, 18, 6); sun.castShadow = true;
    { const ms = (window.innerWidth || 1024) < 520 ? 1024 : 2048; sun.shadow.mapSize.set(ms, ms); }   /* the shadow camera spans the whole floor, so 1024 left no contact shadow under a desk */
    rim = new T.DirectionalLight('#e6ecff', 0.5); rim.position.set(-10, 10, -10);   /* rim light from behind the default camera (theta0 = pi/4), 35 degrees up, no shadow */
    sun.shadow.bias = -0.0008; sun.shadow.radius = 4;
    scene.add(hemi, sun, sun.target, rim);
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
    /* post-processing passes (post.js); the team names are floor decals, so nothing is drawn on top afterwards */
    makePost(T, renderer, scene, camera, { mobile, look: OFFICE_LOOK }).then(p => { if(destroyed){ if(p) p.dispose(); return; } post = p; if(post){ post.setSize(W, H); post.setNight(envN); request(); } }).catch(() => {});
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
    update(d){ cur = d; if(started !== true) return; if(builtKey !== null && keyOf(d) === builtKey) soft(d); else build(d); },   /* the same structure repaints in place (soft), anything else rebuilds */
    get view(){ return view; },
    ready: () => started === true && !!view,
    bench(n = 60){ const gl = renderer.getContext(), b = new Uint8Array(4); let t = 0; for(let i = 0; i < n; i++){ const s0 = performance.now(); render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); t += performance.now() - s0; } return t / n; },   /* GPU-synced ms per frame, for measurements */
    portraitInfo: () => ({ species: sel ? sel.gk : null, card: !!(pr && pr.on && pr.card) }),   /* card: the profile card shows the baked image */
    people: () => people.map(o => ({ id: o.p.id, name: o.p.name, tier: o.p.tier, ghost: o.ghost, x: o.x, z: o.z, species: o.gk, sprite: !!(o.spr && o.spr.on) })),   /* sprite: this person is drawn as a sprite right now */
    server: () => (srv ? { x: srv.x, z: srv.z } : null),
    selectPerson(id, opts){ const o = people.find(q => q.p.id === id); if(o) openDrawer(o, !(opts && opts.fly === false)); return !!o; },   /* fly:false keeps a scripted camera where the script put it */
    closeDrawer: () => chrome.close(),
    /* the object viewer, for scripted screenshots: viewObject(kind, id) opens 'desk', 'frame' or 'pet' of that person (false when there is none; not named view,
       which is the camera above), viewInfo() says what is open; objects() lists the clickable objects with their projected centre and radius in canvas px */
    viewObject(kind, id){ const o = people.find(q => q.p.id === id); return !!o && viewOpen(kind, o); },
    viewClose: () => viewClose(),
    viewInfo: () => (vw && vw.on ? { kind: vw.info.kind, id: vw.info.o.p.id, title: vw.info.title, sub: vw.info.sub.slice(), hint: vw.info.hint || '', pin: !!vw.info.pin, size: vw.s, photo: !!vw.info.photo, live: !!vw.g, focus: document.activeElement === vw.x } : null),
    tip: () => (elTip.hidden ? null : elTip.textContent),   /* the hover tooltip's text, null when hidden */
    objects: () => objList().map(e => ({ kind: e.kind, id: e.o.p.id, x: e.x, y: e.y, r: e.r })),
    /* pets, for scripted recordings and screenshots: setPet(id, pet) replaces one person's pet (a look plus photo) and rebuilds; petAct(id, kind) holds the pet in
       'roam', 'sit', 'eat', 'drink', 'sleep' or 'play' until petAct(id, null) hands it back to its schedule; pets() lists where each one is */
    setPet(id, pet, toys){ const p = cur && (cur.people || []).find(q => q.id === id); if(!p) return false; p.pet = pet || null; if(pet && typeof pet.photo === 'string') photoCache.set(String(id), pet.photo);   /* a scripted photo stands for a shared one */ if(toys !== undefined) p.petToys = !!toys; if(started === true) build(cur); return true; },   /* toys: whether the pet may fetch and play (left as it was when omitted) */
    petAct(id, kind, walk, dur){ const pt = pets.find(q => q.o.p.id === id); if(!pt) return false; pt.forceDur = dur > 0 ? +dur : 0; petForce(pt, kind || null, !!walk); request(); return true; },   /* walk: play the whole act from where the pet is instead of starting it in place; dur: seconds the act lasts (held until changed when left out) */
    petToy(id, kind){ const pt = pets.find(q => q.o.p.id === id); if(!pt || !pt.toy) return false; petToyReplace(pt, kind); request(); return true; },   /* scripted checks of each toy kind: swap this pet's toy */
    pets: () => pets.map(pt => ({ id: pt.o.p.id, kind: pt.look.kind, x: pt.x, y: pt.y, z: pt.z, yaw: pt.yaw, air: Number(pt.g.userData.air) || 0, legK: lk(pt), playZ: pz(pt), bs: pt.bs, frame: pt.frame ? { x: pt.frame.position.x, z: pt.frame.position.z } : null, act: pt.force || pt.prev, pose: pt.pose, seg: pt.seg ? pt.seg.k + (pt.seg.ph ? ':' + pt.seg.ph : '') : null, v: pt.v, scale: pt.g.scale.y, deskK: pt.deskK,
      toy: pt.toy ? { kind: pt.toy.userData.kind, mode: pt.toyMode, x: pt.toy.position.x, y: pt.toy.position.y, z: pt.toy.position.z, s: pt.toy.scale.x, shown: pt.toy.visible, low: toyLow(pt) } : null, play: pt.play ? petPlayAt(pt.play.seq, pt.play.t, pz(pt)).k : null, toyQ: pt.toy ? toySpinOf(pt.toy).quaternion.toArray().map(v => +v.toFixed(4)) : null, carryYaw: pt.toy ? toyCarry(pt.toy) : null,
      slot: pt.slot ? { k: pt.slot.k, fetch: pt.slot.fetch, play: pt.slot.play } : null, seat: { x: pt.o.x, z: pt.o.z }, bowls: pt.spots.bowl, pile: pt.spots.pile, desk: pt.spots.desk, hop: pt.spots.hop, sit: pt.spots.sit, furCalls: petFurCalls, deskBox: pt.deskBox, blob: { y: pt.blob.position.y, s: pt.blob.scale.x, o: pt.blobMat ? pt.blobMat.opacity : null } })),
    destroy(){
      destroyed = true; if(sprKit){ sprKit.dispose(); sprKit = null; } if(pr){ hidePortrait(); pr.r.dispose(); pr.el.remove(); pr = null; } if(raf) cancelAnimationFrame(raf); if(rr) cancelAnimationFrame(rr); clearInterval(minuteTimer);
      if(io) io.disconnect(); if(ro) ro.disconnect();
      document.removeEventListener('visibilitychange', onVis); chrome.destroy();
      if(started === true){
        document.documentElement.classList.remove('of-sheet-on'); viewKill(); clear(); disposePetShared(T); disposeGearShared(T); shopKill(); wxs = null; lamps.forEach(L => { scene.remove(L); L.dispose(); }); lamps = []; statics.forEach(o => o.dispose && o.dispose()); if(post) post.dispose(); renderer.dispose();
        const x = renderer.getContext().getExtension('WEBGL_lose_context'); if(x) x.loseContext();
        if(canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
      container.innerHTML = '';
    }
  };
}

/* the office is seen closer than the town: lighter tilt-shift so the desks at the top and bottom edges stay readable */
const OFFICE_LOOK = { tilt: 0.55 };

/* ── cosmetics: unlock levels, head, wing and desk gear (gear.js) and pets, shared by both data mappers and the scene ──
 * The server computes the level (0..LV_MAX) from use since joining and returns each person's choices; the page never adds up anyone's figures.
 * A missing field means level 0, nothing worn and no pet, so an old server gives exactly the page it gave before. */
export const LV_MAX = 6;
export const lvOf = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(LV_MAX, Math.max(0, n)) : 0; };
const GEAR_SLOT = Object.fromEntries(GEAR_ITEMS.map(g => [g.id, g.slot]));
/* The server's catalogue carries nine slots: the character's head, back and desk, and the pet's goods pet_collar, pet_tag, pet_head, pet_back, pet_body and pet_toy. A pet item repeats
   the id of a character item (cap is in head and in pet_head), so every lookup keys on the slot and the id together. itemSlot is the slot of one item, or null when
   it is not one this build knows; an item with no slot (an older server) is a character item by its id. PET_SLOT_KEY is the look key a pet slot sets. */
const CHAR_SLOTS = ['head', 'back', 'desk'], PET_SLOT_IDS = { pet_head: PET_HATS, pet_back: PET_WINGS, pet_body: PET_BODIES, pet_toy: PET_TOYS, pet_collar: ['collar'], pet_tag: PET_TAGS };
const PET_SLOT_KEY = { pet_head: 'hat', pet_back: 'wing', pet_body: 'body', pet_toy: 'toy', pet_collar: 'collar', pet_tag: 'tag' };
const itemSlot = i => !i ? null : i.slot ? ((CHAR_SLOTS.includes(i.slot) ? GEAR_SLOT[i.id] === i.slot : (PET_SLOT_IDS[i.slot] || []).includes(i.id)) ? i.slot : null) : GEAR_SLOT[i.id] || null;
const charItem = i => CHAR_SLOTS.includes(itemSlot(i));
/* what a level opens in the pet goods, as one entry 'pg:<count>' (the level-up note says "pet goods (3)" once, not every name) */
const petGoodsOpens = (u, lvl) => { const n = (u.items || []).filter(i => i && lvOf(i.lvl) === lvl && PET_SLOT_KEY[itemSlot(i)]).length; return n ? ['pg:' + n] : []; };
/* { head, back, desk } with known ids in the right slot, anything else null */
export function gearOf(g){ const ok = (id, slot) => (typeof id === 'string' && GEAR_SLOT[id] === slot ? id : null); return { head: ok(g && g.head, 'head'), desk: ok(g && g.desk, 'desk'), back: ok(g && g.back, 'back') }; }
export const HOL_HAT_SKIP = new Set([]);   /* species that already wear a hat take the Rudolph set in the season; since the cast models lost their built-in accessories (3.127.0-2) none does */
/* HOL_HEADS: whether the year-end season puts a Santa hat, antlers or a red nose on heads. Off since 2026-11-15: by default a head wears only what the member
   chose (the crown or a head gear); the season still dresses the room (tree, presents, garland, wreaths). */
export const HOL_HEADS = false;
/* What goes on a head. o: { ghost, crown, head (gear id or null), skip (headGearFit says the species cannot wear it), xmas, holHeads (HOL_HEADS), species,
 * coin (0..1 hash) }. The crown wins over head gear. With holHeads in the year-end season a chosen head gear replaces the Santa hat or the antlers and the
 * red nose stays ('nose'). hol is null, 'santa', 'rudolph' (antlers where the species takes them, and the nose) or 'nose'. */
export function headDress(o){
  if(!o || o.ghost) return { crown: false, head: null, hol: null };
  const crown = !!o.crown, head = !crown && o.head && !o.skip ? o.head : null;
  const hol = !o.xmas || !o.holHeads ? null : crown || head ? 'nose' : HOL_HAT_SKIP.has(o.species) ? 'rudolph' : o.coin < 0.5 ? 'santa' : 'rudolph';
  return { crown, head, hol };
}
/* A person's cosmetics for the scene. p: { lvl, gear, pet, toys?, photo? } as the server sends them; o: { off (closed organization or a ghost: nothing),
 * toysLvl (the level from which pets play with toys), keepPet (keep the pet object as it is, photo included; otherwise the normalized look only) } */
export function cosmeticsOf(p, o = {}){
  if(o.off || !p) return { lvl: 0, gear: { head: null, back: null, desk: null }, pet: null, petToys: false };
  const lvl = lvOf(p.lvl), look = normalizePetLook(p.pet), tl = o.toysLvl == null ? NaN : Number(o.toysLvl);
  /* photo: true on a row says the member shares a photo; the pet then carries shared: true and the scene asks for the photo itself (opts.petPhotos) */
  let pet = look ? (o.keepPet ? p.pet : look) : null; if(pet && p.photo === true) pet = { ...pet, shared: true };
  return { lvl, gear: gearOf(p.gear), pet, petToys: !!pet && (p.toys === true || (Number.isFinite(tl) && lvl >= tl)) };
}
/* The unlock block: where the viewer stands and what the next level needs. u is data.shop. Thresholds come from the server (u.levels), never from here.
 * Every level needs at least one delegation, so a viewer without one is told that the first delegation opens level 1. */
export function unlockNext(u){
  const level = lvOf(u && u.level), clamp1 = x => Math.min(1, Math.max(0, x));
  const levels = (Array.isArray(u && u.levels) ? u.levels : []).map(l => ({ lvl: lvOf(l && l.lvl), spent: Number(l && l.min_spent) || 0, dlg: Number(l && l.min_dlg) || 0 })).filter(l => l.lvl > 0).sort((a, b) => a.lvl - b.lvl);
  const next = levels.find(l => l.lvl > level) || null, spent = Number(u && u.spent) || 0, dlg = Number(u && u.dlg) || 0, runs = Number(u && u.runs) || 0;
  const opens = !next ? [] : (u.items || []).filter(i => lvOf(i.lvl) === next.lvl && charItem(i)).map(i => i.id)
    .concat(petGoodsOpens(u, next.lvl), lvOf(u.petLvl) === next.lvl && u.petLvl != null ? ['pet'] : [], lvOf(u.toysLvl) === next.lvl && u.toysLvl != null ? ['toys'] : []);
  return { level, top: levels.length > 0 && !next, next, spent, dlg, runs, noDlg: runs <= 0,
    spentK: next ? (next.spent > 0 ? clamp1(spent / next.spent) : 1) : 1, dlgK: next ? (next.dlg > 0 ? clamp1(dlg / next.dlg) : 1) : 1, opens };
}
/* The collection (the shop's first tab) from data.shop: one page per level of the server's table (u.levels, lowest first), never from numbers kept here.
 * state: 'done' (the level is reached), 'next' (the one after the viewer's level) or 'locked'. items: what the level opens (unknown ids dropped, in gear.js order),
 * open once the level is reached; feats: 'pet' and 'toys' on the level that opens them. spentK and dlgK (0..1) are the progress toward the next goal only
 * (a base of 0 counts as met); a reached page reads 1 and a locked one 0. got: the open items, total: the items on show. */
export function bookOf(u){
  const level = lvOf(u && u.level), spent = Number(u && u.spent) || 0, dlg = Number(u && u.dlg) || 0, clamp1 = x => Math.min(1, Math.max(0, x)), at = (x, base) => base > 0 ? clamp1(x / base) : 1;
  const levels = (Array.isArray(u && u.levels) ? u.levels : []).map(l => ({ lvl: lvOf(l && l.lvl), spent: Number(l && l.min_spent) || 0, dlg: Number(l && l.min_dlg) || 0 })).filter(l => l.lvl > 0).sort((a, b) => a.lvl - b.lvl);
  const order = new Map(GEAR_ITEMS.map((g, i) => [g.id, i])), items = (Array.isArray(u && u.items) ? u.items : []).filter(i => charItem(i)).sort((a, b) => order.get(a.id) - order.get(b.id));
  const feat = (v, n) => v != null && lvOf(v) === n;
  let got = 0, total = 0;
  const pages = levels.map(l => {
    const state = l.lvl <= level ? 'done' : l.lvl === level + 1 ? 'next' : 'locked';
    const its = items.filter(i => lvOf(i.lvl) === l.lvl).map(i => ({ id: i.id, slot: itemSlot(i), open: l.lvl <= level }));
    total += its.length; got += its.filter(i => i.open).length;
    return { lvl: l.lvl, spent: l.spent, dlg: l.dlg, state, spentK: state === 'next' ? at(spent, l.spent) : state === 'done' ? 1 : 0, dlgK: state === 'next' ? at(dlg, l.dlg) : state === 'done' ? 1 : 0,
      items: its, feats: [...(feat(u && u.petLvl, l.lvl) ? ['pet'] : []), ...(feat(u && u.toysLvl, l.lvl) ? ['toys'] : [])] };
  });
  return { got, total, pages };
}
/* the shop's tiles for one of the nine slots (head, back, desk, pet_head, pet_back, pet_body, pet_toy, pet_collar, pet_tag): the server's item list (unknown ids dropped), matched on slot and id together, in gear.js order
 * for the character and in the pets.js list for the pet, each with its level and whether it is open */
export function shopTiles(u, slot){
  const lv = lvOf(u && u.level), by = {}; ((u && u.items) || []).forEach(i => { if(i && itemSlot(i) === slot) by[i.id] = lvOf(i.lvl); });
  const order = CHAR_SLOTS.includes(slot) ? GEAR_ITEMS.filter(g => g.slot === slot).map(g => g.id) : PET_SLOT_IDS[slot] || [];   /* gear.js order for the character, the pets.js list for the pet */
  return order.filter(id => id in by).map(id => ({ id, lvl: by[id], open: by[id] <= lv }));
}
export const fmtMoney = v => '$' + (v >= 100 ? Math.round(v).toLocaleString('en-US') : (Number(v) || 0).toFixed(2));
/* The viewer's own progress next to a goal is rounded down to what is shown, so a figure short of the goal never reads as the goal: a share of 0.952 %
 * read "1.0% / 1%" while level 2 stayed shut (2026-11-16), and $49.996 would read "$50.00 / $50". moneyDown keeps whole dollars from $100 (fmtMoney's
 * precision there) and cents below; pctDown keeps one decimal. The 1e-9 keeps a share computed as 0.15 by the server from showing 14.9 %. */
export const moneyDown = v => { const n = Number(v) || 0; return n >= 100 ? Math.floor(n + 1e-9) : Math.floor(n * 100 + 1e-9) / 100; };
export const pctDown = v => (Math.floor((Number(v) || 0) * 1000 + 1e-9) / 10).toFixed(1) + '%';
/* the shop's strings (office-i18n.js of.sh.*, of.gear.*, of.pet.*), resolved by the page's t() so the scene stays free of i18n */
export const SHOP_KEYS = ['title', 'scope', 'level', 'spent', 'dlg', 'runs', 'need', 'need1', 'next', 'top', 'ghost', 'open', 'back', 'tabs', 'tab.book', 'tab.head', 'tab.back', 'tab.desk', 'tab.pet', 'book.got', 'book.need', 'book.need1', 'book.done', 'book.next', 'book.locked', 'book.spent', 'book.dlg', 'book.pet', 'book.toys', 'slot.head', 'slot.back', 'slot.desk', 'none', 'locked', 'lockedSr', 'skip', 'skipSr', 'save', 'cancel', 'saving',
  'saved', 'saved.private', 'saved.shared', 'err', 'err.locked', 'err.many', 'err.na', 'err.link', 'err.input', 'err.org', 'pet.locked', 'pet.drop', 'pet.add', 'pet.file', 'pet.change', 'pet.photo', 'pet.bad', 'pet.read', 'pet.readBreed', 'pet.pick',
  'pet.kind', 'pet.pattern', 'pet.ear', 'pet.tail', 'pet.size', 'pet.fluff', 'pet.fur', 'pet.colors', 'pet.use', 'pet.name', 'pet.remove', 'pet.ask', 'pet.keep', 'pet.removed', 'pet.preview', 'pet.zoom', 'pet.toys', 'pet.toysOn', 'item.pet', 'item.toys', 'wearing',
  'err.photo', 'pet.breed', 'pet.breedNote', 'pet.custom', 'pet.dogs', 'pet.cats', 'pet.vis', 'pet.visMe', 'pet.visShare', 'pet.visMeNote', 'pet.visShareNote', 'pet.visEx', 'pet.g.basic', 'pet.g.coat', 'pet.g.shape', 'pet.g.face', 'pet.tag', 'tab.petgear', 'pg.collar', 'pg.tagNote', 'pg.head', 'pg.back', 'pg.body', 'pg.toy', 'pg.nopet', 'pg.toPet', 'pg.opens',
  'pet.earsize', 'pet.snout', 'pet.legs', 'pet.length', 'pet.build', ...['fluff', 'earsize', 'snout', 'legs', 'length', 'build'].flatMap(k => ['pet.' + k + '.lo', 'pet.' + k + '.hi']),
  'pet.marks', 'pet.markColor', 'pet.eye', 'pet.nose', 'pet.auto', 'pet.collar', 'pet.collarColor', 'pet.toyAuto'];
/* every coat role any pattern names (pets.js petCoatRoles), for the labels of the colour inputs */
export const petRoleKeys = () => [...new Set(PET_PATTERNS.flatMap(p => petCoatRoles(p).map(r => r.key)))];
export function shopUi(t){
  const ui = {}; SHOP_KEYS.forEach(k => { ui[k] = t('of.sh.' + k); });
  ui.gear = Object.fromEntries(GEAR_ITEMS.map(g => [g.id, t('of.gear.' + g.id)]));
  ui.opt = Object.fromEntries([...PET_KINDS, ...PET_PATTERNS.map(x => 'pat.' + x), ...PET_EARS.map(x => 'ear.' + x), ...PET_TAILS.map(x => 'tail.' + x), ...PET_SIZES.map(x => 'size.' + x),
    ...petRoleKeys().map(x => 'role.' + x), ...PET_MARKS.map(x => 'mark.' + x), ...PET_FUR_LIST.map(x => 'fur.' + x), ...PET_TOYS.map(x => 'toy.' + x), ...PET_TAGS.map(x => 'tag.' + x), ...PET_BODIES.map(x => 'body.' + x)].map(k => [k, t('of.pet.' + k)]));
  return ui;
}
/* the object viewer's strings (office-i18n.js of.vw.*), with the item names and the pet kinds, for every page (it is not tied to the shop) */
export const VIEW_KEYS = ['title', 'close', 'photo', 'pet', 'drag', 'ownPet', 'ownDesk', 'shared', 'mine', 'mineShared', 'tip'];
export function viewUi(t){
  const ui = {}; VIEW_KEYS.forEach(k => { ui[k] = t('of.vw.' + k); });
  ui.gear = Object.fromEntries(GEAR_ITEMS.map(g => [g.id, t('of.gear.' + g.id)])); ui.kind = Object.fromEntries(PET_KINDS.map(k => [k, t('of.pet.' + k)]));
  return ui;
}

/* ── shared pet photos (server: member_pet_photos). A photo is a small JPEG or WebP data URL; anything else never reaches an image source. ── */
export const PET_PHOTO_RE = /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, PET_PHOTO_MAX = 48000, PET_PHOTO_UP = 46000;
export const petPhotoOk = s => typeof s === 'string' && s.length <= PET_PHOTO_MAX && PET_PHOTO_RE.test(s);
/* a town_pet_photos or org_pet_photos reply, { id: dataUrl }: only the ids asked for and only valid photos; anything else reads as no photos */
export function petPhotosClean(res, ids){
  const out = {}; if(!res || typeof res !== 'object' || Array.isArray(res)) return out;
  const want = new Set((ids || []).map(String)); for(const k of Object.keys(res)) if(want.has(k) && petPhotoOk(res[k])) out[k] = res[k];
  return out;
}
/* What a pet save does with the shared copy. extra: { photo (this browser's photo), fresh (picked in this visit), share (the member's choice), shared (the
 * server has a copy) }. 'upload' when sharing and the server lacks this photo, 'clear' when going private while the server has one, else null. Removing
 * the pet clears the copy on the server by itself. */
export function petPhotoPlan(change, extra){
  if(!change || !change.pet || change.petClear || !extra) return null;
  if(extra.share === true) return extra.photo && (extra.fresh || !extra.shared) ? 'upload' : null;
  return extra.share === false && extra.shared ? 'clear' : null;
}
/* town_cosmetics_set arguments; upload is the downscaled data URL for plan 'upload' (dropped unless valid) */
export function cosmeticsArgs(tok, change, plan, upload){
  const a = { p_token: tok };
  if(change.gear) a.p_gear = change.gear;
  if(change.petClear){ a.p_pet_clear = true; return a; }
  if(change.pet){ a.p_pet = change.pet; if(plan === 'upload' && petPhotoOk(upload) && upload.length <= PET_PHOTO_UP) a.p_photo = upload; else if(plan === 'clear') a.p_photo_clear = true; }
  return a;
}
/* the upload copy: encode(q) re-encodes the photo as a JPEG at quality q (the page draws it on a canvas, longest side 256 px, which drops EXIF); the first
   quality that fits PET_PHOTO_UP wins, null when none does */
export const PET_PHOTO_Q = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34, 0.26];
export function fitJpeg(encode, max = PET_PHOTO_UP){
  for(const q of PET_PHOTO_Q){ let u; try{ u = encode(q); }catch(e){ return null; } if(typeof u === 'string' && u.length <= max && petPhotoOk(u)) return u; }
  return null;
}
/* the copy kept in this browser: [longest side, JPEG quality] steps, the first under PET_PHOTO_LOCAL characters wins (photoSafe takes it below that) */
export const PET_PHOTO_LOCAL = 400000, PET_PHOTO_KEEP = [[1024, 0.86], [1024, 0.76], [768, 0.8], [512, 0.8], [256, 0.85]];
/* The shared copy, as large as the server's limit allows. The page crops the photo to the frame's shape, PET_PHOTO_ASPECT (width over height, the PW / PH
   of makePhotoFrame in pets.js), so no byte goes to what the frame would cut off, and encode(h, type, q) draws it h px high and encodes it. Each height in
   PET_PHOTO_SIDES is tried at PET_PHOTO_QS, WebP before JPEG: WebP looks the same at about two thirds of the size, and a browser that cannot encode it hands
   back PNG, which is skipped. The first that fits PET_PHOTO_UP wins; after the last height, fitJpeg's whole ladder at 256 px; null when nothing fits. */
export const PET_PHOTO_ASPECT = 0.19 / 0.24, PET_PHOTO_SIDES = [640, 560, 480, 400, 320], PET_PHOTO_QS = [0.86, 0.8, 0.74, 0.68];
export function fitPhoto(encode, max = PET_PHOTO_UP){
  for(const h of PET_PHOTO_SIDES) for(const type of ['image/webp', 'image/jpeg']) for(const q of PET_PHOTO_QS){
    let u; try{ u = encode(h, type, q); }catch(e){ return null; }
    if(typeof u !== 'string' || !u.startsWith('data:' + type + ';')) break;   /* the browser does not encode this type: the next one */
    if(u.length <= max && petPhotoOk(u)) return u;
  }
  return fitJpeg(q => encode(256, 'image/jpeg', q), max);
}
/* a procedural stand-in photo for the demos (no real photographs): a soft backdrop and a round face in the pet's coat colours */
export function demoPetPhoto(look, seed = 0){
  const L = normalizePetLook(look) || { kind: 'dog', coat: ['#d9b48f'] }, c = document.createElement('canvas'); c.width = 192; c.height = 240; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 240); g.addColorStop(0, seed % 2 ? '#cfe6f5' : '#f6dcc8'); g.addColorStop(1, seed % 2 ? '#f2ead9' : '#fff4e2'); x.fillStyle = g; x.fillRect(0, 0, 192, 240);
  const a = L.coat[0], b = L.coat[1] || a, cat = L.kind === 'cat';
  x.fillStyle = b; x.beginPath(); x.ellipse(96, 214, 70, 44, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = a; for(const s of [-1, 1]){ x.beginPath(); if(cat){ x.moveTo(96 + s * 22, 86); x.lineTo(96 + s * 58, 40); x.lineTo(96 + s * 62, 104); } else x.ellipse(96 + s * 50, 116, 16, 36, s * 0.35, 0, Math.PI * 2); x.fill(); }
  x.beginPath(); x.arc(96, 128, 52, 0, Math.PI * 2); x.fill();
  x.fillStyle = b; x.beginPath(); x.ellipse(96, 150, 26, 20, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#2d2323'; for(const s of [-1, 1]){ x.beginPath(); x.arc(96 + s * 19, 118, 5.5, 0, Math.PI * 2); x.fill(); } x.beginPath(); x.ellipse(96, 142, 7, 5, 0, 0, Math.PI * 2); x.fill();
  return c.toDataURL('image/jpeg', 0.8);
}

/* ── breeds (server: pet_breeds()). rows: [{ key, kind, en, ko, look }]; the clean list keeps valid rows, dogs first, each look normalized with its kind and
   breed key. An error or an empty list hides the breed select. ── */
export const BREED_KEY = /^[a-z0-9_]{1,32}$/;
export function breedList(rows){
  const ok = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r.key === 'string' && BREED_KEY.test(r.key) && PET_KINDS.includes(r.kind) && r.look && typeof r.look === 'object')
    .map(r => { const look = normalizePetLook({ ...r.look, kind: r.kind, breed: r.key }); return look ? { key: r.key, kind: r.kind, en: String(r.en || r.key).slice(0, 40), ko: String(r.ko || r.en || r.key).slice(0, 40), look } : null; }).filter(Boolean);
  const seen = new Set(); return PET_KINDS.flatMap(k => ok.filter(r => r.kind === k && !seen.has(r.key) && seen.add(r.key)));
}
export const breedName = (b, lang) => (b ? (/^ko/.test(lang || '') ? b.ko : b.en) || '' : '');
/* Coat colours for a pattern's roles (pets.js petCoatRoles), kept by position. A role the pattern needs and the coat lacks takes the colour the member last
   had there (mem) or one derived from the first colour: lighter for the white, belly and muzzle roles, darker otherwise. Optional roles stay as they are. */
const LIGHT_ROLES = new Set(['white', 'under', 'muzzle']);
export function petCoatFor(coat, roles, mem = []){
  const c0 = (coat && coat[0]) || mem[0] || '#d9b48f', out = [];
  roles.forEach((r, i) => { const c = (coat && coat[i]) || null; if(c) out.push(c); else if(!r.optional && out.length === i) out.push(mem[i] || mixHex(c0, LIGHT_ROLES.has(r.key) ? '#f3efe8' : '#3a2c22', LIGHT_ROLES.has(r.key) ? 0.75 : 0.45)); });
  return out.slice(0, roles.length);
}
/* Hit priority for a click or hover: list holds the clickable objects (desk items, photo frames, pets) with their projected centre x, y and radius r in px.
   The nearest object (by distance over radius) wins when the pointer is inside its radius (at least minR px); null leaves the person, team and server picking. */
export function objPick(px, py, list, minR = 10){
  let best = null, bk = Infinity;
  (list || []).forEach(e => { const r = Math.max(minR, Number(e.r) || 0), d = Math.hypot(e.x - px, e.y - py); if(d < r && d / r < bk){ bk = d / r; best = e; } });
  return best;
}
/* the pick radius is OBJ_R of an object's bounding sphere (close to its silhouette); a finger gets at least 22 px, a mouse 10 */
export const OBJ_R = 0.6;
export const pickMinR = type => (type === 'touch' || type === 'pen' ? 22 : 10);
/* A tap on a moving object: down is the object taken at the press (null when the press missed every object), now its entry in the list at the release
   (null when it is gone). 'open' when the release is still within 1.5 times its radius, 'keep' when the press began on an object but the release is away from
   it (nothing happens: no person behind it, no closing the drawer), 'pass' when the press began on no object (people, teams and the server as before). */
export function objTap(down, now, px, py, minR = 10){
  if(!down) return 'pass';
  return now && Math.hypot(now.x - px, now.y - py) <= 1.5 * Math.max(minR, Number(now.r) || 0) ? 'open' : 'keep';
}
/* The home camera (theta0 = pi/4, the office's default view) looks along -x and -z, 30 degrees down: a floor point is seen when the line from it toward the
   camera (horizontal direction dir, rising slope per unit) passes over every box [x0, z0, x1, z1, top] it crosses. A point inside a box is not seen. */
export const HOME_DIR = [Math.SQRT1_2, Math.SQRT1_2], HOME_SLOPE = 16.6 / Math.hypot(20, 20);
export function floorSeen(x, z, boxes, dir = HOME_DIR, slope = HOME_SLOPE, h0 = 0){
  for(const b of boxes || []){
    const [x0, z0, x1, z1, top] = b; if(!(top > h0)) continue;
    let s0 = 0, s1 = (top - h0) / slope;   /* the stretch of the line still under the box's top */
    for(const [p, d, lo, hi] of [[x, dir[0], x0, x1], [z, dir[1], z0, z1]]){
      if(Math.abs(d) < 1e-9){ if(p < lo || p > hi){ s0 = 1; s1 = 0; } continue; }
      let a = (lo - p) / d, c = (hi - p) / d; if(a > c){ const w = a; a = c; c = w; } s0 = Math.max(s0, a); s1 = Math.min(s1, c);
    }
    if(s0 <= s1) return false;
  }
  return true;
}
export const playSeen = (pts, boxes) => (pts || []).every(([x, z]) => floorSeen(x, z, boxes));
/* the hop's horizontal progress at flight fraction f: going up it lags (the pet rises before it moves over the desk's edge), coming down it leads */
export const hopAlong = (f, up) => { const u = Math.min(1, Math.max(0, f)); return up ? u ** 2.2 : 1 - (1 - u) ** 2.2; };
/* the shop's message after a save: a pet with a photo says who sees the photo (a private photo stays mine, a shared one shows in my desk frame to coworkers) */
export function saveMsgKey(change, extra){
  if(change && change.petClear) return 'pet.removed';
  if(!change || !change.pet || !extra || !extra.photo) return 'saved';
  return extra.share === true ? 'saved.shared' : 'saved.private';
}
/* the coat textures for the form (pets.js PET_FURS; the first is the standard coat, which writes no key) */
export const PET_FUR_LIST = Array.isArray(PETS_NS.PET_FURS) && PETS_NS.PET_FURS.length ? PETS_NS.PET_FURS.slice() : ['plush', 'curly', 'silky'];

const numOrNaN = v => (v == null ? NaN : Number(v));
/* Total usage over a set of machines (team_member_usage rows): per day, the gateway figure once per hash, plus total (else spent) of the rest;
 * a machine without series adds its own total once. Returns { total, days: { day: [spend, saved] } }. The office mapper and the town's team table share it. */
export function usageTotal(us){
  const acc = {}; let total = 0;
  us.forEach(u => {
    const ser = Array.isArray(u.series) ? u.series : [], h = u.gateway_user_hash || null;
    if(!ser.length){ total += Number(u.total_spent ?? u.spent) || 0; return; }
    ser.forEach(q => {
      const d = acc[q.day] || (acc[q.day] = { plain: 0, gw: {}, saved: 0 }), g = numOrNaN(q.gateway);
      d.saved += Number(q.saved) || 0;
      if(h && Number.isFinite(g)) d.gw[h] = Math.max(d.gw[h] ?? 0, g); else d.plain += Number(q.total ?? q.spent) || 0;
    });
  });
  const days = {};
  Object.entries(acc).forEach(([d, x]) => { const v = x.plain + Object.values(x.gw).reduce((a, b) => a + b, 0); days[d] = [v, x.saved]; total += v; });
  return { total, days };
}

/* One machine's usage cut to the days since install (u.since, from team_member_usage). Savings only exist after install, so a rate over the
 * whole range is diluted by spend from before it. Money shown to users stays on the full figures; only rate denominators (and the delegation
 * cost beside them) use this. An old server sends no since: the row comes back unchanged. admin-ux.js keeps an identical copy (pinned by test/usage-since.test.js). */
export function sinceUsage(u){
  if(!u || !u.since || !Array.isArray(u.series)) return u;
  const cut = String(u.since).slice(0, 10), kept = u.series.filter(q => String(q.day).slice(0, 10) >= cut), fin = v => v != null && Number.isFinite(Number(v));
  let spent = 0, saved = 0, total = 0, gw = null, dc = null;
  kept.forEach(q => {
    spent += Number(q.spent) || 0; saved += Number(q.saved) || 0; total += Number(q.total ?? q.spent) || 0;
    if(fin(q.gateway)) gw = (gw || 0) + Number(q.gateway);
    if(fin(q.delegated_cost)) dc = (dc || 0) + Number(q.delegated_cost);
  });
  return { ...u, series: kept, spent, saved, total_spent: total, gateway_spent: gw, delegated_cost: dc };
}

/* Work share of an organization or a team: the share of the work sprag handled, (delegation cost + saved) over (spend + saved), because
 * delegation cost plus savings is what the delegated work would have cost without sprag. With since-install figures (since = true) base is spend
 * since install; without them (an old server) it is the plain delegation cost over spend. null when the cost is unknown or the denominator is 0.
 * admin-ux.js keeps the same rule in workShare (pinned by test/dashboard-followups.test.js). */
export function workShareOf(dc, saved, base, since){
  if(!Number.isFinite(dc)) return null;
  const sv = since ? (Number(saved) || 0) : 0, den = (Number(base) || 0) + sv;
  return den > 0 ? (dc + sv) / den : null;
}

/* Shared data mapper for both pages: one person per seat host (a host plus the machines merged into it), over the page's date range.
 * o: { rows (org_seats), usage ({machine member_id: {spent, saved, delegated, families?, total_spent?, local_spent?, gateway_spent?, gateway_user_hash?,
 *      delegated_cost?, codex_delegated?, unpriced?, series?}}), promptRows (org_prompt_usage members, or null), cosmetics (org_cosmetics: [{ member_id, lvl, gear, pet, toys? }], optional),
 *      toysLvl (optional: the level from which pets play with toys, when the rows carry no toys flag),
 *      teams, used, limit, orgName, rangeLabel, closed, demoBubbles ([{text, ai}] or null), t(key, vars, raw), rel(iso) }
 * Spend is the person's total usage: per day, the gateway (LiteLLM) figure counted once per gateway_user_hash (two machines of one person
 *   share it), plus the total (else local spend) of every machine without a gateway figure that day. Old rows without the new keys fall back to spent.
 * Grades (see GRADES): percentile score = .5 spend + .3 delegation share (delegated_cost / total usage) + .2 prompts (renormalized without prompts, W_NOPR);
 *   a person none of whose machines sent delegated_cost has an unknown share: it ranks as 0, never meets the delegation rule, and is left out of the medians.
 *   The tier follows the grade: power = top 20% with delegation >= median, active = top half, normal = above the bottom 25%, low = bottom 25% or no spend and no prompts.
 *   With fewer than SMALL_TEAM.n ranked people the score percentile is squeezed into [0.3, 0.7] (squeezeSr), so only the normal and active tiers are reachable and only an idle person is low;
 *   the ranking, the score and the crown stay as they are, and the full ladder opens at SMALL_TEAM.n people. Grading and the drawer's company median are one value: median() of the known delegation shares.
 * Ranked: an unsuspended organization ranks every person with a machine in signal ok or late, so a quiet weekend keeps the animal while the month's data stands (the server's _office_standings is the same rule).
 * No data: a person whose machines are all paused or silent is 'nodata' and stays out of the ranking. */
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
  const num = numOrNaN;
  let totSaved = 0;
  Object.values(usage).forEach(u => { totSaved += Number(u.saved) || 0; });
  const totSpent = usageTotal(Object.values(usage)).total;
  const all = [...groups.entries()].map(([key, rs]) => {
    rs.sort((a, b) => (a.member_id === key ? -1 : 0) - (b.member_id === key ? -1 : 0));
    const host = rs[0], mix = { haiku: 0, sonnet: 0, opus: 0 };
    let local = 0, saved = 0, runs = 0, fam = false, models = null, today = 0, errors = 0, savedToday = 0, delToday = null;
    let dcost = null, codexRuns = 0, unpriced = 0; const todayGw = {};
    const { total: spent, days } = usageTotal(rs.map(r => usage[r.member_id] || {}));
    rs.forEach(r => {
      { const u1 = usage[r.member_id] || {}; savedToday += Number(u1.saved_today) || 0; if(u1.delegated_today != null) delToday = (delToday || 0) + (Number(u1.delegated_today) || 0); }
      errors += Number((usage[r.member_id] || {}).errors) || 0;
      const u = usage[r.member_id] || {}; local += Number(u.local_spent ?? u.spent) || 0; saved += Number(u.saved) || 0; runs += Number(u.delegated) || 0;
      { const tdy = Number(u.total_spent_today ?? u.spent_today) || 0, h = u.gateway_user_hash || null;
        if(h && Number.isFinite(num(u.gateway_spent))) todayGw[h] = Math.max(todayGw[h] ?? 0, tdy); else today += tdy; }
      { const c = num(u.delegated_cost); if(Number.isFinite(c)) dcost = (dcost || 0) + c; }
      codexRuns += Number(u.codex_delegated) || 0; unpriced += Number(u.unpriced) || 0;
      if(u.models && typeof u.models === 'object') Object.entries(u.models).forEach(([k, v]) => { const n = Number(v); if(Number.isFinite(n) && n > 0){ models = models || {}; models[k] = (models[k] || 0) + n; } });
      const f = u.families; if(f) Object.keys(mix).forEach(k => { const n = Number(f[k]) || 0; if(n){ mix[k] += n; orgMix[k] += n; fam = true; } });
    });
    let prompts = 0, promptId = null, chars = 0, lastPrompt = null; const pdays = {};
    if(pr) rs.forEach(r => { const p = pr.find(x => x.member_id === r.member_id) || pr.find(x => x.display_name && x.display_name === r.display_name); if(p){ prompts += Number(p.prompts) || 0; chars += Number(p.chars) || 0; promptId = promptId || p.member_id;
      if(p.last_prompt_at && (!lastPrompt || p.last_prompt_at > lastPrompt)) lastPrompt = p.last_prompt_at; (p.by_day || []).forEach(q => { pdays[q.day] = (pdays[q.day] || 0) + (Number(q.prompts) || 0); }); } });
    today += Object.values(todayGw).reduce((a, b) => a + b, 0);
    /* since-install figures: the HUD's org delegation share, and p.dlg, the delegation axis of the ranks and grades: savings over spend plus savings from the day
       each machine joined (sprag-team 20261116000400 _office_standings). Spend for the spend axis keeps the whole period. A server without `since` gives full-range figures. */
    const sinceUs = rs.map(r => sinceUsage(usage[r.member_id] || {})), spentSince = usageTotal(sinceUs).total;
    let dcostSince = null, savedSince = 0; sinceUs.forEach(u => { const c = num(u.delegated_cost); if(Number.isFinite(c)) dcostSince = (dcostSince || 0) + c; savedSince += Number(u.saved) || 0; });
    const hasSince = rs.some(r => { const u0 = usage[r.member_id]; return !!(u0 && u0.since && Array.isArray(u0.series)); });
    return { id: key, host, rs, spent, spentSince, dcostSince, savedSince, hasSince, local, dcost, codexRuns, unpriced, saved, runs, today, savedToday, delToday, errors, days, pdays, chars, lastPrompt,
      mix: fam ? mix : null, models, prompts, promptId, ok: !closed && rs.some(r => r.signal === 'ok' || r.signal === 'late'), dlg: spentSince + savedSince > 0 ? savedSince / (spentSince + savedSince) : 0 };
  });
  all.sort((a, b) => b.spent - a.spent);
  const shown = all.slice(0, MAXP), more = all.length - shown.length;
  const ranked = all.filter(p => p.ok), n = ranked.length;
  const rank = (arr, v) => { if(n < 2) return 0.5; let lo = 0, eq = 0; arr.forEach(x => { if(x < v) lo++; else if(x === v) eq++; }); return (lo + (eq - 1) / 2) / (n - 1); };
  /* the delegation share is never unknown now (0 with nothing since the install); an older shape's null still ranks as 0 and stays out of the medians */
  const sp = ranked.map(p => p.spent), dl = ranked.map(p => p.dlg ?? 0), pm = ranked.map(p => p.prompts), w = pr ? W_FULL : W_NOPR;
  const dlKnown = ranked.map(p => p.dlg).filter(x => x != null);
  const median = a => { if(!a.length) return 0; const q = [...a].sort((x, y) => x - y), m = Math.floor(q.length / 2); return q.length % 2 ? q[m] : (q[m - 1] + q[m]) / 2; };
  ranked.forEach(p => { p.score = w[0] * rank(sp, p.spent) + w[1] * rank(dl, p.dlg ?? 0) + (pr ? w[2] * rank(pm, p.prompts) : 0); });
  const sc = ranked.map(p => p.score), med = median(dlKnown);
  ranked.forEach(p => { p.sr = squeezeSr(rank(sc, p.score), n); p.idle = p.spent < 0.01 && (!pr || !p.prompts); p.grade = gradeOf(p.sr, p.dlg, med, p.idle); p.tier = tierOfGrade(p.grade); });
  /* standings: rank 1 is the highest score (ties share a rank); the crown goes to rank 1 when at least two people are ranked and they spent something */
  ranked.forEach(p => { p.rank = 1 + ranked.filter(q => q.score > p.score + 1e-12).length; p.crown = n >= 2 && p.rank === 1 && !p.idle; });
  const pc = x => Math.round(x * 100) + '%', pcN = x => (x == null ? t('of.unknown') : pc(x)), mixTot = Object.values(orgMix).reduce((a, b) => a + b, 0);
  const famOf = m => { const s = m ? Object.entries(m).sort((a, b) => b[1] - a[1]) : []; return s[0] && s[0][1] > 0 ? s[0][0] : null; };
  const newestOs = rs => { const r = [...rs].sort((a, b) => String(b.last_seen || b.last_upload_at || '').localeCompare(String(a.last_seen || a.last_upload_at || ''))).find(x => x.os); return r ? String(r.os) : ''; };   /* a person on several computers shows the newest one's OS */
  const botsFor = p => {
    const k = p.runs <= 0 ? 0 : p.runs < 5 ? 1 : p.runs < 20 ? 2 : 3;
    const m = p.mix || (mixTot ? orgMix : null), tot = m ? Object.values(m).reduce((a, b) => a + b, 0) : 0;
    return Array.from({ length: k }, (_, j) => {
      if(!tot) return 'any';
      let acc = 0; const x = (j + 0.5) / k * tot;
      for(const [f, v] of Object.entries(m).sort((a, b) => b[1] - a[1])){ acc += v; if(x <= acc && v > 0) return f; }
      return 'any';
    });
  };
  const orgM = { spent: median(sp), dlg: median(dlKnown), prompts: median(pm) }, teamM = {};
  teams.forEach(tm => { const r = ranked.filter(x => x.host.team_id === tm.id); teamM[tm.id] = { spent: median(r.map(x => x.spent)), dlg: median(r.map(x => x.dlg).filter(x => x != null)), prompts: median(r.map(x => x.prompts)) }; });
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
    const g = GRADES[gi - 1], small = n < SMALL_TEAM.n, span = small ? SMALL_TEAM.hi - SMALL_TEAM.lo : 1;
    if(small && g.minSr > SMALL_TEAM.hi + SR_EPS){ out.push(t('of.d.next.small', { k: SMALL_TEAM.n }, true)); return out; }
    const x = Math.max(0, Math.ceil((g.minSr - p.sr) / span * (n - 1) - 1e-6)), dl = g.needDlg && !(p.dlg != null && p.dlg >= med), v = { x: Math.max(1, x), s: gn(g.k), c: pc(med) };
    out.push(t(dl ? (x ? 'of.d.next.xd' : 'of.d.next.d') : 'of.d.next', v, true));
    return out;
  };
  let demoI = 0;
  /* cosmetics (org_cosmetics: [{ member_id (the seat group key), lvl, gear, pet }]); a person without a row keeps a pet a machine row carries (the demo) */
  const cosm = new Map((Array.isArray(o.cosmetics) ? o.cosmetics : []).filter(c => c && c.member_id != null).map(c => [c.member_id, c]));
  const people = shown.map(p => {
    const nodata = !p.ok; p.tier = nodata ? 'nodata' : p.tier; p.grade = nodata ? 'ghost' : p.grade;
    const paused = p.rs.find(r => r.signal === 'paused'), lastUp = p.rs.map(r => r.last_upload_at).filter(Boolean).sort().pop();
    const why = paused ? t('of.why.paused', { x: o.rel(paused.sync_state_at) }, true) : t('of.why.last', { x: lastUp ? o.rel(lastUp) : t('never') }, true);
    const tip = [[t('of.team'), p.host.team_name || '']];
    if(closed) tip.push([t('of.total'), money(p.spent)]);
    else if(nodata) tip.push([t('of.why'), why]);
    else { tip.push([t('of.total'), money(p.spent)]); if(pr) tip.push([t('of.prompts'), String(p.prompts)]); tip.push([t('of.deleg'), pcN(p.dlg)]); }
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
    const cos = cosmeticsOf(cosm.get(p.id) || { pet: (p.rs.find(r => r.pet) || {}).pet || null }, { off: closed || nodata, toysLvl: o.toysLvl, keepPet: true });
    return { id: p.id, name: p.host.display_name || p.id, os: newestOs(p.rs), ...cos, teamId: p.host.team_id, teamName: p.host.team_name || '', tier: p.tier, grade: p.grade, gradeText: t('of.g.' + p.grade),
      gradeLabel: closed ? t('of.tag.closed') : noText + t('of.g.' + p.grade) + ' · ' + t('of.tier.' + p.tier), rank: nodata ? 0 : p.rank, crown: !nodata && !closed && !!p.crown, spent: p.spent, promptId: p.promptId, tip,
      detail: (() => {
        const ids2 = new Set(p.rs.map(r => r.member_id)), tm = teamM[p.host.team_id] || { spent: 0, dlg: 0, prompts: 0 }, dd = Object.keys(p.days).sort(), pd = Object.keys(p.pdays).sort();
        const lastP = p.lastPrompt ? o.rel(p.lastPrompt) : t('never');
        const hasData = !nodata && !closed;
        const pRows = [[t('of.total'), money(p.spent) + (p.unpriced > 0 ? ' · ' + t('of.unpriced') : '')]]
          .concat([[t('of.dcost'), p.dcost == null ? t('of.unknown') : money(p.dcost)], [t('of.saved'), money(p.saved)], [t('of.deleg'), pcN(p.dlg) + (p.dlg != null ? ' (' + t('of.d.dlgall') + ')' : '')], [t('of.runs'), String(p.runs)], [t('of.d.errors'), String(p.errors)]])
          .concat(pr ? [[t('of.prompts'), String(p.prompts)], [t('of.d.days'), String(pd.length)], [t('of.d.avg'), p.prompts ? t('pu.chars', { n: Math.round(p.chars / p.prompts) }, true) : t('of.unknown')], [t('of.d.lastp'), lastP]] : []);
        const tRows = [[t('of.d.today'), money(p.today)], [t('of.d.today.s'), money(p.savedToday)], [t('of.d.today.r'), p.delToday == null ? t('of.unknown') : String(p.delToday)]];
        const groups = hasData ? [{ title: t('of.d.period', { x: o.rangeLabel }, true), rows: pRows }, { title: t('of.d.today.h'), rows: tRows }] : [], grid = hasData ? pRows.concat(tRows) : [];
        const mk3 = (v1, v2, v3, f, nm) => [{ name: t('of.d.me'), v: v1, txt: f(v1), color: '#7c6cf0' }, { name: t('of.d.team'), v: v2, txt: f(v2), color: '#8ec5fb' }, { name: t('of.d.org'), v: v3, txt: f(v3), color: '#d4c7a8' }];
        const dlgMe = mk3(p.dlg ?? 0, tm.dlg, orgM.dlg, pc); if(p.dlg == null) dlgMe[0].txt = t('of.unknown');
        const cmp = hasData ? [{ label: t('of.total'), items: mk3(p.spent, tm.spent, orgM.spent, money) }, { label: t('of.deleg'), items: dlgMe }].concat(pr ? [{ label: t('of.prompts'), items: mk3(p.prompts, tm.prompts, orgM.prompts, v => String(Math.round(v))) }] : []) : [];
        const evs = (o.events || []).filter(e => ids2.has(e.member_id)).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8).map(e => ({ text: t('of.ev.' + e.event) === 'of.ev.' + e.event ? String(e.event) : t('of.ev.' + e.event), when: o.rel(e.at) }));
        return { next: hasData ? standing(p) : [], why: hasData ? t('of.d.why', { a: Math.max(1, Math.round((1 - rank(sp, p.spent)) * 100)), b: pcN(p.dlg), c: pc(orgM.dlg) }, true) : closed ? t('of.tag.closed') : t('of.why') + ': ' + why,
          grid, groups, cmp, fam: p.mix, models: p.models, modelsMissing: p.local > 0 && !p.models, fmt: money, days: hasData ? dd : [], spent: dd.map(d => p.days[d][0]), saved: dd.map(d => p.days[d][1]),
          pdays: hasData && pr ? pd : [], pvals: pd.map(d => p.pdays[d]),
          machines: p.rs.map(r => ({ name: r.display_name || r.member_id, os: o.os(r), ver: r.sprag_version ? 'v' + r.sprag_version : '', color: SIG[r.signal] || '#8a8794', sig: t('sr.s.' + r.signal), sw: t('sr.sw.' + (r.switch === 'off' ? 'off' : 'on')), up: r.last_upload_at ? o.rel(r.last_upload_at) : t('never'), seen: r.last_seen ? o.rel(r.last_seen) : t('never') })),
          events: evs, canPrompts: !!(pr && p.promptId) };
      })(),
      tierText: closed ? t('of.tag.closed') : t('of.tier.' + p.tier), tag: closed ? '' : nodata ? t(late ? 'of.tag.late' : 'of.tag.off') : '', bots: nodata ? [] : botsFor(p), bubbles };
  });
  const cnt = k => people.filter(m => m.tier === k).length, used = Number(o.used) || 0, limit = Number(o.limit) || 0, free = limit > used ? limit - used : 0;
  const active = people.length - cnt('nodata'), act = ranked.length ? (cnt('power') + 0.6 * cnt('active') + 0.25 * cnt('normal')) / ranked.length : 0;
  /* the HUD's org figure is the work share (workShareOf) on spend since install (sinceUsage), so pre-install days do not dilute it; the person's own dlg stays full-range */
  const dRows = ranked.filter(p => p.dcostSince != null), dSince = dRows.some(p => p.hasSince);
  const orgWs = dRows.length ? workShareOf(dRows.reduce((a, p) => a + p.dcostSince, 0), dRows.reduce((a, p) => a + p.savedSince, 0), dRows.reduce((a, p) => a + p.spentSince, 0), dSince) : null;
  const orgDlg = orgWs == null ? t('of.unknown') : pc(orgWs);
  const stats = closed ? t('of.hud.closed', { u: used, limit }, true)
    : t('of.hud', { s: money(totSaved), d: orgDlg, n: active, p: cnt('power'), l: cnt('low'), o: cnt('nodata'), u: used, limit }, true);
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
    note: t('of.book.note', { s: fw(W_FULL[0]), d: fw(W_FULL[1]), p: fw(W_FULL[2]), s2: fw(W_NOPR[0]), d2: fw(W_NOPR[1]) }, true),
    small: n >= 2 && n < SMALL_TEAM.n ? t('of.book.small', { k: SMALL_TEAM.n }, true) : '' };
  const ui = Object.fromEntries(Object.entries({ fs: 'of.fs', fsExit: 'of.fs.exit', close: 'of.close', hint: 'of.hint', reset: 'of.reset', turnL: 'of.turnL', turnR: 'of.turnR', zoomIn: 'of.zoomIn', zoomOut: 'of.zoomOut', total: 'of.d.total', back: 'of.back', runs: 'of.runs', models: 'of.d.models', modelsNone: 'of.d.models.none', daily: 'of.d.daily', pdaily: 'of.d.pdaily', seats: 'of.d.seats', prompts: 'of.d.prompts', cmp: 'of.d.cmp', machines: 'of.d.machines', up: 'of.d.up', seen: 'of.d.seen', events: 'of.d.events', spent: 'of.total', saved: 'of.saved', none: 'of.d.none', pname: 'of.prompts', book: 'of.book', lv: 'of.lv' }).map(([k, v]) => [k, t(v)])); ui.view = viewUi(t);
  return { ui, teams, people, free, freeLabel: free ? t('of.free', { n: free }, true) : '', more: Math.max(0, more), moreLabel: more > 0 ? t('of.more', { n: more }, true) : '', closed,
    server: { label: closed ? t('of.server') + ' · ' + t('of.tag.closed') : t('of.server') + ' · ' + t('of.total') + ' ' + money(totSpent) + ' · ' + t('of.saved') + ' ' + money(totSaved) },
    activity: act, book, hud: { title: o.orgName + ' ' + t('of.town') + ' · ' + o.rangeLabel, stats, closed: t('of.tag.closed') }, legend, strip,
    aria: t('of.aria', { n: people.length, teams: teams.length, used, limit }, true) };
}

/* The member town: the same scene for someone who is not an admin, from the town_view reply (the server has already cut every other person's figures).
 * v: { org:{name,closed,seats_used,seat_limit}, range:{from,to}, teams:[{id,name}], people:[{id,name,os,team_id,team_name,grade,tier,crown,state,self}],
 *      self:{id, standing, machines, usage, prompts, unlock?, gear?, pet?}, has_prompts }.  o: { t(key, vars, raw), rel(iso), os(machine row), rangeLabel?, petPhoto? }.
 * Returns what officeSceneData returns, so mountOfficeScene(box, data, { readOnly: true }) draws it.
 * The viewer is computed by officeSceneData from their own machines and usage (so their drawer shows everything an owner would see), then grade, tier, rank, crown and the
 * "what is next" lines are replaced by the server's standing: a one-person computation would rank them first of one. The team and company medians (detail.cmp) are dropped,
 * since in a small team a median is one person's figure. Everyone else is a character only: name, species, tier, crown, team, OS and state, plus the cosmetics the
 * server sends (unlock level, gear ids and the pet look, never a photo and never the figures behind the level). They carry rank 0, no spend,
 * no robots, no bubbles and a detail flagged redacted, so the scene has no number to draw for them. Nothing here adds up or estimates anyone's figures.
 * Cosmetics: people[].lvl, gear and pet (an old server sends none: level 0, nothing worn); self.unlock (the viewer's own level, figures since joining,
 * thresholds and item list) becomes data.shop; self.gear and self.pet are the viewer's choices, and o.petPhoto (kept by the page in this browser) is the
 * viewer's pet photo for the desk frame.
 * The species number in a label ("No.07") is the position in the field guide, not a figure. The HUD, the legend and the server label carry counts and names, never money. */
export function memberTownData(v, o){
  const t = o.t, org = v.org || {}, closed = !!org.closed, sf = v.self || {}, st = sf.standing || {};
  const used = Number(org.seats_used) || 0, limit = Number(org.seat_limit) || 0, free = limit > used ? limit - used : 0;
  const teams = (v.teams || []).map(x => ({ id: x.id, name: x.name }));
  const rangeLabel = o.rangeLabel || (v.range && v.range.from ? v.range.from + ' ~ ' + v.range.to : '');
  const list = v.people || [], selfP = list.find(p => p.self) || list.find(p => p.id === sf.id) || null;
  const pc = x => Math.round(x * 100) + '%', fin = x => (x != null && Number.isFinite(Number(x)) ? Number(x) : null);
  const gn = k => t('of.g.' + k);
  const noText = k => { const i = gradeIndex(k) + 1; return i ? t('of.g.no', { n: String(i).padStart(2, '0') }, true) + ' ' : ''; };
  const labelOf = (grade, tier) => (closed ? t('of.tag.closed') : noText(grade) + gn(grade) + ' · ' + t('of.tier.' + tier));
  const tagOf = (tier, state) => (closed ? '' : tier === 'nodata' ? t(state === 'late' ? 'of.tag.late' : 'of.tag.off') : '');
  const stateText = s => t('sr.s.' + (s === 'late' || s === 'paused' ? s : 'ok'));
  const tierOf = p => (closed || !p.tier || p.tier === 'nodata' || p.grade === 'ghost' ? 'nodata' : p.tier);
  /* cosmetics: everyone carries the level, the gear and the pet look the server sent (never a figure); the viewer's pet adds the photo kept in this browser */
  const un = sf.unlock && typeof sf.unlock === 'object' ? sf.unlock : null, toysLvl = un && un.toys_lvl != null ? un.toys_lvl : null;
  /* anyone but the viewer: a character with no figures */
  const mini = p => {
    const tier = tierOf(p), grade = tier === 'nodata' ? 'ghost' : p.grade;
    return { id: p.id, name: p.name || p.id, self: false, os: p.os || '', ...cosmeticsOf(p, { off: closed || tier === 'nodata', toysLvl }), teamId: p.team_id, teamName: p.team_name || '', tier, grade, gradeText: gn(grade), gradeLabel: labelOf(grade, tier),
      rank: 0, crown: !closed && tier !== 'nodata' && !!p.crown, spent: 0, promptId: null,
      tip: closed ? [[t('of.team'), p.team_name || '']] : [[t('of.team'), p.team_name || ''], [t('of.state'), stateText(p.state)]],
      detail: { next: [], why: '', grid: [], groups: [], cmp: [], fam: null, models: null, modelsMissing: false, fmt: String, days: [], spent: [], saved: [], pdays: [], pvals: [], machines: [], events: [], canPrompts: false, redacted: true },
      tierText: closed ? t('of.tag.closed') : t('of.tier.' + tier), tag: tagOf(tier, p.state), bots: [], bubbles: [] };
  };
  /* the viewer: their own machines and usage through the shared mapper, merged into one person (the seat host's id is self.id) */
  const LIVE = ['ok', 'late', 'paused', 'silent'], you = ' (' + t('of.you') + ')';   /* the scene has no highlight of its own: the name carries the marker, and the page opens the viewer's drawer (selection ring) */
  const ms = (sf.machines || []).map(r => ({ ...r, team_id: selfP && selfP.team_id, team_name: selfP && selfP.team_name }));
  const hostM = ms.find(r => r.member_id === sf.id) || ms[0];
  ms.forEach(r => { if(hostM && r !== hostM) r.seat_of = hostM.member_id; });
  const usage = {}; (sf.usage || []).forEach(u => { usage[u.member_id] = u; });
  let promptRows = null;
  if(v.has_prompts || sf.prompts){
    const pm = ms.filter(r => LIVE.includes(r.signal)).sort((a, b) => (a === hostM ? -1 : 0) - (b === hostM ? -1 : 0))[0], q = sf.prompts || {};
    promptRows = pm ? [{ member_id: pm.member_id, prompts: q.prompts || 0, chars: q.chars || 0, last_prompt_at: q.last_prompt_at || null, by_day: q.by_day || [] }] : [];
  }
  const base = officeSceneData({ rows: ms, usage, promptRows, teams, used, limit, orgName: org.name || '', rangeLabel, closed, demoBubbles: null, events: [], t, rel: o.rel, os: o.os });
  let me = null, stored = null;   /* stored: the viewer's saved gear and pet whether or not they are drawn (the shop edits these) */
  if(selfP){
    const own = base.people.find(p => p.id === sf.id) || base.people[0] || null, tier = tierOf({ tier: st.tier || selfP.tier, grade: st.grade || selfP.grade });
    const grade = tier === 'nodata' ? 'ghost' : (st.grade || selfP.grade), rank = tier === 'nodata' ? 0 : Number(st.rank) || 0, ranked = Number(st.ranked) || 0;
    const crown = !closed && tier !== 'nodata' && !!(selfP.crown ?? st.crown), med = fin(st.median_dlg), dlg = fin(st.dlg), medTxt = med == null ? t('of.unknown') : pc(med);
    const lines = [];
    if(tier !== 'nodata' && !closed){
      if(rank && ranked) lines.push(t('of.d.rank', { r: rank, n: ranked }, true));
      if(crown) lines.push(t('of.d.crown'));
      const nx = st.next && typeof st.next === 'object' && st.next.grade ? st.next : null;
      if(st.idle === true) lines.push(t('of.d.next.idle'));
      else if(nx){ const x = Math.max(0, Number(nx.pass) || 0); lines.push(t(nx.need_dlg ? (x ? 'of.d.next.xd' : 'of.d.next.d') : 'of.d.next', { x: Math.max(1, x), s: gn(nx.grade), c: medTxt }, true)); }
      else if(gradeIndex(grade) === 0) lines.push(t('of.d.top'));
      else if(ranked < SMALL_TEAM.n) lines.push(t('of.d.next.small', { k: SMALL_TEAM.n }, true));
    }
    const sr = Number(st.spend_rank) || 0;
    const why = tier !== 'nodata' && !closed && sr >= 1 && ranked >= 1 ? t('of.d.why', { a: Math.max(1, Math.round((sr - 1) / Math.max(1, ranked - 1) * 100)), b: dlg == null ? t('of.unknown') : pc(dlg), c: medTxt }, true) : '';
    if(own){
      /* the server's ids are opaque (not member ids), so the viewer takes the id the people list uses for them */
      me = { ...own, id: selfP.id, name: (selfP.name || own.name) + you, self: true, tier, grade, gradeText: gn(grade), gradeLabel: labelOf(grade, tier), rank, crown, promptId: null,
        tierText: closed ? t('of.tag.closed') : t('of.tier.' + tier), tag: tagOf(tier, selfP.state), os: own.os || selfP.os || '',
        tip: own.tip.filter(r => r[0] !== t('of.d.rankk')).concat(rank && ranked ? [[t('of.d.rankk'), t('of.book.rank', { r: rank }, true) + ' / ' + ranked]] : []),
        detail: { ...own.detail, cmp: [], canPrompts: false, redacted: false, next: lines, why: tier === 'nodata' || closed ? own.detail.why : why } };
    } else {
      const m0 = mini(selfP);
      me = { ...m0, name: m0.name + you, self: true, detail: { ...m0.detail, why: t('of.d.none'), redacted: false } };
    }
    const mine = { lvl: un ? un.level : selfP.lvl, gear: sf.gear || selfP.gear, pet: sf.pet !== undefined ? sf.pet : selfP.pet, photo: sf.photo !== undefined ? sf.photo : selfP.photo };
    const withPhoto = c => { if(c.pet && typeof o.petPhoto === 'string' && /^data:image\//.test(o.petPhoto)) c.pet = { ...c.pet, photo: o.petPhoto }; return c; };
    const mc = withPhoto(cosmeticsOf(mine, { off: closed || me.tier === 'nodata', toysLvl }));
    /* the shop edits what is stored, drawn or not: a paused member's animal is a ghost that wears nothing, but opening the shop with empty choices and saving
       would overwrite the stored pet and gear with defaults */
    stored = withPhoto(cosmeticsOf(mine, { toysLvl }));
    Object.assign(me, mc);
  }
  let people = list.map(p => (p === selfP && me ? me : mini(p)));
  if(selfP && !list.includes(selfP) && me) people.push(me);
  let more = 0;
  if(people.length > MAXP){ const rest = people.filter(p => !p.self).slice(0, MAXP - 1); more = people.length - MAXP; people = people.filter(p => p.self).concat(rest); }
  const cnt = k => people.filter(m => m.tier === k).length, active = people.length - cnt('nodata');
  const act = active ? (cnt('power') + 0.6 * cnt('active') + 0.25 * cnt('normal')) / active : 0;
  const stats = closed ? t('of.hud.closed', { u: used, limit }, true) : t('of.hud.town', { n: active, p: cnt('power'), l: cnt('low'), o: cnt('nodata'), u: used, limit }, true);
  const cntG = k => people.filter(m => m.grade === k).length, fw = x => String(Math.round(x * 1000) / 10);
  const bands = gradeBands(), tierN = tr => bands.filter(b => b.tier === tr).length, found = bands.filter(b => cntG(b.k)).length;
  const strip = closed ? null : { title: t('of.lg.strip', { f: found, n: GRADES.length }, true),
    tiers: TIERS.map(tr => ({ tier: tr, label: t('of.tier.' + tr), items: bands.filter(b => b.tier === tr).map(b => ({ k: b.k, name: gn(b.k), n: cntG(b.k) })) })) };
  const botsKey = (base.legend || []).find(l => l.bots);
  const legend = closed ? [] : (people.some(m => m.crown) ? [{ k: 'crown', label: t('of.lg.crown') }] : []).concat([{ k: 'ghost', label: t('of.lg.ghost') },
    { bots: true, label: t('of.lg.bots'), fams: botsKey ? botsKey.fams : [] }, { label: t('of.lg.screen') }]);
  const rk = me && me.rank ? [{ id: me.id, name: me.name, k: me.grade, gname: gn(me.grade), team: me.teamName, crown: me.crown, rk: t('of.book.rank', { r: me.rank }, true) }] : [];
  const rankedN = Number(st.ranked) || 0;
  const book = closed ? null : { title: t('of.book'), range: rangeLabel, found: t('of.book.found', { f: found, n: GRADES.length }, true),
    tiers: Object.fromEntries(TIERS.map(tr => [tr, t('of.book.tier', { t: t('of.tier.' + tr), n: tierN(tr) }, true)]).concat([['nodata', t('of.tier.nodata')]])),
    top: { title: t('of.book.top'), rows: rk },
    rows: bands.map(b => ({ k: b.k, tier: b.tier, no: t('of.g.no', { n: String(b.no).padStart(2, '0') }, true), name: gn(b.k), role: t('of.tier.' + b.tier), range: t('of.gr.' + b.rk, { a: b.a, b: b.b, c: b.c, d: b.d }, true), n: cntG(b.k) }))
      .concat([{ k: 'ghost', tier: 'nodata', no: '', name: gn('ghost'), role: t('of.tier.nodata'), range: t('of.gr.ghost'), n: cntG('ghost') }]).map(r => ({ ...r, nText: t('of.book.n', { n: r.n }, true) })),
    note: t('of.book.note', { s: fw(W_FULL[0]), d: fw(W_FULL[1]), p: fw(W_FULL[2]), s2: fw(W_NOPR[0]), d2: fw(W_NOPR[1]) }, true),
    small: rankedN >= 2 && rankedN < SMALL_TEAM.n ? t('of.book.small', { k: SMALL_TEAM.n }, true) : '' };
  /* the shop: the viewer's own unlock state, only when the server sends it (an old server has none) and the organization is open */
  const shop = un && me && !closed ? { level: lvOf(un.level), spent: Number(un.spent) || 0, saved: Number(un.saved) || 0, dlg: Number(un.dlg) || 0, runs: Number(un.runs) || 0,
    levels: Array.isArray(un.levels) ? un.levels.map(l => ({ lvl: lvOf(l.lvl), min_spent: Number(l.min_spent) || 0, min_dlg: Number(l.min_dlg) || 0 })) : [],
    items: Array.isArray(un.items) ? un.items.filter(i => i && i.slot && itemSlot(i) === i.slot).map(i => ({ id: i.id, slot: i.slot, lvl: lvOf(i.lvl) })) : [],
    petLvl: un.pet_lvl != null ? lvOf(un.pet_lvl) : null, toysLvl: toysLvl != null ? lvOf(toysLvl) : null, gear: (stored || me).gear, pet: (stored || me).pet, photoShared: sf.photo === true, fmt: fmtMoney, ui: shopUi(t) } : null;
  return { ui: { ...base.ui, redacted: t('of.redacted') }, teams, people, free, shop, freeLabel: free ? t('of.free', { n: free }, true) : '', more, moreLabel: more > 0 ? t('of.more', { n: more }, true) : '', closed,
    server: { label: closed ? t('of.server') + ' · ' + t('of.tag.closed') : t('of.server') }, activity: act, book,
    hud: { title: (org.name || '') + ' ' + t('of.town') + ' · ' + rangeLabel, stats, closed: t('of.tag.closed') }, legend, strip,
    aria: t('of.aria', { n: people.length, teams: teams.length, used, limit }, true) };
}
