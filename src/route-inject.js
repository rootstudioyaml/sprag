/**
 * Turn a registered delegation rule into a per-request instruction.
 *
 * Why this exists: rules were registered and then not used. Measured on the
 * author's logs, 337 of 1296 episodes were delegation-eligible and 12 were
 * delegated (3.6%); five of ten registered rules had never fired. Rule wording
 * was not the whole story — the session also carries a general instruction not
 * to spawn subagents unless asked, and ratchet-model.md tries to overrule it in
 * prose. Between two instructions that disagree, the cautious one wins.
 *
 * So this stops arguing in prose. The hook classifies the request that just
 * arrived and states the matching rule as a fact about THIS request, which
 * leaves the model nothing to resolve: no rule list to scan, no self-matching
 * step, no conflict to weigh.
 *
 * Deliberately silent when it cannot be sure:
 *   - the request text does not classify (about half of them, by measurement —
 *     difficulty mostly surfaces after the first tool call, and at prompt time
 *     there are no tool calls yet)
 *   - the text trips ESCALATE_RE (design, analysis, deploy, merge …), where the
 *     top tier is the right answer and a nudge downward would be wrong
 *   - the text trips EDIT_RE (implement, add, fix …): editing is not delegable
 *     however much the sentence also says "install" or "check"
 *   - no registered rule covers that category
 *   - the request is an explanation question ("어떻게 동작해", "뭐야", "how does
 *     …") whose only category evidence is one weight-1 keyword. "sprag 설치만으로
 *     … 도구에서 어떻게 쓰이는거지?" scored run on the bare word 설치 and was told
 *     to hand a question about how the tool behaves to a command-running haiku.
 *     Answering it takes the main model's knowledge, not a command. The read
 *     category is exempt: explaining is what it is for.
 *   - the "prompt" is a message the harness wrote, not the user: a background
 *     task notification, a system reminder, a slash-command echo. Measured over
 *     14 days, 25 of 67 `<task-notification>` messages carried a hint.
 *   - the text asks for an opinion ("…하는게 좋은가?", "…괜찮지 않을까 싶은데")
 *     and no request verb follows. Answering it is judgement, not a lookup. On
 *     a 28-day corpus the pattern removed 6 of 286 hints and none of the turns
 *     that actually delegated.
 * A hint that fires on the wrong request costs more than one that stays quiet.
 */

import { categorizeScored, ESCALATE_RE, JUDGE_RE, EDIT_RE, worthDelegating } from './route-scan.js';
import { delegationGrade, normalizeDelegationGrade, gradeKeepsRule } from './routing-switch.js';
import { loadModelRules, budgetCapPhrase, ruleBudget } from './model-rules.js';
import { sharedProjectRoots, realProjectRoot, scopeRank } from './shared-model-rules.js';
import { agentPhrase, agentPhraseEn, resolveAgentName, agentForRule, TIER_MODEL } from './agents.js';
import { userLanguage } from './config.js';
import { aliasForRole, resolveModelAlias } from './model-alias.js';
import { isRecognizedModelId, modelRank, TIER_TARGET_RANK } from './cost.js';
import { loadRecentSnapshot } from './caps-cache.js';
import { getSessionModel } from './parser.js';
import { labelForKey } from './window-labels.js';

const PASTE_MIN_LINES = 8;
const LOG_SHAPE_RE = /^\s+at\s|\b(error|exception|traceback|warn(ing)?|fatal)\b|^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/im;
export function looksPasted(text) {
  const lines = (String(text).match(/\n/g) || []).length;
  return lines >= PASTE_MIN_LINES || LOG_SHAPE_RE.test(text);
}

/**
 * Messages the harness injects into the user turn. They arrive through the same
 * hook as typed prompts but are not requests, so nothing here is routed. A
 * `<pasted_content` wrapper is deliberately absent: that is the user's own text.
 */
const SYSTEM_PROMPT_PREFIXES = [
  '<task-notification>', '<system-reminder>', '<command-name>', '<command-message>', '<command-args>',
  '<local-command-', '<bash-input>', '<bash-stdout>', '<bash-stderr>', '[Request interrupted',
  // A background subagent's report and the summary that opens a compacted
  // session arrive as user turns too. A hint there told the main model to
  // delegate the checking of a subagent's own result (#16 follow-up).
  'Another Claude session sent a message', '<agent-message', '[SYSTEM NOTIFICATION',
  'This session is being continued from a previous conversation',
];

/** True for a message the harness wrote rather than the user (see SYSTEM_PROMPT_PREFIXES). */
export function isSystemPrompt(text) {
  const t = String(text || '').trim();
  return SYSTEM_PROMPT_PREFIXES.some((p) => t.startsWith(p));
}

/**
 * A paragraph that opens with a short bracketed label ("[운영 규칙] …",
 * "[리마인더] …") is a standing instruction a wrapper adds to every message,
 * such as a Slack bot's prompt suffix.
 */
const STANDING_PARA_RE = /^\[[^\]\n]{1,24}\][ \t]/;

/**
 * The user's request without the standing-instruction paragraphs a wrapper puts
 * before or after it. A 130-character "[운영 규칙]" suffix on every Slack message
 * made each prompt read as a long spec: over 260 such prompts the delegation hint
 * fired 0 times instead of 24, and the implementation reminder 236 times instead
 * of 21. A prompt that is nothing but such a paragraph is kept as it is.
 */
export function stripStandingInstructions(text) {
  const paras = String(text || '').trim().split(/\n[ \t]*\n/);
  while (paras.length > 1 && STANDING_PARA_RE.test(paras[paras.length - 1].trim())) paras.pop();
  while (paras.length > 1 && STANDING_PARA_RE.test(paras[0].trim())) paras.shift();
  return paras.join('\n\n').trim();
}

/** Endings that ask what the model thinks ("좋은가", "괜찮지 않을까", "should we"). */
const OPINION_RE = /(?:좋은가|좋을까|좋겠지|좋지\s*않|낫겠|낫지\s*않|나을까|나을\s*듯|괜찮(?:을까|은가|겠|지\s*않)|어때|어떨까|어떤가|맞(?:을까|는\s*건가|는가)|아닐까|아닌가|싶은데|듯\s*한데|생각(?:해|이)|의견|\bshould\s+(?:we|i)\b|\bwhat do you think\b|\bis it (?:better|worth)\b)/i;
/** A request verb in the same text turns the opinion ending back into a task ("…아닐까 확인해줘"). */
const REQ_RE = /(?:해|봐|줘|찾아|알려|보여|돌려|만들어|올려|정리해)\s*(?:줘|주세요|줄래|봐|보자)|해줘|하자|해봐|부탁/;

/** True for a question that asks for an opinion and carries no request verb. */
export function isOpinionQuestion(text) {
  const t = String(text || '');
  return OPINION_RE.test(t) && !REQ_RE.test(t);
}

/** Shortest text worth classifying; below this a prompt is an ack, not a task. */
const MIN_LEN = 8;

// Gates added after the #16 calibration experiment (600 labelled prompts, of
// which the rule hint had marked 47 test prompts for T2 and 43 of them needed
// the main model). Each targets a shape of those misfires; tuned on the
// calibration split only.

/**
 * A reply to the previous turn rather than a new task: an ack or a pointer
 * ("응 블렌더로…", "그래 네가 돌려봐", "아니면 …", "아,, 뭐야 이게", "A로 더
 * 다듬어서"). What it continues lives in the conversation, which the hook does
 * not see, so a keyword in it says nothing about the work.
 */
const CONTINUATION_RE = /^(?:응|네|넵|그래|그럼|그러면|아니|아+\s*[,.~]|오케이|ok(?=[\s,.!]|$)|좋아|좋네|이건|이거|그건|그거|저건|저거|[A-Za-z]\s*로\s)/i;
/** Feedback on what the model just made ("…가 아니야", "…게 아니라 …"). */
const FEEDBACK_RE = /(?:가|이|게)\s*아니(?:야|라|고|에요|잖)/;
/** The user says they will check, or that checking is needed: a statement, not a request. */
const SELF_CHECK_RE = /확인(?:할게|해\s*볼게|하겠|해볼께|할께)|확인이?\s*필요/;
/**
 * Outward actions that ESCALATE_RE does not list: uploading, posting, sending,
 * deleting, paying. A plain `git push` stays with the run category, as before.
 */
const OUTWARD_RE = /업로드|게시해|게시하|발송|올려\s*(?:줘|주|줄)|보내\s*(?:줘|주|줄)|삭제|지워\s*(?:줘|주)|결제/;
/**
 * Open research on the web: news, communities, alternatives, candidates,
 * trends. A cheaper model stops after a few searches and nothing shows what it
 * missed. In the #16 follow-up review, two of the three hinted delegations
 * that lost quality without anyone noticing were of this kind (a news roundup
 * that missed the week's main story, an asset search that never opened the
 * main marketplace), and neither prompt tripped any other gate.
 */
const OPEN_RESEARCH_RE = /인터넷|웹\s*(?:에서|으로|검색)|뉴스|소식|레딧|reddit|해커뉴스|hacker\s*news|오픈\s*소스|대안|후보|사례|트렌드|동향/i;

/** Edit asks EDIT_RE misses: change, remove, set up, add, polish, generate. */
const EDIT_MORE_RE = /변경해|변경하|바꾸고|없애|빼\s*(?:줘|주|고|자)|[셋세]팅하자|설정하자|구성해|구성하|추가해|다듬|넣고|처리해\s*(?:줘|주)|만들어\s*(?:줘|주|봐)|생성해|적용해|적용하자/;
/**
 * Above this length a request that is not a paste is a written spec: several
 * asks and conditions in one turn. None of the long prompts the hint marked in
 * the calibration split were a lookup or a command.
 */
const SPEC_LEN = 100;

/** True when one of the #16 gates says the request is not the light work its keywords suggest. */
export function looksLikeContextOrSpec(text) {
  const t = String(text || '').trim();
  return CONTINUATION_RE.test(t) || FEEDBACK_RE.test(t) || SELF_CHECK_RE.test(t)
    || OUTWARD_RE.test(t) || EDIT_MORE_RE.test(t) || OPEN_RESEARCH_RE.test(t)
    || (t.length > SPEC_LEN && !looksPasted(t));
}

/**
 * True when a prompt reads as a request to write or change code: an edit ask
 * (EDIT_RE, EDIT_MORE_RE) or a written spec (long and not a paste), minus
 * outward actions and open web research. routeMatch never hints for such a
 * request, so src/impl-follow.js uses this to remind about the implementation
 * split at prompt time. Harness-written messages and acks are not requests.
 */
export function looksLikeImplementation(text) {
  const t = stripStandingInstructions(text);
  if (t.length < MIN_LEN || isSystemPrompt(t)) return false;
  if (OUTWARD_RE.test(t) || OPEN_RESEARCH_RE.test(t)) return false;
  return EDIT_RE.test(t) || EDIT_MORE_RE.test(t) || (t.length > SPEC_LEN && !looksPasted(t));
}

/**
 * A question that asks for an explanation ("어떻게 쓰이는거지?", "뭐야", "how
 * does it work"). "왜" is not here: ESCALATE_RE already routes it to the top
 * tier. Kept to the shapes that ask HOW or WHAT something is — a bare "?" or a
 * sentence-final "-지?" is too common in ordinary commands to count.
 */
const EXPLAIN_Q_RE = /어떻게\s*(?:쓰|사용|동작|작동|해야|하면|하는|하지|하죠|되는\s*(?:거|건|걸|것))|어떤\s*식으로|어떨\s*때|뭐야|뭐지|무엇|무슨\s*(?:의미|뜻)|\bhow\s+(?:does|do)\b|\bwhat\s+(?:is|does)\b/i;
/**
 * "어떻게 돼 / 됐 / 되고 있" asks for the current state of something, which is
 * a check request however it is phrased. EXPLAIN_Q_RE does not list these, and
 * this guard keeps it that way if "어떻게 되는 거" is ever matched next to one.
 */
const STATE_Q_RE = /어떻게\s*(?:돼|됐|됬|되어\s*있|되고\s*있)/;
/** The category rests on exactly one weight-1 keyword. */
const WEAK_SCORE = 1;
/**
 * The category whose job is to explain. Its weight-1 keywords (설명, 알려줘,
 * 뭐야 …) share one pattern, so a question shape adds no evidence against it,
 * and the registered rule names "4번 보정이 뭐야" as its own example.
 */
const EXPLAINING_CATEGORY = 'read';

/** True for a question that asks how something works or what it is. */
export function isExplainQuestion(text) {
  const t = String(text || '');
  return EXPLAIN_Q_RE.test(t) && !STATE_Q_RE.test(t);
}

/**
 * Price rank of whatever model is answering this session, or null when it
 * cannot be established.
 *
 * Only a recognized id counts. `modelRank()` prices an unknown string as Sonnet
 * so a cost estimate always has an answer, but here that guess would silence
 * every T1 hint behind a gateway whose house alias (`prod-large`) names no
 * Claude family — so an unrecognized id returns null and the hint keeps its
 * previous behaviour instead.
 *
 * Sources, most trustworthy first: the session's own transcript, the gateway
 * model environment, and finally the statusline snapshot, which is shared by
 * every session on the machine and therefore only consulted last.
 *
 * @returns {number|null}
 */
export function sessionModelRank({ env = process.env, transcriptPath = null, snapshot } = {}) {
  const rankOf = (raw) => {
    if (!raw) return null;
    if (isRecognizedModelId(raw)) return modelRank(raw);
    // An opaque gateway id can still be priced through profile-map.json.
    const mapped = resolveModelAlias(raw, { env });
    return isRecognizedModelId(mapped) ? modelRank(mapped) : null;
  };
  const fromTranscript = rankOf(getSessionModel(transcriptPath));
  if (fromTranscript !== null) return fromTranscript;
  const fromEnv = rankOf(aliasForRole('main', env));
  if (fromEnv !== null) return fromEnv;
  const snap = snapshot === undefined ? loadRecentSnapshot() : snapshot;
  return rankOf(snap && snap.model);
}

/**
 * Tiers a delegation cannot reach in this session, because the alias the hint
 * names resolves to no model here.
 *
 * A host that manages the provider writes the ANTHROPIC_DEFAULT_*_MODEL
 * variables itself, from the models registered in its own settings, and
 * leaves the unregistered ones empty; settings.json `env` does not override
 * them. The Claude Desktop app does this in its third-party mode
 * (CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1), and a Task(model: "haiku") there
 * runs on the session model. Measured 2026-10-12: with no haiku registered the
 * run answered on the parent's Opus profile, and after registering one, on the
 * Haiku profile. Hinting a delegation in that state costs a subagent's context
 * and saves nothing. Outside such a host an unset variable selects Claude
 * Code's built-in default for the tier, so nothing is reported unreachable.
 */
const TIER_ALIAS_ENV = { T2: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', T1: 'ANTHROPIC_DEFAULT_SONNET_MODEL', T1H: 'ANTHROPIC_DEFAULT_OPUS_MODEL' };
const TIER_ALIAS = { T2: 'haiku', T1: 'sonnet', T1H: 'opus' };

export function unreachableTiers(env = process.env) {
  if (env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST !== '1') return [];
  return Object.keys(TIER_ALIAS_ENV).filter((tier) => !env[TIER_ALIAS_ENV[tier]]);
}

/**
 * The rules a prompt matches, or null when the hint should stay quiet.
 *
 * @param {string} text the prompt just submitted
 * @param {object} [opts]
 * @param {Array} [opts.rules] registered rules (defaults to the stored registry)
 * @param {number|null} [opts.sessionRank] price rank of the model reading the
 *   hint (see sessionModelRank). null means unknown, and an unknown session
 *   model filters nothing.
 * @param {object} [opts.env] environment to read tier aliases from (see
 *   unreachableTiers)
 * @param {string} [opts.grade] delegation grade (routing-switch.js), 'quality'
 *   unless a relax window is open. 'cost' gates on ESCALATE_RE alone; 'quality' also
 *   gates on JUDGE_RE and drops the T2 rules of every category but paste,
 *   read and translate.
 * @returns {{cat: object, t2: object|undefined, t1: object|undefined, unreachable?: string[]}|null}
 *   `unreachable` is set, with neither t2 nor t1, when every matching tier is
 *   one this session cannot reach
 */
export function routeMatch(text, { rules, sessionRank = null, root, env = process.env, grade = delegationGrade() } = {}) {
  const t = stripStandingInstructions(text);
  if (t.length < MIN_LEN) return null;
  // A task notification or command echo is not a request, whatever words it holds.
  if (isSystemPrompt(t)) return null;
  // Judgement and irreversible work stay on the top tier. This check comes
  // before classification because such a request often looks like a light
  // "run" or "check" in its wording.
  if (ESCALATE_RE.test(t)) return null;
  // At grade 'quality' the gate is wider: audits, recommendations, absence
  // checks and research end in a judgement as well (JUDGE_RE).
  if (isQualityGrade(grade) && JUDGE_RE.test(t)) return null;
  // Same for implementation work dressed as a run or a check: an edit is not
  // delegable, and with no tool calls yet only the wording can say so.
  if (EDIT_RE.test(t)) return null;
  // "…하는게 좋은가?" asks what the model thinks. The answer is judgement, and a
  // hint to hand it to a cheaper model is wrong however light the keywords look.
  if (isOpinionQuestion(t)) return null;
  // A reply, feedback, an outward action, an edit or a long spec (#16).
  if (looksLikeContextOrSpec(t)) return null;

  const scored = categorizeScored(t, null);
  if (!scored) return null;
  const cat = scored.cat;
  // A category carried by one weak keyword is a guess, and an explanation
  // question is the case where the guess is most often wrong: "설치" inside a
  // question about how a tool works is not a request to install anything.
  // Two or more points (a command, or several keywords) keep the old verdict.
  if (scored.score === WEAK_SCORE && cat.id !== EXPLAINING_CATEGORY && isExplainQuestion(t)) return null;
  // Length alone makes a paste offline, where the tool mix confirms it. At
  // prompt time a long text is as often a written spec as a pasted log, and a
  // spec is not haiku work — so it must also look pasted: many lines, or the
  // shape of a log or stack trace. Otherwise stay quiet rather than fall
  // through to keyword scoring, which a long request trips by accident.
  if (cat.id === 'paste' && !looksPasted(t)) return null;

  const all = rules || loadModelRules().rules || [];
  // The registry is shared with Codex, so a project rule approved in one
  // project must not route another. A session whose directory is unknown gets
  // global rules only.
  const roots = root ? sharedProjectRoots(root) : [];
  const inScope = (r) => r.scope !== 'project' ||
    (typeof r.targetRoot === 'string' && roots.includes(realProjectRoot(r.targetRoot)));
  const matched = all.filter((r) => r && r.category === cat.id && inScope(r) && gradeKeepsRule(grade, r));
  if (!matched.length) return null;
  // A rule only saves anything when its target tier is cheaper than the model
  // reading the hint. A T1 rule states "delegate to model: sonnet", which in a
  // Sonnet session instructs a delegation worth nothing — and contradicts the
  // registry's own clause that a session already at the target tier does not
  // delegate. So drop the tiers this session cannot profit from; if that leaves
  // nothing (a haiku session), stay quiet.
  const usable = sessionRank === null
    ? matched
    : matched.filter((r) => worthDelegating(r.tier, sessionRank));
  if (!usable.length) return null;
  // A tier whose alias resolves to nothing would run on the session model, so
  // it is dropped like a tier that saves nothing. When that empties the list
  // the match is still reported, so the hint can say why it does not delegate.
  const unreachable = unreachableTiers(env);
  const reachable = usable.filter((r) => !unreachable.includes(r.tier));
  if (!reachable.length) return { cat, unreachable: [...new Set(usable.map((r) => r.tier))] };

  // The closest scope states the cap, whatever order the registry holds.
  const nearest = [...reachable].sort((a, b) => scopeRank(b) - scopeRank(a));
  const t2 = nearest.find((r) => r.tier === 'T2');
  const t1 = nearest.find((r) => r.tier === 'T1');
  const t1h = nearest.find((r) => r.tier === 'T1H');
  return t2 || t1 || t1h ? { cat, t2, t1, t1h } : null;
}

/** True for 'quality'; an unknown grade reads as the default. */
function isQualityGrade(grade) {
  return (normalizeDelegationGrade(grade) ?? 'quality') === 'quality';
}

/**
 * ESCALATE_RE terms that name an action rather than a question: store
 * submission, deploy, release, merge, production access, a go-ahead. They keep
 * the delegation quiet (an irreversible step stays on the main model) but
 * "this request ends in a judgement" would be wrong for "배포해줘".
 */
const ACTION_RE = new RegExp(
  /운영\s*(?:db|디비|데이터베이스|서버|환경)|프로덕션|\bprod(?:uction)?\s*(?:db|database|server|env)|승인\s*(?:할게|했어|했으니|했습니다|합니다|해줄게|완료)|\bapproved?\b|제출|배포|출시|퍼블리시|릴리[스즈](?!\s*노트)|(?<!나)머지|submit|deploy|release|publish|merge/.source, 'gi');

/**
 * Why a request is kept off the delegation path, for the grades that gate on
 * judgement. routeMatch returns null for all of these; this says which gate it
 * was so the caller can recommend a stronger model instead of staying silent.
 *
 * @returns {{judgement: true, kind: 'escalate'|'judge'|'action', cat: null}|null}
 *   'escalate' is a design, diagnosis or comparison word (ESCALATE_RE), 'judge'
 *   an audit, recommendation, absence check or research (JUDGE_RE, only below
 *   grade 'quality'), 'action' an irreversible step with no judgement word.
 */
export function judgementMatch(text, { grade = delegationGrade() } = {}) {
  const t = stripStandingInstructions(text);
  if (t.length < MIN_LEN || isSystemPrompt(t)) return null;
  if (ESCALATE_RE.test(t)) {
    const kind = ESCALATE_RE.test(t.replace(ACTION_RE, ' ')) ? 'escalate' : 'action';
    return { judgement: true, kind, cat: null };
  }
  if (isQualityGrade(grade) && JUDGE_RE.test(t)) return { judgement: true, kind: 'judge', cat: null };
  return null;
}

/**
 * What grade 'cost' still sends up: diagnosis, audit and security asks. The
 * other judgement words stay quiet there because that grade is the relax window, where
 * the user chose to spend less.
 */
const COST_UP_RE = /원인\s*(?:분석|파악|확인|규명|조사)|원인을?\s*찾|root cause|버그|취약|vulnerabilit|보안\s*(?:점검|검토|감사|리뷰|이슈)|security (?:review|audit)|감사\s*(?:해\s*(?:줘|봐|주|보|라|볼)|좀|를\s*(?:해|돌|진행)|하자|요청|부탁)|\baudit(?!\s*(?:log|trail))/i;

/** Price rank of Opus: a session at or above it needs no recommendation to move up. */
const OPUS_RANK = TIER_TARGET_RANK.T1H;

/**
 * The line that recommends Opus at effort high for a request that ends in a
 * judgement, or null when none applies.
 *
 * Measured in the validation Lab (r8) on ten jobs whose result is a judgement:
 * Sonnet at high reached the same conclusion as the reference 1 time, Opus at
 * high 5 times, Opus at xhigh 6 times with 11 wrong claims against 3. So the
 * line names high and never xhigh.
 *
 * Silent when the session already runs Opus or better, and when the session
 * model is unknown (a guess could tell an Opus session to switch to itself).
 * Grade 'quality' speaks for every judgement request; 'cost'
 * only for diagnosis, audit and security (COST_UP_RE).
 *
 * @param {string} text the prompt just submitted
 * @param {object} [opts]
 * @param {number|null} [opts.sessionRank] see sessionModelRank
 * @param {string} [opts.grade] delegation grade
 * @param {string} [opts.lang] 'ko' | 'en'
 * @param {object|null} [opts.judgement] a judgementMatch result the caller already has
 */
export function escalationNotice(text, { sessionRank = null, grade = delegationGrade(), lang = userLanguage(), judgement } = {}) {
  if (sessionRank === null || sessionRank >= OPUS_RANK) return null;
  const j = judgement === undefined ? judgementMatch(text, { grade }) : judgement;
  if (!j || j.kind === 'action') return null;
  if (!isQualityGrade(grade) && !COST_UP_RE.test(String(text || ''))) return null;
  return lang === 'ko'
    ? '✇ [sprag] 이 요청은 판단이 결론인 일입니다. Sonnet보다 Opus(effort high)가 맡도록 권합니다. '
      + 'Opus 서브에이전트(t1h-worker)로 넘기거나 /model opus로 바꾸십시오. '
      + '근거는 판단형 10건에서 Sonnet high가 같은 결론 1건, Opus high가 5건이었던 측정입니다(sprag.io/proof).'
    : '✇ [sprag] This request ends in a judgement. sprag recommends Opus at effort high over Sonnet: '
      + 'hand it to an Opus subagent (t1h-worker) or switch with /model opus. '
      + 'On 10 judgement jobs Sonnet high reached the same conclusion once and Opus high five times (sprag.io/proof).';
}

/**
 * The line for a main session at effort low or medium that gets a request
 * ending in a judgement. A hook cannot change the session's effort, so the line
 * has the model hand the judgement part to an Opus subagent at effort high and
 * tell the user about /effort high in one line. Null when no line applies.
 *
 * Same request gate as escalationNotice: a judgement request that is not an
 * irreversible action, and at grade 'cost' only diagnosis, audit and security.
 *
 * @param {string} text the prompt just submitted
 * @param {object} [opts]
 * @param {string|null} [opts.sessionEffort] the level the statusline recorded (readSessionEffort)
 * @param {string} [opts.grade] delegation grade
 * @param {string} [opts.lang] 'ko' | 'en'
 * @param {object|null} [opts.judgement] a judgementMatch result the caller already has
 */
export function effortNotice(text, { sessionEffort = null, grade = delegationGrade(), lang = userLanguage(), judgement } = {}) {
  const level = typeof sessionEffort === 'string' ? sessionEffort.trim().toLowerCase() : '';
  if (level !== 'low' && level !== 'medium') return null;
  const j = judgement === undefined ? judgementMatch(text, { grade }) : judgement;
  if (!j || j.kind === 'action') return null;
  if (!isQualityGrade(grade) && !COST_UP_RE.test(String(text || ''))) return null;
  return lang === 'ko'
    ? `✇ [sprag] 이 요청은 판단이 결론인 일인데 지금 세션의 effort가 ${level}입니다. `
      + '판단이 필요한 부분은 Opus effort high 서브에이전트(t1h-worker)에 맡기고, '
      + '답 끝에 "/effort high로 올리면 메인도 같은 수준으로 답합니다"를 한 줄 덧붙이십시오.'
    : `✇ [sprag] This request ends in a judgement and the session runs at effort ${level}. `
      + 'Hand the part that needs judgement to an Opus subagent at effort high (t1h-worker), '
      + 'and end your answer with one line: "Raise the main session with /effort high to get the same level here."';
}

/** The budgets a match states, by tier: what the delegation guard repeats to the subagent. */
export function matchCaps(match) {
  if (!match) return null;
  const caps = {};
  if (match.t2) caps.T2 = ruleBudget(match.t2);
  if (match.t1) caps.T1 = ruleBudget(match.t1);
  if (match.t1h) caps.T1H = ruleBudget(match.t1h);
  return caps;
}

/**
 * What the hint says instead of a delegation when every matching tier is
 * unreachable (see unreachableTiers). The model is told to work directly, and
 * to pass the fix on once: the registration lives in the app's settings,
 * which only the user can change.
 */
function unreachableNotice(label, tiers, ko) {
  const models = tiers.map((t) => TIER_ALIAS[t]).join(', ');
  return ko
    ? `✇ [sprag] 이 요청은 위임 룰 "${label}" 에 해당하지만, 이 세션에는 ${models} 모델이 등록되어 있지 않습니다. `
      + `위임해도 세션 모델이 그대로 처리하므로 비용이 줄지 않으니, 위임하지 말고 직접 처리하십시오. `
      + `이 안내를 이번 세션에서 처음 받았다면 답변 끝에 "Claude 앱 설정에 ${models} 모델을 등록하면 이런 요청을 더 싼 모델에 맡길 수 있습니다."라고 사용자에게 한 줄로 알리십시오.`
    : `✇ [sprag] This request matches the delegation rule "${label}", but no ${models} model is registered for this session, `
      + `so a delegated run would stay on the session model and save nothing. Handle it directly instead of delegating. `
      + `If this is the first such notice in this session, end your reply with one line for the user: `
      + `"Register a ${models} model in the Claude app settings to hand requests like this to a cheaper model."`;
}

/** The label a hint names its rule by: the category's label in the user's language. */
export function hintLabel(match, { lang = userLanguage() } = {}) {
  const { cat } = match;
  return lang === 'ko' ? (cat.label || cat.id) : (cat.labelEn || cat.label || cat.id);
}

/**
 * The delegation target a hint names ("the haiku agent", "model: sonnet when it
 * spans …"), without the surrounding sentence. Split out of routeHint so the
 * follow-up notice (src/route-follow.js) repeats exactly the words the hint used.
 *
 * @param {{t2?: object, t1?: object, t1h?: object}} match a routeMatch result with at least one tier
 * @param {object} [opts]
 * @param {string} [opts.lang] 'ko' | 'en'
 * @param {string} [opts.root] as routeHint
 */
export function hintTarget(match, { lang = userLanguage(), root } = {}) {
  const { t2, t1, t1h } = match;
  const ko = lang === 'ko';
  // `root` is threaded through to agentPhrase, which names the subagent only
  // when its .md actually exists on this machine. A caller that pins it can
  // therefore get a deterministic phrase; a test that does not pin it reads
  // whatever the developer happens to have installed.
  const raw = ko ? agentPhrase : agentPhraseEn;
  const phrase = (name) => raw(name, root === undefined ? undefined : { root });

  // T1 is named through its delegation agent only when that file exists here;
  // otherwise the literal tier string stays, so output without agents is unchanged.
  // A rule names its tier; agentForRule picks the agent that serves it.
  const t1Root = root === undefined ? undefined : root;
  const nameOf = (r) => agentForRule(r) ?? TIER_MODEL[r.tier];
  const tierPhrase = (r) => {
    const name = nameOf(r);
    return resolveAgentName(name, t1Root) !== null ? phrase(name) : `model: ${TIER_MODEL[r.tier]}`;
  };
  const picked = [t2, t1, t1h].filter(Boolean);
  let target;
  if (picked.length >= 2) {
    const named = (r) => (r.tier === 'T2' ? phrase(nameOf(r)) : tierPhrase(r));
    const when = (r, i) => {
      if (i === 0) return null;
      if (r.tier === 'T1H') return ko ? '범위가 크면(Fable·Mythos 세션 한정)' : 'for large scope (Fable/Mythos sessions only)';
      return ko ? '여러 단계·여러 파일이 얽히면' : 'when it spans multiple steps or file edits';
    };
    target = ko
      ? picked.map((r, i) => `${when(r, i) ?? '기본'} ${named(r)}`).join(', ')
      : picked.map((r, i) => (i === 0 ? `${named(r)} by default` : `${named(r)} ${when(r, i)}`)).join(', ');
  } else {
    const only = picked[0];
    target = only.tier === 'T1H' ? tierPhrase(only) : phrase(nameOf(only));
  }
  return target;
}

/**
 * The line a delegation hint ends with when a usage window is running low, or
 * '' when there is nothing to add. It only changes how readily the model
 * delegates; the target tier and the caps stay what the rule says.
 *
 * @param {{level: string, pct: number, key: string}|null|undefined} pressure a capPressure result
 */
export function pressureLine(pressure, { lang = userLanguage() } = {}) {
  if (!pressure || (pressure.level !== 'high' && pressure.level !== 'critical')) return '';
  const label = labelForKey(pressure.key).short;
  const pct = Math.round(pressure.pct);
  const ko = lang === 'ko';
  // The caller sets `offer` once per limit window when delegation is not
  // relaxed (claimRelaxOffer). The offer stands in for the usual line.
  if (pressure.offer) return relaxOfferLine(label, pct, lang);
  if (pressure.level === 'critical') {
    return ko
      ? `한도 위험: ${label} ${pct}%. 여러 단계 작업도 위임 대상으로 보고, 메인 모델을 바꾸는 것(/model)도 사용자에게 제안하십시오.`
      : `Usage limit critical: ${label} ${pct}%. Treat multi-step work as delegable too, and suggest to the user switching the main model (/model).`;
  }
  return ko
    ? `한도 압박: ${label} ${pct}%. 판단이 애매하면 위임하십시오.`
    : `Usage limit pressure: ${label} ${pct}%. When in doubt, delegate.`;
}

/** The one-time offer to widen delegation until the limit window resets. */
export function relaxOfferLine(label, pct, lang = userLanguage()) {
  return lang === 'ko'
    ? `✇ [sprag] ${label} 사용량이 ${pct}%입니다. 이번 한도 창이 끝날 때까지 위임 범위를 넓히면 사용량을 아낄 수 있습니다. 사용자에게 한 줄로 물어보고, 동의하면 sprag routing relax 를 실행하십시오. 창이 초기화되면 자동으로 원래대로 돌아옵니다.`
    : `✇ [sprag] ${label} usage is at ${pct}%. Widening delegation until this limit window resets would save usage. Ask the user in one line, and if they agree run sprag routing relax. It switches back by itself when the window resets.`;
}

/**
 * @param {string} text the prompt just submitted
 * @param {object} [opts] as routeMatch, plus:
 * @param {string} [opts.lang] 'ko' | 'en'
 * @param {object|null} [opts.pressure] a capPressure result. A delegation hint
 *   ends with one more line when it is high or critical; null or omitted leaves
 *   the hint exactly as it was. The caller passes it rather than this function
 *   reading the snapshot, so a hint stays a function of its arguments.
 * @param {string} [opts.root] project root used to look for a subagent's .md.
 *   The hint names the agent when that file exists and only its model tier when
 *   it does not, so a caller that needs a predictable phrase pins this.
 * @param {object|null} [opts.match] a routeMatch result the caller already has
 * @returns {string|null} the line to inject, or null to stay quiet
 */
export function routeHint(text, { rules, lang = userLanguage(), root, sessionRank = null, match, env, pressure = null } = {}) {
  const found = match === undefined ? routeMatch(text, { rules, sessionRank, root, env }) : match;
  if (!found) return null;
  const { t2, t1, t1h } = found;
  const ko = lang === 'ko';
  const label = hintLabel(found, { lang });
  if (!t2 && !t1 && !t1h && found.unreachable?.length) return unreachableNotice(label, found.unreachable, ko);
  const target = hintTarget(found, { lang, root });
  const picked = [t2, t1, t1h].filter(Boolean);

  const caps = picked.map((r) => budgetCapPhrase(r, lang));
  const capText = picked.length >= 2
    ? (ko ? '상한 ' : 'cap ') + picked.map((r, i) => `${TIER_MODEL[r.tier]} ${caps[i]}`).join(' / ')
    : (ko ? `상한 ${caps[0]}` : `cap ${caps[0]}`);

  const extra = pressureLine(pressure, { lang });
  // The marker line is the one in ratchet-model.md, so the user sees the same
  // string whichever path decided to delegate.
  const body = ko
    ? `✇ [sprag] 이 요청은 사용자가 이미 승인한 위임 룰 "${label}" 에 해당합니다: ${target} 로 위임하십시오 (${capText}). `
      + `되묻지 말고 위임하고, 위임할 때 \`✇ [sprag] 모델 피팅: "${label}" → <agent> (<모델> · effort <effort>) 위임\` 을 먼저 표시하십시오. `
      + `모델과 effort 값은 위 에이전트 표기에 적힌 그대로 쓰고, Agent 도구의 description 맨 앞에도 \`[<모델> · <effort>]\` 를 붙이십시오. `
      + `상한을 넘길 것 같거나 에러가 나면 그 자리에서 멈추고 메인 모델이 이어받습니다.`
    : `✇ [sprag] This request matches a delegation rule the user already approved — "${label}": delegate to ${target} (${capText}). `
      + `Do not ask again; print \`✇ [sprag] model fit: "${label}" → <agent> (<model> · effort <effort>)\` first, `
      + `with the model and effort the agent's phrase above gives, and start the Agent tool's description with \`[<model> · <effort>]\`. `
      + `If the run is likely to exceed its cap or hits an error, stop there and the main model takes over.`;
  return extra ? `${body}\n${extra}` : body;
}
