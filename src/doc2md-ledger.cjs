/**
 * doc2md-ledger — one event per document conversion, with what it saved.
 *
 * Separate from delegation-ledger.json on purpose. Routing savings and
 * conversion savings answer different questions ("work ran on a cheaper
 * model" vs "a document was read as text instead of as an attachment"), and
 * a statusline that folds them into one figure cannot tell the reader which
 * habit earned the money.
 *
 * File: <userDataDir>/doc2md-ledger.json
 *   { "version": 1,
 *     "events": { "<source path>": { "ts", "usd", "ext", "tokens", "baseline" } } }
 *
 * Keyed by the source path so re-converting the same document after an edit
 * updates its event instead of counting the file twice.
 *
 * # What "saved" means here, and what it deliberately does not
 *
 * The counterfactual is what the reader would have done without a converter,
 * and it differs by format. Both were measured on 2026-09-06.
 *
 * PDF: attaching the file. The same one-line prompt was sent through
 * `claude --print --input-format stream-json` with and without the file as a
 * document block. The control turn cost 42,204 tokens, twice, to the token.
 *
 *   kohjuho_resume_kr.pdf   7 pages   +20,537 tokens   2,934 per page
 *   xeoyoung_resume.pdf     5 pages   +12,709 tokens   2,542 per page
 *
 * A PDF is read whole: the model answered from its contents. Converting one
 * to text is worth three to four times its own size.
 *
 * pptx/xlsx/docx: unpacking the container. These never reach the model as
 * attachments at all — the same probe on a docx added 78 tokens and the model
 * replied that it had no file. Read refuses them too, measured the same way:
 * a Read of the 31.8MB deck cost +317 tokens and of the 185KB docx +185, which
 * is a refusal message and nothing more. What a reader does instead is unzip
 * the archive and wade through its XML, where tags and style attributes
 * outweigh the text many times over:
 *
 *   aws-summit-seoul.pptx   2.1MB of slide XML   ~540,429 tokens   23.8× the conversion
 *   사업계획서.docx        312KB of body XML    ~78,113 tokens    ~46× the conversion
 *
 * So the baseline for these formats is the body markup the converter read,
 * measured per file rather than assumed from a ratio. It is a real number for
 * a real fallback — this very session unzipped a pptx to verify a conversion
 * before this ledger existed.
 *
 * .fig: the file itself. Unlike the Office formats, Read does not refuse a
 * .fig — the extension means nothing to it, so it pulls the binary in as text
 * and the context window fills with tokenised noise. Measured against the same
 * 42,760-token control:
 *
 *   plan.fig            26KB    +44,195 tokens   conversion: 100
 *   bootstrap-kit.fig   8.1MB   +43,994 tokens   conversion: 18,397
 *
 * Two files three hundred times apart in size cost the same, because Read
 * truncates at a cap long before the file ends — which also means the reader
 * gets a fraction of a document for the price of a whole one. The baseline is
 * therefore a flat 44,000 tokens rather than anything per-byte. An earlier
 * version of this file claimed .fig had no measurable baseline at all; that
 * was an assumption about Read's behaviour that turned out to be wrong.
 *
 * Erring low is deliberate throughout. A savings figure that flatters the
 * tool is worth less than one the user can trust.
 *
 * `scripts/doc2md-baseline.mjs` re-measures the attachment side if the
 * client's handling changes.
 */

const fs = require('node:fs');
const path = require('node:path');

const WEEK_MS = 7 * 24 * 3600 * 1000;
const MONTH_MS = 30 * 24 * 3600 * 1000;

const LEDGER_VERSION = 1;

/**
 * Tokens an attached PDF costs per page, from the two measurements in the
 * header: 2,934 and 2,542 per page. 2,500 sits below both, so the saving is
 * understated for a dense document rather than overstated for a sparse one.
 */
const PDF_TOKENS_PER_PAGE = 2500;

/**
 * How each format's alternative is priced. `perPage` values an attached
 * page-image document; `markup` values the body XML a reader would have had
 * to wade through instead.
 *
 * `.xls` is the pre-2007 binary format, which is not a zip container and so
 * has no markup to measure. It falls back to parity, recording no saving.
 */
const ATTACHMENT_BASELINE = {
  '.pdf': { perPage: PDF_TOKENS_PER_PAGE },
  '.pptx': { markup: true },
  '.docx': { markup: true },
  '.xlsx': { markup: true },
  '.xls': { ratio: 1 },
  // Read swallows a .fig instead of refusing it, at a flat ~44,000 tokens
  // whatever the file's size (see the header). Rounded down from the two
  // measurements, both of which landed just under 44,200.
  '.fig': { fixed: 44_000 },
};

/**
 * Input price per token used to value the difference, in USD. Sonnet's input
 * rate, chosen as the mid tier: crediting the conversion at Opus rates would
 * quietly triple every figure for anyone who never runs Opus.
 */
const INPUT_USD_PER_TOKEN = 3 / 1_000_000;

/** Rough token count for text. Four bytes per token, the usual approximation. */
function estimateTokens(text) {
  return Math.ceil(Buffer.byteLength(String(text || ''), 'utf8') / 4);
}

/**
 * What the conversion saved, in USD, and the two token figures behind it.
 * `meta` is the conversion metadata: `pages` for PDFs, plus the markdown that
 * was written.
 */
function estimateSaving({ ext, pages = 0, markupBytes = 0, markdown = '' }) {
  const tokens = estimateTokens(markdown);
  const rule = ATTACHMENT_BASELINE[String(ext).toLowerCase()] || { ratio: 1 };
  let baseline;
  if (rule.fixed) {
    baseline = rule.fixed;
  } else if (rule.perPage && pages > 0) {
    baseline = pages * rule.perPage;
  } else if (rule.markup && markupBytes > 0) {
    baseline = Math.ceil(markupBytes / 4);
  } else {
    baseline = Math.round(tokens * (rule.ratio || 1));
  }
  // Never below what the conversion actually produced. A dense PDF can cost
  // more as text than its page count suggests, and a baseline under the real
  // figure would show as a zero saving while understating the document.
  baseline = Math.max(baseline, tokens);
  const usd = Math.max(0, baseline - tokens) * INPUT_USD_PER_TOKEN;
  return { tokens, baseline, usd: Math.round(usd * 10000) / 10000 };
}

function ledgerPath(userDataDir) {
  return path.join(userDataDir, 'doc2md-ledger.json');
}

function loadLedger(userDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(ledgerPath(userDataDir), 'utf8'));
    if (!data || typeof data.events !== 'object' || data.events === null) {
      return { version: LEDGER_VERSION, events: {} };
    }
    if (data.version !== LEDGER_VERSION) return { version: LEDGER_VERSION, events: {} };
    return data;
  } catch {
    return { version: LEDGER_VERSION, events: {} };
  }
}

/**
 * Record one conversion. Never throws: an unwritable ledger costs a
 * statusline figure, which is not worth failing a conversion over.
 */
function recordConversion(userDataDir, event) {
  if (!event || !event.key) return;
  const data = loadLedger(userDataDir);
  data.version = LEDGER_VERSION;
  data.events[event.key] = {
    ts: Number.isFinite(event.ts) ? event.ts : Date.now(),
    usd: Math.max(0, Math.round((Number(event.usd) || 0) * 10000) / 10000),
    ext: event.ext || '',
    tokens: Number(event.tokens) || 0,
    baseline: Number(event.baseline) || 0,
  };
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(ledgerPath(userDataDir), JSON.stringify(data) + '\n', { mode: 0o600 });
  } catch {
    /* best effort, like every other state file here */
  }
}

/**
 * Rolling totals plus `docs` (documents converted, lifetime) and `byExt` —
 * the lifetime rollup per format, priciest first, then most-converted. Never
 * throws; an unreadable ledger yields zeros, and the statusline hides the
 * chip on a zero.
 */
function doc2mdSavedTotals(userDataDir, now = Date.now()) {
  const empty = () => ({ week: 0, month: 0, total: 0, docs: 0, tokens: 0, byExt: [] });
  const totals = empty();
  const byExt = new Map();
  try {
    for (const e of Object.values(loadLedger(userDataDir).events)) {
      const usd = Number(e.usd) || 0;
      totals.total += usd;
      totals.docs += 1;
      totals.tokens += Number(e.tokens) || 0;
      if (Number.isFinite(e.ts)) {
        if (now - e.ts <= WEEK_MS) totals.week += usd;
        if (now - e.ts <= MONTH_MS) totals.month += usd;
      }
      const key = String(e.ext || '?').replace(/^\./, '') || '?';
      const row = byExt.get(key) || { ext: key, docs: 0, usd: 0 };
      row.docs += 1;
      row.usd += usd;
      byExt.set(key, row);
    }
  } catch {
    return empty();
  }
  totals.byExt = [...byExt.values()].sort((a, b) => b.usd - a.usd || b.docs - a.docs);
  return totals;
}

module.exports = {
  LEDGER_VERSION,
  PDF_TOKENS_PER_PAGE,
  ATTACHMENT_BASELINE,
  INPUT_USD_PER_TOKEN,
  estimateTokens,
  estimateSaving,
  ledgerPath,
  loadLedger,
  recordConversion,
  doc2mdSavedTotals,
};
