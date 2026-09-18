/**
 * The effort chip — which effort level `/effort` left the session on.
 *
 * Claude Code puts the resolved level in the statusline payload itself
 * (`effort.level`, added by 2.1.276), so nothing here reads the transcript. Two
 * properties are worth pinning because getting either wrong is silent: an
 * absent key must render no chip rather than a default one (models without an
 * effort setting, and older Claude Code builds, both omit the key — showing
 * "high" there would be an invention), and the tone must separate a level the
 * user raised from the one they were given, since raising it spends more tokens
 * per turn and that is the whole subject of this tool.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEffort } from '../src/stdin-payload.js';
import { formatReport, formatNoSession } from '../src/formatters/statusline.js';

function data(effort) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d' },
    lastActivity: Date.now(),
    contextWindow: { size: '1M', maxContext: 1000000 },
    ctxLive: { usedPct: 47, size: 1_000_000 },
    spikeChip: null,
    caps: { windows: [{ key: 'five_hour', usedPct: 31 }] },
    model: 'Opus 5',
    effort,
    delegationSaved: 0,
  };
}

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const line = (effort, opts = {}) => formatReport(data(effort), { color: false, timer: false, mode: 'icon', ...opts });
/** The color escape the effort chip opens with, whatever palette is in play. */
function effortTone(effort) {
  const rendered = formatReport(data(effort), { color: true, timer: false, mode: 'icon', segments: ['effort'] });
  const m = rendered.match(/\x1b\[[0-9;]*m/);
  return m ? m[0] : null;
}

test('the payload level is read as-is, and a missing one stays missing', () => {
  assert.equal(extractEffort({ effort: { level: 'high' } }), 'high');
  // Case and padding are normalized so the tone lookup can key on the level.
  assert.equal(extractEffort({ effort: { level: ' XHigh ' } }), 'xhigh');
  // Every shape that means "this payload says nothing about effort".
  assert.equal(extractEffort({}), null, 'no effort key');
  assert.equal(extractEffort(null), null, 'no payload at all');
  assert.equal(extractEffort({ effort: {} }), null, 'effort object without a level');
  assert.equal(extractEffort({ effort: { level: '' } }), null, 'empty level');
  assert.equal(extractEffort({ effort: { level: '   ' } }), null, 'whitespace level');
  assert.equal(extractEffort({ effort: { level: 3 } }), null, 'non-string level');
});

test('the chip names the level, and says so in words where there is no glyph', () => {
  assert.match(strip(line('high')), /🔬 high/, 'icon mode pairs the glyph with the level');
  assert.match(strip(line('high', { mode: 'narrow' })), /▲ high/, 'narrow mode swaps only the glyph');
  // A bare "high" beside a model name would be anyone's guess, so text mode
  // names the field instead.
  assert.match(strip(line('high', { mode: 'text' })), /Effort high/);
});

test('no level means no chip, not a guessed one', () => {
  for (const absent of [null, undefined, '']) {
    const out = strip(line(absent));
    assert.doesNotMatch(out, /🔬/, `${String(absent)} must render no effort glyph`);
    assert.doesNotMatch(out, /high/, `${String(absent)} must not invent a level`);
    // And the line must not carry the separator the dropped chip would have had.
    assert.doesNotMatch(out, / · · /, 'a dropped chip leaves no empty slot');
  }
});

test('the chip sits with the model it qualifies', () => {
  const out = strip(line('max'));
  const model = out.indexOf('🤖');
  const effort = out.indexOf('🔬');
  assert.ok(model >= 0 && effort >= 0, 'both chips render');
  assert.ok(model < effort, 'effort follows the model chip');
  assert.ok(effort - model < 20, 'and follows it immediately, as one glance');
});

test('raising effort above the default is toned differently from accepting it', () => {
  // `high` is what Claude Code resolves an unset effort to, so it reads as
  // identity beside the model. The two levels above it cost more tokens per
  // turn, which is the tool's subject, so they take the warning tone.
  const dflt = effortTone('high');
  assert.equal(effortTone('xhigh'), effortTone('max'), 'both raised levels share one tone');
  assert.notEqual(effortTone('xhigh'), dflt, 'a raised level is not toned as the default');
  // Below default recedes rather than warns: it spends less, not more.
  assert.equal(effortTone('low'), effortTone('medium'), 'the cheaper levels share one tone');
  assert.notEqual(effortTone('low'), dflt);
  assert.notEqual(effortTone('low'), effortTone('max'), 'cheaper must not look like a warning');
  // A level this build has never heard of still renders, in the identity tone.
  assert.equal(effortTone('ultra'), dflt, 'an unknown level falls back to identity');
  assert.match(strip(line('ultra')), /🔬 ultra/);
});

test('an empty analysis window still shows what effort the session is on', () => {
  // Same reason the model chip survives there: the payload is live even when the
  // log window is empty, and this is identity, not a statistic.
  const out = strip(formatNoSession({ model: 'Opus 5', effort: 'max' }, { color: false }));
  assert.match(out, /🔬 max/);
  const bare = strip(formatNoSession({ model: 'Opus 5' }, { color: false }));
  assert.doesNotMatch(bare, /🔬/, 'and renders nothing when the payload omitted it');
});
