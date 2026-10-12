import { updateStatus, maybeSpawnUpdateCheck, readUpdateState, updateCheckDisabled, SESSION_START_CHECK_INTERVAL_MS } from './update-check.js';
import { debug } from './debug.js';

/** Shared by terminal renders; registry I/O stays in the detached checker. */
export function readUpdateChip(version, { refresh = true, ...opts } = {}) {
  try {
    if (refresh) maybeSpawnUpdateCheck(version, opts);
    const status = updateStatus(version, opts);
    const checkedAt = updateCheckDisabled() ? null : (Number(readUpdateState().checkedAt) || null);
    return { ...status, checkedAt };
  } catch (e) {
    debug('update-check:chip', e);
    return null;
  }
}

export function upgradeInstructions(agent = 'claude') {
  return agent === 'codex'
    ? ['npm i -g sprag-cli --ignore-scripts', 'sprag install --agent codex']
    : ['sprag upgrade'];
}

/** The model must obtain consent; a hook never installs a package itself. */
export function updateOffer(version, { agent = 'claude', lang = 'en', ...opts } = {}) {
  const u = readUpdateChip(version, { intervalMs: SESSION_START_CHECK_INTERVAL_MS, ...opts });
  if (!u?.available || u.dismissed) return null;
  const ko = lang === 'ko';
  return [
    ko ? `[sprag update] 새 버전이 나와 있습니다: v${u.current} → ${u.latest}.`
      : `[sprag update] A newer version is available: v${u.current} → ${u.latest}.`,
    ...(u.highlights || []).slice(0, 3).map((note) => `  - ${note}`),
    ko ? '사용자에게 변경 내용을 알리고 업그레이드할지 물어보십시오. 승낙한 경우에만 아래 명령을 실행하십시오.'
      : 'Show the changes and ask the user whether to upgrade. Run these commands only if they agree; do not install without asking.',
    ...upgradeInstructions(agent).map((command) => `  ${command}`),
    `  sprag update-check --dismiss${agent === 'codex' ? ' --agent codex' : ''}`,
  ].join('\n');
}
