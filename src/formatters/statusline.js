/**
 * Statusline formatter — compact single-line output for Claude Code statusline API.
 * Called every ~300ms, so kept minimal and fast. ANSI color codes included by default.
 *
 * Example output (color):
 *   🧠 97.5% · 1h · ⏱ 42:15 · 💰 $4.8K · 7d
 *
 * Disable color with NO_COLOR=1 env var or --no-color flag.
 * Disable the TTL countdown with --no-timer.
 *
 * Usage in ~/.claude/settings.json:
 *   {
 *     "statusLine": {
 *       "type": "command",
 *       "command": "npx claude-token-saver --statusline"
 *     }
 *   }
 */

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';

function formatMoney(usd) {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`;
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 10) return `$${usd.toFixed(1)}`;
  return `$${usd.toFixed(2)}`;
}

function formatPct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Format a remaining-seconds countdown as MM:SS (or H:MM when ≥ 1h).
 */
function formatTimer(remainingSec) {
  if (remainingSec <= 0) return 'EXPIRED';
  const totalSec = Math.floor(remainingSec);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Pick the cap-warn chip ({ kind, usedPct, resetsAt, label }) that should
 * surface, or null if neither window is at 90%+. When both windows are warning,
 * the one that resets sooner wins (it's the more imminent block).
 */
export function pickCapWarn(caps) {
  if (!caps) return null;
  const candidates = [];
  if (caps.fiveHour && caps.fiveHour.usedPct >= 90) {
    candidates.push({
      kind: 'five_hour',
      label: '5H',
      usedPct: caps.fiveHour.usedPct,
      resetsAt: caps.fiveHour.resetsAt,
    });
  }
  if (caps.sevenDay && caps.sevenDay.usedPct >= 90) {
    candidates.push({
      kind: 'seven_day',
      label: '7D',
      usedPct: caps.sevenDay.usedPct,
      resetsAt: caps.sevenDay.resetsAt,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const ar = Number.isFinite(a.resetsAt) ? a.resetsAt : Infinity;
    const br = Number.isFinite(b.resetsAt) ? b.resetsAt : Infinity;
    return ar - br;
  });
  return candidates[0];
}

/**
 * @param {object} data - output of main report pipeline (summary, ttl, cost, options, lastActivity)
 * @param {object} [opts]
 * @param {boolean} [opts.color=true] - emit ANSI escape codes
 * @param {boolean} [opts.verbose=false] - longer layout with labels
 * @param {boolean} [opts.timer=true] - show TTL countdown segment
 * @param {'text'|'icon'} [opts.mode='text'] - label style. 'icon' uses 🧠 ⏳ 💰 instead of word labels.
 * @param {string[]|null} [opts.segments] - whitelist of segments to render. Names: cap-warn, spike, hit, ttl, saved, ctx, period. Null/undefined = all.
 */
export function formatReport(data, { color = true, verbose = false, timer = true, mode = 'text', segments = null } = {}) {
  const { summary, ttl, cost, options, lastActivity, contextWindow, spikeChip, caps } = data;
  const { hitRate } = summary;

  // Hit rate → color signal
  const hitColor =
    hitRate >= 0.85 ? GREEN :
    hitRate >= 0.70 ? YELLOW :
    RED;

  // TTL dominance → color signal (1h = good, 5m = warning).
  // The subscription plan fixes this, so the bucket rarely changes — it's the countdown that matters.
  const is1h = ttl.pct1h >= 0.5;
  const bucketLabel = is1h ? '1h' : '5m';
  const bucketColor = is1h ? GREEN : YELLOW;
  const ttlSeconds = is1h ? 3600 : 300;

  const savings = cost?.savings ?? 0;

  const c = (v) => (color ? v : '');
  const isIcon = mode === 'icon';

  // Labels per mode.
  //   text:       "Cache hit 98.3%"                 |  verbose: "Cache hit 98.3%"
  //   icon:       "🧠 98.3%"                          |  verbose: "🧠 Cache hit 98.3%"
  const hitLabel = isIcon
    ? (verbose ? '🧠 Cache hit' : '🧠')
    : 'Cache hit';
  const hitSeg = `${c(BOLD)}${hitLabel}${c(RESET)} ${c(hitColor)}${formatPct(hitRate)}${c(RESET)}`;

  //   text:       "Cache saved $1.5K"                |  same in verbose
  //   icon:       "💰 $1.5K"                          |  verbose: "💰 Cache saved $1.5K"
  const saveLabel = isIcon
    ? (verbose ? '💰 Cache saved' : '💰')
    : 'Cache saved';
  const saveSeg = `${c(CYAN)}${saveLabel}${c(RESET)} ${formatMoney(savings)}`;

  // Period label honors hour-precision configs (`mode 6h` → "6h", `mode 1d` → "1d").
  // Fall back to legacy `${days}d` when callers haven't supplied a label.
  const periodLabel = options.windowLabel || `${options.days}d`;
  const periodSeg = verbose
    ? `${c(GRAY)}last ${periodLabel}${c(RESET)}`
    : `${c(GRAY)}${periodLabel}${c(RESET)}`;

  // TTL countdown — how much time is left on the last API call's cache entry.
  // Matches Anthropic's actual prompt-cache behaviour: each call starts a fresh
  // TTL window, and the next call (hit) within that window resets it. So the
  // countdown visibly ticks down between prompts, and "resets" happens as a
  // jump back toward the bucket max the moment you send another message.
  // Compact modes drop the bucket label — it's read as part of the clock
  // ("1h 59:58" gets parsed as "1 hour 59 minutes 58 seconds"). The bucket
  // is plan-determined and rarely changes, so verbose mode is where it belongs.
  //   text compact:   "Expires 59:58"
  //   text verbose:   "1h bucket · expires in 59:58"
  //   icon compact:   "⏳ 59:58"
  //   icon verbose:   "⏳ Expires 1h 59:58"
  let ttlSeg;
  if (timer && lastActivity) {
    const elapsed = (Date.now() - lastActivity) / 1000;
    const remaining = ttlSeconds - elapsed;
    const text = formatTimer(remaining);
    const pct = remaining / ttlSeconds;
    const timerColor =
      remaining <= 0 ? RED :
      pct > 0.30 ? GREEN :
      pct > 0.10 ? YELLOW :
      RED;

    if (isIcon && verbose) {
      // Drop bucket here too — `⏳ Expires 1h 57:20` reads as "1h 57m 20s left"
      // for the same reason the compact form did. The bucket lives in the
      // text-verbose layout where the "bucket" word + `·` separator make it
      // unambiguous.
      ttlSeg = `${c(timerColor)}⏳ Cache expires ${text}${c(RESET)}`;
    } else if (isIcon) {
      ttlSeg = `${c(timerColor)}⏳ ${text}${c(RESET)}`;
    } else if (verbose) {
      ttlSeg = `${c(bucketColor)}Cache ${bucketLabel} bucket${c(RESET)} · ${c(timerColor)}expires in ${text}${c(RESET)}`;
    } else {
      ttlSeg = `${c(timerColor)}Cache expires ${text}${c(RESET)}`;
    }
  } else {
    // No-timer fallback: only the bucket is available, so we show just that.
    if (isIcon) {
      const prefix = verbose ? '⏳ Cache bucket ' : '⏳ ';
      ttlSeg = `${c(bucketColor)}${prefix}${bucketLabel}${c(RESET)}`;
    } else if (verbose) {
      ttlSeg = `${c(bucketColor)}Cache ${bucketLabel} bucket${c(RESET)}`;
    } else {
      ttlSeg = `${c(bucketColor)}Cache bucket ${bucketLabel}${c(RESET)}`;
    }
  }

  // Context window chip (e.g. "📦 1M" or "📦 200k"). 1M gets a warning color
  // because it's the expensive default on Max plans after Opus 4.7.
  let ctxSeg = null;
  if (contextWindow && contextWindow.size && contextWindow.size !== 'unknown') {
    const label = contextWindow.size === '1M' ? '1M' : '200k';
    const ctxColor = contextWindow.size === '1M' ? RED : GREEN;
    if (isIcon && verbose) {
      ctxSeg = `${c(ctxColor)}📦 Context ${label}${c(RESET)}`;
    } else if (isIcon) {
      ctxSeg = `${c(ctxColor)}📦 ${label}${c(RESET)}`;
    } else if (verbose) {
      ctxSeg = `${c(ctxColor)}Context ${label}${c(RESET)}`;
    } else {
      ctxSeg = `${c(ctxColor)}Ctx ${label}${c(RESET)}`;
    }
  }

  // Spike chip — one word only, keeps the statusline single-line.
  const spikeSeg = spikeChip ? `${c(RED)}${spikeChip}${c(RESET)}` : null;

  // Cap-warn chip — leads everything when ANY rate-limit window is at 90%+.
  // It's the most actionable signal we can show: no point optimizing cache
  // hits if you're about to be rate-limited anyway. The chip body matches the
  // English shape `🚨 5H 94%` / `🚨 7D 92%` so history parsers can dedupe on it.
  const capWarn = pickCapWarn(caps);
  let capWarnSeg = null;
  if (capWarn) {
    const pct = Math.round(capWarn.usedPct);
    if (isIcon && verbose) {
      capWarnSeg = `${c(BOLD)}${c(RED)}🚨 ${capWarn.label} cap ${pct}%${c(RESET)}`;
    } else if (isIcon) {
      capWarnSeg = `${c(BOLD)}${c(RED)}🚨 ${capWarn.label} ${pct}%${c(RESET)}`;
    } else if (verbose) {
      capWarnSeg = `${c(BOLD)}${c(RED)}${capWarn.label} cap ${pct}%${c(RESET)}`;
    } else {
      capWarnSeg = `${c(BOLD)}${c(RED)}${capWarn.label} ${pct}%${c(RESET)}`;
    }
  }

  // Warning chip leads — a glance at the statusline catches "something's wrong"
  // before parsing any numbers. Healthy states have no chip and look unchanged.
  // Cap-warn outranks spike: an imminent rate-limit block is more urgent than
  // a single spiking session.
  const allow = segments && segments.length
    ? new Set(segments.map((s) => s.toLowerCase()))
    : null;
  const want = (name) => !allow || allow.has(name);
  const segs = [];
  if (capWarnSeg && want('cap-warn')) segs.push(capWarnSeg);
  if (spikeSeg && want('spike')) segs.push(spikeSeg);
  if (want('hit')) segs.push(hitSeg);
  if (want('ttl')) segs.push(ttlSeg);
  if (want('saved')) segs.push(saveSeg);
  if (ctxSeg && want('ctx')) segs.push(ctxSeg);
  if (want('period')) segs.push(periodSeg);
  return segs.join(' · ');
}
