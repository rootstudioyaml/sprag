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
import { loadConfig, saveConfig } from './config.js';
import { agentDefinitions, cliVersion, presetSource } from './presets-source.js';

export const OWNER_MARK = 'sprag:delegation-agent';
const MARK_LINE = `# managed by sprag (${OWNER_MARK}); edits are overwritten`;

// The definitions come from presets-source.js: the centrally published bundle
// when it verifies, else presets/agents.json. Both have one shape:
//   { name, model, effort, tools: [..], description: { ko, en }, body: { ko, en } }
//
// Models are aliases on purpose: behind a gateway they resolve through
// ANTHROPIC_DEFAULT_*_MODEL, and a full model id would bypass that mapping.
// t1h-worker used to pin claude-opus-5-5 because older Claude Code releases
// resolved the haiku alias to Haiku 4.5; 2.1.302 resolves opus, sonnet and
// haiku to the current 5.5 models on the first-party API, so all five agents
// use aliases (preset v4).
//
// Effort is a separate axis from the tier and is set by how the work gets
// verified, not by how hard it is. Where the check is command output or a file
// comparison (lookups, test runs, mechanical conversion) extra thinking buys
// nothing, so those agents run at low. Both workers implement a design the
// caller already fixed and run at high: a wrong implementation costs a rerun and
// another review by the main model, which outweighs the extra thinking. The
// tier, not the effort, separates the sonnet worker from the opus one. The main session's effort is never touched here, and
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
    return { name: def.name, state, drift: f && state === 'user-file' ? driftOf(def, f.text) : null };
  });
  return { enabled, agents };
}

/** `model` and `effort` from the leading frontmatter block; null when absent. */
function readFrontmatterSpec(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const field = (key) => {
    const hit = m && new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(m[1]);
    return hit && hit[1] ? hit[1] : null;
  };
  return { model: field('model'), effort: field('effort') };
}

/** fable, opus, sonnet or haiku, so an alias and a pinned id of one family compare equal. */
export function modelFamily(model) {
  const hit = /fable|opus|sonnet|haiku/.exec(String(model || '').toLowerCase());
  return hit ? hit[0] : null;
}

function driftOf(def, text) {
  const file = readFrontmatterSpec(text);
  const preset = { model: def.model || null, effort: def.effort || null };
  const same = file.effort === preset.effort && modelFamily(file.model) === modelFamily(preset.model);
  return same ? null : { name: def.name, file, preset };
}

/**
 * User-owned agent files whose model family or effort differs from the preset.
 * sync never touches them, so this is the only place the difference shows.
 */
export function agentDrift() {
  const out = [];
  for (const def of definitions()) {
    const f = existsSync(fileOf(def.name)) ? readOwned(fileOf(def.name)) : null;
    if (!f || isOwned(f.text)) continue;
    const d = driftOf(def, f.text);
    if (d) out.push(d);
  }
  return out;
}

/**
 * Session-start notice for agentDrift(), shown once per preset version: the
 * key is remembered in config, and a newly published version changes it.
 * Returns null when there is no drift or this key was already announced.
 */
export function takeAgentDriftNotice({ lang = 'ko' } = {}) {
  const drift = agentDrift();
  if (drift.length === 0) return null;
  const src = presetSource();
  // The bundled presets carry no version of their own; they change with the CLI.
  const key = `${src.kind}:${src.kind === 'remote' ? src.version : cliVersion()}`;
  const cfg = loadConfig();
  if (cfg.agentDriftNoticedKey === key) return null;
  saveConfig({ ...cfg, agentDriftNoticedKey: key });
  const ko = lang === 'ko';
  const label = src.kind === 'remote' ? `v${src.version}` : 'bundled';
  const v = (x) => x || '-';
  return [
    ko
      ? `[sprag agents] 프리셋 ${label}이 지정한 값과 다른 직접 만든 에이전트 파일이 있어서, sync가 이 파일들을 덮어쓰지 않았습니다.`
      : `[sprag agents] Some agent files you made yourself differ from what preset ${label} specifies, so sync did not overwrite them.`,
    ...drift.map((d) => ko
      ? `- ${d.name}: 파일 effort ${v(d.file.effort)} · 모델 ${v(d.file.model)}, 프리셋 effort ${v(d.preset.effort)} · 모델 ${v(d.preset.model)}`
      : `- ${d.name}: file effort ${v(d.file.effort)} · model ${v(d.file.model)}, preset effort ${v(d.preset.effort)} · model ${v(d.preset.model)}`),
    ko
      ? 'sprag가 관리하게 하려면 파일을 지운 뒤 `sprag delegate agents on` 을 실행합니다. 지금 값을 유지하려면 그대로 두면 되고, 이 안내는 프리셋 버전이 바뀔 때만 다시 나옵니다. 사용자에게 이 차이를 한 줄로 알리십시오.'
      : 'To let sprag manage them, delete the files and run `sprag delegate agents on`. To keep the current values, leave them as they are; this notice returns only when the preset version changes. Tell the user about this difference in one line.',
  ].join('\n');
}
