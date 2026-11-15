import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shapeLike } from '../scripts/presets-shape.mjs';

/* jsonb sorts keys shorter first; a pull of unchanged content must write the committed bytes back */
const jsonbOrder = (v) => (Array.isArray(v) ? v.map(jsonbOrder) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map((k) => [k, jsonbOrder(v[k])])) : v);

for (const [name, key] of [['agents.json', 'agents'], ['model-rules.json', 'presets'], ['ratchet-rules.json', 'rules']]) {
  test(`presets pull keeps the committed key order: ${name}`, () => {
    const text = readFileSync(new URL(`../presets/${name}`, import.meta.url), 'utf8'), data = JSON.parse(text);
    const back = { ...data, [key]: shapeLike(jsonbOrder(data[key]), data[key]) };
    assert.equal(JSON.stringify(back, null, 2) + '\n', text);
  });
}

test('presets pull: items match by id, new keys and new items keep their own order after the known ones', () => {
  const t = [{ id: 'a', name: 'A', body: { ko: 'k', en: 'e' } }];
  const v = [{ zz: 1, body: { en: 'E', ko: 'K' }, id: 'b', name: 'B' }, { name: 'A2', id: 'a', body: { en: 'e2', ko: 'k2' } }];
  assert.deepEqual(shapeLike(v, t).map((x) => Object.keys(x)), [['id', 'name', 'body', 'zz'], ['id', 'name', 'body']]);
  assert.deepEqual(Object.keys(shapeLike(v, t)[1].body), ['ko', 'en']);
  assert.deepEqual(shapeLike(v, t)[1], { id: 'a', name: 'A2', body: { ko: 'k2', en: 'e2' } }, 'values are untouched');
});
