/**
 * Subcommand: korean — Korean writing guidance for every session.
 *   claude-token-saver korean on       # inject at session start, all projects
 *   claude-token-saver korean off      # stop injecting
 *   claude-token-saver korean status   # current state, cost, and provenance
 *   claude-token-saver korean show     # print the guidance itself
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
 *   claude-token-saver korean lint block|warn|off   # how findings are handled
 *   claude-token-saver korean lint <file...>        # check files on disk
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
      console.error('Usage: claude-token-saver korean lint scope [all|prose]');
      process.exit(1);
    }
    cfg.koreanStyle = cfg.koreanStyle || {};
    cfg.koreanStyle.lintScope = next;
    saveConfig(cfg);
    console.log(lang === 'ko'
      ? (next === 'all'
        ? '검사 범위: all — 문서와 코드 주석, UI 문자열까지 세션이 쓴 모든 텍스트 파일을 검사합니다.'
        : '검사 범위: prose — 마크다운과 텍스트 문서만 검사합니다.')
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
      console.error('Usage: claude-token-saver korean lint [block|warn|off] | korean lint <file...>');
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
    const { installKoreanLintHook, removeKoreanLintHook } = await import('../installer.js');
    const hook = enabled ? installKoreanLintHook() : removeKoreanLintHook();
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
          ? `  쓰기 시점 검사: ${koreanLintMode(loadConfig())}, 범위 ${koreanLintScope(loadConfig())} (Write·Edit 로 쓴 한국어를 검사합니다)`
          : `  Write-time check: ${koreanLintMode(loadConfig())}, scope ${koreanLintScope(loadConfig())} (runs on Korean written via Write/Edit)`);
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
    console.log(`  쓰기 시점 검사: ${koreanLintMode(loadConfig())}, 범위 ${koreanLintScope(loadConfig())} (바꾸려면 claude-token-saver korean lint block|warn|off, korean lint scope all|prose)`);
    console.log(`  출처: ${ks.KOREAN_STYLE_SOURCE}`);
    console.log(`  라이선스 전문: ${ks.KOREAN_STYLE_LICENSE_PATH}`);
    console.log(on
      ? '  끄려면: claude-token-saver korean off'
      : '  켜려면: claude-token-saver korean on');
  } else {
    console.log(`Korean writing guidance: ${on ? 'on' : 'off'}`);
    console.log(`  Cost: ~${tokens} tokens per session (injected once at session start)`);
    console.log(`  Write-time check: ${koreanLintMode(loadConfig())}, scope ${koreanLintScope(loadConfig())} (change with: claude-token-saver korean lint block|warn|off, korean lint scope all|prose)`);
    console.log(`  Source: ${ks.KOREAN_STYLE_SOURCE}`);
    console.log(`  License text: ${ks.KOREAN_STYLE_LICENSE_PATH}`);
    console.log(on
      ? '  Turn off with: claude-token-saver korean off'
      : '  Turn on with: claude-token-saver korean on');
  }
}
