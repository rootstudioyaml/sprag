/**
 * Statusline overlap guard: lock, last-render cache, budget, and the CLI wiring.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  acquireStatuslineLock, readLastRender, writeLastRender, statuslineBudgetMs,
} from '../src/statusline-guard.js';
import { childEnv } from './helpers/child-env.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-guard-'));
after(() => rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
let n = 0;
const fresh = () => { const d = join(SANDBOX, `d${n++}`); mkdirSync(d, { recursive: true }); return d; };
const lockPath = (dir, key = 'k') => join(dir, 'statusline-locks', `${key}.lock`);
const opts = (dir, extra) => ({ dir, key: 'k', now: 1_000_000, registerExit: false, ...extra });

test('second acquire fails while the holder is alive', () => {
  const dir = fresh();
  const a = acquireStatuslineLock(opts(dir, { pid: 111, isAlive: () => true }));
  assert.equal(a.acquired, true);
  assert.equal(JSON.parse(readFileSync(lockPath(dir), 'utf8')).pid, 111);
  const b = acquireStatuslineLock(opts(dir, { pid: 222, isAlive: () => true }));
  assert.equal(b.acquired, false);
  assert.equal(b.holder.pid, 111);
});

test('a dead holder is replaced', () => {
  const dir = fresh();
  acquireStatuslineLock(opts(dir, { pid: 111, isAlive: () => true }));
  const b = acquireStatuslineLock(opts(dir, { pid: 222, isAlive: () => false }));
  assert.equal(b.acquired, true);
  assert.equal(JSON.parse(readFileSync(lockPath(dir), 'utf8')).pid, 222);
});

test('a holder older than staleMs is replaced even if alive', () => {
  const dir = fresh();
  acquireStatuslineLock(opts(dir, { pid: 111, isAlive: () => true }));
  const b = acquireStatuslineLock(opts(dir, { pid: 222, isAlive: () => true, now: 1_000_000 + 30_001 }));
  assert.equal(b.acquired, true);
  assert.equal(JSON.parse(readFileSync(lockPath(dir), 'utf8')).pid, 222);
});

test('release removes own lock only and is idempotent', () => {
  const dir = fresh();
  const a = acquireStatuslineLock(opts(dir, { pid: 111, isAlive: () => true }));
  // Another pid takes over (stale), then the original release must not delete it.
  const b = acquireStatuslineLock(opts(dir, { pid: 222, isAlive: () => false }));
  a.release();
  assert.ok(existsSync(lockPath(dir)));
  b.release();
  assert.ok(!existsSync(lockPath(dir)));
  assert.doesNotThrow(() => { b.release(); b.release(); });
});

test('a broken lock file is stale', () => {
  const dir = fresh();
  mkdirSync(join(dir, 'statusline-locks'), { recursive: true });
  writeFileSync(lockPath(dir), 'not json');
  const a = acquireStatuslineLock(opts(dir, { pid: 333, isAlive: () => true }));
  assert.equal(a.acquired, true);
  assert.equal(JSON.parse(readFileSync(lockPath(dir), 'utf8')).pid, 333);
});

test('last render round-trips per key and expired entries drop on write', () => {
  const dir = fresh();
  writeLastRender({ dir, key: 'a', text: 'AAA', now: 1000 });
  writeLastRender({ dir, key: 'b', text: 'BBB', now: 2000 });
  assert.equal(readLastRender({ dir, key: 'a' }), 'AAA');
  assert.equal(readLastRender({ dir, key: 'b' }), 'BBB');
  assert.equal(readLastRender({ dir, key: 'zzz' }), null);
  writeLastRender({ dir, key: 'c', text: 'CCC', now: 1000 + 24 * 3600 * 1000 + 1 });
  assert.equal(readLastRender({ dir, key: 'a' }), null);
  assert.equal(readLastRender({ dir, key: 'c' }), 'CCC');
});

test('statuslineBudgetMs parses the env override', () => {
  assert.equal(statuslineBudgetMs({}), 4000);
  assert.equal(statuslineBudgetMs({ CTS_STATUSLINE_BUDGET_MS: '0' }), 0);
  assert.equal(statuslineBudgetMs({ SPRAG_STATUSLINE_BUDGET_MS: '2500' }), 2500);
  assert.equal(statuslineBudgetMs({ SPRAG_STATUSLINE_BUDGET_MS: '1500', CTS_STATUSLINE_BUDGET_MS: '9' }), 1500);
  assert.equal(statuslineBudgetMs({ CTS_STATUSLINE_BUDGET_MS: 'abc' }), 4000);
});

// ---- CLI integration ----
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const INPUT = JSON.stringify({ session_id: 'sess-a', transcript_path: '/nonexistent/x.jsonl' });

function runCli(extraEnv, setup) {
  const root = fresh();
  const dataDir = join(root, 'cfg', 'claude-token-saver');
  const home = join(root, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(dataDir, 'statusline-locks'), { recursive: true });
  setup(dataDir);
  const r = spawnSync(process.execPath, [CLI, '--statusline', '--no-color'], {
    input: INPUT,
    encoding: 'utf8',
    timeout: 60_000,
    env: childEnv({ HOME: home, XDG_CONFIG_HOME: join(root, 'cfg'), ...extraEnv }),
  });
  return { r, dataDir };
}
const cache = (dataDir) => writeFileSync(
  join(dataDir, 'statusline-last.json'),
  JSON.stringify({ 'sess-a': { text: 'CACHED LINE', at: Date.now() } }),
);
const lock = (dataDir, pid) => writeFileSync(
  join(dataDir, 'statusline-locks', 'sess-a.lock'),
  JSON.stringify({ pid, startedAt: Date.now() }),
);

test('CLI: a live lock makes the run print the cached line and exit 0', () => {
  const { r } = runCli({}, (d) => { lock(d, process.pid); cache(d); });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'CACHED LINE\n');
});

test('CLI: a dead holder is ignored, the line renders and the lock is gone', () => {
  const { r, dataDir } = runCli({}, (d) => { lock(d, 999999); cache(d); });
  assert.equal(r.status, 0);
  assert.notEqual(r.stdout.trim(), '');
  assert.notEqual(r.stdout.trim(), 'CACHED LINE');
  assert.ok(!existsSync(join(dataDir, 'statusline-locks', 'sess-a.lock')));
});

test('CLI: an exhausted budget prints the cached line and exits 0', () => {
  const { r } = runCli({ SPRAG_STATUSLINE_BUDGET_MS: '1' }, (d) => cache(d));
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('CACHED LINE'), r.stdout);
});
