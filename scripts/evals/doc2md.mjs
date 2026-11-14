#!/usr/bin/env node
/**
 * Export the document-conversion layer of the proof page from the local doc2md ledger.
 *
 *   node scripts/evals/doc2md.mjs        write evals/doc2md.json
 *
 * The ledger (src/doc2md-ledger.cjs) holds one event per document sprag converted to Markdown
 * before the model read it: when, the format, the tokens the Markdown costs and the tokens the
 * same document would have cost without the conversion (the per-format baseline measured in that
 * file's header). Only aggregates leave the machine: extensions and token counts, no source
 * paths, no file names, no dollar figures. Output is deterministic for a given ledger.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { userDataDir } from '../../src/paths.js';
import { isMain } from './lib.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(here, '..', '..', 'evals', 'doc2md.json');

const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const ratio = (baseline, tokens) => Math.round(baseline / Math.max(1, tokens) * 10) / 10;

/** Pure: ledger events -> the aggregate the page shows, or null when no event is countable. */
export function summariseDoc2md(events) {
  const rows = new Map();
  const stamps = [];
  let n = 0, baseline = 0, tokens = 0;
  for (const e of events || []) {
    if (!e || !Number.isFinite(e.tokens) || !Number.isFinite(e.baseline)) continue;
    if (!(e.baseline > 0) || e.tokens < 0 || !e.ts) continue;
    const ext = String(e.ext || '').toLowerCase().replace(/^\./, '');
    if (!/^[a-z0-9]{1,6}$/.test(ext)) continue;
    const ms = new Date(e.ts).getTime();
    if (!Number.isFinite(ms)) continue;
    stamps.push(ms);
    n++; baseline += e.baseline; tokens += e.tokens;
    const row = rows.get(ext) || { ext, n: 0, baseline: 0, tokens: 0 };
    row.n++; row.baseline += e.baseline; row.tokens += e.tokens;
    rows.set(ext, row);
  }
  if (!n) return null;
  const byExt = [...rows.values()]
    .map((r) => ({ ext: r.ext, n: r.n, baseline: r.baseline, tokens: r.tokens, x: ratio(r.baseline, r.tokens) }))
    .sort((a, b) => b.x - a.x || a.ext.localeCompare(b.ext));
  return {
    since: day(Math.min(...stamps)),
    until: day(Math.max(...stamps)),
    n, baseline, tokens,
    pct: Math.round((1 - tokens / baseline) * 100),
    byExt,
  };
}

export function main({ out = DEFAULT_OUT, log = console.log, events } = {}) {
  const list = events || Object.values(require('../../src/doc2md-ledger.cjs').loadLedger(userDataDir()).events || {});
  const doc = summariseDoc2md(list);
  if (!doc) {
    console.error('doc2md: no countable conversion in the ledger, nothing written');
    return 1;
  }
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  log(`doc2md: ${doc.n} documents, ${doc.since} to ${doc.until}, ${doc.pct}% fewer tokens (${doc.baseline} -> ${doc.tokens}) -> ${out}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
