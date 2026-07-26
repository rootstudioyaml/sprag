/**
 * Opt-in diagnostics for the tool's deliberately silent paths.
 *
 * Most catches here are best-effort by design: a failed history append or
 * cache write must never break a statusline that renders every few seconds,
 * and a hook that throws would disrupt the user's session. The cost is that
 * a genuinely broken path (bad permissions on the state dir, a corrupt hook
 * payload) is indistinguishable from "nothing to do".
 *
 * `CTS_DEBUG=1` makes those swallowed failures visible on stderr — which the
 * statusline contract discards and hooks surface in Claude Code's debug
 * output — without changing behavior in any way.
 */

const ENABLED = !!process.env.CTS_DEBUG;

/**
 * @param {string} scope short label for where the failure happened
 * @param {unknown} err the swallowed error
 */
export function debug(scope, err) {
  if (!ENABLED) return;
  const msg = err && err.stack ? err.stack : String(err);
  process.stderr.write(`[cts:${scope}] ${msg}\n`);
}

export function debugEnabled() {
  return ENABLED;
}
