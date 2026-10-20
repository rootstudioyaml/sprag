/**
 * Delegation-only subagents: Claude Code agents with a `tools` allowlist.
 *
 * Behind a gateway (ANTHROPIC_BASE_URL) Claude Code turns MCP tool search off,
 * so every MCP tool definition rides along on each subagent request. A
 * `general-purpose` haiku measured 46,618 tokens on its first request; a haiku
 * agent limited to Read/Grep/Glob/Bash measured 20,141. A `tools` allowlist
 * excludes MCP tools by definition, which is the whole saving.
 *
 * The files live in ~/.claude/agents and carry an ownership marker inside the
 * frontmatter (a YAML comment, so it never reaches the prompt). Only files with
 * that marker are ever overwritten or deleted; a same-named user file is left.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { claudeUserDir } from './paths.js';
import { loadConfig } from './config.js';
import { agentDefinitions } from './presets-source.js';

export const OWNER_MARK = 'sprag:delegation-agent';
const MARK_LINE = `# managed by sprag (${OWNER_MARK}); edits are overwritten`;

// The definitions come from presets-source.js: the centrally published bundle
// when it verifies, else presets/agents.json. Both have one shape:
//   { name, model, effort, tools: [..], description: { ko, en }, body: { ko, en } }
//
// Models are aliases on purpose: behind a gateway they resolve through
// ANTHROPIC_DEFAULT_*_MODEL, and a full model id would bypass that mapping. The
// exception is t1h-worker, which names the full id: Claude Code resolves a bare
// alias to an older model than the one the tier means.
//
// Effort is a separate axis from the tier and is set by how the work gets
// verified, not by how hard it is. Where the check is command output or a file
// comparison (lookups, test runs, mechanical conversion) extra thinking buys
// nothing, so those agents run at low. The worker implements a design the
// caller already fixed, against tests, so it takes the default for well-specified
// work, medium; the opus worker takes the larger, harder share of that work at high. The main session's effort is never touched here, and
// CLAUDE_CODE_EFFORT_LEVEL must stay unset: it overrides every agent's own value.
//
// The files are rendered from the English copy. They are prompts the model
// reads, and the Korean copy is what the /ops console shows beside it.
export function definitions() {
  return agentDefinitions();
}

function render(def) {
  const body = String((def.body && def.body.en) || '').replace(/\s+$/, '');
  return [
    '---',
    `name: ${def.name}`,
    `description: ${(def.description && def.description.en) || ''}`,
    `tools: ${(Array.isArray(def.tools) ? def.tools : [def.tools]).join(', ')}`,
    `model: ${def.model}`,
    `effort: ${def.effort}`,
    MARK_LINE,
    '---',
    body,
    '',
  ].join('\n');
}

const agentsDir = () => join(claudeUserDir(), 'agents');
const fileOf = (name) => join(agentsDir(), `${name}.md`);

/** True when the marker sits inside the leading frontmatter block. */
function isOwned(text) {
  if (!text.startsWith('---')) return false;
  const end = text.indexOf('\n---', 3);
  return (end === -1 ? text : text.slice(0, end)).includes(OWNER_MARK);
}

function readOwned(path) {
  try { return { text: readFileSync(path, 'utf8') }; } catch { return null; }
}

/** Names of the files in the agents dir that carry our marker. */
function ownedNames() {
  let entries = [];
  try { entries = readdirSync(agentsDir()); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.endsWith('.md')) continue;
    const f = readOwned(join(agentsDir(), e));
    if (f && isOwned(f.text)) out.push(e.slice(0, -3));
  }
  return out;
}

export function removeDelegationAgents() {
  const removed = [];
  const names = new Set([...definitions().map((d) => d.name), ...ownedNames()]);
  for (const name of names) {
    const p = fileOf(name);
    try {
      const f = readOwned(p);
      if (f && isOwned(f.text)) { unlinkSync(p); removed.push(name); }
    } catch { /* one file failing does not stop the rest */ }
  }
  return { written: [], unchanged: [], skipped: [], removed };
}

export function syncDelegationAgents({ agent = 'claude' } = {}) {
  const res = { written: [], unchanged: [], skipped: [], removed: [] };
  if (agent === 'codex') return res;
  try {
    if (loadConfig().delegationAgents === false) return removeDelegationAgents();
  } catch { /* an unreadable config means the default, on */ }
  const defs = definitions();
  for (const def of defs) {
    try {
      const p = fileOf(def.name);
      const want = render(def);
      const cur = existsSync(p) ? readOwned(p) : null;
      if (existsSync(p) && !cur) { res.skipped.push({ name: def.name, reason: 'unreadable' }); continue; }
      if (cur && !isOwned(cur.text)) { res.skipped.push({ name: def.name, reason: 'not-owned' }); continue; }
      if (cur && cur.text === want) { res.unchanged.push(def.name); continue; }
      mkdirSync(agentsDir(), { recursive: true });
      writeFileSync(p, want);
      res.written.push(def.name);
    } catch (e) {
      res.skipped.push({ name: def.name, reason: `error: ${e.message}` });
    }
  }
  // An agent the published presets dropped or renamed: its old file is ours
  // (the marker says so) and nothing names it any more.
  if (defs.length > 0) {
    const keep = new Set(defs.map((d) => d.name));
    for (const name of ownedNames()) {
      if (keep.has(name)) continue;
      try { unlinkSync(fileOf(name)); res.removed.push(name); } catch { /* left for the next sync */ }
    }
  }
  return res;
}

export function delegationAgentStatus() {
  let enabled = true;
  try { enabled = loadConfig().delegationAgents !== false; } catch { /* default on */ }
  const agents = definitions().map((def) => {
    const f = existsSync(fileOf(def.name)) ? readOwned(fileOf(def.name)) : null;
    const state = !f ? 'absent' : isOwned(f.text) ? 'installed-by-sprag' : 'user-file';
    return { name: def.name, state };
  });
  return { enabled, agents };
}
