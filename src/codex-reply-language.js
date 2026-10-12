import { createRequire } from 'node:module';
import { forkedCopyFilter, codexToolEvents } from './codex-parser.js';

const { checkReplyLanguage } = createRequire(import.meta.url)('./reply-language.cjs');

/** Ignore copied history and commentary; only the current turn's final reply counts. */
export function lastCodexTurn(lines, { turnId, sessionId } = {}) {
  const copied = forkedCopyFilter();
  let prompt = null, reply = '', currentTurn = null;
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (copied(e)) continue;
    const p = e?.payload;
    if (!p) continue;
    if (e.type === 'session_meta' && sessionId && (p.id || p.session_id) !== sessionId) return null;
    if (e.type === 'event_msg' && p.type === 'task_started') {
      currentTurn = p.turn_id;
      prompt = null;
      reply = '';
    }
    for (const ev of codexToolEvents(e)) {
      if (ev.kind !== 'user' || (sessionId && ev.threadId && ev.threadId !== sessionId)) continue;
      currentTurn = ev.turnId || currentTurn;
      prompt = ev.text;
      reply = '';
    }
    if (e.type === 'response_item' && p.type === 'message' && p.role === 'assistant' && p.phase === 'final_answer') {
      reply = (Array.isArray(p.content) ? p.content : []).filter((b) => b?.type === 'output_text' && typeof b.text === 'string').map((b) => b.text).join('\n');
    }
    if (e.type === 'event_msg' && p.type === 'task_complete' && (!p.turn_id || p.turn_id === currentTurn) &&
        typeof p.last_agent_message === 'string') reply = p.last_agent_message;
  }
  if (prompt === null || (turnId && currentTurn !== turnId)) return null;
  return { prompt, reply };
}

export function checkCodexReplyLanguage(payload) {
  return checkReplyLanguage(payload.transcript_path, {
    parseTurn: (lines) => lastCodexTurn(lines, { turnId: payload.turn_id, sessionId: payload.session_id }),
    reply: payload.last_assistant_message,
  });
}
