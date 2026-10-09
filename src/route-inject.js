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
 * A hint that fires on the wrong request costs more than one that stays quiet.
 */

import { categorizeScored, ESCALATE_RE, EDIT_RE, worthDelegating } from './route-scan.js';
import { loadModelRules, budgetCapPhrase, ruleBudget } from './model-rules.js';
import { sharedProjectRoots, realProjectRoot, scopeRank } from './shared-model-rules.js';
import { agentPhrase, agentPhraseEn } from './agents.js';
import { userLanguage } from './config.js';
import { aliasForRole, resolveModelAlias } from './model-alias.js';
import { isRecognizedModelId, modelRank } from './cost.js';
import { loadRecentSnapshot } from './caps-cache.js';
import { getSessionModel } from './parser.js';

const PASTE_MIN_LINES = 8;
const LOG_SHAPE_RE = /^\s+at\s|\b(error|exception|traceback|warn(ing)?|fatal)\b|^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/im;
export function looksPasted(text) {
  const lines = (String(text).match(/\n/g) || []).length;
  return lines >= PASTE_MIN_LINES || LOG_SHAPE_RE.test(text);
}

/** Shortest text worth classifying; below this a prompt is an ack, not a task. */
const MIN_LEN = 8;

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
 * The rules a prompt matches, or null when the hint should stay quiet.
 *
 * @param {string} text the prompt just submitted
 * @param {object} [opts]
 * @param {Array} [opts.rules] registered rules (defaults to the stored registry)
 * @param {number|null} [opts.sessionRank] price rank of the model reading the
 *   hint (see sessionModelRank). null means unknown, and an unknown session
 *   model filters nothing.
 * @returns {{cat: object, t2: object|undefined, t1: object|undefined}|null}
 */
export function routeMatch(text, { rules, sessionRank = null, root } = {}) {
  const t = String(text || '').trim();
  if (t.length < MIN_LEN) return null;
  // Judgement and irreversible work stay on the top tier. This check comes
  // before classification because such a request often looks like a light
  // "run" or "check" in its wording.
  if (ESCALATE_RE.test(t)) return null;
  // Same for implementation work dressed as a run or a check: an edit is not
  // delegable, and with no tool calls yet only the wording can say so.
  if (EDIT_RE.test(t)) return null;

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
  const matched = all.filter((r) => r && r.category === cat.id && inScope(r));
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

  // The closest scope states the cap, whatever order the registry holds.
  const nearest = [...usable].sort((a, b) => scopeRank(b) - scopeRank(a));
  const t2 = nearest.find((r) => r.tier === 'T2');
  const t1 = nearest.find((r) => r.tier === 'T1');
  return t2 || t1 ? { cat, t2, t1 } : null;
}

/** The budgets a match states, by tier: what the delegation guard repeats to the subagent. */
export function matchCaps(match) {
  if (!match) return null;
  const caps = {};
  if (match.t2) caps.T2 = ruleBudget(match.t2);
  if (match.t1) caps.T1 = ruleBudget(match.t1);
  return caps;
}

/**
 * @param {string} text the prompt just submitted
 * @param {object} [opts] as routeMatch, plus:
 * @param {string} [opts.lang] 'ko' | 'en'
 * @param {string} [opts.root] project root used to look for a subagent's .md.
 *   The hint names the agent when that file exists and only its model tier when
 *   it does not, so a caller that needs a predictable phrase pins this.
 * @param {object|null} [opts.match] a routeMatch result the caller already has
 * @returns {string|null} the line to inject, or null to stay quiet
 */
export function routeHint(text, { rules, lang = userLanguage(), root, sessionRank = null, match } = {}) {
  const found = match === undefined ? routeMatch(text, { rules, sessionRank, root }) : match;
  if (!found) return null;
  const { cat, t2, t1 } = found;
  const ko = lang === 'ko';
  const label = ko ? (cat.label || cat.id) : (cat.labelEn || cat.label || cat.id);
  // `root` is threaded through to agentPhrase, which names the subagent only
  // when its .md actually exists on this machine. A caller that pins it can
  // therefore get a deterministic phrase; a test that does not pin it reads
  // whatever the developer happens to have installed.
  const raw = ko ? agentPhrase : agentPhraseEn;
  const phrase = (name) => raw(name, root === undefined ? undefined : { root });

  let target;
  if (t2 && t1) {
    target = ko
      ? `기본 ${phrase(t2.agent)}, 여러 단계·여러 파일이 얽히면 model: sonnet`
      : `${phrase(t2.agent)} by default, model: sonnet when it spans multiple steps or file edits`;
  } else {
    const only = t2 || t1;
    target = ko ? phrase(only.agent) : phrase(only.agent);
  }

  const caps = [t2, t1].filter(Boolean).map((r) => budgetCapPhrase(r, lang));
  const capText = caps.length === 2
    ? (ko ? `상한 haiku ${caps[0]} / sonnet ${caps[1]}` : `cap haiku ${caps[0]} / sonnet ${caps[1]}`)
    : (ko ? `상한 ${caps[0]}` : `cap ${caps[0]}`);

  // The marker line is the one in ratchet-model.md, so the user sees the same
  // string whichever path decided to delegate.
  return ko
    ? `[sprag] 이 요청은 사용자가 이미 승인한 위임 룰 "${label}" 에 해당합니다: ${target} 로 위임하십시오 (${capText}). `
      + `되묻지 말고 위임하고, 위임할 때 \`🔀 [sprag] 모델 피팅: "${label}" → <agent> 위임\` 을 먼저 표시하십시오. `
      + `상한을 넘길 것 같거나 에러가 나면 그 자리에서 멈추고 메인 모델이 이어받습니다.`
    : `[sprag] This request matches a delegation rule the user already approved — "${label}": delegate to ${target} (${capText}). `
      + `Do not ask again; print \`🔀 [sprag] model fit: "${label}" → <agent>\` first. `
      + `If the run is likely to exceed its cap or hits an error, stop there and the main model takes over.`;
}
