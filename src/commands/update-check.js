/**
 * Subcommand: update-check — everything around "is a newer version out".
 *
 *   claude-token-saver update-check              # print the cached answer
 *   claude-token-saver update-check --refresh    # ask the registry now
 *   claude-token-saver update-check --refresh --quiet
 *                                                # what the detached background child runs
 *   claude-token-saver update-check --dismiss    # stop offering this version at session start
 *
 * The statusline never calls the --refresh path directly; it spawns this
 * command detached so the render itself stays offline and instant.
 */

export async function run({ hasFlag, version }) {
  const {
    updateStatus,
    refreshUpdateState,
    dismissUpdate,
    upgradeCommand,
    updateCheckDisabled,
    updateStatePath,
  } = await import('../update-check.js');
  const { userLanguage } = await import('../config.js');
  const lang = userLanguage();
  const quiet = hasFlag('--quiet');

  if (hasFlag('--refresh')) {
    const res = await refreshUpdateState(version);
    if (quiet) return;
    if (!res.ok) {
      console.error(lang === 'ko'
        ? `최신 버전을 확인하지 못했습니다: ${res.error}`
        : `Could not reach the registry: ${res.error}`);
      process.exit(1);
    }
  }

  if (hasFlag('--dismiss')) {
    const s = updateStatus(version);
    if (s.latest) dismissUpdate(s.latest);
    console.log(lang === 'ko'
      ? `${s.latest || '최신'} 버전 안내를 끕니다. 그 다음 버전이 나오면 다시 안내합니다.`
      : `Muted the ${s.latest || 'latest'} notice. The next release after it will ask again.`);
    return;
  }

  if (updateCheckDisabled()) {
    console.log(lang === 'ko'
      ? `현재 버전 v${version} — 업데이트 확인이 환경 변수로 꺼져 있습니다 (CTS_NO_UPDATE_CHECK / NO_UPDATE_NOTIFIER).`
      : `v${version} — update checks are disabled by env var (CTS_NO_UPDATE_CHECK / NO_UPDATE_NOTIFIER).`);
    return;
  }

  const s = updateStatus(version);
  if (s.available) {
    console.log(lang === 'ko'
      ? `새 버전이 있습니다: v${version} → ${s.latest}`
      : `Update available: v${version} → ${s.latest}`);
    console.log(lang === 'ko'
      ? `업그레이드: ${upgradeCommand()}   (또는 claude-token-saver upgrade)`
      : `Upgrade with: ${upgradeCommand()}   (or: claude-token-saver upgrade)`);
    if (s.dismissed) {
      console.log(lang === 'ko'
        ? '이 버전은 사용자가 한 번 넘긴 상태라, 세션 시작 시에는 다시 묻지 않습니다.'
        : 'This version was dismissed, so the session-start offer stays quiet for it.');
    }
    return;
  }
  console.log(lang === 'ko'
    ? `최신 버전을 쓰고 있습니다 (v${version}).`
    : `Up to date (v${version}).`);
  if (!s.latest) {
    console.log(lang === 'ko'
      ? `아직 확인된 기록이 없습니다. 지금 확인하려면: claude-token-saver update-check --refresh (기록 파일: ${updateStatePath()})`
      : `No check has completed yet. Run: claude-token-saver update-check --refresh (state: ${updateStatePath()})`);
  }
}
