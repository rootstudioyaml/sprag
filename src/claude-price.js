/**
 * Claude-side cost by the path the call took. A session on a LiteLLM gateway
 * (gatewayBase(env) set) is billed by the gateway, so it is priced from its
 * /model/info table and stays unpriced (null) when the table has no entry;
 * the Anthropic list table is never a fallback there. Every other session is a
 * direct call and uses the list table. Kept apart from cost.js because
 * litellm-models.js imports cost.js, and this needs both.
 */
import { estimateCost, estimateCostAcross } from './cost.js';
import { gatewayPriceFor } from './litellm-models.js';
import { gatewayBase } from './gateway-auth.js';

export function sessionCost(totals, model, { env = process.env, now } = {}) {
  if (!gatewayBase(env)) return estimateCost(totals, model);
  const price = gatewayPriceFor(model, env, now);
  return price ? estimateCost(totals, model, { price }) : null;
}

/**
 * What a session's cost is made of: the session itself and each subagent run
 * it spawned (parser.js attaches them as `subagentRuns`). A run has its own
 * model, so it is priced on its own instead of at the session's rate.
 */
export function pricedParts(session) {
  return session ? [session, ...(session.subagentRuns || [])] : [];
}

/** Like estimateCostAcross, plus how many sessions or subagent runs had no price and were left out. */
export function sessionCostAcross(sessions, opts = {}) {
  let unpriced = 0;
  const total = estimateCostAcross((sessions || []).flatMap(pricedParts), (totals, model) => {
    const c = sessionCost(totals, model, opts);
    if (!c) unpriced++;
    return c;
  });
  return { ...total, unpriced };
}
