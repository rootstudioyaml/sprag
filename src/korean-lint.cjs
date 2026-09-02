#!/usr/bin/env node
/**
 * korean-lint — machine-checkable half of the fluent-korean guidance.
 *
 * Why this exists next to korean-style.js:
 *
 * korean-style.js hands the model ~1.3k tokens of prose at session start. That
 * is the right way to teach judgement, but prose has no enforcement point. The
 * model reads it once, writes forty files over the next two hours, and nothing
 * ever re-checks the output. Users reported exactly that hole: the guidance was
 * loaded, the session still shipped `~는 자리` and `~의 흐름` into documents,
 * and it surfaced only when a human read the finished artifact.
 *
 * So the clauses a machine can decide are checked at write time instead. The
 * PostToolUse hook already runs on Write/Edit, so every file the session
 * produces passes through here and findings are handed back to the model while
 * it can still fix them.
 *
 * Scope: every text file the session writes, documents and source alike. The
 * vendored guidance exempts code comments, but a comment is read by a person
 * and generated artifacts are assembled from the strings sitting in source, so
 * exempting them reopens the gap for exactly the outputs that were reported.
 * `isLintTarget(path, 'prose')` restores the narrow reading. Only dependencies,
 * VCS internals, lockfiles, and binary or image files are skipped; build output
 * is checked like anything else, and fenced code blocks are dropped from
 * documents. Findings are requests to confirm, not
 * verdicts — a settled idiom or a verbatim quotation is allowed to stay.
 *
 * Zero dependencies, CommonJS, so ~/.claude/cache-monitor-hook.cjs can require
 * it standalone.
 */

'use strict';

// Documents. Under the `prose` scope these are the only files checked.
const PROSE_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']);

// Only two kinds of path are skipped: installed dependencies and VCS
// internals, neither of which anyone in this session wrote. Build output is
// deliberately NOT on this list. Generated artifacts are the files a reader
// actually receives, so exempting `dist/` or `build/` would exempt the very
// documents the check exists for.
const SKIP_PATH = /(^|[\\/])(node_modules|\.git|.*\.min\.[a-z]+|.*-lock\.json|.*\.lock)([\\/]|$)/i;
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.pdf', '.zip', '.gz', '.tar',
  '.mp3', '.mp4', '.wav', '.mov', '.woff', '.woff2', '.ttf', '.otf', '.map', '.bin',
]);

/**
 * Figurative vocabulary (guidance 3.4). This is the clause human review misses
 * most often, because each individual phrase reads fine in isolation — it is
 * only against the rule that it is standing where a plain noun or verb should.
 * Add a line here when a new one shows up; that is the whole maintenance story.
 */
const METAPHOR_LEXICON = [
  // `자리` is the single most common substitution for a plain noun. Physical
  // seating is the rare literal use, so those modifiers are excluded and
  // everything else is raised for confirmation.
  { re: /(?<!빈 |좌석 |앞 |뒤 |옆 )(?:^|(?<=\s))자리(?:에서|에서는|에|로|가|는|다|입니다|였습니다)?(?=\s|$|[.,·)])/, fix: "'지점'·'상황'·'부분'처럼 뜻을 그대로 담은 명사로 바꿉니다" },
  { re: /[가-힣]+의\s*흐름/, fix: "'방향'·'순서'·'경과'로 바꿉니다" },
  { re: /닿(?:는다|습니다|아|는 지점)/, fix: "'겨냥하다'·'해당하다'처럼 동작을 그대로 서술합니다" },
  { re: /박(?:아 두|혀 있|아 넣)/, fix: "'명시하다'·'기록하다'로 바꿉니다" },
  { re: /걷어내/, fix: "'없애다'·'제거하다'로 바꿉니다" },
  { re: /손대(?:는|지|어)/, fix: "'수정하다'·'변경하다'로 바꿉니다" },
  { re: /발목을 잡/, fix: '무엇이 어떻게 막는지 그대로 서술합니다' },
  { re: /민낯|속살/, fix: "'실제 상태'·'내부 구조'로 바꿉니다" },
  { re: /열쇠(?:다|입니다|가 된다)/, fix: "'핵심 조건'·'결정 요인'으로 바꿉니다" },
  { re: /물꼬|신호탄|분수령|기폭제/, fix: '무엇이 시작되고 무엇이 바뀌는지 그대로 적습니다' },
  { re: /판(?:을|도가|이)\s*(?:흔들|바뀌|뒤집)/, fix: '무엇이 어떻게 달라지는지 그대로 적습니다' },
  { re: /몸집|심장부|두뇌 역할/, fix: "'규모'·'중심 구성 요소'로 바꿉니다" },
  { re: /벽에 부딪|길을 열|문을 열/, fix: '무엇이 막히고 무엇이 가능해지는지 그대로 적습니다' },
  { re: /갈림길|갈리는 지점/, fix: "'결정이 나뉘는 조건'으로 바꿉니다" },
  { re: /깨어나|잠들어 있/, fix: "'동작을 시작하다'·'실행되지 않고 있다'로 바꿉니다" },
];

// Guidance 3.2/3.3: literal renderings of English noun phrases.
const TRANSLATIONESE = [
  { re: /에 대한/, fix: '서술어로 풀어 씁니다' },
  { re: /[을를] 위한/, fix: '서술어로 풀어 씁니다' },
  { re: /되어지/, fix: '이중 피동을 없애고 능동이나 단일 피동으로 씁니다' },
  { re: /하는 것을 통해/, fix: "'~해서'·'~함으로써'로 줄입니다" },
  { re: /라고 할 수 있다/, fix: '단정하거나 근거를 붙여 서술합니다' },
];

// Guidance 3.7: a period belongs after a 종결어미, not after a nominal ending.
const NOMINAL_ENDING = /(?:음|함|됨|임|점|론|양|성|화)\.$/;

/**
 * Which files the checker opens.
 *
 * `prose` follows the guidance's own exemption list: documents only, because
 * code and comments are excluded there. `all` is the scope users asked for
 * once they saw what the narrow reading costs — Korean written into a comment,
 * a UI string, or a template ends up in front of a reader exactly like a
 * document does, and a generated PDF is assembled from those strings. Under
 * `all` the only things skipped are installed dependencies, lockfiles, and
 * files that are not text.
 *
 * When the scope is `all` the injected guidance says so too (see
 * korean-style.js), so the model is told the same rule the checker enforces.
 */
function isLintTarget(filePath, scope = 'all') {
  if (!filePath) return false;
  if (SKIP_PATH.test(filePath)) return false;
  const dot = filePath.lastIndexOf('.');
  const ext = dot === -1 ? '' : filePath.slice(dot).toLowerCase();
  if (PROSE_EXTENSIONS.has(ext)) return true;
  if (scope !== 'all') return false;
  if (!ext) return false;
  return !BINARY_EXTENSIONS.has(ext);
}

// Kept for callers that only ever meant documents.
function isProseFile(filePath) {
  return isLintTarget(filePath, 'prose');
}

/** Drop fenced code blocks and inline code so snippets never trip the rules. */
function stripCode(text) {
  const out = [];
  let fenced = false;
  for (const line of String(text).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      out.push('');
      continue;
    }
    out.push(fenced ? '' : line.replace(/`[^`]*`/g, ' '));
  }
  return out;
}

function hasKorean(s) {
  return /[가-힣]/.test(s);
}

/**
 * Lint one document. Returns `[{ line, rule, hit, fix }]`, empty when clean.
 * `lines` are 1-indexed against the original text so the model can jump
 * straight to the offending line.
 */
function lintKoreanText(text, { maxFindings = 20, code = false } = {}) {
  const findings = [];
  const lines = stripCode(text);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!hasKorean(line)) continue;
    // Reference lists and link lines are citations, not authored prose.
    if (/^\s*\[\d+\]:/.test(line)) continue;
    // A document that teaches the rules has to spell the banned form out. Its
    // headings and its ✗/○ example pairs are quotations of the rule, not
    // breaches of it, so they are left alone.
    if (/^\s*#/.test(line)) continue;
    if (/[✗○✘❌⭕]/.test(line)) continue;

    const at = i + 1;
    const push = (rule, hit, fix) => {
      if (findings.length < maxFindings) findings.push({ line: at, rule, hit, fix });
    };

    // In a source file `|` is an operator, so only the dashes are checked
    // there; in a document a leading `|` is a table row rather than a sentence.
    const sep = line.match(code ? /[—ㅡ]/ : /[—ㅡ|]/);
    if (sep && !(sep[0] === '|' && /^\s*\|/.test(line))) {
      push('구분자', sep[0], '접속사나 쉼표, 가운뎃점(·)으로 바꿉니다');
    }

    for (const { re, fix } of TRANSLATIONESE) {
      const m = line.match(re);
      if (m) push('번역체', m[0], fix);
    }

    for (const { re, fix } of METAPHOR_LEXICON) {
      const m = line.match(re);
      if (m) push('비유 어휘', m[0], fix);
    }

    for (const chunk of line.split(/[.,·\n]/)) {
      const count = (chunk.match(/[가-힣]의(?=\s|[가-힣])/g) || []).length;
      if (count >= 3) {
        push("'의' 반복", chunk.trim().slice(0, 30), '생략된 문장 성분이 없는지 확인합니다');
        break;
      }
    }

    const trimmed = line.trim();
    if (NOMINAL_ENDING.test(trimmed) && !/^[#>\-*\d]/.test(trimmed)) {
      push('명사형 종결', trimmed.slice(-8), "마침표를 빼거나 '~습니다'로 끝맺습니다");
    }
  }

  return findings;
}

/** Pull the text a Write/Edit/MultiEdit call just put on disk. */
function writtenTextOf(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  if (toolName === 'Write') return typeof toolInput.content === 'string' ? toolInput.content : null;
  if (toolName === 'Edit') return typeof toolInput.new_string === 'string' ? toolInput.new_string : null;
  if (toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
    const joined = edits.map((e) => (e && typeof e.new_string === 'string' ? e.new_string : '')).join('\n');
    return joined || null;
  }
  return null;
}

/**
 * Full check for one PostToolUse payload. Returns null when there is nothing to
 * say, which is the common case and must stay cheap.
 */
function lintToolUse(context, { scope = 'all' } = {}) {
  if (!context) return null;
  const toolName = context.tool_name;
  const toolInput = context.tool_input;
  const filePath = toolInput && typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
  if (!isLintTarget(filePath, scope)) return null;

  const text = writtenTextOf(toolName, toolInput);
  if (!text || !hasKorean(text)) return null;

  const findings = lintKoreanText(text, { code: !isProseFile(filePath) });
  if (findings.length === 0) return null;
  return { filePath, findings };
}

/** Render findings as the message handed back to the model. */
function formatFindings(filePath, findings) {
  const head = `[korean-style] ${filePath} 에 문체 규약 위반 ${findings.length}건이 있습니다. 파일을 고친 뒤 계속하십시오.`;
  const body = findings.map((f) => `  ${f.line}행 ${f.rule}: "${f.hit}" 이 걸렸습니다. ${f.fix}`);
  const tail = '  (원문 인용이거나 이미 굳은 표현이면 그대로 두고, 그 이유를 한 줄로 밝히십시오.)';
  return [head, ...body, tail].join('\n');
}

module.exports = {
  METAPHOR_LEXICON,
  isLintTarget,
  isProseFile,
  lintKoreanText,
  writtenTextOf,
  lintToolUse,
  formatFindings,
};
