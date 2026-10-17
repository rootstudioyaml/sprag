/**
 * transcriptLines() must leave no file open behind it, whichever way the loop
 * ends. On Windows an open descriptor makes the directory undeletable, and
 * Node 20 kept one open after an early `return` and, for a moment, after a
 * loop that ran to the end. POSIX shows the same leak as a descriptor count,
 * which /dev/fd lists on macOS and Linux.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcriptLines } from '../src/transcript-lines.js';

const openFds = () => readdirSync('/dev/fd').length;
const hasDevFd = process.platform !== 'win32';

const dir = mkdtempSync(join(tmpdir(), 'sprag-lines-'));
const file = join(dir, 'a.jsonl');
writeFileSync(file, Array.from({ length: 50 }, (_, i) => `{"n":${i}}`).join('\n') + '\n');
test.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

test('yields every line and closes the file before returning', { skip: !hasDevFd && 'no /dev/fd' }, async () => {
  const before = openFds();
  let count = 0;
  for await (const line of transcriptLines(file)) if (line) count += 1;
  assert.equal(count, 50);
  assert.equal(openFds(), before, 'the descriptor is released when the loop is over, not later');
});

test('an early break closes the file too', { skip: !hasDevFd && 'no /dev/fd' }, async () => {
  const before = openFds();
  for await (const line of transcriptLines(file)) {
    if (line.includes('"n":3')) break;
  }
  assert.equal(openFds(), before);
});

test('a return from inside the loop closes the file', { skip: !hasDevFd && 'no /dev/fd' }, async () => {
  const before = openFds();
  const find = async () => {
    for await (const line of transcriptLines(file)) if (line.includes('"n":7')) return line;
    return null;
  };
  assert.equal(await find(), '{"n":7}');
  assert.equal(openFds(), before);
});

test('a missing file throws and leaves nothing open', { skip: !hasDevFd && 'no /dev/fd' }, async () => {
  const before = openFds();
  await assert.rejects(async () => { for await (const line of transcriptLines(join(dir, 'missing.jsonl'))) void line; }, /ENOENT/);
  assert.equal(openFds(), before);
});
