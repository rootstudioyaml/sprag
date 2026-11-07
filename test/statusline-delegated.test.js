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


// Sonnet delegations the guard ran at high effort (effort-raise-ledger's totals)
// with no measured saving: a raise no rule routed. The count alone, gray, right
// after the savings, as a bare document count is for Doc2md.
test('raises with no measured saving get a gray count chip after the savings, and nothing at zero', () => {
  const raised = (n) => ({ ...data(3.2), effortRaises: { count: n, cost: 1.23, kept: 0, keptRuns: 0, since: Date.now() } });
  const text = formatReport(raised(3), opts);
  assert.match(text, /Routing saved \$3\.20? · effort↑3/);
  assert.match(formatReport(raised(3), { ...opts, mode: 'icon' }), /🔀 \$3\.20? · 🔬↑3/);
  assert.match(formatReport(raised(3), { ...opts, mode: 'icon', verbose: true }), /effort raised ×3/);
  // Gray in color mode: the same tone as the period label, not the savings green.
  const colored = formatReport(raised(3), { ...opts, color: true });
  const tone = colored.match(/(\x1b\[[\d;]+m)effort↑3\x1b\[0m/)?.[1];
  assert.ok(tone, colored);
  assert.equal(tone, colored.match(/(\x1b\[[\d;]+m)\(1d\)/)?.[1]);

  // Byte-identical to the line without the field when there is nothing to show.
  for (const mode of ['text', 'icon']) {
    const base = formatReport(data(3.2), { ...opts, mode });
    assert.equal(formatReport(raised(0), { ...opts, mode }), base);
    assert.equal(formatReport({ ...data(3.2), effortRaises: null }, { ...opts, mode }), base);
  }
});

// With a measured saving the chip takes the shape of the other two savings:
// "Effort saved $12.4", green, the routing saving the raised runs produced
// (already inside Routing saved), with the count only in verbose mode.
test('raises with a measured saving get an "Effort saved" chip in the savings shape', () => {
  const since = new Date(new Date().getFullYear(), 10, 1).getTime(); // 11/1 this year
  const kept = (extra = {}) => ({ ...data(3.2), effortRaises: { count: 3, cost: 1.23, kept: 12.4, keptRuns: 2, since, ...extra } });
  assert.match(formatReport(kept(), opts), /Routing saved \$3\.20? · Effort saved \$12\.4 since 11\/1/);
  assert.match(formatReport(kept(), { ...opts, mode: 'icon' }), /🔀 \$3\.20? · 🔬 \$12\.4 \(11\/1~\)/);
  assert.match(formatReport(kept(), { ...opts, mode: 'icon', verbose: true }), /🔬 Effort saved \$12\.4 since 11\/1 · 3 raised/);

  // Color: the label is in the same green as Routing saved; a loss is red.
  const colored = formatReport(kept(), { ...opts, color: true });
  const green = colored.match(/(\x1b\[[\d;]+m)Routing saved\x1b\[0m/)?.[1];
  assert.ok(green, colored);
  assert.ok(colored.includes(`${green}Effort saved\x1b[0m $12.4`), colored);
  const red = formatReport({ ...data(3.2), delegationSaved: -1 }, { ...opts, color: true }).match(/(\x1b\[[\d;]+m)Routing saved\x1b\[0m/)?.[1];
  assert.ok(formatReport(kept({ kept: -0.5 }), { ...opts, color: true }).includes(`${red}Effort saved\x1b[0m -$0.50`));

  // No priced run behind the figure: the chip is the count alone.
  for (const [mode, verbose, plain] of [['text', false, 'effort↑3'], ['icon', false, '🔬↑3'], ['icon', true, 'effort raised ×3']]) {
    const out = formatReport(kept({ keptRuns: 0 }), { ...opts, mode, verbose });
    assert.ok(out.includes(plain), out);
    assert.ok(!out.includes('12.4'), out);
    assert.equal(out, formatReport(kept({ keptRuns: 0, kept: 0 }), { ...opts, mode, verbose }));
  }
});

// With a Routing saved line on record (the ledger totals), a measured saving
// gets its own line under the savings lines, in their anatomy: the figure, the
// same reset mark as Routing saved, then the breakdown with the raise count.
test('beside a Routing saved line, "Effort saved" becomes a line under the savings lines and the chip steps aside', () => {
  const since = new Date(new Date().getFullYear(), 10, 1).getTime(); // 11/1 this year
  const totals = { week: 0, month: 0, total: 3.2, spent: 0, spentMissing: 0, pairs: [], since };
  const withLine = (raises) => ({ ...data(3.2), delegationTotals: totals, effortRaises: raises });
  const raises = { count: 2, cost: 1.23, costMissing: 0, kept: 12.4, keptRuns: 2, since };
  const text = formatReport(withLine(raises), opts);
  const lines = text.split('\n');
  assert.match(lines[0], /^Routing saved \$3\.20? since 11\/1/);
  assert.equal(lines[1], 'Effort saved $12.4 since 11/1  |  medium→high ×2 $12.4');
  assert.doesNotMatch(lines[lines.length - 1], /effort↑|Effort saved/, 'the chip steps aside for the line');
  const icon = formatReport(withLine(raises), { ...opts, mode: 'icon' }).split('\n');
  assert.equal(icon[1], '🔬 Effort saved $12.4 since 11/1  |  medium→high ×2 $12.4');
  // Raises no rule routed are counted apart, with no figure to claim.
  const mixed = formatReport(withLine({ ...raises, count: 3 }), opts).split('\n');
  assert.equal(mixed[1], 'Effort saved $12.4 since 11/1  |  medium→high ×2 $12.4 · no rule ×1 (n/a)');
  assert.match(formatReport(withLine({ ...raises, count: 3 }), { ...opts, verbose: true }).split('\n')[1], /no rule ×1 \(no saving measured\)$/);
  // No measured saving: no line; the count stays a chip on the chip line.
  const bare = formatReport(withLine({ ...raises, kept: 0, keptRuns: 0, count: 3 }), opts).split('\n');
  assert.doesNotMatch(bare[1] || '', /Effort saved/);
  assert.match(bare[bare.length - 1], /effort↑3/);
  // Nothing raised: no line and no chip.
  const none = formatReport(withLine({ ...raises, count: 0, kept: 0, keptRuns: 0 }), opts);
  assert.doesNotMatch(none, /Effort saved|effort↑/);
  // In color the figure is the savings green, as on the Routing saved line.
  const colored = formatReport(withLine(raises), { ...opts, color: true }).split('\n');
  const green = colored[0].match(/(\x1b\[[\d;]+m)\$3\.2/)?.[1];
  assert.ok(green, 'the Routing saved figure is colored');
  assert.ok(colored[1].includes(`${green}$12.4`), colored[1]);
});
