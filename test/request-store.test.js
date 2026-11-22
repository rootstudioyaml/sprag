import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, existsSync, readFileSync, statSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The store lives under the data directory, so point it at a temp one first.
const home = mkdtempSync(join(tmpdir(), 'rs-home-'));
process.env.XDG_CONFIG_HOME = home;
delete process.env.SPRAG_NO_REQUEST_STORE;
delete process.env.CTS_NO_REQUEST_STORE;

const { parseSessionFile, parseStats, resetParseStats, parseAllSessions, flushPendingSessionCache } = await import('../src/parser.js');
const store = await import('../src/request-store.js');

const work = mkdtempSync(join(tmpdir(), 'rs-work-'));
const T0 = Date.now() - 3600_000;
let seq = 0;
const newFile = () => join(work, `t${seq++}.jsonl`);

function entry(n, { id = 'r' + n, out = n * 2 } = {}) {
  const model = n % 5 === 0 ? 'claude-haiku-4-5' : 'claude-sonnet-4-5';
  return JSON.stringify({
    type: 'assistant', sessionId: 'sess-1', requestId: id, timestamp: new Date(T0 + n * 1000).toISOString(),
    message: {
      id: 'm' + n, model,
      usage: {
        input_tokens: n, output_tokens: out, cache_read_input_tokens: 10, cache_creation_input_tokens: 5,
        cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 0 },
      },
    },
  }) + '\n';
}
const userLine = (n) => JSON.stringify({ type: 'user', sessionId: 'sess-1', timestamp: new Date(T0 + n * 1000).toISOString(), message: { role: 'user', content: 'hi' } }) + '\n';
function batch(from, to) {
  let s = '';
  for (let n = from; n <= to; n++) s += entry(n) + (n % 7 === 0 ? userLine(n) : '') + (n % 11 === 0 ? 'not json\n' : '');
  return s;
}
const full = (f) => parseSessionFile(f, { store: false });
const withStore = (f) => parseSessionFile(f, { minBytes: 1 });

test('store path result equals the whole-file parse, on the first and the resumed read', async () => {
  const f = newFile();
  writeFileSync(f, batch(1, 40));
  resetParseStats();
  assert.deepStrictEqual(await withStore(f), await full(f));
  assert.equal(parseStats().resumed, 0);
  assert.ok(existsSync(store.storePathFor(f)), 'store written');
  assert.deepStrictEqual(await withStore(f), await full(f));
  assert.equal(parseStats().resumed, 1, 'second read resumes from the store');
});

test('an appended transcript parses like a whole file, streaming chunks across the boundary included', async () => {
  const f = newFile();
  writeFileSync(f, batch(1, 20) + entry(21, { out: 5 }));
  await withStore(f);
  appendFileSync(f, entry(21, { out: 99 }) + batch(22, 30));
  const got = await withStore(f);
  assert.deepStrictEqual(got, await full(f));
  assert.equal(got.requests.find((r) => r.requestId === 'r21').outputTokens, 99);
});

test('only the appended bytes are read when resuming', async () => {
  const f = newFile();
  writeFileSync(f, batch(1, 30));
  await withStore(f);
  const added = batch(31, 45);
  appendFileSync(f, added);
  resetParseStats();
  const got = await withStore(f);
  // Read the counters before the comparison: the whole-file parse counts too.
  const s = parseStats();
  assert.deepStrictEqual(got, await full(f));
  assert.equal(s.resumed, 1);
  assert.equal(s.full, 0);
  assert.equal(s.bytes, Buffer.byteLength(added));
});

test('a last line cut off without its newline is read again once completed', async () => {
  const f = newFile();
  const last = entry(11);
  writeFileSync(f, batch(1, 10) + last.slice(0, 40));
  assert.deepStrictEqual(await withStore(f), await full(f));
  appendFileSync(f, last.slice(40));
  const got = await withStore(f);
  assert.deepStrictEqual(got, await full(f));
  assert.equal(got.requestCount, 11);
});

test('a complete last line without a newline still counts', async () => {
  const f = newFile();
  writeFileSync(f, batch(1, 10) + entry(11).trimEnd());
  const got = await withStore(f);
  assert.deepStrictEqual(got, await full(f));
  assert.equal(got.requestCount, 11);
});

test('a transcript replaced by other content discards the store', async () => {
  const f = newFile();
  writeFileSync(f, batch(1, 40));
  await withStore(f);
  writeFileSync(f, batch(100, 110));
  resetParseStats();
  assert.deepStrictEqual(await withStore(f), await full(f));
  assert.equal(parseStats().resumed, 0, 'shrunken file is parsed from the start');
  writeFileSync(f, batch(200, 400));
  resetParseStats();
  assert.deepStrictEqual(await withStore(f), await full(f));
  assert.equal(parseStats().resumed, 0, 'same-prefix mismatch on a longer file is parsed from the start');
});

test('a broken store file is ignored', async () => {
  const f = newFile();
  writeFileSync(f, batch(1, 30));
  await withStore(f);
  writeFileSync(store.storePathFor(f), '{not json');
  resetParseStats();
  assert.deepStrictEqual(await withStore(f), await full(f));
  assert.equal(parseStats().resumed, 0);
  writeFileSync(store.storePathFor(f), JSON.stringify({ v: 99, path: f, offset: 5, tailHash: 'x', reqs: [] }));
  assert.deepStrictEqual(await withStore(f), await full(f));
});

test('SPRAG_NO_REQUEST_STORE turns the store off', async () => {
  const f = newFile();
  writeFileSync(f, batch(1, 30));
  process.env.SPRAG_NO_REQUEST_STORE = '1';
  try {
    assert.deepStrictEqual(await withStore(f), await full(f));
    assert.equal(existsSync(store.storePathFor(f)), false);
  } finally {
    delete process.env.SPRAG_NO_REQUEST_STORE;
  }
});

test('pruneRequestStore removes stores older than 35 days', () => {
  const dir = join(home, 'prune-check');
  mkdirSync(dir, { recursive: true });
  const old = join(dir, 'old.json');
  const fresh = join(dir, 'fresh.json');
  writeFileSync(old, '{}');
  writeFileSync(fresh, '{}');
  const past = new Date(Date.now() - 40 * 24 * 3600_000);
  utimesSync(old, past, past);
  assert.equal(store.pruneRequestStore({ dir }), 1);
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
});

test('flushPendingSessionCache writes the entries parsed so far', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-flush-'));
  const files = [];
  for (let i = 0; i < 11; i++) {
    const p = join(dir, `s${i}.jsonl`);
    writeFileSync(p, batch(1, 3));
    const st = statSync(p);
    files.push({ path: p, projectDir: 'proj', mtime: st.mtimeMs, size: st.size });
  }
  const cachePath = join(dir, 'cache.json');
  let seen = null;
  // parseAllSessions slices the list once per batch of ten; the second slice
  // happens between batches, with the first batch already in the cache object.
  class Hooked extends Array {
    static get [Symbol.species]() { return Array; }
    slice(a, b) {
      if (a > 0) {
        flushPendingSessionCache();
        seen = JSON.parse(readFileSync(cachePath, 'utf8'));
      }
      return super.slice(a, b);
    }
  }
  const res = await parseAllSessions({ files: Hooked.from(files), cachePath, days: 3650 });
  assert.equal(Object.keys(seen.entries).length, 10, 'first batch is on disk before the run ends');
  assert.equal(res.length, 11);
  assert.equal(Object.keys(JSON.parse(readFileSync(cachePath, 'utf8')).entries).length, 11);
  assert.doesNotThrow(() => flushPendingSessionCache(), 'nothing pending once the run is done');
});

const boundaryLine = (n) => JSON.stringify({
  type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', sessionId: 'sess-1',
  timestamp: new Date(T0 + n * 1000).toISOString(), compactMetadata: { trigger: 'auto', preTokens: 900000, postTokens: 50000 },
}) + '\n';

test('the compaction count carries across a resumed read', async () => {
  const f = newFile();
  writeFileSync(f, batch(1, 10) + boundaryLine(11) + batch(12, 20) + boundaryLine(21) + batch(22, 30));
  resetParseStats();
  assert.equal((await withStore(f)).compactions, 2);
  assert.equal(parseStats().resumed, 0);
  assert.equal(JSON.parse(readFileSync(store.storePathFor(f), 'utf8')).compactions, 2, 'the store keeps the count');

  appendFileSync(f, boundaryLine(31) + batch(32, 35));
  resetParseStats();
  const got = await withStore(f);
  assert.equal(parseStats().resumed, 1, 'the second read resumed from the store');
  assert.equal(got.compactions, 3);
  assert.deepStrictEqual(got, await full(f));
});

test('a store from before the count (v1) is ignored, so the count is not short', async () => {
  const f = newFile();
  writeFileSync(f, batch(1, 10) + boundaryLine(11) + batch(12, 20) + boundaryLine(21) + batch(22, 30));
  await withStore(f);
  // What a v1 store looked like: same fields, no count.
  const { compactions, ...v1 } = JSON.parse(readFileSync(store.storePathFor(f), 'utf8'));
  assert.equal(compactions, 2);
  writeFileSync(store.storePathFor(f), JSON.stringify({ ...v1, v: 1 }));
  appendFileSync(f, boundaryLine(31) + batch(32, 35));
  resetParseStats();
  const got = await withStore(f);
  assert.equal(parseStats().resumed, 0, 'the v1 store is not resumed from');
  assert.equal(got.compactions, 3);
  assert.equal(JSON.parse(readFileSync(store.storePathFor(f), 'utf8')).v, store.STORE_VERSION, 'and is replaced');
});

test('the compaction count survives the session cache and the window trim', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-compact-'));
  const p = join(dir, 's.jsonl');
  // Two days old at the start, so a one-day window trims the session; the
  // count is a whole-session figure and is not trimmed with it.
  const old = (n) => entry(n).replace(/"timestamp":"[^"]+"/, `"timestamp":"${new Date(T0 - 2 * 86400_000 + n * 1000).toISOString()}"`);
  writeFileSync(p, old(1) + boundaryLine(2) + entry(3) + boundaryLine(4) + entry(5));
  const st = statSync(p);
  const files = [{ path: p, projectDir: 'proj', mtime: st.mtimeMs, size: st.size }];
  const cachePath = join(dir, 'cache.json');
  const first = await parseAllSessions({ files, cachePath, days: 1 });
  assert.equal(first[0].requestCount, 2, 'the old request is trimmed');
  assert.equal(first[0].compactions, 2);
  const cached = await parseAllSessions({ files, cachePath, days: 3650 });
  assert.equal(cached[0].requestCount, 3);
  assert.equal(cached[0].compactions, 2, 'read back from the cache');
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf8')).entries[p].s.compactions, 2);
});
