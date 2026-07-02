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
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}
