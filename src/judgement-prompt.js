/**
 * judgement-prompt — does a subagent prompt ask for work whose conclusion is a
 * judgement?
 *
 * The delegation grade (routing-switch.js) needs this at the moment the main
 * model hands work to a haiku or sonnet subagent. Work whose answer is read off
 * a command's output or a named file relays fine on a cheaper tier. Work whose
 * answer is a judgement does not: a review that ends in priorities, an audit, a
 * root-cause diagnosis, a web search for candidates, a lookup where "there is
 * none" may be the answer, a check where the output decides what to open next.
 * A cheaper model hands back a confident, wrong answer there and nothing
 * announces it, so the guard sends that work to Opus (see delegation-guard.js).
 *
 * This is a regex and keyword pass, no model call: the hook runs on every
 * Task/Agent call and has to stay in the milliseconds. Precision comes first.
 * A false positive reroutes a delegation that was fine, a false
 * negative only leaves today's behaviour in place.
 *
 * Left out on purpose: a prompt that names the pages to read and only copies
 * facts off them ("Read https://... and quote ..."), which the rule set keeps
 * as a delegable web read. A prompt that is nothing but a file path to an
 * instruction sheet says nothing the pass can read, so it stays unflagged too.
 *
 * Measured 2026-11-08 against the lanes of the narrow-v3 assignment (54
 * prompts, lane 'main' counted as judgement). Six 'main' prompts that are only
 * a file path or a one-word reply say nothing a pass can read and were left
 * out, which leaves 32 positives and 16 negatives:
 *
 *            flagged   not flagged
 *   main        25          7        recall    0.78 (25/32)
 *   other        1         15        precision 0.96 (25/26)
 *
 * The patterns were tuned on these same 54 prompts, so the figures are
 * in-sample; with 16 negatives they are an order of magnitude, not a rate.
 * The misses are mostly page reads whose questions end in "does the page say
 * X": the assignment labels some 'main' and near-identical ones 'web', and no
 * pattern separates the two. The one false positive is such a page read.
 *
 * Re-measured 2026-11-09 after a live session missed a review: paths now
 * shrink to one token before matching (see judgementEvidence), which moved
 * recall from 0.72 to 0.78, and the bare words "audit" and "읽기 전용 조사"
 * left the audit pattern ("it feeds a security audit" and "read-only
 * investigation" describe the purpose, not the job). Over the 240 prompts of
 * the delegation-ledger snapshot the pass flags 52, about 22%. Both samples
 * come from one user.
 */

const MARKER = '<!-- sprag:delegation -->';

// Each kind is a list of regexes over the lowercased prompt, checked in this
// order so the kinds a stricter grade acts on come first. A prompt is a
// judgement when any pattern of any kind matches, unless a gate below applies.
const PATTERNS = {
  diagnosis: [
    /원인(?:을|이|은)? ?(?:진단|분석|찾|파악|조사|가 (?:뭐|무엇))|원인 진단|근본 ?원인|root[- ]?cause|\bdiagnos(?:e|es|is)\b|왜 (?:실패|느|안 ?되|안 ?돼|죽|멈|깨|오류|에러)|why (?:does|is|did|are|do|it|the)\b[^\n]{0,60}(?:fail|slow|crash|break|broken|not work|wrong|hang|stuck|0 impressions)|무엇이 문제|what(?:'s| is) (?:wrong|causing)|troubleshoot/,
  ],
  audit: [
    /감사(?:해|하|를|\s|$)|\baudit (?:the|this|my|our|for|of|it)\b|security review|보안 (?:점검|검토|허점|감사)|허점|취약(?:점|성)[^\n]{0,12}(?:찾|점검|분석|있는지)|vulnerabilit[^\n]{0,20}(?:find|audit|review|look for)|문제(?:점|를|가)? ?(?:찾|발견)|find (?:the )?(?:problems|issues|bugs|gaps|weak)|훑어/,
  ],
  review: [
    /개선점|개선 ?방안|권고|우선순위|improvements?\b|\brecommendations\b|\brecommend (?:which|the (?:best|top)|one|a (?:top|best))\b|prioriti[sz]|순위를 (?:매기|내)|상위 \d+\s*(?:개|건)[^\n]{0,30}(?:추천|고르|선정)|추천(?:해|까지|을)/,
    /(?:검토|리뷰|review)(?:해|하여|해서|하십시오|하세요|를 해| the| this| my)?[^\n]{0,40}(?:개선|문제|결함|issues?|problems?|weakness|improve)/,
  ],
  search: [
    // Looking for sources, candidates or cases on the web. The strong words say
    // so on their own; a site name needs a research verb beside it, because
    // "post it on Hacker News" is not a search.
    /\bwebsearch\b|web search|웹 ?검색|검색으로|검색해|search the web|search for (?:candidates|packs|sources|alternatives|places|options|tools|articles|papers)|(?:web|market)[- ]research|research task|웹 조사|web only|웹으로 조사/,
    /(?:reddit|레딧|hacker news|\bhn\b|itch\.io|github)[\s\S]{0,400}(?:조사|research|수집|모으|모은다|찾아|find\b|후보|candidates|evidence|what practitioners)|(?:조사|research|수집|모으|모은다|찾아|후보|candidates|evidence)[\s\S]{0,400}(?:reddit|레딧|hacker news)/,
  ],
  absence: [
    /없다는 (?:결론|사실)|없다고 (?:단정|판단|보고)|없음을 (?:확인|단정)|(?:is|are) there any\b|does (?:it|the page|the doc|the docs|any page|this) (?:say|mention|describe)|any mention\b|if the page does not answer|read-only search\b/,
  ],
  conditional: [
    /출력에 따라|결과에 따라|보고 (?:나서 )?(?:더 |어느 )|필요하면 (?:소스|코드|파일|로그)|depending on (?:what|the output|the result)|decide (?:which|what) to (?:open|read|look)|follow (?:the )?leads|(?:무엇|뭔)(?:인지)?(?:는|은)? 아직 모(?:른다|릅니다)|구현 (?:상태|여부)[^\n]{0,10}(?:조사|확인)|(?:막히면|실패하면|안 되면|if (?:it is blocked|that fails|blocked))[^\n]{0,80}(?:다음|대체|우회|fall ?back|시도|instead|try)/,
  ],
};

/**
 * A prompt that hands over a finished design to build. The wording ("the
 * design is fixed", "implement the following") is how the main model briefs
 * the implementation worker, and its text mentions audits, reviews and
 * searches only as things the code does. Reading those as the task is the
 * most common false positive in the ledger snapshot.
 */
const IMPLEMENTATION_BRIEF = /구현 작업|설계(?:가|는|를)? (?:이미 )?확정|권장 모델|수정할 파일|수정 대상|(?:만들|작성할|생성할) 파일|완료 기준|leave (?:the )?changes uncommitted|do not git commit|커밋하지 마십시오|files to (?:create|add|change)|you are (?:extending|implementing)|^\s*(?:implement|extend)\b|implement the follow|(?:design|spec) is (?:fixed|final|settled)/;

/**
 * A prompt that closes the web off and points at a file or pasted text to work
 * from. Its mentions of Reddit or Hacker News name the content, not a search.
 */
const SOURCE_IS_GIVEN = /파일 내용만으로|파일만으로|웹을 새로 조회하지|(?:do not|don't) (?:search|browse|fetch)[^\n]{0,20}(?:the )?web|only from the (?:file|text)/;

/** True when `re` matched at `m.index` inside a negation, "do not diagnose" or "원인 분석을 하지 말고". */
function negated(text, m) {
  const before = text.slice(Math.max(0, m.index - 14), m.index);
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
  return /(?:do not|don't|never|without|no)\s+$/.test(before) || /하지 (?:말|마|않)|금지|안 ?합니다/.test(after);
}

/**
 * A prompt that names pages and asks for what they say. The gate looks for a
 * URL, a read or fetch verb, and no search verb, so a prompt that goes looking
 * for sources is not mistaken for a page read.
 */
function isPageRead(text) {
  if (!/https?:\/\//.test(text)) return false;
  if (!/\b(?:read|fetch|open)\b|읽고|읽어|확인할 페이지/.test(text)) return false;
  const bare = text.replace(/https?:\/\/\S+/g, ' ');
  return !PATTERNS.search.some((re) => re.test(bare));
}

/**
 * @param {string} prompt - the subagent prompt as the caller wrote it
 * @returns {{ judgement: boolean, kind: 'review'|'audit'|'diagnosis'|'search'|'absence'|'conditional'|null }}
 */
export function isJudgementDelegation(prompt) {
  const { judgement, kind } = judgementEvidence(prompt);
  return { judgement, kind };
}

/** Same answer plus the text that triggered it, for tests and for measuring false positives. */
export function judgementEvidence(prompt) {
  if (typeof prompt !== 'string' || prompt === '') return { judgement: false, kind: null, match: null };
  // The guard's own appendix is not part of what the caller asked for.
  const cut = prompt.indexOf(MARKER);
  // Paths shrink to one token first. The patterns keep their words within a
  // short distance, and a real delegation names its directory in full: "review
  // the file app.js in /private/tmp/…/project for security problems" put 70
  // characters between the verb and its object and passed as not judgement in a
  // live session, while the same prompt with a short path was caught.
  const text = (cut === -1 ? prompt : prompt.slice(0, cut)).toLowerCase()
    .replace(/(?:~|\.{0,2})?\/[^\s`'"()<>,;]+/g, '<path>');
  if (IMPLEMENTATION_BRIEF.test(text) || SOURCE_IS_GIVEN.test(text) || isPageRead(text)) return { judgement: false, kind: null, match: null };
  for (const [kind, res] of Object.entries(PATTERNS)) {
    for (const re of res) {
      const m = re.exec(text);
      if (m && !negated(text, m)) return { judgement: true, kind, match: m[0].slice(0, 40) };
    }
  }
  return { judgement: false, kind: null, match: null };
}

/** Kinds the 'cost' grade still raises: a wrong answer here costs the most and shows the least. */
export const SAVING_GRADE_KINDS = new Set(['diagnosis', 'audit']);
