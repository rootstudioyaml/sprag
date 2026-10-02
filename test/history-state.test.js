// The chip state and the cap-warning slots share one file. Regression test for
// the 2026-10-01 review (C6): saving a chip transition must leave the slots.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmp;
let prevXdg;
let history;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'cts-history-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
  // history.js resolves its directory at load, so it is imported only now.
  history = await import('../src/history.js');
});
after(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  rmSync(tmp, { recursive: true, force: true });
});

const dayFile = () => {
  const dir = join(tmp, 'claude-token-saver', 'history');
  return readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
};

test('a chip transition does not make a standing cap warning fire again', () => {
  const win = { key: 'five_hour', usedPct: 94, resetsAt: null };
  assert.equal(history.recordCapTransition(win), true, 'crossing 90% is logged');
  assert.equal(history.recordCapTransition(win), false, 'staying above it is not');

  assert.equal(history.recordChip('⚠ Ctx 500k+'), true);
  assert.equal(history.recordCapTransition(win), false, 'the chip save must keep the cap slot');
  assert.equal(history.recordChip(null), true);
  assert.equal(history.recordCapTransition(win), false);

  assert.equal((dayFile().match(/cap warning \(|cap warning$/gm) || []).length, 1, 'one cap warning line for one episode');

  assert.equal(history.recordCapTransition({ ...win, usedPct: 40 }), true, 'dropping below 90% resolves it');
  assert.match(dayFile(), /cap warning resolved/);
});
