/**
 * Glyph safety for the narrow label set.
 *
 * IntelliJ's terminal draws a character its font lacks through a fallback whose
 * advance width does not match the cell grid, and a line that repaints every
 * second then leaves debris: `Cache expires 4:54` shows as `4:545`, `Ctx 33%` as
 * `Ctx 330%`, `$4.0K` as `$4.:0K`. Dragging a selection forces a full repaint and
 * the line reads correctly again, which is the tell that the buffer was always
 * right and only the painting was off.
 *
 * Read from JetBrainsMono-Regular.ttf (the IDE default) via its cmap: every emoji
 * the icon set uses is absent from the font, while the gauge characters are
 * present — and the gauge was the one part of the line that never garbled. Font
 * coverage, not Unicode width, is therefore the property that matters.
 *
 * A test cannot read the user's font, so it pins the vocabulary instead. Every
 * non-ASCII character the narrow and text paths may emit is listed below, each
 * one verified in that font. Introducing a new glyph fails this test until it has
 * been checked the same way, which is the point: the failure is the reminder.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ICON_GLYPHS, NARROW_GLYPHS, glyphsFor } from '../src/glyphs.js';
import { formatReport, gaugeBar } from '../src/formatters/statusline.js';
import { labelForKey } from '../src/window-labels.js';

/** Chip glyphs, gauge ticks, window icons. Verified present in JetBrains Mono. */
const FONT_VERIFIED = new Set([
  ...'‼⚠↑⍟⌨◈⇉≣◉◔∑◧✓↩',      // narrow chip glyphs
  ...'✶⌸◫◕◇◆',               // narrow window icons
  ...'■□',                    // narrow gauge ticks (U+25A0 / U+25A1)
]);

/**
 * The icon set's gauge ticks. ▰▱ (U+25B0 / U+25B1) are the shape we want, and
 * JetBrains Mono ships neither — which is exactly why narrow draws ■□ instead.
 * Listed separately so the narrow assertions keep rejecting these two: putting
 * them in FONT_VERIFIED would make the font check pass on a character the font
 * does not have.
 */
const ICON_ONLY_GAUGE = new Set([...'▰▱']);

/** Punctuation and arrows the labels themselves carry, likewise verified. */
const FONT_VERIFIED_TEXT = new Set([...'·→×']);

const ALLOWED = new Set([...FONT_VERIFIED, ...FONT_VERIFIED_TEXT]);

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
/** Characters outside ASCII that the vocabulary does not account for. */
const unvetted = (s) =>
  [...new Set([...strip(s)].filter((ch) => ch.codePointAt(0) > 0x7f && !ALLOWED.has(ch)))];
/** Anything above the BMP is an emoji here, and emoji are what garble. */
const astral = (s) => [...new Set([...strip(s)].filter((ch) => ch.codePointAt(0) > 0xffff))];

test('every narrow glyph is one the font was verified to have', () => {
  for (const [name, glyph] of Object.entries(NARROW_GLYPHS)) {
    for (const ch of glyph) {
      const cp = ch.codePointAt(0).toString(16).toUpperCase();
      assert.ok(FONT_VERIFIED.has(ch), `${name} uses ${ch} (U+${cp}), which is not verified`);
    }
  }
});

test('no narrow glyph reaches above the BMP', () => {
  for (const [name, glyph] of Object.entries(NARROW_GLYPHS)) {
    assert.deepEqual(astral(glyph), [], `${name} must not be an astral-plane character`);
  }
});

test('narrow window icons are verified as well', () => {
  const keys = ['five_hour', 'seven_day', 'seven_day_sonnet', 'seven_day_opus', 'litellm_budget', 'unknown_window'];
  for (const key of keys) {
    const { narrowIcon } = labelForKey(key);
    assert.ok(narrowIcon, `${key} needs a narrowIcon`);
    assert.ok(FONT_VERIFIED.has(narrowIcon), `${key} icon ${narrowIcon} is not verified`);
  }
});

test('both sets describe the same chips', () => {
  assert.deepEqual(Object.keys(ICON_GLYPHS).sort(), Object.keys(NARROW_GLYPHS).sort());
});

test('narrow glyphs are distinct, so chips stay tellable apart without labels', () => {
  const values = Object.values(NARROW_GLYPHS);
  assert.equal(new Set(values).size, values.length);
});

test('glyphsFor resolves text mode to the emoji set rather than undefined', () => {
  assert.equal(glyphsFor('narrow'), NARROW_GLYPHS);
  assert.equal(glyphsFor('icon'), ICON_GLYPHS);
  assert.equal(glyphsFor('text'), ICON_GLYPHS);
  assert.equal(glyphsFor(undefined), ICON_GLYPHS);
});

function data() {
  const now = Math.floor(Date.now() / 1000);
  return {
    summary: { hitRate: 0.95 },
    ttl: { total: 0, pct1h: 0 },
    cost: { savings: 288 },
    options: { days: 1, windowLabel: '1d', version: '3.44.0' },
    lastActivity: Date.now(),
    contextWindow: { size: '1M', maxContext: 1000000 },
    ctxLive: { usedPct: 47, size: 1_000_000 },
    spikeChip: '⚠ Input spike',
    caps: {
      windows: [
        { key: 'five_hour', usedPct: 95, resetsAt: now + 3600 },
        { key: 'seven_day', usedPct: 10, resetsAt: now + 200000 },
        { key: 'litellm_budget', usedPct: 34, spend: 34, maxBudget: 100 },
      ],
    },
    model: 'Opus 5',
    delegationSaved: 21.8,
    doc2mdTotals: { total: 1.8, docs: 3 },
    monthSpend: { label: 'Sep', usd: 830 },
    update: { available: true, latest: '9.9.9' },
    unresolvedRuns: 2,
    totals: { total: 21.8, byPair: [{ from: 'opus', to: 'sonnet', runs: 39, usd: 18.1 }] },
  };
}

test('a full narrow line emits nothing outside the verified vocabulary', () => {
  for (const verbose of [true, false]) {
    const out = formatReport(data(), { color: false, mode: 'narrow', verbose });
    assert.deepEqual(unvetted(out), [], `narrow verbose=${verbose} used an unverified character`);
    assert.deepEqual(astral(out), [], `narrow verbose=${verbose} used an emoji`);
  }
});

test('text mode carries no emoji either', () => {
  // The reset clock used to append 🔄 regardless of mode, so text mode shipped an
  // emoji it otherwise avoids, and inherited the same garbling.
  for (const verbose of [true, false]) {
    const out = formatReport(data(), { color: false, mode: 'text', verbose });
    assert.deepEqual(astral(out), [], `text verbose=${verbose} must stay emoji-free`);
    assert.deepEqual(unvetted(out), []);
  }
  const verbose = strip(formatReport(data(), { color: false, mode: 'text', verbose: true }));
  assert.match(verbose, /resets /, 'text mode names the reset instead of drawing it');
});

test('icon mode still uses the emoji, so other terminals are unaffected', () => {
  const out = strip(formatReport(data(), { color: false, mode: 'icon', verbose: true }));
  for (const emoji of ['🧠', '⏳', '📦', '💰', '🤖']) {
    assert.ok(out.includes(emoji), `icon mode should still render ${emoji}`);
  }
});

test('the gauge fills monotonically and always spans twelve ticks', () => {
  for (const mode of ['icon', 'narrow']) {
    const g = glyphsFor(mode);
    let prev = -1;
    for (let pct = 0; pct <= 100; pct += 1) {
      const bar = gaugeBar(pct, mode);
      assert.equal([...bar].length, 12, `${mode} ${pct}% must draw twelve ticks`);
      const filled = [...bar].filter((ch) => ch === g.gaugeFull).length;
      assert.ok(filled >= prev, `${mode} ${pct}% drew fewer ticks than the percentage below it`);
      prev = filled;
    }
  }
});

test('only 100% draws a full row, and only 0% draws an empty one', () => {
  // These are the two readings that change a decision: a full row has to mean
  // the limit is reached, and an empty one has to mean untouched. Plain rounding
  // gets both wrong — it fills the last tick from 96% and leaves the first empty
  // until 5%.
  const g = glyphsFor('icon');
  assert.equal(gaugeBar(100, 'icon'), g.gaugeFull.repeat(12), '100% fills every tick');
  assert.equal(gaugeBar(0, 'icon'), g.gaugeEmpty.repeat(12), '0% fills none');
  for (const pct of [95, 96, 98, 99, 99.9]) {
    assert.notEqual(gaugeBar(pct, 'icon'), g.gaugeFull.repeat(12), `${pct}% must not look full`);
  }
  for (const pct of [0.1, 1, 4, 8]) {
    assert.notEqual(gaugeBar(pct, 'icon'), g.gaugeEmpty.repeat(12), `${pct}% must not look untouched`);
  }
});

test('the bar moves on a 1/12 grid, and the exact figure is printed beside it', () => {
  // Twelve ticks resolve 13 states, so values inside one 1/12 band draw the same
  // bar (46% and 54% both fill six). That is the trade the segmented shape makes:
  // ticks are countable where a solid run is not, and precision was never this
  // bar's job — every chip that draws a gauge prints the percentage right after
  // it. What the bar must not do is look stuck across a band boundary.
  assert.notEqual(gaugeBar(20), gaugeBar(21), 'a band boundary must move the bar');
  assert.notEqual(gaugeBar(29), gaugeBar(30));
  assert.notEqual(gaugeBar(45), gaugeBar(46));
  assert.equal(gaugeBar(46), gaugeBar(54), 'and within a band it deliberately does not');

  // The bands are roughly even, so no single tick swallows a wide range of the
  // scale. 1/12 and 11/12 are the two wide ones by design: they absorb the
  // reserved 0% and 100% readings.
  const width = new Map();
  for (let pct = 0; pct <= 100; pct += 1) {
    const bar = gaugeBar(pct);
    width.set(bar, (width.get(bar) || 0) + 1);
  }
  assert.equal(width.size, 13, 'twelve ticks plus empty is thirteen states');
  const interior = [...width.values()].filter((n) => n > 1);
  assert.ok(Math.max(...interior) <= 12, 'no band covers more than 12 points');
});

test('each mode draws the ticks its terminal font can render', () => {
  // ▰▱ is the shape; JetBrains Mono ships neither, so narrow draws ■□ instead.
  // Getting this backwards is what garbled the line in the first place.
  assert.deepEqual([...new Set(gaugeBar(50, 'icon'))].sort(), [...'▰▱'].sort());
  assert.deepEqual([...new Set(gaugeBar(50, 'narrow'))].sort(), [...'■□'].sort());
  for (const ch of ICON_ONLY_GAUGE) {
    assert.ok(!FONT_VERIFIED.has(ch), `${ch} is icon-only and must not be font-verified`);
    assert.ok(!gaugeBar(50, 'narrow').includes(ch), `narrow must not emit ${ch}`);
  }
});

test('the unused ticks are dimmed when color is available', () => {
  const now = Math.floor(Date.now() / 1000);
  const withBudget = {
    ...data(),
    caps: { windows: [{ key: 'litellm_budget', usedPct: 26, spend: 1000, maxBudget: 4000, resetsAt: now + 100000 }] },
  };
  const colored = formatReport(withBudget, { color: true, mode: 'icon', verbose: true, segments: ['usage'] });
  // The hollow tick already separates the halves by shape; graying the remainder
  // leaves the filled run as the only thing at full brightness.
  assert.match(colored, /\x1b\[90m▱+/, 'unused ticks should be gray');

  const plain = formatReport(withBudget, { color: false, mode: 'icon', verbose: true, segments: ['usage'] });
  assert.match(plain, /▰+▱+/, 'without color the shapes alone carry it');
  assert.doesNotMatch(plain, /\x1b\[/, 'and no escapes are emitted');
});

test('a full gauge has no unused ticks to dim', () => {
  const now = Math.floor(Date.now() / 1000);
  const full = {
    ...data(),
    caps: { windows: [{ key: 'litellm_budget', usedPct: 100, spend: 4000, maxBudget: 4000, resetsAt: now + 100000 }] },
  };
  // At 100% the window is promoted to the cap-warn chip and suppressed in the
  // always-on segment, so that is where its gauge renders.
  const out = formatReport(full, { color: true, mode: 'icon', verbose: true, segments: ['cap-warn'] });
  assert.match(out, /▰{12}/);
  assert.doesNotMatch(out, /▱/, 'no hollow ticks at 100%');
});
