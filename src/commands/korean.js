/**
 * Subcommand: korean — Korean writing guidance for every session.
 *   sprag korean on       # inject at session start, all projects
 *   sprag korean off      # stop injecting
 *   sprag korean status   # current state, cost, and provenance
 *   sprag korean show     # print the guidance itself
 *
 * Why this exists rather than pointing users at Claude Code's output styles:
 * an output style is one global slot, so turning it on takes the slot away
 * from whatever else the user had there, and it has to be configured on every
 * machine. This ships the guidance with the package and delivers it through
 * the SessionStart hook that is already installed, so it applies everywhere
 * the CLI is installed and leaves the output-style slot free.
 *
 * Injection alone turned out to be half the job. The guidance is read once at
 * session start and never again, so a long session writes documents that drift
 * back to the patterns it forbids, and the drift is caught only when a human
 * reads the finished file. `korean on` therefore also installs a PostToolUse
 * hook that runs the machine-checkable clauses over the prose the model just
 * wrote:
 *   sprag korean lint block|warn|off   # how findings are handled
 *   sprag korean lint <file...>        # check files on disk
 *
 * The third half is a Stop hook for the one slip a write-time check cannot
 * see: an English reply to a Korean prompt, which writes no file at all.
 *   sprag korean reply on|off          # toggle it (default on)
 */

// Enforcement is only useful if it is on by default — a check the user has to
// discover is the same hole in a different shape.
function koreanLintMode(cfg) {
  const mode = cfg?.koreanStyle?.lint;
  return mode === 'off' || mode === 'warn' ? mode : 'block';
}

// `all` checks every text file the session writes, including Korean sitting in
// comments and UI strings. That is wider than the vendored guidance's own
// exemption list, and deliberately so: a comment is read by a person, and
// generated artifacts (PDF, HTML, captions) are assembled from those strings,
// so exempting them reopens the gap for exactly the outputs users complained
// about. `prose` restores the narrow reading.
function koreanLintScope(cfg) {
  return cfg?.koreanStyle?.lintScope === 'prose' ? 'prose' : 'all';
}

// Default on, like the lint: a check the user has to discover is the same
// hole in a different shape. Only an explicit false turns it off.
function koreanReplyCheckOn(cfg) {
  return cfg?.koreanReplyCheck !== false;
}

export async function run({ args, hasFlag }) {
  const sub = args[1] || 'status';
  const ks = await import('../korean-style.js');
  const { userLanguage, loadConfig, saveConfig } = await import('../config.js');
  const lang = userLanguage();

  // PostToolUse hook. Claude Code feeds the tool-call payload on stdin; we
  // check the prose the model just wrote and hand any findings straight back
  // to it. Silent and cheap when the file is clean, which is the common case.
  if (hasFlag?.('--hook') || sub === '--hook') {
    const { readStdinJson } = await import('../stdin-payload.js');
    const payload = readStdinJson();
    if (!payload || !ks.koreanStyleEnabled()) return;
    const mode = koreanLintMode(loadConfig());
    if (mode === 'off') return;
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const lint = req('../korean-lint.cjs');
    const result = lint.lintToolUse(payload, { scope: koreanLintScope(loadConfig()) });
    if (!result) return;
    const message = lint.formatFindings(result.filePath, result.findings);
    if (mode === 'block') {
      // Exit 2 is Claude Code's blocking-feedback channel: the file is already
      // written, so nothing is lost, but the model must address this before it
      // moves on. That is the whole point — a warning it can scroll past is
      // what failed in the first place.
      process.stderr.write(message + '\n');
      process.exit(2);
    }
    console.log(message);
    return;
  }

  // Stop hook. Fires when the model finishes a turn; if the reply is English
  // to a Korean prompt, block the stop so the model answers again in Korean.
  // Imports stay minimal on purpose: this runs after every turn.
  if (hasFlag?.('--reply-hook') || sub === '--reply-hook') {
    const { readStdinJson } = await import('../stdin-payload.js');
    const payload = readStdinJson();
    if (!payload) return;
    // Claude Code sets stop_hook_active while the model is already continuing
    // because of a Stop hook. Blocking again would loop forever.
    if (payload.stop_hook_active) return;
    if (!ks.koreanStyleEnabled()) return;
    if (!koreanReplyCheckOn(loadConfig())) return;
    const { createRequire } = await import('node:module');
    const found = createRequire(import.meta.url)('../reply-language.cjs').checkReplyLanguage(payload.transcript_path);
    if (!found) return;
    console.log(JSON.stringify({
      decision: 'block',
      reason: '사용자는 한국어로 질문했는데 마지막 답변이 영어로 작성됐습니다. 같은 내용을 한국어로 다시 답하십시오. 코드, 명령어, 오류 원문, 커밋 메시지처럼 원문을 유지해야 하는 부분은 그대로 둡니다.',
    }));
    return;
  }

  // Toggle: `korean reply on|off`. Off keeps the hook installed and makes it
  // a no-op, the same way lint mode `off` works; `korean off` removes it.
  if (sub === 'reply') {
    const cfg = loadConfig();
    const next = args[2];
    if (!next) {
      console.log(lang === 'ko'
        ? `답변 언어 검사: ${koreanReplyCheckOn(cfg) ? '켜짐' : '꺼짐'}`
        : `Reply-language check: ${koreanReplyCheckOn(cfg) ? 'on' : 'off'}`);
      return;
    }
    if (!['on', 'off'].includes(next)) {
      console.error('Usage: sprag korean reply [on|off]');
      process.exit(1);
    }
    cfg.koreanReplyCheck = next === 'on';
    saveConfig(cfg);
    console.log(next === 'on'
      ? (lang === 'ko'
        ? '답변 언어 검사를 켰습니다. 한국어 질문에 영어로 답하면 모델에게 되돌려 보내 다시 답하게 합니다.'
        : 'Reply-language check is on. An English reply to a Korean prompt is sent back for a Korean answer.')
      : (lang === 'ko'
        ? '답변 언어 검사를 껐습니다. 훅은 남아 있지만 아무 일도 하지 않습니다.'
        : 'Reply-language check is off. The hook stays installed and does nothing.'));
    return;
  }

  // Manual run over files already on disk: `korean lint docs/*.md`.
  if (sub === 'lint' && args.length > 2 && !['on', 'off', 'warn', 'block', 'scope'].includes(args[2])) {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const lint = createRequire(import.meta.url)('../korean-lint.cjs');
    let total = 0;
    for (const file of args.slice(2)) {
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch (e) {
        console.error(`${file}: ${e.message}`);
        continue;
      }
      if (lint.isHtmlFile(file)) text = lint.stripHtml(text);
      const findings = lint.lintKoreanText(text, { code: !lint.isProseFile(file) });
      total += findings.length;
      if (findings.length) console.log(lint.formatFindings(file, findings));
    }
    if (total === 0) {
      console.log(lang === 'ko' ? '문체 규약 위반이 없습니다.' : 'No findings.');
    }
    process.exit(total > 0 ? 1 : 0);
  }

  // Scope switch: `korean lint scope all|prose`.
  if (sub === 'lint' && args[2] === 'scope') {
    const cfg = loadConfig();
    const next = args[3];
    if (!next) {
      console.log(lang === 'ko'
        ? `검사 범위: ${koreanLintScope(cfg)}`
        : `Check scope: ${koreanLintScope(cfg)}`);
      return;
    }
    if (!['all', 'prose'].includes(next)) {
      console.error('Usage: sprag korean lint scope [all|prose]');
      process.exit(1);
    }
    cfg.koreanStyle = cfg.koreanStyle || {};
    cfg.koreanStyle.lintScope = next;
    saveConfig(cfg);
    console.log(lang === 'ko'
      ? (next === 'all'
        ? '검사 범위를 all 로 바꿨습니다. 문서와 코드 주석, UI 문자열까지 세션이 쓴 모든 텍스트 파일을 검사합니다.'
        : '검사 범위를 prose 로 좁혔습니다. 마크다운과 텍스트 문서만 검사합니다.')
      : (next === 'all'
        ? 'Check scope: all — every text file the session writes, comments and UI strings included.'
        : 'Check scope: prose — documents only.'));
    return;
  }

  // Enforcement mode: `korean lint block|warn|off`.
  if (sub === 'lint') {
    const mode = args[2];
    const cfg = loadConfig();
    if (!mode) {
      console.log(lang === 'ko'
        ? `쓰기 시점 검사: ${koreanLintMode(cfg)} (범위 ${koreanLintScope(cfg)})`
        : `Write-time check: ${koreanLintMode(cfg)} (scope ${koreanLintScope(cfg)})`);
      return;
    }
    if (!['block', 'warn', 'off'].includes(mode)) {
      console.error('Usage: sprag korean lint [block|warn|off] | korean lint <file...>');
      process.exit(1);
    }
    cfg.koreanStyle = cfg.koreanStyle || {};
    cfg.koreanStyle.lint = mode;
    saveConfig(cfg);
    const note = {
      block: lang === 'ko' ? '위반을 발견하면 모델에게 되돌려 보내 고치게 합니다.' : 'Findings are handed back to the model as blocking feedback.',
      warn: lang === 'ko' ? '위반을 알리기만 하고 진행을 막지 않습니다.' : 'Findings are printed as a note and do not block.',
      off: lang === 'ko' ? '쓰기 시점 검사를 하지 않습니다.' : 'The write-time check is disabled.',
    }[mode];
    console.log(`${lang === 'ko' ? '쓰기 시점 검사' : 'Write-time check'}: ${mode} — ${note}`);
    return;
  }

  if (sub === 'show') {
    const text = ks.koreanStyleText();
    if (!text) {
      console.error('Korean style guidance file is missing from the package.');
      process.exit(1);
    }
    console.log(text);
    return;
  }

  if (sub === 'on' || sub === 'off') {
    const enabled = sub === 'on';
    ks.setKoreanStyleEnabled(enabled);
    const {
      installKoreanLintHook, removeKoreanLintHook,
      installReplyLanguageHook, removeReplyLanguageHook,
    } = await import('../installer.js');
    const hook = enabled ? installKoreanLintHook() : removeKoreanLintHook();
    if (enabled) installReplyLanguageHook();
    else removeReplyLanguageHook();
    if (enabled) {
      console.log(lang === 'ko'
        ? '한국어 문체 지침을 켰습니다. 다음 세션부터 모든 프로젝트에 적용됩니다.'
        : 'Korean writing guidance is on. It applies in every project from the next session.');
      console.log(lang === 'ko'
        ? '  주입 시점: 세션 시작 1회 (매 턴이 아니므로 두 번째 요청부터는 캐시에 올라갑니다)'
        : '  Injected once per session (not per turn), so it rides the prompt cache from the second request on.');
      console.log(lang === 'ko'
        ? `  출처: ${ks.KOREAN_STYLE_SOURCE}`
        : `  Source: ${ks.KOREAN_STYLE_SOURCE}`);
      if (hook.action === 'skipped') {
        console.log(lang === 'ko'
          ? `  ⚠ 쓰기 시점 검사 훅을 못 걸었습니다: ${hook.reason}`
          : `  ⚠ Could not register the write-time hook: ${hook.reason}`);
      } else {
        console.log(lang === 'ko'
          ? `  쓰기 시점 검사: ${koreanLintMode(loadConfig())}, 범위 ${koreanLintScope(loadConfig())} (Write·Edit·Bash 로 쓴 한국어를 검사합니다)`
          : `  Write-time check: ${koreanLintMode(loadConfig())}, scope ${koreanLintScope(loadConfig())} (runs on Korean written via Write, Edit or Bash)`);
      }
    } else {
      console.log(lang === 'ko'
        ? '한국어 문체 지침을 껐습니다. 다음 세션부터 주입하지 않습니다.'
        : 'Korean writing guidance is off. Nothing is injected from the next session.');
    }
    return;
  }

  // status (default)
  const on = ks.koreanStyleEnabled();
  const text = ks.koreanStyleText();
  // 4 bytes/token is the usual mixed ko/en approximation, same as the ratchet
  // size report — this is the number the user is trading for the style.
  const tokens = text ? Math.round(Buffer.byteLength(text, 'utf8') / 4) : 0;
  if (lang === 'ko') {
    console.log(`한국어 문체 지침: ${on ? '켜짐' : '꺼짐'}`);
    console.log(`  비용: 세션당 약 ${tokens} 토큰 (세션 시작 1회 주입)`);
    console.log(`  쓰기 시점 검사: ${koreanLintMode(loadConfig())}, 범위 ${koreanLintScope(loadConfig())} (바꾸려면 sprag korean lint block|warn|off, korean lint scope all|prose)`);
    console.log(`  답변 언어 검사: ${koreanReplyCheckOn(loadConfig()) ? '켜짐' : '꺼짐'} (바꾸려면 sprag korean reply on|off)`);
    console.log(`  출처: ${ks.KOREAN_STYLE_SOURCE}`);
    console.log(`  라이선스 전문: ${ks.KOREAN_STYLE_LICENSE_PATH}`);
    console.log(on
      ? '  끄려면: sprag korean off'
      : '  켜려면: sprag korean on');
  } else {
    console.log(`Korean writing guidance: ${on ? 'on' : 'off'}`);
    console.log(`  Cost: ~${tokens} tokens per session (injected once at session start)`);
    console.log(`  Write-time check: ${koreanLintMode(loadConfig())}, scope ${koreanLintScope(loadConfig())} (change with: sprag korean lint block|warn|off, korean lint scope all|prose)`);
    console.log(`  Reply-language check: ${koreanReplyCheckOn(loadConfig()) ? 'on' : 'off'} (change with: sprag korean reply on|off)`);
    console.log(`  Source: ${ks.KOREAN_STYLE_SOURCE}`);
    console.log(`  License text: ${ks.KOREAN_STYLE_LICENSE_PATH}`);
    console.log(on
      ? '  Turn off with: sprag korean off'
      : '  Turn on with: sprag korean on');
  }
}
