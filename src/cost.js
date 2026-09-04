/**
 * Cost impact estimation based on Anthropic pricing.
 * Source: https://docs.claude.com/en/docs/about-claude/pricing
 * Prices per million tokens (USD). Updated 2026-04 for Opus 4.7 release.
 *
 * Note: Opus 4.5/4.6/4.7 use reduced pricing ($5/$25) vs. older Opus 4/4.1 ($15/$75).
 * Cache writes are now tracked separately for 5m and 1h TTLs, each with their own rate.
 */

const PRICING = {
  // Fable 5 / Mythos 5 — premium tier above Opus ($10/$50). Cache write
  // rates follow the standard multipliers (1.25x input for 5m, 2x for 1h),
  // cache read is 0.1x input.
  'claude-fable-5': {
    input: 10.0,
    cacheWrite5m: 12.5,
    cacheWrite1h: 20.0,
    cacheRead: 1.0,
    output: 50.0,
  },
  // Opus 4.5+ (new pricing tier — includes 4.5, 4.6, 4.7, 4.8, and future)
  'claude-opus-new': {
    input: 5.0,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
    cacheRead: 0.5,
    output: 25.0,
  },
  // Opus 4 / 4.1 / Opus 3 (legacy premium pricing)
  'claude-opus-legacy': {
    input: 15.0,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30.0,
    cacheRead: 1.5,
    output: 75.0,
  },
  // Sonnet 4 / 4.5 / 4.6 / 3.7
  'claude-sonnet': {
    input: 3.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
    output: 15.0,
  },
  // Haiku 4.5
  'claude-haiku-4-5': {
    input: 1.0,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2.0,
    cacheRead: 0.1,
    output: 5.0,
  },
  // Haiku 3.5
  'claude-haiku-3-5': {
    input: 0.8,
    cacheWrite5m: 1.0,
    cacheWrite1h: 1.6,
    cacheRead: 0.08,
    output: 4.0,
  },
  // Haiku 3 (deprecated)
  'claude-haiku-3': {
    input: 0.25,
    cacheWrite5m: 0.3,
    cacheWrite1h: 0.5,
    cacheRead: 0.03,
    output: 1.25,
  },
};

/**
 * Detect pricing tier from Claude model identifier.
 * Examples: 'claude-opus-4-7', 'claude-sonnet-4-5', 'claude-haiku-4-5'.
 */
function detectPricingTier(model) {
  if (!model) return 'claude-sonnet';
  const m = model.toLowerCase();

  // Fable 5 / Mythos 5 — must be checked before the generic fallback:
  // without this, 'claude-fable-5' fell through to the Sonnet tier and
  // under-estimated costs ~3x ($3/$15 vs the real $10/$50).
  if (m.includes('fable') || m.includes('mythos')) return 'claude-fable-5';

  if (m.includes('opus')) {
    // Opus 4.5, 4.6, 4.7, and future 5+ use the new reduced pricing.
    if (/opus[-_.]?4[-_.]?[5-9]\b/.test(m)) return 'claude-opus-new';
    if (/opus[-_.]?[5-9]/.test(m)) return 'claude-opus-new';
    // Opus 4, 4.1, 3 → legacy premium pricing.
    return 'claude-opus-legacy';
  }

  if (m.includes('haiku')) {
    if (/haiku[-_.]?4[-_.]?5/.test(m)) return 'claude-haiku-4-5';
    if (/haiku[-_.]?3[-_.]?5/.test(m)) return 'claude-haiku-3-5';
    if (/haiku[-_.]?3\b/.test(m)) return 'claude-haiku-3';
    return 'claude-haiku-4-5';
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
  'claude-opus-legacy': 2,
  'claude-opus-new': 2,
  'claude-sonnet': 1,
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
  return !model || String(model).toLowerCase() === 'unknown';
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

/** Price rank each delegation tier targets: T2 → haiku, T1 → sonnet. */
export const TIER_TARGET_RANK = { T2: 0, T1: 1 };

/**
 * Which delegation tier a subagent run at this price rank represents.
 * null = the run was NOT a downgrade (same tier or higher), so it carries no
 * delegation saving to attribute to a rule.
 */
export function tierForRank(rank) {
  if (rank === 0) return 'T2';
  if (rank === 1) return 'T1';
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
 */
export function estimateCost(totals, model) {
  const tier = detectPricingTier(model);
  const p = PRICING[tier];

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

function round(n) {
  return Math.round(n * 100) / 100;
}
