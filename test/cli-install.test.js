import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

/**
 * `install` runs from postinstall on a machine that has never run the tool, so
 * its first-run branch (seed the route-scan cache, report what was found) only
 * executes when no cache exists yet — exactly the path a smoke test against a
 * warm developer machine skips.
 */
test('install completes on a machine with no prior state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-install-'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  try {
    const out = execFileSync(process.execPath, [CLI, 'install'], {
      env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(dir, 'cfg'), NO_COLOR: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(out, /route-scan: analyzing usage patterns/, 'the first-run seeding branch must execute');
    assert.match(out, /delegation candidate/);
    assert.ok(existsSync(join(home, '.claude', 'settings.json')), 'hooks + statusline are configured');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
