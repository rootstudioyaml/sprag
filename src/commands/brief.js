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
 * brief --hook-tool — PostToolUse hook mode: counts the direct lookups of a
 * turn that carried a delegation hint and nudges once (src/route-follow.js),
 * and reminds once about delegating after three files edited directly (src/impl-follow.js).
 */

import { readStdinJson } from '../stdin-payload.js';
import { debug } from '../debug.js';
import { routingEnabled, delegationGrade, isRelaxed } from '../routing-switch.js';

export async function run({ hasFlag }) {
    if (hasFlag('--hook-tool')) {
      // PostToolUse: a nudge is context for the model, so it goes out as
      // hookSpecificOutput; nothing is printed when there is nothing to say.
      // Two followers see the same payload (lookups after a hint, edits without
      // a delegation); their notices go out as one context block.
      const payload = readStdinJson() || {};
      const notes = [];
      try {
        const { followToolUse } = await import('../route-follow.js');
        const nudge = followToolUse(payload);
        if (nudge) notes.push(nudge);
      } catch (e) { debug('brief:hook-tool', e); }
      try {
        const { implFollowToolUse } = await import('../impl-follow.js');
        const nudge = implFollowToolUse(payload);
        if (nudge) notes.push(nudge);
      } catch (e) { debug('brief:hook-tool-impl', e); }
      if (notes.length) {
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n\n') } }));
      }
      return;
    }
    if (!hasFlag('--hook')) {
      console.error('Usage: sprag brief --hook   (UserPromptSubmit hook mode)\n       sprag brief --hook-tool   (PostToolUse hook mode)');
      process.exit(1);
    }
    const ctx = readStdinJson() || {};
    const parts = [];
    // Team prompt upload (Enterprise, opt-in): a stat-light gate, the work runs in a detached child.
    try { (await import('../team-ratchet.js')).spawnTeamSyncOnPrompt(); } catch (e) { debug('brief:team-prompts', e); }
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
    // Master switch off (`sprag routing off`): no hint, and the records of the
    // previous turn are cleared so the PostToolUse nudge and the delegation
    // guard do not act on a hint that is no longer shown.
    const routingOn = routingEnabled();
    if (!routingOn) {
      try {
        const { clearFollow } = await import('../route-follow.js');
        clearFollow(ctx.session_id);
        const { matchCaps } = await import('../route-inject.js');
        const { recordRouteCaps } = await import('../route-caps.js');
        recordRouteCaps(ctx.session_id, matchCaps(null));
      } catch (e) { debug('brief:routing-off', e); }
    }
    if (routingOn) try {
      const { routeHint, routeMatch, matchCaps, sessionModelRank, hintTarget, hintLabel, escalationNotice } = await import('../route-inject.js');
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
      const grade = delegationGrade();
      const match = routeMatch(ctx.prompt, { sessionRank, root: ctx.cwd, grade });
      // How near the usage limit is, from the statusline snapshot. Read only when
      // a hint will be written, and only the file: no network in a prompt hook.
      let pressure = null;
      if (match) {
        try {
          const { capPressure } = await import('../caps-cache.js');
          const { getSessionModel } = await import('../parser.js');
          pressure = capPressure({ sessionModel: getSessionModel(ctx.transcript_path) });
          // High usage while delegation is not widened: the hint offers
          // `sprag routing relax` once per limit window instead of the plain
          // pressure line. Relaxed, or already offered for this window, the
          // plain line stays.
          if (pressure && (pressure.level === 'high' || pressure.level === 'critical') && (match.t2 || match.t1 || match.t1h) && !isRelaxed()) {
            const { claimRelaxOffer } = await import('../relax-offer.js');
            if (claimRelaxOffer(pressure.resetsAt)) pressure = { ...pressure, offer: true };
          }
        } catch (e) { debug('brief:cap-pressure', e); }
      }
      const hint = routeHint(ctx.prompt, { sessionRank, root: ctx.cwd, match, pressure });
      if (hint) parts.push(hint);
      // A request that ends in a judgement gets no delegation hint (routeMatch is
      // null for it). In a session below Opus it gets the recommendation to move
      // up instead; the grade decides which requests count (escalationNotice).
      // Once per session: the second judgement request of a session gets no
      // line, since the first one already said it (claimEscalationNotice).
      let escalationSaid = false;
      if (!match) {
        try {
          const notice = escalationNotice(ctx.prompt, { sessionRank, grade });
          if (notice) {
            const { claimEscalationNotice } = await import('../route-follow.js');
            if (claimEscalationNotice(ctx.session_id)) { parts.push(notice); escalationSaid = true; }
          }
        } catch (e) { debug('brief:escalation-notice', e); }
      }
      // A main session at effort low or medium gets the effort line for the same
      // kind of request. The model line goes first: when the Sonnet session was
      // just told to move up to Opus, this turn carries that line alone (the
      // effort claim stays free for a later turn).
      if (!match && !escalationSaid) {
        try {
          const { effortHintEnabled } = await import('../routing-switch.js');
          if (effortHintEnabled()) {
            const { effortNotice } = await import('../route-inject.js');
            const { readSessionEffort } = await import('../session-effort.js');
            const notice = effortNotice(ctx.prompt, { sessionEffort: readSessionEffort(ctx.session_id), grade });
            if (notice) {
              const { claimEffortNotice } = await import('../route-follow.js');
              if (claimEffortNotice(ctx.session_id)) parts.push(notice);
            }
          }
        } catch (e) { debug('brief:effort-notice', e); }
      }
      // Remember that this turn carried a delegation hint, so the PostToolUse
      // hook can nudge when the model looks things up itself instead. The
      // unreachable-only notice tells the model NOT to delegate, so it starts
      // no follow-up. A prompt without a hint clears the previous turn's record.
      try {
        const { startFollow, clearFollow } = await import('../route-follow.js');
        const { userLanguage } = await import('../config.js');
        if (hint && match && (match.t2 || match.t1 || match.t1h)) {
          const lang = userLanguage();
          startFollow(ctx.session_id, {
            category: match.cat.id,
            label: hintLabel(match, { lang }),
            target: hintTarget(match, { lang, root: ctx.cwd }),
            lang,
          });
        } else {
          clearFollow(ctx.session_id);
        }
      } catch (e) { debug('brief:route-follow', e); /* never block a prompt */ }
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
