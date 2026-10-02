/**
 * How a delegation target is phrased in generated rules.
 *
 * Rules used to name concrete subagents (`haiku-explore`, `haiku-runner`, …).
 * Those live in the user's own `~/.claude/agents/` and are NOT shipped by this
 * package, so on any machine that never created them the generated rule told
 * the model to delegate to an agent that does not exist. The model tier is the
 * part that actually saves tokens and it is universal, so `model: haiku` is the
 * default phrasing — the agent name is only added when the file is really
 * there, which keeps the tool-restricted preset in play for users who have it.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { claudeUserDir } from './paths.js';

/** Tier each preset agent is pinned to, for the `model:` half of the phrase. */
const AGENT_MODEL = {
  'haiku-explore': 'haiku',
  'haiku-runner': 'haiku',
  'haiku-translate': 'haiku',
  'sonnet-worker': 'sonnet',
  // A T1 rule names its target by tier alone (`agent: 'sonnet'`), with no
  // preset agent behind it. Without these the phrase fell through to the
  // haiku default, and a sonnet rule told the session to delegate to haiku.
  sonnet: 'sonnet',
  haiku: 'haiku',
};

/**
 * True when `<name>.md` exists in the project or user agents directory.
 *
 * `root: null` asks about the user directory alone. Text that every project
 * reads (the global ratchet-model.md) has to be worded from what every project
 * can see: checked against the current directory, the same rule read
 * `haiku-explore(model: haiku)` when the scan ran in a project that defines
 * the agent and `model: haiku` when it ran anywhere else, and each flip
 * rewrote a file sitting in the prompt-cache prefix of every session.
 */
export function agentExists(name, root = process.cwd()) {
  if (!name) return false;
  return (root !== null && existsSync(join(root, '.claude', 'agents', `${name}.md`))) ||
    existsSync(join(claudeUserDir(), 'agents', `${name}.md`));
}

/**
 * Korean phrase for a delegation target, e.g.
 *   agent present → `haiku-explore(model: haiku)`
 *   agent absent  → `model: haiku`
 */
export function agentPhrase(name, { model, root } = {}) {
  const tier = model || AGENT_MODEL[name] || 'haiku';
  return agentExists(name, root) ? `${name}(model: ${tier})` : `model: ${tier}`;
}

/**
 * English phrase, including the article, e.g.
 *   agent present → `the haiku-explore (model: haiku) subagent`
 *   agent absent  → `a model: haiku subagent`
 */
export function agentPhraseEn(name, { model, root } = {}) {
  const tier = model || AGENT_MODEL[name] || 'haiku';
  return agentExists(name, root)
    ? `the ${name} (model: ${tier}) subagent`
    : `a model: ${tier} subagent`;
}
