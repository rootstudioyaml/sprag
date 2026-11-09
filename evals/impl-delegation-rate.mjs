#!/usr/bin/env node
// Measures how often an implementation turn was delegated instead of edited by
// the main model, from the Claude Code session transcripts on this machine.
//
// A turn is one user prompt (type "user", string content not starting with "<")
// plus every assistant tool_use up to the next such prompt. Sidechain lines
// (subagent transcripts) are ignored.
//   delegated turn: an Agent/Task/spawn_agent call to an implementer
//     (countsAsDelegation in src/impl-follow.js) whose prompt reads like an
//     implementation brief (files to change, completion criteria, test command).
//   direct turn: no such delegation, and the main model edited three or more
//     distinct code files with Edit, Write or MultiEdit. Documents, anything
//     under /.claude/, /tmp, /private/ and /var/folders do not count.
// Also reports, for direct turns, the median share of the turn's edit text
// (Edit new_string, Write content) that still came after the 1st, 2nd and 3rd
// distinct code file: how much work was left when a reminder could have fired.
//
// Read-only. Usage:
//   node evals/impl-delegation-rate.mjs [--since YYYY-MM-DD] [--until YYYY-MM-DD]
//                                       [--projects <dir>] [--json]
// Defaults: --since 30 days ago, --projects $CLAUDE_CONFIG_DIR/projects
// (else ~/.claude/projects). Dates are UTC days of the user line's timestamp.

import { createReadStream, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countsAsDelegation, excludedPath } from '../src/impl-follow.js';

export const DIRECT_FILES = 3;
const BRIEF_RE = /수정할 파일|완료 기준|테스트 명령|구현|implement|files to (change|edit)|completion criteria/i;
const DELEGATE_TOOLS = new Set(['Task', 'Agent', 'spawn_agent']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

const isoDay = (ts) => (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : null);

function isUserTurn(rec) {
  if (rec?.type !== 'user') return false;
  const c = rec.message?.content;
  return typeof c === 'string' && c.length > 0 && !c.startsWith('<');
}

/** Characters of new text one edit tool call writes. */
function editChars(tool, input) {
  if (tool === 'Edit') return String(input?.new_string ?? '').length;
  if (tool === 'Write') return String(input?.content ?? '').length;
  if (tool === 'MultiEdit') return (Array.isArray(input?.edits) ? input.edits : []).reduce((n, e) => n + String(e?.new_string ?? '').length, 0);
  return 0;
}

/** True for a code file that counts toward a direct implementation turn. */
function isCodeFile(file) {
  return typeof file === 'string' && file !== '' && !excludedPath(file) && !file.startsWith('/private/');
}

/** Folds one tool_use into the turn being built. */
function addTool(turn, name, input) {
  const tool = String(name || '').replace(/^(?:functions|tools)\./, '');
  if (DELEGATE_TOOLS.has(tool)) {
    const brief = String(input?.prompt ?? input?.message ?? '');
    if (countsAsDelegation(tool, input) && BRIEF_RE.test(brief)) turn.delegated = true;
    return;
  }
  if (!EDIT_TOOLS.has(tool)) return;
  const file = input?.file_path;
  if (!isCodeFile(file)) return;
  turn.edits.push({ file, chars: editChars(tool, input) });
}

/**
 * Reads every <dir>/<project>/*.jsonl and returns the turns that delegated or
 * edited at least one code file: [{ date, delegated, edits: [{ file, chars }] }].
 *
 * @param {string} dir the projects directory
 * @param {{since?: string, until?: string}} [range] inclusive UTC days, YYYY-MM-DD
 */
export async function collectTurns(dir, { since, until } = {}) {
  const turns = [];
  let projects = [];
  try { projects = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return turns; }
  const sinceMs = since ? Date.parse(`${since}T00:00:00Z`) : null;
  for (const p of projects) {
    let names = [];
    try { names = readdirSync(join(dir, p.name)).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
    for (const n of names) {
      const file = join(dir, p.name, n);
      try { if (sinceMs !== null && statSync(file).mtimeMs < sinceMs) continue; } catch { continue; }
      let cur = null;
      const flush = () => {
        if (cur && cur.date && (cur.delegated || cur.edits.length)) turns.push(cur);
        cur = null;
      };
      const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        if (rec?.isSidechain) continue;
        if (isUserTurn(rec)) {
          flush();
          const date = isoDay(rec.timestamp);
          const inRange = date && (!since || date >= since) && (!until || date <= until);
          cur = inRange ? { date, delegated: false, edits: [] } : null;
          continue;
        }
        if (!cur || rec?.type !== 'assistant' || !Array.isArray(rec.message?.content)) continue;
        for (const block of rec.message.content) {
          if (block?.type === 'tool_use') addTool(cur, block.name, block.input);
        }
      }
      flush();
    }
  }
  return turns;
}

/** ISO 8601 week label ("2026-W45") of a YYYY-MM-DD day. */
export function isoWeek(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Share of the turn's edit text that comes after the call that first touches the k-th distinct file. */
function shareAfter(edits, k) {
  const total = edits.reduce((n, e) => n + e.chars, 0);
  if (!total) return null;
  const seen = new Set();
  let used = 0;
  for (const e of edits) {
    used += e.chars;
    seen.add(e.file);
    if (seen.size === k) return (total - used) / total;
  }
  return null;
}

/** Weekly counts, totals and the remaining-share medians from collectTurns output. */
export function summarize(turns) {
  const weeks = new Map();
  const shares = [[], [], []];
  const bucket = (t) => {
    const w = isoWeek(t.date);
    if (!weeks.has(w)) weeks.set(w, { week: w, delegated: 0, direct: 0 });
    return weeks.get(w);
  };
  for (const t of turns) {
    if (t.delegated) {
      bucket(t).delegated++;
    } else if (new Set(t.edits.map((e) => e.file)).size >= DIRECT_FILES) {
      bucket(t).direct++;
      for (let k = 1; k <= 3; k++) {
        const s = shareAfter(t.edits, k);
        if (s !== null) shares[k - 1].push(s);
      }
    }
  }
  const rate = (d, x) => (d + x ? Math.round((1000 * d) / (d + x)) / 10 : null);
  const rows = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).map((w) => ({ ...w, ratePct: rate(w.delegated, w.direct) }));
  const delegated = rows.reduce((n, r) => n + r.delegated, 0);
  const direct = rows.reduce((n, r) => n + r.direct, 0);
  return {
    weeks: rows,
    total: { delegated, direct, ratePct: rate(delegated, direct) },
    medianRemainingShare: { afterFile1: median(shares[0]), afterFile2: median(shares[1]), afterFile3: median(shares[2]), directTurns: shares[0].length },
  };
}

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--since') out.since = argv[++i];
    else if (a === '--until') out.until = argv[++i];
    else if (a === '--projects') out.projects = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function render(s, range) {
  const pct = (v) => (v === null ? '-' : `${Math.round(v * 100)}%`);
  const lines = [`window ${range.since}${range.until ? ` .. ${range.until}` : ''}`, '', 'week       delegated  direct  rate'];
  for (const r of s.weeks) lines.push(`${r.week}  ${String(r.delegated).padStart(9)}  ${String(r.direct).padStart(6)}  ${r.ratePct === null ? '-' : `${r.ratePct}%`}`);
  lines.push(`total      ${String(s.total.delegated).padStart(9)}  ${String(s.total.direct).padStart(6)}  ${s.total.ratePct === null ? '-' : `${s.total.ratePct}%`}`, '');
  const m = s.medianRemainingShare;
  lines.push(`median share of edit text still to come, over ${m.directTurns} direct turns:`);
  lines.push(`  after file 1: ${pct(m.afterFile1)}   after file 2: ${pct(m.afterFile2)}   after file 3: ${pct(m.afterFile3)}`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = args.since || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const base = args.projects || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  const turns = await collectTurns(base, { since, until: args.until });
  const summary = summarize(turns);
  const range = { since, until: args.until || null };
  console.log(args.json ? JSON.stringify({ range, ...summary }, null, 2) : render(summary, range));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
