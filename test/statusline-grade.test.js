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

test('the delegation level chip says what the prompt hook adds at 70% and 90%, and steps aside for relax', () => {
  const L1 = { level: 'high', key: 'seven_day', pct: 80.6 }, L2 = { level: 'critical', key: 'five_hour', pct: 93 };
  assert.match(formatReport(data({ delegationLevel: L1 }), one), /L1 delegate if unsure/);
  assert.match(formatReport(data({ delegationLevel: L2 }), one), /L2 delegate multi-step too/);
  assert.match(formatReport(data({ delegationLevel: L1 }), { ...one, mode: 'icon' }), /🔀L1 delegate if unsure/);
  assert.match(formatReport(data({ delegationLevel: L1 }), { ...one, verbose: true }), /delegation L1 at 7D 81%: delegate when unsure \(sprag routing relax widens it\)/);
  assert.match(formatReport(data({ delegationLevel: L2 }), { ...one, verbose: true }), /delegation L2 at 5H 93%: multi-step work too, consider \/model/);
  const relaxed = formatReport(data({ delegationLevel: L1, relaxUntil: new Date(2099, 5, 1, 21, 30).getTime() }), one);
  assert.match(relaxed, /relax →/); assert.doesNotMatch(relaxed, /L1 delegate/, 'the relax chip already says delegation is widened');
  for (const lv of [null, undefined, { level: 'normal', key: 'seven_day', pct: 40 }]) assert.equal(formatReport(data({ delegationLevel: lv }), one), formatReport(data(), one));
});

test('the CLI hands the statusline the same capPressure the prompt hook reads, only while routing is on', async () => {
  const { readFileSync } = await import('node:fs');
  const cli = readFileSync(new URL('../bin/cli.js', import.meta.url), 'utf8');
  assert.match(cli, /if \(routingEnabled\(\) && caps\) \{\s*const \{ capPressure \} = await import\('\.\.\/src\/caps-cache\.js'\);/);
  assert.match(cli, /delegationLevel: isStatusline \? delegationLevel : undefined,/);
});
