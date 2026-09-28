import { loadConfig, saveConfig } from '../config.js';
import { configureCodexHooks } from '../codex-installer.js';
import { validateCodexTarget, loadCodexModelRules, addCodexModelRule, removeCodexModelRule } from '../codex-delegation.js';
import { findCodexCandidate, resolveCodexCandidate } from '../codex-route-scan.js';
import { codexRoutingSavedTotals } from '../codex-ledger.js';
import { codexProviderName } from '../agent.js';

export function run({ args, getArg, hasFlag, root }) {
  const sub = args[1] || 'status';
  if (args.some((arg) => arg.startsWith('--hook'))) throw new Error('Use codex-hook for Codex hook payloads.');
  for (const flag of ['--model', '--effort', '--from']) {
    if (args.some((arg) => arg === flag || arg.startsWith(`${flag}=`)) && (!getArg(flag) || getArg(flag).startsWith('-'))) {
      throw new Error(`${flag} requires a value.`);
    }
  }
  const rules = loadCodexModelRules();
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
    if (!rules.length) console.log('No Codex model rules. Claude rules are not imported.');
    rules.forEach((r, i) => console.log(`#${i + 1} ${r.category} | ${r.from} -> ${r.model} | ${r.scope}${r.targetRoot ? ` ${r.targetRoot}` : ''}`));
    return;
  }
  if (!['on', 'off', 'status', 'model'].includes(sub)) throw new Error('Usage: delegate on|off|status|model <model>|rules --agent codex');
  const cfg = loadConfig();
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
  console.log(`Codex delegate: ${cfg.codex?.delegate === true ? 'on' : 'off'} (model routing and guidance)`);
  console.log(`Default target: ${cfg.codex?.delegateTarget?.model || 'inherit (no override)'}`);
  console.log(`Codex rules: ${rules.length}`);
  console.log('Explicit spawn models and custom roles are preserved. Targets must be available from your Codex provider.');
  const saved = codexRoutingSavedTotals();
  console.log(saved.priced
    ? `Routing saved: $${saved.total.toFixed(4)} over ${saved.priced} priced run(s). Details: sprag route-scan savings --agent codex`
    : `Routing saved: n/a (${saved.runs ? `${saved.runs} attributed run(s), none priced` : 'no attributed runs yet'}). Review/trust the Sprag hooks in Codex /hooks.`);
}
