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
      // `root` is the session's cwd for the same reason routeHint takes it below:
      // the settings that name the model and the compaction window are the
      // project's, not those of whatever directory the hook was spawned in.
      const out = await runBrief({ sessionId: ctx.session_id, transcriptPath: ctx.transcript_path, root: ctx.cwd || process.cwd() });
      if (out) parts.push(out);
    } catch (e) { debug('brief:hook', e); /* briefing is best-effort — never block a prompt */ }
    // State the matching delegation rule as a fact about this request. Registered
    // rules were going unused because applying one meant scanning a list and
    // resolving it against a general "don't spawn subagents" instruction; naming
    // the match here removes both steps. Silent unless it is sure — see
    // src/route-inject.js.
    try {
      const { routeHint, routeMatch, matchCaps, sessionModelRank } = await import('../route-inject.js');
      // The payload names the session but not its model, so the rank comes from
      // the transcript: without it a Sonnet session is told to delegate to
      // Sonnet, which saves nothing.
      const sessionRank = sessionModelRank({ transcriptPath: ctx.transcript_path });
      // `root` is the session's own cwd, not this process's. agentPhrase names the
      // subagent only where `<root>/.claude/agents/<name>.md` exists, and with no
      // root that lookup falls back to process.cwd() — whatever directory the hook
      // was spawned in, which stops being the project root as soon as the two
      // differ. Claude Code sends `cwd` for that reason and the PreToolUse hook
      // already reads it (src/delegation-guard.js). A payload without the field
      // leaves root undefined, which is the behaviour this had before.
      const match = routeMatch(ctx.prompt, { sessionRank });
      const hint = routeHint(ctx.prompt, { sessionRank, root: ctx.cwd, match });
      if (hint) parts.push(hint);
      // The delegation guard repeats these caps to the subagent, so the limit it
      // works under is the one this hint states. A prompt with no match clears
      // the record of the turn before it.
      try {
        const { recordRouteCaps } = await import('../route-caps.js');
        recordRouteCaps(ctx.session_id, matchCaps(match));
      } catch (e) { debug('brief:route-caps', e); }
    } catch (e) { debug('brief:route-hint', e); }
    if (parts.length) console.log(parts.join('\n'));
    return;
}
