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
 *   - no registered rule covers that category
 * A hint that fires on the wrong request costs more than one that stays quiet.
 */

import { categorize, ESCALATE_RE } from './route-scan.js';
import { loadModelRules, budgetCapPhrase } from './model-rules.js';
import { agentPhrase, agentPhraseEn } from './agents.js';
import { userLanguage } from './config.js';

/** Shortest text worth classifying; below this a prompt is an ack, not a task. */
const MIN_LEN = 8;

/**
 * @param {string} text the prompt just submitted
 * @param {object} [opts]
 * @param {Array} [opts.rules] registered rules (defaults to the stored registry)
 * @param {string} [opts.lang] 'ko' | 'en'
 * @param {string} [opts.root] project root used to look for a subagent's .md.
 *   The hint names the agent when that file exists and only its model tier when
 *   it does not, so a caller that needs a predictable phrase pins this.
 * @returns {string|null} the line to inject, or null to stay quiet
 */
export function routeHint(text, { rules, lang = userLanguage(), root } = {}) {
  const t = String(text || '').trim();
  if (t.length < MIN_LEN) return null;
  // Judgement and irreversible work stay on the top tier. This check comes
  // before classification because such a request often looks like a light
  // "run" or "check" in its wording.
  if (ESCALATE_RE.test(t)) return null;

  const cat = categorize(t, null);
  if (!cat) return null;

  const all = rules || loadModelRules().rules || [];
  const matched = all.filter((r) => r && r.category === cat.id);
  if (!matched.length) return null;

  const t2 = matched.find((r) => r.tier === 'T2');
  const t1 = matched.find((r) => r.tier === 'T1');
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
