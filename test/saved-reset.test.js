/**
 * Stopwatch reset for the saved counters: marks, totals that honour them,
 * undo, and the CLI. HOME and XDG_CONFIG_HOME point into a temp directory
 * before any path is resolved, so the real user data is never touched.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-saved-reset-'));
const HOME = join(SANDBOX, 'home');
const CFG = join(SANDBOX, 'cfg');
mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = CFG;
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

const DIR = join(CFG, 'claude-token-saver');
mkdirSync(DIR, { recursive: true });
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

const { readResetMarks, resetSaved, undoReset, isBeforeReset, resetPath } = await import('../src/saved-reset.cjs');
const { delegationSavedTotals } = await import('../src/savings-ledger.js');
const { doc2mdSavedTotals } = await import('../src/doc2md-ledger.cjs');
const { codexRoutingSavedTotals } = await import('../src/codex-ledger.js');

const DAY = 86400000;
// An hour in the past, so the CLI (which marks the real "now") sees every fixture event as older.
const NOW = Date.now() - 3600000;
const MARK = NOW - 2 * DAY;

function writeLedgers() {
  writeFileSync(join(DIR, 'delegation-ledger.json'), JSON.stringify({ version: 2, events: {
    'a/subagents/old1': { ts: NOW - 20 * DAY, usd: 5, from: 'claude-opus-5', to: 'claude-haiku-5' },
    'b/subagents/old2': { ts: NOW - 3 * DAY, usd: 2, from: 'claude-opus-5', to: 'claude-haiku-5' },
    'c/subagents/new1': { ts: NOW - DAY, usd: 1, from: 'claude-opus-5', to: 'claude-sonnet-5' },
    'd/subagents/new2': { ts: NOW - 1000, usd: 0.5, from: 'claude-opus-5', to: 'claude-sonnet-5' },
    'e/subagents/nots': { usd: 9, from: 'claude-opus-5', to: 'claude-haiku-5' },
  } }));
  writeFileSync(join(DIR, 'doc2md-ledger.json'), JSON.stringify({ version: 1, events: {
    'x.pdf': { ts: NOW - 10 * DAY, usd: 4, ext: '.pdf', tokens: 100, baseline: 200 },
    'y.pdf': { ts: NOW - DAY, usd: 1, ext: '.pdf', tokens: 10, baseline: 20 },
    'z.docx': { ts: NOW - 1000, usd: 0.25, ext: '.docx', tokens: 5, baseline: 9 },
    'q.docx': { usd: 7, ext: '.docx', tokens: 1, baseline: 2 },
  } }));
}

function clean() {
  rmSync(resetPath(DIR), { force: true });
}

test('totals before a reset include every event', () => {
  clean();
  writeLedgers();
  const r = delegationSavedTotals(NOW, DIR);
  assert.equal(r.total, 5 + 2 + 1 + 0.5 + 9);
  assert.equal(r.since, null);
  const d = doc2mdSavedTotals(DIR, NOW);
  assert.equal(d.docs, 4);
  assert.equal(d.since, null);
});

test('reset sets marks; only newer events count afterwards', () => {
  clean();
  writeLedgers();
  const marks = resetSaved(['routing', 'doc2md'], { dir: DIR, now: MARK });
  assert.equal(marks.routing, MARK);
  assert.equal(marks.doc2md, MARK);
  assert.equal(marks['codex-routing'], null);

  const r = delegationSavedTotals(NOW, DIR);
  assert.equal(r.since, MARK);
  assert.equal(r.total, 1.5);
  assert.equal(r.week, 1.5);
  assert.equal(r.month, 1.5);
  assert.deepEqual(r.pairs.map((p) => [p.from, p.to, p.runs, p.usd]), [['opus', 'sonnet', 2, 1.5]]);

  const d = doc2mdSavedTotals(DIR, NOW);
  assert.equal(d.since, MARK);
  assert.equal(d.docs, 2);
  assert.equal(d.total, 1.25);
  assert.equal(d.tokens, 15);
  assert.deepEqual(d.byExt.map((e) => [e.ext, e.docs, e.usd]), [['pdf', 1, 1], ['docx', 1, 0.25]]);
});

test('events without a timestamp are excluded once a mark exists', () => {
  clean();
  writeLedgers();
  assert.equal(isBeforeReset(undefined, MARK), true);
  assert.equal(isBeforeReset(NaN, MARK), true);
  assert.equal(isBeforeReset(MARK, MARK), false);
  assert.equal(isBeforeReset(MARK - 1, MARK), true);
  assert.equal(isBeforeReset(undefined, null), false);
  resetSaved(['routing', 'doc2md'], { dir: DIR, now: 1 });
  // The mark is ancient, yet the ts-less events (9 and 7 USD) still drop out.
  assert.equal(delegationSavedTotals(NOW, DIR).total, 5 + 2 + 1 + 0.5);
  assert.equal(doc2mdSavedTotals(DIR, NOW).total, 4 + 1 + 0.25);
});

test('undo restores previous marks, including a second reset back to the first', () => {
  clean();
  resetSaved(['routing'], { dir: DIR, now: 1000 });
  resetSaved(['routing', 'doc2md'], { dir: DIR, now: 2000 });
  assert.equal(readResetMarks(DIR).routing, 2000);
  const u1 = undoReset({ dir: DIR });
  assert.deepEqual(u1.scopes, ['routing', 'doc2md']);
  assert.equal(readResetMarks(DIR).routing, 1000);
  assert.equal(readResetMarks(DIR).doc2md, null);
  undoReset({ dir: DIR });
  assert.equal(readResetMarks(DIR).routing, null);
  assert.equal(undoReset({ dir: DIR }), null);
});

test('undo with no history returns null', () => {
  clean();
  assert.equal(undoReset({ dir: DIR }), null);
});

test('a corrupt saved-reset.json reads as no marks', () => {
  writeFileSync(resetPath(DIR), '{ not json');
  assert.deepEqual(readResetMarks(DIR), { routing: null, doc2md: null, 'codex-routing': null, 'codex-docs': null });
  writeFileSync(resetPath(DIR), JSON.stringify({ version: 1, marks: { routing: 'soon' } }));
  assert.equal(readResetMarks(DIR).routing, null);
  clean();
});

test('codex routing totals skip runs before the mark and count runs/priced after it', () => {
  clean();
  writeFileSync(join(DIR, 'codex-delegation-ledger.json'), JSON.stringify({ version: 1, events: {
    r1: { ts: NOW - 5 * DAY, usd: 3 },
    r2: { ts: NOW - DAY, usd: 1 },
    r3: { ts: NOW - 1000, usd: null },
  } }));
  const before = codexRoutingSavedTotals({ dir: DIR, now: NOW });
  assert.equal(before.runs, 3);
  resetSaved(['codex-routing'], { dir: DIR, now: MARK });
  const after = codexRoutingSavedTotals({ dir: DIR, now: NOW });
  assert.equal(after.since, MARK);
  assert.equal(after.runs, 2);
  assert.equal(after.priced, 1);
  assert.equal(after.total, 1);
  clean();
});

function cli(...argv) {
  return spawnSync(process.execPath, [CLI, ...argv], {
    env: childEnv({ HOME, USERPROFILE: HOME, XDG_CONFIG_HOME: CFG }),
    encoding: 'utf8',
  });
}

test('CLI: saved reset routing, then saved shows the reset; undo restores', () => {
  clean();
  writeLedgers();
  let out = cli('saved');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Routing saved: \$\d+\.\d\d \(not reset\)/);

  out = cli('saved', 'reset', 'routing');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Reset the Routing saved counter/);
  assert.match(out.stdout, /sprag saved undo/);

  out = cli('saved');
  assert.match(out.stdout, /Routing saved: \$0\.00 \(since /);
  assert.match(out.stdout, /Document conversion saved: \$12\.25 \(not reset\)/);
  assert.ok(readResetMarks(DIR).routing > 0);

  out = cli('saved', 'undo');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Restored the Routing saved counter/);
  assert.equal(readResetMarks(DIR).routing, null);

  out = cli('saved', 'undo');
  assert.match(out.stdout, /no reset to undo/);
  clean();
});

test('CLI: an invalid scope exits 1 and lists the valid ones', () => {
  const out = cli('saved', 'reset', 'bogus');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /Unknown scope: bogus/);
  assert.match(out.stderr, /routing, doc2md, all/);
  assert.equal(readResetMarks(DIR).routing, null);
});

test('CLI: --agent codex saved reset uses the codex scopes', () => {
  clean();
  const out = cli('saved', 'reset', '--agent', 'codex');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Codex routing saved/);
  const m = readResetMarks(DIR);
  assert.ok(m['codex-routing'] > 0 && m['codex-docs'] > 0 && m.routing === null);
  clean();
});
