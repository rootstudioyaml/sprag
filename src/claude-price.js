/**
 * Claude-side cost by the path the call took. A session on a LiteLLM gateway
 * (gatewayBase(env) set) is billed by the gateway, so it is priced from its
 * /model/info table and stays unpriced (null) when the table has no entry;
 * the Anthropic list table is never a fallback there. Every other session is a
 * direct call and uses the list table. Kept apart from cost.js because
 * litellm-models.js imports cost.js, and this needs both.
 */
import { pathToFileURL } from 'node:url';
import { estimateCost, estimateCostAcross, isUnknownModel } from './cost.js';
import { gatewayPriceFor, gatewayPriceMiss } from './litellm-models.js';
import { gatewayBase } from './gateway-auth.js';
import { diagActive, recordDiag, diagSrcDir } from './diag-log.js';

// `at` is when the tokens were spent; list prices and gateway prices (from the
// gateway's dated price history) are looked up for that time.
export function sessionCost(totals, model, { env = process.env, now, at } = {}) {
  if (!gatewayBase(env)) return estimateCost(totals, model, { at });
  const price = gatewayPriceFor(model, env, now, at);
  if (!price) noteUnpriced(model, env, now, at, totals);
  return price ? estimateCost(totals, model, { price }) : null;
}

const tokenBucket = (n) => (n <= 0 ? '0' : n < 1000 ? '<1k' : n < 100000 ? '<100k' : '100k+');

/** `src/<file>.js:<line>` of the first stack frame outside this file, or '?'. */
function callerFrame(stack) {
  if (typeof stack !== 'string') return '?';
  for (const line of stack.split('\n').slice(1)) {
    if (line.includes('claude-price.js')) continue;
    for (const needle of [diagSrcDir, pathToFileURL(diagSrcDir).href]) {
      const at = line.indexOf(needle);
      if (at < 0) continue;
      const m = /^[\\/]([^\s():]+?\.c?js):(\d+)/.exec(line.slice(at + needle.length));
      if (m) return `src/${m[1].replace(/\\/g, '/')}:${m[2]}`;
    }
  }
  return '?';
}

// A gateway session with no price is invisible otherwise: the figure just reads
// as unpriced. The diagnostics log records why, once per distinct message per
// process (recordDiag dedupes), so the message must not carry `at`.
// An unknown model has nothing to list, so its message names the size of the
// spend and the caller instead; both are bucketed to keep the message stable.
function noteUnpriced(model, env, now, at, totals) {
  try {
    if (!diagActive({ env })) return;
    if (isUnknownModel(model)) {
      const t = totals || {};
      const sum = (t.input || 0) + (t.cacheCreation || 0) + (t.cacheRead || 0) + (t.output || 0);
      recordDiag('price:unpriced', new Error(`model=unknown tokens=${tokenBucket(sum)} via=${callerFrame(new Error().stack)}`), { env });
      return;
    }
    const { reason, keys } = gatewayPriceMiss(model, env, now, at);
    recordDiag('price:unpriced', new Error(`model=${model} reason=${reason} known=${keys.join(',')}`), { env });
  } catch { /* diagnostics only */ }
}

/**
 * Several totals folded into one, `long` included. Returns the entry itself
 * for a list of one.
 */
export function sumTotals(list) {
  if (list.length === 1) return list[0];
  const out = {};
  for (const t of list) {
    for (const [k, v] of Object.entries(t)) {
      if (k === 'long') {
        out.long = out.long || {};
        for (const [lk, lv] of Object.entries(v)) out.long[lk] = (out.long[lk] || 0) + lv;
      } else out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

/**
 * One priced part per model that spent tokens, or the whole at its one model.
 * `at` is when the tokens were spent (the start of the session or run) and
 * `byDay` holds that model's totals per UTC day, present only when the
 * session or run crossed a UTC midnight. Price rows change at UTC midnight,
 * so partCost prices each day at its own row instead of one row for all (#15).
 */
function partsByModel(x) {
  const t = x.startTime || x.endTime;
  const at = t ? new Date(t).getTime() : undefined;
  const dayTotals = x.dayTotals;
  const dayParts = (model, only) => {
    if (!dayTotals) return {};
    const byDay = {};
    for (const [day, models] of Object.entries(dayTotals)) {
      const hit = only ? models[model] : sumTotals(Object.values(models));
      if (hit) byDay[day] = hit;
    }
    return Object.keys(byDay).length ? { byDay } : {};
  };
  if (!x.modelTotals) return [{ totals: x.totals, model: x.model, at, ...dayParts(x.model, false) }];
  return Object.entries(x.modelTotals).map(([model, totals]) => ({ totals, model, at, ...dayParts(model, true) }));
}

/**
 * What a session's cost is made of: the session itself and each subagent run
 * it spawned (parser.js attaches them as `subagentRuns`). A run has its own
 * model, so it is priced on its own instead of at the session's rate, and a
 * session or run that switched model is split again so each model's tokens
 * meet that model's rate. `own` marks the parts that are the session itself.
 */
export function pricedParts(session) {
  if (!session) return [];
  return [
    ...partsByModel(session).map((part) => ({ ...part, own: true })),
    ...(session.subagentRuns || []).flatMap(partsByModel),
  ];
}

/**
 * Cost of one priced part. A part that crossed UTC midnights is priced day by
 * day, each day at the price row in effect then; the figures are summed. One
 * unpriced day makes the whole part unpriced (null), as for a single price.
 * Without `byDay` the part is priced at its start time.
 */
export function partCost(part, { env = process.env, now } = {}) {
  if (!part.byDay) return sessionCost(part.totals, part.model, { env, now, at: part.at });
  const acc = { actual: 0, noCacheCost: 0, savings: 0, scenario5mCost: 0, extraCostIf5m: 0, extraCostIf5mApplicable: false, tier: null };
  for (const day of Object.keys(part.byDay).sort()) {
    const c = sessionCost(part.byDay[day], part.model, { env, now, at: `${day}T12:00:00Z` });
    if (!c) return null;
    for (const k of ['actual', 'noCacheCost', 'savings', 'scenario5mCost', 'extraCostIf5m']) acc[k] += c[k];
    acc.extraCostIf5mApplicable = acc.extraCostIf5mApplicable || c.extraCostIf5mApplicable;
    acc.tier = c.tier;
  }
  return { ...acc, savingsRate: acc.noCacheCost > 0 ? acc.savings / acc.noCacheCost : 0 };
}

/** Like estimateCostAcross, plus how many priced parts (a session, a subagent run, or one model's share of either) had no price and were left out. */
export function sessionCostAcross(sessions, opts = {}) {
  let unpriced = 0;
  const total = estimateCostAcross((sessions || []).flatMap(pricedParts), (totals, model, part) => {
    const c = partCost(part, opts);
    if (!c) unpriced++;
    return c;
  });
  return { ...total, unpriced };
}
