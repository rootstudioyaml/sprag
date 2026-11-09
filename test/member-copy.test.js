/**
 * Member names in the /team members table and the seat tables of /team and /ops copy themselves
 * on click. The button comes from AdminUX.copyId; the pages fall back to plain text when a cached
 * admin-ux.js predates it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const ux = read('../site/assets/admin-ux.js');
const team = read('../site/team/index.html');
const ops = read('../site/ops/index.html');

test('admin-ux exports copyId and handles .cp-id clicks with a clipboard write', () => {
  assert.match(ux, /window\.AdminUX = \{ copyId,/);
  assert.match(ux, /closest\('\.cp-id'\)/);
  assert.match(ux, /navigator\.clipboard\.writeText\(v\)/);
  for (const k of ['cpTip', 'cpDone', 'cpFail']) assert.equal(ux.split(k + ':').length - 1, 2, `${k} in both languages`);
});

test('both pages guard copyId and use it for member names', () => {
  const guard = 'const cpId = (v, shown) => AdminUX.copyId ? AdminUX.copyId(v, shown) : esc(shown ?? v);';
  assert.ok(team.includes(guard) && ops.includes(guard));
  assert.ok(team.includes('(m.display_name ? cpId(m.display_name) : \'-\')'), 'members table');
  assert.ok(team.includes('return cpId(NAME(r)) + (r.seat_of'), '/team seat table');
  assert.ok(ops.includes('return cpId(NAME(r)) + (r.seat_of'), '/ops seat table');
});
