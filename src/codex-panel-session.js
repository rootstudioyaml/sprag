import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function createPanelBinding(file) {
  writeFileSync(file, JSON.stringify({ version: 1, sessionId: null, transcriptPath: null }), { mode: 0o600 });
}

export function readPanelBinding(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data.version !== 1) return null;
    if (typeof data.sessionId !== 'string' || !data.sessionId.trim()) return null;
    return { sessionId: data.sessionId,
      transcriptPath: typeof data.transcriptPath === 'string' && isAbsolute(data.transcriptPath) ? data.transcriptPath : null };
  } catch { return null; }
}

// The inline runner uses --no-daemon so this path belongs to this Codex process,
// not an environment inherited by a shared server from a different terminal.
export function bindPanelSession(event, payload, { file = process.env.SPRAG_CODEX_PANEL_BINDING } = {}) {
  if (!file || !['session-start', 'panel-start'].includes(event)) return false;
  if (!['startup', 'resume', 'clear', 'compact'].includes(payload?.source)) return false;
  if (typeof payload.session_id !== 'string' || !payload.session_id.trim()) return false;
  try {
    // Never recreate a binding after its launcher has exited and cleaned up.
    const current = JSON.parse(readFileSync(file, 'utf8'));
    if (current.version !== 1) return false;
    if (payload.source === 'compact' && current.sessionId && current.sessionId !== payload.session_id) return false;
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, sessionId: payload.session_id,
      transcriptPath: typeof payload.transcript_path === 'string' && isAbsolute(payload.transcript_path) ? payload.transcript_path : null }), { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch { return false; }
}
