/**
 * Organization minimum version: the rules pull stores it, a session start
 * below it starts a detached background upgrade, `upgrade --org-policy` does
 * the install, and the next session reports the outcome. Every spawn, install
 * command and registry call is injected; temp HOME / XDG_CONFIG_HOME /
 * APPDATA / CODEX_HOME keep the real machine out of it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncTeam, withRulesMeta, saveTeamState, loadTeamState, teamRulesCachePath } from '../src/team-sync.js';
import { userDataDir } from '../src/paths.js';
import {
  parseMinVersion, orgUpgradeTarget, maybeStartOrgUpgrade, orgUpgradeNotice, orgPolicyOffer,
  readOrgUpgrade, writeOrgUpgrade, orgUpgradeLogPath, ORG_UPGRADE_INFLIGHT_MS, ORG_UPGRADE_RETRY_MS,
} from '../src/org-upgrade.js';
import { updateOffer } from '../src/update-notice.js';
import { runOrgPolicy, orgUpgradeCommands } from '../src/commands/upgrade.js';
import { upgradeCommand } from '../src/update-check.js';
import { CLI_ENTRY } from '../src/cli-entry.js';

const KEYS = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA', 'CODEX_HOME', 'SPRAG_NO_TEAM_SYNC', 'SPRAG_TEAM_TOKEN', 'SPRAG_DETACHED_CHILD',
  'SPRAG_NO_UPDATE_CHECK', 'NO_UPDATE_NOTIFIER', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'];

function isolate(t) {
  const root = mkdtempSync(join(tmpdir(), 'sprag-orgup-'));
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.HOME = root;
  process.env.USERPROFILE = root; // os.homedir() reads USERPROFILE on Windows, not HOME
  process.env.XDG_CONFIG_HOME = root;
  process.env.APPDATA = root;
  process.env.CODEX_HOME = join(root, '.codex');
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const dir = userDataDir();
  mkdirSync(dir, { recursive: true });
  // A package root without a .git entry, so the dev-checkout guard lets the start through.
  const pkgRoot = join(root, 'pkg');
  mkdirSync(pkgRoot, { recursive: true });
  return { root, dir, pkgRoot };
}

const joined = (extra = {}) => ({ version: 1, memberKey: 'spk_secret', teamName: 'Acme', plan: 'pro', ...extra });

function spawnRecorder() {
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  spawn.calls = calls;
  return spawn;
}

function fakeFetch(body) {
  return async (url, init) => {
    const fn = url.split('/rpc/')[1];
    const r = typeof body === 'function' ? body(fn, JSON.parse(init.body)) : body[fn];
    return { ok: true, status: 200, json: async () => (r === undefined ? true : r) };
  };
}

// ---------------------------------------------------------------- rules pull

test('withRulesMeta stores a valid minimum, clears it on null or a malformed value, keeps it when the key is absent', () => {
  const base = { memberKey: 'k', minVersion: '3.80.0' };
  assert.equal(withRulesMeta(base, { min_version: '3.84.0' }, 1).minVersion, '3.84.0');
  assert.equal(withRulesMeta(base, { min_version: null }, 1).minVersion, null);
  for (const bad of ['3.84', 'v3.84.0', '3.84.0-beta', '', 5, {}]) {
    assert.equal(withRulesMeta(base, { min_version: bad }, 1).minVersion, null, String(bad));
  }
  assert.equal(withRulesMeta(base, { team_name: 'x' }, 1).minVersion, '3.80.0', 'an old server omits the key');
  assert.equal('minVersion' in withRulesMeta({ memberKey: 'k' }, { team_name: 'x' }, 1), false);
});

test('a rules pull writes minVersion to the cache file and the state; an old server leaves the state alone', async (t) => {
  const { dir } = isolate(t);
  saveTeamState(joined(), dir);
  const now = Date.now();
  await syncTeam({ dir, now, env: {}, rulesOnly: true, force: true,
    fetch: fakeFetch({ team_rules_get: { team_name: 'Acme', plan: 'pro', rules: [], removed: [], min_version: '3.84.0' } }) });
  assert.equal(JSON.parse(readFileSync(teamRulesCachePath(dir), 'utf8')).minVersion, '3.84.0');
  assert.equal(loadTeamState(dir).minVersion, '3.84.0');

  await syncTeam({ dir, now: now + 1, env: {}, rulesOnly: true, force: true,
    fetch: fakeFetch({ team_rules_get: { team_name: 'Acme', plan: 'pro', rules: [], removed: [] } }) });
  assert.equal(JSON.parse(readFileSync(teamRulesCachePath(dir), 'utf8')).minVersion, null, 'the cache records what the response carried');
  assert.equal(loadTeamState(dir).minVersion, '3.84.0', 'absent key: state untouched');

  await syncTeam({ dir, now: now + 2, env: {}, rulesOnly: true, force: true,
    fetch: fakeFetch({ team_rules_get: { team_name: 'Acme', plan: 'pro', rules: [], removed: [], min_version: null } }) });
  assert.equal(loadTeamState(dir).minVersion, null, 'null clears it');
});

// ---------------------------------------------------------------- target

test('parseMinVersion accepts only X.Y.Z', () => {
  assert.equal(parseMinVersion('3.84.0'), '3.84.0');
  assert.equal(parseMinVersion(' 3.84.0 '), '3.84.0');
  for (const bad of [null, undefined, '', '3', '3.84', '3.84.0.1', 'v3.84.0', '3.84.0-rc.1', 384, {}]) assert.equal(parseMinVersion(bad), null);
});

test('orgUpgradeTarget: below the minimum returns it; equal, above, unset, invalid and left return null', () => {
  assert.equal(orgUpgradeTarget('3.83.0', joined({ minVersion: '3.84.0' })), '3.84.0');
  assert.equal(orgUpgradeTarget('3.9.9', joined({ minVersion: '3.10.0' })), '3.10.0', 'numeric, not lexical');
  assert.equal(orgUpgradeTarget('3.84.0', joined({ minVersion: '3.84.0' })), null);
  assert.equal(orgUpgradeTarget('3.85.0', joined({ minVersion: '3.84.0' })), null);
  assert.equal(orgUpgradeTarget('3.83.0', joined()), null);
  assert.equal(orgUpgradeTarget('3.83.0', joined({ minVersion: 'banana' })), null);
  assert.equal(orgUpgradeTarget('3.83.0', joined({ minVersion: '3.84.0', left: true })), null);
  assert.equal(orgUpgradeTarget('3.83.0', {}), null);
  assert.equal(orgUpgradeTarget('3.83.0', null), null);
  assert.equal(orgUpgradeTarget('', joined({ minVersion: '3.84.0' })), null, 'an unknown running version is not acted on');
});

// ---------------------------------------------------------------- start

test('maybeStartOrgUpgrade spawns once with the right arguments, then holds while the attempt is in flight', (t) => {
  const { dir, pkgRoot } = isolate(t);
  saveTeamState(joined({ minVersion: '3.84.0' }), dir);
  const spawn = spawnRecorder();
  const now = Date.now();
  const opts = { agent: 'claude', env: {}, now, dir, spawn, root: pkgRoot, isAlive: () => true };
  const r1 = maybeStartOrgUpgrade('3.83.0', opts);
  assert.deepEqual(r1, { status: 'started', target: '3.84.0' });
  assert.equal(spawn.calls.length, 1);
  assert.deepEqual(spawn.calls[0].args, [CLI_ENTRY, 'upgrade', '--org-policy', '--agent', 'claude']);
  assert.equal(spawn.calls[0].opts.detached, true);
  assert.equal(spawn.calls[0].opts.env.SPRAG_DETACHED_CHILD, '1');
  const rec = readOrgUpgrade(dir);
  assert.equal(rec.target, '3.84.0');
  assert.equal(rec.from, '3.83.0');
  assert.equal(rec.startedAt, now);
  assert.equal(rec.announced, false);

  assert.equal(maybeStartOrgUpgrade('3.83.0', { ...opts, now: now + 1000 }).status, 'in-flight');
  assert.equal(spawn.calls.length, 1, 'not again while in flight');

  // A recorded pid that died, or an attempt older than 30 minutes, is not in flight.
  writeOrgUpgrade({ pid: 4242 }, dir);
  assert.equal(maybeStartOrgUpgrade('3.83.0', { ...opts, now: now + 2000, isAlive: () => false }).status, 'started');
  assert.equal(spawn.calls.length, 2);
  assert.equal(maybeStartOrgUpgrade('3.83.0', { ...opts, now: now + 2000 + ORG_UPGRADE_INFLIGHT_MS + 1, isAlive: () => true }).status, 'started');
  assert.equal(spawn.calls.length, 3);
});

test('maybeStartOrgUpgrade passes the Codex agent through', (t) => {
  const { dir, pkgRoot } = isolate(t);
  saveTeamState(joined({ minVersion: '3.84.0' }), dir);
  const spawn = spawnRecorder();
  maybeStartOrgUpgrade('3.83.0', { agent: 'codex', env: {}, dir, spawn, root: pkgRoot });
  assert.deepEqual(spawn.calls[0].args.slice(1), ['upgrade', '--org-policy', '--agent', 'codex']);
});

test('maybeStartOrgUpgrade waits an hour after an attempt ends, success or failure', (t) => {
  const { dir, pkgRoot } = isolate(t);
  saveTeamState(joined({ minVersion: '3.84.0' }), dir);
  const spawn = spawnRecorder();
  const now = Date.now();
  const opts = { env: {}, dir, spawn, root: pkgRoot };
  writeOrgUpgrade({ target: '3.84.0', startedAt: now - 120000, finishedAt: now - 60000, ok: false, error: 'boom' }, dir);
  assert.equal(maybeStartOrgUpgrade('3.83.0', { ...opts, now }).status, 'cooldown');
  writeOrgUpgrade({ ok: true, error: null }, dir);
  assert.equal(maybeStartOrgUpgrade('3.83.0', { ...opts, now }).status, 'cooldown', 'a success that left this copy below the minimum does not loop');
  assert.equal(spawn.calls.length, 0);
  assert.equal(maybeStartOrgUpgrade('3.83.0', { ...opts, now: now - 60000 + ORG_UPGRADE_RETRY_MS + 1 }).status, 'started');
  assert.equal(spawn.calls.length, 1);
});

test('maybeStartOrgUpgrade never starts from a detached child, a dev checkout, or without a target', (t) => {
  const { dir, root, pkgRoot } = isolate(t);
  saveTeamState(joined({ minVersion: '3.84.0' }), dir);
  const spawn = spawnRecorder();
  assert.equal(maybeStartOrgUpgrade('3.83.0', { env: { SPRAG_DETACHED_CHILD: '1' }, dir, spawn, root: pkgRoot }).status, 'child');

  const dev = join(root, 'dev');
  mkdirSync(join(dev, '.git'), { recursive: true });
  assert.equal(maybeStartOrgUpgrade('3.83.0', { env: {}, dir, spawn, root: dev }).status, 'dev');
  const devFile = join(root, 'dev2');
  mkdirSync(devFile, { recursive: true });
  writeFileSync(join(devFile, '.git'), 'gitdir: /elsewhere\n'); // a worktree has a .git file
  assert.equal(maybeStartOrgUpgrade('3.83.0', { env: {}, dir, spawn, root: devFile }).status, 'dev');

  assert.equal(maybeStartOrgUpgrade('3.84.0', { env: {}, dir, spawn, root: pkgRoot }).status, 'none');
  assert.equal(spawn.calls.length, 0);
  assert.equal(existsSync(join(dir, 'org-upgrade.json')), false, 'nothing recorded for the skipped cases');
});

test('maybeStartOrgUpgrade records a failure when the spawn throws', (t) => {
  const { dir, pkgRoot } = isolate(t);
  saveTeamState(joined({ minVersion: '3.84.0' }), dir);
  const spawn = () => { throw new Error('EAGAIN'); };
  const r = maybeStartOrgUpgrade('3.83.0', { env: {}, dir, spawn, root: pkgRoot });
  assert.equal(r.status, 'spawn-failed');
  const rec = readOrgUpgrade(dir);
  assert.equal(rec.ok, false);
  assert.match(rec.error, /EAGAIN/);
});

// ---------------------------------------------------------------- notices

test('orgUpgradeNotice: started, in both languages, never tells the model to install', () => {
  const ko = orgUpgradeNotice('3.83.0', { lang: 'ko', status: { status: 'started', target: '3.84.0' } });
  assert.match(ko, /조직 정책에 따라 최소 버전 v3\.84\.0 가 필요해 백그라운드에서 업그레이드를 시작했습니다\. 다음 세션부터 새 버전이 적용됩니다\./);
  const en = orgUpgradeNotice('3.83.0', { lang: 'en', status: { status: 'started', target: '3.84.0' } });
  assert.match(en, /v3\.84\.0/);
  assert.match(en, /started in the background/);
  for (const text of [ko, en]) {
    assert.doesNotMatch(text, /npm|sprag upgrade|sprag install|ask the user|물어보십시오|실행하십시오/);
  }
});

test('orgUpgradeNotice: a success is announced once, and only when the running version reached the target', (t) => {
  const { dir } = isolate(t);
  writeOrgUpgrade({ target: '3.84.0', from: '3.83.0', startedAt: 1, finishedAt: 2, ok: true, error: null, announced: false }, dir);
  assert.equal(orgUpgradeNotice('3.83.0', { dir }), null, 'still on the old copy: nothing to announce yet');
  assert.equal(readOrgUpgrade(dir).announced, false);
  const first = orgUpgradeNotice('3.84.0', { dir, lang: 'en' });
  assert.match(first, /finished/);
  assert.match(first, /v3\.84\.0/);
  assert.equal(readOrgUpgrade(dir).announced, true);
  assert.equal(orgUpgradeNotice('3.84.0', { dir, lang: 'en' }), null);
});

test('orgUpgradeNotice: a failure gives the reason and the manual command once, and goes quiet when the target is met', (t) => {
  const { dir } = isolate(t);
  writeOrgUpgrade({ target: '3.84.0', startedAt: 1, finishedAt: 2, ok: false, error: 'required version 3.84.0 is not published (latest 3.83.1)', announced: false }, dir);
  const ko = orgUpgradeNotice('3.83.0', { dir, lang: 'ko' });
  assert.match(ko, /not published/);
  assert.match(ko, /sprag upgrade 를 직접 실행하도록/);
  assert.equal(orgUpgradeNotice('3.83.0', { dir, lang: 'ko' }), null, 'announced once');
  writeOrgUpgrade({ announced: false }, dir);
  assert.equal(orgUpgradeNotice('3.84.0', { dir }), null, 'the user upgraded by hand: no stale failure');
});

// ---------------------------------------------------------------- updateOffer

function seedUpdateCheck(dir, latest = '99.0.0') {
  writeFileSync(join(dir, 'update-check.json'), JSON.stringify({
    current: '3.83.0', latest, checkedAt: Date.now(), highlights: ['Faster things', 'Fewer bugs'], highlightsFor: latest, highlightsLang: 'en',
  }));
}

test('updateOffer with an org target starts the upgrade and reports it instead of asking for consent', (t) => {
  const { dir, pkgRoot } = isolate(t);
  saveTeamState(joined({ minVersion: '3.84.0' }), dir);
  seedUpdateCheck(dir);
  const spawn = spawnRecorder();
  const text = updateOffer('3.83.0', { agent: 'claude', lang: 'ko', orgUpgrade: { spawn, root: pkgRoot, env: {} } });
  assert.match(text, /조직 정책에 따라 최소 버전 v3\.84\.0 가 필요해 백그라운드에서 업그레이드를 시작했습니다/);
  assert.doesNotMatch(text, /승낙|물어보십시오|update-check --dismiss/);
  assert.equal(spawn.calls.length, 1);
  assert.deepEqual(spawn.calls[0].args.slice(1), ['upgrade', '--org-policy', '--agent', 'claude']);

  const en = updateOffer('3.83.0', { agent: 'claude', lang: 'en', orgUpgrade: { spawn, root: pkgRoot, env: {} } });
  assert.equal(en, null, 'in flight: quiet, and still not the consent offer');
  assert.equal(spawn.calls.length, 1);
});

test('updateOffer returns a pending success notice when the target is already met', (t) => {
  const { dir, pkgRoot } = isolate(t);
  saveTeamState(joined({ minVersion: '3.84.0' }), dir);
  writeOrgUpgrade({ target: '3.84.0', startedAt: 1, finishedAt: 2, ok: true, error: null, announced: false }, dir);
  const text = updateOffer('3.84.0', { agent: 'codex', lang: 'en', orgUpgrade: { spawn: spawnRecorder(), root: pkgRoot, env: {} } });
  assert.match(text, /finished/);
});

test('updateOffer without team state is byte-for-byte the consent offer', (t) => {
  const { dir } = isolate(t);
  seedUpdateCheck(dir);
  const spawnImpl = () => ({ unref() {} });
  const expected = [
    '[sprag update] A newer version is available: v3.83.0 → 99.0.0.',
    '  - Faster things',
    '  - Fewer bugs',
    'Show the changes and ask the user whether to upgrade. Run these commands only if they agree; do not install without asking.',
    '  sprag upgrade',
    '  sprag update-check --dismiss',
  ].join('\n');
  assert.equal(updateOffer('3.83.0', { agent: 'claude', lang: 'en', spawnImpl }), expected);
  const codex = updateOffer('3.83.0', { agent: 'codex', lang: 'en', spawnImpl });
  assert.match(codex, /npm i -g sprag-cli --ignore-scripts\n {2}sprag install --agent codex\n {2}sprag update-check --dismiss --agent codex$/);

  // A joined member whose organization sets no minimum, or one already met, gets the same offer.
  saveTeamState(joined(), dir);
  assert.equal(updateOffer('3.83.0', { agent: 'claude', lang: 'en', spawnImpl }), expected);
  saveTeamState(joined({ minVersion: '3.83.0' }), dir);
  assert.equal(updateOffer('3.83.0', { agent: 'claude', lang: 'en', spawnImpl }), expected);
});

test('updateOffer from a dev checkout or a detached child keeps the consent offer', (t) => {
  const { dir, root } = isolate(t);
  saveTeamState(joined({ minVersion: '3.84.0' }), dir);
  seedUpdateCheck(dir);
  const dev = join(root, 'dev');
  mkdirSync(join(dev, '.git'), { recursive: true });
  const spawn = spawnRecorder();
  const spawnImpl = () => ({ unref() {} });
  assert.match(updateOffer('3.83.0', { lang: 'en', spawnImpl, orgUpgrade: { spawn, root: dev, env: {} } }), /ask the user whether to upgrade/);
  assert.equal(spawn.calls.length, 0);
  assert.equal(orgPolicyOffer('3.83.0', { env: { SPRAG_DETACHED_CHILD: '1' }, spawn, root: dev }), null);
});

// ---------------------------------------------------------------- upgrade --org-policy

function runnerFixture(t, { teamState = joined({ minVersion: '3.84.0' }), latest = '3.84.0', refreshOk = true, fail = null } = {}) {
  const env = isolate(t);
  if (teamState) saveTeamState(teamState, env.dir);
  const ran = [];
  const exec = async (cmd) => { ran.push(cmd); return fail && cmd.includes(fail) ? 1 : 0; };
  const refreshed = [];
  const refresh = async (v) => { refreshed.push(v); return refreshOk ? { ok: true, latest } : { ok: false, error: 'offline' }; };
  return { ...env, ran, exec, refresh, refreshed };
}

test('--org-policy for Claude runs the upgrade command then sprag install, and records success', async (t) => {
  const f = runnerFixture(t);
  writeOrgUpgrade({ target: '3.84.0', startedAt: 1, pid: null, finishedAt: null }, f.dir);
  const r = await runOrgPolicy({ version: '3.83.0', agent: 'claude', exec: f.exec, refresh: f.refresh, codexPresent: async () => false, claudePresent: async () => false });
  assert.deepEqual(r, { ok: true, error: null });
  assert.deepEqual(f.ran, [upgradeCommand(), 'sprag install']);
  const rec = readOrgUpgrade(f.dir);
  assert.equal(rec.ok, true);
  assert.equal(rec.error, null);
  assert.equal(rec.target, '3.84.0');
  assert.equal(rec.pid, process.pid);
  assert.ok(Number.isFinite(rec.finishedAt));
  assert.deepEqual(f.refreshed, ['3.83.0', '3.84.0'], 'the update state is refreshed against the new latest afterwards');
  assert.match(readFileSync(orgUpgradeLogPath(f.dir), 'utf8'), /upgraded 3\.83\.0 -> 3\.84\.0/);
});

test('--org-policy for Claude also refreshes the Codex hooks when they are installed', async (t) => {
  const f = runnerFixture(t);
  await runOrgPolicy({ version: '3.83.0', agent: 'claude', exec: f.exec, refresh: f.refresh, codexPresent: async () => true, claudePresent: async () => true });
  assert.deepEqual(f.ran, [upgradeCommand(), 'sprag install', 'sprag install --agent codex']);
});

test('--org-policy for Codex runs the Codex instructions, plus sprag install when Claude hooks are present', async (t) => {
  const f = runnerFixture(t);
  await runOrgPolicy({ version: '3.83.0', agent: 'codex', exec: f.exec, refresh: f.refresh, codexPresent: async () => true, claudePresent: async () => false });
  assert.deepEqual(f.ran, ['npm i -g sprag-cli --ignore-scripts', 'sprag install --agent codex']);
  f.ran.length = 0;
  writeOrgUpgrade({ finishedAt: null }, f.dir);
  await runOrgPolicy({ version: '3.83.0', agent: 'codex', exec: f.exec, refresh: f.refresh, codexPresent: async () => true, claudePresent: async () => true });
  assert.deepEqual(f.ran, ['npm i -g sprag-cli --ignore-scripts', 'sprag install --agent codex', 'sprag install']);
});

test('orgUpgradeCommands detects the other integration from the real files', async (t) => {
  const { root } = isolate(t);
  assert.deepEqual(await orgUpgradeCommands('claude'), [upgradeCommand(), 'sprag install']);
  mkdirSync(process.env.CODEX_HOME, { recursive: true });
  const { CODEX_HANDLERS } = await import('../src/codex/installer.js');
  const hooks = {};
  for (const [event, h] of Object.entries(CODEX_HANDLERS)) {
    hooks[event] = [{ ...(h.matcher ? { matcher: h.matcher } : {}), hooks: [{ type: 'command', command: h.command, timeout: h.timeout }] }];
  }
  writeFileSync(join(process.env.CODEX_HOME, 'hooks.json'), JSON.stringify({ hooks }));
  assert.deepEqual(await orgUpgradeCommands('claude'), [upgradeCommand(), 'sprag install', 'sprag install --agent codex']);
  assert.deepEqual(await orgUpgradeCommands('codex'), ['npm i -g sprag-cli --ignore-scripts', 'sprag install --agent codex']);
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'sprag route-scan --hook' }] }] } }));
  assert.deepEqual(await orgUpgradeCommands('codex'), ['npm i -g sprag-cli --ignore-scripts', 'sprag install --agent codex', 'sprag install']);
});

test('--org-policy runs nothing when the registry latest is older than the target', async (t) => {
  const f = runnerFixture(t, { latest: '3.83.5' });
  const r = await runOrgPolicy({ version: '3.83.0', agent: 'claude', exec: f.exec, refresh: f.refresh, codexPresent: async () => false });
  assert.equal(r.ok, false);
  assert.match(r.error, /3\.84\.0 is not published \(latest 3\.83\.5\)/);
  assert.deepEqual(f.ran, []);
  const rec = readOrgUpgrade(f.dir);
  assert.equal(rec.ok, false);
  assert.equal(rec.announced, false);
  assert.match(readFileSync(orgUpgradeLogPath(f.dir), 'utf8'), /not published/);
});

test('--org-policy records a registry failure and runs nothing', async (t) => {
  const f = runnerFixture(t, { refreshOk: false });
  const r = await runOrgPolicy({ version: '3.83.0', agent: 'claude', exec: f.exec, refresh: f.refresh });
  assert.equal(r.ok, false);
  assert.match(r.error, /registry/);
  assert.deepEqual(f.ran, []);
});

test('--org-policy stops with a silent record when nothing is required any more', async (t) => {
  const f = runnerFixture(t, { teamState: joined({ minVersion: null }) });
  const r = await runOrgPolicy({ version: '3.83.0', agent: 'claude', exec: f.exec, refresh: f.refresh });
  assert.equal(r.ok, false);
  assert.deepEqual(f.ran, []);
  assert.deepEqual(f.refreshed, []);
  assert.equal(readOrgUpgrade(f.dir).announced, true, 'no failure notice for a requirement that went away');
  const none = runnerFixture(t, { teamState: null });
  assert.equal((await runOrgPolicy({ version: '3.83.0', agent: 'claude', exec: none.exec, refresh: none.refresh })).ok, false);
});

test('--org-policy records a failed install, stops at it, and the next session reports it', async (t) => {
  const f = runnerFixture(t, { fail: 'install -g' });
  const r = await runOrgPolicy({ version: '3.83.0', agent: 'claude', exec: f.exec, refresh: f.refresh, codexPresent: async () => true });
  assert.equal(r.ok, false);
  assert.match(r.error, /exited with code 1/);
  assert.deepEqual(f.ran, [upgradeCommand()], 'sprag install does not run after a failed install');
  const rec = readOrgUpgrade(f.dir);
  assert.equal(rec.ok, false);
  assert.ok(Number.isFinite(rec.finishedAt));
  assert.match(orgUpgradeNotice('3.83.0', { dir: f.dir, lang: 'en' }), /failed/);
});

test('--org-policy refuses to run beside a live attempt', async (t) => {
  const f = runnerFixture(t);
  writeOrgUpgrade({ target: '3.84.0', startedAt: Date.now(), pid: process.ppid || 1, finishedAt: null }, f.dir);
  const r = await runOrgPolicy({ version: '3.83.0', agent: 'claude', exec: f.exec, refresh: f.refresh, codexPresent: async () => false, now: () => Date.now() });
  assert.equal(r.skipped, 'in-flight');
  assert.deepEqual(f.ran, []);
});

test('--org-policy appends to the log across attempts', async (t) => {
  const f = runnerFixture(t, { latest: '3.80.0' });
  await runOrgPolicy({ version: '3.83.0', agent: 'claude', exec: f.exec, refresh: f.refresh });
  writeOrgUpgrade({ finishedAt: null }, f.dir);
  await runOrgPolicy({ version: '3.83.0', agent: 'claude', exec: f.exec, refresh: f.refresh });
  const lines = readFileSync(orgUpgradeLogPath(f.dir), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
});
