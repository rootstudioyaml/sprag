/**
 * The script a detached child of this CLI must run.
 *
 * The preset sync and the two team syncs start a detached child to do their
 * network work, and they used to pass `process.argv[1]` as its script. Inside
 * the CLI that is bin/cli.js. Inside anything else that imports these modules
 * it is that caller's script: under `node --test` a test file relaunched
 * itself, detached, on every session-start case, and each copy did the same.
 * 4,055 processes in 59 seconds on 2026-10-20, and three memory-exhaustion
 * stalls in two days. So the entry is fixed here from this module's own
 * location, and a spawned child carries a marker that refuses to spawn again.
 */
import * as childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { envVar } from './env.js';

export const CLI_ENTRY = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

/** The marker a detached child carries; read through envVar('DETACHED_CHILD'). */
export const DETACHED_CHILD_VAR = 'SPRAG_DETACHED_CHILD';

export function isDetachedChild(env = process.env) {
  return envVar('DETACHED_CHILD', env) === '1';
}

/** The environment for a detached child: the caller's, plus the marker. */
export function detachedChildEnv(env = process.env) {
  return { ...env, [DETACHED_CHILD_VAR]: '1' };
}

/**
 * Start `sprag <args>` detached, never awaited, never from a detached child.
 * Returns true when a child was started. Every background refresh goes
 * through here so that no caller can name the script itself.
 */
export function spawnDetachedCli(args, { env = process.env, spawn = childProcess.spawn, execPath = process.execPath } = {}) {
  if (isDetachedChild(env)) return false;
  spawn(execPath, [CLI_ENTRY, ...args], { detached: true, stdio: 'ignore', windowsHide: true, env: detachedChildEnv(env) }).unref();
  return true;
}
