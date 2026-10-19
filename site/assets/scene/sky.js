/* Sprag sky: the day/night and weather logic that the town and the office scenes share. No three.js import here, scenes pass their own T
 * where a colour blend is needed. Same behaviour in both scenes:
 *   day/night follows the viewer's local clock (dawn 5-7, day 7-17, dusk 17-19, night 19-5, smooth blends), the scene re-reads it every minute;
 *   weather comes from Open-Meteo for Seoul (fixed coordinates, no key, no geolocation, one fetch per 30 min shared through sessionStorage, 4 s timeout,
 *   silent fallback to clear);
 *   debug overrides for screenshots only (also honoured in ?demo=1):  ?tod=night|dawn|dusk|day (or an hour like 21.5)   ?wx=clear|clouds|fog|rain|snow|storm
 *
 *   todPhase(now)                  -> { hour, name:'night'|'dawn'|'day'|'dusk', from, to, k, night:0..1 }   now = Date | hour number | undefined (the clock)
 *   todKeys(hour)                  -> { a, b, k }          the two neighbouring anchors and the smoothed blend between them
 *   blendAnchors(table, hour, T)   -> blended fields of any { day, dawn, dusk, night } table ('#hex' -> T.Color, numbers and number arrays interpolated)
 *   todBlend(hour, T)              -> blendAnchors(ANC, hour, T), the town's sky and light blend
 *   fetchWeather()                 -> Promise<raw|null>    cached 30 min in memory and in sessionStorage('sprag-town-wx')
 *   weatherFromCode(raw)           -> { kind:'clear'|'clouds'|'fog'|'rain'|'snow'|'storm', cloud:0..1, wind:km/h, temp, rain:0..1 }   (null raw gives the clear default)
 *   parseOverrides(url)            -> { tod, wx, hour, weather }   url defaults to location.href (string, URL or Location)
 *   chipText(wx, lang, night)      -> { text:'서울 · 🌧 12°C', title:'비' } | null   (null while there is no temperature, i.e. no weather data; a clear night shows a moon)
 *   SKY_CSS / injectSkyCss()       -> chip, stars layer, haze overlay and night HUD styles (classes sk-chip, sk-stars, sk-haze, of-stage.sk-night); the chip is a block that
 *                                    sits on its own line under the HUD title and subtitle, never inline with the stats text
 *   starsBackground()              -> CSS background-image value: a moon glow plus a tiled star field */

export const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = u => u * u * (3 - 2 * u);

/* town sky and light anchors: c0/c1 sky gradient, sc/si sun colour and intensity, sp sun position, hs/hg/hi hemisphere, fi fill, ex exposure, n night amount */
export const ANC = {
  night: { c0: '#2b3a78', c1: '#0b1030', sc: '#8fa8ff', si: 0.62, sp: [16, 32, 18], hs: '#4a5c9c', hg: '#232a50', hi: 0.7, fi: 0.1, ex: 1.05, n: 1 },
  dawn:  { c0: '#ffe0cf', c1: '#f0bfae', sc: '#ffb58a', si: 1.5, sp: [-28, 20, 14], hs: '#ffe2d0', hg: '#e8c4a6', hi: 0.95, fi: 0.25, ex: 1.08, n: 0.3 },
  day:   { c0: '#fffaf0', c1: '#f6ead2', sc: '#fff0d4', si: 2.0, sp: [-12, 34, 16], hs: '#eaf3ff', hg: '#f0e2c8', hi: 1.0, fi: 0.4, ex: 1.1, n: 0 },
  dusk:  { c0: '#ffd5b0', c1: '#e5a186', sc: '#ff9460', si: 1.6, sp: [30, 17, 10], hs: '#ffd9c0', hg: '#d9b0a0', hi: 0.9, fi: 0.2, ex: 1.05, n: 0.45 }
};
export const TL = [[0, 'night'], [4.5, 'night'], [6, 'dawn'], [7.5, 'day'], [16.5, 'day'], [18, 'dusk'], [19.5, 'night'], [24, 'night']];
export const WXK = { clear: ['맑음', 'Clear', '☀'], clouds: ['흐림', 'Cloudy', '☁'], fog: ['안개', 'Fog', '🌫'], rain: ['비', 'Rain', '🌧'], snow: ['눈', 'Snow', '❄'], storm: ['뇌우', 'Storm', '⛈'] };
export const WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=37.57&longitude=126.98&current=weather_code,cloud_cover,precipitation,wind_speed_10m,is_day,temperature_2m';
export const WX_CACHE_KEY = 'sprag-town-wx';
export const WX_CLEAR = Object.freeze({ kind: 'clear', cloud: 0.12, wind: 6, temp: null, rain: 0 });
export const WX_DBG = {
  clear: { kind: 'clear', cloud: 0.12, wind: 6, temp: 22, rain: 0 }, clouds: { kind: 'clouds', cloud: 0.75, wind: 14, temp: 18, rain: 0 }, fog: { kind: 'fog', cloud: 0.55, wind: 3, temp: 8, rain: 0 },
  rain: { kind: 'rain', cloud: 0.9, wind: 16, temp: 12, rain: 0.8 }, snow: { kind: 'snow', cloud: 0.85, wind: 8, temp: -2, rain: 0.7 }, storm: { kind: 'storm', cloud: 1, wind: 34, temp: 20, rain: 1 }
};
export const TOD_DBG = { dawn: 6, day: 12, dusk: 18, night: 0 };

/* ── weather ─────────────────────────────────────────────────────────── */
let wxMem = null, wxPromise = null;
export function fetchWeather(){
  const now = Date.now();
  if(wxMem && now - wxMem.t < 1800e3) return Promise.resolve(wxMem.d);
  try{ const s = JSON.parse(sessionStorage.getItem(WX_CACHE_KEY) || 'null'); if(s && s.d && now - s.t < 1800e3){ wxMem = s; return Promise.resolve(s.d); } }catch(e){}
  if(wxPromise) return wxPromise;
  wxPromise = new Promise(res => {
    let to = 0;
    try{
      const ac = new AbortController(); to = setTimeout(() => ac.abort(), 4000);
      fetch(WX_URL, { signal: ac.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }).then(r => (r.ok ? r.json() : null)).then(j => {
        const c = j && j.current; if(!c) return res(null);
        const d = { code: Number(c.weather_code) || 0, cloud: Number(c.cloud_cover) || 0, precip: Number(c.precipitation) || 0, wind: Number(c.wind_speed_10m) || 0, temp: c.temperature_2m == null ? null : Number(c.temperature_2m) };
        wxMem = { t: Date.now(), d }; try{ sessionStorage.setItem(WX_CACHE_KEY, JSON.stringify(wxMem)); }catch(e){} res(d);
      }).catch(() => res(null)).finally(() => { clearTimeout(to); wxPromise = null; });
    }catch(e){ clearTimeout(to); wxPromise = null; res(null); }
  });
  return wxPromise;
}
/* WMO weather_code to a scene state. cloud 0..1, wind km/h, rain 0..1 */
export function weatherFromCode(d){
  if(!d) return { ...WX_CLEAR };
  const c = d.code, cv = clampN(d.cloud / 100, 0, 1), w = d.wind || 0, ra = clampN(d.precip / 4, 0.25, 1);
  if(c >= 95) return { kind: 'storm', cloud: Math.max(cv, 0.95), wind: w, temp: d.temp, rain: 1 };
  if((c >= 71 && c <= 77) || c === 85 || c === 86) return { kind: 'snow', cloud: Math.max(cv, 0.8), wind: w, temp: d.temp, rain: ra };
  if((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return { kind: 'rain', cloud: Math.max(cv, 0.85), wind: w, temp: d.temp, rain: c >= 61 || c >= 80 ? Math.max(ra, 0.6) : 0.4 };
  if(c === 45 || c === 48) return { kind: 'fog', cloud: Math.max(cv, 0.5), wind: w, temp: d.temp, rain: 0 };
  if(c === 2 || c === 3) return { kind: 'clouds', cloud: Math.max(cv, c === 3 ? 0.85 : 0.5), wind: w, temp: d.temp, rain: 0 };
  return { kind: 'clear', cloud: Math.min(cv, 0.3), wind: w, temp: d.temp, rain: 0 };
}

/* ── time of day ─────────────────────────────────────────────────────── */
export function hourOf(now){
  if(typeof now === 'number') return now;
  const d = now instanceof Date ? now : new Date();
  return d.getHours() + d.getMinutes() / 60;
}
export function todKeys(hour, tl = TL){
  let i = 0; while(i < tl.length - 2 && hour >= tl[i + 1][0]) i++;
  const a = tl[i], b = tl[i + 1];
  return { a: a[1], b: b[1], k: smooth(clampN((hour - a[0]) / (b[0] - a[0]), 0, 1)) };
}
export function blendAnchors(table, hour, T){
  const { a, b, k } = todKeys(hour), A = table[a], B = table[b], out = {};
  for(const f of Object.keys(A)){
    const v = A[f], w = B[f];
    out[f] = typeof v === 'string' ? new T.Color(v).lerp(new T.Color(w), k) : Array.isArray(v) ? v.map((x, j) => x + (w[j] - x) * k) : v + (w - v) * k;
  }
  return out;
}
export const todBlend = (hour, T) => blendAnchors(ANC, hour, T);
export function todPhase(now){
  const hour = hourOf(now), { a, b, k } = todKeys(hour);
  return { hour, name: k < 0.5 ? a : b, from: a, to: b, k, night: ANC[a].n + (ANC[b].n - ANC[a].n) * k };
}

/* ── debug overrides ─────────────────────────────────────────────────── */
export function parseOverrides(url){
  const none = { tod: null, wx: null, hour: null, weather: null };
  let qs;
  try{
    const u = url == null ? (typeof location !== 'undefined' ? location.href : '') : typeof url === 'string' ? url : url.href || String(url);
    qs = new URL(u, 'http://x/').searchParams;
  }catch(e){ return none; }
  const tod = qs.get('tod'), wq = qs.get('wx'), own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  let hour = null;
  if(tod && own(TOD_DBG, tod)) hour = TOD_DBG[tod]; else if(tod && /^\d{1,2}(\.\d+)?$/.test(tod) && Number(tod) <= 24) hour = Number(tod);
  const weather = wq && own(WX_DBG, wq) ? { ...WX_DBG[wq] } : null;
  return { tod: hour == null ? null : tod, wx: weather ? wq : null, hour, weather };
}

/* ── HUD chip ────────────────────────────────────────────────────────── */
export function chipText(wx, lang, night = false){
  if(!wx || wx.temp == null) return null;
  const ko = String(lang || '').toLowerCase().startsWith('ko'), k = WXK[wx.kind] || WXK.clear, ic = night && wx.kind === 'clear' ? '🌙' : k[2];
  return { text: `${ko ? '서울' : 'Seoul'} · ${ic} ${Math.round(wx.temp)}°C`, title: k[ko ? 0 : 1] };
}

/* ── shared styles and the star layer ────────────────────────────────── */
export const SKY_CSS = `.sk-chip{display:block;width:fit-content;margin-top:6px;padding:1px 9px;border-radius:999px;background:rgba(255,255,255,.8);border:1px solid rgba(120,90,60,.16);font-size:11px;font-weight:600;line-height:1.5;color:#6a5a4a;pointer-events:none}
.sk-chip[hidden]{display:none}
.sk-stars{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 1.2s;background-repeat:no-repeat,repeat-x;background-position:0 0,0 0;background-size:100% 100%,640px 420px}
.sk-haze{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 1.2s}
.of-stage.sk-night .of-hud,.of-stage.sk-night .of-hud b{color:#e8ecff}
.of-stage.sk-night .sk-chip{background:rgba(30,38,80,.7);border-color:rgba(160,180,255,.3);color:#dfe5ff}
.of-stage.sk-night .of-legend{background:rgba(30,38,80,.72);color:#dfe5ff}`;
export function injectSkyCss(){
  if(typeof document === 'undefined' || document.getElementById('sk-style')) return;
  const s = document.createElement('style'); s.id = 'sk-style'; s.textContent = SKY_CSS; document.head.appendChild(s);
}
let starsMemo = '';
export function starsBackground(){
  if(starsMemo) return starsMemo;
  const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = 640; c.height = 420;
  let s = 0x5eed1234; const rn = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  for(let i = 0; i < 120; i++){ const r = rn() < 0.1 ? 2.2 : rn() < 0.4 ? 1.4 : 0.9; x.fillStyle = `rgba(255,255,${230 + Math.floor(rn() * 25)},${0.35 + rn() * 0.65})`; x.beginPath(); x.arc(rn() * 640, rn() * 330, r, 0, 6.283); x.fill(); }
  return (starsMemo = `radial-gradient(circle at 70% 15%, #fff8e0 0 13px, rgba(255,248,224,.3) 14px 26px, rgba(255,248,224,0) 40px), url(${c.toDataURL()})`);
}
