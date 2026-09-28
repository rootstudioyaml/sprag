import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { userDataDir } from './paths.js';
import { codexUserDir } from './agent.js';

export function panelStatePath(root, kind, dir = userDataDir(), sessionId) {
  const key = createHash('sha256').update(codexUserDir() + '\0' + resolve(root) + (sessionId ? `\0${sessionId}` : '')).digest('hex');
  return join(dir, `codex-panel-${key}-${kind}.json`);
}

export function recordPanelState(root, kind, value, dir = userDataDir()) {
  try {
    mkdirSync(dir, { recursive: true });
    const file = panelStatePath(root, kind, dir);
    const tmp = `${file}.${process.pid}.tmp`;
    const text = JSON.stringify({ ...value, at: new Date().toISOString() });
    writeFileSync(tmp, text);
    renameSync(tmp, file);
    if (value.sessionId) {
      const sessionFile = panelStatePath(root, kind, dir, value.sessionId);
      const sessionTmp = `${sessionFile}.${process.pid}.tmp`;
      writeFileSync(sessionTmp, text);
      renameSync(sessionTmp, sessionFile);
    }
  } catch { /* Diagnostics must not stop a session or panel. */ }
}

export function readPanelState(root, kind, dir = userDataDir(), sessionId) {
  try { return JSON.parse(readFileSync(panelStatePath(root, kind, dir, sessionId), 'utf8')); }
  catch { return null; }
}

export function panelHealth(root, { now = Date.now(), dir, sessionId } = {}) {
  const hook = readPanelState(root, 'hook', dir, sessionId);
  const frame = readPanelState(root, 'frame', dir, sessionId);
  const age = frame ? now - Date.parse(frame.at) : Infinity;
  const live = frame?.status === 'rendered' && age >= 0 && age < 15000;
  return { hook, frame, live };
}
