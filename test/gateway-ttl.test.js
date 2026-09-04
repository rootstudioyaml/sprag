/**
 * Gateway-backed sessions (Bedrock/Vertex via LiteLLM and friends) report the
 * cache-creation total but never the per-bucket split, and they offer only the
 * 5-minute bucket. Every default that keys off "no split reported" therefore
 * has to know the difference between "nothing cached yet" and "this provider
 * never tells us", or it lands on the wrong answer for exactly these users.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ttlBreakdown, sessionMetrics, diagnoseSession } from '../src/stats.js';
import { estimateCost } from '../src/cost.js';
import { aliasForRole } from '../src/model-alias.js';
import { formatReport } from '../src/formatters/statusline.js';

const BEDROCK_ARN =
  'converse/arn:aws:bedrock:ap-northeast-2:629733055624:application-inference-profile/1u1pzc316exg';

function session({ gateway = false, e5 = 0, e1h = 0, cacheCreation = 100_000 } = {}) {
  return {
    sessionId: 's1',
    requestCount: 10,
    maxContextPerRequest: 50_000,
    gatewayObserved: gateway,
    totals: {
      input: 1_000,
      cacheCreation,
      cacheRead: 400_000,
      ephemeral5m: e5,
      ephemeral1h: e1h,
      output: 5_000,
    },
  };
}

function statusline(ttl, extra = {}) {
  return formatReport({
    summary: { hitRate: 0.94 },
    ttl,
    cost: { savings: 1 },
    options: { windowLabel: 'last 1d', windowHours: 24, version: '0.0.0' },
    lastActivity: Date.now() - 60_000,
    contextWindow: null,
    ctxLive: null,
    spikeChip: null,
    caps: null,
    model: null,
    ...extra,
  }, { color: false, mode: 'text', verbose: true, singleLine: true });
}

test('a gateway session is carried through the TTL breakdown', () => {
  const plain = ttlBreakdown([session()]);
  assert.equal(plain.gatewayObserved, false);
  const gw = ttlBreakdown([session({ gateway: true })]);
  assert.equal(gw.gatewayObserved, true);
  // One gateway session among several is still a gateway environment.
  assert.equal(ttlBreakdown([session(), session({ gateway: true })]).gatewayObserved, true);
});

// Seconds left on the rendered countdown. Parsed rather than string-matched
// because the fixture's "one minute ago" drifts by however long the test takes
// to reach the assertion.
function remainingSeconds(line) {
  const m = /expires in (\d+):(\d+)/.exec(line);
  assert.ok(m, `no countdown in: ${line}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

test('the countdown falls back to 5m behind a gateway and 1h otherwise', () => {
  // No split reported and no gateway: unchanged behaviour, an hour-long clock
  // labelled as a guess. Max users idling must not be told 5:00.
  const unknown = statusline({ total: 0, pct1h: 0, pct5m: 0, gatewayObserved: false });
  assert.match(unknown, /Cache \? bucket/);
  assert.ok(remainingSeconds(unknown) > 3000, 'an hour-sized window');

  // No split reported but a gateway id was seen: the real window is 5 minutes,
  // and the old fallback opened at 59:59, overstating it twelvefold.
  const gw = statusline({ total: 0, pct1h: 0, pct5m: 0, gatewayObserved: true });
  assert.match(gw, /Cache 5m\? bucket/, 'the label marks this as inferred, not measured');
  assert.ok(remainingSeconds(gw) <= 300, 'never larger than the bucket itself');
  assert.ok(remainingSeconds(gw) > 180, 'a minute spent leaves four');
});

test('measured data outranks the gateway guess, and a pinned bucket outranks both', () => {
  const measured1h = statusline({ total: 1000, pct1h: 0.9, pct5m: 0.1, gatewayObserved: true });
  assert.match(measured1h, /Cache 1h bucket/);

  const pinned = statusline(
    { total: 0, pct1h: 0, pct5m: 0, gatewayObserved: false },
    { ttlBucket: '5m' },
  );
  assert.match(pinned, /Cache 5m bucket/, 'pinned reads as certain, with no question mark');
  assert.ok(remainingSeconds(pinned) <= 300);
});

test('unresolved delegated runs get a chip instead of silence', () => {
  const silent = statusline({ total: 0, pct1h: 0, pct5m: 0 }, { delegationSaved: 0 });
  assert.doesNotMatch(silent, /unresolved/);

  // Delegation happened and was discarded for want of a priceable model id.
  // Rendering nothing made this identical to never having delegated.
  const chipped = statusline({ total: 0, pct1h: 0, pct5m: 0 }, { delegationSaved: 0, unresolvedRuns: 7 });
  assert.match(chipped, /7 unresolved/);
});

test('the 5m-dominant warning reaches gateway users, with advice they can act on', () => {
  const gw = diagnoseSession(sessionMetrics(session({ gateway: true })), null);
  const codes = gw.map((i) => i.code);
  // Before this, the warning required the split sum to be non-zero, so the one
  // group of users permanently on a 5m bucket never saw it.
  assert.ok(codes.includes('BUCKET_5M_DOMINANT_GATEWAY'));
  assert.ok(!codes.includes('BUCKET_5M_DOMINANT'), 'the plan-upgrade advice must not fire here');
  assert.equal(gw.find((i) => i.code === 'BUCKET_5M_DOMINANT_GATEWAY').inferred, true);

  // A direct-API session that genuinely reports a 5m-heavy split is unchanged.
  const direct = diagnoseSession(sessionMetrics(session({ e5: 900, e1h: 100 })), null);
  assert.ok(direct.map((i) => i.code).includes('BUCKET_5M_DOMINANT'));
});

test('the 5m-only counterfactual is withdrawn when there is nothing to lose', () => {
  const noneTo1h = estimateCost(session().totals, 'claude-sonnet-5');
  assert.equal(noneTo1h.extraCostIf5mApplicable, false);
  const has1h = estimateCost(session({ e5: 100, e1h: 900 }).totals, 'claude-sonnet-5');
  assert.equal(has1h.extraCostIf5mApplicable, true);
});

test('a foundation-model ARN in the environment resolves; an opaque profile does not', () => {
  // Pointing these variables at an ARN is a normal way to configure a private
  // gateway, and it used to void the delegation stats entirely.
  const fm = aliasForRole('haiku', {
    ANTHROPIC_DEFAULT_HAIKU_MODEL:
      'arn:aws:bedrock:ap-northeast-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
  });
  assert.match(fm, /claude-haiku-4-5/);

  // The application-inference-profile id names no model. Guessing at it is how
  // wrong prices enter the ledger, so it stays rejected.
  assert.equal(aliasForRole('haiku', { ANTHROPIC_DEFAULT_HAIKU_MODEL: BEDROCK_ARN }), null);
  assert.equal(aliasForRole('haiku', {}), null);
});
