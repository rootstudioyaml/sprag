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
  claudeCodeVersion,
  modelSettingsSupported,
  modelSettingsNotice,
  MODEL_SETTINGS_MIN_VERSION,
  effectiveWindow,
  canonicalModelId,
  compactWindowWarningEnabled,
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

// #14: a model Claude Code runs at 1M by default carries no `[1m]` (Opus 5.5
// as `opus` or `claude-opus-5-5`). Before its own statusline reports, the
// session borrows the window another session reported for the same model, and
// a bare alias matches the newest report of its family.
test('without a report of its own, the window comes from another session of the same model', async () => {
  const { ctxWindowFor } = await import('../src/brief.js');
  const { recordLiveWindow } = await import('../src/ctx-window-cache.js');
  for (const model of ['claude-opus-5-5', 'opus']) {
    const root = sandbox({ model });
    const dir = mkdtempSync(join(tmpdir(), 'cts-ctxwin-'));
    withEnv({ XDG_CONFIG_HOME: dir, ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, () => {
      // Nothing reported yet: the observed-size guess.
      assert.equal(ctxWindowFor(160_000, root).window, 200_000, model);
      // Another model's report does not count.
      recordLiveWindow('other', 1_000_000, Date.now(), 'claude-sonnet-5-5');
      assert.equal(ctxWindowFor(160_000, root).window, 200_000, model);
      recordLiveWindow('earlier', 1_000_000, Date.now(), 'claude-opus-5-5[1m]');
      const w = ctxWindowFor(160_000, root);
      assert.equal(w.window, 1_000_000, model);
      assert.equal(w.modelWindow, 1_000_000, model);
      // The session's own report still wins.
      assert.equal(ctxWindowFor(160_000, root, { liveWindow: 200_000 }).window, 200_000, model);
    });
  }
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

/**
 * The model id is not where the window size lives. A model that is 1M without
 * a `[1m]` suffix read as 200k, so the briefing announced "200k 창의 80%" at
 * 160k while the statusline of the same session said "Ctx 1M". The statusline
 * payload carries the real size, and the briefing now reads it back by session.
 */
test('a window the statusline reported outranks the model id', async () => {
  const { ctxWindowFor } = await import('../src/brief.js');
  const root = sandbox({ model: 'claude-fable-5-1' });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, () => {
    assert.equal(ctxWindowFor(160_000, root).window, 200_000, 'the id alone still reads as 200k');
    const w = ctxWindowFor(160_000, root, { liveWindow: 1_000_000 });
    assert.equal(w.window, 1_000_000);
    assert.equal(w.modelWindow, 1_000_000);
    assert.equal(w.compactCapped, false);
  });
  const capped = sandbox({ model: 'claude-fable-5-1', autoCompactWindow: 600_000 });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: capped, USERPROFILE: capped }, () => {
    const w = ctxWindowFor(160_000, capped, { liveWindow: 1_000_000 });
    assert.equal(w.window, 600_000);
    assert.equal(w.modelWindow, 1_000_000);
    assert.equal(w.compactCapped, true);
  });
});

test('the live window cache writes on change only and answers by session', async () => {
  const { recordLiveWindow, liveWindowFor, ctxWindowCachePath } = await import('../src/ctx-window-cache.js');
  const dir = mkdtempSync(join(tmpdir(), 'cts-ctxwin-'));
  withEnv({ XDG_CONFIG_HOME: dir }, () => {
    const t0 = 1_800_000_000_000;
    assert.equal(liveWindowFor('sess-a'), null);
    assert.equal(recordLiveWindow('sess-a', 1_000_000, t0), true);
    assert.equal(recordLiveWindow('sess-a', 1_000_000, t0 + 5_000), false, 'an unchanged size is not rewritten every render');
    assert.equal(recordLiveWindow('sess-a', 200_000, t0 + 6_000), true, 'a changed size is');
    assert.equal(liveWindowFor('sess-a'), 200_000);
    assert.equal(recordLiveWindow(null, 1_000_000, t0), false);
    assert.equal(recordLiveWindow('sess-b', 0, t0), false);
    // Eight days on, another session's write prunes the stale entry.
    recordLiveWindow('sess-c', 1_000_000, t0 + 8 * 86_400_000);
    assert.equal(liveWindowFor('sess-a'), null);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(ctxWindowCachePath(), 'utf8')).sessions), ['sess-c']);
  });
});

test('the briefing stays quiet at 170k once the session is known to be 1M', async () => {
  const { runBrief } = await import('../src/brief.js');
  const { recordLiveWindow } = await import('../src/ctx-window-cache.js');
  const dir = mkdtempSync(join(tmpdir(), 'cts-brief3-'));
  const root = sandbox({ model: 'claude-fable-5-1', autoCompactWindow: 600_000 });
  const tx = join(dir, 't.jsonl');
  writeFileSync(tx, JSON.stringify({ message: { usage: { input_tokens: 170_000 } } }) + '\n');
  await withEnv({ XDG_CONFIG_HOME: dir, ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, async () => {
    const before = await runBrief({ sessionId: 'sess-unknown', transcriptPath: tx, root });
    assert.match(before || '', /200k 창의 80%/, 'with no reported size the id-based guess is all there is');

    recordLiveWindow('sess-live', 1_000_000);
    const after = await runBrief({ sessionId: 'sess-live', transcriptPath: tx, root });
    assert.doesNotMatch(after || '', /창의 80%|창\(\d+k\)의 80%/);

    // 80% of the 600k compaction window, counted against the reported 1M.
    writeFileSync(tx, JSON.stringify({ message: { usage: { input_tokens: 490_000 } } }) + '\n');
    const crossed = await runBrief({ sessionId: 'sess-live', transcriptPath: tx, root });
    assert.match(crossed || '', /자동 압축 창\(600k\)의 80%/);
    assert.match(crossed || '', /1M 창 기준으로는 49%/);
  });
});

test('an unset compaction window is flagged once the session reports 1M', () => {
  const root = sandbox({ model: 'claude-fable-5-1' });
  withEnv({ ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: root, USERPROFILE: root }, () => {
    assert.equal(compactWindowStatus({ root }).reason, 'not-1m');
    const s = compactWindowStatus({ root, liveWindow: 1_000_000 });
    assert.equal(s.ok, false);
    assert.equal(s.reason, 'unset');
    assert.equal(compactWindowWarningForStatusline(root, null, { liveWindow: 1_000_000 }), 'compact-window?');
    assert.equal(compactWindowWarningForStatusline(root, null, { liveWindow: 200_000 }), null);
  });
});

/**
 * Since Claude Code 2.1.288 `/autocompact` writes
 * `modelSettings[<canonical id>].autoCompactWindow` instead of the top-level
 * key. Reading only the top-level key reported a pinned 500k as "unset" and
 * kept warning about a setting the user had already made (issue #11).
 */
test('canonicalModelId folds every spelling of a model to one id', () => {
  const cases = [
    ['claude-opus-5-5[1m]', 'claude-opus-5-5'],
    ['us.anthropic.claude-opus-5-5-20251101-v1:0', 'claude-opus-5-5'],
    ['bedrock/anthropic.claude-haiku-4-5', 'claude-haiku-4-5'],
    ['claude-opus-5-5@20251101', 'claude-opus-5-5'],
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    ['opus[1m]', 'opus'],
    ['Opus', 'opus'],
  ];
  for (const [input, want] of cases) assert.equal(canonicalModelId(input), want, input);
  assert.equal(canonicalModelId(''), null);
  assert.equal(canonicalModelId(null), null);
  assert.equal(canonicalModelId(42), null);
});

const NO_ENV = { ANTHROPIC_MODEL: undefined, CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined };

function userHome(settings) {
  const home = sandbox(settings);
  const root = sandbox(null);
  return { home, root, env: { ...NO_ENV, HOME: home, USERPROFILE: home } };
}

// A bare alias is never resolved to a version by guessing: the live model id
// from the statusline payload decides, and without it the entries are skipped.
test('a per-model window is read by the live model id, and a bare alias does not guess', () => {
  const { root, env } = userHome({
    model: 'opus[1m]',
    modelSettings: { 'claude-opus-5': { autoCompactWindow: 900000 }, 'claude-opus-5-5': { autoCompactWindow: '500k' } },
  });
  withEnv(env, () => {
    assert.equal(compactWindowStatus({ root }).reason, 'unset');
    const s = compactWindowStatus({ root, liveWindow: 1_000_000, liveModel: 'claude-opus-5-5[1m]' });
    assert.equal(s.window, 500000);
    assert.equal(s.ok, true);
    assert.equal(s.reason, 'configured');
    assert.equal(s.windowModelKey, 'claude-opus-5-5');
    assert.equal(s.windowSource, 'global');
  });
});

// The user chose the model default on purpose, so it is not a defect to warn about.
test('a per-model "auto" is reported as the model default and not warned', () => {
  const { root, env } = userHome({ model: 'claude-opus-5-5[1m]', modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 'auto' } } });
  withEnv(env, () => {
    const s = compactWindowStatus({ root });
    assert.equal(s.ok, true);
    assert.equal(s.reason, 'auto');
    assert.equal(s.window, null);
    assert.equal(s.windowAuto, true);
    assert.equal(compactWindowWarningForStatusline(root), null);
  });
});

test('a per-model value beats the top-level key in the same file', () => {
  const { root, env } = userHome({
    model: 'claude-opus-5-5[1m]',
    autoCompactWindow: 500000,
    modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 900000 } },
  });
  withEnv(env, () => {
    const s = compactWindowStatus({ root });
    assert.equal(s.reason, 'too-large');
    assert.equal(s.window, 900000);
  });
});

test('a project top-level value beats a user per-model "auto"', () => {
  const { root, env } = userHome({ model: 'claude-opus-5-5[1m]', modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 'auto' } } });
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 500000 }));
  withEnv(env, () => {
    const s = compactWindowStatus({ root });
    assert.equal(s.reason, 'configured');
    assert.equal(s.window, 500000);
    assert.equal(s.windowSource, 'project');
  });
});

test('an entry for another model is ignored', () => {
  const { root, env } = userHome({ model: 'claude-opus-5-5[1m]', modelSettings: { 'claude-sonnet-5-5': { autoCompactWindow: 500000 } } });
  withEnv(env, () => {
    assert.equal(compactWindowStatus({ root }).reason, 'unset');
  });
});

test('the live model id from a Bedrock session finds its modelSettings entry', () => {
  const { root, env } = userHome({ modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 600000 } } });
  withEnv(env, () => {
    const s = compactWindowStatus({ root, liveWindow: 1_000_000, liveModel: 'us.anthropic.claude-opus-5-5-20251101-v1:0' });
    assert.equal(s.reason, 'configured');
    assert.equal(s.window, 600000);
    assert.equal(s.modelSource, 'live');
  });
});

// The chip and the briefing judge the same session, so the chip takes the
// payload model id too: a bare `opus` session on a 1M window must not warn
// when its /autocompact value sits under modelSettings.
test('the statusline chip looks up modelSettings with the live model id', () => {
  const { root, env } = userHome({ model: 'opus', modelSettings: { 'claude-opus-5-5': { autoCompactWindow: '500k' } } });
  withEnv(env, () => {
    assert.equal(compactWindowWarningForStatusline(root, null, { liveWindow: 1_000_000, liveModel: 'claude-opus-5-5[1m]' }), null);
    assert.equal(compactWindowWarningForStatusline(root, null, { liveWindow: 1_000_000, liveModel: 'claude-sonnet-5-5[1m]' }), 'compact-window?');
  });
});

test('compactWindowWarningEnabled follows the config switch', () => {
  assert.equal(compactWindowWarningEnabled({}), true);
  assert.equal(compactWindowWarningEnabled(null), true);
  assert.equal(compactWindowWarningEnabled({ compactWindow: { enabled: false } }), false);
  assert.equal(compactWindowWarningEnabled({ compactWindow: { enabled: true } }), true);
});

test('set --all-models writes the top-level key and removes per-model values in that file', () => {
  const root = sandbox({ modelSettings: {
    'claude-opus-5-5': { autoCompactWindow: 'auto', effortLevel: 'high' },
    'claude-sonnet-5-5': { autoCompactWindow: 900000 },
  } });
  const r = setAutoCompactWindow({ root, scope: 'project', value: '500k', models: 'all' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.removed, [{ key: 'claude-opus-5-5', value: 'auto' }, { key: 'claude-sonnet-5-5', value: 900000 }]);
  const j = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  assert.equal(j.autoCompactWindow, 500000);
  // Other per-model keys survive; an entry left empty is dropped.
  assert.deepEqual(j.modelSettings, { 'claude-opus-5-5': { effortLevel: 'high' } });
});

test('set --model writes only that model entry, the slot /autocompact uses', () => {
  const root = sandbox({ autoCompactWindow: 700000, modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } });
  const r = setAutoCompactWindow({ root, scope: 'project', value: '500k', models: 'claude-opus-5-5[1m]' });
  assert.equal(r.ok, true);
  assert.equal(r.modelKey, 'claude-opus-5-5');
  const j = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  assert.equal(j.autoCompactWindow, 700000, 'top-level untouched');
  assert.deepEqual(j.modelSettings['claude-opus-5-5'], { effortLevel: 'high', autoCompactWindow: 500000 });
  // A model with no entry yet gets one under its canonical name.
  setAutoCompactWindow({ root, scope: 'project', value: '600k', models: 'us.anthropic.claude-sonnet-5-5-20251101-v1:0' });
  const j2 = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  assert.equal(j2.modelSettings['claude-sonnet-5-5'].autoCompactWindow, 600000);
});

test('set --model refuses a bare alias, since the version is unknown', () => {
  for (const settings of [{}, { modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }]) {
    const root = sandbox(settings);
    const before = readFileSync(join(root, '.claude', 'settings.json'), 'utf8');
    const r = setAutoCompactWindow({ root, scope: 'project', value: '500k', models: 'opus[1m]' });
    assert.equal(r.ok, false);
    assert.match(r.error, /full model id/);
    assert.equal(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'), before, 'nothing written');
  }
});

// A Claude Code older than 2.1.288 ignores modelSettings, so a per-model value
// would silently do nothing there. Every place that offers or writes --model
// names the installed version against that floor.
test('the per-model notice names the installed Claude Code version against 2.1.288', () => {
  assert.equal(MODEL_SETTINGS_MIN_VERSION, '2.1.288');
  assert.equal(claudeCodeVersion({ run: () => '2.1.302 (Claude Code)\n' }), '2.1.302');
  assert.equal(claudeCodeVersion({ run: () => { throw new Error('ENOENT'); } }), null);
  assert.equal(modelSettingsSupported('2.1.288'), true);
  assert.equal(modelSettingsSupported('2.1.302'), true);
  assert.equal(modelSettingsSupported('2.1.287'), false);
  assert.equal(modelSettingsSupported(null), null);
  assert.match(modelSettingsNotice('2.1.302', true), /2\.1\.288 이상.*설치된 버전\(2\.1\.302\)에서는 적용됩니다/);
  assert.match(modelSettingsNotice('2.1.200', true), /설치된 버전\(2\.1\.200\)에서는 적용되지 않습니다/);
  assert.match(modelSettingsNotice(null, true), /확인하지 못했습니다/);
  assert.match(modelSettingsNotice('2.1.200', false), /ignored/);
});
