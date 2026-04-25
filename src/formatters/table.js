/**
 * Terminal table formatter — zero dependencies.
 */
import { ISSUE_MESSAGES } from '../advice.js';

function pad(str, len, align = 'left') {
  const s = String(str);
  if (align === 'right') return s.padStart(len);
  return s.padEnd(len);
}

function pct(n) {
  return (n * 100).toFixed(1) + '%';
}

function millions(n) {
  return (n / 1_000_000).toFixed(2) + 'M';
}

function thousands(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function hr(len) {
  return '─'.repeat(len);
}

function tableRow(cols, widths, aligns) {
  return (
    '│ ' +
    cols.map((c, i) => pad(c, widths[i], aligns[i])).join(' │ ') +
    ' │'
  );
}

function tableSep(widths) {
  return '├─' + widths.map((w) => hr(w)).join('─┼─') + '─┤';
}

function tableTop(widths) {
  return '┌─' + widths.map((w) => hr(w)).join('─┬─') + '─┐';
}

function tableBot(widths) {
  return '└─' + widths.map((w) => hr(w)).join('─┴─') + '─┘';
}

/**
 * Format the full report for terminal output.
 */
function shortSessionId(id) {
  if (!id) return '(unknown)';
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatContextSize(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return String(n);
}

function renderSpikeSection(spikes, contextWindow) {
  const lines = [];
  lines.push('  ⚠ Token spike detected');
  lines.push(`  ${'─'.repeat(50)}`);
  if (contextWindow && contextWindow.size === '1M') {
    lines.push(
      `  Context mode: 1M  (max recent single-request input ${formatContextSize(contextWindow.maxContext)} tokens)`,
    );
    lines.push('');
  }
  for (const spike of spikes) {
    const m = spike.metrics;
    const ratioLabel = spike.ratio ? `${spike.ratio.toFixed(1)}× p95` : 'single-request > 250k';
    lines.push(
      `  • ${shortSessionId(m.sessionId)} [${m.projectDir || 'unknown'}]  ` +
        `total input ${formatContextSize(m.totalInput)}  (${ratioLabel}, ${m.requestCount} requests)`,
    );
    if (m.maxContextPerRequest > 0) {
      lines.push(
        `      max single-request context: ${formatContextSize(m.maxContextPerRequest)} tokens`,
      );
    }
    for (const issue of spike.issues) {
      const info = ISSUE_MESSAGES[issue.code];
      if (!info) continue;
      lines.push(`      · ${info.title}`);
    }
    lines.push('');
  }

  // De-dupe action blocks — if multiple spikes share the same issue, show
  // the remediation once per run, not once per spike.
  const seen = new Set();
  const uniqueIssues = [];
  for (const spike of spikes) {
    for (const issue of spike.issues) {
      if (seen.has(issue.code)) continue;
      seen.add(issue.code);
      uniqueIssues.push(issue);
    }
  }
  if (uniqueIssues.length > 0) {
    lines.push('  Recommended actions');
    lines.push(`  ${'─'.repeat(50)}`);
    for (const issue of uniqueIssues) {
      const info = ISSUE_MESSAGES[issue.code];
      if (!info) continue;
      lines.push(`  ▸ ${info.title}`);
      lines.push(`    ${info.explain}`);
      for (const action of info.actions()) {
        lines.push(`    - ${action.label}`);
        for (const cmd of action.commands) {
          lines.push(`        ${cmd}`);
        }
      }
      lines.push('');
    }
  }
  return lines;
}

function formatResetIn(resetsAt, now = new Date()) {
  if (!Number.isFinite(resetsAt)) return null;
  const remaining = Math.max(0, resetsAt - Math.floor(now.getTime() / 1000));
  if (remaining <= 0) return '0m';
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function renderCapWarnSection(caps) {
  const warning = [];
  if (caps.fiveHour && caps.fiveHour.usedPct >= 90) {
    warning.push({ label: '5-hour window', info: caps.fiveHour });
  }
  if (caps.sevenDay && caps.sevenDay.usedPct >= 90) {
    warning.push({ label: '7-day window', info: caps.sevenDay });
  }
  if (warning.length === 0) return [];
  const lines = [];
  lines.push('  🚨 Rate-limit cap is closing in');
  lines.push(`  ${'─'.repeat(50)}`);
  for (const { label, info } of warning) {
    const reset = formatResetIn(info.resetsAt);
    const tail = reset ? `, resets in ${reset}` : '';
    lines.push(`  • ${label}: ${Math.round(info.usedPct)}% used${tail}`);
  }
  lines.push('');
  lines.push('  Back up work before the cap hits:');
  lines.push('    claude-token-saver handoff');
  lines.push('  (writes a HANDOFF-*.md so a fresh session can pick up.)');
  lines.push('');
  return lines;
}

export function formatReport({ summary: sum, trend, ttl, anomalies, cost, options, spikeReport, contextWindow, caps }) {
  const lines = [];

  // Header
  lines.push('');
  lines.push(`  Claude Token Saver — Last ${options.days} day${options.days === 1 ? '' : 's'}`);
  lines.push(`  (claude-token-saver v${options.version || ''})`.trimEnd());
  lines.push(`  ${'═'.repeat(50)}`);
  lines.push('');

  // Cap warning leads — it's the most time-sensitive signal we can show.
  if (caps) {
    lines.push(...renderCapWarnSection(caps));
  }

  // Spike section goes next — it's what the user acts on.
  if (spikeReport && spikeReport.spikes.length > 0) {
    lines.push(...renderSpikeSection(spikeReport.spikes, contextWindow));
  }

  // Context window chip for the normal case too
  if (contextWindow && contextWindow.size !== 'unknown') {
    const note =
      contextWindow.size === '1M'
        ? '⚠ 1M context active (Opus 4.7+ Max default). Disable with CLAUDE_CODE_DISABLE_1M_CONTEXT=1'
        : '✓ 200k context (standard)';
    lines.push(`  Context window: ${contextWindow.size}  ${note}`);
    lines.push(`  (max recent single-request input ${formatContextSize(contextWindow.maxContext)} tokens)`);
    lines.push('');
  }

  // Overall summary
  lines.push('  Summary');
  lines.push(`  Sessions: ${sum.sessions}  |  API calls: ${sum.apiCalls.toLocaleString()}  |  Model: ${cost.tier}`);
  lines.push(`  Cache hit rate: ${pct(sum.hitRate)}  |  Total input: ${millions(sum.totalInput)} tokens`);
  lines.push('');

  // TTL breakdown
  lines.push('  TTL Breakdown');
  const ttlW = [18, 16, 16];
  const ttlA = ['left', 'right', 'right'];
  lines.push('  ' + tableTop(ttlW));
  lines.push('  ' + tableRow(['', '5m Ephemeral', '1h Extended'], ttlW, ttlA));
  lines.push('  ' + tableSep(ttlW));
  lines.push(
    '  ' +
      tableRow(
        [
          'Cache writes',
          `${thousands(ttl.ephemeral5m)} (${pct(ttl.pct5m)})`,
          `${thousands(ttl.ephemeral1h)} (${pct(ttl.pct1h)})`,
        ],
        ttlW,
        ttlA,
      ),
  );
  lines.push('  ' + tableBot(ttlW));
  lines.push('');

  // Cost impact
  lines.push('  Cost Impact (estimated)');
  const costW = [24, 12];
  const costA = ['left', 'right'];
  lines.push('  ' + tableTop(costW));
  lines.push('  ' + tableRow(['Actual cost', `$${cost.actual}`], costW, costA));
  lines.push('  ' + tableRow(['Without cache', `$${cost.noCacheCost}`], costW, costA));
  lines.push('  ' + tableSep(costW));
  lines.push('  ' + tableRow(['Savings', `$${cost.savings} (${pct(cost.savingsRate)})`], costW, costA));
  lines.push('  ' + tableRow(['Extra cost if 5m-only', `+$${cost.extraCostIf5m}`], costW, costA));
  lines.push('  ' + tableBot(costW));
  lines.push('');

  // Daily trend
  lines.push('  Daily Trend');
  const tw = [10, 8, 7, 10, 10, 5];
  const ta = ['left', 'right', 'right', 'right', 'right', 'right'];
  lines.push('  ' + tableTop(tw));
  lines.push('  ' + tableRow(['Date', 'HitRate', 'Calls', 'Read', 'Write', '5m%'], tw, ta));
  lines.push('  ' + tableSep(tw));

  const recentTrend = trend.slice(-14); // last 14 days
  for (const d of recentTrend) {
    const ccTotal = d.ephemeral5m + d.ephemeral1h;
    const pct5m = ccTotal > 0 ? pct(d.ephemeral5m / ccTotal) : '-';
    lines.push(
      '  ' +
        tableRow(
          [d.date, pct(d.hitRate), String(d.apiCalls), millions(d.cacheRead), millions(d.cacheCreation), pct5m],
          tw,
          ta,
        ),
    );
  }
  lines.push('  ' + tableBot(tw));

  if (trend.length > 14) {
    lines.push(`  ... ${trend.length - 14} earlier days omitted (use --format json for full data)`);
  }
  lines.push('');

  // Anomalies
  if (anomalies.length > 0) {
    lines.push('  ⚠ Anomalies Detected');
    for (const a of anomalies) {
      lines.push(
        `    ${a.date}: hit rate ${pct(a.hitRate)} (7-day avg: ${pct(a.avgHitRate)}, drop: -${pct(a.drop)}) [${a.apiCalls} calls]`,
      );
    }
  } else {
    lines.push('  ✓ No anomalies detected');
  }

  lines.push('');
  return lines.join('\n');
}
