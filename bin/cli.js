#!/usr/bin/env node

/**
 * claude-token-saver CLI (formerly claude-cache-monitor)
 *
 * Usage:
 *   npx claude-token-saver                    # default report (last 30 days)
 *   npx claude-token-saver --days 7           # last 7 days
 *   npx claude-token-saver --format json      # JSON output
 *   npx claude-token-saver --format csv       # CSV output
 *   npx claude-token-saver --project myproj   # filter by project
 *   npx claude-token-saver --install-hook     # install PostToolUse hook
 *   npx claude-token-saver --uninstall-hook   # remove hook
 *   npx claude-token-saver --hook-run         # internal: called by hook
 *   npx claude-token-saver --statusline       # one-line output for Claude Code statusline API
 *   npx claude-token-saver --statusline --verbose  # longer labels
 *   npx claude-token-saver --statusline --no-color # strip ANSI colors
 *   npx claude-token-saver --statusline --icon     # use 🧠 ⏳ 💰 icons
 *   npx claude-token-saver --statusline --no-timer # hide the TTL countdown
 *   npx claude-token-saver --statusline --exclude-session <path>
 *                                               # exclude a JSONL path from lastActivity
 *                                               # (or set CACHE_MONITOR_EXCLUDE_SESSION env var)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Read the JSON blob Claude Code feeds the statusline command on stdin.
 * Returns null when stdin is a TTY or empty (e.g. user invokes `--statusline`
 * by hand) so callers can fall back to flag/env config.
 *
 * The blob shape (subset we consume):
 *   {
 *     "transcript_path": "...",
 *     "rate_limits": {
 *       "five_hour":  { "used_percentage": 94, "resets_at": 1777099200 },
 *       "seven_day":  { "used_percentage": 7,  "resets_at": 1777521600 }
 *     }
 *   }
 *
 * extractCaps treats `rate_limits` as a generic object so any future window
 * Anthropic adds (e.g. a Sonnet-only weekly bucket) flows through without code
 * changes — known keys get curated labels, unknowns get derived ones.
 */
function readStdinJson() {
  if (process.stdin.isTTY) return null;
  try {
    const raw = readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractCaps(stdinJson) {
  if (!stdinJson || !stdinJson.rate_limits || typeof stdinJson.rate_limits !== 'object') return null;
  const windows = [];
  for (const [key, value] of Object.entries(stdinJson.rate_limits)) {
    if (!value || typeof value !== 'object') continue;
    const usedPct = Number(value.used_percentage);
    if (!Number.isFinite(usedPct)) continue;
    const resetsAt = Number(value.resets_at);
    windows.push({
      key,
      usedPct,
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    });
  }
  return windows.length ? { windows } : null;
}

/**
 * Pull the human-friendly model name out of Claude Code's stdin payload.
 * `model.display_name` is the contract; fall back to `model.id` when it's
 * absent. Returns null when nothing usable is in the JSON.
 */
// Bedrock/litellm proxies pass model IDs like
//   global.anthropic.claude-opus-4-7-20251001-v1:0
//   anthropic.claude-sonnet-4-6-20250930-v1:0
//   bedrock/anthropic.claude-haiku-4-5
// while Claude Code's `display_name` collapses these to a generic family
// label ("Opus 4", "Sonnet 4") that hides the actual minor version. Pull the
// version out of the id when we can spot it so the statusline shows the real
// model in use (Opus 4.7 vs 4.6 matters a lot for token budgeting).
function bedrockDisplayFromId(id) {
  if (typeof id !== 'string') return null;
  const m = id.match(/claude[-_](opus|sonnet|haiku)[-_](\d+)[-_](\d+)/i);
  if (!m) return null;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return `${family} ${m[2]}.${m[3]}`;
}

function extractModel(stdinJson) {
  if (!stdinJson || !stdinJson.model) return null;
  const m = stdinJson.model;
  if (typeof m === 'string') return bedrockDisplayFromId(m) || m;
  // Prefer the id when it carries a precise version (e.g. Bedrock IDs); fall
  // back to display_name for the standard Claude Code path where display_name
  // already says "Claude Opus 4.7".
  const idDerived = bedrockDisplayFromId(m.id);
  if (idDerived) return idDerived;
  if (typeof m.display_name === 'string' && m.display_name) return m.display_name;
  if (typeof m.id === 'string' && m.id) return m.id;
  return null;
}

import { parseAllSessions, getLastUserMessageTime } from '../src/parser.js';
import {
  dailyTrend,
  ttlBreakdown,
  detectAnomalies,
  summary,
  detectSpikes,
  detectContextWindow,
  sessionMetrics,
  diagnoseSession,
} from '../src/stats.js';
import { estimateCost } from '../src/cost.js';
import { chipForIssues } from '../src/advice.js';

const args = process.argv.slice(2);

const PKG_VERSION = (() => {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version || '';
  } catch {
    return '';
  }
})();

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx !== -1) return args[idx + 1];
  const prefix = `${name}=`;
  const eq = args.find((a) => a.startsWith(prefix));
  if (eq) return eq.slice(prefix.length);
  return undefined;
}

function hasFlag(name) {
  return args.includes(name);
}

/**
 * Scan recent history file contents (newest day first) and return the most
 * recent warning event — `{ time, chip, detail, codes, isCap, capLabel, capPct }`.
 * Returns null when no warning is found in the window.
 *
 * Recognized event lines (from history.js appendDayLine output):
 *   - HH:MM:SS ⚠ Cache miss — session abc1: LOW_HIT_RATE
 *   - HH:MM:SS ⚠ A → ⚠ B — detail
 *   - HH:MM:SS 🚨 5H 94% cap warning (resets in ...)
 *   - HH:MM:SS ✓ resolved (was ...)        ← skip
 *   - HH:MM:SS ✓ 5H cap warning resolved   ← skip
 *   - HH:MM:SS 📝 handoff written: ...     ← skip
 */
function findLatestWarning(historyEntries, chipToCodes) {
  const warnings = [];
  for (const { date, content } of historyEntries) {
    const lines = content.split('\n');
    for (const line of lines) {
      // Skip non-event lines
      const m = line.match(/^- (\d{2}:\d{2}:\d{2})\s+(.+)$/);
      if (!m) continue;
      const time = m[1];
      const rest = m[2];
      // Skip resolutions and handoff entries
      if (rest.startsWith('✓ ') || rest.startsWith('📝 ')) continue;
      // Cap-warn line: `🚨 5H 94% cap warning (...)`
      const cap = rest.match(/^🚨\s+(\S+)\s+(\d+)%\s+cap warning(?:\s*\((.+)\))?$/);
      if (cap) {
        warnings.push({
          date,
          time,
          chip: `🚨 ${cap[1]} ${cap[2]}%`,
          isCap: true,
          capLabel: cap[1],
          capPct: parseInt(cap[2], 10),
          capReset: cap[3] || null,
          codes: [],
          detail: null,
        });
        continue;
      }
      // Chip line — last token after the chip is `— detail` (optional). The
      // chip itself can be a plain `⚠ X` or a `⚠ A → ⚠ B` transition; we want
      // the *current* chip (right side of the arrow if present).
      const arrowMatch = rest.match(/^(.+?)\s+→\s+(.+?)(?:\s+—\s+(.+))?$/);
      let chip;
      let detail = null;
      if (arrowMatch) {
        chip = arrowMatch[2].trim();
        detail = arrowMatch[3] || null;
      } else {
        const plain = rest.match(/^(\S+(?:\s+\S+)*?)(?:\s+—\s+(.+))?$/);
        if (!plain) continue;
        chip = plain[1].trim();
        detail = plain[2] || null;
      }
      // Resolve codes: detail "session ID: A, B" → codes; else CHIP_TO_CODES.
      const codes = [];
      if (detail) {
        const dm = detail.match(/^session [^:]+:\s*(.+)$/);
        if (dm) {
          for (const c of dm[1].split(',').map((s) => s.trim()).filter(Boolean)) {
            if (!codes.includes(c)) codes.push(c);
          }
        }
      }
      if (chipToCodes[chip]) {
        for (const c of chipToCodes[chip]) if (!codes.includes(c)) codes.push(c);
      }
      warnings.push({ date, time, chip, isCap: false, codes, detail });
    }
  }
  return warnings.length ? warnings[warnings.length - 1] : null;
}

async function main() {
  // Subcommand: last — print the most recent warning + how to handle it.
  // Designed for the auto-trigger skill so the user immediately sees
  // "what just fired and how to fix it" without having to read the whole
  // history file.
  //   claude-token-saver last           # search last 1 day
  //   claude-token-saver last --days 7  # widen the lookback
  if (args[0] === 'last') {
    const { readRecent, historyDir } = await import('../src/history.js');
    const { ISSUE_MESSAGES, CHIP_TO_CODES, CAP_TIPS } = await import('../src/advice.js');
    const { userLanguage } = await import('../src/config.js');
    const lang = userLanguage();
    const days = parseFloat(getArg('--days') || '1');
    const recent = readRecent(days);
    const latest = findLatestWarning(recent, CHIP_TO_CODES);
    if (!latest) {
      console.log(`No warnings in the last ${days} day${days === 1 ? '' : 's'}.`);
      console.log(`(History dir: ${historyDir()})`);
      return;
    }
    // Header
    console.log(`Most recent warning — ${latest.date} ${latest.time}`);
    console.log(`  ${latest.chip}${latest.detail ? `  — ${latest.detail}` : ''}`);
    console.log('');
    // Cap-warn path: handoff is the recommendation. Print the bilingual tip
    // and a one-line "how to back up" pointer.
    if (latest.isCap) {
      if (latest.capReset) console.log(`  Cap window: ${latest.capReset}`);
      console.log('');
      console.log('💡 ' + (lang === 'ko' ? CAP_TIPS.ko : CAP_TIPS.en));
      console.log('');
      console.log(lang === 'ko' ? '실행:' : 'Run:');
      console.log('  claude-token-saver handoff');
      return;
    }
    // Chip warning path: render full ISSUE_MESSAGES advice for each code,
    // bilingual (English first, `└ Korean` continuation per line — matches
    // the history.md format).
    if (latest.codes.length === 0) {
      console.log(lang === 'ko'
        ? '(진단 코드 없음 — 표 뷰를 열어보세요: `claude-token-saver --days 1`)'
        : '(No diagnostic code attached — open the table view: `claude-token-saver --days 1`)');
      return;
    }
    // Pick a single language per field; fall back to EN when KO is missing.
    const pick = (en, ko) => (lang === 'ko' && ko ? ko : en);
    for (const code of latest.codes) {
      const msg = ISSUE_MESSAGES[code];
      if (!msg) {
        console.log(`Code: ${code} (no advice registered)`);
        continue;
      }
      console.log(`▎ ${pick(msg.title, msg.titleKo)}`);
      console.log(`  ${pick(msg.explain, msg.explainKo)}`);
      const actions = typeof msg.actions === 'function' ? msg.actions() : msg.actions || [];
      for (const a of actions) {
        console.log('');
        console.log(`  ${pick(a.label, a.labelKo)}:`);
        const cmds = a.commands || [];
        const cmdsKo = a.commandsKo || [];
        for (let i = 0; i < cmds.length; i++) {
          console.log(`    - ${pick(cmds[i], cmdsKo[i])}`);
        }
      }
      console.log('');
    }
    return;
  }

  // Subcommand: history — print recent warning transitions captured by the
  // statusline. One markdown file per day, persisted under the platform-
  // specific user-data dir.
  //   claude-token-saver history              # last 7 days
  //   claude-token-saver history --days 30    # custom window
  //   claude-token-saver history --list       # just list available dates
  if (args[0] === 'history') {
    const { readRecent, listDates, historyDir, formatHistoryForLanguage } =
      await import('../src/history.js');
    const { userLanguage } = await import('../src/config.js');
    const lang = userLanguage();
    if (hasFlag('--list')) {
      const dates = listDates();
      if (dates.length === 0) {
        console.log(`No history yet. Files will appear under: ${historyDir()}`);
        return;
      }
      console.log(`History (${historyDir()}):`);
      for (const d of dates) console.log(`  ${d}`);
      return;
    }
    const days = parseFloat(getArg('--days') || '7');
    const recent = readRecent(days);
    if (recent.length === 0) {
      console.log(`No warning history in the last ${days} day${days === 1 ? '' : 's'}.`);
      console.log(`(Files would be written to: ${historyDir()})`);
      return;
    }
    for (const { content } of recent) {
      const filtered = formatHistoryForLanguage(content, lang);
      console.log(filtered.replace(/\n+$/, ''));
      console.log('');
    }
    return;
  }

  // Subcommand: handoff — write a HANDOFF-YYYY-MM-DD-HHMM.md template in cwd
  // capturing git status + the latest cap snapshot, so a fresh Claude Code
  // session can pick up where this one stopped. Pairs with the cap-warn chip:
  // when statusline shows 🚨 5H 90%+, run this to back up state before the cap
  // hits.
  //   claude-token-saver handoff             # write to cwd
  //   claude-token-saver handoff --cwd PATH  # custom directory
  if (args[0] === 'handoff') {
    const { writeHandoff } = await import('../src/handoff.js');
    const { recordHandoff } = await import('../src/history.js');
    const cwd = getArg('--cwd') || process.cwd();
    // Cap data only flows in via stdin (Claude Code statusline contract).
    // Direct CLI invocations won't have it — that's fine, the template will
    // note the gap.
    const stdinJson = readStdinJson();
    const caps = extractCaps(stdinJson);
    const { path, git } = writeHandoff({ cwd, caps });
    try { recordHandoff(path); } catch { /* non-critical */ }
    console.log(`Handoff written: ${path}`);
    if (git) {
      console.log(`  git: ${git.branch}${git.head ? ` @ ${git.head}` : ''}${git.status ? ' (dirty)' : ' (clean)'}`);
    }
    console.log('');
    console.log('Fill in the empty sections, then start a new Claude Code session with:');
    console.log('  Read the most recent HANDOFF-*.md in this directory and continue the work.');
    return;
  }

  // Subcommand: install — write the Claude Code auto-trigger skill so the
  // user can just mention chip wording and Claude responds. v2.6.0 dropped
  // the redundant /token-monitor slash command in favor of the skill alone;
  // a legacy command file is removed automatically. Cross-platform.
  //   claude-token-saver install              # install/update the skill
  //   claude-token-saver install --force      # overwrite existing skill file
  if (args[0] === 'install') {
    const { installAll } = await import('../src/installer.js');
    const force = hasFlag('--force');
    const print = (kind, r) => {
      const verb = r.action === 'exists' ? 'already exists' : r.action;
      console.log(`  ${kind}: ${r.path} (${verb})`);
    };
    const r = installAll({ force });
    print('skill', r.skill);
    {
      const s = r.statusline;
      const verb = s.action === 'exists' ? 'already configured (refreshInterval=5)'
        : s.action === 'skipped' ? `skipped — ${s.reason}`
        : s.reason ? `${s.action} — ${s.reason}`
        : s.action;
      console.log(`  statusline: ${s.path} (${verb})`);
    }
    if (r.legacy.action === 'removed') {
      print('legacy /token-monitor', r.legacy);
      console.log('  (consolidated into the skill — same workflow, triggered by intent)');
    }
    console.log('');
    console.log('Open Claude Code in any directory and just mention:');
    console.log('  "cache hit rate" / "1M context" / "5H cap" — the skill auto-activates.');
    if (!force) {
      console.log('');
      console.log('Tip: re-run with --force to overwrite the existing skill file.');
    }
    return;
  }

  // Subcommand: mode — persist statusline preferences so future runs pick
  // them up without flags or wrapper edits.
  //   claude-token-saver mode                    # show current config
  //   claude-token-saver mode icon verbose       # set icon + verbose
  //   claude-token-saver mode reset              # clear back to defaults
  if (args[0] === 'mode') {
    const { applyMode, loadConfig, configPath, statuslineDefaults, VALID_KEYWORDS } =
      await import('../src/config.js');
    const words = args.slice(1);
    if (words.length === 0) {
      const eff = statuslineDefaults();
      const raw = loadConfig().statusline || {};
      console.log('Statusline mode (effective):');
      console.log(`  icon:     ${eff.icon}`);
      console.log(`  verbose:  ${eff.verbose}`);
      console.log(`  timer:    ${eff.timer}`);
      console.log(`  color:    ${eff.color}`);
      console.log(`  language: ${eff.language}  (advice / history / last)`);
      console.log(`  window:   ${eff.windowLabel} (${eff.windowHours}h)`);
      console.log('');
      console.log(`Stored config (${configPath()}):`);
      console.log(`  ${Object.keys(raw).length === 0 ? '(none — using defaults)' : JSON.stringify(raw)}`);
      console.log('');
      console.log('Change with: claude-token-saver mode <keywords...>');
      console.log(`Keywords: ${VALID_KEYWORDS.join(', ')}`);
      return;
    }
    const { applied, unknown } = applyMode(words);
    if (unknown.length) {
      console.error(`Unknown keyword${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
      console.error(`Valid: ${VALID_KEYWORDS.join(', ')}`);
      process.exit(1);
    }
    const eff = statuslineDefaults();
    console.log(`Updated: ${applied.join(', ')}`);
    console.log(`Now: icon=${eff.icon} verbose=${eff.verbose} timer=${eff.timer} color=${eff.color} language=${eff.language} window=${eff.windowLabel}`);
    console.log('Statusline picks up the change on the next refresh (~1s).');
    return;
  }

  // Hook management
  if (hasFlag('--install-hook')) {
    const { installHook } = await import('../src/hook-manager.js');
    const threshold = parseFloat(getArg('--threshold') || '0.7');
    await installHook({ threshold });
    return;
  }

  if (hasFlag('--uninstall-hook')) {
    const { uninstallHook } = await import('../src/hook-manager.js');
    await uninstallHook();
    return;
  }

  // Hook internal execution
  if (hasFlag('--hook-run')) {
    await import('../src/hook.cjs');
    return;
  }

  // Statusline mode shortcut
  const isStatusline = hasFlag('--statusline') || getArg('--format') === 'statusline';

  // Demo mode — render synthetic warning-case data through the real
  // formatter for screencasts/marketing GIFs. `--demo cycle` rotates through
  // every scenario based on wall clock so a screen recorder picks them up.
  const demoArg = getArg('--demo');

  // `claude-token-saver --demo table` (no --statusline) — full table view
  // with all six issue drill-downs at once, for marketing screencasts.
  if (!isStatusline && demoArg === 'table') {
    const { buildTableDemoData } = await import('../src/demo.js');
    const { formatReport } = await import('../src/formatters/table.js');
    const data = buildTableDemoData({ version: PKG_VERSION });
    console.log(formatReport(data));
    return;
  }

  if (isStatusline && demoArg) {
    const { buildScenarioData, listScenarios } = await import('../src/demo.js');
    const { statuslineDefaults } = await import('../src/config.js');
    const cfg = statuslineDefaults();
    const cycleSeconds = parseFloat(getArg('--demo-cycle-sec') || '3');
    const data = buildScenarioData(demoArg, {
      cycleSeconds,
      windowHours: cfg.windowHours,
      windowLabel: cfg.windowLabel,
      days: cfg.windowHours / 24,
      version: PKG_VERSION,
    });
    if (!data) {
      const known = listScenarios().map((s) => s.name).concat(['cycle']).join(', ');
      console.error(`Unknown demo scenario: ${demoArg}`);
      console.error(`Valid: ${known}`);
      process.exit(1);
    }
    const { formatReport } = await import('../src/formatters/statusline.js');
    const isIcon = hasFlag('--icon')
      ? true
      : (hasFlag('--no-icon') || hasFlag('--text') ? false : cfg.icon);
    const isVerbose = hasFlag('--verbose')
      ? true
      : (hasFlag('--no-verbose') || hasFlag('--compact') ? false : cfg.verbose);
    const showTimer = hasFlag('--no-timer') ? false : cfg.timer;
    const colorOk = !hasFlag('--no-color') && !process.env.NO_COLOR && cfg.color;
    const segmentsArg = getArg('--segments');
    const segments = segmentsArg
      ? segmentsArg.split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    const out = formatReport(data, {
      color: colorOk,
      verbose: isVerbose,
      timer: showTimer,
      mode: isIcon ? 'icon' : 'text',
      segments,
    });
    // For `cycle` mode, prefix with the scenario label so the screen recorder
    // shows what the viewer is looking at (only when explicitly requested).
    if (demoArg === 'cycle' && hasFlag('--demo-label')) {
      const gray = colorOk ? '\x1b[90m' : '';
      const reset = colorOk ? '\x1b[0m' : '';
      console.log(`${gray}[${data._demoLabel}]${reset}  ${out}`);
    } else {
      console.log(out);
    }
    return;
  }

  // Report generation
  // Statusline window comes from persisted config — hours-precise so users
  // can pick `1h` / `6h` etc, not just whole days. Other formats default to
  // 30 days as before.
  let windowHours = 30 * 24;
  let windowLabel = '30d';
  if (isStatusline) {
    const { statuslineDefaults } = await import('../src/config.js');
    const d = statuslineDefaults();
    windowHours = d.windowHours;
    windowLabel = d.windowLabel;
  }
  // CLI overrides: --hours wins over --days; both win over config.
  const hoursArg = getArg('--hours');
  const daysArg = getArg('--days') || getArg('-d');
  if (hoursArg !== undefined) {
    windowHours = parseFloat(hoursArg);
    windowLabel = `${windowHours}h`;
  } else if (daysArg !== undefined) {
    windowHours = parseFloat(daysArg) * 24;
    windowLabel = `${parseFloat(daysArg)}d`;
  }
  const days = windowHours / 24;
  const format = isStatusline ? 'statusline' : (getArg('--format') || getArg('-f') || 'table');
  const projectFilter = getArg('--project') || getArg('-p');

  if (format === 'table') {
    process.stderr.write('Scanning session files...\n');
  }

  // Exclude the current Claude Code session when computing lastActivity —
  // otherwise the agent's own tool calls reset the countdown every few seconds.
  const excludeSessionPath =
    getArg('--exclude-session') || process.env.CACHE_MONITOR_EXCLUDE_SESSION || undefined;

  const sessions = await parseAllSessions({ days, projectFilter, excludeSessionPath });

  if (sessions.length === 0) {
    // Statusline must always emit a single line (no multi-line help spam every 300ms)
    if (format === 'statusline') {
      const colorOk = !hasFlag('--no-color') && !process.env.NO_COLOR;
      const gray = colorOk ? '\x1b[90m' : '';
      const reset = colorOk ? '\x1b[0m' : '';
      console.log(`${gray}🧠 no session data · ${days}d${reset}`);
      return;
    }
    console.log('No session data found for the given period.');
    console.log('');
    console.log('This tool analyzes Claude Code session logs (~/.claude/projects/).');
    console.log('');
    console.log('Possible causes:');
    console.log('  - You haven\'t used Claude Code in the last ' + days + ' days');
    console.log('  - You\'re using the Claude API directly (SDK/curl) without Claude Code');
    console.log('    → This tool requires Claude Code. API-only usage does not generate session logs.');
    console.log('  - Try increasing the period: --days 90');
    process.exit(1);
  }

  const trend = dailyTrend(sessions);
  const ttl = ttlBreakdown(sessions);
  const sum = summary(sessions);
  const anomalies = detectAnomalies(trend);
  const cost = estimateCost(sum, sessions[0]?.model);
  const spikeReport = detectSpikes(sessions, { recentHours: 24, multiplier: 3 });
  const contextWindow = detectContextWindow(sessions, { recentHours: 24 });

  // Claude Code feeds the statusline command a JSON blob on stdin every
  // refresh. Pull rate_limits + model out of it so we can surface cap-warn
  // (>=90%) chips, always-on usage segments, the model chip, record cap
  // transitions, and seed the table view's warning box. The table path falls
  // back to the most-recent cached snapshot so the table view (which
  // doesn't pipe stdin) still has the data.
  const stdinJson = readStdinJson();
  let caps = extractCaps(stdinJson);
  let model = extractModel(stdinJson);
  if (isStatusline && (caps || model)) {
    try {
      const { persistSnapshot } = await import('../src/caps-cache.js');
      persistSnapshot({ caps, model });
    } catch {
      // non-critical
    }
  }
  if (!isStatusline && (!caps || !model)) {
    try {
      const { loadRecentSnapshot } = await import('../src/caps-cache.js');
      const snap = loadRecentSnapshot();
      if (snap) {
        if (!caps && snap.caps) caps = snap.caps;
        if (!model && snap.model) model = snap.model;
      }
    } catch {
      // ignore
    }
  }

  // For statusline: attach a single-word chip only when there's something
  // actionable right now. 1M context is always shown; otherwise only fire
  // if the most recent session actually appears in the spike list.
  let spikeChip = null;
  let chipDetail = null;
  if (format === 'statusline') {
    if (contextWindow.size === '1M') {
      spikeChip = chipForIssues([], contextWindow);
      chipDetail = `Context auto-promoted to 1M (max single-request ${Math.round(contextWindow.maxContext / 1000)}k tokens)`;
    } else {
      const recentSession = sessions
        .slice()
        .sort((a, b) => (b.endTime?.getTime() || 0) - (a.endTime?.getTime() || 0))[0];
      const recentIsSpiking = recentSession && spikeReport.spikes.some(
        (sp) => sp.metrics.sessionId === recentSession.sessionId,
      );
      if (recentIsSpiking) {
        const m = sessionMetrics(recentSession);
        const issues = diagnoseSession(m, spikeReport.baseline);
        spikeChip = chipForIssues(issues, contextWindow);
        const titles = issues
          .map((i) => i.code)
          .slice(0, 2)
          .join(', ');
        chipDetail = `session ${recentSession.sessionId?.slice(0, 8) || ''}: ${titles}`;
      }
    }
    // Persist transitions to ~/.config/claude-token-saver/history/YYYY-MM-DD.md
    // so `claude-token-saver history` and the auto-skill can replay them.
    try {
      const { recordChip, recordCapTransition } = await import('../src/history.js');
      recordChip(spikeChip, { detail: chipDetail });
      // Cap-warn transitions are tracked independently per window — a session
      // can hit 90% on the 5h window even when no spike chip is firing.
      if (caps && Array.isArray(caps.windows)) {
        for (const win of caps.windows) recordCapTransition(win);
      }
    } catch {
      // history is non-critical — don't let it break the statusline render
    }
  }

  // Last API activity feeds the statusline TTL countdown.
  // For every session that wasn't excluded, take the full endTime (any API call
  // keeps the prefix cache warm — it doesn't matter whether it's user- or
  // agent-driven because the cache is shared across sessions by prefix content).
  const otherLastActivity = sessions
    .map((s) => (s.endTime ? s.endTime.getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  // For the excluded (current) session, only the user's prompts count — the
  // agent's tool calls would otherwise reset the countdown every few seconds
  // as long as Claude Code is streaming a response.
  let currentSessionLastUser = 0;
  if (excludeSessionPath) {
    try {
      const t = await getLastUserMessageTime(excludeSessionPath);
      if (t) currentSessionLastUser = t.getTime();
    } catch {
      // ignore — keep 0 so it doesn't raise the max
    }
  }
  const lastActivity = Math.max(otherLastActivity, currentSessionLastUser);

  const data = {
    summary: sum,
    trend,
    ttl,
    anomalies,
    cost,
    options: { days, windowHours, windowLabel, version: PKG_VERSION },
    lastActivity,
    spikeReport,
    contextWindow,
    spikeChip,
    caps,
    model,
  };

  let output;
  if (format === 'json') {
    const { formatReport } = await import('../src/formatters/json.js');
    output = formatReport(data);
  } else if (format === 'csv') {
    const { formatReport } = await import('../src/formatters/csv.js');
    output = formatReport(data);
  } else if (format === 'statusline') {
    const { formatReport } = await import('../src/formatters/statusline.js');
    const { statuslineDefaults } = await import('../src/config.js');
    const cfg = statuslineDefaults();

    // IntelliJ's Claude Code plugin renders the statusline through a custom
    // widget that fuses prior frames with the new one when emoji are present,
    // producing garbage like "59:548" that no ANSI escape can clean up
    // (verified: emitting the same output directly into JediTerm renders
    // cleanly, so the bug is in the plugin's render path, not the terminal).
    // Force text mode unconditionally inside IntelliJ — even past an explicit
    // `--icon` flag, since wrappers commonly hardcode `--icon` and the user
    // can't easily edit them; icon mode is just broken there.
    const isIntelliJ = process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm';
    // CLI flags take precedence; otherwise fall back to persisted config.
    const isIcon = isIntelliJ
      ? false
      : (hasFlag('--icon')
          ? true
          : (hasFlag('--no-icon') || hasFlag('--text') ? false : cfg.icon));
    const isVerbose = hasFlag('--verbose')
      ? true
      : (hasFlag('--no-verbose') || hasFlag('--compact') ? false : cfg.verbose);
    const showTimer = hasFlag('--no-timer') ? false : cfg.timer;
    const colorOk =
      !hasFlag('--no-color') && !process.env.NO_COLOR && cfg.color;

    const segmentsArg = getArg('--segments');
    const segments = segmentsArg
      ? segmentsArg.split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    output = formatReport(data, {
      color: colorOk,
      verbose: isVerbose,
      timer: showTimer,
      mode: isIcon ? 'icon' : 'text',
      segments,
    });
  } else {
    const { formatReport } = await import('../src/formatters/table.js');
    output = formatReport(data);
  }

  console.log(output);
}

main().catch((err) => {
  // Statusline mode must never spam multi-line errors (called every ~300ms)
  const isStatusline = process.argv.includes('--statusline') || process.argv.includes('statusline');
  if (isStatusline) {
    const colorOk = !process.argv.includes('--no-color') && !process.env.NO_COLOR;
    const red = colorOk ? '\x1b[31m' : '';
    const reset = colorOk ? '\x1b[0m' : '';
    console.log(`${red}🧠 error${reset}`);
    process.exit(0);
  }
  console.error('Error:', err.message);
  process.exit(1);
});
