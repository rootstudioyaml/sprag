/**
 * korean-style — inject Korean writing guidance into every session.
 *
 * Claude Code's own mechanism for this is an output style, which is a global
 * switch: turning it on replaces whatever style the user had, and it only
 * applies where the user remembered to configure it. Projects opened on a
 * different machine, or by a teammate, get nothing.
 *
 * This module carries the guidance inside the package instead and hands it to
 * the model through the SessionStart hook claude-token-saver already installs.
 * The rules then apply in every project on the machine, with no output-style
 * change and no plugin to install, and they survive `/clear` because the hook
 * fires again.
 *
 * Cost: the text is ~1.3k tokens, injected once per session (not per turn) and
 * covered by the prompt cache from the second request on. A token-saving tool
 * has no business spending that silently, so the feature is opt-in via
 * `claude-token-saver korean on`.
 *
 * The guidance itself is vendored from fluent-korean
 * (https://github.com/snflkd/fluent-korean), Copyright (c) 2026 snflkd, MIT
 * License — see presets/korean-style/LICENSE-fluent-korean. Only the
 * output-style frontmatter was stripped; the wording is unmodified.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadConfig, saveConfig } from './config.js';

const require = createRequire(import.meta.url);

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const KOREAN_STYLE_PATH = join(packageRoot, 'presets', 'korean-style', 'fluent-korean.md');
export const KOREAN_STYLE_LICENSE_PATH = join(packageRoot, 'presets', 'korean-style', 'LICENSE-fluent-korean');
export const KOREAN_STYLE_SOURCE = 'fluent-korean by snflkd (MIT) — https://github.com/snflkd/fluent-korean';

/** Whether session-start injection is enabled. Off unless the user asked. */
export function koreanStyleEnabled(cfg = loadConfig()) {
  return cfg?.koreanStyle?.enabled === true;
}

/** True once the user has turned the feature on or off explicitly. */
export function koreanStyleDecided(cfg = loadConfig()) {
  return typeof cfg?.koreanStyle?.enabled === 'boolean';
}

/**
 * Whether this machine looks like it writes Korean.
 *
 * Used only to decide the DEFAULT at install time. Turning the guidance on for
 * everyone would bill ~1.5k tokens per session to users who never write a
 * Korean sentence; leaving it off for everyone means the people who need it
 * have to discover a command that exists for exactly them. Locale answers the
 * question well enough, and the user can override either way afterwards.
 *
 * Signals, cheapest first: the tool's own language setting, then the POSIX
 * locale variables, then (macOS only, where those are routinely unset) the
 * system locale.
 */
export function koreanLocaleDetected({ env = process.env, platform = process.platform } = {}) {
  try {
    if (loadConfig().language === 'ko') return true;
  } catch { /* unreadable config falls through to the env checks */ }
  for (const v of [env.LC_ALL, env.LC_MESSAGES, env.LANG, env.LANGUAGE]) {
    // `ko` must be a whole subtag: `ko`, `ko_KR.UTF-8`, `ko-KR`, and the
    // colon-separated `LANGUAGE=ko:en` all count, while `kok` (Konkani) and
    // `tok` do not.
    if (typeof v === 'string' && /(^|[:._-])ko([:._-]|$)/i.test(v)) return true;
  }
  if (platform === 'darwin') {
    try {
      // `LANG` is commonly unset in macOS GUI-launched shells, so the system
      // locale is the only reliable signal there.
      const { execFileSync } = require('node:child_process');
      const out = execFileSync('defaults', ['read', '-g', 'AppleLocale'], {
        encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (/^ko(_|-|$)/i.test(out)) return true;
    } catch { /* `defaults` missing or slow — treat as "not detected" */ }
  }
  return false;
}

export function setKoreanStyleEnabled(enabled) {
  const cfg = loadConfig();
  cfg.koreanStyle = { ...(cfg.koreanStyle || {}), enabled: !!enabled };
  saveConfig(cfg);
  return cfg.koreanStyle;
}

/**
 * The guidance text, with the vendoring comment stripped (it is provenance for
 * readers of the repo, not instruction for the model — and every token of it
 * would be charged on each session).
 *
 * Returns null when the file is missing, which the hook reads as "inject
 * nothing" rather than failing a session start.
 */
export function koreanStyleText() {
  try {
    if (!existsSync(KOREAN_STYLE_PATH)) return null;
    const raw = readFileSync(KOREAN_STYLE_PATH, 'utf8');
    const body = raw.replace(/^<!--[\s\S]*?-->\s*/, '').trim();
    return body || null;
  } catch {
    return null;
  }
}

/**
 * Block to inject at session start, or null when disabled/unavailable.
 *
 * The framing line matters: without it the model can read the guidance as
 * "the user is asking about Korean writing rules" instead of "these rules
 * govern how I write from now on".
 */
// The injected scope sentence and the write-time checker have to agree. When
// they disagree the model is told one thing and corrected for another, which
// is how the August 2026 report started: the scope line read as excluding
// documents, so a session shipped 18 em dashes into a markdown deliverable
// while the guidance was active. These lines are therefore derived from the
// same `lintScope` setting the checker reads.
export function koreanScopeLines(cfg = loadConfig()) {
  const scope = cfg?.koreanStyle?.lintScope === 'prose' ? 'prose' : 'all';
  if (scope === 'prose') {
    return [
      '적용 대상: 대화 답변, 그리고 새로 작성하거나 수정하는 마크다운·문서·보고서의 한국어 산문을 모두 포함합니다.',
      '적용 예외: 원문을 그대로 옮기는 인용, 코드, 코드 주석, 그리고 프로젝트의 기존 표기 관례를 따라야 하는 커밋 메시지와 로그 문자열입니다.',
    ];
  }
  return [
    '적용 대상: 대화 답변, 그리고 세션이 쓰거나 고치는 모든 파일의 한국어를 포함합니다. 문서와 보고서는 물론이고 코드 주석, 화면에 나가는 문자열, 자막과 템플릿, 스크립트가 읽어 산출물을 만드는 데이터 파일까지 모두 해당합니다.',
    '적용 예외: 원문을 그대로 옮기는 인용과, 프로젝트의 기존 표기 관례를 따라야 하는 커밋 메시지와 로그 문자열입니다.',
    '쓰기 시점에 기계 검사가 함께 돌아갑니다. 위반을 알리면 그 파일을 고친 뒤에 다음 작업으로 넘어가십시오.',
  ];
}

export function koreanStyleInjection({ cfg = loadConfig() } = {}) {
  if (!koreanStyleEnabled(cfg)) return null;
  const text = koreanStyleText();
  if (!text) return null;
  return [
    '[claude-token-saver korean-style] 이 세션에서 한국어를 출력할 때는 아래 지침을 따르십시오.',
    '이 지침은 사용자가 claude-token-saver에 설정한 것입니다.',
    ...koreanScopeLines(cfg),
    '표기 규칙(예외 없이 적용): 도구 호출 인자에 한국어를 비롯한 비ASCII 문자열을 담을 때에는 반드시 리터럴 UTF-8로 작성하고, \\uXXXX 유니코드 이스케이프로는 절대 작성하지 마십시오. 이스케이프로 작성하면 글자가 깨진 채 파일에 기록되는 사례가 자주 발생합니다.',
    `(출처: ${KOREAN_STYLE_SOURCE})`,
    '',
    text,
  ].join('\n');
}
