import { createArgs } from '../cli-args.js';
import { configureCodexHooks } from '../codex-installer.js';
import { initCodexHarness, uninitCodexHarness, codexHarnessStatus } from '../codex-harness.js';
import { findProjectRoot, harnessPromote, harnessListRules, harnessRmRule, harnessPrune } from '../harness.js';
import { loadConfig, saveConfig } from '../config.js';
import { resolve } from 'node:path';

const HELP = `Sprag / Codex

Usage: sprag <command> --agent codex [options]
  --statusline                  Compact, one-shot terminal status (not the native footer)
  panel                         Live companion panel; --once for piped output
  panel run -- <codex args>      Codex above the panel in tmux
                                Local, session-bound execution (--no-daemon)
      --keep-native-statusline  Keep Codex's duplicate status row (before --)
  panel auto on|off|status       Optional macOS Terminal auto-start
  panel shell install|remove    Optional macOS zsh integration
  panel doctor                  Panel hook and rendering diagnostics
  doctor [--format json]         Config, hooks, harness, logs, and capabilities
  capabilities [--format json]   Support matrix, including native/unsupported areas
  brief [on|off|status]          Current warnings or prompt-briefing preference
  last / history                Codex warning history; --days, --session, --project
  handoff [--cwd path]           Write Git state and Codex usage to HANDOFF-*.md
  delegate on|off|status         Native model routing and SubagentStart guidance
  delegate model <model>         Default target for spawns without an explicit model
  delegate rules                Codex-only category rules; add/rm with explicit scope
  route-scan [--refresh]         Discover recurring simple turns in local logs
  route-scan dismiss R<N>       Dismiss a candidate without registering a rule
  route-scan savings            Attributed routing estimates; --refresh or --format json
  seed [accept|skip|reset]       Bundled Codex ratchet presets; acceptance needs a scope
  cache [auto|off|<duration>]    Display timer policy (e.g. 30m); never changes retention
  cache status --refresh        Resolve the session's gateway deployment and cache policy
  harness init|uninit|check|promote|list|rm|prune
                                Rules in Codex AGENTS.md and ratchet files
  korean / cohesion / doc2md     Writing guidance and document conversion
  mode                          Shared label/color preferences
  install [--no-panel]           Register hooks and global harness; trust via /hooks
  uninstall                     Remove global integration; keep rules and shared state
  upgrade --print               Print Codex-only upgrade commands

Report: sprag --agent codex [--days N | --hours N] [--format table|json|csv]
  --project TEXT                Report/history project substring filter
  --session ID                  Report/history exact session filter
Panel/statusline:
  --project PATH --session ID --days N --text --narrow --no-color
  --columns N                   Statusline wrapping width (default terminal or 100)
  --single-line                 Unwrapped statusline output for terminal integrations
  --timer / --no-timer           Override the shared countdown preference

Codex tui.status_line accepts native item identifiers, not shell commands.
Cache clocks use resolved provider policies, not measured expiry times.
Routing estimates need matching LiteLLM prices and attributed child usage.
Unknown prices and session billing remain unavailable; Claude totals are not imported.
`;

function scopeOf(args, dflt) {
  const { getArg, hasFlag } = createArgs(args);
  const scope = getArg('--scope') || (hasFlag('--global') ? 'global' : hasFlag('--project') ? 'project' : dflt);
  if (scope && !['global', 'project'].includes(scope)) throw new Error('--scope expects global or project');
  if (hasFlag('--global') && hasFlag('--project')) throw new Error('Choose one scope: --global or --project');
  return scope;
}

export async function run({ args, version }) {
  const { getArg, hasFlag } = createArgs(args);
  const numArg = (name, { dflt, min, max } = {}) => {
    const raw = getArg(name);
    if (raw === undefined && !hasFlag(name)) return dflt;
    const value = Number(raw);
    if (!raw || !Number.isFinite(value)) throw new Error(`${name} expects a number`);
    if (min !== undefined && value < min) throw new Error(`${name} must be >= ${min}`);
    if (max !== undefined && value > max) throw new Error(`${name} must be <= ${max}`);
    return value;
  };
  const cmd = args[0];
  if (hasFlag('--help') || hasFlag('-h') || cmd === 'help') { console.log(HELP); return; }
  const separator = args.indexOf('--');
  const ownArgs = separator < 0 ? args : args.slice(0, separator);
  const own = createArgs(ownArgs);
  for (const flag of ['--project', '--session', '--session-file', '--cwd', '--format', '-f', '--columns', '--interval', '--hours', '--days', '-d', '-p']) {
    // Harness, rule, and seed --project selects scope and intentionally takes no value.
    if ((['harness', 'seed'].includes(cmd) || (cmd === 'delegate' && args[1] === 'rules')) && flag === '--project') continue;
    if (!ownArgs.some((arg) => arg === flag || arg.startsWith(`${flag}=`))) continue;
    const value = own.getArg(flag);
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (['--columns', '--interval', '--hours', '--days', '-d'].includes(flag) && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
      throw new Error(`${flag} expects a non-negative number`);
    }
  }
  const root = findProjectRoot(process.cwd(), { agent: 'codex' });
  const selectedRoot = !['harness', 'delegate', 'seed'].includes(cmd) && getArg('--project') ? resolve(getArg('--project')) : root;
  const format = getArg('--format') || getArg('-f') || 'table';
  if (cmd === 'cache') {
    const { parseCodexCacheTtl } = await import('../codex-cache.js');
    const mode = args[1] || 'status';
    const cfg = loadConfig();
    if (mode !== 'status') {
      const ttl = parseCodexCacheTtl(mode);
      cfg.codex = { ...cfg.codex, cacheTtl: ttl };
      saveConfig(cfg);
    }
    const ttl = cfg.codex?.cacheTtl ?? 'auto';
    console.log(`Codex cache timer: ${typeof ttl === 'number' ? `${ttl / 60}m (configured estimate)` : ttl}`);
    const { createPanelReader } = await import('../codex-panel.js');
    const { refreshCodexCachePolicy } = await import('../codex-cache-policy.js');
    const { codexCacheTimer } = await import('../codex-cache.js');
    const data = await createPanelReader({ root: selectedRoot, sessionId: getArg('--session'),
      ...(hasFlag('--refresh') ? { readCachePolicy: refreshCodexCachePolicy } : {}) })();
    if (data.session) {
      const { terminalText } = await import('../codex-panel.js');
      console.log(`Session: ${terminalText(data.session.sessionId)} | ${terminalText(data.session.provider)} / ${terminalText(data.session.model)}`);
      if (data.cachePolicy) {
        const p = data.cachePolicy;
        console.log(`Policy: ${p.backend} / ${terminalText(p.model)} / ${p.seconds / 60}m minimum retention after a cache write or reuse`);
        console.log(`Source: ${p.reference}`);
      } else console.log('Policy: unresolved. Run sprag cache status --refresh --agent codex to query the configured gateway.');
      console.log(codexCacheTimer(data.session, { ttl, policy: data.cachePolicy })?.text || 'Cache timer off');
    } else console.log('No matching Codex session log.');
    console.log('The clock starts at recorded cache usage. The window ending does not prove eviction; a cache hit also requires a matching prefix. Provider retention is unchanged.');
    return;
  }
  if (cmd === 'capabilities' || cmd === 'doctor') {
    if (!['table', 'json'].includes(format)) throw new Error('Diagnostics format must be table or json.');
    const { codexDoctor, CODEX_CAPABILITIES } = await import('../codex-doctor.js');
    const report = cmd === 'capabilities' ? { agent: 'codex', capabilities: CODEX_CAPABILITIES }
      : await codexDoctor({ root: selectedRoot, sessionId: getArg('--session'), days: numArg('--days', { dflt: 7, min: 0 }) });
    if (format === 'json') { console.log(JSON.stringify(report, null, 2)); return; }
    const { terminalText } = await import('../codex-panel.js');
    if (cmd === 'doctor') {
      console.log(`Codex home: ${terminalText(report.home)}`);
      console.log(`Config: ${report.config.error || (report.config.present ? 'readable' : 'absent (defaults)')}`);
      console.log(`Hooks: ${report.hooks.error || `${report.hooks.events.filter((hook) => hook.registered).length}/${report.hooks.events.length} registered; trust unknown`}`);
      for (const hook of report.hooks.events) console.log(`  ${hook.event}: ${hook.registered ? 'registered' : 'missing/outdated; run sprag install --agent codex'}`);
      if (report.config.hooksDisabled) console.log('WARNING: user config disables hooks. Review features.hooks in Codex config.');
      for (const [scope, harness] of Object.entries(report.harness)) console.log(`Harness ${scope}: ${harness.error ? terminalText(harness.error) : `${harness.configured}/${harness.total}`}`);
      console.log(`Session: ${report.session ? `${terminalText(report.session.id)} (${terminalText(report.session.model)})` : 'no matching rollout log'}`);
      console.log(`Panel: ${report.panel.live ? 'recent rendered frame observed' : 'no recent rendered frame'}`);
      console.log(`Preferences: ${JSON.stringify(report.preferences)}`);
      console.log('Review hook trust in Codex /hooks. User config does not include profile/project/admin/runtime overrides.');
    }
    for (const feature of report.capabilities) console.log(`${feature.feature}: ${feature.support} | ${[feature.command, feature.note].filter(Boolean).join(' | ')}`);
    return;
  }
  if (cmd === 'delegate') return (await import('./codex-delegate.js')).run({ args, getArg, hasFlag, root });
  if (cmd === 'seed') return (await import('./seed.js')).run({ args, hasFlag, agent: 'codex', root });
  if (cmd === 'route-scan') {
    const rs = await import('../codex-route-scan.js');
    const days = numArg('--days', { dflt: 14, min: 1 });
    if (args[1] === 'savings') {
      const { refreshCodexLedger, loadCodexLedger, codexRoutingSavedTotals } = await import('../codex-ledger.js');
      if (hasFlag('--refresh')) await refreshCodexLedger();
      const events = Object.entries(loadCodexLedger().events).map(([id, e]) => ({ id, ...e })).sort((a, b) => b.ts - a.ts);
      const totals = codexRoutingSavedTotals();
      if (format === 'json') { console.log(JSON.stringify({ agent: 'codex', totals, events }, null, 2)); return; }
      const money = (usd) => Number.isFinite(usd) ? `${usd < 0 ? '-' : ''}$${Math.abs(usd).toFixed(4)}` : 'n/a (unpriced)';
      console.log(`Codex routing saved: ${totals.priced ? `${money(totals.week)} (7d) / ${money(totals.total)} total` : 'n/a'} | ${totals.runs} attributed run(s), ${totals.runs - totals.priced} unpriced`);
      for (const e of events.slice(0, 20)) {
        console.log(`${new Date(e.ts).toISOString().slice(0, 16)} ${e.source}${e.category ? `/${e.category}` : ''} ${e.from} -> ${e.to} ${money(e.usd)}${e.complete ? '' : ' (incomplete)'}`);
      }
      console.log('Counterfactual: the child run\'s own tokens priced at the parent model. Only Sprag-routed spawns with a recorded route id count.');
      return;
    }
    if (args[1] === 'dismiss') {
      const cand = rs.findCodexCandidate(args[2]);
      if (!cand) throw new Error(`No open Codex route candidate ${args[2] || ''}. List them with sprag route-scan --agent codex.`);
      rs.resolveCodexCandidate(cand);
      console.log(`Dismissed R${cand.id}: ${cand.category} (${cand.from}) in ${cand.projectRoot}. It will not be offered again.`);
      return;
    }
    if (args[1] && !args[1].startsWith('-')) throw new Error('Usage: sprag route-scan [--refresh] [--days N] | dismiss R<N> | savings --agent codex');
    let cache = rs.readCodexRouteScan();
    if (hasFlag('--refresh') || !cache) {
      // Prices live in the gateway snapshot; refresh it when stale so candidates can name a target.
      const { readCodexPrices, refreshCodexPrices } = await import('../codex-cache-policy.js');
      if (!readCodexPrices()) { try { await refreshCodexPrices(); } catch { /* Candidates still list; targets need --model. */ } }
      cache = await rs.runCodexRouteScan({ days });
    }
    if (hasFlag('--quiet')) return;
    if (format === 'json') { console.log(JSON.stringify(cache, null, 2)); return; }
    const open = rs.openCodexCandidates(cache);
    console.log(`Codex route-scan: ${cache.totalEpisodes} turns in ${cache.days} days, scanned ${cache.scannedAt}${cache.priceCheckedAt ? '' : ' | prices unavailable'}`);
    if (!open.length) console.log('No recurring delegable pattern. Needs 3+ similar simple turns per project and parent model.');
    for (const c of open) {
      const target = c.suggestedModel ? `-> ${c.suggestedModel}${Number.isFinite(c.estSavedUsd) ? ` (~$${c.estSavedUsd.toFixed(4)} over ${c.count} turns)` : ''}`
        : `-> choose --model${c.alternatives.length ? ` (priced cheaper: ${c.alternatives.join(', ')})` : ''}`;
      console.log(`R${c.id} ${c.category} x${c.count} [T2 ${c.tiers.T2} / T1 ${c.tiers.T1}] ${c.provider || 'unknown provider'} / ${c.from} ${target}`);
      console.log(`   ${c.projectRoot}`);
      console.log(`   e.g. ${JSON.stringify(c.example)}`);
    }
    if (open.length) console.log('Approve (ask the user for scope first): sprag delegate rules add R<N> --global|--project --agent codex\nDecline: sprag route-scan dismiss R<N> --agent codex');
    return;
  }
  if (cmd === 'brief') {
    if (args.some((arg) => arg.startsWith('--hook'))) throw new Error('Use codex-hook for Codex hook payloads.');
    const sub = args[1]?.startsWith('-') ? undefined : args[1];
    if (sub && !['on', 'off', 'status'].includes(sub)) throw new Error(`Usage: sprag ${cmd} [on|off|status] --agent codex`);
    if (['on', 'off'].includes(sub)) {
      if (sub === 'on') configureCodexHooks();
      const cfg = loadConfig();
      cfg.codex = { ...cfg.codex, [cmd]: sub === 'on' };
      saveConfig(cfg);
    }
    if (sub) {
      const value = loadConfig()?.codex?.[cmd];
      console.log(`Codex ${cmd}: ${value !== false ? 'on' : 'off'} (preference)`);
      console.log('Run sprag install --agent codex and review/trust hooks in Codex /hooks.');
      return;
    }
    const { createPanelReader, terminalText } = await import('../codex-panel.js');
    const { codexIssues } = await import('../codex-brief.js');
    const data = await createPanelReader({ root: selectedRoot, sessionId: getArg('--session'), days: numArg('--days', { dflt: 7, min: 0 }) })();
    const issues = codexIssues(data.session);
    if (!issues.length) console.log('No fresh Codex context or rate-limit warnings. Missing/stale logs do not prove healthy usage.');
    for (const issue of issues) {
      console.log(terminalText(issue.message));
      console.log(terminalText(issue.advice));
    }
    return;
  }
  if (cmd === 'history' || cmd === 'last') {
    if (!['table', 'json'].includes(format)) throw new Error('History format must be table or json.');
    const { readCodexHistory } = await import('../codex-brief.js');
    const { terminalText } = await import('../codex-panel.js');
    let events = readCodexHistory({ days: numArg('--days', { dflt: cmd === 'last' ? 1 : 7, min: 0 }),
      sessionId: getArg('--session'), project: getArg('--project') || getArg('-p') });
    if (cmd === 'last') events = events.slice(-1);
    if (format === 'json') { console.log(JSON.stringify({ agent: 'codex', events }, null, 2)); return; }
    if (!events.length) console.log('No Codex warning history in this window. Records are written by the trusted prompt hook.');
    else if (hasFlag('--list')) console.log([...new Set(events.map((event) => event.at.slice(0, 10)))].reverse().join('\n'));
    else for (const event of events) {
      console.log(terminalText(`${event.at} [${event.sessionId}] ${event.message}`));
      console.log(terminalText(event.advice));
    }
    return;
  }
  if (cmd === 'handoff') {
    const { createPanelReader } = await import('../codex-panel.js');
    const { writeHandoff } = await import('../handoff.js');
    const cwd = getArg('--cwd') || process.cwd();
    const data = await createPanelReader({ root: findProjectRoot(resolve(cwd), { agent: 'codex' }), sessionId: getArg('--session'), days: numArg('--days', { dflt: 7, min: 0 }) })();
    const result = writeHandoff({ cwd, agent: 'codex', session: data.session });
    console.log(`Handoff written: ${result.path}`);
    console.log('Fill in the remaining-work sections, then ask the next Codex session to read this file.');
    return;
  }
  const statusline = hasFlag('--statusline') || format === 'statusline';
  if (statusline && (!cmd || cmd.startsWith('-'))) {
    const { createPanelReader, formatCodexPanel } = await import('../codex-panel.js');
    const data = await createPanelReader({ root: selectedRoot, sessionId: getArg('--session'), days: numArg('--days', { dflt: 7, min: 0 }), hasFlag })();
    const columns = numArg('--columns', { dflt: process.stdout.columns || 100, min: 1, max: 10000 });
    const text = formatCodexPanel(data, { compact: true, columns: hasFlag('--single-line') ? 100000 : columns,
      rows: 10000, version, color: !hasFlag('--no-color') && !process.env.NO_COLOR && !!process.stdout.isTTY && data.color });
    console.log(hasFlag('--single-line') ? text.split('\n').join(' | ') : text);
    return;
  }
  if (cmd === 'panel') {
    if (args[1] === 'run') {
      const separator = args.indexOf('--');
      const forwarded = separator < 0 ? [] : args.slice(separator + 1);
      const { runCodexWithPanel } = await import('../codex-panel-runner.js');
      let project = process.cwd();
      for (let i = 0; i < forwarded.length; i++) {
        if (forwarded[i] === '--') break;
        if (['-C', '--cd'].includes(forwarded[i]) && forwarded[i + 1]) project = forwarded[++i];
        else if (forwarded[i].startsWith('--cd=')) project = forwarded[i].slice(5);
      }
      process.exitCode = runCodexWithPanel(forwarded, { root: project, keepNativeStatusline: own.hasFlag('--keep-native-statusline') });
      return;
    }
    if (args[1] === 'shell') {
      if (process.platform !== 'darwin') throw new Error('Immediate panel launch currently supports macOS zsh.');
      if (!['install', 'remove'].includes(args[2])) throw new Error('Usage: sprag panel shell install|remove --agent codex');
      const { installPanelShell } = await import('../codex-panel-shell.js');
      const file = installPanelShell({ remove: args[2] === 'remove' });
      console.log(`Shell integration ${args[2]}: ${file}. Open a new terminal to apply it.`);
      return;
    }
    const { recordPanelState, panelHealth } = await import('../codex-panel-state.js');
    const panelRoot = getArg('--project') ? resolve(getArg('--project')) : root;
    if (args[1] === 'doctor') {
      const { codexPanelAutoEnabled } = await import('../codex-installer.js');
      const health = panelHealth(panelRoot, { sessionId: getArg('--session') });
      console.log(`Panel hook registered: ${codexPanelAutoEnabled() ? 'yes' : 'no'}`);
      console.log(`Project: ${panelRoot}`);
      console.log(`Last hook execution: ${health.hook ? `${health.hook.status} at ${health.hook.at}` : 'not observed'}`);
      if (health.hook?.error) console.log(`Launch error: ${health.hook.error}`);
      console.log(`Panel rendering: ${health.live ? 'verified (recent frame)' : 'not verified (no recent frame)'}`);
      if (health.frame) console.log(`Last frame: ${health.frame.at} (${health.frame.status})`);
      console.log('Trust is managed by Codex /hooks; registration alone does not prove approval or execution.');
      if (!health.live) console.log('Open now: sprag panel --open --agent codex. Check /hooks, macOS Automation permission, and the hook PATH.');
      return;
    }
    if (args[1] === 'auto') {
      const { codexPanelAutoEnabled } = await import('../codex-installer.js');
      const mode = args[2] || 'status';
      if (!['on', 'off', 'status'].includes(mode)) throw new Error('Usage: sprag panel auto on|off|status --agent codex');
      if (mode === 'on' && process.platform !== 'darwin') throw new Error('Automatic panel windows currently require macOS Terminal.');
      if (mode !== 'status') {
        configureCodexHooks({ panelAuto: mode === 'on' });
        const cfg = loadConfig();
        cfg.codex = { ...cfg.codex, panelAuto: mode === 'on' };
        saveConfig(cfg);
      }
      console.log(`Codex panel auto-start: ${codexPanelAutoEnabled() ? 'on' : 'off'}`);
      if (mode === 'on') console.log('Review and trust the new panel-start hook in Codex /hooks, then restart or resume Codex.');
      return;
    }
    if (hasFlag('--open')) {
      const { openCodexPanel } = await import('../codex-panel-launcher.js');
      console.log(`Codex panel: ${openCodexPanel(getArg('--project') || root, { sessionId: getArg('--session') })}`);
      return;
    }
    const { createPanelReader, runCodexPanel } = await import('../codex-panel.js');
    const { createCodexCachePolicyReader, refreshCodexCachePolicy } = await import('../codex-cache-policy.js');
    const { createCodexBudgetReader, codexBudgetProvider, fetchCodexBudget } = await import('../codex-budget.js');
    const readBudget = hasFlag('--once') ? (() => {
      let snapshot = null;
      return { read: () => snapshot, set: (value) => { snapshot = value; } };
    })() : { read: createCodexBudgetReader() };
    if (hasFlag('--once')) {
      const provider = codexBudgetProvider();
      if (provider) { try { readBudget.set(await fetchCodexBudget(provider)); } catch { /* No verified budget. */ } }
    }
    const { createInlinePanelResizer } = await import('../codex-panel-runner.js');
    const rawInterval = getArg('--interval');
    const interval = rawInterval === undefined ? 2 : Number(rawInterval);
    if (!Number.isFinite(interval) || interval < 0.5 || interval > 60) throw new Error('--interval must be between 0.5 and 60 seconds');
    for (const flag of ['--session', '--project', '--interval']) {
      if (hasFlag(flag) && (!getArg(flag) || getArg(flag).startsWith('--'))) throw new Error(`${flag} requires a value`);
    }
    let renderedSessionId;
    return runCodexPanel({
      read: createPanelReader({ root: getArg('--project') ? resolve(getArg('--project')) : root,
        sessionId: getArg('--session'), sessionFile: getArg('--session-file'), days: numArg('--days', { dflt: 7, min: 0 }), readBudget: readBudget.read,
        readCachePolicy: hasFlag('--once') ? async (session) => {
          const { readCodexCachePolicy } = await import('../codex-cache-policy.js');
          try { return readCodexCachePolicy(session) || await refreshCodexCachePolicy(session); }
          catch { return null; }
        } : createCodexCachePolicyReader(), hasFlag }),
      interval: interval * 1000, once: hasFlag('--once'),
      color: !hasFlag('--no-color') && !process.env.NO_COLOR && !!process.stdout.isTTY, version, compact: hasFlag('--compact'),
      fitRows: createInlinePanelResizer(),
      onFrame: (data) => {
        renderedSessionId = data.sessionId || data.session?.sessionId;
        recordPanelState(panelRoot, 'frame', { status: 'rendered', pid: process.pid, sessionId: renderedSessionId });
      },
      onClose: () => recordPanelState(panelRoot, 'frame', { status: 'closed', pid: process.pid, sessionId: renderedSessionId }),
    });
  }
  if (cmd === 'codex-hook') {
    const { readStdinJson } = await import('../stdin-payload.js');
    const { codexHookOutput } = await import('../codex-hooks.js');
    try {
      const payload = readStdinJson();
      const { bindPanelSession } = await import('../codex-panel-session.js');
      bindPanelSession(getArg('--event'), payload);
      if (getArg('--event') === 'panel-start') {
        if (process.env.SPRAG_CODEX_PANEL === '1') return;
        if (!payload?.cwd || typeof payload.session_id !== 'string' || !payload.session_id.trim() || !['startup', 'resume'].includes(payload.source)) return;
        const { openCodexPanel } = await import('../codex-panel-launcher.js');
        const { recordPanelState } = await import('../codex-panel-state.js');
        const panelRoot = findProjectRoot(payload.cwd, { agent: 'codex' });
        recordPanelState(panelRoot, 'hook', { status: 'started', sessionId: payload.session_id });
        try {
          const status = openCodexPanel(panelRoot, { sessionId: payload.session_id });
          recordPanelState(panelRoot, 'hook', { status, sessionId: payload.session_id });
        } catch (e) {
          recordPanelState(panelRoot, 'hook', { status: 'failed', error: String(e.message).slice(0, 1000), sessionId: payload.session_id });
          console.log(JSON.stringify({ systemMessage: 'Sprag panel could not open. Run sprag panel --agent codex in a separate terminal; macOS may require Terminal automation permission.' }));
        }
        return;
      }
      const out = await codexHookOutput(getArg('--event'), payload);
      if (out) console.log(JSON.stringify(out));
    } catch { /* Hook failures must not break the agent loop. */ }
    return;
  }
  if (cmd === 'install') {
    const cfg = loadConfig();
    const panelAuto = process.platform === 'darwin' && !hasFlag('--no-panel') && cfg?.codex?.panelAuto !== false;
    const hook = configureCodexHooks({ panelAuto });
    console.log(`Codex hooks: ${hook.file} (${hook.action})`);
    if (process.env.CTS_NO_HARNESS !== '1') {
      const h = initCodexHarness({ root, scope: 'global' });
      console.log(`Codex harness: ${h.file}`);
    }
    console.log('Open /hooks in Codex and review/trust the Sprag hooks before they can run.');
    console.log(`Panel auto-start: ${panelAuto ? 'registered with the other hooks' : 'off'}. Hook registration is complete; runtime activation is not verified.`);
    console.log('After approval, start or resume Codex and run: sprag panel doctor --agent codex');
    if (panelAuto) console.log('Some Codex versions defer SessionStart until the first prompt. For immediate opening on typing codex: sprag panel shell install --agent codex (optional zsh integration).');
    console.log('Existing config.toml, Claude Code settings, and ratchet rules are preserved.');
    console.log('Korean guidance is opt-in: sprag korean on --agent codex');
    return;
  }
  if (cmd === 'uninstall') {
    if (hasFlag('--purge')) throw new Error('Codex uninstall keeps shared Sprag state; --purge is not supported.');
    const hook = configureCodexHooks({ remove: true });
    const h = uninitCodexHarness({ root, scope: 'global' });
    console.log(`Codex hooks: ${hook.file} (${hook.action})`);
    console.log(`Codex harness: ${h.file} (${h.removed ? 'removed' : 'absent'})`);
    console.log('Ratchet rules, project harnesses, backups, and shared Sprag state kept.');
    return;
  }
  if (cmd === 'harness') {
    const sub = args[1] || 'check';
    const scope = scopeOf(args, sub === 'promote' ? null : 'project');
    const opts = { root, scope, agent: 'codex' };
    if (sub === 'init') {
      console.log(JSON.stringify(initCodexHarness(opts), null, 2));
    } else if (sub === 'uninit' || sub === 'remove') {
      if (hasFlag('--purge-ratchet')) throw new Error('Codex uninit keeps ratchet rules; use harness rm or prune.');
      console.log(JSON.stringify(uninitCodexHarness(opts), null, 2));
    } else if (sub === 'check') {
      let s = codexHarnessStatus(opts);
      if (!scopeOf(args, null) && !s.configured) s = codexHarnessStatus({ root, scope: 'global' });
      console.log(`Harness ${s.configured}/${s.total}: ${s.file}`);
      for (const name of s.missing) console.log(`Missing: ${name}`);
    } else if (sub === 'promote') {
      if (!scope) throw new Error('Ask the user for scope, then pass --global or --project.');
      const words = [];
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--scope' || args[i] === '--session') { i++; continue; }
        if (args[i] === '--global' || args[i] === '--project' || args[i].startsWith('--scope=') || args[i].startsWith('--session=')) continue;
        words.push(args[i]);
      }
      const rule = words.join(' ').trim();
      if (!rule) throw new Error('Provide rule text or a ratchet candidate number (see ratchet? in sprag --statusline --agent codex).');
      if (/^R\d+$/i.test(rule)) throw new Error(`Approve route candidates with: sprag delegate rules add ${rule.toUpperCase()} --global|--project --agent codex`);
      if (/^\d+$/.test(rule)) {
        const { createPanelReader } = await import('../codex-panel.js');
        const { codexCandidateRule } = await import('../codex-harness.js');
        const { userLanguage } = await import('../config.js');
        const data = await createPanelReader({ root, sessionId: getArg('--session') })();
        const cand = (data.ratchet || []).find((c) => c.id === Number(rule));
        if (!cand) throw new Error(`No ratchet candidate #${rule} in ${data.session ? `session ${data.session.sessionId}` : 'this project'}. Candidates last 30 minutes.`);
        const text = codexCandidateRule(cand, userLanguage());
        console.log(`Candidate #${cand.id} from session ${data.session.sessionId}: ${cand.pattern}`);
        console.log(`Appended to ${harnessPromote(text, opts).path}`);
        console.log('Replace the TODO with the cause and prevention: sprag harness list --agent codex');
        return;
      }
      console.log(`Appended to ${harnessPromote(rule, opts).path}`);
    } else if (sub === 'list' || sub === 'ls') {
      const r = harnessListRules(opts);
      console.log(`Codex ratchet [${scope}]: ${r.path}`);
      for (const rule of r.rules) console.log(`#${rule.index} ${rule.text}`);
    } else if (sub === 'rm') {
      const raw = args[2];
      // Locate the index even when scope flags precede it.
      const index = args.slice(2).find((s) => /^\d+$/.test(s));
      if (!index) throw new Error(`Expected rule index, got ${raw || 'nothing'}`);
      const r = harnessRmRule(Number(index), opts);
      if (!r.ok) throw new Error(r.error);
      console.log(`Removed #${index}; backup: ${r.backup}`);
    } else if (sub === 'prune') {
      const r = harnessPrune({ ...opts, tag: getArg('--tag'), olderThanMonths: numArg('--older-than', { min: 1 }), dryRun: hasFlag('--dry-run') });
      if (!r.ok) throw new Error(r.error);
      console.log(JSON.stringify(r, null, 2));
    } else throw new Error(`Codex harness supports init, uninit, check, promote, list, rm, prune (got ${sub}).`);
    return;
  }
  if (cmd === 'korean' && ['on', 'off'].includes(args[1])) {
    if (args.some((arg) => arg.startsWith('--hook'))) throw new Error('Use codex-hook for Codex hook payloads.');
    const { setKoreanStyleEnabled } = await import('../korean-style.js');
    if (args[1] === 'on') configureCodexHooks();
    setKoreanStyleEnabled(args[1] === 'on');
    console.log(`Korean guidance: ${args[1]} (shared Sprag preference). Review/trust the Sprag hooks in Codex /hooks.`);
    return;
  }
  if (cmd === 'doc2md' && ['on', 'off'].includes(args[1])) {
    if (args.some((arg) => arg.startsWith('--hook'))) throw new Error('Use codex-hook for Codex hook payloads.');
    if (args[1] === 'on') configureCodexHooks();
    const cfg = loadConfig();
    cfg.codex = { ...cfg.codex, doc2md: args[1] === 'on' };
    saveConfig(cfg);
    console.log(`Codex document conversion: ${args[1]}. Codex hooks must be installed and trusted.`);
    return;
  }
  if (cmd === 'doc2md' && (!args[1] || args[1] === 'status')) {
    const { createRequire } = await import('node:module');
    const doc2md = createRequire(import.meta.url)('../doc2md.cjs');
    const { codexHookStatus } = await import('../codex-installer.js');
    console.log(`Codex document conversion: ${loadConfig()?.codex?.doc2md === false || process.env.CTS_NO_DOC2MD === '1' ? 'off' : 'on'}`);
    console.log(`Formats: ${doc2md.TARGET_EXTENSIONS.join(' ')}`);
    console.log(`Converter: ${doc2md.findInterpreter() || 'missing; run sprag doc2md install-converter --agent codex'}`);
    console.log(`Cache: ${doc2md.cacheDir()}`);
    try {
      for (const hook of codexHookStatus().filter((h) => ['PreToolUse', 'UserPromptSubmit'].includes(h.event))) console.log(`${hook.event}: ${hook.registered ? 'registered' : 'missing/outdated'}`);
    } catch {
      console.log('Hooks: cannot read Codex hooks.json; file left unchanged. Run sprag doctor --agent codex for diagnostics.');
    }
    console.log('Prompt conversion, supported reads, and document/cache write guards require trusted hooks. Review in Codex /hooks.');
    return;
  }
  if (cmd === 'doc2md' && args[1] && !args[1].startsWith('-') && args[1] !== 'install-converter') {
    const { convertCodexDocument } = await import('../codex-doc2md.js');
    const result = convertCodexDocument(resolve(args[1]));
    if (!result.ok) {
      console.error(`Doc2md failed: ${result.reason}`);
      if (result.reason === 'no-markitdown') console.error('Run sprag doc2md install-converter --agent codex, then retry.');
      process.exitCode = 1;
      return;
    }
    console.log(`${result.cached ? 'Cached' : 'Converted'}: ${result.cacheFile}`);
    console.log(`Source ${result.meta.size} bytes; Markdown ${result.meta.markdownBytes} bytes.`);
    if (result.meta.clipped || result.meta.truncated) console.log('Text extraction is incomplete; inspect the source for omitted content.');
    if (result.meta.note) console.log(result.meta.note);
    return;
  }
  if (cmd === 'upgrade') {
    const command = 'npm i -g sprag-cli --ignore-scripts';
    if (!hasFlag('--print')) throw new Error(`For a Codex-only upgrade, run ${command}, then sprag install --agent codex.`);
    console.log(command);
    console.log('sprag install --agent codex');
    return;
  }
  const shared = new Set(['korean', 'cohesion', 'doc2md', 'mode', 'feedback', 'update-check']);
  if (shared.has(cmd)) {
    if (args.some((a) => a.startsWith('--hook'))) throw new Error('Use codex-hook for Codex hook payloads.');
    if (cmd === 'cohesion' && args[1] === 'on') configureCodexHooks();
    const { userDataDir } = await import('../paths.js');
    const result = await (await import(`./${cmd}.js`)).run({ args, getArg, hasFlag, numArg, version, dataDir: userDataDir() });
    if (cmd === 'cohesion' && args[1] === 'on') console.log('Review/trust the Sprag hooks in Codex /hooks.');
    return result;
  }
  if (cmd && !cmd.startsWith('-')) throw new Error(`${cmd} is not supported for Codex yet. Use --agent claude for Claude Code integration.`);
  if (hasFlag('--install-hook') || hasFlag('--uninstall-hook') || hasFlag('--hook-run')) {
    throw new Error('Claude command statusline and legacy hooks are not supported by Codex. Use sprag --agent codex for a report.');
  }
  const days = numArg('--hours', { min: 0 }) !== undefined ? numArg('--hours', { min: 0 }) / 24
    : (numArg('--days', { min: 0 }) ?? numArg('-d', { min: 0 }) ?? 30);
  if (!['table', 'json', 'csv'].includes(format)) throw new Error('Codex report format must be table, json, or csv.');
  const { parseAllCodexSessions } = await import('../codex-parser.js');
  const { summary, dailyTrend } = await import('../stats.js');
  const sessions = (await parseAllCodexSessions({ days, projectFilter: getArg('--project') || getArg('-p') }))
    .filter((session) => !getArg('--session') || session.sessionId === getArg('--session'));
  const sum = summary(sessions);
  const report = {
    agent: 'codex', options: { days }, summary: sum, usageUpdates: sum.apiCalls, trend: dailyTrend(sessions),
    reasoningOutputTokens: sessions.reduce((n, s) => n + s.reasoningOutputTokens, 0),
    cost: null, ttl: null,
    usageNote: 'Local rollout estimates; reasoning is included in output. Cost and cache TTL are not inferred. Usage updates are not an exact API request count.',
    sessions,
  };
  if (format === 'json') console.log(JSON.stringify(report, null, 2));
  else if (format === 'csv') {
    console.log('agent,sessions,usage_updates,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens');
    console.log(['codex', sum.sessions, sum.apiCalls, sum.totalInput, sum.cacheRead, sum.output, report.reasoningOutputTokens].join(','));
  } else {
    console.log(`Sprag / Codex / ${days} days`);
    console.log(`Sessions: ${sum.sessions} | Usage updates: ${sum.apiCalls}`);
    console.log(`Input: ${sum.totalInput} (${sum.cacheRead} cached, ${(sum.hitRate * 100).toFixed(1)}% hit rate)`);
    console.log(`Output: ${sum.output} (${report.reasoningOutputTokens} reasoning, included)`);
    console.log('Cost: unavailable | Cache TTL: unavailable');
    if (!sessions.length) console.log('No Codex usage records found. Check CODEX_HOME, session logging, or --days 90.');
  }
}
