import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { userDataDir } from './paths.js';
import { discoverCodexSessionFiles, parseCodexTurns } from './codex-parser.js';
import { codexRunCost, readCodexPrices } from './codex-cache-policy.js';

/*
 * Codex routing savings, kept apart from Claude's delegation ledger.
 *
 * A child rollout only counts when Sprag itself routed it: either path writes
 * a random route id and records the same id here at that moment, so the
 * pending record (not the marker text a model could write by hand) is what
 * shows a rule existed before the child ran. Two ways an id reaches a child:
 *   - the PreToolUse spawn rewrite (codexDelegationTool) writes it into the
 *     spawned message, for Codex versions that route spawn_agent through hooks;
 *   - on versions that don't (0.159.2), the prompt hint (codexRouteHint) can
 *     only ask the model to include the line, so SubagentStart binds the id to
 *     whichever spawned child matches the pending record (bindCodexSubagent),
 *     and refreshCodexLedger falls back to that binding when no marker is found.
 */

export const ROUTE_ID_RE = /<!-- sprag:codex:route id=([0-9a-f]{16}) -->/;
const PENDING_TTL_MS = 7 * 86400000;
const BIND_TTL_MS = 30 * 60000;
const pendingFile = (dir) => join(dir, 'codex-delegations.jsonl');
const bindsFile = (dir) => join(dir, 'codex-delegation-binds.jsonl');
const ledgerFile = (dir) => join(dir, 'codex-delegation-ledger.json');

export function newRouteId() {
  return randomBytes(8).toString('hex');
}

/** One append per spawn. Each line stays well under PIPE_BUF, so parallel spawns do not interleave. */
export function recordCodexDelegation(entry, { dir = userDataDir() } = {}) {
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ...entry, at: entry.at ?? Date.now() });
  if (line.length > 3500) throw new Error('Codex delegation record too large');
  appendFileSync(pendingFile(dir), line + '\n', { mode: 0o600 });
}

export function readCodexDelegations({ dir = userDataDir() } = {}) {
  let text;
  try { text = readFileSync(pendingFile(dir), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    try {
      const r = JSON.parse(line);
      if (r && /^[0-9a-f]{16}$/.test(r.id) && Number.isFinite(r.at) && typeof r.to === 'string') out.push(r);
    } catch { /* Partial trailing line. */ }
  }
  return out;
}

/** One append per bind, mirroring recordCodexDelegation's append-only shape. */
export function recordCodexBinding(entry, { dir = userDataDir() } = {}) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(bindsFile(dir), JSON.stringify(entry) + '\n', { mode: 0o600 });
}

export function readCodexBindings({ dir = userDataDir() } = {}) {
  let text;
  try { text = readFileSync(bindsFile(dir), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    try {
      const b = JSON.parse(line);
      if (b && /^[0-9a-f]{16}$/.test(b.id) && typeof b.childSessionId === 'string' && Number.isFinite(b.at)) out.push(b);
    } catch { /* Partial trailing line. */ }
  }
  return out;
}

/**
 * Bind a just-spawned SubagentStart child to the pending route it most likely
 * fulfills: same parent thread, same target model, recent enough, and not
 * already claimed by another child. Returns the bound route id, or null when
 * nothing matches or this child is already bound.
 */
export function bindCodexSubagent(payload, { dir = userDataDir(), now = Date.now() } = {}) {
  if (typeof payload?.agent_id !== 'string' || typeof payload?.session_id !== 'string' || typeof payload?.model !== 'string') return null;
  const binds = readCodexBindings({ dir });
  if (binds.some((b) => b.childSessionId === payload.agent_id)) return null;
  const boundIds = new Set(binds.map((b) => b.id));
  const pending = readCodexDelegations({ dir }).filter((r) =>
    r.parentSessionId === payload.session_id && r.to === payload.model && now - r.at < BIND_TTL_MS && !boundIds.has(r.id));
  if (!pending.length) return null;
  const chosen = pending.reduce((a, b) => (b.at > a.at ? b : a));
  recordCodexBinding({ id: chosen.id, childSessionId: payload.agent_id, at: now }, { dir });
  return chosen.id;
}

export function loadCodexLedger({ dir = userDataDir() } = {}) {
  try {
    const data = JSON.parse(readFileSync(ledgerFile(dir), 'utf8'));
    if (data?.version === 1 && data.events && typeof data.events === 'object') return data;
  } catch { /* Missing or unreadable reads as empty. */ }
  return { version: 1, events: {} };
}

function saveLedger(data, dir) {
  mkdirSync(dir, { recursive: true });
  const file = ledgerFile(dir), tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}

/**
 * The route id a child rollout carries, and its own tokens, or null. When no
 * child turn carries the marker line (the prompt-hint path can only ask the
 * model to write it, not guarantee it), `binds` — childSessionId -> id from
 * SubagentStart — supplies the id instead.
 */
async function childRun(path, cutoffMs, binds) {
  const s = await parseCodexTurns(path, { cutoffMs });
  if (!s.isSubagent) return null;
  let id = null;
  const tokens = { input: 0, cached: 0, cacheWrite: 0, output: 0 };
  let model = null, startedAt = null, endedAt = null, complete = false, aborted = false, usageKnown = false, mixedModels = false;
  for (const t of s.turns) {
    // Only the child's own first message may carry the id; copied history does not count.
    if (!id && t.text) { const m = ROUTE_ID_RE.exec(t.text); if (m) id = m[1]; }
    tokens.input += t.input; tokens.cached += t.cached; tokens.cacheWrite += t.cacheWrite; tokens.output += t.out;
    if (model && t.model && model !== t.model) mixedModels = true;
    model ??= t.model;
    usageKnown ||= t.usageKnown;
    if (Number.isFinite(t.startedAt)) startedAt = Math.min(startedAt ?? t.startedAt, t.startedAt);
    if (Number.isFinite(t.endedAt)) { endedAt = Math.max(endedAt ?? t.endedAt, t.endedAt); complete = !t.aborted; aborted = !!t.aborted; }
  }
  if (!id && binds) id = binds.get(s.sessionId) ?? null;
  return id ? { id, sessionId: s.sessionId, parentThreadId: s.parentThreadId, provider: s.provider,
    model, tokens, startedAt, endedAt, complete, aborted, usageKnown: usageKnown && !mixedModels } : null;
}

/**
 * Join child rollouts to pending routes and price them. Savings hold the
 * child's tokens constant and price them at the parent model, the same
 * approximation Claude's ledger states. A route to a pricier model is a loss,
 * shown as one rather than clamped away. A child that was interrupted before
 * it finished replaced no parent work (the parent did the task itself), so its
 * whole cost is booked as a loss.
 */
export async function refreshCodexLedger({ dir = userDataDir(), home, now = Date.now(), prices = readCodexPrices({ now, home, dir }) } = {}) {
  const pending = readCodexDelegations({ dir }).filter((r) => now - r.at < PENDING_TTL_MS);
  const ledger = loadCodexLedger({ dir });
  if (!pending.length) return ledger;
  const byId = new Map(pending.map((r) => [r.id, r]));
  const bindMap = new Map(readCodexBindings({ dir }).filter((b) => byId.has(b.id)).map((b) => [b.childSessionId, b.id]));
  const oldest = Math.min(...pending.map((r) => r.at));
  const files = await discoverCodexSessionFiles({ home, days: Math.max(1, (now - oldest) / 86400000 + 1) });
  let changed = false;
  const seen = new Set();
  for (const f of files.slice().reverse()) {
    if (f.mtime < oldest) continue;
    let run;
    try { run = await childRun(f.path, oldest - 60000, bindMap); } catch { continue; }
    const route = run && byId.get(run.id);
    // The id must come from a spawn this parent made, after the record was written.
    if (!route || (route.parentSessionId && run.parentThreadId && route.parentSessionId !== run.parentThreadId)) continue;
    if (route.provider && route.provider !== run.provider) continue;
    if (Number.isFinite(run.startedAt) && run.startedAt < route.at - 5000) continue;
    if (seen.has(route.id)) continue;
    seen.add(route.id);
    const to = run.model || route.to;
    const previous = ledger.events[route.id];
    const provider = route.provider || run.provider;
    const sameRun = previous?.childSessionId === run.sessionId && previous.to === to && previous.from === route.from;
    const rates = sameRun && previous.rates ? previous.rates
      : prices?.provider === provider ? { from: prices.prices[route.from], to: prices.prices[to], checkedAt: prices.checkedAt } : null;
    const actual = rates && run.usageKnown ? codexRunCost(run.tokens, rates.to) : null;
    const counterfactual = rates && run.usageKnown ? codexRunCost(run.tokens, rates.from) : null;
    const usd = actual === null || counterfactual === null ? null : run.aborted ? -actual : counterfactual - actual;
    const event = { ts: run.endedAt ?? route.at, parentSessionId: route.parentSessionId || run.parentThreadId || null,
      childSessionId: run.sessionId, source: route.source, category: route.category ?? null, scope: route.scope ?? null,
      from: route.from, to, provider, tokens: run.tokens, usd, rates: usd === null ? null : rates,
      priceCheckedAt: rates?.checkedAt ?? null, complete: run.complete, ...(run.aborted ? { aborted: true } : {}) };
    // A transient price outage must not erase a completed, unchanged priced run.
    if (usd === null && sameRun && previous.complete && Number.isFinite(previous.usd) &&
        JSON.stringify(previous.tokens) === JSON.stringify(run.tokens)) continue;
    if (JSON.stringify(ledger.events[route.id]) !== JSON.stringify(event)) { ledger.events[route.id] = event; changed = true; }
  }
  if (changed) saveLedger(ledger, dir);
  return ledger;
}

/** Signed totals over priced runs; unpriced runs are counted, never summed as zero. */
export function codexRoutingSavedTotals({ dir = userDataDir(), now = Date.now() } = {}) {
  const events = Object.values(loadCodexLedger({ dir }).events);
  const totals = { week: 0, month: 0, total: 0, runs: events.length, priced: 0 };
  for (const e of events) {
    if (!Number.isFinite(e.usd)) continue;
    totals.priced++;
    totals.total += e.usd;
    if (now - e.ts < 7 * 86400000) totals.week += e.usd;
    if (now - e.ts < 30 * 86400000) totals.month += e.usd;
  }
  return totals;
}
