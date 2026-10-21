/**
 * How a delegation target is phrased in generated rules.
 *
 * Rules used to name concrete subagents (`t2-explore`, `t2-runner`, …).
 * Those live in the user's own `~/.claude/agents/` and are NOT shipped by this
 * package, so on any machine that never created them the generated rule told
 * the model to delegate to an agent that does not exist. The model tier is the
 * part that actually saves tokens and it is universal, so `model: haiku` is the
 * default phrasing — the agent name is only added when the file is really
 * there, which keeps the tool-restricted preset in play for users who have it.
 *
 * A rule that names a tier alone (`sonnet`, `haiku`) resolves to that tier's
 * delegation-only agent (`t1-worker`, `t2-explore`, installed by
 * delegation-agents.js) when its file exists. A phrase that names an agent
 * always carries a general-purpose fallback, because Cowork reads no agents
 * directory and a copied rule would otherwise name an agent that is not there.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeUserDir } from './paths.js';
import { agentDefinitions } from './presets-source.js';

/**
 * Agents used to be named after their model. They are named by tier now, since
 * the model behind a tier changes and a stale model name inside an agent name
 * misleads. A registry, a hand-written rule or a user's own file may still carry
 * the old name, so it keeps resolving to the new one.
 */
export const LEGACY_AGENT_NAMES = {
  'haiku-explore': 't2-explore',
  'haiku-runner': 't2-runner',
  'haiku-translate': 't2-translate',
  'sonnet-worker': 't1-worker',
  'opus-worker': 't1h-worker',
};

/**
 * Bare model alias each routing tier stands for. A rule says only its tier;
 * where no agent serves that tier, this alias is what the text names.
 */
export const TIER_MODEL = { T2: 'haiku', T1: 'sonnet', T1H: 'opus' };

/** Tier each preset agent is pinned to, for the `model:` half of the phrase. */
const AGENT_MODEL = {
  't2-explore': 'haiku',
  't2-runner': 'haiku',
  't2-translate': 'haiku',
  't1-worker': 'sonnet',
  't1h-worker': 'opus',
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
 * `t2-explore(model: haiku)` when the scan ran in a project that defines
 * the agent and `model: haiku` when it ran anywhere else, and each flip
 * rewrote a file sitting in the prompt-cache prefix of every session.
 */
export function agentExists(name, root = process.cwd()) {
  if (!name) return false;
  return (root !== null && existsSync(join(root, '.claude', 'agents', `${name}.md`))) ||
    existsSync(join(claudeUserDir(), 'agents', `${name}.md`));
}

/**
 * The agent a model-routing rule delegates to, or null when no agent serves its
 * tier. A rule carries only `category` and `tier`; the agents preset says which
 * tier and categories each agent serves, so Claude and Codex read one key.
 *
 *   (a) `rule.agent` when it is a non-empty string: legacy registries and the
 *       published v1 bundle still carry it, and it stays an explicit override,
 *   (b) else the first agent of that tier whose categories name the category,
 *   (c) else the first agent of that tier whose categories hold "*",
 *   (d) else null.
 */
export function agentForRule(rule, { agents = agentDefinitions() } = {}) {
  if (!rule) return null;
  if (typeof rule.agent === 'string' && rule.agent.trim()) {
    return Object.hasOwn(LEGACY_AGENT_NAMES, rule.agent) ? LEGACY_AGENT_NAMES[rule.agent] : rule.agent;
  }
  const list = (Array.isArray(agents) ? agents : []).filter((a) => a && a.tier === rule.tier);
  const cats = (a) => (Array.isArray(a.categories) ? a.categories : []);
  const exact = list.find((a) => cats(a).includes(rule.category));
  if (exact) return exact.name;
  const any = list.find((a) => cats(a).includes('*'));
  return any ? any.name : null;
}

/** Model alias an agent (or a legacy agent name) is pinned to, or undefined. */
const modelOf = (name) => AGENT_MODEL[Object.hasOwn(LEGACY_AGENT_NAMES, name) ? LEGACY_AGENT_NAMES[name] : name];

/** Agent a bare tier name stands for when that agent's file exists. */
const TIER_AGENT = { sonnet: 't1-worker', opus: 't1h-worker', haiku: 't2-explore' };

/**
 * The agent a rule target really names on this machine, or null when none is
 * installed. A name wins when its own file exists; a bare tier name falls back
 * to its delegation-only agent. A legacy name maps to its tier-named successor
 * first; when only the legacy file is installed (a user-edited file sprag does
 * not own, so it was never removed) the legacy name is returned, because that is
 * the file the phrase has to point at.
 */
export function resolveAgentName(name, root = process.cwd()) {
  const current = Object.hasOwn(LEGACY_AGENT_NAMES, name) ? LEGACY_AGENT_NAMES[name] : name;
  if (agentExists(current, root)) return current;
  if (current !== name && agentExists(name, root)) return name;
  const alt = TIER_AGENT[current];
  return alt && agentExists(alt, root) ? alt : null;
}

/**
 * Korean phrase for a delegation target, e.g.
 *   agent present → `t2-explore(model 인자 생략. …general-purpose에 model: haiku)`
 *   agent absent  → `model: haiku`
 *
 * A named agent carries its model in its own definition, and the Agent tool's
 * `model` argument overrides that definition. The old phrase
 * `t2-explore(model: haiku)` read as "pass model: haiku", and Claude Code
 * resolves the bare `haiku` alias to an older Haiku than a definition pinned to
 * a full id (claude-haiku-5-5), so following the rule undid the pin. The phrase
 * now says to leave the argument out.
 */
export function agentPhrase(name, { model, root } = {}) {
  const resolved = resolveAgentName(name, root);
  if (!resolved) return `model: ${model || modelOf(name) || 'haiku'}`;
  const tier = modelOf(resolved) || model || 'haiku';
  const spec = agentSpecLabel(resolved, root);
  return `${resolved}(${spec ? `${spec}. ` : ''}model 인자 생략. 이 에이전트가 없거나 MCP 도구가 필요하면 general-purpose에 model: ${tier})`;
}

/**
 * English phrase, including the article, e.g.
 *   agent present → `the t2-explore subagent (omit the model argument; …)`
 *   agent absent  → `a model: haiku subagent`
 */
export function agentPhraseEn(name, { model, root } = {}) {
  const resolved = resolveAgentName(name, root);
  if (!resolved) return `a model: ${model || modelOf(name) || 'haiku'} subagent`;
  const tier = modelOf(resolved) || model || 'haiku';
  const spec = agentSpecLabel(resolved, root, ', ');
  return `the ${resolved} subagent (${spec ? `${spec}; ` : ''}omit the model argument; if it is unavailable or MCP tools are needed, use general-purpose with model: ${tier})`;
}

/**
 * The model and effort an installed agent file really pins, read from its
 * frontmatter, or null when the file has none.
 *
 * The agent name says only the tier (`t1-worker`), and Claude Code draws a
 * delegated run as `t1-worker(…)` with no model beside it. The phrase carries
 * what the file says so the session can show it. The file is read rather
 * than the preset because a user's own copy is never overwritten, and it may
 * pin something else. A file without `model:` inherits the session model,
 * which Claude Code writes as `inherit`.
 */
export function agentSpec(name, root = process.cwd()) {
  const paths = [];
  if (root !== null) paths.push(join(root, '.claude', 'agents', `${name}.md`));
  paths.push(join(claudeUserDir(), 'agents', `${name}.md`));
  for (const p of paths) {
    let text;
    try { text = readFileSync(p, 'utf8'); } catch { continue; }
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!m) return null;
    const field = (key) => {
      const hit = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(m[1]);
      return hit && hit[1] ? hit[1] : null;
    };
    return { model: field('model') || 'inherit', effort: field('effort') };
  }
  return null;
}

/**
 * Display name for a model value: `claude-sonnet-5-5` → `Sonnet 5.5`, a dated
 * id loses its date. An alias or a gateway id stays as written, since an alias
 * can resolve to an older model and that is worth seeing.
 */
export function modelLabel(model) {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(String(model || ''));
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : String(model || '');
}

/** `Sonnet 5.5 · effort medium` for an installed agent, or '' when unknown. */
function agentSpecLabel(name, root, sep = ' · ') {
  const spec = agentSpec(name, root);
  if (!spec) return '';
  return spec.effort ? `${modelLabel(spec.model)}${sep}effort ${spec.effort}` : modelLabel(spec.model);
}
