/**
 * Subcommand: upgrade — install the latest release with the package manager
 * that put this copy on disk.
 *
 *   sprag upgrade          # refresh the check, then install
 *   sprag upgrade --print  # show the command, run nothing
 *
 * This is the command the model runs after the user says yes to the
 * session-start offer, so it prints the exact command it is about to execute
 * before executing it: an install that writes outside the project should never
 * be a black box.
 */

import { spawn } from 'node:child_process';

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

export async function run({ hasFlag, version }) {
  const { updateStatus, refreshUpdateState, upgradeCommand, INSTALLED_UNDER_LEGACY_NAME } =
    await import('../update-check.js');
  const { userLanguage } = await import('../config.js');
  const lang = userLanguage();
  const cmd = upgradeCommand();

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
  console.log(lang === 'ko'
    ? `설치가 끝났습니다. 새 셸에서 sprag --version 으로 ${s.latest} 인지 확인하십시오.`
    : `Done. In a fresh shell, run sprag --version to confirm ${s.latest}.`);
}
