/**
 * presets-source — which presets this machine uses: the centrally published
 * bundle or the copy shipped in the npm package.
 *
 * The superuser publishes ratchet presets, model-routing presets and the
 * delegation agent definitions from the /ops console as one signed bundle.
 * preset-sync.js fetches it (read-only, at most daily, in a detached child) into
 * <userDataDir>/presets-remote.json. Everything that reads presets comes through
 * here, so a newer bundle takes effect at the next session start after a fetch.
 *
 * The remote bundle wins only while it is valid, checked again on every read:
 * its signature verifies against a key in PRESET_SIGNING_KEYS, its format is
 * one this CLI understands, its min_cli is not newer than this CLI, its shape is
 * right and it is at most 200 KB. Anything else falls back to the bundled
 * presets in presets/*.json, which have the same shape. So a blocked network, a
 * server outage or a tampered response leaves the machine exactly where a fresh
 * install of this version would be.
 *
 * SPRAG_NO_PRESET_SYNC=1 (or SPRAG_NO_UPDATE_CHECK=1) turns the remote source
 * off entirely: no fetch, and a cached bundle is ignored.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { envVar } from './env.js';
import { userDataDir } from './paths.js';
import {
  PRESET_BUNDLE_FORMAT, PRESET_MAX_BYTES, PRESET_SIGNING_KEYS, verifyBundleSignature,
} from './preset-sign.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function cliVersion() {
  try { return require('../package.json').version; } catch { return '0.0.0'; }
}

export function presetSyncDisabled(env = process.env) {
  return envVar('NO_PRESET_SYNC', env) === '1' || envVar('NO_UPDATE_CHECK', env) === '1';
}

export function remoteCachePath(dir = userDataDir()) { return join(dir, 'presets-remote.json'); }

/** -1, 0 or 1. Pre-release suffixes are ignored; unparsable versions compare as 0.0.0. */
export function compareVersions(a, b) {
  const p = (v) => (String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/) || [0, 0, 0, 0]).slice(1, 4).map(Number);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MODEL_RE = /^[A-Za-z0-9._-]{1,80}$/;
const LINE_RE = /^[^\r\n]{1,600}$/;
const TOOL_RE = /^[A-Za-z0-9_*().: -]{1,80}$/;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const TIERS = ['T1', 'T2', 'T1H'];
const str = (v) => typeof v === 'string' && v.trim() !== '';

function uniq(list, key) {
  const seen = new Set();
  for (const x of list) { if (seen.has(x[key])) return false; seen.add(x[key]); }
  return true;
}

/**
 * Shape check for a bundle. Returns null when valid, else a short reason code.
 * Rejected here rather than when rendering: an agent name with a slash would be
 * a path outside ~/.claude/agents, and a newline in a frontmatter field would
 * let the description write its own `tools:` line.
 */
export function bundleShapeError(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'shape';
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(b), 'utf8'); } catch { return 'shape'; }
  if (bytes > PRESET_MAX_BYTES) return 'too-large';
  if (!Number.isInteger(b.format) || b.format < 1) return 'shape';
  if (b.format > PRESET_BUNDLE_FORMAT) return 'format';
  if (!Number.isInteger(b.version) || b.version < 1) return 'shape';
  if (b.min_cli != null && typeof b.min_cli !== 'string') return 'shape';
  const { ratchet_rules: rr, model_rules: mr, agents: ag } = b;
  if (!Array.isArray(rr) || !Array.isArray(mr) || !Array.isArray(ag)) return 'shape';
  for (const r of rr) {
    if (!r || !ID_RE.test(r.id) || !str(r.ko) || !str(r.en)) return 'shape';
    if (r.agents != null && (!Array.isArray(r.agents) || r.agents.some((a) => a !== 'claude' && a !== 'codex'))) return 'shape';
  }
  for (const m of mr) {
    if (!m || !ID_RE.test(m.id) || !TIERS.includes(m.tier) || !ID_RE.test(m.category)) return 'shape';
    if (!str(m.label) || !str(m.labelEn) || !str(m.agent) || !LINE_RE.test(m.agent)) return 'shape';
    if (m.budget != null && (typeof m.budget !== 'object' || Array.isArray(m.budget))) return 'shape';
  }
  for (const a of ag) {
    if (!a || !NAME_RE.test(a.name) || !MODEL_RE.test(a.model) || !EFFORTS.includes(a.effort)) return 'shape';
    if (!Array.isArray(a.tools) || a.tools.length === 0 || a.tools.some((t) => typeof t !== 'string' || !TOOL_RE.test(t))) return 'shape';
    if (!a.description || !LINE_RE.test(a.description.en || '') || (a.description.ko != null && !LINE_RE.test(a.description.ko))) return 'shape';
    if (!a.body || !str(a.body.en)) return 'shape';
  }
  if (!uniq(rr, 'id') || !uniq(mr, 'id') || !uniq(ag, 'name')) return 'shape';
  return null;
}

/**
 * Whether this CLI may apply a bundle. { ok, reason?, kid? } with reason one of
 * shape, too-large, format, min-cli, no-keys, unsigned, unknown-kid, bad-sig.
 * No keys is checked before the signature: it is the more basic answer.
 */
export function evaluateBundle(b, { version = cliVersion(), keys = PRESET_SIGNING_KEYS } = {}) {
  const shape = bundleShapeError(b);
  if (shape) return { ok: false, reason: shape };
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, reason: 'no-keys' };
  if (b.min_cli && compareVersions(b.min_cli, version) > 0) return { ok: false, reason: 'min-cli' };
  const sig = verifyBundleSignature(b, keys);
  return sig.ok ? { ok: true, kid: sig.kid } : { ok: false, reason: sig.reason };
}

export function readRemoteCache(dir = userDataDir()) {
  try {
    const c = JSON.parse(readFileSync(remoteCachePath(dir), 'utf8'));
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  } catch {
    return {};
  }
}

// One evaluation per cache-file revision: the session-start path reads the
// presets several times (seed offer, preset file, agents, route-scan).
let memo = null;
export function resetPresetSourceMemo() { memo = null; }

function activeRemote({ env = process.env, dir = userDataDir(), keys = PRESET_SIGNING_KEYS, version = cliVersion() } = {}) {
  if (presetSyncDisabled(env)) return { bundle: null, reason: 'disabled', cache: {} };
  const file = remoteCachePath(dir);
  let sig;
  try { const s = statSync(file); sig = `${file}|${s.mtimeMs}|${s.size}|${keys.length}|${version}`; } catch { return { bundle: null, reason: 'no-cache', cache: {} }; }
  if (memo && memo.sig === sig && memo.keys === keys) return memo.value;
  const cache = readRemoteCache(dir);
  let value;
  if (!cache.bundle) value = { bundle: null, reason: 'no-cache', cache };
  else {
    const ev = evaluateBundle(cache.bundle, { version, keys });
    value = ev.ok ? { bundle: cache.bundle, kid: ev.kid, cache } : { bundle: null, reason: ev.reason, cache };
  }
  memo = { sig, keys, value };
  return value;
}

/** { kind: 'remote'|'bundled', version, fetchedAt, kid?, reason? } */
export function presetSource(opts = {}) {
  const r = activeRemote(opts);
  if (r.bundle) return { kind: 'remote', version: r.bundle.version, fetchedAt: r.cache.fetchedAt || null, kid: r.kid };
  return { kind: 'bundled', version: null, fetchedAt: r.cache.fetchedAt || null, reason: r.reason };
}

function readBundled(name) {
  try { return JSON.parse(readFileSync(join(packageRoot, 'presets', name), 'utf8')); } catch { return null; }
}

const derivedId = (ko) => `fix-${createHash('sha1').update(ko).digest('hex').slice(0, 6)}`;

function normaliseRatchet(list) {
  return (Array.isArray(list) ? list : [])
    .filter((r) => r && typeof r.ko === 'string' && r.ko.trim())
    .map((r) => ({
      // Explicit ids are stable across rewording. A rule without one (an older
      // file) gets the id the Korean text always produced.
      id: typeof r.id === 'string' && r.id ? r.id : derivedId(r.ko.trim()),
      ko: r.ko.trim(), en: (r.en || r.ko).trim(),
      ...(Array.isArray(r.agents) ? { agents: r.agents.filter((a) => typeof a === 'string') } : {}),
    }));
}

/** Ratchet presets: [{ id, ko, en, agents? }] */
export function ratchetPresetEntries(opts = {}) {
  const r = activeRemote(opts);
  if (r.bundle) return normaliseRatchet(r.bundle.ratchet_rules);
  return normaliseRatchet(readBundled('ratchet-rules.json')?.rules);
}

/** Model-routing presets, the objects of presets/model-rules.json `presets`. */
export function modelPresets(opts = {}) {
  const r = activeRemote(opts);
  if (r.bundle) return r.bundle.model_rules.map((p) => ({ ...p }));
  const data = readBundled('model-rules.json');
  return Array.isArray(data?.presets) ? data.presets : [];
}

/** Delegation agents: [{ name, model, effort, tools[], description{ko,en}, body{ko,en} }] */
export function agentDefinitions(opts = {}) {
  const r = activeRemote(opts);
  if (r.bundle) return r.bundle.agents.map((a) => ({ ...a }));
  const data = readBundled('agents.json');
  return Array.isArray(data?.agents) ? data.agents : [];
}

/** The bundle the bundled files make: the shape the server seeds as version 1. */
export function bundledBundle({ version = 1, minCli = null } = {}) {
  return {
    format: PRESET_BUNDLE_FORMAT,
    version,
    min_cli: minCli,
    ratchet_rules: normaliseRatchet(readBundled('ratchet-rules.json')?.rules),
    model_rules: readBundled('model-rules.json')?.presets || [],
    agents: readBundled('agents.json')?.agents || [],
  };
}
