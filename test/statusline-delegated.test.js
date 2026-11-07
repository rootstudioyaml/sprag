/**
 * The delegation-savings chip is a second, separate savings number: "Cache
 * saved" is prompt-cache only. It must render in every label mode, stay out of
 * the line when there is nothing measured, and never disturb the existing chip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../src/formatters/statusline.js';

function data(delegationSaved) {
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
    delegationSaved,
  };
}

const opts = { color: false, timer: false };

test('the chip renders in text, icon, and icon+verbose modes', () => {
  assert.match(formatReport(data(3.2), opts), /Routing saved \$3\.2/);
  assert.match(formatReport(data(3.2), { ...opts, mode: 'icon' }), /🔀 \$3\.2/);
  const verbose = formatReport(data(3.2), { ...opts, mode: 'icon', verbose: true });
  assert.match(verbose, /🔀 Routing saved \$3\.2/);
});

test('nothing measured means no chip at all, not "$0"', () => {
  for (const value of [0, undefined, null, NaN]) {
    const out = formatReport(data(value), opts);
    assert.doesNotMatch(out, /Routing saved/, `value ${String(value)} should hide the chip`);
    assert.match(out, /Cache saved/, 'the cache chip is unaffected');
  }
});

test('routing savings lead, cache savings keep their own value and place', () => {
  const out = formatReport(data(3.2), opts);
  assert.match(out, /Cache saved \$1\.5K/);
  assert.ok(out.indexOf('Routing saved') < out.indexOf('Cache saved'), 'routing savings lead the line');
  assert.ok(out.indexOf('Cache saved') < out.indexOf('1d'), 'the period label still closes the line');
});

test('the segment whitelist knows the chip by name', () => {
  const only = formatReport(data(3.2), { ...opts, segments: ['delegated'] });
  assert.match(only, /Routing saved \$3\.2/);
  assert.doesNotMatch(only, /Cache saved/);
  assert.doesNotMatch(formatReport(data(3.2), { ...opts, segments: ['saved'] }), /Routing saved/);
});

test('--no-color output carries no ANSI escapes', () => {
  assert.doesNotMatch(formatReport(data(3.2), opts), /\x1b\[/);
});


// The effort guard (effort-raise-ledger's totals): Sonnet delegations the guard
// ran at high effort. On the single-line layout it is a gray count chip after
// the savings, as a bare document count is for Doc2md; nothing at zero. What a
// guarded run saved by routing is Routing saved's figure, not the guard's, so
// no money appears here in any layout.
test('the effort guard is a gray count chip on the single-line layout, and nothing at zero', () => {
  const raised = (n) => ({ ...data(3.2), effortRaises: { count: n, cost: 1.23, kept: 0, keptRuns: 0, since: Date.now() } });
  const one = { ...opts, singleLine: true };
  assert.match(formatReport(raised(3), one), /Routing saved \$3\.20? · effort↑3/);
  assert.match(formatReport(raised(3), { ...one, mode: 'icon' }), /🔀 \$3\.20? · 🔬↑3/);
  assert.match(formatReport(raised(3), { ...one, mode: 'icon', verbose: true }), /effort guard ×3/);
  // Gray in color mode: the same tone as the period label, not the savings green.
  const colored = formatReport(raised(3), { ...one, color: true });
  const tone = colored.match(/(\x1b\[[\d;]+m)effort↑3\x1b\[0m/)?.[1];
  assert.ok(tone, colored);
  assert.equal(tone, colored.match(/(\x1b\[[\d;]+m)\(1d\)/)?.[1]);
  // A routing saving on record behind the raises changes nothing, in either layout.
  const kept = (o) => formatReport({ ...raised(3), effortRaises: { ...raised(3).effortRaises, kept: 12.4, keptRuns: 2 } }, o);
  for (const o of [one, opts]) {
    assert.equal(kept(o), formatReport(raised(3), o));
    assert.doesNotMatch(kept(o), /12\.4/);
  }
  // Byte-identical to the line without the field when there is nothing to show.
  for (const mode of ['text', 'icon']) {
    for (const o of [opts, one]) {
      const base = formatReport(data(3.2), { ...o, mode });
      assert.equal(formatReport(raised(0), { ...o, mode }), base);
      assert.equal(formatReport({ ...data(3.2), effortRaises: null }, { ...o, mode }), base);
    }
  }
});

// On the multi-line layout the guard takes the top line, above the savings:
// the count with the same reset mark as Routing saved, then the raise itself.
// The chip steps aside.
test('the effort guard line leads the multi-line layout, above Routing saved', () => {
  const since = new Date(new Date().getFullYear(), 10, 1).getTime(); // 11/1 this year
  const totals = { week: 0, month: 0, total: 3.2, spent: 0, spentMissing: 0, pairs: [], since };
  const withLine = (raises) => ({ ...data(3.2), delegationTotals: totals, effortRaises: raises });
  const raises = { count: 2, cost: 1.23, costMissing: 0, kept: 0, keptRuns: 0, since };
  const lines = formatReport(withLine(raises), opts).split('\n');
  assert.equal(lines[0], 'Effort guard ×2 since 11/1  |  sonnet medium→high');
  assert.match(lines[1], /^Routing saved \$3\.20? since 11\/1/);
  assert.doesNotMatch(lines[lines.length - 1], /effort↑|Effort guard/, 'the chip steps aside for the line');
  const icon = formatReport(withLine(raises), { ...opts, mode: 'icon' }).split('\n');
  assert.equal(icon[0], '🔬🔥 Effort guard ×2 since 11/1  |  sonnet medium→high');
  // Narrow mode has no font-verified flame: the ▲ alone.
  assert.match(formatReport(withLine(raises), { ...opts, mode: 'narrow' }).split('\n')[0], /^▲ Effort guard ×2 since 11\/1/);
  // Without a Routing saved line the guard line still leads, over the chip line.
  const alone = formatReport({ ...data(3.2), effortRaises: raises }, opts).split('\n');
  assert.equal(alone[0], 'Effort guard ×2 since 11/1  |  sonnet medium→high');
  assert.match(alone[1], /Routing saved \$3\.2/);
  // No reset mark on record: no "since".
  assert.equal(formatReport(withLine({ ...raises, since: null }), opts).split('\n')[0], 'Effort guard ×2  |  sonnet medium→high');
  // Nothing raised: no line and no chip.
  const none = formatReport(withLine({ ...raises, count: 0 }), opts);
  assert.doesNotMatch(none, /Effort guard|effort↑/);
  // In color the head is bold in its own tone, not the savings green, and the breakdown stays gray.
  const colored = formatReport(withLine(raises), { ...opts, color: true }).split('\n');
  const green = colored[1].match(/(\x1b\[[\d;]+m)\$3\.2/)?.[1];
  assert.ok(green, 'the Routing saved figure is colored');
  assert.ok(colored[0].includes('\x1b[1mEffort guard'), colored[0]);
  assert.ok(!colored[0].includes(`${green}×2`), colored[0]);
  const gray = colored[0].match(/(\x1b\[[\d;]+m)sonnet medium→high\x1b\[0m/)?.[1];
  assert.equal(gray, colored[colored.length - 1].match(/(\x1b\[[\d;]+m)\(1d\)/)?.[1]);
});
