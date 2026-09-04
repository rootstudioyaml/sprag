/**
 * Installs the Claude Code integration asset:
 *   - Skill:  ~/.claude/skills/claude-token-saver/SKILL.md
 *
 * v2.6.0 consolidates `/token-monitor` into the skill (was redundant with the
 * auto-trigger). On install we actively remove a legacy
 * ~/.claude/commands/token-monitor.md if present so users don't see two
 * overlapping entry points.
 *
 * All paths are resolved with node:path so Windows backslashes and POSIX
 * forward-slashes are both handled. Directories are created with
 * `mkdirSync(..., { recursive: true })` which is a no-op if they already
 * exist on every platform.
 */

import { writeFileSync, mkdirSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeUserDir } from './paths.js';

const STATUSLINE_COMMAND = 'claude-token-saver --statusline --icon';
const STATUSLINE_REFRESH_INTERVAL = 5;

const SKILL_BODY = `---
name: claude-token-saver
description: Use when the user mentions Claude Code token usage, prompt cache hit rate, TTL/expiry, the 1M context window, cache misses, output spikes, rate-limit caps (5h/7d), or anything in the statusline produced by claude-token-saver (chips like "🚨 5H 94%", "🚨 7D 92%", "⚠ 1M ON", "⚠ Input spike", "⚠ Cache miss", "⚠ 5m TTL", "⚠ Rebuild churn", "⚠ Output heavy", "⚠ Call surge", "⏳ Cache expires", "💰 Cache saved", "🧠 Cache hit"). Also use when they ask to view token-usage history, want to understand a warning they just saw, or want to back up work before a session cap with \`claude-token-saver handoff\`.
---

# claude-token-saver — Claude Code Token Monitor

This skill helps users interpret and act on the \`claude-token-saver\` statusline
in Claude Code. The statusline updates every ~1s and shows cache health, TTL
countdown, savings, and (when relevant) a leading warning chip.

## Response language

Respond in the user's configured output language. Run
\`claude-token-saver mode\` once at the start of the session and read the
\`Output language\` field — if it shows \`language: ko\`, write **all of your
prose to the user in Korean** (summary, "All clear" status lines, headings,
recommendations). If it shows \`language: en\` (the default), write in
English. Tool output (the body of \`last\`/\`history\`/the table report) is
already localized by the CLI — do not retranslate it; just mirror your
own narration to match. If the user asks for a different language inline,
honor that for the rest of the turn without changing the saved setting.

## When this skill should activate

- The user references any chip wording: \`🚨 5H NN%\`, \`🚨 7D NN%\`,
  \`⚠ 1M ON\`, \`⚠ Input spike\`, \`⚠ Cache miss\`, \`⚠ 5m TTL\`,
  \`⚠ Rebuild churn\`, \`⚠ Output heavy\`, \`⚠ Call surge\`.
- The user asks "why is my cache hit rate low", "what does this warning mean",
  "when did this start happening", or similar.
- The user is approaching a rate-limit cap and wants to back up the current
  work so a fresh session can continue (point them at
  \`claude-token-saver handoff\`).
- The user wants to see the token-usage history file or asks for a summary
  of recent warnings.
- The user asks for a quick token report or "current state" check (the
  skill replaces the legacy \`/token-monitor\` slash command — same workflow,
  triggered by intent rather than a typed slash).

## What to do

1. **Lead with the most recent warning + how to handle it.** Run
   \`claude-token-saver last\` first. It returns the most recent warning event
   (chip + detail + timestamp) plus the full advice block for it. Surface that
   to the user before anything else — this is what they came for.
2. **Identify the chip.** If the user pasted a statusline (instead of relying
   on \`last\`), pull out the leading \`⚠ ...\` chip. That maps to a specific
   issue category.
3. **Show recent history.** Run \`claude-token-saver history\` (default last 7
   days) to see the chronology of warning transitions. Each entry is timestamped,
   bilingual (English line + 한국어), and includes a \`💡\` action tip inline.
4. **Drill down on the live state.** Run \`claude-token-saver --days 1\` (or
   another window) to render the full table view, which lists per-session
   spikes and recommended actions.
5. **Explain the warning** in plain language. Use the chip → cause table:

   | Chip               | Likely cause                                          |
   | ------------------ | ----------------------------------------------------- |
   | \`🚨 5H NN%\`       | 5-hour rate-limit window at NN% (>=90%). Cap is imminent. |
   | \`🚨 7D NN%\`       | 7-day rate-limit window at NN% (>=90%). Pace yourself.   |
   | \`⚠ 1M ON\`         | Auto-promoted to 1M context (Opus 4.7+ Max default).  |
   | \`⚠ Input spike\`   | One request consumed >250k or >3× the recent p95.     |
   | \`⚠ Cache miss\`    | Cache hit rate dropped below ~70%.                    |
   | \`⚠ 5m TTL\`        | Most cache writes are 5-min ephemeral (Pro plan default). |
   | \`⚠ Rebuild churn\` | Cache being re-written rapidly — prefix is unstable.  |
   | \`⚠ Output heavy\`  | Output ratio dominates input — inspect long generations. |
   | \`⚠ Call surge\`    | Request count is well above baseline.                 |

6. **Suggest the next action.** For \`🚨 5H/7D\` chips, recommend running
   \`claude-token-saver handoff\` to back up the current work to a
   \`HANDOFF-*.md\` file before the cap hits, then continue in a fresh
   session. For 1M ON, mention \`CLAUDE_CODE_DISABLE_1M_CONTEXT=1\`. For
   5m TTL, point at the Max plan's 1h bucket. For input spike, suggest
   splitting the conversation or compacting context.

## Useful commands

- \`claude-token-saver last\` — most recent warning + full advice (start here).
- \`claude-token-saver last --days 7\` — widen the lookback window.
- \`claude-token-saver\` — full table report (default last 1 day).
- \`claude-token-saver --days 7\` — wider window.
- \`claude-token-saver history\` — recent warning transitions per day, with
  inline \`💡\` action tips.
- \`claude-token-saver history --days 30\` — longer history.
- \`claude-token-saver handoff\` — write a HANDOFF-*.md template in cwd
  capturing git status + cap snapshot, so a fresh session can resume cleanly.
- \`claude-token-saver mode\` — show statusline preferences.
- \`claude-token-saver mode icon verbose 1d\` — change preferences.

## Storage layout (for reference)

History files live under the OS-appropriate user-data dir:
- Windows: \`%APPDATA%\\claude-token-saver\\history\\YYYY-MM-DD.md\`
- macOS:   \`~/Library/Application Support/claude-token-saver/history/YYYY-MM-DD.md\`
- Linux:   \`~/.config/claude-token-saver/history/YYYY-MM-DD.md\`

Each day's file is plain Markdown — safe to open in any editor.
`;

function writeIfNeeded(file, body, force) {
  const existed = existsSync(file);
  if (existed && !force) return { path: file, action: 'exists' };
  writeFileSync(file, body);
  return { path: file, action: existed ? 'updated' : 'created' };
}

export function installSkill({ force = false } = {}) {
  const dir = join(claudeUserDir(), 'skills', 'claude-token-saver');
  const file = join(dir, 'SKILL.md');
  mkdirSync(dir, { recursive: true });
  // SKILL.md is fully package-controlled — overwrite whenever the bundled
  // body differs from what's on disk so postinstall picks up new instructions
  // (e.g. the response-language directive added in v2.9.3) without forcing
  // users to re-run \`install --force\`.
  if (existsSync(file) && readFileSync(file, 'utf8') === SKILL_BODY) {
    return { path: file, action: 'exists' };
  }
  return writeIfNeeded(file, SKILL_BODY, true);
}

// Removes the legacy /token-monitor slash command from prior versions.
// v2.6.0 consolidated it into the skill — the file would otherwise linger.
export function removeLegacyCommand() {
  const file = join(claudeUserDir(), 'commands', 'token-monitor.md');
  if (!existsSync(file)) return { path: file, action: 'absent' };
  unlinkSync(file);
  return { path: file, action: 'removed' };
}

// Registers/repairs the Claude Code statusLine entry in ~/.claude/settings.json.
// - No statusLine yet: insert ours with refreshInterval:1.
// - statusLine already points at claude-token-saver: ensure refreshInterval:1
//   (this is the bit that makes the TTL countdown tick every second while idle).
// - statusLine points at a different command: leave it alone unless --force.
export function installStatusline({ force = false } = {}) {
  const dir = claudeUserDir();
  const file = join(dir, 'settings.json');
  mkdirSync(dir, { recursive: true });

  let settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      return { path: file, action: 'skipped', reason: `unreadable JSON (${e.message})` };
    }
  }

  const cur = settings.statusLine;
  const targetsUs = cur && typeof cur.command === 'string' && cur.command.includes('claude-token-saver');

  if (!cur) {
    settings.statusLine = {
      type: 'command',
      command: STATUSLINE_COMMAND,
      refreshInterval: STATUSLINE_REFRESH_INTERVAL,
    };
    writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
    return { path: file, action: 'created' };
  }

  if (targetsUs) {
    if (cur.refreshInterval === STATUSLINE_REFRESH_INTERVAL) {
      return { path: file, action: 'exists' };
    }
    cur.refreshInterval = STATUSLINE_REFRESH_INTERVAL;
    writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
    return { path: file, action: 'updated', reason: 'set refreshInterval=1' };
  }

  if (!force) {
    return { path: file, action: 'skipped', reason: `existing statusLine command (${cur.command}) — re-run with --force to overwrite` };
  }
  settings.statusLine = {
    type: 'command',
    command: STATUSLINE_COMMAND,
    refreshInterval: STATUSLINE_REFRESH_INTERVAL,
  };
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { path: file, action: 'updated', reason: 'replaced previous statusLine' };
}

// Registers the SessionStart hook that surfaces route-scan delegation
// candidates as session context (startup + /clear). Idempotent: skips when a
// claude-token-saver route-scan hook is already present; never touches other
// hooks the user configured.
const ROUTE_SCAN_HOOK_COMMAND = 'claude-token-saver route-scan --hook';

export function installSessionStartHook() {
  const dir = claudeUserDir();
  const file = join(dir, 'settings.json');
  mkdirSync(dir, { recursive: true });

  let settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      return { path: file, action: 'skipped', reason: `unreadable JSON (${e.message})` };
    }
  }

  settings.hooks = settings.hooks || {};
  // A present-but-non-array value is schema-invalid, but it's the user's
  // data — back off instead of silently replacing it.
  if (settings.hooks.SessionStart !== undefined && !Array.isArray(settings.hooks.SessionStart)) {
    return { path: file, action: 'skipped', reason: 'hooks.SessionStart is not an array — fix settings.json manually' };
  }
  const list = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
  const already = list.some((m) =>
    Array.isArray(m?.hooks) && m.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('route-scan --hook')),
  );
  if (already) return { path: file, action: 'exists' };

  list.push({
    matcher: 'startup|clear',
    hooks: [{ type: 'command', command: ROUTE_SCAN_HOOK_COMMAND, timeout: 10 }],
  });
  settings.hooks.SessionStart = list;
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { path: file, action: 'created' };
}

// Registers the UserPromptSubmit hook that briefs mid-session state changes
// (ctx tier crossings, new route candidates, rule-health flips) into the
// conversation — the model cannot see statusline chips, so without this a
// change that happens mid-session goes unexplained until the user asks.
// Silent (no output, zero context cost) when nothing changed. Idempotent.
const BRIEF_HOOK_COMMAND = 'claude-token-saver brief --hook';

export function installBriefHook() {
  const dir = claudeUserDir();
  const file = join(dir, 'settings.json');
  mkdirSync(dir, { recursive: true });

  let settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      return { path: file, action: 'skipped', reason: `unreadable JSON (${e.message})` };
    }
  }

  settings.hooks = settings.hooks || {};
  // A present-but-non-array value is schema-invalid, but it's the user's
  // data — back off instead of silently replacing it.
  if (settings.hooks.UserPromptSubmit !== undefined && !Array.isArray(settings.hooks.UserPromptSubmit)) {
    return { path: file, action: 'skipped', reason: 'hooks.UserPromptSubmit is not an array — fix settings.json manually' };
  }
  const list = Array.isArray(settings.hooks.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];
  const already = list.some((m) =>
    Array.isArray(m?.hooks) && m.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('brief --hook')),
  );
  if (already) return { path: file, action: 'exists' };

  list.push({
    hooks: [{ type: 'command', command: BRIEF_HOOK_COMMAND, timeout: 10 }],
  });
  settings.hooks.UserPromptSubmit = list;
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { path: file, action: 'created' };
}

// Registers the PostToolUse hook that checks Korean prose the session just
// wrote. Session-start guidance teaches the model but is never re-read, so
// files written later drift back to the patterns the guidance forbids and the
// drift surfaces only when a human reads the artifact. This hook closes that
// gap: it runs on the file the model just wrote, while it can still fix it.
// Installed by `korean on`, removed by `korean off`. Idempotent.
const KOREAN_LINT_HOOK_COMMAND = 'claude-token-saver korean --hook';

export function installKoreanLintHook() {
  const dir = claudeUserDir();
  const file = join(dir, 'settings.json');
  mkdirSync(dir, { recursive: true });

  let settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      return { path: file, action: 'skipped', reason: `unreadable JSON (${e.message})` };
    }
  }

  settings.hooks = settings.hooks || {};
  if (settings.hooks.PostToolUse !== undefined && !Array.isArray(settings.hooks.PostToolUse)) {
    return { path: file, action: 'skipped', reason: 'hooks.PostToolUse is not an array — fix settings.json manually' };
  }
  const list = Array.isArray(settings.hooks.PostToolUse) ? settings.hooks.PostToolUse : [];
  const already = list.some((m) =>
    Array.isArray(m?.hooks) && m.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('korean --hook')),
  );
  if (already) return { path: file, action: 'exists' };

  list.push({
    matcher: 'Write|Edit|MultiEdit',
    hooks: [{ type: 'command', command: KOREAN_LINT_HOOK_COMMAND, timeout: 10 }],
  });
  settings.hooks.PostToolUse = list;
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { path: file, action: 'created' };
}

export function removeKoreanLintHook() {
  const file = join(claudeUserDir(), 'settings.json');
  if (!existsSync(file)) return { path: file, action: 'absent' };
  let settings;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { path: file, action: 'skipped', reason: `unreadable JSON (${e.message})` };
  }
  const list = settings?.hooks?.PostToolUse;
  if (!Array.isArray(list)) return { path: file, action: 'absent' };
  const kept = list.filter((m) =>
    !(Array.isArray(m?.hooks) && m.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('korean --hook'))),
  );
  if (kept.length === list.length) return { path: file, action: 'absent' };
  if (kept.length === 0) delete settings.hooks.PostToolUse;
  else settings.hooks.PostToolUse = kept;
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { path: file, action: 'removed' };
}

// Registers the PreToolUse hook that converts attached documents to Markdown
// before the model reads them. PreToolUse rather than PostToolUse because the
// point is to intervene before a pptx lands in the context window; afterwards
// the tokens are already spent.
//
// No `timeout` is set, on purpose. Claude Code defaults command hooks to ten
// minutes, so naming a number here could only lower that ceiling, and a cold
// `import markitdown` measured at twelve seconds by itself, with a very large
// workbook adding a minute on top. The row cap inside the converter is what
// actually bounds the work; the timeout is only a backstop.
// Installed by `doc2md on`, removed by `doc2md off`. Idempotent.
const DOC2MD_HOOK_COMMAND = 'claude-token-saver doc2md --hook';
const DOC2MD_PROMPT_HOOK_COMMAND = 'claude-token-saver doc2md --hook-prompt';

export function installDoc2mdHook() {
  const dir = claudeUserDir();
  const file = join(dir, 'settings.json');
  mkdirSync(dir, { recursive: true });

  let settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      return { path: file, action: 'skipped', reason: `unreadable JSON (${e.message})` };
    }
  }

  settings.hooks = settings.hooks || {};
  if (settings.hooks.PreToolUse !== undefined && !Array.isArray(settings.hooks.PreToolUse)) {
    return { path: file, action: 'skipped', reason: 'hooks.PreToolUse is not an array — fix settings.json manually' };
  }
  // Each event is checked on its own. Returning early on "the Read hook is
  // already there" would leave anyone upgrading from 3.26.x with the half that
  // cannot see pptx and without the half that can — which is exactly what
  // happened on the first machine to try it.
  const list = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
  const hasReadHook = list.some((m) =>
    Array.isArray(m?.hooks) && m.hooks.some((h) => typeof h?.command === 'string' && /doc2md --hook(?!-)/.test(h.command)),
  );
  if (!hasReadHook) {
    list.push({
      matcher: 'Read',
      hooks: [{ type: 'command', command: DOC2MD_HOOK_COMMAND }],
    });
    settings.hooks.PreToolUse = list;
  }

  // The Read hook alone covers only PDFs. Claude Code refuses pptx/xlsx/docx
  // as binary before any PreToolUse hook runs, so for exactly the formats this
  // feature exists for, the tool call is dead before doc2md is consulted.
  // UserPromptSubmit runs earlier and sees the raw prompt text, which is where
  // a path the user typed can still be turned into Markdown.
  let addedPrompt = false;
  if (settings.hooks.UserPromptSubmit === undefined || Array.isArray(settings.hooks.UserPromptSubmit)) {
    const prompts = Array.isArray(settings.hooks.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];
    const hasPromptHook = prompts.some((m) =>
      Array.isArray(m?.hooks) && m.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('doc2md --hook-prompt')),
    );
    if (!hasPromptHook) {
      prompts.push({ hooks: [{ type: 'command', command: DOC2MD_PROMPT_HOOK_COMMAND }] });
      settings.hooks.UserPromptSubmit = prompts;
      addedPrompt = true;
    }
  }

  if (!hasReadHook || addedPrompt) {
    writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
    return { path: file, action: hasReadHook ? 'updated' : 'created' };
  }
  return { path: file, action: 'exists' };
}

export function removeDoc2mdHook() {
  const file = join(claudeUserDir(), 'settings.json');
  if (!existsSync(file)) return { path: file, action: 'absent' };
  let settings;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { path: file, action: 'skipped', reason: `unreadable JSON (${e.message})` };
  }
  // Both entries go, and only this tool's own: anything else registered under
  // either event stays exactly where the user put it. The substring covers
  // `--hook` and `--hook-prompt` alike.
  let touched = false;
  for (const event of ['PreToolUse', 'UserPromptSubmit']) {
    const list = settings?.hooks?.[event];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((m) =>
      !(Array.isArray(m?.hooks) && m.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('doc2md --hook'))),
    );
    if (kept.length === list.length) continue;
    touched = true;
    if (kept.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = kept;
  }
  if (!touched) return { path: file, action: 'absent' };
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { path: file, action: 'removed' };
}

export function installAll({ force = false } = {}) {
  return {
    skill: installSkill({ force }),
    statusline: installStatusline({ force }),
    sessionStartHook: installSessionStartHook(),
    briefHook: installBriefHook(),
    legacy: removeLegacyCommand(),
  };
}
