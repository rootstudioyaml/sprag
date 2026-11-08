/**
 * grade-counts: the raised count the statusline shows, kept in a
 * small state file and zeroed by the routing reset mark. Every call passes a
 * throwaway directory, so the real user data is never read or written.
 */
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordGradeAction, gradeActionTotals, gradeCountsPath, GRADE_COUNTS_VERSION } from '../src/grade-counts.js';
import { resetSaved } from '../src/saved-reset.cjs';

const DIR = mkdtempSync(join(tmpdir(), 'sprag-grade-counts-'));
after(() => rmSync(DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
beforeEach(() => {
  for (const f of [gradeCountsPath(DIR), join(DIR, 'saved-reset.json')]) rmSync(f, { force: true });
});

test('no file reads as zero with no reset mark', () => {
  assert.deepEqual(gradeActionTotals(DIR), { raised: 0, since: null });
});

test('each raise counts once and the file keeps the window start', () => {
  const t0 = Date.now();
  recordGradeAction('raised', { dir: DIR, now: t0 });
  recordGradeAction('raised', { dir: DIR, now: t0 + 5 });
  assert.deepEqual(gradeActionTotals(DIR), { raised: 2, since: null });
  const file = JSON.parse(readFileSync(gradeCountsPath(DIR), 'utf8'));
  assert.deepEqual(file, { version: GRADE_COUNTS_VERSION, raised: 2, since: t0 });
});

test('a file written with the old blocked field still loads, and the next write drops the field', () => {
  writeFileSync(gradeCountsPath(DIR), JSON.stringify({ version: GRADE_COUNTS_VERSION, raised: 3, blocked: 4, since: Date.now() }));
  assert.deepEqual(gradeActionTotals(DIR), { raised: 3, since: null });
  recordGradeAction('raised', { dir: DIR });
  const file = JSON.parse(readFileSync(gradeCountsPath(DIR), 'utf8'));
  assert.equal(file.raised, 4);
  assert.equal('blocked' in file, false);
});

test('an unknown action writes nothing', () => {
  assert.equal(recordGradeAction('blocked', { dir: DIR }), null);
  assert.equal(existsSync(gradeCountsPath(DIR)), false);
});

test('a routing reset zeroes the totals at once and the next write starts a new window', () => {
  const t0 = Date.now() - 10_000;
  recordGradeAction('raised', { dir: DIR, now: t0 });
  resetSaved(['routing'], { dir: DIR, now: t0 + 5_000 });
  // Same field the effort guard reads: the mark itself.
  assert.deepEqual(gradeActionTotals(DIR), { raised: 0, since: t0 + 5_000 });
  recordGradeAction('raised', { dir: DIR, now: t0 + 6_000 });
  assert.deepEqual(gradeActionTotals(DIR), { raised: 1, since: t0 + 5_000 });
  assert.equal(JSON.parse(readFileSync(gradeCountsPath(DIR), 'utf8')).since, t0 + 6_000);
});

test('a reset of another counter changes nothing', () => {
  recordGradeAction('raised', { dir: DIR, now: Date.now() - 1000 });
  resetSaved(['doc2md'], { dir: DIR });
  assert.equal(gradeActionTotals(DIR).raised, 1);
});

test('an unreadable or wrong-version file reads as zero and is replaced on the next write', () => {
  writeFileSync(gradeCountsPath(DIR), '{not json');
  assert.equal(gradeActionTotals(DIR).raised, 0);
  writeFileSync(gradeCountsPath(DIR), JSON.stringify({ version: 99, raised: 7, since: 1 }));
  assert.deepEqual(gradeActionTotals(DIR), { raised: 0, since: null });
  recordGradeAction('raised', { dir: DIR });
  assert.equal(gradeActionTotals(DIR).raised, 1);
});
