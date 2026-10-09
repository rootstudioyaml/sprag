/**
 * `sprag compact-window` runs outside a session, so it has no statusline
 * payload. Judged by the settings model id alone, a bare `opus` (1M by default
 * on Opus 5.5, no `[1m]` suffix) read as a 200k session and the command said
 * the setting changed nothing, while the statusline reported 1M. The command
 * now takes the window the statusline last reported.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-cw-live-'));
const HOME = join(SANDBOX, 'home');
const CFG = join(SANDBOX, 'cfg');
mkdirSync(join(HOME, '.claude'), { recursive: true });
mkdirSync(join(CFG, 'claude-token-saver'), { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = CFG;
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const { recordLiveWindow, latestLiveWindow } = await import('../src/ctx-window-cache.js');

function status() {
  return spawnSync(process.execPath, [CLI, 'compact-window'], {
    cwd: SANDBOX,
    env: childEnv({ HOME, USERPROFILE: HOME, XDG_CONFIG_HOME: CFG, CTS_LANG: 'en' }),
    encoding: 'utf8',
  }).stdout;
}

test('latestLiveWindow returns the most recently reported size', () => {
  assert.equal(latestLiveWindow(), null);
  recordLiveWindow('older', 200_000, 1_000);
  recordLiveWindow('newer', 1_000_000, 2_000);
  assert.equal(latestLiveWindow(), 1_000_000);
});

test('a bare opus model counts as 1M once the statusline has reported 1M', () => {
  writeFileSync(join(HOME, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', autoCompactWindow: 700000 }));
  recordLiveWindow('live', 1_000_000);
  const out = status();
  assert.match(out, /window: 1M context \[statusline: 1M\]/);
  assert.doesNotMatch(out, /200k context/);
});
