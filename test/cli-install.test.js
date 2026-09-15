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
      // CTS_LANG pins the output language: the install now picks one from the
      // machine's locale when nothing is recorded, and the assertions below read
      // English strings.
      env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(dir, 'cfg'), NO_COLOR: '1', CTS_LANG: 'en' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(out, /route-scan: analyzing usage patterns/, 'the first-run seeding branch must execute');
    assert.match(out, /delegation candidate/);
    assert.ok(existsSync(join(home, '.claude', 'settings.json')), 'hooks + statusline are configured');
    // Everything that costs nothing until it is needed is on after a plain
    // install — doc2md used to wait for the user to discover `doc2md on`.
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    const commands = JSON.stringify(settings.hooks);
    assert.match(commands, /doc2md --hook(?!-)/, 'the doc2md Read hook is registered by install');
    assert.match(commands, /doc2md --hook-prompt/, 'the doc2md prompt hook is registered by install');
    // Both route-scan hooks, distinguished: `--hook-delegated` contains `--hook`
    // as a prefix, so a bare substring test would pass with either one missing.
    assert.match(commands, /route-scan --hook(?![\w-])/, 'the SessionStart hook is registered');
    assert.match(commands, /route-scan --hook-delegated/, 'the delegation rescan hook is registered');
    assert.match(commands, /brief --hook/);
    // The delegation hook must fire on the delegation tools and nothing else: a
    // wider matcher would rescan after every Read.
    const post = (settings.hooks.PostToolUse || []).find((m) =>
      (m.hooks || []).some((h) => (h.command || '').includes('route-scan --hook-delegated')));
    assert.ok(post, 'the delegation hook lives under PostToolUse');
    assert.equal(post.matcher, 'Task|Agent');
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

/**
 * Language used to fall back to English with no question asked, so a Korean user
 * read English reports until they happened to find `mode lang=ko`. The install
 * records a choice: the locale decides it unattended, a prompt decides it at a
 * terminal, and either way it is never asked twice.
 */
test('install records an output language from the locale and keeps it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-lang-'));
  const home = join(dir, 'home');
  const cfgHome = join(dir, 'cfg');
  mkdirSync(home, { recursive: true });
  const base = {
    ...process.env, HOME: home, USERPROFILE: home,
    XDG_CONFIG_HOME: cfgHome, APPDATA: cfgHome, NO_COLOR: '1',
  };
  delete base.CTS_LANG;
  const cfgPath = join(cfgHome, 'claude-token-saver', 'config.json');
  try {
    const ko = execFileSync(process.execPath, [CLI, 'install'], {
      env: { ...base, LANG: 'ko_KR.UTF-8' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(ko, /language: set to 한국어/);
    assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).language, 'ko');

    // A second install must not re-decide: the recorded answer wins over a
    // locale that now says something else.
    const again = execFileSync(process.execPath, [CLI, 'install'], {
      env: { ...base, LANG: 'en_US.UTF-8' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.doesNotMatch(again, /language: set to/);
    assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).language, 'ko');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an explicitly non-Korean locale variable wins over the macOS system locale', async () => {
  const { koreanLocaleDetected } = await import('../src/korean-style.js');
  // The `defaults` fallback exists for GUI shells where LANG is unset; a LANG
  // that IS set and is not Korean is an answer, not a missing signal.
  assert.equal(koreanLocaleDetected({ env: { LANG: 'en_US.UTF-8' }, platform: 'darwin' }), false);
  assert.equal(koreanLocaleDetected({ env: { LANG: 'ko_KR.UTF-8' }, platform: 'darwin' }), true);
  assert.equal(koreanLocaleDetected({ env: { LANGUAGE: 'ko:en' }, platform: 'linux' }), true);
  assert.equal(koreanLocaleDetected({ env: { LANG: 'C' }, platform: 'linux' }), false);
});
