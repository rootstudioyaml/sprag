/**
 * The transcript analyzer behind the ratchet candidates and the evidence rate:
 * conversation() keeps only the real messages, error results are grouped by a
 * normalized key and the user's own refusals never count, and readTailEntries()
 * reads just the end of a big transcript. Transcripts are written to temp dirs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const A = require('../src/harness-analyzer.cjs');

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-analyzer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

let n = 0;
const ts = () => new Date(1_800_000_000_000 + (n++) * 1000).toISOString();
const use = (name = 'Bash', id = `tu${n}`) => ({
  type: 'assistant', timestamp: ts(),
  message: { role: 'assistant', id: `m${n}`, content: [{ type: 'tool_use', id, name, input: {} }] },
});
const result = (text, isError = true) => ({
  type: 'user', timestamp: ts(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', is_error: isError, content: text }] },
});
const failed = (text) => [use(), result(text)];
const analyze = (entries) => A.analyzeTranscript('/unused.jsonl', { entries });

test('conversation drops non-message lines and sidechains and merges split assistant lines', () => {
  const raw = [
    { type: 'attachment', timestamp: ts(), attachment: { type: 'hook_success' } },
    { type: 'user', timestamp: ts(), message: { role: 'user', content: 'hello' } },
    { type: 'assistant', timestamp: ts(), message: { role: 'assistant', id: 'm1', content: [{ type: 'thinking', thinking: 'x' }] } },
    { type: 'assistant', timestamp: ts(), message: { role: 'assistant', id: 'm1', content: [{ type: 'text', text: 'hi' }] } },
    { type: 'assistant', timestamp: ts(), message: { role: 'assistant', id: 'm1', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } },
    { type: 'api-request-blob', timestamp: ts(), message: { role: 'user', content: [] } },
    { type: 'assistant', isSidechain: true, timestamp: ts(), message: { role: 'assistant', id: 'm9', content: [{ type: 'text', text: 'sub' }] } },
    { type: 'assistant', timestamp: ts(), message: { role: 'assistant', id: 'm2', content: [{ type: 'text', text: 'next' }] } },
  ];
  const conv = A.conversation(raw);
  assert.deepEqual(conv.map((e) => e.type), ['user', 'assistant', 'assistant']);
  assert.deepEqual(conv[1].message.content.map((b) => b.type), ['thinking', 'text', 'tool_use']);
  assert.equal(conv[2].message.id, 'm2');
});

test('a hook record between a tool_use and its result does not hide the evidence', () => {
  const entries = [
    use('Bash', 't1'),
    { type: 'attachment', timestamp: ts(), attachment: { type: 'hook_success' } },
    result('ok', false),
  ];
  const r = analyze(entries);
  assert.equal(r.evidenceRate, 1);
  assert.equal(r.evidenceLow, false);
});

test('an error copied into an api-request line counts once; two real ones count twice', () => {
  const text = 'fatal: unable to access the registry, connection refused after retries';
  const blob = { type: 'api-request-blob', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: text }] } };
  assert.deepEqual(analyze([...failed(text), blob]).ratchetCandidates, []);
  const two = analyze([...failed(text), blob, ...failed(text)]).ratchetCandidates;
  assert.equal(two.length, 1);
  assert.equal(two[0].count, 2);
  assert.equal(two[0].id, 1);
  assert.ok(two[0].key);
});

test('user refusals, interrupted calls and a bare exit status are not candidates', () => {
  const texts = [
    "The user doesn't want to proceed with this tool use. The tool use was rejected",
    '<tool_use_error>The user rejected this tool call</tool_use_error>',
    '[Tool call interrupted by the user before it finished running]',
    'Exit code 1',
  ];
  for (const text of texts) {
    const entries = [...failed(text), ...failed(text), ...failed(text)];
    assert.deepEqual(analyze(entries).ratchetCandidates, [], text);
  }
  // An exit status followed by a real message still counts.
  const real = 'Exit code 2\nsh: build-tool: command not found';
  assert.equal(analyze([...failed(real), ...failed(real)]).ratchetCandidates.length, 1);
});

test('errors that differ only in numbers and paths share a group; pattern is the first original text', () => {
  const a = 'ENOENT: no such file or directory, open /home/me/proj/src/alpha.js while reading line 12 of the input';
  const b = 'ENOENT: no such file or directory, open /home/me/other/lib/beta.js while reading line 345 of the input';
  const list = analyze([...failed(a), ...failed(b)]).ratchetCandidates;
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 2);
  assert.equal(list[0].pattern, a.slice(0, 80));
  assert.equal(A.normalizeError(a), A.normalizeError(b));
  assert.equal(A.normalizeError('<tool_use_error>  oops 7').startsWith('oops'), true);
  assert.ok(A.normalizeError('x'.repeat(200)).length <= 60);
});

test('recentErrors reports key, pattern, count and lastAt per group', () => {
  const text = 'Cannot read properties of undefined (reading items) at step 4';
  const errs = A.recentErrors([...failed(text), ...failed(text.replace('4', '5')), ...failed('Another failure with enough text to count')]);
  assert.equal(errs.length, 2);
  const g = errs.find((e) => e.count === 2);
  assert.deepEqual(Object.keys(g).sort(), ['count', 'key', 'lastAt', 'pattern']);
  assert.equal(g.pattern, text.slice(0, 80));
});

test('readTailEntries drops the cut first line and keeps the rest; a missing file gives []', (t) => {
  const dir = tmp(t);
  const lines = [1, 2, 3].map((i) => JSON.stringify({ n: i, pad: 'x'.repeat(100) }) + '\n');
  const file = join(dir, 't.jsonl');
  writeFileSync(file, lines.join(''));
  const L = lines[0].length;
  // The window starts 10 bytes before the end of line 2: that fragment is cut.
  assert.deepEqual(A.readTailEntries(file, L + 10).map((e) => e.n), [3]);
  assert.deepEqual(A.readTailEntries(file, 10 * L).map((e) => e.n), [1, 2, 3]);
  assert.deepEqual(A.readTailEntries(join(dir, 'missing.jsonl'), 1024), []);
});

test('candidate files round-trip through a given directory and a missing file reads as null', (t) => {
  const dir = tmp(t);
  assert.equal(A.readCandidates(dir), null);
  A.writeCandidates({ sessionId: 's', candidates: [{ id: 1, count: 2 }] }, dir);
  assert.deepEqual(A.readCandidates(dir), { sessionId: 's', candidates: [{ id: 1, count: 2 }] });
});
