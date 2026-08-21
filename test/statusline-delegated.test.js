/**
 * The delegation-savings chip is a second, separate savings number: "Cache
 * saved" is prompt-cache only. It must render in every label mode, stay out of
 * the line when there is nothing measured, and never disturb the existing chip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../src/formatters/statusline.js';

function data(delegationSaved) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: null,
    spikeChip: null,
    caps: null,
    model: null,
    delegationSaved,
  };
}

const opts = { color: false, timer: false };

test('the chip renders in text, icon, and icon+verbose modes', () => {
  assert.match(formatReport(data(3.2), opts), /Delegated \$3\.2/);
  assert.match(formatReport(data(3.2), { ...opts, mode: 'icon' }), /🔀 \$3\.2/);
  const verbose = formatReport(data(3.2), { ...opts, mode: 'icon', verbose: true });
  assert.match(verbose, /🔀 Delegated \$3\.2/);
});

test('nothing measured means no chip at all, not "$0"', () => {
  for (const value of [0, undefined, null, NaN]) {
    const out = formatReport(data(value), opts);
    assert.doesNotMatch(out, /Delegated/, `value ${String(value)} should hide the chip`);
    assert.match(out, /Cache saved/, 'the cache chip is unaffected');
  }
});

test('the existing cache-savings chip keeps its own value and label', () => {
  const out = formatReport(data(3.2), opts);
  assert.match(out, /Cache saved \$1\.5K/);
  assert.ok(out.indexOf('Cache saved') < out.indexOf('Delegated'), 'delegation follows cache');
  assert.ok(out.indexOf('Delegated') < out.indexOf('1d'), 'the period label still closes the line');
});

test('the segment whitelist knows the chip by name', () => {
  const only = formatReport(data(3.2), { ...opts, segments: ['delegated'] });
  assert.match(only, /Delegated \$3\.2/);
  assert.doesNotMatch(only, /Cache saved/);
  assert.doesNotMatch(formatReport(data(3.2), { ...opts, segments: ['saved'] }), /Delegated/);
});

test('--no-color output carries no ANSI escapes', () => {
  assert.doesNotMatch(formatReport(data(3.2), opts), /\x1b\[/);
});
