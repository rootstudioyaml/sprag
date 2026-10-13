/**
 * cowork-sync: the ratchet copies for the Claude app's Cowork tab.
 *
 * Every case runs in a child process against a throwaway HOME and a throwaway
 * XDG_CONFIG_HOME, so the real ~/.claude and the real Cowork session folder are
 * never read or written. Most cases call syncCoworkRatchets() through a tiny
 * `node -e` driver (to read the result object); the integration cases go
 * through the real CLI, because a unit call cannot show that the hook and the
 * `cowork` subcommand actually reach the sync.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { childEnv } from './helpers/child-env.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.js');
const MODULE_URL = pathToFileURL(join(ROOT, 'src', 'cowork-sync.js')).href;
const MARKER = '<!-- sprag:cowork-ratchet -->';
const PATTERN = '**/.claude/rules/sprag-cowork-ratchet.md';
const COPY = join('.claude', 'rules', 'sprag-cowork-ratchet.md');
const SUPPORTED = process.platform === 'darwin' || process.platform === 'win32';

function haveGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cts-cowork-')));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const appdata = join(home, 'AppData', 'Roaming');
  const env = childEnv({
    HOME: home, XDG_CONFIG_HOME: join(dir, 'cfg'), NO_COLOR: '1', CTS_LANG: 'ko',
    ...(process.platform === 'win32' ? { APPDATA: appdata } : {}),
  });
  const sessionsRoot = process.platform === 'win32'
    ? join(appdata, 'Claude-3p', 'local-agent-mode-sessions')
    : join(home, 'Library', 'Application Support', 'Claude-3p', 'local-agent-mode-sessions');

  const run = (args, input) => execFileSync(process.execPath, [CLI, ...args], {
    cwd: dir, env, encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout: 120_000 });
  const call = (expr) => JSON.parse(execFileSync(process.execPath, [
    '--input-type=module', '-e',
    `import * as m from ${JSON.stringify(MODULE_URL)}; const r = await (async () => (${expr}))(); console.log(JSON.stringify(r));`,
  ], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }));
  const sync = (opts = {}) => call(`m.syncCoworkRatchets(${JSON.stringify({ discover: true, ...opts })})`);

  const folder = (name) => { const p = join(dir, name); mkdirSync(p, { recursive: true }); return p; };
  let n = 0;
  const session = (folders) => {
    const d = join(sessionsRoot, 'o', 'u');
    mkdirSync(d, { recursive: true });
    n += 1;
    writeFileSync(join(d, `local_${n}.json`), JSON.stringify({ userSelectedFolders: folders }));
  };
  const sources = (tag = 'v1') => {
    writeFileSync(join(home, '.claude', 'ratchet-model.md'), `MODEL-RULES ${tag}\n`);
    writeFileSync(join(home, '.claude', 'ratchet-preset.md'), `PRESET-RULES ${tag}\n`);
    writeFileSync(join(home, '.claude', 'ratchet.md'), `PLAIN-RULES ${tag}\n`);
  };
  const settingsPath = join(home, '.claude', 'settings.json');
  return { dir, home, env, run, call, sync, folder, session, sources, settingsPath };
}

const countOf = (text, needle) => text.split(needle).length - 1;

test('sync writes the copy with the marker and all three sources', { skip: !SUPPORTED }, (t) => {
  const s = sandbox(t);
  const a = s.folder('projA');
  s.sources();
  s.session([a]);
  const r = s.sync();
  assert.deepEqual(r.written, [a]);
  const text = readFileSync(join(a, COPY), 'utf8');
  assert.equal(text.split('\n')[0], MARKER);
  for (const body of ['MODEL-RULES v1', 'PRESET-RULES v1', 'PLAIN-RULES v1']) assert.ok(text.includes(body), body);
});

test('a second sync rewrites nothing, and a changed source updates the copy', { skip: !SUPPORTED }, (t) => {
  const s = sandbox(t);
  const a = s.folder('projA');
  s.sources();
  s.session([a]);
  s.sync();
  const second = s.sync();
  assert.deepEqual(second.written, []);
  assert.deepEqual(second.unchanged, [a]);
  s.sources('v2');
  const third = s.sync();
  assert.deepEqual(third.written, [a]);
  assert.ok(readFileSync(join(a, COPY), 'utf8').includes('MODEL-RULES v2'));
});

test('a same-named file without the marker is never overwritten', { skip: !SUPPORTED }, (t) => {
  const s = sandbox(t);
  const a = s.folder('projA');
  mkdirSync(join(a, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(a, COPY), 'my own rules\n');
  s.sources();
  s.session([a]);
  const r = s.sync();
  assert.deepEqual(r.written, []);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].dir, a);
  assert.equal(r.skipped[0].reason, 'not-owned');
  assert.equal(readFileSync(join(a, COPY), 'utf8'), 'my own rules\n');
});

test('the home directory and ~/.claude are never written to', { skip: !SUPPORTED }, (t) => {
  const s = sandbox(t);
  s.sources();
  s.session([s.home, join(s.home, '.claude')]);
  const r = s.sync();
  assert.deepEqual(r.written, []);
  assert.deepEqual(r.skipped.map((x) => x.dir).sort(), [s.home, join(s.home, '.claude')].sort());
  assert.ok(!existsSync(join(s.home, COPY)));
  assert.ok(!existsSync(join(s.home, '.claude', COPY)));
  assert.ok(!existsSync(s.settingsPath), 'no folder was served, so settings.json stays untouched');
});

test('a git folder gets exactly one info/exclude line, however often it syncs', { skip: !SUPPORTED || !haveGit() }, (t) => {
  const s = sandbox(t);
  const a = s.folder('projA');
  execFileSync('git', ['init', '-q', a], { stdio: 'ignore' });
  s.sources();
  s.session([a]);
  s.sync();
  s.sources('v2'); // force a rewrite on the second pass too
  s.sync();
  s.sync();
  const exclude = readFileSync(join(a, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(countOf(exclude, '/.claude/rules/sprag-cowork-ratchet.md'), 1);
  assert.ok(!existsSync(join(a, '.gitignore')), 'the committed .gitignore is not touched');
});

test('settings.json gets the exclude pattern once, keeps other keys, and stays absent without folders', { skip: !SUPPORTED }, (t) => {
  const s = sandbox(t);
  s.sources();
  s.sync(); // no Cowork sessions at all
  assert.ok(!existsSync(s.settingsPath));

  writeFileSync(s.settingsPath, JSON.stringify({ theme: 'dark', claudeMdExcludes: ['**/other.md'] }));
  const a = s.folder('projA');
  s.session([a]);
  s.sync();
  s.sync();
  const settings = JSON.parse(readFileSync(s.settingsPath, 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.deepEqual(settings.claudeMdExcludes, ['**/other.md', PATTERN]);
});

test('removal deletes only marked copies and takes only our pattern out of settings.json', { skip: !SUPPORTED }, (t) => {
  const s = sandbox(t);
  const a = s.folder('projA');
  const b = s.folder('projB');
  mkdirSync(join(b, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(b, COPY), 'user file\n');
  writeFileSync(s.settingsPath, JSON.stringify({ theme: 'dark' }));
  s.sources();
  s.session([a, b]);
  s.sync();
  assert.ok(existsSync(join(a, COPY)));
  s.run(['cowork', 'off']);
  assert.ok(!existsSync(join(a, COPY)));
  assert.ok(existsSync(join(a, '.claude', 'rules')), 'the rules directory stays');
  assert.equal(readFileSync(join(b, COPY), 'utf8'), 'user file\n');
  const settings = JSON.parse(readFileSync(s.settingsPath, 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.claudeMdExcludes, undefined);
  // With sync off, a later sync (what the hook runs) writes nothing.
  assert.deepEqual(s.sync().written, []);
  assert.ok(!existsSync(join(a, COPY)));
});

test('the real CLI reaches the sync: route-scan --hook and cowork sync', { skip: !SUPPORTED }, (t) => {
  const s = sandbox(t);
  const a = s.folder('projA');
  s.sources();
  s.session([a]);

  s.run(['route-scan', '--hook'], '{}');
  const viaHook = readFileSync(join(a, COPY), 'utf8');
  assert.equal(viaHook.split('\n')[0], MARKER);
  assert.ok(viaHook.includes('PLAIN-RULES v1'));

  rmSync(join(a, COPY));
  s.run(['cowork', 'sync']);
  assert.equal(readFileSync(join(a, COPY), 'utf8'), viaHook);

  const status = s.run(['cowork']);
  assert.ok(status.includes(a));
});

test('exclude removes the copy and include brings it back', { skip: !SUPPORTED }, (t) => {
  const s = sandbox(t);
  const a = s.folder('projA');
  s.sources();
  s.session([a]);
  s.run(['cowork', 'sync']);
  assert.ok(existsSync(join(a, COPY)));
  s.run(['cowork', 'exclude', a]);
  assert.ok(!existsSync(join(a, COPY)));
  s.run(['cowork', 'sync']);
  assert.ok(!existsSync(join(a, COPY)));
  s.run(['cowork', 'include', a]);
  assert.ok(existsSync(join(a, COPY)));
});

test('the codex agent writes nothing', { skip: !SUPPORTED }, (t) => {
  const s = sandbox(t);
  const a = s.folder('projA');
  s.sources();
  s.session([a]);
  const r = s.sync({ agent: 'codex' });
  assert.deepEqual(r, { written: [], unchanged: [], skipped: [], removed: [] });
  assert.ok(!existsSync(join(a, COPY)));
  assert.ok(!existsSync(s.settingsPath));
});
