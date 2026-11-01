/**
 * Terminal cell width of a string, for laying out lines that must not overflow.
 *
 * `String.length` is wrong for this twice over: emoji and Hangul take two cells
 * while a variation selector or ZWJ takes none, and ANSI colour sequences take
 * no cells at all. Characters are measured per grapheme cluster, because a
 * terminal draws a cluster (a flag, `✍️`) as one glyph.
 */

// CSI and OSC (hyperlink) sequences; shared with the Codex panel's sanitizer.
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const MARKS_ONLY = /^[\p{Mark}\u200d]+$/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;

// East Asian Wide ranges that matter for what sprag prints (Hangul, CJK, kana,
// fullwidth forms). Not the full UAX #11 table: a miss costs one cell of slack.
function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x115f)
    || (cp >= 0x2e80 && cp <= 0xa4cf)
    || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe30 && cp <= 0xfe4f)
    || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x20000 && cp <= 0x3fffd);
}

export function cellWidth(text) {
  const plain = String(text ?? '').replace(ANSI, '');
  // ASCII fast path: the statusline renders every few seconds.
  if (/^[\x20-\x7e]*$/.test(plain)) return plain.length;
  let width = 0;
  for (const { segment } of graphemes.segment(plain)) {
    if (MARKS_ONLY.test(segment)) continue;
    const cp = segment.codePointAt(0);
    width += segment.includes('\ufe0f') || cp >= 0x1f000 || EMOJI_PRESENTATION.test(segment) || isWide(cp) ? 2 : 1;
  }
  return width;
}
