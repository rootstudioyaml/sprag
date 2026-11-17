/**
 * Which Claude Code is running this hook or command, read without spawning it.
 *
 * Measured on Claude Code 2.1.319: the SessionStart and UserPromptSubmit hook
 * processes carry AI_AGENT=claude-code_2-1-319_harness, and the Bash tool's
 * children carry claude-code_2-1-319_agent. The Claude process's own
 * environment does not have it, so the value exists only in hook and tool
 * children. That is enough here, because the callers are hooks and CLI
 * commands that a session runs. `claude --version` is deliberately not used: it
 * would slow the hook path and make tests depend on the machine.
 *
 * Why the version matters: before 2.1.326 a session did not find an agent file
 * first created while it was running ("Fixed a first skill, command or agent
 * created during a session not being found right away").
 */

import { isNewer } from './update-check.js';

export const AGENTS_LIVE_MIN_VERSION = '2.1.326';

const AI_AGENT_RE = /^claude-code_(\d+)-(\d+)-(\d+)(?:_|$)/;

/** Claude Code version from AI_AGENT ("claude-code_2-1-319_harness" -> "2.1.319"), or null. */
export function sessionClaudeVersion(env = process.env) {
  const hit = AI_AGENT_RE.exec(String((env && env.AI_AGENT) || '').trim());
  return hit ? `${hit[1]}.${hit[2]}.${hit[3]}` : null;
}

/**
 * True when this Claude Code finds an agent first created mid-session; false
 * when it is older; null when the version is unknown (callers treat null like
 * false, so an old Claude Code is never assumed to be new).
 */
export function agentsLoadMidSession(version) {
  if (!version) return null;
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) return null;
  return version === AGENTS_LIVE_MIN_VERSION || isNewer(version, AGENTS_LIVE_MIN_VERSION);
}
