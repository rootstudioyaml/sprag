/**
 * The inquiry dialog (site/assets/inquiry-form.js) replaces the mailto: buttons on /pricing/ and /license/.
 * These tests pin the pure helpers, the two language tables and the markup contract on both pages.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
// The package is "type": "module", so require() would parse the browser script as ESM and see no module.exports.
// Run it as a classic script with a CommonJS-style module (node has no document, so the browser part stays off).
const mod = { exports: {} };
new Function('module', readFileSync(new URL('../site/assets/inquiry-form.js', import.meta.url), 'utf8'))(mod);
const { validate, buildPayload, STRINGS } = mod.exports;
const lint = require('../src/korean-lint.cjs');

const good = { email: 'user1@example.com', message: 'We are about 20 people at acmeco.' };

test('validate accepts a normal submission', () => {
  const v = validate(good);
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, {});
});

test('validate rejects bad emails', () => {
  for (const email of ['', 'user1', 'user1@', '@example.com', 'user1@example', 'us er@example.com']) {
    const v = validate({ ...good, email });
    assert.equal(v.ok, false, email);
    assert.equal(v.errors.email, 'errEmail');
  }
});

test('validate rejects an empty or whitespace message', () => {
  for (const message of ['', '   \n ']) {
    const v = validate({ ...good, message });
    assert.equal(v.ok, false);
    assert.equal(v.errors.message, 'errMessage');
  }
});

test('validate rejects a message over 4000 characters and accepts exactly 4000', () => {
  assert.equal(validate({ ...good, message: 'a'.repeat(4000) }).ok, true);
  const v = validate({ ...good, message: 'a'.repeat(4001) });
  assert.equal(v.ok, false);
  assert.equal(v.errors.message, 'errMessageLong');
});

test('buildPayload normalizes seats', () => {
  const seats = s => buildPayload({ ...good, seats: s }, {}).seats;
  assert.equal(seats('20'), 20);
  assert.equal(seats(' 7 '), 7);
  assert.equal(seats(5), 5);
  for (const bad of ['', '0', 0, '2.5', 2.5, '-3', 'abc', null, undefined]) assert.equal(seats(bad), null, String(bad));
});

test('buildPayload keeps the four plans and maps anything else to general', () => {
  for (const plan of ['pro', 'enterprise', 'custom', 'general']) assert.equal(buildPayload({ ...good, plan }, {}).plan, plan);
  for (const plan of ['team', '', undefined, 'PRO']) assert.equal(buildPayload({ ...good, plan }, {}).plan, 'general');
});

test('buildPayload passes lang, page and captcha and trims text', () => {
  const p = buildPayload({ ...good, email: ' user1@example.com ', name: ' User One ', company: ' acmeco ' },
    { lang: 'ko', page: '/pricing/', captcha: 'tok' });
  assert.deepEqual(p, {
    email: 'user1@example.com', message: good.message, name: 'User One', company: 'acmeco',
    plan: 'general', seats: null, lang: 'ko', page: '/pricing/', captcha: 'tok'
  });
  assert.equal(buildPayload(good, { lang: 'fr' }).lang, 'en');
});

test('both language tables have the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.ko).sort());
  for (const lang of ['en', 'ko']) for (const [k, v] of Object.entries(STRINGS[lang])) assert.ok(v && v.length, `${lang}.${k}`);
});

test('the Korean strings pass korean-lint', () => {
  const text = Object.values(STRINGS.ko).map(s => lint.stripHtml(s)).join('\n');
  const findings = lint.lintKoreanText(text);
  assert.deepEqual(findings, []);
  for (const s of Object.values(STRINGS.ko)) assert.ok(!/[·—–]/.test(s), s);
});

test('the Korean copy matches the agreed wording', () => {
  const ko = STRINGS.ko;
  assert.equal(ko.title, '도입 문의');
  assert.equal(ko.intro, '조직 이름과 예상 인원을 알려 주시면 주문 링크를 보내 드립니다.');
  assert.equal(ko.submit, '보내기');
  assert.equal(ko.sending, '보내는 중');
  assert.equal(ko.doneTitle, '문의를 받았습니다');
  assert.match(ko.errLimit, /<a href="mailto:support@sprag\.io">support@sprag\.io<\/a>/);
  assert.match(ko.errGeneral, /<a href="mailto:support@sprag\.io">support@sprag\.io<\/a>/);
  assert.match(ko.consent, /<a href="\/privacy\/">개인정보처리방침<\/a>/);
});

const pricing = read('../site/pricing/index.html');
const license = read('../site/license/index.html');
const home = read('../site/index.html');

const anchors = html => [...html.matchAll(/<a\b[^>]*\bdata-inquiry="([^"]*)"[^>]*>/g)].map(m => ({ value: m[1], tag: m[0] }));

test('pricing has four inquiry buttons that keep their mailto fallback', () => {
  const a = anchors(pricing);
  assert.deepEqual(a.map(x => x.value), ['pro', 'enterprise', 'custom', 'general']);
  for (const x of a) assert.match(x.tag, /href="mailto:/);
});

test('license has two inquiry buttons that keep their mailto fallback', () => {
  const a = anchors(license);
  assert.deepEqual(a.map(x => x.value), ['general', 'general']);
  for (const x of a) assert.match(x.tag, /href="mailto:/);
});

// The ad lands on the home page, so the form has to be one click away there too.
test('home has two team inquiry buttons that keep their mailto fallback, with a Korean label', () => {
  const a = anchors(home);
  assert.deepEqual(a.map(x => x.value), ['general', 'general']);
  for (const x of a) { assert.match(x.tag, /href="mailto:/); assert.match(x.tag, /data-k="hero\.team"/); }
  assert.match(home, /'hero\.team':'[^']+'/);
});

test('the pages load the captcha wrapper before the form and skip inquiry buttons in the click conversion', () => {
  for (const html of [pricing, license, home]) {
    const cap = html.indexOf('<script src="/assets/sign-in-captcha.js" defer></script>');
    const inq = html.indexOf('<script src="/assets/inquiry-form.js" defer></script>');
    assert.ok(cap > 0 && inq > cap, 'captcha script before inquiry script');
    assert.ok(html.includes(`closest('[data-copy], a[href^="mailto:"]:not([data-inquiry])')`));
  }
});

test('the production SUPABASE_URL matches the order page', () => {
  const pick = src => src.match(/'(https:\/\/[a-z0-9]+\.supabase\.co)'/)[1];
  const js = read('../site/assets/inquiry-form.js');
  assert.equal(pick(js), pick(read('../site/order/index.html')));
});

// The inquiry function runs without JWT verification (Turnstile is the gate), so this file
// carries no key. A key pasted here would also trip the pre-commit secret scan.
test('the form sends no API key', () => {
  const js = read('../site/assets/inquiry-form.js');
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(js), 'no JWT in the form script');
  assert.ok(!/apikey|Authorization/.test(js), 'no auth headers on the request');
});
