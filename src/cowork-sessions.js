/**
 * cowork-sessions: read the Claude Code transcripts the Claude desktop app's
 * Cowork tab writes.
 *
 * Cowork runs Claude Code with a per-session CLAUDE_CONFIG_DIR, so its
 * transcripts never land in ~/.claude/projects. They sit inside the session
 * folder instead:
 *   <root>/<org>/<account>/<session>/.claude/projects/<project>/<uuid>.jsonl
 * with subagents at `<project>/<uuid>/subagents/agent-*.jsonl`. The session
 * folder also holds uploads, outputs and audit logs (gigabytes), so discovery
 * walks exactly that depth and never recurses freely.
 *
 * This is a separate module, used only by the team upload (daily spend). The
 * statusline, route-scan and the ledger do not read Cowork, matching the
 * 2026-10-13 decision to keep delegation out of Cowork. Its parse cache is a
 * separate file so thousands of transcripts never bloat session-cache.json.
 *
 * The macOS path is verified; the Windows and 1p (".../Claude") paths are
 * assumed, as in cowork-sync.js. Leaf module: it imports only node: builtins and
 * ./paths.js. The parser loads on demand inside the functions that need it, so
 * cowork-sync.js (SessionStart hook) can import coworkSessionRoots without pulling
 * in the parser graph, and without a cycle.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { userDataDir } from './paths.js';

// Sessions scanned at once; each scan is a few readdirs and stats.
const DISCOVER_BATCH = 16;

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

/** Names of the subdirectories of `dir`; unreadable means none. */
async function subdirNames(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Transcripts modified within `days`, in the shape discoverSessionFiles returns.
 * Only <root>/<org>/<account>/<session> is walked here; each session's own projects
 * directory goes through discoverSessionFiles, so Cowork follows every discovery rule
 * of Claude Code. Best-effort: an unreadable directory is skipped.
 */
export async function discoverCoworkSessionFiles({ days = 30, roots = coworkSessionRoots(), now = Date.now() } = {}) {
  const { discoverSessionFiles, dedupeSessionFiles } = await import('./parser.js');
  const projectsDirs = [];
  for (const root of roots) {
    for (const org of await subdirNames(root)) {
      for (const account of await subdirNames(join(root, org))) {
        for (const session of await subdirNames(join(root, org, account))) {
          projectsDirs.push(join(root, org, account, session, '.claude', 'projects'));
        }
      }
    }
  }
  const files = [];
  for (let i = 0; i < projectsDirs.length; i += DISCOVER_BATCH) {
    const batch = await Promise.all(projectsDirs.slice(i, i + DISCOVER_BATCH).map((root) => discoverSessionFiles({ root, days, now })));
    for (const found of batch) files.push(...found);
  }
  // Transcript names are uuids, so this only collapses a copied session folder.
  return dedupeSessionFiles(files).sort((a, b) => a.mtime - b.mtime);
}

/** Parsed Cowork sessions, marked `surface: 'cowork'`. */
export async function parseCoworkSessions({ days = 30, roots } = {}) {
  const { parseAllSessions } = await import('./parser.js');
  const sessions = await parseAllSessions({
    days,
    files: await discoverCoworkSessionFiles({ days, roots }),
    cachePath: join(userDataDir(), 'cowork-session-cache.json'),
  });
  for (const s of sessions) s.surface = 'cowork';
  return sessions;
}
