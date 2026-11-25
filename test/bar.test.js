// `sprag bar`: the activity snapshot (src/agent-activity.js) and its three
// renderings (src/commands/bar.js). Every input is injected: no real ~/.claude,
// no real user data folder, no real ~/.codex, no real `ps` or `lsof`, and the
// CLI is never spawned. collect() below supplies the defaults.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  parsePs, readClaudeSessions, pendingTools, collectActivity, PS_ARGS, pickTitle,
} from '../src/agent-activity.js';
import {
  formatDuration, formatMem, formatTokens, formatUsd, activityLabel, renderText, renderSwiftBar, pluginScript, run,
} from '../src/commands/bar.js';
import { encodeProjectDir } from '../src/commands/panel.js';
import { peekCached } from '../src/session-cache.js';
import { windowLabel } from '../src/window-labels.js';
import { estimateCost } from '../src/cost.js';
import { toolTarget, sessionDetail, sessionTitleHints } from '../src/agent-detail.js';
import { collectSettings } from '../src/bar-settings.js';
import { collectRules } from '../src/bar-rules.js';
import { currentWarnings, QUIET_CHIPS } from '../src/agent-warnings.js';
import { newestRenderAt } from '../src/statusline-guard.js';
import { readChipState } from '../src/history.js';
import { CAP_PRESSURE_CRITICAL } from '../src/caps-cache.js';

const NOW = 1_700_000_100_000;
const CWD = '/home/me/proj';

function tmp(t, prefix = 'sprag-bar-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeSession(claudeDir, pid, extra = {}) {
  mkdirSync(join(claudeDir, 'sessions'), { recursive: true });
  const body = { pid, sessionId: `sid-${pid}`, cwd: CWD, name: `proj-${pid}`, status: 'idle', statusUpdatedAt: NOW - 12_000, updatedAt: NOW, kind: 'interactive', ...extra };
  writeFileSync(join(claudeDir, 'sessions', `${pid}.json`), JSON.stringify(body));
}

function writeTranscript(claudeDir, sessionId, lines, cwd = CWD) {
  const dir = join(claudeDir, 'projects', encodeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const use = (id, name) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
const result = (id) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

const PS_TEXT = [
  '  100     1   1.5  10240 /opt/my apps/claude',
  '  101   100  10.0 102400 /bin/zsh',
  '  102   101   5.0  51200 node',
  '  200   102  20.0 204800 claude',
  '  201   200   2.5  20480 /usr/bin/rg',
  '  300     1   0.0   1000 /usr/bin/vim',
  '  400     1   3.0  40960 /usr/local/bin/codex',
  '  401   400   1.0  10240 codex',
  '  402   401   0.5   5120 /usr/bin/rg',
  '  500     1   9.9   9999 /usr/bin/unrelated',
].join('\n');

const noChip = () => null;
const MIN = 60_000;

/**
 * collectActivity with every outside input pointed at a temp folder or a stub:
 * the user data folder, the Codex home, `lsof`, the core count and the env.
 * Pass any of them to override.
 */
function collect(t, opts = {}) {
  return collectActivity({
    dataDir: tmp(t, 'sprag-bar-data-'),
    codexHome: tmp(t, 'sprag-bar-codex-'),
    openFiles: () => null,
    cores: 4,
    env: {},
    readChip: noChip,
    now: NOW,
    selfPid: -1,
    lang: 'en',
    ...opts,
  });
}

function writeJson(dir, name, data) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(data));
}

/** A transcript line shaped like Claude Code's own: model, then usage in the order the reader expects. */
const turn = (usage, { model = 'claude-opus-5-5', sidechain = false } = {}) => JSON.stringify({
  type: 'assistant', isSidechain: sidechain,
  message: { model, usage: { input_tokens: usage[0], cache_creation_input_tokens: usage[1], cache_read_input_tokens: usage[2], output_tokens: 7 } },
});

/** A rollout under the local-date folder of `at`, with its mtime set to `at`. */
function writeRollout(codexHome, name, lines, at = NOW) {
  const d = new Date(at);
  const dir = join(codexHome, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-${name}.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  utimesSync(file, new Date(at), new Date(at));
  return file;
}

const ts = (ms) => new Date(ms).toISOString();
const rolloutLines = ({ cwd = '/home/me/proj-x', model = 'gpt-5.5-codex', effort = 'high', status = 'task_started', context = 90_000, total, limits, meta = {} } = {}) => [
  { timestamp: ts(NOW - 5 * MIN), type: 'session_meta', payload: { id: 'cdx-1', cwd, source: 'cli', ...meta } },
  { timestamp: ts(NOW - 4 * MIN), type: 'turn_context', payload: { model, effort } },
  { timestamp: ts(NOW - 3 * MIN), type: 'event_msg', payload: { type: status } },
  { timestamp: ts(NOW - 2 * MIN), type: 'event_msg', payload: {
    type: 'token_count',
    info: { total_token_usage: total ?? { input_tokens: 100_000, cached_input_tokens: 60_000, output_tokens: 500 }, last_token_usage: { input_tokens: context }, model_context_window: 200_000 },
    rate_limits: limits ?? {
      primary: { used_percent: 12, window_minutes: 300, resets_at: NOW / 1000 + 600 },
      secondary: { used_percent: 3.4, window_minutes: 10_080, resets_at: NOW / 1000 + 86_400 },
      plan_type: 'plus',
    },
  } },
];

test('parsePs reads spaces in comm and skips lines of another shape', () => {
  const table = parsePs(['  100     1   1.5  10240 /opt/my apps/claude', 'PID PPID', 'garbage', '', '  7 1 x 5 y', '   8   1  0.0  5 sh'].join('\n'));
  assert.deepEqual([...table.keys()], [100, 8]);
  assert.deepEqual(table.get(100), { pid: 100, ppid: 1, cpu: 1.5, rssKb: 10240, comm: '/opt/my apps/claude' });
  assert.equal(parsePs(null).size, 0);
  assert.ok(PS_ARGS.includes('pid=,ppid=,pcpu=,rss=,comm='));
});

test('readClaudeSessions skips malformed files, other extensions and the .key files', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100);
  const dir = join(claudeDir, 'sessions');
  writeFileSync(join(dir, '101.json'), '{not json');
  writeFileSync(join(dir, '102.json'), JSON.stringify({ pid: 'x', sessionId: 's' }));
  writeFileSync(join(dir, '103.json'), JSON.stringify({ pid: 103, sessionId: 5 }));
  writeFileSync(join(dir, '100.abc.key'), JSON.stringify({ pid: 999, sessionId: 'leak' }));
  assert.deepEqual(readClaudeSessions(claudeDir).map((s) => s.pid), [100]);
});

test('stale session files are dropped: pid missing from ps, or reused by another program', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100);
  writeSession(claudeDir, 300); // vim now owns pid 300
  writeSession(claudeDir, 999); // not running at all
  const snap = collect(t, { claudeDir, ps: () => parsePs(PS_TEXT), now: NOW, readChip: noChip });
  assert.deepEqual(snap.sessions.filter((s) => s.agent === 'claude').map((s) => s.pid), [100]);
});

test('CPU and memory climb to the nearest session root, so an inner session is not counted twice', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100, { status: 'busy' });
  writeSession(claudeDir, 200, { status: 'busy', name: 'inner' });
  const snap = collect(t, { claudeDir, ps: () => parsePs(PS_TEXT), now: NOW, readChip: noChip });
  const outer = snap.sessions.find((s) => s.pid === 100);
  const inner = snap.sessions.find((s) => s.pid === 200);
  assert.deepEqual([outer.cpu, outer.rssMb, outer.procs], [16.5, 160, 3]); // 100, 101, 102
  assert.deepEqual([inner.cpu, inner.rssMb, inner.procs], [22.5, 220, 2]); // 200, 201
  assert.equal(snap.totals.procs, outer.procs + inner.procs + 3); // + the codex row
  assert.equal(snap.totals.sessions, 3);
  assert.equal(snap.totals.busy, 2);
});

test('a codex process with no codex or Claude session above it is one row, and its children count for it', (t) => {
  const claudeDir = tmp(t);
  const snap = collect(t, { claudeDir, ps: () => parsePs(PS_TEXT), now: NOW, readChip: noChip });
  assert.equal(snap.sessions.length, 1);
  assert.deepEqual(snap.sessions[0], {
    agent: 'codex', pid: 400, sessionId: null, name: 'codex', title: null, project: null, cwd: null, kind: null,
    state: null, stateSince: null, tools: [], subagents: 0,
    model: null, modelName: null, effort: null, context: null, usage: null,
    cpu: 4.5, cpuPct: 1.1, rssMb: 55, procs: 3,
  });
  // A codex started inside a Claude session is part of that session, not a row.
  writeSession(claudeDir, 100);
  const table = parsePs(`${PS_TEXT}\n  600   101   1.0  1024 codex`);
  const again = collect(t, { claudeDir, ps: () => table, now: NOW, readChip: noChip });
  assert.deepEqual(again.sessions.map((s) => `${s.agent}:${s.pid}`).sort(), ['claude:100', 'codex:400']);
});

test('pendingTools returns only calls without a result, in order, and [] for an unreadable file', (t) => {
  const claudeDir = tmp(t);
  const file = writeTranscript(claudeDir, 'sid-x', [use('t1', 'Read'), result('t1'), use('t2', 'Bash'), use('t3', 'Edit'), result('t3'), use('t4', 'Grep')]);
  assert.deepEqual(pendingTools(file), ['Bash', 'Grep']);
  assert.deepEqual(pendingTools(join(claudeDir, 'missing.jsonl')), []);
  assert.deepEqual(pendingTools(null), []);
});

test('tools show only while the session is busy', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100, { status: 'busy' });
  writeSession(claudeDir, 200, { status: 'idle' });
  for (const pid of [100, 200]) writeTranscript(claudeDir, `sid-${pid}`, [use('t1', 'Bash')]);
  const snap = collect(t, { claudeDir, ps: () => parsePs(PS_TEXT), now: NOW, readChip: noChip });
  assert.deepEqual(snap.sessions.find((s) => s.pid === 100).tools, ['Bash']);
  assert.deepEqual(snap.sessions.find((s) => s.pid === 200).tools, []);
});

test('subagents counts runs still working', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100, { status: 'busy' });
  const file = writeTranscript(claudeDir, 'sid-100', [use('t1', 'Task')]);
  const sub = join(file.slice(0, -'.jsonl'.length), 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-a.jsonl'), '{"model":"claude-sonnet-5-5"}\n');
  writeFileSync(join(sub, 'agent-b.jsonl'), '{"model":"claude-sonnet-5-5"}\n');
  writeFileSync(join(sub, 'agent-b.meta.json'), '{"finished":true}');
  const snap = collect(t, { claudeDir, ps: () => parsePs(PS_TEXT), now: Date.now(), readChip: noChip });
  assert.equal(snap.sessions[0].subagents, 1);
  assert.equal(snap.totals.subagents, 1);
});

test('name falls back to the project folder, then to "claude <pid>"; state passes through untouched', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100, { name: '', status: 'thinking', statusUpdatedAt: 'x' });
  writeSession(claudeDir, 200, { name: undefined, cwd: undefined, status: undefined });
  const snap = collect(t, { claudeDir, ps: () => parsePs(PS_TEXT), now: NOW, readChip: noChip });
  const a = snap.sessions.find((s) => s.pid === 100);
  const b = snap.sessions.find((s) => s.pid === 200);
  assert.deepEqual([a.name, a.project, a.state, a.stateSince], ['proj', 'proj', 'thinking', null]);
  assert.deepEqual([b.name, b.project, b.cwd, b.state], ['claude 200', null, null, null]);
});

test('without ps the rows stay, resources is false and every measure is null', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100, { status: 'busy' });
  const alive = [];
  const snap = collect(t, { claudeDir, ps: () => null, isAlive: (pid) => { alive.push(pid); return pid === 100; }, now: NOW, readChip: noChip });
  assert.deepEqual(alive, [100]);
  assert.equal(snap.resources, false);
  assert.deepEqual(snap.totals, { sessions: 1, busy: 1, warnings: 0, subagents: 0, cpu: null, cpuPct: null, costUsd: null, rssMb: null, procs: null });
  assert.equal(snap.sessions[0].cpuPct, null);
  assert.deepEqual([snap.sessions[0].cpu, snap.sessions[0].rssMb, snap.sessions[0].procs], [null, null, null]);
  const thrown = collect(t, { claudeDir, ps: () => { throw new Error('no ps'); }, isAlive: () => true, now: NOW, readChip: noChip });
  assert.equal(thrown.resources, false);
});

test('a missing sessions folder gives an empty result, and a throwing readChip gives no animal', (t) => {
  const claudeDir = tmp(t);
  const snap = collect(t, { claudeDir, ps: () => parsePs('  500 1 1.0 1000 /usr/bin/unrelated'), now: NOW, readChip: () => { throw new Error('boom'); } });
  assert.deepEqual(snap.sessions, []);
  assert.equal(snap.animal, null);
  assert.deepEqual(snap.totals, { sessions: 0, busy: 0, warnings: 0, subagents: 0, cpu: 0, cpuPct: 0, costUsd: null, rssMb: 0, procs: 0 });
  assert.equal(snap.at, NOW);
});

test('the animal comes from the team grade, and an unknown grade gives none', (t) => {
  const claudeDir = tmp(t);
  const grade = (g) => collect(t, { claudeDir, ps: () => null, now: NOW, readChip: () => ({ standing: { grade: g } }) }).animal;
  assert.deepEqual(grade('lion'), { grade: 'lion', emoji: '🦁' });
  assert.equal(grade('not-a-grade'), null);
});

test('the standing carries the rank, the score percentile and the next species beside the animal', (t) => {
  const claudeDir = tmp(t);
  const standingOf = (st, lang = 'en', org = 'acmeco') => collect(t, { claudeDir, ps: () => null, lang, readChip: () => ({ org, standing: st }) }).standing;
  const st = { grade: 'husky', rank: 3, ranked: 10, crown: false, idle: false, scorePct: 0.7, spendRank: 2, dlgRank: 4, next: { grade: 'owl', pass: 1, needDlg: false } };
  assert.deepEqual(standingOf(st), {
    grade: 'husky', emoji: '🐕', name: 'Husky', org: 'acmeco', rank: 3, ranked: 10, crown: false, idle: false, scorePct: 70,
    spendRank: 2, dlgRank: 4, next: { grade: 'owl', emoji: '🦉', name: 'Owl', floorPct: 71, pass: 1, needDlg: false },
  });
  const ko = standingOf({ ...st, crown: true, next: null, ranked: 2, rank: 1 }, 'ko', null);
  assert.deepEqual([ko.name, ko.org, ko.crown, ko.next], ['허스키', null, true, null]);
  // No team, or a grade this version does not know: no standing and no animal.
  assert.equal(collect(t, { claudeDir, ps: () => null, readChip: () => null }).standing, null);
  assert.equal(standingOf({ grade: 'not-a-grade' }), null);
});

test('rows sort busy first, then by name and pid, and never by a live reading', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100, { status: 'idle', name: 'a' });
  writeSession(claudeDir, 200, { status: 'busy', name: 'z' });
  writeSession(claudeDir, 600, { status: 'busy', name: 'b' });
  writeSession(claudeDir, 700, { status: 'idle', name: 'a' });
  const order = (cpu600, cpu700) => collect(t, {
    claudeDir, now: NOW, readChip: noChip,
    ps: () => parsePs(`${PS_TEXT}\n  600 1 ${cpu600} 1024 claude\n  700 1 ${cpu700} 1024 claude`),
  }).sessions.map((s) => `${s.name}:${s.pid}`);
  const want = ['b:600', 'z:200', 'a:100', 'a:700', 'codex:400'];
  assert.deepEqual(order('30.0', '0.0'), want);
  // The same sessions with the CPU load moved around keep their places.
  assert.deepEqual(order('0.0', '90.0'), want);
});

test('the process taking the snapshot and its children are charged to no session', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100);
  // Only pid 100 has a session file, so everything under it is its own: 101, 102, 200, 201.
  // 102 plays the `sprag bar` process and 150 the `ps` it started.
  const table = parsePs(`${PS_TEXT}\n  150 102 40.0 4096 /bin/ps`);
  const row = (selfPid) => collect(t, { claudeDir, ps: () => table, selfPid }).sessions.find((s) => s.pid === 100);
  assert.equal(row(-1).procs, 6);
  // With 102 as the measuring process, it and all below it (150, 200, 201) drop out.
  const own = row(102);
  assert.deepEqual([own.procs, own.cpu, own.rssMb], [2, 11.5, Math.round((10240 + 102400) / 1024)]);
});

test('formatDuration, formatMem and activityLabel', () => {
  assert.deepEqual([0, 12_000, 59_999, 60_000, 18 * 60_000, 5 * 3_600_000, 47 * 3_600_000, 48 * 3_600_000, 3 * 86_400_000].map(formatDuration),
    ['0s', '12s', '59s', '1m', '18m', '5h', '47h', '2d', '3d']);
  assert.deepEqual([-1, NaN, undefined].map(formatDuration), ['', '', '']);
  assert.equal(formatMem(598), '598 MB');
  assert.equal(formatMem(1023), '1023 MB');
  assert.equal(formatMem(2807), '2.7 GB');
  assert.equal(activityLabel({ tools: ['Bash'], subagents: 0 }), 'Bash');
  assert.equal(activityLabel({ tools: ['Bash', 'Read', 'Edit'], subagents: 2 }), 'Bash +2 ⤷2');
  assert.equal(activityLabel({ tools: [], subagents: 1 }), '⤷1');
  assert.equal(activityLabel({ tools: [], subagents: 0 }), '');
});

test('cpuPct is the machine share: cpu divided by cores, one decimal, null without ps', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100, { status: 'busy' });
  writeSession(claudeDir, 200, { status: 'busy', name: 'inner' });
  const snap = collect(t, { claudeDir, ps: () => parsePs(PS_TEXT), cores: 4 });
  assert.equal(snap.cores, 4);
  assert.equal(snap.sessions.find((s) => s.pid === 100).cpuPct, 4.1); // 16.5 / 4 = 4.125
  assert.equal(snap.sessions.find((s) => s.pid === 200).cpuPct, 5.6); // 22.5 / 4 = 5.625
  assert.equal(snap.totals.cpu, 43.5);
  assert.equal(snap.totals.cpuPct, 10.9); // 43.5 / 4 = 10.875
  const eight = collect(t, { claudeDir, ps: () => parsePs(PS_TEXT), cores: 8 });
  assert.equal(eight.totals.cpuPct, 5.4);
  const none = collect(t, { claudeDir, ps: () => null, isAlive: () => true });
  assert.equal(none.totals.cpuPct, null);
  // Without an injected count the machine's own is used.
  const real = collectActivity({ claudeDir, dataDir: tmp(t), codexHome: tmp(t), openFiles: () => null, env: {}, ps: () => null, isAlive: () => false, readChip: noChip, now: NOW });
  assert.ok(Number.isInteger(real.cores) && real.cores >= 1);
});

test('Claude limits: windows from the snapshot, seconds to milliseconds, expired and unreadable windows left out', (t) => {
  const dataDir = tmp(t);
  const claudeDir = tmp(t);
  const reset = NOW / 1000 + 3600;
  writeJson(dataDir, 'last-caps.json', {
    capturedAt: Date.now(),
    caps: { windows: [
      { key: 'five_hour', usedPct: 12, resetsAt: reset },
      { key: 'seven_day', usedPct: 19.4, resetsAt: NOW / 1000 - 10 }, // already reset
      { key: 'seven_day_sonnet', usedPct: 'x', resetsAt: reset }, // no usable percentage
      { key: 'spend_limit', usedPct: 50, resetsAt: null, spend: 5, maxBudget: 10 },
    ] },
  });
  const snap = collect(t, { claudeDir, dataDir, ps: () => null });
  assert.deepEqual(snap.usage.claude, { windows: [
    { key: 'five_hour', label: '5H', usedPct: 12, resetsAt: reset * 1000 },
    { key: 'spend_limit', label: 'BUDGET', usedPct: 50, resetsAt: null, spend: 5, maxBudget: 10 },
  ] });
  assert.equal(snap.usage.codex, null);
  // A snapshot older than 30 minutes is a statusline that stopped: no limits rather than old ones.
  writeJson(dataDir, 'last-caps.json', { capturedAt: Date.now() - 31 * MIN, caps: { windows: [{ key: 'five_hour', usedPct: 12, resetsAt: reset }] } });
  assert.equal(collect(t, { claudeDir, dataDir, ps: () => null }).usage.claude, null);
  // Only expired windows leave nothing to show.
  writeJson(dataDir, 'last-caps.json', { capturedAt: Date.now(), caps: { windows: [{ key: 'five_hour', usedPct: 12, resetsAt: NOW / 1000 }] } });
  assert.equal(collect(t, { claudeDir, dataDir, ps: () => null }).usage.claude, null);
});

test('Claude context: the newest main-thread prompt, skipping sidechain lines, with or without a window', (t) => {
  const claudeDir = tmp(t);
  const dataDir = tmp(t);
  writeSession(claudeDir, 100);
  writeTranscript(claudeDir, 'sid-100', [
    turn([5, 100, 1000]),
    turn([10, 5000, 160_990]), // 166000 in all
    turn([1, 2, 900_000], { sidechain: true }), // a subagent's prompt is not this session's context
  ]);
  const table = parsePs(PS_TEXT);
  const row = (d) => collect(t, { claudeDir, dataDir: d, ps: () => table }).sessions.find((s) => s.pid === 100);
  assert.deepEqual(row(dataDir).context, { tokens: 166_000, window: null, pct: null });
  writeJson(dataDir, 'ctx-window.json', { sessions: { 'sid-100': { size: 1_000_000, ts: Date.now() } } });
  assert.deepEqual(row(dataDir).context, { tokens: 166_000, window: 1_000_000, pct: 17 });
  // No usage line in the tail: nothing to report.
  writeTranscript(claudeDir, 'sid-100', [use('t1', 'Bash')]);
  assert.equal(row(dataDir).context, null);
  // A tool result larger than the 256 KiB tail hides the last request: the wider second look finds it.
  writeTranscript(claudeDir, 'sid-100', [turn([10, 5000, 160_990]), JSON.stringify({ type: 'user', message: { content: 'x'.repeat(300 * 1024) } })]);
  assert.equal(row(dataDir).context.tokens, 166_000);
});

test('Claude model: the statusline-reported id first, else the last real model in the transcript, never <synthetic>', (t) => {
  const claudeDir = tmp(t);
  const dataDir = tmp(t);
  writeSession(claudeDir, 100);
  writeTranscript(claudeDir, 'sid-100', [turn([1, 1, 1], { model: 'claude-opus-5-5' }), turn([1, 1, 1], { model: 'claude-sonnet-5-5' }), turn([0, 0, 0], { model: '<synthetic>' })]);
  const row = () => collect(t, { claudeDir, dataDir, ps: () => parsePs(PS_TEXT) }).sessions.find((s) => s.pid === 100);
  assert.deepEqual([row().model, row().modelName], ['claude-sonnet-5-5', 'Sonnet 5.5']);
  writeJson(dataDir, 'ctx-window.json', { sessions: { 'sid-100': { size: 1_000_000, ts: Date.now(), model: 'claude-opus-5-5' } } });
  assert.deepEqual([row().model, row().modelName, row().effort], ['claude-opus-5-5', 'Opus 5.5', null]);
  writeTranscript(claudeDir, 'sid-100', [use('t1', 'Bash')]);
  writeJson(dataDir, 'ctx-window.json', { sessions: {} });
  assert.deepEqual([row().model, row().modelName], [null, null]);
});

test('Claude usage: the session and its subagent transcripts from the parse cache, never another session', (t) => {
  const claudeDir = tmp(t);
  const dataDir = tmp(t);
  writeSession(claudeDir, 100);
  const transcript = writeTranscript(claudeDir, 'sid-100', [turn([1, 1, 1])]);
  const totals = (input, cacheCreation, cacheRead, output) => ({ input, cacheCreation, cacheRead, ephemeral5m: 0, ephemeral1h: 0, output });
  const entry = (requestCount, tot, compactions = 0) => ({ mtimeMs: 1, size: 1, s: { sessionId: 'sid-100', startTime: null, endTime: null, requestCount, totals: tot, maxContextPerRequest: 0, model: 'claude-sonnet-5-5', gatewayObserved: false, compactions } });
  const subDir = join(dirname(transcript), 'sid-100', 'subagents');
  // mtime and size no longer match the file on purpose: the display reads the last stored summary.
  writeJson(dataDir, 'session-cache.json', { version: 7, entries: {
    [transcript]: entry(3, totals(1_000_000, 500_000, 2_000_000, 20_000), 2),
    [join(subDir, 'agent-a.jsonl')]: entry(2, totals(100_000, 5_000, 100_000, 4_000), 5),
    [join(dirname(transcript), 'sid-1000', 'subagents', 'agent-x.jsonl')]: entry(9, totals(9999, 9999, 9999, 9999)), // another session whose id starts the same
    [join(dirname(transcript), 'sid-200.jsonl')]: entry(9, totals(9999, 9999, 9999, 9999)),
  } });
  const row100 = collect(t, { claudeDir, dataDir, ps: () => parsePs(PS_TEXT) }).sessions.find((s) => s.pid === 100);
  const usage = row100.usage;
  // The row carries the session's own compaction count, not its subagent's.
  assert.equal(row100.compactions, 2);
  assert.deepEqual(usage.tokens, { input: 1_100_000, cacheRead: 2_100_000, cacheWrite: 505_000, output: 24_000 });
  assert.equal(usage.requests, 5);
  const expected = estimateCost(totals(1_000_000, 500_000, 2_000_000, 20_000), 'claude-sonnet-5-5').actual + estimateCost(totals(100_000, 5_000, 100_000, 4_000), 'claude-sonnet-5-5').actual;
  assert.ok(usage.costUsd > 0);
  assert.ok(Math.abs(usage.costUsd - expected) <= 0.011, `${usage.costUsd} vs ${expected}`);
  assert.equal(Math.round(usage.costUsd * 100) / 100, usage.costUsd);
  // No cache file, or no entry for the session: null, and the snapshot total has no cost.
  const none = collect(t, { claudeDir, ps: () => parsePs(PS_TEXT) });
  assert.equal(none.sessions.find((s) => s.pid === 100).usage, null);
  assert.equal(none.sessions.find((s) => s.pid === 100).compactions, null);
  assert.equal(none.totals.costUsd, null);
  // totals.costUsd adds the rows that have a cost.
  const snap = collect(t, { claudeDir, dataDir, ps: () => parsePs(PS_TEXT) });
  assert.equal(snap.totals.costUsd, usage.costUsd);
});

test('totals.costUsd sums the numeric row costs to the cent and is null when no row has one', (t) => {
  const claudeDir = tmp(t);
  const dataDir = tmp(t);
  writeSession(claudeDir, 100);
  writeSession(claudeDir, 200);
  const tr = (id) => writeTranscript(claudeDir, id, [turn([1, 1, 1])]);
  const totals = { input: 1_000_000, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 };
  const e = { mtimeMs: 1, size: 1, s: { sessionId: 'x', startTime: null, endTime: null, requestCount: 1, totals, maxContextPerRequest: 0, model: 'claude-sonnet-5-5', gatewayObserved: false } };
  writeJson(dataDir, 'session-cache.json', { version: 7, entries: { [tr('sid-100')]: e, [tr('sid-200')]: e } });
  const snap = collect(t, { claudeDir, dataDir, ps: () => parsePs(PS_TEXT) });
  const each = estimateCost(totals, 'claude-sonnet-5-5').actual;
  const costs = snap.sessions.filter((s) => s.agent === 'claude').map((s) => s.usage.costUsd);
  assert.equal(costs.length, 2);
  assert.equal(snap.totals.costUsd, Math.round((costs[0] + costs[1]) * 100) / 100);
  assert.ok(Math.abs(snap.totals.costUsd - 2 * each) <= 0.02);
});

test('Codex rows are tied to their rollout through the files the process holds open, children included', (t) => {
  const claudeDir = tmp(t);
  const codexHome = tmp(t);
  writeRollout(codexHome, 'old', rolloutLines({ cwd: '/home/me/other' }), NOW - 5 * MIN);
  const mine = writeRollout(codexHome, 'mine', rolloutLines({ total: { input_tokens: 100_000, cached_input_tokens: 60_000, cache_write_input_tokens: 7, output_tokens: 500 } }), NOW - 2 * MIN);
  writeRollout(codexHome, 'newest', rolloutLines({ cwd: '/home/me/newest' }), NOW - MIN);
  const calls = [];
  // The native binary (pid 401, under the wrapper 400) is the one holding the rollout.
  const openFiles = (pids) => { calls.push(pids); return new Map([[400, ['/dev/null', '/home/me/.config/x.log']], [401, ['/dev/null', mine]]]); };
  const snap = collect(t, { claudeDir, codexHome, openFiles, ps: () => parsePs(PS_TEXT) });
  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0]].sort(), [400, 401]);
  const row = snap.sessions[0];
  assert.deepEqual([row.agent, row.name, row.project, row.cwd], ['codex', 'proj-x', 'proj-x', '/home/me/proj-x']);
  assert.deepEqual([row.model, row.modelName, row.effort, row.state, row.stateSince], ['gpt-5.5-codex', 'gpt-5.5-codex', 'high', 'busy', null]);
  assert.deepEqual(row.context, { tokens: 90_000, window: 200_000, pct: 45 });
  assert.deepEqual(row.usage, { tokens: { input: 40_000, cacheRead: 60_000, cacheWrite: 7, output: 500 }, requests: null, costUsd: null });
  assert.equal(snap.totals.costUsd, null);
});

test('Codex state: working is busy, idle and interrupted are idle, nothing is null', (t) => {
  const claudeDir = tmp(t);
  const state = (status) => {
    const codexHome = tmp(t);
    const file = writeRollout(codexHome, 'a', rolloutLines({ status }), NOW - MIN);
    return collect(t, { claudeDir, codexHome, openFiles: () => new Map([[400, [file]]]), ps: () => parsePs(PS_TEXT) }).sessions[0].state;
  };
  assert.deepEqual(['task_started', 'task_complete', 'turn_aborted'].map(state), ['busy', 'idle', 'idle']);
  const codexHome = tmp(t);
  const bare = writeRollout(codexHome, 'a', [{ timestamp: ts(NOW), type: 'session_meta', payload: { id: 'x', cwd: '/home/me/bare' } }], NOW - MIN);
  const row = collect(t, { claudeDir, codexHome, openFiles: () => new Map([[400, [bare]]]), ps: () => parsePs(PS_TEXT) }).sessions[0];
  assert.deepEqual([row.state, row.model, row.context, row.usage, row.name], [null, null, null, null, 'bare']);
});

test('a lone Codex row with no open rollout takes the newest one written in the last 15 minutes', (t) => {
  const claudeDir = tmp(t);
  const codexHome = tmp(t);
  writeRollout(codexHome, 'stale', rolloutLines({ cwd: '/home/me/stale' }), NOW - 20 * MIN);
  const run1 = (openFiles) => collect(t, { claudeDir, codexHome, openFiles, ps: () => parsePs(PS_TEXT) }).sessions[0];
  // Nothing within 15 minutes: no guess.
  assert.deepEqual([run1(() => null).name, run1(() => null).model], ['codex', null]);
  writeRollout(codexHome, 'fresh-a', rolloutLines({ cwd: '/home/me/fresh-a' }), NOW - 10 * MIN);
  writeRollout(codexHome, 'fresh-b', rolloutLines({ cwd: '/home/me/fresh-b' }), NOW - 5 * MIN);
  assert.equal(run1(() => null).name, 'fresh-b'); // no lsof at all
  assert.equal(run1(() => new Map([[400, ['/dev/null']]])).name, 'fresh-b'); // lsof found no rollout
  assert.equal(run1(() => { throw new Error('lsof failed'); }).name, 'fresh-b');
});

test('with several Codex rows and no open rollout nothing is tied, and lsof is not run without a Codex row', (t) => {
  const claudeDir = tmp(t);
  const codexHome = tmp(t);
  writeRollout(codexHome, 'fresh', rolloutLines(), NOW - MIN);
  const two = parsePs(`${PS_TEXT}\n  410     1   1.0  1024 codex`);
  const snap = collect(t, { claudeDir, codexHome, openFiles: () => new Map(), ps: () => two });
  const codex = snap.sessions.filter((s) => s.agent === 'codex');
  assert.equal(codex.length, 2);
  for (const r of codex) assert.deepEqual([r.name, r.model, r.context, r.usage], ['codex', null, null, null]);
  // Each row can still be tied when lsof names its rollout.
  const file = writeRollout(codexHome, 'second', rolloutLines({ cwd: '/home/me/second' }), NOW - 3 * MIN);
  const tied = collect(t, { claudeDir, codexHome, openFiles: () => new Map([[410, [file]]]), ps: () => two }).sessions.filter((s) => s.agent === 'codex');
  assert.deepEqual(tied.map((r) => r.name).sort(), ['codex', 'second']);
  // No Codex row: lsof is never called.
  writeSession(claudeDir, 100);
  let called = 0;
  collect(t, { claudeDir, codexHome, openFiles: () => { called++; return null; }, ps: () => parsePs('  100 1 1.0 1000 claude') });
  assert.equal(called, 0);
});

test('a rollout whose session_meta line is longer than the head read still gives its folder', (t) => {
  const claudeDir = tmp(t);
  const codexHome = tmp(t);
  const file = writeRollout(codexHome, 'big', rolloutLines({ meta: { instructions: 'x'.repeat(80_000) } }), NOW - MIN);
  const row = collect(t, { claudeDir, codexHome, openFiles: () => new Map([[400, [file]]]), ps: () => parsePs(PS_TEXT) }).sessions[0];
  assert.deepEqual([row.name, row.cwd], ['proj-x', '/home/me/proj-x']);
});

test('Codex limits come from the newest rollout of the last 24 hours, with no Codex running; expired windows and old files do not count', (t) => {
  const claudeDir = tmp(t);
  const codexHome = tmp(t);
  const none = () => collect(t, { claudeDir, codexHome, ps: () => parsePs('  500 1 1.0 1000 /usr/bin/unrelated') }).usage.codex;
  assert.equal(none(), null);
  writeRollout(codexHome, 'ancient', rolloutLines(), NOW - 25 * 3_600_000);
  assert.equal(none(), null);
  writeRollout(codexHome, 'older', rolloutLines({ limits: { primary: { used_percent: 99, window_minutes: 300, resets_at: NOW / 1000 + 5 } } }), NOW - 2 * 3_600_000);
  writeRollout(codexHome, 'newest', rolloutLines(), NOW - 3 * MIN);
  assert.deepEqual(none(), { plan: 'plus', at: NOW - 3 * MIN, windows: [
    { key: 'primary', label: '5H', usedPct: 12, resetsAt: (NOW / 1000 + 600) * 1000 },
    { key: 'secondary', label: '7D', usedPct: 3.4, resetsAt: (NOW / 1000 + 86_400) * 1000 },
  ] });
  // A window that already reset is dropped; no plan_type gives null.
  writeRollout(codexHome, 'newest', rolloutLines({ limits: {
    primary: { used_percent: 12, window_minutes: 300, resets_at: NOW / 1000 - 1 },
    secondary: { used_percent: 0, window_minutes: 43_200, resets_at: NOW / 1000 + 10 },
  } }), NOW - MIN);
  assert.deepEqual(none(), { plan: null, at: NOW - MIN, windows: [{ key: 'secondary', label: '30D', usedPct: 0, resetsAt: (NOW / 1000 + 10) * 1000 }] });
});

test('peekCached returns the stored summary whatever the file looks like now, and null without an entry', () => {
  const stored = { sessionId: 's1', startTime: 5, endTime: 9, requestCount: 4, totals: { input: 1 }, maxContextPerRequest: 3, model: 'claude-opus-5-5' };
  const cache = { entries: { '/p/a.jsonl': { mtimeMs: 1, size: 2, s: stored } } };
  const got = peekCached(cache, '/p/a.jsonl', '/p');
  assert.equal(got.sessionId, 's1');
  assert.equal(got.filePath, '/p/a.jsonl');
  assert.equal(got.projectDir, '/p');
  assert.equal(got.requestCount, 4);
  assert.ok(got.startTime instanceof Date && got.startTime.getTime() === 5);
  assert.equal(peekCached(cache, '/p/missing.jsonl'), null);
  assert.equal(peekCached({ entries: { x: { mtimeMs: 1, size: 1 } } }, 'x'), null);
  assert.equal(peekCached(null, 'x'), null);
  assert.equal(peekCached(cache, '/p/a.jsonl').projectDir, '');
});

test('windowLabel lives in window-labels.js and the Codex panel imports it instead of keeping a copy', () => {
  assert.deepEqual([300, 10_080, 43_200, 90, 1440].map((m) => windowLabel(m, 'k')), ['5H', '7D', '30D', '90m', '1D']);
  assert.deepEqual([0, -5, NaN, undefined, null].map((m) => windowLabel(m, 'primary')), ['primary', 'primary', 'primary', 'primary', 'primary']);
  const panel = readFileSync(new URL('../src/codex/panel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /function windowLabel/);
  assert.match(panel, /import \{[^}]*\bwindowLabel\b[^}]*\} from '\.\.\/window-labels\.js'/);
});

test('formatTokens and formatUsd', () => {
  assert.deepEqual([0, 999, 1000, 1499, 166_000, 999_000, 1_000_000, 1_250_000, 12_400_000].map(formatTokens),
    ['0', '999', '1k', '1k', '166k', '999k', '1.0M', '1.3M', '12.4M']);
  assert.deepEqual([NaN, null, undefined].map(formatTokens), ['', '', '']);
  assert.equal(formatUsd(41.2), '$41.20');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(null), '');
});

function snapshot(over = {}) {
  const usage = (tokens, costUsd) => ({ tokens: { input: tokens, cacheRead: 0, cacheWrite: 0, output: 0 }, requests: 10, costUsd });
  const row = (o) => ({
    agent: 'claude', pid: 1, sessionId: 's', name: 'proj-1a', project: 'proj', cwd: CWD, kind: 'interactive', state: 'busy', stateSince: NOW - 12_000,
    tools: ['Bash'], subagents: 2, model: 'claude-fable-5-2', modelName: 'Fable 5.2', effort: null,
    context: { tokens: 166_000, window: 1_000_000, pct: 17 }, usage: usage(100, 41.2),
    cpu: 21.9, cpuPct: 5.5, rssMb: 598, procs: 7, ...o,
  });
  return {
    at: NOW, resources: true, cores: 4, animal: null, usage: { claude: null, codex: null },
    totals: { sessions: 3, busy: 2, subagents: 2, cpu: 37.2, cpuPct: 9.3, costUsd: 41.2, rssMb: 2807, procs: 31 },
    sessions: [
      row({}),
      row({ pid: 2, name: 'proj-2b', model: 'claude-opus-5-5', modelName: 'Opus 5.5', state: 'idle', tools: [], subagents: 0, context: { tokens: 50_000, window: null, pct: null }, usage: usage(1, null), cpu: 0.4, cpuPct: 0.1, rssMb: 1500 }),
      row({ pid: 3, agent: 'codex', name: 'x'.repeat(40), model: null, modelName: null, state: null, stateSince: null, tools: [], subagents: 0, context: null, usage: null, cpu: 15, cpuPct: 3.8, rssMb: 700 }),
    ],
    ...over,
  };
}

const LIMITS = {
  claude: { windows: [{ key: 'five_hour', label: '5H', usedPct: 12.4, resetsAt: null }, { key: 'seven_day', label: '7D', usedPct: 18.6, resetsAt: null }] },
  codex: { plan: 'plus', windows: [{ key: 'primary', label: '30D', usedPct: 0, resetsAt: null }] },
};

test('renderText: machine-share CPU, agent and model, context, cost, one aligned line per session, no colour, no trailing space', () => {
  const lines = renderText(snapshot()).split('\n');
  assert.equal(lines[0], '✇ 2/3 busy · CPU 9% · 2.7 GB');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^● {2}proj-1a +Claude Fable 5\.2 +busy 12s {2}Bash ⤷2 {2}ctx 17% +\$41\.20 {2}5\.5% {2}598 MB$/);
  assert.match(lines[2], /^○ {2}proj-2b +Claude Opus 5\.5 +idle 12s {2} +ctx 50k {2} +0\.1% {2}1\.5 GB$/);
  assert.match(lines[3], /^◌ {2}x{27}… {2}Codex +- /);
  for (const l of lines) assert.doesNotMatch(l, /\x1b|\s$/);
  // Columns line up: every row puts the CPU share and memory at the same place.
  assert.equal(new Set(lines.slice(1).map((l) => l.indexOf(' MB') >= 0 ? l.indexOf(' MB') : l.indexOf(' GB'))).size, 1);
});

test('renderText: a column that is empty on every row is left out, a partly empty one stays', () => {
  const s = snapshot();
  s.sessions = s.sessions.map((r) => ({ ...r, context: null, usage: null }));
  const none = renderText(s).split('\n');
  assert.doesNotMatch(none.join('\n'), /ctx|\$/);
  assert.match(none[1], /^● {2}proj-1a +Claude Fable 5\.2 +busy 12s {2}Bash ⤷2 {2}5\.5% {2}598 MB$/);
  const costOnly = snapshot();
  costOnly.sessions = costOnly.sessions.map((r) => ({ ...r, context: null }));
  const lines = renderText(costOnly).split('\n');
  assert.doesNotMatch(lines.join('\n'), /ctx/);
  assert.match(lines[1], /\$41\.20 {2}5\.5%/);
  assert.match(lines[2], /busy|idle/);
  assert.match(lines[3], /◌/);
  // Tokens only reads as ctx 166k, a known window as a percentage.
  const tokensOnly = snapshot();
  tokensOnly.sessions[0].context = { tokens: 166_000, window: null, pct: null };
  assert.match(renderText(tokensOnly).split('\n')[1], /ctx 166k/);
});

test('renderText: the header names each agent that has limits, Claude first, and the agent column drops a missing model', () => {
  const lines = renderText(snapshot({ usage: LIMITS })).split('\n');
  assert.equal(lines[0], '✇ 2/3 busy · CPU 9% · 2.7 GB · Claude 5H 12% 7D 19% · Codex 30D 0%');
  assert.equal(renderText(snapshot({ usage: { claude: null, codex: LIMITS.codex } })).split('\n')[0], '✇ 2/3 busy · CPU 9% · 2.7 GB · Codex 30D 0%');
  assert.match(lines[3], / Codex +- /);
});

test('renderText: animal mark, empty state, and no cpu or memory columns without resources', () => {
  assert.equal(renderText(snapshot({ animal: { grade: 'lion', emoji: '🦁' }, sessions: [], totals: { sessions: 0, busy: 0 } })), '🦁 no agent sessions running');
  const s = snapshot({ resources: false });
  s.totals = { ...s.totals, cpu: null, cpuPct: null, rssMb: null, procs: null };
  s.sessions = s.sessions.map((r) => ({ ...r, cpu: null, cpuPct: null, rssMb: null, procs: null }));
  const lines = renderText(s).split('\n');
  assert.equal(lines[0], '✇ 2/3 busy');
  assert.doesNotMatch(lines.join('\n'), /MB|GB|\d\.\d%/);
  assert.match(lines[1], /ctx 17% +\$41\.20$/);
});

test('renderSwiftBar: title, separator, rows with parameters, limits lines, footer', () => {
  const lines = renderSwiftBar(snapshot()).split('\n');
  assert.equal(lines[0], '✇ 2/3 · 9%');
  assert.equal(lines[1], '---');
  assert.equal(lines[2], '● proj-1a · Claude Fable 5.2 · busy 12s · Bash ⤷2 · ctx 17% · $41.20 · 5.5% · 598 MB | font=Menlo size=12');
  assert.equal(lines[3], '○ proj-2b · Claude Opus 5.5 · idle 12s · ctx 50k · 0.1% · 1.5 GB | font=Menlo size=12');
  assert.match(lines[4], /^◌ x{40} · Codex · - · 3\.8% · 700 MB \| /);
  assert.equal(lines.at(-3), '---');
  assert.equal(lines.at(-2), 'CPU 9% · 2.7 GB · 31 processes | font=Menlo size=12');
  assert.equal(lines.at(-1), 'Refresh | refresh=true');
  const limited = renderSwiftBar(snapshot({ usage: LIMITS })).split('\n');
  assert.deepEqual(limited.slice(-4), [
    'CPU 9% · 2.7 GB · 31 processes | font=Menlo size=12',
    'Claude limits: 5H 12% · 7D 19% | font=Menlo size=12',
    'Codex limits: 30D 0% | font=Menlo size=12',
    'Refresh | refresh=true',
  ]);
  // Without resources the limits still follow the separator.
  const bare = renderSwiftBar(snapshot({ resources: false, usage: LIMITS })).split('\n');
  assert.deepEqual(bare.slice(-4), ['---', 'Claude limits: 5H 12% · 7D 19% | font=Menlo size=12', 'Codex limits: 30D 0% | font=Menlo size=12', 'Refresh | refresh=true']);
});

test('renderSwiftBar: pipes and newlines in a name cannot start parameters; empty and no-resource forms', () => {
  const s = snapshot();
  s.sessions[0].name = 'a|b\nrefresh=true';
  const row = renderSwiftBar(s).split('\n')[2];
  assert.match(row, /^● a¦b refresh=true · Claude Fable 5\.2 · busy/);
  assert.equal(row.split('|').length, 2);
  const empty = renderSwiftBar(snapshot({ sessions: [], totals: { sessions: 0, busy: 0, cpu: 0, cpuPct: 0 } })).split('\n');
  assert.equal(empty[2], 'No agent sessions running');
  const bare = renderSwiftBar(snapshot({ resources: false })).split('\n');
  assert.equal(bare[0], '✇ 2/3');
  assert.equal(bare.at(-1), 'Refresh | refresh=true');
  assert.ok(!bare.some((l) => l.startsWith('CPU ')));
});

test('pluginScript quotes both paths, including a single quote', () => {
  const script = pluginScript({ execPath: "/opt/it's/node", cliEntry: '/x y/cli.js' });
  const lines = script.split('\n');
  assert.equal(lines[0], '#!/bin/sh');
  assert.equal(lines[2], "exec '/opt/it'\\''s/node' '/x y/cli.js' bar --swiftbar");
});

function runBar(flags, collect = () => snapshot(), settings, rules) {
  const out = [];
  const err = [];
  const prev = process.exitCode;
  return run({
    hasFlag: (f) => flags.includes(f),
    deps: { collect, settings, rules, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } },
  }).then(() => {
    const code = process.exitCode;
    process.exitCode = prev;
    return { out: out.join(''), err: err.join(''), code };
  });
}

test('run prints text, JSON, SwiftBar text or the plugin script', async () => {
  const text = await runBar([]);
  assert.match(text.out, /^✇ 2\/3 busy/);
  assert.ok(text.out.endsWith('\n'));
  const json = await runBar(['--json']);
  assert.equal(JSON.parse(json.out).totals.sessions, 3);
  const bar = await runBar(['--swiftbar']);
  assert.equal(bar.out.split('\n')[1], '---');
  let collected = false;
  const plugin = await runBar(['--plugin'], () => { collected = true; return snapshot(); });
  assert.equal(plugin.out.split('\n')[0], '#!/bin/sh');
  assert.equal(collected, false);
  assert.equal(text.code, process.exitCode);
});

test('run refuses --json together with --swiftbar with exit code 2 and one stderr line', async () => {
  let collected = false;
  const r = await runBar(['--json', '--swiftbar'], () => { collected = true; return snapshot(); });
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  assert.equal(r.err.trim().split('\n').length, 1);
  assert.equal(collected, false);
});

test('bin/cli.js dispatches bar, lists it in the usage and specs its flags', () => {
  const cli = readFileSync(new URL('../bin/cli.js', import.meta.url), 'utf8');
  assert.match(cli, /if \(args\[0\] === 'bar'\) \{\s*return \(await import\('\.\.\/src\/commands\/bar\.js'\)\)\.run\(\{ args, hasFlag \}\);/);
  assert.match(cli, /KNOWN_SUBCOMMANDS = new Set\(\[[^\]]*'bar'/);
  assert.match(cli, /bar: \{ value: \[\], bool: \['--json', '--swiftbar', '--plugin', '--settings', '--rules', '--detail', '--then-launch', '--help', '-h'\] \}/);
  assert.match(cli, /^ {2}sprag bar {16}what each running agent session/m);
});

const STATUSLINE = { compactLevel: 2, labels: 'narrow', timer: false, color: true };

test('collectSettings reports routing, statusline, language and the team name from what it is given', () => {
  const joined = { memberKey: 'k', teamName: ' acmeco ', displayName: 'user1' };
  const on = collectSettings({ cfg: {}, statusline: STATUSLINE, language: 'ko', team: joined, now: NOW, compact: null });
  assert.deepEqual(on, {
    routing: { enabled: true, relaxed: false, relaxUntil: null },
    statusline: { compact: 2, labels: 'narrow', timer: false },
    language: 'ko',
    team: { joined: true, teamName: 'acmeco', displayName: 'user1' },
    compactWindow: null,
  });
  // Routing off and a relax deadline still ahead.
  const relaxed = collectSettings({ cfg: { routing: false, relaxUntil: NOW + 60_000 }, statusline: STATUSLINE, language: 'en', team: {}, now: NOW, compact: null });
  assert.deepEqual(relaxed.routing, { enabled: false, relaxed: true, relaxUntil: NOW + 60_000 });
  // A deadline already past is not relaxed, and a machine that left its team shows no names.
  const past = collectSettings({ cfg: { relaxUntil: NOW - 1 }, statusline: STATUSLINE, language: 'en', team: { ...joined, left: true }, now: NOW, compact: null });
  assert.deepEqual(past.routing, { enabled: true, relaxed: false, relaxUntil: null });
  assert.deepEqual(past.team, { joined: false, teamName: null, displayName: null });
});

test('run --settings prints the settings as JSON and takes no snapshot', async () => {
  let snapshots = 0;
  const r = await runBar(['--settings'], () => { snapshots++; return snapshot(); }, () => ({ routing: { enabled: false } }));
  assert.deepEqual(JSON.parse(r.out), { routing: { enabled: false } });
  assert.ok(r.out.endsWith('\n'));
  assert.equal(snapshots, 0);
});

const CAP_WARNING = {
  kind: 'cap', chip: '🚨 7D 92%', level: 'critical', since: null, detail: null, resetsAt: null,
  advice: [{ code: 'CAP', title: '7D limit is 92% used', explain: null, tip: 'Run `sprag handoff` to back up state before the cap blocks you', actions: [{ label: 'Run', commands: ['sprag handoff'] }] }],
};
const ISSUE_WARNING = {
  kind: 'issue', chip: '⚠ Ctx 500k+', level: 'warn', since: NOW - 60_000, detail: null, resetsAt: null,
  advice: [{ code: 'LARGE_INPUT_PER_REQUEST', title: 'Per-request input tokens are unusually large', explain: 'x', tip: 'Compact or clear', actions: [] }],
};

test('Codex limits show only while a Codex session row exists, in text and in SwiftBar', () => {
  const withCodex = snapshot({ usage: LIMITS });
  assert.match(renderText(withCodex).split('\n')[0], / · Codex 30D 0%$/);
  assert.ok(renderSwiftBar(withCodex).includes('Codex limits: 30D 0%'));
  const claudeOnly = snapshot({ usage: LIMITS });
  claudeOnly.sessions = claudeOnly.sessions.filter((r) => r.agent !== 'codex');
  assert.equal(renderText(claudeOnly).split('\n')[0], '✇ 2/3 busy · CPU 9% · 2.7 GB · Claude 5H 12% 7D 19%');
  assert.ok(!renderSwiftBar(claudeOnly).includes('Codex'));
  // The JSON keeps usage.codex either way.
  assert.equal(claudeOnly.usage.codex.plan, 'plus');
});

test('renderText: one line per warning after the head line, none without warnings, and the empty output only changes with warnings', () => {
  const lines = renderText(snapshot({ warnings: [CAP_WARNING, ISSUE_WARNING] })).split('\n');
  assert.equal(lines[1], '🚨 7D 92%  7D limit is 92% used');
  assert.equal(lines[2], '⚠ Ctx 500k+  Per-request input tokens are unusually large');
  assert.match(lines[3], /^● {2}proj-1a/);
  assert.equal(renderText(snapshot()).split('\n').length, 4);
  assert.equal(renderText(snapshot({ warnings: [] })), renderText(snapshot()));
  const noAdvice = renderText(snapshot({ warnings: [{ ...ISSUE_WARNING, advice: [] }] })).split('\n');
  assert.equal(noAdvice[1], '⚠ Ctx 500k+');
  assert.equal(renderText(snapshot({ sessions: [], totals: { sessions: 0, busy: 0 } })), '✇ no agent sessions running');
  assert.equal(
    renderText(snapshot({ sessions: [], totals: { sessions: 0, busy: 0 }, warnings: [ISSUE_WARNING] })),
    '✇ no agent sessions running\n⚠ Ctx 500k+  Per-request input tokens are unusually large',
  );
});

test('renderSwiftBar: a warning marks the title, gets a line with its tip as a submenu, and cannot inject parameters', () => {
  assert.equal(renderSwiftBar(snapshot()).split('\n')[0], '✇ 2/3 · 9%');
  const crit = renderSwiftBar(snapshot({ warnings: [CAP_WARNING, ISSUE_WARNING] })).split('\n');
  assert.equal(crit[0], '🚨 ✇ 2/3 · 9%');
  const at = crit.indexOf('🚨 7D 92% · 7D limit is 92% used | font=Menlo size=12');
  assert.ok(at > 0);
  assert.equal(crit[at + 1], '--Run `sprag handoff` to back up state before the cap blocks you | font=Menlo size=12');
  assert.equal(crit[at + 2], '⚠ Ctx 500k+ · Per-request input tokens are unusually large | font=Menlo size=12');
  assert.equal(crit[at + 3], '--Compact or clear | font=Menlo size=12');
  // The warnings come after the session rows and before the totals line.
  assert.ok(at > crit.indexOf('---') && crit.indexOf('CPU 9% · 2.7 GB · 31 processes | font=Menlo size=12') > at + 3);
  assert.equal(renderSwiftBar(snapshot({ warnings: [ISSUE_WARNING] })).split('\n')[0], '⚠ ✇ 2/3 · 9%');
  const bare = renderSwiftBar(snapshot({ warnings: [{ ...ISSUE_WARNING, advice: [] }] })).split('\n');
  assert.ok(bare.includes('⚠ Ctx 500k+ | font=Menlo size=12'));
  const evil = renderSwiftBar(snapshot({ warnings: [{ ...ISSUE_WARNING, advice: [{ ...ISSUE_WARNING.advice[0], title: 'a|b\nc', tip: 'x|refresh=true' }] }] })).split('\n');
  const row = evil.find((l) => l.startsWith('⚠ Ctx 500k+ · a'));
  assert.equal(row, '⚠ Ctx 500k+ · a¦b c | font=Menlo size=12');
  assert.equal(evil.find((l) => l.startsWith('--x')).split('|').length, 2);
});

const HISTORY = (...lines) => () => [{ date: '2026-11-21', content: lines.join('\n') }];
// quiet is empty here so these tests can use the context-size chip, whose detail line has a translation.
const FRESH = { chipState: { chip: '⚠ Ctx 500k+', ts: new Date(NOW - 60_000).toISOString() }, lastRenderAt: NOW - 5_000, history: HISTORY(), quiet: new Set() };

test('currentWarnings leaves the context-size chip out by default, and keeps limits and other chips', () => {
  const of = (chip) => currentWarnings({
    now: NOW, lang: 'en', lastRenderAt: NOW - 5_000, history: () => [],
    chipState: { chip, ts: new Date(NOW - 60_000).toISOString() },
    limits: { windows: [{ key: 'five_hour', label: '5H', usedPct: 94, resetsAt: NOW + 60_000 }] },
  }).map((w) => w.chip);
  for (const chip of QUIET_CHIPS) assert.deepEqual(of(chip), ['🚨 5H 94%'], chip);
  assert.deepEqual([...QUIET_CHIPS], ['⚠ Ctx 500k+', '⚠ Ctx 200k+', '⚠ 1M ON']);
  assert.deepEqual(of('⚠ Cache miss'), ['🚨 5H 94%', '⚠ Cache miss']);
  assert.deepEqual(of('⚠ Input spike'), ['🚨 5H 94%', '⚠ Input spike']);
});

test('currentWarnings: a window is a cap warning from 90% and not at 89.9%', () => {
  const win = (usedPct) => ({ windows: [{ key: 'seven_day', label: '7D', usedPct, resetsAt: NOW + 1000 }, { key: 'five_hour', label: '5H', usedPct: 10, resetsAt: null }] });
  assert.equal(CAP_PRESSURE_CRITICAL, 90);
  assert.deepEqual(currentWarnings({ now: NOW, lang: 'en', limits: win(89.9), chipState: { chip: null, ts: null }, lastRenderAt: null }), []);
  const [w, ...rest] = currentWarnings({ now: NOW, lang: 'en', limits: win(92.4), chipState: { chip: null, ts: null }, lastRenderAt: null });
  assert.equal(rest.length, 0);
  assert.deepEqual(w, {
    kind: 'cap', chip: '🚨 7D 92%', level: 'critical', since: null, detail: null, resetsAt: NOW + 1000,
    advice: [{
      code: 'CAP', title: '7D limit is 92% used', explain: null,
      tip: 'Run `sprag handoff` to back up state before the cap blocks you',
      actions: [{ label: 'Run', commands: ['sprag handoff'] }],
    }],
  });
  const ko = currentWarnings({ now: NOW, lang: 'ko', limits: win(90), chipState: { chip: null, ts: null }, lastRenderAt: null })[0];
  assert.equal(ko.advice[0].title, '7D 한도를 90% 썼습니다');
  assert.match(ko.advice[0].tip, /handoff/);
  assert.equal(ko.advice[0].actions[0].label, '실행');
  assert.deepEqual(currentWarnings({ now: NOW, lang: 'en', limits: null, chipState: { chip: null, ts: null }, lastRenderAt: null }), []);
});

test('currentWarnings: the issue chip counts only while a statusline has rendered in the last 120 s and a chip is set', () => {
  const at = (lastRenderAt, chip = '⚠ Ctx 500k+') => currentWarnings({ ...FRESH, now: NOW, lang: 'en', chipState: { ...FRESH.chipState, chip }, lastRenderAt });
  const [w] = at(NOW - 5_000);
  assert.deepEqual([w.kind, w.level, w.chip, w.since, w.resetsAt, w.detail], ['issue', 'warn', '⚠ Ctx 500k+', NOW - 60_000, null, null]);
  assert.equal(at(NOW - 120_000).length, 1);
  assert.equal(at(NOW - 120_001).length, 0);
  assert.equal(at(null).length, 0);
  assert.equal(at(NOW - 5_000, null).length, 0);
  assert.equal(at(NOW - 5_000, '').length, 0);
  assert.equal(currentWarnings({ ...FRESH, now: NOW, lang: 'en', chipState: { chip: '⚠ Ctx 500k+', ts: null } })[0].since, null);
  // Cap warnings come before the issue and do not need a render.
  const both = currentWarnings({ ...FRESH, now: NOW, lang: 'en', limits: { windows: [{ key: 'seven_day', label: '7D', usedPct: 95, resetsAt: null }] } });
  assert.deepEqual(both.map((x) => x.kind), ['cap', 'issue']);
});

test('currentWarnings: detail comes only from a history event with the same chip, and is translated for Korean', () => {
  const matching = HISTORY(
    '- 09:00:00 ⚠ Cache miss — session abc1: LOW_HIT_RATE',
    '- 10:00:00 ⚠ Ctx 500k+ — Single-request context exceeded 500k (max 612k tokens)',
  );
  const en = currentWarnings({ ...FRESH, now: NOW, lang: 'en', history: matching })[0];
  assert.equal(en.detail, 'Single-request context exceeded 500k (max 612k tokens)');
  const ko = currentWarnings({ ...FRESH, now: NOW, lang: 'ko', history: matching })[0];
  assert.equal(ko.detail, '단일 요청 컨텍스트 500k 초과 (최대 612k 토큰)');
  // The newest event is another chip: its detail does not belong to the current one.
  const other = HISTORY(
    '- 10:00:00 ⚠ Ctx 500k+ — Single-request context exceeded 500k (max 612k tokens)',
    '- 11:00:00 ⚠ Cache miss — session abc1: LOW_HIT_RATE',
  );
  const w = currentWarnings({ ...FRESH, now: NOW, lang: 'en', history: other })[0];
  assert.equal(w.detail, null);
  assert.deepEqual(w.advice.map((a) => a.code), ['LARGE_INPUT_PER_REQUEST']);
  // A history reader that throws leaves the item without detail.
  const broken = currentWarnings({ ...FRESH, now: NOW, lang: 'en', history: () => { throw new Error('boom'); } })[0];
  assert.equal(broken.detail, null);
});

test('currentWarnings: advice follows the chip codes then the history codes, in the chosen language, skipping unregistered codes', () => {
  const chipState = { chip: '⚠ Cache miss', ts: new Date(NOW).toISOString() };
  const history = HISTORY('- 10:00:00 ⚠ Cache miss — session abc1: FREQUENT_CACHE_REBUILD, NOT_A_CODE, LOW_HIT_RATE');
  const en = currentWarnings({ now: NOW, lang: 'en', chipState, lastRenderAt: NOW, history })[0];
  assert.deepEqual(en.advice.map((a) => a.code), ['LOW_HIT_RATE', 'FREQUENT_CACHE_REBUILD']);
  const ko = currentWarnings({ now: NOW, lang: 'ko', chipState, lastRenderAt: NOW, history })[0];
  assert.notEqual(ko.advice[0].title, en.advice[0].title);
  assert.match(ko.advice[0].title, /[가-힣]/);
  assert.doesNotMatch(en.advice[0].title, /[가-힣]/);
  for (const a of [...en.advice, ...ko.advice]) {
    assert.equal(typeof a.title, 'string');
    assert.equal(typeof a.explain, 'string');
    assert.ok(Array.isArray(a.actions));
    for (const act of a.actions) assert.ok(typeof act.label === 'string' && Array.isArray(act.commands) && act.commands.every((c) => typeof c === 'string'));
  }
  assert.equal(typeof en.advice[0].tip, 'string');
  assert.match(ko.advice[0].tip, /[가-힣]/);
  // A chip nobody registered advice for has none.
  const unknown = currentWarnings({ now: NOW, lang: 'en', chipState: { chip: '⚠ Something new', ts: null }, lastRenderAt: NOW, history: HISTORY() });
  assert.deepEqual(unknown.map((x) => [x.chip, x.advice]), [['⚠ Something new', []]]);
});

test('readChipState reads last-chip.json and gives nulls for a missing or broken file; newestRenderAt takes the largest at', (t) => {
  const dir = tmp(t);
  assert.deepEqual(readChipState(dir), { chip: null, ts: null });
  writeFileSync(join(dir, 'last-chip.json'), '{broken');
  assert.deepEqual(readChipState(dir), { chip: null, ts: null });
  writeJson(dir, 'last-chip.json', { chip: '⚠ Cache miss', ts: '2026-11-21T01:02:03.000Z', cap_seven_day: 1 });
  assert.deepEqual(readChipState(dir), { chip: '⚠ Cache miss', ts: '2026-11-21T01:02:03.000Z' });
  assert.equal(newestRenderAt({ dir }), null);
  writeJson(dir, 'statusline-last.json', { a: { text: 'x', at: 1000 }, b: { text: 'y', at: 5000 }, c: { text: 'z' }, d: null });
  assert.equal(newestRenderAt({ dir }), 5000);
  writeFileSync(join(dir, 'statusline-last.json'), '[1]');
  assert.equal(newestRenderAt({ dir }), null);
});

test('collectActivity carries the warnings and counts them in totals, computed from the one limits object of usage.claude', (t) => {
  const dataDir = tmp(t);
  writeJson(dataDir, 'last-caps.json', { capturedAt: Date.now(), caps: { windows: [{ key: 'seven_day', usedPct: 93, resetsAt: NOW / 1000 + 3600 }] } });
  let seen;
  const snap = collect(t, { dataDir, warningsOf: (o) => { seen = o; return [CAP_WARNING]; }, lang: 'ko' });
  assert.deepEqual(snap.warnings, [CAP_WARNING]);
  assert.equal(snap.totals.warnings, 1);
  assert.equal(seen.lang, 'ko');
  assert.equal(seen.now, NOW);
  assert.equal(seen.dataDir, dataDir);
  assert.equal(seen.limits, snap.usage.claude);
  assert.equal(snap.usage.claude.windows[0].usedPct, 93);
  // A throwing or odd warnings reader gives none; the default reader finds nothing in an empty folder.
  assert.deepEqual(collect(t, { warningsOf: () => { throw new Error('boom'); } }).warnings, []);
  assert.deepEqual(collect(t, { warningsOf: () => 'nope' }).warnings, []);
  const plain = collect(t);
  assert.deepEqual([plain.warnings, plain.totals.warnings], [[], 0]);
});

test('collectActivity with the real warnings reader turns a 93% window and a fresh chip into two warnings', (t) => {
  const dataDir = tmp(t);
  writeJson(dataDir, 'last-caps.json', { capturedAt: Date.now(), caps: { windows: [{ key: 'seven_day', usedPct: 93, resetsAt: NOW / 1000 + 3600 }] } });
  writeJson(dataDir, 'last-chip.json', { chip: '⚠ Cache miss', ts: new Date(NOW - 1000).toISOString() });
  writeJson(dataDir, 'statusline-last.json', { default: { text: 'x', at: NOW - 2000 } });
  const snap = collect(t, { dataDir });
  assert.deepEqual(snap.warnings.map((w) => [w.kind, w.chip]), [['cap', '🚨 7D 93%'], ['issue', '⚠ Cache miss']]);
  assert.equal(snap.totals.warnings, 2);
});

const COMPACT = {
  is1m: true, window: 400000, windowAuto: false, windowSource: 'global', windowModelKey: 'opus', ok: false, reason: 'too-large',
  recommended: 400000, recommendedMin: 300000, recommendedMax: 500000,
};

test('collectSettings reports the compact window, its warning switch, and null when it cannot be read', () => {
  const base = { cfg: {}, statusline: STATUSLINE, language: 'en', team: {}, now: NOW };
  const on = collectSettings({ ...base, compact: COMPACT });
  assert.deepEqual(on.compactWindow, {
    is1m: true, value: 400000, auto: false, source: 'global', modelKey: 'opus', ok: false, reason: 'too-large',
    recommended: 400000, min: 300000, max: 500000, warn: true,
  });
  const off = collectSettings({ ...base, cfg: { compactWindow: { enabled: false } }, compact: { ...COMPACT, window: undefined, windowSource: undefined, windowModelKey: undefined, windowAuto: true, ok: true, reason: 'auto' } });
  assert.deepEqual([off.compactWindow.warn, off.compactWindow.value, off.compactWindow.source, off.compactWindow.modelKey, off.compactWindow.auto], [false, null, null, null, true]);
  assert.equal(collectSettings({ ...base, compact: null }).compactWindow, null);
});

const RULE_FILE = (path, bytes, rules) => ({ path, bytes, rules: rules.map((text, i) => ({ index: i + 1, lineNo: i + 4, text, ...(text.startsWith('2026') ? { date: '2026-11-01', tags: ['video'] } : { date: null, tags: [] }) })) });

function rulesSources(t, over = {}) {
  const home = process.env.HOME || '/home/me';
  const globalFile = join(tmp(t), 'ratchet.md');
  writeFileSync(globalFile, '- x\n');
  return {
    lang: 'en',
    roots: () => ['/home/me/zeta', home, '/home/me/alpha'],
    listRules: ({ root, scope }) => (scope === 'global'
      ? RULE_FILE(globalFile, 400, ['2026-11-01: [video] keep it short', 'plain rule'])
      : RULE_FILE(`${root}/.claude/ratchet.md`, 100, [`rule of ${root}`])),
    presetPath: () => '/home/me/.claude/ratchet-preset.md',
    presets: ({ lang }) => [{ id: 'fix-aaaaaa', text: `accepted ${lang}` }],
    pending: ({ lang, root }) => [
      { id: 'fix-bbbbbb', kind: 'ratchet', ruleText: `pending ${lang}`, extra: root },
      { id: 'model-cccccc', kind: 'model', ruleText: 'not a ratchet' },
    ],
    modelRules: () => [
      { scope: 'global', label: '읽기', labelEn: 'reading', tier: 'T2', status: 'review', rule: 'delegate reads', example: 'what is this', count: 4, savedUsd: 1.5 },
      { scope: 'project', targetRoot: '/home/me/alpha', label: 'only ko', tier: 'T1' },
    ],
    routing: () => false,
    teamState: () => ({ memberKey: 'k' }),
    teamCache: () => ({ removed: ['r3'], rules: [
      { id: 'r1', level: 'team', scope: 'ratchet', text: 'team rule\none' },
      { id: 'r2', level: 'org', scope: 'model', text: 'org rule' },
      { id: 'r3', level: 'org', text: 'removed' },
      { id: 'r4', level: 'team', text: '' },
    ] }),
    ...over,
  };
}

test('collectRules lists the global, project, preset, model and team rules from the sources it is given', (t) => {
  const out = collectRules(rulesSources(t));
  assert.deepEqual(Object.keys(out), ['budgetTokens', 'global', 'projects', 'preset', 'model', 'team']);
  assert.equal(out.budgetTokens, 2000);
  assert.equal(out.global.exists, true);
  assert.deepEqual([out.global.bytes, out.global.tokens], [400, 100]);
  assert.deepEqual(out.global.rules, [
    { index: 1, text: '2026-11-01: [video] keep it short', date: '2026-11-01', tags: ['video'] },
    { index: 2, text: 'plain rule', date: null, tags: [] },
  ]);
  // The home root is skipped and the rest is sorted by name.
  assert.deepEqual(out.projects.map((p) => [p.name, p.root, p.exists, p.bytes, p.tokens]), [
    ['alpha', '/home/me/alpha', false, 100, 25],
    ['zeta', '/home/me/zeta', false, 100, 25],
  ]);
  assert.deepEqual(out.projects[0].rules, [{ index: 1, text: 'rule of /home/me/alpha', date: null, tags: [] }]);
  assert.deepEqual(out.preset, {
    path: '/home/me/.claude/ratchet-preset.md',
    rules: [{ id: 'fix-aaaaaa', text: 'accepted en' }],
    pending: [{ id: 'fix-bbbbbb', text: 'pending en' }],
  });
  assert.equal(out.model.enabled, false);
  assert.deepEqual(out.model.rules, [
    { index: 1, scope: 'global', root: null, label: 'reading', tier: 'T2', status: 'review', text: 'delegate reads', example: 'what is this', count: 4, savedUsd: 1.5 },
    { index: 2, scope: 'project', root: '/home/me/alpha', label: 'only ko', tier: 'T1', status: null, text: '', example: null, count: null, savedUsd: null },
  ]);
  assert.deepEqual(out.team, { joined: true, rules: [
    { id: 'r2', level: 'org', scope: 'model', text: 'org rule' },
    { id: 'r1', level: 'team', scope: 'ratchet', text: 'team rule one' },
  ] });
  // Korean picks the Korean label.
  assert.equal(collectRules(rulesSources(t, { lang: 'ko' })).model.rules[0].label, '읽기');
});

test('collectRules: a failing source gives its empty shape and the others stay', (t) => {
  const boom = () => { throw new Error('boom'); };
  const out = collectRules(rulesSources(t, {
    roots: boom, listRules: boom, presetPath: boom, presets: boom, pending: boom, modelRules: boom, routing: boom, teamState: boom, teamCache: boom,
  }));
  assert.deepEqual(out, {
    budgetTokens: 2000,
    global: { path: null, exists: false, bytes: 0, tokens: 0, rules: [] },
    projects: [],
    preset: { path: null, rules: [], pending: [] },
    model: { enabled: false, rules: [] },
    team: { joined: false, rules: [] },
  });
  const partial = collectRules(rulesSources(t, { modelRules: boom, listRules: ({ scope }) => { if (scope === 'project') throw new Error('x'); return RULE_FILE('/home/me/g.md', 8, ['a']); } }));
  assert.deepEqual(partial.model.rules, []);
  assert.equal(partial.global.rules.length, 1);
  assert.deepEqual(partial.projects.map((p) => [p.exists, p.rules]), [[false, []], [false, []]]);
});

test('run --rules prints the rules as JSON and takes no snapshot', async () => {
  let snapshots = 0;
  const r = await runBar(['--rules'], () => { snapshots++; return snapshot(); }, undefined, () => ({ budgetTokens: 2000 }));
  assert.deepEqual(JSON.parse(r.out), { budgetTokens: 2000 });
  assert.ok(r.out.endsWith('\n'));
  assert.equal(snapshots, 0);
});

// ---------------------------------------------------------------- effort

test('a Claude row carries the effort the statusline recorded, and null without one or with an unusable file', (t) => {
  const claudeDir = tmp(t);
  const dataDir = tmp(t);
  writeSession(claudeDir, 100);
  writeSession(claudeDir, 200);
  writeSession(claudeDir, 300, { sessionId: 'sid-300' });
  mkdirSync(join(dataDir, 'session-effort'), { recursive: true });
  writeFileSync(join(dataDir, 'session-effort', 'sid-100'), 'xhigh\n');
  writeFileSync(join(dataDir, 'session-effort', 'sid-300'), '  \n');
  const ps = () => parsePs('  100 1 0.0 1 claude\n  200 1 0.0 1 claude\n  300 1 0.0 1 claude');
  const rows = collect(t, { claudeDir, dataDir, ps }).sessions;
  const effortOf = (pid) => rows.find((r) => r.pid === pid).effort;
  assert.equal(effortOf(100), 'xhigh');
  assert.equal(effortOf(200), null);
  assert.equal(effortOf(300), null);
});

test('the agent column adds the effort after the model in the text table and the SwiftBar rows', () => {
  const s = snapshot();
  s.sessions[0].effort = 'xhigh';
  s.sessions[2].effort = 'high';
  s.sessions[2].agent = 'codex';
  s.sessions[2].modelName = 'gpt-6';
  const lines = renderText(s).split('\n');
  assert.match(lines[1], /^● {2}proj-1a +Claude Fable 5\.2 xhigh +busy 12s /);
  assert.match(lines[2], /^○ {2}proj-2b +Claude Opus 5\.5 +idle /);
  assert.match(lines[3], /Codex gpt-6 high +- /);
  const bar = renderSwiftBar(s).split('\n');
  assert.match(bar[2], /^● proj-1a · Claude Fable 5\.2 xhigh · busy 12s/);
  assert.match(bar[3], /^○ proj-2b · Claude Opus 5\.5 · idle 12s/);
  assert.match(bar[4], / · Codex gpt-6 high · - · /);
  // An unknown model still shows the effort, and neither shows a stray space without one.
  const bare = snapshot();
  bare.sessions[0].modelName = null;
  bare.sessions[0].effort = 'xhigh';
  assert.match(renderText(bare).split('\n')[1], /^● {2}proj-1a +Claude xhigh +busy/);
  assert.match(renderSwiftBar(bare).split('\n')[2], /^● proj-1a · Claude xhigh · busy/);
  assert.match(renderSwiftBar(snapshot()).split('\n')[4], / · Codex · - · /);
});

// ---------------------------------------------------------------- detail

test('toolTarget names what each tool acts on and gives an empty string when it cannot', () => {
  assert.equal(toolTarget('Bash', { command: 'ls -la', description: 'List files' }), 'List files');
  assert.equal(toolTarget('Bash', { command: 'ls -la', description: '' }), 'ls -la');
  assert.equal(toolTarget('Bash', { command: 'a\n  b   c' }), 'a b c');
  assert.equal(toolTarget('Read', { file_path: '/home/me/proj/src/a.js' }), 'a.js');
  assert.equal(toolTarget('Edit', { file_path: '/home/me/proj/b.js' }), 'b.js');
  assert.equal(toolTarget('Write', { file_path: '/home/me/proj/c.md' }), 'c.md');
  assert.equal(toolTarget('NotebookEdit', { notebook_path: '/home/me/n.ipynb' }), 'n.ipynb');
  assert.equal(toolTarget('Grep', { pattern: 'foo.*bar' }), 'foo.*bar');
  assert.equal(toolTarget('Glob', { pattern: '**/*.js' }), '**/*.js');
  assert.equal(toolTarget('Agent', { description: 'Find callers', subagent_type: 'explorer' }), 'Find callers (explorer)');
  assert.equal(toolTarget('Task', { description: 'Run checks' }), 'Run checks');
  assert.equal(toolTarget('WebSearch', { query: 'node test runner' }), 'node test runner');
  assert.equal(toolTarget('WebFetch', { url: 'https://docs.example.com/a/b?c=1' }), 'docs.example.com');
  assert.equal(toolTarget('WebFetch', { url: 'not a url' }), 'not a url');
  assert.equal(toolTarget('Skill', { skill: 'graphify' }), 'graphify');
  assert.equal(toolTarget('Mystery', { command: 'x', file_path: '/a/b' }), '');
  for (const input of [undefined, null, 'text', 5]) assert.equal(toolTarget('Bash', input), '');
  assert.equal(toolTarget('Read', {}), '');
  assert.equal(toolTarget('Bash', { command: 5 }), '');
});

test('toolTarget cuts to 80 characters with an ellipsis and keeps an exactly 80 character target whole', () => {
  assert.equal(toolTarget('Grep', { pattern: 'p'.repeat(80) }), 'p'.repeat(80));
  assert.equal(toolTarget('Grep', { pattern: 'p'.repeat(81) }), `${'p'.repeat(80)}…`);
});

const NOW_ISO = (ms) => new Date(ms).toISOString();
const typed = (text, at = NOW, extra = {}) => JSON.stringify({ type: 'user', timestamp: NOW_ISO(at), message: { role: 'user', content: text }, ...extra });
const said = (text, at = NOW, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: NOW_ISO(at), message: { content: [{ type: 'text', text }] }, ...extra });
const call = (id, name, input = {}, at = NOW) => JSON.stringify({ type: 'assistant', timestamp: NOW_ISO(at), message: { content: [{ type: 'tool_use', id, name, input }] } });
const done = (id, at = NOW) => JSON.stringify({ type: 'user', timestamp: NOW_ISO(at), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

function detailOf(t, lines, opts = {}) {
  const claudeDir = tmp(t);
  return sessionDetail({ transcript: writeTranscript(claudeDir, 'sid-d', lines), ...opts });
}

test('sessionDetail takes the newest typed request and skips tool results, meta, sidechain and wrapper-only lines', (t) => {
  const d = detailOf(t, [
    typed('first request', NOW - 5000),
    call('t1', 'Bash', { command: 'ls' }),
    typed('side request', NOW, { isSidechain: true }),
    typed('meta request', NOW, { isMeta: true }),
    typed('<system-reminder>hook said something</system-reminder>\n  ', NOW),
    typed('<command-name>/clear</command-name><command-message>clear</command-message><command-args></command-args>', NOW),
    done('t1', NOW),
    said('a reply', NOW - 1000),
  ]);
  assert.deepEqual(d.prompt, { text: 'first request', at: NOW - 5000 });
});

test('sessionDetail reads the text items of a list message and strips wrapper blocks from a mixed one', (t) => {
  const mixed = '<system-reminder>\nnote\n</system-reminder>  Please   fix\n the build <pasted_content id="1">big paste</pasted_content>now <local-command-stdout>out</local-command-stdout>';
  const d = detailOf(t, [
    typed('older', NOW - 9000),
    JSON.stringify({ type: 'user', timestamp: NOW_ISO(NOW), message: { content: [{ type: 'text', text: mixed }, { type: 'image', source: {} }, { type: 'text', text: 'and <task-notification>done</task-notification>second' }] } }),
  ]);
  assert.deepEqual(d.prompt, { text: 'Please fix the build now and second', at: NOW });
  // A list holding a tool result is a tool result even when it also holds text.
  const tr = detailOf(t, [typed('typed one', NOW - 1), JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }, { type: 'text', text: 'not typed' }] } })]);
  assert.equal(tr.prompt.text, 'typed one');
});

test('sessionDetail cuts a long request at 400 code points without splitting an emoji, and ends it with an ellipsis', (t) => {
  const d = detailOf(t, [typed(`${'a'.repeat(399)}😀😀 tail`)]);
  assert.equal(d.prompt.text, `${'a'.repeat(399)}😀…`);
  assert.equal(Array.from(d.prompt.text).length, 401);
  assert.ok(d.prompt.text.isWellFormed());
  const exact = detailOf(t, [typed('b'.repeat(400))]);
  assert.equal(exact.prompt.text, 'b'.repeat(400));
  const reply = detailOf(t, [said(`${'c'.repeat(399)}😀😀`)]);
  assert.equal(reply.reply.text, `${'c'.repeat(399)}😀…`);
});

test('sessionDetail returns the newest text reply, joined, and ignores tool-only and sidechain assistant lines', (t) => {
  const d = detailOf(t, [
    said('older reply', NOW - 3000),
    JSON.stringify({ type: 'assistant', timestamp: NOW_ISO(NOW - 2000), message: { content: [{ type: 'text', text: 'part one' }, { type: 'tool_use', id: 'a', name: 'Bash', input: {} }, { type: 'text', text: '   ' }, { type: 'text', text: 'part  two' }] } }),
    call('b', 'Read', { file_path: '/home/me/a.js' }, NOW - 1000),
    said('subagent chatter', NOW, { isSidechain: true }),
  ]);
  assert.deepEqual(d.reply, { text: 'part one part two', at: NOW - 2000 });
  assert.equal(d.prompt, null);
});

test('sessionDetail lists the last 12 tool calls oldest first, with their target and whether a result is still missing', (t) => {
  const lines = [];
  for (let i = 1; i <= 15; i++) {
    lines.push(call(`t${i}`, i % 2 ? 'Read' : 'Grep', i % 2 ? { file_path: `/home/me/f${i}.js` } : { pattern: `p${i}` }, NOW + i));
    if (i !== 14) lines.push(done(`t${i}`));
  }
  lines.push(call('t16', 'Bash', { command: 'sleep 9' }, NOW + 16));
  lines.push(call('side', 'Bash', { command: 'no' }, NOW + 17).replace('"type":"assistant"', '"type":"assistant","isSidechain":true'));
  const d = detailOf(t, lines);
  assert.equal(d.recent.length, 12);
  assert.deepEqual(d.recent.map((c) => c.tool), [...[5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => (i % 2 ? 'Read' : 'Grep')), 'Bash']);
  assert.deepEqual(d.recent[0], { at: NOW + 5, tool: 'Read', target: 'f5.js', pending: false });
  assert.deepEqual(d.recent.at(-1), { at: NOW + 16, tool: 'Bash', target: 'sleep 9', pending: true });
  assert.deepEqual(d.recent.filter((c) => c.pending).map((c) => c.target), ['p14', 'sleep 9']);
  assert.ok(d.recent.every((c, i) => i === 0 || c.at > d.recent[i - 1].at));
});

test('sessionDetail gives an at of null for a missing or bad timestamp and never throws on an unreadable file', (t) => {
  const d = detailOf(t, [JSON.stringify({ type: 'user', timestamp: 'yesterday', message: { content: 'hello there' } }), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })]);
  assert.deepEqual([d.prompt.at, d.reply.at], [null, null]);
  const empty = { prompt: null, reply: null, recent: [], size: null };
  assert.deepEqual(sessionDetail({ transcript: join(tmp(t), 'missing.jsonl') }), empty);
  assert.deepEqual(sessionDetail({ transcript: null }), empty);
  assert.deepEqual(sessionDetail({}), empty);
  const garbage = writeTranscript(tmp(t), 'sid-g', ['{not json', '[1,2]', 'null', '{"type":"user","message":null}', '{"type":"assistant","message":{"content":"plain"}}']);
  const g = sessionDetail({ transcript: garbage });
  assert.deepEqual([g.prompt, g.reply, g.recent], [null, null, []]);
  assert.ok(g.size > 0);
});

const queued = (content, at = NOW, operation = 'enqueue') => JSON.stringify({ type: 'queue-operation', operation, timestamp: NOW_ISO(at), sessionId: 'sid-d', content });

test('sessionDetail skips a context-compaction summary and a line that is visible only in the transcript', (t) => {
  const d = detailOf(t, [
    typed('the real request', NOW - 3000),
    typed('a long summary of the session so far', NOW - 2000, { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
    typed('shown only in the transcript', NOW - 1000, { isVisibleInTranscriptOnly: true }),
  ]);
  assert.deepEqual(d.prompt, { text: 'the real request', at: NOW - 3000 });
});

test('sessionDetail takes a message queued while the agent was working, ignores its remove line and skips queued harness traffic', (t) => {
  const d = detailOf(t, [
    typed('typed first', NOW - 5000),
    queued('sent while busy', NOW - 4000),
    queued('sent while busy', NOW - 3000, 'remove'),
  ]);
  assert.deepEqual(d.prompt, { text: 'sent while busy', at: NOW - 4000 });
  // A typed line newer than the queued one wins.
  const newer = detailOf(t, [queued('queued earlier', NOW - 4000), typed('typed later', NOW)]);
  assert.equal(newer.prompt.text, 'typed later');
  const harness = detailOf(t, [
    typed('typed first', NOW - 5000),
    queued('<agent-message from="worker-1">finished</agent-message>', NOW - 4000),
    queued('<task-notification><summary>done</summary></task-notification>', NOW - 3000),
    queued('<teammate-message>hi</teammate-message>', NOW - 2000),
    queued('   ', NOW - 1000),
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: NOW_ISO(NOW), content: ['not', 'text'] }),
  ]);
  assert.deepEqual(harness.prompt, { text: 'typed first', at: NOW - 5000 });
});

const filler = (n = 40_000) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'z', content: 'x'.repeat(n) }] } });

test('sessionDetail looks further back for a request the tail pushed out, across chunk edges, and gives up at the limit', (t) => {
  const claudeDir = tmp(t);
  // The request line is about 20 KB, so it straddles several 7 KB chunks.
  const longRequest = typed(`old request ${'<system-reminder>' + 'r'.repeat(20_000) + '</system-reminder>'} still the old request`, NOW - 7000);
  const transcript = writeTranscript(claudeDir, 'sid-w', [typed('older still', NOW - 9000), longRequest, said('x', NOW), filler(), filler(), filler()]);
  const none = sessionDetail({ transcript, tailBytes: 30_000, chunkBytes: 7000, deepLimit: 60_000 });
  assert.equal(none.prompt, null);
  const found = sessionDetail({ transcript, tailBytes: 30_000, chunkBytes: 7000 });
  assert.deepEqual(found.prompt, { text: 'old request still the old request', at: NOW - 7000 });
  assert.equal(found.size, readFileSync(transcript).length);
  // The same answer whatever the chunk size, including one smaller than a line.
  for (const chunkBytes of [1000, 4096, 65_536, 4 * 1024 * 1024]) {
    assert.equal(sessionDetail({ transcript, tailBytes: 30_000, chunkBytes }).prompt.text, 'old request still the old request', `chunk ${chunkBytes}`);
  }
  // A request in the tail is the answer without any look back.
  const inTail = writeTranscript(claudeDir, 'sid-w2', [typed('first'), said('x'), typed('last', NOW)]);
  assert.equal(sessionDetail({ transcript: inTail }).prompt.text, 'last');
});

test('sessionDetail with a known earlier result scans only what was written since, and never the bytes before size minus 64 KiB', (t) => {
  const claudeDir = tmp(t);
  const cached = { text: 'cached request', at: 123 };
  const head = [typed('ancient request', NOW - 9000), filler(), filler(), filler(), filler(), filler(), filler()];
  const transcript = writeTranscript(claudeDir, 'sid-k', head);
  const knownSize = readFileSync(transcript).length;
  // Nothing new that holds a request: the older part is not read, so its request must not come back.
  appendFileSync(transcript, [filler(), filler(), filler()].join('\n') + '\n');
  const resumed = sessionDetail({ transcript, tailBytes: 30_000, chunkBytes: 20_000, known: { size: knownSize, prompt: cached } });
  assert.deepEqual(resumed.prompt, cached);
  assert.equal(sessionDetail({ transcript, tailBytes: 30_000, chunkBytes: 20_000 }).prompt.text, 'ancient request');
  // A known size with no known prompt means none was found then.
  assert.equal(sessionDetail({ transcript, tailBytes: 30_000, known: { size: knownSize, prompt: null } }).prompt, null);
  // A request written after the known size but before the tail is found.
  const grown = writeTranscript(claudeDir, 'sid-k2', head);
  const grownSize = readFileSync(grown).length;
  appendFileSync(grown, [typed('fresh request', NOW), filler(), filler(), filler()].join('\n') + '\n');
  const fresh = sessionDetail({ transcript: grown, tailBytes: 30_000, chunkBytes: 20_000, known: { size: grownSize, prompt: cached } });
  assert.deepEqual(fresh.prompt, { text: 'fresh request', at: NOW });
  // A file smaller than the known size is a different file: scanned afresh.
  const smaller = sessionDetail({ transcript, tailBytes: 30_000, known: { size: 1e9, prompt: cached } });
  assert.equal(smaller.prompt.text, 'ancient request');
});

test('pickTitle: a /rename name, then a substantial prompt, then the topic title, then any prompt', () => {
  const derived = { name: 'proj-6b', nameSource: 'derived' };
  // 1. A name the user gave wins over everything.
  assert.equal(pickTitle({ name: ' my work ', nameSource: 'user' }, { lastPrompt: '해커뉴스 확인', aiTitle: 'topic' }), 'my work');
  assert.equal(pickTitle({ name: 'proj-6b' }, { lastPrompt: '해커뉴스 확인' }), '해커뉴스 확인');
  assert.equal(pickTitle({ name: '  ', nameSource: 'user' }, { lastPrompt: '해커뉴스 확인' }), '해커뉴스 확인');
  // 2. A prompt of 5 or more characters, spaces not counted.
  assert.equal(pickTitle(derived, { lastPrompt: '해커뉴스 확인', aiTitle: '앱 배포' }), '해커뉴스 확인');
  assert.equal(pickTitle(derived, { lastPrompt: 'a b c d', aiTitle: 'topic' }), 'topic');
  assert.equal(pickTitle(derived, { lastPrompt: 'a b c d e', aiTitle: 'topic' }), 'a b c d e');
  // 3. A short prompt gives way to the topic title.
  assert.equal(pickTitle(derived, { lastPrompt: '승인완료', aiTitle: '앱 배포' }), '앱 배포');
  assert.equal(pickTitle(derived, { lastPrompt: '/compact please do it now', aiTitle: '앱 배포' }), '앱 배포');
  assert.equal(pickTitle(derived, { lastPrompt: '<command-name>x</command-name> more text', aiTitle: 'topic' }), 'topic');
  // 4. Without a topic title the short prompt is still better than the folder name.
  assert.equal(pickTitle(derived, { lastPrompt: '승인완료' }), '승인완료');
  assert.equal(pickTitle(derived, { lastPrompt: '/compact', aiTitle: null }), '/compact');
  // 5. Nothing to show.
  assert.equal(pickTitle(derived, {}), null);
  assert.equal(pickTitle(derived, { lastPrompt: '  \n ', aiTitle: '' }), null);
  assert.equal(pickTitle(derived, { lastPrompt: 42, aiTitle: {} }), null);
  assert.equal(pickTitle(null, undefined), null);
  // The first non-blank line, with runs of white space collapsed.
  assert.equal(pickTitle(derived, { lastPrompt: '\n\n  fix   the\ttitle  bug \nsecond line' }), 'fix the title bug');
  // 80 code points at most, then an ellipsis.
  const long = 'x'.repeat(100);
  assert.equal(pickTitle(derived, { lastPrompt: long }), `${'x'.repeat(80)}…`);
  assert.equal(pickTitle(derived, { lastPrompt: 'x'.repeat(80) }), 'x'.repeat(80));
  assert.equal(Array.from(pickTitle(derived, { lastPrompt: '가'.repeat(90) })).length, 81);
  assert.equal(pickTitle({ name: long, nameSource: 'user' }, {}), `${'x'.repeat(80)}…`);
});

test('sessionTitleHints returns the newest last-prompt and ai-title, and null for a missing file', (t) => {
  const claudeDir = tmp(t);
  const line = (o) => JSON.stringify(o);
  const file = writeTranscript(claudeDir, 'sid-h', [
    line({ type: 'ai-title', aiTitle: 'first topic', sessionId: 'sid-h' }),
    line({ type: 'last-prompt', lastPrompt: 'first prompt', leafUuid: 'a' }),
    filler(),
    line({ type: 'ai-title', aiTitle: 'second topic', sessionId: 'sid-h' }),
    line({ type: 'last-prompt', lastPrompt: 'second prompt', leafUuid: 'b' }),
    line({ type: 'last-prompt', lastPrompt: 123, leafUuid: 'c' }),
    '{"type":"last-prompt","lastPrompt": broken',
  ]);
  assert.deepEqual(sessionTitleHints({ transcript: file }), { lastPrompt: 'second prompt', aiTitle: 'second topic' });
  assert.deepEqual(sessionTitleHints({ transcript: join(claudeDir, 'missing.jsonl') }), { lastPrompt: null, aiTitle: null });
  assert.deepEqual(sessionTitleHints({ transcript: '' }), { lastPrompt: null, aiTitle: null });
  assert.deepEqual(sessionTitleHints({}), { lastPrompt: null, aiTitle: null });
  // A transcript with neither line.
  const bare = writeTranscript(claudeDir, 'sid-bare', [filler()]);
  assert.deepEqual(sessionTitleHints({ transcript: bare }), { lastPrompt: null, aiTitle: null });
});

test('sessionTitleHints reads only the tail and drops the cut first line', (t) => {
  const claudeDir = tmp(t);
  const line = (o) => JSON.stringify(o);
  const tail = line({ type: 'last-prompt', lastPrompt: 'newest prompt', leafUuid: 'z' });
  const file = writeTranscript(claudeDir, 'sid-t', [
    line({ type: 'ai-title', aiTitle: 'old topic that is out of the tail', sessionId: 'sid-t' }),
    filler(2000),
    tail,
  ]);
  // The window is the last line plus a few bytes of the filler: the cut filler line is dropped, the old title is out of reach.
  const hints = sessionTitleHints({ transcript: file, tailBytes: tail.length + 40 });
  assert.deepEqual(hints, { lastPrompt: 'newest prompt', aiTitle: null });
  // A window that starts in the middle of a last-prompt line must not report it.
  const cutAt = tail.length + 1 - 10;
  assert.deepEqual(sessionTitleHints({ transcript: file, tailBytes: cutAt + 1 }), { lastPrompt: null, aiTitle: null });
  // A big window sees both.
  assert.deepEqual(sessionTitleHints({ transcript: file }), { lastPrompt: 'newest prompt', aiTitle: 'old topic that is out of the tail' });
});

test('collectActivity gives a claude row a title from its transcript, and the row order keeps following name', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100, { name: 'proj-1', nameSource: 'derived' });
  writeSession(claudeDir, 200, { name: 'proj-2', nameSource: 'derived' });
  writeSession(claudeDir, 300, { name: 'renamed', nameSource: 'user' });
  writeSession(claudeDir, 600, { name: 'proj-4', nameSource: 'derived', cwd: null });
  writeTranscript(claudeDir, 'sid-100', [
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'check the hacker news digest', leafUuid: 'a' }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'digest work', sessionId: 'sid-100' }),
  ]);
  writeTranscript(claudeDir, 'sid-200', [
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'ok', leafUuid: 'a' }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'release prep', sessionId: 'sid-200' }),
  ]);
  const ps = () => parsePs(['100 1 0.0 1 claude', '200 1 0.0 1 claude', '300 1 0.0 1 claude', '600 1 0.0 1 claude'].join('\n'));
  const snap = collect(t, { claudeDir, ps });
  const by = (pid) => snap.sessions.find((s) => s.pid === pid);
  assert.equal(by(100).title, 'check the hacker news digest');
  assert.equal(by(200).title, 'release prep');
  assert.equal(by(300).title, 'renamed'); // no transcript: the name the user gave
  assert.equal(by(600).title, null);      // no transcript and a derived name
  assert.equal(by(100).name, 'proj-1');
  assert.deepEqual(snap.sessions.map((s) => s.name), ['proj-1', 'proj-2', 'proj-4', 'renamed']);
});

test('renderText and renderSwiftBar show the title where the name was, and the name when there is no title', () => {
  const s = snapshot();
  const titled = { ...s, sessions: [{ ...s.sessions[0], title: 'check the digest' }] };
  assert.match(renderText(titled).split('\n')[1], /check the digest/);
  assert.doesNotMatch(renderText(titled), /proj-1a/);
  assert.match(renderSwiftBar(titled), /check the digest/);
  const bare = { ...s, sessions: [{ ...s.sessions[0], title: null }] };
  assert.match(renderText(bare).split('\n')[1], /proj-1a/);
  assert.match(renderSwiftBar(bare), /proj-1a/);
});

test('collectActivity with detail keeps the request it found in bar-prompts.json, and writes nothing without detail', (t) => {
  const claudeDir = tmp(t);
  const dataDir = tmp(t);
  writeSession(claudeDir, 100);
  const lines = [typed('original request', NOW - 9000), filler(150_000), filler(150_000), filler(150_000)];
  const transcript = writeTranscript(claudeDir, 'sid-100', lines);
  const ps = () => parsePs('  100 1 0.0 1 claude');
  const cacheFile = join(dataDir, 'bar-prompts.json');
  const promptOf = (snap) => snap.sessions[0].detail.prompt;

  assert.ok(!('detail' in collect(t, { claudeDir, dataDir, ps }).sessions[0]));
  assert.equal(existsSync(cacheFile), false);

  assert.deepEqual(promptOf(collect(t, { claudeDir, dataDir, ps, detail: true })), { text: 'original request', at: NOW - 9000 });
  const saved = JSON.parse(readFileSync(cacheFile, 'utf8'));
  assert.equal(saved.version, 1);
  assert.deepEqual(Object.keys(saved.entries), [transcript]);
  assert.deepEqual(saved.entries[transcript], { size: readFileSync(transcript).length, prompt: { text: 'original request', at: NOW - 9000 }, seenAt: NOW });
  if (process.platform !== 'win32') assert.equal(statSync(cacheFile).mode & 0o777, 0o600);

  // Unchanged: the file is not written again.
  utimesSync(cacheFile, new Date(NOW - 100_000), new Date(NOW - 100_000));
  collect(t, { claudeDir, dataDir, ps, detail: true, now: NOW + 1000 });
  assert.equal(statSync(cacheFile).mtimeMs, NOW - 100_000);

  // The file grows with no new request in the new bytes: the answer comes from the cache, not from the old bytes.
  writeFileSync(transcript, [typed('rewritten head', NOW - 9000), filler(150_000), filler(150_000), filler(150_000), filler(150_000)].join('\n') + '\n');
  assert.equal(promptOf(collect(t, { claudeDir, dataDir, ps, detail: true, now: NOW + 2000 })).text, 'original request');
  assert.equal(JSON.parse(readFileSync(cacheFile, 'utf8')).entries[transcript].size, readFileSync(transcript).length);
});

test('the bar-prompts.json cache drops entries unseen for 24 hours, ignores a bad file, and a failing write does not stop the snapshot', (t) => {
  const claudeDir = tmp(t);
  const dataDir = tmp(t);
  writeSession(claudeDir, 100);
  writeTranscript(claudeDir, 'sid-100', [typed('a request')]);
  const ps = () => parsePs('  100 1 0.0 1 claude');
  const day = 24 * 60 * 60 * 1000;
  const entry = (seenAt) => ({ size: 5, prompt: null, seenAt });
  writeJson(dataDir, 'bar-prompts.json', { version: 1, entries: { '/home/me/old.jsonl': entry(NOW - day - 1), '/home/me/recent.jsonl': entry(NOW - day + 60_000), '/home/me/bad.jsonl': { size: 'x' } } });
  collect(t, { claudeDir, dataDir, ps, detail: true });
  const keys = Object.keys(JSON.parse(readFileSync(join(dataDir, 'bar-prompts.json'), 'utf8')).entries).sort();
  assert.equal(keys.length, 2);
  assert.ok(keys.includes('/home/me/recent.jsonl'));
  assert.ok(!keys.includes('/home/me/old.jsonl') && !keys.includes('/home/me/bad.jsonl'));

  // Not JSON, wrong version: no cache, same result.
  for (const text of ['{not json', JSON.stringify({ version: 2, entries: {} })]) {
    writeFileSync(join(dataDir, 'bar-prompts.json'), text);
    assert.equal(collect(t, { claudeDir, dataDir, ps, detail: true }).sessions[0].detail.prompt.text, 'a request');
  }
  // A directory where the file belongs: the write fails and the snapshot is still produced.
  const blocked = tmp(t);
  mkdirSync(join(blocked, 'bar-prompts.json'));
  assert.equal(collect(t, { claudeDir, dataDir: blocked, ps, detail: true }).sessions[0].detail.prompt.text, 'a request');
});

test('collectActivity with detail adds prompt, reply, recent and procs to every row, and without it adds no detail key', (t) => {
  const claudeDir = tmp(t);
  writeSession(claudeDir, 100, { status: 'busy' });
  writeSession(claudeDir, 150);
  writeTranscript(claudeDir, 'sid-100', [typed('please build the thing'), said('building it now'), call('t1', 'Bash', { description: 'Run build' })]);
  const table = parsePs([
    '  100 1 1.5 1000 claude',
    '  101 100 8.0 2048 /bin/zsh',
    '  102 100 8.0 4096 /usr/bin/node',
    '  103 100 8.0 4096 /usr/bin/Python.exe',
    '  104 100 40.0 1024 /usr/bin/rg',
    '  105 101 0.1 512 sleep',
    '  106 101 0.2 512 cat',
    '  107 101 0.3 512 tail',
    '  150 1 0.0 1000 claude',
    '  400 1 3.0 40960 /usr/local/bin/codex',
    '  401 400 4.0 10240 codex',
  ].join('\n'));
  const plain = collect(t, { claudeDir, ps: () => table });
  assert.ok(plain.sessions.every((r) => !('detail' in r)));
  const snap = collect(t, { claudeDir, ps: () => table, detail: true });
  assert.ok(snap.sessions.every((r) => Object.keys(r.detail).join() === 'prompt,reply,recent,procs'));
  const row = snap.sessions.find((r) => r.pid === 100);
  assert.deepEqual(row.detail.prompt, { text: 'please build the thing', at: NOW });
  assert.deepEqual(row.detail.reply, { text: 'building it now', at: NOW });
  assert.deepEqual(row.detail.recent, [{ at: NOW, tool: 'Bash', target: 'Run build', pending: true }]);
  // Heaviest first (CPU, then memory, then pid), five at most, the root left out, .exe dropped, CPU as a share of 4 cores.
  assert.deepEqual(row.detail.procs, [
    { pid: 104, name: 'rg', cpuPct: 10, rssMb: 1 },
    { pid: 102, name: 'node', cpuPct: 2, rssMb: 4 },
    { pid: 103, name: 'Python', cpuPct: 2, rssMb: 4 },
    { pid: 101, name: 'zsh', cpuPct: 2, rssMb: 2 },
    { pid: 107, name: 'tail', cpuPct: 0.1, rssMb: 1 },
  ]);
  // A Claude row without a transcript and a Codex row get the empty shape with their own processes.
  const idle = snap.sessions.find((r) => r.pid === 150);
  assert.deepEqual(idle.detail, { prompt: null, reply: null, recent: [], procs: [] });
  const codex = snap.sessions.find((r) => r.agent === 'codex');
  assert.deepEqual(codex.detail, { prompt: null, reply: null, recent: [], procs: [{ pid: 401, name: 'codex', cpuPct: 1, rssMb: 10 }] });
  // No process table: the shape stays and procs is empty.
  const blind = collect(t, { claudeDir, ps: () => null, isAlive: () => true, detail: true });
  assert.ok(blind.sessions.every((r) => Array.isArray(r.detail.procs) && r.detail.procs.length === 0));
});

test('run --json --detail asks for detail, plain --json asks for nothing, and --detail alone is a usage error', async () => {
  const seen = [];
  const collect = (...args) => { seen.push(args); return snapshot(); };
  const r = await runBar(['--json', '--detail'], collect);
  assert.deepEqual(seen, [[{ detail: true }]]);
  assert.equal(JSON.parse(r.out).totals.sessions, 3);
  await runBar(['--json'], collect);
  assert.deepEqual(seen[1], []);
  seen.length = 0;
  const bad = await runBar(['--detail'], collect);
  assert.equal(bad.code, 2);
  assert.equal(bad.out, '');
  assert.equal(bad.err, 'sprag bar: --detail needs --json\n');
  assert.deepEqual(seen, []);
  const bar = await runBar(['--swiftbar', '--detail'], collect);
  assert.equal(bar.code, 2);
  assert.deepEqual(seen, []);
});
