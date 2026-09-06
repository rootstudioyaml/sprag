import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
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

/**
 * `uninstall` shipped as a name in the subcommand list with nothing behind it:
 * it fell through to the usage report and exited non-zero. Removal has to work
 * as reliably as installation, and it has to leave other people's settings
 * exactly where it found them.
 */
test('uninstall removes our entries and only ours', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-uninstall-'));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const settings = join(home, '.claude', 'settings.json');
  const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'their-hook' }] };
  writeFileSync(settings, JSON.stringify({
    statusLine: { type: 'command', command: 'their-statusline' },
    hooks: {
      PreToolUse: [foreign, { matcher: 'Read', hooks: [{ type: 'command', command: 'claude-token-saver doc2md --hook' }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: 'claude-token-saver route-scan --hook' }] }],
    },
  }, null, 2));

  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(dir, 'state'), APPDATA: join(dir, 'state') };
  const out = execFileSync(process.execPath, [CLI, 'uninstall'], { encoding: 'utf8', env, timeout: 120_000 });
  assert.match(out, /removed|제거/i);

  const after = JSON.parse(readFileSync(settings, 'utf8'));
  // Ours is gone, theirs is untouched — including a statusline we did not write.
  assert.deepEqual(after.hooks.PreToolUse, [foreign]);
  assert.equal(after.hooks.SessionStart, undefined);
  assert.deepEqual(after.statusLine, { type: 'command', command: 'their-statusline' });

  // Recorded savings survive a plain uninstall; only --purge takes them.
  assert.match(out, /--purge/);

  rmSync(dir, { recursive: true, force: true });
});
