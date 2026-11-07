// Shared helpers for the evals pipeline. Pure functions are exported for tests.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ratesAt, detectPricingTier } from '../../src/cost.js';
import { nameRegex, privacyRe } from './build.mjs';

export const workDir = () => process.env.SPRAG_EVALS_WORK || new URL('../../handoff/evals-work/', import.meta.url).pathname;
export const sha10 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
export const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
export const projectSlug = (abs) => abs.replace(/[^A-Za-z0-9]/g, '-');
export const claudeProjects = () => join(homedir(), '.claude', 'projects');
/**
 * Python's round(x, nd): decided on the exact binary value, and an exact tie goes to the even digit
 * (round(2.5) is 2, round(0.25, 1) is 0.2). Math.round and toFixed differ on those ties, and the first
 * public data was rounded by Python, so a republished case would otherwise drift by a digit.
 */
export function pyRound(x, nd = 0) {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e15) return x;
  const [ip, fp] = Math.abs(x).toFixed(100).split('.');
  const rest = fp.slice(nd);
  let n = BigInt(ip + fp.slice(0, nd));
  const tie = /^50*$/.test(rest);
  if (rest[0] > '5' || (rest[0] === '5' && (!tie || n % 2n === 1n))) n += 1n;
  const out = Number(`${n}e-${nd}`);
  return x < 0 && out !== 0 ? -out : out;
}
/** True when the module at `metaUrl` is the script node was started with. Never passed to a child. */
export const isMain = (metaUrl) => Boolean(process.argv[1]) && fileURLToPath(metaUrl) === process.argv[1];
/** Public runs name the model family only (haiku/sonnet/opus). Unknown families must not be published by guess. */
export function shortModel(model) {
  const m = String(model || '').toLowerCase().match(/haiku|sonnet|opus/);
  if (!m) throw new Error(`cannot map model "${model}" to haiku/sonnet/opus`);
  return m[0];
}
/** Per-million rates for a model id (full id, dated id or alias) on a date or timestamp. */
export function ratesFor(model, at) {
  const rates = ratesAt(detectPricingTier(model, { at }), at);
  if (!rates) throw new Error(`no price for model "${model}"`);
  return rates;
}
/** A case may override the agent of one condition (round 2 ran case 404 lane A as t2-runner). */
export const agentFor = (caseObj, cond) => caseObj?.agents?.[cond.key] ?? cond.agent;
export function cleanEnv(env = process.env) {
  const e = { ...env };
  delete e.ANTHROPIC_API_KEY;
  delete e.ANTHROPIC_AUTH_TOKEN;
  return e;
}

// Ported from scripts/mask-transcript-secrets.py
const SECRET_PATTERNS = [
  [/npm_[A-Za-z0-9]{30,}/g, 'npm_***REDACTED***'],
  [/github_pat_[A-Za-z0-9_]{40,}/g, 'github_pat_***REDACTED***'],
  [/ghp_[A-Za-z0-9]{30,}/g, 'ghp_***REDACTED***'],
  [/sk-ant-[A-Za-z0-9\-_]{40,}/g, 'sk-ant-***REDACTED***'],
  [/sk-proj-[A-Za-z0-9\-_]{40,}/g, 'sk-proj-***REDACTED***'],
  [/AKIA[0-9A-Z]{16}/g, 'AKIA***REDACTED***'],
  [/xox[bpasr]-[0-9A-Za-z-]{20,}/g, 'xoxb-***REDACTED***'],
  [/AIza[0-9A-Za-z\-_]{35}/g, 'AIza***REDACTED***'],
  [/1\/\/[0-9A-Za-z\-_]{40,}/g, '1//***REDACTED***'],
];
export function maskSecrets(text) {
  let t = String(text ?? '');
  for (const [rx, rep] of SECRET_PATTERNS) t = t.replace(rx, rep);
  return t;
}

// Ported from build_public.py
const PATH_RULES = [
  [/\/Users\/[^/\s]+\/projects\/sprag-team/g, '<server repo>'],
  [/\/private\/tmp\/claude-\d+\/[^\s)`"'\]>,;]*/g, '<scratch>/…'],
  [/\/Users\/[^/\s]+\/projects\/sprag(?=\/|\b)/g, '<repo>'],
  [/\/Users\/[^/\s]+\/[^\s)`"'\]>,;]*/g, '~/…'],
  [/\/Users\/[^/\s]+/g, '~'],
];
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
export function scrub(text) {
  let t = String(text ?? '');
  for (const [rx, rep] of PATH_RULES) t = t.replace(rx, rep);
  // Private names come from the machine, never from this file: see privateNames() in build.mjs.
  const names = nameRegex();
  if (names) t = t.replace(names, '');
  return t.replaceAll('sprag-team', '<server repo>').replace(EMAIL_RE, '<email>');
}
/** Returns the first field path whose string value matches the privacy regex, or null. */
export function findPrivacyHit(obj, path = '', re = privacyRe()) {
  if (typeof obj === 'string') return re.test(obj) ? { path, match: obj.match(re)[0] } : null;
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const h = findPrivacyHit(v, Array.isArray(obj) ? `${path}[${k}]` : path ? `${path}.${k}` : k, re);
      if (h) return h;
    }
  }
  return null;
}

/** Deep-scrub every string in a value (objects and arrays are copied, key order kept). */
export function scrubDeep(v) {
  if (typeof v === 'string') return scrub(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)]));
  return v;
}
/** Reports are plain text, or {"message": "..."} JSON from older rounds. Secrets masked, paths scrubbed, trimmed. */
export function readReport(path) {
  let raw = readFileSync(path, 'utf8');
  const s = raw.trim();
  if (s.startsWith('{')) {
    try { const o = JSON.parse(s); if (o && typeof o === 'object') raw = o.message || o.report || o.text || raw; } catch { /* plain text */ }
  }
  return scrub(maskSecrets(raw)).trim();
}

// Limits count code points, as the Python builder did (a UTF-16 slice would cut emoji differently).
const cpLen = (t) => [...t].length;
const cpSlice = (t, n) => [...t].slice(0, n).join('');
export function excerptOf(text, limit = 700) {
  if (cpLen(text) <= limit) return text;
  let cut = cpSlice(text, limit);
  for (const sep of ['\n', '. ', '다. ', '다.\n']) {
    const i = cut.lastIndexOf(sep);
    if (i >= 0 && cpLen(cut.slice(0, i)) >= limit * 0.6) { cut = cut.slice(0, i + (sep === '\n' ? 0 : sep.trimEnd().length)); break; }
  }
  return cut.trimEnd() + ' …';
}
export function capped(text, cap = 8000) {
  return cpLen(text) <= cap ? [text, false] : [cpSlice(text, cap).trimEnd() + '\n…', true];
}

// ---- transcripts ----
export const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
export const tokensOf = (t) => (t.input || 0) + (t.cacheCreation || 0) + (t.cacheRead || 0) + (t.output || 0);
const emptyTotals = () => ({ input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 });
function addUsage(t, u) {
  const cc = u.cache_creation_input_tokens || 0;
  const e5 = u.cache_creation?.ephemeral_5m_input_tokens || 0;
  const e1 = u.cache_creation?.ephemeral_1h_input_tokens || 0;
  t.input += u.input_tokens || 0; t.output += u.output_tokens || 0;
  t.cacheRead += u.cache_read_input_tokens || 0; t.cacheCreation += cc;
  t.ephemeral5m += e5 || e1 ? e5 : cc; t.ephemeral1h += e1;
}
export function exactUsd(t, rates) {
  const w5 = t.ephemeral5m || 0, w1 = t.ephemeral1h || 0;
  const untracked = Math.max(0, (t.cacheCreation || 0) - w5 - w1);
  return (t.input * rates.input + (w5 + untracked) * rates.cacheWrite5m + w1 * rates.cacheWrite1h + t.cacheRead * rates.cacheRead + t.output * rates.output) / 1e6;
}
/** Last usage per message.id, summed. Returns {model, totals, usd, ms, calls, startedAt}. */
export function costOfTranscript(entries, modelHint) {
  const last = new Map(); const seenTools = new Set();
  let t0 = null, t1 = null, model = modelHint || null, calls = 0;
  for (const o of entries) {
    if (o.timestamp) { t0 ??= o.timestamp; t1 = o.timestamp; }
    if (o.type !== 'assistant' || !o.message?.usage) continue;
    last.set(o.message.id, o.message.usage);
    model = o.message.model || model;
    for (const b of o.message.content || []) if (b.type === 'tool_use' && !seenTools.has(b.id)) { seenTools.add(b.id); calls++; }
  }
  const totals = emptyTotals();
  for (const u of last.values()) addUsage(totals, u);
  const rates = ratesFor(model, (t0 || new Date().toISOString()).slice(0, 10));
  return { model, totals, usd: pyRound(exactUsd(totals, rates), 2), exactUsd: exactUsd(totals, rates), ms: Date.parse(t1) - Date.parse(t0), calls, startedAt: t0 };
}
/** Counts WebSearch results, split by the budget-exhausted message (as check_blocked.py). */
export function countWebSearches(entries) {
  const ids = new Set(); let ok = 0, blocked = 0;
  for (const o of entries) for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
    if (b.type === 'tool_use' && b.name === 'WebSearch') ids.add(b.id);
    if (b.type === 'tool_result' && ids.has(b.tool_use_id)) {
      const s = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
      if (s.includes('Web search was not performed')) blocked++; else ok++;
    }
  }
  return { ws_ok: ok, ws_blocked: blocked };
}

// ---- trace (port of build_trace) ----
const SECRET_LABEL = /[A-Za-z0-9+_]{20,}|[0-9a-fA-F]{20,}|password|token|secret|key=|Bearer/i;
const TMP_RE = /(?:\/private)?\/tmp\/|<scratch>\/…/g;
const repoRel = (t) => scrub(t).replace(TMP_RE, 'tmp/').replaceAll('<repo>/', '');
export function labelFor(name, inp = {}) {
  let arg = '';
  if (name === 'WebSearch') arg = String(inp.query || '');
  else if (name === 'WebFetch') { const m = String(inp.url || '').match(/^(?:https?:\/\/)?([^/?#\s]+)([^?#\s]*)/); arg = m ? m[1] + m[2] : ''; }
  else if (['Read', 'Grep', 'Glob'].includes(name)) arg = repoRel(String(inp.file_path || inp.pattern || inp.path || ''));
  else if (name === 'Bash') {
    let cmd = scrub(String(inp.command || '')).replace(TMP_RE, 'tmp/');
    for (;;) {
      const n = cmd.replace(/^\s*cd\s+[^&;]+(?:&&|;)\s*/, '').replace(/^\s*[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s;]*)\s*;?\s*/, '');
      if (n === cmd) break; cmd = n;
    }
    arg = cmd.split(/\s+/).join(' ').replace(/\?[^\s"']*/g, '').slice(0, 40);
  }
  arg = scrub(arg.split(/\s+/).join(' ').trim());
  if (SECRET_LABEL.test(arg)) return '(hidden)';
  return arg.length > 60 ? arg.slice(0, 59).trimEnd() + '…' : arg;
}
export function buildTrace(entries, model, runUsd, cap = 80) {
  const asst = entries.filter((o) => o.type === 'assistant' && o.message);
  const origin = Date.parse(entries.find((o) => o.timestamp)?.timestamp) / 1000; // epoch seconds as doubles, like the Python builder
  const rates = ratesFor(model, (entries.find((o) => o.timestamp)?.timestamp || '').slice(0, 10));
  const lastUsage = new Map(), order = [], raw = [], seen = new Set();
  for (const o of asst) {
    const m = o.message;
    if (!lastUsage.has(m.id)) order.push(m.id);
    lastUsage.set(m.id, m.usage || {});
    for (const b of m.content || []) {
      if (b.type === 'tool_use') { if (seen.has(b.id)) continue; seen.add(b.id); }
      raw.push([Date.parse(o.timestamp) / 1000 - origin, m.id, b]);
    }
  }
  if (!raw.length) throw new Error('no assistant events');
  const run = emptyTotals(), cum = new Map();
  for (const id of order) { addUsage(run, lastUsage.get(id)); cum.set(id, [tokensOf(run), exactUsd(run, rates)]); }
  let events = [];
  for (const [t, id, b] of raw) {
    const kind = { tool_use: 'tool', thinking: 'think', text: 'text' }[b.type];
    if (!kind) continue;
    const [tok, usd] = cum.get(id);
    const ev = { t: pyRound(t, 1), kind };
    if (kind === 'tool') { ev.tool = b.name || ''; ev.arg = labelFor(b.name, b.input); }
    events.push({ ...ev, tok, usd: pyRound(usd, 4) });
  }
  if (Math.abs(events.at(-1).usd - runUsd) > 0.01 * runUsd) throw new Error(`trace cost ${events.at(-1).usd} differs from run cost ${runUsd}`);
  if (events.length > cap) events = events.filter((e) => e.kind !== 'think');
  if (events.length > cap) {
    const step = (events.length - 1) / (cap - 1);
    events = [...new Set(Array.from({ length: cap }, (_, k) => pyRound(k * step)))].sort((a, b) => a - b).map((i) => events[i]);
  }
  if (Math.abs(events.at(-1).usd - runUsd) > 0.01 * runUsd) throw new Error('capped trace lost its last event');
  return events;
}

// ---- rounds ----
export function validateRound(r) {
  const errs = [];
  const need = (c, m) => { if (!c) errs.push(m); };
  need(r && typeof r === 'object', 'round.json must be an object');
  if (errs.length) return errs;
  need(/^[\w-]+$/.test(r.id || ''), 'id must be a non-empty slug');
  need(/^\d{4}-\d{2}-\d{2}$/.test(r.date || ''), 'date must be YYYY-MM-DD');
  need(['conditions', 'effort'].includes(r.kind), 'kind must be "conditions" or "effort"');
  need(typeof r.repo === 'string' && r.repo.startsWith('/'), 'repo must be an absolute path');
  need(/^[0-9a-f]{7,40}$/.test(r.commit || ''), 'commit must be a hex sha');
  need(Number.isInteger(r.repeats ?? 1) && (r.repeats ?? 1) >= 1, 'repeats must be an integer >= 1');
  need(Array.isArray(r.conditions) && r.conditions.length > 0, 'conditions must be a non-empty array');
  const keys = new Set();
  for (const c of r.conditions || []) {
    need(/^[A-Z]$/.test(c.key || ''), `condition key must be one letter: ${c.key}`);
    need(!keys.has(c.key), `duplicate condition key ${c.key}`); keys.add(c.key);
    need(c.id && c.model && c.effort, `condition ${c.key} needs id, model, effort`);
    need(['original', 'improved'].includes(c.prompt), `condition ${c.key} prompt must be original or improved`);
  }
  need(Array.isArray(r.cases) && r.cases.length > 0, 'cases must be a non-empty array');
  for (const c of r.cases || []) {
    need(c.id && c.prompt && c.rubric, `case ${c.id} needs id, prompt, rubric`);
    if ((r.conditions || []).some((x) => x.prompt === 'improved')) need(c.improvedPrompt, `case ${c.id} needs improvedPrompt`);
    need(c.write === undefined || typeof c.write === 'boolean', `case ${c.id}: write must be a boolean`);
    need(c.agents === undefined || (c.agents && typeof c.agents === 'object' && !Array.isArray(c.agents)
      && Object.keys(c.agents).every((k) => keys.has(k))), `case ${c.id}: agents must map condition keys to agent names`);
  }
  need(r.allowedTools === undefined || (Array.isArray(r.allowedTools) && r.allowedTools.every((t) => typeof t === 'string')), 'allowedTools must be an array of strings');
  const baselines = (r.conditions || []).filter((c) => c.role === 'baseline').length;
  if (r.kind === 'effort') need(baselines <= 1, 'at most one condition may have role "baseline"');
  else need(baselines === 1, 'exactly one condition needs role "baseline"');
  if (r.kind === 'effort') need((r.repeats ?? 1) > 1, 'an effort round needs repeats > 1');
  return errs;
}

// ---- blind grading ----
export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Deterministic shuffle of run keys; labels P, Q, R, ... (wrapping A.. after Z, so up to 26 runs). */
export function blindOrder(roundId, caseId, runKeys) {
  const rnd = mulberry32(parseInt(createHash('sha1').update(`${roundId}:${caseId}`).digest('hex').slice(0, 8), 16));
  const a = [...runKeys].sort();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.length > 26) throw new Error(`cannot blind ${a.length} runs of one case (26 labels)`);
  return Object.fromEntries(a.map((k, i) => [String.fromCharCode(65 + ((15 + i) % 26)), k]));
}
const MODEL_LINE = /\b(haiku|sonnet|opus|claude-[a-z]+-\d|effort\s+(low|medium|high|xhigh)|t[12]h?-(explore|runner|worker))\b/i;
export const stripModelLines = (t) => t.split('\n').filter((l) => !MODEL_LINE.test(l)).join('\n');
export function extractJsonObject(text) {
  const s = String(text);
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    let depth = 0, inStr = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(i, j + 1)); } catch { break; } }
    }
  }
  return null;
}
/** Makes total the sum of items, because a grader's own addition is the usual slip. Returns a new object. */
export function normalizeGrades(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(Object.entries(obj).map(([l, g]) => [l,
    g && Array.isArray(g.items) && g.items.every((x) => typeof x === 'number') ? { ...g, total: g.items.reduce((a, b) => a + b, 0) } : g]));
}
export function validateGrades(obj, labels) {
  const errs = [];
  for (const l of labels) {
    const g = obj?.[l];
    if (!g) { errs.push(`missing label ${l}`); continue; }
    if (!Array.isArray(g.items) || !g.items.length || !g.items.every((x) => typeof x === 'number') || typeof g.total !== 'number' || typeof g.max !== 'number') errs.push(`${l}: items/total/max invalid`);
    else if (g.total > g.max || g.items.some((x) => x < 0)) errs.push(`${l}: total ${g.total} exceeds max ${g.max} or an item is negative`);
    if (!['예', '부분', '아니오'].includes(g.relay)) errs.push(`${l}: relay invalid`);
    if (typeof g.key_miss !== 'string') errs.push(`${l}: key_miss invalid`);
  }
  return errs;
}
export const VERDICT = { 예: 'ok', 부분: 'partial', 아니오: 'fail' };
