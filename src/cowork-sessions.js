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
 * assumed, as in cowork-sync.js. Leaf module: node: builtins, ./parser.js and
 * ./paths.js only, so cowork-sync.js can import it without a cycle.
 */

import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseAllSessions, listSubagentFiles, dedupeSessionFiles } from './parser.js';
import { userDataDir } from './paths.js';

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
 * Best-effort: an unreadable directory is skipped.
 */
export async function discoverCoworkSessionFiles({ days = 30, roots = coworkSessionRoots(), now = Date.now() } = {}) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const files = [];
  for (const root of roots) {
    for (const org of await subdirNames(root)) {
      for (const account of await subdirNames(join(root, org))) {
        for (const session of await subdirNames(join(root, org, account))) {
          const projectsDir = join(root, org, account, session, '.claude', 'projects');
          for (const project of await subdirNames(projectsDir)) {
            const projectPath = join(projectsDir, project);
            let entries;
            try {
              entries = await readdir(projectPath);
            } catch {
              continue;
            }
            for (const name of entries) {
              if (!name.endsWith('.jsonl')) continue;
              try {
                const fp = join(projectPath, name);
                const s = await stat(fp);
                if (!s.isFile() || s.mtimeMs < cutoff) continue;
                const file = { path: fp, projectDir: 'cowork', mtime: s.mtimeMs, size: s.size };
                const subagentFiles = await listSubagentFiles(join(projectPath, name.slice(0, -'.jsonl'.length)), 'cowork', cutoff);
                if (subagentFiles.length) file.subagentFiles = subagentFiles;
                files.push(file);
              } catch {
                continue;
              }
            }
          }
        }
      }
    }
  }
  // Transcript names are uuids, so this only collapses a copied session folder.
  return dedupeSessionFiles(files).sort((a, b) => a.mtime - b.mtime);
}

/** Parsed Cowork sessions, marked `surface: 'cowork'`. */
export async function parseCoworkSessions({ days = 30, roots } = {}) {
  const sessions = await parseAllSessions({
    days,
    files: await discoverCoworkSessionFiles({ days, roots }),
    cachePath: join(userDataDir(), 'cowork-session-cache.json'),
  });
  for (const s of sessions) s.surface = 'cowork';
  return sessions;
}
