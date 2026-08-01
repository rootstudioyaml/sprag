/**
 * compact-window — auto-compact window audit for 1M-context sessions.
 *
 * Claude Code compacts when context usage approaches
 * `min(settings.autoCompactWindow, model max context)`. On a 1M window the
 * default lets a session grow past 800k before compaction ever fires, so every
 * later request re-bills a context most sessions never needed. Pinning
 * `autoCompactWindow` somewhere in 400k–700k keeps 2–3.5x the headroom of a
 * 200k session for the genuinely large ones while capping the runaway tail.
 *
 * The recommendation is a range, not a number: 400k is the floor where the
 * saving is worth the extra compactions, and in practice long sessions often
 * want more room than that. Anything at or below 700k is left alone — only an
 * unset window, or one above 700k, is a real config defect.
 *
 * 200k sessions are exempt by design: their window is already <= 200k, so the
 * setting changes nothing and a warning would be pure noise.
 *
 * Sources, highest precedence first (mirrors Claude Code's own resolution):
 *   1. env CLAUDE_CODE_AUTO_COMPACT_WINDOW  ("200000" | "200k" | "200")
 *   2. <root>/.claude/settings.local.json
 *   3. <root>/.claude/settings.json
 *   4. ~/.claude/settings.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { debug } from './debug.js';

// Claude Code clamps autoCompactWindow to [100k, 1M] (settings schema:
// `.int().min(1e5).max(1e6)`), so anything outside that range is not a value
// the app would honor.
export const MIN_WINDOW = 100_000;
export const MAX_WINDOW = 1_000_000;
// Recommended band. Warn only outside it on the high side (or when unset) —
// a window below RECOMMENDED_MIN is a deliberate, more aggressive choice and
// costs nothing, so it stays silent.
export const RECOMMENDED_MIN = 400_000;
export const RECOMMENDED_MAX = 700_000;
// What `compact-window set` writes when no --value is given: middle of the band.
export const RECOMMENDED_WINDOW = 500_000;

// A model id whose context is the 1M variant. Claude Code spells it as a
// suffix on the model id (`claude-opus-5[1m]`); the beta header form
// (`context-1m`) shows up in SDK/env configs.
const ONE_M_RE = /\[1m\]|context-1m|1m-context/i;

export function userSettingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

export function projectSettingsPaths(root) {
  return [
    join(root, '.claude', 'settings.local.json'),
    join(root, '.claude', 'settings.json'),
  ];
}

function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    debug('compact-window:read', e);
    return null; // malformed settings — treat as "nothing configured"
  }
}

/**
 * Parse the value forms Claude Code accepts for a window size: a plain token
 * count, a `200k`/`1M` shorthand, or the bare-hundreds shorthand (`200` = 200k)
 * its /config parser documents. Returns null when unparseable.
 */
export function parseWindow(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([km]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === 'k') return Math.round(n * 1_000);
  if (m[2] === 'm') return Math.round(n * 1_000_000);
  // Bare number: below the legal minimum it can only be the `200` = 200k form.
  return n < MIN_WINDOW ? Math.round(n * 1_000) : Math.round(n);
}

/**
 * The model id this project would launch with. Same precedence as the settings
 * lookup, with ANTHROPIC_MODEL on top (Claude Code reads it as an override).
 */
export function resolveModelId(root) {
  if (process.env.ANTHROPIC_MODEL) return { model: process.env.ANTHROPIC_MODEL, source: 'env' };
  for (const p of projectSettingsPaths(root)) {
    const j = readJson(p);
    if (j && typeof j.model === 'string') return { model: j.model, source: 'project', path: p };
  }
  const g = readJson(userSettingsPath());
  if (g && typeof g.model === 'string') return { model: g.model, source: 'global', path: userSettingsPath() };
  return { model: null, source: null };
}

export function isOneMillionModel(model) {
  return typeof model === 'string' && ONE_M_RE.test(model);
}

/** Effective autoCompactWindow, with the source that won. */
export function effectiveWindow(root) {
  const env = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  if (env) {
    const v = parseWindow(env);
    if (v !== null) return { value: v, source: 'env' };
  }
  for (const p of projectSettingsPaths(root)) {
    const j = readJson(p);
    const v = j ? parseWindow(j.autoCompactWindow) : null;
    if (v !== null) return { value: v, source: 'project', path: p };
  }
  const gp = userSettingsPath();
  const g = readJson(gp);
  const gv = g ? parseWindow(g.autoCompactWindow) : null;
  if (gv !== null) return { value: gv, source: 'global', path: gp };
  return { value: null, source: null };
}

/**
 * Full audit result. `ok` is true when there is nothing to warn about — either
 * the session is not on a 1M model (exempt), or the window is already pinned at
 * or below the top of the recommended band (700k).
 *
 * `reason` names why it is not ok: 'unset' (no autoCompactWindow anywhere) or
 * 'too-large' (set, but above 700k — still lets context run away).
 */
export function compactWindowStatus({ root = process.cwd() } = {}) {
  const { model, source: modelSource } = resolveModelId(root);
  const is1m = isOneMillionModel(model);
  const win = effectiveWindow(root);
  const base = {
    model,
    modelSource,
    is1m,
    window: win.value,
    windowSource: win.source,
    windowPath: win.path || null,
    recommended: RECOMMENDED_WINDOW,
    recommendedMin: RECOMMENDED_MIN,
    recommendedMax: RECOMMENDED_MAX,
  };
  if (!is1m) return { ...base, ok: true, reason: 'not-1m' };
  if (win.value === null) return { ...base, ok: false, reason: 'unset' };
  if (win.value > RECOMMENDED_MAX) return { ...base, ok: false, reason: 'too-large' };
  return { ...base, ok: true, reason: 'configured' };
}

/**
 * Statusline chip text, or null when there is nothing to say. Kept to the same
 * short shape as the other 🅷⚠ warnings so the line stays single-width.
 */
export function compactWindowWarningForStatusline(root = process.cwd(), cfg = null) {
  if (cfg && cfg.compactWindow && cfg.compactWindow.enabled === false) return null;
  try {
    const s = compactWindowStatus({ root });
    return s.ok ? null : 'compact-window?';
  } catch (e) {
    debug('compact-window:statusline', e);
    return null;
  }
}

/**
 * Write `autoCompactWindow` into a settings.json, preserving every other key.
 * Scope 'global' → ~/.claude/settings.json, 'project' → <root>/.claude/settings.json.
 * A `.bak` is written first whenever the file already exists.
 *
 * Returns { path, scope, value, previous, backup }.
 */
export function setAutoCompactWindow({ root = process.cwd(), scope = 'global', value = RECOMMENDED_WINDOW } = {}) {
  const v = parseWindow(value);
  if (v === null || v < MIN_WINDOW || v > MAX_WINDOW) {
    return { ok: false, error: `Invalid window: ${value} (expected ${MIN_WINDOW}–${MAX_WINDOW} tokens, e.g. 400000 or 400k)` };
  }
  const path = scope === 'global' ? userSettingsPath() : join(root, '.claude', 'settings.json');
  let json = {};
  let backup = null;
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8');
    try {
      json = JSON.parse(raw);
    } catch (e) {
      debug('compact-window:parse', e);
      // Refuse to overwrite a file we cannot parse — silently replacing a
      // malformed settings.json would drop every other setting in it.
      return { ok: false, error: `${path} is not valid JSON — fix it first (nothing was written).` };
    }
    backup = `${path}.bak`;
    writeFileSync(backup, raw);
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }
  const previous = parseWindow(json.autoCompactWindow);
  json.autoCompactWindow = v;
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  return { ok: true, path, scope, value: v, previous, backup };
}
