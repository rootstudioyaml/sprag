import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { codexUserDir } from './agent.js';

const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;

export function panelLaunchCommand(root, { node = process.execPath, cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url)), home = codexUserDir(), sessionId, sessionFile } = {}) {
  return ['env', `CODEX_HOME=${home}`, node, cli, 'panel', '--agent', 'codex', '--project', resolve(root),
    ...(sessionId ? ['--session', sessionId] : []), ...(sessionFile ? ['--session-file', sessionFile] : [])]
    .map(quote).join(' ');
}

export function openCodexPanel(root, { platform = process.platform, exec = execFileSync, ...options } = {}) {
  if (platform !== 'darwin') throw new Error('Automatic panel windows currently require macOS Terminal. Run sprag panel --agent codex in a separate terminal.');
  const identity = [options.home || codexUserDir(), options.sessionId ? `session\0${options.sessionId}` : `project\0${resolve(root)}`].join('\0');
  const title = `Sprag | Codex | ${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
  // Arguments travel through osascript argv, never through AppleScript source.
  // Reuse only the same session (or an explicitly project-following window).
  const script = `on run argv
set panelTitle to item 1 of argv
set panelCommand to item 2 of argv
tell application "Terminal"
repeat with w in windows
repeat with t in tabs of w
if custom title of t is panelTitle then
set miniaturized of w to false
set visible of w to true
set selected tab of w to t
set index of w to 1
activate
if busy of t then return "already-open"
do script panelCommand in t
return "restarted"
end if
end repeat
end repeat
set t to do script panelCommand
set custom title of t to panelTitle
activate
return "opened"
end tell
end run`;
  return exec('/usr/bin/osascript', ['-e', script, title, panelLaunchCommand(root, options)], {
    encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
