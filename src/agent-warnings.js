/**
 * The warnings the sprag statusline is showing right now, for `sprag bar`.
 *
 * Two kinds, both read from files the statusline already writes:
 *   - cap: an account limit window at or past CAP_PRESSURE_CRITICAL, taken from
 *     the limits the snapshot already holds (the statusline's `🚨 7D 92%` chip).
 *   - issue: the `⚠ ...` chip in last-chip.json, with the advice registered for
 *     it in advice.js and the detail line of its newest history event. The
 *     context-size chip is left out (QUIET_CHIPS).
 *
 * last-chip.json keeps the last chip forever once every session has exited, so
 * an issue only counts while some statusline has rendered in the last two
 * minutes (statusline-last.json). Nothing here writes a file (readRecent makes
 * sure the history folder exists, and only while an issue chip is active), and
 * nothing throws.
 */

import { userDataDir } from './paths.js';
import { userLanguage } from './config.js';
import { CAP_PRESSURE_CRITICAL } from './caps-cache.js';
import { readChipState, readRecent, detailKo } from './history.js';
import { newestRenderAt } from './statusline-guard.js';
import { findLatestWarning } from './commands/last.js';
import { ISSUE_MESSAGES, ISSUE_TIPS, CHIP_TO_CODES, CAP_TIPS } from './advice.js';

/**
 * Chips the statusline shows that `sprag bar` does not raise as a warning. The
 * context-size chip is on whenever any request of the last day passed 500k,
 * which with 1M sessions is most days, and a mark that is always lit says
 * nothing. Every row already carries its own context use. While this chip is
 * the statusline's pick it also hides whatever lower-priority chip is under it,
 * because the statusline records one chip at a time.
 */
export const QUIET_CHIPS = new Set(['⚠ Ctx 500k+', '⚠ Ctx 200k+', '⚠ 1M ON']);

/** A chip older than this with no render since is a leftover of an exited session. */
const RENDER_FRESH_MS = 120_000;

function capItems(limits, lang) {
  const ko = lang === 'ko';
  const out = [];
  for (const w of Array.isArray(limits?.windows) ? limits.windows : []) {
    if (!w || !Number.isFinite(w.usedPct) || w.usedPct < CAP_PRESSURE_CRITICAL) continue;
    const pct = Math.round(w.usedPct);
    out.push({
      kind: 'cap',
      chip: `🚨 ${w.label} ${pct}%`,
      level: 'critical',
      since: null,
      detail: null,
      resetsAt: Number.isFinite(w.resetsAt) ? w.resetsAt : null,
      advice: [{
        code: 'CAP',
        title: ko ? `${w.label} 한도를 ${pct}% 썼습니다` : `${w.label} limit is ${pct}% used`,
        explain: null,
        tip: CAP_TIPS[lang] ?? CAP_TIPS.en,
        actions: [{ label: ko ? '실행' : 'Run', commands: ['sprag handoff'] }],
      }],
    });
  }
  return out;
}

function adviceFor(code, lang) {
  const msg = ISSUE_MESSAGES[code];
  if (!msg) return null;
  const pick = (en, ko) => (lang === 'ko' && ko ? ko : en);
  const actions = typeof msg.actions === 'function' ? msg.actions() : msg.actions || [];
  return {
    code,
    title: pick(msg.title, msg.titleKo),
    explain: pick(msg.explain, msg.explainKo) ?? null,
    tip: ISSUE_TIPS[code]?.[lang] ?? ISSUE_TIPS[code]?.en ?? null,
    actions: actions.map((a) => ({
      label: pick(a.label, a.labelKo),
      commands: (a.commands ?? []).map((c, i) => pick(c, a.commandsKo?.[i])),
    })),
  };
}

function issueItem({ chipState, history, lang }) {
  const chip = chipState.chip;
  let event = null;
  try { event = findLatestWarning(history(), CHIP_TO_CODES); } catch { event = null; }
  if (event && event.chip !== chip) event = null;
  const codes = [...(CHIP_TO_CODES[chip] ?? []), ...(event?.codes ?? [])].filter((c, i, all) => all.indexOf(c) === i);
  const advice = [];
  for (const code of codes) {
    try {
      const a = adviceFor(code, lang);
      if (a) advice.push(a);
    } catch { /* one broken entry must not hide the others */ }
  }
  const ts = Date.parse(chipState.ts);
  let detail = event?.detail ?? null;
  if (detail && lang === 'ko') detail = detailKo(detail);
  return {
    kind: 'issue',
    chip,
    level: 'warn',
    since: Number.isFinite(ts) ? ts : null,
    detail,
    resetsAt: null,
    advice,
  };
}

/** @returns {object[]} rate-limit warnings first, then the issue chip; [] when none */
export function currentWarnings({
  dataDir = userDataDir(),
  now = Date.now(),
  lang = userLanguage(),
  limits = null,
  chipState = readChipState(dataDir),
  lastRenderAt = newestRenderAt({ dir: dataDir }),
  history = () => readRecent(1),
  quiet = QUIET_CHIPS,
} = {}) {
  const out = [];
  try { out.push(...capItems(limits, lang)); } catch { /* keep the issue chip */ }
  try {
    const chip = chipState?.chip;
    if (typeof chip === 'string' && chip && !quiet.has(chip) && Number.isFinite(lastRenderAt) && now - lastRenderAt <= RENDER_FRESH_MS) {
      out.push(issueItem({ chipState, history, lang }));
    }
  } catch { /* no issue item */ }
  return out;
}
