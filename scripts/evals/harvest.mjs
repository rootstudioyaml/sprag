// Scan Claude Code transcripts for Agent/Task delegations and write <work>/candidates.jsonl.
// Usage: node scripts/evals/harvest.mjs [--days 30] [--project <substring>]
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { workDir, sha10, maskSecrets, claudeProjects, readJson, isMain } from './lib.mjs';

const INJECTED = ['<task-notification', '[SYSTEM NOTIFICATION', 'Another Claude session sent a message', '<agent-message', 'This session is being continued'];

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}
/** A genuine user prompt: text present, not a tool_result-only turn, not harness-injected. */
export function genuineUserText(entry) {
  if (entry.type !== 'user' || entry.isMeta) return null;
  const c = entry.message?.content;
  if (Array.isArray(c) && c.length && c.every((b) => b.type === 'tool_result')) return null;
  const t = textOf(c).trim();
  if (!t || INJECTED.some((p) => t.startsWith(p))) return null;
  return t;
}
const resultText = (b) => (typeof b.content === 'string' ? b.content : (b.content || []).map((x) => x.text || '').join('\n'));

/** Pure: entries of one main-session transcript -> candidates (secrets masked). */
export function parseCandidates(entries, { sessionId, project }) {
  const out = []; const byId = new Map(); let lastUser = null;
  for (const o of entries) {
    const u = genuineUserText(o);
    if (u != null) {
      for (const c of out) if (c.nextUserPrompt === null && c._open) { c.nextUserPrompt = maskSecrets(u); c._open = false; }
      lastUser = u;
    }
    for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
      if (o.type === 'assistant' && b.type === 'tool_use' && ['Agent', 'Task'].includes(b.name)) {
        const i = b.input || {};
        const c = { id: sha10(sessionId + b.id), session: sessionId, toolUseId: b.id, project, timestamp: o.timestamp,
          userPrompt: maskSecrets(lastUser || ''), subagentType: i.subagent_type ?? null, model: i.model ?? null, effort: i.effort ?? null,
          description: maskSecrets(i.description || ''), prompt: maskSecrets(i.prompt || ''), report: null, nextUserPrompt: null, _open: true };
        out.push(c); byId.set(b.id, c);
      } else if (b.type === 'tool_result' && byId.has(b.tool_use_id)) {
        byId.get(b.tool_use_id).report = maskSecrets(resultText(b));
      }
    }
  }
  return out.map(({ _open, ...c }) => c);
}
export function groupCounts(cands) {
  const m = {};
  for (const c of cands) { const k = `${c.subagentType || c.model || 'default'} / ${c.effort || '-'}`; m[k] = (m[k] || 0) + 1; }
  return m;
}
export function seenHashes(work) {
  const s = new Set(readJson(join(work, 'seen.json'), []));
  const rounds = join(work, 'rounds');
  if (existsSync(rounds)) for (const r of readdirSync(rounds)) {
    const d = join(rounds, r, 'cases');
    if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.md')) s.add(sha10(readFileSync(join(d, f), 'utf8').trim()));
  }
  return s;
}

export function harvest({ days = 30, project = null, root = claudeProjects(), work = workDir() } = {}) {
  const since = Date.now() - days * 864e5; const seen = seenHashes(work); const all = [];
  for (const dir of readdirSync(root)) {
    if (project && !dir.includes(project)) continue;
    const full = join(root, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const f of readdirSync(full)) {
      if (!f.endsWith('.jsonl')) continue; // subagents/ sit in directories, skipped here
      const p = join(full, f);
      if (statSync(p).mtimeMs < since) continue;
      const entries = readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
      for (const c of parseCandidates(entries, { sessionId: f.slice(0, -6), project: dir })) {
        if (Date.parse(c.timestamp) >= since && !seen.has(sha10(c.prompt.trim()))) all.push(c);
      }
    }
  }
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'candidates.jsonl'), all.map((c) => JSON.stringify(c)).join('\n') + (all.length ? '\n' : ''));
  return all;
}

export function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const cands = harvest({ days: Number(opt('--days') || 30), project: opt('--project') });
  console.log(`candidates: ${cands.length} -> ${join(workDir(), 'candidates.jsonl')}`);
  for (const [k, n] of Object.entries(groupCounts(cands)).sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
