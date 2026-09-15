/**
 * Segment ordering. `--segments` used to be a filter whose order was discarded,
 * and the default sequence was whatever the push calls happened to be — so
 * near-constant identity chips (harness, Korean style) held the front while the
 * rate-limit gauges and Ctx, the two things that actually stop the work, sat
 * where a narrow terminal clips them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReport, DEFAULT_SEGMENT_ORDER } from '../src/formatters/statusline.js';

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
    delegationSaved: 0,
  };
}

const opts = { color: false, timer: false, mode: 'icon' };
// Index of a chip in the rendered line; -1 when absent.
const at = (line, needle) => line.indexOf(needle);

test('the default order leads with what stops the work', () => {
  const line = formatReport(data(), opts);
  const cap = at(line, '✦');       // 5h gauge
  const ctx = at(line, '📦');      // context
  const model = at(line, '🤖');
  const harness = at(line, '🅷');
  for (const [name, i] of [['cap', cap], ['ctx', ctx], ['model', model], ['harness', harness]]) {
    assert.ok(i >= 0, `${name} segment must render`);
  }
  assert.ok(cap < ctx, 'rate-limit gauge precedes context');
  assert.ok(ctx < model, 'context precedes the model chip');
  assert.ok(model < harness, 'near-constant harness identity goes last');
});

test('cache chips sit between context and the cost group', () => {
  const line = formatReport(data(), opts);
  assert.ok(at(line, '📦') < at(line, '⏳'), 'ctx precedes the TTL countdown');
  assert.ok(at(line, '⏳') < at(line, '🧠'), 'TTL precedes the hit rate');
  assert.ok(at(line, '🧠') < at(line, '💰'), 'hit rate precedes lifetime savings');
});

test('--segments sets the order, not just the filter', () => {
  const first = formatReport(data(), { ...opts, segments: ['ctx', 'harness'] });
  const second = formatReport(data(), { ...opts, segments: ['harness', 'ctx'] });
  assert.ok(at(first, '📦') < at(first, '🅷'), 'ctx,harness renders ctx first');
  assert.ok(at(second, '🅷') < at(second, '📦'), 'harness,ctx renders harness first');
  // Still a whitelist: nothing outside the list appears.
  assert.equal(at(first, '🧠'), -1, 'unlisted hit-rate chip stays out');
});

test('a warning chip keeps the lead wherever it was written', () => {
  const line = formatReport(data({ fiveHourPct: 95 }), {
    ...opts,
    segments: ['ctx', 'harness', 'cap-warn'],
  });
  assert.match(line, /🚨/, 'the cap-warn chip renders');
  assert.ok(at(line, '🚨') < at(line, '📦'), 'the alarm is not buried behind ctx');
  assert.ok(at(line, '🚨') < at(line, '🅷'));
});

test('overlapping segment names cannot print the same chip twice', () => {
  const line = formatReport(data(), { ...opts, segments: ['usage', 'five_hour', '5h'] });
  assert.equal(line.split('✦').length - 1, 1, 'the 5h gauge appears exactly once');
  assert.equal(line.split('📅').length - 1, 1, 'the weekly gauge appears exactly once');
});

test('the legacy 5h / 7d aliases still select their windows', () => {
  const only5h = formatReport(data(), { ...opts, segments: ['5h'] });
  assert.match(only5h, /✦/);
  assert.equal(at(only5h, '📅'), -1);
  const only7d = formatReport(data(), { ...opts, segments: ['7d'] });
  assert.match(only7d, /📅/);
  assert.equal(at(only7d, '✦'), -1);
});

test('`usage` selects every rate-limit window at once', () => {
  const line = formatReport(data(), { ...opts, segments: ['usage'] });
  assert.match(line, /✦/);
  assert.match(line, /📅/);
  assert.equal(at(line, '📦'), -1, 'and nothing else');
});

test('the live context reading is what renders, not the fallback', () => {
  // Guards the test data itself: an earlier version passed `pct` where the
  // renderer reads `usedPct`, so every ordering assertion here was silently
  // exercising the contextWindow fallback instead of the live path.
  const line = formatReport(data(), { ...opts, verbose: true, segments: ['ctx'] });
  assert.match(line, /47%/, 'the live percentage renders');
  assert.doesNotMatch(line, /200k/, 'the fallback size must not be what we see');
});

test('every name in the default order is one the renderer knows', () => {
  // The order list and the segment registry are separate structures. A name
  // added to only one of them would be dropped without a word, so assert that
  // each default name actually produces a chip when data for it exists.
  const rich = {
    ...data({ fiveHourPct: 95 }),           // 90%+ so the cap-warn chip exists
    options: { days: 1, windowLabel: '1d', version: '3.0.0' },
    spikeChip: '⚠ Input spike',
    delegationSaved: 3.2,
    doc2mdTotals: { total: 1.8, docs: 3 },
    monthSpend: { label: 'Sep', usd: 804 },
    update: { available: true, latest: '9.9.9' },
  };
  const missing = [];
  for (const name of DEFAULT_SEGMENT_ORDER) {
    const line = formatReport(rich, { ...opts, segments: [name] });
    // A rendered line always carries the erase-to-EOL suffix, so compare on the
    // visible text only.
    const visible = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
    if (visible === '') missing.push(name);
  }
  assert.deepEqual(missing, [], `default order names that render nothing: ${missing.join(', ')}`);
});
