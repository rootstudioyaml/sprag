import { readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { userDataDir } from './paths.js';
import { codexUserDir, codexProviderName } from './agent.js';
import { categorize, ESCALATE_RE, EDIT_RE } from './route-scan.js';
import { looksPasted } from './route-inject.js';
import { newRouteId, recordCodexDelegation } from './codex-ledger.js';
import { readCodexTailLines } from './codex-parser.js';

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

/**
 * Input tokens from the rollout's last token_count record, or 0 when the
 * transcript is missing or unreadable. Only the tail is read: the newest
 * measurement is always near the end of the file.
 */
export function codexContextTokens(transcriptPath) {
  const lines = readCodexTailLines(transcriptPath, 512 * 1024);
  if (!lines) return 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('token_count')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const n = e?.payload?.type === 'token_count' ? e.payload?.info?.last_token_usage?.input_tokens : undefined;
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

/**
 * A prompt-time routing suggestion for Codex 0.159.2, where `spawn_agent`
 * never reaches PreToolUse (see codexDelegationTool below). Gated on parent
 * context size: a small parent's own coordination overhead outweighs the
 * savings from a delegated child (measured 2026-09-30, see docs/CODEX.md).
 */
export function codexRouteHint(payload, opts = {}) {
  const provider = payload?.model_provider || codexProviderName();
  const rule = matchCodexModelRule(payload?.prompt, { provider, ...opts, model: payload?.model, root: opts.root || payload?.cwd });
  if (!rule) return null;
  const minContext = opts.minContext ?? 60000;
  const ctx = opts.contextTokens ?? codexContextTokens(payload?.transcript_path);
  if (ctx < minContext) return null;
  const id = newRouteId();
  const record = opts.record ?? recordCodexDelegation;
  try {
    record({ id, parentSessionId: payload?.session_id ?? null, turnId: payload?.turn_id ?? null, via: 'prompt',
      source: 'rule', category: rule.category, scope: rule.scope, from: payload?.model, to: rule.model,
      provider, effort: rule.effort ?? null, contextTokens: ctx,
      targetRoot: rule.targetRoot ?? null, ruleCreatedAt: rule.createdAt ?? null }, { dir: opts.dir });
  } catch { /* Accounting is optional; the hint still applies. */ }
  return `[Sprag model routing] This request matches the approved ${rule.category} rule (route ${id}). `
    + `Spawn one sub-agent with model ${rule.model}${rule.effort ? `, reasoning_effort ${rule.effort}` : ''} and fork_turns "none". `
    + `Give it a self-contained task message that ends with the line <!-- sprag:codex:route id=${id} -->. `
    + 'Wait for it to finish (call wait_agent with timeout_ms of at least 120000, and again if it times out) and do not do the delegated task yourself while it runs; then verify its result and report unfinished work. Do not spawn another CLI process. '
    + 'If sub-agent tools or the target model are unavailable, keep the task on the main agent and state that delegation was unavailable.';
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

// Kept for Codex versions that do send spawn_agent through PreToolUse; on
// 0.159.2 the hook never fires for it, so codexRouteHint above is the live path.
export function codexDelegationTool(payload, { cfg = {}, root = payload?.cwd || process.cwd(), home = codexUserDir(), rules: given, dir = userDataDir(), record = recordCodexDelegation } = {}) {
  if (cfg.codex?.delegate !== true) return null;
  const tool = payload?.tool_name?.replace(/^(?:functions|tools)\./, '');
  if (!['spawn_agent', 'Agent'].includes(tool)) return null;
  const input = payload.tool_input;
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.message !== 'string' || !input.message.trim() || input.message.includes(MARKER)) return null;
  const role = input.agent_type || 'default';
  if (!['default', 'worker', 'explorer'].includes(role) || customRole(role, payload.cwd || root, home)) return null;
  const explicit = Object.hasOwn(input, 'model');
  // An unreadable rule file must not stop the default target or the spawn itself.
  let rules = given;
  if (!rules) { try { rules = loadCodexModelRules({ dir }); } catch { rules = []; } }
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
          from: payload.model, to: target.model, provider, effort: updatedInput.reasoning_effort ?? null,
          ...(rule ? { targetRoot: rule.targetRoot ?? null, ruleCreatedAt: rule.createdAt ?? null } : {}) }, { dir });
        routeLine = `\n<!-- sprag:codex:route id=${id} -->`;
      } catch { /* Accounting is optional; the route itself still applies. */ }
    }
  }
  updatedInput.message += `\n\n${MARKER}${routeLine}\nStay within the assigned task and requested output shape. Back findings with file references or actual command results. State what you could not verify. Honor caller-provided limits; do not invent a budget or assume the parent's model tier. Stop and report partial work when a limit or unavailable dependency prevents completion. Do not recursively delegate this bounded task.`;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } };
}
