import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTmux, setupCodexPanel, describePanelSetup } from '../src/codex-panel-setup.js';

test('ensureTmux skips without probing when opted out or in CI', () => {
  let calls = 0;
  const exec = () => { calls += 1; };
  assert.deepEqual(ensureTmux({ env: { CTS_NO_TMUX: '1' }, exec }), { status: 'skipped' });
  assert.deepEqual(ensureTmux({ env: { CI: 'true' }, exec }), { status: 'skipped' });
  assert.equal(calls, 0);
});

test('ensureTmux reports present when tmux already answers -V', () => {
  assert.deepEqual(ensureTmux({ env: {}, exec: () => '' }), { status: 'present' });
});

test('ensureTmux installs tmux with brew on macOS when missing and brew is on PATH', () => {
  const calls = [];
  let installed = false;
  const exec = (bin, args, options) => {
    calls.push({ bin, args, options });
    if (bin === 'tmux' && args[0] === '-V') {
      if (!installed) throw new Error('tmux: command not found');
      return '';
    }
    if (bin === 'brew' && args[0] === '--prefix') return '/opt/homebrew';
    if (bin === 'brew' && args[0] === 'install') { installed = true; return ''; }
    throw new Error(`unexpected exec ${bin} ${args.join(' ')}`);
  };
  const result = ensureTmux({ platform: 'darwin', env: {}, exec });
  assert.deepEqual(result, { status: 'installed', via: 'brew' });
  const install = calls.find((c) => c.bin === 'brew' && c.args[0] === 'install');
  assert.equal(install.options.env.HOMEBREW_NO_AUTO_UPDATE, '1');
});

test('ensureTmux reports unavailable on macOS when brew cannot be found anywhere', () => {
  const calls = [];
  const exec = (bin, args) => { calls.push([bin, ...args]); throw new Error('missing'); };
  const result = ensureTmux({ platform: 'darwin', env: {}, exec, exists: () => false });
  assert.equal(result.status, 'unavailable');
  assert.ok(!calls.some((c) => c.includes('install')));
});

test('ensureTmux reports unavailable on Linux without probing for brew', () => {
  const calls = [];
  const exec = (bin, args) => { calls.push([bin, ...args]); throw new Error('missing'); };
  const result = ensureTmux({ platform: 'linux', env: {}, exec });
  assert.equal(result.status, 'unavailable');
  assert.ok(!calls.some((c) => c[0] === 'brew'));
});

test('setupCodexPanel is off with --no-panel or off macOS, without touching the shell', () => {
  let calls = 0;
  const installShell = () => { calls += 1; return '/tmp/x/.zshrc'; };
  assert.deepEqual(setupCodexPanel({ noPanel: true, installShell }), { panelAuto: false, mode: 'off' });
  assert.deepEqual(setupCodexPanel({ platform: 'linux', env: { SHELL: '/bin/zsh' }, installShell }), { panelAuto: false, mode: 'off' });
  assert.equal(calls, 0);
});

test('setupCodexPanel goes inline on macOS zsh once tmux and the shell block are ready', () => {
  const installShell = () => '/tmp/x/.zshrc';
  const tmux = () => ({ status: 'present' });
  const result = setupCodexPanel({ platform: 'darwin', env: { SHELL: '/bin/zsh' }, installShell, tmux });
  assert.deepEqual(result, { panelAuto: false, mode: 'inline', tmux: { status: 'present' }, shellFile: '/tmp/x/.zshrc' });
  const withAuto = setupCodexPanel({ platform: 'darwin', env: { SHELL: '/bin/zsh' },
    config: { codex: { panelAuto: true } }, installShell, tmux });
  assert.equal(withAuto.panelAuto, true);
  assert.equal(withAuto.mode, 'inline');
});

test('setupCodexPanel falls back to the separate window on every non-inline condition', () => {
  const present = () => ({ status: 'present' });
  let shellCalls = 0;
  const countedShell = () => { shellCalls += 1; return '/tmp/x/.zshrc'; };

  const bash = setupCodexPanel({ platform: 'darwin', env: { SHELL: '/bin/bash' }, installShell: countedShell, tmux: present });
  assert.equal(bash.mode, 'window');
  assert.equal(bash.panelAuto, true);
  assert.match(bash.reason, /not zsh/);
  assert.equal(shellCalls, 0);

  const off = setupCodexPanel({ platform: 'darwin', env: { SHELL: '/bin/zsh' },
    config: { codex: { panelShell: false } }, installShell: countedShell, tmux: present });
  assert.equal(off.mode, 'window');
  assert.equal(shellCalls, 0);

  const noTmux = setupCodexPanel({ platform: 'darwin', env: { SHELL: '/bin/zsh' }, installShell: countedShell,
    tmux: () => ({ status: 'unavailable', detail: 'no brew' }) });
  assert.equal(noTmux.mode, 'window');
  assert.equal(noTmux.tmux.status, 'unavailable');
  assert.equal(shellCalls, 0);

  const thrown = setupCodexPanel({ platform: 'darwin', env: { SHELL: '/bin/zsh' }, tmux: present,
    installShell: () => { throw new Error('An existing codex alias/function is present; keeping it unchanged.'); } });
  assert.equal(thrown.mode, 'window');
  assert.match(thrown.reason, /existing codex alias/);

  const disabled = setupCodexPanel({ platform: 'darwin', env: { SHELL: '/bin/bash' },
    config: { codex: { panelAuto: false } }, installShell: countedShell, tmux: present });
  assert.equal(disabled.mode, 'off');
  assert.equal(disabled.panelAuto, false);
  assert.equal(shellCalls, 0);
});

test('describePanelSetup renders nothing for off and names the shell file for inline', () => {
  assert.deepEqual(describePanelSetup({ mode: 'off' }), []);
  const lines = describePanelSetup({ mode: 'inline', shellFile: '/tmp/x/.zshrc' });
  assert.ok(lines.some((line) => line.includes('/tmp/x/.zshrc')));
});
