/**
 * Subcommand: secrets — secrets that "don't ask again" left in approval lists.
 *
 *   sprag secrets               list the settings entries that look like secrets (values are never printed)
 *   sprag secrets fix [--yes]   delete the flagged allow/ask entries after saving the original
 *   sprag secrets off | on      stop (or resume) the session start notice
 *
 * See src/permission-secrets.js for what is read and why an entry is deleted
 * rather than repaired.
 */

export async function run({ args, hasFlag }) {
  const { userLanguage, loadConfig, saveConfig } = await import('../config.js');
  const ko = userLanguage() === 'ko';
  const ps = await import('../permission-secrets.js');
  const { homedir } = await import('node:os');
  const { findProjectRoot } = await import('../harness.js');
  const sub = args[1];
  const home = homedir();
  const t = (koText, enText) => (ko ? koText : enText);
  const shown = (p) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);

  if (sub === 'off' || sub === 'on') {
    const cfg = loadConfig();
    if (sub === 'off') cfg.secretScan = false;
    else delete cfg.secretScan;
    saveConfig(cfg);
    console.log(sub === 'off'
      ? t('세션 시작 때 승인 목록의 비밀 값을 알리지 않습니다. 다시 켜기: sprag secrets on', 'The session start notice about secrets in approval lists is off. Turn it back on with: sprag secrets on')
      : t('세션 시작 때 승인 목록의 비밀 값을 알립니다.', 'The session start notice about secrets in approval lists is on.'));
    return;
  }
  if (sub !== undefined && sub !== 'fix') {
    console.error(t('사용법: sprag secrets, sprag secrets fix [--yes], sprag secrets off, sprag secrets on', 'Usage: sprag secrets, sprag secrets fix [--yes], sprag secrets off, sprag secrets on'));
    process.exit(1);
  }

  const root = findProjectRoot(process.cwd());
  const found = ps.scanPermissionSecrets({ home, root }).filter((f) => f.entries.length);

  if (sub === 'fix') {
    if (!found.length) {
      console.log(t('승인 목록에서 비밀 값으로 보이는 항목을 찾지 못했습니다.', 'No approval list entry looks like a secret.'));
      return;
    }
    const removable = found.map((f) => ({ ...f, n: f.entries.filter((e) => e.list !== 'deny').length })).filter((f) => f.n > 0);
    if (!removable.length) {
      console.log(t('걸린 항목이 모두 deny 목록에 있어 지우지 않았습니다. deny 는 차단 규칙입니다.', 'Every flagged entry is in a deny list, so nothing was removed. deny entries block commands.'));
      return;
    }
    printFindings(removable, { t, shown, ko });
    if (!hasFlag('--yes')) {
      const { canPrompt, confirm } = await import('../prompt.js');
      if (!canPrompt()) {
        console.log(t('대화형 터미널이 아니어서 아무것도 지우지 않았습니다. 지우려면 sprag secrets fix --yes 를 실행하십시오.',
          'This is not an interactive terminal, so nothing was removed. Run sprag secrets fix --yes to remove them.'));
        return;
      }
      const ok = await confirm(t(`위 allow/ask 항목 ${removable.reduce((a, f) => a + f.n, 0)}개를 지울까요? 원본은 먼저 백업합니다.`,
        `Remove these ${removable.reduce((a, f) => a + f.n, 0)} allow/ask entries? The original is backed up first.`), { defaultValue: false });
      if (!ok) { console.log(t('취소했습니다.', 'Cancelled.')); return; }
    }
    const now = new Date();
    let total = 0;
    for (const f of removable) {
      const r = ps.fixSettingsFile(f.path, { now });
      if (r.error) {
        console.error(t(`${shown(f.path)}: 쓰지 못했습니다 (${r.error}). 원본 백업: ${shown(r.backup)}`, `${shown(f.path)}: could not write (${r.error}). Backup: ${shown(r.backup)}`));
        process.exitCode = 1;
        continue;
      }
      total += r.removed;
      console.log(t(`${shown(f.path)}: ${r.removed}개 지웠습니다. 원본 백업: ${shown(r.backup)} (소유자만 읽을 수 있음)`,
        `${shown(f.path)}: removed ${r.removed}. Original saved to ${shown(r.backup)} (owner-only).`));
    }
    console.log(t(`총 ${total}개를 지웠습니다. 이미 노출됐을 수 있는 값은 발급처에서 회전하십시오.`,
      `Removed ${total} in total. Rotate any value that may already have been exposed, at the service that issued it.`));
    return;
  }

  if (!found.length) {
    console.log(t('승인 목록에서 비밀 값으로 보이는 항목을 찾지 못했습니다.', 'No approval list entry looks like a secret.'));
    return;
  }
  printFindings(found, { t, shown, ko });
  console.log(t('지우려면: sprag secrets fix. 이미 노출됐을 수 있는 값은 발급처에서 회전하십시오.',
    'To remove them: sprag secrets fix. Rotate any value that may already have been exposed, at the service that issued it.'));
}

function printFindings(files, { t, shown }) {
  for (const f of files) {
    console.log(t(`${shown(f.path)}: 비밀 값으로 보이는 항목 ${f.entries.length}개`, `${shown(f.path)}: ${f.entries.length} entries look like secrets`));
    for (const e of f.entries) {
      console.log(`  ${e.list} #${e.index} [${e.kinds.join(', ')}] ${e.preview}`);
    }
    if (f.git?.tracked) {
      console.log(t(
        '  경고: 이 파일은 git이 추적하고 있습니다. 이미 커밋됐다면 값이 기록에 남아 있으니 파일을 고쳐도 소용없고, 발급처에서 값을 회전해야 합니다.',
        '  Warning: git tracks this file. If it was ever committed, the value is in history, so editing the file is not enough: rotate it at the service that issued it.',
      ));
    } else if (f.git && f.git.ignored === false) {
      console.log(t('  이 파일은 git이 추적하지는 않지만 무시 목록에도 없어 다음 커밋에 들어갈 수 있습니다.', '  git does not track this file yet, but it is not ignored either, so the next commit can pick it up.'));
    } else if (f.git?.ignored) {
      console.log(t('  이 파일은 git 무시 목록에 있습니다.', '  git ignores this file.'));
    }
  }
}
