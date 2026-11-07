import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// parser.js, session-cache.js and usage-ledger.js resolve their directories
// from the environment, so the sandbox goes in before the imports below.
const home = mkdtempSync(join(tmpdir(), 'cts-dated-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
delete process.env.ANTHROPIC_BASE_URL;

const { parseSessionFile } = await import('../src/parser.js');
const { pricedParts, partCost, sessionCostAcross } = await import('../src/claude-price.js');
const { monthSpend } = await import('../src/month-spend.js');
const { recordUsage, usageSince } = await import('../src/usage-ledger.js');
const { userDataDir } = await import('../src/paths.js');
const cache = await import('../src/session-cache.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const SONNET = 'claude-sonnet-5-5';
const OPUS = 'claude-opus-5-5';
const B = 1e9;
const LEDGER = () => join(userDataDir(), 'usage-ledger.json');

// Sonnet 5.5 cache reads cost $0.20/M before 2026-10-07 and $0.10/M from then on.
let n = 0;
function line(sessionId, iso, model, usage) {
  n++;
  return JSON.stringify({
    requestId: `r${n}`, timestamp: iso, sessionId,
    message: { id: `m${n}`, model, usage },
  });
}
const reads = (tokens) => ({ input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 });

async function transcript(name, sessionId, rows) {
  const file = join(home, `${name}.jsonl`);
  writeFileSync(file, rows.map(([iso, model, tokens]) => line(sessionId, iso, model, reads(tokens))).join('\n') + '\n');
  return parseSessionFile(file);
}

test('a session across a price change is priced day by day', async () => {
  const s = await transcript('two-day', 'two-day', [
    ['2026-10-06T10:00:00Z', SONNET, B],
    ['2026-10-08T10:00:00Z', SONNET, B],
  ]);
  assert.deepEqual(Object.keys(s.dayTotals), ['2026-10-06', '2026-10-08']);
  assert.equal(s.dayTotals['2026-10-06'][SONNET].cacheRead, B);
  const [part] = pricedParts(s);
  assert.deepEqual(Object.keys(part.byDay), ['2026-10-06', '2026-10-08']);
  const c = partCost(part);
  assert.equal(c.actual, (B / 1e6) * 0.20 + (B / 1e6) * 0.10);
  assert.equal(sessionCostAcross([s]).actual, c.actual);
});

test('a single-day session has no dayTotals and is priced at its start time', async () => {
  const s = await transcript('one-day', 'one-day', [
    ['2026-10-06T01:00:00Z', SONNET, B],
    ['2026-10-06T23:00:00Z', SONNET, B],
  ]);
  assert.equal(s.dayTotals, undefined);
  const [part] = pricedParts(s);
  assert.equal(part.byDay, undefined);
  assert.equal(partCost(part).actual, (2 * B / 1e6) * 0.20);
});

test('session cache keeps dayTotals and is on version 6', async () => {
  const s = await transcript('cache-rt', 'cache-rt', [
    ['2026-10-06T10:00:00Z', SONNET, 1000],
    ['2026-10-08T10:00:00Z', SONNET, 2000],
  ]);
  const c = { entries: {} };
  const file = { path: s.filePath, projectDir: 'p', mtime: Date.now() - 1000, size: 10 };
  cache.putCached(c, file, s);
  cache.saveCache(c);
  const back = cache.getCached(cache.loadCache(), file);
  assert.deepEqual(back.dayTotals, s.dayTotals);
  assert.equal(JSON.parse(readFileSync(cache.sessionCachePath(), 'utf8')).version, 6);
});

test('monthSpend counts a ledger-only session and never counts it twice', async () => {
  const s = await transcript('ledger', 'ledger-1', [
    ['2026-10-06T10:00:00Z', SONNET, B],
    ['2026-10-08T10:00:00Z', SONNET, B],
  ]);
  const now = new Date('2026-10-20T12:00:00Z');
  assert.equal(recordUsage([s], { now: now.getTime() }), true);
  assert.equal(JSON.parse(readFileSync(LEDGER(), 'utf8')).sessions['ledger-1'].days['2026-10-06'][SONNET].cacheRead, B);

  const expected = (B / 1e6) * 0.20 + (B / 1e6) * 0.10;
  const only = monthSpend([], now);
  assert.equal(only.usd, expected);
  assert.equal(only.sessions, 1);
  const both = monthSpend([s], now);
  assert.equal(both.usd, expected);
  assert.equal(both.sessions, 1);
  assert.equal(monthSpend([], now, { ledger: false }).usd, 0);
  // Days before the month are not counted.
  assert.equal(usageSince(Date.parse('2026-10-07T00:00:00Z')).length, 1);
  assert.equal(monthSpend([], new Date('2026-11-20T12:00:00Z')).usd, 0);
});

test('recordUsage is idempotent, throttled, and prunes old entries', async () => {
  const s = await transcript('idem', 'idem-1', [
    ['2026-10-06T10:00:00Z', SONNET, 1000],
    ['2026-10-08T10:00:00Z', SONNET, 2000],
  ]);
  rmSync(LEDGER(), { force: true });
  const t0 = Date.parse('2026-10-20T12:00:00Z');
  const strip = () => { const d = JSON.parse(readFileSync(LEDGER(), 'utf8')); delete d.writtenAt; return d; };
  recordUsage([s], { now: t0 });
  const first = strip();
  assert.equal(recordUsage([s], { now: t0 + 30 * 60 * 1000 }), false, 'throttled inside the hour');
  assert.equal(recordUsage([s], { now: t0 + 2 * 3600 * 1000 }), true);
  assert.deepEqual(strip(), first);

  const ago = (days) => {
    const t = new Date(t0 - days * 86400000);
    return { startTime: t, endTime: t, totals: { input: 1, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 1 }, model: SONNET };
  };
  // A 401-day-old entry is pruned on the write that would add it.
  recordUsage([{ sessionId: 'old-401', ...ago(401) }, { sessionId: 'old-399', ...ago(399) }], { now: t0 + 4 * 3600 * 1000 });
  let sessions = JSON.parse(readFileSync(LEDGER(), 'utf8')).sessions;
  assert.equal(sessions['old-401'], undefined, 'pruned');
  assert.ok(sessions['old-399'], 'kept while inside 400 days');
  // ...and the 399-day-old one ages out three days later.
  recordUsage([], { now: t0 + 3 * 86400000 });
  sessions = JSON.parse(readFileSync(LEDGER(), 'utf8')).sessions;
  assert.equal(sessions['old-399'], undefined, 'aged out');
  assert.ok(sessions['idem-1']);
});

test('a mixed-model multi-day session prices each model\'s days separately', async () => {
  const s = await transcript('mixed', 'mixed-1', [
    ['2026-10-06T10:00:00Z', SONNET, B],
    ['2026-10-06T11:00:00Z', OPUS, B],
    ['2026-10-08T10:00:00Z', SONNET, B],
    ['2026-10-08T11:00:00Z', OPUS, B],
  ]);
  const parts = pricedParts(s);
  assert.equal(parts.length, 2);
  const sonnet = parts.find((p) => p.model === SONNET);
  const opus = parts.find((p) => p.model === OPUS);
  assert.deepEqual(Object.keys(sonnet.byDay), ['2026-10-06', '2026-10-08']);
  assert.equal(sonnet.byDay['2026-10-06'].cacheRead, B);
  assert.equal(partCost(sonnet).actual, 1000 * 0.20 + 1000 * 0.10);
  // Opus 5.5 reads at $0.20/M on both days (single row), so two days = $400.
  assert.equal(partCost(opus).actual, 2000 * 0.20);
});
