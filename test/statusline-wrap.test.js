/**
 * Responsive wrapping. Claude Code truncates a statusline line that is wider
 * than the terminal with an ellipsis, hiding the chips at the tail; with
 * COLUMNS known the chips wrap at chip boundaries instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cellWidth } from '../src/cell-width.js';
import { layoutChips, formatReport, formatNoSession } from '../src/formatters/statusline.js';

function data({ fiveHourPct = 31, sevenDayPct = 10 } = {}) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: { usedPct: 47, size: 1_000_000 },
    spikeChip: null,
    caps: {
      windows: [
        { key: 'five_hour', usedPct: fiveHourPct },
        { key: 'seven_day', usedPct: sevenDayPct },
      ],
    },
    model: 'Opus 5',
    effort: 'high',
    delegationSaved: 0,
  };
}

const opts = { color: false, timer: false, mode: 'icon' };
const widest = (text) => Math.max(...text.split('\n').map(cellWidth));

test('cellWidth counts terminal cells', () => {
  assert.equal(cellWidth('ABC'), 3);
  assert.equal(cellWidth('한글'), 4);
  assert.equal(cellWidth('🧠'), 2);
  assert.equal(cellWidth('⏱️'), 2);
  assert.equal(cellWidth('\x1b[31mred\x1b[0m'), 3);
  assert.equal(cellWidth('\x1b]8;;https://example.com\x1b\\label\x1b]8;;\x1b\\'), 5);
  assert.equal(cellWidth(''), 0);
});

const chips = ['alpha-chip', 'bravo-chip', 'charlie-chip', 'delta-chip', 'echo-chip', 'foxtrot-chip'];

test('layoutChips without columns is the plain join', () => {
  assert.equal(layoutChips(chips, {}), chips.join(' · '));
  assert.equal(layoutChips(chips, { columns: 0, eol: '!' }), chips.join(' · ') + '!');
  assert.equal(layoutChips(chips, { columns: NaN }), chips.join(' · '));
});

test('layoutChips keeps a wide terminal on one line', () => {
  assert.equal(layoutChips(chips, { columns: 200 }), chips.join(' · '));
});

test('layoutChips wraps at chip boundaries within columns - 4', () => {
  const out = layoutChips(chips, { columns: 34, maxLines: 10 });
  const lines = out.split('\n');
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(cellWidth(line) <= 30, `"${line}" too wide`);
  assert.deepEqual(lines.join(' · ').split(' · '), chips, 'chips intact and in order');
});

test('layoutChips puts a chip wider than the line alone on its own line', () => {
  const long = 'x'.repeat(60);
  const lines = layoutChips(['a', long, 'b'], { columns: 40, maxLines: 10 }).split('\n');
  assert.deepEqual(lines, ['a', long, 'b']);
});

test('layoutChips ends every line with eol and has no trailing newline', () => {
  const out = layoutChips(chips, { columns: 34, maxLines: 10, eol: '<K>' });
  assert.ok(!out.endsWith('\n'));
  assert.ok(out.endsWith('<K>'));
  assert.equal(out.split('<K>\n').length, out.split('\n').length);
});

test('layoutChips drops tail chips past maxLines and counts them', () => {
  const out = layoutChips(chips, { columns: 34, maxLines: 2, color: false });
  const lines = out.split('\n');
  assert.ok(lines.length <= 2);
  const shown = lines.join(' · ').split(' · ');
  assert.match(shown.at(-1), /^\+\d+$/);
  const dropped = Number(shown.at(-1).slice(1));
  assert.equal(shown.length - 1 + dropped, chips.length);
  assert.deepEqual(shown.slice(0, -1), chips.slice(0, shown.length - 1), 'the head survives');
});

test('layoutChips grays the +N chip only with color', () => {
  assert.match(layoutChips(chips, { columns: 34, maxLines: 1, color: true }), /\x1b\[[0-9;]*m\+\d+\x1b\[0m$/);
  assert.doesNotMatch(layoutChips(chips, { columns: 34, maxLines: 1, color: false }), /\x1b/);
});

test('layoutChips never drops a protected chip', () => {
  const protectedSegs = new Set(['foxtrot-chip']);
  const out = layoutChips(chips, { columns: 34, maxLines: 2, protectedSegs, color: false });
  assert.ok(out.includes('foxtrot-chip'));
  const all = new Set(chips);
  const kept = layoutChips(chips, { columns: 34, maxLines: 1, protectedSegs: all, color: false });
  assert.ok(chips.every((c) => kept.includes(c)), 'all protected: wrapped lines are returned anyway');
  assert.ok(!/\+\d+$/.test(kept));
});

test('formatReport wraps to the terminal and keeps the chips that stop the work', () => {
  const out = formatReport(data(), { ...opts, columns: 60 });
  assert.ok(out.includes('\n'), 'a 60 column terminal needs more than one line');
  assert.ok(widest(out) <= 56, `widest line is ${widest(out)}`);
  assert.ok(out.includes('✦'), 'five-hour gauge kept');
  assert.ok(out.includes('📦'), 'context kept');
});

test('formatReport keeps usage and ctx chips under a tight line budget', () => {
  const out = formatReport(data(), { ...opts, columns: 40, maxLines: 1 });
  assert.ok(out.includes('✦') && out.includes('📦'));
});

test('formatReport without columns is unchanged', () => {
  const base = formatReport(data(), opts);
  assert.equal(formatReport(data(), { ...opts, columns: 0 }), base);
  assert.ok(!base.includes('\n'));
});

test('formatReport --single-line ignores columns', () => {
  const base = formatReport(data(), { ...opts, singleLine: true });
  assert.equal(formatReport(data(), { ...opts, singleLine: true, columns: 60 }), base);
  assert.ok(!base.includes('\n'));
});

test('formatReport falls back from verbose to compact before dropping chips', () => {
  const verbose = formatReport(data(), { ...opts, verbose: true, columns: 80, maxLines: 2 });
  const compact = formatReport(data(), { ...opts, verbose: false, columns: 80, maxLines: 2 });
  assert.ok(verbose.split('\n').length <= 2);
  assert.ok(!/\+\d+$/.test(verbose.split('\n').at(-1)) || /\+\d+$/.test(compact.split('\n').at(-1)));
});

test('formatNoSession wraps with columns and leaves the default alone', () => {
  const fields = { model: 'Opus 5', effort: 'high', windowLabel: '1d', version: '3.90.4' };
  const o = { color: false, mode: 'icon' };
  const base = formatNoSession(fields, o);
  assert.ok(!base.includes('\n'));
  assert.equal(formatNoSession(fields, { ...o, columns: 0 }), base);
  const narrow = formatNoSession(fields, { ...o, columns: 40 });
  assert.ok(narrow.includes('\n'));
  assert.ok(widest(narrow) <= 36);
});

// The routing headline lists every model pair, so it is the widest line of the
// statusline. Unwrapped, a narrow terminal cut it right after the total.
function withRouting(extra = {}) {
  return {
    ...data(),
    delegationTotals: {
      total: 244,
      pairs: [
        { from: 'opus', to: 'sonnet', runs: 58, usd: 151 },
        { from: 'fable', to: 'sonnet', runs: 21, usd: 84 },
        { from: 'fable', to: 'haiku', runs: 10, usd: 5.07 },
        { from: 'opus', to: 'haiku', runs: 9, usd: 3.83 },
        { from: 'sonnet', to: 'haiku', runs: 1, usd: 0.08 },
      ],
    },
    ...extra,
  };
}

test('formatReport wraps the routing headline at its joints', () => {
  const columns = 60;
  const out = formatReport(withRouting(), { color: true, mode: 'icon', columns });
  const lines = out.split('\n');
  for (const line of lines) assert.ok(cellWidth(line) <= columns - 4, `too wide: ${line}`);
  // Every pair is still there, none cut in half.
  const plain = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  for (const pair of ['opus→sonnet ×58', 'fable→sonnet ×21', 'fable→haiku ×10', 'opus→haiku ×9', 'sonnet→haiku ×1']) {
    assert.ok(plain.split('\n').some((l) => l.includes(pair)), `missing ${pair}`);
  }
  // Continuation rows are indented so they read as the rest of the headline.
  const headRow = plain.split('\n').findIndex((l) => l.includes('Routing saved'));
  assert.ok(plain.split('\n')[headRow + 1].startsWith('  '));
});

test('formatReport leaves the routing headline whole without columns', () => {
  const out = formatReport(withRouting(), { color: false, mode: 'icon' });
  const head = out.split('\n').find((l) => l.includes('Routing saved'));
  assert.ok(head.includes('sonnet→haiku ×1'));
});
