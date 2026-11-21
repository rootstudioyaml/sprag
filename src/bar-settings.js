/**
 * The settings a menu bar app shows, for `sprag bar --settings`.
 *
 * This file only reads. A change goes through the command that already owns the
 * setting, so each stored value keeps a single writer:
 *   routing.enabled      sprag routing on | off
 *   routing.relaxed      sprag routing relax | relax off
 *   statusline.compact   sprag mode compact=0..3
 *   statusline.labels    sprag mode icon | narrow | text
 *   statusline.timer     sprag mode timer | no-timer
 *   language             sprag mode lang=en | lang=ko
 *   team.displayName     sprag team name "<name>"
 *   compactWindow.value  sprag compact-window set --global --all-models --value <n>
 *   compactWindow.warn   sprag compact-window on | off
 */

import { loadConfig, statuslineDefaults, userLanguage } from './config.js';
import { routingEnabled, isRelaxed, relaxUntil } from './routing-switch.js';
import { loadTeamState, isJoined } from './team-sync.js';
import { compactWindowStatus, compactWindowWarningEnabled } from './compact-window.js';
import { latestLiveWindow, latestLiveModel } from './ctx-window-cache.js';

/** The compact window status of the folder the command runs in, or null when any reader fails. */
function readCompact() {
  try {
    const guard = (fn) => { try { return fn(); } catch { return null; } };
    return compactWindowStatus({ root: process.cwd(), liveWindow: guard(latestLiveWindow), liveModel: guard(latestLiveModel) });
  } catch {
    return null;
  }
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Never throws: every reader below falls back to its default on a missing or broken file. */
export function collectSettings({
  cfg = loadConfig(),
  statusline = statuslineDefaults(),
  language = userLanguage(),
  team = loadTeamState(),
  now = Date.now(),
  compact = readCompact(),
} = {}) {
  const relaxed = isRelaxed(cfg, now);
  const joined = isJoined(team);
  return {
    routing: {
      enabled: routingEnabled(cfg),
      relaxed,
      // Epoch ms while delegation is widened; a deadline already past reads as not relaxed.
      relaxUntil: relaxed ? relaxUntil(cfg) : null,
    },
    statusline: {
      compact: statusline.compactLevel,
      labels: statusline.labels,
      timer: statusline.timer,
    },
    language,
    team: {
      joined,
      teamName: joined ? text(team.teamName) : null,
      displayName: joined ? text(team.displayName) : null,
    },
    compactWindow: compact ? {
      is1m: compact.is1m,
      value: compact.window ?? null,
      auto: compact.windowAuto,
      source: compact.windowSource ?? null,
      modelKey: compact.windowModelKey ?? null,
      ok: compact.ok,
      reason: compact.reason,
      recommended: compact.recommended,
      min: compact.recommendedMin,
      max: compact.recommendedMax,
      warn: compactWindowWarningEnabled(cfg),
    } : null,
  };
}
