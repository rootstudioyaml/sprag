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
delete process.env.ANTHROPIC_MODEL;
delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
after(() => rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const { recordLiveWindow, latestLiveWindow, liveModelFor, latestLiveModel } = await import('../src/ctx-window-cache.js');

function cli(...args) {
  return spawnSync(process.execPath, [CLI, 'compact-window', ...args], {
    cwd: SANDBOX,
    env: childEnv({ HOME, USERPROFILE: HOME, XDG_CONFIG_HOME: CFG, SPRAG_LANG: 'en' }),
    encoding: 'utf8',
  }).stdout;
}

const status = () => cli();

test('latestLiveWindow returns the most recently reported size', () => {
  assert.equal(latestLiveWindow(), null);
  recordLiveWindow('older', 200_000, 1_000);
  recordLiveWindow('newer', 1_000_000, 2_000);
  assert.equal(latestLiveWindow(), 1_000_000);
});

// Must run before any entry stamped with Date.now(): latestLiveModel follows
// the most recent timestamp.
test('the statusline model id is recorded, and a model change is rewritten', () => {
  recordLiveWindow('m', 1_000_000, 3_000, 'claude-opus-5-5[1m]');
  assert.equal(liveModelFor('m'), 'claude-opus-5-5[1m]');
  assert.equal(latestLiveModel(), 'claude-opus-5-5[1m]');
  assert.equal(recordLiveWindow('m', 1_000_000, 3_500, 'claude-sonnet-5-5'), true, 'same size, new model');
  assert.equal(liveModelFor('m'), 'claude-sonnet-5-5');
  assert.equal(liveModelFor('nobody'), null);
});

test('a bare opus model counts as 1M once the statusline has reported 1M', () => {
  writeFileSync(join(HOME, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', autoCompactWindow: 700000 }));
  recordLiveWindow('live', 1_000_000);
  const out = status();
  assert.match(out, /window: 1M context \[statusline: 1M\]/);
  assert.doesNotMatch(out, /200k context/);
});

/**
 * `compact-window off` used to silence only the statusline chip. The session
 * briefing read the audit directly and kept firing once per session.
 */
test('the briefing honors compact-window off', async () => {
  const { runBrief } = await import('../src/brief.js');
  writeFileSync(join(HOME, '.claude', 'settings.json'), JSON.stringify({ model: 'opus[1m]' }));
  cli('off');
  const off = await runBrief({ sessionId: 'brief-off', root: SANDBOX });
  assert.ok(off === null || !off.includes('autoCompactWindow'), off);
  cli('on');
  const on = await runBrief({ sessionId: 'brief-on', root: SANDBOX });
  assert.match(on || '', /autoCompactWindow가 현재 미설정입니다/);
});

test('a per-model "auto" is not briefed', async () => {
  const { runBrief } = await import('../src/brief.js');
  writeFileSync(join(HOME, '.claude', 'settings.json'), JSON.stringify({
    model: 'opus[1m]',
    modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 'auto' } },
  }));
  // The statusline reports the session's model id; the alias alone is not resolved.
  recordLiveWindow('brief-auto', 1_000_000, Date.now(), 'claude-opus-5-5[1m]');
  const out = await runBrief({ sessionId: 'brief-auto', root: SANDBOX });
  assert.ok(out === null || !out.includes('autoCompactWindow'), out);
});
