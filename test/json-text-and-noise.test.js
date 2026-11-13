// parseJsonText (UTF-8 BOM), and two Windows log noises that are not faults:
// no ~/.npmrc and no `claude` on a hook's PATH.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cts-json-noise-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
process.env.APPDATA = join(home, 'config');
delete process.env.ANTHROPIC_BASE_URL;

const { parseJsonText } = await import('../src/json-text.js');
const { withClaudeSettingsEnv } = await import('../src/gateway-auth.js');
const { claudeCodeVersion } = await import('../src/compact-window.js');
const { npmRegistry } = await import('../src/update-check.js');
const { readDiag, diagPath, _resetDiagForTest } = await import('../src/diag-log.js');
const { userDataDir } = await import('../src/paths.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

test('parseJsonText strips one leading BOM and nothing else', () => {
  assert.deepEqual(parseJsonText('﻿{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonText('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonText('  {"a":1}'), { a: 1 });
  assert.throws(() => parseJsonText('﻿﻿{"a":1}'), SyntaxError);
  assert.throws(() => parseJsonText('﻿'), SyntaxError);
});

test('withClaudeSettingsEnv reads a BOM settings.json', () => {
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), '﻿' + JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://gw.example.com' } }));
  const env = withClaudeSettingsEnv({}, { home });
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://gw.example.com');
});

function withDiag(fn) {
  const dir = userDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'team.json'), JSON.stringify({ memberKey: 'spk_secret' }));
  rmSync(diagPath(dir), { force: true });
  _resetDiagForTest();
  try {
    fn(dir);
  } finally {
    rmSync(join(dir, 'team.json'), { force: true });
    rmSync(diagPath(dir), { force: true });
    _resetDiagForTest();
  }
}

const coded = (code) => Object.assign(new Error(`spawn ${code}`), { code });

test('update-check:npmrc is not logged for a missing ~/.npmrc, but other errors are', () => {
  withDiag((dir) => {
    assert.equal(npmRegistry({ env: {}, readText: () => { throw coded('ENOENT'); }, home: '/h' }), 'https://registry.npmjs.org/');
    assert.deepEqual(readDiag({ dir }), []);
    npmRegistry({ env: {}, readText: () => { throw coded('EACCES'); }, home: '/h' });
    assert.deepEqual(readDiag({ dir }).map((e) => e.scope), ['update-check:npmrc']);
  });
});

test('compact-window:claude-version is not logged for a missing claude, but a timeout is', () => {
  withDiag((dir) => {
    assert.equal(claudeCodeVersion({ run: () => { throw coded('ENOENT'); } }), null);
    assert.deepEqual(readDiag({ dir }), []);
    assert.equal(claudeCodeVersion({ run: () => { throw coded('ETIMEDOUT'); } }), null);
    assert.deepEqual(readDiag({ dir }).map((e) => e.scope), ['compact-window:claude-version']);
  });
});
