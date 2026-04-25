/**
 * Installs the Claude Code integration assets:
 *   - Skill:  ~/.claude/skills/claude-token-saver/SKILL.md
 *   - Slash:  ~/.claude/commands/token-monitor.md
 *
 * All paths are resolved with node:path so Windows backslashes and POSIX
 * forward-slashes are both handled. Directories are created with
 * `mkdirSync(..., { recursive: true })` which is a no-op if they already
 * exist on every platform.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { claudeUserDir } from './paths.js';

const SKILL_BODY = `---
name: claude-token-saver
description: Use when the user mentions Claude Code token usage, prompt cache hit rate, TTL/expiry, the 1M context window, cache misses, output spikes, rate-limit caps (5h/7d), or anything in the statusline produced by claude-token-saver (chips like "🚨 5H 94%", "🚨 7D 92%", "⚠ 1M ON", "⚠ Input spike", "⚠ Cache miss", "⚠ 5m TTL", "⚠ Rebuild churn", "⚠ Output heavy", "⚠ Call surge", "⏳ Cache expires", "💰 Cache saved", "🧠 Cache hit"). Also use when they ask to view token-usage history, want to understand a warning they just saw, or want to back up work before a session cap with \`claude-token-saver handoff\`.
---

# claude-token-saver — Claude Code Token Monitor

This skill helps users interpret and act on the \`claude-token-saver\` statusline
in Claude Code. The statusline updates every ~1s and shows cache health, TTL
countdown, savings, and (when relevant) a leading warning chip.

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

const COMMAND_BODY = `---
description: Show recent claude-token-saver warning history and a fresh report.
---

You are responding to the \`/token-monitor\` slash command. The user wants a
quick read of their Claude Code token usage and any active warnings — most
importantly: **what just happened, and how do I handle it?**

Steps:

1. **Lead with the most recent warning.** Run \`claude-token-saver last\`
   first and surface its output verbatim (or lightly summarized) at the top
   of your reply. This returns the latest warning event (chip + detail +
   timestamp) followed by the full advice block. If \`last\` says no recent
   warnings, mention that and skip ahead — you can stop here unless the user
   asked for more.
2. Run \`claude-token-saver history --days 7\` and capture the output. Use it
   only to add context — e.g. "this is the 3rd cache miss today" — not to
   re-print the whole file. Each entry is bilingual and includes a \`💡\`
   action tip inline.
3. Run \`claude-token-saver --days 1\` and capture the output for any extra
   color you want to add: TTL breakdown, cost impact, daily trend, or active
   spikes. Skip if step 1 already covered what the user needs.
4. Summarize for the user:
   - **What just fired** — the chip + the time + a sentence on what caused it
     (from \`last\`).
   - **What to do** — the action tip from \`last\`. For cap-warn (\`🚨 5H/7D NN%\`),
     surface \`claude-token-saver handoff\` prominently so they can back up
     state before the cap blocks them.
   - **Today's pattern** (optional) — when warnings cluster in time, mention it.

Keep the summary to ~10 lines. The user can re-run the underlying commands
themselves for the full output.
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
  return writeIfNeeded(file, SKILL_BODY, force);
}

export function installCommand({ force = false } = {}) {
  const dir = join(claudeUserDir(), 'commands');
  const file = join(dir, 'token-monitor.md');
  mkdirSync(dir, { recursive: true });
  return writeIfNeeded(file, COMMAND_BODY, force);
}

export function installAll({ force = false } = {}) {
  return {
    skill: installSkill({ force }),
    command: installCommand({ force }),
  };
}
