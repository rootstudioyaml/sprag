/**
 * The macOS menu bar app: where it lives, when it is compiled, and how it is
 * started and stopped.
 *
 * The package ships the Swift source (mac/SpragBar.swift) and never a binary.
 * The first session on a Mac with the Xcode command line tools compiles it
 * once per sprag version into <dataDir>/bar/<version>/sprag-bar and starts it.
 * `sprag bar off` turns the whole thing off, and `sprag bar on` brings it back.
 * Starting the app also writes a launcher, ~/Applications/Sprag Bar.app, a shell
 * script bundle that runs `sprag bar on`, so Spotlight, Launchpad and Finder can
 * bring the app back without a terminal.
 *
 * Every outside effect goes through an injectable dependency (run, spawn, kill,
 * exists, clock, dataDir, version), so the tests start no process and touch no
 * real folder. Every read of a state file tolerates a missing or corrupt file.
 */

import * as childProcess from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_ENTRY, DETACHED_CHILD_VAR, isDetachedChild, spawnDetachedCli } from './cli-entry.js';
import { loadConfig, saveConfig } from './config.js';
import { envVar } from './env.js';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';

export const BAR_SOURCE = fileURLToPath(new URL('../mac/SpragBar.swift', import.meta.url));

const PKG_VERSION = createRequire(import.meta.url)('../package.json').version;

/** A build lock older than this is a crashed build. */
export const LOCK_STALE_MS = 10 * 60 * 1000;
/** A failed build of this source is not retried at session start for this long. */
export const BUILD_RETRY_MS = 24 * 60 * 60 * 1000;
const BUILD_TIMEOUT_MS = 5 * 60 * 1000;
/** Compile errors that a second try fixes. A build that failed this way is not held back for a day. */
const TRANSIENT_ERROR = /was modified during the build/i;
const ERROR_TAIL = 600;
const BINARY_NAME = 'sprag-bar';

export const LAUNCHER_NAME = 'Sprag Bar.app';
export const LAUNCHER_ID = 'io.sprag.bar-launcher';
const LAUNCHER_EXECUTABLE = 'sprag-bar-launcher';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
/** What LaunchServices does not hand to an app it starts, and the app's data and config folders depend on. */
const LAUNCHER_ENV_KEYS = ['XDG_CONFIG_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'];

/** The bar is on unless the user ran `sprag bar off`. */
export function barEnabled(cfg = loadConfig()) {
  return cfg?.bar !== false;
}

/** Off stores `bar: false`; on removes the key so the default applies again. */
export function setBarEnabled(on) {
  const cfg = loadConfig();
  if (on) delete cfg.bar;
  else cfg.bar = false;
  saveConfig(cfg);
}

const buildIds = new Map();

/**
 * What a compiled copy is keyed by: the first 12 hex digits of the source's
 * hash, not the sprag version. sprag ships often and the app changes rarely, so
 * keying by version would spend half a minute compiling and restart the app on
 * every upgrade for nothing. An unreadable source falls back to the version.
 */
export function barBuildId(source = BAR_SOURCE) {
  if (!buildIds.has(source)) {
    let id = PKG_VERSION;
    try { id = createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 12); } catch { /* keep the version */ }
    buildIds.set(source, id);
  }
  return buildIds.get(source);
}

/** `version` is the build id above; the name is kept because the app's pid file calls it that. */
export function barPaths({ dataDir = userDataDir(), version = barBuildId(), appsDir, home } = {}) {
  const dir = join(dataDir, 'bar');
  const apps = appsDir ?? join(home ?? homedir(), 'Applications');
  return {
    appsDir: apps,
    launcher: join(apps, LAUNCHER_NAME),
    dataDir,
    dir,
    version,
    binary: join(dir, version, BINARY_NAME),
    pidFile: join(dataDir, 'bar-app.json'),
    buildState: join(dataDir, 'bar-build.json'),
    buildLock: join(dataDir, 'bar-build.lock'),
  };
}

/** Run a command to completion. Never throws: a missing program is a non-zero status. */
function defaultRun(cmd, args, opts = {}) {
  const r = childProcess.spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  return {
    status: r.error ? (r.status ?? -1) : r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    error: r.error ?? null,
  };
}

const runOf = (deps) => deps.run ?? defaultRun;
const existsOf = (deps) => deps.exists ?? existsSync;
const clockOf = (deps) => deps.clock ?? Date.now;
const killOf = (deps) => deps.kill ?? ((pid, signal) => process.kill(pid, signal));

function readJson(file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** The last build result, or null when none was recorded or the file is unreadable. */
export function readBuildState(deps = {}) {
  return readJson(barPaths(deps).buildState);
}

function writeBuildState(paths, state) {
  try { writeStateFile(paths.buildState, `${JSON.stringify(state)}\n`); } catch { /* the state only throttles retries */ }
}

/**
 * The compiler, or null. `xcode-select -p` runs first and alone: when the
 * command line tools are missing, a bare `swiftc` or `xcrun` pops up a system
 * install dialog on the user's screen, so neither runs unless it succeeds.
 */
export function findSwiftc(deps = {}) {
  const run = runOf(deps);
  const sel = run('xcode-select', ['-p']);
  if (sel.error || sel.status !== 0) return null;
  const found = run('xcrun', ['--find', 'swiftc']);
  if (found.error || found.status !== 0) return null;
  const path = String(found.stdout ?? '').trim();
  return path && existsOf(deps)(path) ? path : null;
}

/** The running app, `{ pid, version }`, or null when the pid file is missing, unreadable or stale. */
export function barRunning(deps = {}) {
  const info = readJson(barPaths(deps).pidFile);
  const pid = info?.pid;
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    killOf(deps)(pid, 0);
  } catch {
    return null;
  }
  return { pid, version: typeof info.version === 'string' ? info.version : null };
}

/** SIGTERM to the running app, only after `ps` confirms the pid is still a sprag-bar. True when a signal went out. */
export function stopBar(deps = {}) {
  const running = barRunning(deps);
  if (!running) return false;
  const ps = runOf(deps)('ps', ['-p', String(running.pid), '-o', 'comm=']);
  if (ps.error || ps.status !== 0) return false;
  if (basename(String(ps.stdout ?? '').trim()) !== BINARY_NAME) return false;
  try {
    killOf(deps)(running.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

/** Age of the build lock in ms, or null when there is none. */
function lockAge(paths, now) {
  try {
    return now - statSync(paths.buildLock).mtimeMs;
  } catch {
    return null;
  }
}

function takeLock(paths, now) {
  mkdirSync(paths.dataDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(paths.buildLock, String(process.pid), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      const age = lockAge(paths, now);
      if (age !== null && age < LOCK_STALE_MS) return false;
      try { rmSync(paths.buildLock, { force: true }); } catch { /* the retake below fails and reports it */ }
    }
  }
  return false;
}

function pruneOtherVersions(paths) {
  try {
    for (const entry of readdirSync(paths.dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== paths.version) {
        rmSync(join(paths.dir, entry.name), { recursive: true, force: true });
      }
    }
  } catch { /* leftovers are only disk space */ }
}

/**
 * Compile the Swift source for this version, in the foreground of this process.
 * Returns `{ ok, ms, error }`, or `{ ok: false, skipped: 'building' }` when
 * another build holds a fresh lock.
 */
export function buildBar(deps = {}) {
  const paths = barPaths(deps);
  const clock = clockOf(deps);
  const started = clock();
  if (!takeLock(paths, started)) return { ok: false, skipped: 'building' };
  try {
    const swiftc = findSwiftc(deps);
    if (!swiftc) {
      writeBuildState(paths, { version: paths.version, ok: false, at: clock(), ms: 0, error: 'no-toolchain' });
      return { ok: false, ms: 0, error: 'no-toolchain' };
    }
    const folder = join(paths.dir, paths.version);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const tmp = `${paths.binary}.tmp-${process.pid}`;
    // swiftc reads a copy of the source. `npm install -g` of the same version rewrites the package's
    // SpragBar.swift with the same bytes and a new mtime, and swiftc fails a build whose input changed while it
    // ran ("was modified during the build"). The copy sits in its own folder so it keeps its file name.
    const srcDir = join(folder, `src-${process.pid}`);
    const srcCopy = join(srcDir, basename(BAR_SOURCE));
    let error = null;
    let transient = false;
    try {
      rmSync(srcDir, { recursive: true, force: true });
      mkdirSync(srcDir, { recursive: true, mode: 0o700 });
      copyFileSync(deps.source ?? BAR_SOURCE, srcCopy);
    } catch (e) {
      // The package folder can be missing for a moment while npm swaps it, so the next session tries again.
      error = `could not copy the source: ${String(e?.message ?? e)}`;
      transient = true;
    }
    if (!error) {
      // The compiler inside the toolchain cannot find the SDK when run by its full path ("unable to load standard
      // library"). /usr/bin/swiftc is the system's front door to the same compiler and sets the SDK up. Running it is
      // safe here: findSwiftc has just confirmed developer tools are installed, so it cannot pop the install dialog.
      const compiler = existsOf(deps)('/usr/bin/swiftc') ? '/usr/bin/swiftc' : swiftc;
      const r = runOf(deps)(compiler, ['-O', '-swift-version', '5', srcCopy, '-o', tmp], {
        timeout: BUILD_TIMEOUT_MS, stdio: 'pipe', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      });
      if (r.error) error = r.error.code === 'ETIMEDOUT' ? 'timeout after 5 minutes' : String(r.error.message ?? r.error);
      else if (r.status !== 0) error = String(r.stderr ?? '').trim().slice(-ERROR_TAIL) || `swiftc exited with status ${r.status}`;
      if (error && TRANSIENT_ERROR.test(error)) transient = true;
    }
    try { rmSync(srcDir, { recursive: true, force: true }); } catch { /* a stray copy is only disk space */ }
    if (!error) {
      try {
        renameSync(tmp, paths.binary);
        chmodSync(paths.binary, 0o755);
      } catch (e) {
        error = String(e?.message ?? e).slice(-ERROR_TAIL);
      }
    }
    if (error) {
      try { rmSync(tmp, { force: true }); } catch { /* a stray temp file is only disk space */ }
      error = error.slice(-ERROR_TAIL);
    }
    const ms = clock() - started;
    writeBuildState(paths, { version: paths.version, ok: !error, at: clock(), ms, error, ...(transient ? { transient: true } : {}) });
    if (!error) pruneOtherVersions(paths);
    return { ok: !error, ms, error, ...(transient ? { transient: true } : {}) };
  } finally {
    try { rmSync(paths.buildLock, { force: true }); } catch { /* a stale lock expires by itself */ }
  }
}

/**
 * The environment the app starts with: the caller's, minus what marks a Claude
 * Code session. The app attributes processes to Claude sessions by those
 * variables, so an app that inherited them would count itself as that
 * session's own work, and later as a leftover of a session that has ended.
 * The detached-child marker goes too, or the app's own `sprag` calls would
 * refuse to start background work.
 */
export function barChildEnv(env = process.env) {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (key.startsWith('CLAUDE_CODE_')) delete out[key];
  }
  for (const key of ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT', DETACHED_CHILD_VAR]) {
    delete out[key];
  }
  return out;
}

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const xmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * The two files of the launcher bundle. Opening the bundle runs `sprag bar on`.
 * LaunchServices starts it without the user's shell environment, so the folders
 * that decide where sprag keeps its data and finds Claude's settings are written
 * into the script. A launcher without them would turn on a bar that reads other folders.
 */
export function launcherFiles({ execPath, cliEntry, env = {}, version }) {
  const exportLines = LAUNCHER_ENV_KEYS
    .filter((key) => typeof env?.[key] === 'string' && env[key] !== '')
    .map((key) => `export ${key}=${shQuote(env[key])}`);
  const script = [
    '#!/bin/sh',
    '# Written by sprag. Opening Sprag Bar runs `sprag bar on`, which turns the menu bar app on and starts it.',
    ...exportLines,
    `exec ${shQuote(execPath)} ${shQuote(cliEntry)} bar on`,
    '',
  ].join('\n');
  const entries = [
    ['CFBundleIdentifier', `<string>${xmlEscape(LAUNCHER_ID)}</string>`],
    ['CFBundleName', '<string>Sprag Bar</string>'],
    ['CFBundleDisplayName', '<string>Sprag Bar</string>'],
    ['CFBundleExecutable', `<string>${LAUNCHER_EXECUTABLE}</string>`],
    ['CFBundlePackageType', '<string>APPL</string>'],
    ['CFBundleShortVersionString', `<string>${xmlEscape(version)}</string>`],
    ['LSUIElement', '<true/>'],
  ];
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...entries.flatMap(([key, value]) => [`  <key>${key}</key>`, `  ${value}`]),
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
  return { plist, script };
}

function launcherFilePaths(paths) {
  return {
    plist: join(paths.launcher, 'Contents', 'Info.plist'),
    script: join(paths.launcher, 'Contents', 'MacOS', LAUNCHER_EXECUTABLE),
  };
}

/** The text of a file, or null when it cannot be read. */
function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

/**
 * Write ~/Applications/Sprag Bar.app so Spotlight, Launchpad and Finder can start the app again.
 * Never throws. Returns 'created', 'updated', 'unchanged', 'foreign' (a bundle or file of that name
 * that is not ours is left alone), 'not-mac' or 'error'.
 */
export function installLauncher(deps = {}) {
  try {
    if ((deps.platform ?? process.platform) !== 'darwin') return 'not-mac';
    const paths = barPaths(deps);
    const files = launcherFilePaths(paths);
    if (existsSync(paths.launcher) && !statSync(paths.launcher).isDirectory()) return 'foreign';
    const oldPlist = readText(files.plist);
    if (oldPlist !== null && !oldPlist.includes(LAUNCHER_ID)) return 'foreign';
    const want = launcherFiles({
      execPath: deps.execPath ?? process.execPath,
      cliEntry: deps.cliEntry ?? CLI_ENTRY,
      env: deps.env ?? process.env,
      version: PKG_VERSION,
    });
    let executable = false;
    try { executable = (statSync(files.script).mode & 0o111) !== 0; } catch { /* a missing script is rewritten */ }
    if (oldPlist === want.plist && readText(files.script) === want.script && executable) return 'unchanged';
    mkdirSync(join(paths.launcher, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(files.plist, want.plist);
    writeFileSync(files.script, want.script);
    chmodSync(files.script, 0o755);
    if (oldPlist !== null) return 'updated';
    // A new bundle is registered once so Spotlight and Launchpad list it without waiting for their own scan.
    try { runOf(deps)(LSREGISTER, ['-f', paths.launcher]); } catch { /* the bundle works without it */ }
    return 'created';
  } catch {
    return 'error';
  }
}

/** Delete the launcher, only when its Info.plist names our bundle id. True when it was deleted. Never throws. */
export function removeLauncher(deps = {}) {
  try {
    const paths = barPaths(deps);
    const plist = readText(launcherFilePaths(paths).plist);
    if (plist === null || !plist.includes(LAUNCHER_ID)) return false;
    rmSync(paths.launcher, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Start the compiled app detached from this process. The caller has checked the binary exists. */
export function launchBar(deps = {}) {
  const paths = barPaths(deps);
  // The launcher is a convenience: a failure to write it never keeps the app from starting.
  try { installLauncher(deps); } catch { /* the app starts regardless */ }
  const spawn = deps.spawn ?? childProcess.spawn;
  const child = spawn(paths.binary, [
    '--node', deps.execPath ?? process.execPath,
    '--cli', deps.cliEntry ?? CLI_ENTRY,
    '--data-dir', paths.dataDir,
    '--version-tag', paths.version,
  ], { detached: true, stdio: 'ignore', windowsHide: true, env: barChildEnv(deps.env ?? process.env) });
  // A failed start (the binary vanished, no execute bit) must not become an unhandled error event.
  if (typeof child.on === 'function') child.on('error', () => {});
  child.unref();
}

/**
 * Whether the recorded build state keeps session start from compiling this build.
 * A compile that failed is not retried for a day. A missing toolchain is looked for again every time: the check
 * costs one short command, and installing the tools should bring the app at the next session. A transient failure
 * (the source changed or vanished while a reinstall of the package rewrote it) is tried again at the next session.
 */
function buildHeldBack(state, version, now) {
  return Boolean(state && state.version === version && state.ok === false && state.error !== 'no-toolchain'
    && state.transient !== true && Number.isFinite(state.at) && now - state.at < BUILD_RETRY_MS);
}

/**
 * The line a session start prints when a failed compile holds the app back, or null when nothing does.
 * Without it the only place the failure shows is `sprag bar status`, which nobody opens while the app is missing.
 */
export function barBuildBlockedNotice({ lang = 'en', now = Date.now(), ...deps } = {}) {
  const paths = barPaths(deps);
  const state = readBuildState(deps);
  if (!buildHeldBack(state, paths.version, now)) return null;
  const hours = Math.max(1, Math.ceil((state.at + BUILD_RETRY_MS - now) / 3_600_000));
  return lang === 'ko'
    ? `✇ [sprag] Sprag Bar 컴파일이 실패해서 앞으로 ${hours}시간 동안 세션을 시작해도 다시 컴파일하지 않습니다. 지금 다시 하려면 \`sprag bar build --then-launch\` 를 실행하십시오. 오류는 \`sprag bar status\` 에 나옵니다. 사용자에게 이 내용을 한 줄로 알리십시오.`
    : `✇ [sprag] The Sprag Bar compile failed, so sessions will not compile it again for the next ${hours}h. Run \`sprag bar build --then-launch\` to try now; \`sprag bar status\` shows the error. Tell the user this in one line.`;
}

/**
 * Session start: make sure the app is running, building it first when needed.
 * Returns why it did what it did and never throws. 'started', 'restarted' and
 * 'running' mean the app is up; 'building' means a background build will start it.
 */
export function ensureBar({ platform = process.platform, env = process.env, cfg, now = Date.now(), ...deps } = {}) {
  try {
    if (platform !== 'darwin') return 'not-mac';
    if (isDetachedChild(env)) return 'child';
    if (envVar('NO_BAR', env) === '1') return 'off';
    if (!barEnabled(cfg)) return 'off';
    const d = { ...deps, env, platform };
    const paths = barPaths(d);
    let restart = false;
    const running = barRunning(d);
    if (running) {
      if (running.version === paths.version) {
        // An app that stays up across upgrades would otherwise never get the launcher, or a launcher naming a new node.
        installLauncher(d);
        return 'running';
      }
      stopBar(d);
      restart = true;
    }
    if (existsOf(d)(paths.binary)) {
      launchBar(d);
      return restart ? 'restarted' : 'started';
    }
    const state = readBuildState(d);
    if (buildHeldBack(state, paths.version, now)) return 'build-failed';
    const age = lockAge(paths, now);
    if (age !== null && age < LOCK_STALE_MS) return 'building';
    if (!findSwiftc(d)) {
      writeBuildState(paths, { version: paths.version, ok: false, at: now, ms: 0, error: 'no-toolchain' });
      return 'no-toolchain';
    }
    (d.spawnCli ?? spawnDetachedCli)(['bar', 'build', '--then-launch'], { env });
    return 'building';
  } catch {
    return 'error';
  }
}

/** Uninstall: stop the app and delete everything this module wrote under the data directory, and the launcher. */
export function removeBarFiles(deps = {}) {
  const paths = barPaths(deps);
  try { stopBar(deps); } catch { /* the files go regardless */ }
  removeLauncher(deps);
  for (const target of [paths.dir, paths.pidFile, paths.buildState, paths.buildLock]) {
    try { rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
