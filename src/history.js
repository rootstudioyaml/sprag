/**
 * Warning history — appends an entry whenever the active chip transitions
 * (none → warning, warning A → warning B, warning → none). One markdown file
 * per calendar day so users can pinpoint "when did this start" easily.
 *
 * Each event is written bilingually: the canonical English line first, the
 * Korean translation as an indented "└" continuation right below. The chip
 * text itself stays as-is (its symbol+English is part of the UX surface), but
 * the diagnostic detail and resolved-status verbs are translated.
 *
 * Storage path is platform-aware (see paths.userDataDir):
 *   Windows: %APPDATA%\claude-token-saver\history\YYYY-MM-DD.md
 *   macOS:   ~/Library/Application Support/claude-token-saver/history/YYYY-MM-DD.md
 *   Linux:   ~/.config/claude-token-saver/history/YYYY-MM-DD.md
 *
 * State (last-seen chip, prevents duplicate appends every 1s refresh):
 *   <userDataDir>/last-chip.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { formatResetIn, formatResetClock } from './format-time.js';
import { labelForKey } from './window-labels.js';
import { ISSUE_TIPS, CHIP_TO_CODES, CAP_TIPS } from './advice.js';

const BASE_DIR = userDataDir();
const HISTORY_DIR = join(BASE_DIR, 'history');
const STATE_PATH = join(BASE_DIR, 'last-chip.json');

export function historyDir() {
  return HISTORY_DIR;
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hms(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { chip: null, ts: null };
  }
}

function saveState(state) {
  ensureDir(BASE_DIR);
  writeFileSync(STATE_PATH, JSON.stringify(state) + '\n');
}

/**
 * Map a chip's English label to its Korean equivalent.
 * Returns the input unchanged if no mapping is registered (forward-compat
 * with chips added in advice.js after this map was last updated).
 */
function chipKo(chip) {
  if (!chip) return chip;
  const map = {
    '⚠ 1M ON': '⚠ 1M 컨텍스트 활성',
    '⚠ Cache miss': '⚠ 캐시 미스',
    '⚠ Rebuild churn': '⚠ 캐시 재빌드 빈발',
    '⚠ Input spike': '⚠ 입력 급증',
    '⚠ Output heavy': '⚠ 출력 과다',
    '⚠ Call surge': '⚠ 호출 급증',
    '⚠ 5m TTL': '⚠ 5분 TTL',
    '⏳ Cache expires': '⏳ 캐시 만료 임박',
    '💰 Cache saved': '💰 캐시 절약',
    '🧠 Cache hit': '🧠 캐시 적중',
  };
  return map[chip] || chip;
}

/**
 * Translate the diagnostic detail string to Korean. The detail is constructed
 * in cli.js and follows two stable shapes:
 *   "Context auto-promoted to 1M (max single-request {N}k tokens)"
 *   "session {ID}: CODE_A, CODE_B"
 * Anything else falls through unchanged.
 */
function detailKo(detail) {
  if (!detail) return detail;
  const m1 = detail.match(/^Context auto-promoted to 1M \(max single-request (\d+)k tokens\)$/);
  if (m1) return `1M 컨텍스트 자동 활성 (단일 요청 최대 ${m1[1]}k 토큰)`;
  const m2 = detail.match(/^session ([^:]+): (.+)$/);
  if (m2) {
    const codeKo = {
      LOW_HIT_RATE: '캐시 적중률 낮음',
      FREQUENT_CACHE_REBUILD: '캐시 재빌드 빈발',
      OUTPUT_HEAVY: '출력 과다',
      INPUT_SPIKE: '입력 급증',
      CALL_SURGE: '호출 급증',
      TTL_5M: '5분 TTL',
    };
    const codes = m2[2]
      .split(',')
      .map((c) => c.trim())
      .map((c) => codeKo[c] || c)
      .join(', ');
    return `세션 ${m2[1]}: ${codes}`;
  }
  return detail;
}

/**
 * Resolve the diagnostic codes that apply to a transition. We try, in order:
 *   1. `detail` of shape "session ID: CODE_A, CODE_B" (chip transitions with
 *      explicit per-session codes — the richest source).
 *   2. `chip` text mapped via CHIP_TO_CODES (covers 1M ON and chips that fire
 *      without a per-session detail).
 * Returns an array of unique codes, possibly empty.
 */
function codesForEvent(chip, detail) {
  const out = [];
  if (detail) {
    const m = detail.match(/^session [^:]+:\s*(.+)$/);
    if (m) {
      for (const c of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!out.includes(c)) out.push(c);
      }
    }
  }
  if (chip && CHIP_TO_CODES[chip]) {
    for (const c of CHIP_TO_CODES[chip]) if (!out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * Build the "💡 ..." tip block for a given chip+detail pair. Returns
 * { en: string, ko: string } where each may be empty if no tips apply
 * (resolution events, unknown chips, etc.).
 */
function tipsForEvent(chip, detail) {
  const codes = codesForEvent(chip, detail);
  const enLines = [];
  const koLines = [];
  for (const code of codes) {
    const tip = ISSUE_TIPS[code];
    if (!tip) continue;
    enLines.push(`  💡 ${tip.en}`);
    // KR tip carries the `└` marker so language-filtered renderers can
    // pair it with its EN counterpart (mirrors the event-line continuation).
    koLines.push(`  └ 💡 ${tip.ko}`);
  }
  return { en: enLines.join('\n'), ko: koLines.join('\n') };
}

function appendDayLine(en, ko, date = new Date(), tips = null) {
  ensureDir(HISTORY_DIR);
  const path = join(HISTORY_DIR, `${ymd(date)}.md`);
  // Bilingual event line. Tip lines (when present) follow on their own lines so
  // the file reads as: event-en / └ event-ko / 💡 tip-en / 💡 tip-ko.
  let block = ko && ko !== en ? `${en}\n  └ ${ko}\n` : `${en}\n`;
  if (tips && tips.en) block += `${tips.en}\n`;
  if (tips && tips.ko) block += `${tips.ko}\n`;
  if (!existsSync(path)) {
    const header = `# Token Monitor / 토큰 모니터 — ${ymd(date)}\n\n## Events / 이벤트\n`;
    writeFileSync(path, header + block);
  } else {
    const existing = readFileSync(path, 'utf8');
    const sep = existing.endsWith('\n') ? '' : '\n';
    writeFileSync(path, existing + sep + block);
  }
}

/**
 * Record a chip transition. Called from the statusline render path.
 * Returns `true` if a transition was logged, `false` if duplicate (same chip
 * as last call).
 */
export function recordChip(chip, contextHints = {}) {
  const state = loadState();
  const now = new Date();
  const current = chip || null;
  const last = state.chip || null;

  if (current === last) return false;

  const detail = contextHints.detail || null;
  const detailEn = detail ? `  — ${detail}` : '';
  const detailKr = detail ? `  — ${detailKo(detail)}` : '';

  let en, ko;
  // Tips only on warning entry/transition (not resolution) — based on the
  // *new* chip so users see how to handle what's currently active.
  let tips = null;
  if (current && !last) {
    en = `- ${hms(now)} ${current}${detailEn}`;
    ko = `${chipKo(current)}${detailKr}`;
    tips = tipsForEvent(current, detail);
  } else if (current && last) {
    en = `- ${hms(now)} ${last} → ${current}${detailEn}`;
    ko = `${chipKo(last)} → ${chipKo(current)}${detailKr}`;
    tips = tipsForEvent(current, detail);
  } else {
    // current === null, last was something — warning resolved
    en = `- ${hms(now)} ✓ resolved (was ${last})`;
    ko = `✓ 해소됨 (이전: ${chipKo(last)})`;
  }
  appendDayLine(en, ko, now, tips);
  saveState({ chip: current, ts: now.toISOString() });
  return true;
}

/**
 * Read history files for the most recent N days (oldest first).
 * Returns array of { date, content } — empty content for days with no file.
 */
export function readRecent(days = 7) {
  ensureDir(HISTORY_DIR);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = ymd(d);
    const path = join(HISTORY_DIR, `${date}.md`);
    if (existsSync(path)) {
      out.push({ date, content: readFileSync(path, 'utf8') });
    }
  }
  return out;
}

/**
 * Record entering or exiting the cap-warn (>=90%) zone for a rate-limit
 * window. Each window (keyed by its stdin name — e.g. `five_hour`, `seven_day`)
 * has its own dedup slot, so the daily file gets two transitions max per
 * window per warning episode.
 *
 * @param {{ key: string, usedPct: number, resetsAt: number|null } | null} window
 * @returns {boolean} true when a line was appended
 */
export function recordCapTransition(window) {
  if (!window || typeof window.key !== 'string') return false;
  const state = loadState();
  const slotKey = `cap_${window.key}`;
  const wasWarn = !!state[slotKey];
  const isWarn = Number.isFinite(window.usedPct) && window.usedPct >= 90;
  if (wasWarn === isWarn) return false;

  const now = new Date();
  const labels = labelForKey(window.key);
  const labelEn = labels.short;
  // Korean labels map only the well-known windows; everything else falls back
  // to the English short label (still readable for the bilingual line).
  const KO_OVERRIDES = {
    five_hour: '5시간 윈도',
    seven_day: '7일 윈도',
    seven_day_sonnet: '7일 윈도 (Sonnet)',
    seven_day_opus: '7일 윈도 (Opus)',
  };
  const labelKo = KO_OVERRIDES[window.key] || labels.short;
  let en;
  let ko;
  if (isWarn) {
    const pct = Math.round(window.usedPct);
    const reset = formatResetIn(window.resetsAt, now);
    const clock = formatResetClock(window.resetsAt, now);
    const tail = reset && clock
      ? ` (resets in ${reset}, at ${clock})`
      : reset
        ? ` (resets in ${reset})`
        : clock
          ? ` (resets at ${clock})`
          : '';
    const tailKo = reset && clock
      ? ` (${clock}에 리셋, 남은 ${reset})`
      : reset
        ? ` (리셋까지 ${reset})`
        : clock
          ? ` (${clock}에 리셋)`
          : '';
    en = `- ${hms(now)} 🚨 ${labelEn} ${pct}% cap warning${tail}`;
    ko = `🚨 ${labelKo} ${pct}% 캡 경고${tailKo}`;
  } else {
    en = `- ${hms(now)} ✓ ${labelEn} cap warning resolved`;
    ko = `✓ ${labelKo} 캡 경고 해소`;
  }
  // Cap-warn entry → handoff tip; resolution → no tip (just the ✓ line).
  const capTips = isWarn ? { en: `  💡 ${CAP_TIPS.en}`, ko: `  └ 💡 ${CAP_TIPS.ko}` } : null;
  appendDayLine(en, ko, now, capTips);
  state[slotKey] = isWarn;
  saveState(state);
  return true;
}

/**
 * Record a handoff write — invoked by the `handoff` subcommand so
 * `claude-token-saver history` shows when work was backed up to a HANDOFF file.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function recordHandoff(filePath) {
  const now = new Date();
  const en = `- ${hms(now)} 📝 handoff written: ${filePath}`;
  const ko = `📝 핸드오프 백업 작성: ${filePath}`;
  appendDayLine(en, ko, now);
  return true;
}

/**
 * Filter a daily-history file's content down to a single language.
 *
 * History files are written bilingual (EN line + `  └ KO` continuation +
 * `  💡 EN tip` + `  └ 💡 KO tip`). This helper renders just the chosen side
 * for display, while the on-disk file stays bilingual for archival.
 *
 *   en: drop every `  └ ...` line (KR continuations + KR tips).
 *   ko: replace each EN line with the immediately following `  └ KO` line
 *       (preserving the leading `- HH:MM:SS` from the EN line so timestamps
 *       still appear); drop unpaired EN-only events.
 *
 * Lines that don't match the bilingual pattern (headers, blank lines,
 * legacy entries from older versions without the `└ 💡` marker) pass through
 * unchanged.
 */
export function formatHistoryForLanguage(content, lang) {
  if (lang !== 'ko') {
    // English: simply strip the `└` continuations.
    return content
      .split('\n')
      .filter((line) => !/^\s*└\s/.test(line))
      .join('\n');
  }
  // Korean: pair each line with its `└` continuation when present.
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || '';
    const cont = next.match(/^(\s*)└\s+(.*)$/);
    // Event line: `- HH:MM:SS <english>` → keep the timestamp prefix, swap text.
    const evt = line.match(/^(- \d{2}:\d{2}:\d{2}\s+)(.*)$/);
    if (evt && cont) {
      out.push(`${evt[1]}${cont[2]}`);
      i++;
      continue;
    }
    // Tip line: `  💡 <english>` paired with `  └ 💡 <korean>`.
    const tip = line.match(/^(\s*)💡\s+(.*)$/);
    if (tip && cont && /^💡\s/.test(cont[2])) {
      out.push(`${tip[1]}${cont[2]}`);
      i++;
      continue;
    }
    // Header / blank / unpaired line — pass through.
    out.push(line);
  }
  return out.join('\n');
}

/**
 * List all available history file dates (sorted newest first).
 */
export function listDates() {
  ensureDir(HISTORY_DIR);
  return readdirSync(HISTORY_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => f.replace(/\.md$/, ''))
    .sort()
    .reverse();
}
