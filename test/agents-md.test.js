import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
// The title and the note under it name each file's own reader, so the
// comparison starts at the first section.
const body = (name) => {
  assert.ok(existsSync(file(name)), `${name} is required; include it in the checkout.`);
  const text = readFileSync(file(name), 'utf8');
  assert.match(text, /^## \S/m, `${name} must contain project instruction sections.`);
  return text.replace(/^[\s\S]*?(?=^## )/m, '');
};

test('AGENTS.md carries the same project instructions as CLAUDE.md', () => {
  assert.equal(body('AGENTS.md'), body('CLAUDE.md'));
});
