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
import { koreanStyleEnabled } from '../korean-style.js';

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
 * Korean-style chip builder. Renders only when the session-start injection is
 * enabled, so nothing changes for anyone who never asked for it.
 */
function buildKoreanSeg(c, isIcon, verbose) {
  try {
    if (!koreanStyleEnabled()) return null;
    // Deliberately quiet (gray, one glyph): this is a "yes, it is on"
    // confirmation, not a warning. Without it a silently-failed hook looks
    // exactly like a working one, because the style only shows up when the
    // model happens to write Korean. The icon says "writing guidance", not
    // "Korean" — the verbose label already carries the language.
    if (isIcon) return `${c(GRAY)}${verbose ? '✍️ Korean style' : '✍️'}${c(RESET)}`;
    return `${c(GRAY)}Korean style${c(RESET)}`;
  } catch {
    return null;
  }
}

/**
 * Version segment builder — "which copy of this tool am I looking at", plus
 * the upgrade nudge when a newer one has been published.
 *
 * Two states, deliberately different in weight:
 *   - up to date  → `v3.24.0` in gray. Identity context, not news.
 *   - update available → `⬆ v3.24.0 → 3.25.0` in yellow. Same tone as the
 *     other "you should do something eventually" chips, never red: nothing is
 *     broken, and a permanently-red statusline trains the eye to ignore red.
 *
 * A statusline cannot open a dialog, so the *asking* happens at session start
 * (see route-scan --hook, which briefs the model to offer the upgrade). This
 * chip is the persistent reminder between those offers, which is why it keeps
 * rendering after the user declines — declining hides the session-start
 * question, not the fact that a new version exists.
 */
function buildVersionSeg(version, update, c, isIcon, verbose) {
  if (!version) return null;
  if (update && update.available && update.latest) {
    const body = verbose
      ? `Update v${version} → ${update.latest}`
      : `v${version} → ${update.latest}`;
    return `${c(YELLOW)}${isIcon ? '⬆ ' : ''}${body}${c(RESET)}`;
  }
  return `${c(GRAY)}v${version}${c(RESET)}`;
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
export function formatNoSession({ caps = null, model = null, windowLabel = '', version = '', update = null } = {}, { color = true, mode = 'icon' } = {}) {
  const c = (v) => (color ? v : '');
  const isIcon = mode === 'icon';
  const segs = [];
  const capSeg = buildCapWarnSeg(pickCapWarn(caps), c, isIcon);
  if (capSeg) segs.push(capSeg);
  const versionSeg = buildVersionSeg(version, update, c, isIcon, false);
  if (versionSeg && update && update.available) segs.push(versionSeg);
  const harnessSeg = buildHarnessSeg(c, isIcon);
  if (harnessSeg) segs.push(harnessSeg);
  if (typeof model === 'string' && model.length > 0) {
    segs.push(isIcon ? `${c(MAGENTA)}🤖 ${model}${c(RESET)}` : `${c(MAGENTA)}${model}${c(RESET)}`);
  }
  segs.push(`${c(GRAY)}🧠 no session data${windowLabel ? ` · ${windowLabel}` : ''}${c(RESET)}`);
  if (versionSeg && !(update && update.available)) segs.push(versionSeg);
  return segs.join(' · ') + (color ? '\x1b[K' : '');
}

/**
 * @param {object} data - output of main report pipeline (summary, ttl, cost, options, lastActivity)
 * @param {object} [opts]
 * @param {boolean} [opts.color=true] - emit ANSI escape codes
 * @param {boolean} [opts.verbose=false] - longer layout with labels
 * @param {boolean} [opts.timer=true] - show TTL countdown segment
 * @param {'text'|'icon'} [opts.mode='text'] - label style. 'icon' uses 🧠 ⏳ 💰 instead of word labels.
 * @param {string[]|null} [opts.segments] - whitelist of segments to render. Names: cap-warn, spike, version, harness, korean, model, hit, ttl, saved, delegated, doc2md, ctx, period, plus per-window keys (`five_hour`, `seven_day`, …). `5h`/`7d` are kept as aliases for back-compat. Null/undefined = all.
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
  //
  // That default is exactly backwards behind a gateway. Bedrock and Vertex
  // never report the per-bucket split, so ttl.total stays 0 there forever, and
  // they offer only the 5m bucket: the countdown opened at 59:59 for a window
  // that was really 5:00, overstating it twelvefold. So the fallback now
  // follows the evidence — gateway seen, assume 5m; otherwise keep 1h. An
  // explicit `ttlBucket` setting outranks both, so a gateway that starts
  // reporting the split correctly does not need a release to be believed.
  const hasTtlData = ttl.total > 0;
  const override = data.ttlBucket === '5m' || data.ttlBucket === '1h' ? data.ttlBucket : null;
  const is1h = override ? override === '1h' : (hasTtlData ? ttl.pct1h >= 0.5 : !ttl.gatewayObserved);
  // Three grades of certainty, three labels: measured (`1h`/`5m`), inferred
  // from a gateway model id (`5m?`), and unknown (`?`). Folding the middle
  // case into `?` would hide a judgement the user could otherwise check.
  const bucketKnown = hasTtlData || !!override;
  const bucketLabel = bucketKnown
    ? (is1h ? '1h' : '5m')
    : (ttl.gatewayObserved ? '5m?' : '?');
  const bucketColor = bucketKnown
    ? (is1h ? GREEN : YELLOW)
    : (ttl.gatewayObserved ? YELLOW : GRAY);
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
  // Zero savings has two very different causes and, until now, one appearance:
  // nothing at all. "Never delegated" and "delegated plenty, but every run was
  // dropped because the gateway model id could not be resolved" looked
  // identical, so users in the second case had no reason to suspect anything
  // was wrong. The count gets a chip; the explanation stays in `route-scan
  // rules`, where there is room for it.
  const unresolvedRuns = Number(data.unresolvedRuns) || 0;
  const delegateSeg = delegationSaved > 0
    ? `${c(GREEN)}${delegateLabel}${c(RESET)} ${formatMoney(delegationSaved)}`
    : (unresolvedRuns > 0
      ? `${c(YELLOW)}🔀 ${unresolvedRuns} unresolved${c(RESET)}`
      : null);

  // Document conversions — the same kind of number as "Routing saved", earned
  // a different way: a document read as Markdown instead of attached whole.
  // Kept as its own chip rather than folded into the routing total, because a
  // single figure could not tell the reader which habit earned it.
  //
  // Conversions that saved nothing measurable still show as a count. For
  // pptx/xlsx/docx the honest saving is zero — the client extracts much the
  // same text — and a chip that disappeared on those would read as "doc2md
  // did nothing" on the very formats it is the only way to open.
  //   icon:  "📄 $0.42"   verbose: "📄 Doc2md saved $0.42 · 12 docs"
  //   text:  "Doc2md saved $0.42"
  const doc2md = data.doc2mdTotals;
  const doc2mdUsd = Number(doc2md && doc2md.total) || 0;
  const doc2mdDocs = Number(doc2md && doc2md.docs) || 0;
  const doc2mdLabel = isIcon
    ? (verbose ? '📄 Doc2md saved' : '📄')
    : 'Doc2md saved';
  let doc2mdSeg = null;
  if (doc2mdUsd > 0) {
    doc2mdSeg = `${c(GREEN)}${doc2mdLabel}${c(RESET)} ${formatMoney(doc2mdUsd)}`
      + (verbose ? ` ${c(GRAY)}· ${doc2mdDocs} docs${c(RESET)}` : '');
  } else if (doc2mdDocs > 0) {
    const label = isIcon ? '📄' : 'Doc2md';
    doc2mdSeg = `${c(GRAY)}${label} ${doc2mdDocs} docs${c(RESET)}`;
  }

  // Routing-savings headline line (multi-line layout). The lifetime sum from
  // the delegation ledger — the number the whole tool exists to grow, so it
  // gets line 1 to itself while the diagnostics move to line 2.
  //
  // One figure, not three. The weekly and monthly sums used to sit here too,
  // but the per-model breakdown that follows is a lifetime split, and next to
  // a row of rolling windows it read as a breakdown of whichever one it
  // touched. A single lifetime total makes the whole line one timeframe with
  // nothing to mismatch.
  //   icon:  "🔀 Routing saved $9.8 | opus→haiku 2× $6.4 · fable→sonnet 1× $3.4"
  //   text:  "Routing saved $9.8 | opus→haiku 2× $6.4 · fable→sonnet 1× $3.4"
  const totals = data.delegationTotals;
  let totalsLine = null;
  if (!singleLine && totals && Number(totals.total) > 0) {
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
    // The breakdown stays entirely gray, amounts included. Only the total is
    // green: it is the headline figure, and repeating that green on every
    // component would flatten the line into one loud block with nothing to
    // land on first.
    const pairText = pairs
      .map((p) => `${c(GRAY)}${p.from}→${p.to} ${p.runs}× ${formatMoney(p.usd)}${c(RESET)}`)
      .join(` ${c(GRAY)}·${c(RESET)} `);
    totalsLine =
      `${c(GREEN)}${c(BOLD)}${head}${c(RESET)} ` +
      `${c(GREEN)}${formatMoney(Number(totals.total) || 0)}${c(RESET)}` +
      (pairText ? `  ${c(GRAY)}|${c(RESET)}  ${pairText}` : '');
  }

  // Doc2md's own headline line, same anatomy as the routing one: a green
  // lifetime total, then a gray per-format breakdown. Only built when there
  // is money to report — a bare document count stays an inline chip, since a
  // whole line for "3 docs" would be all frame and no figure.
  //   icon:  "📄 Doc2md saved $1.8 | pptx 1× $1.55 · pdf 2× $0.27"
  let doc2mdLine = null;
  if (!singleLine && doc2mdUsd > 0) {
    const head = isIcon ? '📄 Doc2md saved' : 'Doc2md saved';
    const byExt = Array.isArray(doc2md.byExt) ? doc2md.byExt : [];
    const extText = byExt
      .map((r) => `${c(GRAY)}${r.ext} ${r.docs}× ${formatMoney(r.usd)}${c(RESET)}`)
      .join(` ${c(GRAY)}·${c(RESET)} `);
    doc2mdLine =
      `${c(GREEN)}${c(BOLD)}${head}${c(RESET)} ` +
      `${c(GREEN)}${formatMoney(doc2mdUsd)}${c(RESET)}` +
      (extText ? `  ${c(GRAY)}|${c(RESET)}  ${extText}` : '');
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
    // Percentages are the wrong unit in a 5-minute bucket: 30% of it is 90
    // seconds, and green there reads as comfort the user does not have. Below
    // an hour the thresholds are absolute, so the color tracks whether there
    // is time to finish a thought rather than a share of a short window.
    const timerColor =
      remaining <= 0 ? RED :
      is1h
        ? (pct > 0.30 ? GREEN : pct > 0.10 ? YELLOW : RED)
        : (remaining > 60 ? GREEN : remaining > 30 ? YELLOW : RED);

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

  // Version / upgrade chip. Read from a cache written by a detached background
  // check — this render path never touches the network.
  const versionSeg = buildVersionSeg(options.version, data.update, c, isIcon, verbose);
  const updateAvailable = !!(data.update && data.update.available);

  // Korean-style chip — rendered only when the session-start injection is on.
  const koreanSeg = buildKoreanSeg(c, isIcon, verbose);

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
  // An available upgrade rides up front with the other "act on this" chips.
  // When there is nothing to upgrade to, the same segment is pure identity and
  // sits at the tail instead (pushed after `saved`, below).
  if (versionSeg && updateAvailable && want('version')) segs.push(versionSeg);
  if (harnessSeg && want('harness')) segs.push(harnessSeg);
  if (koreanSeg && want('korean')) segs.push(koreanSeg);
  if (modelSeg && want('model')) segs.push(modelSeg);
  // Delegation savings ride up front, next to the model that would otherwise
  // have done the work. "Cache saved" stays at the tail: it is a lifetime brag
  // stat, while this one is the point of the tool.
  // When the totals headline owns line 1, the inline session chip would
  // repeat the same story on line 2 — drop it there.
  if (delegateSeg && want('delegated') && !totalsLine) segs.push(delegateSeg);
  // Only when it did not already earn a headline line above.
  if (doc2mdSeg && want('doc2md') && !doc2mdLine) segs.push(doc2mdSeg);
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
  if (versionSeg && !updateAvailable && want('version')) segs.push(versionSeg);
  if (want('period')) segs.push(periodSeg);
  // Trailing erase-to-end-of-line so any leftover characters from a previous
  // (longer) statusline render don't bleed into ours. \x1b[K is the standard
  // "erase from cursor to EOL" CSI. Only emitted when color (i.e. ANSI) is
  // allowed — --no-color/NO_COLOR consumers expect escape-free output.
  const eol = color ? '\x1b[K' : '';
  const rest = segs.join(' · ') + eol;
  // Each savings source that earned real money gets a headline line, ordered
  // biggest saver first — the top line is the one the eye lands on, so it
  // goes to whichever habit is actually paying for the tool. The diagnostics
  // line always closes.
  const headlines = [];
  if (totalsLine && want('delegated')) {
    headlines.push({ usd: Number(totals && totals.total) || 0, line: totalsLine });
  }
  if (doc2mdLine && want('doc2md')) {
    headlines.push({ usd: doc2mdUsd, line: doc2mdLine });
  }
  headlines.sort((a, b) => b.usd - a.usd);
  return headlines.map((h) => h.line + eol + '\n').join('') + rest;
}
