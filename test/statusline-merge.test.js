/**
 * Statusline merge: installing next to someone else's statusLine keeps theirs
 * as `statuslineBase`, runs it underneath ours, and uninstall gives it back.
 * HOME points into a temp directory before any path is resolved.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-statusline-merge-'));
const HOME = join(SANDBOX, 'home');
mkdirSync(join(HOME, '.claude'), { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = join(SANDBOX, 'cfg');
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

const { installStatusline, uninstallAll, isOurCommand } = await import('../src/installer.js');
const { loadConfig, saveConfig } = await import('../src/config.js');
const { withBaseStatusline } = await import('../src/statusline-base.js');

const SETTINGS = join(HOME, '.claude', 'settings.json');
const settings = () => JSON.parse(readFileSync(SETTINGS, 'utf8'));
const ORIGINAL = { type: 'command', command: 'bash ~/x.sh', padding: 0 };

test('sandbox: paths resolve inside the temp directory', () => {
  assert.ok(SETTINGS.startsWith(SANDBOX));
});

test('merge saves the original statusLine, writes ours, and uninstall restores it', () => {
  writeFileSync(SETTINGS, JSON.stringify({ statusLine: ORIGINAL }));
  const r = installStatusline({ merge: true });
  assert.equal(r.action, 'updated');
  assert.equal(r.merged, true);
  assert.ok(isOurCommand(settings().statusLine.command));
  assert.deepEqual(loadConfig().statuslineBase, ORIGINAL);

  const u = uninstallAll();
  assert.ok(u.removed.some((x) => x.startsWith('statusLine')));
  assert.deepEqual(settings().statusLine, ORIGINAL);
  assert.equal(loadConfig().statuslineBase, undefined);
});

test('replace (force) drops any saved base', () => {
  writeFileSync(SETTINGS, JSON.stringify({ statusLine: ORIGINAL }));
  installStatusline({ merge: true });
  // Someone else takes the slot again, then the user picks replace.
  writeFileSync(SETTINGS, JSON.stringify({ statusLine: ORIGINAL }));
  installStatusline({ force: true });
  assert.equal(loadConfig().statuslineBase, undefined);
  assert.ok(isOurCommand(settings().statusLine.command));
});

test('without merge or force a foreign statusLine is left alone', () => {
  writeFileSync(SETTINGS, JSON.stringify({ statusLine: ORIGINAL }));
  const r = installStatusline();
  assert.equal(r.action, 'skipped');
  assert.deepEqual(settings().statusLine, ORIGINAL);
});

test('withBaseStatusline puts the base output first', () => {
  saveConfig({ statuslineBase: { type: 'command', command: "printf 'BASE'" } });
  assert.equal(withBaseStatusline('OURS'), 'BASE\nOURS');
});

test('withBaseStatusline falls back to our output on failure, empty output or no config', () => {
  saveConfig({ statuslineBase: { type: 'command', command: 'exit 3' } });
  assert.equal(withBaseStatusline('OURS'), 'OURS');
  saveConfig({ statuslineBase: { type: 'command', command: 'true' } });
  assert.equal(withBaseStatusline('OURS'), 'OURS');
  saveConfig({ statuslineBase: { type: 'command', command: 'sprag --statusline' } });
  assert.equal(withBaseStatusline('OURS'), 'OURS');
  saveConfig({});
  assert.equal(withBaseStatusline('OURS'), 'OURS');
});

test('a base that calls back into sprag does not start the base again', () => {
  // The child sees the marker, so a wrapper script around `sprag --statusline`
  // gets our lines once instead of spawning itself without end.
  saveConfig({ statuslineBase: { type: 'command', command: 'printf "$SPRAG_STATUSLINE_BASE"' } });
  assert.equal(withBaseStatusline('OURS'), '1\nOURS');
  process.env.SPRAG_STATUSLINE_BASE = '1';
  try {
    assert.equal(withBaseStatusline('OURS'), 'OURS');
  } finally {
    delete process.env.SPRAG_STATUSLINE_BASE;
  }
});
