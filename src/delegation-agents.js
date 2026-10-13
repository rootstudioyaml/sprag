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

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { claudeUserDir } from './paths.js';
import { loadConfig } from './config.js';

export const OWNER_MARK = 'sprag:delegation-agent';
const MARK_LINE = `# managed by sprag (${OWNER_MARK}); edits are overwritten`;

// Models are aliases on purpose: behind a gateway they resolve through
// ANTHROPIC_DEFAULT_*_MODEL, and a full model id would bypass that mapping.
export const DEFINITIONS = [
  {
    name: 'haiku-explore',
    model: 'haiku',
    tools: 'Read, Grep, Glob, Bash',
    role: 'Your role: read-only exploration, lookups, status checks, and questions about pasted logs or text.',
    description: 'Cheap read-only exploration, lookup, status checks and summaries for delegated tasks. It has no MCP tools.',
  },
  {
    name: 'haiku-runner',
    model: 'haiku',
    tools: 'Bash, Read, Grep, Glob',
    role: 'Your role: run the build, test, or git commands you are given and report the result.',
    description: 'Cheap runner for build, test and git commands in delegated tasks. It has no MCP tools.',
  },
  {
    name: 'haiku-translate',
    model: 'haiku',
    tools: 'Read, Grep, Glob, Edit, Write',
    role: 'Your role: batch translation and mechanical text conversion of the files or text you are given.',
    description: 'Cheap batch translation and structured text conversion for delegated tasks. It has no MCP tools.',
  },
  {
    name: 'sonnet-worker',
    model: 'sonnet',
    tools: 'Read, Grep, Glob, Bash, Edit, Write, NotebookEdit',
    role: 'Your role: multi-step work and the implementation half of a design the caller already fixed.',
    description: 'Mid-tier worker for multi-step tasks and implementation handed over with a fixed design. It has no MCP tools.',
  },
];

function render(def) {
  return [
    '---',
    `name: ${def.name}`,
    `description: ${def.description}`,
    `tools: ${def.tools}`,
    `model: ${def.model}`,
    MARK_LINE,
    '---',
    def.role,
    'Do only the delegated task, and stay within the caps (tool calls, output tokens) the caller wrote in the prompt.',
    "Report concisely, in the language of the caller's prompt.",
    'If you need an MCP tool or any tool not on your list, stop at once and report one line: "needs general-purpose: <tools needed>". The parent will delegate again.',
    'Do not guess at anything you could not verify; say that you could not verify it.',
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

export function removeDelegationAgents() {
  const removed = [];
  for (const def of DEFINITIONS) {
    const p = fileOf(def.name);
    try {
      const f = readOwned(p);
      if (f && isOwned(f.text)) { unlinkSync(p); removed.push(def.name); }
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
  for (const def of DEFINITIONS) {
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
  return res;
}

export function delegationAgentStatus() {
  let enabled = true;
  try { enabled = loadConfig().delegationAgents !== false; } catch { /* default on */ }
  const agents = DEFINITIONS.map((def) => {
    const f = existsSync(fileOf(def.name)) ? readOwned(fileOf(def.name)) : null;
    const state = !f ? 'absent' : isOwned(f.text) ? 'installed-by-sprag' : 'user-file';
    return { name: def.name, state };
  });
  return { enabled, agents };
}
