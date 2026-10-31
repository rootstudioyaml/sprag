/**
 * The "limit pressure" and "savings basis" explanations are two static sections, not a video.
 * site/index.html carries them under the terminal comparison video; docs/explain/explain.html
 * is the same markup and Korean strings, captured per section into docs/sprag-{limits,savings}-{en,ko}.png
 * for the READMEs. These tests keep the two copies in step, pin the savings figures to
 * docs/explain/savings-snapshot.json, and make sure no video or GIF reference comes back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
const snap = JSON.parse(read('docs/explain/savings-snapshot.json'));
const site = read('site/index.html');
const page = read('docs/explain/explain.html');

const keysOf = (html) => [...html.matchAll(/data-k="(ex\.[a-z0-9.]+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);
const koOf = (html) => Object.fromEntries([...html.matchAll(/'(ex\.[a-z0-9.]+)':'([^']*)'/g)].map((m) => [m[1], m[2]]));

test('site and explain.html carry the same English strings and Korean dictionary', () => {
  const a = keysOf(site);
  const b = keysOf(page);
  assert.ok(a.length >= 20, 'site section has its data-k strings');
  assert.deepEqual(b, a);
  assert.deepEqual(koOf(page), koOf(site));
  for (const [k] of a) assert.ok(koOf(site)[k], `Korean string for ${k}`);
});

test('the section markup is identical in the site and the README source page', () => {
  const block = (html) => html.match(/<div class="explain">[\s\S]*?\n    <\/div>\n/)?.[0];
  assert.ok(block(site));
  assert.equal(block(page), block(site));
});

test('limits and savings are separate sections, limits first, each with its own heading', () => {
  const b = site.match(/<div class="explain">[\s\S]*?\n    <\/div>\n/)[0];
  const secs = [...b.matchAll(/<section class="ex-card ex-(\w+)" data-part="(\w+)">\s*<h3 /g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(secs, [['limits', 'limits'], ['savings', 'savings']]);
  assert.match(b, /<div class="ex-col">[\s\S]*<div class="ex-col ex-val">/);
});

test('no separators, no mono font on Korean card text, no animation', () => {
  const ko = Object.values(koOf(site)).join('\n');
  assert.doesNotMatch(ko, /[—|ㅡ]/);
  const css = site.match(/\/\* explain sections:[\s\S]*?@media\(max-width:720px\)\{\.ex-card[^\n]*\n/)[0];
  assert.doesNotMatch(css, /var\(--mono\)|animation|transition/);
});

const money = (n) => '$' + n.toFixed(2);
const fmtK = (n) => `${Math.round(n / 1000)}k`;
const fmtMan = (n) => `${(n / 10000).toFixed(1)}만`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const enDate = (iso) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8)}`;

test('the savings figures shown match docs/explain/savings-snapshot.json', () => {
  const t = snap.terms;
  const amounts = [['+', t.rereadConversation], ['+', t.rereadPiledUp], ['+', t.newInputOutput], ['−', t.subagentCost], ['−', t.delegatingCost], ['=', snap.saving]];
  for (const [name, html] of [['site', site], ['explain.html', page]]) {
    const shown = [...html.matchAll(/<span class="ex-amt"><i>(.)<\/i><b>([^<]*)<\/b>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(shown, amounts.map(([sg, v]) => [sg, money(v)]), name);
    const en = Object.fromEntries(keysOf(html));
    const ko = koOf(html);
    const y = snap.to.slice(0, 4);
    assert.equal(en['ex.b.d'], `${enDate(snap.from)} to ${enDate(snap.to)}, ${y}, one dev machine, ${snap.runs} delegations`, name);
    assert.equal(ko['ex.b.d'], `${snap.from} ~ ${snap.to}, 개발 PC 1대, 위임 ${snap.runs}건`, name);
    assert.equal(en['ex.b.m'], `Last ${snap.days} days, measured`, name);
    assert.equal(ko['ex.b.m'], `최근 ${snap.days}일 실측`, name);
    assert.equal(en['ex.b.n1'], `Conversation size at delegation: ${fmtK(snap.contextTokens.mean)} tokens on average, ${fmtK(snap.contextTokens.median)} median`, name);
    assert.equal(ko['ex.b.n1'], `위임 시점 대화 크기: 평균 ${fmtMan(snap.contextTokens.mean)} 토큰, 중앙값 ${fmtMan(snap.contextTokens.median)} 토큰`, name);
    assert.equal(snap.negativeRuns, 0, 'the "no loss" line needs negativeRuns 0');
    assert.equal(ko['ex.b.n2'], `손해로 계산된 위임 ${snap.negativeRuns}건`, name);
    assert.equal(en['ex.b.n2'], 'No delegation counted as a loss', name);
  }
});

test('the three plus terms minus the two minus terms equal the saving (within a cent)', () => {
  const t = snap.terms;
  const sum = t.rereadConversation + t.rereadPiledUp + t.newInputOutput - t.subagentCost - t.delegatingCost;
  assert.ok(Math.abs(sum - snap.saving) <= 0.01, `${sum} vs ${snap.saving}`);
  assert.ok(Math.abs(snap.check - snap.saving) <= 0.01);
});

test('the explain video and GIF are gone; the four README images exist and stay under 500KB', () => {
  for (const f of ['site/index.html', 'README.md', 'README.ko.md']) {
    assert.doesNotMatch(read(f), /sprag-explain-(en|ko)\.(mp4|gif|jpg|png)|explain-video/, f);
  }
  for (const l of ['en', 'ko']) {
    const readme = read(l === 'en' ? 'README.md' : 'README.ko.md');
    for (const part of ['limits', 'savings']) {
      assert.ok(readme.includes(`docs/sprag-${part}-${l}.png`), `${part} ${l} in README`);
      const png = ROOT + `docs/sprag-${part}-${l}.png`;
      assert.ok(existsSync(png));
      assert.ok(statSync(png).size < 500 * 1024, `${part} ${l} png stays under 500KB`);
    }
    assert.ok(readme.indexOf(`sprag-limits-${l}.png`) < readme.indexOf(`sprag-savings-${l}.png`));
    assert.ok(readme.includes(money(snap.saving)) && readme.includes(String(snap.runs)), `${l} savings alt carries the total and the delegation count`);
    for (const ext of ['mp4', 'jpg']) assert.ok(!existsSync(ROOT + `site/assets/video/sprag-explain-${l}.${ext}`));
    for (const ext of ['gif', 'png']) assert.ok(!existsSync(ROOT + `docs/sprag-explain-${l}.${ext}`));
  }
});
