/**
 * The compaction chip: how many times this session's conversation was
 * compacted. Each compaction replaces earlier conversation with a summary, so
 * the chip darkens with the count and is absent until the first one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// config.js resolves its file when first loaded, and the formatter pulls it in
// transitively, so the temp dir is set before anything from src/ is imported.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'cts-compactions-'));
const { formatReport, DEFAULT_SEGMENT_ORDER, RED, YELLOW, GRAY, RESET } = await import('../src/formatters/statusline.js');
const { sessionCompactions } = await import('../src/statusline-data.js');

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const astral = (s) => [...strip(s)].filter((ch) => ch.codePointAt(0) > 0xffff);

function data(compactions) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: { usedPct: 47, size: 1_000_000 },
    spikeChip: null,
    caps: { windows: [{ key: 'five_hour', usedPct: 31 }, { key: 'seven_day', usedPct: 10 }] },
    model: 'Opus 5',
    effort: 'high',
    delegationSaved: 0,
    compactions,
  };
}

const opts = { color: false, timer: false, mode: 'icon' };
const chip = (n, o = {}) => formatReport(data(n), { ...opts, segments: ['compactions'], ...o });

test('no chip at 0, null, undefined or a non-integer', () => {
  for (const n of [0, null, undefined, NaN, -1, 1.5, '3']) {
    assert.equal(strip(chip(n)).trim(), '', `nothing for ${String(n)}`);
    assert.doesNotMatch(strip(formatReport(data(n), { ...opts, verbose: true })), /Compacted|🧹/);
  }
});

test('the tone darkens with the count: quiet at 1, yellow at 2, red from 3', () => {
  const colored = (n) => chip(n, { color: true, mode: 'text' });
  assert.equal(colored(1), `${GRAY}Compacted 1×${RESET}\x1b[K`);
  assert.equal(colored(2), `${YELLOW}Compacted 2×${RESET}\x1b[K`);
  assert.equal(colored(3), `${RED}Compacted 3×${RESET}\x1b[K`);
  assert.equal(colored(7), `${RED}Compacted 7×${RESET}\x1b[K`);
});

test('icon mode draws the broom, short or with the word', () => {
  assert.equal(strip(chip(3)).trim(), '🧹 3×');
  assert.equal(strip(chip(3, { verbose: true })).trim(), '🧹 Compacted 3×');
});

test('narrow and text modes use the word and no emoji', () => {
  for (const mode of ['narrow', 'text']) {
    for (const verbose of [true, false]) {
      const one = strip(chip(3, { mode, verbose })).trim();
      assert.equal(one, 'Compacted 3×', `${mode} verbose=${verbose}`);
      const line = formatReport(data(3), { ...opts, mode, verbose });
      assert.deepEqual(astral(line), [], `${mode} verbose=${verbose} line stays emoji-free`);
      assert.match(strip(line), /Compacted 3×/);
    }
  }
});

test('the chip sits right after the context chip', () => {
  assert.equal(DEFAULT_SEGMENT_ORDER[DEFAULT_SEGMENT_ORDER.indexOf('ctx') + 1], 'compactions');
  for (const [mode, ctx] of [['icon', '📦 47%'], ['text', 'Ctx 47% of 1M']]) {
    const line = strip(formatReport(data(2), { ...opts, mode }));
    const want = mode === 'icon' ? '🧹 2×' : 'Compacted 2×';
    assert.ok(line.includes(`${ctx} · ${want}`), `${mode}: ${line}`);
  }
});

test('--segments compactions selects it alone', () => {
  const out = strip(chip(4, { verbose: true })).trim();
  assert.equal(out, '🧹 Compacted 4×');
  assert.doesNotMatch(out, /📦|🤖/);
});

test('compact level 2 keeps the chip and level 3 drops it', () => {
  const two = strip(formatReport(data(3), { ...opts, compactLevel: 2, columns: 120 }));
  const three = strip(formatReport(data(3), { ...opts, compactLevel: 3, columns: 120 }));
  assert.match(two, /🧹 3×/);
  assert.doesNotMatch(three, /🧹|Compacted/);
  assert.match(three, /📦/, 'the context chip stays at level 3');
});

test('a narrow terminal gives the chip up before the context chip', () => {
  const out = strip(formatReport(data(3), { ...opts, columns: 40, maxLines: 1 }));
  assert.match(out, /📦/);
  assert.doesNotMatch(out, /🧹/, 'not one of the chips that stop the work');
});

test('the statusline does not draw the chip without a session', async () => {
  const { formatNoSession } = await import('../src/formatters/statusline.js');
  const out = strip(formatNoSession({ compactions: 3, model: 'Opus 5' }, { color: false }));
  assert.doesNotMatch(out, /Compacted|🧹/);
});

test('sessionCompactions finds the session by transcript path, then by id', () => {
  const sessions = [
    { sessionId: 'a', filePath: '/tmp/p/a.jsonl', endTime: new Date(1000), compactions: 1 },
    { sessionId: 'b', filePath: '/tmp/p/b-old.jsonl', endTime: new Date(1000), compactions: 5 },
    { sessionId: 'b', filePath: '/tmp/p/b.jsonl', endTime: new Date(2000), compactions: 2 },
    { sessionId: 'c', filePath: '/tmp/p/c.jsonl', endTime: new Date(1000) },
  ];
  assert.equal(sessionCompactions(sessions, { transcriptPath: '/tmp/p/../p/a.jsonl' }), 1);
  assert.equal(sessionCompactions(sessions, { transcriptPath: '/tmp/p/b-old.jsonl', sessionId: 'b' }), 5, 'the path wins over the id');
  assert.equal(sessionCompactions(sessions, { sessionId: 'b' }), 2, 'the most recently active file of the id');
  assert.equal(sessionCompactions(sessions, { sessionId: 'c' }), 0, 'a summary without the field reads as 0');
  assert.equal(sessionCompactions(sessions, { sessionId: 'zz' }), null);
  assert.equal(sessionCompactions(sessions, {}), null);
  assert.equal(sessionCompactions(null, { sessionId: 'a' }), null);
});
