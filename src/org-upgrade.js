/**
 * The organization minimum version: the one case where a hook starts an
 * install without asking.
 *
 * The sprag operator sets a minimum version per organization in the ops
 * console. The rules pull stores it in team.json as `minVersion`. A session
 * start on a machine below it starts `sprag upgrade --org-policy` detached and
 * tells the model that it did, so the member hears about it without being
 * asked and without the model installing anything itself. Everyone else keeps
 * the consent-only offer in update-notice.js.
 *
 * org-upgrade.json (in the user data dir) is the record both sides share:
 * `{ target, from, startedAt, pid, finishedAt, ok, error, announced }`. The
 * statusline and the hooks import this module, so it stays on node builtins
 * and small leaf modules; the runner that installs lives in
 * src/commands/upgrade.js.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { isNewer } from './update-check.js';
import { isDetachedChild, spawnDetachedCli } from './cli-entry.js';
import { readTeamState, isJoined } from './team-ratchet.js';
import { debug } from './debug.js';

/** A running attempt older than this is treated as dead, whatever its pid says. */
export const ORG_UPGRADE_INFLIGHT_MS = 30 * 60 * 1000;
/** After an attempt ends, this long before the next session starts another. */
export const ORG_UPGRADE_RETRY_MS = 60 * 60 * 1000;

const MIN_VERSION_RE = /^\d+\.\d+\.\d+$/;

/** 'X.Y.Z' when the server sent a usable minimum, else null. */
export function parseMinVersion(v) {
  return typeof v === 'string' && MIN_VERSION_RE.test(v.trim()) ? v.trim() : null;
}

export const orgUpgradePath = (dir = userDataDir()) => join(dir, 'org-upgrade.json');
export const orgUpgradeLogPath = (dir = userDataDir()) => join(dir, 'org-upgrade.log');

export function readOrgUpgrade(dir = userDataDir()) {
  try {
    const s = JSON.parse(readFileSync(orgUpgradePath(dir), 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the record and return the result. */
export function writeOrgUpgrade(patch, dir = userDataDir()) {
  const next = { ...readOrgUpgrade(dir), ...patch };
  writeStateFile(orgUpgradePath(dir), JSON.stringify(next, null, 2) + '\n');
  return next;
}

/** The organization's minimum for a joined member, or null. */
export function orgMinVersion(state) {
  return isJoined(state) ? parseMinVersion(state.minVersion) : null;
}

/** The version the machine must reach, or null when it already meets the minimum or none is set. */
export function orgUpgradeTarget(version, state) {
  const min = orgMinVersion(state);
  return min && isNewer(min, version) ? min : null;
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

/** Whether an attempt is running now: unfinished, recent, and its process (once known) alive. */
export function orgUpgradeInFlight(rec, { now = Date.now(), isAlive = pidAlive } = {}) {
  if (!rec || rec.finishedAt || !Number.isFinite(rec.startedAt)) return false;
  if (now - rec.startedAt >= ORG_UPGRADE_INFLIGHT_MS) return false;
  return rec.pid == null || isAlive(rec.pid);
}

/** A copy running from a git checkout is a developer's; it must never replace itself. */
export function isDevCheckout(root = dirname(dirname(fileURLToPath(import.meta.url)))) {
  return existsSync(join(root, '.git'));
}

/**
 * Start the background upgrade when the policy calls for one. Returns
 * `{ status, target }` with status one of: none (nothing required), child
 * (this process is itself detached), dev, in-flight, cooldown, started,
 * spawn-failed.
 */
export function maybeStartOrgUpgrade(version, {
  agent = 'claude', env = process.env, now = Date.now(), dir = userDataDir(), spawn, root, state, isAlive,
} = {}) {
  const target = orgUpgradeTarget(version, state || readTeamState(dir));
  if (!target) return { status: 'none', target: null };
  if (isDetachedChild(env)) return { status: 'child', target };
  if (isDevCheckout(root)) return { status: 'dev', target };
  const rec = readOrgUpgrade(dir);
  if (orgUpgradeInFlight(rec, { now, isAlive })) return { status: 'in-flight', target };
  // Any attempt that ended inside the last hour also holds off the next: a
  // failure for the reason below, and a success that left this copy below the
  // minimum because the install went to a different copy than the one running.
  if (Number.isFinite(rec.finishedAt) && now - rec.finishedAt < ORG_UPGRADE_RETRY_MS) return { status: 'cooldown', target };
  writeOrgUpgrade({
    target, from: version, startedAt: now, pid: null, finishedAt: null, ok: null, error: null, announced: false,
  }, dir);
  let started = false;
  try {
    started = spawnDetachedCli(['upgrade', '--org-policy', '--agent', agent], { env, ...(spawn ? { spawn } : {}) });
  } catch (e) {
    debug('org-upgrade:spawn', e);
    writeOrgUpgrade({ finishedAt: now, ok: false, error: `could not start: ${e && e.message ? e.message : e}`, announced: false }, dir);
    return { status: 'spawn-failed', target };
  }
  if (!started) {
    writeOrgUpgrade({ finishedAt: now, ok: false, error: 'could not start the background upgrade', announced: false }, dir);
    return { status: 'spawn-failed', target };
  }
  return { status: 'started', target };
}

/**
 * One short block for the session context, or null. Informational only: it
 * never tells the model to install anything. A success or failure is reported
 * once (`announced`), at the first session that can see it.
 */
export function orgUpgradeNotice(version, { lang = 'en', status, dir = userDataDir() } = {}) {
  const ko = lang === 'ko';
  try {
    if (status && status.status === 'started') {
      return ko
        ? `[sprag 조직 정책] 조직 정책에 따라 최소 버전 v${status.target} 가 필요해 백그라운드에서 업그레이드를 시작했습니다. 다음 세션부터 새 버전이 적용됩니다.`
        : `[sprag org policy] The organization requires at least v${status.target}, so an upgrade was started in the background. The new version applies from the next session.`;
    }
    const rec = readOrgUpgrade(dir);
    if (rec.announced || !rec.target || !Number.isFinite(rec.finishedAt)) return null;
    if (rec.ok === true && !isNewer(rec.target, version)) {
      writeOrgUpgrade({ announced: true }, dir);
      return ko
        ? `[sprag 조직 정책] 조직 최소 버전 v${rec.target} 로의 업그레이드가 끝났습니다. 현재 v${version} 가 실행 중입니다.`
        : `[sprag org policy] The upgrade to the organization minimum v${rec.target} finished. Running v${version}.`;
    }
    if (rec.ok === false && isNewer(rec.target, version)) {
      writeOrgUpgrade({ announced: true }, dir);
      const reason = String(rec.error || 'unknown').slice(0, 200);
      return ko
        ? `[sprag 조직 정책] 조직 최소 버전 v${rec.target} 로의 자동 업그레이드가 실패했습니다: ${reason}. 사용자에게 알리고 sprag upgrade 를 직접 실행하도록 안내하십시오.`
        : `[sprag org policy] The automatic upgrade to the organization minimum v${rec.target} failed: ${reason}. Tell the user to run sprag upgrade themselves.`;
    }
  } catch (e) {
    debug('org-upgrade:notice', e);
  }
  return null;
}

/**
 * What the session-start offer asks first. `{ text }` means the org policy
 * owns this session's answer (text may be null: say nothing and skip the
 * consent offer); null means it has nothing to say and today's offer applies.
 */
export function orgPolicyOffer(version, { agent = 'claude', lang = 'en', dir = userDataDir(), ...opts } = {}) {
  try {
    const state = readTeamState(dir);
    const status = maybeStartOrgUpgrade(version, { agent, dir, state, ...opts });
    if (status.status === 'none') {
      const text = orgUpgradeNotice(version, { lang, dir });
      return text ? { text } : null;
    }
    // A dev checkout and a detached child keep today's behaviour.
    if (status.status === 'child' || status.status === 'dev') return null;
    return { text: orgUpgradeNotice(version, { lang, status, dir }) };
  } catch (e) {
    debug('org-upgrade:offer', e);
    return null;
  }
}
