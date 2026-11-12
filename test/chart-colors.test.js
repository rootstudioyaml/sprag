/**
 * The team console and ops charts draw their data colors from the --ch-* palette in admin-ux.js.
 * Dark mode keeps the colors the charts had before the light-default redesign; light mode lowers
 * the lightness of the same hue so the marks stay readable on white. These checks pin:
 *  - every light value reaches 3:1 against white (WCAG 1.4.11), value labels 4.5:1,
 *  - marks drawn next to each other stay apart in lightness,
 *  - dark mode still carries the pre-redesign colors,
 *  - the chart code no longer writes those colors as literals that would skip the light palette.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const ux = read('../site/assets/admin-ux.js');
const team = read('../site/team/index.html');
const ops = read('../site/ops/index.html');

function block(selector){
  const i = ux.indexOf(selector + '{--ch-');
  assert.ok(i >= 0, `admin-ux.js has no ${selector} chart palette`);
  const body = ux.slice(i + selector.length + 1, ux.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--ch-([a-z0-9-]+):([^;]+)/g)].map(m => [m[1], m[2].trim()]));
}
const light = block(':root'), dark = block(':root[data-theme=dark]');

const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const rgb = h => [0, 2, 4].map(i => parseInt(h.slice(1 + i, 3 + i), 16) / 255);
const lum = h => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const okL = h => {
  const [r, g, b] = rgb(h).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
};

test('light and dark palettes name the same colors', () => {
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
  assert.ok(Object.keys(light).length >= 21);
});

test('light chart marks reach 3:1 on white and value labels 4.5:1', () => {
  for(const [k, v] of Object.entries(light)){
    assert.match(v, /^#[0-9a-f]{6}$/, `--ch-${k} must be an opaque hex in light mode`);
    const need = k.endsWith('-txt') ? 4.5 : 3;
    assert.ok(contrast(v, '#ffffff') >= need, `--ch-${k} ${v} is ${contrast(v, '#ffffff').toFixed(2)}:1 on white, needs ${need}:1`);
  }
});

test('marks drawn side by side stay apart in lightness', () => {
  for(const [a, b] of [['joined', 'restored'], ['left', 'removed'], ['pro', 'ent']]){
    const d = Math.abs(okL(light[a]) - okL(light[b]));
    assert.ok(d >= 0.08, `--ch-${a} and --ch-${b} are only ${d.toFixed(3)} apart in oklab lightness`);
  }
});

test('dark mode keeps the chart colors from before the redesign', () => {
  assert.deepEqual(
    [dark.spend, dark['spend-bar'], dark.saved, dark['saved-bar'], dark.restored, dark.warn, dark.bad, dark.pro, dark.ent, dark['m-sonnet']],
    ['#8a94f2', '#828fff', '#3fd48f', '#35d6a8', '#9be8c6', '#e8ab3c', '#f06b6b', 'rgba(94,106,210,.62)', 'rgba(138,148,242,.34)', '#8ec5fb']);
});

test('chart code takes its data colors from the palette, not literals', () => {
  const old = /#(8a94f2|828fff|a9b1ff|3fd48f|35d6a8|5fe0bb|9be8c6|e8ab3c|f06b6b|b84a4a|fcd34d|c4b5fd|f9a8d4|8ec5fb|7fe0b8|cbd5e1)\b/gi;
  const strip = s => s.split('\n').filter(l => !/^\s*(--[a-z0-9-]+:|:root)/.test(l)).join('\n');
  const uxCode = ux.replace(/:root\{--ch-[^}]*\}/, '').replace(/:root\[data-theme=dark\]\{--ch-[^}]*\}/, '');
  for(const [name, src] of [['admin-ux.js', uxCode], ['team', strip(team)], ['ops', strip(ops)]])
    assert.deepEqual(src.match(old) || [], [], `${name} still writes a chart color as a literal`);
});
