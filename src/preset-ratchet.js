/**
 * preset-ratchet — the bundled ratchet presets the user accepted globally,
 * kept in a file of their own.
 *
 * Presets used to be appended to ratchet.md next to the user's own rules. Once
 * there, an upgrade could not reword a preset, drop one that turned out wrong,
 * or tell which lines were ours: every line looked like the user's. This file
 * holds only presets and is regenerated whole from the recorded answers in
 * seed-state, the same way ratchet-model.md is regenerated from the rule
 * registry. So an upgrade updates it by itself, `seed skip` removes one, and
 * ratchet.md stays the user's.
 *
 *   Claude Code  ~/.claude/ratchet-preset.md   (imported by the global harness block)
 *   Codex        <CODEX_HOME>/ratchet-preset.md (injected by the SessionStart hook)
 *
 * Presets accepted into a project scope still go to that project's ratchet.md:
 * a project rule is the user's placement decision, not a tool-wide default.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { codexUserDir } from './agent.js';
import { userLanguage } from './config.js';
import {
  HARNESS_BLOCK_BEGIN,
  HARNESS_BLOCK_END,
  PRESET_RATCHET_IMPORT_RE,
  presetRatchetImportLine,
  renderPresetRatchet,
} from './harness-templates.js';
import { loadSeedState, ratchetPresets, saveSeedState } from './seed-rules.js';

export function presetRatchetPath({ agent = 'claude' } = {}) {
  return agent === 'codex'
    ? join(codexUserDir(), 'ratchet-preset.md')
    : join(homedir(), '.claude', 'ratchet-preset.md');
}

function globalRatchetPath(agent) {
  return agent === 'codex' ? join(codexUserDir(), 'ratchet.md') : join(homedir(), '.claude', 'ratchet.md');
}

function writeIfChanged(file, text) {
  let before = null;
  try { before = readFileSync(file, 'utf8'); } catch { /* first write */ }
  if (before === text) return false;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  return true;
}

/** The accepted-global presets, in the bundled order, with this version's wording. */
export function acceptedGlobalPresets({ agent = 'claude', lang = userLanguage() } = {}) {
  const { decided } = loadSeedState({ agent });
  return ratchetPresets(lang, { agent })
    .filter((p) => decided[p.id]?.action === 'accepted' && decided[p.id]?.scope === 'global')
    .map((p) => ({ id: p.id, text: p.text }));
}

/**
 * Rewrite the preset file from the recorded answers. A preset that a newer
 * release removed simply stops being rendered; its answer stays in seed-state
 * so it is not offered again if it comes back under the same text.
 */
export function syncPresetRatchet({ agent = 'claude', lang = userLanguage() } = {}) {
  const file = presetRatchetPath({ agent });
  const rules = acceptedGlobalPresets({ agent, lang });
  const changed = writeIfChanged(file, renderPresetRatchet(rules, { lang, agent }));
  return { file, rules: rules.length, changed };
}

/**
 * Move presets that earlier versions appended to the global ratchet.md into
 * the preset file. A line counts as a preset only when its text, without the
 * date stamp, equals a bundled rule in either language, so nothing the user
 * wrote themselves is touched. The original is backed up once before the
 * first change.
 */
export function migrateLegacyPresetRules({ agent = 'claude' } = {}) {
  const file = globalRatchetPath(agent);
  if (!existsSync(file)) return { file, moved: 0 };
  const byText = new Map();
  for (const lang of ['ko', 'en']) {
    for (const p of ratchetPresets(lang, { agent })) byText.set(p.text.trim(), p.id);
  }
  const stamp = /^\d{4}-\d{2}-\d{2}(\s*\([^)]*\))?:\s*/;
  const original = readFileSync(file, 'utf8');
  const moved = [];
  const kept = original.split('\n').filter((line) => {
    const m = line.match(/^\s*-\s+(.*)$/);
    if (!m) return true;
    const id = byText.get(m[1].replace(stamp, '').trim());
    if (!id) return true;
    moved.push(id);
    return false;
  });
  if (!moved.length) return { file, moved: 0 };
  writeFileSync(`${file}.bak-preset-migration`, original);
  writeIfChanged(file, kept.join('\n'));
  const state = loadSeedState({ agent });
  const today = new Date().toISOString().slice(0, 10);
  for (const id of moved) state.decided[id] = { action: 'accepted', at: today, scope: 'global', migrated: true };
  saveSeedState(state, { agent });
  return { file, moved: moved.length };
}

/**
 * Add the preset import to a global harness block written before the file
 * existed. Only the tool's own marked block is edited; a CLAUDE.md without the
 * block is left alone, since the user chose not to install the harness there.
 */
export function ensurePresetImport() {
  const file = join(homedir(), '.claude', 'CLAUDE.md');
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return { file, added: false }; }
  const begin = text.indexOf(HARNESS_BLOCK_BEGIN);
  const end = text.indexOf(HARNESS_BLOCK_END);
  if (begin < 0 || end < begin) return { file, added: false };
  if (PRESET_RATCHET_IMPORT_RE.test(text.slice(begin, end))) return { file, added: false };
  writeFileSync(file, `${text.slice(0, end)}${presetRatchetImportLine()}\n${text.slice(end)}`);
  return { file, added: true };
}

/** Everything a session start or an install does: migrate, render, and wire the import. */
export function preparePresetRatchet({ agent = 'claude', lang = userLanguage() } = {}) {
  const migrated = migrateLegacyPresetRules({ agent });
  const synced = syncPresetRatchet({ agent, lang });
  const imported = agent === 'codex' ? { added: false } : ensurePresetImport();
  return { ...synced, moved: migrated.moved, importAdded: imported.added };
}
