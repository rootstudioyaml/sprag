/**
 * Cost impact estimation based on Anthropic pricing.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 * Prices per million tokens (USD). Updated 2026-10 for Fable 5.1, Opus 5.5,
 * Sonnet 5 / 5.5 and Haiku 5.5 (checked against the pricing page 2026-10-09).
 *
 * Note: Opus 4.5/4.6/4.7 use reduced pricing ($5/$25) vs. older Opus 4/4.1 ($15/$75).
 * Cache writes are now tracked separately for 5m and 1h TTLs, each with their own rate.
 */

import { priceForPrompt } from './gateway-prices.js';

// Haiku 5.5 charges a request whose prompt (input + cache writes + cache
// reads) exceeds this many tokens at the higher 'claude-haiku-5-5-long' rates.
// Each request is priced on its own, so callers accumulate such requests into
// `totals.long` (see parser.js) rather than relying on session-wide sums.
export const LONG_PROMPT_THRESHOLD = 100_000;

// Each tier lists its rate cards oldest first, with the date each took effect
// (`from`, a UTC YYYY-MM-DD; null = since the model launched). A price change
// or a correction is a new row, never an edit of an old one, so a run is
// always priced at the rate that applied when it happened (#15).
const PRICE_HISTORY = {
  // Fable 5.1 / Mythos 5.1 — same prices as Fable 5 except cache reads, which
  // drop to $0.25.
  'claude-fable-5-1': [{
    from: null,
    input: 10.0,
    cacheWrite5m: 12.5,
    cacheWrite1h: 20.0,
    cacheRead: 0.25,
    output: 50.0,
  }],
  // Fable 5 / Mythos 5 — premium tier above Opus ($10/$50). Cache write
  // rates follow the standard multipliers (1.25x input for 5m, 2x for 1h),
  // cache read is 0.1x input.
  'claude-fable-5': [{
    from: null,
    input: 10.0,
    cacheWrite5m: 12.5,
    cacheWrite1h: 20.0,
    cacheRead: 1.0,
    output: 50.0,
  }],
  // Opus 5.5 — cheaper than the Opus 4.5-5 tier below.
  'claude-opus-5-5': [{
    from: null,
    input: 4.0,
    cacheWrite5m: 5.0,
    cacheWrite1h: 8.0,
    cacheRead: 0.2,
    output: 20.0,
  }],
  // Opus 4.5+ (new pricing tier — includes 4.5, 4.6, 4.7, 4.8, and future)
  'claude-opus-new': [{
    from: null,
    input: 5.0,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
    cacheRead: 0.5,
    output: 25.0,
  }],
  // Opus 4 / 4.1 / Opus 3 (legacy premium pricing)
  'claude-opus-legacy': [{
    from: null,
    input: 15.0,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30.0,
    cacheRead: 1.5,
    output: 75.0,
  }],
  // Sonnet 5 — standard price is $2/$10. The rise to $3/$15 planned for
  // 2026-09-01 was cancelled, so this is not an introductory rate.
  'claude-sonnet-5': [{
    from: null,
    input: 2.0,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4.0,
    cacheRead: 0.2,
    output: 10.0,
  }],
  // Sonnet 5.5 — launched 2026-09-28 with Sonnet 5's prices. Cache reads were
  // cut from $0.20 to $0.10 on 2026-10-07 ("We've lowered the price of prompt
  // cache reads on Claude Sonnet 5.5 from $0.20 USD to $0.10 USD", platform
  // release notes); every other rate is unchanged.
  'claude-sonnet-5-5': [{
    from: null,
    input: 2.0,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4.0,
    cacheRead: 0.2,
    output: 10.0,
  }, {
    from: '2026-10-07',
    input: 2.0,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4.0,
    cacheRead: 0.1,
    output: 10.0,
  }],
  // Sonnet 4 / 4.5 / 4.6 / 3.7
  'claude-sonnet': [{
    from: null,
    input: 3.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
    output: 15.0,
  }],
  // Haiku 5.5, prompt <= LONG_PROMPT_THRESHOLD tokens.
  'claude-haiku-5-5': [{
    from: null,
    input: 0.1,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
    output: 0.5,
  }],
  // Haiku 5.5, prompt > LONG_PROMPT_THRESHOLD tokens. Not returned by
  // detectPricingTier: estimateCost applies it to `totals.long` only.
  'claude-haiku-5-5-long': [{
    from: null,
    input: 0.5,
    cacheWrite5m: 0.625,
    cacheWrite1h: 1.0,
    cacheRead: 0.05,
    output: 2.5,
  }],
  // Haiku 4.5
  'claude-haiku-4-5': [{
    from: null,
    input: 1.0,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2.0,
    cacheRead: 0.1,
    output: 5.0,
  }],
  // Haiku 3.5
  'claude-haiku-3-5': [{
    from: null,
    input: 0.8,
    cacheWrite5m: 1.0,
    cacheWrite1h: 1.6,
    cacheRead: 0.08,
    output: 4.0,
  }],
  // Haiku 3 (deprecated)
  'claude-haiku-3': [{
    from: null,
    input: 0.25,
    cacheWrite5m: 0.3,
    cacheWrite1h: 0.5,
    cacheRead: 0.03,
    output: 1.25,
  }],
};

/** Milliseconds for a `from` date, or -Infinity for "since launch". */
const fromMs = (from) => (from ? Date.parse(`${from}T00:00:00Z`) : -Infinity);

const toMs = (at) => {
  if (at === undefined || at === null) return Date.now();
  const n = typeof at === 'number' ? at : Date.parse(at);
  return Number.isFinite(n) ? n : Date.now();
};

/**
 * The rate card of a tier in effect at `at` (ms or a date string; default
 * now): the newest row whose `from` is not after it. A time before the first
 * dated row gets the first row, since that is the earliest price known.
 */
export function ratesAt(tier, at) {
  const rows = PRICE_HISTORY[tier];
  if (!rows) return null;
  const t = toMs(at);
  let pick = rows[0];
  for (const r of rows) if (fromMs(r.from) <= t) pick = r;
  return pick;
}

/** Every dated row of a tier, oldest first (for audits and the upstream watch). */
export function priceHistory(tier) {
  return (PRICE_HISTORY[tier] || []).map((r) => ({ ...r }));
}

// What a bare alias meant over time: the model Claude Code sent for it from
// each date on, oldest first. An alias moves to a new model on launch day, so
// a run recorded as `opus` is priced as the Opus that was current then, not
// the oldest Opus in the table (#13).
// Dates are the launch days in the platform release notes
// (https://platform.claude.com/docs/en/release-notes/overview); Claude Code
// moved its aliases on or shortly after them. A time before the first row
// resolves to the first row.
const ALIAS_HISTORY = {
  opus: [
    { from: '2025-05-22', model: 'claude-opus-4-20250514' },
    { from: '2025-08-05', model: 'claude-opus-4-1-20250805' },
    { from: '2025-11-24', model: 'claude-opus-4-5-20251101' },
    { from: '2026-02-05', model: 'claude-opus-4-6' },
    { from: '2026-04-16', model: 'claude-opus-4-7' },
    { from: '2026-05-28', model: 'claude-opus-4-8' },
    { from: '2026-07-24', model: 'claude-opus-5' },
    { from: '2026-09-22', model: 'claude-opus-5-5' },
  ],
  sonnet: [
    { from: '2025-05-22', model: 'claude-sonnet-4-20250514' },
    { from: '2025-09-29', model: 'claude-sonnet-4-5-20250929' },
    { from: '2026-02-17', model: 'claude-sonnet-4-6' },
    { from: '2026-06-30', model: 'claude-sonnet-5' },
    { from: '2026-09-28', model: 'claude-sonnet-5-5' },
  ],
  haiku: [
    { from: null, model: 'claude-3-5-haiku-20241022' },
    { from: '2025-10-15', model: 'claude-haiku-4-5-20251001' },
    { from: '2026-10-07', model: 'claude-haiku-5-5' },
  ],
  fable: [
    { from: '2026-06-09', model: 'claude-fable-5' },
    { from: '2026-09-01', model: 'claude-fable-5-1' },
  ],
};

// Spellings that name an alias rather than a model: the bare family, its
// `[1m]` form, and the Claude Code shorthands that resolve to a family.
const ALIAS_OF = { opus: 'opus', opusplan: 'opus', sonnet: 'sonnet', haiku: 'haiku', fable: 'fable', best: 'fable' };

/**
 * The model a bare alias stood for at `at`, or null when `model` is not an
 * alias (a full id passes through untouched at the call site).
 */
export function resolveAlias(model, at) {
  if (typeof model !== 'string') return null;
  const key = ALIAS_OF[model.trim().toLowerCase().replace(/\[1m\]$/, '')];
  const rows = key && ALIAS_HISTORY[key];
  if (!rows || rows.length === 0) return null;
  const t = toMs(at);
  let pick = null;
  for (const r of rows) if (fromMs(r.from) <= t) pick = r;
  return (pick || rows[0]).model;
}

/**
 * Detect pricing tier from Claude model identifier.
 * Examples: 'claude-opus-4-7', 'claude-sonnet-4-5', 'claude-haiku-4-5'.
 * A bare alias (`opus`, `sonnet[1m]`) is first resolved to the model it meant
 * at `at` (default now).
 */
export function detectPricingTier(model, { at } = {}) {
  if (!model) return 'claude-sonnet';
  const resolved = resolveAlias(model, at);
  const m = (resolved || model).toLowerCase();

  // Fable 5 / Mythos 5 — must be checked before the generic fallback:
  // without this, 'claude-fable-5' fell through to the Sonnet tier and
  // under-estimated costs ~3x ($3/$15 vs the real $10/$50).
  if (m.includes('fable') || m.includes('mythos')) {
    // `(?!\d)` keeps a date suffix (`fable-5-20261001`) from reading as 5.1.
    if (/(fable|mythos)[-_.]?5[-_.]1(?!\d)/.test(m)) return 'claude-fable-5-1';
    return 'claude-fable-5';
  }

  if (m.includes('opus')) {
    // 5.5 first: `opus-5-5` would otherwise match the generic 5+ pattern, and
    // `(?!\d)` keeps `opus-5-20260101` (Opus 5 with a date) out of 5.5.
    if (/opus[-_.]?5[-_.]5(?!\d)/.test(m)) return 'claude-opus-5-5';
    // Opus 4.5, 4.6, 4.7, and future 5+ use the new reduced pricing.
    if (/opus[-_.]?4[-_.]?[5-9]\b/.test(m)) return 'claude-opus-new';
    if (/opus[-_.]?[5-9]/.test(m)) return 'claude-opus-new';
    // Opus 4, 4.1, 3 → legacy premium pricing.
    return 'claude-opus-legacy';
  }

  if (m.includes('haiku')) {
    if (/haiku[-_.]?5[-_.]5(?!\d)/.test(m)) return 'claude-haiku-5-5';
    if (/haiku[-_.]?4[-_.]?5/.test(m)) return 'claude-haiku-4-5';
    // The 3.x ids put the version first (`claude-3-5-haiku-20241022`,
    // `claude-3-haiku-20240307`), so both orders are matched. With only the
    // family-first order, 3.5 Haiku fell through to the 4.5 rate.
    if (/haiku[-_.]?3[-_.]?5|3[-_.]?5[-_.]?haiku/.test(m)) return 'claude-haiku-3-5';
    if (/haiku[-_.]?3\b|\b3[-_.]?haiku/.test(m)) return 'claude-haiku-3';
    return 'claude-haiku-4-5';
  }

  if (m.includes('sonnet')) {
    if (/sonnet[-_.]?5[-_.]5(?!\d)/.test(m)) return 'claude-sonnet-5-5';
    // Sonnet 5 incl. date-suffixed ids; the 3.x/4.x ids never put a 5 right
    // after the family name (`claude-3-5-sonnet-2024…` has it before).
    if (/sonnet[-_.]?5(?!\d)/.test(m)) return 'claude-sonnet-5';
  }

  // Sonnet (default fallback): 3.7, 4, 4.5, 4.6 all share the same pricing.
  return 'claude-sonnet';
}

/**
 * Relative price rank of a model's pricing tier. Delegation only pays off
 * when the target tier is genuinely cheaper than the model that did the work,
 * so route-scan needs an ORDER, not just "is it haiku?" — a Sonnet session
 * must not produce "delegate to Sonnet" rules (the subagent would rebuild
 * context for zero price difference).
 */
const TIER_RANK = {
  'claude-fable-5': 3,
  'claude-fable-5-1': 3,
  'claude-opus-5-5': 2,
  'claude-opus-legacy': 2,
  'claude-opus-new': 2,
  'claude-sonnet': 1,
  'claude-sonnet-5': 1,
  'claude-sonnet-5-5': 1,
  'claude-haiku-5-5': 0,
  'claude-haiku-4-5': 0,
  'claude-haiku-3-5': 0,
  'claude-haiku-3': 0,
};

/**
 * True for the explicit 'unknown' marker — an id that could not be resolved
 * at all (see model-alias.js), as opposed to an id this table simply has no
 * entry for. The two must not share a fate: an unresolved gateway id counted
 * as Sonnet silently corrupts every delegation statistic, so it is dropped
 * from the ranking instead of guessed at.
 */
export function isUnknownModel(model) {
  if (!model) return true;
  const m = String(model).toLowerCase();
  // "<synthetic>" is Claude Code's placeholder for locally-generated error
  // stubs — no real API call happened, so pricing it as Sonnet would be a
  // silent guess (session-records.js skips it for the same reason).
  return m === 'unknown' || m === '<synthetic>';
}

/**
 * True when the id actually names a Claude family this table can price, as
 * opposed to falling through to the Sonnet default.
 *
 * `detectPricingTier` must keep defaulting — a plain cost estimate is better
 * off guessing Sonnet than refusing to answer. But anything that compares two
 * models must not: behind a company gateway an id can be a house alias
 * (`prod-large`, `team-fast`) carrying no family name, and pricing that as
 * Sonnet silently invents or erases a delegation saving. Callers that need a
 * real comparison gate on this and skip when it is false.
 *
 * Covers the shapes gateways actually emit — Bedrock
 * (`anthropic.claude-opus-4-5-v1:0`, `us.anthropic.…`), Vertex
 * (`claude-opus-4-5@20251101`), and the `[1m]` context suffix — because all of
 * them keep the family name in the string. House aliases that do not are
 * exactly what this returns false for; map those in profile-map.json's
 * `modelAliases`.
 */
export function isRecognizedModelId(model) {
  if (isUnknownModel(model)) return false;
  return /fable|mythos|opus|sonnet|haiku/i.test(String(model));
}

export function modelRank(model) {
  // -1 sits below every real tier, so worthDelegating() rejects it and
  // tierForRank() attributes no saving to it: the run leaves the aggregate
  // rather than distorting it.
  if (isUnknownModel(model)) return -1;
  const rank = TIER_RANK[detectPricingTier(model)];
  // Unknown ids fall through detectPricingTier to the Sonnet tier; ranking
  // them 1 keeps the conservative reading (cheap enough that a Sonnet-target
  // rule is not worth it, expensive enough that a haiku one still is).
  return rank ?? 1;
}

/**
 * Price rank each delegation tier targets: T2 → haiku, T1 → sonnet, T1H → opus.
 * T1H is worth it only from a rank-3 (Fable/Mythos) session.
 */
export const TIER_TARGET_RANK = { T2: 0, T1: 1, T1H: 2 };

/**
 * Which delegation tier a subagent run at this price rank represents.
 * null = the run was NOT a downgrade (same tier or higher), so it carries no
 * delegation saving to attribute to a rule.
 */
export function tierForRank(rank) {
  if (rank === 0) return 'T2';
  if (rank === 1) return 'T1';
  if (rank === 2) return 'T1H';
  return null;
}

function tokensToMillions(n) {
  return n / 1_000_000;
}

/**
 * Estimate costs for given token totals.
 *
 * totals shape (from parser.js):
 *   input            — non-cached input tokens
 *   cacheCreation    — total cache-write tokens (5m + 1h combined, as reported by API)
 *   cacheRead        — cache-hit tokens
 *   ephemeral5m      — portion of cacheCreation billed at 5m rate (1.25x input)
 *   ephemeral1h      — portion of cacheCreation billed at 1h rate (2x input)
 *   output           — output tokens
 *
 * `at` (ms or a date string, default now) is when the tokens were spent: the
 * list price is the one in effect then (see ratesAt).
 */
export function estimateCost(totals, model, { price, at } = {}) {
  if (price) return estimateCostAtPrice(totals, price);
  const tier = detectPricingTier(model, { at });

  // Haiku 5.5 prices each request by its own prompt length, so the long-prompt
  // part (`totals.long`, same shape) is priced at the long rates and the rest
  // at the short rates. Every other tier ignores `long`.
  let c;
  if (tier === 'claude-haiku-5-5' && totals.long) {
    const short = subtractTotals(totals, totals.long);
    const a = priceTotals(short, ratesAt(tier, at));
    const b = priceTotals(totals.long, ratesAt('claude-haiku-5-5-long', at));
    c = {
      actual: a.actual + b.actual,
      noCacheCost: a.noCacheCost + b.noCacheCost,
      scenario5mCost: a.scenario5mCost + b.scenario5mCost,
      write1h: a.write1h + b.write1h,
    };
  } else {
    c = priceTotals(totals, ratesAt(tier, at));
  }
  const { actual, noCacheCost, scenario5mCost, write1h } = c;

  return {
    tier,
    actual: round(actual),
    noCacheCost: round(noCacheCost),
    savings: round(noCacheCost - actual),
    savingsRate: noCacheCost > 0 ? (noCacheCost - actual) / noCacheCost : 0,
    scenario5mCost: round(scenario5mCost),
    extraCostIf5m: round(scenario5mCost - actual),
    // The row asks a counterfactual: what would dropping to 5m-only cost you?
    // With no 1h writes there is nothing to lose, and the arithmetically
    // honest `+$0` it printed read as "5m-only is free" — the opposite of the
    // truth for a gateway user already confined to 5m. The display layer has
    // to change the question rather than the number.
    extraCostIf5mApplicable: write1h > 0,
  };
}

const TOTAL_FIELDS = ['input', 'cacheCreation', 'cacheRead', 'ephemeral5m', 'ephemeral1h', 'output'];

/** totals - part, field by field (clamped at 0), dropping the `long` key. */
function subtractTotals(totals, part) {
  const out = {};
  for (const f of TOTAL_FIELDS) out[f] = Math.max(0, (totals[f] ?? 0) - (part[f] ?? 0));
  return out;
}

/** Unrounded cost figures for one set of totals at one rate card. */
function priceTotals(totals, p) {
  // Prefer explicit 5m/1h split when available; fall back to cacheCreation at 5m rate
  // (conservative — 5m is cheaper than 1h).
  const write5m = totals.ephemeral5m ?? 0;
  const write1h = totals.ephemeral1h ?? 0;
  const trackedWrites = write5m + write1h;
  const untracked = Math.max(0, (totals.cacheCreation ?? 0) - trackedWrites);

  const actual =
    tokensToMillions(totals.input) * p.input +
    tokensToMillions(write5m + untracked) * p.cacheWrite5m +
    tokensToMillions(write1h) * p.cacheWrite1h +
    tokensToMillions(totals.cacheRead) * p.cacheRead +
    tokensToMillions(totals.output) * p.output;

  // What it would cost without any caching (all input billed at base rate).
  const totalInput = totals.input + totals.cacheCreation + totals.cacheRead;
  const noCacheCost =
    tokensToMillions(totalInput) * p.input +
    tokensToMillions(totals.output) * p.output;

  // What it would cost if all 1h-tier writes had been 5m instead
  // (higher miss rate — estimate 3x more cache re-creation for sessions > 5min).
  const extra5mCreation = write1h * 2; // sessions that would re-create under 5m TTL
  const scenario5mWrites = write5m + write1h + untracked + extra5mCreation;
  const scenario5mCost =
    tokensToMillions(totals.input) * p.input +
    tokensToMillions(scenario5mWrites) * p.cacheWrite5m +
    tokensToMillions(Math.max(0, totals.cacheRead - extra5mCreation)) * p.cacheRead +
    tokensToMillions(totals.output) * p.output;

  return { actual, noCacheCost, scenario5mCost, write1h };
}

/** Unrounded figures for one set of totals at one gateway price; null when a needed rate is missing. */
function priceTotalsAtGateway(totals, price) {
  const write5m = totals.ephemeral5m ?? 0;
  const write1h = totals.ephemeral1h ?? 0;
  const untracked = Math.max(0, (totals.cacheCreation ?? 0) - write5m - write1h);
  const read = totals.cacheRead ?? 0;
  if (read > 0 && price.cacheRead == null) return null;
  if (write5m + untracked > 0 && price.cacheWrite == null) return null;
  if (write1h > 0 && price.cacheWrite1h == null) return null;
  if (price.input == null || price.output == null) return null;
  const perM = (rate) => (rate ?? 0) * 1e6;
  const input = perM(price.input), output = perM(price.output), cacheRead = perM(price.cacheRead);
  const cacheWrite5m = perM(price.cacheWrite), cacheWrite1h = perM(price.cacheWrite1h);

  const actual =
    tokensToMillions(totals.input) * input +
    tokensToMillions(write5m + untracked) * cacheWrite5m +
    tokensToMillions(write1h) * cacheWrite1h +
    tokensToMillions(read) * cacheRead +
    tokensToMillions(totals.output) * output;
  const totalInput = totals.input + (totals.cacheCreation ?? 0) + read;
  const noCacheCost = tokensToMillions(totalInput) * input + tokensToMillions(totals.output) * output;

  // The 5m scenario needs a 5m write rate; without one it is not computable, so
  // it collapses to the actual cost and the "extra cost" row stays hidden.
  let scenario5mCost = actual;
  if (price.cacheWrite != null) {
    const extra5mCreation = write1h * 2;
    scenario5mCost =
      tokensToMillions(totals.input) * input +
      tokensToMillions(write5m + write1h + untracked + extra5mCreation) * cacheWrite5m +
      tokensToMillions(Math.max(0, read - extra5mCreation)) * cacheRead +
      tokensToMillions(totals.output) * output;
  }
  return { actual, noCacheCost, scenario5mCost, applicable: price.cacheWrite != null && write1h > 0 };
}

/**
 * Same shape as the list-price estimate, but priced at a gateway's per-token
 * rates (LiteLLM /model/info). A token class the gateway does not price makes
 * the whole estimate unknown (null) rather than free or list-priced.
 *
 * The parser splits requests whose prompt exceeds LONG_PROMPT_THRESHOLD into
 * `totals.long`, so only a gateway tier at exactly that threshold can be
 * applied here. A tier at any other threshold (e.g. 272K) cannot be told apart
 * in aggregated Claude totals; those keep base rates.
 */
function estimateCostAtPrice(totals, price) {
  const longTier = totals.long && price.tiers?.some((t) => t.threshold === LONG_PROMPT_THRESHOLD);
  let parts;
  if (longTier) {
    parts = [priceTotalsAtGateway(subtractTotals(totals, totals.long), price),
      priceTotalsAtGateway(totals.long, priceForPrompt(price, LONG_PROMPT_THRESHOLD + 1))];
  } else {
    parts = [priceTotalsAtGateway(totals, price)];
  }
  if (parts.some((part) => part === null)) return null;
  const actual = parts.reduce((n, part) => n + part.actual, 0);
  const noCacheCost = parts.reduce((n, part) => n + part.noCacheCost, 0);
  const scenario5mCost = parts.reduce((n, part) => n + part.scenario5mCost, 0);

  return {
    tier: 'gateway',
    actual: round(actual),
    noCacheCost: round(noCacheCost),
    savings: round(noCacheCost - actual),
    savingsRate: noCacheCost > 0 ? (noCacheCost - actual) / noCacheCost : 0,
    scenario5mCost: round(scenario5mCost),
    extraCostIf5m: round(scenario5mCost - actual),
    extraCostIf5mApplicable: parts.some((part) => part.applicable),
  };
}

/**
 * Price a set of sessions each at its own model and sum. One estimateCost over
 * the summed totals priced every token at whichever session came first in the
 * list — sorted by mtime, so a haiku scratch session touched earliest set the
 * rate for a day of Fable work and understated the saving about tenfold.
 * Sessions whose model has no known rate are skipped, as month-spend does.
 * `estimate` lets a caller price by path (see claude-price.js); null skips a session.
 */
export function estimateCostAcross(sessions, estimate = estimateCost) {
  const acc = { actual: 0, noCacheCost: 0, scenario5mCost: 0, extraCostIf5mApplicable: false };
  const tiers = new Map();
  for (const s of sessions || []) {
    if (!s?.totals) continue;
    let c;
    try { c = estimate(s.totals, s.model); } catch { continue; }
    if (!c) continue;
    acc.actual += c.actual;
    acc.noCacheCost += c.noCacheCost;
    acc.scenario5mCost += c.scenario5mCost;
    acc.extraCostIf5mApplicable = acc.extraCostIf5mApplicable || c.extraCostIf5mApplicable;
    tiers.set(c.tier, (tiers.get(c.tier) || 0) + c.actual);
  }
  let tier = null;
  for (const [t, usd] of tiers) if (tier === null || usd > tiers.get(tier)) tier = t;
  return {
    tier,
    actual: round(acc.actual),
    noCacheCost: round(acc.noCacheCost),
    savings: round(acc.noCacheCost - acc.actual),
    savingsRate: acc.noCacheCost > 0 ? (acc.noCacheCost - acc.actual) / acc.noCacheCost : 0,
    scenario5mCost: round(acc.scenario5mCost),
    extraCostIf5m: round(acc.scenario5mCost - acc.actual),
    extraCostIf5mApplicable: acc.extraCostIf5mApplicable,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}
