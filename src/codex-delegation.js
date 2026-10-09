import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { userDataDir } from './paths.js';
import { writeViaTmp } from './state-file.js';
import { codexUserDir, codexProviderName } from './agent.js';
import { categorize, ESCALATE_RE, EDIT_RE } from './route-scan.js';
import { looksPasted } from './route-inject.js';
import { newRouteId, recordCodexDelegation } from './codex-ledger.js';
import { readCodexTailLines } from './codex-parser.js';
import { loadConfig } from './config.js';
import { loadSharedModelRules, sharedModelRulesForProject, sharedRuleBounds, SHARED_RULE_TIERS } from './shared-model-rules.js';
import { codexPriceBook, readCodexPrices } from './codex-cache-policy.js';
import { codexRunCost } from './gateway-prices.js';

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

export function validateCodexSharedTarget({ tier, from, model, effort, provider }) {
  validateCodexTarget(model, effort);
  if (!SHARED_RULE_TIERS.includes(tier)) throw new Error('Shared rule tier must be T1 or T2.');
  if (!safeId(from) || from === model) throw new Error('--from must name a different parent model.');
  if (!safeId(provider)) throw new Error('A shared model mapping requires a Codex provider ID.');
  return { tier, from, model, ...(effort === undefined ? {} : { effort }), provider };
}

export function codexSharedTargets(cfg) {
  const targets = cfg?.codex?.sharedRules?.targets;
  if (!Array.isArray(targets)) return [];
  return targets.flatMap((target) => {
    try { return [validateCodexSharedTarget(target)]; } catch { return []; }
  });
}

// A request of this shape (input to output about 5:1) ranks models by price.
const RANKING_USAGE = { input: 10000, output: 2000 };
const routeScanFile = (dir) => join(dir, 'codex-route-scan.json');

function observedCodexModels(dir, provider) {
  try {
    const data = JSON.parse(readFileSync(routeScanFile(dir), 'utf8'));
    const prefix = `${provider}|`;
    return (Array.isArray(data?.observedModels) ? data.observedModels : [])
      .filter((key) => typeof key === 'string' && key.startsWith(prefix)).map((key) => key.slice(prefix.length));
  } catch { return []; }
}

/**
 * The models Codex resolves T2 and T1 to when the user mapped none, the way
 * Claude Code resolves `haiku` and `sonnet`. Only a model that is priced on the
 * parent's provider, costs less than the parent, and has already run in this
 * user's Codex sessions qualifies, so the hint never names a model the gateway
 * cannot serve. The cheapest is T2 and the next one up is T1; with a single
 * candidate T1 stays on the main agent. Returns { targets, reason }.
 */
export function autoCodexSharedTargets({ dir = userDataDir(), home = codexUserDir(), model, provider, now = Date.now() } = {}) {
  if (!safeId(model) || !safeId(provider)) return { targets: [], reason: 'unknown parent model or provider' };
  const book = codexPriceBook(provider, readCodexPrices({ now, home, dir }), { home });
  if (!book) return { targets: [], reason: `no price table for ${provider}` };
  const cost = (m) => codexRunCost(RANKING_USAGE, book.prices[m]);
  const parent = cost(model);
  if (parent === null) return { targets: [], reason: `${model} is not priced on ${provider}` };
  const cheaper = [...new Set(observedCodexModels(dir, provider))]
    .filter((m) => m !== model && safeId(m)).map((m) => ({ model: m, usd: cost(m) }))
    .filter((x) => x.usd !== null && x.usd < parent).sort((a, b) => a.usd - b.usd || a.model.localeCompare(b.model));
  if (!cheaper.length) return { targets: [], reason: `no cheaper priced model has run in your Codex sessions on ${provider}` };
  const targets = cheaper.slice(0, 2).map((x, i) => ({ tier: i === 0 ? 'T2' : 'T1', from: model, model: x.model, provider, auto: true }));
  return { targets, reason: null };
}

/**
 * Explicit mappings win per tier. Without one, a tier resolves automatically
 * unless the user turned that off; resolution runs only for an enabled Codex
 * delegation, so a caller without the hook's config never routes by accident.
 */
export function codexTierTargets({ cfg = loadConfig(), dir = userDataDir(), home = codexUserDir(), model, provider = codexProviderName() } = {}) {
  const explicit = codexSharedTargets(cfg).filter((t) => t.from === model && t.provider === provider);
  if (cfg.codex?.delegate !== true || cfg.codex?.sharedRules?.auto === false) return explicit;
  const auto = autoCodexSharedTargets({ dir, home, model, provider }).targets
    .filter((t) => !explicit.some((e) => e.tier === t.tier));
  return [...explicit, ...auto];
}

export function sharedCodexModelRules({ cfg = loadConfig(), dir = userDataDir(), home = codexUserDir(), root, start = root,
  model, provider = codexProviderName() } = {}) {
  if (cfg.codex?.sharedRules?.enabled === false) return [];
  const targets = codexTierTargets({ cfg, dir, home, model, provider });
  return sharedModelRulesForProject(loadSharedModelRules({ dir }), start).flatMap((rule) => {
    const target = targets.find((t) => t.tier === rule.tier);
    return target ? [{ ...rule, ...target, source: 'shared', status: 'active' }] : [];
  });
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
  writeViaTmp(tmp, file, JSON.stringify({ version: 1, rules }, null, 2) + '\n', { mode: 0o600 });
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
  // A rule saved without a provider has no `provider` key, and a caller with
  // none passes null. Compared as they are, undefined !== null, so re-adding
  // the same rule stacked a duplicate instead of replacing it.
  const old = rules.findIndex((r) => r.category === category && r.from === from && r.scope === scope && r.targetRoot === targetRoot && (r.provider ?? null) === (provider ?? null));
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

/** A Codex-only rule wins; otherwise the shared policies mapped for this parent, T2 first. */
function matchingRoutes(text, opts) {
  const own = matchCodexModelRule(text, { ...opts, rules: opts.rules ?? loadCodexModelRules({ dir: opts.dir }) });
  if (own) return [own];
  const category = codexPromptCategory(text);
  if (!category) return [];
  return sharedCodexModelRules(opts).filter((r) => r.category === category.id)
    .sort((a, b) => SHARED_RULE_TIERS.indexOf(a.tier) - SHARED_RULE_TIERS.indexOf(b.tier));
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

export const DEFAULT_DELEGATE_MIN_CONTEXT = 60000;

/** Parent input tokens below which the prompt hint stays silent. */
export function codexDelegateMinContext(cfg) {
  const value = cfg?.codex?.delegateMinContext;
  return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_DELEGATE_MIN_CONTEXT;
}

// Codex tells the model to set spawn_agent's model only on the user's request,
// so the shared hint says where this request came from.
const SHARED_APPROVAL = 'The user approved this policy and its model mapping, so setting model here follows the user\'s request.';
const SHARED_TIER_GUIDANCE = 'Choose T2 only for a simple bounded lookup or command. Use T1 for multi-step tool chains or work spanning multiple files. If the required tier is not mapped, keep the task on the main agent. Do not delegate design judgement, diagnosis, or irreversible actions.';
const WAIT_TEXT = 'Wait for it to finish (call wait_agent with timeout_ms of at least 120000, and again if it times out) and do not do the delegated task yourself while it runs; then verify its result and report unfinished work. Do not spawn another CLI process. '
  + 'If sub-agent tools or the target model are unavailable, keep the task on the main agent and state that delegation was unavailable.';

function sharedTargetText(rule) {
  return `${rule.tier}: model ${rule.model}${rule.effort ? `, reasoning_effort ${rule.effort}` : ''}. ${sharedRuleBounds(rule)}`.trim();
}

function sharedDenyReason(routes) {
  return `[Sprag model routing] This spawn matches the approved shared ${routes[0].category} policy but names no model. ${SHARED_APPROVAL} `
    // A full-history fork inherits the parent model and refuses overrides.
    + 'Spawn again with fork_turns "none" and the model and reasoning_effort of the tier you choose, keeping the route line the routing hint gave for that tier:\n'
    + routes.map(sharedTargetText).join('\n')
    + `\n${SHARED_TIER_GUIDANCE} To keep the task on your own model, pass that model explicitly. If a model cannot be set, do the task on the main agent instead of spawning again.`;
}

/**
 * A prompt-time routing suggestion for Codex 0.159.2, where `spawn_agent`
 * never reaches PreToolUse (see codexDelegationTool below). Gated on parent
 * context size: a small parent's own coordination overhead outweighs the
 * savings from a delegated child (measured 2026-09-30, see docs/CODEX.md).
 *
 * A shared policy offers both mapped tiers and records one route per tier;
 * SubagentStart binds the child to the route whose model it runs, and the
 * next prompt closes the tier that was not chosen.
 */
export function codexRouteHint(payload, opts = {}) {
  // The hook passes its loaded config. Without one there are no shared
  // mappings and the default gate applies, so a caller never routes from the
  // user's real config by accident.
  const cfg = opts.cfg ?? {};
  const provider = payload?.model_provider || codexProviderName();
  const routes = matchingRoutes(payload?.prompt, { cfg, provider, ...opts, model: payload?.model,
    root: opts.root || payload?.cwd, start: payload?.cwd });
  const rule = routes[0];
  if (!rule) return null;
  const minContext = opts.minContext ?? codexDelegateMinContext(cfg);
  const ctx = opts.contextTokens ?? codexContextTokens(payload?.transcript_path);
  if (ctx < minContext) return null;
  const record = opts.record ?? recordCodexDelegation;
  // Tiers offered by one hint are alternatives. SubagentStart binds by model
  // alone, so it must know which records compete for the same child.
  const offerId = routes.length > 1 ? newRouteId() : null;
  const recordRoute = (route) => {
    const id = newRouteId();
    const shared = route.source === 'shared';
    try {
      record({ id, parentSessionId: payload?.session_id ?? null, turnId: payload?.turn_id ?? null, via: 'prompt',
        source: shared ? 'shared' : 'rule', category: route.category, scope: route.scope, from: payload?.model, to: route.model,
        provider: route.provider || provider, effort: route.effort ?? null, contextTokens: ctx, targetRoot: route.targetRoot ?? null,
        ...(shared ? { tier: route.tier, sharedSignature: route.sharedSignature, ...(offerId ? { offerId } : {}), ...(route.auto ? { mapping: 'auto' } : {}) }
          : { ruleCreatedAt: route.createdAt ?? null }) }, { dir: opts.dir });
    } catch { /* Accounting is optional; the hint still applies. */ }
    return id;
  };
  if (rule.source === 'shared') {
    const targets = routes.map((route) => `${sharedTargetText(route)} Route line: <!-- sprag:codex:route id=${recordRoute(route)} -->`);
    return `[Sprag model routing] This request matches the approved shared ${rule.category} policy. ${SHARED_APPROVAL} ${SHARED_TIER_GUIDANCE}\n`
      + `${targets.join('\n')}\n`
      + 'Spawn at most one sub-agent with the selected model, reasoning_effort when specified, and fork_turns "none"; a full-history fork ignores the model. '
      + 'Give it a self-contained task message with the selected cap that ends with that tier\'s route line only. '
      + WAIT_TEXT;
  }
  const id = recordRoute(rule);
  return `[Sprag model routing] This request matches the approved ${rule.category} rule (route ${id}). `
    + `Spawn one sub-agent with model ${rule.model}${rule.effort ? `, reasoning_effort ${rule.effort}` : ''} and fork_turns "none". `
    + `Give it a self-contained task message that ends with the line <!-- sprag:codex:route id=${id} -->. `
    + WAIT_TEXT;
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
  const routes = explicit ? [] : matchingRoutes(input.message, { model: payload.model, provider, root, start: payload.cwd, rules, cfg, dir, home });
  // Only the caller can choose a shared policy's tier. A shared match without a
  // model goes back to the caller with the mapped choices instead of a guessed
  // downgrade, or a default target that ignores the tier.
  if (routes[0]?.source === 'shared') {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: sharedDenyReason(routes) } };
  }
  const rule = routes[0] ?? null;
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
