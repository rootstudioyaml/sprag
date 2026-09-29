/**
 * Sets up the Codex companion panel to run inline, inside the same terminal,
 * instead of opening a separate macOS Terminal window. Codex's native footer
 * cannot run a command, so the panel is the closest thing Codex has to a
 * statusline; showing it below the Codex pane in tmux (via a zsh `codex()`
 * wrapper) means a user does not get a new window per session. Install falls
 * back to the separate window when tmux cannot be set up, the login shell is
 * not zsh, or the user already has their own `codex` alias/function.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { installPanelShell } from './codex-panel-shell.js';

/** Whether a tmux binary answers `-V`. */
export function tmuxAvailable({ exec = execFileSync } = {}) {
  try { exec('tmux', ['-V'], { stdio: 'pipe' }); return true; }
  catch { return false; }
}

export function ensureTmux({ platform = process.platform, env = process.env, exec = execFileSync, exists = existsSync } = {}) {
  // Checked first, before probing anything, so tests and CI never spawn brew.
  if (env.CTS_NO_TMUX === '1' || (env.CI && env.CI !== 'false')) return { status: 'skipped' };
  if (tmuxAvailable({ exec })) return { status: 'present' };
  if (platform !== 'darwin') {
    return { status: 'unavailable', detail: 'install tmux with your package manager (e.g. sudo apt install tmux)' };
  }
  let brew;
  try { exec('brew', ['--prefix'], { stdio: 'pipe' }); brew = 'brew'; }
  catch {
    for (const p of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
      if (exists(p)) { brew = p; break; }
    }
  }
  if (!brew) {
    return { status: 'unavailable', detail: 'Homebrew not found; install tmux from https://github.com/tmux/tmux/wiki/Installing or MacPorts (sudo port install tmux)' };
  }
  try {
    // brew update alone can take minutes; postinstall cannot afford that here.
    exec(brew, ['install', 'tmux'], { stdio: 'inherit', timeout: 600_000,
      env: { ...env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' } });
  } catch (e) {
    return { status: 'failed', via: 'brew', detail: String(e.message).split('\n')[0] };
  }
  // No npm-package fallback: no official npm tmux exists, and a third-party
  // prebuilt binary would be an unaudited supply-chain risk.
  const fallback = join(dirname(brew === 'brew' ? '/opt/homebrew/bin/brew' : brew), 'tmux');
  if (tmuxAvailable({ exec }) || exists(fallback)) return { status: 'installed', via: 'brew' };
  return { status: 'failed', via: 'brew', detail: 'tmux not on PATH after brew install' };
}

export function setupCodexPanel({ platform = process.platform, env = process.env, config = {}, noPanel = false,
  exec, exists, installShell = installPanelShell, tmux = ensureTmux } = {}) {
  if (noPanel) return { panelAuto: false, mode: 'off' };
  // Panel auto and the zsh integration are macOS-only today.
  if (platform !== 'darwin') return { panelAuto: false, mode: 'off' };
  const windowAuto = config?.codex?.panelAuto !== false;
  if (config?.codex?.panelShell === false) {
    return { panelAuto: windowAuto, mode: windowAuto ? 'window' : 'off', reason: 'shell integration turned off' };
  }
  if (basename(env.SHELL || '') !== 'zsh') {
    return { panelAuto: windowAuto, mode: windowAuto ? 'window' : 'off', reason: 'login shell is not zsh' };
  }
  const t = tmux({ platform, env, ...(exec && { exec }), ...(exists && { exists }) });
  if (!['present', 'installed'].includes(t.status)) {
    return { panelAuto: windowAuto, mode: windowAuto ? 'window' : 'off', reason: t.detail || t.status, tmux: t };
  }
  let shellFile;
  try { shellFile = installShell(); }
  catch (e) {
    return { panelAuto: windowAuto, mode: windowAuto ? 'window' : 'off', reason: e.message, tmux: t };
  }
  // The inline panel replaces the separate window by default; an explicit
  // `panel auto on` keeps both.
  return { panelAuto: config?.codex?.panelAuto === true, mode: 'inline', tmux: t, shellFile };
}

/** Formats a `setupCodexPanel` result as lines a caller prefixes and prints. */
export function describePanelSetup(result, lang = 'en') {
  if (result.mode === 'off') return [];
  if (result.mode === 'inline') {
    const lines = [lang === 'ko'
      ? `패널: tmux 인라인 (${result.shellFile}). 새 터미널에서 codex 를 실행하면 같은 창 아래쪽에 패널이 붙습니다.`
      : `panel: inline tmux (${result.shellFile}). Open a new terminal and run codex; the panel attaches below it.`];
    if (result.tmux?.status === 'installed') {
      lines.push(lang === 'ko' ? 'tmux 를 Homebrew 로 설치했습니다.' : 'installed tmux with Homebrew.');
    }
    return lines;
  }
  const lines = [lang === 'ko'
    ? `패널: 별도 Terminal 창${result.reason ? ` (${result.reason})` : ''}`
    : `panel: separate Terminal window${result.reason ? ` (${result.reason})` : ''}`];
  if (result.tmux?.detail && ['unavailable', 'failed'].includes(result.tmux.status)) {
    lines.push(`tmux: ${result.tmux.detail}`);
  }
  return lines;
}
