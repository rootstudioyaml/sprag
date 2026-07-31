/**
 * brief — UserPromptSubmit hook: per-session, change-triggered briefing.
 *
 * The statusline can only show chips (`ctx 82%`, `route? R1`, `rule-health`),
 * and the model cannot see the statusline at all — so a mid-session state
 * change is invisible to the conversation unless a hook injects it. This
 * module runs on every prompt submit, compares the CURRENT session's state
 * against what was already briefed for that session, and emits a short
 * briefing instruction only when something NEW crossed a threshold. No
 * change → completely silent (zero context cost).
 *
 * Per-session by design (user requirement): context size is a property of
 * one session's transcript, so both the measurement (from this session's
 * transcript_path) and the "already briefed" markers are keyed by session_id.
 *
 * State: <stateDir>/brief-state.json
 *   { sessions: { [session_id]: { ts, ctxTier, briefed: [signature] } } }
 * Sessions untouched for 7 days are pruned on every write.
 *
 * Division of labor with the SessionStart hook: SessionStart prints the
 * session-start snapshot and records the signatures it actually briefed via
 * seedSessionBriefed(); this hook emits anything NOT in that record. A
 * candidate that lands after the SessionStart read (e.g. the detached rescan
 * finishing between session start and the first prompt) is therefore briefed
 * on the next prompt instead of being lost for the whole session.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { resolveModelId, isOneMillionModel, effectiveWindow } from './compact-window.js';

// Context tiers as a fraction of the session's context window. Tier 1 warns
// (compaction/cost territory ahead), tier 2 urges wrapping up. A session only
// ever hears about each tier once, and only on upward crossings.
export const CTX_TIERS = [
  { tier: 1, pct: 0.8 },
  { tier: 2, pct: 0.95 },
];
// Requests above this input size can only exist on a 1M window. Used as a
// fallback signal only — a 1M session that has not yet grown past 250k is
// still a 1M session, so the configured model decides first (see sessionCtx).
const WINDOW_1M_MIN_INPUT = 250_000;
const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;
const TAIL_BYTES = 256 * 1024;

// See the note in route-scan.js — paths.js is the only place that resolves
// this, so an XDG_CONFIG_HOME override moves every state file together.
const stateDir = userDataDir;

export function briefStatePath() {
  return join(stateDir(), 'brief-state.json');
}

function loadState() {
  try {
    const s = JSON.parse(readFileSync(briefStatePath(), 'utf8'));
    return s && typeof s.sessions === 'object' ? s : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

function saveState(state, now) {
  for (const [id, s] of Object.entries(state.sessions)) {
    if (!s?.ts || now - s.ts > PRUNE_MS) delete state.sessions[id];
  }
  const dir = stateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(briefStatePath(), JSON.stringify(state) + '\n');
}

/**
 * The window a tier crossing should be measured against.
 *
 * Two corrections over "infer from the biggest request seen":
 *  - The configured model decides the ceiling. A 1M session that has not yet
 *    grown past 250k is still a 1M session; judging it against 200k fired the
 *    80% warning at 160k, less than a fifth of the real window.
 *  - `autoCompactWindow` lowers that ceiling. Once compaction is pinned at
 *    400k, 400k — not 1M — is where the session actually turns over, so that
 *    is the number a "you are at 80%" warning has to mean.
 *
 * `observedMax` stays as a floor: it proves a 1M window even when the model id
 * is unreadable (env override, settings we do not resolve).
 */
export function ctxWindowFor(observedMax = 0, root = process.cwd()) {
  let window = observedMax > WINDOW_1M_MIN_INPUT ? 1_000_000 : 200_000;
  let compactCapped = false;
  try {
    const { model } = resolveModelId(root);
    if (isOneMillionModel(model)) window = 1_000_000;
    const cap = effectiveWindow(root).value;
    if (cap !== null && cap < window) {
      window = cap;
      compactCapped = true;
    }
  } catch { /* settings unreadable — the observed-size fallback still holds */ }
  return { window, compactCapped };
}

/**
 * Last request's input size for THIS session, from the transcript tail.
 * Reads at most TAIL_BYTES — prompt-submit hooks must stay fast.
 */
export function sessionCtx(transcriptPath, { root = process.cwd() } = {}) {
  let size;
  try { size = statSync(transcriptPath).size; } catch { return null; }
  const start = Math.max(0, size - TAIL_BYTES);
  const buf = Buffer.alloc(size - start);
  let fd;
  try {
    fd = openSync(transcriptPath, 'r');
    readSync(fd, buf, 0, buf.length, start);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
  }
  const lines = buf.toString('utf8').split('\n');
  let input = null;
  let maxInput = 0;
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const u = e?.message?.usage;
    if (!u) continue;
    const total = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (total > 0) { input = total; maxInput = Math.max(maxInput, total); }
  }
  if (input == null) return null;
  const { window, compactCapped } = ctxWindowFor(maxInput, root);
  return { input, window, compactCapped, pct: input / window };
}

function ctxTierOf(pct) {
  let t = 0;
  for (const { tier, pct: p } of CTX_TIERS) if (pct >= p) t = tier;
  return t;
}

const fmtK = (n) => `${Math.round(n / 1000)}k`;

/**
 * Called by the SessionStart hook after it prints the session-start snapshot:
 * records the signatures it actually briefed so runBrief suppresses exactly
 * those and nothing more. Signature format matches runBrief:
 * `route|<sig>` / `health|<sig>|<scope>`.
 */
export function seedSessionBriefed(sessionId, signatures, now = Date.now()) {
  if (!sessionId || !Array.isArray(signatures) || signatures.length === 0) return;
  const state = loadState();
  const s = state.sessions[sessionId] || { ctxTier: 0, briefed: [] };
  s.briefed = [...new Set([...(s.briefed || []), ...signatures])];
  s.ts = now;
  state.sessions[sessionId] = s;
  saveState(state, now);
}

/**
 * Compute the briefing for one prompt-submit event. Returns the text to
 * inject, or null when nothing new happened. Mutates + persists state.
 *
 * Route/rule-health signatures already briefed by the SessionStart hook
 * (recorded via seedSessionBriefed) are skipped; every other fresh signature
 * is emitted, including on the session's first event.
 */
export async function runBrief({ sessionId, transcriptPath, now = Date.now() }) {
  if (!sessionId) return null;
  const state = loadState();
  const s = state.sessions[sessionId] || { ctxTier: 0, briefed: [] };
  const items = [];

  // ── context tier crossing (per-session) ──
  const ctx = transcriptPath ? sessionCtx(transcriptPath) : null;
  if (ctx) {
    const tier = ctxTierOf(ctx.pct);
    if (tier > (s.ctxTier || 0)) {
      // Name the window the percentage was actually computed against — when
      // autoCompactWindow caps a 1M model at 400k, "1M 창의 80%" would be a
      // number the user cannot reconcile with anything they configured.
      const winLabel = ctx.window >= 1_000_000 ? '1M' : fmtK(ctx.window);
      const capNote = ctx.compactCapped ? ' (autoCompactWindow 기준)' : '';
      items.push(tier === 2
        ? `이 세션의 컨텍스트가 ${winLabel} 창${capNote}의 95%를 넘었습니다(직전 요청 입력 ${fmtK(ctx.input)}). 곧 자동 압축으로 맥락 손실이 생길 수 있으니, 진행 중인 작업을 일단락하고 새 세션을 시작하는 편이 좋습니다.`
        : `이 세션의 컨텍스트가 ${winLabel} 창${capNote}의 80%를 넘었습니다(직전 요청 입력 ${fmtK(ctx.input)}). 이후 요청은 비용이 커지는 구간입니다 — 작업이 일단락되면 새 세션 시작을 권합니다.`);
      s.ctxTier = tier;
    }
  }

  // ── mid-session route-scan / rule-health changes (global state, briefed
  //    at most once per session per signature) ──
  try {
    const rs = await import('./route-scan.js');
    const mr = await import('./model-rules.js');
    const briefed = new Set(s.briefed || []);
    const fresh = [];
    for (const c of rs.openCandidates(rs.readRouteScan())) {
      const sig = `route|${c.signature}`;
      if (briefed.has(sig)) continue;
      briefed.add(sig);
      fresh.push(['route', c]);
    }
    for (const r of mr.loadModelRules().rules) {
      if (r.status !== 'review') continue;
      const sig = `health|${r.signature}|${r.scope}`;
      if (briefed.has(sig)) continue;
      briefed.add(sig);
      fresh.push(['health', r]);
    }
    for (const [kind, x] of fresh) {
      items.push(kind === 'route'
        ? `새 위임 후보가 감지되었습니다 — "${x.label}" 유형 ${x.count}회 반복(statusline의 route? R${x.id} 칩). 등록: claude-token-saver harness promote R${x.id} --project|--global (적용 범위는 사용자에게 확인) / 무시: route-scan dismiss ${x.id}`
        : `승인된 위임 룰의 최근 에러율이 기준(20%)을 넘었습니다 — "${x.label}" (statusline의 rule-health 칩). 조건 좁히기/제거를 사용자와 상의하세요: claude-token-saver route-scan rules`);
    }
    s.briefed = [...briefed];
  } catch { /* caches unreadable — ctx briefing above still applies */ }

  // ── auto-compact window misconfigured on a 1M model (once per session) ──
  // Config defect, not a usage trend: on a 1M window compaction only fires
  // past ~800k, so every request until then re-bills a context the session
  // never needed. 200k sessions are exempt (their window is already <= 200k).
  try {
    const cw = await import('./compact-window.js');
    const st = cw.compactWindowStatus({ root: process.cwd() });
    if (!st.ok) {
      const sig = `compact-window|${st.reason}`;
      const briefed = new Set(s.briefed || []);
      if (!briefed.has(sig)) {
        briefed.add(sig);
        s.briefed = [...briefed];
        const now = st.window ? `현재 ${fmtK(st.window)}` : '현재 미설정';
        items.push(`1M 컨텍스트 모델(${st.model})인데 autoCompactWindow가 ${now}입니다 — 자동 압축이 80만 토큰 근처에서야 걸려 그전까지 모든 요청이 전체 컨텍스트를 재과금합니다. 40만으로 고정하면 1M 창은 그대로 두고 압축 시점만 앞당깁니다. 등록: claude-token-saver compact-window set --global|--project (적용 범위는 사용자에게 확인) / 끄기: compact-window off`);
      }
    }
  } catch { /* settings unreadable — other briefings above still apply */ }

  s.ts = now;
  state.sessions[sessionId] = s;
  saveState(state, now);

  if (items.length === 0) return null;
  const lines = [
    '[claude-token-saver 브리핑] 아래 상태 변화를 사용자에게 알려주세요. 진행 중인 답변 흐름을 끊지 말고, 답변 말미에 `※ [claude-token-saver]` 라벨을 달아 각 항목을 1~2줄로 요약해 전달하면 됩니다 (이 브리핑은 항목당 한 번만 주입됩니다):',
  ];
  for (const it of items) lines.push(`- ${it}`);
  return lines.join('\n');
}
