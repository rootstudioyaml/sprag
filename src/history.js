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

function appendDayLine(en, ko, date = new Date()) {
  ensureDir(HISTORY_DIR);
  const path = join(HISTORY_DIR, `${ymd(date)}.md`);
  const block = ko && ko !== en ? `${en}\n  └ ${ko}\n` : `${en}\n`;
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
  if (current && !last) {
    en = `- ${hms(now)} ${current}${detailEn}`;
    ko = `${chipKo(current)}${detailKr}`;
  } else if (current && last) {
    en = `- ${hms(now)} ${last} → ${current}${detailEn}`;
    ko = `${chipKo(last)} → ${chipKo(current)}${detailKr}`;
  } else {
    // current === null, last was something — warning resolved
    en = `- ${hms(now)} ✓ resolved (was ${last})`;
    ko = `✓ 해소됨 (이전: ${chipKo(last)})`;
  }
  appendDayLine(en, ko, now);
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
 * Format "resets in Hh Mm" / "Mm" given a Unix-epoch resets_at value.
 * Returns null when the input isn't a finite number.
 */
function formatResetIn(resetsAt, now = new Date()) {
  if (!Number.isFinite(resetsAt)) return null;
  const remainingSec = Math.max(0, resetsAt - Math.floor(now.getTime() / 1000));
  if (remainingSec <= 0) return '0m';
  const h = Math.floor(remainingSec / 3600);
  const m = Math.floor((remainingSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Record entering or exiting the cap-warn (>=90%) zone for a rate-limit
 * window. Each window (`five_hour`, `seven_day`) has its own dedup slot, so
 * the daily file gets two transitions max per window per warning episode.
 *
 * @param {'five_hour'|'seven_day'} kind
 * @param {{ usedPct: number, resetsAt: number|null } | null} info
 * @returns {boolean} true when a line was appended
 */
export function recordCapTransition(kind, info) {
  const state = loadState();
  const slotKey = `cap_${kind}`;
  const wasWarn = !!state[slotKey];
  const isWarn = !!(info && Number.isFinite(info.usedPct) && info.usedPct >= 90);
  if (wasWarn === isWarn) return false;

  const now = new Date();
  const labelEn = kind === 'five_hour' ? '5H' : '7D';
  const labelKo = kind === 'five_hour' ? '5시간 윈도' : '7일 윈도';
  let en;
  let ko;
  if (isWarn) {
    const pct = Math.round(info.usedPct);
    const reset = formatResetIn(info.resetsAt, now);
    const tail = reset ? ` (resets in ${reset})` : '';
    const tailKo = reset ? ` (리셋까지 ${reset})` : '';
    en = `- ${hms(now)} 🚨 ${labelEn} ${pct}% cap warning${tail}`;
    ko = `🚨 ${labelKo} ${pct}% 캡 경고${tailKo}`;
  } else {
    en = `- ${hms(now)} ✓ ${labelEn} cap warning resolved`;
    ko = `✓ ${labelKo} 캡 경고 해소`;
  }
  appendDayLine(en, ko, now);
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
