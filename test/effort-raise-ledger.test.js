/**
 * effort-raise-ledger: the runs the delegation guard raised to high effort,
 * kept as events and read live with the routing reset mark.
 *
 * HOME and XDG_CONFIG_HOME point into a temp directory before any module that
 * resolves a path is loaded, so the real user data is never read or written.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv } from './helpers/child-env.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-effort-raise-'));
const HOME = join(SANDBOX, 'home');
const CFG = join(SANDBOX, 'cfg');
mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = CFG;
{
  const clean = childEnv({ HOME, USERPROFILE: HOME, XDG_CONFIG_HOME: CFG });
  for (const key of Object.keys(process.env)) if (!(key in clean)) delete process.env[key];
}
process.once('exit', () => rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const DIR = join(CFG, 'claude-token-saver');
mkdirSync(DIR, { recursive: true });

const {
  EFFORT_RAISE_LEDGER_VERSION, effortRaiseLedgerPath, loadEffortRaiseLedger, recordEffortRaises, effortRaiseTotals,
} = await import('../src/effort-raise-ledger.js');
const { resetSaved, resetPath } = await import('../src/saved-reset.cjs');

const FILE = effortRaiseLedgerPath(DIR);
const DELEGATION_FILE = join(DIR, 'delegation-ledger.json');
const T = Date.now();

beforeEach(() => {
  for (const f of [FILE, DELEGATION_FILE, resetPath(DIR), `${FILE}.corrupt`]) rmSync(f, { force: true });
});

const runA = '/home/u/.claude/projects/-proj/sess1/subagents/agent-1.jsonl';
const runB = '/home/u/.claude/projects/-proj/sess2/subagents/agent-2.jsonl';

test('the ledger lives in the user data dir and is versioned', () => {
  assert.equal(FILE, join(DIR, 'effort-raise-ledger.json'));
  recordEffortRaises([{ key: runA, ts: T, cost: 0.123456, model: 'claude-sonnet-4-5' }], DIR);
  const data = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.equal(data.version, EFFORT_RAISE_LEDGER_VERSION);
  assert.deepEqual(data.events[runA], { ts: T, cost: 0.1235, model: 'claude-sonnet-4-5' });
});

test('record then upsert: the same run under a renamed project path stays one event', () => {
  const oldKey = '/a/-proj-old/sess/subagents/agent-1.jsonl';
  const newKey = '/b/-proj-new/sess/subagents/agent-1.jsonl';
  recordEffortRaises([{ key: oldKey, ts: T, cost: 1 }], DIR);
  recordEffortRaises([{ key: newKey, ts: T, cost: 1 }], DIR);
  assert.deepEqual(Object.keys(loadEffortRaiseLedger(DIR).events), [newKey]);
  assert.equal(effortRaiseTotals(Date.now(), DIR).count, 1);
});

test('entries without a key or with a non-finite ts are skipped and nothing is written', () => {
  recordEffortRaises([
    { ts: T, cost: 1 },
    { key: runA, ts: NaN },
    { key: runB, ts: null },
    { key: runB },
    null,
  ], DIR);
  assert.equal(existsSync(FILE), false);
  recordEffortRaises([], DIR);
  assert.equal(existsSync(FILE), false);
  // an unchanged event does not rewrite the file either
  recordEffortRaises([{ key: runA, ts: T, cost: 1, model: 'm' }], DIR);
  const before = readFileSync(FILE, 'utf8');
  writeFileSync(FILE, before + ' ');
  recordEffortRaises([{ key: runA, ts: T, cost: 1, model: 'm' }], DIR);
  assert.equal(readFileSync(FILE, 'utf8'), before + ' ');
});

test('totals join the delegation ledger by run identity', () => {
  recordEffortRaises([
    { key: runA, ts: T, cost: 0.5 },
    { key: runB, ts: T + 1000 },
  ], DIR);
  // The delegation ledger holds the same run under another copy's path.
  const copyOfA = '/elsewhere/-proj-copy/sess1/subagents/agent-1.jsonl';
  writeFileSync(DELEGATION_FILE, JSON.stringify({
    version: 3,
    events: { [copyOfA]: { ts: T, usd: 4.5, cost: 1 } },
  }));
  const totals = effortRaiseTotals(Date.now(), DIR);
  assert.deepEqual(totals, { count: 2, cost: 0.5, costMissing: 1, kept: 4.5, keptRuns: 1, since: null });
});

test('the routing reset mark excludes older events and keeps one at the mark', () => {
  recordEffortRaises([
    { key: runA, ts: T - 5000, cost: 1 },
    { key: runB, ts: T, cost: 2 },
  ], DIR);
  assert.equal(effortRaiseTotals(Date.now(), DIR).count, 2);
  resetSaved(['routing'], { dir: DIR, now: T });
  const totals = effortRaiseTotals(Date.now(), DIR);
  assert.equal(totals.count, 1);
  assert.equal(totals.cost, 2);
  assert.equal(totals.since, T);
});

test('a corrupt or missing file yields zeros without throwing', () => {
  const zero = { count: 0, cost: 0, costMissing: 0, kept: 0, keptRuns: 0, since: null };
  assert.deepEqual(effortRaiseTotals(Date.now(), DIR), zero);
  writeFileSync(FILE, 'not json');
  assert.deepEqual(effortRaiseTotals(Date.now(), DIR), zero);
  assert.deepEqual(loadEffortRaiseLedger(DIR), { version: EFFORT_RAISE_LEDGER_VERSION, events: {} });
  writeFileSync(FILE, JSON.stringify({ version: 99, events: { [runA]: { ts: T } } }));
  assert.equal(effortRaiseTotals(Date.now(), DIR).count, 0, 'a wrong version reads as empty');
});
