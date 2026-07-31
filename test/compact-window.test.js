import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseWindow,
  isOneMillionModel,
  compactWindowStatus,
  compactWindowWarningForStatusline,
  setAutoCompactWindow,
  effectiveWindow,
  RECOMMENDED_WINDOW,
} from '../src/compact-window.js';

/**
 * The warning exists for exactly one shape of misconfiguration: a 1M-context
 * model with no (or too large) autoCompactWindow. 200k sessions must stay
 * silent — the setting cannot change anything for them, so warning would be
 * noise the user can't act on.
 */

function sandbox(settings) {
  const root = mkdtempSync(join(tmpdir(), 'cts-cw-'));
  mkdirSync(join(root, '.claude'), { recursive: true });
  if (settings) writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify(settings));
  return root;
}

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('parseWindow accepts every form Claude Code takes', () => {
  assert.equal(parseWindow(400000), 400000);
  assert.equal(parseWindow('400000'), 400000);
  assert.equal(parseWindow('400k'), 400000);
  assert.equal(parseWindow('1M'), 1000000);
  assert.equal(parseWindow('400'), 400000); // bare-hundreds shorthand
  assert.equal(parseWindow('bogus'), null);
  assert.equal(parseWindow(undefined), null);
});

test('1M detection keys off the model id, not the plan', () => {
  assert.equal(isOneMillionModel('claude-opus-5[1m]'), true);
  assert.equal(isOneMillionModel('claude-sonnet-5[1M]'), true);
  assert.equal(isOneMillionModel('claude-opus-5'), false);
  assert.equal(isOneMillionModel(null), false);
});

test('200k models are exempt even with no autoCompactWindow anywhere', () => {
  const root = sandbox({ model: 'claude-opus-5' });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined }, () => {
    const s = compactWindowStatus({ root });
    assert.equal(s.is1m, false);
    assert.equal(s.ok, true);
    assert.equal(s.reason, 'not-1m');
    assert.equal(compactWindowWarningForStatusline(root), null);
  });
});

test('1M model with no window warns as unset', () => {
  const root = sandbox({ model: 'claude-opus-5[1m]' });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, () => {
    const s = compactWindowStatus({ root });
    assert.equal(s.is1m, true);
    assert.equal(s.ok, false);
    assert.equal(s.reason, 'unset');
    assert.equal(compactWindowWarningForStatusline(root), 'compact-window?');
  });
});

test('a window above the recommendation still warns; at or below does not', () => {
  const root = sandbox({ model: 'claude-opus-5[1m]', autoCompactWindow: 800000 });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, () => {
    assert.equal(compactWindowStatus({ root }).reason, 'too-large');
  });
  const ok = sandbox({ model: 'claude-opus-5[1m]', autoCompactWindow: RECOMMENDED_WINDOW });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: ok, USERPROFILE: ok }, () => {
    const s = compactWindowStatus({ root: ok });
    assert.equal(s.ok, true);
    assert.equal(s.reason, 'configured');
  });
});

test('the env var wins over settings.json, matching Claude Code', () => {
  const root = sandbox({ model: 'claude-opus-5[1m]', autoCompactWindow: 400000 });
  withEnv({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '900k' }, () => {
    const w = effectiveWindow(root);
    assert.equal(w.value, 900000);
    assert.equal(w.source, 'env');
  });
});

test('the statusline warning can be switched off in config', () => {
  const root = sandbox({ model: 'claude-opus-5[1m]' });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, () => {
    assert.equal(compactWindowWarningForStatusline(root, { compactWindow: { enabled: false } }), null);
  });
});

test('set preserves every other key and backs the file up', () => {
  const root = sandbox({ model: 'claude-opus-5[1m]', permissions: { defaultMode: 'auto' } });
  const r = setAutoCompactWindow({ root, scope: 'project', value: '400k' });
  assert.equal(r.ok, true);
  assert.equal(r.value, 400000);
  const written = JSON.parse(readFileSync(r.path, 'utf8'));
  assert.equal(written.autoCompactWindow, 400000);
  assert.deepEqual(written.permissions, { defaultMode: 'auto' });
  assert.equal(JSON.parse(readFileSync(r.backup, 'utf8')).autoCompactWindow, undefined);
});

test('set refuses values Claude Code would reject, and unparseable settings', () => {
  const root = sandbox({ model: 'claude-opus-5[1m]' });
  assert.equal(setAutoCompactWindow({ root, scope: 'project', value: 50000 }).ok, false);
  assert.equal(setAutoCompactWindow({ root, scope: 'project', value: 2000000 }).ok, false);
  const broken = mkdtempSync(join(tmpdir(), 'cts-cw-bad-'));
  mkdirSync(join(broken, '.claude'), { recursive: true });
  writeFileSync(join(broken, '.claude', 'settings.json'), '{ not json');
  const r = setAutoCompactWindow({ root: broken, scope: 'project' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not valid JSON/);
  assert.equal(readFileSync(join(broken, '.claude', 'settings.json'), 'utf8'), '{ not json');
});
