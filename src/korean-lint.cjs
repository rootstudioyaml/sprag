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

// HTML is a document a reader receives, so it is checked under BOTH scopes,
// like prose — but through `stripHtml` first, so tags, comments, and CSS never
// trip the rules. Script bodies are kept: on a static page the Korean UI copy
// (i18n dictionaries, template strings) lives exactly there, and that gap is
// how an em dash shipped to a real landing page unchecked (2026-09-13).
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml', '.vue', '.svelte']);

// Only two kinds of path are skipped: installed dependencies and VCS
// internals, neither of which anyone in this session wrote. Build output is
// deliberately NOT on this list. Generated artifacts are the files a reader
// actually receives, so exempting `dist/` or `build/` would exempt the very
// documents the check exists for.
const SKIP_PATH = /(^|[\\/])(node_modules|\.git|.*\.min\.[a-z]+|.*-lock\.json|.*\.lock)([\\/]|$)/i;
// This module and the hook copy that embeds it quote every banned form.
const SELF_PATH = /(^|[\\/])(korean-lint\.cjs|cache-monitor-hook\.cjs|korean-lint\.test\.js)$/i;

// Opt-out marker. A file that exists to exercise the checker has to contain the
// forms the checker bans, and so does a document quoting a style report. Before
// Bash joined the matcher those files slipped through by accident; now that
// every write route is covered, the exemption has to be something the author
// states on purpose rather than something the tool guesses. One line anywhere
// in the file turns the check off for that file.
const OPT_OUT_MARKER = /korean-lint:\s*(?:off|ignore-file)/i;
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
  // Added 2026-09-13. "fails loudly / fails silently" reads as idiom in English
  // but lands as figurative vocabulary in Korean: a failure has no volume.
  // 0 hits across 400 Korean files in yaml-sns-agent, so the confirm-request is
  // not noise.
  {
    re: /(?:시끄럽게|시끄러운|조용히|조용한)\s*[가-힣]*(?:실패|틀리|드러나|어긋)|(?:실패|오류|버그)[가은는이]?\s*(?:시끄럽|시끄러운|조용하|조용한)/,
    fix: "무엇으로 실패를 확인하는지 적습니다. '종료 코드로 바로 드러나는가'·'검증 없이 지나가는가'",
  },
  {
    re: /안전망/,
    fix: "'검증 수단'·'확인 장치'처럼 무엇이 실패를 잡아내는지 그대로 적습니다",
  },
];

// Guidance 3.2/3.3: literal renderings of English noun phrases.
const TRANSLATIONESE = [
  { re: /에 대한/, fix: '서술어로 풀어 씁니다' },
  { re: /[을를] 위한/, fix: '서술어로 풀어 씁니다' },
  { re: /되어지/, fix: '이중 피동을 없애고 능동이나 단일 피동으로 씁니다' },
  { re: /하는 것을 통해/, fix: "'~해서'·'~함으로써'로 줄입니다" },
  { re: /라고 할 수 있다/, fix: '단정하거나 근거를 붙여 서술합니다' },
  // Conservative additions (2026-09-13), sourced from 국립국어원 공공언어
  // 지침·한글문화연대 교정 사례·쿠버네티스 한글화 가이드. Bar for inclusion:
  // the form is nearly always an improvement to change, so a confirm-request
  // on it is rarely noise. See presets/korean-style/supplement.md.
  { re: /(?:보여|쓰여|불려|잊혀)[지집진질져]/, fix: "이중 피동입니다. '보인다'·'쓰인'·'불린'·'잊힌'처럼 단일 피동으로 씁니다" },
  { re: /에 다름 아니/, fix: "일본어 번역투입니다. '~일 뿐이다'·'바로 ~이다'로 바꿉니다" },
  { re: /지 않으면 안 [되된됩돼]/, fix: "이중 부정 번역투입니다. '~해야 합니다'로 바꿉니다" },
  { re: /(?<!여기|거기|저기|어디)에 있어서/, fix: "'~에서'·'~에는'으로 바꿉니다" },
  { re: /(?:의미|특징|장점|단점|성격|가능성|중요성|효과)[을를] 가지고 있/, fix: "'~이다'·'~가 있다'로 바꿉니다 (have 직역)" },
];

// Guidance 3.7: a period belongs after a 종결어미, not after a nominal ending.
const NOMINAL_ENDING = /(?:음|함|됨|임|점|론|양|성|화)\.$/;

// Sentence closers with no lexical content of their own: existence, negation,
// the copula, and the do-verb. Korean puts these at the end of most sentences,
// so repeating one across two sentences is normal writing. Only content verbs
// repeating is the style problem the cohesion clause means.
const AUXILIARY_ENDING = /^(?:있|없|않|아니|아닙|같|이|뿐이|때문이|것이|거|합|한|했|됩|된|됐|입|였|이었)/;
// The copula and the do-verb also attach to a preceding noun, so they have to
// be matched at the tail as well: `수치입니다`, `설명합니다`, `반영됩니다`.
const AUXILIARY_TAIL = /(?:입니다|입니다만|이다|합니다|한다|됩니다|된다|있습니다|없습니다|않습니다|않는다)$/;

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
  // The rule table has to spell every banned form out, so this file always
  // matches its own lexicon. Checking it reports the rules, not a breach.
  if (SELF_PATH.test(filePath)) return false;
  const dot = filePath.lastIndexOf('.');
  const ext = dot === -1 ? '' : filePath.slice(dot).toLowerCase();
  if (PROSE_EXTENSIONS.has(ext)) return true;
  if (HTML_EXTENSIONS.has(ext)) return true;
  if (scope !== 'all') return false;
  if (!ext) return false;
  return !BINARY_EXTENSIONS.has(ext);
}

// Kept for callers that only ever meant documents.
function isProseFile(filePath) {
  return isLintTarget(filePath, 'prose');
}

function isHtmlFile(filePath) {
  const dot = String(filePath).lastIndexOf('.');
  const ext = dot === -1 ? '' : String(filePath).slice(dot).toLowerCase();
  return HTML_EXTENSIONS.has(ext);
}

/**
 * Blank out the parts of an HTML document no reader sees — comments, CSS, and
 * the tags themselves — while keeping every newline, so finding line numbers
 * still point into the original file. Script bodies stay: that is where the
 * page's Korean copy lives on a static site.
 */
function stripHtml(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, blank)
    .replace(/<[^>]+>/g, blank);
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
  if (OPT_OUT_MARKER.test(text)) return findings;
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

  findings.push(...repeatedEndings(lines, maxFindings - findings.length));

  return findings;
}

/**
 * Adjacent sentences closing on the same predicate.
 *
 * This is a cohesion clause, and cohesion was written off as "needs judgement,
 * so the guidance text has to carry it". That reading cost us the September
 * 2026 report: two sentences in a row ended in `잠급니다`, the machine layer
 * passed the file, and a human caught it on the published page. Identical
 * final 어절 in consecutive sentences needs no judgement at all — it is a
 * string comparison — so it belongs here, where it blocks, rather than in an
 * instruction nobody re-reads.
 *
 * Deliberately narrow to keep the false-positive rate at zero on our own
 * corpus: the two 어절 must match exactly, run at least three characters, and
 * close a sentence. Near-misses (`막습니다` after `잠급니다`) are a judgement
 * call and stay with the cohesion review.
 */
function repeatedEndings(lines, budget) {
  if (budget <= 0) return [];
  const out = [];
  // Sentences are collected with the line they end on, so a finding still
  // points the model at a line it can jump to.
  const sentences = [];
  let buf = '';
  let startLine = 1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Headings, list markers and table rows are labels, not flowing prose.
    if (/^\s*(?:#|\||[-*+]\s|\d+\.\s|>)/.test(raw)) { buf = ''; continue; }
    // Structured data (YAML keys, JSON fields, front matter) holds independent
    // values that happen to sit on neighbouring lines. Joining them invents
    // sentence adjacency that no reader ever experiences.
    if (/^\s*["'\w.-]+\s*:\s/.test(raw) || /^\s*---\s*$/.test(raw)) { buf = ''; continue; }
    if (!buf) startLine = i + 1;
    buf += (buf ? ' ' : '') + raw.trim();
    const parts = buf.split(/(?<=[.!?])\s+/);
    buf = /[.!?]\s*$/.test(raw.trim()) ? '' : parts.pop() || '';
    for (const p of parts) sentences.push({ text: p, line: i + 1, startLine });
    if (!buf) startLine = i + 2;
  }

  const tailOf = (s) => {
    const m = String(s).trim().replace(/[.!?]+$/, '').match(/([가-힣]+)$/);
    const t = m ? m[1] : '';
    // Only verb/adjective endings count; a sentence closing on a noun is
    // already covered by the nominal-ending rule.
    if (!/다$/.test(t) || t.length < 3) return '';
    // Existential, negative and copular closers carry no lexical content, so
    // two of them in a row is ordinary Korean, not a repetition the writer
    // should fix. Measured on 272 Korean files: without this stoplist the rule
    // fires 74 times and nearly all of it is this class.
    if (AUXILIARY_ENDING.test(t) || AUXILIARY_TAIL.test(t)) return '';
    return t;
  };

  for (let i = 1; i < sentences.length && out.length < budget; i++) {
    const a = tailOf(sentences[i - 1].text);
    const b = tailOf(sentences[i].text);
    if (a && a === b) {
      out.push({
        line: sentences[i].line,
        rule: '종결 반복',
        hit: a,
        fix: '앞 문장과 같은 서술어로 끝납니다. 한쪽을 다른 서술어로 바꾸거나 두 문장을 합칩니다',
      });
    }
  }
  return out;
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
 * Files a shell command just wrote.
 *
 * Write is not the only way Korean reaches disk. A heredoc, a `tee`, a `sed -i`
 * or a generator script puts the same prose in the same file, and a subagent
 * that was handed Bash but not Write reaches for `cat > file` as its first
 * choice. Matching only the file-editing tools therefore exempted exactly the
 * artifacts produced by delegated work.
 *
 * Only redirection targets are recognised, never the command body: the body is
 * shell, and linting shell would flag every Korean string in an echo. The file
 * is read back from disk afterwards, so whatever the command actually produced
 * is what gets checked.
 */
function writtenPathsOfBash(command) {
  if (typeof command !== 'string' || !command) return [];
  const out = new Set();
  const add = (p) => {
    if (!p) return;
    const clean = p.replace(/^["']|["']$/g, '');
    if (clean && !clean.startsWith('/dev/') && !/[*?]/.test(clean)) out.add(clean);
  };
  // `> file`, `>> file` — the redirection that covers heredocs and echo alike.
  for (const m of command.matchAll(/(?<![0-9&])>>?\s*("[^"]+"|'[^']+'|[^\s|&;<>()]+)/g)) add(m[1]);
  // `tee file`, `tee -a file`
  for (const m of command.matchAll(/\btee\b(?:\s+-\w+)*\s+("[^"]+"|'[^']+'|[^\s|&;<>()]+)/g)) add(m[1]);
  // In-place edits name their target at the end of the argument list.
  for (const m of command.matchAll(/\b(?:sed|perl)\b[^|;&]*?\s-\w*i\w*\b[^|;&]*?\s("[^"]+"|'[^']+'|[^\s|&;<>()]+)\s*(?:$|[|;&])/g)) add(m[1]);
  return [...out];
}

/**
 * Full check for one PostToolUse payload. Returns null when there is nothing to
 * say, which is the common case and must stay cheap.
 */
function lintToolUse(context, { scope = 'all' } = {}) {
  if (!context) return null;
  const toolName = context.tool_name;
  const toolInput = context.tool_input;

  if (toolName === 'Bash') return lintBashWrites(toolInput, scope);

  const filePath = toolInput && typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
  if (!isLintTarget(filePath, scope)) return null;

  let text = writtenTextOf(toolName, toolInput);
  if (!text || !hasKorean(text)) return null;

  // Edits arrive as fragments, so tag-stripping only applies when the payload
  // is a whole document; a fragment is still linted, just without stripping.
  if (isHtmlFile(filePath) && toolName === 'Write') text = stripHtml(text);
  const findings = lintKoreanText(text, { code: !isProseFile(filePath) });
  if (findings.length === 0) return null;
  return { filePath, findings };
}

/**
 * Check the files a Bash call redirected into. Reads from disk rather than from
 * the command text, because the command is a recipe and only the result is
 * prose. A path that does not exist, is unreadable, or is too large to be
 * authored prose is skipped in silence: this runs after every shell command, so
 * it must cost nothing in the overwhelmingly common case.
 */
const BASH_LINT_MAX_BYTES = 512 * 1024;

function lintBashWrites(toolInput, scope) {
  const command = toolInput && typeof toolInput.command === 'string' ? toolInput.command : '';
  const paths = writtenPathsOfBash(command).filter((p) => isLintTarget(p, scope));
  if (paths.length === 0) return null;

  const fs = require('node:fs');
  for (const p of paths) {
    let text;
    try {
      const st = fs.statSync(p);
      if (!st.isFile() || st.size > BASH_LINT_MAX_BYTES) continue;
      text = fs.readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    if (!hasKorean(text)) continue;
    const findings = lintKoreanText(isHtmlFile(p) ? stripHtml(text) : text, { code: !isProseFile(p) });
    if (findings.length > 0) return { filePath: p, findings };
  }
  return null;
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
  OPT_OUT_MARKER,
  isProseFile,
  isHtmlFile,
  stripHtml,
  lintKoreanText,
  writtenTextOf,
  lintToolUse,
  writtenPathsOfBash,
  formatFindings,
};
