/**
 * cohesion — English sentence-connection guidance injected at session start.
 *
 * The Korean supplement's cohesion section turned out to be language-neutral:
 * given-before-new ordering, one referent per pronoun, subject consistency,
 * bridging instead of leaping, merging choppy sentences. English-only users
 * never run `korean on`, so those rules never reached them. This module ships
 * the same principles as a standalone English block.
 *
 * Off by default for the same reason the Korean guidance is opt-in: a
 * token-saving tool has no business silently billing ~0.5k tokens a session.
 * Enable with `sprag cohesion on`.
 *
 * When the Korean guidance is enabled, this block is NOT injected even if
 * enabled: the Korean supplement already carries the cohesion rules, and
 * injecting the same principles twice bills them twice.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from './config.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const COHESION_PATH = join(packageRoot, 'presets', 'cohesion', 'cohesion-en.md');

/** Whether session-start injection is enabled. Off unless the user asked. */
export function cohesionEnabled(cfg = loadConfig()) {
  return cfg?.cohesion?.enabled === true;
}

export function setCohesionEnabled(enabled) {
  const cfg = loadConfig();
  cfg.cohesion = { ...(cfg.cohesion || {}), enabled: !!enabled };
  saveConfig(cfg);
  return cfg.cohesion;
}

/** The guidance text with the provenance comment stripped, or null. */
export function cohesionText() {
  try {
    if (!existsSync(COHESION_PATH)) return null;
    const raw = readFileSync(COHESION_PATH, 'utf8');
    const body = raw.replace(/^<!--[\s\S]*?-->\s*/, '').trim();
    return body || null;
  } catch {
    return null;
  }
}

/**
 * Block to inject at session start, or null when disabled, unavailable, or
 * redundant (Korean guidance on — its supplement already carries these rules).
 */
export async function cohesionInjection({ cfg = loadConfig() } = {}) {
  if (!cohesionEnabled(cfg)) return null;
  try {
    const { koreanStyleEnabled } = await import('./korean-style.js');
    if (koreanStyleEnabled(cfg)) return null;
  } catch { /* korean module unavailable: inject normally */ }
  const text = cohesionText();
  if (!text) return null;
  return [
    '[sprag cohesion] Follow this guidance for English prose in this session.',
    'The user enabled it in claude-token-saver.',
    '',
    text,
  ].join('\n');
}
