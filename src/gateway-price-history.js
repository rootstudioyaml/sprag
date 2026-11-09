/**
 * gateway-price-history: dated copies of a LiteLLM gateway's price table (#15).
 *
 * `/model/info` only reports today's prices, so a figure for past usage priced
 * from the current table drifts whenever the gateway changes a price. Every
 * successful refresh is recorded here instead, and a call is priced with the
 * table in effect when it happened.
 *
 * File: <userDataDir>/gateway-price-history.json
 *   { "version": 1,
 *     "gateways": { "<base>": { "checkedAt": <ms of the latest successful fetch>,
 *                               "rows": [ { "from": "YYYY-MM-DD", "prices": {...} } ] } } }
 * Rows are oldest first; `from` is the UTC day of the fetch that first showed
 * those prices. A row is appended only when the prices changed, and a fetch on
 * the day of the last row replaces it.
 *
 * Same principle as the rest of the gateway path: only the gateway's own
 * numbers are used and a model its table lacks stays unpriced (null). Prices
 * for a time later than `checkedAt + PRICE_MAX_AGE_MS` are unknown, the same
 * freshness rule the current table follows.
 *
 * An install that refreshed before this file existed has its table in
 * profile-map.json (`gateway.prices`). That table stands in as a single row
 * from its `fetchedAt` day until the history has an entry for the gateway.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { PRICE_MAX_AGE_MS } from './gateway-prices.js';
import { loadProfileMap } from './model-alias.js';
import { normalizeCandidate } from './litellm-models.js';

export const HISTORY_VERSION = 1;

export function priceHistoryPath() {
  return join(userDataDir(), 'gateway-price-history.json');
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// Sorted keys at every level, so equal tables compare equal whatever order the gateway listed them in.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

let cache = null; // { path, mtimeMs, size, data }

function readHistory() {
  const path = priceHistoryPath();
  try {
    const st = statSync(path);
    if (cache && cache.path === path && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.data;
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const ok = data && data.version === HISTORY_VERSION && data.gateways && typeof data.gateways === 'object';
    const out = ok ? data : { version: HISTORY_VERSION, gateways: {} };
    cache = { path, mtimeMs: st.mtimeMs, size: st.size, data: out };
    return out;
  } catch {
    return { version: HISTORY_VERSION, gateways: {} };
  }
}

/** The table profile-map.json holds for `base`, as a one-row history, or null. */
function seedEntry(base) {
  try {
    const gw = loadProfileMap()?.gateway;
    if (!gw || gw.base !== base || !gw.prices || typeof gw.prices !== 'object') return null;
    const fetchedAt = Date.parse(gw.fetchedAt);
    if (!Number.isFinite(fetchedAt)) return null;
    return { checkedAt: fetchedAt, rows: [{ from: dayOf(fetchedAt), prices: gw.prices }] };
  } catch {
    return null;
  }
}

/**
 * Record a successful fetch of `base`'s table. Appends a row only when the
 * prices differ from the last row; on the same UTC day as the last row the row
 * is replaced instead. Call it before the profile-map section is overwritten:
 * for a gateway the history has not seen yet, the table still stored there is
 * kept as the first row, so the prices known before this fetch are not lost.
 */
export function recordGatewayPrices(base, prices, fetchedAtMs = Date.now()) {
  if (!base || !prices || typeof prices !== 'object' || !Number.isFinite(fetchedAtMs)) return;
  const data = readHistory();
  const gateways = { ...data.gateways };
  const prev = gateways[base] && Array.isArray(gateways[base].rows) ? gateways[base] : seedEntry(base);
  const rows = prev ? prev.rows.map((r) => ({ from: r.from, prices: r.prices })) : [];
  const from = dayOf(fetchedAtMs);
  const last = rows[rows.length - 1];
  if (!last || canonical(last.prices) !== canonical(prices)) {
    if (last && last.from === from) rows[rows.length - 1] = { from, prices };
    else rows.push({ from, prices });
  }
  gateways[base] = { checkedAt: fetchedAtMs, rows };
  writeStateFile(priceHistoryPath(), JSON.stringify({ version: HISTORY_VERSION, gateways }) + '\n');
  cache = null;
}

/**
 * Price of `model` on `base` at time `at` (ms or ISO string): the newest row
 * whose day is not after the UTC day of `at`, or the first row for an earlier
 * time. null when the gateway has no history, `at` is later than the freshness
 * limit, or that row lacks the model (or lists it as ambiguous).
 */
export function gatewayPriceAt(model, base, at) {
  return resolveAt(model, base, at).price;
}

/**
 * Why `gatewayPriceAt` returned null, as a short label for the diagnostics log:
 * `no-history` (no entry or rows for `base`), `stale` (`at` is later than the
 * freshness limit), `ambiguous` (the key is listed with a null value),
 * `not-listed` (the key is absent) or `bad-time`. null when the model is priced.
 */
export function gatewayPriceMissReason(model, base, at) {
  return resolveAt(model, base, at).reason;
}

/**
 * The model keys of the price row that `gatewayPriceAt` would use, sorted and
 * cut to `max` (8 by default). Empty when there is no such row. Shows whether
 * the gateway's table lists the model under another name.
 */
export function gatewayPriceKeys(model, base, at, max = 8) {
  const prices = resolveAt(model, base, at).prices;
  return prices ? Object.keys(prices).sort().slice(0, max) : [];
}

function resolveAt(model, base, at) {
  const miss = (reason, prices = null) => ({ price: null, reason, prices });
  if (!base) return miss('no-history');
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) return miss('bad-time');
  const entry = readHistory().gateways[base] ?? seedEntry(base);
  if (!entry || !Array.isArray(entry.rows) || entry.rows.length === 0) return miss('no-history');
  const day = dayOf(t);
  let row = entry.rows[0];
  for (const r of entry.rows) if (r.from <= day) row = r;
  const prices = row?.prices;
  if (!prices || typeof prices !== 'object') return miss('no-history');
  // The row is chosen before the freshness check so a stale miss still shows what the table held.
  if (!Number.isFinite(entry.checkedAt) || t > entry.checkedAt + PRICE_MAX_AGE_MS) return miss('stale', prices);
  if (typeof model !== 'string' || !model) return miss('not-listed', prices);
  for (const key of [model, normalizeCandidate(model)]) {
    if (key && Object.hasOwn(prices, key)) {
      return prices[key] ? { price: prices[key], reason: null, prices } : miss('ambiguous', prices);
    }
  }
  return miss('not-listed', prices);
}
