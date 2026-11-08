/**
 * The delegation grade's statusline chips: `model↑N` (judgement work raised to
 * Opus) and the relax chip, which shows only while a relax window is open. They sit in the
 * `delegated` slot beside the effort chip, hide at zero, and  a default
 * install shows no relax chip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReport, DEFAULT_SEGMENT_ORDER } from '../src/formatters/statusline.js';
import { formatResetClock } from '../src/format-time.js';

function data(extra = {}) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: null,
    spikeChip: null,
    caps: null,
    model: null,
    delegationSaved: 3.2,
    ...extra,
  };
}

const one = { color: false, timer: false, singleLine: true };
const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

test('the model chip follows the effort chip, in text, icon and verbose modes', () => {
  const d = data({
    effortRaises: { count: 3, since: null },
    gradeActions: { raised: 2, since: null },
  });
  assert.match(formatReport(d, one), /Routing saved \$3\.20? · effort↑3 · model↑2/);
  assert.match(formatReport(d, { ...one, mode: 'icon' }), /🔀 \$3\.20? · 🔬↑3 · 🤖↑2/);
  assert.match(formatReport(d, { ...one, mode: 'icon', verbose: true }), /effort guard ×3 · model guard ×2/);
});

test('the count hides at zero', () => {
  const only = (gradeActions) => formatReport(data({ gradeActions }), one);
  assert.match(only({ raised: 4 }), /model↑4/);
  assert.doesNotMatch(only({ raised: 0 }), /model↑/);
  // A count file from the earlier version carried `blocked`; it draws nothing.
  assert.doesNotMatch(only({ raised: 0, blocked: 2 }), /held|model↑/);
});

test('with nothing to show the line is byte-identical to one without the fields', () => {
  for (const mode of ['text', 'icon']) {
    for (const o of [one, { color: false, timer: false }]) {
      const base = formatReport(data(), { ...o, mode });
      for (const extra of [
        { gradeActions: { raised: 0, since: null } },
        { gradeActions: null },
        { relaxUntil: null },
        { relaxUntil: undefined },
        { relaxUntil: Date.now() - 60000 },
        { relaxUntil: 'soon' },
        { delegationGrade: 'cost' },
      ]) assert.equal(formatReport(data(extra), { ...o, mode }), base, JSON.stringify(extra));
    }
  }
});

test('the relax chip shows only while the window is open', () => {
  const until = new Date(2099, 5, 1, 21, 30).getTime();
  const clock = formatResetClock(until / 1000);
  assert.match(formatReport(data({ relaxUntil: until }), one), new RegExp(`Routing saved \\$3\\.20? · relax →${clock}`));
  assert.match(formatReport(data({ relaxUntil: until }), { ...one, verbose: true }), new RegExp(`relax until ${clock}`));
  assert.doesNotMatch(formatReport(data({ relaxUntil: Date.now() - 1000 }), one), /relax/, 'expired');
  assert.doesNotMatch(formatReport(data(), one), /relax/);
});

test('the chips survive the multi-line layout, below the effort guard line', () => {
  const since = new Date(new Date().getFullYear(), 10, 1).getTime();
  const totals = { week: 0, month: 0, total: 3.2, spent: 0, spentMissing: 0, pairs: [], since };
  const lines = formatReport(data({
    delegationTotals: totals,
    effortRaises: { count: 2, since },
    gradeActions: { raised: 1, since },
    relaxUntil: new Date(2099, 5, 1, 21, 30).getTime(),
  }), { color: false, timer: false }).split('\n');
  assert.match(lines[0], /^Effort guard ×2/);
  const last = lines[lines.length - 1];
  assert.match(last, /model↑1 · relax →/);
  assert.doesNotMatch(last, /effort↑/, 'the effort chip steps aside for its line, as before');
});

test('the chips are gray, like the effort chip', () => {
  const colored = formatReport(data({ effortRaises: { count: 1, since: null }, gradeActions: { raised: 1 }, relaxUntil: new Date(2099, 5, 1, 21, 30).getTime() }), { ...one, color: true });
  const toneOf = (label) => colored.match(new RegExp(`(\\x1b\\[[\\d;]+m)${label}\\x1b\\[0m`))?.[1];
  assert.ok(toneOf('effort↑1'));
  assert.equal(toneOf('model↑1'), toneOf('effort↑1'));
  assert.equal(toneOf(`relax →${formatResetClock(new Date(2099, 5, 1, 21, 30).getTime() / 1000)}`), toneOf('effort↑1'));
});

test('they ride with the delegated segment name: no new segment to list', () => {
  assert.ok(DEFAULT_SEGMENT_ORDER.includes('delegated'));
  const d = data({ gradeActions: { raised: 1 } });
  assert.match(strip(formatReport(d, { ...one, segments: ['delegated'] })), /model↑1/);
  assert.doesNotMatch(strip(formatReport(d, { ...one, segments: ['saved'] })), /model↑1/);
});
