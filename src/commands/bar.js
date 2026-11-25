/**
 * Subcommand: bar -- what each running Claude Code and Codex session is doing,
 * with its model, context use, cost, CPU and memory, and the account limits of
 * each agent, printed once.
 *
 * Three outputs share one snapshot from collectActivity():
 *   sprag bar             a terminal table
 *   sprag bar --json      the snapshot as JSON, for a menu bar app or a desktop pet
 *   sprag bar --json --detail  the same, with each session's request, last reply, recent tool calls and child processes
 *   sprag bar --swiftbar  SwiftBar/xbar menu bar text
 *   sprag bar --plugin    the shell script to save as sprag.5s.sh in the plugin folder
 *   sprag bar --settings  the settings a menu bar app shows, as JSON (src/bar-settings.js)
 *   sprag bar --rules     every ratchet, preset, model-fitting and team rule, as JSON (src/bar-rules.js)
 *
 * Four subcommands manage the macOS menu bar app (src/bar-app.js), which is
 * compiled from mac/SpragBar.swift once per change to that file and started at session start:
 *   sprag bar on          turn it on, compile it when needed and start it
 *   sprag bar off         turn it off and stop it
 *   sprag bar status      on or off, running, built, toolchain, last build error
 *   sprag bar build [--then-launch]  compile it now, and start it after a good build
 *
 * The plugin script names the node binary and the CLI by absolute path because
 * SwiftBar runs plugins with a short PATH that does not find `sprag`.
 */

import { collectActivity } from '../agent-activity.js';
import { cellWidth } from '../cell-width.js';
import { CLI_ENTRY } from '../cli-entry.js';

const NAME_WIDTH = 28;
const ACTIVITY_WIDTH = 16;
const BRAND = '✇';
const MONO = 'font=Menlo size=12';

/** 12s under a minute, 18m under an hour, 5h under 48 hours, then 3d. '' for a negative or missing span. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function formatMem(mb) {
  if (!Number.isFinite(mb)) return '';
  return mb < 1024 ? `${mb} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

/** 842, 166k, 1.2M. '' for a missing count. */
export function formatTokens(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1000) return String(n);
  if (n < 1e6) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

export function formatUsd(n) {
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '';
}

/** The tool a session is in the middle of, how many more are pending, and its running subagents. */
export function activityLabel(row) {
  const tools = Array.isArray(row?.tools) ? row.tools : [];
  const parts = [];
  if (tools.length > 0) parts.push(tools.length > 1 ? `${tools[0]} +${tools.length - 1}` : tools[0]);
  if (row?.subagents > 0) parts.push(`⤷${row.subagents}`);
  return parts.join(' ');
}

const dot = (state) => (state === 'busy' ? '●' : state === 'idle' ? '○' : '◌');

/** `state` and how long it has held, or '-' when the state is unknown. */
function stateText(row, at) {
  if (typeof row.state !== 'string') return '-';
  const since = Number.isFinite(row.stateSince) ? formatDuration(at - row.stateSince) : '';
  return since ? `${row.state} ${since}` : row.state;
}

function fit(text, width) {
  const s = String(text ?? '');
  if (cellWidth(s) <= width) return s;
  let out = '';
  for (const ch of Array.from(s)) {
    if (cellWidth(out + ch) + 1 > width) break;
    out += ch;
  }
  return `${out}…`;
}

const padEnd = (s, w) => s + ' '.repeat(Math.max(0, w - cellWidth(s)));
const padStart = (s, w) => ' '.repeat(Math.max(0, w - cellWidth(s))) + s;
const mark = (snapshot) => snapshot.animal?.emoji ?? BRAND;
// CPU is shown as a share of the whole machine (cpuPct): `ps` reports a share of
// one core, which adds up past 100% and read as an error.
const cpuText = (pct) => (Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '');
const AGENT_NAMES = { claude: 'Claude', codex: 'Codex' };

/** `Claude Fable 5.2 xhigh`: the agent, then the model and the effort when they are known. */
function agentText(row) {
  const name = AGENT_NAMES[row.agent] ?? String(row.agent ?? '');
  return [name, row.modelName, row.effort].filter((part) => typeof part === 'string' && part !== '').join(' ');
}

/** `ctx 17%` when the window is known, `ctx 166k` when only the size of the prompt is, else ''. */
function ctxText(row) {
  const c = row.context;
  if (Number.isFinite(c?.pct)) return `ctx ${c.pct}%`;
  return Number.isFinite(c?.tokens) ? `ctx ${formatTokens(c.tokens)}` : '';
}

const costText = (row) => formatUsd(row.usage?.costUsd);

/** Agents that have account limits, Claude first, with their windows as `5H 12%` words. */
function limitGroups(snapshot) {
  const groups = [];
  // Codex limits are read from rollout files that outlive the process, so they
  // would show for a user who runs no Codex at all.
  const hasCodex = (snapshot.sessions ?? []).some((r) => r.agent === 'codex');
  for (const key of ['claude', 'codex']) {
    if (key === 'codex' && !hasCodex) continue;
    const windows = snapshot.usage?.[key]?.windows;
    const words = (Array.isArray(windows) ? windows : [])
      .filter((w) => w && Number.isFinite(w.usedPct))
      .map((w) => `${w.label ?? w.key} ${Math.round(w.usedPct)}%`);
    if (words.length) groups.push({ name: AGENT_NAMES[key], words });
  }
  return groups;
}

const warningsOf = (snapshot) => (Array.isArray(snapshot.warnings) ? snapshot.warnings : []);

export function renderText(snapshot) {
  const { totals, sessions } = snapshot;
  const lead = mark(snapshot);
  const warningLines = warningsOf(snapshot).map((w) => `${w.chip}  ${w.advice?.[0]?.title ?? ''}`.replace(/\s+$/, ''));
  if (!sessions.length) return [`${lead} no agent sessions running`, ...warningLines].join('\n');
  let head = `${lead} ${totals.busy}/${totals.sessions} busy`;
  if (snapshot.resources) {
    if (Number.isFinite(totals.cpuPct)) head += ` · CPU ${Math.round(totals.cpuPct)}%`;
    head += ` · ${formatMem(totals.rssMb)}`;
  }
  for (const g of limitGroups(snapshot)) head += ` · ${g.name} ${g.words.join(' ')}`;
  const cells = sessions.map((r) => ({
    dot: dot(r.state),
    name: fit(r.title ?? r.name, NAME_WIDTH),
    agent: agentText(r),
    state: stateText(r, snapshot.at),
    activity: fit(activityLabel(r), ACTIVITY_WIDTH),
    ctx: ctxText(r),
    cost: costText(r),
    cpu: snapshot.resources ? cpuText(r.cpuPct) : '',
    mem: snapshot.resources ? formatMem(r.rssMb) : '',
  }));
  const w = (key) => Math.max(0, ...cells.map((c) => cellWidth(c[key])));
  // ctx and cost take no room when no row has one.
  const columns = [
    { key: 'name', pad: padEnd }, { key: 'agent', pad: padEnd }, { key: 'state', pad: padEnd }, { key: 'activity', pad: padEnd },
    ...(w('ctx') > 0 ? [{ key: 'ctx', pad: padEnd }] : []),
    ...(w('cost') > 0 ? [{ key: 'cost', pad: padStart }] : []),
    ...(snapshot.resources ? [{ key: 'cpu', pad: padStart }, { key: 'mem', pad: padStart }] : []),
  ];
  const widths = Object.fromEntries(columns.map((col) => [col.key, w(col.key)]));
  const lines = cells.map((c) => [c.dot, ...columns.map((col) => col.pad(c[col.key], widths[col.key]))]
    .join('  ').replace(/\s+$/, ''));
  return [head, ...warningLines, ...lines].join('\n');
}

/** SwiftBar reads `|` as the start of parameters, so a `|` or a newline inside text must not reach it. */
const clean = (s) => String(s).replace(/\|/g, '¦').replace(/\r?\n|\r/g, ' ');

export function renderSwiftBar(snapshot) {
  const { totals, sessions } = snapshot;
  const cpu = snapshot.resources && Number.isFinite(totals.cpuPct) ? ` · ${Math.round(totals.cpuPct)}%` : '';
  const warnings = warningsOf(snapshot);
  const alert = warnings.some((w) => w.level === 'critical') ? '🚨 ' : warnings.length ? '⚠ ' : '';
  const title = `${alert}${mark(snapshot)} ${totals.busy}/${totals.sessions}${cpu}`;
  const out = [clean(title), '---'];
  if (!sessions.length) {
    out.push('No agent sessions running');
  } else {
    for (const r of sessions) {
      const parts = [r.title ?? r.name, agentText(r), stateText(r, snapshot.at)];
      const label = activityLabel(r);
      if (label) parts.push(label);
      for (const extra of [ctxText(r), costText(r)]) if (extra) parts.push(extra);
      if (snapshot.resources) parts.push(...[cpuText(r.cpuPct), formatMem(r.rssMb)].filter(Boolean));
      out.push(`${clean(`${dot(r.state)} ${parts.join(' · ')}`)} | ${MONO}`);
    }
  }
  out.push('---');
  for (const w of warnings) {
    const advice = w.advice?.[0];
    out.push(`${clean(advice?.title ? `${w.chip} · ${advice.title}` : w.chip)} | ${MONO}`);
    if (advice?.tip) out.push(`--${clean(advice.tip)} | ${MONO}`);
  }
  if (snapshot.resources) {
    const cpuPart = Number.isFinite(totals.cpuPct) ? `CPU ${Math.round(totals.cpuPct)}% · ` : '';
    out.push(`${cpuPart}${formatMem(totals.rssMb)} · ${totals.procs} processes | ${MONO}`);
  }
  for (const g of limitGroups(snapshot)) out.push(`${clean(`${g.name} limits: ${g.words.join(' · ')}`)} | ${MONO}`);
  out.push('Refresh | refresh=true');
  return out.join('\n');
}

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The SwiftBar/xbar plugin: a shell script that runs this CLI by absolute path. */
export function pluginScript({ execPath = process.execPath, cliEntry = CLI_ENTRY } = {}) {
  return [
    '#!/bin/sh',
    '# sprag menu bar plugin for SwiftBar or xbar. Save it as sprag.5s.sh in the plugin folder and make it executable.',
    `exec ${shQuote(execPath)} ${shQuote(cliEntry)} bar --swiftbar`,
    '',
  ].join('\n');
}

const BAR_SUBCOMMANDS = new Set(['on', 'off', 'status', 'build']);

/** The last lines of a build error, indented under the message that names it. */
const indent = (text) => String(text ?? '').trim().split('\n').map((l) => `  ${l}`).join('\n');

/** `sprag bar on|off|status|build`: the menu bar app's switch, state and compile step. */
async function runSubcommand(sub, { hasFlag, deps }) {
  const { stdout = process.stdout, stderr = process.stderr } = deps;
  const ko = (deps.lang ?? (await import('../config.js')).userLanguage()) === 'ko';
  const bar = deps.bar ?? (await import('../bar-app.js'));
  const platform = deps.platform ?? process.platform;
  const barDeps = deps.barDeps ?? {};
  const say = (en, kor) => stdout.write(`${ko ? kor : en}\n`);
  const fail = (en, kor) => { stderr.write(`${ko ? kor : en}\n`); process.exitCode = 1; };
  const macOnly = () => say('The menu bar app only works on macOS.', '메뉴 막대 앱은 macOS에서만 동작합니다.');
  const needTools = () => fail(
    'Compiling the menu bar app needs the Xcode command line tools. Install them with: xcode-select --install',
    '메뉴 막대 앱을 컴파일하려면 Xcode 명령줄 도구가 필요합니다. 설치: xcode-select --install',
  );
  const buildFailed = (r) => fail(
    `Could not compile the menu bar app:\n${indent(r.error)}`,
    `메뉴 막대 앱을 컴파일하지 못했습니다:\n${indent(r.error)}`,
  );

  if (sub === 'off') {
    bar.setBarEnabled(false);
    bar.stopBar(barDeps);
    bar.removeLauncher(barDeps);
    say('✓ The menu bar app is off and will not be started again. `sprag bar on` brings it back.',
      '✓ 메뉴 막대 앱을 껐고 다시 시작하지 않습니다. 다시 켜려면 `sprag bar on` 을 실행하십시오.');
    return;
  }

  if (sub === 'on') {
    bar.setBarEnabled(true);
    if (platform !== 'darwin') { macOnly(); return; }
    const paths = bar.barPaths(barDeps);
    const running = bar.barRunning(barDeps);
    if (running && running.version === paths.version) {
      bar.installLauncher({ ...barDeps, platform });
      say(`✓ The menu bar app is already running (pid ${running.pid}, build ${running.version}).`,
        `✓ 메뉴 막대 앱이 이미 실행 중입니다 (pid ${running.pid}, 빌드 ${running.version}).`);
      return;
    }
    if (running) bar.stopBar(barDeps);
    const exists = barDeps.exists ?? (await import('node:fs')).existsSync;
    if (!exists(paths.binary)) {
      if (!bar.findSwiftc(barDeps)) { needTools(); return; }
      say('Compiling the menu bar app, which takes about half a minute...',
        '메뉴 막대 앱을 컴파일합니다. 30초쯤 걸립니다...');
      const r = bar.buildBar(barDeps);
      if (r.skipped) {
        say('Another build is already running. The app starts when it finishes.',
          '다른 컴파일이 이미 진행 중입니다. 끝나면 앱이 시작됩니다.');
        return;
      }
      if (!r.ok) {
        if (r.error === 'no-toolchain') needTools();
        else buildFailed(r);
        return;
      }
    }
    bar.launchBar(barDeps);
    say('✓ The menu bar app is in the menu bar.', '✓ 메뉴 막대에 앱을 띄웠습니다.');
    say('Open "Sprag Bar" from Spotlight or Launchpad to start it again later.',
      '나중에 다시 켤 때는 Spotlight나 Launchpad에서 Sprag Bar를 여십시오.');
    return;
  }

  if (sub === 'build') {
    if (platform !== 'darwin') { macOnly(); return; }
    const r = bar.buildBar(barDeps);
    if (r.skipped) {
      say('Another build is already running.', '다른 컴파일이 이미 진행 중입니다.');
      return;
    }
    if (!r.ok) {
      if (r.error === 'no-toolchain') needTools();
      else buildFailed(r);
      return;
    }
    say(`✓ Compiled the menu bar app in ${(r.ms / 1000).toFixed(1)}s.`, `✓ 메뉴 막대 앱을 ${(r.ms / 1000).toFixed(1)}초 만에 컴파일했습니다.`);
    if (hasFlag('--then-launch') && bar.barEnabled() && !bar.barRunning(barDeps)) {
      bar.launchBar(barDeps);
      say('✓ The menu bar app is in the menu bar.', '✓ 메뉴 막대에 앱을 띄웠습니다.');
    }
    return;
  }

  // status
  const paths = bar.barPaths(barDeps);
  const on = bar.barEnabled();
  say(`Menu bar app: ${on ? 'on' : 'off'}`, `메뉴 막대 앱: ${on ? '켜짐' : '꺼짐'}`);
  const running = bar.barRunning(barDeps);
  if (running) {
    say(`Running: yes (pid ${running.pid}, build ${running.version ?? 'unknown'})`,
      `실행 중: 예 (pid ${running.pid}, 빌드 ${running.version ?? '알 수 없음'})`);
  } else {
    say('Running: no', '실행 중: 아니요');
  }
  const exists = barDeps.exists ?? (await import('node:fs')).existsSync;
  if (exists(paths.binary)) {
    say(`Compiled (build ${paths.version}): yes (${paths.binary})`, `컴파일 (빌드 ${paths.version}): 있음 (${paths.binary})`);
  } else {
    say(`Compiled (build ${paths.version}): no`, `컴파일 (빌드 ${paths.version}): 없음`);
  }
  if (platform === 'darwin') {
    const swiftc = bar.findSwiftc(barDeps);
    say(swiftc ? `Swift toolchain: found (${swiftc})` : 'Swift toolchain: missing (xcode-select --install)',
      swiftc ? `Swift 도구: 있음 (${swiftc})` : 'Swift 도구: 없음 (xcode-select --install)');
  } else {
    say('Swift toolchain: not needed, the app only works on macOS', 'Swift 도구: 필요 없음, 앱은 macOS에서만 동작합니다');
  }
  if (exists(paths.launcher)) {
    say(`Launcher app: yes (${paths.launcher})`, `응용 프로그램 실행기: 있음 (${paths.launcher})`);
  } else {
    say('Launcher app: no', '응용 프로그램 실행기: 없음');
  }
  const state = bar.readBuildState(barDeps);
  if (state?.error) {
    say(`Last build error (${state.version ?? 'unknown build'}):\n${indent(state.error)}`,
      `마지막 컴파일 오류 (${state.version ?? '알 수 없는 빌드'}):\n${indent(state.error)}`);
  }
}

export async function run({ args = [], hasFlag, deps = {} }) {
  const { collect = collectActivity, stdout = process.stdout, stderr = process.stderr } = deps;
  if (BAR_SUBCOMMANDS.has(args[1])) return runSubcommand(args[1], { hasFlag, deps });
  if (hasFlag('--plugin')) {
    stdout.write(pluginScript());
    return;
  }
  if (hasFlag('--settings')) {
    // Loaded only here: the snapshot path runs every few seconds and needs none of it.
    const settings = deps.settings ?? (await import('../bar-settings.js')).collectSettings;
    stdout.write(`${JSON.stringify(settings(), null, 2)}\n`);
    return;
  }
  if (hasFlag('--rules')) {
    const rules = deps.rules ?? (await import('../bar-rules.js')).collectRules;
    stdout.write(`${JSON.stringify(rules(), null, 2)}\n`);
    return;
  }
  const json = hasFlag('--json');
  const swiftbar = hasFlag('--swiftbar');
  if (json && swiftbar) {
    stderr.write('sprag bar: --json and --swiftbar cannot be combined\n');
    process.exitCode = 2;
    return;
  }
  const detail = hasFlag('--detail');
  if (detail && !json) {
    stderr.write('sprag bar: --detail needs --json\n');
    process.exitCode = 2;
    return;
  }
  const snapshot = detail ? collect({ detail: true }) : collect();
  const text = json ? JSON.stringify(snapshot, null, 2) : swiftbar ? renderSwiftBar(snapshot) : renderText(snapshot);
  stdout.write(`${text}\n`);
}
