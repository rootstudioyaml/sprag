/**
 * gateway-spend: the LiteLLM gateway's own daily spend for this user, for the
 * team upload.
 *
 * Local session logs miss requests that leave no transcript (print mode
 * without persistence, SDK scripts, deleted conversations), so a machine on a
 * gateway reports the gateway's figure as its total usage and keeps the local
 * figures beside it. Two calls, both with the user's own key:
 *
 *   GET {base}/key/info          the key's user_id (404 on custom-auth deployments)
 *   GET {base}/user/info         user_info.user_id as the fallback
 *   GET {base}/global/spend/logs rows {date, spend, api_key, user}; the most
 *                                recent 30 days, every user the key may see
 *
 * Only rows whose `user` is this user id are summed: an admin key sees
 * everyone's rows and summing them all would report the whole company as one
 * person. Without a user id nothing is attributable and the caller gets null,
 * which reads as "no gateway figure" rather than an error.
 *
 * The key is used for the Authorization header only and is never written to
 * a file (same rule as litellm-budget.js). Failures are returned as
 * `{ error }`, never thrown: the upload goes on with local figures.
 *
 * `date` is the gateway's calendar day (UTC on the deployments measured), so
 * a day can differ from the local day by up to a few hours of traffic; range
 * sums are unaffected.
 */

import { createHash } from 'node:crypto';
// gateway-auth.js is the leaf that litellm-budget.js re-exports; importing it
// directly keeps team-sync.js out of the statusline formatter's import graph.
import { gatewayBase, resolveKey } from './gateway-auth.js';
import { debug } from './debug.js';

/** Same answer as litellm-budget's gatewayEnv: address and key, or null. */
export function gatewayEnv(env = process.env) {
  const base = gatewayBase(env);
  if (!base) return null;
  const key = resolveKey(env);
  return key ? { base, key } : null;
}

export const GATEWAY_SPEND_TIMEOUT_MS = 15000;
export const GATEWAY_SPEND_DAYS = 30;

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;

/** Local calendar day, same key as team-sync.js and stats.js. */
function dayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Pseudonymous id for the (gateway, user) pair: the first 16 hex characters of a SHA-256. */
export function gatewayUserHash(base, userId) {
  return createHash('sha256').update(`${base}\n${userId}`).digest('hex').slice(0, 16);
}

/**
 * Sum `rows` for one user by date. Exported for tests and for the aggregate
 * step; `rows` is the `/global/spend/logs` body (an array, or `{ data }`).
 */
export function sumSpendRows(rows, userId) {
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : [];
  const days = new Map();
  let earliest = null;
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const date = String(r.date || r.startTime || '').slice(0, 10);
    if (!DAY_RE.test(date)) continue;
    if (earliest === null || date < earliest) earliest = date;
    if (String(r.user ?? '') !== String(userId)) continue;
    const usd = Number(r.spend);
    if (!Number.isFinite(usd)) continue;
    days.set(date, (days.get(date) || 0) + usd);
  }
  return { days, earliest };
}

/**
 * The gateway figure for one local day: a number inside the covered range (0
 * when the gateway has no row for it), null outside it or without a result.
 */
export function gatewayDayValue(result, day) {
  if (!result || !result.days || !result.coveredFrom || !result.coveredTo) return null;
  if (day < result.coveredFrom || day > result.coveredTo) return null;
  return result.days.get(day) || 0;
}

/**
 * @returns {Promise<null | { error: string } | { days: Map<string, number>, coveredFrom: string, coveredTo: string, userId: string, userHash: string }>}
 *   null when no gateway is configured or the user id cannot be learned.
 */
export async function fetchGatewayDailySpend({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = GATEWAY_SPEND_TIMEOUT_MS } = {}) {
  const g = gatewayEnv(env);
  if (!g) return null;
  const { base, key } = g;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const headers = { accept: 'application/json', authorization: `Bearer ${key}` };
  const getJson = async (path) => {
    const res = await fetchImpl(`${base}${path}`, { signal: ctl.signal, headers, redirect: 'error' });
    if (!res.ok) throw new Error(`LiteLLM ${path} responded ${res.status}`);
    return res.json();
  };
  try {
    // Same order as pickBudgetSource: the key's own user id first, then the
    // user record. /key/info is 404 on custom-auth deployments; that is fine.
    let userId = null;
    try {
      const keyBody = await getJson('/key/info');
      const id = keyBody?.info?.user_id;
      if (typeof id === 'string' && id) userId = id;
    } catch (e) { debug('gateway-spend:key-info', e); }
    if (!userId) {
      const userBody = await getJson('/user/info');
      const id = userBody?.user_info?.user_id;
      if (typeof id === 'string' && id) userId = id;
    }
    if (!userId) return null;
    const rows = await getJson('/global/spend/logs');
    const { days, earliest } = sumSpendRows(rows, userId);
    const coveredTo = dayKey(now);
    const windowStart = dayKey(now - (GATEWAY_SPEND_DAYS - 1) * 86400000);
    // The response is the gateway's recent-30-day window. A day inside it with
    // no row is a day with no spend; the earliest row only widens the window
    // when the gateway sent more than 30 days.
    const coveredFrom = earliest && earliest < windowStart ? earliest : windowStart;
    return { days, coveredFrom, coveredTo, userId, userHash: gatewayUserHash(base, userId) };
  } catch (e) {
    debug('gateway-spend', e);
    return { error: e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}
