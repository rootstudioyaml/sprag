/**
 * The mods in mod/ and the installer entries that load them.
 *
 * A mod is loaded through CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json,
 * a list of absolute paths the user may share with other tools. These tests
 * hold the installer to three things: it adds only its own paths, it repairs a
 * path left by an older install location instead of adding a second one, and
 * removing doc2md, or uninstalling, takes out exactly what it added.
 *
 * HOME and XDG_CONFIG_HOME point into a temp directory before the installer is
 * imported, as in settings-safety.test.js, so the real ~/.claude is never read.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-mod-install-'));
const HOME = join(SANDBOX, 'home');
mkdirSync(join(HOME, '.claude'), { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = join(SANDBOX, 'cfg');
// The installer reads the inherited value to avoid overriding a user's own;
// a developer shell that sets it must not change what these tests see.
delete process.env.CLAUDE_CODE_PLUGIN_DIRS;
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

const {
  modDir, MOD_NAMES, DOC2MD_MOD, DELEGATION_METER_MOD,
  installDelegationMeterMod, installDoc2mdHook, removeDoc2mdHook, uninstallAll, modDirsState,
} = await import('../src/installer.js');

const SETTINGS = join(HOME, '.claude', 'settings.json');
const SEP = process.platform === 'win32' ? ';' : ':';
const KEY = 'CLAUDE_CODE_PLUGIN_DIRS';

const put = (obj) => (obj === null ? rmSync(SETTINGS, { force: true }) : writeFileSync(SETTINGS, JSON.stringify(obj, null, 2)));
const json = () => JSON.parse(readFileSync(SETTINGS, 'utf8'));
const dirs = () => (json().env?.[KEY] ?? '').split(SEP).filter(Boolean);

// The paths `npm pack` would put in the tarball, as npm itself lists them.
//
// Asked of npm rather than read from package.json `files`, because the two can
// disagree: npm 11 does not expand `mod/*/hooks/`, a glob that ends in a
// directory, so v3.63.0 shipped each mod with its manifest alone while a test
// that only looked for that string in `files` passed. Both mods then loaded
// with no hooks and did nothing.
function packedFiles() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const out = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: childEnv({ HOME }),
    encoding: 'utf8', timeout: 120_000,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Set(JSON.parse(out)[0].files.map((f) => f.path));
}

test('every mod the installer names ships as a loadable plugin folder', () => {
  const shipped = packedFiles();
  for (const name of MOD_NAMES) {
    assert.ok(shipped.has(`mod/${name}/.claude-plugin/plugin.json`), `${name}: manifest in the package`);
    assert.equal(JSON.parse(readFileSync(join(modDir(name), '.claude-plugin', 'plugin.json'), 'utf8')).name, name);
    assert.ok(shipped.has(`mod/${name}/hooks/hooks.json`), `${name}: hooks.json in the package`);
    const hooks = JSON.parse(readFileSync(join(modDir(name), 'hooks', 'hooks.json'), 'utf8'));
    for (const mod of hooks.modules) {
      assert.ok(shipped.has(posix.join(`mod/${name}/hooks`, mod)), `${name}: ${mod} in the package`);
    }
  }
  // Nothing beside them: the mods' own tests, and what a Claude Code load
  // writes into the folder (types, tsconfig), stay out of the package.
  const extra = [...shipped].filter((p) => p.startsWith('mod/')
    && !/^mod\/[^/]+\/(?:\.claude-plugin\/plugin\.json|hooks\/.+)$/.test(p));
  assert.deepEqual(extra, []);
});

test('the doc2md mod targets exactly the formats the converter handles', () => {
  // The mod has no Node and cannot load doc2md.cjs, so it carries its own copy
  // of the list. This is where the two are held in step.
  const require = createRequire(import.meta.url);
  const { TARGET_EXTENSIONS } = require('../src/doc2md.cjs');
  const source = readFileSync(join(modDir(DOC2MD_MOD), 'hooks', 'register.ts'), 'utf8');
  const match = source.match(/const TARGET = \/\\\.\(([^)]+)\)\$\/i/);
  assert.ok(match, 'the TARGET regex is where this test expects it');
  assert.deepEqual(match[1].split('|').sort(), TARGET_EXTENSIONS.map((e) => e.slice(1)).sort());
});

test('the doc2md mod runs the CLI by the name cli-name.js gives it', async () => {
  // Like the format list above: the mod cannot import CLI_NAME, so a rename
  // that missed its copy would leave every redirect silently failing over to
  // the settings hook. This is where the copy is held to the source.
  const { CLI_NAME } = await import('../src/cli-name.js');
  const source = readFileSync(join(modDir(DOC2MD_MOD), 'hooks', 'register.ts'), 'utf8');
  const match = source.match(/^const CLI = '([^']+)'$/m);
  assert.ok(match, 'the CLI constant is where this test expects it');
  assert.equal(match[1], CLI_NAME);
  assert.match(source, /\$\.process\.run\(\[CLI, 'doc2md', path\]/, 'the conversion runs through that constant');
});

test('mod tests are .test.tsx, which node --test does not collect', () => {
  // Node 23+ strips types and its test runner then also collects *.test.ts,
  // which would import claude-code/testing and fail `npm test`. The plugin kit
  // runs .test.tsx as well, and Node cannot strip TSX, so it never collects it.
  for (const name of MOD_NAMES) {
    assert.ok(existsSync(join(modDir(name), 'tests')), `${name}: tests folder`);
  }
  const stray = MOD_NAMES.flatMap((name) =>
    readdirSync(join(modDir(name), 'tests')).filter((f) => /\.test\.(c|m)?ts$/.test(f)));
  assert.deepEqual(stray, []);
});

test('the meter is added once and leaves other plugin folders alone', () => {
  put({ env: { [KEY]: `/opt/other-plugin${SEP}/old/lib/node_modules/sprag-cli/mod/${DELEGATION_METER_MOD}`, FOO: 'bar' } });

  // An entry added to a settings.json that was already there is an update
  assert.equal(installDelegationMeterMod().action, 'updated');
  // The stale path from the old install location is replaced, not kept beside it
  assert.deepEqual(dirs(), ['/opt/other-plugin', modDir(DELEGATION_METER_MOD)]);
  assert.equal(json().env.FOO, 'bar');

  assert.equal(installDelegationMeterMod().action, 'exists');
  assert.deepEqual(dirs(), ['/opt/other-plugin', modDir(DELEGATION_METER_MOD)]);
});

test('doc2md on and off carry the doc2md mod with the hooks', () => {
  put(null);
  assert.equal(installDelegationMeterMod().action, 'created');

  const on = installDoc2mdHook();
  assert.equal(on.action, 'created');
  assert.equal(on.modReason, undefined);
  assert.deepEqual(modDirsState(), { [DOC2MD_MOD]: true, [DELEGATION_METER_MOD]: true });
  assert.equal(installDoc2mdHook().action, 'exists', 'a second install changes nothing');

  assert.equal(removeDoc2mdHook().action, 'removed');
  // Only the doc2md mod goes; the meter is not doc2md's to remove
  assert.deepEqual(dirs(), [modDir(DELEGATION_METER_MOD)]);
  assert.equal(removeDoc2mdHook().action, 'absent');
});

test('an env this cannot extend skips the mod but not the doc2md hooks', () => {
  put({ env: 'not an object' });

  assert.equal(installDelegationMeterMod().action, 'skipped');
  const on = installDoc2mdHook();
  assert.equal(on.action, 'created');
  assert.match(on.modReason, /env is not an object/);
  assert.equal(json().env, 'not an object', 'the user value stays as it was');
  assert.ok(Array.isArray(json().hooks.PreToolUse));
});

test('a shell value of the variable is never overridden', () => {
  // settings.json `env` replaces what the shell set, so writing ours there
  // would stop the user's own mods from loading in every session.
  put(null);
  process.env[KEY] = `/home/me/my-mods/tally${SEP}/home/me/my-mods/guard`;
  try {
    const r = installDelegationMeterMod();
    assert.equal(r.action, 'skipped');
    assert.match(r.reason, /set in your shell/);
    assert.match(r.reason, new RegExp(modDir(DELEGATION_METER_MOD).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(existsSync(SETTINGS), false, 'nothing was written');

    // Once settings.json carries a value of its own it already overrides the
    // shell's, so extending it changes nothing the user had working
    put({ env: { [KEY]: '/home/me/my-mods/tally' } });
    assert.equal(installDelegationMeterMod().action, 'updated');
    assert.deepEqual(dirs(), ['/home/me/my-mods/tally', modDir(DELEGATION_METER_MOD)]);
  } finally {
    delete process.env[KEY];
  }
});

test('a shell value holding only sprag mods does not block the install', () => {
  put(null);
  process.env[KEY] = `/old/sprag-cli/mod/${DELEGATION_METER_MOD}`;
  try {
    assert.equal(installDelegationMeterMod().action, 'created');
    assert.deepEqual(dirs(), [modDir(DELEGATION_METER_MOD)]);
  } finally {
    delete process.env[KEY];
  }
});

test('a copy installed through /plugin keeps running alone', () => {
  put({ enabledPlugins: { [`${DOC2MD_MOD}@someone`]: true } });
  const on = installDoc2mdHook();
  assert.equal(on.action, 'created', 'the doc2md hooks still go in');
  assert.match(on.modReason, /already installed as the plugin sprag-doc2md@someone/);
  assert.equal(json().env, undefined);

  // A disabled copy runs nothing, so ours is added
  put({ enabledPlugins: { [`${DOC2MD_MOD}@someone`]: false } });
  assert.equal(installDoc2mdHook().modReason, undefined);
  assert.deepEqual(dirs(), [modDir(DOC2MD_MOD)]);
});

test('uninstall removes every mod path, stale ones included, and nothing else', () => {
  put({
    env: {
      [KEY]: [`/old/sprag-cli/mod/${DOC2MD_MOD}`, '/opt/other-plugin', modDir(DELEGATION_METER_MOD)].join(SEP),
    },
  });
  const u = uninstallAll();
  assert.equal(u.action, 'removed');
  assert.ok(u.removed.includes(`env.${KEY} (mods)`), JSON.stringify(u.removed));
  assert.deepEqual(dirs(), ['/opt/other-plugin']);

  // When the mods were all the env held, env goes with them
  put({ env: { [KEY]: modDir(DOC2MD_MOD) } });
  uninstallAll();
  assert.equal(json().env, undefined);
});
