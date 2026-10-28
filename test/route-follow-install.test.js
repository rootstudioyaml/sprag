/**
 * installRouteFollowHook: the PostToolUse entry behind the delegation follow-up.
 *
 * HOME and XDG_CONFIG_HOME point into a temp directory before the installer is
 * imported, as in mod-install.test.js, so the real ~/.claude is never touched.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SANDBOX = mkdtempSync(join(tmpdir(), 'sprag-follow-install-'));
const HOME = join(SANDBOX, 'home');
mkdirSync(join(HOME, '.claude'), { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = join(SANDBOX, 'cfg');
after(() => rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const { installRouteFollowHook, installBriefHook, installAll, isOurSubcommand } = await import('../src/installer.js');
const SETTINGS = join(HOME, '.claude', 'settings.json');
const settings = () => JSON.parse(readFileSync(SETTINGS, 'utf8'));
const followEntries = () => (settings().hooks.PostToolUse || []).filter((m) =>
  (m.hooks || []).some((h) => isOurSubcommand(h.command, 'brief', '--hook-tool')));

test('creates one PostToolUse entry with the lookup, edit, delegation and MCP matcher', () => {
  rmSync(SETTINGS, { force: true });
  assert.equal(installRouteFollowHook().action, 'created');
  const entries = followEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, 'Read|Grep|Glob|LS|Bash|Edit|Write|MultiEdit|NotebookEdit|Task|Agent|WebFetch|WebSearch|mcp__.*');
  assert.equal(entries[0].hooks[0].timeout, 5);
  assert.match(entries[0].hooks[0].command, /brief --hook-tool$/);
  // The delegation call also stops the count when it starts, before the
  // subagent's own lookups reach the PostToolUse entry.
  const pre = (settings().hooks.PreToolUse || []).filter((m) =>
    (m.hooks || []).some((h) => isOurSubcommand(h.command, 'brief', '--hook-tool')));
  assert.equal(pre.length, 1);
  assert.equal(pre[0].matcher, 'Task|Agent');
});

test('a second install changes nothing', () => {
  assert.equal(installRouteFollowHook().action, 'exists');
  assert.equal(followEntries().length, 1);
});

test('the UserPromptSubmit brief hook is not mistaken for it, in either direction', () => {
  rmSync(SETTINGS, { force: true });
  assert.equal(installBriefHook().action, 'created');
  assert.equal(installRouteFollowHook().action, 'created', '`brief --hook` must not count as `brief --hook-tool`');
  assert.equal(installBriefHook().action, 'exists');
  assert.equal(followEntries().length, 1);
});

test('installAll registers it and leaves other tools hooks alone', () => {
  writeFileSync(SETTINGS, JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other-tool run' }] }] } }));
  const r = installAll();
  assert.equal(r.routeFollowHook.action, 'created');
  const post = settings().hooks.PostToolUse;
  assert.ok(post.some((m) => m.hooks.some((h) => h.command === 'other-tool run')));
  assert.equal(followEntries().length, 1);
});
