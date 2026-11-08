/**
 * The leading "subagents running" chip. A run counts when its transcript was
 * written recently and its meta file does not say `finished` (see
 * src/statusline-running.js for the measurement behind that choice).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runningSubagents, RUNNING_WINDOW_MS } from '../src/statusline-running.js';
import { formatReport } from '../src/formatters/statusline.js';
import { cellWidth } from '../src/cell-width.js';

const plain = (t) => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const NOW = Date.parse('2026-11-09T08:00:00Z');

/** A session directory with the given subagent runs: { id, ageMs, finished, model }. */
function fixture(runs) {
  const root = mkdtempSync(join(tmpdir(), 'sprag-running-'));
  const transcript = join(root, 'sess1.jsonl');
  writeFileSync(transcript, '{}\n');
  const dir = join(root, 'sess1', 'subagents');
  mkdirSync(dir, { recursive: true });
  for (const r of runs) {
    const file = join(dir, `agent-${r.id}.jsonl`);
    const rec = (m) => JSON.stringify({ type: 'assistant', isSidechain: true, message: { role: 'assistant', model: m, content: [{ type: 'text', text: 'x' }] } });
    // The model sits behind a bulky record, as a real api-request record is.
    writeFileSync(file, `${rec(r.model)}\n${JSON.stringify({ type: 'api-request', pad: 'p'.repeat(4000) })}\n`);
    const t = new Date(NOW - r.ageMs);
    utimesSync(file, t, t);
    const meta = { agentType: 't1-worker', ...(r.finished === undefined ? {} : { finished: r.finished }) };
    writeFileSync(join(dir, `agent-${r.id}.meta.json`), JSON.stringify(meta));
  }
  return { root, transcript };
}

test('recent unfinished runs are counted, with their model families', () => {
  const { root, transcript } = fixture([
    { id: 'a', ageMs: 2_000, model: 'claude-sonnet-5-5' },
    { id: 'b', ageMs: 5_000, model: 'claude-opus-4-5' },
    { id: 'c', ageMs: 1_000, model: 'claude-sonnet-5-5' },
  ]);
  try {
    const r = runningSubagents(transcript, { now: NOW });
    assert.equal(r.count, 3);
    assert.deepEqual(r.families, [{ family: 'sonnet', runs: 2 }, { family: 'opus', runs: 1 }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('old and finished runs are not counted', () => {
  const { root, transcript } = fixture([
    { id: 'old', ageMs: RUNNING_WINDOW_MS + 5_000, model: 'claude-sonnet-5-5' },
    { id: 'done', ageMs: 1_000, finished: true, model: 'claude-sonnet-5-5' },
    { id: 'live', ageMs: 1_000, finished: false, model: 'claude-haiku-4-5' },
  ]);
  try {
    const r = runningSubagents(transcript, { now: NOW });
    assert.equal(r.count, 1);
    assert.deepEqual(r.families, [{ family: 'haiku', runs: 1 }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('nothing running, no directory, or no transcript path is null', () => {
  const { root, transcript } = fixture([{ id: 'done', ageMs: 100, finished: true, model: 'claude-sonnet-5-5' }]);
  try {
    assert.equal(runningSubagents(transcript, { now: NOW }), null);
    assert.equal(runningSubagents(join(root, 'other.jsonl'), { now: NOW }), null);
    assert.equal(runningSubagents(null), null);
    assert.equal(runningSubagents('/x/not-a-transcript.txt'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing meta file counts as running, and only the newest files are read for a model', () => {
  const runs = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, ageMs: 1_000 + i * 100, model: 'claude-sonnet-5-5' }));
  const { root, transcript } = fixture(runs);
  rmSync(join(root, 'sess1', 'subagents', 'agent-r0.meta.json'));
  try {
    const r = runningSubagents(transcript, { now: NOW });
    assert.equal(r.count, 8);
    assert.deepEqual(r.families, [{ family: 'sonnet', runs: 5 }], 'models read for at most five files');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function data(extra = {}) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: { usedPct: 47, size: 1_000_000 },
    spikeChip: null,
    caps: { windows: [{ key: 'five_hour', usedPct: 31 }] },
    model: 'Opus 5',
    effort: 'high',
    delegationSaved: 0,
    ...extra,
  };
}
const running = (lang) => ({ count: 2, families: [{ family: 'sonnet', runs: 1 }, { family: 'opus', runs: 1 }], lang });
const opts = { color: false, timer: false, mode: 'icon' };

test('the chip is the first thing on the first line, in Korean and in English', () => {
  const ko = plain(formatReport(data({ runningSubagents: running('ko') }), { ...opts, columns: 120 }));
  assert.ok(ko.startsWith('⏳ 서브에이전트 2개 실행 중 (sonnet 1, opus 1)'), ko.split('\n')[0]);
  const en = plain(formatReport(data({ runningSubagents: running('en') }), { ...opts, columns: 120 }));
  assert.ok(en.startsWith('⏳ 2 subagents running (sonnet 1, opus 1)'), en.split('\n')[0]);
  const one = plain(formatReport(data({ runningSubagents: { count: 1, families: [], lang: 'en' } }), { ...opts, columns: 120 }));
  assert.ok(one.startsWith('⏳ 1 subagent running · '), one.split('\n')[0]);
});

test('text mode drops the glyph and the narrow set has none', () => {
  const text = plain(formatReport(data({ runningSubagents: running('en') }), { ...opts, mode: 'text' }));
  assert.ok(text.startsWith('2 subagents running'));
  const narrow = plain(formatReport(data({ runningSubagents: running('en') }), { ...opts, mode: 'narrow' }));
  assert.ok(narrow.startsWith('2 subagents running'));
});

test('no chip when nothing is running, and the line is unchanged', () => {
  const plainOut = formatReport(data(), { ...opts, columns: 120 });
  assert.ok(!plainOut.includes('running'));
  assert.equal(formatReport(data({ runningSubagents: null }), { ...opts, columns: 120 }), plainOut);
});

test('with a headline row the chip joins that row and the row still fits', () => {
  const totals = { total: 288, since: Date.parse('2026-11-01T12:00:00'), pairs: [
    { from: 'opus', to: 'sonnet', runs: 130, usd: 241 }, { from: 'opus', to: 'haiku', runs: 51, usd: 21.1 },
    { from: 'fable', to: 'sonnet', runs: 8, usd: 14.7 }, { from: 'fable', to: 'opus', runs: 3, usd: 7.75 } ] };
  const out = plain(formatReport(data({ delegationSaved: 288, delegationTotals: totals, runningSubagents: running('ko') }), { ...opts, columns: 120 }));
  const first = out.split('\n')[0];
  assert.ok(first.startsWith('⏳ 서브에이전트 2개 실행 중'), first);
  assert.ok(first.includes('Routing saved'));
  assert.ok(cellWidth(first) <= 116, `first row is ${cellWidth(first)} cells`);
  assert.equal(out.split('\n').filter((l) => l.includes('서브에이전트')).length, 1);
});

test('a user segment list hides the chip unless it names running, subagents or delegated', () => {
  const d = data({ runningSubagents: running('en') });
  assert.ok(!plain(formatReport(d, { ...opts, segments: ['model'] })).includes('running'));
  for (const name of ['running', 'subagents', 'delegated']) {
    assert.ok(plain(formatReport(d, { ...opts, segments: ['model', name] })).startsWith('⏳ 2 subagents running'), name);
  }
});
