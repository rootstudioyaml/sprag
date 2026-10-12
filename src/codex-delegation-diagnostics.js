import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { codexUserDir, codexModelName } from './agent.js';
import { codexDelegationStatus } from './codex-ledger.js';

/** Local introspection only. A CLI feature flag cannot prove a model received a tool. */
export function codexDelegationDiagnostics({ home = codexUserDir(), model = codexModelName({ home }), sessionId, dir,
  exec = execFileSync } = {}) {
  const result = { model, version: null, flags: {}, configuredDisabled: false,
    catalogAgentVersion: null, activity: codexDelegationStatus({ dir, sessionId }),
    tools: 'unverified in the active session', warnings: [], errors: [] };
  try {
    const cfg = parse(readFileSync(join(home, 'config.toml'), 'utf8'));
    const profile = cfg.profiles?.[cfg.profile];
    result.configuredDisabled = (profile?.agents?.enabled ?? cfg.agents?.enabled) === false ||
      (profile?.features?.multi_agent ?? cfg.features?.multi_agent) === false;
  } catch (e) { if (e.code !== 'ENOENT') result.errors.push('Cannot parse user config.'); }
  const run = (args) => exec('codex', args, { encoding: 'utf8', timeout: 5000, maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CODEX_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  try { result.version = run(['--version']).trim().slice(0, 100); } catch { result.errors.push('Codex version unavailable.'); }
  try {
    for (const line of run(['features', 'list']).split('\n')) {
      const m = /^(multi_agent(?:_v2(?:_dynamic_tools)?)?)\s+.+?\s+(true|false)\s*$/.exec(line);
      if (m) result.flags[m[1]] = m[2] === 'true';
    }
  } catch { result.errors.push('Codex feature list unavailable.'); }
  try {
    const data = JSON.parse(run(['debug', 'models', '--bundled']));
    const models = Array.isArray(data) ? data : data.models;
    const found = models?.find((m) => m.slug === model);
    if (['v1', 'v2'].includes(found?.multi_agent_version)) result.catalogAgentVersion = found.multi_agent_version;
  } catch { result.errors.push('Bundled model catalog unavailable.'); }
  if (result.configuredDisabled || result.flags.multi_agent === false) result.warnings.push('Agent tools are disabled in the inspected configuration.');
  if (result.catalogAgentVersion === 'v2' && result.flags.multi_agent_v2 === false) {
    result.warnings.push('The bundled model catalog names v2 while the v2 feature is off. This is a compatibility clue, not proof of the cause; no setting was changed.');
  }
  if (result.activity.offers && !result.activity.bound && !result.activity.settled) result.warnings.push('Sprag emitted offers but no child execution is connected.');
  result.warnings.push('Confirm spawn_agent and wait_agent in the running session. If absent, continue on the main agent and report the limitation; do not launch another CLI as a substitute.');
  return result;
}
