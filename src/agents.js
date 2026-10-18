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
 *
 * A rule that names a tier alone (`sonnet`, `haiku`) resolves to that tier's
 * delegation-only agent (`sonnet-worker`, `haiku-explore`, installed by
 * delegation-agents.js) when its file exists. A phrase that names an agent
 * always carries a general-purpose fallback, because Cowork reads no agents
 * directory and a copied rule would otherwise name an agent that is not there.
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
  'opus-worker': 'opus',
  // A T1 rule names its target by tier alone (`agent: 'sonnet'`). Without these
  // the phrase fell through to the haiku default, and a sonnet rule told the
  // session to delegate to haiku. resolveAgentName maps them to an agent file.
  sonnet: 'sonnet',
  opus: 'opus',
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

/** Agent a bare tier name stands for when that agent's file exists. */
const TIER_AGENT = { sonnet: 'sonnet-worker', opus: 'opus-worker', haiku: 'haiku-explore' };

/**
 * The agent a rule target really names on this machine, or null when none is
 * installed. A name wins when its own file exists; a bare tier name falls back
 * to its delegation-only agent.
 */
export function resolveAgentName(name, root = process.cwd()) {
  if (agentExists(name, root)) return name;
  const alt = TIER_AGENT[name];
  return alt && agentExists(alt, root) ? alt : null;
}

/**
 * Korean phrase for a delegation target, e.g.
 *   agent present → `haiku-explore(model 인자 생략. …general-purpose에 model: haiku)`
 *   agent absent  → `model: haiku`
 *
 * A named agent carries its model in its own definition, and the Agent tool's
 * `model` argument overrides that definition. The old phrase
 * `haiku-explore(model: haiku)` read as "pass model: haiku", and Claude Code
 * resolves the bare `haiku` alias to an older Haiku than a definition pinned to
 * a full id (claude-haiku-5-5), so following the rule undid the pin. The phrase
 * now says to leave the argument out.
 */
export function agentPhrase(name, { model, root } = {}) {
  const resolved = resolveAgentName(name, root);
  if (!resolved) return `model: ${model || AGENT_MODEL[name] || 'haiku'}`;
  const tier = AGENT_MODEL[resolved] || model || 'haiku';
  return `${resolved}(model 인자 생략. 이 에이전트가 없거나 MCP 도구가 필요하면 general-purpose에 model: ${tier})`;
}

/**
 * English phrase, including the article, e.g.
 *   agent present → `the haiku-explore subagent (omit the model argument; …)`
 *   agent absent  → `a model: haiku subagent`
 */
export function agentPhraseEn(name, { model, root } = {}) {
  const resolved = resolveAgentName(name, root);
  if (!resolved) return `a model: ${model || AGENT_MODEL[name] || 'haiku'} subagent`;
  const tier = AGENT_MODEL[resolved] || model || 'haiku';
  return `the ${resolved} subagent (omit the model argument; if it is unavailable or MCP tools are needed, use general-purpose with model: ${tier})`;
}
