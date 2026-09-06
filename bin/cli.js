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
 *   npx claude-token-saver route-scan         # detect recurring easy work → haiku-delegation candidates
 *   npx claude-token-saver install            # set up skill/hooks/statusline; asks about harness + Korean guidance
 *   npx claude-token-saver install --yes      # take the defaults without asking (same as --no-input)
 *   npx claude-token-saver --install-hook     # install PostToolUse hook
 *   npx claude-token-saver --uninstall-hook   # remove hook
 *   npx claude-token-saver --hook-run         # internal: called by hook
 *   npx claude-token-saver --statusline       # one-line output for Claude Code statusline API
 *   npx claude-token-saver --statusline --verbose  # longer labels
 *   npx claude-token-saver --statusline --no-color # strip ANSI colors
 *   npx claude-token-saver --statusline --icon     # use 🧠 ⏳ 💰 icons
 *   npx claude-token-saver --statusline --no-timer # hide the TTL countdown
 *   npx claude-token-saver --statusline --single-line # legacy 1-line layout (no routing-totals headline)
 *   npx claude-token-saver --statusline --exclude-session <path>
 *                                               # exclude a JSONL path from lastActivity
 *                                               # (or set CACHE_MONITOR_EXCLUDE_SESSION env var)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';

import {
  readStdinJson,
  extractCaps,
  extractContextUsage,
  extractModel,
} from '../src/stdin-payload.js';

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
import { debug } from '../src/debug.js';
import { createArgs } from '../src/cli-args.js';
import { updateStatus, maybeSpawnUpdateCheck } from '../src/update-check.js';

const args = process.argv.slice(2);

const PKG_VERSION = (() => {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version || '';
  } catch {
    return '';
  }
})();

const { getArg, hasFlag, numArg } = createArgs(args);

/**
 * Version/update state for the statusline chip. Reads a cache file and, when
 * that cache has aged past the check interval, kicks a detached child to
 * refresh it for a later render. Never awaits the network, never throws into
 * the render: a registry outage must not cost the statusline its other chips.
 */
function readUpdateChip() {
  try {
    maybeSpawnUpdateCheck(PKG_VERSION);
    return updateStatus(PKG_VERSION);
  } catch (e) {
    debug('update-check:chip', e);
    return null;
  }
}

// Subcommands this build knows how to run. Used only by the guard below.
const KNOWN_SUBCOMMANDS = new Set([
  'last', 'brief', 'history', 'handoff', 'install', 'uninstall', 'mode', 'korean',
  'doc2md', 'harness', 'route-scan', 'compact-window', 'update-check', 'upgrade',
]);

async function main() {
  // A hook invocation names a subcommand and expects either silence or that
  // subcommand's own protocol on stdout. If this build does not have the
  // subcommand — an older global install against a newer settings.json, which
  // is exactly what a mid-upgrade machine looks like — falling through to the
  // default report would push a full table into the hook stream on every
  // matching tool call. Say nothing instead.
  if (hasFlag('--hook') && args[0] && !KNOWN_SUBCOMMANDS.has(args[0])) {
    return;
  }

  // Subcommand: last — print the most recent warning + how to handle it.
  // Designed for the auto-trigger skill so the user immediately sees
  // "what just fired and how to fix it" without having to read the whole
  // history file.
  //   claude-token-saver last           # search last 1 day
  //   claude-token-saver last --days 7  # widen the lookback
  if (args[0] === 'last') {
    return (await import('../src/commands/last.js')).run({ numArg });
  }

  // Subcommand: history — print recent warning transitions captured by the
  // statusline. One markdown file per day, persisted under the platform-
  // specific user-data dir.
  //   claude-token-saver history              # last 7 days
  //   claude-token-saver history --days 30    # custom window
  //   claude-token-saver history --list       # just list available dates
  if (args[0] === 'history') {
    return (await import('../src/commands/history.js')).run({ hasFlag, numArg });
  }

  // Subcommand: handoff — write a HANDOFF-YYYY-MM-DD-HHMM.md template in cwd
  // capturing git status + the latest cap snapshot, so a fresh Claude Code
  // session can pick up where this one stopped. Pairs with the cap-warn chip:
  // when statusline shows 🚨 5H 90%+, run this to back up state before the cap
  // hits.
  //   claude-token-saver handoff             # write to cwd
  //   claude-token-saver handoff --cwd PATH  # custom directory
  if (args[0] === 'handoff') {
    return (await import('../src/commands/handoff.js')).run({ getArg });
  }

  // Subcommand: install — write the Claude Code auto-trigger skill so the
  // user can just mention chip wording and Claude responds. v2.6.0 dropped
  // the redundant /token-monitor slash command in favor of the skill alone;
  // a legacy command file is removed automatically. Cross-platform.
  //   claude-token-saver install              # install/update the skill
  //   claude-token-saver install --force      # overwrite existing skill file
  if (args[0] === 'install') {
    return (await import('../src/commands/install.js')).run({ hasFlag });
  }

  // The counterpart to `install`. It was in the known-subcommand list from the
  // start but had no dispatch, so it fell through to the usage report and
  // exited non-zero — an unhelpful answer to "remove this".
  if (args[0] === 'uninstall') {
    return (await import('../src/commands/uninstall.js')).run({ hasFlag, args });
  }

  // Subcommand: mode — persist statusline preferences so future runs pick
  // them up without flags or wrapper edits.
  //   claude-token-saver mode                    # show current config
  //   claude-token-saver mode icon verbose       # set icon + verbose
  //   claude-token-saver mode reset              # clear back to defaults
  if (args[0] === 'mode') {
    return (await import('../src/commands/mode.js')).run({ args });
  }

  // Subcommand: route-scan — detect recurring easy work on expensive models
  // and propose model-delegation ratchet rules. Zero token cost, fully local.
  //   claude-token-saver route-scan                 # scan (24h cache) + print candidates
  //   claude-token-saver route-scan --refresh       # force rescan
  //   claude-token-saver route-scan --days 30       # wider lookback
  //   claude-token-saver route-scan --hook          # SessionStart hook mode (context injection)
  //   claude-token-saver route-scan dismiss <N>     # mute candidate R<N>
  // Promote a candidate to a ratchet rule (scope is always explicit):
  //   claude-token-saver harness promote R<N> --project|--global
  // brief --hook — UserPromptSubmit hook mode: per-session, change-triggered
  // briefing of state the statusline can only chip (ctx tier crossings,
  // mid-session route/rule-health changes). Silent when nothing changed.
  if (args[0] === 'brief') {
    return (await import('../src/commands/brief.js')).run({ hasFlag });
  }

  if (args[0] === 'route-scan') {
    return (await import('../src/commands/route-scan.js')).run({ args, hasFlag, numArg });
  }

  // Subcommand: korean — Korean writing guidance injected at session start,
  // so the rules apply in every project without an output-style switch.
  //   claude-token-saver korean on | off | status | show
  if (args[0] === 'korean') {
    return (await import('../src/commands/korean.js')).run({ args, hasFlag });
  }

  // Subcommand: doc2md — convert pptx/xlsx/pdf/docx to Markdown before the
  // model reads them, so an unreadable binary never enters the context window.
  //   claude-token-saver doc2md on | off | <file> | --clean
  if (args[0] === 'doc2md') {
    return (await import('../src/commands/doc2md.js')).run({ args, hasFlag });
  }

  // Subcommand: harness — manage the project's CLAUDE.md harness rules.
  //   claude-token-saver harness init       # write CLAUDE.md (5 sections) + ratchet.md
  //   claude-token-saver harness uninit     # remove harness block from CLAUDE.md (backup kept)
  //   claude-token-saver harness check      # show 🅷 N/5 + which sections are missing
  //   claude-token-saver harness promote "<rule>"  # append a rule to ratchet.md
  //   claude-token-saver harness pull [--global|--project]  # register the package's curated preset rules (default global)
  //   claude-token-saver harness off | on   # toggle the statusline 🅷 segment
  if (args[0] === 'harness') {
    return (await import('../src/commands/harness.js')).run({ args, hasFlag });
  }

  // Subcommand: compact-window — audit / pin Claude Code's autoCompactWindow.
  // On a 1M-context model, compaction only fires near 800k unless the window is
  // capped; 200k sessions are exempt.
  //   claude-token-saver compact-window                  # status
  //   claude-token-saver compact-window set --global     # pin 200k (~/.claude/settings.json)
  //   claude-token-saver compact-window set --project    # pin 200k (<root>/.claude/settings.json)
  //   claude-token-saver compact-window off | on         # toggle the statusline warning
  if (args[0] === 'compact-window') {
    return (await import('../src/commands/compact-window.js')).run({ args, hasFlag });
  }

  // `--version` / `-v` — the flag every CLI is expected to answer. Until now
  // the version was only visible in the table view's footer, which meant
  // "which version am I on" required running a full report.
  if (hasFlag('--version') || hasFlag('-v')) {
    console.log(PKG_VERSION);
    return;
  }

  // Subcommand: update-check — the registry lookup behind the ⬆ statusline
  // chip and the session-start upgrade offer.
  //   claude-token-saver update-check              # print cached status
  //   claude-token-saver update-check --refresh    # hit the registry now (detached child uses this)
  //   claude-token-saver update-check --dismiss    # stop offering THIS version at session start
  if (args[0] === 'update-check') {
    return (await import('../src/commands/update-check.js')).run({
      hasFlag,
      version: PKG_VERSION,
    });
  }

  // Subcommand: upgrade — run the install command that matches how this copy
  // got here, then confirm the new version.
  //   claude-token-saver upgrade          # install the latest release
  //   claude-token-saver upgrade --print  # just show the command, run nothing
  if (args[0] === 'upgrade') {
    return (await import('../src/commands/upgrade.js')).run({
      hasFlag,
      version: PKG_VERSION,
    });
  }

  // Hook management
  if (hasFlag('--install-hook')) {
    const { installHook } = await import('../src/hook-manager.js');
    const threshold = numArg('--threshold', { dflt: 0.7, min: 0, max: 1 });
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
    const cycleSeconds = numArg('--demo-cycle-sec', { dflt: 3, min: 0.1 });
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
      singleLine: hasFlag('--single-line'),
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
  const hoursArg = numArg('--hours', { min: 0 });
  const daysArg = numArg('--days', { min: 0 }) ?? numArg('-d', { min: 0 });
  if (hoursArg !== undefined) {
    windowHours = hoursArg;
    windowLabel = `${windowHours}h`;
  } else if (daysArg !== undefined) {
    windowHours = daysArg * 24;
    windowLabel = `${daysArg}d`;
  }
  const days = windowHours / 24;
  const format = isStatusline ? 'statusline' : (getArg('--format') || getArg('-f') || 'table');
  const projectFilter = getArg('--project') || getArg('-p');

  if (format === 'table') {
    process.stderr.write('Scanning session files...\n');
  }

  // The current Claude Code session is only excluded from the lastActivity
  // timer (so the agent's own tool calls don't reset the countdown). It MUST
  // still feed ttlBreakdown — otherwise when the user's only recent traffic
  // lives in the current session, the bucket signal collapses to empty and
  // the statusline falsely flips to the 5m default. (See issue: Max users
  // seeing "Cache expires 5:00" on idle even though their plan is 1h.)
  const excludeSessionPath =
    getArg('--exclude-session') || process.env.CACHE_MONITOR_EXCLUDE_SESSION || undefined;

  const sessions = await parseAllSessions({ days, projectFilter });

  if (sessions.length === 0) {
    // Statusline must always emit a single line (no multi-line help spam every
    // 300ms) — but the stdin payload (rate limits, model) is still live even
    // with an empty analysis window (e.g. `mode 1h` + idle), and cap-warn /
    // harness are exactly the signals that must not vanish then.
    if (format === 'statusline') {
      const { formatNoSession } = await import('../src/formatters/statusline.js');
      const { statuslineDefaults } = await import('../src/config.js');
      const cfg = statuslineDefaults();
      const colorOk = !hasFlag('--no-color') && !process.env.NO_COLOR && cfg.color;
      const isIcon = hasFlag('--icon')
        ? true
        : (hasFlag('--no-icon') || hasFlag('--text') ? false : cfg.icon);
      const stdinJson = readStdinJson();
      const caps = extractCaps(stdinJson);
      const model = extractModel(stdinJson);
      if (caps || model) {
        try {
          const { persistSnapshot } = await import('../src/caps-cache.js');
          persistSnapshot({ caps, model });
        } catch (e) { debug('caps-cache:persist', e); }
      }
      console.log(formatNoSession(
        { caps, model, windowLabel, version: PKG_VERSION, update: readUpdateChip() },
        { color: colorOk, mode: isIcon ? 'icon' : 'text' },
      ));
      return;
    }
    // JSON mode stays JSON. A caller that asked for machine-readable output
    // and got a paragraph of advice has to parse prose to find out nothing
    // was found, which is exactly the failure this format exists to avoid.
    if (getArg('--format') === 'json') {
      console.log(JSON.stringify({
        sessions: 0,
        days,
        error: 'no-session-data',
        message: 'No Claude Code session logs found for the given period.',
      }, null, 2));
      process.exit(1);
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
  const ctxLive = extractContextUsage(stdinJson);
  if (isStatusline && (caps || model)) {
    try {
      const { persistSnapshot } = await import('../src/caps-cache.js');
      persistSnapshot({ caps, model });
    } catch (e) {
      debug('caps-cache:persist', e);
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
    } catch (e) {
      debug('caps-cache:load', e);
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
      chipDetail = `Single-request context exceeded 200k (max ${Math.round(contextWindow.maxContext / 1000)}k tokens)`;
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
    } catch (e) {
      debug('history:record', e); // never let history break the statusline render
    }
  }

  // Last API activity feeds the statusline TTL countdown.
  // For every session OTHER than the excluded (current) one, take the full
  // endTime (any API call keeps the prefix cache warm — it doesn't matter
  // whether it's user- or agent-driven because the cache is shared across
  // sessions by prefix content). The current session is filtered here rather
  // than at the parser, so its writes still inform ttlBreakdown above.
  const excludeAbs = excludeSessionPath
    ? (isAbsolute(excludeSessionPath) ? excludeSessionPath : join(process.cwd(), excludeSessionPath))
    : null;
  const otherLastActivity = sessions
    .filter((s) => !excludeAbs || s.filePath !== excludeAbs)
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
    } catch (e) {
      debug('parser:last-user-message', e); // keep 0 so it doesn't raise the max
    }
  }
  const lastActivity = Math.max(otherLastActivity, currentSessionLastUser);

  // What delegation has measurably saved, read straight from the registry
  // route-scan maintains. A lookup, never a scan: the statusline re-renders
  // every few seconds and a scan parses tens of MB of transcripts.
  let delegationSaved = 0;
  try {
    const { delegationSavedUsd } = await import('../src/model-rules.js');
    delegationSaved = delegationSavedUsd();
  } catch (e) {
    debug('model-rules:saved', e); // an unreadable registry just hides the chip
  }
  // Rolling week/month/lifetime totals from the delegation ledger — the
  // statusline's headline line. Falls back to null (chip hidden) on any error.
  let delegationTotals = null;
  try {
    const { delegationSavedTotals } = await import('../src/savings-ledger.js');
    delegationTotals = delegationSavedTotals();
  } catch (e) {
    debug('savings-ledger:totals', e);
  }
  // Document conversions, same shape as the delegation totals: a lifetime sum
  // plus a document count. A lookup of a small JSON file, never a scan.
  let doc2mdTotals = null;
  try {
    const { doc2mdSavedTotals } = await import('../src/doc2md-ledger.cjs');
    const { userDataDir } = await import('../src/paths.js');
    doc2mdTotals = doc2mdSavedTotals(userDataDir());
  } catch (e) {
    debug('doc2md-ledger:totals', e);
  }
  // Delegated runs route-scan had to throw away because their model id could
  // not be priced. Also a lookup of the cached scan, never a scan. Without it
  // the statusline shows the same blank for "no delegation happened" and for
  // "delegation happened and was silently discarded".
  let unresolvedRuns = 0;
  try {
    const { readRouteScan } = await import('../src/route-scan.js');
    unresolvedRuns = Number(readRouteScan()?.unresolvedRuns) || 0;
  } catch (e) {
    debug('route-scan:unresolved', e);
  }
  // 'auto' unless the user pinned a bucket. Read here rather than in the
  // statusline branch below because the table and JSON formatters want the
  // same answer.
  let ttlBucket = 'auto';
  try {
    const { statuslineDefaults } = await import('../src/config.js');
    ttlBucket = statuslineDefaults().ttlBucket;
  } catch (e) {
    debug('config:ttlBucket', e);
  }

  const data = {
    summary: sum,
    trend,
    ttl,
    anomalies,
    cost,
    options: { days, windowHours, windowLabel, version: PKG_VERSION },
    // Cached-only; the background refresh it may trigger lands on a later render.
    update: format === 'statusline' ? readUpdateChip() : null,
    lastActivity,
    spikeReport,
    contextWindow,
    ctxLive,
    spikeChip,
    caps,
    model,
    delegationSaved,
    delegationTotals,
    doc2mdTotals,
    unresolvedRuns,
    ttlBucket,
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
      // macOS builds of Claude Code have rendered only the first line of a
      // multi-line statusline in some versions (anthropics/claude-code#35176)
      // — --single-line restores the legacy one-line layout in that case.
      singleLine: hasFlag('--single-line'),
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
    // Still exactly one line, but name the problem — a bad flag in a
    // statusline wrapper is otherwise invisible ("🧠 error" for a typo the
    // user cannot see the source of). Collapse newlines and cap the length.
    const msg = String(err?.message || 'error').split('\n')[0].slice(0, 80);
    console.log(`${red}🧠 ${msg}${reset}`);
    process.exit(0);
  }
  console.error('Error:', err.message);
  process.exit(1);
});
