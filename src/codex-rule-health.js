import { loadCodexLedger } from './codex-ledger.js';
import { isFailedRun } from './route-scan.js';
import { wilsonLowerBound, HEALTH_ERR_RATE, HEALTH_MIN_SAMPLE_DELEGATED } from './model-rules.js';

/**
 * Measured outcome of one Codex rule, judged as Claude's rule health judges
 * its delegations: a run fails when interrupted or when its tool-error density
 * crosses isFailedRun's line, and the rule goes to review only when the Wilson
 * lower bound of the failure rate clears HEALTH_ERR_RATE over enough runs.
 */
export function codexRuleHealth(rule, { events = Object.values(loadCodexLedger().events) } = {}) {
  const runs = events.filter((e) => e && e.category === rule.category && e.from === rule.from && e.to === rule.model &&
    (!rule.provider || !e.provider || e.provider === rule.provider) && (e.complete || e.aborted));
  const errs = runs.filter((e) => e.aborted || isFailedRun({ toolErrors: e.toolErrors, calls: e.calls })).length;
  const saved = runs.filter((e) => Number.isFinite(e.usd)).reduce((sum, e) => sum + e.usd, 0);
  const review = runs.length >= HEALTH_MIN_SAMPLE_DELEGATED && wilsonLowerBound(errs, runs.length) > HEALTH_ERR_RATE;
  return { runs: runs.length, errs, rate: runs.length ? errs / runs.length : 0, saved, status: review ? 'review' : 'active' };
}
