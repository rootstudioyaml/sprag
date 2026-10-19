#!/usr/bin/env node
/* Records the Sprag tour clips frame by frame from the demo dashboards.
 *
 *   node record.mjs --lang ko|en [--shots a,b,c | --group town|rest|all] [--out ../clips] [--base http://localhost:8788]
 *
 * Needs the site server (node scripts/serve-site.mjs 8788) and puppeteer-core (npm i in this folder, or
 * TOUR_NODE_MODULES=/path/to/node_modules). Drives the system Chrome with the GPU, no Playwright browsers.
 *
 * Timing: CDP virtual time. Every frame advances the page clock by exactly 1000/30 ms
 * (Emulation.setVirtualTimePolicy pauseIfNetworkFetchesPending + budget), then takes a screenshot, so motion runs
 * at true 30 fps however slow the capture is. Math.random is seeded and the start date is fixed.
 * Pages are opened with ?demo=1&rec=1 (the scene handles appear on window.__sprag) and &norev=1 on /ops, so no
 * Sprag revenue is drawn. Scene shots put the scene card in its full-window overlay and hide the zoom buttons.
 * Output: <out>/<lang>/<shot>.mp4 (1920x1080, 30 fps, H.264 CRF 12, an intermediate for the HyperFrames comp). */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(process.env.TOUR_NODE_MODULES || path.join(HERE, 'node_modules'), '_.js'));
const puppeteer = req('puppeteer-core');

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const LANG = arg('--lang', 'ko'), BASE = arg('--base', 'http://localhost:8788'), OUT = path.resolve(arg('--out', path.join(HERE, '..', 'clips')));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 30, F = 1000 / FPS;
const T0 = 1792292400;   /* 2026-10-18 12:00 KST: fixed clock, so demo dates and range labels never drift */
const KO = LANG === 'ko';

/* ── easing and path helpers ── */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = u => { u = clamp(u, 0, 1); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const lerp = (a, b, u) => a + (b - a) * u;
/* keyframed pose: keys = [[t, {th, ph, zoom, x, z}], ...], eased between neighbours */
function poseAt(keys, t){
  if(t <= keys[0][0]) return { ...keys[0][1] };
  for(let i = 0; i < keys.length - 1; i++){
    const [ta, a] = keys[i], [tb, b] = keys[i + 1];
    if(t <= tb){ const u = ease((t - ta) / (tb - ta)), o = {}; for(const k of Object.keys(b)) o[k] = lerp(a[k] ?? b[k], b[k], u); return o; }
  }
  return { ...keys[keys.length - 1][1] };
}
const at = (t, t0) => t >= t0 && t < t0 + 0.5 / FPS * 2;   /* true on the one frame that crosses t0 */

const ops = (q, hash = '') => `${BASE}/ops/?demo=1&lang=${LANG}&rec=1&norev=1${q ? '&' + q : ''}${hash}`;
const team = (q = '', hash = '') => `${BASE}/team/?demo=1&lang=${LANG}&rec=1${q ? '&' + q : ''}${hash}`;

/* ── page-side helpers (strings run in the page) ── */
const SCENE_CSS = '.of-tools,.of-hint{display:none!important}';
const fsx = key => `(() => { const box = document.querySelector('${key === 'town' ? '#town-box' : '#scene-box'}'); (box.closest('.of-card') || box).classList.add('of-fsx'); return true; })()`;
const ready = key => `!!(window.__sprag && window.__sprag.${key} && window.__sprag.${key}.ready && window.__sprag.${key}.ready())`;
const setPose = (key, o) => `window.__sprag.${key}.view.setPose(${JSON.stringify(o)})`;

/* the town camera of the day/night sequence is one path; each clip records its own slice of it */
const DN = [[0, { th: 0.55, ph: 1.0, zoom: 1.25, x: 0, z: 0 }], [9, { th: 1.25, ph: 0.92, zoom: 1.4, x: 0, z: 0 }]];
const dnClip = (tod, wx, from) => ({ group: 'town', url: ops(`tod=${tod}&wx=${wx}`), scene: 'town', dur: 2.6,
  frame: async (c, t) => c.eval(setPose('town', poseAt(DN, from + t))) });

const RF = '#ru-box form[data-rlform=team]';   /* the team's add-rule form on the Rules sub-tab */
const LION = 'd1-m14', CHICK = 'd1-m10', ORG = 'd1';
const SHOTS = {
  /* 0-8 s: night rain, slow zoom out from the HQ to the whole island */
  'town-hook': { group: 'town', url: ops('tod=night&wx=rain'), scene: 'town', dur: 8.6,
    frame: async (c, t) => c.eval(setPose('town', poseAt([[0, { th: 0.62, ph: 0.95, zoom: 3.4, x: 0, z: 0 }], [7.6, { th: 0.86, ph: 1.05, zoom: 1.0, x: 0, z: 0 }]], t))) },
  /* 8-14 s: glide to a company, its drawer slides in, hover "open organization" */
  'town-select': { group: 'town', url: ops('tod=day&wx=clear'), scene: 'town', dur: 6.6,
    prepare: async c => { c.org = (await c.eval(`window.__sprag.town.orgs()`)).find(o => o.id === ORG); },
    frame: async (c, t) => {
      await c.eval(setPose('town', poseAt([[0, { th: 0.86, ph: 1.05, zoom: 1.0, x: 0, z: 0 }], [2.4, { th: 0.95, ph: 1.0, zoom: 1.75, x: c.org.x * 0.6, z: c.org.z * 0.6 }]], t)));
      if(at(t, 2.5)) await c.eval(`window.__sprag.town.selectOrg('${ORG}')`);
      if(t >= 4.4 && t < 5.4) await c.moveTo('.of-drawer [data-a=org]', ease((t - 4.4) / 1.0), [0.5, 0.5], [0.62, 0.95]);
    } },
  /* 14-20 s: the company's office, slow push in */
  'office-intro': { url: ops('', '#org/' + ORG), scene: 'office', dur: 6.6,
    frame: async (c, t) => c.eval(setPose('office', poseAt([[0, { th: 0.785, ph: 1.04, zoom: 0.98, x: 0, z: 0 }], [6.6, { th: 1.035, ph: 1.0, zoom: 1.15, x: 0, z: 0 }]], t))) },
  /* 20-38 s: into a lion, full orbit, wide on the bots and the server, then a chick with its coffee */
  'office-lion': { url: ops('', '#org/' + ORG), scene: 'office', dur: 18.6,
    prepare: async c => { const ps = await c.eval(`window.__sprag.office.people()`), s = await c.eval(`window.__sprag.office.server()`);
      const L = ps.find(p => p.id === LION) || ps.find(p => p.tier === 'power'), Ch = ps.find(p => p.id === CHICK) || ps.find(p => p.tier === 'low');
      const TAU = Math.PI * 2, th = 1.035;
      c.keys = [[0, { th, ph: 1.0, zoom: 1.15, x: 0, z: 0 }], [3.0, { th, ph: 0.92, zoom: 2.6, x: L.x, z: L.z + 0.3 }],
        [7.2, { th: th + TAU / 2, ph: 0.86, zoom: 2.35, x: L.x, z: L.z + 0.3 }], [11.4, { th: th + TAU, ph: 0.92, zoom: 2.6, x: L.x, z: L.z + 0.3 }],
        [14.4, { th: th + TAU, ph: 1.0, zoom: 1.45, x: (L.x + s.x) / 2, z: (L.z + s.z) / 2 }], [18.4, { th: th + TAU + 0.12, ph: 0.95, zoom: 2.9, x: Ch.x, z: Ch.z + 0.3 }]]; },
    frame: async (c, t) => c.eval(setPose('office', poseAt(c.keys, t))) },
  /* 38-50 s: open the lion's card, hover the model mix, scroll to the daily chart and sweep it */
  'office-drawer': { url: ops('', '#org/' + ORG), scene: 'office', dur: 12.6,
    prepare: async c => { const ps = await c.eval(`window.__sprag.office.people()`); c.L = ps.find(p => p.id === LION) || ps.find(p => p.tier === 'power'); },
    frame: async (c, t) => {
      const L = c.L; await c.eval(setPose('office', poseAt([[0, { th: 1.035, ph: 0.95, zoom: 1.9, x: L.x + 2.2, z: L.z + 0.3 }], [12.6, { th: 1.2, ph: 0.95, zoom: 2.0, x: L.x + 2.2, z: L.z + 0.3 }]], t)));
      if(at(t, 0.6)) await c.eval(`window.__sprag.office.selectPerson('${L.id}')`);
      if(t >= 2.4 && t < 5.6){   /* model mix bar: haiku, sonnet, opus in turn */
        const k = Math.min(2, Math.floor((t - 2.4) / 1.07)), u = ease(((t - 2.4) - k * 1.07) / 0.5);
        await c.moveTo(`.of-drawer .fam i:nth-child(${k + 1})`, u, k ? [0.5, 0.5] : [0.1, 1.6], [0.5, 0.5], k ? `.of-drawer .fam i:nth-child(${k})` : null);
      }
      if(t >= 5.7 && t < 7.1) await c.eval(`(() => { const bd = document.querySelector('.of-drawer .bd'), ch = bd && bd.querySelector('.ch'); if(!ch) return; const to = ch.offsetTop - bd.offsetTop - 120; bd.__s0 ??= bd.scrollTop; bd.scrollTop = bd.__s0 + (to - bd.__s0) * ${ease((t - 5.7) / 1.4)}; })()`);
      if(t >= 7.3) await c.moveTo('.of-drawer .ch', 1, [0.5, 0.5], [0.06 + 0.88 * ease((t - 7.3) / 5.1), 0.55]);
    } },
  /* 50-55 s: company console, KPI cards count up, then the range rail switches to 90 days */
  'team-kpi': { url: team(), dur: 5.6, waitFor: `!!document.querySelector('.kc .kv b')`, waitStep: F, noWarm: true,
    frame: async (c, t) => {
      /* KPI cards count up at the top, then glide down so the range rail clears the caption and switch it to 90 days */
      const top = `(() => { const k = document.querySelector('.kcards'); return k ? k.getBoundingClientRect().top + scrollY - 52 : 0; })()`;
      if(t < 1.8) c.kTop = await c.eval(top);
      await c.eval(`window.scrollTo(0, ${Math.round(c.kTop + 150 * ease((t - 1.8) / 1.2))})`);
      if(t >= 3.1 && t < 3.7) await c.moveTo('.rail-i[data-d="90"]', ease((t - 3.1) / 0.6), [0.9, 1.4], [0.5, 0.5]);
      if(at(t, 3.8)) await c.eval(`document.querySelector('.rail-i[data-d="90"]').click()`);
    } },
  /* 55-60 s: seats tab, movement chart and table, a filter chip */
  'team-seats': { url: team(), dur: 5.6, waitFor: `!!document.querySelector('.kc')`,
    prepare: async c => { await c.eval(`document.querySelector('#vtab-seats').click()`); await c.waitFor(`!!document.querySelector('#view-seats .dt-chip')`); await c.run(0.5); },
    frame: async (c, t) => {
      await c.eval(`window.scrollTo(0, ${Math.round(150 * ease(t / 2.2))})`);
      if(t >= 2.4 && t < 3.2) await c.moveTo('#view-seats .dt-chip:nth-child(4)', ease((t - 2.4) / 0.8), [0.5, -2], [0.5, 0.5]);
      if(at(t, 3.3)) await c.eval(`document.querySelector('#view-seats .dt-chip:nth-child(4)').click()`);
    } },
  /* 60-64 s: Cmd+K palette, type a name */
  'team-palette': { url: team(), dur: 5.1, waitFor: `!!document.querySelector('.kc')`,
    /* opened over the seats view so no 3D scene is in frame */
    prepare: async c => { await c.eval(`document.querySelector('#vtab-seats').click()`); await c.waitFor(`!!document.querySelector('#view-seats .dt-chip')`); await c.eval('window.scrollTo(0, 150)'); await c.run(0.5); },
    frame: async (c, t) => {
      if(at(t, 0.7)) await c.page.keyboard.down('Meta').then(() => c.page.keyboard.press('k')).then(() => c.page.keyboard.up('Meta'));
      if(t >= 1.7 && t < 3.0){ const s = 'pat', n = Math.min(s.length, 1 + Math.floor((t - 1.7) / 0.32)); await c.eval(`(() => { const i = document.querySelector('.pal input'); if(i && i.value !== '${s.slice(0, n)}'){ i.value = '${s.slice(0, n)}'; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`); }
    } },
  /* 64-71 s: team rules, type a model rule, add it, it lands under approved */
  'team-rules': { url: team('team=demo-t1', '#rules'), dur: 7.6, waitFor: `!!document.querySelector(${JSON.stringify(RF)}) && !!document.querySelector('#ru-box .rl-cols .rule')`,
    frame: async (c, t) => {
      const s = KO ? '설계는 메인 세션이 맡고, 구현은 sonnet에 위임' : 'Main session designs, Sonnet implements', I = RF + ' input[name=text]';
      /* glide from the rule lists down to the team's approved column and its form */
      if(t < 1.4) await c.eval(`(() => { const el = document.querySelector(${JSON.stringify(RF)}); if(!el) return; const to = el.getBoundingClientRect().top + scrollY - 450; window.__s0 ??= scrollY; window.scrollTo(0, window.__s0 + (to - window.__s0) * ${ease(t / 1.3)}); })()`);
      if(at(t, 1.4)) await c.eval(`document.querySelector(${JSON.stringify(I)}).focus({ preventScroll: true })`);
      if(t >= 1.5 && t < 4.6){ const n = Math.min(s.length, Math.ceil((t - 1.5) / 2.9 * s.length)); await c.eval(`(() => { const i = document.querySelector(${JSON.stringify(I)}), v = ${JSON.stringify(s)}.slice(0, ${n}); if(i.value !== v){ i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`); }
      if(at(t, 4.8)) await c.eval(`(() => { const s = document.querySelector(${JSON.stringify(RF + ' select[name=scope]')}); s.value = 'model'; s.dispatchEvent(new Event('change', { bubbles: true })); s.focus({ preventScroll: true }); })()`);
      if(t >= 4.9 && t < 5.5) await c.moveTo(RF + ' button[type=submit]', ease((t - 4.9) / 0.6), [-1.5, 0.5], [0.5, 0.5]);
      if(at(t, 5.6)) await c.eval(`document.querySelector(${JSON.stringify(RF + ' button[type=submit]')}).click()`);
    } },
  /* 76-84 s: dawn, day, dusk, then a snowy night (crossfaded in the comp) */
  'town-dawn': dnClip('dawn', 'clear', 0),
  'town-day': dnClip('day', 'clear', 2.0),
  'town-dusk': dnClip('dusk', 'clear', 4.0),
  'town-snow': dnClip('night', 'snow', 6.0),
};

async function record(browser, name, shot){
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if(m.type() === 'error') errors.push(m.text()); });
  /* a request to Open-Meteo would mean the weather override failed: block it */
  await page.setRequestInterception(true);
  page.on('request', r => (/open-meteo/.test(r.url()) ? r.abort() : r.continue()));
  await page.evaluateOnNewDocument(() => {
    let s = 20261018; Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}
    /* a screenshot waits for a compositor frame with damage; pages that sit still (no WebGL loop) would hang it,
       so every frame toggles an invisible 1 px dot */
    let k = 0; window.__damage = () => { let d = document.getElementById('__dmg'); if(!d && document.body){ d = document.createElement('div'); d.id = '__dmg'; d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;z-index:2147483647;background:#000'; document.body.appendChild(d); } if(d) d.style.opacity = (k++ % 2) ? '0.01' : '0.02'; };
    (function loop(){ window.__damage(); requestAnimationFrame(loop); })();
    /* a tiny WebGL canvas cleared every frame keeps the compositor producing frames under paused virtual time */
    let gl = null, n = 0; (function glLoop(){ if(!gl && document.body){ const c = document.createElement('canvas'); c.width = c.height = 1; c.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:2147483647'; document.body.appendChild(c); gl = c.getContext('webgl'); }
      if(gl){ gl.clearColor((n++ % 2) * 0.01, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); } requestAnimationFrame(glLoop); })();
  });
  const cdp = await page.createCDPSession();
  const advance = ms => new Promise((res, rej) => { cdp.once('Emulation.virtualTimeBudgetExpired', res); cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: ms }).catch(rej); });
  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause', initialVirtualTime: T0 });
  const c = { page, name,
    eval: js => page.evaluate(js),
    run: async sec => { for(let i = 0; i < Math.round(sec * FPS); i++) await advance(F); },
    async waitFor(js, maxSec = 40, step = 100){ for(let i = 0; i < maxSec * 1000 / step; i++){ if(await page.evaluate(js).catch(() => false)) return; await advance(step); } throw new Error(`${name}: timed out waiting for ${js} :: ` + await page.evaluate(() => location.href + " " + document.body.innerText.slice(0, 300).replace(/\s+/g, " ")).catch(e => e.message) + " :: " + errors.slice(0, 3).join(" / ")); },
    /* move the (invisible) mouse from a point relative to `from` (or to `sel`) toward `to` on `sel`; fractions of the element box */
    async moveTo(sel, u, from, to, fromSel){
      const box = await page.evaluate((s, f) => { const r = (q) => { const e = document.querySelector(q); if(!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }; return [r(s), f ? r(f) : null]; }, sel, fromSel);
      const [b, fb] = box; if(!b) return;
      const src = fb || b, x0 = src[0] + src[2] * from[0], y0 = src[1] + src[3] * from[1], x1 = b[0] + b[2] * to[0], y1 = b[1] + b[3] * to[1];
      await page.mouse.move(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u);
    } };
  page.goto(shot.url, { waitUntil: 'domcontentloaded', timeout: 0 }).catch(e => errors.push('goto ' + e.message));
  await new Promise(r => setTimeout(r, 200));
  await c.waitFor(shot.scene ? ready(shot.scene) : shot.waitFor, 40, shot.waitStep || 100);
  /* no mouse pointer; extra room under dashboard pages so a shot can scroll its subject above the caption band */
  await page.addStyleTag({ content: '*{cursor:none!important}' + (shot.scene ? SCENE_CSS : 'body{padding-bottom:420px}') });
  if(shot.scene){ await c.eval(fsx(shot.scene)); await c.run(1.5); }   /* fonts.ready rebuild and the overlay resize settle */
  else if(!shot.noWarm) await c.run(0.6);
  if(shot.prepare) await shot.prepare(c);

  const dir = path.join(OUT, LANG); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name + '.mp4'), N = Math.round(shot.dur * FPS);
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise(res => ff.on('close', res));
  const t1 = Date.now();
  for(let i = 0; i < N; i++){
    const t = i / FPS;
    if(shot.frame) await shot.frame(c, t, i);
    await page.evaluate(() => window.__damage && window.__damage());
    await advance(F);
    const buf = await page.screenshot({ type: 'png', optimizeForSpeed: true, captureBeyondViewport: false });
    if(!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); const code = await done;
  const sec = (Date.now() - t1) / 1000;
  console.log(`${LANG}/${name}: ${N} frames in ${sec.toFixed(1)} s (${(N / sec).toFixed(1)} fps) -> ${file}${code ? ' FFMPEG EXIT ' + code : ''}`);
  const bad = errors.filter(e => !/open-meteo|ERR_FAILED|net::/i.test(e));
  if(bad.length) console.log(`  page errors: ${bad.slice(0, 5).join(' | ')}`);
  await page.close();
  return code === 0;
}

const group = arg('--group', 'rest'), only = arg('--shots');
const names = only ? only.split(',') : Object.keys(SHOTS).filter(n => group === 'all' || (group === 'town') === (SHOTS[n].group === 'town'));
for(const n of names) if(!SHOTS[n]) { console.error('unknown shot ' + n); process.exit(2); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 120000,
  args: ['--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'] });
const gl = await (async () => { const p = await browser.newPage(); const r = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'), d = g && g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : String(!!g); }); await p.close(); return r; })();
console.log(`chrome ${await browser.version()} · WebGL ${gl} · lang ${LANG} · shots ${names.join(',')}`);
let ok = true;
for(const n of names){ try{ ok = (await record(browser, n, SHOTS[n])) && ok; }catch(e){ ok = false; console.error(`${LANG}/${n}: FAILED ${e.message}`); } }
await browser.close();
process.exit(ok ? 0 : 1);
