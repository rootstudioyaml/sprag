import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { GRADES } = await import('../site/assets/scene/office-scene.js');
const { SPECIES, speciesLabel } = await import('../src/office-species.js');

// The console's I18N tables are Object.assign(I18N.<lang>, {...}) blocks of JSON.
function consoleNames(lang) {
  const html = readFileSync(new URL('../site/team/index.html', import.meta.url), 'utf8');
  const out = {};
  for (const m of html.matchAll(new RegExp(`Object\\.assign\\(I18N\\.${lang}, (\\{.*?\\})\\);`, 'g'))) {
    for (const [k, v] of Object.entries(JSON.parse(m[1]))) if (k.startsWith('of.g.') && k !== 'of.g.no') out[k.slice(5)] = v;
  }
  return out;
}

test('species keys are the GRADES keys plus ghost', () => {
  assert.deepEqual(Object.keys(SPECIES).sort(), [...GRADES.map(g => g.k), 'ghost'].sort());
});

test('species names equal the console strings in en and ko', () => {
  for (const lang of ['en', 'ko']) {
    const names = consoleNames(lang);
    assert.equal(Object.keys(names).length, 31, lang);
    for (const [k, s] of Object.entries(SPECIES)) assert.equal(s[lang], names[k], `${lang} ${k}`);
  }
});

test('speciesLabel puts the emoji before the name and rejects unknown keys', () => {
  assert.equal(speciesLabel('fox', 'ko'), '🦊 여우');
  assert.equal(speciesLabel('fox', 'en'), '🦊 Fox');
  assert.equal(speciesLabel('ghost', 'en'), '👻 Ghost');
  assert.equal(speciesLabel('fox', 'ko', { emoji: false }), '여우');
  assert.equal(speciesLabel('nope', 'en', { emoji: false }), null);
  assert.equal(speciesLabel('nope', 'en'), null);
  assert.equal(speciesLabel('toString', 'en'), null);
  for (const s of Object.values(SPECIES)) assert.ok(s.emoji && s.en && s.ko);
});
