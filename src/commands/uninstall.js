/**
 * Subcommand: uninstall — take the integration back out of ~/.claude.
 *
 *   sprag uninstall           # hooks, statusline, skill
 *   sprag uninstall --purge   # the above plus recorded state
 *
 * Recorded savings are kept by default. Someone removing an integration is
 * usually not asking to throw away the ledger that says what it saved, and
 * that data cannot be reconstructed once the transcripts age out.
 */

export async function run({ hasFlag, args = [] }) {
  const { uninstallAll } = await import('../installer.js');
  const { userLanguage } = await import('../config.js');
  const { CLI_NAME } = await import('../cli-name.js');
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
  // The install now registers Codex too when it finds it, so removal has to
  // undo that as well; otherwise Codex keeps calling a command that may no
  // longer exist. Only our own entries go, exactly as `uninstall --agent codex`.
  try {
    const { codexHookStatus, configureCodexHooks } = await import('../codex-installer.js');
    const { codexHarnessStatus, uninitCodexHarness } = await import('../codex-harness.js');
    const hooked = codexHookStatus().some((h) => h.registered);
    let harness = false;
    try { harness = codexHarnessStatus({ scope: 'global' }).configured > 0; } catch { /* no AGENTS.md */ }
    if (hooked || harness) {
      const hook = configureCodexHooks({ remove: true });
      const h = uninitCodexHarness({ scope: 'global' });
      console.log(lang === 'ko'
        ? `  Codex: 훅 ${hook.action} (${hook.file}), 하네스 ${h.removed ? '제거' : '없음'}`
        : `  Codex: hooks ${hook.action} (${hook.file}), harness ${h.removed ? 'removed' : 'absent'}`);
    }
  } catch { /* Codex state is optional; the Claude removal above already succeeded */ }
  if (!purge) {
    console.log(lang === 'ko'
      ? `  기록된 절감액과 설정까지 지우려면 \`${CLI_NAME} uninstall --purge\` 를 실행하십시오.`
      : `  To remove recorded savings and settings too: \`${CLI_NAME} uninstall --purge\`.`);
  }
}
