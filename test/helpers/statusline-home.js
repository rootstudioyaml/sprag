/**
 * A throwaway HOME for tests that drive `bin/cli.js --statusline` end to end.
 *
 * The statusline's data assembly lives inline in bin/cli.js, which runs on load
 * and cannot be imported, so a formatter test alone passes whether or not the
 * entry point hands the formatter a given field. These tests spawn the real CLI
 * instead; this module is the part they share: a sandbox HOME, transcripts
 * (with subagent runs) the parser will pick up, and one function that renders.
 *
 * Everything lives under a realpath'd temp directory. On macOS os.tmpdir() is a
 * symlink (/var -> /private/var) and the CLI reports its cwd through the real
 * path, so a fixture path built from the symlink would never compare equal to
 * what the tool derives from it.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { childEnv } from './child-env.js';

const CLI = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));

export const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

/**
 * @returns {{ dir: string, project: string, dataDir: string, cleanup: () => void }}
 *   `project` is an empty directory to use as the CLI's cwd, `dataDir` is where
 *   the tool keeps its state files (XDG_CONFIG_HOME/claude-token-saver).
 */
export function makeHome(prefix = 'sprag-sl-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  mkdirSync(join(dir, '.claude', 'projects'), { recursive: true });
  const project = join(dir, 'proj');
  mkdirSync(project, { recursive: true });
  const dataDir = join(dir, 'cfg', 'claude-token-saver');
  mkdirSync(dataDir, { recursive: true });
  return { dir, project, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let seq = 0;
function usageEntry({ sessionId, model, ts = Date.now() }) {
  seq += 1;
  return JSON.stringify({
    requestId: `req-${seq}`,
    timestamp: new Date(ts).toISOString(),
    sessionId,
    message: {
      id: `msg-${seq}`,
      model,
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1000,
        output_tokens: 5,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 },
      },
    },
  }) + '\n';
}

/**
 * Write one session transcript plus a subagent transcript per entry of
 * `subagents` (each a model id), the way Claude Code lays them out:
 * `<project>/<sessionId>.jsonl` and `<project>/<sessionId>/subagents/agent-N.jsonl`.
 *
 * @returns {string} the path of the main transcript
 */
export function writeSession(home, { project = '-tmp-proj', sessionId, model = 'claude-opus-5', subagents = [] }) {
  const projDir = join(home.dir, '.claude', 'projects', project);
  mkdirSync(projDir, { recursive: true });
  const main = join(projDir, `${sessionId}.jsonl`);
  writeFileSync(main, usageEntry({ sessionId, model }));
  if (subagents.length) {
    const subDir = join(projDir, sessionId, 'subagents');
    mkdirSync(subDir, { recursive: true });
    subagents.forEach((m, i) => {
      writeFileSync(join(subDir, `agent-${i}.jsonl`), usageEntry({ sessionId: `${sessionId}-sub${i}`, model: m }));
    });
  }
  return main;
}

/**
 * Run `sprag --statusline` against the sandbox and return the visible text.
 *
 * @param {object} home makeHome() result
 * @param {object} [payload] the JSON Claude Code would pipe on stdin
 * @param {object} [opts]
 * @param {string[]} [opts.args] extra flags, e.g. ['--verbose']
 * @param {string} [opts.cwd] defaults to the sandbox's empty project directory
 * @param {object} [opts.env] extra environment, `undefined` removes a key
 */
export function renderStatusline(home, payload = {}, { args = [], cwd = home.project, env = {} } = {}) {
  return strip(execFileSync(process.execPath, [CLI, '--statusline', '--no-color', ...args], {
    cwd,
    env: childEnv({
      HOME: home.dir,
      XDG_CONFIG_HOME: join(home.dir, 'cfg'),
      APPDATA: join(home.dir, 'cfg'),
      NO_COLOR: '1',
      // Update checks would otherwise try the network in a sandbox whose state
      // file says it is due. A case about the update chip supplies a fresh
      // state file and does not need this.
      CTS_NO_UPDATE_CHECK: '1',
      ...env,
    }),
    input: JSON.stringify(payload),
    encoding: 'utf8',
  }));
}
