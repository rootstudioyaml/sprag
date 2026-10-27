/**
 * Subcommand: upgrade — install the latest release with the package manager
 * that put this copy on disk.
 *
 *   sprag upgrade          # refresh the check, then install
 *   sprag upgrade --print  # show the command, run nothing
 *   sprag upgrade --org-policy [--agent codex]
 *                          # non-interactive: what the session-start hook starts
 *                          # (detached) when the organization sets a minimum version
 *
 * This is the command the model runs after the user says yes to the
 * session-start offer, so it prints the exact command it is about to execute
 * before executing it: an install that writes outside the project should never
 * be a black box.
 */

import { spawn } from 'node:child_process';
import { openSync, closeSync, writeSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function runCommand(cmd) {
  return new Promise((resolve) => {
    // Shell form: the upgrade command is a fixed string we composed ourselves
    // (no user input reaches it), and `npm install -g` needs the user's PATH
    // resolution to find the same npm that installed us.
    const child = spawn(cmd, { shell: true, stdio: 'inherit' });
    child.on('close', (code) => resolve(code === null ? 1 : code));
    child.on('error', () => resolve(1));
  });
}

/** Shell command with stdout and stderr appended to the log file; resolves to its exit code. */
function runLogged(cmd, logFile) {
  return new Promise((resolve) => {
    let fd;
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      fd = openSync(logFile, 'a');
      writeSync(fd, `$ ${cmd}\n`);
    } catch { resolve(1); return; }
    const done = (code) => { try { closeSync(fd); } catch { /* already closed */ } resolve(code); };
    // Same fixed-string shell form as runCommand; nothing here is user input.
    const child = spawn(cmd, { shell: true, stdio: ['ignore', fd, fd], windowsHide: true });
    child.on('close', (code) => done(code === null ? 1 : code));
    child.on('error', () => done(1));
  });
}

/** Whether sprag's Claude Code hooks or statusline are registered in settings.json. */
async function claudeIntegrationPresent() {
  try {
    const { readSettings, isOurCommand } = await import('../installer.js');
    const { claudeUserDir } = await import('../paths.js');
    const { join } = await import('node:path');
    const read = readSettings(join(claudeUserDir(), 'settings.json'));
    if (read.state !== 'ok') return false;
    const s = read.settings;
    if (isOurCommand(s.statusLine?.command)) return true;
    return Object.values(s.hooks && typeof s.hooks === 'object' ? s.hooks : {}).some((groups) =>
      Array.isArray(groups) && groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => isOurCommand(h?.command))));
  } catch { return false; }
}

/** Whether sprag's Codex hooks are registered. */
async function codexIntegrationPresent() {
  try {
    const { codexHookStatus } = await import('../codex/installer.js');
    return codexHookStatus().some((h) => h.registered);
  } catch { return false; }
}

/**
 * The commands an organization-policy upgrade runs for `agent`, in order. The
 * agent's own install comes first; the other agent's integration is refreshed
 * too when it is present, so a machine with both ends up on one version.
 */
export async function orgUpgradeCommands(agent, { claudePresent = claudeIntegrationPresent, codexPresent = codexIntegrationPresent } = {}) {
  const { upgradeCommand } = await import('../update-check.js');
  const { upgradeInstructions } = await import('../update-notice.js');
  const cmds = agent === 'codex' ? [...upgradeInstructions('codex')] : [upgradeCommand(), 'sprag install'];
  if (agent === 'codex' ? await claudePresent() : await codexPresent()) {
    cmds.push(agent === 'codex' ? 'sprag install' : 'sprag install --agent codex');
  }
  return [...new Set(cmds)];
}

/**
 * `sprag upgrade --org-policy`: the unattended upgrade the session-start hook
 * starts when the organization sets a minimum version. Detached, so nothing
 * goes to a terminal: output is appended to org-upgrade.log and the outcome to
 * org-upgrade.json, which the next session reports. `exec`, `refresh` and
 * `dir` are injectable for tests.
 */
export async function runOrgPolicy({
  version, agent = 'claude', dir, now = Date.now, exec, refresh, claudePresent, codexPresent,
} = {}) {
  const { userDataDir } = await import('../paths.js');
  const { readTeamState } = await import('../team-ratchet.js');
  const org = await import('../org-upgrade.js');
  const { isNewer, refreshUpdateState } = await import('../update-check.js');
  const root = dir || userDataDir();
  const logFile = org.orgUpgradeLogPath(root);
  const run = exec || ((cmd) => runLogged(cmd, logFile));
  const refreshState = refresh || refreshUpdateState;
  const log = (line) => { try { writeLogLine(logFile, line); } catch { /* the record still says what happened */ } };

  const prev = org.readOrgUpgrade(root);
  if (prev.pid && prev.pid !== process.pid && org.orgUpgradeInFlight(prev, { now: now() })) {
    return { ok: false, skipped: 'in-flight' };
  }
  const required = org.orgMinVersion(readTeamState(root));
  const target = required || prev.target || null;
  org.writeOrgUpgrade({
    target, from: version, startedAt: prev.startedAt && !prev.finishedAt ? prev.startedAt : now(), pid: process.pid,
    finishedAt: null, ok: null, error: null, announced: false,
  }, root);
  const finish = (ok, error = null, extra = {}) => {
    org.writeOrgUpgrade({ finishedAt: now(), ok, error, ...extra }, root);
    return { ok, error };
  };

  if (!required || !isNewer(required, version)) {
    // The requirement went away while this was starting: nothing to report.
    log(`nothing required (minimum ${required || 'unset'}, running ${version})`);
    return finish(false, 'no minimum version is required any more', { announced: true });
  }
  const r = await refreshState(version);
  const latest = r && r.ok ? r.latest : null;
  if (!latest) {
    log(`registry check failed: ${(r && r.error) || 'no answer'}`);
    return finish(false, `could not read the latest version from the registry: ${(r && r.error) || 'no answer'}`);
  }
  if (isNewer(required, latest)) {
    log(`required version ${required} is not published (latest ${latest})`);
    return finish(false, `required version ${required} is not published (latest ${latest})`);
  }

  for (const cmd of await orgUpgradeCommands(agent, { claudePresent, codexPresent })) {
    const code = await run(cmd);
    if (code !== 0) {
      log(`failed (exit ${code}): ${cmd}`);
      return finish(false, `"${cmd}" exited with code ${code}`);
    }
  }
  // Same as the interactive path: the cached "latest" now describes the new copy.
  try { await refreshState(latest); } catch (e) { log(`state refresh failed: ${e && e.message}`); }
  log(`upgraded ${version} -> ${latest}`);
  return finish(true);
}

function writeLogLine(file, line) {
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, 'a');
  try { writeSync(fd, `[${new Date().toISOString()}] ${line}\n`); } finally { closeSync(fd); }
}

export async function run({ hasFlag, version, agent = 'claude' }) {
  if (hasFlag('--org-policy')) {
    // Detached, so the exit code is for whoever runs it by hand; the record has the reason.
    const result = await runOrgPolicy({ version, agent });
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const { updateStatus, refreshUpdateState, upgradeCommand, INSTALLED_UNDER_LEGACY_NAME } =
    await import('../update-check.js');
  const { userLanguage } = await import('../config.js');
  const lang = userLanguage();
  const cmd = upgradeCommand();

  // pnpm and bun skip lifecycle scripts by default, and npm skips them under
  // ignore-scripts, so the new copy's setup (Codex hooks, tmux panel) runs here.
  // The install is idempotent, so npm running it twice changes nothing.
  async function runSetup() {
    console.log('$ sprag install');
    const installCode = await runCommand('sprag install');
    if (installCode !== 0) console.error(lang === 'ko'
      ? '설치 후 설정(sprag install)이 실패했습니다. 새 셸에서 sprag install 을 직접 실행하십시오.'
      : 'Post-upgrade setup (sprag install) failed. Run sprag install in a fresh shell.');
  }

  if (hasFlag('--print')) {
    console.log(cmd);
    return;
  }

  // Refresh first so the "already latest" answer is trustworthy rather than up
  // to 24h stale — an upgrade is a deliberate, interactive action, so one
  // network round trip is fine here.
  await refreshUpdateState(version);
  const s = updateStatus(version);
  // A legacy-name copy has somewhere to go even on the newest version: the
  // package was renamed, and only the new name keeps receiving releases.
  if (!s.available && INSTALLED_UNDER_LEGACY_NAME) {
    console.log(lang === 'ko'
      ? `패키지 이름이 claude-token-saver 에서 sprag-cli 로 바뀌었습니다. 버전은 최신(v${version})이지만, 앞으로의 릴리스를 계속 받으려면 새 이름으로 옮겨야 합니다.`
      : `The package was renamed from claude-token-saver to sprag-cli. You are on the latest version (v${version}), but future releases only ship under the new name.`);
    console.log(`$ ${cmd}`);
    const migrateCode = await runCommand(cmd);
    if (migrateCode !== 0) {
      console.error(lang === 'ko'
        ? `이전 명령이 종료 코드 ${migrateCode}로 실패했습니다. 위 출력을 확인하십시오.`
        : `Migration command failed with exit code ${migrateCode}. Check the output above.`);
      process.exit(migrateCode);
    }
    await runSetup();
    console.log(lang === 'ko'
      ? '이전이 끝났습니다. 새 셸에서 sprag --version 으로 확인하십시오.'
      : 'Migration done. Confirm with sprag --version in a fresh shell.');
    return;
  }
  if (!s.available) {
    console.log(lang === 'ko'
      ? `이미 최신 버전입니다 (v${version}). 설치할 것이 없습니다.`
      : `Already on the latest version (v${version}). Nothing to install.`);
    return;
  }

  console.log(lang === 'ko'
    ? (INSTALLED_UNDER_LEGACY_NAME
      ? `v${version} → ${s.latest} 로 업그레이드하면서 새 패키지 이름(sprag-cli)으로 함께 옮깁니다.`
      : `v${version} → ${s.latest} 로 업그레이드합니다.`)
    : (INSTALLED_UNDER_LEGACY_NAME
      ? `Upgrading v${version} → ${s.latest} and moving to the new package name (sprag-cli).`
      : `Upgrading v${version} → ${s.latest}.`));
  console.log(`$ ${cmd}`);
  const code = await runCommand(cmd);
  if (code !== 0) {
    console.error(lang === 'ko'
      ? `업그레이드 명령이 종료 코드 ${code}로 실패했습니다. 위 출력을 확인하고, 권한 문제라면 sudo 없이 설치되는 전역 경로인지 점검하십시오.`
      : `Upgrade command failed with exit code ${code}. Check the output above; if it is a permissions error, verify your global install prefix.`);
    process.exit(code);
  }
  // The freshly installed copy is a different file on disk, so this process
  // still reports the old version. Refresh the cache against the new latest so
  // the statusline chip clears on the next render instead of lingering.
  await refreshUpdateState(s.latest);
  await runSetup();
  console.log(lang === 'ko'
    ? `설치가 끝났습니다. 새 셸에서 sprag --version 으로 ${s.latest} 인지 확인하십시오.`
    : `Done. In a fresh shell, run sprag --version to confirm ${s.latest}.`);
}
