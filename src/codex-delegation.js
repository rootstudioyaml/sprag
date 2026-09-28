import { readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { userDataDir } from './paths.js';
import { codexUserDir, codexProviderName } from './agent.js';
import { categorize, ESCALATE_RE, EDIT_RE } from './route-scan.js';
import { looksPasted } from './route-inject.js';
import { newRouteId, recordCodexDelegation } from './codex-ledger.js';

export const CODEX_ROUTE_CATEGORIES = ['paste', 'translate', 'explore', 'read', 'check', 'run'];
const MARKER = '<!-- sprag:codex:delegation -->';
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/.test(value);
const validEffort = (value) => value === undefined || ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value);

export function validateCodexTarget(model, effort) {
  if (!safeId(model)) throw new Error('Provide a literal Codex model ID.');
  if (!validEffort(effort)) {
    throw new Error('Invalid reasoning effort; choose a value supported by the target model.');
  }
  return { model, ...(effort === undefined ? {} : { effort }) };
}

const rulesFile = (dir) => join(dir, 'codex-model-rules.json');
export function loadCodexModelRules({ dir = userDataDir() } = {}) {
  try {
    const data = JSON.parse(readFileSync(rulesFile(dir), 'utf8'));
    if (data?.version !== 1 || !Array.isArray(data.rules) || data.rules.some((r) => !r ||
      !CODEX_ROUTE_CATEGORIES.includes(r.category) || !safeId(r.from) || !safeId(r.model) || r.from === r.model ||
      !validEffort(r.effort) || r.status !== 'active' || !['global', 'project'].includes(r.scope) ||
      (r.provider != null && !safeId(r.provider)) ||
      (r.scope === 'project' ? typeof r.targetRoot !== 'string' || resolve(r.targetRoot) !== r.targetRoot : r.targetRoot !== null))) throw new Error();
    return data.rules;
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error('Cannot parse Codex model rules; file left unchanged.');
  }
}

function saveRules(rules, dir) {
  mkdirSync(dir, { recursive: true });
  const file = rulesFile(dir), tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, rules }, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}

export function addCodexModelRule({ category, model, effort, from, scope, root, provider }, { dir = userDataDir() } = {}) {
  validateCodexTarget(model, effort);
  if (!CODEX_ROUTE_CATEGORIES.includes(category)) throw new Error(`Category must be ${CODEX_ROUTE_CATEGORIES.join(', ')}`);
  if (!safeId(from) || from === model) throw new Error('--from must name a different parent model.');
  if (!['global', 'project'].includes(scope)) throw new Error('Choose --global or --project for the rule.');
  if (provider != null && !safeId(provider)) throw new Error('Invalid Codex provider ID.');
  const rules = loadCodexModelRules({ dir });
  const targetRoot = scope === 'project' ? resolve(root) : null;
  const rule = { category, model, effort, from, scope, targetRoot, ...(provider ? { provider } : {}), status: 'active', createdAt: new Date().toISOString() };
  const old = rules.findIndex((r) => r.category === category && r.from === from && r.scope === scope && r.targetRoot === targetRoot && r.provider === provider);
  if (old < 0) rules.push(rule); else rules[old] = rule;
  saveRules(rules, dir);
  return rule;
}

export function removeCodexModelRule(index, { dir = userDataDir() } = {}) {
  const rules = loadCodexModelRules({ dir });
  if (!Number.isSafeInteger(index) || index < 1 || index > rules.length) throw new Error('Unknown Codex rule index.');
  rules.splice(index - 1, 1);
  saveRules(rules, dir);
}

/**
 * The category a prompt can be routed under at runtime, or null. The route
 * scan counts episodes with this same gate, so a rule it proposes is one the
 * prompt hook can actually match.
 */
export function codexPromptCategory(text) {
  const prompt = typeof text === 'string' ? text.trim() : '';
  if (prompt.length < 8 || ESCALATE_RE.test(prompt) || EDIT_RE.test(prompt) || /\b(?:implement|modify|fix|delete|push|commit)\b/i.test(prompt)) return null;
  const category = categorize(prompt, null);
  if (!category || (category.id === 'paste' && !looksPasted(prompt))) return null;
  return category;
}

export function matchCodexModelRule(text, { model, root, provider = codexProviderName(), rules = loadCodexModelRules() } = {}) {
  const category = codexPromptCategory(text);
  if (!category) return null;
  const usable = rules.filter((r) => r?.status === 'active' && r.category === category.id && r.from === model &&
    (!r.provider || r.provider === provider) &&
    safeId(r.model) && validEffort(r.effort) && r.model !== model && (r.scope === 'global' || (r.scope === 'project' && r.targetRoot === resolve(root || '.'))));
  return usable.find((r) => r.scope === 'project') || usable[0] || null;
}

export function codexRouteHint(payload, opts = {}) {
  const rule = matchCodexModelRule(payload?.prompt, { provider: payload?.model_provider || codexProviderName(), ...opts, model: payload?.model, root: opts.root || payload?.cwd });
  if (!rule) return null;
  return `[Sprag model routing] This request matches the approved ${rule.category} rule: delegate the bounded task to model ${rule.model}`
    + (rule.effort ? ` with reasoning_effort ${rule.effort}` : '')
    + '. Use the available native Codex subagent tool and a built-in role. Wait for its result, verify it, and report unfinished work. '
    + 'Do not spawn another CLI process. If subagent tools or the target model are unavailable, keep the task on the main agent and state that delegation was unavailable.';
}

function customRole(role, root, home) {
  // Custom role files override an explicit spawn model. Leave those calls alone.
  const layers = new Set([home]);
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    layers.add(join(dir, '.codex'));
    if (dirname(dir) === dir) break;
  }
  for (const layer of layers) {
    try {
      const cfg = parse(readFileSync(join(layer, 'config.toml'), 'utf8'));
      if (Object.hasOwn(cfg.agents || {}, role)) return true;
    } catch (e) { if (e.code !== 'ENOENT') return true; }
    const dir = join(layer, 'agents');
    let names;
    try { names = readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') continue; return true; }
    for (const name of names.filter((n) => n.endsWith('.toml'))) {
      try { if (parse(readFileSync(join(dir, name), 'utf8')).name === role) return true; }
      catch { return true; }
    }
  }
  return false;
}

export function codexDelegationTool(payload, { cfg = {}, root = payload?.cwd || process.cwd(), home = codexUserDir(), rules, dir = userDataDir(), record = recordCodexDelegation } = {}) {
  if (cfg.codex?.delegate !== true) return null;
  const tool = payload?.tool_name?.replace(/^(?:functions|tools)\./, '');
  if (!['spawn_agent', 'Agent'].includes(tool)) return null;
  const input = payload.tool_input;
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.message !== 'string' || !input.message.trim() || input.message.includes(MARKER)) return null;
  const role = input.agent_type || 'default';
  if (!['default', 'worker', 'explorer'].includes(role) || customRole(role, payload.cwd || root, home)) return null;
  const explicit = Object.hasOwn(input, 'model');
  const provider = payload.model_provider || codexProviderName({ home });
  const rule = explicit ? null : matchCodexModelRule(input.message, { model: payload.model, provider, root, rules });
  const target = rule || (!explicit && cfg.codex?.delegateTarget);
  const updatedInput = { ...input };
  let routeLine = '';
  if (target) {
    validateCodexTarget(target.model, target.effort);
    updatedInput.model = target.model;
    if (target.effort !== undefined && !Object.hasOwn(input, 'reasoning_effort')) updatedInput.reasoning_effort = target.effort;
    // Only a route Sprag applied, with a known parent, can be credited later.
    if (safeId(payload.model) && payload.model !== target.model) {
      const id = newRouteId();
      try {
        record({ id, parentSessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
          source: rule ? 'rule' : 'default', category: rule?.category ?? null, scope: rule?.scope ?? null,
          from: payload.model, to: target.model, provider, effort: updatedInput.reasoning_effort ?? null }, { dir });
        routeLine = `\n<!-- sprag:codex:route id=${id} -->`;
      } catch { /* Accounting is optional; the route itself still applies. */ }
    }
  }
  updatedInput.message += `\n\n${MARKER}${routeLine}\nStay within the assigned task and requested output shape. Back findings with file references or actual command results. State what you could not verify. Honor caller-provided limits; do not invent a budget or assume the parent's model tier. Stop and report partial work when a limit or unavailable dependency prevents completion. Do not recursively delegate this bounded task.`;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } };
}
