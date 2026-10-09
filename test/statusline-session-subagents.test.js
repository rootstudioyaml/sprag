/**
 * This session's subagent runs: `🔀 this session 3 (haiku 2 · sonnet 1)`.
 *
 * The parser already attaches each session's subagent runs to the session
 * summary, so the count costs no extra file I/O: the statusline only has to
 * find which of the loaded sessions is the one Claude Code is drawing for (by
 * the transcript path and session id in its stdin payload) and tally that
 * session's runs by model family.
 *
 * A formatter test cannot catch a missing wire here. The match happens in
 * src/statusline-data.js and the hand-off in bin/cli.js, so the last cases run
 * the real CLI over a sandbox HOME with real transcripts on disk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../src/formatters/statusline.js';
import { sessionSubagentSummary } from '../src/statusline-data.js';
import { makeHome, writeSession, renderStatusline } from './helpers/statusline-home.js';

const run = (model) => ({ model, requestCount: 1, endTime: new Date() });

test('runs are tallied by model family, biggest first, and versions are dropped', () => {
  const sessions = [{
    sessionId: 'a',
    filePath: '/p/a.jsonl',
    subagentRuns: [
      run('claude-haiku-4-5-20251001'),
      run('claude-sonnet-5'),
      run('claude-haiku-4-5'),
      run('claude-opus-4-5-20251101-v1:0'),
      run('claude-haiku-5'),
    ],
  }];
  assert.deepEqual(sessionSubagentSummary(sessions, { sessionId: 'a' }), {
    total: 5,
    families: [
      { family: 'haiku', runs: 3 },
      { family: 'opus', runs: 1 },
      { family: 'sonnet', runs: 1 },
    ],
  });
});

test('the session is found by transcript path first, then by session id', () => {
  const sessions = [
    { sessionId: 'one', filePath: '/p/one.jsonl', subagentRuns: [run('claude-haiku-5')] },
    { sessionId: 'two', filePath: '/p/two.jsonl', subagentRuns: [run('claude-sonnet-5'), run('claude-sonnet-5')] },
  ];
  assert.equal(sessionSubagentSummary(sessions, { transcriptPath: '/p/two.jsonl' }).total, 2);
  assert.equal(sessionSubagentSummary(sessions, { sessionId: 'one' }).total, 1);
  // The path wins when the two disagree: it names a file, an id can be shared.
  assert.equal(sessionSubagentSummary(sessions, { transcriptPath: '/p/one.jsonl', sessionId: 'two' }).total, 1);
  // A path that matches nothing falls back to the id.
  assert.equal(sessionSubagentSummary(sessions, { transcriptPath: '/elsewhere/x.jsonl', sessionId: 'two' }).total, 2);
});

test('a resumed conversation under one id reports the file still being written', () => {
  const sessions = [
    { sessionId: 'same', filePath: '/p/old.jsonl', endTime: new Date('2026-10-01'), subagentRuns: [run('claude-haiku-5')] },
    { sessionId: 'same', filePath: '/p/new.jsonl', endTime: new Date('2026-10-09'), subagentRuns: [run('claude-sonnet-5'), run('claude-sonnet-5')] },
  ];
  assert.equal(sessionSubagentSummary(sessions, { sessionId: 'same' }).total, 2);
});

test('no runs, no match, or nothing to match by all mean no summary', () => {
  const sessions = [
    { sessionId: 'quiet', filePath: '/p/quiet.jsonl' },
    { sessionId: 'empty', filePath: '/p/empty.jsonl', subagentRuns: [] },
  ];
  assert.equal(sessionSubagentSummary(sessions, { sessionId: 'quiet' }), null, 'a session that ran none');
  assert.equal(sessionSubagentSummary(sessions, { sessionId: 'empty' }), null);
  assert.equal(sessionSubagentSummary(sessions, { sessionId: 'unknown' }), null, 'a session not in the window');
  assert.equal(sessionSubagentSummary(sessions, {}), null, 'a payload with neither id nor path');
  assert.equal(sessionSubagentSummary(null, { sessionId: 'quiet' }), null);
  assert.equal(sessionSubagentSummary([], { sessionId: 'quiet' }), null);
});

test('a model id the family table does not know is shown, shortened, not hidden', () => {
  const sessions = [{
    sessionId: 'a',
    filePath: '/p/a.jsonl',
    subagentRuns: [run('arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc'), run(undefined)],
  }];
  const { families } = sessionSubagentSummary(sessions, { sessionId: 'a' });
  const names = families.map((f) => f.family);
  assert.ok(names.includes('?'), 'a run with no model reads as ?');
  const arn = names.find((n) => n.startsWith('arn:'));
  assert.ok(arn && arn.length <= 14, `an opaque id must not flood the line (got "${arn}")`);
});

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

function data(sessionDelegation) {
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
    model: 'Opus 5',
    delegationSaved: 0,
    sessionDelegation,
  };
}

const SD = { total: 3, families: [{ family: 'haiku', runs: 2 }, { family: 'sonnet', runs: 1 }] };
const opts = { color: false, timer: false };

test('the chip reads in every label mode', () => {
  assert.match(formatReport(data(SD), opts), /Subagents this session 3 \(haiku 2 · sonnet 1\)/);
  assert.match(formatReport(data(SD), { ...opts, mode: 'icon' }), /🔀 this session 3 \(haiku 2 · sonnet 1\)/);
  assert.match(formatReport(data(SD), { ...opts, mode: 'narrow' }), /⇉ this session 3 \(haiku 2 · sonnet 1\)/);
  assert.match(
    formatReport(data(SD), { ...opts, mode: 'icon', verbose: true }),
    /🔀 Subagents this session 3 \(haiku 2 · sonnet 1\)/,
  );
});

test('a session with no subagents shows nothing', () => {
  for (const sd of [null, undefined, { total: 0, families: [] }, { total: 'x' }]) {
    const out = formatReport(data(sd), { ...opts, mode: 'icon' });
    assert.doesNotMatch(out, /this session/, `${JSON.stringify(sd)} must render no chip`);
    assert.doesNotMatch(out, / · · /, 'and leave no empty slot');
  }
});

test('the chip follows the model it qualifies and is addressable by name', () => {
  const line = formatReport(data(SD), { ...opts, mode: 'icon' });
  assert.ok(line.indexOf('🤖') < line.indexOf('this session'), 'after the model chip');
  const only = formatReport(data(SD), { ...opts, segments: ['subagents'] });
  assert.match(only, /^Subagents this session 3/);
  assert.doesNotMatch(only, /Cache/);
  // A list naming both the group and the chip prints it once.
  const both = formatReport(data(SD), { ...opts, segments: ['delegated', 'subagents'] });
  assert.equal(both.split('Subagents this session').length - 1, 1);
});

test('the chip is still drawn when a routing headline owns line 1', () => {
  const withHeadline = {
    ...data(SD),
    delegationSaved: 3.2,
    delegationTotals: { week: 0, month: 0, total: 3.2, pairs: [] },
  };
  const out = formatReport(withHeadline, opts).split('\n');
  assert.equal(out.length, 2);
  assert.match(out[0], /^Routing saved \$3\.20$/);
  assert.match(out[1], /Subagents this session 3/);
});

// ---------------------------------------------------------------------------
// Wiring, over the real CLI
// ---------------------------------------------------------------------------

test('the CLI matches the payload to its own session, not a neighbour', () => {
  const home = makeHome();
  try {
    const mine = writeSession(home, {
      sessionId: 'sess-mine',
      subagents: ['claude-haiku-4-5', 'claude-haiku-4-5', 'claude-sonnet-5'],
    });
    // A busier session in the same window, which must not leak into the count.
    writeSession(home, {
      sessionId: 'sess-other',
      subagents: ['claude-opus-5', 'claude-opus-5', 'claude-opus-5', 'claude-opus-5'],
    });
    // Compact wording; verbose is the shipped default and is checked below.
    const compact = { args: ['--no-verbose'] };
    const byPath = renderStatusline(home, { session_id: 'sess-mine', transcript_path: mine }, compact);
    assert.match(byPath, /🔀 this session 3 \(haiku 2 · sonnet 1\)/);
    assert.doesNotMatch(byPath, /opus \d/, 'the other session stays out');

    // Id alone is enough, for a payload that omits the path.
    const byId = renderStatusline(home, { session_id: 'sess-mine' }, compact);
    assert.match(byId, /🔀 this session 3 \(haiku 2 · sonnet 1\)/);

    // And the verbose label.
    const verbose = renderStatusline(home, { session_id: 'sess-mine' }, { args: ['--verbose'] });
    assert.match(verbose, /🔀 Subagents this session 3 \(haiku 2 · sonnet 1\)/);
  } finally {
    home.cleanup();
  }
});

test('the CLI shows no chip for a session that ran no subagents', () => {
  const home = makeHome();
  try {
    writeSession(home, { sessionId: 'sess-solo' });
    writeSession(home, { sessionId: 'sess-busy', subagents: ['claude-haiku-5'] });
    const out = renderStatusline(home, { session_id: 'sess-solo' });
    assert.doesNotMatch(out, /this session/);
    // A payload that names no known session is not guessed at either.
    assert.doesNotMatch(renderStatusline(home, { session_id: 'sess-nope' }), /this session/);
    assert.doesNotMatch(renderStatusline(home, {}), /this session/);
  } finally {
    home.cleanup();
  }
});
