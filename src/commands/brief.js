/**
 * Subcommand: route-scan — detect recurring easy work on expensive models
 * and propose model-delegation ratchet rules. Zero token cost, fully local.
 *   sprag route-scan                 # scan (24h cache) + print candidates
 *   sprag route-scan --refresh       # force rescan
 *   sprag route-scan --days 30       # wider lookback
 *   sprag route-scan --hook          # SessionStart hook mode (context injection)
 *   sprag route-scan dismiss <N>     # mute candidate R<N>
 * Promote a candidate to a ratchet rule (scope is always explicit):
 *   sprag harness promote R<N> --global|--project
 * brief --hook — UserPromptSubmit hook mode: per-session, change-triggered
 * briefing of state the statusline can only chip (ctx tier crossings,
 * mid-session route/rule-health changes). Silent when nothing changed.
 */

import { readStdinJson } from '../stdin-payload.js';
import { debug } from '../debug.js';

export async function run({ hasFlag }) {
    if (!hasFlag('--hook')) {
      console.error('Usage: sprag brief --hook   (UserPromptSubmit hook mode)');
      process.exit(1);
    }
    const ctx = readStdinJson() || {};
    const parts = [];
    try {
      const { runBrief } = await import('../brief.js');
      const out = await runBrief({ sessionId: ctx.session_id, transcriptPath: ctx.transcript_path });
      if (out) parts.push(out);
    } catch (e) { debug('brief:hook', e); /* briefing is best-effort — never block a prompt */ }
    // State the matching delegation rule as a fact about this request. Registered
    // rules were going unused because applying one meant scanning a list and
    // resolving it against a general "don't spawn subagents" instruction; naming
    // the match here removes both steps. Silent unless it is sure — see
    // src/route-inject.js.
    try {
      const { routeHint } = await import('../route-inject.js');
      const hint = routeHint(ctx.prompt);
      if (hint) parts.push(hint);
    } catch (e) { debug('brief:route-hint', e); }
    if (parts.length) console.log(parts.join('\n'));
    return;
}
