import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { codexUserDir } from './agent.js';
import { codexHookStatus } from './codex-installer.js';
import { createPanelReader } from './codex-panel.js';
import { panelHealth } from './codex-panel-state.js';

export const CODEX_CAPABILITIES = [
  { feature: 'statusline', support: 'supported', command: 'sprag --statusline --agent codex', note: 'Local terminal output; native footer accepts only Codex item identifiers.' },
  { feature: 'panel', support: 'supported', command: 'sprag panel --agent codex', note: 'Local logs; tmux inline layout; optional macOS window.' },
  { feature: 'reports', support: 'supported', command: 'sprag --agent codex --format json', note: 'Token usage, cached input, reasoning, session and project filters.' },
  { feature: 'harness', support: 'supported', command: 'sprag harness check --agent codex', note: 'AGENTS.md, overrides, explicit-scope ratchet rule management.' },
  { feature: 'brief', support: 'supported', command: 'sprag brief --agent codex', note: 'Fresh context and limit warnings; change-triggered prompt hook.' },
  { feature: 'history', support: 'supported', command: 'sprag history --agent codex', note: 'Codex-only records of context (80%/95%) and 5h/weekly rate-limit (90%) warnings, plus handoffs. Cache and TTL chips are not recorded; last shows the latest event.' },
  { feature: 'handoff', support: 'supported', command: 'sprag handoff --agent codex', note: 'Git state and recorded Codex session usage; never reads Claude caps.' },
  { feature: 'korean', support: 'supported', command: 'sprag korean status --agent codex', note: 'Session guidance and recognized write-target lint; shared preference.' },
  { feature: 'reply-language', support: 'supported', command: 'sprag korean reply on --agent codex', note: 'Trusted Stop hook checks the current Korean prompt and final reply; continuation, opt-out and explicit English requests are excluded.' },
  { feature: 'cohesion', support: 'supported', command: 'sprag cohesion status --agent codex', note: 'Shared English guidance preference.' },
  { feature: 'doc2md', support: 'supported', command: 'sprag doc2md status --agent codex', note: 'Shared converter, prompt paths, supported file reads, and recognized document/cache write guards; not arbitrary shell extraction.' },
  { feature: 'doc2md-saved', support: 'partial', command: 'sprag doc2md savings --agent codex', note: 'Office XML versus Markdown bytes/4 at the recorded Codex input price. Estimate only; incomplete or unsupported baselines and missing prices stay unknown.' },
  { feature: 'delegation-diagnostics', support: 'supported', command: 'sprag delegate doctor --agent codex', note: 'Local feature/catalog and matched-child evidence. Never claims that an enabled preference proves native tools are available.' },
  { feature: 'delegate', support: 'supported', command: 'sprag delegate on --agent codex', note: 'Native routing and shared delegation policies; tier models resolve from priced models already run in Codex, or from explicit mappings. Explicit models/custom roles preserved; bounds are guidance, not enforced limits.' },
  { feature: 'routing-saved', support: 'partial', command: 'sprag route-scan savings --agent codex', note: 'Sprag-routed child usage with matching LiteLLM prices; counterfactual estimate, not billed savings. Unpriced runs stay unknown.' },
  { feature: 'cache-timer', support: 'partial', command: 'sprag cache status --refresh --agent codex', note: 'Documented minimum retention after recorded cache usage; LiteLLM deployments resolved through model/info. Unknown routes show age; exact expiry is not reported.' },
  { feature: 'mode', support: 'partial', command: 'sprag mode --agent codex', note: 'Labels, color, and timer apply to panel/statusline; Claude TTL buckets do not.' },
  { feature: 'upgrade', support: 'manual', command: 'sprag upgrade --print --agent codex', note: 'Skip the Claude npm postinstall; reinstall Codex hooks after upgrade.' },
  { feature: 'update-notice', support: 'supported', command: 'sprag update-check --agent codex', note: 'Live panel refreshes in the background; one-shot statusline reads cached state; interactive SessionStart offers upgrades with consent.' },
  { feature: 'implementation-delegation', support: 'supported', command: 'sprag delegate implementation --agent codex --from MODEL --provider PROVIDER --session ID', note: 'Main agent designs and verifies; implementation uses resolved T1 only. Requires native subagent tools and records only matched child runs.' },
  { feature: 'route-scan', support: 'supported', command: 'sprag route-scan --agent codex', note: 'Recurring simple turns grouped by project, provider, and parent model; explicit approval before routing.' },
  { feature: 'seed', support: 'supported', command: 'sprag seed --agent codex', note: 'Shared delegation policies plus agent-compatible ratchet presets. Explicit scope; tier models resolve automatically or by mapping. No Claude installation needed.' },
  { feature: 'transcript ratchet', support: 'supported', command: 'sprag --statusline --agent codex', note: 'Recent repeated tool failures become ratchet? candidates; no automatic rule registration.' },
  { feature: 'compact-window', support: 'native', note: 'Codex uses model_auto_compact_token_limit; no Claude autoCompactWindow heuristic.' },
  { feature: 'cost / exact cache expiry', support: 'unavailable', note: 'Not measured in rollout logs; never estimated with Anthropic prices.' },
];

export async function codexDoctor({ root = process.cwd(), sessionId, days = 7 } = {}) {
  const home = codexUserDir();
  const file = join(home, 'config.toml');
  const config = { file, present: existsSync(file) };
  try {
    const cfg = config.present ? parse(readFileSync(file, 'utf8')) : {};
    // Only expose an allowlist. Provider auth and arbitrary config may hold secrets.
    config.hooksDisabled = cfg.features?.hooks === false || (cfg.features?.hooks === undefined && cfg.features?.codex_hooks === false);
    config.agentsDisabled = cfg.agents?.enabled === false || cfg.features?.multi_agent === false;
    config.agentsMaxThreads = cfg.agents?.max_concurrent_threads_per_session ?? cfg.agents?.max_threads ?? null;
    config.statusLine = Array.isArray(cfg.tui?.status_line) ? cfg.tui.status_line.filter((item) => typeof item === 'string') : null;
    config.autoCompactTokenLimit = Number.isFinite(cfg.model_auto_compact_token_limit) ? cfg.model_auto_compact_token_limit : null;
    config.note = 'User config only; active profile, project, managed policy, and runtime overrides may differ.';
  } catch { config.error = 'Cannot parse user config.toml; file left unchanged.'; }
  let hooks;
  try { hooks = { file: join(home, 'hooks.json'), events: codexHookStatus(), trust: 'unknown; review in Codex /hooks' }; }
  catch { hooks = { error: 'Cannot parse Codex hooks.json; file left unchanged.', events: [] }; }
  const data = await createPanelReader({ root, sessionId, days })();
  const session = data.session ? { id: data.session.sessionId, model: data.session.model,
    lastActivity: data.session.lastActivity, usageUpdates: data.session.requestCount } : null;
  return { agent: 'codex', home, root, config, hooks, harness: data.harness, rules: data.rules,
    preferences: { korean: data.korean, lint: data.lint, cohesion: data.cohesion, doc2md: data.doc2md, brief: data.brief, delegate: data.delegate },
    session, delegation: { ...data.delegation, tools: 'unknown; only the running agent can confirm spawn_agent and wait_agent availability' },
    documents: data.documents, routingSaved: data.routingSaved, panel: panelHealth(root, { sessionId }), capabilities: CODEX_CAPABILITIES };
}
