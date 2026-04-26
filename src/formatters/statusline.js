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

import { formatResetClock } from '../format-time.js';
import { labelForKey } from '../window-labels.js';

// The 8-color ANSI defaults (RED=31, GREEN=32, YELLOW=33…) read as garish
// next to each other — terminal palettes set them with unbalanced perceptual
// brightness, so the line ends up feeling loud. We emit a Tailwind-inspired
// muted palette via 24-bit truecolor when the terminal advertises support
// (`COLORTERM=truecolor`/`24bit`), and gracefully fall back to the legacy
// 8-color codes on terminals that don't.
//
//   GREEN   → emerald-400 #34D399  (calm, balanced with the others)
//   YELLOW  → amber-400   #FBBF24  (warm, not screamy)
//   RED     → rose-400    #FB7185  (alarm without the eye-burn of pure red)
//   CYAN    → cyan-400    #22D3EE
//   MAGENTA → violet-400  #A78BFA  (model identity tone)
//   GRAY    → slate-500   #64748B  (recedes for the gauge track / period footer)
const TRUECOLOR =
  process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit';
const fg = (r, g, b, fallback) =>
  TRUECOLOR ? `\x1b[38;2;${r};${g};${b}m` : fallback;

const RESET = '\x1b[0m';
const RED = fg(251, 113, 133, '\x1b[31m');
const GREEN = fg(52, 211, 153, '\x1b[32m');
const YELLOW = fg(251, 191, 36, '\x1b[33m');
const CYAN = fg(34, 211, 238, '\x1b[36m');
const MAGENTA = fg(167, 139, 250, '\x1b[35m');
const GRAY = fg(100, 116, 139, '\x1b[90m');
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
 * Render a 6-cell density-gradient gauge for `pct` (0..100). All cells share
 * the same Unicode "Block Elements" density family — `█` (100%) → `▓` (75%)
 * → `▒` (50%) → `░` (25%) — so the fill→empty boundary reads as one smooth
 * gradient instead of an awkward step.
 *
 * Earlier we used partial-fill glyphs (`▏▎▍▌▋▊▉`) for sub-cell precision, but
 * those have transparent halves that clash visually with the `░` track next
 * to them (the eye sees "solid edge | gap | dotted track" — three zones).
 * Density chars are the same shape, just darker/lighter, so the boundary
 * cell reads as a single smooth fade.
 *
 * Each cell is ~17% wide; the boundary cell uses 3 intermediate density steps
 * for ~4% effective precision around the fill edge. Stable monospace width
 * across all terminal fonts that ship Block Elements (U+2580–U+259F).
 */
function gaugeBar(pct) {
  const cells = 6;
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = (clamped / 100) * cells; // e.g. 4.32 cells filled
  const fullCells = Math.floor(filled);
  const remainder = filled - fullCells; // 0..1 — fill fraction of the boundary cell
  // Boundary cell: ░ (empty), ▒ (1/3), ▓ (2/3), or roll over to a full █.
  let partial = '';
  let extra = 0;
  if (remainder >= 0.83) {
    extra = 1; // round up — fill the boundary cell completely
  } else if (remainder >= 0.5) {
    partial = '▓';
  } else if (remainder >= 0.16) {
    partial = '▒';
  } // else: remainder is too small to show — leave the cell empty
  const totalFull = Math.min(cells, fullCells + extra);
  const usedCells = totalFull + (partial ? 1 : 0);
  const empty = '░'.repeat(Math.max(0, cells - usedCells));
  return '█'.repeat(totalFull) + partial + empty;
}

/**
 * Format a remaining-seconds countdown as MM:SS (or H:MM when ≥ 1h).
 */
function formatTimer(remainingSec) {
  // Defensive: non-finite/NaN inputs (e.g. clock skew, stringified Date) used
  // to slip through and render as "NaN:NaN" or stretched seconds. Treat any
  // weird input as expired rather than rendering garbage in the statusline.
  if (!Number.isFinite(remainingSec) || remainingSec <= 0) return 'EXPIRED';
  const totalSec = Math.max(0, Math.floor(remainingSec));
  const h = Math.floor(totalSec / 3600);
  const mRaw = Math.floor((totalSec % 3600) / 60);
  const sRaw = totalSec % 60;
  // Clamp explicitly so a future regression in the math (or padStart no-op
  // truncation) can never produce m:sss like "4:547".
  const m = Math.min(59, Math.max(0, mRaw));
  const s = Math.min(59, Math.max(0, sRaw));
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Pick the cap-warn chip that should surface from any of the rate-limit
 * windows, or null when none are at 90%+. When multiple windows are warning,
 * the one that resets sooner wins (it's the more imminent block).
 */
export function pickCapWarn(caps) {
  if (!caps || !Array.isArray(caps.windows)) return null;
  const candidates = caps.windows
    .filter((w) => Number.isFinite(w.usedPct) && w.usedPct >= 90)
    .map((w) => ({ ...w, label: labelForKey(w.key).short }));
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
 * @param {string[]|null} [opts.segments] - whitelist of segments to render. Names: cap-warn, spike, model, hit, ttl, saved, ctx, period, plus per-window keys (`five_hour`, `seven_day`, …). `5h`/`7d` are kept as aliases for back-compat. Null/undefined = all.
 */
export function formatReport(data, { color = true, verbose = false, timer = true, mode = 'text', segments = null } = {}) {
  const { summary, ttl, cost, options, lastActivity, contextWindow, spikeChip, caps, model } = data;
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
    // Coerce to a numeric ms timestamp. Some upstream paths handed in a Date,
    // a stringified ISO timestamp, or epoch-seconds — any of which silently
    // produces NaN/huge values when subtracted from Date.now(), which then
    // bypasses formatTimer's normal MM:SS shape.
    const laMs =
      typeof lastActivity === 'number'
        ? (lastActivity < 1e12 ? lastActivity * 1000 : lastActivity) // seconds → ms
        : (lastActivity instanceof Date ? lastActivity.getTime() : Date.parse(lastActivity));
    const elapsed = Number.isFinite(laMs) ? (Date.now() - laMs) / 1000 : Infinity;
    // Clamp remaining into the bucket so a clock-skew or stale-state edge case
    // can't display a value larger than the bucket itself.
    const remaining = Math.min(ttlSeconds, ttlSeconds - elapsed);
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
    // `Ctx` (not the full word `Context`) across every mode — the icon already
    // tells the eye what the chip is, and the short form fits the same cadence
    // as `Hit`/`Saved` peers when we eventually shorten those too.
    if (isIcon && verbose) {
      ctxSeg = `${c(ctxColor)}📦 Ctx ${label}${c(RESET)}`;
    } else if (isIcon) {
      ctxSeg = `${c(ctxColor)}📦 ${label}${c(RESET)}`;
    } else {
      ctxSeg = `${c(ctxColor)}Ctx ${label}${c(RESET)}`;
    }
  }

  // Spike chip — one word only, keeps the statusline single-line.
  const spikeSeg = spikeChip ? `${c(RED)}${spikeChip}${c(RESET)}` : null;

  // Model chip — pulled from Claude Code's stdin payload (`model.display_name`).
  // Cheap identity context: useful when the user toggles between Sonnet/Opus
  // mid-session and wants to confirm at a glance which one is answering.
  let modelSeg = null;
  if (typeof model === 'string' && model.length > 0) {
    // 🤖 + name is enough — the emoji disambiguates so the literal word "Model"
    // is dead weight in icon mode. Text modes keep the bare name; the magenta
    // tone marks it as identity context.
    if (isIcon) {
      modelSeg = `${c(MAGENTA)}🤖 ${model}${c(RESET)}`;
    } else {
      modelSeg = `${c(MAGENTA)}${model}${c(RESET)}`;
    }
  }

  // Always-on usage segments — what /usage shows in Claude Code, mirrored
  // to the statusline so the user doesn't have to slash-command for it.
  // Today the stdin payload exposes the 5h ("Current session") and 7-day
  // rolling ("Current week") windows; if Anthropic ships more (e.g. a
  // Sonnet-only weekly), they render automatically with derived labels.
  // Each renders as `{label} {pct}% · {countdown}`. When a window is at >=90%
  // the cap-warn chip already shouts about it, so we suppress the always-on
  // segment to avoid duplicate noise.
  function buildUsageSeg({ labels, info, color: tone }) {
    if (!info || !Number.isFinite(info.usedPct)) return null;
    if (info.usedPct >= 90) return null; // cap-warn chip handles this case
    const pct = Math.round(info.usedPct);
    // Show only the wall-clock reset time (e.g. `🔄 21:10`). Absolute time
    // doesn't tick second-by-second so the statusline reads stable, and the
    // 🔄 icon itself separates the percent from the clock — no extra `·` needed.
    const clock = formatResetClock(info.resetsAt);
    const tail = clock ? ` 🔄 ${clock}` : '';
    // `cap` reads as a rate-limit ceiling rather than a duration. Icon mode
    // leans on the icon to identify the window (✦ = session/now, 📅 = week),
    // so the 5H label is empty while the 7D label spells out "weekly". Text and
    // verbose modes keep the `5H`/`7D` short label since they have no icon.
    // Icon mode renders an inline ▰▱ gauge instead of the literal "cap used" —
    // a glance at the bar conveys urgency faster than parsing a percent number,
    // and the gauge stays the same width as the percent climbs.
    if (isIcon) {
      const labelPart = labels.usageLabel ? `${labels.usageLabel} ` : '';
      const bar = gaugeBar(pct);
      return `${c(tone)}${labels.icon} ${labelPart}${bar} ${pct}%${tail}${c(RESET)}`;
    }
    if (verbose) {
      return `${c(tone)}${labels.short} cap ${pct}% used${tail}${c(RESET)}`;
    }
    return `${c(tone)}${labels.short} cap ${pct}%${tail}${c(RESET)}`;
  }
  // Color tone: green when <70%, yellow 70-89% (the segment is suppressed at
  // 90+% in favor of cap-warn). Lets the user spot "I'm getting close" without
  // waiting for the alarm chip.
  function usageTone(info) {
    if (!info || !Number.isFinite(info.usedPct)) return GRAY;
    if (info.usedPct >= 70) return YELLOW;
    return GREEN;
  }
  const usageSegs = [];
  if (caps && Array.isArray(caps.windows)) {
    for (const win of caps.windows) {
      const labels = labelForKey(win.key);
      const seg = buildUsageSeg({
        labels,
        info: win,
        color: usageTone(win),
      });
      if (seg) usageSegs.push({ key: win.key, seg });
    }
  }

  // Cap-warn chip — leads everything when ANY rate-limit window is at 90%+.
  // It's the most actionable signal we can show: no point optimizing cache
  // hits if you're about to be rate-limited anyway. The chip body matches the
  // English shape `🚨 5H 94%` / `🚨 7D 92%` so history parsers can dedupe on it.
  const capWarn = pickCapWarn(caps);
  let capWarnSeg = null;
  if (capWarn) {
    const pct = Math.round(capWarn.usedPct);
    // At 90%+ the user wants to know "when can I send again" — wall-clock is
    // the actionable bit. Same `🔄 HH:MM` shape as the always-on segments so
    // the icon's meaning carries over to the alarm chip.
    const clock = formatResetClock(capWarn.resetsAt);
    const clockTail = clock ? ` 🔄 ${clock}` : '';
    if (isIcon) {
      // Gauge keeps shape parity with the always-on usage segment — the
      // cap-warn is just the same gauge "filled to alarm". Visual continuity
      // helps the eye understand "this is the 5H bar I was watching, just red now."
      const bar = gaugeBar(pct);
      capWarnSeg = `${c(BOLD)}${c(RED)}🚨 ${capWarn.label} ${bar} ${pct}%${clockTail}${c(RESET)}`;
    } else {
      capWarnSeg = `${c(BOLD)}${c(RED)}${capWarn.label} cap ${pct}%${clockTail}${c(RESET)}`;
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
  // Legacy whitelist aliases: `5h` ↔ `five_hour`, `7d` ↔ `seven_day`. So
  // existing `--segments` configs keep working after the generic refactor.
  const usageWant = (key) => {
    if (!allow) return true;
    if (allow.has(key.toLowerCase())) return true;
    if (key === 'five_hour' && allow.has('5h')) return true;
    if (key === 'seven_day' && allow.has('7d')) return true;
    return false;
  };
  const segs = [];
  if (capWarnSeg && want('cap-warn')) segs.push(capWarnSeg);
  if (spikeSeg && want('spike')) segs.push(spikeSeg);
  if (modelSeg && want('model')) segs.push(modelSeg);
  if (want('hit')) segs.push(hitSeg);
  if (want('ttl')) segs.push(ttlSeg);
  for (const { key, seg } of usageSegs) {
    if (usageWant(key)) segs.push(seg);
  }
  if (ctxSeg && want('ctx')) segs.push(ctxSeg);
  // Cache saved is the "lifetime brag" stat — useful but not actionable, so
  // it sits near the tail. The period label closes the line as a quiet
  // timeframe footer.
  if (want('saved')) segs.push(saveSeg);
  if (want('period')) segs.push(periodSeg);
  // Trailing erase-to-end-of-line so any leftover characters from a previous
  // (longer) statusline render don't bleed into ours. Some terminals + the
  // Claude Code statusline integration don't fully clear the line on rewrite,
  // which surfaced as "Cache expires 4:574" or "Cache expires 43550" — old
  // digits from a prior frame leaking past the new shorter timer text.
  // \x1b[K is the standard "erase from cursor to EOL" CSI; safe on any
  // ANSI-compatible terminal and a no-op when stdout isn't a TTY.
  // Defensive overwrite — terminals that miscount emoji width (JetBrains JediTerm
  // is the known case, but others surface periodically) leave the cursor at the
  // wrong column, which makes trailing `\x1b[K` erase the wrong region and
  // leftover bytes from the previous frame fuse with the new one ("4:54" + "8"
  // → "4:548"). Appending a run of spaces overwrites those leftover bytes
  // positionally without any clear-then-redraw step (so no flicker), and is
  // invisible on terminals that already redraw cleanly. `\x1b[K` still mops up
  // anything beyond the padding.
  return segs.join(' · ') + ' '.repeat(40) + '\x1b[K';
}
