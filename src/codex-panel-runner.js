import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { panelLaunchCommand } from './codex-panel-launcher.js';
import { createPanelBinding } from './codex-panel-session.js';

const quote = (s) => `'${String(s).replace(/'/g, `'"'"'`)}'`;

export function resizeInlinePanel(rows, { exec = execFileSync, env = process.env, state } = {}) {
  if (env.SPRAG_CODEX_PANEL !== '1' || !env.TMUX_PANE || !env.TMUX) return;
  try {
    const info = exec('tmux', ['display-message', '-p', '-t', env.TMUX_PANE, '#{window_height} #{pane_height} #{window_width}'], { encoding: 'utf8', timeout: 1000 }).trim().split(/\s+/).map(Number);
    const size = `${info[2]}x${info[0]}`;
    // Keep the high-water mark until the terminal is resized. Timer labels and
    // disappearing warnings must not repeatedly resize the prompt above us.
    const contentRows = state && state.size === size ? Math.max(rows, state.rows) : rows;
    const wanted = Math.max(1, Math.min(contentRows + 1, info[0] - 11));
    if (state) { state.size = size; state.rows = contentRows; }
    if (Number.isFinite(wanted) && wanted !== info[1]) exec('tmux', ['resize-pane', '-t', env.TMUX_PANE, '-y', String(wanted)], { stdio: 'ignore' });
  } catch { /* A disappearing client must not stop the panel. */ }
}

export function createInlinePanelResizer(options = {}) {
  const state = {};
  return (rows) => resizeInlinePanel(rows, { ...options, state });
}

// A private server leaves the user's tmux configuration and sessions untouched.
export function runCodexWithPanel(args, { root = process.cwd(), codex = 'codex', tmux = 'tmux',
  exec = execFileSync, spawn = spawnSync, tty = !!process.stdin.isTTY && !!process.stdout.isTTY,
  env = process.env, columns = process.stdout.columns || 100, rows = process.stdout.rows || 30,
  keepNativeStatusline = false } = {}) {
  if (!tty) throw new Error('Panel run requires an interactive terminal. Use codex directly for scripts.');
  const options = args.slice(0, args.indexOf('--') < 0 ? args.length : args.indexOf('--'));
  if (options.some((arg) => arg === '--remote' || arg.startsWith('--remote='))) {
    throw new Error('Inline panels require a local Codex process. For remote Codex, run codex directly and use a separate panel with --session ID and local logs.');
  }
  try { exec(tmux, ['-V'], { stdio: 'pipe' }); }
  catch { throw new Error('The inline Codex panel requires tmux. Install it with brew install tmux on macOS.'); }
  const socket = `sprag-${randomUUID()}`;
  const base = ['-L', socket, '-f', '/dev/null'];
  const dir = mkdtempSync(join(tmpdir(), 'sprag-codex-'));
  const status = join(dir, 'exit');
  const sessionFile = join(dir, 'session.json');
  const home = resolve(env.CODEX_HOME || join(env.HOME || homedir(), '.codex'));
  const childEnv = { ...env, TMUX: '', SPRAG_CODEX_PANEL: '1', SPRAG_CODEX_PANEL_BINDING: sessionFile };
  // Hide duplicate model/effort only in this layout. Later caller overrides win;
  // putting the default before args also preserves subcommands and `--` prompts.
  const launchArgs = [...(options.includes('--no-daemon') ? [] : ['--no-daemon']),
    ...(keepNativeStatusline ? [] : ['-c', 'tui.status_line=[]']), ...args];
  const call = (argv) => exec(tmux, [...base, ...argv], { env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    createPanelBinding(sessionFile);
    const tmuxCommand = [tmux, ...base].map(quote).join(' ');
    const command = `${tmuxCommand} wait-for ready; ${[codex, ...launchArgs].map(quote).join(' ')}; result=$?; printf '%s' "$result" > ${quote(status)}; ${tmuxCommand} kill-session -t codex`;
    const top = call(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'codex', '-c', process.cwd(),
      '-x', String(columns), '-y', String(Math.max(16, rows)), command]).trim();
    call(['set-option', '-t', 'codex', 'status', 'off']);
    call(['set-option', '-t', 'codex', 'destroy-unattached', 'off']);
    call(['split-window', '-d', '-v', '-l', '6', '-t', top,
      `${panelLaunchCommand(resolve(root), { home, sessionFile })} --compact`]);
    call(['select-pane', '-t', top]);
    call(['wait-for', '-S', 'ready']);
    const attached = spawn(tmux, [...base, 'attach-session', '-t', 'codex'], { env: childEnv, stdio: 'inherit' });
    if (attached.error) throw attached.error;
    try { return Number(readFileSync(status, 'utf8')); }
    catch { return attached.status || 0; }
  } finally {
    try { call(['kill-server']); } catch { /* Already gone after normal exit. */ }
    rmSync(dir, { recursive: true, force: true });
  }
}
