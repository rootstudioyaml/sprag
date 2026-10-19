/**
 * preset-sync — fetch the centrally published preset bundle.
 *
 * Read-only and anonymous: two RPC calls to the same Supabase project the team
 * layer uses, with the public anon key and no member key, so the request is all
 * that leaves the machine. `presets_version()` is polled first because it is a
 * few bytes; `presets_published()` is fetched only when the version moved.
 *
 * Cadence: at most once every 24 hours, from a detached child spawned on the
 * SessionStart path (the same pattern as the update check and the team sync),
 * so a session never waits on the network. The attempt is stamped before the
 * spawn, so an offline machine does not spawn a doomed child every session.
 *
 * A fetched bundle is stored only when this CLI would apply it (see
 * presets-source.js evaluateBundle). A rejected one is recorded with its reason
 * so `sprag presets status` can say why the bundled presets are still in use.
 *
 * Opt out with SPRAG_NO_PRESET_SYNC=1 or SPRAG_NO_UPDATE_CHECK=1.
 */

import * as childProcess from 'node:child_process';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { debug } from './debug.js';
import {
  cliVersion, evaluateBundle, presetSyncDisabled, readRemoteCache, remoteCachePath, resetPresetSourceMemo,
} from './presets-source.js';
import { PRESET_SIGNING_KEYS } from './preset-sign.js';

export const PRESET_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

function writeCache(cache, dir) {
  writeStateFile(remoteCachePath(dir), JSON.stringify(cache, null, 2) + '\n');
  resetPresetSourceMemo();
}

/** Due when the last attempt (success or not) is 24 hours old, or there was none. */
export function presetSyncDue(cache, now = Date.now()) {
  const at = Number(cache && cache.checkedAt);
  return !Number.isFinite(at) || at <= 0 || now - at >= PRESET_SYNC_INTERVAL_MS || now < at;
}

export function nextPresetCheckAt(cache) {
  const at = Number(cache && cache.checkedAt);
  return Number.isFinite(at) && at > 0 ? at + PRESET_SYNC_INTERVAL_MS : null;
}

/**
 * Called on session start. Never awaits the network. Returns true when a child
 * was spawned.
 */
export function spawnPresetSyncIfDue({
  env = process.env, now = Date.now(), dir = userDataDir(),
  spawn = childProcess.spawn, argv = process.argv, execPath = process.execPath,
} = {}) {
  if (presetSyncDisabled(env)) return false;
  const cache = readRemoteCache(dir);
  if (!presetSyncDue(cache, now)) return false;
  try {
    writeCache({ ...cache, checkedAt: now }, dir);
  } catch (e) {
    debug('preset-sync:stamp', e);
    return false;
  }
  try {
    spawn(execPath, [argv[1], 'presets', 'sync', '--background'],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch (e) {
    debug('preset-sync:spawn', e);
    return false;
  }
}

/**
 * Fetch now. Returns { status, version?, reason? } where status is
 *   'disabled' | 'none' (nothing published) | 'current' (cached version is the
 *   published one) | 'updated' | 'rejected' | 'error'
 * `force` refetches the bundle even when the version did not move.
 */
export async function syncPresets({
  env = process.env, now = Date.now(), dir = userDataDir(), fetch, force = false,
  version = cliVersion(), keys = PRESET_SIGNING_KEYS,
} = {}) {
  if (presetSyncDisabled(env)) return { status: 'disabled' };
  const { rpc, teamApiUrl, teamAnonKey } = await import('./team-sync.js');
  const call = (fn) => rpc(fn, {}, { fetch, url: teamApiUrl(env), key: teamAnonKey(env) });
  const cache = readRemoteCache(dir);
  const base = { ...cache, checkedAt: now };
  // The cached bundle counts only while it still verifies: after a key rotation
  // the same version has to be fetched again rather than skipped as current.
  const cachedOk = cache.bundle && evaluateBundle(cache.bundle, { version, keys }).ok;
  const have = cachedOk ? cache.bundle.version : 0;
  try {
    const head = await call('presets_version');
    if (!head || !Number.isInteger(head.version)) {
      writeCache({ ...base, lastError: null }, dir);
      return { status: 'none' };
    }
    if (!force && head.version === have) {
      writeCache({ ...base, lastError: null }, dir);
      return { status: 'current', version: have };
    }
    if (!force && cache.rejected && cache.rejected.version === head.version && cache.rejected.cli === version
        && cache.rejected.keys === keys.length) {
      writeCache({ ...base, lastError: null }, dir);
      return { status: 'rejected', version: head.version, reason: cache.rejected.reason };
    }
    const bundle = await call('presets_published');
    if (!bundle) {
      writeCache({ ...base, lastError: null }, dir);
      return { status: 'none' };
    }
    if (Number.isInteger(bundle.version) && bundle.version < have) {
      const rejected = { version: bundle.version, reason: 'older', at: now, cli: version, keys: keys.length };
      writeCache({ ...base, rejected, lastError: null }, dir);
      return { status: 'rejected', version: bundle.version, reason: 'older' };
    }
    const ev = evaluateBundle(bundle, { version, keys });
    if (!ev.ok) {
      const rejected = { version: Number.isInteger(bundle.version) ? bundle.version : null, reason: ev.reason, at: now, cli: version, keys: keys.length };
      writeCache({ ...base, rejected, lastError: null }, dir);
      return { status: 'rejected', version: rejected.version, reason: ev.reason };
    }
    writeCache({ checkedAt: now, fetchedAt: now, version: bundle.version, bundle, rejected: null, lastError: null }, dir);
    return { status: 'updated', version: bundle.version };
  } catch (e) {
    debug('preset-sync', e);
    writeCache({ ...base, lastError: { message: String(e && e.message || e).slice(0, 200), at: now } }, dir);
    return { status: 'error', reason: String(e && e.message || e) };
  }
}
