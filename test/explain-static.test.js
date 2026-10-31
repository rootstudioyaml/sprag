/**
 * The "limit pressure + savings basis" explanation is two static cards, not a video.
 * site/index.html carries them under the terminal comparison video; docs/explain/explain.html
 * is the same markup and Korean strings, captured into docs/sprag-explain-{en,ko}.png for the READMEs.
 * These tests keep the two copies in step and make sure no video or GIF reference comes back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
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

test('the card markup is identical in the site and the README source page', () => {
  const block = (html) => html.match(/<div class="explain">[\s\S]*?\n    <\/div>\n/)?.[0];
  assert.ok(block(site));
  assert.equal(block(page), block(site));
});

test('no separators, no mono font on Korean card text, no animation', () => {
  const ko = Object.values(koOf(site)).join('\n');
  assert.doesNotMatch(ko, /[—|ㅡ]/);
  const css = site.match(/\/\* explain cards:[\s\S]*?@media\(max-width:720px\)\{\.explain[^\n]*\n/)[0];
  assert.doesNotMatch(css, /var\(--mono\)|animation|transition/);
});

test('the explain video and GIF are gone from the site and both READMEs', () => {
  for (const f of ['site/index.html', 'README.md', 'README.ko.md']) {
    assert.doesNotMatch(read(f), /sprag-explain-(en|ko)\.(mp4|gif|jpg)|explain-video/, f);
  }
  for (const l of ['en', 'ko']) {
    assert.ok(read(l === 'en' ? 'README.md' : 'README.ko.md').includes(`docs/sprag-explain-${l}.png`));
    const png = ROOT + `docs/sprag-explain-${l}.png`;
    assert.ok(existsSync(png));
    assert.ok(statSync(png).size < 500 * 1024, `${l} png stays under 500KB`);
    for (const ext of ['mp4', 'jpg']) assert.ok(!existsSync(ROOT + `site/assets/video/sprag-explain-${l}.${ext}`));
    assert.ok(!existsSync(ROOT + `docs/sprag-explain-${l}.gif`));
  }
});
