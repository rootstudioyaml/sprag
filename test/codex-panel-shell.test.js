import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installPanelShell, PANEL_SHELL_BLOCK } from '../src/codex-panel-shell.js';
import { childEnv } from './helpers/child-env.js';

test('shell setup is idempotent, reversible, and does not replace existing codex customization', () => {
  const home = mkdtempSync(join(tmpdir(), 'sprag-shell-'));
  const file = join(home, '.zshrc');
  try {
    writeFileSync(file, '# existing\n');
    installPanelShell({ file });
    const once = readFileSync(file, 'utf8');
    installPanelShell({ file });
    assert.equal(readFileSync(file, 'utf8'), once);
    installPanelShell({ file, remove: true });
    assert.equal(readFileSync(file, 'utf8').trim(), '# existing');
    writeFileSync(file, 'alias codex="my-codex"\n');
    assert.throws(() => installPanelShell({ file }), /existing codex/);
    assert.equal(readFileSync(file, 'utf8'), 'alias codex="my-codex"\n');
    if (process.platform === 'darwin') {
      const parsed = spawnSync('/bin/zsh', ['-n'], { input: PANEL_SHELL_BLOCK, env: childEnv({ HOME: home }), encoding: 'utf8' });
      assert.equal(parsed.status, 0, parsed.stderr);
    }
    assert.doesNotMatch(PANEL_SHELL_BLOCK, /[\x00-\x08]/);
    assert.match(PANEL_SHELL_BLOCK, /command codex "\$@"/);
  } finally { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
