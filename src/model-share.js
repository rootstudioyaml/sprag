/**
 * Model share: how the spend since the routing counter's mark splits across
 * model families, by cost. Feeds the statusline's bar and `sprag saved`'s table.
 *
 * "Same period" as `sprag saved`: the routing reset mark, or the start of the
 * calendar month when nothing was ever reset, capped at 90 days of parsing.
 */
import { pricedParts, sessionCost } from './claude-price.js';
import { modelFamily } from './savings-ledger.js';
import { readResetMarks } from './saved-reset.cjs';
import { RESET, RED, GREEN, YELLOW, CYAN, MAGENTA, GRAY } from './formatters/statusline.js';

const DAY = 86400000;
export const MAX_DAYS = 90;

/**
 * Split `slots` whole units across `values` in proportion, largest remainder
 * first, so the parts always add up to exactly `slots`. Ties keep input order.
 */
export function roundShares(values, slots) {
  const vs = (values || []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = vs.reduce((a, b) => a + b, 0);
  if (total <= 0 || !(slots > 0)) return vs.map(() => 0);
  const exact = vs.map((v) => (v / total) * slots);
  const out = exact.map((x) => Math.floor(x + 1e-9));
  let left = slots - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k].i] += 1;
  return out;
}

function rank(families) {
  return families
    .map((f, i) => ({ ...f, i }))
    .sort((a, b) => b.usd - a.usd || a.i - b.i);
}

function toneOf(family) {
  switch (family) {
    case 'opus': return MAGENTA;
    case 'sonnet': return CYAN;
    case 'haiku': return GREEN;
    case 'fable': return YELLOW;
    case 'mythos': return RED;
    default: return GRAY;
  }
}

const FAMILY_NAMES = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', mythos: 'Mythos' };

/**
 * Statusline legend, `● Opus 90%  ● Sonnet 10%`: a dot in the family's colour,
 * the name, and a gray whole percent. Reads without a key, which the bar and
 * letters did not. Without colour the dot carries nothing, so it is dropped.
 * A family that spent money but rounds to 0% shows as `<1%`: dropping it made
 * a model that had just been delegated to look unused.
 */
export function shareLegend(families, { color = true } = {}) {
  const ranked = rank(families || []);
  const pcts = roundShares(ranked.map((f) => f.usd), 100);
  return ranked
    .map((f, idx) => {
      if (!(f.usd > 0)) return null;
      const name = FAMILY_NAMES[f.family] || f.family;
      const pct = pcts[idx] > 0 ? `${pcts[idx]}%` : '<1%';
      return color
        ? `${toneOf(f.family)}●${RESET} ${name} ${GRAY}${pct}${RESET}`
        : `${name} ${pct}`;
    })
    .filter(Boolean)
    .join('  ');
}

/** Cost per family over the given sessions, subagent runs split out. Pure. */
export function computeModelShare(sessions, { env = process.env } = {}) {
  const all = new Map();
  const sub = new Map();
  let unpriced = 0;
  let totalUsd = 0;
  let subUsd = 0;
  for (const s of sessions || []) {
    for (const part of pricedParts(s)) {
      if (!part || !part.totals) continue;
      let cost = null;
      try { cost = sessionCost(part.totals, part.model, { env }); } catch { cost = null; }
      if (!cost || !Number.isFinite(cost.actual)) { unpriced++; continue; }
      const family = modelFamily(part.model);
      all.set(family, (all.get(family) || 0) + cost.actual);
      totalUsd += cost.actual;
      if (!part.own) {
        sub.set(family, (sub.get(family) || 0) + cost.actual);
        subUsd += cost.actual;
      }
    }
  }
  const list = (m) => [...m.entries()]
    .map(([family, usd]) => ({ family, usd, pct: totalUsd > 0 ? (usd / totalUsd) * 100 : 0 }))
    .sort((a, b) => b.usd - a.usd);
  if (!(totalUsd > 0)) {
    return { totalUsd: 0, unpriced, families: [], subagent: { usd: 0, pct: 0, families: [] } };
  }
  return {
    totalUsd,
    unpriced,
    families: list(all),
    subagent: { usd: subUsd, pct: (subUsd / totalUsd) * 100, families: list(sub) },
  };
}

/**
 * Collect the sessions for the routing counter's period and compute the share.
 * `monthSessions` (already parsed by the statusline) is reused when the period
 * starts inside the month; otherwise, or when absent, the transcripts are parsed.
 */
export async function loadModelShare({ dir, env = process.env, projectFilter, now = Date.now(), monthSessions } = {}) {
  const { parseAllSessions, sessionsSince } = await import('./parser.js');
  const { monthStartMs } = await import('./month-spend.js');
  const reset = readResetMarks(dir).routing;
  const monthStart = monthStartMs(new Date(now));
  let since = Number.isFinite(reset) && reset > 0 ? reset : monthStart;
  let sinceKind = since === monthStart && !(Number.isFinite(reset) && reset > 0) ? 'month' : 'reset';
  if (now - since > MAX_DAYS * DAY) {
    since = now - MAX_DAYS * DAY;
    sinceKind = 'capped';
  }
  let sessions;
  if (monthSessions && since >= monthStart) {
    sessions = await sessionsSince(monthSessions, since);
  } else {
    const days = Math.max(1, Math.ceil((now - since) / DAY));
    sessions = await sessionsSince(await parseAllSessions({ days, projectFilter, sinceMs: since }), since);
  }
  return { ...computeModelShare(sessions, { env }), since, sinceKind };
}
