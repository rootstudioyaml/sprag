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
  RECOMMENDED_MIN,
  RECOMMENDED_MAX,
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
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  let out;
  try {
    out = fn();
  } catch (e) {
    restore();
    throw e;
  }
  // An async callback must keep its environment until it actually finishes —
  // restoring in a synchronous `finally` tore the env down at the first await,
  // so the assertions ran against the real ~/.claude settings.
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
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

test('only a window above the recommended band warns', () => {
  const root = sandbox({ model: 'claude-opus-5[1m]', autoCompactWindow: 800000 });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, () => {
    assert.equal(compactWindowStatus({ root }).reason, 'too-large');
  });
  // Anywhere in (and below) the band is the user's call — 600k, the band edges,
  // and the default pin all stay silent.
  for (const w of [RECOMMENDED_MIN, RECOMMENDED_WINDOW, 600_000, RECOMMENDED_MAX, 200_000]) {
    const ok = sandbox({ model: 'claude-opus-5[1m]', autoCompactWindow: w });
    withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: ok, USERPROFILE: ok }, () => {
      const s = compactWindowStatus({ root: ok });
      assert.equal(s.ok, true, `window ${w} should not warn`);
      assert.equal(s.reason, 'configured');
      assert.equal(compactWindowWarningForStatusline(ok), null);
    });
  }
  // One token above the band is still a defect.
  const over = sandbox({ model: 'claude-opus-5[1m]', autoCompactWindow: RECOMMENDED_MAX + 1 });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: over, USERPROFILE: over }, () => {
    assert.equal(compactWindowStatus({ root: over }).reason, 'too-large');
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

/**
 * The briefing's context tier is measured against the window the session
 * actually turns over at. Inferring it from "the biggest request seen so far"
 * called a 1M session 200k until it had already grown past 250k, so the 80%
 * warning fired at 160k — 16% of the real window.
 */
test('the briefing window follows the configured model, not the observed size', async () => {
  const { ctxWindowFor } = await import('../src/brief.js');
  const root = sandbox({ model: 'claude-opus-5[1m]' });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, () => {
    const w = ctxWindowFor(160_000, root);
    assert.equal(w.window, 1_000_000);
    assert.equal(w.compactCapped, false);
  });
});

test('autoCompactWindow lowers the briefing window to where compaction fires', async () => {
  const { ctxWindowFor } = await import('../src/brief.js');
  const root = sandbox({ model: 'claude-opus-5[1m]', autoCompactWindow: 400_000 });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, () => {
    const w = ctxWindowFor(160_000, root);
    assert.equal(w.window, 400_000);
    assert.equal(w.compactCapped, true);
  });
});

test('a huge observed request still proves 1M when the model id is unreadable', async () => {
  const { ctxWindowFor } = await import('../src/brief.js');
  const root = sandbox(null);
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, () => {
    assert.equal(ctxWindowFor(300_000, root).window, 1_000_000);
    assert.equal(ctxWindowFor(50_000, root).window, 200_000);
  });
});

/**
 * Auto-compaction ends one fill cycle and starts another. A monotonic
 * high-water tier meant the session that compacted at 80% never spoke again,
 * even as it refilled straight back to the cap.
 */
test('the context tier falls back down after compaction', async () => {
  const { runBrief, briefStatePath } = await import('../src/brief.js');
  const dir = mkdtempSync(join(tmpdir(), 'cts-brief-'));
  const tx = join(dir, 't.jsonl');
  const usage = (n) => JSON.stringify({ message: { usage: { input_tokens: n } } }) + '\n';
  const read = () => JSON.parse(readFileSync(briefStatePath(), 'utf8'));

  await withEnv({ XDG_CONFIG_HOME: dir, ANTHROPIC_MODEL: 'claude-opus-5', CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined }, async () => {
    writeFileSync(tx, usage(170_000)); // 85% of 200k → tier 1
    const first = await runBrief({ sessionId: 'sess-compact', transcriptPath: tx });
    assert.match(first || '', /80%/);
    assert.equal(read().sessions['sess-compact'].ctxTier, 1);

    writeFileSync(tx, usage(30_000)); // compaction dropped the live context
    await runBrief({ sessionId: 'sess-compact', transcriptPath: tx });
    assert.equal(read().sessions['sess-compact'].ctxTier, 0, 'tier must follow the context back down');

    writeFileSync(tx, usage(170_000)); // refilled → warn again
    const again = await runBrief({ sessionId: 'sess-compact', transcriptPath: tx });
    assert.match(again || '', /80%/);
  });
});

test('a capped window reports the model-window percentage too', async () => {
  const { runBrief } = await import('../src/brief.js');
  const dir = mkdtempSync(join(tmpdir(), 'cts-brief2-'));
  const root = sandbox({ model: 'claude-opus-5[1m]', autoCompactWindow: 400_000 });
  const tx = join(dir, 't.jsonl');
  writeFileSync(tx, JSON.stringify({ message: { usage: { input_tokens: 330_000 } } }) + '\n');
  await withEnv({ XDG_CONFIG_HOME: dir, ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, async () => {
    const prev = process.cwd();
    process.chdir(root);
    try {
      const out = await runBrief({ sessionId: 'sess-capped', transcriptPath: tx });
      assert.match(out || '', /자동 압축 창\(400k\)의 80%/);
      assert.match(out || '', /1M 창 기준으로는 33%/);
      // Compaction is automatic at the cap — do not tell the user to bail out.
      assert.doesNotMatch(out || '', /새 세션 시작을 권합니다/);
    } finally {
      process.chdir(prev);
    }
  });
});
