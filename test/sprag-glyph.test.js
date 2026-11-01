/**
 * Sprag marks the lines it prints or injects with the ✇ glyph: `✇ [sprag] ...`.
 * Output written by older versions starts with `[sprag` or `🔀 [sprag]`, so every
 * reader of those strings has to accept the old form as well as the new one.
 */
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderModelRatchet } from '../src/model-rules.js';
import { isSpragFeedback } from '../src/codex/harness.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

function isolatedHome(t) {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const home = mkdtempSync(join(tmpdir(), 'sprag-glyph-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

test('the fitting line in ratchet-model.md starts with the ✇ glyph in both languages', (t) => {
  isolatedHome(t);
  const ko = renderModelRatchet([], 'ko', { root: null });
  assert.ok(ko.includes('`✇ [sprag] 모델 피팅: "<유형>"'));
  assert.ok(!ko.includes('🔀 [sprag]'));
  const en = renderModelRatchet([], 'en', { root: null });
  assert.ok(en.includes('`✇ [sprag] model fitting: "<category>"'));
  assert.ok(!en.includes('🔀 [sprag]'));
});

test('the answer-end label told to the model is ✇ [sprag], not the old ※ label', () => {
  for (const file of ['brief.js', 'commands/route-scan.js']) {
    const text = read(file);
    assert.ok(text.includes('`✇ [sprag]` 라벨'), `${file} should name the ✇ label`);
    assert.ok(!text.includes('※ [sprag]'), `${file} should not use the ※ label`);
  }
  assert.ok(read('commands/route-scan.js').includes('under a `✇ [sprag]` label'));
});

test('the route hint tells the model to print the ✇ fitting line', () => {
  const text = read('route-inject.js');
  assert.ok(text.includes('`✇ [sprag] 모델 피팅: "${label}"'));
  assert.ok(text.includes('`✇ [sprag] model fit: "${label}"'));
  assert.ok(!text.includes('🔀 [sprag]'));
});

test('injected tags start with the glyph, never with a bare [sprag', () => {
  const files = [
    'brief.js', 'cohesion.js', 'commands/route-scan.js', 'delegation-agents.js', 'korean-style.js',
    'monthly-reset-offer.js', 'org-upgrade.js', 'route-follow.js', 'route-inject.js', 'update-notice.js',
  ];
  for (const file of files) {
    for (const [i, line] of read(file).split('\n').entries()) {
      assert.ok(!/['"`]\[sprag/.test(line), `${file}:${i + 1} opens a string with a bare [sprag tag`);
    }
  }
});

test('Sprag feedback detection accepts the old and the new form of every tag', () => {
  for (const out of [
    '[sprag] 이 요청은', '✇ [sprag] 이 요청은',
    '🔀 [sprag] 모델 피팅: "x" → t2-runner 위임', '✇ [sprag] 모델 피팅: "x" → t2-runner 위임',
    '🔀 [sprag] model fitting: "x" → delegated to t2-runner', '✇ [sprag] model fitting: "x" → delegated to t2-runner',
    '[sprag korean-style] x', '✇ [sprag korean-style] x',
    '[korean-style] a.md 에 문체 규약 위반', '✇ [korean-style] a.md 에 문체 규약 위반',
    '  ✇ [sprag update] A newer version', '[claude-token-saver] old',
  ]) {
    assert.ok(isSpragFeedback(out), out);
  }
  assert.ok(!isSpragFeedback('error: [sprag] in the middle'));
  assert.ok(!isSpragFeedback('✇ not a tag'));
});
