/**
 * member-id — the random default display name: created once, persisted,
 * replaced only when the file is not a valid id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memberId, memberIdPath } from '../src/member-id.js';

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-member-id-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

test('memberId creates an id in the expected format and persists it', (t) => {
  const dir = tmp(t);
  const id = memberId({ dir });
  assert.match(id, /^member-[0-9a-f]{8}$/);
  assert.equal(readFileSync(memberIdPath(dir), 'utf8'), `${id}\n`);
});

test('a second call returns the stored id instead of generating another', (t) => {
  const dir = tmp(t);
  const a = memberId({ dir, random: () => '3f9a2c71' });
  assert.equal(a, 'member-3f9a2c71');
  assert.equal(memberId({ dir, random: () => 'deadbeef' }), a);
});

test('a file that is not a valid id is replaced', (t) => {
  const dir = tmp(t);
  for (const bad of ['', 'alice\n', 'member-XYZ12345\n', 'member-3f9a2c7\n', 'member-3f9a2c71extra\n']) {
    writeFileSync(memberIdPath(dir), bad);
    assert.equal(memberId({ dir, random: () => 'abcdef01' }), 'member-abcdef01');
    assert.equal(readFileSync(memberIdPath(dir), 'utf8'), 'member-abcdef01\n');
  }
});

test('memberId still returns an id when the directory cannot be written', (t) => {
  const dir = tmp(t);
  const blocker = join(dir, 'file');
  writeFileSync(blocker, 'x');
  // A path under a regular file cannot be created; the call must not throw.
  assert.match(memberId({ dir: join(blocker, 'sub') }), /^member-[0-9a-f]{8}$/);
});

test('a failed write returns the same id on repeated calls in one process', (t) => {
  const dir = tmp(t);
  const blocker = join(dir, 'file');
  writeFileSync(blocker, 'x');
  const sub = join(blocker, 'sub');
  const a = memberId({ dir: sub });
  assert.equal(memberId({ dir: sub }), a);
  assert.equal(memberId({ dir: sub, random: () => 'deadbeef' }), a);
});

test('a valid id written by another process is returned and not overwritten', (t) => {
  const dir = tmp(t);
  writeFileSync(memberIdPath(dir), 'member-0a1b2c3d\n');
  assert.equal(memberId({ dir, random: () => 'deadbeef' }), 'member-0a1b2c3d');
  assert.equal(readFileSync(memberIdPath(dir), 'utf8'), 'member-0a1b2c3d\n');
});

test('no temp files are left behind', (t) => {
  const dir = tmp(t);
  memberId({ dir });
  assert.deepEqual(readdirSync(dir), ['member-id']);
});
