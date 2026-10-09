import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { codexUserDir } from './agent.js';
import { writeViaTmp } from './state-file.js';

export const CODEX_HANDLERS = {
  SessionStart: { matcher: 'startup|resume|clear|compact', command: 'sprag codex-hook --agent codex --event session-start', timeout: 15 },
  UserPromptSubmit: { command: 'sprag codex-hook --agent codex --event prompt', timeout: 600 },
  PreToolUse: { matcher: '^(Bash|Read|read_file|Edit|Write|Agent|spawn_agent|mcp__filesystem__read_(?:text_)?file|(?:functions\\.|tools\\.)?(?:exec_command|shell_command|shell|apply_patch|spawn_agent))$', command: 'sprag codex-hook --agent codex --event pre-tool', timeout: 600 },
  PostToolUse: { matcher: '^(Bash|apply_patch|Edit|Write|(?:functions\\.|tools\\.)?(?:exec_command|shell_command|shell|apply_patch))$', command: 'sprag codex-hook --agent codex --event post-tool', timeout: 15 },
  SubagentStart: { command: 'sprag codex-hook --agent codex --event subagent-start', timeout: 15 },
};
const ownCommands = new Set(Object.values(CODEX_HANDLERS).map((h) => h.command));
const PANEL_COMMAND = 'sprag codex-hook --agent codex --event panel-start';
ownCommands.add(PANEL_COMMAND);

export function codexPanelAutoEnabled() {
  const data = readHooks(join(codexUserDir(), 'hooks.json'));
  return (data.hooks?.SessionStart || []).some((g) => g.hooks.some((h) => h?.command === PANEL_COMMAND));
}

export function readCodexHooks(file = join(codexUserDir(), 'hooks.json')) {
  if (!existsSync(file)) return {};
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (data.hooks !== undefined && (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)))) {
    throw new Error(`Invalid Codex hooks configuration: ${file}`);
  }
  for (const groups of Object.values(data.hooks || {})) {
    if (!Array.isArray(groups) || groups.some((g) => !g || !Array.isArray(g.hooks))) {
      throw new Error(`Invalid Codex hook groups: ${file}`);
    }
  }
  return data;
}

const readHooks = readCodexHooks;

export function codexHookStatus() {
  const data = readCodexHooks();
  return Object.entries(CODEX_HANDLERS).map(([event, expected]) => {
    const groups = data.hooks?.[event] || [];
    // Async hooks cannot enforce write guards or lint feedback. Conversion hooks
    // also need time for interpreter probes and multiple bounded conversions.
    const registered = groups.some((group) => group.matcher === expected.matcher && group.hooks.some((hook) =>
      hook?.type === 'command' && hook.command === expected.command && hook.enabled !== false && hook.async !== true &&
      Number.isFinite(hook.timeout ?? 600) && (hook.timeout ?? 600) >= expected.timeout));
    return { event, registered };
  });
}

export function configureCodexHooks({ remove = false, panelAuto } = {}) {
  const file = join(codexUserDir(), 'hooks.json');
  const data = readHooks(file);
  const before = JSON.stringify(data);
  const auto = panelAuto ?? (data.hooks?.SessionStart || []).some((g) => g.hooks.some((h) => h?.command === PANEL_COMMAND));
  data.hooks ||= {};
  for (const [event, groups] of Object.entries(data.hooks)) {
    data.hooks[event] = groups.map((g) => ({ ...g, hooks: g.hooks.filter((h) => !ownCommands.has(h?.command)) }))
      .filter((g) => g.hooks.length);
    if (!data.hooks[event].length) delete data.hooks[event];
  }
  if (!remove) {
    for (const [event, { matcher, command, timeout }] of Object.entries(CODEX_HANDLERS)) {
      const group = { hooks: [{ type: 'command', command, timeout }] };
      if (matcher) group.matcher = matcher;
      (data.hooks[event] ||= []).push(group);
    }
    if (auto) data.hooks.SessionStart.push({ matcher: 'startup|resume', hooks: [{ type: 'command', command: PANEL_COMMAND, timeout: 10 }] });
  }
  if (remove && !Object.keys(data.hooks).length) delete data.hooks;
  if (JSON.stringify(data) !== before) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) writeFileSync(`${file}.bak-${Date.now()}`, readFileSync(file));
    const tmp = `${file}.${process.pid}.tmp`;
    writeViaTmp(tmp, file, JSON.stringify(data, null, 2) + '\n');
  }
  return { file, action: remove ? 'removed' : 'configured' };
}
