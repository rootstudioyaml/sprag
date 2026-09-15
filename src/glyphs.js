/**
 * Statusline glyph sets, one per label mode.
 *
 * Why a narrow set exists at all: IntelliJ's terminal draws a character its
 * configured font lacks through a fallback font, and the fallback's advance
 * width does not match the cell grid. The mismatch is invisible on static text,
 * but a segment whose value changes every second (the TTL countdown, a gauge
 * percentage) repaints partially, and the leftover characters read as garbage:
 * `Cache expires 4:54` renders as `4:545`, `$4.0K` as `$4.:0K`. Dragging a
 * selection forces a full repaint and the line looks correct again, which is the
 * tell that the buffer was always right and only the painting was off.
 *
 * Measured on this machine (JetBrainsMono-Regular.ttf, the IDE default):
 * every emoji the icon set uses is absent from the font, while the gauge
 * characters (█ ▉ … ░) are present — and the gauge is the one part of the line
 * that never garbled. So the narrow set is chosen by font coverage, not by
 * Unicode width: each glyph below is one JetBrains Mono actually ships.
 *
 * Per-window glyphs (the 5h star, the weekly grid, the budget box) live in
 * src/window-labels.js instead, next to the labels they belong to.
 *
 * The gauge cells live here too, for the same reason the chip glyphs do. The
 * shapes differ by mode rather than only the vocabulary: ▰▱ read as a row of
 * separate ticks, which is what a gauge is, but JetBrains Mono ships neither
 * (verified via its cmap: U+25B0 and U+25B1 are absent, U+25A0 and U+25A1 are
 * present). So the narrow set draws the same segmented shape with ■□ instead of
 * falling back to a font whose advance width would garble the line.
 *
 * Width still matters as a second filter — a fullwidth glyph would occupy two
 * cells — so every narrow glyph is also East Asian Width N/Na. The test suite
 * enforces both properties.
 */

/** Emoji set: what a terminal with proper emoji support should show. */
const ICON = {
  capWarn: '🚨',
  spike: '⚠',
  upgrade: '⬆',
  harness: '🅷',
  korean: '✍️',
  model: '🤖',
  routing: '🔀',
  doc: '📄',
  hit: '🧠',
  ttl: '⏳',
  month: '💵',
  ctx: '📦',
  saved: '💰',
  reset: '🔄',
  // Gauge cells. Separate ticks rather than one continuous block: the bar is a
  // count of how much of a budget is gone, and ticks are countable where a solid
  // run is not. Precision is not this bar's job — an exact percentage is printed
  // immediately after it in every chip that draws one.
  gaugeFull: '▰',
  gaugeEmpty: '▱',
};

/**
 * Narrow set: every glyph is present in JetBrains Mono and one cell wide.
 * Shapes were picked to stay distinguishable from each other at a glance, since
 * compact mode shows the glyph with no label beside it.
 */
const NARROW = {
  capWarn: '‼',   // doubled bang reads as an alarm
  spike: '⚠',     // the one emoji-adjacent glyph the font does ship
  upgrade: '↑',
  harness: '⍟',   // circled star: a score out of five
  korean: '⌨',    // an input/typing convention rather than a hand
  model: '◈',
  routing: '⇉',   // sent down a different path
  doc: '≣',       // stacked lines: a page of text
  hit: '◉',       // bullseye: a cache hit
  ttl: '◔',       // a partly elapsed dial
  month: '∑',     // a running total
  ctx: '◧',       // a box filling up
  saved: '✓',
  reset: '↩',     // the window turning over
  // Same segmented shape as the icon set, in the two glyphs this font has.
  // ▰▱ (U+25B0/25B1) are absent from JetBrains Mono; ■□ (U+25A0/25A1) are there.
  gaugeFull: '■',
  gaugeEmpty: '□',
};

const SETS = { icon: ICON, narrow: NARROW };

/**
 * Glyphs for a label mode. Text mode never reads a glyph, but it resolves to the
 * emoji set so a caller that asks anyway gets a complete object rather than
 * undefined lookups.
 */
export function glyphsFor(mode) {
  return SETS[mode] || ICON;
}

export { ICON as ICON_GLYPHS, NARROW as NARROW_GLYPHS };
