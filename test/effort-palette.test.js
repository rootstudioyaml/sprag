/**
 * The effort palette — Claude Code's own level colors, pinned by value.
 *
 * These are not design choices this project gets to make: the chip has to match
 * what `/effort` showed, so every number here is transcribed from the theme
 * tables in the Claude Code 2.1.276 binary and a drift in either direction is a
 * bug. Pinned literally for that reason — a structural test ("low differs from
 * medium") would stay green through a wrong hue.
 *
 * The slider's own mapping, for reference while reading the expectations:
 *   low=warning · medium=success · high=permission · xhigh=autoAccept-shimmer
 *   max=rainbow-animated · ultracode=effortUltra
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { effortTones, claudeTheme, THEME_NAMES } from '../src/effort-palette.js';

const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;

test('the dark theme is transcribed exactly — it is the default', () => {
  const t = effortTones({ theme: 'dark' });
  assert.equal(t.low, rgb(255, 193, 7), 'warning');
  assert.equal(t.medium, rgb(78, 186, 101), 'success');
  assert.equal(t.high, rgb(177, 185, 249), 'permission');
  assert.equal(t.xhigh, rgb(175, 135, 255), 'autoAccept');
  // effortUltra is the same value as autoAccept in this theme, so a flat
  // ultracode would be indistinguishable from xhigh. It takes the shimmer pair
  // as a glow ramp instead: starts and ends on effortUltra, peaks on
  // autoAcceptShimmer.
  assert.equal(t.ultracode[0], rgb(175, 135, 255), 'the ramp starts on effortUltra');
  assert.equal(t.ultracode.at(-1), rgb(175, 135, 255), 'and returns to it');
  assert.equal(t.ultracode[3], rgb(208, 180, 255), 'peaking on autoAcceptShimmer');
  assert.equal(t.ultracode.length, 7);
  assert.notEqual(t.ultracode[3], t.xhigh, 'which is what separates the top two levels');
});

test('light is its own set, not a reuse of dark', () => {
  const t = effortTones({ theme: 'light' });
  assert.equal(t.low, rgb(150, 108, 30));
  assert.equal(t.medium, rgb(44, 122, 57));
  assert.equal(t.high, rgb(87, 105, 247));
  assert.equal(t.xhigh, rgb(135, 0, 255));
  assert.equal(t.ultracode[0], rgb(135, 0, 255), 'the glow ramp starts on this theme own purple');
  assert.equal(t.ultracode[3], rgb(208, 180, 255));
});

test('the daltonized themes are carried too', () => {
  const dark = effortTones({ theme: 'dark-daltonized' });
  assert.equal(dark.low, rgb(255, 204, 0));
  assert.equal(dark.medium, rgb(51, 153, 255), 'success is blue here, which is the whole point of the theme');
  assert.equal(dark.high, rgb(153, 204, 255));
  const light = effortTones({ theme: 'light-daltonized' });
  assert.equal(light.low, rgb(255, 153, 0));
  assert.equal(light.medium, rgb(0, 102, 153));
  assert.equal(light.high, rgb(51, 102, 255));
});

test('max is the rainbow, seven stops, in order', () => {
  const t = effortTones({ theme: 'dark' });
  assert.deepEqual(t.max, [
    rgb(235, 95, 87), rgb(245, 139, 87), rgb(250, 195, 95),
    rgb(145, 200, 130), rgb(130, 170, 220), rgb(155, 130, 200), rgb(200, 130, 180),
  ]);
  // Theme-independent in the app, so it must not drift per theme here either.
  for (const theme of ['light', 'dark-daltonized', 'light-daltonized']) {
    assert.deepEqual(effortTones({ theme }).max, t.max, `${theme} shares the rainbow`);
  }
});

test('a terminal without 24-bit color gets the ANSI themes, not a guess', () => {
  const dark = effortTones({ theme: 'dark', truecolor: false });
  assert.deepEqual(
    { low: dark.low, medium: dark.medium, high: dark.high, xhigh: dark.xhigh, ultracode: dark.ultracode },
    { low: '\x1b[93m', medium: '\x1b[92m', high: '\x1b[94m', xhigh: '\x1b[95m', ultracode: '\x1b[95m' },
    'dark-ansi: the bright forms, and ultracode flat because 8 colors have no ramp',
  );
  const light = effortTones({ theme: 'light', truecolor: false });
  assert.deepEqual(
    { low: light.low, medium: light.medium, high: light.high, xhigh: light.xhigh },
    { low: '\x1b[33m', medium: '\x1b[32m', high: '\x1b[34m', xhigh: '\x1b[35m' },
    'light-ansi: the plain forms',
  );
  assert.deepEqual(dark.max, ['\x1b[31m', '\x1b[91m', '\x1b[33m', '\x1b[32m', '\x1b[36m', '\x1b[34m', '\x1b[35m']);
});

test('an ANSI theme stays ANSI even on a 24-bit terminal', () => {
  // Picking `dark-ansi` is a deliberate choice about what the terminal should
  // receive, so capability must not override it.
  const t = effortTones({ theme: 'dark-ansi', truecolor: true });
  assert.equal(t.low, '\x1b[93m');
  assert.equal(effortTones({ theme: 'light-ansi', truecolor: true }).low, '\x1b[33m');
});

test('every theme name Claude Code accepts resolves to a full set', () => {
  for (const theme of THEME_NAMES) {
    const t = effortTones({ theme });
    for (const level of ['low', 'medium', 'high', 'xhigh']) {
      assert.match(t[level], /^\x1b\[[0-9;]*m$/, `${theme}/${level} must be one escape`);
    }
    assert.equal(t.max.length, 7, `${theme}/max`);
    // ultracode is a ramp on a 24-bit theme and a single escape on an ANSI one.
    if (theme.endsWith('-ansi')) assert.match(t.ultracode, /^\x1b\[[0-9;]*m$/, `${theme}/ultracode`);
    else assert.equal(t.ultracode.length, 7, `${theme}/ultracode ramp`);
  }
  // An unknown theme falls back to dark rather than to undefined escapes.
  assert.deepEqual(effortTones({ theme: 'no-such-theme' }), effortTones({ theme: 'dark' }));
});

test('the theme is read from the config, defaulting the way Claude Code defaults', () => {
  const theme = claudeTheme();
  assert.ok(THEME_NAMES.includes(theme), `${theme} should be one of the accepted names`);
});
