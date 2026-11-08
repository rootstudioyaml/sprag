/**
 * Line fitting. A headline that is wider than the terminal gives up its tail
 * items, lowest priority first, and ends in `…`; it is not wrapped onto more
 * rows. The routing headline shortens to its two biggest model moves plus a
 * `+N` count first. What the user picked with `--segments` is never given up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cellWidth } from '../src/cell-width.js';
import { formatReport, DEFAULT_COLUMNS } from '../src/formatters/statusline.js';

const plain = (t) => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function data(extra = {}) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: { usedPct: 47, size: 1_000_000 },
    spikeChip: null,
    caps: { windows: [{ key: 'five_hour', usedPct: 31 }, { key: 'seven_day', usedPct: 10 }] },
    model: 'Opus 5',
    effort: 'high',
    delegationSaved: 288,
    delegationTotals: {
      total: 288,
      since: Date.parse('2026-11-01T12:00:00'),
      pairs: [
        { from: 'opus', to: 'sonnet', runs: 130, usd: 241 },
        { from: 'opus', to: 'haiku', runs: 51, usd: 21.1 },
        { from: 'fable', to: 'sonnet', runs: 8, usd: 14.7 },
        { from: 'fable', to: 'opus', runs: 3, usd: 7.75 },
        { from: 'fable', to: 'haiku', runs: 2, usd: 3.03 },
        { from: 'sonnet', to: 'haiku', runs: 11, usd: 1.09 },
      ],
    },
    ...extra,
  };
}

const base = { color: false, timer: false, mode: 'icon', verbose: true };
const headRow = (out) => plain(out).split('\n').find((l) => l.includes('Routing saved'));

test('a routing headline wider than the terminal keeps its two biggest moves and counts the rest', () => {
  const out = formatReport(data(), { ...base, columns: 120 });
  const row = headRow(out);
  assert.ok(row.includes('opus→sonnet ×130 $241'));
  assert.ok(row.includes('opus→haiku ×51 $21.1'));
  assert.ok(!row.includes('fable→sonnet'));
  assert.match(row, /\+4$/);
  assert.ok(cellWidth(row) <= 120 - 4, `row is ${cellWidth(row)} cells`);
});

test('a routing headline that fits is left whole', () => {
  const row = headRow(formatReport(data(), { ...base, columns: 400 }));
  assert.ok(row.includes('sonnet→haiku ×11 $1.09'));
  assert.ok(!/\+\d$/.test(row));
});

test('a headline still too wide ends in an ellipsis instead of wrapping, and no row exceeds the width', () => {
  const columns = 50;
  const out = formatReport(data(), { ...base, columns });
  const rows = plain(out).split('\n');
  const routing = rows.filter((l) => l.includes('Routing saved'));
  assert.equal(routing.length, 1, 'one row, not wrapped');
  assert.match(routing[0], / …$/);
  assert.ok(cellWidth(routing[0]) <= columns - 4, `row is ${cellWidth(routing[0])} cells`);
  // The head (label and total) is the piece that always stays.
  assert.ok(routing[0].includes('$288'));
});

test('the cut falls on a joint: no pair is split in half', () => {
  const out = formatReport(data(), { ...base, columns: 75 });
  const row = headRow(out);
  assert.match(row, /(×\d+ \$[\d.]+|\+\d|since 11\/1) …$|×\d+ \$[\d.]+ …$/);
  assert.ok(!/→\w* …$/.test(row));
});

test('segments named by the user are never given up: the headline wraps and keeps every pair', () => {
  const out = formatReport(data(), { ...base, columns: 60, segments: ['delegated'] });
  const text = plain(out);
  for (const pair of ['opus→sonnet ×130', 'opus→haiku ×51', 'fable→sonnet ×8', 'fable→opus ×3', 'fable→haiku ×2', 'sonnet→haiku ×11']) {
    assert.ok(text.includes(pair), `missing ${pair}`);
  }
  assert.ok(!text.includes('…'));
});

test('segments named by the user are not dropped from the chip lines either', () => {
  const segments = ['cap-warn', 'ctx', 'model', 'effort', 'hit', 'ttl', 'month'];
  const out = formatReport(data(), { ...base, columns: 40, maxLines: 1, segments });
  assert.ok(!/\+\d+$/.test(out), 'no +N chip: nothing was dropped');
  assert.ok(out.includes('🤖') || out.includes('Opus'), 'model kept');
});

test('the live statusline assumes 120 cells when no width is known', () => {
  assert.equal(DEFAULT_COLUMNS, 120);
});
