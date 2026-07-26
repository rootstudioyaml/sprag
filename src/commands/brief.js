/**
 * Subcommand: route-scan — detect recurring easy work on expensive models
 * and propose model-delegation ratchet rules. Zero token cost, fully local.
 *   claude-token-saver route-scan                 # scan (24h cache) + print candidates
 *   claude-token-saver route-scan --refresh       # force rescan
 *   claude-token-saver route-scan --days 30       # wider lookback
 *   claude-token-saver route-scan --hook          # SessionStart hook mode (context injection)
 *   claude-token-saver route-scan dismiss <N>     # mute candidate R<N>
 * Promote a candidate to a ratchet rule (scope is always explicit):
 *   claude-token-saver harness promote R<N> --project|--global
 * brief --hook — UserPromptSubmit hook mode: per-session, change-triggered
 * briefing of state the statusline can only chip (ctx tier crossings,
 * mid-session route/rule-health changes). Silent when nothing changed.
 */

import { readStdinJson } from '../stdin-payload.js';
import { debug } from '../debug.js';

export async function run({ hasFlag }) {
    if (!hasFlag('--hook')) {
      console.error('Usage: claude-token-saver brief --hook   (UserPromptSubmit hook mode)');
      process.exit(1);
    }
    const ctx = readStdinJson() || {};
    try {
      const { runBrief } = await import('../brief.js');
      const out = await runBrief({ sessionId: ctx.session_id, transcriptPath: ctx.transcript_path });
      if (out) console.log(out);
    } catch (e) { debug('brief:hook', e); /* briefing is best-effort — never block a prompt */ }
    return;
}
