/**
 * update-check — "is there a newer claude-token-saver?", answered without ever
 * blocking a render.
 *
 * The statusline command runs every ~300ms, so a network call on that path is
 * out of the question. We use the same shape sindresorhus/update-notifier
 * settled on: the foreground only ever READS a cached answer, and when that
 * answer is older than the check interval it spawns a detached, unref'd child
 * that refreshes the cache for the *next* render. Nothing awaits the network.
 *
 * State lives next to the other user-data files:
 *   { checkedAt: <ms>, latest: "3.25.0", current: "3.24.0",
 *     dismissedVersion: "3.25.0"|undefined }
 *
 * Opt out with CTS_NO_UPDATE_CHECK=1 or NO_UPDATE_NOTIFIER (the de-facto
 * standard env var — anyone who set it for other CLIs meant us too).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userDataDir } from './paths.js';
import { debug } from './debug.js';

const PKG_NAME = 'claude-token-saver';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h — the registry is not a health endpoint
const FETCH_TIMEOUT_MS = 5000;

export function updateStatePath() {
  return join(userDataDir(), 'update-check.json');
}

export function updateCheckDisabled() {
  return process.env.CTS_NO_UPDATE_CHECK === '1' || !!process.env.NO_UPDATE_NOTIFIER;
}

export function readUpdateState() {
  try {
    const s = JSON.parse(readFileSync(updateStatePath(), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function writeUpdateState(next) {
  const dir = userDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(updateStatePath(), JSON.stringify(next, null, 2) + '\n');
}

/**
 * Compare two semver-ish strings. Returns true when `a` is strictly newer than
 * `b`. Pre-release tags (`3.25.0-beta.1`) are treated as older than the plain
 * release, which is what we want: we never nudge anyone onto a pre-release.
 */
export function isNewer(a, b) {
  const parse = (v) => {
    const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!m) return null;
    return { nums: [+m[1], +m[2], +m[3]], pre: m[4] || null };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i];
  }
  if (pa.pre && !pb.pre) return false; // 3.25.0-beta < 3.25.0
  if (!pa.pre && pb.pre) return true;
  return false;
}

/**
 * The read-only accessor every render path uses.
 *
 * @returns {{current: string, latest: string|null, available: boolean, dismissed: boolean, stale: boolean}}
 */
export function updateStatus(currentVersion) {
  if (updateCheckDisabled()) {
    return { current: currentVersion, latest: null, available: false, dismissed: false, stale: false };
  }
  const s = readUpdateState();
  const latest = typeof s.latest === 'string' ? s.latest : null;
  const available = !!latest && isNewer(latest, currentVersion);
  const age = Date.now() - (Number(s.checkedAt) || 0);
  return {
    current: currentVersion,
    latest,
    available,
    // A version the user already declined stays out of the statusline and out
    // of the session briefing until a newer one ships — otherwise "no thanks"
    // means "ask me again in five minutes", forever.
    dismissed: available && s.dismissedVersion === latest,
    stale: age >= CHECK_INTERVAL_MS,
  };
}

/**
 * Fire the background refresh when the cached answer has aged out. Returns
 * immediately in every case; the child is detached and unref'd so it cannot
 * hold the statusline process open.
 */
export function maybeSpawnUpdateCheck(currentVersion) {
  if (updateCheckDisabled()) return false;
  const { stale } = updateStatus(currentVersion);
  if (!stale) return false;
  // Stamp the attempt before spawning. Without this, an offline machine
  // re-spawns a doomed child on every single statusline render — several per
  // second — because the cache never gets a fresh timestamp.
  try {
    writeUpdateState({ ...readUpdateState(), checkedAt: Date.now(), current: currentVersion });
  } catch (e) {
    debug('update-check:stamp', e);
    return false;
  }
  try {
    spawn(process.execPath, [cliEntryPath(), 'update-check', '--refresh', '--quiet'], {
      detached: true,
      stdio: 'ignore',
      // Without this Windows flashes a console window, and this one
      // re-spawns from the statusline — several times a minute.
      windowsHide: true,
    }).unref();
    return true;
  } catch (e) {
    debug('update-check:spawn', e);
    return false;
  }
}

/** Path to this package's CLI entry point (bin/cli.js). */
export function cliEntryPath() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
}

/**
 * Actually hit the registry and persist the answer. Only the detached child
 * and the explicit `update-check --refresh` command call this.
 */
export async function refreshUpdateState(currentVersion) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // The `latest` dist-tag endpoint returns a few hundred bytes, unlike the
    // full packument which is megabytes for a package with this many releases.
    const res = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`registry responded ${res.status}`);
    const body = await res.json();
    const latest = typeof body.version === 'string' ? body.version : null;
    if (!latest) throw new Error('registry response carried no version');
    const prev = readUpdateState();
    const next = { ...prev, checkedAt: Date.now(), latest, current: currentVersion };
    // A newly published version clears an older dismissal: the user declined
    // 3.25.0, not "all future upgrades".
    if (prev.dismissedVersion && isNewer(latest, prev.dismissedVersion)) {
      delete next.dismissedVersion;
    }
    writeUpdateState(next);
    return { ok: true, latest };
  } catch (e) {
    debug('update-check:refresh', e);
    // Keep the timestamp fresh even on failure so an offline machine backs off
    // for the full interval instead of retrying on every render.
    try {
      writeUpdateState({ ...readUpdateState(), checkedAt: Date.now(), current: currentVersion });
    } catch (e2) {
      debug('update-check:refresh-stamp', e2);
    }
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Record that the user said "not now" for this exact version. */
export function dismissUpdate(version) {
  const s = readUpdateState();
  writeUpdateState({ ...s, dismissedVersion: version });
}

/**
 * How this copy was installed, and therefore what command upgrades it.
 * Best-effort: the install root is the only reliable signal we have, and when
 * it tells us nothing we fall back to the npm global install, which is how the
 * overwhelming majority of copies got here.
 */
export function upgradeCommand() {
  const here = dirname(fileURLToPath(import.meta.url));
  if (here.includes('/pnpm/')) return `pnpm add -g ${PKG_NAME}@latest`;
  if (here.includes('/.bun/')) return `bun add -g ${PKG_NAME}@latest`;
  if (here.includes('/.yarn/')) return `yarn global add ${PKG_NAME}@latest`;
  return `npm install -g ${PKG_NAME}@latest`;
}

export const UPDATE_CHECK_INTERVAL_MS = CHECK_INTERVAL_MS;
export const PACKAGE_NAME = PKG_NAME;
