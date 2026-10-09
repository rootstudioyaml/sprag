import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { userDataDir } from './paths.js';
import { writeViaTmp } from './state-file.js';
import { loadConfig } from './config.js';
import { findProjectRoot } from './harness.js';
import { discoverCodexSessionFiles, parseCodexTurns } from './codex-parser.js';
import { categorize, isSkippable, tierOf, calibrateThresholds, MIN_RECURRENCE,
  RESCAN_MIN_INTERVAL_MS, RESCAN_BIG_DELTA_BYTES, RESCAN_MAX_AGE_MS } from './route-scan.js';
import { codexPromptCategory, loadCodexModelRules } from './codex-delegation.js';
import { codexRunCost, codexPriceBook, isDirectOpenAI, readCodexPrices } from './codex-cache-policy.js';
import { OPENAI_PRICES_CHECKED_AT } from './openai-prices.js';
import { refreshCodexLedger } from './codex-ledger.js';

/*
 * Codex route-scan: recurring easy turns become delegation-rule candidates.
 * Kept apart from Claude's route-scan.json, model-rules.json and
 * ratchet-model.md; approval goes through the Codex rule store with an
 * explicit scope.
 */

const cacheFile = (dir) => join(dir, 'codex-route-scan.json');
const MAX_CANDIDATES = 8;

export function readCodexRouteScan({ dir = userDataDir() } = {}) {
  try {
    const data = JSON.parse(readFileSync(cacheFile(dir), 'utf8'));
    return data?.version === 1 && Array.isArray(data.candidates) ? data : null;
  } catch { return null; }
}

function writeCache(data, dir) {
  mkdirSync(dir, { recursive: true });
  const file = cacheFile(dir), tmp = `${file}.${randomUUID()}.tmp`;
  writeViaTmp(tmp, file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

/** Candidates not yet approved or dismissed; with `root`, only that project's. */
export function openCodexCandidates(cache, { root } = {}) {
  if (!cache?.candidates) return [];
  const resolved = new Set(cache.resolved || []);
  const project = root ? resolve(root) : null;
  return cache.candidates.filter((c) => !resolved.has(c.signature) && (!project || c.projectRoot === project));
}

export function findCodexCandidate(ref, { dir = userDataDir() } = {}) {
  const m = /^R?(\d+)$/i.exec(String(ref || ''));
  if (!m) return null;
  return openCodexCandidates(readCodexRouteScan({ dir })).find((c) => c.id === Number(m[1])) || null;
}

/** Stop offering a candidate: it was approved or the user said no. */
export function resolveCodexCandidate(cand, { dir = userDataDir() } = {}) {
  const cache = readCodexRouteScan({ dir });
  if (!cache) return;
  cache.resolved = [...new Set([...(cache.resolved || []), cand.signature])];
  writeCache(cache, dir);
}

/** Same gate as Claude's: at most hourly, and only when enough new log data arrived. */
export async function shouldRescanCodex(cache, { home, days = 14, now = Date.now() } = {}) {
  const ts = Date.parse(cache?.scannedAt);
  if (!Number.isFinite(ts)) return true;
  const age = now - ts;
  if (age < RESCAN_MIN_INTERVAL_MS) return false;
  let total = 0, anyNew = false;
  try {
    for (const f of await discoverCodexSessionFiles({ home, days })) {
      total += f.size;
      if (f.mtime > ts) anyNew = true;
    }
  } catch { return age >= RESCAN_MAX_AGE_MS; }
  if (!anyNew) return false;
  if (total - (cache.dataBytes || 0) >= RESCAN_BIG_DELTA_BYTES) return true;
  return age >= RESCAN_MAX_AGE_MS;
}

/**
 * Cheaper targets the user can actually run. "Known to work" means seen in
 * this user's Codex sessions, set as the default delegate target, or already
 * a rule target, so a gateway that also serves unrelated models (embeddings,
 * other vendors) never has one suggested blind.
 */
function pickTarget(group, { prices, known, home }) {
  const book = codexPriceBook(group.provider, prices, { home });
  const cost = (model) => book ? codexRunCost(group.tokens, book.prices[model]) : null;
  const parent = cost(group.from);
  if (parent === null) return { suggestedModel: null, alternatives: [], estSavedUsd: null };
  const cheaper = Object.keys(book.prices).filter((m) => m !== group.from && book.prices[m])
    .map((m) => ({ model: m, usd: cost(m) })).filter((x) => x.usd !== null && x.usd < parent)
    .sort((a, b) => a.usd - b.usd);
  const eligible = cheaper.filter((x) => known.has(`${group.provider}|${x.model}`));
  // Simple work goes to the cheapest model; moderate work steps down one notch.
  const pick = group.tiers.T2 >= group.tiers.T1 ? eligible[0] : eligible.at(-1);
  return {
    suggestedModel: pick?.model ?? null,
    alternatives: pick ? [] : cheaper.slice(0, 3).map((x) => x.model),
    estSavedUsd: pick ? parent - pick.usd : null,
  };
}

export async function runCodexRouteScan({ days = 14, now = Date.now(), home, dir = userDataDir(),
  prices = readCodexPrices({ now, home, dir }), cfg = loadConfig(), refreshLedger = true } = {}) {
  const files = await discoverCodexSessionFiles({ home, days });
  const cutoffMs = now - days * 86400000;
  const episodes = [];
  const observed = new Set();
  const seen = new Set();
  let dataBytes = 0;
  for (const f of files.slice().reverse()) {
    dataBytes += f.size;
    let s;
    try { s = await parseCodexTurns(f.path, { cutoffMs }); } catch { continue; }
    const identity = s.sessionId || f.path;
    if (seen.has(identity)) continue;
    seen.add(identity);
    // A model a subagent ran on is proven to work, even though its turns are
    // the delegated work itself rather than requests to route.
    for (const t of s.turns) if (t.model) observed.add(`${s.provider}|${t.model}`);
    if (s.isSubagent) continue;
    for (const t of s.turns) {
      if (t.aborted || !Number.isFinite(t.endedAt) || !t.text || !t.model || isSkippable(t.text)) continue;
      episodes.push({ ...t, provider: s.provider, projectRoot: findProjectRoot(t.cwd || s.projectDir || '.', { agent: 'codex' }) });
    }
  }
  const thresholds = calibrateThresholds(episodes.map((e) => e.out));
  const groups = new Map();
  for (const ep of episodes) {
    // A second user message mid-turn is steering, which is not a bounded task.
    if (ep.userMessages > 1) continue;
    // Group by the category the prompt hook would route, so an approved rule
    // can fire. The tool mix only vetoes editing turns, which categorize()
    // leaves unclassified.
    const runtime = codexPromptCategory(ep.text);
    if (!runtime || !categorize(ep.text, ep.tools)) continue;
    const tier = tierOf(ep, runtime, thresholds);
    if (tier !== 'T1' && tier !== 'T2') continue;
    const key = `${runtime.id}|${ep.provider}|${ep.model}|${ep.projectRoot}`;
    const g = groups.get(key) || { signature: key, category: runtime.id, label: runtime.label, labelEn: runtime.labelEn,
      from: ep.model, provider: ep.provider, projectRoot: ep.projectRoot, count: 0, tiers: { T1: 0, T2: 0 }, example: ep.text,
      tokens: { input: 0, cached: 0, cacheWrite: 0, output: 0 }, lastSeen: 0 };
    g.count++;
    g.tiers[tier]++;
    if (ep.text.length < g.example.length) g.example = ep.text;
    g.tokens.input += ep.input; g.tokens.cached += ep.cached; g.tokens.cacheWrite += ep.cacheWrite; g.tokens.output += ep.out;
    g.lastSeen = Math.max(g.lastSeen, ep.endedAt ?? ep.startedAt ?? 0);
    groups.set(key, g);
  }
  let rules = [];
  try { rules = loadCodexModelRules({ dir }); } catch { /* An unreadable rule file only means candidates may repeat. */ }
  const covered = (g) => rules.some((r) => r.category === g.category && r.from === g.from &&
    (!r.provider || r.provider === g.provider) &&
    (r.scope === 'global' || r.targetRoot === g.projectRoot));
  const known = new Set([...observed, ...rules.filter((r) => r.provider).map((r) => `${r.provider}|${r.model}`)]);
  const target = cfg?.codex?.delegateTarget?.model;
  if (target) {
    if (prices?.provider) known.add(`${prices.provider}|${target}`);
    if (isDirectOpenAI('openai', { home })) known.add(`openai|${target}`);
  }
  const prev = readCodexRouteScan({ dir });
  const resolved = new Set(prev?.resolved || []);
  const candidates = [...groups.values()]
    .filter((g) => g.count >= MIN_RECURRENCE && !covered(g) && !resolved.has(g.signature))
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, MAX_CANDIDATES)
    .map((g, i) => ({ id: i + 1, signature: g.signature, category: g.category, label: g.label, labelEn: g.labelEn,
      from: g.from, provider: g.provider, projectRoot: g.projectRoot, count: g.count, tiers: g.tiers, example: g.example.slice(0, 160),
      lastSeen: g.lastSeen || null, suggestedScope: 'project', ...pickTarget(g, { prices, known, home }) }));
  const priceCheckedAt = prices?.checkedAt ?? ([...groups.values()].some((g) => isDirectOpenAI(g.provider, { home })) ? OPENAI_PRICES_CHECKED_AT : null);
  const data = { version: 1, scannedAt: new Date(now).toISOString(), days, dataBytes, totalEpisodes: episodes.length,
    thresholds, observedModels: [...observed], priceCheckedAt, candidates, resolved: [...resolved] };
  writeCache(data, dir);
  if (refreshLedger) {
    try { await refreshCodexLedger({ dir, home, now, prices }); } catch { /* The ledger catches up on the next scan. */ }
  }
  return data;
}
