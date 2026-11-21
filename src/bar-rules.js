/**
 * Every rule source a menu bar app lists, for `sprag bar --rules`.
 *
 * This file only reads. A rule is changed or removed through the command that
 * already owns it, so each file keeps a single writer:
 *   global.rules[].index   sprag harness rm <N> --global
 *   projects[].rules[]     sprag harness rm <N>, run inside that project
 *   preset.pending[].id    sprag seed accept <id> --global | sprag seed skip <id>
 *   preset.rules[].id      sprag seed skip <id>
 *   model.rules[].index    sprag route-scan rules rm <N>
 *   team.rules             set by the team admin, read-only here
 *
 * Every source is read inside its own try/catch: a failing one gives its empty
 * shape and never fails the command. Each parameter below is a reader (a
 * function) whose default is the real one, so a test never touches the real
 * home folder.
 */

import { existsSync } from 'node:fs';
import os from 'node:os';
import { basename } from 'node:path';
import { userLanguage } from './config.js';
import { harnessListRules, findProjectRoot, RATCHET_TOKEN_BUDGET } from './harness.js';
import { readClaudeSessions } from './agent-activity.js';
import { claudeConfigDir } from './commands/panel.js';
import { defaultIsAlive } from './statusline-guard.js';
import { presetRatchetPath, acceptedGlobalPresets } from './preset-ratchet.js';
import { pendingSeeds } from './seed-rules.js';
import { loadModelRules } from './model-rules.js';
import { routingEnabled } from './routing-switch.js';
import { loadTeamState } from './team-sync.js';
import { isJoined, readTeamRulesCache, teamRuleText } from './team-ratchet.js';

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

/** Project roots of the running Claude Code sessions. */
function runningRoots() {
  const roots = new Set();
  for (const file of readClaudeSessions(claudeConfigDir())) {
    if (typeof file.cwd !== 'string' || !file.cwd || !defaultIsAlive(file.pid)) continue;
    const root = safe(() => findProjectRoot(file.cwd), null);
    if (root) roots.add(root);
  }
  return [...roots];
}

const EMPTY_FILE = () => ({ path: null, exists: false, bytes: 0, tokens: 0, rules: [] });

function ratchetFile(listRules, { root, scope }) {
  return safe(() => {
    const r = listRules({ root, scope });
    const bytes = Number.isFinite(r.bytes) ? r.bytes : 0;
    return {
      path: r.path ?? null,
      exists: r.path ? existsSync(r.path) : false,
      bytes,
      // The same 4 bytes per token the ratchet size check uses.
      tokens: Math.round(bytes / 4),
      rules: (r.rules ?? []).map(({ index, text, date, tags }) => ({ index, text, date: date ?? null, tags: tags ?? [] })),
    };
  }, EMPTY_FILE());
}

export function collectRules({
  lang = userLanguage(),
  roots = runningRoots,
  listRules = harnessListRules,
  presetPath = presetRatchetPath,
  presets = acceptedGlobalPresets,
  pending = pendingSeeds,
  modelRules = () => loadModelRules().rules,
  routing = routingEnabled,
  teamState = loadTeamState,
  teamCache = readTeamRulesCache,
} = {}) {
  const home = os.homedir();

  // A session started in the home folder has the global file as its project file.
  const projects = safe(() => roots(), []).filter((root) => root !== home).map((root) => ({
    root, name: basename(root), ...ratchetFile(listRules, { root, scope: 'project' }),
  })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.root < b.root ? -1 : a.root > b.root ? 1 : 0));

  const preset = {
    path: safe(() => presetPath() ?? null, null),
    rules: safe(() => presets({ lang }).map((p) => ({ id: p.id, text: p.text })), []),
    pending: safe(() => pending({ lang, root: home })
      .filter((s) => s.kind === 'ratchet')
      .map((s) => ({ id: s.id, text: s.ruleText })), []),
  };

  const model = {
    enabled: safe(() => !!routing(), false),
    // index is the 1-based position `sprag route-scan rules` prints and `rules rm <N>` takes.
    rules: safe(() => modelRules().map((r, i) => ({
      index: i + 1,
      scope: r.scope ?? null,
      root: r.targetRoot ?? null,
      label: lang === 'ko' ? r.label : (r.labelEn ?? r.label),
      tier: r.tier ?? null,
      status: r.status ?? null,
      text: r.rule ?? '',
      example: r.example ?? null,
      count: r.count ?? null,
      savedUsd: r.savedUsd ?? null,
    })), []),
  };

  const team = {
    joined: safe(() => isJoined(teamState()), false),
    rules: safe(() => {
      const cache = teamCache();
      const removed = new Set(Array.isArray(cache?.removed) ? cache.removed : []);
      const textOf = (r) => teamRuleText(r, { lang });
      const found = (Array.isArray(cache?.rules) ? cache.rules : [])
        .filter((r) => r && textOf(r) && !removed.has(r.id));
      return [...found.filter((r) => r.level === 'org'), ...found.filter((r) => r.level !== 'org')].map((r) => ({
        id: r.id ?? null,
        level: r.level === 'org' ? 'org' : 'team',
        scope: r.scope === 'model' ? 'model' : 'ratchet',
        text: textOf(r).replace(/\s*\n\s*/g, ' '),
      }));
    }, []),
  };

  return {
    budgetTokens: RATCHET_TOKEN_BUDGET,
    global: ratchetFile(listRules, { root: home, scope: 'global' }),
    projects,
    preset,
    model,
    team,
  };
}
