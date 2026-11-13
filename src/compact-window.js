/**
 * compact-window — auto-compact window audit for 1M-context sessions.
 *
 * Claude Code compacts when context usage approaches
 * `min(settings.autoCompactWindow, model max context)`. A model with a native
 * 1M window compacts at about 967k by default, so every request until then
 * re-bills a context most sessions never needed. Pinning
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
 * Within each settings file, `modelSettings[<canonical id>].autoCompactWindow`
 * (what `/autocompact` writes since Claude Code 2.1.288; `"auto"` means the
 * model default) beats the top-level `autoCompactWindow` for that model.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { debug } from './debug.js';
import { writePrivateFile } from './private-file.js';
import { isNewer } from './update-check.js';
import { parseJsonText } from './json-text.js';

// First Claude Code release that reads `modelSettings[<model>].autoCompactWindow`.
// An older one ignores the entry, so a per-model `set` would silently do nothing.
export const MODEL_SETTINGS_MIN_VERSION = '2.1.288';

/** Installed Claude Code version (`2.1.302`), or null when it cannot be read. */
export function claudeCodeVersion({ run = () => execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }) } = {}) {
  try {
    const m = String(run()).match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch (e) {
    // claude missing from a hook's PATH is normal there, not worth a log line.
    if (e?.code !== 'ENOENT') debug('compact-window:claude-version', e);
    return null;
  }
}

/** true / false against MODEL_SETTINGS_MIN_VERSION, or null when the version is unknown. */
export function modelSettingsSupported(version) {
  if (!version) return null;
  return version === MODEL_SETTINGS_MIN_VERSION || isNewer(version, MODEL_SETTINGS_MIN_VERSION);
}

/**
 * One line telling the user whether a per-model value will be used by their
 * Claude Code. Shown wherever `--model` is offered or written.
 */
export function modelSettingsNotice(version, ko) {
  const min = MODEL_SETTINGS_MIN_VERSION;
  const ok = modelSettingsSupported(version);
  if (ok === null) {
    return ko
      ? `모델별 값(--model)은 Claude Code ${min} 이상에서만 적용됩니다. 설치된 버전을 확인하지 못했습니다(claude --version).`
      : `A per-model value (--model) is only used by Claude Code ${min} or later. The installed version could not be read (claude --version).`;
  }
  if (ok) {
    return ko
      ? `모델별 값(--model)은 Claude Code ${min} 이상에서만 적용됩니다. 설치된 버전(${version})에서는 적용됩니다.`
      : `A per-model value (--model) is only used by Claude Code ${min} or later. You have ${version}, so it applies.`;
  }
  return ko
    ? `모델별 값(--model)은 Claude Code ${min} 이상에서만 적용됩니다. 설치된 버전(${version})에서는 적용되지 않습니다. Claude Code를 업데이트하거나 --all-models를 쓰세요.`
    : `A per-model value (--model) is only used by Claude Code ${min} or later. You have ${version}, so it is ignored. Update Claude Code or use --all-models.`;
}

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
    return parseJsonText(readFileSync(path, 'utf8'));
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
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    // Same bare-hundreds rule as the string form: `200` and `"200"` are one
    // intent and must audit the same way.
    const n = Math.round(raw);
    return n < MIN_WINDOW ? n * 1_000 : n;
  }
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

// A window Claude Code itself reported for the session (statusline payload).
// Anything this large can only be the 1M window.
export const LIVE_1M_MIN = 900_000;

/**
 * The canonical model name Claude Code keys `modelSettings` by. It matches a
 * model's alias, date-suffixed, `[1m]`, Bedrock and Vertex spellings to the
 * same entry, so every one of those spellings has to fold to one id here.
 */
export function canonicalModelId(model) {
  if (typeof model !== 'string') return null;
  let s = model.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/\[1m\]$/, '');
  const slash = s.lastIndexOf('/');
  if (slash !== -1) s = s.slice(slash + 1); // litellm / bedrock route prefixes
  s = s.replace(/^(?:[a-z0-9-]+\.)*anthropic\./, ''); // us.anthropic., global.anthropic., anthropic.
  s = s.replace(/-v\d+:\d+$/, ''); // Bedrock version suffix
  s = s.replace(/@\d{8}$/, ''); // Vertex date suffix
  s = s.replace(/-\d{8}$/, ''); // dated snapshot
  return s || null;
}

const ALIAS_RE = /^(opus|sonnet|haiku|fable|mythos)$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The `modelSettings` entry that applies to `model` in one settings file, as
 * `{ key, settings }`, or null.
 *
 * Only an exact match counts. A bare alias such as `opus` is never resolved
 * here: which version it means lives inside Claude Code, and picking the
 * highest-versioned key in the file is wrong whenever the file only holds an
 * older model's entry. Callers pass the live model id from the statusline
 * payload instead, and without one the per-model entries are skipped.
 */
export function modelSettingsEntry(json, model) {
  const ms = json && json.modelSettings;
  if (!isPlainObject(ms)) return null;
  const want = canonicalModelId(model);
  if (!want) return null;
  const entries = Object.entries(ms).filter(([, v]) => v !== null && typeof v === 'object');
  for (const [key, settings] of entries) {
    if (canonicalModelId(key) === want) return { key, settings };
  }
  return null;
}

const isAuto = (v) => typeof v === 'string' && v.trim().toLowerCase() === 'auto';

function windowFromFile(json, model, source, path) {
  if (!json) return null;
  const entry = modelSettingsEntry(json, model);
  if (entry) {
    if (isAuto(entry.settings.autoCompactWindow)) {
      return { value: null, auto: true, source, path, modelKey: entry.key };
    }
    const v = parseWindow(entry.settings.autoCompactWindow);
    if (v !== null) return { value: v, source, path, modelKey: entry.key };
  }
  const top = parseWindow(json.autoCompactWindow);
  if (top !== null) return { value: top, source, path };
  return null;
}

/**
 * Effective autoCompactWindow for `model`, with the source that won. A
 * per-model `"auto"` is an explicit setting (the model default), so it ends
 * the search and wins over lower-precedence files, as in Claude Code.
 */
export function effectiveWindow(root, { model } = {}) {
  const env = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  if (env) {
    const v = parseWindow(env);
    if (v !== null) return { value: v, source: 'env' };
  }
  const m = model === undefined ? resolveModelId(root).model : model;
  for (const p of projectSettingsPaths(root)) {
    const w = windowFromFile(readJson(p), m, 'project', p);
    if (w) return w;
  }
  const gp = userSettingsPath();
  const gw = windowFromFile(readJson(gp), m, 'global', gp);
  if (gw) return gw;
  return { value: null, source: null };
}

/**
 * Full audit result. `ok` is true when there is nothing to warn about — either
 * the session is not on a 1M model (exempt), the window is already pinned at
 * or below the top of the recommended band (700k), or the user chose `"auto"`
 * with `/autocompact auto` (reason 'auto'). `auto` hands the window back to the
 * model default on purpose, so sprag respects that choice instead of nagging.
 *
 * `reason` names why it is not ok: 'unset' (no autoCompactWindow anywhere) or
 * 'too-large' (set, but above 700k — still lets context run away).
 *
 * `liveWindow` is the window Claude Code reported for the running session. The
 * model id alone misses every model that is 1M without a `[1m]` suffix, so a
 * reported size settles it whenever the caller has one. `liveModel` is the
 * model id the same payload carried; it picks the `modelSettings` entry.
 */
export function compactWindowStatus({ root = process.cwd(), liveWindow = null, liveModel = null } = {}) {
  const resolved = resolveModelId(root);
  const model = liveModel || resolved.model;
  const modelSource = liveModel ? 'live' : resolved.source;
  const is1m = isOneMillionModel(model) || (Number.isFinite(liveWindow) && liveWindow >= LIVE_1M_MIN);
  const win = effectiveWindow(root, { model });
  const base = {
    model,
    modelSource,
    is1m,
    window: win.value,
    windowSource: win.source,
    windowPath: win.path || null,
    windowAuto: !!win.auto,
    windowModelKey: win.modelKey || null,
    recommended: RECOMMENDED_WINDOW,
    recommendedMin: RECOMMENDED_MIN,
    recommendedMax: RECOMMENDED_MAX,
  };
  if (!is1m) return { ...base, ok: true, reason: 'not-1m' };
  if (win.auto) return { ...base, ok: true, reason: 'auto' };
  if (win.value === null) return { ...base, ok: false, reason: 'unset' };
  if (win.value > RECOMMENDED_MAX) return { ...base, ok: false, reason: 'too-large' };
  return { ...base, ok: true, reason: 'configured' };
}

/**
 * False once `sprag compact-window off` has switched the warning off. Read by
 * the statusline chip and the session briefing alike.
 */
export function compactWindowWarningEnabled(cfg) {
  return !(cfg && cfg.compactWindow && cfg.compactWindow.enabled === false);
}

/**
 * Statusline chip text, or null when there is nothing to say. Kept to the same
 * short shape as the other 🅷⚠ warnings so the line stays single-width.
 */
export function compactWindowWarningForStatusline(root = process.cwd(), cfg = null, { liveWindow = null, liveModel = null } = {}) {
  if (!compactWindowWarningEnabled(cfg)) return null;
  try {
    const s = compactWindowStatus({ root, liveWindow, liveModel });
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
 * `models` picks which models the value covers, and the user has to choose it:
 *   'all'  → the top-level key. A per-model entry in the same file beats the
 *            top-level key for its model, so every per-model
 *            `autoCompactWindow` in that file is removed (listed in `removed`)
 *            and one value really applies to every model.
 *   <id>   → `modelSettings[<id>].autoCompactWindow` only, the slot
 *            `/autocompact` writes. The id is stored under its canonical name
 *            (or the existing key that spells it). A bare alias such as `opus`
 *            is refused, since sprag cannot tell which version it means.
 *
 * Returns { path, scope, value, previous, backup, models, modelKey, removed }.
 */
export function setAutoCompactWindow({ root = process.cwd(), scope = 'global', value = RECOMMENDED_WINDOW, models = 'all' } = {}) {
  const v = parseWindow(value);
  if (v === null || v < MIN_WINDOW || v > MAX_WINDOW) {
    return { ok: false, error: `Invalid window: ${value} (expected ${MIN_WINDOW}–${MAX_WINDOW} tokens, e.g. 400000 or 400k)` };
  }
  if (typeof models !== 'string' || models.trim() === '') {
    return { ok: false, error: 'Choose the models: all, or one model id such as claude-opus-5-5.' };
  }
  const path = scope === 'global' ? userSettingsPath() : join(root, '.claude', 'settings.json');
  let json = {};
  let backup = null;
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8');
    try {
      json = parseJsonText(raw);
    } catch (e) {
      debug('compact-window:parse', e);
      // Refuse to overwrite a file we cannot parse — silently replacing a
      // malformed settings.json would drop every other setting in it.
      return { ok: false, error: `${path} is not valid JSON — fix it first (nothing was written).` };
    }
    if (!isPlainObject(json)) {
      return { ok: false, error: `${path} is not a JSON object — fix it first (nothing was written).` };
    }
  }

  let modelKey = null;
  if (models !== 'all') {
    const want = canonicalModelId(models);
    if (!want || ALIAS_RE.test(want)) {
      return { ok: false, error: `"${models}" is an alias, so the model version is unknown. Use the full model id, e.g. claude-${want || 'opus'}-5-5.` };
    }
    const existing = modelSettingsEntry(json, models);
    modelKey = existing ? existing.key : want;
  }

  if (existsSync(path)) {
    backup = `${path}.bak`;
    writePrivateFile(backup, readFileSync(path, 'utf8'));
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }

  const removed = [];
  let previous;
  if (modelKey) {
    if (!isPlainObject(json.modelSettings)) json.modelSettings = {};
    if (!isPlainObject(json.modelSettings[modelKey])) json.modelSettings[modelKey] = {};
    previous = json.modelSettings[modelKey].autoCompactWindow ?? null;
    json.modelSettings[modelKey].autoCompactWindow = v;
  } else {
    previous = parseWindow(json.autoCompactWindow);
    json.autoCompactWindow = v;
    if (isPlainObject(json.modelSettings)) {
      for (const [key, ms] of Object.entries(json.modelSettings)) {
        if (!isPlainObject(ms) || ms.autoCompactWindow === undefined) continue;
        removed.push({ key, value: ms.autoCompactWindow });
        delete ms.autoCompactWindow;
        if (Object.keys(ms).length === 0) delete json.modelSettings[key];
      }
    }
  }
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  return { ok: true, path, scope, value: v, previous, backup, models: modelKey ? 'model' : 'all', modelKey, removed };
}
