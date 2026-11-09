/**
 * Subcommand: panel (Claude Code side) -- a live copy of the statusline in a
 * terminal pane.
 *
 * Hosts that run Claude Code headless through the Agent SDK `query()` (T3 Code)
 * never execute settings.json `statusLine.command`, so the statusline is
 * invisible there. Those hosts do ship a terminal whose cwd is the thread's
 * project, so `sprag panel` finds the newest transcript for that project and
 * re-renders the real `sprag --statusline` against it every few seconds.
 *
 * `sprag panel --agent codex` is a different panel and never reaches this file.
 */

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { claudeUserDir } from '../paths.js';
import { CLI_ENTRY } from '../cli-entry.js';

const RENDER_TIMEOUT_MS = 4000;
const DEFAULT_INTERVAL_S = 5;
const MIN_INTERVAL_S = 1;
const PASSTHROUGH_FLAGS = ['--no-color', '--icon', '--verbose', '--single-line'];

/**
 * Where Claude Code keeps its config. paths.js claudeUserDir() ignores
 * CLAUDE_CONFIG_DIR, but a host that sets it (Cowork, T3 profiles) writes its
 * transcripts there, so the panel has to look there first.
 */
export function claudeConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || claudeUserDir();
}

/** Claude Code names a project's transcript directory after its cwd, every non-alphanumeric char turned into '-'. */
export function encodeProjectDir(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * The transcript directory for `cwd`. The realpath is tried as well because the
 * terminal may report /tmp while Claude Code recorded /private/tmp (macOS). When
 * neither exists the directory for the given cwd is returned so callers see "no
 * session yet" rather than an error.
 */
export function projectTranscriptDir(cwd, { claudeDir = claudeConfigDir() } = {}) {
  const candidates = [cwd];
  try {
    const real = realpathSync(cwd);
    if (real !== cwd) candidates.push(real);
  } catch { /* cwd may not exist (yet) */ }
  const dirs = candidates.map((c) => join(claudeDir, 'projects', encodeProjectDir(c)));
  return dirs.find((d) => existsSync(d)) || dirs[0];
}

/**
 * The session to show: `session` when pinned, otherwise the newest *.jsonl by
 * mtime. Only files directly in the directory count; subdirectories hold
 * subagent transcripts, which must not displace the main session.
 *
 * @returns {{ sessionId: string, transcriptPath: string | null } | null}
 */
export function latestSession(cwd, { claudeDir = claudeConfigDir(), session } = {}) {
  const dir = projectTranscriptDir(cwd, { claudeDir });
  if (session) {
    const file = join(dir, `${session}.jsonl`);
    return { sessionId: session, transcriptPath: existsSync(file) ? file : null };
  }
  let best = null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const path = join(dir, e.name);
    let mtime;
    try { mtime = statSync(path).mtimeMs; } catch { continue; }
    if (!best || mtime > best.mtime) best = { mtime, path };
  }
  if (!best) return null;
  return { sessionId: basename(best.path, '.jsonl'), transcriptPath: best.path };
}

/**
 * The stdin JSON for one statusline render. Only what the panel knows: an
 * absent field means "no data" to the statusline, a 0 means 0%, so rate limits,
 * model and context are never invented here.
 */
export function panelPayload({ cwd, session }) {
  const payload = { cwd, workspace: { current_dir: cwd, project_dir: cwd } };
  if (session) {
    payload.session_id = session.sessionId;
    if (session.transcriptPath) payload.transcript_path = session.transcriptPath;
  }
  return payload;
}

/** The argv of the child that renders one frame. CLI_ENTRY, never process.argv[1]: under the test runner that is the test file and forks without end. */
export function renderArgs({ cols, passthrough = [], cliEntry = CLI_ENTRY }) {
  return [cliEntry, '--statusline', '--columns', String(cols), ...passthrough];
}

/** Default spawner: run `cmd args` with `input` on stdin, never throw. */
export function defaultSpawner(cmd, args, { input, timeout, cwd }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(cmd, args, { timeout, windowsHide: true, cwd, maxBuffer: 1024 * 1024 },
        (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
    } catch {
      resolve({ ok: false, stdout: '' });
      return;
    }
    child.stdin.on('error', () => { /* the child exited before reading; the callback reports it */ });
    child.stdin.end(input);
  });
}

/** One rendered frame, or null when the render failed or timed out (the caller keeps the last frame). */
export async function renderFrame({
  payload, cols, passthrough = [], spawner = defaultSpawner, execPath = process.execPath,
  cliEntry = CLI_ENTRY, timeoutMs = RENDER_TIMEOUT_MS, cwd,
}) {
  const res = await spawner(execPath, renderArgs({ cols, passthrough, cliEntry }), {
    input: JSON.stringify(payload), timeout: timeoutMs, cwd,
  });
  if (!res || !res.ok) return null;
  const text = String(res.stdout).replace(/\s+$/, '');
  return text === '' ? null : text;
}

/** Repaint only when the frame text changed; a redraw every tick makes the pane flicker. */
export function createScreen(write) {
  let last = null;
  return {
    draw(frame) {
      if (frame === last) return false;
      last = frame;
      write(`\x1b[H\x1b[2J${frame}\n`);
      return true;
    },
  };
}

export const waitingHint = (cwd) => `sprag panel: waiting for a Claude Code session in ${cwd}`;

function passthroughOf(hasFlag) {
  return PASSTHROUGH_FLAGS.filter((f) => hasFlag(f));
}

/**
 * @param {object} p
 * @param {(name: string) => string | undefined} p.getArg
 * @param {(name: string) => boolean} p.hasFlag
 * @param {object} [p.deps] injection points for tests
 */
export async function run({ getArg, hasFlag, deps = {} }) {
  const {
    spawner = defaultSpawner,
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    setTimeoutFn = setTimeout,
    onStop,
  } = deps;
  const write = (s) => stdout.write(s);
  const cwd = getArg('--project') || process.cwd();
  const pinned = getArg('--session') || undefined;
  const claudeDir = claudeConfigDir(env);
  const passthrough = passthroughOf(hasFlag);
  const cols = () => stdout.columns || 120;
  const renderCwd = existsSync(cwd) ? cwd : undefined;

  const intervalRaw = getArg('--interval');
  let intervalS = DEFAULT_INTERVAL_S;
  if (intervalRaw !== undefined) {
    const n = Number(intervalRaw);
    if (!Number.isFinite(n)) throw new Error(`--interval expects a number, got "${intervalRaw}"`);
    intervalS = Math.max(MIN_INTERVAL_S, n);
  }

  const frameFor = async () => {
    const session = latestSession(cwd, { claudeDir, session: pinned });
    const frame = await renderFrame({
      payload: panelPayload({ cwd, session }), cols: cols(), passthrough, spawner, cwd: renderCwd,
    });
    return { session, frame };
  };

  if (hasFlag('--once') || !stdout.isTTY) {
    const { session, frame } = await frameFor();
    if (frame !== null) write(`${frame}\n`);
    if (!session) stderr.write(`${waitingHint(cwd)}\n`);
    else if (frame === null) process.exitCode = 1;
    return;
  }

  const screen = createScreen(write);
  let lastFrame = null;
  let stopped = false;
  let timer = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    write('\x1b[?25h');
    if (onStop) onStop(); else process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  write('\x1b[?25l');

  // The next tick is scheduled only after this one finishes, so a slow render
  // can never stack a second child on top of the first.
  const tick = async () => {
    try {
      const { session, frame } = await frameFor();
      if (frame !== null) lastFrame = frame;
      if (lastFrame !== null) {
        screen.draw(session ? lastFrame : `${lastFrame}\n${waitingHint(cwd)}`);
      } else if (!session) {
        screen.draw(waitingHint(cwd));
      }
    } catch { /* keep the last frame on screen */ }
    if (!stopped) {
      timer = setTimeoutFn(tick, intervalS * 1000);
    }
  };
  await tick();
}
