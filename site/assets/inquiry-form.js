/* Inquiry dialog for the pricing and license pages. Any element with data-inquiry="pro|enterprise|custom|general"
   opens a native <dialog> with a short form instead of a mailto: link (the link stays in the markup as the
   fallback when this script does not run). The form posts to the Supabase Edge Function "inquiry", guarded by the
   Turnstile wrapper in sign-in-captcha.js (SpragCaptcha.mount, .token, .reset).
   Language comes from <html lang> at the moment the dialog opens (the pages' setLang() keeps it current).
   validate() and buildPayload() are pure and exported for node tests; everything that touches the DOM runs only
   when a document exists. */
(function(){
'use strict';

const PLANS = ['pro', 'enterprise', 'custom', 'general'];
const MAX_MESSAGE = 4000;
const CONVERSION = 'AW-18548782436/rBY1CPyE0bIdEOTq34xF';
const MAIL = '<a href="mailto:support@sprag.io">support@sprag.io</a>';

const STRINGS = {
  ko: {
    title: '도입 문의',
    intro: '조직 이름과 예상 인원을 알려 주시면 주문 링크를 보내 드립니다.',
    email: '이메일',
    name: '이름',
    company: '회사 또는 팀',
    seats: '예상 인원',
    plan: '플랜',
    message: '문의 내용',
    optional: '(선택)',
    planPro: 'Pro',
    planEnterprise: 'Enterprise',
    planCustom: '맞춤 견적',
    planGeneral: '아직 정하지 않음',
    placeholder: '궁금한 점이나 도입 일정을 적어 주세요',
    consent: '보내기를 누르면 <a href="/privacy/">개인정보처리방침</a>에 따라 문의 답변에 필요한 정보를 처리합니다.',
    submit: '보내기',
    sending: '보내는 중',
    close: '닫기',
    doneTitle: '문의를 받았습니다',
    doneBody: '적어 주신 이메일 주소로 답장드리겠습니다.',
    errEmail: '이메일 주소를 확인해 주세요.',
    errMessage: '문의 내용을 적어 주세요.',
    errMessageLong: '문의 내용은 4000자 안으로 적어 주세요.',
    errCaptcha: '자동 입력 방지 확인을 마친 뒤 다시 보내 주세요.',
    errLimit: '지금은 접수하지 못했습니다. ' + MAIL + '로 보내 주세요.',
    errGeneral: '전송하지 못했습니다. 잠시 뒤 다시 시도하거나 ' + MAIL + '로 보내 주세요.'
  },
  en: {
    title: 'Get in touch',
    intro: 'Tell us your organization and roughly how many people will use Sprag, and we will send an order link.',
    email: 'Email',
    name: 'Name',
    company: 'Company or team',
    seats: 'Expected seats',
    plan: 'Plan',
    message: 'Message',
    optional: '(optional)',
    planPro: 'Pro',
    planEnterprise: 'Enterprise',
    planCustom: 'Custom quote',
    planGeneral: 'Not decided yet',
    placeholder: 'Questions, or when you would like to start',
    consent: 'By sending, you agree that we process this information to answer your inquiry, as described in the <a href="/privacy/">Privacy Policy</a>.',
    submit: 'Send',
    sending: 'Sending',
    close: 'Close',
    doneTitle: 'We got your message',
    doneBody: 'We will reply to the email address you gave.',
    errEmail: 'Check the email address.',
    errMessage: 'Write a message.',
    errMessageLong: 'Keep the message under 4000 characters.',
    errCaptcha: 'Finish the human check, then send again.',
    errLimit: 'We cannot take this right now. Please email ' + MAIL + '.',
    errGeneral: 'Could not send. Try again in a moment or email ' + MAIL + '.'
  }
};

/* ---- pure helpers ---- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(fields){
  const f = fields || {};
  const errors = {};
  const email = String(f.email == null ? '' : f.email).trim();
  const message = String(f.message == null ? '' : f.message).trim();
  if(!EMAIL_RE.test(email) || email.length > 254) errors.email = 'errEmail';
  if(!message) errors.message = 'errMessage';
  else if(message.length > MAX_MESSAGE) errors.message = 'errMessageLong';
  return { ok: Object.keys(errors).length === 0, errors };
}

function normalizeSeats(v){
  const s = String(v == null ? '' : v).trim();
  if(!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && Number.isSafeInteger(n) ? n : null;
}

function buildPayload(fields, ctx){
  const f = fields || {}, c = ctx || {};
  const str = v => String(v == null ? '' : v).trim();
  return {
    email: str(f.email),
    message: str(f.message),
    name: str(f.name),
    company: str(f.company),
    plan: PLANS.indexOf(f.plan) >= 0 ? f.plan : 'general',
    seats: normalizeSeats(f.seats),
    lang: c.lang === 'ko' ? 'ko' : 'en',
    page: c.page || '',
    captcha: c.captcha || ''
  };
}

/* ---- browser part ---- */
function boot(){
  const doc = document;
  const Q = new URLSearchParams(location.search);
  // Local test stack: only on localhost / 127.0.0.1 AND with ?api=local (same switch as site/order/index.html).
  // The request carries no key: the inquiry function runs without JWT verification and Turnstile is its gate.
  const LOCAL_API = ['localhost', '127.0.0.1'].includes(location.hostname) && Q.get('api') === 'local';
  const SUPABASE_URL = LOCAL_API ? 'http://127.0.0.1:55321' : 'https://hiycfjwswtkixyoqkznm.supabase.co';

  let dlg = null, form = null, busy = false, lang = 'en';
  const $ = sel => dlg.querySelector(sel);

  const CSS = `
dialog.inq{margin:auto;padding:0;border:1px solid var(--line2,#2c2d34);border-radius:var(--r,0);background:var(--bg,#0a0a0c);color:var(--ink,#ececef);
  width:min(480px,calc(100vw - 24px));max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);overflow:auto;font-family:var(--sans,var(--font-body,sans-serif));font-size:14px;line-height:1.55}
dialog.inq::backdrop{background:rgba(0,0,0,.55)}
.inq-box{padding:24px;position:relative}
.inq h2{font-size:20px;margin:0 36px 6px 0;line-height:1.25;letter-spacing:-.01em}
.inq p.inq-intro{margin:0 0 16px;color:var(--dim,#9b9da6)}
.inq-x{position:absolute;top:12px;right:12px;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;background:transparent;color:var(--dim,#9b9da6);font-size:20px;line-height:1;padding:0}
.inq-x:hover{border-color:var(--line2,#2c2d34);color:var(--ink,#ececef)}
.inq label{display:block;margin:0 0 12px;font-size:13px;font-weight:500;color:var(--ink,#ececef)}
.inq label .inq-opt{font-weight:400;color:var(--faint,#686a74);margin-left:4px}
.inq input,.inq select,.inq textarea{display:block;width:100%;margin-top:5px;padding:8px 10px;border:1px solid var(--line2,#2c2d34);border-radius:var(--r,0);background:var(--bg,#0a0a0c);color:var(--ink,#ececef);font:inherit;font-weight:400}
.inq textarea{min-height:110px;resize:vertical}
.inq input:focus-visible,.inq select:focus-visible,.inq textarea:focus-visible,.inq-x:focus-visible,.inq-btn:focus-visible{outline:2px solid var(--accent-fg,var(--accent2,#8a94f2));outline-offset:2px}
.inq [aria-invalid=true]{border-color:var(--ink,#ececef)}
.inq-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.inq-hp{position:absolute!important;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}
.inq-fe{display:block;margin-top:4px;font-size:12.5px;font-weight:500;color:var(--ink,#ececef)}
.inq-fe:empty{display:none}
.inq-consent{margin:4px 0 14px;font-size:12.5px;color:var(--dim,#9b9da6)}
.inq-consent a,.inq-status a{text-decoration:underline;text-underline-offset:2px}
.inq-status{min-height:0;margin:0 0 12px;font-size:13px;font-weight:500}
.inq-status:empty{display:none}
.inq-btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 18px;border:1px solid var(--accent-fg,var(--accent,#5e6ad2));border-radius:var(--r,0);background:var(--accent,#5e6ad2);color:var(--on-accent,#fff);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.inq-btn[disabled]{opacity:.6;cursor:default}
.inq-done[hidden],.inq-form[hidden]{display:none}
.inq-done p{margin:6px 0 16px;color:var(--dim,#9b9da6)}
@media(max-width:520px){.inq-box{padding:20px 16px}.inq-row{grid-template-columns:1fr}.inq input,.inq select,.inq textarea{font-size:16px}}
`;

  function build(){
    if(!doc.getElementById('inquiry-style')){
      const st = doc.createElement('style'); st.id = 'inquiry-style'; st.textContent = CSS; doc.head.appendChild(st);
    }
    dlg = doc.createElement('dialog');
    dlg.className = 'inq';
    dlg.setAttribute('aria-labelledby', 'inq-title');
    dlg.innerHTML =
      '<div class="inq-box">' +
        '<button type="button" class="inq-x" data-close>&times;</button>' +
        '<div class="inq-form-wrap">' +
          '<h2 id="inq-title" data-s="title"></h2>' +
          '<p class="inq-intro" data-s="intro"></p>' +
          '<form class="inq-form" novalidate>' +
            '<label><span data-s="email"></span><input type="email" name="email" autocomplete="email" required maxlength="254" /><span class="inq-fe" data-fe="email"></span></label>' +
            '<div class="inq-row">' +
              '<label><span data-s="name"></span><span class="inq-opt" data-s="optional"></span><input type="text" name="name" autocomplete="name" maxlength="80" /></label>' +
              '<label><span data-s="company"></span><span class="inq-opt" data-s="optional"></span><input type="text" name="company" autocomplete="organization" maxlength="120" /></label>' +
            '</div>' +
            '<div class="inq-row">' +
              '<label><span data-s="seats"></span><span class="inq-opt" data-s="optional"></span><input type="number" name="seats" min="1" step="1" inputmode="numeric" /></label>' +
              '<label><span data-s="plan"></span><select name="plan">' +
                '<option value="pro" data-s="planPro"></option><option value="enterprise" data-s="planEnterprise"></option>' +
                '<option value="custom" data-s="planCustom"></option><option value="general" data-s="planGeneral"></option></select></label>' +
            '</div>' +
            '<label><span data-s="message"></span><textarea name="message" required maxlength="' + MAX_MESSAGE + '" data-sp="placeholder"></textarea><span class="inq-fe" data-fe="message"></span></label>' +
            '<div class="inq-hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off" /></div>' +
            '<div class="captcha"></div>' +
            '<p class="inq-consent" data-sh="consent"></p>' +
            '<p class="inq-status" role="status" aria-live="polite"></p>' +
            '<button type="submit" class="inq-btn" data-s="submit"></button>' +
          '</form>' +
        '</div>' +
        '<div class="inq-done" hidden>' +
          '<h2 data-s="doneTitle"></h2><p data-s="doneBody"></p>' +
          '<button type="button" class="inq-btn" data-close data-s="close"></button>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(dlg);
    form = $('form');
    dlg.addEventListener('click', e => {
      if(e.target === dlg || (e.target.closest && e.target.closest('[data-close]'))) dlg.close();
    });
    form.addEventListener('submit', onSubmit);
    /* A field's error goes away as soon as the visitor edits that field. */
    form.addEventListener('input', e => {
      const n = e.target && e.target.name;
      if(n === 'email' || n === 'message') setFieldError(n, '');
    });
  }

  function t(key){ return STRINGS[lang][key]; }

  function applyLang(){
    dlg.querySelectorAll('[data-s]').forEach(el => { el.textContent = t(el.dataset.s); });
    dlg.querySelectorAll('[data-sh]').forEach(el => { el.innerHTML = t(el.dataset.sh); });
    dlg.querySelectorAll('[data-sp]').forEach(el => { el.placeholder = t(el.dataset.sp); });
    $('.inq-x').setAttribute('aria-label', t('close'));
    dlg.lang = lang;
  }

  function setStatus(key){ $('.inq-status').innerHTML = key ? t(key) : ''; }
  function setFieldError(name, key){
    const input = form.elements[name], slot = $('[data-fe="' + name + '"]');
    if(slot) slot.textContent = key ? t(key) : '';
    if(input){ if(key) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }
  function clearErrors(){ setStatus(''); setFieldError('email', ''); setFieldError('message', ''); }

  function setBusy(on){
    busy = on;
    const b = $('.inq-btn[type=submit]');
    b.disabled = on;
    b.textContent = t(on ? 'sending' : 'submit');
  }

  function readFields(){
    const v = n => form.elements[n].value;
    return { email: v('email'), name: v('name'), company: v('company'), seats: v('seats'), plan: v('plan'), message: v('message') };
  }

  /* `sent` is false on the honeypot path: nothing reached the server, so it is not a conversion. */
  function showDone(sent){
    $('.inq-form-wrap').hidden = true;
    $('.inq-done').hidden = false;
    if(sent && typeof gtag === 'function') gtag('event', 'conversion', { 'send_to': CONVERSION });
  }

  async function onSubmit(e){
    e.preventDefault();
    if(busy) return;
    clearErrors();
    const fields = readFields();
    const v = validate(fields);
    if(!v.ok){
      if(v.errors.email) setFieldError('email', v.errors.email);
      if(v.errors.message) setFieldError('message', v.errors.message);
      const first = form.elements[v.errors.email ? 'email' : 'message']; if(first) first.focus();
      return;
    }
    // Honeypot: a bot fills the hidden field. Show success and send nothing.
    if(form.elements.website.value){ showDone(false); return; }
    setBusy(true);
    try{
      let captcha = '';
      if(window.SpragCaptcha){ try{ captcha = await window.SpragCaptcha.token(); }catch(err){ captcha = ''; } }
      if(!captcha){ setStatus('errCaptcha'); return; }
      const body = buildPayload(fields, { lang, page: location.pathname, captcha });
      let res;
      try{
        res = await fetch(SUPABASE_URL + '/functions/v1/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      }catch(err){ setStatus('errGeneral'); return; }
      const j = await res.json().catch(() => ({}));
      if(res.status === 200 && j && j.ok === true){ showDone(true); }
      else if(res.status === 400 && j && j.error === 'invalid' && j.field === 'email'){ setFieldError('email', 'errEmail'); form.elements.email.focus(); }
      else if(res.status === 400 && j && j.error === 'invalid' && j.field === 'message'){ setFieldError('message', 'errMessage'); form.elements.message.focus(); }
      else if(res.status === 403){ setStatus('errCaptcha'); }
      else if(res.status === 429){ setStatus('errLimit'); }
      else setStatus('errGeneral');
    }finally{
      // A Turnstile token is good for one request, sent or failed.
      if(window.SpragCaptcha){ try{ window.SpragCaptcha.reset(); }catch(err){} }
      setBusy(false);
    }
  }

  function open(plan){
    if(!dlg) build();
    lang = (doc.documentElement.lang || '').toLowerCase().indexOf('ko') === 0 ? 'ko' : 'en';
    if($('.inq-done').hidden === false){ form.reset(); $('.inq-done').hidden = true; $('.inq-form-wrap').hidden = false; }
    applyLang();
    clearErrors();
    setBusy(false);
    form.elements.plan.value = PLANS.indexOf(plan) >= 0 ? plan : 'general';
    if(!dlg.open) dlg.showModal();
    if(window.SpragCaptcha){ window.SpragCaptcha.mount($('.captcha')).catch(() => {}); }
    form.elements.email.focus();
  }

  doc.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('[data-inquiry]');
    if(!el) return;
    e.preventDefault();
    open(el.getAttribute('data-inquiry'));
  });
  window.SpragInquiry = { open };
}

if(typeof document !== 'undefined') boot();
if(typeof module !== 'undefined' && module.exports) module.exports = { validate, buildPayload, STRINGS };
})();
