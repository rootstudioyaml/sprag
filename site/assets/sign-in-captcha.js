/* Cloudflare Turnstile in front of the sign-in code request on sprag.io/team and sprag.io/ops.
   The team server (Supabase Auth) verifies the token on POST /auth/v1/otp, so a script cannot
   request codes for a known owner address until the project's hourly mail quota is gone, and
   cannot create accounts for arbitrary addresses. Nothing else needs the token: code
   verification, the authenticator step and the data calls run as before.
   The page calls SpragCaptcha.mount(el) once, SpragCaptcha.token() right before signInWithOtp
   and SpragCaptcha.reset() afterwards (a token is good for one request). The widget renders in
   the page's language from <html lang>. On any host but sprag.io the always-passing test key
   is used, matched by the test secret the local stack starts with (see sprag-team LOCAL-TESTING). */
(function(){
'use strict';
const LIVE_KEY = '0x4AAAAAAF4K2Gv2Mh60CV3n';
const TEST_KEY = '1x00000000000000000000AA';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const doc = document;
let widgetId = null, token = '', loading = null, mountEl = null;

const siteKey = () => /(^|\.)sprag\.io$/.test(location.hostname) ? LIVE_KEY : TEST_KEY;

function load(){
  if(loading) return loading;
  loading = new Promise((resolve, reject) => {
    if(window.turnstile) return resolve();
    const s = doc.createElement('script');
    s.src = SCRIPT; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('captcha script did not load')); };
    doc.head.appendChild(s);
  });
  return loading;
}
function style(){
  if(doc.getElementById('captcha-style')) return;
  const st = doc.createElement('style'); st.id = 'captcha-style';
  st.textContent = '.captcha{margin:4px 0 12px;min-height:65px}.captcha:empty{min-height:0;margin:0}';
  doc.head.appendChild(st);
}
/* Renders the widget inside `el`. Safe to call again: the widget is rendered once. */
async function mount(el){
  mountEl = el; style();
  await load();
  if(widgetId != null || !mountEl) return;
  widgetId = window.turnstile.render(mountEl, {
    sitekey: siteKey(),
    theme: 'dark',
    language: doc.documentElement.lang === 'ko' ? 'ko' : 'en',
    callback: t => { token = t || ''; },
    'expired-callback': () => { token = ''; },
    'error-callback': () => { token = ''; },
    'timeout-callback': () => { token = ''; }
  });
}
/* The current token, waiting up to `waitMs` for the widget to finish. Empty when it has not. */
async function take(waitMs){
  const until = Date.now() + (waitMs || 8000);
  try{ await mount(mountEl); }catch(e){ return ''; }
  while(!token && Date.now() < until) await new Promise(r => setTimeout(r, 150));
  return token;
}
/* Tokens are single use: after a request (sent or failed) the widget produces a new one. */
function reset(){
  token = '';
  if(widgetId != null && window.turnstile){ try{ window.turnstile.reset(widgetId); }catch(e){} }
}
window.SpragCaptcha = { mount, token: take, reset, siteKey };
})();
