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

import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CLI_NAME } from './cli-name.js';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
// Legacy copied-file location — removed on install/uninstall so machines that
// installed an older version don't keep a dead hook script around.
const LEGACY_HOOK_DEST = join(homedir(), '.claude', 'cache-monitor-hook.cjs');
const HOOK_MARKER = 'cache-monitor-hook';

function isCacheMonitorHook(nh) {
  const cmd = nh?.command;
  if (typeof cmd !== 'string') return false;
  return cmd.includes(HOOK_MARKER) || cmd.includes('--hook-run');
}

export async function installHook({ threshold = 0.7 } = {}) {
  let settings;
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf8');
    settings = JSON.parse(raw);
  } catch {
    settings = {};
  }

  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.PostToolUse)) settings.hooks.PostToolUse = [];

  // Remove existing cache-monitor hook if present — matches both the current
  // subcommand form and the legacy copied-file form.
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
    (h) => !(h.hooks || []).some(isCacheMonitorHook),
  );

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

  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  // Clean up the legacy copy left by older versions.
  await rm(LEGACY_HOOK_DEST, { force: true }).catch(() => {});

  console.log(`✓ Hook installed (PostToolUse → ${CLI_NAME} --hook-run)`);
  console.log(`  Settings updated: ${SETTINGS_PATH}`);
  console.log(`  Threshold: ${(threshold * 100).toFixed(0)}%`);
  console.log(`  Stats file: ~/.claude/cache-stats.jsonl`);
}

export async function uninstallHook() {
  let settings;
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf8');
    settings = JSON.parse(raw);
  } catch {
    console.log('No settings.json found, nothing to uninstall.');
    return;
  }

  if (settings.hooks?.PostToolUse) {
    const before = settings.hooks.PostToolUse.length;
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
      (h) => !(h.hooks || []).some(isCacheMonitorHook),
    );
    const removed = before - settings.hooks.PostToolUse.length;

    if (settings.hooks.PostToolUse.length === 0) delete settings.hooks.PostToolUse;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

    await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    console.log(`✓ Removed ${removed} hook(s) from settings.json`);
  } else {
    console.log('No cache-monitor hook found in settings.');
  }

  // The legacy copied hook file is dead weight either way.
  await rm(LEGACY_HOOK_DEST, { force: true }).catch(() => {});
}
