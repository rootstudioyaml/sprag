/**
 * permission-secrets — approval-list entries that hold secrets. Everything runs
 * against a temporary home, a temporary state directory and a temporary git
 * repository; the real ~/.claude is never touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, utimesSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  scanPermissionSecrets, scanSettingsFile, fixSettingsFile, secretsNotice, gitState, settingsTargets,
} from '../src/permission-secrets.js';
import { childEnv } from './helpers/child-env.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.js');
const TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
const PW_CMD = 'Bash(mysql --password=hunter2pw -h db)';

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'cts-secrets-'));
  const home = join(dir, 'home');
  const project = join(dir, 'project');
  const state = join(dir, 'state');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(project, '.claude'), { recursive: true });
  mkdirSync(state, { recursive: true });
  const write = (base, name, json) => writeFileSync(join(base, '.claude', name), JSON.stringify(json, null, 2) + '\n');
  return { dir, home, project, state, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });

test('scanSettingsFile flags allow/ask/deny entries and never carries the value', () => {
  const s = sandbox();
  try {
    s.write(s.project, 'settings.local.json', {
      permissions: {
        allow: ['Bash(git status)', PW_CMD, `Bash(curl -H "Authorization: Bearer ${TOKEN}" x)`],
        ask: [`Bash(echo ${TOKEN})`],
        deny: ['Bash(rm -rf /)', `Bash(cat ${TOKEN})`],
      },
    });
    const scan = scanSettingsFile(join(s.project, '.claude', 'settings.local.json'));
    assert.deepEqual(scan.entries.map((e) => `${e.list}#${e.index}`), ['allow#2', 'allow#3', 'ask#1', 'deny#2']);
    const dump = JSON.stringify(scan);
    assert.ok(!dump.includes(TOKEN) && !dump.includes('hunter2pw'), 'a preview must not hold the value');
    assert.match(scan.entries[0].preview, /--password=\[redacted\]/);
  } finally { s.cleanup(); }
});

test('a clean, missing or malformed file yields no entries', () => {
  const s = sandbox();
  try {
    s.write(s.home, 'settings.json', { permissions: { allow: ['Bash(git status)', 'Read(*)'] }, env: { FOO: 'bar' } });
    writeFileSync(join(s.project, '.claude', 'settings.json'), '{not json');
    const found = scanPermissionSecrets({ home: s.home, root: s.project });
    assert.deepEqual(found.map((f) => f.entries.length), [0]);
    assert.equal(scanSettingsFile(join(s.home, '.claude', 'settings.local.json')), null);
  } finally { s.cleanup(); }
});

test('the home directory reached as the project is scanned once', () => {
  const s = sandbox();
  try {
    s.write(s.home, 'settings.json', {});
    assert.equal(settingsTargets({ home: s.home, root: s.home }).filter((t) => t.name === 'settings.json').length, 1);
  } finally { s.cleanup(); }
});

test('git state: tracked, untracked and ignored; a folder that is no repository gives null', () => {
  const s = sandbox();
  try {
    const shared = join(s.project, '.claude', 'settings.json');
    const local = join(s.project, '.claude', 'settings.local.json');
    s.write(s.project, 'settings.json', { permissions: { allow: [PW_CMD] } });
    s.write(s.project, 'settings.local.json', { permissions: { allow: [PW_CMD] } });
    assert.equal(gitState(shared), null, 'no repository yet');
    git(s.project, 'init', '-q');
    git(s.project, 'add', '.claude/settings.json');
    writeFileSync(join(s.project, '.gitignore'), '.claude/settings.local.json\n');
    assert.deepEqual(gitState(shared), { tracked: true, ignored: false });
    assert.deepEqual(gitState(local), { tracked: false, ignored: true });
    const found = scanPermissionSecrets({ home: s.home, root: s.project });
    const byName = Object.fromEntries(found.map((f) => [f.name, f]));
    assert.equal(byName['settings.json'].git.tracked, true);
    assert.equal(byName['settings.local.json'].git.ignored, true);
  } finally { s.cleanup(); }
});

test('fix backs the original up as owner-only, removes allow/ask hits and keeps deny and the rest', () => {
  const s = sandbox();
  try {
    const file = join(s.project, '.claude', 'settings.local.json');
    s.write(s.project, 'settings.local.json', {
      model: 'opus',
      permissions: {
        allow: ['Bash(git status)', PW_CMD, `Bash(echo ${TOKEN})`, 'Read(*)'],
        ask: [`Bash(x ${TOKEN})`, 'Bash(npm publish)'],
        deny: ['Bash(rm -rf /)', `Bash(cat ${TOKEN})`],
      },
    });
    const original = readFileSync(file, 'utf8');
    const res = fixSettingsFile(file, { dir: s.state, now: new Date('2026-11-09T01:02:03.456Z') });
    assert.equal(res.removed, 3);
    assert.ok(res.backup.startsWith(join(s.state, 'backups', '2026-11-09T01-02-03-456Z')), res.backup);
    assert.equal(readFileSync(res.backup, 'utf8'), original, 'the backup is the untouched original');
    if (process.platform !== 'win32') assert.equal(statSync(res.backup).mode & 0o777, 0o600);
    const after = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(after.permissions.allow, ['Bash(git status)', 'Read(*)']);
    assert.deepEqual(after.permissions.ask, ['Bash(npm publish)']);
    assert.deepEqual(after.permissions.deny, ['Bash(rm -rf /)', `Bash(cat ${TOKEN})`], 'deny entries block commands and stay');
    assert.equal(after.model, 'opus');
    assert.ok(!readdirSync(dirname(file)).some((n) => n.includes('sprag-bak') || n.includes('sprag-tmp')), 'no copy of the secret is left beside the file');
    // a second run finds nothing to remove and writes no second backup
    assert.equal(fixSettingsFile(file, { dir: s.state }).removed, 0);
  } finally { s.cleanup(); }
});

test('two files with the same name get separate backups in one folder', () => {
  const s = sandbox();
  try {
    s.write(s.home, 'settings.local.json', { permissions: { allow: [PW_CMD] } });
    s.write(s.project, 'settings.local.json', { permissions: { allow: [PW_CMD] } });
    const now = new Date('2026-11-09T00:00:00Z');
    const a = fixSettingsFile(join(s.home, '.claude', 'settings.local.json'), { dir: s.state, now });
    const b = fixSettingsFile(join(s.project, '.claude', 'settings.local.json'), { dir: s.state, now });
    assert.notEqual(a.backup, b.backup);
    assert.ok(existsSync(a.backup) && existsSync(b.backup));
  } finally { s.cleanup(); }
});

test('session notice: shown once per mtime, again after the file changes, never when off', () => {
  const s = sandbox();
  try {
    const file = join(s.project, '.claude', 'settings.local.json');
    s.write(s.project, 'settings.local.json', { permissions: { allow: [PW_CMD, `Bash(echo ${TOKEN})`] } });
    const first = secretsNotice({ home: s.home, root: s.project, lang: 'en', dir: s.state });
    assert.match(first, /^✇ \[sprag\] 2 entries in the permission list of .*settings\.local\.json look like they hold secrets\. Tell the user/);
    assert.ok(!first.includes('git tracks'));
    assert.equal(secretsNotice({ home: s.home, root: s.project, lang: 'en', dir: s.state }), null, 'same mtime: quiet');
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    assert.ok(secretsNotice({ home: s.home, root: s.project, lang: 'ko', dir: s.state }), 'a new mtime announces again');
    assert.equal(secretsNotice({ home: s.home, root: s.project, lang: 'ko', dir: s.state, enabled: false }), null);
  } finally { s.cleanup(); }
});

test('session notice: Korean wording and the tracked-by-git warning', () => {
  const s = sandbox();
  try {
    s.write(s.project, 'settings.json', { permissions: { allow: [PW_CMD] } });
    git(s.project, 'init', '-q');
    git(s.project, 'add', '.claude/settings.json');
    const ko = secretsNotice({ home: s.home, root: s.project, lang: 'ko', dir: s.state });
    assert.match(ko, /승인 목록 1개 항목에 비밀 값으로 보이는 문자열이 있습니다\. 이 파일은 git이 추적하고 있어 커밋되면 공개될 수 있습니다\. 사용자에게 알리고 sprag secrets 로 확인한 뒤 sprag secrets fix 로 지우라고 안내하십시오\.$/);
    assert.ok(!ko.includes('hunter2pw'));
  } finally { s.cleanup(); }
});

test('session notice: fixing the file clears the state so a new secret announces again', () => {
  const s = sandbox();
  try {
    const file = join(s.project, '.claude', 'settings.local.json');
    s.write(s.project, 'settings.local.json', { permissions: { allow: [PW_CMD] } });
    assert.ok(secretsNotice({ home: s.home, root: s.project, dir: s.state }));
    fixSettingsFile(file, { dir: s.state });
    assert.equal(secretsNotice({ home: s.home, root: s.project, dir: s.state }), null);
    s.write(s.project, 'settings.local.json', { permissions: { allow: [PW_CMD] } });
    assert.ok(secretsNotice({ home: s.home, root: s.project, dir: s.state }));
  } finally { s.cleanup(); }
});

// ---- the command, through the CLI ----

function cli(s, args, { input } = {}) {
  const env = childEnv({ HOME: s.home, XDG_CONFIG_HOME: s.state, APPDATA: s.state, NO_COLOR: '1', CI: '1' });
  return execFileSync(process.execPath, [CLI, ...args], { env, cwd: s.project, encoding: 'utf8', timeout: 60_000, input });
}

test('sprag secrets prints counts, numbers and masked previews, never a value; exit 0', () => {
  const s = sandbox();
  try {
    s.write(s.project, 'settings.local.json', { permissions: { allow: [PW_CMD, `Bash(echo ${TOKEN})`] } });
    const out = cli(s, ['secrets']);
    assert.match(out, /settings\.local\.json/);
    assert.match(out, /allow #1/);
    assert.match(out, /allow #2/);
    assert.ok(!out.includes(TOKEN) && !out.includes('hunter2pw'), out);
    assert.match(out, /--password=\[redacted\]/);
  } finally { s.cleanup(); }
});

test('sprag secrets on a clean setup says so in one line', () => {
  const s = sandbox();
  try {
    s.write(s.project, 'settings.local.json', { permissions: { allow: ['Bash(git status)'] } });
    const out = cli(s, ['secrets']).trim();
    assert.equal(out.split('\n').length, 1);
  } finally { s.cleanup(); }
});

test('sprag secrets fix without --yes and without a terminal changes nothing', () => {
  const s = sandbox();
  try {
    const file = join(s.project, '.claude', 'settings.local.json');
    s.write(s.project, 'settings.local.json', { permissions: { allow: [PW_CMD] } });
    const before = readFileSync(file, 'utf8');
    const out = cli(s, ['secrets', 'fix']);
    assert.match(out, /--yes/);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.ok(!existsSync(join(s.state, 'claude-token-saver', 'backups')));
  } finally { s.cleanup(); }
});

test('sprag secrets fix --yes removes the entries, backs up, and says to rotate', () => {
  const s = sandbox();
  try {
    const file = join(s.project, '.claude', 'settings.local.json');
    s.write(s.project, 'settings.local.json', { permissions: { allow: [PW_CMD, 'Bash(git status)'] } });
    const out = cli(s, ['secrets', 'fix', '--yes']);
    assert.match(out, /rotate/i);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).permissions.allow, ['Bash(git status)']);
    const backups = join(s.state, 'claude-token-saver', 'backups');
    const [stamp] = readdirSync(backups);
    assert.ok(readFileSync(join(backups, stamp, 'settings.local.json'), 'utf8').includes('hunter2pw'));
    assert.ok(!out.includes('hunter2pw'));
  } finally { s.cleanup(); }
});

test('sprag secrets off and on toggle cfg.secretScan', () => {
  const s = sandbox();
  try {
    cli(s, ['secrets', 'off']);
    const cfgPath = join(s.state, 'claude-token-saver', 'config.json');
    assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).secretScan, false);
    cli(s, ['secrets', 'on']);
    assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).secretScan, undefined);
  } finally { s.cleanup(); }
});
