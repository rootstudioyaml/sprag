import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { codexUserDir } from '../agent.js';
import { userDataDir } from '../paths.js';
import { writeViaTmp } from '../state-file.js';
import { readResetMarks, isBeforeReset } from '../saved-reset.cjs';
import { codexPriceBook, readCodexPrices } from './cache-policy.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const ledgerDir = ({ home = codexUserDir(), dir = userDataDir() } = {}) => join(dir, 'codex-doc2md', hash(resolve(home)));
const finite = (n) => Number.isSafeInteger(n) && n >= 0;

/** Office XML versus the prepared Markdown, not native attachment billing. */
export function estimateCodexDocument(source, meta, { model, provider, home, dir, now = Date.now(), prices } = {}) {
  const unknown = (reason) => ({ usd: null, reason });
  if (meta.clipped || meta.truncated) return unknown('incomplete-text');
  if (!['.pptx', '.docx', '.xlsx'].includes(extname(source).toLowerCase()) || !finite(meta.markupBytes) || meta.markupBytes === 0) {
    return unknown('no-comparable-baseline');
  }
  if (!finite(meta.markdownBytes)) return unknown('missing-markdown-size');
  if (typeof model !== 'string' || !model || typeof provider !== 'string' || !provider) return unknown('unknown-model-provider');
  const book = codexPriceBook(provider, prices === undefined ? readCodexPrices({ home, dir, now }) : prices, { home });
  const rate = book?.prices?.[model]?.input;
  if (!Number.isFinite(rate) || rate < 0) return unknown('unpriced-model');
  const baseline = Math.ceil(meta.markupBytes / 4), tokens = Math.ceil(meta.markdownBytes / 4);
  return { usd: (baseline - tokens) * rate, baseline, tokens, savedTokens: baseline - tokens,
    method: 'office-xml-vs-markdown-bytes/4', model, provider, inputRate: rate,
    priceSource: book.source, priceCheckedAt: book.checkedAt };
}

// One file per source avoids lost updates when parallel hooks prepare documents.
export function recordCodexDocument(source, result, opts = {}) {
  if (!result?.ok) return;
  try {
    const dir = ledgerDir(opts);
    const file = join(dir, `${hash(realpathSync(source))}.json`);
    const meta = result.meta || {};
    const now = opts.now ?? Date.now();
    const st = statSync(source);
    const fingerprint = hash(JSON.stringify([st.size, st.mtimeMs, meta.markupBytes, meta.markdownBytes, !!(meta.clipped || meta.truncated)]));
    let previous;
    try { previous = JSON.parse(readFileSync(file, 'utf8')); } catch { /* First use. */ }
    const same = previous?.version === 2 && previous.fingerprint === fingerprint;
    const since = readResetMarks(opts.dir ?? userDataDir())['codex-docs'];
    const estimate = estimateCodexDocument(source, meta, opts);
    // Reusing a cache without session identity must not erase a priced snapshot.
    const saving = same && !isBeforeReset(previous.at, since) && Number.isFinite(previous.saving?.usd) ? previous.saving : estimate;
    const event = { version: 2, ext: extname(source).slice(1).toLowerCase(),
      fingerprint, at: same && !isBeforeReset(previous.at, since) ? previous.at : now, saving,
      sourceBytes: finite(meta.size) ? meta.size : null,
      markdownBytes: finite(meta.markdownBytes) ? meta.markdownBytes : null,
      clipped: !!(meta.clipped || meta.truncated) };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeViaTmp(tmp, file, JSON.stringify(event) + '\n', { mode: 0o600 });
    return saving;
  } catch { /* Accounting must not prevent document conversion. */ }
}

/**
 * One `{ ts, usd }` per recorded document, reset marks NOT applied (the
 * caller decides which mark governs): the team upload sums these by local
 * day beside the Claude doc2md ledger. `usd` is null for an unpriced record.
 */
export function codexDocumentEvents(opts = {}) {
  const out = [];
  try {
    const dir = ledgerDir(opts);
    for (const file of readdirSync(dir).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      try {
        const event = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        if (![1, 2].includes(event?.version) || !['pdf', 'pptx', 'xlsx', 'xls', 'docx', 'fig'].includes(event.ext)) continue;
        const ts = event.version === 2 ? event.at : statSync(join(dir, file)).mtimeMs;
        const s = event.saving;
        const usd = event.version === 2 && s?.method === 'office-xml-vs-markdown-bytes/4' && Number.isFinite(s.usd) ? s.usd : null;
        out.push({ ts, usd });
      } catch { /* Ignore only the damaged record. */ }
    }
  } catch { /* No Codex document history yet. */ }
  return out;
}

// Legacy records use mtime; new records retain their first priced observation.
export function codexDocumentTotals(opts = {}) {
  const since = readResetMarks(opts?.dir ?? userDataDir())['codex-docs'];
  const now = opts.now ?? Date.now();
  const savings = { week: 0, month: 0, total: 0, priced: 0, unpriced: 0, savedTokens: 0, reasons: {} };
  const total = { docs: 0, byExt: [], scope: 'codex-total', since, savings };
  const byExt = new Map();
  try {
    const dir = ledgerDir(opts);
    for (const file of readdirSync(dir).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      try {
        const event = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        if (![1, 2].includes(event?.version) || !['pdf', 'pptx', 'xlsx', 'xls', 'docx', 'fig'].includes(event.ext)) continue;
        const at = event.version === 2 ? event.at : statSync(join(dir, file)).mtimeMs;
        if (isBeforeReset(at, since)) continue;
        total.docs++;
        byExt.set(event.ext, (byExt.get(event.ext) || 0) + 1);
        const s = event.saving;
        if (event.version === 2 && s?.method === 'office-xml-vs-markdown-bytes/4' && Number.isFinite(s.usd)) {
          savings.priced++;
          savings.total += s.usd;
          savings.savedTokens += Number.isFinite(s.savedTokens) ? s.savedTokens : 0;
          if (at <= now && now - at < 7 * 86400000) savings.week += s.usd;
          if (at <= now && now - at < 30 * 86400000) savings.month += s.usd;
        } else {
          savings.unpriced++;
          const reason = event.version === 1 ? 'legacy-record' : s?.reason || 'unknown';
          savings.reasons[reason] = (savings.reasons[reason] || 0) + 1;
        }
      } catch { /* Ignore only the damaged record. */ }
    }
  } catch { /* No Codex document history yet. */ }
  total.byExt = [...byExt].map(([ext, docs]) => ({ ext, docs })).sort((a, b) => b.docs - a.docs || a.ext.localeCompare(b.ext));
  return total;
}
