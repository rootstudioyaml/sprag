/**
 * The SPRAG_ prefix replaced the legacy CTS_ prefix (the package used to be
 * called claude-token-saver). Existing users still have CTS_ variables set in
 * shells, CI and Claude Code managed settings, so every read takes the SPRAG_
 * name first and falls back to the CTS_ one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envVar } from '../src/env.js';
import { teamSyncDisabled } from '../src/team-sync.js';
import { updateCheckDisabled } from '../src/update-check.js';
import { childEnv } from './helpers/child-env.js';

const require = createRequire(import.meta.url);
const twin = require('../src/env.cjs');
const ROOT = fileURLToPath(new URL('..', import.meta.url));

for (const [label, read] of [['esm', envVar], ['cjs twin', twin.envVar]]) {
  test(`envVar (${label}) prefers SPRAG_ over CTS_ and falls back to CTS_`, () => {
    assert.equal(read('X', { SPRAG_X: 'new', CTS_X: 'old' }), 'new');
    assert.equal(read('X', { CTS_X: 'old' }), 'old');
    assert.equal(read('X', { SPRAG_X: 'new' }), 'new');
    assert.equal(read('X', {}), undefined);
    assert.equal(read('X', { SPRAG_X: '', CTS_X: '1' }), '', 'an explicit empty SPRAG_ value wins');
  });
}

test('the ESM and CJS helpers answer the same for the same environments', () => {
  for (const env of [{}, { CTS_A: '1' }, { SPRAG_A: '2' }, { SPRAG_A: '2', CTS_A: '1' }, { SPRAG_A: '' }]) {
    assert.equal(twin.envVar('A', env), envVar('A', env));
  }
});

test('NO_TEAM_SYNC is honoured under both names', () => {
  assert.equal(teamSyncDisabled({ SPRAG_NO_TEAM_SYNC: '1' }), true);
  assert.equal(teamSyncDisabled({ CTS_NO_TEAM_SYNC: '1' }), true);
  assert.equal(teamSyncDisabled({}), false);
  assert.equal(teamSyncDisabled({ SPRAG_NO_TEAM_SYNC: '0', CTS_NO_TEAM_SYNC: '1' }), false, 'the new name wins');
});

test('NO_UPDATE_CHECK is honoured under both names', () => {
  const saved = Object.assign({}, process.env);
  try {
    delete process.env.NO_UPDATE_NOTIFIER;
    delete process.env.SPRAG_NO_UPDATE_CHECK;
    delete process.env.CTS_NO_UPDATE_CHECK;
    assert.equal(updateCheckDisabled(), false);
    process.env.CTS_NO_UPDATE_CHECK = '1';
    assert.equal(updateCheckDisabled(), true, 'legacy name still works');
    delete process.env.CTS_NO_UPDATE_CHECK;
    process.env.SPRAG_NO_UPDATE_CHECK = '1';
    assert.equal(updateCheckDisabled(), true);
  } finally {
    process.env = saved;
  }
});

test('the standalone hook keeps the same SPRAG_ then CTS_ order as the helper', () => {
  const hook = readFileSync(join(ROOT, 'src', 'hook.cjs'), 'utf8');
  assert.match(hook, /process\.env\.SPRAG_DEBUG \?\? process\.env\.CTS_DEBUG/);
});

test('the doc2md converter keeps the SPRAG_ then CTS_ order for its row cap', () => {
  const py = readFileSync(join(ROOT, 'presets', 'doc2md', 'convert.py'), 'utf8');
  assert.match(py, /SPRAG_DOC2MD_ROW_CAP.*CTS_DOC2MD_ROW_CAP/);
});

test('only the helper and the documented fallbacks mention CTS_ in the source', () => {
  const allowed = new Set(['src/env.js', 'src/env.cjs', 'src/hook.cjs', 'presets/doc2md/convert.py']);
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, out); else out.push(full);
    }
    return out;
  };
  const offenders = ['src', 'bin', 'scripts', 'presets']
    .flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => /\.(js|cjs|mjs|py)$/.test(f))
    // Windows paths use backslashes; compare in the repo's forward-slash form.
    .map((f) => relative(ROOT, f).split(sep).join('/'))
    .filter((f) => !allowed.has(f) && readFileSync(join(ROOT, f), 'utf8').includes('CTS_'));
  assert.deepEqual(offenders, [], 'read variables through envVar() and name them SPRAG_');
});

test('childEnv scrubs both names', () => {
  const saved = Object.assign({}, process.env);
  process.env.CTS_NO_TEAM_SYNC = '1';
  process.env.SPRAG_NO_TEAM_SYNC = '1';
  try {
    const env = childEnv({ HOME: '/tmp/sandbox' });
    assert.equal(env.CTS_NO_TEAM_SYNC, undefined);
    assert.equal(env.SPRAG_NO_TEAM_SYNC, undefined);
  } finally {
    process.env = saved;
  }
});
