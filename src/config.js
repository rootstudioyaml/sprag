/**
 * User-level config persistence — keeps the user's preferred statusline mode
 * across runs without forcing them to edit ~/.claude/settings.json or any
 * wrapper script. CLI flags (e.g. --icon) still override what's stored here.
 *
 * Location is resolved per-platform by paths.userDataDir():
 *   Windows: %APPDATA%\claude-token-saver\config.json
 *   macOS:   ~/Library/Application Support/claude-token-saver/config.json
 *   Linux:   $XDG_CONFIG_HOME/claude-token-saver/config.json or ~/.config/...
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';

const CONFIG_DIR = userDataDir();
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function configPath() {
  return CONFIG_PATH;
}

export function loadConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) || {};
  } catch {
    return {};
  }
}

export function saveConfig(cfg) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

// Each keyword maps to a single statusline option toggle.
// Orthogonal — `mode icon verbose` flips both without resetting the rest.
// Statusline-only toggles. Stored under `cfg.statusline`.
const KEYWORDS = {
  icon:       { key: 'icon',    value: true  },
  text:       { key: 'icon',    value: false },
  verbose:    { key: 'verbose', value: true  },
  compact:    { key: 'verbose', value: false },
  timer:      { key: 'timer',   value: true  },
  'no-timer': { key: 'timer',   value: false },
  color:      { key: 'color',   value: true  },
  'no-color': { key: 'color',   value: false },
};

// Output language for `last`/`history`/advice. Stored at top level
// (`cfg.language`) because it has nothing to do with statusline rendering —
// the chips themselves stay symbolic regardless.
const LANG_KEYWORDS = {
  en:      'en',
  english: 'en',
  ko:      'ko',
  korean:  'ko',
};

// Window preset accepts forms like:
//   `1h`, `6h`, `24h`        — hours
//   `1d`, `7d`, `30d`        — days (× 24h)
//   `days=14`, `hours=6`     — explicit
// Returns hours (number) or null if not a window keyword.
function parseWindow(word) {
  const lower = String(word).toLowerCase();
  const mh = lower.match(/^(\d+)h$/);
  if (mh) return parseInt(mh[1], 10);
  const md = lower.match(/^(\d+)d$/);
  if (md) return parseInt(md[1], 10) * 24;
  const eh = lower.match(/^hours?=(\d+)$/);
  if (eh) return parseInt(eh[1], 10);
  const ed = lower.match(/^days?=(\d+)$/);
  if (ed) return parseInt(ed[1], 10) * 24;
  return null;
}

export const VALID_KEYWORDS = Object.keys(KEYWORDS)
  .concat(Object.keys(LANG_KEYWORDS))
  .concat([
    '<N>h (e.g. 1h, 6h, 24h)',
    '<N>d (e.g. 1d, 7d, 30d)',
    'lang=en | lang=ko',
    'reset',
    'default',
  ]);

/**
 * Apply user-supplied mode keywords to the persisted config.
 * Returns { applied, unknown } so the caller can report success/failure.
 */
export function applyMode(words) {
  const cfg = loadConfig();
  if (!cfg.statusline) cfg.statusline = {};

  const applied = [];
  const unknown = [];

  for (const w of words) {
    const lower = String(w).toLowerCase();
    if (lower === 'reset' || lower === 'default') {
      cfg.statusline = {};
      delete cfg.language;
      applied.push(lower);
      continue;
    }
    const langMatch = lower.match(/^lang(?:uage)?=(en|english|ko|korean)$/);
    if (langMatch) {
      const v = langMatch[1].startsWith('k') ? 'ko' : 'en';
      cfg.language = v;
      // Migrate any legacy value that lived under cfg.statusline.language.
      if (cfg.statusline) delete cfg.statusline.language;
      applied.push(`lang=${v}`);
      continue;
    }
    if (LANG_KEYWORDS[lower]) {
      cfg.language = LANG_KEYWORDS[lower];
      if (cfg.statusline) delete cfg.statusline.language;
      applied.push(`lang=${cfg.language}`);
      continue;
    }
    const hours = parseWindow(lower);
    if (hours !== null && hours > 0) {
      cfg.statusline.windowHours = hours;
      // Drop legacy `days` field if present so a single source of truth wins.
      delete cfg.statusline.days;
      applied.push(formatWindow(hours));
      continue;
    }
    const kw = KEYWORDS[lower];
    if (!kw) {
      unknown.push(w);
      continue;
    }
    cfg.statusline[kw.key] = kw.value;
    applied.push(lower);
  }

  if (applied.length && unknown.length === 0) saveConfig(cfg);
  return { cfg, applied, unknown };
}

/**
 * Effective statusline defaults, derived from the persisted config.
 * Defaults for new users: icon=true, verbose=true, timer=true, color=true.
 * Verbose+icon is the most readable preset (full labels + emoji anchors)
 * and avoids the "1h bucket vs clock" ambiguity in compact mode.
 * Users who explicitly opt out via `mode text` / `mode compact` get their
 * choice persisted and respected.
 */
export function statuslineDefaults() {
  const s = loadConfig().statusline || {};
  // windowHours is the source of truth. Legacy `days` field still honored
  // for users with old configs.
  let windowHours;
  if (Number.isFinite(s.windowHours) && s.windowHours > 0) {
    windowHours = s.windowHours;
  } else if (Number.isFinite(s.days) && s.days > 0) {
    windowHours = s.days * 24;
  } else {
    windowHours = 24; // default: last 1 day
  }
  return {
    icon:        s.icon    !== false,
    verbose:     s.verbose !== false,
    timer:       s.timer   !== false,
    color:       s.color   !== false,
    windowHours,
    windowLabel: formatWindow(windowHours),
  };
}

// Resolve the user's preferred output language for advice/history/last.
// Returns 'en' or 'ko'; defaults to 'en' for first-time users.
// Reads `cfg.language` (current location) with a fallback to the legacy
// `cfg.statusline.language` slot so configs from earlier 2.9.x installs
// keep working.
export function userLanguage() {
  const cfg = loadConfig();
  const v = cfg.language || (cfg.statusline && cfg.statusline.language);
  return v === 'ko' ? 'ko' : 'en';
}

/**
 * Render hours as the most natural unit:
 *   24h → "1d", 168h → "7d", 6h → "6h", 36h → "36h" (not whole days).
 */
export function formatWindow(hours) {
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24}d`;
  return `${hours}h`;
}
