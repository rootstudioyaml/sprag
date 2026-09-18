/**
 * Effort palette — Claude Code's own colors for the effort levels.
 *
 * The statusline used to tint the effort chip from this tool's muted palette,
 * which meant the level you picked in `/effort` and the level the chip reported
 * were the same word in different colors. These are the app's values instead, so
 * the chip echoes the color the picker showed.
 *
 * The mapping is not per-level color keys — Claude Code 2.1.276 keeps a slider
 * table whose entries name SEMANTIC theme colors, which is why grepping for
 * `effort*` keys finds only the last row:
 *
 *   lo=[{value:"low",   label:"low",   color:"warning"},
 *       {value:"medium",label:"medium",color:"success"},
 *       {value:"high",  label:"high",  color:"permission"},
 *       {value:"xhigh", label:"xhigh", color:"autoAccept-shimmer"},
 *       {value:"max",   label:"max",   color:"rainbow-animated"}]
 *
 * and ultracode is painted separately, in `effortUltra`:
 *
 *   function qCe(h){if(h){let E=Vre(Po("theme","dark").value);return bt("effortUltra",E)("ultracode")}}
 *
 * Two of those five are animated, and the statusline cannot animate: Claude Code
 * re-runs the command on an interval measured in seconds (`statusLine.refreshInterval`,
 * clamped to `Math.max(1,n)*1000`) and each run is a new process with no frame
 * state, so a cycling color would read as a flicker rather than a shimmer. Both
 * are therefore rendered as their still form — `xhigh` takes the `autoAccept`
 * base color, and `max` takes the rainbow as a gradient across the word instead
 * of a cycle over time.
 *
 * VALUES are lifted verbatim from the six theme tables in the 2.1.276 binary.
 * `dark` is the default (`Po("theme","dark")`), where `autoAccept` and
 * `effortUltra` are the same color: Claude Code separates `xhigh` from
 * `ultracode` by shimmering one of them, not by hue.
 *
 * Dropping the animation would therefore leave the top two levels identical, so
 * `ultracode` takes the shimmer's own two endpoints as a GLOW instead — a ramp
 * from `autoAccept` up to `autoAcceptShimmer` and back down, spread across the
 * word. Same device as `max`: what the app says over time, the chip says across
 * the letters. No new colors are invented, and the level that costs the most is
 * the one that looks lit.
 *
 * An 8-color terminal has no ramp to spend, so there `ultracode` stays the flat
 * bright magenta and the level word is the only thing separating it from xhigh.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The theme names Claude Code accepts, from its own settings enum. */
export const THEME_NAMES = ['dark', 'light', 'light-daltonized', 'dark-daltonized', 'light-ansi', 'dark-ansi'];

/** 24-bit values, per theme, for the four semantic keys the slider names. */
const RGB = {
  dark: { warning: [255, 193, 7], success: [78, 186, 101], permission: [177, 185, 249], autoAccept: [175, 135, 255], ultra: [175, 135, 255] },
  light: { warning: [150, 108, 30], success: [44, 122, 57], permission: [87, 105, 247], autoAccept: [135, 0, 255], ultra: [135, 0, 255] },
  'dark-daltonized': { warning: [255, 204, 0], success: [51, 153, 255], permission: [153, 204, 255], autoAccept: [175, 135, 255], ultra: [175, 135, 255] },
  'light-daltonized': { warning: [255, 153, 0], success: [0, 102, 153], permission: [51, 102, 255], autoAccept: [135, 0, 255], ultra: [135, 0, 255] },
};

/**
 * The 8-color forms, from Claude Code's two ANSI themes. These are what a
 * terminal without 24-bit color gets, and they are also the whole palette for a
 * user who picked an ANSI theme on purpose.
 */
const ANSI = {
  dark: { warning: '\x1b[93m', success: '\x1b[92m', permission: '\x1b[94m', autoAccept: '\x1b[95m', ultra: '\x1b[95m' },
  light: { warning: '\x1b[33m', success: '\x1b[32m', permission: '\x1b[34m', autoAccept: '\x1b[35m', ultra: '\x1b[35m' },
};

/**
 * `autoAcceptShimmer` — the bright end of the pair Claude Code shimmers between,
 * per theme. Only the dark/light split matters here, since the daltonized themes
 * carry the same purple pair as their plain counterparts.
 */
const SHIMMER = {
  dark: [208, 180, 255],
  light: [208, 180, 255],
  'dark-daltonized': [208, 180, 255],
  'light-daltonized': [208, 180, 255],
};

/**
 * The glow ramp for `ultracode`: base → shimmer → base, seven stops, so a word
 * painted with it brightens toward the middle and settles again. Built by
 * interpolation rather than hand-picked, so a theme whose purple differs still
 * gets a smooth ramp.
 */
function glowRamp(base, peak) {
  const t = [0, 1 / 3, 2 / 3, 1, 2 / 3, 1 / 3, 0];
  return t.map((k) => base.map((ch, i) => Math.round(ch + (peak[i] - ch) * k)));
}

/** `max` — rainbow_red … rainbow_violet. One table for every theme. */
const RAINBOW_RGB = [
  [235, 95, 87], [245, 139, 87], [250, 195, 95], [145, 200, 130], [130, 170, 220], [155, 130, 200], [200, 130, 180],
];
/** Same seven, in the order the ANSI themes name them (red, redBright, yellow, green, cyan, blue, magenta). */
const RAINBOW_ANSI = ['\x1b[31m', '\x1b[91m', '\x1b[33m', '\x1b[32m', '\x1b[36m', '\x1b[34m', '\x1b[35m'];

const esc = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`;

/**
 * The theme Claude Code is running, resolved the way it resolves it: the config
 * value if set, `dark` otherwise. Read best-effort — an unreadable or absent
 * config is the default theme, never an error, because this feeds a statusline.
 */
export function claudeTheme() {
  for (const path of [join(homedir(), '.claude.json'), join(homedir(), '.claude', 'settings.json')]) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      const theme = raw && typeof raw.theme === 'string' ? raw.theme : null;
      if (theme && THEME_NAMES.includes(theme)) return theme;
    } catch { /* absent or malformed — keep looking, then default */ }
  }
  return 'dark';
}

/**
 * Escapes for every effort level, keyed by level name. `max` is an ARRAY of
 * escapes — one per rainbow stop — and every other level is a single escape, so
 * a caller paints `max` character by character and the rest in one go.
 *
 * @param {object} [opts]
 * @param {string} [opts.theme] - a Claude Code theme name; anything unknown reads as `dark`.
 * @param {boolean} [opts.truecolor=true] - false emits the ANSI forms.
 */
export function effortTones({ theme = claudeTheme(), truecolor = true } = {}) {
  const ansiTheme = theme.startsWith('light') ? 'light' : 'dark';
  // An ANSI theme is a deliberate choice, so it wins over terminal capability.
  const useAnsi = !truecolor || theme.endsWith('-ansi');
  const keys = useAnsi ? ANSI[ansiTheme] : (RGB[theme] || RGB.dark);
  const tone = (key) => (useAnsi ? keys[key] : esc(keys[key]));
  return {
    low: tone('warning'),
    medium: tone('success'),
    high: tone('permission'),
    xhigh: tone('autoAccept'),
    max: useAnsi ? RAINBOW_ANSI : RAINBOW_RGB.map(esc),
    ultracode: useAnsi
      ? keys.ultra
      : glowRamp(keys.ultra, SHIMMER[theme] || SHIMMER.dark).map(esc),
  };
}
