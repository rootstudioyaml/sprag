/**
 * permission-secrets — secrets that "don't ask again" left in approval lists.
 *
 * Claude Code stores an approved command verbatim in permissions.allow of
 * .claude/settings.local.json. A command that carried a password or token
 * therefore keeps it on disk, and a project whose settings file is committed
 * publishes it (Apiiro found 1,122 public GitHub files this way, 2026-11-05).
 *
 * This module reads the four settings files (home and project, shared and
 * local), reports which approval entries hold something findSecrets flags, and
 * removes allow/ask entries on request. It never prints a value: previews go
 * through maskPreview. An entry is deleted, not rewritten, because a repaired
 * command could permit a different command than the one the user approved.
 * deny entries stay: they block, and a blocked secret-bearing command is harmless.
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync, realpathSync, rmSync, chmodSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { findSecrets, maskPreview } from './redact.js';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { writePrivateFile } from './private-file.js';
import { debug } from './debug.js';

export const PERMISSION_LISTS = ['allow', 'ask', 'deny'];
const GIT_TIMEOUT_MS = 2000;
const STATE_FILE = 'secret-scan-state.json';

/** The settings files worth reading, home first. A file reached twice (cwd is the home directory) appears once. */
export function settingsTargets({ home = homedir(), root = null } = {}) {
  const out = [];
  const seen = new Set();
  const add = (dir, name, scope) => {
    const path = join(dir, '.claude', name);
    let key = path;
    try { key = realpathSync(path); } catch { /* not there: keep the plain path */ }
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path, scope, name });
  };
  add(home, 'settings.json', 'home');
  add(home, 'settings.local.json', 'home');
  if (root) {
    add(root, 'settings.json', 'project');
    add(root, 'settings.local.json', 'project');
  }
  return out;
}

function readJson(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Entries of one settings file that hold something that looks like a secret.
 * @returns {{ path: string, mtimeMs: number, entries: { list: string, index: number, kinds: string[], preview: string }[] } | null}
 *   null when the file is missing or unreadable; `entries` is empty for a clean file
 */
export function scanSettingsFile(path) {
  if (!existsSync(path)) return null;
  const json = readJson(path);
  if (!json) return null;
  const perms = json.permissions;
  const entries = [];
  if (perms && typeof perms === 'object') {
    for (const list of PERMISSION_LISTS) {
      if (!Array.isArray(perms[list])) continue;
      perms[list].forEach((item, i) => {
        if (typeof item !== 'string') return;
        const hits = findSecrets(item);
        if (!hits.length) return;
        entries.push({
          list,
          index: i + 1,
          kinds: [...new Set(hits.map((h) => h.kind))],
          preview: maskPreview(item, 100),
        });
      });
    }
  }
  let mtimeMs = 0;
  try { mtimeMs = statSync(path).mtimeMs; } catch { /* the entries are still valid */ }
  return { path, mtimeMs, entries };
}

/** Run git without a shell. Returns the exit status, or null when git cannot answer (missing, timed out). */
function gitStatus(args, cwd) {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore', timeout: GIT_TIMEOUT_MS });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' ? e.status : null;
  }
}

/**
 * Whether git tracks `file` (a secret in a tracked file is one commit away from
 * public, or already is) and whether it is ignored.
 * @returns {{ tracked: boolean, ignored: boolean | null } | null} null when git is unavailable or the folder is no repository
 */
export function gitState(file, { withIgnore = true } = {}) {
  const cwd = dirname(file);
  const tracked = gitStatus(['ls-files', '--error-unmatch', '--', basename(file)], cwd);
  if (tracked === null || tracked > 1) return null; // 128: not a repository
  let ignored = null;
  if (withIgnore) {
    const status = gitStatus(['check-ignore', '-q', '--', basename(file)], cwd);
    ignored = status === 0 ? true : status === 1 ? false : null;
  }
  return { tracked: tracked === 0, ignored };
}

/**
 * Scan every settings file for the given project.
 * Project files with hits also get their git state; `withIgnore: false` skips the
 * second git call (the session hook only needs to know whether a file is tracked).
 */
export function scanPermissionSecrets({ home = homedir(), root = null, withIgnore = true } = {}) {
  const results = [];
  for (const target of settingsTargets({ home, root })) {
    const scan = scanSettingsFile(target.path);
    if (!scan) continue;
    const git = target.scope === 'project' && scan.entries.length ? gitState(target.path, { withIgnore }) : null;
    results.push({ ...target, ...scan, git });
  }
  return results;
}

/** Where `sprag secrets fix` keeps the original before it changes a file. */
export function backupPathFor(file, { dir = userDataDir(), now = new Date() } = {}) {
  const folder = join(dir, 'backups', now.toISOString().replace(/[:.]/g, '-'));
  mkdirSync(folder, { recursive: true });
  let target = join(folder, basename(file));
  // home and project both have a settings.local.json
  for (let n = 2; existsSync(target); n += 1) target = join(folder, `${basename(file)}.${n}`);
  return target;
}

/**
 * Remove the flagged allow/ask entries from one settings file.
 * The original is saved first (owner-only) and the rest of the JSON is kept as it was.
 * @returns {{ removed: number, backup: string|null, error?: string }}
 */
export function fixSettingsFile(path, { dir = userDataDir(), now = new Date() } = {}) {
  const raw = readFileSync(path, 'utf8');
  const json = JSON.parse(raw);
  const perms = json?.permissions;
  let removed = 0;
  if (perms && typeof perms === 'object') {
    for (const list of ['allow', 'ask']) {
      if (!Array.isArray(perms[list])) continue;
      const kept = perms[list].filter((item) => !(typeof item === 'string' && findSecrets(item).length > 0));
      removed += perms[list].length - kept.length;
      perms[list] = kept;
    }
  }
  if (!removed) return { removed: 0, backup: null };

  const backup = backupPathFor(path, { dir, now });
  writePrivateFile(backup, raw);

  // Same shape as installer.writeSettings (temp file + rename, mode kept, symlink followed),
  // minus its .sprag-bak sidecar: that copy would put the secret right back beside the file.
  let target = path;
  let mode;
  try { target = realpathSync(path); mode = statSync(target).mode & 0o777; } catch { /* write to the plain path */ }
  const tmp = `${target}.sprag-tmp-${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(json, null, 2) + '\n', mode === undefined ? undefined : { mode });
    if (mode !== undefined) { try { chmodSync(tmp, mode); } catch { /* mode is best effort */ } }
    renameSync(tmp, target);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    return { removed: 0, backup, error: e.message };
  }
  return { removed, backup };
}

// ---------------------------------------------------------------------------
// Session start notice
// ---------------------------------------------------------------------------

const statePath = (dir) => join(dir, STATE_FILE);

function loadNoticeState(dir) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(dir), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const shortPath = (p, home) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);

export function noticeLine({ file, n, tracked, lang }) {
  if (lang === 'ko') {
    return `✇ [sprag] ${file} 의 승인 목록 ${n}개 항목에 비밀 값으로 보이는 문자열이 있습니다${tracked ? '. 이 파일은 git이 추적하고 있어 커밋되면 공개될 수 있습니다' : ''}. 사용자에게 알리고 sprag secrets 로 확인한 뒤 sprag secrets fix 로 지우라고 안내하십시오.`;
  }
  return `✇ [sprag] ${n} entries in the permission list of ${file} look like they hold secrets${tracked ? ', and git tracks this file, so a commit would publish them' : ''}. Tell the user, and suggest sprag secrets to review them and sprag secrets fix to remove them.`;
}

/**
 * The line(s) the session start hook shows when a settings file holds secrets, or null.
 * A file is announced once per modification time: the same file at the same mtime
 * stays quiet on later sessions, and editing it (adding an entry, or fixing it) re-arms the check.
 * Cheap on purpose: four JSON reads, plus one `git ls-files` per project file that has hits.
 */
export function secretsNotice({
  home = homedir(), root = null, lang = 'en', dir = userDataDir(), enabled = true,
} = {}) {
  if (!enabled) return null;
  const state = loadNoticeState(dir);
  const lines = [];
  let changed = false;
  for (const f of scanPermissionSecrets({ home, root, withIgnore: false })) {
    if (!f.entries.length) {
      if (state[f.path] !== undefined) { delete state[f.path]; changed = true; }
      continue;
    }
    if (state[f.path] === f.mtimeMs) continue;
    lines.push(noticeLine({ file: shortPath(f.path, home), n: f.entries.length, tracked: f.git?.tracked === true, lang }));
    state[f.path] = f.mtimeMs;
    changed = true;
  }
  if (changed) {
    try { writeStateFile(statePath(dir), JSON.stringify(state) + '\n'); } catch (e) { debug('permission-secrets:state', e); }
  }
  return lines.length ? lines.join('\n') : null;
}
