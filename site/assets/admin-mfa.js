/* Sprag admin sign-in, second step: the authenticator app (TOTP). Shared by site/team and site/ops.
   The page verifies the email code first, then calls SpragMFA.gate(sb, session, { mount }) and waits.
   gate() shows either the enrollment (QR code + secret, then a code) or the challenge (a code) inside
   `mount` and resolves with the upgraded session, or with null when the person signed out. The database
   (migration 20261108000100) refuses every admin check below aal2 and every session older than
   SpragMFA.maxAgeSeconds, so the page checks SpragMFA.sessionFresh(session) before the gate.
   Uses the pages' CSS classes (.f, .codein, .btn, .row, .sub, .err) and the UI language from <html lang>.
   No dependencies beyond supabase-js on window.supabase. */
(function(){
'use strict';
const MAX_AGE = 7 * 86400;
const ISSUER = 'Sprag Teams';
const doc = document;
const lang = () => doc.documentElement.lang === 'ko' ? 'ko' : 'en';
const TXT = {
  en: {
    enrollH: 'Set up your authenticator app',
    enrollD: 'Scan this code with Google Authenticator, Microsoft Authenticator, 1Password or any app that produces 6-digit codes. From now on every sign-in asks for the email code and a code from the app.',
    secret: 'Cannot scan? Enter this key by hand',
    code: '6-digit code from the app',
    verify: 'Verify',
    challengeH: 'Authenticator code',
    challengeD: 'Enter the 6-digit code your authenticator app shows for {issuer}.',
    out: 'Sign out',
    busy: 'Checking the code',
    badcode: 'Enter the 6 digits the app shows right now.',
    wrong: 'That code did not match. Wait for the next one and try again.',
    lost: 'Lost the app? Your organization\'s owner or support@sprag.io can reset it.',
    resetConfirm: 'Remove the current authenticator app and enroll a new one? You will scan a new code right away.',
    resetDone: 'The old authenticator was removed. Enroll the new one.',
    lib: 'The sign-in library did not load. Reload the page.'
  },
  ko: {
    enrollH: '인증 앱 등록',
    enrollD: 'Google Authenticator, Microsoft Authenticator, 1Password처럼 6자리 코드를 만드는 앱으로 이 코드를 스캔하세요. 앞으로는 로그인할 때마다 이메일 코드와 앱 코드를 함께 입력합니다.',
    secret: '스캔이 안 되면 이 키를 직접 입력하세요',
    code: '앱에 표시된 6자리 코드',
    verify: '확인',
    challengeH: '인증 앱 코드',
    challengeD: '인증 앱에서 {issuer} 항목의 6자리 코드를 입력하세요.',
    out: '로그아웃',
    busy: '코드를 확인하는 중',
    badcode: '앱에 지금 보이는 6자리 숫자를 입력해 주세요.',
    wrong: '코드가 맞지 않습니다. 다음 코드가 나오면 다시 입력해 주세요.',
    lost: '앱을 잃어버렸다면 조직 오너나 support@sprag.io 에 재설정을 요청하세요.',
    resetConfirm: '지금 쓰는 인증 앱을 지우고 새로 등록할까요? 바로 새 코드를 스캔하게 됩니다.',
    resetDone: '이전 인증 앱을 지웠습니다. 새 앱을 등록하세요.',
    lib: '로그인 라이브러리를 불러오지 못했습니다. 페이지를 새로 고쳐 주세요.'
  }
};
const u = (k, v) => {
  let s = (TXT[lang()] || TXT.en)[k] || TXT.en[k] || k;
  if(v) for(const x in v) s = s.split('{' + x + '}').join(String(v[x]));
  return s;
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function claims(session){
  try{
    const b = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b)))) || {};
  }catch(e){ return {}; }
}
/* The oldest amr entry is the sign-in that opened the session. The database refuses anything older than MAX_AGE. */
function sessionFresh(session){
  if(!session || !session.access_token) return false;
  const amr = claims(session).amr;
  const ts = (Array.isArray(amr) ? amr : []).map(a => Number(a && a.timestamp)).filter(n => Number.isFinite(n) && n > 0);
  if(!ts.length) return false;
  return Math.min.apply(null, ts) >= Math.floor(Date.now() / 1000) - MAX_AGE;
}
function verified(session){ return !!session && claims(session).aal === 'aal2'; }

async function factors(sb){
  const { data, error } = await sb.auth.mfa.listFactors();
  if(error) throw error;
  const all = (data && (data.all || data.totp)) || [];
  return all.filter(f => f && f.factor_type === 'totp');
}
/* Enrolls a new factor. Leftover unverified factors (an abandoned enrollment) are removed first, otherwise
   GoTrue refuses a second factor with the same name and the factor cap (3) fills up. */
async function enroll(sb){
  for(const f of await factors(sb)){
    if(f.status !== 'verified'){ try{ await sb.auth.mfa.unenroll({ factorId: f.id }); }catch(e){} }
  }
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', issuer: ISSUER, friendlyName: ISSUER + ' ' + new Date().toISOString().slice(0, 16).replace('T', ' ') });
  if(error) throw error;
  return data;
}
async function challengeVerify(sb, factorId, code){
  const ch = await sb.auth.mfa.challenge({ factorId });
  if(ch.error) throw ch.error;
  const v = await sb.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
  if(v.error) throw v.error;
  const { data } = await sb.auth.getSession();
  return data && data.session;
}
function isWrongCode(e){
  const m = String((e && e.message) || '').toLowerCase();
  return /invalid|incorrect|expired|mismatch/.test(m);
}

function render(mount, mode, enrollment, note){
  const secret = enrollment && enrollment.totp ? enrollment.totp.secret || '' : '';
  const qr = enrollment && enrollment.totp ? enrollment.totp.qr_code || '' : '';
  /* GoTrue's qr_code is a data: URI holding raw SVG with double quotes, so it goes on the img through the DOM, never into HTML. */
  const qrSrc = /^data:image\/svg\+xml/.test(qr) ? qr : (qr && /^</.test(qr.trim()) ? 'data:image/svg+xml;utf8,' + encodeURIComponent(qr) : '');
  mount.innerHTML = `
    <form id="mfa-form" novalidate>
      <h2 class="mfa-h">${esc(u(mode === 'enroll' ? 'enrollH' : 'challengeH'))}</h2>
      ${note ? `<p class="sub mfa-note">${esc(note)}</p>` : ''}
      <p class="sub">${esc(mode === 'enroll' ? u('enrollD') : u('challengeD', { issuer: ISSUER }))}</p>
      ${mode === 'enroll' ? `
      <div class="mfa-qr"></div>
      <p class="sub mfa-secret-l">${esc(u('secret'))}</p>
      <code class="mfa-secret" translate="no">${esc(secret.replace(/(.{4})/g, '$1 ').trim())}</code>` : ''}
      <label class="f"><span>${esc(u('code'))}</span>
        <input type="text" id="mfa-code" class="codein" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······" />
      </label>
      <div class="row">
        <button class="btn pri" type="submit" id="mfa-verify">${esc(u('verify'))}</button>
        <button class="btn" type="button" id="mfa-out">${esc(u('out'))}</button>
      </div>
      <p class="err" id="mfa-err" role="alert" hidden></p>
      ${mode === 'challenge' ? `<p class="note mfa-lost">${esc(u('lost'))}</p>` : ''}
    </form>`;
  if(mode === 'enroll' && qrSrc){
    const img = doc.createElement('img');
    img.src = qrSrc; img.alt = 'QR code'; img.width = 184; img.height = 184;
    mount.querySelector('.mfa-qr').appendChild(img);
  }
  if(!doc.getElementById('mfa-style')){
    const st = doc.createElement('style'); st.id = 'mfa-style';
    st.textContent = '.mfa-h{margin:0 0 8px;font-size:18px}.mfa-qr{margin:12px 0 8px}.mfa-qr img{display:block;background:#fff;padding:8px;border-radius:8px;box-sizing:content-box}' +
      '.mfa-secret{display:inline-block;margin:0 0 14px;padding:8px 10px;border-radius:6px;background:rgba(255,255,255,.06);font-size:14px;letter-spacing:.06em;word-break:break-all;user-select:all}' +
      '.mfa-secret-l{margin-bottom:4px}.mfa-note{color:var(--ok,#7bd88f)}.mfa-lost{padding:0;margin-top:14px}';
    doc.head.appendChild(st);
  }
}

/* Resolves with the aal2 session, or null after sign-out. Shows the UI inside `mount` and clears it when done. */
function gate(sb, session, opts){
  const mount = opts && opts.mount;
  const note = opts && opts.note;
  return new Promise(async resolve => {
    const finish = s => { mount.innerHTML = ''; resolve(s || null); };
    let mode = 'challenge', enrollment = null, factorId = null;
    try{
      const ok = (await factors(sb)).filter(f => f.status === 'verified');
      if(ok.length){ factorId = ok[0].id; }
      else { mode = 'enroll'; enrollment = await enroll(sb); factorId = enrollment.id; }
    }catch(e){
      mount.innerHTML = `<p class="err" role="alert">${esc((e && e.message) || String(e))}</p><div class="row"><button class="btn" type="button" id="mfa-out">${esc(u('out'))}</button></div>`;
      mount.querySelector('#mfa-out').addEventListener('click', async () => { try{ await sb.auth.signOut(); }catch(e2){} finish(null); });
      return;
    }
    render(mount, mode, enrollment, note);
    const form = mount.querySelector('#mfa-form'), input = mount.querySelector('#mfa-code'), err = mount.querySelector('#mfa-err'), btn = mount.querySelector('#mfa-verify');
    const showErr = m => { err.textContent = m || ''; err.hidden = !m; };
    input.focus();
    mount.querySelector('#mfa-out').addEventListener('click', async () => { try{ await sb.auth.signOut(); }catch(e){} finish(null); });
    form.addEventListener('submit', async ev => {
      ev.preventDefault(); showErr('');
      const code = input.value.replace(/\s/g, '');
      if(!/^\d{6}$/.test(code)) return showErr(u('badcode'));
      btn.disabled = true; const label = btn.textContent; btn.textContent = u('busy');
      try{
        const s = await challengeVerify(sb, factorId, code);
        if(!verified(s)) throw new Error(u('wrong'));
        finish(s);
      }catch(e){
        showErr(isWrongCode(e) ? u('wrong') : ((e && e.message) || String(e)));
        input.value = ''; input.focus();
      }finally{ btn.disabled = false; btn.textContent = label; }
    });
  });
}

/* Removes the verified factor(s) of the signed-in account (needs aal2) and refreshes the session, which
   drops it to aal1. The page then runs gate() again, which enrolls a new app. Returns the refreshed session. */
async function reset(sb){
  if(!confirm(u('resetConfirm'))) return null;
  for(const f of await factors(sb)){
    const { error } = await sb.auth.mfa.unenroll({ factorId: f.id });
    if(error) throw error;
  }
  const { data, error } = await sb.auth.refreshSession();
  if(error) throw error;
  return data && data.session;
}

window.SpragMFA = { maxAgeSeconds: MAX_AGE, issuer: ISSUER, sessionFresh, verified, gate, reset, text: u };
})();
