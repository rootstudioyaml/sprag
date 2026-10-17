/**
 * cowork-sync: copy the global ratchet files into the folders connected to the
 * Claude desktop app's Cowork tab.
 *
 * Cowork does not read ~/.claude (no hooks, no `@` imports), but it does read
 * `<folder>/.claude/rules/*.md`. So the three global ratchet files are pasted
 * into one tool-owned rules file per connected folder. Claude Code reads the
 * same rules directory, so ~/.claude/settings.json gets a `claudeMdExcludes`
 * entry that keeps Claude Code from loading the copy a second time (Cowork does
 * not read that settings file).
 *
 * Where Cowork keeps its session metadata (macOS verified):
 *   ~/Library/Application Support/Claude-3p/local-agent-mode-sessions/<org>/<user>/local_<id>.json
 * The 1p app is assumed to use ".../Claude/local-agent-mode-sessions" (not
 * verified). Windows is assumed to use %APPDATA%\Claude and %APPDATA%\Claude-3p
 * (not verified). Linux is out of scope.
 *
 * Nothing here throws to the caller: a folder that cannot be written is
 * reported in `skipped`, and the SessionStart hook ignores the whole call on
 * failure.
 */

import {
  existsSync, readFileSync, readdirSync, statSync, realpathSync, mkdirSync, writeFileSync, rmSync,
  appendFileSync,
} from 'node:fs';
import { join, resolve, sep, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { userDataDir, claudeUserDir } from './paths.js';
import { loadConfig, saveConfig, userLanguage } from './config.js';
import { writeStateFile } from './state-file.js';
import { readSettings, writeSettings } from './installer.js';
import { modelRatchetPathFor } from './model-rules.js';
import { presetRatchetPath } from './preset-ratchet.js';
import { teamRatchetPath } from './team-ratchet.js';
import { globalRatchetMdPath } from './harness.js';
import { debug } from './debug.js';

export const COWORK_MARKER = '<!-- sprag:cowork-ratchet -->';
export const COWORK_EXCLUDE_PATTERN = '**/.claude/rules/sprag-cowork-ratchet.md';
const COPY_REL = join('.claude', 'rules', 'sprag-cowork-ratchet.md');
const MAX_PARSE_PER_CALL = 200;

export const coworkStatePath = () => join(userDataDir(), 'cowork-sync.json');

// ---------- config ----------

export function coworkConfig() {
  const c = loadConfig().cowork;
  return {
    sync: !(c && c.sync === false),
    exclude: Array.isArray(c?.exclude) ? c.exclude.filter((x) => typeof x === 'string') : [],
  };
}

export function saveCoworkConfig(patch) {
  const cfg = loadConfig();
  saveConfig({ ...cfg, cowork: { ...coworkConfig(), ...patch } });
}

// ---------- state ----------

export function loadCoworkState() {
  try {
    const s = JSON.parse(readFileSync(coworkStatePath(), 'utf8'));
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      return {
        version: 1,
        scanned: s.scanned && typeof s.scanned === 'object' ? s.scanned : {},
        folders: s.folders && typeof s.folders === 'object' ? s.folders : {},
        written: s.written && typeof s.written === 'object' ? s.written : {},
        ...(typeof s.lastSync === 'string' ? { lastSync: s.lastSync } : {}),
      };
    }
  } catch { /* first run or unreadable: start empty */ }
  return { version: 1, scanned: {}, folders: {}, written: {} };
}

export function saveCoworkState(state) {
  try { writeStateFile(coworkStatePath(), JSON.stringify(state, null, 2) + '\n'); } catch (e) { debug('cowork-sync:save-state', e); }
}

// ---------- discovery ----------

export function coworkSessionRoots() {
  const bases = [];
  if (process.platform === 'darwin') {
    const support = join(homedir(), 'Library', 'Application Support');
    bases.push(join(support, 'Claude'), join(support, 'Claude-3p'));
  } else if (process.platform === 'win32' && process.env.APPDATA) {
    bases.push(join(process.env.APPDATA, 'Claude'), join(process.env.APPDATA, 'Claude-3p'));
  }
  return bases.map((b) => join(b, 'local-agent-mode-sessions')).filter((p) => existsSync(p));
}

function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(dir, e.name));
  } catch { return []; }
}

/** local_*.json exactly three levels under a root: <org>/<user>/local_*.json */
function sessionMetaFiles(root) {
  const out = [];
  for (const org of subdirs(root)) {
    for (const user of subdirs(org)) {
      let names;
      try { names = readdirSync(user); } catch { continue; }
      for (const n of names) {
        if (n.startsWith('local_') && n.endsWith('.json')) out.push(join(user, n));
      }
    }
  }
  return out;
}

/**
 * Parse only the metadata files whose mtime changed since the last call (at
 * most 200 per call, newest first; the rest wait for the next call) and add
 * the folders they name to `state.folders`. Folders are never forgotten.
 */
export function discoverCoworkFolders({ state = loadCoworkState() } = {}) {
  const now = new Date().toISOString();
  const seen = {};
  const changed = [];
  for (const root of coworkSessionRoots()) {
    for (const file of sessionMetaFiles(root)) {
      let mtime;
      try { mtime = statSync(file).mtimeMs; } catch { continue; }
      seen[file] = mtime;
      if (state.scanned[file] !== mtime) changed.push({ file, mtime });
    }
  }
  changed.sort((a, b) => b.mtime - a.mtime);
  const nextScanned = {};
  // Unchanged files keep their mark; changed ones are marked only once handled,
  // so the ones beyond the cap are picked up by the next call.
  for (const [file, mtime] of Object.entries(seen)) {
    if (state.scanned[file] === mtime) nextScanned[file] = mtime;
  }
  for (const { file, mtime } of changed.slice(0, MAX_PARSE_PER_CALL)) {
    nextScanned[file] = mtime;
    let meta;
    try { meta = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    const list = Array.isArray(meta?.userSelectedFolders) ? meta.userSelectedFolders : [];
    for (const f of list) {
      if (typeof f !== 'string' || !f) continue;
      const rec = state.folders[f];
      state.folders[f] = { firstSeen: rec?.firstSeen || now, lastSeen: now };
    }
  }
  state.scanned = nextScanned;
  return Object.keys(state.folders);
}

// ---------- eligibility ----------

function real(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

const isInside = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** @returns {{ ok: boolean, reason?: string, dir?: string }} `dir` is the real path when ok */
export function eligibleFolder(dir) {
  if (typeof dir !== 'string' || !isAbsolute(dir)) return { ok: false, reason: 'not-absolute' };
  let st;
  try { st = statSync(dir); } catch { return { ok: false, reason: 'missing' }; }
  if (!st.isDirectory()) return { ok: false, reason: 'not-a-directory' };
  const rd = real(dir);
  const home = real(homedir());
  if (rd === home || isInside(home, rd)) return { ok: false, reason: 'home-or-ancestor' };
  if (isInside(rd, real(claudeUserDir()))) return { ok: false, reason: 'inside-claude-dir' };
  if (process.platform === 'darwin' && isInside(rd, real(join(homedir(), 'Library')))) return { ok: false, reason: 'inside-library' };
  if (isInside(rd, real(userDataDir()))) return { ok: false, reason: 'inside-sprag-data' };
  for (const ex of coworkConfig().exclude) {
    if (isInside(rd, real(ex))) return { ok: false, reason: 'excluded' };
  }
  return { ok: true, dir: rd };
}

export const coworkCopyPath = (dir) => join(dir, COPY_REL);

// ---------- content ----------

/** @returns {string|null} null when none of the source files exists */
export function renderCoworkRatchet(lang = userLanguage()) {
  const ko = lang === 'ko';
  const parts = [];
  for (const file of [modelRatchetPathFor('global'), presetRatchetPath(), teamRatchetPath(), globalRatchetMdPath()]) {
    let body;
    try { body = readFileSync(file, 'utf8'); } catch { continue; }
    const name = file.split(/[\\/]/).pop();
    parts.push(`## ${ko ? '원본' : 'Source'}: ~/.claude/${name}\n\n${body.trim()}\n`);
  }
  if (parts.length === 0) return null;
  const intro = ko
    ? '이 파일은 sprag가 Claude 앱 Cowork 탭용으로 생성한 래칫 사본입니다. Cowork는 ~/.claude 의 설정과 import를 읽지 않으므로, 원본 래칫 파일들의 본문을 여기에 옮겨 둡니다. sprag가 원본이 바뀔 때마다 이 파일을 통째로 다시 쓰므로 직접 고치지 마십시오. Claude Code(Code 탭)는 settings.json 의 claudeMdExcludes 로 이 파일을 읽지 않습니다.'
    : 'This file is a copy of the ratchet rules that sprag generates for the Cowork tab of the Claude app. Cowork does not read the settings or imports under ~/.claude, so the bodies of the source ratchet files are copied here. sprag rewrites this whole file whenever a source changes, so do not edit it by hand. Claude Code (the Code tab) skips this file through claudeMdExcludes in settings.json.';
  return `${COWORK_MARKER}\n${intro}\n\n${parts.join('\n')}`;
}

function firstLine(file) {
  const raw = readFileSync(file, 'utf8');
  const i = raw.indexOf('\n');
  return (i === -1 ? raw : raw.slice(0, i)).replace(/\r$/, '').trim();
}

const isOwned = (file) => { try { return firstLine(file) === COWORK_MARKER; } catch { return false; } };

// ---------- git exclude ----------

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], {
  timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8',
}).trim();

function addGitExclude(dir) {
  try {
    if (git(dir, ['rev-parse', '--is-inside-work-tree']) !== 'true') return;
    const rel = COPY_REL.split(sep).join('/');
    try { git(dir, ['check-ignore', '-q', rel]); return; } catch { /* exit 1: not ignored yet */ }
    const excludeFile = resolve(dir, git(dir, ['rev-parse', '--git-path', 'info/exclude']));
    const prefix = git(dir, ['rev-parse', '--show-prefix']);
    const line = `/${prefix}${rel}`;
    let existing = '';
    try { existing = readFileSync(excludeFile, 'utf8'); } catch { /* new file */ }
    if (existing.split(/\r?\n/).includes(line)) return;
    mkdirSync(resolve(excludeFile, '..'), { recursive: true });
    appendFileSync(excludeFile, `${existing && !existing.endsWith('\n') ? '\n' : ''}${line}\n`);
  } catch (e) {
    debug('cowork-sync:git-exclude', e);
  }
}

// ---------- settings.json (Code tab de-dup) ----------

const settingsFile = () => join(claudeUserDir(), 'settings.json');

function ensureClaudeMdExclude() {
  const file = settingsFile();
  const read = readSettings(file);
  if (read.state !== 'ok' && read.state !== 'absent') return;
  const cur = read.settings.claudeMdExcludes;
  if (cur !== undefined && !Array.isArray(cur)) return; // not ours to reshape
  if (cur && cur.includes(COWORK_EXCLUDE_PATTERN)) return;
  read.settings.claudeMdExcludes = [...(cur || []), COWORK_EXCLUDE_PATTERN];
  const problem = writeSettings(file, read.settings);
  if (problem) debug('cowork-sync:settings-write', problem);
}

function dropClaudeMdExclude() {
  const file = settingsFile();
  const read = readSettings(file);
  if (read.state !== 'ok') return;
  const cur = read.settings.claudeMdExcludes;
  if (!Array.isArray(cur) || !cur.includes(COWORK_EXCLUDE_PATTERN)) return;
  const next = cur.filter((x) => x !== COWORK_EXCLUDE_PATTERN);
  if (next.length) read.settings.claudeMdExcludes = next;
  else delete read.settings.claudeMdExcludes;
  const problem = writeSettings(file, read.settings);
  if (problem) debug('cowork-sync:settings-write', problem);
}

// ---------- sync / remove ----------

export function syncCoworkRatchets({ discover = true, agent = 'claude' } = {}) {
  const result = { written: [], unchanged: [], skipped: [], removed: [] };
  if (agent === 'codex') return result;
  try {
    if (!coworkConfig().sync) return removeCoworkRatchets();
    const state = loadCoworkState();
    if (discover) {
      try { discoverCoworkFolders({ state }); } catch (e) { debug('cowork-sync:discover', e); }
    }
    const content = renderCoworkRatchet();
    for (const folder of Object.keys(state.folders)) {
      try {
        const el = eligibleFolder(folder);
        if (!el.ok) { result.skipped.push({ dir: folder, reason: el.reason }); continue; }
        if (content === null) { result.skipped.push({ dir: folder, reason: 'no-source' }); continue; }
        const target = coworkCopyPath(el.dir);
        if (existsSync(target)) {
          if (!isOwned(target)) { result.skipped.push({ dir: folder, reason: 'not-owned' }); continue; }
          if (readFileSync(target, 'utf8') === content) {
            result.unchanged.push(folder);
            state.written[target] = state.written[target] || { at: new Date().toISOString() };
            continue;
          }
        }
        mkdirSync(join(el.dir, '.claude', 'rules'), { recursive: true });
        writeFileSync(target, content);
        state.written[target] = { at: new Date().toISOString() };
        result.written.push(folder);
        addGitExclude(el.dir);
      } catch (e) {
        result.skipped.push({ dir: folder, reason: `error: ${e?.message || e}` });
      }
    }
    if (result.written.length || result.unchanged.length) {
      try { ensureClaudeMdExclude(); } catch (e) { debug('cowork-sync:settings', e); }
    }
    state.lastSync = new Date().toISOString();
    saveCoworkState(state);
  } catch (e) {
    debug('cowork-sync:sync', e);
  }
  return result;
}

/** Remove the copy in one folder (only when it carries our marker). */
export function removeCoworkRatchetIn(dir) {
  const candidates = new Set([coworkCopyPath(dir), coworkCopyPath(real(dir))]);
  let removed = false;
  const state = loadCoworkState();
  for (const target of candidates) {
    try {
      if (existsSync(target) && isOwned(target)) { rmSync(target, { force: true }); removed = true; }
    } catch (e) { debug('cowork-sync:remove-one', e); }
    delete state.written[target];
  }
  saveCoworkState(state);
  return removed;
}

export function removeCoworkRatchets() {
  const result = { written: [], unchanged: [], skipped: [], removed: [] };
  try {
    const state = loadCoworkState();
    const targets = new Set(Object.keys(state.written));
    for (const folder of Object.keys(state.folders)) targets.add(coworkCopyPath(folder));
    for (const target of targets) {
      try {
        if (existsSync(target) && isOwned(target)) {
          rmSync(target, { force: true });
          result.removed.push(resolve(target, '..', '..', '..'));
        }
      } catch (e) {
        result.skipped.push({ dir: target, reason: `error: ${e?.message || e}` });
      }
    }
    state.written = {};
    saveCoworkState(state);
    try { dropClaudeMdExclude(); } catch (e) { debug('cowork-sync:settings', e); }
  } catch (e) {
    debug('cowork-sync:remove', e);
  }
  return result;
}

/** Per-folder view for `sprag cowork`. */
export function coworkStatus() {
  const state = loadCoworkState();
  const cfg = coworkConfig();
  const folders = Object.keys(state.folders).map((dir) => {
    const el = eligibleFolder(dir);
    const copy = coworkCopyPath(el.ok ? el.dir : dir);
    const there = existsSync(copy);
    return { dir, eligible: el.ok, reason: el.reason, hasCopy: there && isOwned(copy), foreign: there && !isOwned(copy) };
  });
  return { enabled: cfg.sync, exclude: cfg.exclude, lastSync: state.lastSync || null, folders };
}
