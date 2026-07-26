/**
 * Subcommand: install — write the Claude Code auto-trigger skill so the
 * user can just mention chip wording and Claude responds. v2.6.0 dropped
 * the redundant /token-monitor slash command in favor of the skill alone;
 * a legacy command file is removed automatically. Cross-platform.
 *   claude-token-saver install              # install/update the skill
 *   claude-token-saver install --force      # overwrite existing skill file
 */

import { debug } from '../debug.js';

export async function run({ hasFlag }) {
    const { installAll } = await import('../installer.js');
    const { userLanguage } = await import('../config.js');
    const lang = userLanguage();
    const force = hasFlag('--force');
    const print = (kind, r) => {
      const verb = r.action === 'exists' ? 'already exists' : r.action;
      console.log(`  ${kind}: ${r.path} (${verb})`);
    };
    const r = installAll({ force });
    print('skill', r.skill);
    print('SessionStart hook (route-scan)', r.sessionStartHook);
    print('UserPromptSubmit hook (brief)', r.briefHook);
    {
      const s = r.statusline;
      const verb = s.action === 'exists' ? 'already configured (refreshInterval=5)'
        : s.action === 'skipped' ? `skipped — ${s.reason}`
        : s.reason ? `${s.action} — ${s.reason}`
        : s.action;
      console.log(`  statusline: ${s.path} (${verb})`);
    }
    if (r.legacy.action === 'removed') {
      print('legacy /token-monitor', r.legacy);
      console.log('  (consolidated into the skill — same workflow, triggered by intent)');
    }
    // First-time setup: analyze existing session logs right away so the
    // very first session already sees delegation candidates — without this,
    // the initial scan would only start from the first session's hook and
    // its results would surface one session late. Runs inline (a few
    // seconds on a typical 14-day history): a detached child can be reaped
    // by sandboxed installers before it finishes, and postinstall carries
    // `|| true` so a failure here never breaks the install.
    {
      const rs = await import('../route-scan.js');
      if (!rs.readRouteScan()) {
        try {
          console.log('');
          console.log(lang === 'ko'
            ? '  route-scan: 기존 세션 로그의 사용 패턴을 분석하는 중...'
            : '  route-scan: analyzing usage patterns in your existing session logs...');
          const cache = await rs.runRouteScan({ days: 14 });
          console.log(lang === 'ko'
            ? `  route-scan: 에피소드 ${cache.totalEpisodes}건 분석 완료 — 위임 후보 ${cache.candidates.length}건.`
            : `  route-scan: analyzed ${cache.totalEpisodes} episodes — ${cache.candidates.length} delegation candidate(s).`);
          console.log(lang === 'ko'
            ? '              (다음 Claude Code 세션에서 티어 위임 후보가 표시됩니다)'
            : '              (candidates surface in your next Claude Code session)');
        } catch (e) { debug('install:route-scan-seed', e); /* hook-triggered scan covers it on the first session instead */ }
      }
    }
    console.log('');
    console.log('Open Claude Code in any directory and just mention:');
    console.log('  "cache hit rate" / "1M context" / "5H cap" — the skill auto-activates.');
    if (!force) {
      console.log('');
      console.log('Tip: re-run with --force to overwrite the existing skill file.');
    }
    return;
}
