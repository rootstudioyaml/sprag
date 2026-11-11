// The cast thumbnail atlas (site/assets/scene/cast/atlas.webp) is rendered by tools/blender/render_thumbs.py.
// The page finds a species' cell by its index in GRADES (then ghost), and the Blender script reads the order from
// src/office-species.js. These checks keep the file in budget and the two key orders in step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const ATLAS = new URL('site/assets/scene/cast/atlas.webp', root);

test('atlas.webp exists, stays under 250 KB and is 1280x640 with alpha', () => {
  const size = statSync(ATLAS).size;
  assert.ok(size > 10_000 && size <= 250 * 1024, `atlas.webp is ${size} bytes`);
  const b = readFileSync(ATLAS);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  assert.equal(b.toString('ascii', 12, 16), 'VP8X', 'extended format (needed for alpha)');
  assert.ok(b[20] & 0x10, 'alpha flag set');
  const w = 1 + b.readUIntLE(24, 3), h = 1 + b.readUIntLE(27, 3);
  assert.deepEqual([w, h], [1280, 640]);
});

test('GRADES order in src/office-species.js matches site/assets/scene/office-scene.js', () => {
  const src = [...readFileSync(new URL('src/office-species.js', root), 'utf8').matchAll(/row\('([a-z]+)'/g)].map(m => m[1]);
  const site = [...readFileSync(new URL('site/assets/scene/office-scene.js', root), 'utf8').matchAll(/\bG\('([a-z]+)', -?[\d.]+, '/g)].map(m => m[1]);
  assert.equal(src.length, 30);
  assert.deepEqual(site, src);
});
