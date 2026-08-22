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
    // Harness, set up as part of the install rather than left as a manual
    // follow-up step. The 🅷 statusline segment and the ratchet rules that
    // route-scan promotes both depend on the block existing in CLAUDE.md, so
    // an install without it ships a tool that is half wired up.
    //
    // Scope is global (~/.claude/CLAUDE.md): a global install is not tied to
    // any one project, and the harness principles are project-independent.
    // Only ever ADDS — harnessInit appends its own marked block, backs up the
    // previous file, and leaves surrounding content untouched. Skipped when a
    // block is already there (nothing to do) and when CTS_NO_HARNESS=1 is set,
    // for anyone who wants the statusline without the CLAUDE.md rules.
    try {
      const { harnessInit, harnessStatus } = await import('../harness.js');
      const before = harnessStatus(undefined, { scope: 'global' });
      if (process.env.CTS_NO_HARNESS === '1') {
        console.log('');
        console.log(lang === 'ko'
          ? '  harness: CTS_NO_HARNESS=1 이므로 건너뜁니다 (나중에 `harness init --global`).'
          : '  harness: skipped (CTS_NO_HARNESS=1) — run `harness init --global` later.');
      } else if (before.hasBlock) {
        console.log('');
        console.log(lang === 'ko'
          ? `  harness: 이미 설정됨 — 🅷 ${before.configured}/${before.total} (${before.file})`
          : `  harness: already set up — 🅷 ${before.configured}/${before.total} (${before.file})`);
      } else {
        const h = harnessInit({ scope: 'global' });
        console.log('');
        for (const p of h.backedUp) {
          console.log(lang === 'ko' ? `  harness: 백업 ${p}` : `  harness: backed up ${p}`);
        }
        for (const p of h.wrote) {
          console.log(lang === 'ko' ? `  harness: 작성 ${p}` : `  harness: wrote ${p}`);
        }
        console.log(lang === 'ko'
          ? '  harness: 5원칙을 ~/.claude/CLAUDE.md 에 설정했습니다 — statusline에 🅷 5/5 가 표시됩니다.'
          : '  harness: 5 principles installed in ~/.claude/CLAUDE.md — the statusline now shows 🅷 5/5.');
        console.log(lang === 'ko'
          ? '           되돌리려면: claude-token-saver harness uninit --global'
          : '           to undo: claude-token-saver harness uninit --global');
      }
    } catch (e) {
      // Never fail an install over this — the statusline and Skill are already
      // in place, and `harness init` remains available as a manual step.
      debug('install:harness-init', e);
      console.log(lang === 'ko'
        ? '  harness: 자동 설정을 건너뛰었습니다 — `claude-token-saver harness init --global` 로 직접 설정하세요.'
        : '  harness: auto-setup skipped — run `claude-token-saver harness init --global` yourself.');
    }

    // Korean writing guidance. Decided here rather than left to a command the
    // user has to find, because the people who need it are exactly the ones
    // who would not know to look for it. Enabled when the machine's locale
    // says Korean; left alone once the user has answered either way, so an
    // upgrade never re-enables something they turned off.
    try {
      const ks = await import('../korean-style.js');
      if (process.env.CTS_NO_KOREAN === '1') {
        console.log('');
        console.log(lang === 'ko'
          ? '  korean: CTS_NO_KOREAN=1 이므로 건너뜁니다 (나중에 `korean on`).'
          : '  korean: skipped (CTS_NO_KOREAN=1) — run `korean on` later.');
      } else if (ks.koreanStyleDecided()) {
        console.log('');
        console.log(lang === 'ko'
          ? `  korean: 기존 설정 유지 — 한국어 문체 지침 ${ks.koreanStyleEnabled() ? '켜짐' : '꺼짐'}`
          : `  korean: keeping your setting — Korean writing guidance is ${ks.koreanStyleEnabled() ? 'on' : 'off'}`);
      } else if (ks.koreanLocaleDetected()) {
        ks.setKoreanStyleEnabled(true);
        console.log('');
        console.log(lang === 'ko'
          ? '  korean: 한국어 환경이 감지되어 문체 지침을 켰습니다 — 모든 프로젝트의 세션 시작 시 주입됩니다.'
          : '  korean: Korean locale detected — writing guidance enabled, injected at session start in every project.');
        console.log(lang === 'ko'
          ? `           출처: ${ks.KOREAN_STYLE_SOURCE}`
          : `           source: ${ks.KOREAN_STYLE_SOURCE}`);
        console.log(lang === 'ko'
          ? '           끄려면: claude-token-saver korean off'
          : '           turn off with: claude-token-saver korean off');
      } else {
        console.log('');
        console.log(lang === 'ko'
          ? '  korean: 한국어 환경이 아니어서 꺼 두었습니다 — 필요하면 `claude-token-saver korean on`.'
          : '  korean: left off (no Korean locale detected) — enable with `claude-token-saver korean on`.');
      }
    } catch (e) {
      debug('install:korean-style', e); // optional feature; never fail install
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
