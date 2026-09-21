/**
 * session-paths — recentToolPaths() pulls file paths a session already
 * touched out of its transcript tail, for delegation-guard.js to hand a
 * subagent instead of letting it re-explore from scratch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recentToolPaths } from '../src/session-paths.js';

function assistantToolUse(name, input) {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
}

test('recentToolPaths: missing transcript, or no path at all, returns []', () => {
  const root = mkdtempSync(join(tmpdir(), 'sprag-sp-'));
  try {
    assert.deepEqual(recentToolPaths(join(root, 'does-not-exist.jsonl'), { root }), []);
    assert.deepEqual(recentToolPaths(null, { root }), []);
    assert.deepEqual(recentToolPaths(undefined, { root }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recentToolPaths: catches per-tool argument keys, drops outside-root paths, dedupes with most-recent-first, and skips broken JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'sprag-sp-'));
  const outsideRoot = mkdtempSync(join(tmpdir(), 'sprag-sp-outside-'));
  try {
    const aPath = join(root, 'src', 'a.js');
    const bPath = join(root, 'src', 'b.js');
    const outsidePath = join(outsideRoot, 'c.js');

    const lines = [
      // Kept, not dropped: this transcript is far smaller than the window, so
      // the read starts at byte 0 and nothing was cut. It stays out of the
      // result only because the "tool_use" prefilter passes over it. The
      // truncation branch is covered by its own test below.
      'NOT-A-TOOL-USE-LINE',
      // A line that looks like a tool_use record but fails to parse — must be
      // skipped rather than throwing the whole read away.
      '{"type":"assistant","message":{"content":[{"type":"tool_use"',
      // Read uses `file_path`.
      assistantToolUse('Read', { file_path: aPath }),
      // Grep uses `path` — a different argument key for the same purpose.
      assistantToolUse('Grep', { path: bPath }),
      // Outside the repo root entirely: must be filtered out.
      assistantToolUse('Read', { file_path: outsidePath }),
      // a.js touched again, later — this occurrence should win the dedupe and
      // put a.js ahead of b.js in the result.
      assistantToolUse('Read', { file_path: aPath }),
    ];
    const transcriptPath = join(root, 'session.jsonl');
    writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const result = recentToolPaths(transcriptPath, { root });
    assert.deepEqual(result, [join('src', 'a.js'), join('src', 'b.js')]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('recentToolPaths: limit truncates the result', () => {
  const root = mkdtempSync(join(tmpdir(), 'sprag-sp-'));
  try {
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push(assistantToolUse('Read', { file_path: join(root, `f${i}.js`) }));
    }
    const transcriptPath = join(root, 'session.jsonl');
    // Leading throwaway line so the shift() in recentToolPaths does not eat
    // a real record.
    // Same as above: a line the prefilter ignores rather than one the tail cut.
    writeFileSync(transcriptPath, ['NOT-A-TOOL-USE-LINE', ...lines].join('\n') + '\n');

    const result = recentToolPaths(transcriptPath, { root, limit: 2 });
    assert.equal(result.length, 2);
    assert.deepEqual(result, ['f4.js', 'f3.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recentToolPaths: a whole-file read keeps the opening record, a cut tail drops it', () => {
  const root = mkdtempSync(join(tmpdir(), 'sprag-sp-'));
  try {
    const first = join(root, 'src', 'first.js');
    const later = join(root, 'src', 'later.js');
    const lines = [
      assistantToolUse('Read', { file_path: first }),
      assistantToolUse('Read', { file_path: later }),
    ];
    const transcriptPath = join(root, 'session.jsonl');
    writeFileSync(transcriptPath, lines.join('\n') + '\n');

    // The file fits inside the window, so the read starts at byte 0 and the
    // first line is a whole record. Dropping it here would lose the only
    // history a short transcript has.
    assert.deepEqual(recentToolPaths(transcriptPath, { root }),
      [join('src', 'later.js'), join('src', 'first.js')]);

    // A window that holds the last record and only part of the first makes the
    // read start mid-record, so that fragment goes and the rest survives.
    const tailBytes = Buffer.byteLength(lines[1], 'utf8') + 12;
    assert.deepEqual(recentToolPaths(transcriptPath, { root, tailBytes }),
      [join('src', 'later.js')]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recentToolPaths: the default window survives a transcript padded out with tool results', () => {
  /* The regression this pins was found by measuring a live session, not by
     reading the code: a transcript's bytes are almost all tool RESULTS, so a
     window sized for "a few recent turns" in lines is far smaller than that in
     bytes. At the original 256KiB default, a real 4.65MB session held 28 lines
     and gave back 0 of the 8 path-bearing calls it had made — the feature was
     silently dead in exactly the sessions long enough to need it. Padding here
     stands in for those results; the assertion is that the path still comes
     back with no tailBytes argument, which is how the hook calls it. */
  const root = mkdtempSync(join(tmpdir(), 'sprag-sp-'));
  try {
    const wanted = join(root, 'src', 'wanted.js');
    const padding = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'x'.repeat(60 * 1024) }] },
    });
    const lines = [assistantToolUse('Read', { file_path: wanted })];
    // Comfortably past the old 256KiB window, and past it in result bytes
    // rather than in record count, which is the shape that caused the miss.
    for (let i = 0; i < 8; i++) lines.push(padding);
    const transcriptPath = join(root, 'session.jsonl');
    writeFileSync(transcriptPath, lines.join('\n') + '\n');
    assert.ok(Buffer.byteLength(lines.join('\n'), 'utf8') > 256 * 1024, 'the padding must clear the old default');

    assert.deepEqual(recentToolPaths(transcriptPath, { root }), [join('src', 'wanted.js')]);
    // And the same transcript with the old window, to show the assertion above
    // is testing the window rather than restating that parsing works.
    assert.deepEqual(recentToolPaths(transcriptPath, { root, tailBytes: 256 * 1024 }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
