/**
 * Regression tests for the settings.json / CLAUDE.md corruption defects
 * (C1 install-hook overwrite, C3 substring hook matching and group deletion,
 * C4 null/array settings, C5 harness init --force duplication).
 *
 * Nothing here touches the real ~/.claude: HOME and XDG_CONFIG_HOME point into
 * a temp directory before any path is resolved, and every test asserts that.
 * node --test runs each file in its own process, so the override cannot leak.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-settings-safety-'));
const HOME = join(SANDBOX, 'home');
mkdirSync(join(HOME, '.claude'), { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = join(SANDBOX, 'cfg');
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

const {
  readSettings, isOurSubcommand, isLegacyCacheMonitorCommand,
  installKoreanLintHook, removeKoreanLintHook,
  installDoc2mdHook, removeDoc2mdHook,
  installSessionStartHook, installStatusline, uninstallAll,
  migrateLegacyCacheMonitorHook,
} = await import('../src/installer.js');
const { installHook, uninstallHook, withoutCacheMonitorHooks } = await import('../src/hook-manager.js');
const { harnessInit } = await import('../src/harness.js');
const { HARNESS_BLOCK_BEGIN, HARNESS_BLOCK_END } = await import('../src/harness-templates.js');

const SETTINGS = join(HOME, '.claude', 'settings.json');
const BAK = `${SETTINGS}.sprag-bak`;

function put(content) {
  rmSync(BAK, { force: true, recursive: true });
  if (content === null) rmSync(SETTINGS, { force: true });
  else writeFileSync(SETTINGS, content);
}
const bytes = () => readFileSync(SETTINGS);
const json = () => JSON.parse(readFileSync(SETTINGS, 'utf8'));

function quiet(fn) {
  const orig = console.log;
  console.log = () => {};
  const done = () => { console.log = orig; };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.finally(done);
    done();
    return r;
  } catch (e) { done(); throw e; }
}

test('sandbox: the tests resolve ~/.claude inside the temp directory', () => {
  assert.ok(SETTINGS.startsWith(SANDBOX));
});

const UNUSABLE = ['{ not json', 'null', '[]', '[{"hooks":{}}]', '"text"', '42', ''];

// --- C1 ---------------------------------------------------------------------

test('C1: --install-hook leaves a broken / non-object settings.json byte for byte', async () => {
  for (const content of UNUSABLE) {
    put(content);
    const before = bytes();
    process.exitCode = undefined;
    await quiet(() => installHook({ threshold: 0.5 }));
    assert.deepEqual(bytes(), before, `installHook must not write over ${JSON.stringify(content)}`);
    assert.equal(process.exitCode, 1, `failure must be visible for ${JSON.stringify(content)}`);
    assert.equal(existsSync(BAK), false, 'no backup is needed when nothing was written');
  }
  process.exitCode = undefined;
});

test('C1: --uninstall-hook leaves a broken / non-object settings.json byte for byte', async () => {
  for (const content of UNUSABLE) {
    put(content);
    const before = bytes();
    process.exitCode = undefined;
    await quiet(() => uninstallHook());
    assert.deepEqual(bytes(), before);
    assert.equal(process.exitCode, 1);
  }
  process.exitCode = undefined;
});

test('C1: only a missing file starts from an empty object', async () => {
  put(null);
  process.exitCode = undefined;
  await quiet(() => installHook({ threshold: 0.5 }));
  assert.equal(process.exitCode, undefined);
  assert.match(json().hooks.PostToolUse[0].hooks[0].command, /--hook-run --threshold 0\.5/);
});

test('C1: a healthy file keeps the user data and gets one backup', async () => {
  const original = JSON.stringify({ model: 'x', hooks: { PostToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'mine' }] }] } }, null, 2) + '\n';
  put(original);
  await quiet(() => installHook());
  await quiet(() => installHook());
  const s = json();
  assert.equal(s.model, 'x');
  assert.equal(s.hooks.PostToolUse.filter((m) => m.hooks.some((h) => /--hook-run/.test(h.command))).length, 1, 're-install does not duplicate');
  assert.ok(s.hooks.PostToolUse.some((m) => m.hooks.some((h) => h.command === 'mine')));
  assert.ok(existsSync(BAK));
});

// --- C4 ---------------------------------------------------------------------

test('C4: readSettings tells absent, ok and unusable apart', () => {
  put(null);
  assert.deepEqual(readSettings(SETTINGS), { state: 'absent', settings: {} });
  put('{"a":1}');
  assert.deepEqual(readSettings(SETTINGS), { state: 'ok', settings: { a: 1 } });
  for (const content of ['{ nope', 'null', '[]', '7', '"s"']) {
    put(content);
    const r = readSettings(SETTINGS);
    assert.equal(r.state, 'unusable', content);
    assert.equal(typeof r.reason, 'string');
  }
  // A directory where the file should be is a read error, not "absent".
  rmSync(SETTINGS, { force: true });
  mkdirSync(SETTINGS);
  assert.equal(readSettings(SETTINGS).state, 'unusable');
  rmSync(SETTINGS, { recursive: true });
});

test('C4: every installer entry point skips null / array settings without writing or throwing', () => {
  const entries = {
    installStatusline, installSessionStartHook, installKoreanLintHook, installDoc2mdHook,
    removeKoreanLintHook, removeDoc2mdHook, migrateLegacyCacheMonitorHook, uninstallAll,
  };
  for (const content of ['null', '[]', '{ bad']) {
    for (const [name, fn] of Object.entries(entries)) {
      put(content);
      const before = bytes();
      const r = fn();
      assert.equal(r.action, 'skipped', `${name} on ${content}`);
      assert.ok(r.reason, `${name} gives a reason`);
      assert.deepEqual(bytes(), before, `${name} must not write on ${content}`);
    }
  }
});

test('C4: a hooks value that is not an object is skipped, not thrown on', () => {
  for (const hooks of ['"str"', '[]', '7']) {
    put(`{"hooks":${hooks}}`);
    const before = bytes();
    const r = installSessionStartHook();
    assert.equal(r.action, 'skipped');
    assert.deepEqual(bytes(), before);
  }
});

test('C4: a normal install leaves one backup of the previous file and no temp file', () => {
  const original = '{\n  "theme": "dark"\n}\n';
  put(original);
  assert.equal(installSessionStartHook().action, 'created');
  assert.equal(readFileSync(BAK, 'utf8'), original);
  assert.equal(json().theme, 'dark');
  // The backup is overwritten, not accumulated.
  const afterFirst = bytes().toString();
  installKoreanLintHook();
  assert.equal(readFileSync(BAK, 'utf8'), afterFirst);
  const leftovers = readdirSync(join(HOME, '.claude')).filter((n) => n.includes('sprag-tmp'));
  assert.deepEqual(leftovers, []);
});

test('C4: a failed write is not reported as success and the file is unchanged', () => {
  const original = '{"theme":"dark"}\n';
  put(original);
  mkdirSync(BAK); // copyFileSync onto a directory fails, so the backup step fails
  const r = installSessionStartHook();
  assert.equal(r.action, 'skipped');
  assert.match(r.reason, /write failed/);
  assert.equal(readFileSync(SETTINGS, 'utf8'), original);
  rmSync(BAK, { recursive: true });
});

// --- C3 ---------------------------------------------------------------------

test('C3: isOurSubcommand matches our executable plus whole tokens only', () => {
  assert.ok(isOurSubcommand('sprag korean --hook', 'korean', '--hook'));
  assert.ok(isOurSubcommand('claude-token-saver korean --hook', 'korean', '--hook'));
  assert.ok(isOurSubcommand('/usr/local/bin/sprag korean --hook extra', 'korean', '--hook'));
  assert.ok(isOurSubcommand('npx sprag-cli doc2md --hook-prompt', 'doc2md', '--hook-prompt'));
  assert.equal(isOurSubcommand('sprag doc2md --hook-prompt', 'doc2md', '--hook'), false, '--hook is not --hook-prompt');
  assert.equal(isOurSubcommand('echo "sprag korean --hook"', 'korean', '--hook'), false);
  assert.equal(isOurSubcommand('my-tool korean --hook', 'korean', '--hook'), false);
  assert.equal(isOurSubcommand('node ~/probe/sprag-probe.mjs korean --hook', 'korean', '--hook'), false);
  assert.equal(isOurSubcommand('sprag-wrapper korean --hook', 'korean', '--hook'), false);
});

test('C3: only the exact legacy copied-file form counts as the old cache monitor', () => {
  assert.ok(isLegacyCacheMonitorCommand('node "/Users/me/.claude/cache-monitor-hook.cjs" --threshold 0.7'));
  assert.ok(isLegacyCacheMonitorCommand('node /home/me/.claude/cache-monitor-hook.cjs --threshold 0.7'));
  assert.equal(isLegacyCacheMonitorCommand('echo cache-monitor-hook'), false);
  assert.equal(isLegacyCacheMonitorCommand('cat ~/.claude/cache-monitor-hook.cjs'), false);
  assert.equal(isLegacyCacheMonitorCommand('node other.js cache-monitor-hook.cjs'), false);
});

const H = (command, extra = {}) => ({ type: 'command', command, ...extra });

test('C3: removing the korean hook keeps another hook that shares its group', () => {
  put(JSON.stringify({ hooks: { PostToolUse: [
    { matcher: 'Write|Edit|MultiEdit|Bash', hooks: [H('theirs --check'), H('sprag korean --hook', { timeout: 10 })] },
  ] } }));
  assert.equal(removeKoreanLintHook().action, 'removed');
  assert.deepEqual(json().hooks.PostToolUse, [{ matcher: 'Write|Edit|MultiEdit|Bash', hooks: [H('theirs --check')] }]);
});

test('C3: a foreign command that only quotes our text is neither removed nor mistaken for ours', () => {
  const foreign = { matcher: 'Bash', hooks: [H('echo "sprag korean --hook"')] };
  put(JSON.stringify({ hooks: { PostToolUse: [foreign] } }));
  assert.equal(removeKoreanLintHook().action, 'absent');
  assert.deepEqual(json().hooks.PostToolUse, [foreign]);
  // Install must not treat it as "already installed".
  assert.equal(installKoreanLintHook().action, 'created');
  const list = json().hooks.PostToolUse;
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], foreign);
  assert.equal(list[1].hooks[0].command, 'sprag korean --hook');
});

test('C3: doc2md removal is per hook and ignores lookalike commands', () => {
  put(JSON.stringify({ hooks: {
    PreToolUse: [{ matcher: 'Read', hooks: [H('theirs read'), H('sprag doc2md --hook')] }, { matcher: 'Bash', hooks: [H('echo "sprag doc2md --hook"')] }],
    UserPromptSubmit: [{ hooks: [H('sprag doc2md --hook-prompt'), H('theirs prompt')] }],
  } }));
  assert.equal(removeDoc2mdHook().action, 'removed');
  const s = json();
  assert.deepEqual(s.hooks.PreToolUse, [
    { matcher: 'Read', hooks: [H('theirs read')] },
    { matcher: 'Bash', hooks: [H('echo "sprag doc2md --hook"')] },
  ]);
  assert.deepEqual(s.hooks.UserPromptSubmit, [{ hooks: [H('theirs prompt')] }]);
});

test('C3: widening the korean matcher never changes a group someone else shares', () => {
  put(JSON.stringify({ hooks: { PostToolUse: [
    { matcher: 'Write|Edit|MultiEdit', hooks: [H('theirs --check'), H('sprag korean --hook', { timeout: 10 })] },
  ] } }));
  assert.equal(installKoreanLintHook().action, 'updated');
  assert.deepEqual(json().hooks.PostToolUse, [
    { matcher: 'Write|Edit|MultiEdit', hooks: [H('theirs --check')] },
    { matcher: 'Write|Edit|MultiEdit|Bash', hooks: [H('sprag korean --hook', { timeout: 10 })] },
  ]);
});

test('C3: widening the matcher of a group that is only ours still edits it in place', () => {
  put(JSON.stringify({ hooks: { PostToolUse: [
    { matcher: 'Write|Edit|MultiEdit', hooks: [H('sprag korean --hook', { timeout: 10 })] },
  ] } }));
  assert.equal(installKoreanLintHook().action, 'updated');
  assert.equal(json().hooks.PostToolUse.length, 1);
  assert.equal(json().hooks.PostToolUse[0].matcher, 'Write|Edit|MultiEdit|Bash');
});

test('C3: uninstallAll drops our hooks only, including the legacy file form, and keeps neighbours', () => {
  put(JSON.stringify({ hooks: { PostToolUse: [
    { matcher: 'Bash', hooks: [
      H('theirs'),
      H('sprag --hook-run --threshold 0.7'),
      H('node "/h/.claude/cache-monitor-hook.cjs" --threshold 0.7'),
      H('echo cache-monitor-hook'),
    ] },
  ] } }));
  assert.equal(uninstallAll().action, 'removed');
  assert.deepEqual(json().hooks.PostToolUse, [{ matcher: 'Bash', hooks: [H('theirs'), H('echo cache-monitor-hook')] }]);
});

test('C3: migration rewrites only the legacy form, not a command that mentions the file', () => {
  put(JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [
    H('node "/h/.claude/cache-monitor-hook.cjs" --threshold 0.4'),
    H('echo cache-monitor-hook'),
  ] }] } }));
  assert.equal(migrateLegacyCacheMonitorHook().action, 'migrated');
  const cmds = json().hooks.PostToolUse[0].hooks.map((h) => h.command);
  assert.deepEqual(cmds, ['sprag --hook-run --threshold 0.4', 'echo cache-monitor-hook']);
});

test('C3: withoutCacheMonitorHooks keeps a foreign command that quotes --hook-run', () => {
  const groups = [
    { matcher: 'Bash', hooks: [H('echo "sprag --hook-run"'), H('sprag --hook-run --threshold 0.7')] },
  ];
  assert.deepEqual(withoutCacheMonitorHooks(groups), [{ matcher: 'Bash', hooks: [H('echo "sprag --hook-run"')] }]);
});

// --- C5 ---------------------------------------------------------------------

function projectRoot(name) {
  const root = join(SANDBOX, name);
  mkdirSync(root, { recursive: true });
  return root;
}
const countOf = (text, needle) => text.split(needle).length - 1;

test('C5: harness init --force twice leaves exactly one block', () => {
  const root = projectRoot('c5-force');
  const cm = join(root, 'CLAUDE.md');
  writeFileSync(cm, '# My notes\n\nkeep me\n');
  harnessInit({ root, force: true });
  harnessInit({ root, force: true });
  const text = readFileSync(cm, 'utf8');
  assert.equal(countOf(text, HARNESS_BLOCK_BEGIN), 1);
  assert.equal(countOf(text, HARNESS_BLOCK_END), 1);
  assert.match(text, /keep me/);
});

test('C5: a rerun with an identical block writes nothing and reports no change', () => {
  const root = projectRoot('c5-idem');
  writeFileSync(join(root, 'CLAUDE.md'), '# notes\n');
  harnessInit({ root });
  const before = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  for (const force of [false, true]) {
    const r = harnessInit({ root, force });
    assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), before);
    assert.ok(!r.wrote.some((w) => w.includes('CLAUDE.md')), `force=${force}: CLAUDE.md is not in wrote`);
    assert.ok(r.backedUp.length === 0, 'no backup for a no-op');
    assert.ok(r.skipped.some((s) => s.includes('CLAUDE.md')));
  }
});

test('C5: a changed block is replaced in place, with a backup under --force', () => {
  const root = projectRoot('c5-replace');
  const cm = join(root, 'CLAUDE.md');
  writeFileSync(cm, 'top\n');
  harnessInit({ root });
  const stale = readFileSync(cm, 'utf8').replace(HARNESS_BLOCK_END, `old line $&\n${HARNESS_BLOCK_END}`);
  writeFileSync(cm, stale + 'tail\n');
  const r = harnessInit({ root, force: true });
  const text = readFileSync(cm, 'utf8');
  assert.equal(countOf(text, HARNESS_BLOCK_BEGIN), 1);
  assert.ok(!text.includes('old line'));
  assert.match(text, /tail\n$/);
  assert.equal(r.backedUp.length, 1);
  assert.equal(readFileSync(r.backedUp[0], 'utf8'), stale + 'tail\n');
});

test('C5: a begin marker with no end marker is left alone and reported as skipped', () => {
  for (const force of [false, true]) {
    const root = projectRoot(`c5-noend-${force}`);
    const cm = join(root, 'CLAUDE.md');
    const broken = `# mine\n${HARNESS_BLOCK_BEGIN}\nhalf a block, user text after\n`;
    writeFileSync(cm, broken);
    const r = harnessInit({ root, force });
    assert.equal(readFileSync(cm, 'utf8'), broken, `force=${force}`);
    assert.ok(r.skipped.some((s) => s.includes('CLAUDE.md') && /end marker/.test(s)));
    assert.ok(!r.wrote.some((w) => w.includes('CLAUDE.md')));
    assert.equal(r.backedUp.length, 0);
    // The command reads this to end with a failure instead of "initialized".
    assert.equal(r.brokenBlock, true);
  }
});
