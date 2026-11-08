#!/usr/bin/env node
/**
 * Snapshot the delegation prompts that the ledger still points at, before Claude Code's
 * transcript cleanup removes them.
 *
 *   node scripts/evals/snapshot.mjs        update <work>/ledger-snapshot.jsonl
 *
 * Each ledger event (src/savings-ledger.js) is keyed by a subagent transcript path.
 * While that file exists, its first user message is the prompt the main session handed
 * over, and the last assistant text is the answer that came back. This script copies
 * both, with the ledger's money fields, into one local JSONL line per event. The file is
 * accumulative: lines already written survive even after the transcript is gone, and a
 * rerun only adds or refreshes lines whose transcript is still on disk. It lives under
 * handoff/ (gitignored) because the prompts are private; secrets are masked anyway.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLedger, modelFamily } from '../../src/savings-ledger.js';
import { workDir, readJsonl, maskSecrets, isMain } from './lib.mjs';
import { genuineUserText } from './harvest.mjs';

const textOf = (c) => (typeof c === 'string' ? c : (c || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));

/** Pure: one subagent transcript plus its ledger event -> snapshot line (or null when no prompt). */
export function snapshotOf(key, ev, entries) {
  let prompt = null, answer = '', model = null, toolCalls = 0, first = null;
  for (const o of entries) {
    if (!first && o.type === 'user') first = o;
    if (prompt == null) { const t = genuineUserText(o); if (t != null) prompt = t; }
    if (o.type === 'assistant' && o.message) {
      model = model || o.message.model || null;
      const blocks = Array.isArray(o.message.content) ? o.message.content : [];
      toolCalls += blocks.filter((b) => b.type === 'tool_use').length;
      // Newer Claude Code returns the report through a SubagentHandback tool call, not a text block.
      const hb = blocks.find((b) => b.type === 'tool_use' && b.name === 'SubagentHandback');
      const t = hb ? String(hb.input?.message || '') : textOf(o.message.content); if (t.trim()) answer = t;
    }
  }
  if (prompt == null) return null;
  return {
    key, ts: ev.ts, rule: ev.rule ?? null, from: ev.from ?? null, to: ev.to ?? null, toFamily: modelFamily(ev.to),
    usd: ev.usd ?? null, cost: ev.cost ?? null, basis: ev.basis ?? null,
    model, toolCalls, cwd: first?.cwd ?? null, gitBranch: first?.gitBranch ?? null, session: first?.sessionId ?? null, agentId: first?.agentId ?? null,
    prompt: maskSecrets(prompt), answer: maskSecrets(answer), snappedAt: new Date().toISOString(),
  };
}

export function snapshot({ work = workDir(), ledger = loadLedger() } = {}) {
  const out = join(work, 'ledger-snapshot.jsonl');
  const prev = existsSync(out) ? readJsonl(out) : [];
  const byKey = new Map(prev.map((l) => [l.key, l]));
  const events = Object.entries(ledger.events || {});
  let alive = 0, added = 0, refreshed = 0, noPrompt = 0;
  for (const [key, ev] of events) {
    if (!key.endsWith('.jsonl') || !existsSync(key)) continue;
    alive++;
    const line = snapshotOf(key, ev, readJsonl(key));
    if (!line) { noPrompt++; continue; }
    if (byKey.has(key)) refreshed++; else added++;
    byKey.set(key, line);
  }
  const lines = [...byKey.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  mkdirSync(work, { recursive: true });
  writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  const by = (f) => lines.reduce((m, l) => { const k = f(l) || '-'; m[k] = (m[k] || 0) + 1; return m; }, {});
  return { out, events: events.length, alive, added, refreshed, noPrompt, total: lines.length, byTo: by((l) => l.toFamily), byProject: by((l) => l.cwd) };
}

if (isMain(import.meta.url)) {
  const r = snapshot();
  console.log(`ledger events ${r.events}, transcripts alive ${r.alive}, snapshot lines ${r.total} (added ${r.added}, refreshed ${r.refreshed}, no prompt ${r.noPrompt})`);
  console.log('by model:', JSON.stringify(r.byTo));
  console.log('by project:'); for (const [k, v] of Object.entries(r.byProject).sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`);
  console.log(`written: ${r.out}`);
}
