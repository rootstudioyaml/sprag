/**
 * net-saving — the v3 delegation counterfactual.
 *
 * v2 priced the subagent's own tokens at the session model's rates and called
 * the difference the saving. That leaves out what makes a long-lived main
 * session expensive: every call it makes re-reads its whole context from the
 * cache, and everything a tool returns stays in that context for the rest of
 * the session. It also leaves out what delegating costs the main session: the
 * prompt it writes and the report that comes back and is then re-read.
 *
 * For one delegated run, with
 *   k    subagent calls, ctx_i the context of call i, g_i = ctx_i - ctx_1
 *   G    ctx_k - ctx_1 + the run's total output (what the main context would
 *        have gained)
 *   C    context of the main call that issued the delegation
 *   N    main calls that follow, up to the next compaction (capped)
 *   P    tokens of the delegation prompt, R tokens of the report that returned
 * the main model doing the work itself would have cost
 *   CF_work  = sum_i (C + g_i) * cacheRead + sum_i (newIn_i * write + out_i * output)
 *   CF_carry = G * N * cacheRead
 * and delegating actually cost
 *   Actual   = what the run cost on its own model
 *              + P * output + R * write + R * N * cacheRead
 * so  saving = CF_work + CF_carry - Actual.
 *
 * Rates are the main model's, per token, from the same price paths as every
 * other figure (list table, or the LiteLLM gateway table when one is set). A
 * rate that is not known makes the saving null; nothing is filled in.
 */

import { sessionCost } from './claude-price.js';
import { gatewayBase } from './gateway-auth.js';

// estimateCost rounds to cents. A per-token rate or a sub-cent run would vanish
// in that rounding, so both are priced at a larger quantity and scaled back
// (a run to 1e-8 USD, a rate to 1e-12 USD per token).
const RATE_SCALE = 1e9;
const COST_SCALE = 1e6;

const ZERO = { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 };

/** Where a price came from: the Anthropic list table, or a LiteLLM gateway. */
export function priceSource(env = process.env) {
  return gatewayBase(env) ? 'gateway' : 'list';
}

/**
 * Per-token USD rates of a model for the three token classes the counterfactual
 * touches. Cache writes are taken at the 5-minute rate, the cheaper of the two.
 * null when any of them has no price.
 */
export function unitRates(model, { env = process.env } = {}) {
  if (!model) return null;
  const rate = (totals) => {
    let c;
    try { c = sessionCost({ ...ZERO, ...totals }, model, { env }); } catch { return null; }
    return c ? c.actual / RATE_SCALE : null;
  };
  const cacheRead = rate({ cacheRead: RATE_SCALE });
  const write = rate({ cacheCreation: RATE_SCALE, ephemeral5m: RATE_SCALE });
  const output = rate({ output: RATE_SCALE });
  if (cacheRead === null || write === null || output === null) return null;
  return { cacheRead, write, output };
}

/**
 * What a run's tokens cost on a model, in USD, to better than a cent. null when
 * the model has no price on this path.
 */
export function exactCost(totals, model, { env = process.env } = {}) {
  if (!model) return null;
  const scale = (t) => {
    const out = {};
    for (const f of Object.keys(ZERO)) out[f] = (t[f] || 0) * COST_SCALE;
    return out;
  };
  const scaled = scale(totals);
  if (totals.long) scaled.long = scale(totals.long);
  let c;
  try { c = sessionCost(scaled, model, { env }); } catch { return null; }
  return c ? c.actual / COST_SCALE : null;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The v3 saving of one delegated run, or null when an input is missing (the
 * caller then falls back to the v2 formula).
 *
 * @param {object} p
 * @param {Array<{ctx:number,newIn:number,out:number}>} p.calls subagent calls, in order
 * @param {number} p.mainCtx C
 * @param {number} p.followUps N
 * @param {number} p.promptTokens P
 * @param {number} p.resultTokens R
 * @param {{cacheRead:number,write:number,output:number}} p.rates main model, USD per token
 * @param {number} p.subActual what the run cost on its own model, USD
 * @param {boolean} [p.skipFirstWrite] leave the first call's new input out of CF_work
 * @returns {{usd:number,cfWork:number,cfCarry:number,overhead:number,actual:number}|null}
 */
export function netSavingV3({ calls, mainCtx, followUps, promptTokens, resultTokens, rates, subActual, skipFirstWrite = false }) {
  if (!Array.isArray(calls) || calls.length === 0) return null;
  if (!calls.every((c) => c && isNum(c.ctx) && isNum(c.newIn) && isNum(c.out))) return null;
  if (!isNum(mainCtx) || mainCtx <= 0) return null;
  if (!isNum(followUps) || followUps < 0) return null;
  if (!isNum(promptTokens) || promptTokens < 0) return null;
  if (!isNum(resultTokens) || resultTokens < 0) return null;
  if (!rates || !isNum(rates.cacheRead) || !isNum(rates.write) || !isNum(rates.output)) return null;
  if (!isNum(subActual) || subActual < 0) return null;

  const ctx1 = calls[0].ctx;
  const grow = (c) => Math.max(0, c.ctx - ctx1);
  let cfWork = 0;
  let cfReread = 0;
  let totalOut = 0;
  calls.forEach((c, i) => {
    const reread = (mainCtx + grow(c)) * rates.cacheRead;
    cfWork += reread;
    cfReread += reread;
    if (!(skipFirstWrite && i === 0)) cfWork += c.newIn * rates.write;
    cfWork += c.out * rates.output;
    totalOut += c.out;
  });
  const G = grow(calls[calls.length - 1]) + totalOut;
  const cfCarry = G * followUps * rates.cacheRead;
  const overhead = promptTokens * rates.output
    + resultTokens * rates.write
    + resultTokens * followUps * rates.cacheRead;
  const actual = subActual + overhead;
  // cfReread is the part of cfWork spent re-reading context; the rest is new
  // input and output. Split out so the savings page can show each term.
  return { usd: cfWork + cfCarry - actual, cfWork, cfReread, cfCarry, overhead, actual, subActual };
}
