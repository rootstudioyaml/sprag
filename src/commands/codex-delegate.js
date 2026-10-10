import { loadConfig, saveConfig } from '../config.js';
import { configureCodexHooks } from '../codex-installer.js';
import { validateCodexTarget, loadCodexModelRules, addCodexModelRule, removeCodexModelRule,
  validateCodexSharedTarget, codexSharedTargets, codexDelegateMinContext, DEFAULT_DELEGATE_MIN_CONTEXT,
  autoCodexSharedTargets, codexDelegateEnabled } from '../codex-delegation.js';
import { findCodexCandidate, resolveCodexCandidate } from '../codex-route-scan.js';
import { codexRoutingSavedTotals, loadCodexLedger } from '../codex-ledger.js';
import { codexRuleHealth, codexRulesInReview } from '../codex-rule-health.js';
import { signedUsd } from '../money.js';
import { codexProviderName, codexModelName } from '../agent.js';
import { loadSharedModelRules, sharedModelRulesForProject, SHARED_RULE_TIERS } from '../shared-model-rules.js';

// Starts from the working directory, as the hooks do, so a project policy
// stored under either agent's project root is counted.
function printShared(cfg, { details = false } = {}) {
  const policies = sharedModelRulesForProject(loadSharedModelRules(), process.cwd());
  const targets = codexSharedTargets(cfg);
  const provider = codexProviderName();
  const parent = codexModelName();
  console.log(`Shared delegation policies: ${policies.length} in this project (${cfg.codex?.sharedRules?.enabled === false ? 'off' : 'on'}); Codex tier mappings: ${targets.length}`);
  if (!policies.length) console.log('First use: sprag seed --agent codex. Approve policies with seed accept <id>|all --global|--project; no Claude installation or history is required.');
  if (details) {
    for (const r of policies) console.log(`shared ${r.tier} ${r.category} | ${r.scope}${r.targetRoot ? ` ${r.targetRoot}` : ''}`);
    for (const t of targets) console.log(`${t.provider} | ${t.from} | ${t.tier} -> ${t.model}${t.effort ? ` (${t.effort})` : ''}`);
  }
  // A mapping routes only sessions on the parent model it names, so a tier
  // mapped for another model still leaves the configured model unrouted. A tier
  // without one resolves automatically, the way Claude Code resolves haiku/sonnet.
  const own = (tier) => targets.find((t) => t.provider === provider && t.tier === tier && (!parent || t.from === parent));
  const autoOn = cfg.codex?.sharedRules?.auto !== false;
  const auto = autoOn && parent ? autoCodexSharedTargets({ model: parent, provider }) : { targets: [], reason: autoOn ? 'Codex config names no default model' : 'off' };
  const tiers = [...new Set(policies.map((r) => r.tier))];
  for (const tier of tiers) {
    const t = own(tier) || auto.targets.find((a) => a.tier === tier);
    if (t) console.log(`${tier} -> ${t.model}${t.effort ? ` (${t.effort})` : ''}${t.auto ? ' (auto: cheaper priced model Codex runs or lists)' : ''}`);
  }
  const missing = tiers.filter((tier) => !own(tier) && !auto.targets.some((a) => a.tier === tier));
  if (missing.length) {
    console.log(`Unmapped tiers for ${parent || 'any parent model'} on ${provider || 'unknown provider'}: ${missing.join(', ')}`
      + `${autoOn && auto.reason ? ` (auto: ${auto.reason})` : ''}. `
      + `Set: sprag delegate shared map <T1|T2> --from ${parent || '<parent-model>'} --model <target-model> --agent codex`);
  }
  console.log(`Automatic tier models: ${autoOn ? 'on' : 'off'} (turn ${autoOn ? 'off' : 'on'}: sprag delegate shared auto ${autoOn ? 'off' : 'on'} --agent codex)`);
  if (!parent && targets.length) console.log('Codex config names no default model; each mapping routes only sessions on its --from model.');
  const minimum = codexDelegateMinContext(cfg);
  console.log(`Shared prompt guidance starts at ${minimum} parent input tokens${cfg.codex?.delegateMinContext === minimum ? '' : ' (default)'}. `
    + 'Change: sprag delegate shared min-context <tokens|default> --agent codex');
  console.log('Shared policies keep their original scope and bounds. Models require an exact parent/provider mapping; agent-specific roles and usage totals are not imported.');
}

export function run({ args, getArg, hasFlag, root }) {
  const sub = args[1] || 'status';
  if (args.some((arg) => arg.startsWith('--hook'))) throw new Error('Use codex-hook for Codex hook payloads.');
  for (const flag of ['--model', '--effort', '--from', '--provider']) {
    if (args.some((arg) => arg === flag || arg.startsWith(`${flag}=`)) && (!getArg(flag) || getArg(flag).startsWith('-'))) {
      throw new Error(`${flag} requires a value.`);
    }
  }
  const cfg = loadConfig();
  if (sub === 'shared') {
    const action = args[2] || 'status';
    if (!['status', 'on', 'off', 'map', 'unmap', 'min-context', 'auto'].includes(action)) {
      throw new Error('Usage: delegate shared status|on|off|map <T1|T2>|unmap <T1|T2>|min-context <tokens|default>|auto on|off --agent codex');
    }
    if (hasFlag('--global') || hasFlag('--project')) throw new Error('Shared policies retain their approved scope; mappings do not change it.');
    const provided = (flag) => args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
    if (!['map', 'unmap'].includes(action) && ['--model', '--effort', '--from', '--provider'].some(provided)) {
      throw new Error('Model options require delegate shared map or unmap.');
    }
    const targets = codexSharedTargets(cfg);
    if (action === 'map' || action === 'unmap') {
      const tier = args[3];
      const from = getArg('--from');
      const provider = getArg('--provider') ?? codexProviderName();
      if (!SHARED_RULE_TIERS.includes(tier)) throw new Error('Shared rule tier must be T1 or T2.');
      const same = (t) => t.tier === tier && t.from === from && t.provider === provider;
      if (action === 'map') {
        const target = validateCodexSharedTarget({ tier, from, provider, model: getArg('--model'), effort: getArg('--effort') });
        cfg.codex = { ...cfg.codex, sharedRules: { ...cfg.codex?.sharedRules, targets: [...targets.filter((t) => !same(t)), target] } };
      } else {
        if (provided('--model') || provided('--effort')) throw new Error('unmap accepts only tier, --from and --provider.');
        if (!targets.some(same)) throw new Error('No matching shared tier mapping; specify --from and the correct provider.');
        cfg.codex = { ...cfg.codex, sharedRules: { ...cfg.codex?.sharedRules, targets: targets.filter((t) => !same(t)) } };
      }
    } else if (action === 'auto') {
      if (!['on', 'off'].includes(args[3])) throw new Error('Usage: delegate shared auto on|off --agent codex');
      cfg.codex = { ...cfg.codex, sharedRules: { ...cfg.codex?.sharedRules, auto: args[3] === 'on' } };
    } else if (action === 'min-context') {
      const value = args[3];
      if (value === 'default') {
        cfg.codex = { ...cfg.codex };
        delete cfg.codex.delegateMinContext;
      } else if (/^\d+$/.test(value ?? '') && Number.isSafeInteger(Number(value))) {
        cfg.codex = { ...cfg.codex, delegateMinContext: Number(value) };
      } else {
        throw new Error(`min-context takes a whole number of parent input tokens, or default (${DEFAULT_DELEGATE_MIN_CONTEXT}).`);
      }
    } else if (action !== 'status') {
      cfg.codex = { ...cfg.codex, sharedRules: { ...cfg.codex?.sharedRules, enabled: action === 'on' } };
    }
    if (action !== 'status') saveConfig(cfg);
    printShared(cfg, { details: true });
    console.log(`Codex delegation is ${codexDelegateEnabled(cfg) ? 'on' : 'off; enable with sprag delegate on --agent codex'}. Target availability and lower cost must be verified with your provider.`);
    return;
  }
  if (sub === 'rules') {
    if (args[2] === 'add') {
      if (hasFlag('--global') === hasFlag('--project')) throw new Error('Choose --global or --project for the rule.');
      const scope = hasFlag('--project') ? 'project' : 'global';
      // `add R<N>` approves a route-scan candidate; its project is where the pattern was seen.
      const cand = /^R\d+$/i.test(args[3] || '') ? findCodexCandidate(args[3]) : null;
      if (/^R\d+$/i.test(args[3] || '') && !cand) throw new Error(`No open Codex route candidate ${args[3]}. Run sprag route-scan --agent codex.`);
      const model = getArg('--model') ?? cand?.suggestedModel;
      if (cand && !model) throw new Error(`R${cand.id} has no priced target the user has run. Pass --model <id>${cand.alternatives?.length ? ` (priced cheaper: ${cand.alternatives.join(', ')})` : ''}.`);
      const rule = addCodexModelRule({ category: cand?.category ?? args[3], model, effort: getArg('--effort'),
        from: cand?.from ?? getArg('--from'), scope, root: cand?.projectRoot ?? root, provider: cand?.provider || codexProviderName() });
      if (cand) resolveCodexCandidate(cand);
      console.log(`Codex rule: ${rule.category} | ${rule.from} -> ${rule.model} | ${rule.scope}${rule.targetRoot ? ` ${rule.targetRoot}` : ''}`);
    } else if (args[2] === 'rm') removeCodexModelRule(Number(args[3]));
    else if (args[2]) throw new Error('Usage: delegate rules [add <category|R<N>> --from <model> --model <model> --global|--project | rm <N>]');
    const rules = loadCodexModelRules();
    if (!rules.length) console.log('No Codex-only model rules.');
    let events = [];
    try { events = Object.values(loadCodexLedger().events); } catch { /* No ledger yet: rules list without outcomes. */ }
    const inReview = new Set(codexRulesInReview({ rules, events, root: null }).map((x) => x.index));
    rules.forEach((r, i) => {
      const h = codexRuleHealth(r, { events });
      const outcome = h.runs ? ` | measured x${h.runs}, err ${Math.round(h.rate * 100)}%, saved ${signedUsd(h.saved, 4)}` : '';
      const warn = inReview.has(i + 1) ? ` | rule-health: ${h.errs}/${h.runs} runs failed, narrow the condition or remove (delegate rules rm ${i + 1} --agent codex)` : '';
      console.log(`#${i + 1} ${r.category} | ${r.from} -> ${r.model} | ${r.scope}${r.targetRoot ? ` ${r.targetRoot}` : ''}${outcome}${warn}`);
    });
    printShared(cfg, { details: true });
    return;
  }
  if (!['on', 'off', 'status', 'model'].includes(sub)) throw new Error('Usage: delegate on|off|status|model <model>|rules|shared --agent codex');
  let target;
  if (sub === 'model') target = args[2] === 'off' ? null : validateCodexTarget(args[2], getArg('--effort'));
  else if (getArg('--model') !== undefined) target = validateCodexTarget(getArg('--model'), getArg('--effort'));
  else if (hasFlag('--effort')) throw new Error('--effort requires a target model.');
  if (target !== undefined && !['model', 'on'].includes(sub)) throw new Error('Set the target with delegate model or delegate on --model.');
  if (sub === 'on') configureCodexHooks();
  if (sub !== 'status') {
    cfg.codex = { ...cfg.codex };
    if (sub === 'on' || sub === 'off') cfg.codex.delegate = sub === 'on';
    if (target !== undefined) cfg.codex.delegateTarget = target;
    saveConfig(cfg);
  }
  console.log(`Codex delegate: ${codexDelegateEnabled(cfg) ? 'on' : 'off'} (model routing and guidance)`);
  console.log(`Default target: ${cfg.codex?.delegateTarget?.model || 'inherit (no override)'}`);
  // Turning delegation off must work even when the rule file is damaged.
  let ruleCount;
  try { ruleCount = String(loadCodexModelRules().length); } catch (e) { ruleCount = `unreadable (${e.message})`; }
  console.log(`Codex rules: ${ruleCount}`);
  printShared(cfg);
  console.log('Explicit spawn models and custom roles are preserved. Targets must be available from your Codex provider.');
  const saved = codexRoutingSavedTotals();
  console.log(saved.priced
    ? `Routing saved: ${saved.total < 0 ? '-' : ''}$${Math.abs(saved.total).toFixed(4)} over ${saved.priced} priced run(s). Details: sprag route-scan savings --agent codex`
    : `Routing saved: n/a (${saved.runs ? `${saved.runs} attributed run(s), none priced` : 'no attributed runs yet'}). Review/trust the Sprag hooks in Codex /hooks.`);
}
