/**
 * Demo scenarios for the statusline — used for screencasts/marketing GIFs
 * embedded in the GitHub README and npm page.
 *
 * Activated via:
 *   claude-token-saver --statusline --demo healthy
 *   claude-token-saver --statusline --demo cycle    # rotates every 3s
 *
 * Each scenario builds the same data shape the real pipeline produces, so
 * it flows through formatReport() unchanged.
 */

// Default cap usage attached to every scenario so the always-on ✦ / 📅
// gauge segments render in the demo line. Individual scenarios override `caps`
// when they're meant to surface a `🚨 5H/7D` cap-warn chip.
const HEALTHY_CAPS = { fiveHour: 31, sevenDay: 10 };
const DEFAULT_MODEL = 'Opus 4.7';

const SCENARIOS = [
  {
    name: 'healthy',
    label: '✅ Healthy baseline',
    data: {
      hitRate: 0.983,
      pct1h: 0.95,
      savings: 2123,
      elapsedSec: 30,
      contextSize: '200k',
      spikeChip: null,
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: 'low-hit',
    label: '⚠ Cache miss (low hit rate)',
    data: {
      hitRate: 0.55,
      pct1h: 0.95,
      savings: 240,
      elapsedSec: 30,
      contextSize: '200k',
      spikeChip: '⚠ Cache miss',
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: 'ttl-warning',
    label: '⚠ TTL nearly out (yellow)',
    data: {
      hitRate: 0.983,
      pct1h: 0.95,
      savings: 2123,
      elapsedSec: 3000,         // ~10min remaining of 1h
      contextSize: '200k',
      spikeChip: null,
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: 'ttl-expiring',
    label: '⚠ TTL almost expired (red)',
    data: {
      hitRate: 0.983,
      pct1h: 0.95,
      savings: 2123,
      elapsedSec: 3360,         // ~4min remaining of 1h
      contextSize: '200k',
      spikeChip: null,
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: 'ttl-expired',
    label: '⚠ TTL EXPIRED',
    data: {
      hitRate: 0.983,
      pct1h: 0.95,
      savings: 2123,
      elapsedSec: 4000,         // past 1h
      contextSize: '200k',
      spikeChip: null,
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: '5m-bucket',
    label: '⚠ 5m TTL dominant (Pro plan)',
    data: {
      hitRate: 0.92,
      pct1h: 0.15,
      pct5m: 0.85,
      savings: 410,
      elapsedSec: 60,
      contextSize: '200k',
      spikeChip: '⚠ 5m TTL',
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: 'ctx-1m',
    label: '⚠ 1M context auto-on',
    data: {
      hitRate: 0.78,
      pct1h: 0.92,
      savings: 1340,
      elapsedSec: 30,
      contextSize: '1M',
      spikeChip: '⚠ 1M ON',
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: 'spike-input',
    label: '⚠ Input spike',
    data: {
      hitRate: 0.91,
      pct1h: 0.95,
      savings: 1820,
      elapsedSec: 30,
      contextSize: '200k',
      spikeChip: '⚠ Input spike',
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: 'spike-rebuild',
    label: '⚠ Cache rebuild churn',
    data: {
      hitRate: 0.62,
      pct1h: 0.85,
      savings: 220,
      elapsedSec: 30,
      contextSize: '200k',
      spikeChip: '⚠ Rebuild churn',
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: 'spike-output',
    label: '⚠ Output ratio high',
    data: {
      hitRate: 0.94,
      pct1h: 0.95,
      savings: 1450,
      elapsedSec: 30,
      contextSize: '200k',
      spikeChip: '⚠ Output heavy',
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: 'spike-calls',
    label: '⚠ Request count surge',
    data: {
      hitRate: 0.93,
      pct1h: 0.92,
      savings: 980,
      elapsedSec: 30,
      contextSize: '200k',
      spikeChip: '⚠ Call surge',
      caps: HEALTHY_CAPS,
    },
  },
  {
    name: '5h-cap-warn',
    label: '🚨 5H cap 94% (imminent block)',
    data: {
      hitRate: 0.93,
      pct1h: 0.95,
      savings: 1840,
      elapsedSec: 30,
      contextSize: '200k',
      spikeChip: null,
      caps: { fiveHour: 94, sevenDay: 12 },
    },
  },
  {
    name: '7d-cap-warn',
    label: '🚨 7D cap 92% (week pacing)',
    data: {
      hitRate: 0.91,
      pct1h: 0.92,
      savings: 4200,
      elapsedSec: 30,
      contextSize: '200k',
      spikeChip: null,
      caps: { fiveHour: 35, sevenDay: 92 },
    },
  },
  {
    name: 'caps-yellow',
    label: '⚠ 5H 78% / 7D 70% (heads-up)',
    data: {
      hitRate: 0.95,
      pct1h: 0.95,
      savings: 2680,
      elapsedSec: 30,
      contextSize: '200k',
      spikeChip: null,
      caps: { fiveHour: 78, sevenDay: 70 },
    },
  },
];

export function listScenarios() {
  return SCENARIOS.map((s) => ({ name: s.name, label: s.label }));
}

/**
 * Synthetic spike-report data for `--demo table` — exercises every issue
 * code so the drill-down section renders all six advice blocks. Used for
 * marketing recordings of the table view.
 */
export function buildTableDemoData(options = {}) {
  const issueCodes = [
    'LARGE_INPUT_PER_REQUEST',
    'LOW_HIT_RATE',
    'BUCKET_5M_DOMINANT',
    'HIGH_OUTPUT_RATIO',
    'HIGH_REQUEST_COUNT',
    'FREQUENT_CACHE_REBUILD',
  ];

  const spikes = issueCodes.map((code, i) => ({
    metrics: {
      sessionId: `demo${String(i).padStart(4, '0')}-aaaa-bbbb`,
      projectDir: ['ai-pipeline', 'frontend', 'data-eng', 'infra', 'docs-site', 'scratch'][i],
      totalInput: [3_200_000, 850_000, 1_100_000, 620_000, 2_400_000, 740_000][i],
      requestCount: [42, 128, 91, 67, 310, 58][i],
      maxContextPerRequest: [280_000, 175_000, 195_000, 90_000, 145_000, 130_000][i],
    },
    ratio: [3.4, 2.1, 2.6, 1.9, 4.8, 2.3][i],
    issues: [{ code }],
  }));

  return {
    summary: {
      sessions: 12,
      apiCalls: 1247,
      hitRate: 0.812,
      totalInput: 9_540_000_000,
    },
    trend: [
      { date: '2026-04-23', hitRate: 0.94, calls: 312, totalRead: 2.1e8, totalWrite: 8.2e6, pct5m: 0.08 },
      { date: '2026-04-24', hitRate: 0.78, calls: 488, totalRead: 1.4e8, totalWrite: 1.5e7, pct5m: 0.42 },
      { date: '2026-04-25', hitRate: 0.71, calls: 447, totalRead: 9.8e7, totalWrite: 2.1e7, pct5m: 0.61 },
    ],
    ttl: {
      ephemeral5m: 1.5e7,
      ephemeral1h: 2.4e7,
      total: 3.9e7,
      pct5m: 0.38,
      pct1h: 0.62,
    },
    anomalies: [],
    cost: {
      tier: 'claude-opus-new',
      actual: 487.32,
      noCacheCost: 2143.91,
      savings: 1656.59,
      savingsRate: 0.773,
      scenario5mCost: 612.04,
      extraCostIf5m: 124.72,
    },
    options: {
      days: options.days ?? 7,
      windowHours: options.windowHours ?? 168,
      windowLabel: options.windowLabel ?? '7d',
      version: options.version ?? '',
    },
    spikeReport: { spikes, baseline: { p95: 940_000 } },
    contextWindow: { size: '1M', maxContext: 280_000 },
    lastActivity: Date.now() - 60 * 1000,
    spikeChip: '⚠ 1M ON',
  };
}


// Build the rate-limit caps shape that statusline.js consumes. Reset times
// are anchored to "wall-clock-ish" offsets so the cycle reads stable: 5H
// resets ~2h out, 7D resets a few days out — matches what real /usage shows.
function buildCapsShape(caps) {
  if (!caps) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    windows: [
      { key: 'five_hour', usedPct: caps.fiveHour, resetsAt: nowSec + 60 * 130 }, // ~2h10m
      { key: 'seven_day', usedPct: caps.sevenDay, resetsAt: nowSec + 60 * 60 * 76 }, // ~3d4h
    ],
  };
}

export function buildScenarioData(scenarioName, options) {
  let scenario;
  if (scenarioName === 'cycle') {
    // Bucket Date.now() into N-second slots, rotate through scenarios.
    const slot = Math.floor(Date.now() / (options.cycleSeconds * 1000)) % SCENARIOS.length;
    scenario = SCENARIOS[slot];
  } else {
    scenario = SCENARIOS.find((s) => s.name === scenarioName);
    if (!scenario) return null;
  }

  const { hitRate, pct1h, pct5m, savings, elapsedSec, contextSize, spikeChip, caps } = scenario.data;
  return {
    summary: { hitRate },
    ttl: { pct1h, pct5m: pct5m ?? (1 - pct1h) },
    cost: { savings },
    options: {
      days: options.days ?? 1,
      windowHours: options.windowHours ?? 24,
      windowLabel: options.windowLabel ?? '1d',
      version: options.version ?? '',
    },
    lastActivity: Date.now() - elapsedSec * 1000,
    contextWindow: { size: contextSize },
    spikeChip,
    caps: buildCapsShape(caps),
    model: DEFAULT_MODEL,
    _demoLabel: scenario.label,
    _demoName: scenario.name,
  };
}
