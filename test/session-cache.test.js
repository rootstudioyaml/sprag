import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// session-cache resolves its path from userDataDir() at module load, so the
// env override has to be in place before the dynamic import below.
let dir;
let cache;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cts-cache-'));
  process.env.XDG_CONFIG_HOME = dir;
  cache = await import('../src/session-cache.js');
});

after(() => rmSync(dir, { recursive: true, force: true }));

// mtime must be a realistic recent epoch — saveCache prunes entries whose
// transcript is older than 90 days, so a placeholder like `1000` (1970) would
// never survive a roundtrip.
const MTIME = Date.now() - 60 * 60 * 1000;
const file = { path: '/p/a.jsonl', projectDir: 'proj', mtime: MTIME, size: 500 };
const session = {
  sessionId: 'sess-1',
  startTime: new Date('2026-07-01T10:00:00Z'),
  endTime: new Date('2026-07-01T11:00:00Z'),
  requestCount: 3,
  totals: { input: 1, cacheCreation: 2, cacheRead: 3, ephemeral5m: 4, ephemeral1h: 5, output: 6 },
  maxContextPerRequest: 123,
  model: 'claude-opus-5',
  requests: [{ requestId: 'r1' }],
};

test('roundtrips a session through disk with Dates intact', () => {
  const c = { entries: {} };
  cache.putCached(c, file, session);
  cache.saveCache(c);
  assert.ok(existsSync(cache.sessionCachePath()));

  const hit = cache.getCached(cache.loadCache(), file);
  assert.equal(hit.sessionId, 'sess-1');
  assert.equal(hit.requestCount, 3);
  assert.equal(hit.maxContextPerRequest, 123);
  assert.deepEqual(hit.totals, session.totals);
  assert.ok(hit.startTime instanceof Date);
  assert.equal(hit.startTime.toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(hit.endTime.toISOString(), '2026-07-01T11:00:00.000Z');
  // filePath/projectDir come from the discovered file, not the stored blob.
  assert.equal(hit.filePath, file.path);
  assert.equal(hit.projectDir, 'proj');
  // The per-request array is deliberately not cached.
  assert.equal(hit.requests, undefined);
});

test('a changed size or mtime is a miss (append-only identity)', () => {
  const c = { entries: {} };
  cache.putCached(c, file, session);
  assert.ok(cache.getCached(c, file), 'sanity: exact match hits');
  assert.equal(cache.getCached(c, { ...file, size: 501 }), null, 'grown file must miss');
  assert.equal(cache.getCached(c, { ...file, mtime: MTIME + 1 }), null, 'touched file must miss');
  assert.equal(cache.getCached(c, { ...file, path: '/p/b.jsonl' }), null, 'other file must miss');
});

test('a corrupt cache file degrades to an empty cache', () => {
  writeFileSync(cache.sessionCachePath(), '{ this is not json');
  assert.deepEqual(cache.loadCache(), { entries: {} });
});

test('a cache written by a future version is discarded, not misread', () => {
  writeFileSync(
    cache.sessionCachePath(),
    JSON.stringify({ version: 999, entries: { '/p/a.jsonl': { mtimeMs: MTIME, size: 500, s: {} } } }),
  );
  assert.deepEqual(cache.loadCache(), { entries: {} });
});

test('entries for long-dead transcripts are pruned on save', () => {
  const old = { ...file, path: '/p/old.jsonl', mtime: Date.now() - 200 * 24 * 60 * 60 * 1000 };
  const fresh = { ...file, path: '/p/fresh.jsonl', mtime: Date.now() };
  const c = { entries: {} };
  cache.putCached(c, old, session);
  cache.putCached(c, fresh, session);
  cache.saveCache(c);

  const reloaded = cache.loadCache();
  assert.equal(reloaded.entries['/p/old.jsonl'], undefined, '200d-old entry should be pruned');
  assert.ok(reloaded.entries['/p/fresh.jsonl'], 'recent entry should survive');
});
