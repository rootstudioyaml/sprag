/**
 * Aggregate session data into daily trends, TTL breakdown, and anomalies.
 */

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function hitRate(read, creation, input) {
  const total = read + creation + input;
  return total > 0 ? read / total : 0;
}

/**
 * Daily cache hit rate trend
 */
export function dailyTrend(sessions) {
  const byDay = new Map();

  for (const s of sessions) {
    if (!s.startTime) continue;
    const day = dateKey(s.startTime);
    if (!byDay.has(day)) {
      byDay.set(day, {
        date: day,
        input: 0,
        cacheCreation: 0,
        cacheRead: 0,
        ephemeral5m: 0,
        ephemeral1h: 0,
        output: 0,
        apiCalls: 0,
        sessions: 0,
      });
    }
    const d = byDay.get(day);
    d.input += s.totals.input;
    d.cacheCreation += s.totals.cacheCreation;
    d.cacheRead += s.totals.cacheRead;
    d.ephemeral5m += s.totals.ephemeral5m;
    d.ephemeral1h += s.totals.ephemeral1h;
    d.output += s.totals.output;
    d.apiCalls += s.requestCount;
    d.sessions += 1;
  }

  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      hitRate: hitRate(d.cacheRead, d.cacheCreation, d.input),
      totalInput: d.cacheRead + d.cacheCreation + d.input,
    }));
}

/**
 * TTL breakdown summary
 */
export function ttlBreakdown(sessions) {
  let total5m = 0;
  let total1h = 0;
  let gatewayObserved = false;

  for (const s of sessions) {
    total5m += s.totals.ephemeral5m;
    total1h += s.totals.ephemeral1h;
    if (s.gatewayObserved) gatewayObserved = true;
  }

  const total = total5m + total1h;
  return {
    ephemeral5m: total5m,
    ephemeral1h: total1h,
    total,
    pct5m: total > 0 ? total5m / total : 0,
    pct1h: total > 0 ? total1h / total : 0,
    // Bedrock and Vertex fill only the `cache_creation_input_tokens` sum and
    // leave the per-bucket split at zero, so `total === 0` there means "cannot
    // tell" rather than "no cache writes happened". Carrying the observation
    // alongside the numbers lets the display layer tell those two apart
    // without going back to the environment.
    gatewayObserved,
  };
}

/**
 * Detect anomalies — days where hit rate drops significantly from rolling average
 */
export function detectAnomalies(trend, { threshold = 0.15 } = {}) {
  const anomalies = [];
  const windowSize = 7;

  for (let i = 0; i < trend.length; i++) {
    const day = trend[i];
    if (day.apiCalls < 5) continue; // skip low-volume days

    // rolling average of prior days
    const windowStart = Math.max(0, i - windowSize);
    const window = trend.slice(windowStart, i);
    if (window.length < 3) continue;

    const avgHitRate =
      window.reduce((sum, d) => sum + d.hitRate, 0) / window.length;

    const drop = avgHitRate - day.hitRate;
    if (drop > threshold) {
      anomalies.push({
        date: day.date,
        hitRate: day.hitRate,
        avgHitRate,
        drop,
        apiCalls: day.apiCalls,
      });
    }
  }

  return anomalies;
}

/**
 * Per-session metrics used by diagnostics.
 */
export function sessionMetrics(session) {
  const t = session.totals;
  const totalInput = t.input + t.cacheCreation + t.cacheRead;
  const reqs = session.requestCount || 0;
  const avgInputPerReq = reqs > 0 ? totalInput / reqs : 0;
  const hit = hitRate(t.cacheRead, t.cacheCreation, t.input);
  const ttlSum = t.ephemeral5m + t.ephemeral1h;
  const pct5m = ttlSum > 0 ? t.ephemeral5m / ttlSum : 0;
  const outputRatio = totalInput > 0 ? t.output / totalInput : 0;
  const writeToReadRatio = t.cacheRead > 0 ? t.cacheCreation / t.cacheRead : (t.cacheCreation > 0 ? Infinity : 0);
  return {
    sessionId: session.sessionId,
    projectDir: session.projectDir,
    startTime: session.startTime,
    endTime: session.endTime,
    requestCount: reqs,
    totalInput,
    avgInputPerReq,
    hitRate: hit,
    pct5m,
    outputRatio,
    writeToReadRatio,
    maxContextPerRequest: session.maxContextPerRequest || 0,
    gatewayObserved: !!session.gatewayObserved,
    totals: t,
  };
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

/**
 * Baseline using sessions OUTSIDE the recent window. Recent sessions are what
 * we're diagnosing — if we let them into the baseline they'd drag the baseline
 * toward themselves and never register as anomalies.
 */
export function computeBaseline(sessions, recentWindowMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - recentWindowMs;
  const older = sessions.filter((s) => s.startTime && s.startTime.getTime() < cutoff && s.requestCount > 0);
  if (older.length < 3) {
    return { enough: false, sampleSize: older.length };
  }
  const metrics = older.map(sessionMetrics);
  return {
    enough: true,
    sampleSize: older.length,
    medianAvgInputPerReq: median(metrics.map((m) => m.avgInputPerReq)),
    p95AvgInputPerReq: percentile(metrics.map((m) => m.avgInputPerReq), 0.95),
    medianTotalInput: median(metrics.map((m) => m.totalInput)),
    p95TotalInput: percentile(metrics.map((m) => m.totalInput), 0.95),
    medianHitRate: median(metrics.map((m) => m.hitRate)),
    medianRequestCount: median(metrics.map((m) => m.requestCount)),
    p95RequestCount: percentile(metrics.map((m) => m.requestCount), 0.95),
    medianMaxContext: median(metrics.map((m) => m.maxContextPerRequest)),
  };
}

/**
 * Diagnose one session against a baseline. Returns issue codes + supporting
 * numbers so the formatter can render human-readable messages without
 * re-computing anything.
 *
 * Issue codes:
 *   LARGE_INPUT_PER_REQUEST  — likely 1M context mode; avg input per request
 *                              is 8x+ baseline or max req context > 250k
 *   LOW_HIT_RATE             — below 0.5 and baseline was meaningfully higher
 *   BUCKET_5M_DOMINANT       — 5m TTL writes dominate (>70%); prefix re-writes
 *   HIGH_OUTPUT_RATIO        — output/input ratio > 0.15 (unusually chatty)
 *   HIGH_REQUEST_COUNT       — request count > 3x baseline
 *   FREQUENT_CACHE_REBUILD   — cacheCreation > cacheRead (cache not reused)
 */
export function diagnoseSession(metrics, baseline) {
  const issues = [];
  if (!metrics || metrics.requestCount === 0) return issues;

  const b = baseline?.enough ? baseline : null;

  if (metrics.maxContextPerRequest > 250_000 ||
      (b && b.medianAvgInputPerReq > 0 && metrics.avgInputPerReq > b.medianAvgInputPerReq * 8)) {
    issues.push({
      code: 'LARGE_INPUT_PER_REQUEST',
      avgInputPerReq: metrics.avgInputPerReq,
      maxContextPerRequest: metrics.maxContextPerRequest,
      baseline: b?.medianAvgInputPerReq,
    });
  }

  if (metrics.hitRate < 0.5 && (!b || b.medianHitRate > metrics.hitRate + 0.2)) {
    issues.push({
      code: 'LOW_HIT_RATE',
      hitRate: metrics.hitRate,
      baseline: b?.medianHitRate,
    });
  }

  // The split is only knowable when the provider reports it. Requiring that
  // sum outright meant gateway users — who are on a 5m-only backend and so
  // need this warning most — never saw it at all.
  const ttlSplitKnown = (metrics.totals.ephemeral5m + metrics.totals.ephemeral1h) > 0;
  if (ttlSplitKnown && metrics.pct5m > 0.7) {
    issues.push({
      code: 'BUCKET_5M_DOMINANT',
      pct5m: metrics.pct5m,
    });
  } else if (!ttlSplitKnown && metrics.gatewayObserved && metrics.totals.cacheCreation > 0) {
    // Bedrock and Vertex offer no 1h bucket, so every write is a 5m write.
    // The advice differs from the subscription case: no plan change fixes it.
    issues.push({
      code: 'BUCKET_5M_DOMINANT_GATEWAY',
      pct5m: 1.0,
      inferred: true,
    });
  }

  if (metrics.outputRatio > 0.15) {
    issues.push({
      code: 'HIGH_OUTPUT_RATIO',
      outputRatio: metrics.outputRatio,
    });
  }

  if (b && metrics.requestCount > b.medianRequestCount * 3 && metrics.requestCount > 30) {
    issues.push({
      code: 'HIGH_REQUEST_COUNT',
      requestCount: metrics.requestCount,
      baseline: b.medianRequestCount,
    });
  }

  if (metrics.writeToReadRatio !== Infinity &&
      metrics.writeToReadRatio > 1 &&
      metrics.totals.cacheCreation > 100_000) {
    issues.push({
      code: 'FREQUENT_CACHE_REBUILD',
      writeToReadRatio: metrics.writeToReadRatio,
    });
  }

  return issues;
}

/**
 * Find sessions in the recent window whose token totals are >= multiplier x
 * the baseline p95. Returns spikes sorted by severity (largest first) with
 * diagnosis attached.
 */
export function detectSpikes(sessions, { recentHours = 24, multiplier = 3 } = {}) {
  const baseline = computeBaseline(sessions, recentHours * 60 * 60 * 1000);
  const cutoff = Date.now() - recentHours * 60 * 60 * 1000;
  const recent = sessions.filter(
    (s) => s.startTime && s.startTime.getTime() >= cutoff && s.requestCount > 0,
  );

  const spikes = [];
  for (const s of recent) {
    const m = sessionMetrics(s);
    // Need a floor so tiny sessions with a few hundred tokens don't register
    // as spikes just because baseline is also small.
    if (m.totalInput < 1_000_000) continue;

    const ratio = baseline.enough && baseline.p95TotalInput > 0
      ? m.totalInput / baseline.p95TotalInput
      : null;

    const isSpike =
      (ratio !== null && ratio >= multiplier) ||
      m.maxContextPerRequest > 250_000;

    if (!isSpike) continue;

    spikes.push({
      metrics: m,
      ratio,
      issues: diagnoseSession(m, baseline),
    });
  }

  spikes.sort((a, b) => b.metrics.totalInput - a.metrics.totalInput);
  return { baseline, spikes };
}

/**
 * Detect the likely context-window setting from the largest single-request
 * context seen in the recent window. Claude Code's two modes are 200k (default)
 * and 1M (Opus 4.7+ auto-enabled on Max). If max single-request context passes
 * the 200k ceiling, the user has 1M turned on.
 *
 * Returns { size: '1M' | '200k' | 'unknown', maxContext, source }.
 */
export function detectContextWindow(sessions, { recentHours = 24 } = {}) {
  const cutoff = Date.now() - recentHours * 60 * 60 * 1000;
  const recent = sessions.filter(
    (s) => s.endTime && s.endTime.getTime() >= cutoff && s.requestCount > 0,
  );
  const pool = recent.length > 0 ? recent : sessions;
  const maxContext = pool.reduce(
    (m, s) => Math.max(m, s.maxContextPerRequest || 0),
    0,
  );
  if (maxContext === 0) return { size: 'unknown', maxContext, source: 'no-data' };
  // 200_000 is the hard ceiling for the standard window. Anything materially
  // over that means the 1M context is in play. Use 210k for a small safety
  // margin against rounding/metadata tokens.
  if (maxContext > 210_000) return { size: '1M', maxContext, source: recent.length > 0 ? 'recent' : 'all' };
  return { size: '200k', maxContext, source: recent.length > 0 ? 'recent' : 'all' };
}

/**
 * Overall summary
 */
export function summary(sessions) {
  const totals = sessions.reduce(
    (acc, s) => {
      acc.input += s.totals.input;
      acc.cacheCreation += s.totals.cacheCreation;
      acc.cacheRead += s.totals.cacheRead;
      acc.ephemeral5m += s.totals.ephemeral5m;
      acc.ephemeral1h += s.totals.ephemeral1h;
      acc.output += s.totals.output;
      acc.apiCalls += s.requestCount;
      acc.sessions += 1;
      return acc;
    },
    { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0, apiCalls: 0, sessions: 0 },
  );

  const totalInput = totals.cacheRead + totals.cacheCreation + totals.input;

  return {
    ...totals,
    totalInput,
    hitRate: hitRate(totals.cacheRead, totals.cacheCreation, totals.input),
  };
}
