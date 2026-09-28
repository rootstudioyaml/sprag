import test from 'node:test';
import assert from 'node:assert/strict';
import { openCodexPanel, panelLaunchCommand } from '../src/codex-panel-launcher.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';
import { recordPanelState, panelHealth } from '../src/codex-panel-state.js';

test('panel launcher quotes shell arguments and keeps them out of AppleScript source', () => {
  const root = '/tmp/a "quote"\' $(danger); project';
  const command = panelLaunchCommand(root, { node: '/node', cli: '/cli', home: '/home' });
  assert.match(command, /'"'"'/);
  let calls = 0;
  const result = openCodexPanel(root, { platform: 'darwin', exec: (bin, args, opts) => {
    calls++;
    assert.equal(bin, '/usr/bin/osascript');
    assert.doesNotMatch(args[1], /danger/);
    assert.match(args[2], /^Sprag \| Codex \| [0-9a-f]{16}$/);
    assert.match(args[1], /busy of t/);
    assert.ok(args[1].indexOf('set miniaturized of w to false') < args[1].indexOf('if busy of t'));
    assert.match(args[1], /set selected tab of w to t/);
    assert.match(args[1], /set index of w to 1/);
    assert.match(args[3], /danger/);
    assert.equal(opts.timeout, 8000);
    return 'already-open\n';
  } });
  assert.equal(result, 'already-open');
  assert.equal(calls, 1);
  assert.throws(() => openCodexPanel(root, { platform: 'linux' }), /macOS/);
});

test('panel health separates hook execution from rendering and expires stale frames', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-health-'));
  try {
    assert.equal(panelHealth('/project', { dir }).live, false);
    recordPanelState('/project', 'hook', { status: 'opened' }, dir);
    assert.equal(panelHealth('/project', { dir }).live, false);
    recordPanelState('/project', 'frame', { status: 'rendered' }, dir);
    assert.equal(panelHealth('/project', { dir }).live, true);
    assert.equal(panelHealth('/project', { dir, now: Date.now() + 20000 }).live, false);
    recordPanelState('/project', 'frame', { status: 'closed' }, dir);
    assert.equal(panelHealth('/project', { dir }).live, false);
    assert.equal(panelHealth('/other', { dir }).hook, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('auto panel registration survives reinstall and can be removed independently', () => {
  const home = mkdtempSync(join(tmpdir(), 'sprag-auto-'));
  const module = fileURLToPath(new URL('../src/codex-installer.js', import.meta.url));
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import {configureCodexHooks,codexPanelAutoEnabled} from ${JSON.stringify(module)};
      assert.equal(codexPanelAutoEnabled(),false);
      configureCodexHooks({panelAuto:true});
      assert.equal(codexPanelAutoEnabled(),true);
      configureCodexHooks();
      assert.equal(codexPanelAutoEnabled(),true);
      configureCodexHooks({panelAuto:false});
      assert.equal(codexPanelAutoEnabled(),false);
      configureCodexHooks({panelAuto:true});
      configureCodexHooks({remove:true});
      assert.equal(codexPanelAutoEnabled(),false);
    `], { env: childEnv({ HOME: home, CODEX_HOME: home }), encoding: 'utf8' });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('automatic windows and health records are session-specific within one project', () => {
  const titles = [];
  for (const [home, sessionId] of [['/home', 'one'], ['/home', 'two'], ['/home', 'one'], ['/other', 'one']]) {
    openCodexPanel('/project', { platform: 'darwin', home, sessionId, exec: (bin, args) => {
      titles.push(args[2]);
      assert.ok(args[3].includes(`'--session' '${sessionId}'`));
      return 'opened';
    } });
  }
  assert.notEqual(titles[0], titles[1]);
  assert.equal(titles[0], titles[2]);
  assert.notEqual(titles[0], titles[3]);
  const dir = mkdtempSync(join(tmpdir(), 'sprag-health-sessions-'));
  try {
    recordPanelState('/project', 'frame', { status: 'rendered', sessionId: 'one' }, dir);
    recordPanelState('/project', 'frame', { status: 'closed', sessionId: 'two' }, dir);
    assert.equal(panelHealth('/project', { dir, sessionId: 'one' }).live, true);
    assert.equal(panelHealth('/project', { dir, sessionId: 'two' }).live, false);
    assert.equal(panelHealth('/project', { dir, sessionId: 'missing' }).frame, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
