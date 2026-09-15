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

import { formatResetClock, formatResetIn } from '../format-time.js';
import { glyphsFor } from '../glyphs.js';
import { labelForKey } from '../window-labels.js';
import { harnessStatusForStatusline } from '../harness.js';
import { loadConfig } from '../config.js';
import { koreanStyleEnabled } from '../korean-style.js';
import { MIN_VOTES } from '../model-alias.js';

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

export function formatMoney(usd) {
  // Boundaries sit at 999.5/999500 so a value that would round up into the
  // next band's width ($999.9 → "$1000") jumps to that band's unit instead —
  // otherwise "$1000" renders visually larger than "$1.0K".
  if (usd >= 999500) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 999.5) return `$${(usd / 1000).toFixed(1)}K`;
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 10) return `$${usd.toFixed(1)}`;
  return `$${usd.toFixed(2)}`;
}

function formatPct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Render the gauge for `pct` (0..100) as a row of separate ticks.
 *
 * The bar used to be six cells of one continuous block, with the boundary cell
 * subdivided into eighths for sub-cell precision. That precision had no reader:
 * every chip that draws a gauge prints the exact percentage immediately after it
 * (`▰▰▰▱▱▱ 26%`), so the bar's job is the glance, not the number. What the solid
 * run cost instead was legibility — adjacent full cells fuse into one shape, and
 * a shape has no quantity you can read off it. Separate ticks do: twelve of them
 * are countable at a glance and land on a familiar 1/12 grid.
 *
 * Two ends get special treatment, because they are the two readings that change
 * a decision. A full row means the limit is reached, so nothing below 100% may
 * draw one; conversely anything above zero draws at least one tick, so "barely
 * started" never looks like "untouched". Rounding alone gets both wrong: it fills
 * the last cell from 96% and leaves the first empty until 5%.
 *
 * Glyphs come from the mode's set (src/glyphs.js) rather than being fixed here.
 * ▰▱ is the shape we want, but JetBrains Mono ships neither character, and a
 * missing glyph is drawn by a fallback font whose advance width does not match
 * the cell grid — which is the whole reason narrow mode exists. So narrow draws
 * the same segmented bar with ■□, which that font does have.
 *
 * @param {number} pct
 * @param {string} [mode] label mode; selects the tick glyphs
 * @returns {{ filled: string, empty: string }} the two halves, so a caller can
 *   color them separately
 */
export function gaugeParts(pct, mode = 'icon') {
  const CELLS = 12;
  const g = glyphsFor(mode);
  const clamped = Math.max(0, Math.min(100, pct));
  let ticks = Math.round((clamped / 100) * CELLS);
  // A full row is reserved for an actual 100%: at the cap the gauge alone has to
  // say so, and 96% rounding up to twelve would spend that signal on a window
  // that still has room.
  if (ticks >= CELLS && clamped < 100) ticks = CELLS - 1;
  // And any nonzero usage earns a tick, so an empty row means untouched.
  if (ticks === 0 && clamped > 0) ticks = 1;
  return {
    filled: g.gaugeFull.repeat(ticks),
    empty: g.gaugeEmpty.repeat(CELLS - ticks),
  };
}

/**
 * The bar as one string, for callers that render it in a single color.
 * @param {number} pct
 * @param {string} [mode] label mode; selects the tick glyphs
 * @returns {string}
 */
export function gaugeBar(pct, mode = 'icon') {
  const { filled, empty } = gaugeParts(pct, mode);
  return filled + empty;
}

/**
 * The bar with the unused ticks dimmed.
 *
 * The hollow tick already distinguishes the two halves by shape, so color is not
 * carrying that distinction the way it had to when both halves were the same
 * solid block. It still helps: graying the remainder keeps the filled run as the
 * only thing at full brightness, which is what the eye should land on. The
 * segment tone is reinstated at the end so the text after the bar keeps the color
 * it started in.
 *
 * @param {number} pct
 * @param {(code: string) => string} c - color emitter (returns '' when color is off)
 * @param {string} tone - the segment's own color code
 * @param {boolean} color - whether ANSI is allowed. Passed explicitly rather
 *   than inferred from `c` emitting nothing: that inference reads the emitter's
 *   current implementation, and a caller that wraps or replaces `c` would change
 *   behaviour here as a side effect nobody asked for.
 * @param {string} [mode] label mode; selects the tick glyphs
 * @returns {string}
 */
function gaugeColored(pct, c, tone, color, mode = 'icon') {
  const { filled, empty } = gaugeParts(pct, mode);
  if (!empty) return filled;
  if (!color) return filled + empty;
  return `${filled}${c(RESET)}${c(GRAY)}${empty}${c(RESET)}${c(tone)}`;
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
function buildKoreanSeg(c, isIcon, verbose, g) {
  try {
    if (!koreanStyleEnabled()) return null;
    // Deliberately quiet (gray, one glyph): this is a "yes, it is on"
    // confirmation, not a warning. Without it a silently-failed hook looks
    // exactly like a working one, because the style only shows up when the
    // model happens to write Korean. The icon says "writing guidance", not
    // "Korean" — the verbose label already carries the language.
    if (isIcon) return `${c(GRAY)}${verbose ? `${g.korean} Korean style` : g.korean}${c(RESET)}`;
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
function buildVersionSeg(version, update, c, isIcon, verbose, g) {
  if (!version) return null;
  if (update && update.available && update.latest) {
    const body = verbose
      ? `Update v${version} → ${update.latest}`
      : `v${version} → ${update.latest}`;
    return `${c(YELLOW)}${isIcon ? `${g.upgrade} ` : ''}${body}${c(RESET)}`;
  }
  return `${c(GRAY)}v${version}${c(RESET)}`;
}

/**
 * Harness 🅷 segment builder — shared by the full report and the no-session
 * fallback line. Best-effort: never throws into the statusline (corrupted
 * CLAUDE.md, permission issue, etc. → null).
 */
function buildHarnessSeg(c, isIcon, g) {
  try {
    const harnessInfo = harnessStatusForStatusline(loadConfig());
    if (!harnessInfo) return null;
    const icon = isIcon ? g.harness : 'H';
    if (harnessInfo.warning) {
      // Warning state outranks the N/5 count — a runtime issue (repeated
      // error / no-evidence / racing edits) is more actionable than a
      // missing ratchet section. Always red so it stands out.
      return `${c(RED)}${icon}${g.spike} ${harnessInfo.warning}${c(RESET)}`;
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
function buildCapWarnSeg(capWarn, c, isIcon, g, color, mode) {
  // `color` and `mode` are both for the gauge: the first decides whether the
  // unused ticks are dimmed, the second which pair of tick glyphs to draw.
  if (!capWarn) return null;
  const pct = Math.round(capWarn.usedPct);
  const clock = formatResetClock(capWarn.resetsAt);
  // Text mode has no glyph vocabulary, so it names the thing instead of
  // borrowing an emoji it otherwise avoids.
  const clockTail = clock ? (isIcon ? ` ${g.reset} ${clock}` : ` resets ${clock}`) : '';
  if (isIcon) {
    // Gauge keeps shape parity with the always-on usage segment — the
    // cap-warn is just the same gauge "filled to alarm". Visual continuity
    // helps the eye understand "this is the 5H bar I was watching, just red now."
    const bar = gaugeColored(pct, c, RED, color, mode);
    return `${c(BOLD)}${c(RED)}${g.capWarn} ${capWarn.label} ${bar} ${pct}%${clockTail}${c(RESET)}`;
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
  // narrow shares the icon layout and swaps only the glyphs, so both modes take
  // the same branches from here on.
  const isIcon = mode === 'icon' || mode === 'narrow';
  const g = glyphsFor(mode);
  const segs = [];
  const capSeg = buildCapWarnSeg(pickCapWarn(caps), c, isIcon, g, color, mode);
  if (capSeg) segs.push(capSeg);
  const versionSeg = buildVersionSeg(version, update, c, isIcon, false, g);
  if (versionSeg && update && update.available) segs.push(versionSeg);
  const harnessSeg = buildHarnessSeg(c, isIcon, g);
  if (harnessSeg) segs.push(harnessSeg);
  if (typeof model === 'string' && model.length > 0) {
    segs.push(isIcon ? `${c(MAGENTA)}${g.model} ${model}${c(RESET)}` : `${c(MAGENTA)}${model}${c(RESET)}`);
  }
  segs.push(`${c(GRAY)}${g.hit} no session data${windowLabel ? ` · ${windowLabel}` : ''}${c(RESET)}`);
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
 * @param {string[]|null} [opts.segments] - segments to render, in the order given. Names: cap-warn, spike, version, harness, korean, model, hit, ttl, month, saved, delegated, doc2md, ctx, period, `usage` (every rate-limit window), plus per-window keys (`five_hour`, `seven_day`, …). `5h`/`7d` are kept as aliases for back-compat. cap-warn and spike keep the lead regardless of where they appear. Null/undefined = all, in the default order.
 * @param {boolean} [opts.singleLine=false] - force the legacy one-line layout. By default, when the delegation ledger has lifetime savings, the routing totals lead on their own first line and everything else moves to line 2 (Claude Code renders multi-line statuslines; `--single-line` is the escape hatch for terminals that only show the first line).
 */
/**
 * Default segment order, most actionable first. A rate-limit block or a full
 * context window stops the work outright, so those lead. Cache and cost numbers
 * shape habits rather than the next keystroke, and harness / Korean-style are
 * near-constant identity: they sit at the tail, where a narrow terminal clips
 * the least useful end of the line instead of the most useful one.
 *
 * `version` is listed once, at its identity position. formatReport() moves it
 * forward when an upgrade is actually available, since it becomes an
 * "act on this" chip then.
 *
 * Exported so a test can assert every name here is one the renderer knows:
 * the order list and the segment registry are separate structures, and a name
 * added to only one of them would be dropped in silence.
 */
export const DEFAULT_SEGMENT_ORDER = [
  'cap-warn', 'spike',
  'usage', 'ctx',
  'ttl',
  'model',
  // Grouped by the timeframe each figure covers, because mixing them was the
  // problem: a lifetime total, a windowed rate and a calendar-month estimate sat
  // interleaved, with one window label at the end of the line that appeared to
  // qualify all of them.
  //
  // Lifetime, from the savings ledgers. Delegation stays ahead of the cache
  // figure: routing is what the tool is for, the cache number is a brag stat.
  'delegated', 'doc2md',
  // Analysis window. These two are the only chips measured over it, so the label
  // sits with them and the three render as one group.
  'hit', 'saved', 'period',
  // Calendar month.
  'month',
  'harness', 'korean', 'version',
];

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
  // narrow shares the icon layout and swaps only the glyphs, so both modes take
  // the same branches from here on.
  const isIcon = mode === 'icon' || mode === 'narrow';
  const g = glyphsFor(mode);

  // Labels per mode.
  //   text:       "Cache hit 98.3%"                 |  verbose: "Cache hit 98.3%"
  //   icon:       "🧠 98.3%"                          |  verbose: "🧠 Cache hit 98.3%"
  const hitLabel = isIcon
    ? (verbose ? `${g.hit} Cache hit` : g.hit)
    : 'Cache hit';
  const hitSeg = `${c(BOLD)}${hitLabel}${c(RESET)} ${c(hitColor)}${formatPct(hitRate)}${c(RESET)}`;

  //   text:       "Cache saved $1.5K"                |  same in verbose
  //   icon:       "💰 $1.5K"                          |  verbose: "💰 Cache saved $1.5K"
  const saveLabel = isIcon
    ? (verbose ? `${g.saved} Cache saved` : g.saved)
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
    ? (verbose ? `${g.routing} Routing saved` : g.routing)
    : 'Routing saved';
  // Zero savings has two very different causes and, until now, one appearance:
  // nothing at all. "Never delegated" and "delegated plenty, but every run was
  // dropped because the gateway model id could not be resolved" looked
  // identical, so users in the second case had no reason to suspect anything
  // was wrong. The count gets a chip; the explanation stays in `route-scan
  // rules`, where there is room for it.
  //
  // But only once there are enough of them to mean anything. A gateway reports
  // an opaque profile ARN, and the fix for that is learned from observed runs —
  // which needs MIN_VOTES of them before it can conclude anything. Below that
  // threshold an unresolved run is not a problem, it is the first day of a
  // working mechanism, and warning about it makes a fresh install look broken.
  // Tied to MIN_VOTES rather than a literal so the two cannot drift: the chip
  // appears exactly when learning has had its chance and still came up short.
  const unresolvedRuns = Number(data.unresolvedRuns) || 0;
  const delegateSeg = delegationSaved > 0
    ? `${c(GREEN)}${delegateLabel}${c(RESET)} ${formatMoney(delegationSaved)}`
    : (unresolvedRuns >= MIN_VOTES
      ? `${c(YELLOW)}${g.routing} ${unresolvedRuns} unresolved${c(RESET)}`
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
    ? (verbose ? `${g.doc} Doc2md saved` : g.doc)
    : 'Doc2md saved';
  let doc2mdSeg = null;
  if (doc2mdUsd > 0) {
    doc2mdSeg = `${c(GREEN)}${doc2mdLabel}${c(RESET)} ${formatMoney(doc2mdUsd)}`
      + (verbose ? ` ${c(GRAY)}· ${doc2mdDocs} docs${c(RESET)}` : '');
  } else if (doc2mdDocs > 0) {
    const label = isIcon ? g.doc : 'Doc2md';
    doc2mdSeg = `${c(GRAY)}${label} ${doc2mdDocs} docs${c(RESET)}`;
  }

  // 이번 달 지출 세그먼트. 달력 월(1일 00시 기준) 지출 추정치라서 cap 이 없는
  // 게이트웨이 사용자에게도 항상 의미가 있다. 정보성 지표이므로 회색으로,
  // 게이지들 뒤에 조용히 놓는다.
  //   icon:    "💵 Sep $42.1"
  //   text:    "Sep spend $42.1"
  //   verbose: "Sep spend $42.1 (since Sep 1)"
  const month = data.monthSpend;
  let monthSeg = null;
  if (month && Number(month.usd) > 0) {
    const amt = formatMoney(Number(month.usd));
    if (isIcon) {
      monthSeg = `${c(GRAY)}${g.month} ${month.label} ${amt}${c(RESET)}`;
    } else if (verbose) {
      monthSeg = `${c(GRAY)}${month.label} spend ${amt} (since ${month.label} 1)${c(RESET)}`;
    } else {
      monthSeg = `${c(GRAY)}${month.label} spend ${amt}${c(RESET)}`;
    }
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
    const head = isIcon ? `${g.routing} Routing saved` : 'Routing saved';
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
    const head = isIcon ? `${g.doc} Doc2md saved` : 'Doc2md saved';
    const byExt = Array.isArray(doc2md.byExt) ? doc2md.byExt : [];
    // Formats that earned money show it; formats with no baseline to measure
    // against are counted instead. Printing "$0.00" next to real amounts reads
    // as "this format saved nothing", when what it means is that nobody has
    // measured what the alternative costs. Only .xls sits there now — the
    // pre-2007 binary, which has no container to price against.
    const paid = byExt.filter((r) => r.usd > 0);
    const unpriced = byExt.filter((r) => !(r.usd > 0));
    const parts = paid.map((r) => `${c(GRAY)}${r.ext} ${r.docs}× ${formatMoney(r.usd)}${c(RESET)}`);
    if (unpriced.length) {
      const counted = unpriced.map((r) => `${r.ext} ${r.docs}×`).join(' · ');
      parts.push(`${c(GRAY)}${counted} ${verbose ? '(no baseline)' : '(n/a)'}${c(RESET)}`);
    }
    const extText = parts.join(` ${c(GRAY)}·${c(RESET)} `);
    doc2mdLine =
      `${c(GREEN)}${c(BOLD)}${head}${c(RESET)} ` +
      `${c(GREEN)}${formatMoney(doc2mdUsd)}${c(RESET)}` +
      (extText ? `  ${c(GRAY)}|${c(RESET)}  ${extText}` : '');
  }

  // Period label honors hour-precision configs (`mode 6h` → "6h", `mode 1d` → "1d").
  // Fall back to legacy `${days}d` when callers haven't supplied a label.
  const periodLabel = options.windowLabel || `${options.days}d`;
  // Parenthesized so it reads as a qualifier on the two chips before it rather
  // than as one more independent chip.
  const periodSeg = verbose
    ? `${c(GRAY)}(last ${periodLabel})${c(RESET)}`
    : `${c(GRAY)}(${periodLabel})${c(RESET)}`;

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
      ttlSeg = `${c(timerColor)}${g.ttl} Cache expires ${text}${c(RESET)}`;
    } else if (isIcon) {
      ttlSeg = `${c(timerColor)}${g.ttl} ${text}${c(RESET)}`;
    } else if (verbose) {
      ttlSeg = `${c(bucketColor)}Cache ${bucketLabel} bucket${c(RESET)} · ${c(timerColor)}expires in ${text}${c(RESET)}`;
    } else {
      ttlSeg = `${c(timerColor)}Cache expires ${text}${c(RESET)}`;
    }
  } else {
    // No-timer fallback: only the bucket is available, so we show just that.
    if (isIcon) {
      const prefix = verbose ? `${g.ttl} Cache bucket ` : `${g.ttl} `;
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
      ctxSeg = `${c(tone)}${g.ctx} Ctx ${longLabel}${c(RESET)}`;
    } else if (isIcon) {
      ctxSeg = `${c(tone)}${g.ctx} ${pct}%${c(RESET)}`;
    } else {
      ctxSeg = `${c(tone)}Ctx ${longLabel}${c(RESET)}`;
    }
  } else if (contextWindow && contextWindow.size && contextWindow.size !== 'unknown') {
    const label = contextWindow.size === '1M' ? '1M' : '200k';
    // Yellow is reserved for the 500k warn line. A 1M window by itself is the
    // default on every current model, so colouring it yellow cried wolf.
    const ctxColor = contextWindow.overWarn ? YELLOW : GREEN;
    if (isIcon && verbose) {
      ctxSeg = `${c(ctxColor)}${g.ctx} Ctx ${label}${c(RESET)}`;
    } else if (isIcon) {
      ctxSeg = `${c(ctxColor)}${g.ctx} ${label}${c(RESET)}`;
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
  const harnessSeg = buildHarnessSeg(c, isIcon, g);

  // Version / upgrade chip. Read from a cache written by a detached background
  // check — this render path never touches the network.
  const versionSeg = buildVersionSeg(options.version, data.update, c, isIcon, verbose, g);
  const updateAvailable = !!(data.update && data.update.available);

  // Korean-style chip — rendered only when the session-start injection is on.
  const koreanSeg = buildKoreanSeg(c, isIcon, verbose, g);

  // Model chip — pulled from Claude Code's stdin payload (`model.display_name`).
  // Cheap identity context: useful when the user toggles between Sonnet/Opus
  // mid-session and wants to confirm at a glance which one is answering.
  let modelSeg = null;
  if (typeof model === 'string' && model.length > 0) {
    // 🤖 + name is enough — the emoji disambiguates so the literal word "Model"
    // is dead weight in icon mode. Text modes keep the bare name; the magenta
    // tone marks it as identity context.
    if (isIcon) {
      modelSeg = `${c(MAGENTA)}${g.model} ${model}${c(RESET)}`;
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
    // A gateway budget can reset weeks out, where a wall-clock time says almost
    // nothing ("Thu 00:00" — which Thursday?). Those windows report how long is
    // left instead. Short windows keep the clock, which is the more useful form
    // when the reset is later today.
    const clock = labels.resetStyle === 'countdown'
      ? formatResetIn(info.resetsAt)
      : formatResetClock(info.resetsAt);
    const tail = clock ? (isIcon ? ` ${g.reset} ${clock}` : ` resets ${clock}`) : '';
    // `cap` reads as a rate-limit ceiling rather than a duration. Icon mode
    // leans on the icon to identify the window (✦ = session/now, 📅 = week),
    // so the 5H label is empty while the 7D label spells out "weekly". Text and
    // verbose modes keep the `5H`/`7D` short label since they have no icon.
    // Icon mode renders an inline ▰▱ gauge instead of the literal "cap used" —
    // a glance at the bar conveys urgency faster than parsing a percent number,
    // and the gauge stays the same width as the percent climbs.
    // LiteLLM 예산 윈도우는 퍼센트만으로는 감이 안 오므로(예산 크기를 모름)
    // 금액을 함께 보여 준다: `💳 budget ▰▱ 34% $34/$100`.
    const money =
      Number.isFinite(info.maxBudget) && info.maxBudget > 0
        ? ` ${formatMoney(Number(info.spend) || 0)}/${formatMoney(info.maxBudget)}`
        : '';
    // LiteLLM 의 internal user 한도는 차단 판정에 쓰이는 값이 아니라서, 팀
    // 멤버십 한도와 수백 배 어긋나는 배포가 있습니다. 그 한도로 그린 게이지는
    // 출처를 밝혀 두어야 사용자가 정확한 값으로 오해하지 않습니다.
    const src = info.source === 'user' ? ' (user)' : '';
    if (isIcon) {
      const labelPart = labels.usageLabel ? `${labels.usageLabel}${src} ` : '';
      const bar = gaugeColored(pct, c, tone, color, mode);
      const winGlyph = mode === 'narrow' ? (labels.narrowIcon || labels.icon) : labels.icon;
      return `${c(tone)}${winGlyph} ${labelPart}${bar} ${pct}%${money}${tail}${c(RESET)}`;
    }
    if (verbose) {
      return `${c(tone)}${labels.short}${src} cap ${pct}% used${money}${tail}${c(RESET)}`;
    }
    return `${c(tone)}${labels.short}${src} cap ${pct}%${money}${tail}${c(RESET)}`;
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

  const capWarnSeg = buildCapWarnSeg(capWarn, c, isIcon, g, color, mode);

  // Warning chip leads — a glance at the statusline catches "something's wrong"
  // before parsing any numbers. Healthy states have no chip and look unchanged.
  // Cap-warn outranks spike: an imminent rate-limit block is more urgent than
  // a single spiking session.
  const allow = segments && segments.length
    ? new Set(segments.map((s) => String(s).toLowerCase()))
    : null;
  // Still needed by the headline lines below, which are not part of the
  // ordered segment list.
  const want = (name) => !allow || allow.has(name);

  // Segment registry — a name maps to the segments it contributes, so the
  // sequence is data instead of the order of push calls. That is what lets a
  // caller reorder: `--segments` used to filter only, and its order was
  // silently discarded, so a user who wanted Ctx first had no way to ask.
  const usageByKey = new Map(usageSegs.map(({ key, seg }) => [key, seg]));
  // Legacy `--segments` aliases: `5h` ↔ `five_hour`, `7d` ↔ `seven_day`.
  const USAGE_ALIASES = { '5h': 'five_hour', '7d': 'seven_day' };
  function segmentsNamed(name) {
    switch (name) {
      case 'cap-warn':  return [capWarnSeg];
      case 'spike':     return [spikeSeg];
      case 'version':   return [versionSeg];
      case 'harness':   return [harnessSeg];
      case 'korean':    return [koreanSeg];
      case 'model':     return [modelSeg];
      // Dropped when the same story already owns a headline line above, which
      // would otherwise repeat it on line 2.
      case 'delegated': return totalsLine ? [] : [delegateSeg];
      case 'doc2md':    return doc2mdLine ? [] : [doc2mdSeg];
      case 'hit':       return [hitSeg];
      case 'ttl':       return [ttlSeg];
      case 'month':     return [monthSeg];
      case 'ctx':       return [ctxSeg];
      case 'saved':     return [saveSeg];
      case 'period':    return [periodSeg];
      // Every rate-limit window, in payload order.
      case 'usage':     return usageSegs.map(({ seg }) => seg);
      default: {
        const seg = usageByKey.get(USAGE_ALIASES[name] || name);
        return seg ? [seg] : [];
      }
    }
  }

  // An available upgrade is an "act on this" chip, so it moves up behind the
  // warning chips. With nothing to upgrade to it stays pure identity, at the
  // tail position DEFAULT_SEGMENT_ORDER gives it.
  let defaultOrder = DEFAULT_SEGMENT_ORDER;
  if (updateAvailable) {
    const rest = DEFAULT_SEGMENT_ORDER.filter((n) => n !== 'version');
    const usageAt = rest.indexOf('usage');
    defaultOrder = [...rest.slice(0, usageAt), 'version', ...rest.slice(usageAt)];
  }
  // A gateway that reports its own spend makes the month chip the second dollar
  // figure on the line, and the two never agree: the budget counts every call
  // that key served, while the month chip estimates from this machine's session
  // logs alone. Two numbers for what looks like one question is worse than one
  // number, so the estimate steps aside when the measured value is present.
  // `--segments month` still asks for it explicitly and still gets it.
  const hasGatewayBudget = !!(caps && Array.isArray(caps.windows)
    && caps.windows.some((w) => w && w.key === 'litellm_budget'));
  if (hasGatewayBudget) defaultOrder = defaultOrder.filter((n) => n !== 'month');

  // A caller-supplied list sets the filter AND the order. Warning chips keep
  // the lead wherever they were written: being seen first is their whole job,
  // and someone reordering segments is not asking to bury an alarm.
  const LEAD = ['cap-warn', 'spike'];
  let order = defaultOrder;
  if (allow) {
    const names = segments.map((s) => String(s).toLowerCase());
    const lead = LEAD.filter((n) => names.includes(n));
    order = lead.concat(names.filter((n) => !LEAD.includes(n)));
  }

  const segs = [];
  // Dedupe so overlapping names (e.g. `usage,five_hour`) cannot print the same
  // chip twice.
  const seen = new Set();
  for (const name of order) {
    for (const seg of segmentsNamed(name)) {
      if (!seg || seen.has(seg)) continue;
      seen.add(seg);
      segs.push(seg);
    }
  }
  // Fuse the analysis-window group with spaces instead of `·`. Separated, each
  // piece reads as an independent chip and the label appears to qualify only the
  // one immediately before it; joined, the three read as a single group and the
  // label covers all of it. Only fused when they actually ended up adjacent, so
  // a caller-supplied order is left alone. Identity comparison is safe here
  // because these are the very strings pushed into `segs`, not rebuilt copies.
  const windowGroup = [hitSeg, saveSeg, periodSeg].filter((seg) => seg && segs.includes(seg));
  if (windowGroup.length > 1) {
    const at = segs.indexOf(windowGroup[0]);
    const adjacent = windowGroup.every((seg, i) => segs[at + i] === seg);
    if (adjacent) segs.splice(at, windowGroup.length, windowGroup.join(' '));
  }
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
