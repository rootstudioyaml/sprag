/**
 * Three small display rules on the statusline:
 *
 *   dated zero       a freshly reset doc2md counter reads `$0`, not `$0.00`
 *   registry age     `v3.67.0 ✓5m ago`: bare `✓5m` reads as time remaining
 *   model name       a raw model id is shortened to `Fable 5.1`
 *
 * Each rule is checked on the formatter, and the model chip, which has two
 * drawing sites, is checked at both, since a fix applied to one of them is the
 * failure these tests exist to catch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReport, formatNoSession, shortModelName,
} from '../src/formatters/statusline.js';
import { bedrockDisplayFromId } from '../src/stdin-payload.js';
import { makeHome, writeSession, renderStatusline } from './helpers/statusline-home.js';

function data(extra = {}) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d', version: '3.67.0' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: null,
    spikeChip: null,
    caps: null,
    model: null,
    delegationSaved: 0,
    ...extra,
  };
}
const opts = { color: false, timer: false };

// --- doc2md dated zero -------------------------------------------------------

test('a dated doc2md zero reads $0 in every layout', () => {
  const since = new Date(new Date().getFullYear(), 9, 9, 12).getTime();
  const d = data({ doc2mdTotals: { total: 0, docs: 0, byExt: [], since } });
  assert.match(formatReport(d, opts), /Doc2md saved \$0 since 10\/9/);
  assert.match(formatReport(d, { ...opts, mode: 'icon' }), /📄 \$0 \(10\/9~\)/);
  assert.match(formatReport(d, { ...opts, mode: 'icon', verbose: true }), /📄 Doc2md saved \$0 since 10\/9/);
  assert.doesNotMatch(formatReport(d, opts), /\$0\.00/);
});

test('real doc2md money keeps formatMoney', () => {
  const since = new Date(new Date().getFullYear(), 9, 9, 12).getTime();
  const d = data({ doc2mdTotals: { total: 1.8, docs: 2, byExt: [{ ext: 'pdf', docs: 2, usd: 1.8 }], since } });
  assert.match(formatReport(d, opts), /Doc2md saved \$1\.80 since 10\/9/);
});

// --- registry age ------------------------------------------------------------

test('the registry age says how long ago', () => {
  const update = { available: false, latest: '3.67.0', checkedAt: Date.now() - 5 * 60 * 1000 };
  const full = formatReport(data({ update }), { ...opts, verbose: true });
  assert.match(full, /v3\.67\.0 ✓5m ago/);
  assert.doesNotMatch(full, /✓5m(?! ago)/, 'never the bare form');
  // The no-session line builds the version chip with verbose off, so it carries
  // no age at all; what must hold is that it never prints the bare form either.
  const bare = formatNoSession({ version: '3.67.0', update }, { color: false, mode: 'icon' });
  assert.doesNotMatch(bare, /✓/);
});

// --- model name --------------------------------------------------------------

test('a raw model id is shortened to family and version', () => {
  const cases = [
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-fable-5', 'Fable 5'],
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-4-5-20250929', 'Sonnet 4.5'],
    ['claude-sonnet-4-20250514', 'Sonnet 4'],
    ['claude-haiku-5', 'Haiku 5'],
    ['claude-mythos-5', 'Mythos 5'],
  ];
  for (const [id, want] of cases) assert.equal(shortModelName(id), want, id);
});

test('gateway ids and the legacy id order are shortened too', () => {
  const cases = [
    ['us.anthropic.claude-fable-5-1-20260101-v1:0', 'Fable 5.1'],
    ['global.anthropic.claude-opus-4-7-20251001-v1:0', 'Opus 4.7'],
    ['bedrock/anthropic.claude-haiku-4-5', 'Haiku 4.5'],
    ['anthropic.claude-sonnet-4-6-20250930-v1:0', 'Sonnet 4.6'],
    ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
    ['us.anthropic.claude-3-5-sonnet-20241022-v2:0', 'Sonnet 3.5'],
    ['claude-3-opus-20240229', 'Opus 3'],
    ['claude-3-haiku-20240307', 'Haiku 3'],
    ['claude-opus-5[1m]', 'Opus 5'],
  ];
  for (const [id, want] of cases) assert.equal(shortModelName(id), want, id);
});

test('what is not a raw id of a known family comes back unchanged', () => {
  for (const name of [
    'Opus 5',
    'Claude Fable 5.1',
    'Sonnet 4.5 (1M context)',
    'claude-unknown-9',
    'my-gateway-alias',
    'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123',
    '',
  ]) {
    assert.equal(shortModelName(name), name, JSON.stringify(name));
  }
  assert.equal(shortModelName(null), null);
  assert.equal(shortModelName(undefined), undefined);
});

test('the shortener agrees with the id parser it builds on', () => {
  // extractModel() already shortens opus/sonnet/haiku ids through
  // bedrockDisplayFromId, and shortModelName defers to it for them. If the two
  // ever diverged, the same id would read differently depending on whether the
  // payload carried a display_name.
  for (const id of ['claude-opus-5', 'claude-opus-4-1', 'anthropic.claude-sonnet-4-20250514-v1:0', 'bedrock/anthropic.claude-haiku-4-5']) {
    assert.equal(shortModelName(id), bedrockDisplayFromId(id), id);
  }
});

test('the full report and the no-session line draw the same model chip', () => {
  for (const mode of ['icon', 'text', 'narrow']) {
    for (const model of ['claude-fable-5-1', 'Opus 5', 'claude-3-5-sonnet-20241022', 'my-gateway-alias']) {
      const full = formatReport(data({ model }), { ...opts, mode, segments: ['model'] });
      const bare = formatNoSession({ model }, { color: false, mode });
      const want = shortModelName(model);
      assert.ok(full.includes(want), `report ${mode} ${model}`);
      assert.ok(bare.includes(want), `no-session ${mode} ${model}`);
      assert.ok(!full.includes('claude-3-5') && !full.includes('claude-fable'), `report ${mode} ${model} shows no raw id`);
    }
  }
});

test('the CLI shows a short name for a payload with only a model id', () => {
  const home = makeHome();
  try {
    writeSession(home, { sessionId: 'sess-model' });
    const out = renderStatusline(home, { session_id: 'sess-model', model: { id: 'claude-fable-5-1' } });
    assert.match(out, /🤖 Fable 5\.1/);
    assert.doesNotMatch(out, /claude-fable-5-1/);
    // The id carries the precise version, so it wins over display_name for
    // every family alike (extractModel); the context size the display_name
    // appends is the 📦 chip's job.
    const named = renderStatusline(home, { session_id: 'sess-model', model: { id: 'claude-fable-5-1', display_name: 'Fable 5.1 (1M)' } });
    assert.match(named, /🤖 Fable 5\.1 ·/);
    const namedOnly = renderStatusline(home, { session_id: 'sess-model', model: { id: 'my-gateway-alias', display_name: 'Fable 5.1 (1M)' } });
    assert.match(namedOnly, /🤖 Fable 5\.1 \(1M\)/);
  } finally {
    home.cleanup();
  }
});

test('the CLI no-session line shortens the model id too', () => {
  const home = makeHome();
  try {
    const out = renderStatusline(home, { model: { id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0' } });
    assert.match(out, /no session data/);
    assert.match(out, /🤖 Sonnet 3\.5/);
  } finally {
    home.cleanup();
  }
});
