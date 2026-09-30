/**
 * Install/uninstall the cache-monitor PostToolUse hook in ~/.claude/settings.json
 *
 * Registered as a CLI subcommand (`claude-token-saver --hook-run`) like every
 * other hook in this package — NOT as a copied file. The old copy-to-home
 * approach pinned a stale hook.cjs in ~/.claude/ forever, never shipped
 * harness-analyzer.cjs alongside it, and survived `uninstall` because its
 * command line did not contain the CLI name. Registering the CLI itself
 * removes the copy, the staleness, and the orphan in one move.
 */

import { rm } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_NAME } from './cli-name.js';
import { claudeUserDir } from './paths.js';
import { isOurSubcommand, isLegacyCacheMonitorCommand, readSettings, writeSettings } from './installer.js';

// Resolved per call, not at import: the paths follow the current home directory.
const settingsPath = () => join(claudeUserDir(), 'settings.json');
// Legacy copied-file location — removed on install/uninstall so machines that
// installed an older version don't keep a dead hook script around.
const legacyHookDest = () => join(claudeUserDir(), 'cache-monitor-hook.cjs');

// Ours means the current subcommand form (`<cli> --hook-run ...`) or the exact
// legacy copied-file form. A command that only mentions either string, such as
// `echo "sprag --hook-run"`, belongs to somebody else.
function isCacheMonitorHook(nh) {
  const cmd = nh?.command;
  if (typeof cmd !== 'string') return false;
  return isOurSubcommand(cmd, '--hook-run') || isLegacyCacheMonitorCommand(cmd);
}

/**
 * Drop our hook entries and keep everything else. Removal is per hook, not per
 * matcher group: Claude Code merges hooks that share a matcher into one group,
 * so filtering whole groups took another tool's hook with ours whenever that
 * tool had been installed into the same `Bash|Edit|Write` group. A group goes
 * only once nothing of anyone else's is left in it. Same rule as
 * installer.js uninstallAll, which fixed this for the other hooks earlier.
 */
export function withoutCacheMonitorHooks(groups) {
  const kept = [];
  for (const m of groups) {
    if (!Array.isArray(m?.hooks)) { kept.push(m); continue; }
    const hooks = m.hooks.filter((h) => !isCacheMonitorHook(h));
    if (hooks.length === m.hooks.length) { kept.push(m); continue; }
    if (hooks.length) kept.push({ ...m, hooks });
  }
  return kept;
}

function countCacheMonitorHooks(groups) {
  let n = 0;
  for (const m of groups) for (const h of (Array.isArray(m?.hooks) ? m.hooks : [])) if (isCacheMonitorHook(h)) n += 1;
  return n;
}

function fail(message) {
  console.log(message);
  process.exitCode = 1;
  return false;
}

export async function installHook({ threshold = 0.7 } = {}) {
  const SETTINGS_PATH = settingsPath();
  // Only a missing file starts from an empty object. A file that exists but
  // cannot be parsed (or is not an object) is the user's configuration;
  // replacing it with a fresh object would wipe everything in it.
  const read = readSettings(SETTINGS_PATH);
  if (read.state === 'unusable') {
    return fail(`✗ ${SETTINGS_PATH} is ${read.reason} — hook not installed, file left untouched.`);
  }
  const settings = read.settings;

  if (settings.hooks === undefined || settings.hooks === null) settings.hooks = {};
  if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    return fail(`✗ hooks in ${SETTINGS_PATH} is not an object — hook not installed, file left untouched.`);
  }
  if (settings.hooks.PostToolUse !== undefined && !Array.isArray(settings.hooks.PostToolUse)) {
    // Someone else's data in a shape we do not understand; overwriting it with
    // [] would discard it. Leave the file alone and say so.
    return fail(`✗ hooks.PostToolUse in ${SETTINGS_PATH} is not an array — hook not installed, file left untouched.`);
  }
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

  // Remove an existing cache-monitor hook — matches both the current subcommand
  // form and the legacy copied-file form.
  settings.hooks.PostToolUse = withoutCacheMonitorHooks(settings.hooks.PostToolUse);

  settings.hooks.PostToolUse.push({
    matcher: 'Bash|Edit|Write',
    hooks: [
      {
        type: 'command',
        command: `${CLI_NAME} --hook-run --threshold ${threshold}`,
        timeout: 10,
      },
    ],
  });

  mkdirSync(claudeUserDir(), { recursive: true });
  const writeProblem = writeSettings(SETTINGS_PATH, settings);
  if (writeProblem) return fail(`✗ Hook not installed: ${writeProblem}`);

  // Clean up the legacy copy left by older versions.
  await rm(legacyHookDest(), { force: true }).catch(() => {});

  console.log(`✓ Hook installed (PostToolUse → ${CLI_NAME} --hook-run)`);
  console.log(`  Settings updated: ${SETTINGS_PATH}`);
  console.log(`  Threshold: ${(threshold * 100).toFixed(0)}%`);
  console.log(`  Stats file: ~/.claude/cache-stats.jsonl`);
}

export async function uninstallHook() {
  const SETTINGS_PATH = settingsPath();
  const read = readSettings(SETTINGS_PATH);
  if (read.state === 'absent') {
    console.log('No settings.json found, nothing to uninstall.');
    return;
  }
  if (read.state === 'unusable') {
    return fail(`✗ ${SETTINGS_PATH} is ${read.reason} — nothing removed, file left untouched.`);
  }
  const settings = read.settings;

  if (Array.isArray(settings.hooks?.PostToolUse)) {
    const removed = countCacheMonitorHooks(settings.hooks.PostToolUse);
    if (removed > 0) {
      settings.hooks.PostToolUse = withoutCacheMonitorHooks(settings.hooks.PostToolUse);
      if (settings.hooks.PostToolUse.length === 0) delete settings.hooks.PostToolUse;
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

      const writeProblem = writeSettings(SETTINGS_PATH, settings);
      if (writeProblem) return fail(`✗ Hook not removed: ${writeProblem}`);
      console.log(`✓ Removed ${removed} hook(s) from settings.json`);
    } else {
      console.log('No cache-monitor hook found in settings.');
    }
  } else {
    console.log('No cache-monitor hook found in settings.');
  }

  // The legacy copied hook file is dead weight either way.
  await rm(legacyHookDest(), { force: true }).catch(() => {});
}
