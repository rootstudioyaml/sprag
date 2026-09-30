// LiteLLM /model/info prices, shared by the Codex and Claude sides. Per-token USD; both sides
// price a call by the path it took, so these are only ever the gateway's own numbers.
export const PRICE_MAX_AGE_MS = 7 * 86400000;
export const rate = (value) => Number.isFinite(value) && value >= 0 && value < 1 ? value : null;

export function deploymentPrice(row) {
  const info = row?.model_info || {};
  const mode = typeof info.mode === 'string' ? info.mode : null;
  if (mode && !['chat', 'responses', 'completion'].includes(mode)) return null;
  const input = rate(info.input_cost_per_token), output = rate(info.output_cost_per_token);
  if (input === null || output === null) return null;
  return { input, output, cacheRead: rate(info.cache_read_input_token_cost), cacheWrite: rate(info.cache_creation_input_token_cost),
    cacheWrite1h: rate(info.cache_creation_input_token_cost_above_1hr) };
}

/** Per-token prices by alias. Load-balanced deployments must agree, like cache policy. */
export function gatewayPrices(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('LiteLLM model/info returned no model list');
  const groups = new Map();
  for (const row of payload.data) {
    if (typeof row?.model_name !== 'string' || row.model_name.length > 256) continue;
    groups.set(row.model_name, [...(groups.get(row.model_name) || []), deploymentPrice(row)]);
  }
  return Object.fromEntries([...groups].map(([name, prices]) => [name,
    prices[0] && prices.every((p) => JSON.stringify(p) === JSON.stringify(prices[0])) ? prices[0] : null]));
}

/**
 * USD for a token mix at one model's prices, or null when a needed rate is
 * missing. Cached input without a cache-read rate is unknown, not free.
 */
export function codexRunCost({ input = 0, cached = 0, cacheWrite = 0, output = 0 }, price) {
  if (!price || price.input === null || price.output === null) return null;
  if (cached > 0 && price.cacheRead === null) return null;
  // cache_write_input_tokens is billed at the creation rate when one is published, else as input.
  const uncached = Math.max(0, input - cached - cacheWrite);
  return uncached * price.input + cached * (price.cacheRead ?? 0) + cacheWrite * (price.cacheWrite ?? price.input) + output * price.output;
}

