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
import { harnessStatusForStatusline } from '../harness.js';
import { loadConfig } from '../config.js';

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
 * Harness 🅷 segment builder — shared by the full report and the no-session
 * fallback line. Best-effort: never throws into the statusline (corrupted
 * CLAUDE.md, permission issue, etc. → null).
 */
function buildHarnessSeg(c, isIcon) {
  try {
    const harnessInfo = harnessStatusForStatusline(loadConfig());
    if (!harnessInfo) return null;
    const icon = isIcon ? '🅷' : 'H';
    if (harnessInfo.warning) {
      // Warning state outranks the N/5 count — a runtime issue (repeated
      // error / no-evidence / racing edits) is more actionable than a
      // missing ratchet section. Always red so it stands out.
      return `${c(RED)}${icon}⚠ ${harnessInfo.warning}${c(RESET)}`;
    }
    if (harnessInfo.custom) return `${c(CYAN)}${icon} custom${c(RESET)}`;
    const tone = harnessInfo.configured >= harnessInfo.total ? GREEN : YELLOW;
    return `${c(tone)}${icon} ${harnessInfo.configured}/${harnessInfo.total}${c(RESET)}`;
  } catch {
    return null;
  }
}

/**
 * Cap-warn chip builder — shared by the full report and the no-session
 * fallback line. At 90%+ the user wants to know "when can I send again", so
 * the wall-clock reset time rides along in the same `🔄 HH:MM` shape as the
 * always-on usage segments.
 */
function buildCapWarnSeg(capWarn, c, isIcon) {
  if (!capWarn) return null;
  const pct = Math.round(capWarn.usedPct);
  const clock = formatResetClock(capWarn.resetsAt);
  const clockTail = clock ? ` 🔄 ${clock}` : '';
  if (isIcon) {
    // Gauge keeps shape parity with the always-on usage segment — the
    // cap-warn is just the same gauge "filled to alarm". Visual continuity
    // helps the eye understand "this is the 5H bar I was watching, just red now."
    const bar = gaugeBar(pct);
    return `${c(BOLD)}${c(RED)}🚨 ${capWarn.label} ${bar} ${pct}%${clockTail}${c(RESET)}`;
  }
  return `${c(BOLD)}${c(RED)}${capWarn.label} cap ${pct}%${clockTail}${c(RESET)}`;
}

/**
 * Fallback line for when no session data exists in the analysis window.
 * The stdin payload (rate limits, model) is still live in that case, and a
 * 90%+ cap warning is exactly the kind of signal that must not disappear
 * just because the user has been idle past the window — so cap-warn,
 * harness, and model chips still render around the "no session data" note.
 */
export function formatNoSession({ caps = null, model = null, windowLabel = '' } = {}, { color = true, mode = 'icon' } = {}) {
  const c = (v) => (color ? v : '');
  const isIcon = mode === 'icon';
  const segs = [];
  const capSeg = buildCapWarnSeg(pickCapWarn(caps), c, isIcon);
  if (capSeg) segs.push(capSeg);
  const harnessSeg = buildHarnessSeg(c, isIcon);
  if (harnessSeg) segs.push(harnessSeg);
  if (typeof model === 'string' && model.length > 0) {
    segs.push(isIcon ? `${c(MAGENTA)}🤖 ${model}${c(RESET)}` : `${c(MAGENTA)}${model}${c(RESET)}`);
  }
  segs.push(`${c(GRAY)}🧠 no session data${windowLabel ? ` · ${windowLabel}` : ''}${c(RESET)}`);
  return segs.join(' · ') + (color ? '\x1b[K' : '');
}

/**
 * @param {object} data - output of main report pipeline (summary, ttl, cost, options, lastActivity)
 * @param {object} [opts]
 * @param {boolean} [opts.color=true] - emit ANSI escape codes
 * @param {boolean} [opts.verbose=false] - longer layout with labels
 * @param {boolean} [opts.timer=true] - show TTL countdown segment
 * @param {'text'|'icon'} [opts.mode='text'] - label style. 'icon' uses 🧠 ⏳ 💰 instead of word labels.
 * @param {string[]|null} [opts.segments] - whitelist of segments to render. Names: cap-warn, spike, harness, model, hit, ttl, saved, delegated, ctx, period, plus per-window keys (`five_hour`, `seven_day`, …). `5h`/`7d` are kept as aliases for back-compat. Null/undefined = all.
 * @param {boolean} [opts.singleLine=false] - force the legacy one-line layout. By default, when the delegation ledger has lifetime savings, the routing totals lead on their own first line and everything else moves to line 2 (Claude Code renders multi-line statuslines; `--single-line` is the escape hatch for terminals that only show the first line).
 */
export function formatReport(data, { color = true, verbose = false, timer = true, mode = 'text', segments = null, singleLine = false } = {}) {
  const { summary, ttl, cost, options, lastActivity, contextWindow, ctxLive, spikeChip, caps, model } = data;
  const { hitRate } = summary;

  // Hit rate → color signal
  const hitColor =
    hitRate >= 0.85 ? GREEN :
    hitRate >= 0.70 ? YELLOW :
    RED;

  // TTL dominance → color signal (1h = good, 5m = warning).
  // The subscription plan fixes this, so the bucket rarely changes — it's the countdown that matters.
  // When ttl.total === 0 (no cache writes observed in the window), we cannot
  // infer the bucket. Default to 1h-sized countdown rather than 5m so Max
  // users on idle don't see a misleading "Cache expires 5:00". The bucket
  // label is shown as "?" so the uncertainty is visible.
  const hasTtlData = ttl.total > 0;
  const is1h = hasTtlData ? ttl.pct1h >= 0.5 : true;
  const bucketLabel = hasTtlData ? (is1h ? '1h' : '5m') : '?';
  const bucketColor = hasTtlData ? (is1h ? GREEN : YELLOW) : GRAY;
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

  // Delegation savings — a DIFFERENT number from "Cache saved" above, which
  // covers the prompt cache only. This one is what running work on a cheaper
  // tier saved, summed from the rule registry route-scan maintains. Hidden
  // when zero or absent: a permanent "$0" is noise for direct-API users and
  // for anyone who has not delegated yet.
  // "Routing saved" says what earned the money — work that ran on a cheaper
  // model instead of this one. It leads the line rather than trailing it
  // because it is the headline number of the whole tool, not a footnote.
  //   text:       "Routing saved $3.2"                |  same in verbose
  //   icon:       "🔀 $3.2"                           |  verbose: "🔀 Routing saved $3.2"
  const delegationSaved = Number(data.delegationSaved) || 0;
  const delegateLabel = isIcon
    ? (verbose ? '🔀 Routing saved' : '🔀')
    : 'Routing saved';
  const delegateSeg = delegationSaved > 0
    ? `${c(GREEN)}${delegateLabel}${c(RESET)} ${formatMoney(delegationSaved)}`
    : null;

  // Routing-totals headline line (multi-line layout). Week/month/lifetime
  // sums from the delegation ledger — the number the whole tool exists to
  // grow, so it gets line 1 to itself while the diagnostics move to line 2.
  //   icon:  "🔀 Routing saved weekly $1.2 · monthly $3.4 · total $9.8"
  //   text:  "Routing saved weekly $1.2 · monthly $3.4 · total $9.8"
  const totals = data.delegationTotals;
  let totalsLine = null;
  if (!singleLine && totals && Number(totals.total) > 0) {
    // Money is green throughout — it is saved cost, the one number on the
    // line that is unambiguously good news. The period markers stay gray so
    // the eye lands on the amounts, not on "wk / mo / all".
    // Period first, amount second — three bare amounts in a row read as one
    // number until the eye finds the trailing marker, so the label leads and
    // the green amount answers it.
    const part = (usd, label) =>
      `${c(GRAY)}${label}${c(RESET)} ${c(GREEN)}${formatMoney(Number(usd) || 0)}${c(RESET)}`;
    const head = isIcon ? '🔀 Routing saved' : 'Routing saved';
    // Model changes behind the total, family-level and version-free: `opus →
    // haiku 2× $0.6`. Versions bump constantly and add nothing here — the
    // shape of the trade is the point.
    //
    // Every pair is listed, not a top-N: the amounts are shown next to a
    // total, so a truncated list reads as "this is what the total is made of"
    // and quietly misstates it. Families collapse the list on their own —
    // there are only so many tier-to-tier moves — so it stays short without
    // being cut.
    const pairs = Array.isArray(totals.pairs) ? totals.pairs : [];
    const pairText = pairs
      .map((p) => `${c(GRAY)}${p.from}→${p.to}${c(RESET)} ${c(GRAY)}${p.runs}×${c(RESET)} ${c(GREEN)}${formatMoney(p.usd)}${c(RESET)}`)
      .join(` ${c(GRAY)}·${c(RESET)} `);
    totalsLine =
      `${c(GREEN)}${c(BOLD)}${head}${c(RESET)} ` +
      `${part(totals.week, 'weekly')} ${c(GRAY)}·${c(RESET)} ` +
      `${part(totals.month, 'monthly')} ${c(GRAY)}·${c(RESET)} ` +
      `${part(totals.total, 'total')}` +
      (pairText ? `  ${c(GRAY)}|${c(RESET)}  ${pairText}` : '');
  }

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

  // Context chip. Two data sources, best first:
  //
  //  1. Live fill level from Claude Code's stdin (`context_window.used_percentage`)
  //     — the current session's actual usage, refreshed every render. Rendered
  //     as `📦 68%` and colored by fill (green <70, yellow 70–89, red 90+),
  //     matching the cap-segment tone scale.
  //  2. Fallback (table view / older Claude Code): transcript-inferred window
  //     size. Note the semantics: `size === '1M'` means a real request already
  //     carried >210k input tokens — actual heavy usage, not just the model
  //     supporting 1M. Current models are all 1M by default with no price
  //     premium, so this renders yellow ("your context is genuinely big"),
  //     not red ("expensive mode on") like it used to.
  let ctxSeg = null;
  if (ctxLive && Number.isFinite(ctxLive.usedPct)) {
    const pct = Math.max(0, Math.round(ctxLive.usedPct));
    const tone = pct >= 90 ? RED : pct >= 70 ? YELLOW : GREEN;
    const sizeLabel = ctxLive.size
      ? (ctxLive.size >= 900_000 ? '1M' : `${Math.round(ctxLive.size / 1000)}k`)
      : null;
    const longLabel = sizeLabel ? `${pct}% of ${sizeLabel}` : `${pct}%`;
    if (isIcon && verbose) {
      ctxSeg = `${c(tone)}📦 Ctx ${longLabel}${c(RESET)}`;
    } else if (isIcon) {
      ctxSeg = `${c(tone)}📦 ${pct}%${c(RESET)}`;
    } else {
      ctxSeg = `${c(tone)}Ctx ${longLabel}${c(RESET)}`;
    }
  } else if (contextWindow && contextWindow.size && contextWindow.size !== 'unknown') {
    const label = contextWindow.size === '1M' ? '1M' : '200k';
    const ctxColor = contextWindow.size === '1M' ? YELLOW : GREEN;
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

  // Harness 🅷 N/5 — project-scoped completeness of CLAUDE.md harness rules.
  // Silent when the project hasn't opted in (no CLAUDE.md and no .claude/);
  // otherwise renders 🅷 5/5 (green) / 🅷 N/5 (yellow) so the user can spot
  // a missing section at a glance and know to run `harness init`.
  const harnessSeg = buildHarnessSeg(c, isIcon);

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
  // Each renders as `{label} {pct}% · {countdown}`. The window promoted to the
  // cap-warn chip is suppressed here to avoid duplicate noise — but ONLY that
  // one. When several windows are at 90%+ the chip shows just the most
  // imminent, so the others must keep their always-on segment (red) or they'd
  // vanish from the statusline entirely at the worst possible moment.
  function buildUsageSeg({ labels, info, color: tone, suppressed }) {
    if (!info || !Number.isFinite(info.usedPct)) return null;
    if (suppressed) return null; // cap-warn chip handles this window
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
  // Color tone: green <70%, yellow 70-89%, red 90+% (a 90+% window only
  // renders here when a *different* window won the cap-warn chip slot).
  function usageTone(info) {
    if (!info || !Number.isFinite(info.usedPct)) return GRAY;
    if (info.usedPct >= 90) return RED;
    if (info.usedPct >= 70) return YELLOW;
    return GREEN;
  }
  // Cap-warn chip — leads everything when ANY rate-limit window is at 90%+.
  // It's the most actionable signal we can show: no point optimizing cache
  // hits if you're about to be rate-limited anyway. The chip body matches the
  // English shape `🚨 5H 94%` / `🚨 7D 92%` so history parsers can dedupe on it.
  // Computed before the usage segments so they know which window it claimed.
  const capWarn = pickCapWarn(caps);
  const usageSegs = [];
  if (caps && Array.isArray(caps.windows)) {
    for (const win of caps.windows) {
      const labels = labelForKey(win.key);
      const seg = buildUsageSeg({
        labels,
        info: win,
        color: usageTone(win),
        suppressed: !!capWarn && capWarn.key === win.key,
      });
      if (seg) usageSegs.push({ key: win.key, seg });
    }
  }

  const capWarnSeg = buildCapWarnSeg(capWarn, c, isIcon);

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
  if (harnessSeg && want('harness')) segs.push(harnessSeg);
  if (modelSeg && want('model')) segs.push(modelSeg);
  // Delegation savings ride up front, next to the model that would otherwise
  // have done the work. "Cache saved" stays at the tail: it is a lifetime brag
  // stat, while this one is the point of the tool.
  // When the totals headline owns line 1, the inline session chip would
  // repeat the same story on line 2 — drop it there.
  if (delegateSeg && want('delegated') && !totalsLine) segs.push(delegateSeg);
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
  // (longer) statusline render don't bleed into ours. \x1b[K is the standard
  // "erase from cursor to EOL" CSI. Only emitted when color (i.e. ANSI) is
  // allowed — --no-color/NO_COLOR consumers expect escape-free output.
  const eol = color ? '\x1b[K' : '';
  const rest = segs.join(' · ') + eol;
  if (totalsLine && want('delegated')) {
    return totalsLine + eol + '\n' + rest;
  }
  return rest;
}
