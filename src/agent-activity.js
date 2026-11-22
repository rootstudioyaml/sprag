/**
 * What each running agent session is doing right now, and what it costs the
 * machine, for `sprag bar` (terminal table, JSON, SwiftBar/xbar menu bar text).
 *
 * Where the data comes from:
 *   - Claude Code writes <claudeDir>/sessions/<pid>.json for every running
 *     process: pid, sessionId, cwd, name, status ('busy' or 'idle'),
 *     statusUpdatedAt, updatedAt, kind, entrypoint. This is an undocumented
 *     internal file; the fields were checked against Claude Code 2.1.319 on
 *     2026-11-21. It may be missing or change shape, so every read here is
 *     defensive and a surprise never fails the command. The `.key` files in the
 *     same folder are never read.
 *   - The tool a busy session is running is the last `tool_use` in its
 *     transcript that has no `tool_result` yet, found by regex over the final
 *     bytes of the file. Nothing parses a whole transcript.
 *   - Subagents come from runningSubagents() (statusline-running.js).
 *   - CPU and memory come from one `ps` call. Every process is charged to the
 *     nearest session root above it, so a session's row includes its tool
 *     processes and an inner session started from a tool counts only for itself.
 *     The process taking the snapshot and its children are charged to no one.
 *     The figures are one instant: a helper that lives a fraction of a second,
 *     such as a statusline refresh, shows in one snapshot and not the next, so
 *     a caller that redraws should smooth over several snapshots.
 *   - Codex has no session file; a `codex` process with no codex or Claude
 *     session above it is a row of its own. Its rollout file is found through
 *     the files the process holds open (agent-usage.js).
 *   - Warnings (the statusline's `⚠` issue chip and `🚨` rate-limit chips, with
 *     their advice) come from agent-warnings.js: the limits above, the chip
 *     state and the history files in the user data folder.
 *   - Model, context window use, tokens, cost and the account limits come from
 *     agent-usage.js: the transcript tail, the statusline's caches in the user
 *     data folder, and the Codex rollout files.
 *   - A Claude row's effort level is the one the statusline recorded in the user
 *     data folder (session-effort.js); Codex rows read theirs from the rollout.
 *   - With `detail`, each row also carries the session's latest typed request, its
 *     last reply, its recent tool calls (agent-detail.js, from the transcript tail)
 *     and its heaviest child processes. Without it none of that is read.
 *
 * The child processes this module starts are `ps`, and `lsof` while a Codex
 * process is running. It never re-runs the sprag CLI and never spawns a
 * detached child. The one file it writes is <dataDir>/bar-prompts.json, and only
 * with `detail`: per transcript, the size seen and the request found, so the
 * next snapshot scans just the bytes added since. It holds the user's own text,
 * so it is mode 0600, and entries unseen for 24 hours are dropped.
 */

import { readdirSync, readFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { basename, join } from 'node:path';
import { claudeConfigDir, projectTranscriptDir } from './commands/panel.js';
import { runningSubagents } from './statusline-running.js';
import { userDataDir } from './paths.js';
import { readTeamChip } from './team-sync.js';
import { SPECIES, GRADES } from './office-species.js';
import { scorePctOf, nextOf, floorPct } from './team-standing.js';
import { loadCache } from './session-cache.js';
import { codexUserDir } from './agent.js';
import { userLanguage } from './config.js';
import { readSessionEffort } from './session-effort.js';
import { sessionDetail } from './agent-detail.js';
import { writeStateFile } from './state-file.js';
import { currentWarnings } from './agent-warnings.js';
import {
  readTail, claudeLimits, claudeSessionDetail, recentRollouts, defaultOpenFiles, pickRollout,
  readRollout, codexRowFields, codexLimits,
} from './agent-usage.js';

export const PS_ARGS = ['-A', '-o', 'pid=,ppid=,pcpu=,rss=,comm='];
/** Program names (lowercase, no .exe) a live Claude Code process can show in `ps`. */
const CLAUDE_COMMS = new Set(['claude', 'node', 'bun']);
/** Most parent hops followed when charging a process to a session. */
const MAX_HOPS = 64;
/** Child processes listed per row with `detail`. */
const DETAIL_PROCS = 5;
const PROMPT_CACHE_FILE = 'bar-prompts.json';
const PROMPT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** An unchanged entry is rewritten for its `seenAt` only this often, so a poll every few seconds does not write every time. */
const PROMPT_SEEN_REFRESH_MS = 60 * 60 * 1000;

/**
 * Parse `ps -o pid=,ppid=,pcpu=,rss=,comm=` output. The first four columns are
 * numbers and the rest of the line is the command, which on macOS is a full
 * path that may hold spaces. Lines of any other shape are skipped.
 *
 * @returns {Map<number, { pid: number, ppid: number, cpu: number, rssKb: number, comm: string }>}
 */
export function parsePs(text) {
  const table = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    table.set(pid, { pid, ppid: Number(m[2]), cpu: Number(m[3]), rssKb: Number(m[4]), comm: m[5] });
  }
  return table;
}

const samePrompt = (a, b) => (a === null || b === null ? a === b : a.text === b.text && a.at === b.at);

function validEntry(e) {
  if (!e || typeof e !== 'object' || !Number.isFinite(e.size) || !Number.isFinite(e.seenAt)) return false;
  const p = e.prompt;
  return p === null || (p && typeof p === 'object' && typeof p.text === 'string' && (p.at === null || Number.isFinite(p.at)));
}

/**
 * The request each transcript showed the last time `--detail` ran, with the file
 * size it was seen at. Any failure to read or write it means no cache: the
 * snapshot is still produced, only a slower first look at a long transcript.
 */
function openPromptCache(dataDir, now) {
  const file = join(dataDir, PROMPT_CACHE_FILE);
  let entries = {};
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data?.version === 1 && data.entries && typeof data.entries === 'object') {
      for (const [key, e] of Object.entries(data.entries)) if (validEntry(e)) entries[key] = e;
    }
  } catch { entries = {}; }
  let dirty = false;
  return {
    known(transcript) {
      const e = entries[transcript];
      return e ? { size: e.size, prompt: e.prompt } : null;
    },
    remember(transcript, size, prompt) {
      const old = entries[transcript];
      if (old && old.size === size && samePrompt(old.prompt, prompt) && now - old.seenAt < PROMPT_SEEN_REFRESH_MS) return;
      entries[transcript] = { size, prompt, seenAt: now };
      dirty = true;
    },
    save() {
      try {
        for (const [key, e] of Object.entries(entries)) {
          if (now - e.seenAt > PROMPT_CACHE_TTL_MS) { delete entries[key]; dirty = true; }
        }
        if (!dirty) return;
        writeStateFile(file, JSON.stringify({ version: 1, entries }));
        if (process.platform !== 'win32') {
          try { chmodSync(file, 0o600); } catch { /* the file is written; the mode is best effort */ }
        }
      } catch { /* no cache this time */ }
    },
  };
}

/** The process table from one `ps` call, or null when there is no ps (Windows) or it fails. */
export function defaultPs() {
  if (process.platform === 'win32') return null;
  try {
    const out = execFileSync('ps', PS_ARGS, { encoding: 'utf8', timeout: 1500, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return parsePs(out);
  } catch {
    return null;
  }
}

/** The session files of running Claude Code processes. Unreadable or malformed ones are skipped. */
export function readClaudeSessions(claudeDir) {
  const dir = join(claudeDir, 'sessions');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (!data || typeof data !== 'object') continue;
      if (!Number.isFinite(data.pid) || typeof data.sessionId !== 'string') continue;
      out.push(data);
    } catch { /* partial write or foreign file */ }
  }
  return out;
}

/**
 * Names of the tool calls near the end of a transcript that have no result yet,
 * in the order they were called. Calls whose result is older than the tail
 * window cannot be seen, which only ever hides a finished call.
 *
 * @returns {string[]} [] when the file cannot be read
 */
export function pendingTools(transcriptPath, { tailBytes = 256 * 1024 } = {}) {
  const tail = readTail(transcriptPath, tailBytes);
  if (!tail) return [];
  const calls = new Map();
  for (const m of tail.text.matchAll(/"type":"tool_use","id":"([^"]+)","name":"([^"]+)"/g)) {
    if (!calls.has(m[1])) calls.set(m[1], m[2]);
  }
  for (const m of tail.text.matchAll(/"tool_use_id":"([^"]+)"/g)) calls.delete(m[1]);
  return [...calls.values()];
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

/** Lowercase program name of a `ps` comm, without directories or a trailing .exe. */
function commName(comm) {
  return basename(String(comm ?? '')).toLowerCase().replace(/\.exe$/, '');
}

const round1 = (n) => Math.round(n * 10) / 10;
const finiteOr = (v, fallback = null) => (Number.isFinite(v) ? v : fallback);

/**
 * The ranking behind the animal, for a menu bar: an animal alone reads as
 * decoration, so the rank, the score percentile and the next species go with it.
 * `st` is the standing readTeamChip() returns; the species is known to exist.
 */
function standingFor(st, { lang, org }) {
  const name = (key) => (lang === 'ko' ? SPECIES[key].ko : SPECIES[key].en);
  const sr = scorePctOf(st);
  const up = nextOf(st, sr);
  const upRow = up && SPECIES[up.grade] ? GRADES.find((g) => g.key === up.grade) : null;
  return {
    grade: st.grade,
    emoji: SPECIES[st.grade].emoji,
    name: name(st.grade),
    org: typeof org === 'string' && org ? org : null,
    rank: finiteOr(st.rank),
    ranked: finiteOr(st.ranked),
    crown: !!st.crown,
    idle: st.idle === true,
    // 0..100, the share of ranked people this score is ahead of.
    scorePct: Number.isFinite(sr) ? Math.round(sr * 100) : null,
    spendRank: finiteOr(st.spendRank),
    dlgRank: finiteOr(st.dlgRank),
    next: upRow ? {
      grade: up.grade, emoji: SPECIES[up.grade].emoji, name: name(up.grade),
      floorPct: floorPct(upRow), pass: finiteOr(up.pass), needDlg: !!up.needDlg,
    } : null,
  };
}
/** Logical cores: `ps` reports CPU per core, so 100% is one core and a busy machine adds up past 100. */
const defaultCores = () => os.availableParallelism?.() ?? os.cpus().length;
const dirName = (cwd) => (typeof cwd === 'string' && cwd ? basename(cwd) || null : null);

function claudeRow(file, { claudeDir, dataDir, now, table, env, getCache, detail, promptCache }) {
  const cwd = typeof file.cwd === 'string' && file.cwd ? file.cwd : null;
  const project = dirName(cwd);
  const name = typeof file.name === 'string' && file.name.trim() ? file.name : (project || `claude ${file.pid}`);
  const state = typeof file.status === 'string' ? file.status : null;
  let transcript = null;
  if (cwd) {
    try { transcript = join(projectTranscriptDir(cwd, { claudeDir }), `${file.sessionId}.jsonl`); } catch { transcript = null; }
  }
  let subagents = 0;
  try { subagents = runningSubagents(transcript, { now })?.count ?? 0; } catch { subagents = 0; }
  // A call the user interrupted never gets a result, so only a busy session shows tools.
  const tools = state === 'busy' ? pendingTools(transcript) : [];
  const usage = claudeSessionDetail({ sessionId: file.sessionId, transcript, dataDir, cache: getCache(), env, now });
  let effort = null;
  try { effort = readSessionEffort(file.sessionId, { dir: dataDir }); } catch { effort = null; }
  const row = {
    agent: 'claude',
    pid: file.pid,
    sessionId: file.sessionId,
    name,
    project,
    cwd,
    kind: typeof file.kind === 'string' ? file.kind : null,
    state,
    stateSince: Number.isFinite(file.statusUpdatedAt) ? file.statusUpdatedAt : null,
    tools,
    subagents,
    model: usage.model,
    modelName: usage.modelName,
    effort,
    context: usage.context,
    usage: usage.usage,
    compactions: usage.compactions,
    cpu: table ? 0 : null,
    cpuPct: null,
    rssMb: table ? 0 : null,
    procs: table ? 0 : null,
  };
  if (detail) {
    const known = transcript && promptCache ? promptCache.known(transcript) : null;
    const { size, ...seen } = sessionDetail({ transcript, known });
    if (transcript && promptCache && Number.isFinite(size)) promptCache.remember(transcript, size, seen.prompt);
    row.detail = { ...seen, procs: [] };
  }
  return row;
}

// The order never depends on a live reading. A menu bar panel redraws every few
// seconds, and rows sorted by CPU traded places while no session had changed.
function compareRows(a, b) {
  const busy = (r) => (r.state === 'busy' ? 0 : 1);
  return busy(a) - busy(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.pid - b.pid;
}

/**
 * One snapshot of every running agent session. Never throws: a missing sessions
 * folder gives zero rows and a failed `ps` gives rows with null resources.
 */
export function collectActivity({
  claudeDir = claudeConfigDir(),
  dataDir = userDataDir(),
  ps = defaultPs,
  now = Date.now(),
  isAlive = defaultIsAlive,
  readChip = () => readTeamChip({ dir: dataDir }),
  codexHome = codexUserDir(),
  openFiles = defaultOpenFiles,
  cores = defaultCores(),
  env = process.env,
  selfPid = process.pid,
  lang = userLanguage(),
  warningsOf = currentWarnings,
  detail = false,
} = {}) {
  let codexPidsOf = null;
  let table = null;
  try { table = ps(); } catch { table = null; }
  if (!(table instanceof Map)) table = null;

  // One read of the parse cache serves every row of the snapshot.
  let cache;
  const getCache = () => (cache ??= loadCache(join(dataDir, 'session-cache.json')));

  const promptCache = detail ? openPromptCache(dataDir, now) : null;
  const rows = [];
  try {
    for (const file of readClaudeSessions(claudeDir)) {
      // A pid that `ps` shows as some other program is a stale file whose pid was reused.
      const alive = table
        ? (table.has(file.pid) && CLAUDE_COMMS.has(commName(table.get(file.pid).comm)))
        : isAlive(file.pid);
      if (!alive) continue;
      rows.push(claudeRow(file, { claudeDir, dataDir, now, table, env, getCache, detail, promptCache }));
    }
  } catch { /* keep whatever was read */ }
  promptCache?.save();

  const rootOf = new Map(rows.map((r) => [r.pid, r]));
  const claudePids = new Set(rootOf.keys());

  if (table) {
    for (const p of table.values()) {
      if (commName(p.comm) !== 'codex' || claudePids.has(p.pid)) continue;
      let nested = false;
      let cur = table.get(p.ppid);
      for (let hop = 0; cur && hop < MAX_HOPS; hop++) {
        if (claudePids.has(cur.pid) || commName(cur.comm) === 'codex') { nested = true; break; }
        cur = table.get(cur.ppid);
      }
      if (nested) continue;
      const row = {
        agent: 'codex', pid: p.pid, sessionId: null, name: 'codex', project: null, cwd: null, kind: null,
        state: null, stateSince: null, tools: [], subagents: 0,
        model: null, modelName: null, effort: null, context: null, usage: null,
        cpu: 0, cpuPct: null, rssMb: 0, procs: 0,
      };
      if (detail) row.detail = { prompt: null, reply: null, recent: [], procs: [] };
      rows.push(row);
      rootOf.set(p.pid, row);
    }

    const kb = new Map(rows.map((r) => [r, { cpu: 0, kb: 0 }]));
    const charged = detail ? new Map(rows.map((r) => [r, []])) : null;
    // A Codex row's own process and the codex processes under it: the native
    // binary behind a wrapper may be the one holding the rollout file open.
    const codexPids = new Map(rows.filter((r) => r.agent === 'codex').map((r) => [r, []]));
    for (const p of table.values()) {
      let cur = p;
      let root = null;
      const seen = new Set();
      for (let hop = 0; cur && hop <= MAX_HOPS && !seen.has(cur.pid); hop++) {
        seen.add(cur.pid);
        // This process and the `ps` it started are the measurement, not the session's work.
        if (cur.pid === selfPid) break;
        if (rootOf.has(cur.pid)) { root = rootOf.get(cur.pid); break; }
        cur = table.get(cur.ppid);
      }
      if (!root) continue;
      const acc = kb.get(root);
      acc.cpu += p.cpu;
      acc.kb += p.rssKb;
      root.procs += 1;
      if (charged && p.pid !== root.pid) charged.get(root).push(p);
      if (codexPids.has(root) && commName(p.comm) === 'codex') codexPids.get(root).push(p.pid);
    }
    for (const [row, acc] of kb) {
      row.cpu = round1(acc.cpu);
      row.rssMb = Math.round(acc.kb / 1024);
    }
    codexPidsOf = codexPids;
    if (charged) {
      for (const [row, list] of charged) {
        list.sort((a, b) => b.cpu - a.cpu || b.rssKb - a.rssKb || a.pid - b.pid);
        row.detail.procs = list.slice(0, DETAIL_PROCS).map((p) => ({
          pid: p.pid,
          name: basename(String(p.comm ?? '')).replace(/\.exe$/i, ''),
          cpuPct: cores > 0 ? round1(p.cpu / cores) : null,
          rssMb: Math.round(p.rssKb / 1024),
        }));
      }
    }
  }

  const rollouts = recentRollouts({ codexHome, now });
  const rolloutAt = new Map();
  const rolloutOf = (file) => {
    if (!rolloutAt.has(file)) rolloutAt.set(file, readRollout(file));
    return rolloutAt.get(file);
  };
  const codexRows = rows.filter((r) => r.agent === 'codex');
  if (codexRows.length) {
    let open = null;
    try { open = openFiles([...new Set(codexRows.flatMap((r) => codexPidsOf?.get(r) ?? [r.pid]))]); } catch { open = null; }
    for (const row of codexRows) {
      const file = pickRollout({ pids: codexPidsOf?.get(row) ?? [row.pid], open, rollouts, onlyRow: codexRows.length === 1, now });
      const rollout = file ? rolloutOf(file) : null;
      if (!rollout) continue;
      const { cwd, ...fields } = codexRowFields(rollout);
      Object.assign(row, fields, { cwd, project: dirName(cwd), name: dirName(cwd) || 'codex' });
    }
  }

  const resources = table !== null;
  for (const r of rows) r.cpuPct = resources && cores > 0 ? round1(r.cpu / cores) : null;

  rows.sort(compareRows);

  let animal = null;
  let standing = null;
  try {
    const chip = readChip();
    const grade = chip?.standing?.grade;
    if (typeof grade === 'string' && SPECIES[grade]) {
      animal = { grade, emoji: SPECIES[grade].emoji };
      try { standing = standingFor(chip.standing, { lang, org: chip.org }); } catch { standing = null; }
    }
  } catch { animal = null; standing = null; }

  const sum = (key) => rows.reduce((n, r) => n + r[key], 0);
  const costs = rows.map((r) => r.usage?.costUsd).filter((c) => typeof c === 'number' && Number.isFinite(c));
  const totalCpu = resources ? round1(sum('cpu')) : null;
  let codexUsage = null;
  try {
    const newest = rollouts[0] ? rolloutOf(rollouts[0].file) : null;
    const limits = codexLimits(newest?.snapshot?.rateLimits, now);
    // `at` is when that rollout was last written. With no Codex running the
    // figure can be most of a day old, and a reader should be able to say so.
    codexUsage = limits ? { ...limits, at: Math.round(rollouts[0].mtimeMs) } : null;
  } catch { codexUsage = null; }
  const claude = claudeLimits({ dataDir, now });
  let warnings = [];
  try {
    const found = warningsOf({ dataDir, now, lang, limits: claude });
    warnings = Array.isArray(found) ? found : [];
  } catch { warnings = []; }
  return {
    at: now,
    resources,
    cores,
    animal,
    standing,
    usage: { claude, codex: codexUsage },
    warnings,
    totals: {
      sessions: rows.length,
      warnings: warnings.length,
      busy: rows.filter((r) => r.state === 'busy').length,
      subagents: sum('subagents'),
      cpu: totalCpu,
      cpuPct: resources && cores > 0 ? round1(totalCpu / cores) : null,
      costUsd: costs.length ? Math.round(costs.reduce((n, c) => n + c, 0) * 100) / 100 : null,
      rssMb: resources ? sum('rssMb') : null,
      procs: resources ? sum('procs') : null,
    },
    sessions: rows,
  };
}
