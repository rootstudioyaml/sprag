/**
 * team-rule-stats — the per-category summary of this machine's model-fitting
 * rules that a team member uploads (RPC member_rules_report).
 *
 * The registry (model-rules.json) holds project paths, the user's prompt
 * excerpts and rule sentences. None of that may leave the machine, so the
 * summary is built from an allowlist: each output row is a new object whose
 * keys are RULE_STAT_KEYS, filled only from numbers, the enumerations
 * (category, tier, status, origin) and one date. test/team-rule-stats.test.js pins the key set
 * and checks that no path or example text survives into the JSON.
 *
 * Rules of one (category, tier) from different projects fold into one row;
 * the server rejects a report that names the same pair twice.
 */

import { loadModelRules, ruleBudget } from './model-rules.js';
import { RULE_CATEGORY_IDS, RULE_TIERS, isRuleCategory, isRuleTier } from './rule-categories.js';

export const RULE_STATS_MAX = 24;
export const RULE_STAT_KEYS = Object.freeze([
  'category', 'tier', 'status', 'episodes', 'delegated', 'delegated_err',
  'saved_usd', 'baseline_err', 'budget_calls', 'budget_out', 'since', 'origin',
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => (Number.isFinite(v) ? v : 0);
const posInt = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);
const round = (v, places) => { const k = 10 ** places; return Math.round(v * k) / k; };
const rate = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

/** Weighted mean of [value, weight] pairs; null when no pair has weight. */
function weighted(pairs) {
  let sum = 0;
  let weight = 0;
  for (const [value, w] of pairs) {
    if (value === null || !(w > 0)) continue;
    sum += value * w;
    weight += w;
  }
  return weight > 0 ? round(sum / weight, 4) : null;
}

/**
 * Where the folded rules came from, as one of three fixed words. A Sprag preset the
 * user accepted is marked `origin: 'preset'` and signed `<tier>|<category>|preset`
 * (src/seed-rules.js); every other rule was promoted from this machine's own
 * route-scan candidates. 'both' means the row folds rules of the two kinds.
 */
const isPresetRule = (r) => r.origin === 'preset' || (typeof r.signature === 'string' && r.signature.endsWith('|preset'));
function ruleOrigin(rules) {
  const presets = rules.filter(isPresetRule).length;
  if (presets === 0) return 'scan';
  return presets === rules.length ? 'preset' : 'both';
}

/** The most common budget among the rules; the first one wins a tie. */
function commonBudget(rules) {
  const tally = new Map();
  for (const r of rules) {
    const b = ruleBudget(r) || {};
    const calls = posInt(b.calls);
    const out = posInt(b.out);
    const key = `${calls}|${out}`;
    const hit = tally.get(key);
    if (hit) hit.n += 1; else tally.set(key, { calls, out, n: 1 });
  }
  let best = null;
  for (const v of tally.values()) if (!best || v.n > best.n) best = v;
  return best || { calls: null, out: null };
}

/**
 * Fold registry rules into the upload rows. Pure: takes the rule array,
 * returns a new array of allowlisted rows ordered by category, then tier.
 */
export function summarizeModelRules(rules) {
  const groups = new Map();
  for (const r of Array.isArray(rules) ? rules : []) {
    if (!r || (r.status !== 'active' && r.status !== 'review')) continue;
    if (!isRuleCategory(r.category) || !isRuleTier(r.tier)) continue;
    const key = `${r.category}|${r.tier}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const rows = [];
  for (const category of RULE_CATEGORY_IDS) {
    for (const tier of RULE_TIERS) {
      const list = groups.get(`${category}|${tier}`);
      if (!list) continue;
      const delegated = list.reduce((n, r) => n + Math.max(0, Math.trunc(num(r.delegatedRuns))), 0);
      const dates = list.map((r) => String(r.promotedAt || '').slice(0, 10)).filter((d) => DATE_RE.test(d)).sort();
      const budget = commonBudget(list);
      rows.push({
        category,
        tier,
        status: list.some((r) => r.status === 'active') ? 'active' : 'review',
        episodes: list.reduce((n, r) => n + Math.max(0, Math.trunc(num(r.count))), 0),
        delegated,
        delegated_err: delegated > 0 ? weighted(list.map((r) => [rate(r.delegatedErrRate), Math.max(0, num(r.delegatedRuns))])) : null,
        saved_usd: round(list.reduce((n, r) => n + num(r.savedUsd), 0), 2),
        baseline_err: weighted(list.map((r) => [rate(r.baselineErrRate), Math.max(0, num(r.baselineSample))])),
        budget_calls: budget.calls,
        budget_out: budget.out,
        since: dates[0] || null,
        origin: ruleOrigin(list),
      });
    }
  }
  return rows.slice(0, RULE_STATS_MAX);
}

/** The summary for this machine's registry (read-only; no network). */
export function ruleStatsSummary({ dir } = {}) {
  return summarizeModelRules(loadModelRules(dir ? { dir } : {}).rules);
}
