/**
 * Subcommand: uninstall — take the integration back out of ~/.claude.
 *
 *   claude-token-saver uninstall           # hooks, statusline, skill
 *   claude-token-saver uninstall --purge   # the above plus recorded state
 *
 * Recorded savings are kept by default. Someone removing an integration is
 * usually not asking to throw away the ledger that says what it saved, and
 * that data cannot be reconstructed once the transcripts age out.
 */

export async function run({ hasFlag, args = [] }) {
  const { uninstallAll } = await import('../installer.js');
  const { userLanguage } = await import('../config.js');
  const lang = userLanguage();
  const purge = hasFlag('--purge') || args.includes('--purge');

  const r = uninstallAll({ purge });

  if (r.action === 'skipped') {
    console.error(lang === 'ko'
      ? `✗ ${r.path} 를 읽지 못해 아무것도 지우지 않았습니다: ${r.reason}`
      : `✗ nothing removed — ${r.path} could not be read: ${r.reason}`);
    process.exitCode = 1;
    return;
  }

  if (r.removed.length === 0) {
    console.log(lang === 'ko' ? '설치된 항목이 없습니다.' : 'Nothing was installed.');
  } else {
    console.log(lang === 'ko' ? `✓ 제거했습니다 (${r.path}):` : `✓ removed (${r.path}):`);
    for (const item of r.removed) console.log(`  - ${item}`);
  }
  for (const item of r.kept) {
    console.log(lang === 'ko' ? `  유지: ${item}` : `  kept: ${item}`);
  }
  if (!purge) {
    console.log(lang === 'ko'
      ? '  기록된 절감액과 설정까지 지우려면 `claude-token-saver uninstall --purge` 를 실행하십시오.'
      : '  To remove recorded savings and settings too: `claude-token-saver uninstall --purge`.');
  }
}
