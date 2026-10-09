/**
 * The SessionStart hook asks the registry on a shorter interval than the
 * statusline. update-check-interval.test.js pins the module's behaviour for a
 * given `intervalMs`; this drives the real `route-scan --hook` so a call site
 * that stops passing the interval (and silently falls back to 24h) fails here.
 *
 * The observable is the stamp: maybeSpawnUpdateCheck writes `checkedAt` before
 * it spawns, and writes nothing when the cache is still fresh. A 4h-old answer
 * is fresh under the statusline's 24h and stale under SessionStart's 3h, so the
 * stamp moving says which interval the hook used. The stale case does start the
 * detached refresh child, as test/update-check.test.js already does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.js');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const HOUR = 60 * 60 * 1000;

function sandbox(updateState) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-update-hook-'));
  const cfgDir = join(dir, 'claude-token-saver');
  const home = join(dir, 'home');
  mkdirSync(cfgDir, { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  // A fresh scan cache, so the hook reads it instead of spawning a rescan.
  writeFileSync(join(cfgDir, 'route-scan.json'), JSON.stringify({
    scannedAt: new Date().toISOString(),
    days: 14,
    totalEpisodes: 0,
    easyEpisodes: 0,
    candidates: [],
    resolved: [],
    scannedBytes: Number.MAX_SAFE_INTEGER,
  }));
  const statePath = join(cfgDir, 'update-check.json');
  writeFileSync(statePath, JSON.stringify(updateState));
  return {
    dir,
    home,
    readState: () => JSON.parse(readFileSync(statePath, 'utf8')),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function runHook(box) {
  return execFileSync(process.execPath, [CLI, 'route-scan', '--hook'], {
    env: childEnv({ HOME: box.home, XDG_CONFIG_HOME: box.dir, NO_COLOR: '1' }),
    input: JSON.stringify({ session_id: 'test-session' }),
    encoding: 'utf8',
  });
}

test('SessionStart re-checks an answer older than 3h, which the statusline would still trust', () => {
  const checkedAt = Date.now() - 4 * HOUR;
  const box = sandbox({ checkedAt, latest: VERSION, current: VERSION });
  try {
    runHook(box);
    const after = Number(box.readState().checkedAt);
    assert.ok(after > checkedAt + 3 * HOUR, 'the hook stamped a new attempt, so it judged 4h stale');
  } finally {
    box.cleanup();
  }
});

test('SessionStart leaves an answer younger than 3h alone', () => {
  const checkedAt = Date.now() - 1 * HOUR;
  const box = sandbox({ checkedAt, latest: VERSION, current: VERSION });
  try {
    runHook(box);
    assert.equal(Number(box.readState().checkedAt), checkedAt, 'no stamp, no spawn');
  } finally {
    box.cleanup();
  }
});
