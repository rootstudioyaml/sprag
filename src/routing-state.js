/**
 * routing-state — what this PC can tell the team dashboard about delegation.
 *
 * A machine that never delegates has three distinct causes the dashboard could
 * not tell apart: routing switched off, the rules never loaded into the
 * session, or the delegation agents missing. routingState() answers each one:
 *
 *   on      routing is not switched off (config `routing`)
 *   loaded  the global CLAUDE.md Claude Code reads imports ratchet-model.md and
 *           the imported file exists
 *   agents  every delegation agent sprag installs is in the agents directory
 *
 * Each field is a boolean, or null when it could not be determined. Nothing here
 * throws, and nothing that names the machine (path, user) leaves it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { routingEnabled } from './routing-switch.js';
import { definitions } from './delegation-agents.js';
import { debug } from './debug.js';

/** The directory Claude Code reads CLAUDE.md and agents from: CLAUDE_CONFIG_DIR, else ~/.claude. */
export function claudeConfigDir({ env = process.env, home = homedir() } = {}) {
  const custom = env && env.CLAUDE_CONFIG_DIR;
  return custom ? String(custom) : join(home, '.claude');
}

/** Paths of the `@...ratchet-model.md` import lines in a CLAUDE.md, with `~` expanded. Project-relative imports are skipped. */
function modelRatchetImports(text, home) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^@(\S*ratchet-model\.md)$/);
    if (!m) continue;
    const p = m[1].startsWith('~/') ? join(home, m[1].slice(2)) : m[1];
    if (isAbsolute(p)) out.push(p);
  }
  return out;
}

function loadedState({ env, home }) {
  const claudeMd = join(claudeConfigDir({ env, home }), 'CLAUDE.md');
  if (!existsSync(claudeMd)) return false;
  const imports = modelRatchetImports(readFileSync(claudeMd, 'utf8'), home);
  return imports.some((p) => existsSync(p));
}

function agentsState({ env, home, names }) {
  const list = names || definitions().map((d) => d && d.name).filter(Boolean);
  if (!list.length) return null;
  const dir = join(claudeConfigDir({ env, home }), 'agents');
  return list.every((n) => existsSync(join(dir, `${n}.md`)));
}

function attempt(scope, fn) {
  try { return fn(); } catch (e) { debug(`routing-state:${scope}`, e); return null; }
}

/**
 * @param {object} [o] test hooks: cfg (config object), env, home, names (agent names)
 * @returns {{ on: boolean|null, loaded: boolean|null, agents: boolean|null }}
 */
export function routingState({ cfg, env = process.env, home = homedir(), names } = {}) {
  return {
    on: attempt('on', () => (cfg === undefined ? routingEnabled() : routingEnabled(cfg))),
    loaded: attempt('loaded', () => loadedState({ env, home })),
    agents: attempt('agents', () => agentsState({ env, home, names })),
  };
}
