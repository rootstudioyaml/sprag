#!/usr/bin/env node
/**
 * Export the real-usage layer of the proof page from the local delegation ledger.
 *
 *   node scripts/evals/live.mjs        write evals/live.json
 *
 * The ledger (src/savings-ledger.js) holds one event per subagent run that a sprag
 * rule routed in a real session: when, which model it would have run on, which
 * model it ran on, what the run cost and what the difference was. Nothing here is
 * replayed or graded, so the page shows these as counts and dollars only, apart
 * from the graded cases. Only aggregates leave the machine: no rule names, no
 * transcript paths, no prompts. Output is deterministic for a given ledger.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLedger, modelFamily } from '../../src/savings-ledger.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'evals', 'live.json');

const events = Object.values(loadLedger().events || {}).filter((e) => e && Number.isFinite(e.usd) && e.ts);
if (!events.length) {
  console.error('live: the delegation ledger is empty, nothing written');
  process.exit(1);
}
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const r2 = (v) => Math.round(v * 100) / 100;
const pairs = new Map();
const to = { haiku: 0, sonnet: 0, opus: 0 };
let cost = 0, costRuns = 0, saved = 0;
for (const e of events) {
  const f = modelFamily(e.from), t = modelFamily(e.to);
  const k = `${f}>${t}`;
  pairs.set(k, (pairs.get(k) || 0) + 1);
  if (t in to) to[t]++;
  saved += e.usd;
  if (Number.isFinite(e.cost)) { cost += e.cost; costRuns++; }
}
const ts = events.map((e) => e.ts);
const live = {
  since: day(Math.min(...ts)),
  until: day(Math.max(...ts)),
  runs: events.length,
  to,
  pairs: [...pairs].map(([k, n]) => ({ from: k.split('>')[0], to: k.split('>')[1], n })).sort((a, b) => b.n - a.n || a.from.localeCompare(b.from)),
  costUsd: r2(cost),
  costRuns,
  savedUsd: r2(saved),
};
writeFileSync(out, JSON.stringify(live, null, 2) + '\n');
console.log(`live: ${live.runs} routed delegations, ${live.since} to ${live.until}, cost $${live.costUsd} over ${live.costRuns}, saved $${live.savedUsd} -> ${out}`);
