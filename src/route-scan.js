/**
 * route-scan — detect recurring "easy" work running on expensive models and
 * propose model-delegation ratchet rules.
 *
 * Difficulty is judged at the EPISODE level (one user request = the
 * consecutive API calls it triggered), because per-call scoring saturates on
 * Claude Code's large session contexts — prompt size carries no signal when
 * every call ships a 100k+ cached prefix. An episode is easy when the whole
 * request finished in few calls with little generation — exactly the work a
 * haiku subagent could take.
 *
 * Fully local, zero token cost. Results are cached (24h) so the SessionStart
 * hook can read them without re-parsing a month of transcripts.
 *
 * Pipeline position (per design discussion): this scan is NOT a real-time
 * router — it is a session-boundary calibrator that feeds the existing
 * ratchet promote flow (`harness promote R<N> --project|--global`).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { discoverSessionFiles } from './parser.js';
import { collectSessionRecords } from './session-records.js';

// ── Tier bands (docs/TIER_CRITERIA.md §3) ────────────────────────────────
// T2 (haiku): finished in few calls, tiny output, near-zero mutation, no
//   errors. T1 (sonnet): moderate output/mutation, at most one tool error.
// T0: everything else stays on the session model. Output-token thresholds
// are calibrated per-user from their own 14-day distribution (fixed
// thresholds drift with workload — RouteLLM's stated limitation), clamped
// to sane ranges so a skewed window can't stretch them absurdly.
export const T2_MAX_CALLS = 6;
export const T2_MAX_MUTATING = 2;
export const T2_OUT_CLAMP = [1000, 3000];   // default 1500 pre-calibration
export const T1_MAX_MUTATING = 6;
export const T1_MAX_ERRORS = 1;
export const T1_OUT_CLAMP = [5000, 15000];  // default 8000 pre-calibration
export const T0_MIN_ERRORS = 2;             // repeated tool errors = hard, by outcome
export const T0_MIN_MUTATING = 7;
// Episodes below this output size carry no delegable work (conversational
// acks, feedback) — skip entirely.
export const MIN_DELEGABLE_OUT = 100;
// Escalation keywords: design/analysis judgement stays on the top tier.
export const ESCALATE_RE = /설계|아키텍처|리팩토링|원인 분석|개선할|검토해보|비교|왜 |analyze|compare|evaluate|architect|refactor/i;
// A pattern must recur this often before we nag about it.
export const MIN_RECURRENCE = 3;

// ── Rescan gate (data-driven, not time-driven) ───────────────────────────
// A scan over unchanged transcripts is deterministic — identical output —
// so time alone is a bad trigger: it wastes scans on idle days and lags a
// full day behind heavy ones. Instead we rescan when enough NEW transcript
// data accumulated (~5MB ≈ 20-40 episodes on measured data — enough for a
// pattern to newly cross MIN_RECURRENCE), with guardrails: a minimum
// interval against session-churn thrash, a daily fallback so small trickles
// still refresh rule-health, and a hard skip when nothing changed at all.
export const RESCAN_MIN_INTERVAL_MS = 60 * 60 * 1000;      // never more than hourly
export const RESCAN_BIG_DELTA_BYTES = 5 * 1024 * 1024;     // this much new data → rescan now
export const RESCAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;      // any new data + a day old → rescan

// Category → recommended subagent. First match wins; order matters
// (paste before everything: keywords inside pasted UI/log text would
// otherwise mislabel the episode; translate before read: "번역해줘" also
// matches the read keywords).
const PASTE_MIN_LEN = 400;
const CATEGORIES = [
  {
    id: 'paste',
    label: '붙여넣은 화면·로그 질문',
    agent: 'haiku-explore',
    re: null, // matched by length, see categorize()
  },
  {
    id: 'translate',
    label: '배치 번역·정형 텍스트 변환',
    agent: 'haiku-translate',
    re: /번역|translate|변환해|표로 정리|포맷팅/i,
  },
  {
    id: 'explore',
    label: '탐색·조회 (파일/값 찾기)',
    agent: 'haiku-explore',
    re: /grep|검색|찾아|search|find|어디|위치|목록|살펴/i,
  },
  {
    id: 'read',
    label: '읽기·요약·설명',
    agent: 'haiku-explore',
    re: /읽어|요약|설명|정리해|summar|explain|보여줘|알려줘|뭐야|what/i,
  },
  {
    id: 'run',
    label: '명령 실행 (빌드·테스트·git)',
    agent: 'haiku-runner',
    re: /git |commit|push|실행|돌려|run |build|빌드|테스트|npm |pip|설치/i,
  },
  {
    id: 'check',
    label: '상태 확인·검증',
    agent: 'haiku-explore',
    re: /확인|맞아\?|되나|됐나|괜찮|체크|check|verify|status|점검/i,
  },
];

// Episodes that are not user-delegable requests: bare continuations, injected
// notifications, image pastes. These are easy but there is nothing to route.
const SKIP_RE = /^(계속|이어서|continue|다음|proceed|진행|응|네|넵|ok|okay|yes|ㄱ+|고고)\b/i;
const SKIP_PREFIX = ['<task-notification', '<system', '[Image:', '<local-command'];

function stateDir() {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || homedir(), 'claude-token-saver');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'claude-token-saver');
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'claude-token-saver');
}

export function routeScanCachePath() {
  return join(stateDir(), 'route-scan.json');
}

/** Munge an absolute path the way Claude Code names project dirs. */
export function mungeProjectPath(p) {
  return String(p).replace(/[^a-zA-Z0-9-]/g, '-');
}

function categorize(text) {
  if (text.length >= PASTE_MIN_LEN) return CATEGORIES.find((c) => c.id === 'paste');
  for (const c of CATEGORIES) if (c.re && c.re.test(text)) return c;
  return null;
}

function isSkippable(text) {
  if (!text) return true;
  if (SKIP_RE.test(text.trim())) return true;
  return SKIP_PREFIX.some((p) => text.startsWith(p));
}

/** Group a session's records into episodes (consecutive same trigger prompt). */
function toEpisodes(records) {
  const episodes = [];
  let cur = null;
  for (const r of records) {
    const text = (r.userText || '').trim();
    if (!cur || cur.text !== text) {
      cur = { text, calls: 0, out: 0, mutating: 0, errors: 0, delegated: 0, models: new Set(), cwd: '' };
      episodes.push(cur);
    }
    cur.calls += 1;
    cur.out += r.completion_tokens;
    cur.mutating += r.mutatingToolCalls || 0;
    cur.errors += r.toolErrors || 0;
    cur.delegated += r.delegationCalls || 0;
    cur.models.add(r.model);
    if (!cur.cwd && r.cwd) cur.cwd = r.cwd;
  }
  return episodes;
}

function isExpensiveModel(model) {
  return !/haiku/i.test(model);
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/**
 * Per-user output-token thresholds from this window's episode distribution.
 * Falls back to mid-clamp defaults when the sample is too small to trust.
 */
export function calibrateThresholds(episodeOuts) {
  if (episodeOuts.length < 100) return { t2Out: 1500, t1Out: 8000, calibrated: false };
  const sorted = [...episodeOuts].sort((a, b) => a - b);
  return {
    t2Out: clamp(Math.max(percentile(sorted, 0.25), 1500), T2_OUT_CLAMP),
    t1Out: clamp(percentile(sorted, 0.75), T1_OUT_CLAMP),
    calibrated: true,
  };
}

/**
 * Tier classification (docs/TIER_CRITERIA.md §3). Returns 'T0'|'T1'|'T2',
 * or null when the episode carries nothing delegable. Order matters: hard
 * evidence (errors, heavy mutation, big output, judgement keywords) wins
 * before any cheap-band check.
 */
export function tierOf(ep, category, th) {
  if (ep.out < MIN_DELEGABLE_OUT) return null;
  if (
    ep.errors >= T0_MIN_ERRORS ||
    ep.mutating >= T0_MIN_MUTATING ||
    ep.out > th.t1Out ||
    ESCALATE_RE.test(ep.text)
  ) return 'T0';
  if (!category || ep.delegated > 0) return 'T0';
  if (ep.calls <= T2_MAX_CALLS && ep.out <= th.t2Out && ep.mutating <= T2_MAX_MUTATING && ep.errors === 0) return 'T2';
  if (ep.out <= th.t1Out && ep.mutating <= T1_MAX_MUTATING && ep.errors <= T1_MAX_ERRORS) return 'T1';
  return 'T0';
}

/**
 * Scan transcripts and build delegation candidates.
 * Returns the cache object (also written to disk).
 */
export async function runRouteScan({ days = 14 } = {}) {
  const files = await discoverSessionFiles({ days });

  // Pass 1 — collect episodes (needed up front: thresholds are calibrated
  // from the full window's output distribution before any tiering).
  const all = []; // { ep, projectDir }
  let dataBytes = 0; // window size snapshot — the rescan gate diffs against it
  for (const f of files) {
    let records;
    try {
      dataBytes += statSync(f.path).size;
      records = await collectSessionRecords(f.path, { includeContent: true });
    } catch {
      continue;
    }
    for (const ep of toEpisodes(records)) {
      if (!ep.text) continue;
      all.push({ ep, projectDir: f.projectDir });
    }
  }
  const totalEpisodes = all.length;
  const thresholds = calibrateThresholds(all.map((x) => x.ep.out));

  // Pass 2 — tier, group by tier×category×project, and accumulate the
  // per-category outcome stats that keep promoted model rules fresh.
  const groups = new Map(); // "tier|category|project" → aggregate
  const episodeStats = new Map(); // "category|project" (+ "category|*") → outcome stats
  let tieredEpisodes = 0;
  const bumpStats = (key, ep) => {
    const s = episodeStats.get(key) || { count: 0, errCount: 0, epCount: 0 };
    s.count += 1;
    s.epCount += 1;
    if (ep.errors > 0) s.errCount += 1;
    episodeStats.set(key, s);
  };

  for (const { ep, projectDir } of all) {
    if (isSkippable(ep.text)) continue;
    if (![...ep.models].some(isExpensiveModel)) continue; // already cheap
    const cat = categorize(ep.text);
    if (cat) {
      // rule-health denominator: episodes that LOOK delegable by shape
      // (tier judged with the error signal zeroed — using real errors here
      // would be circular, since T2 requires errors=0 by definition). The
      // numerator is those that still hit errors: exactly the "light-looking
      // work in this category keeps failing" risk a delegation rule cares about.
      const shapeTier = tierOf({ ...ep, errors: 0 }, cat, thresholds);
      if (shapeTier === 'T1' || shapeTier === 'T2') {
        bumpStats(`${cat.id}|${projectDir}`, ep);
        bumpStats(`${cat.id}|*`, ep);
      }
    }
    const tier = tierOf(ep, cat, thresholds);
    if (tier !== 'T1' && tier !== 'T2') continue;
    tieredEpisodes += 1;
    const key = `${tier}|${cat.id}|${projectDir}`;
    const g = groups.get(key) || {
      tier,
      category: cat.id,
      label: cat.label,
      agent: tier === 'T2' ? cat.agent : 'sonnet',
      project: projectDir,
      projectPath: '',
      count: 0,
      models: new Set(),
      example: '',
    };
    g.count += 1;
    for (const m of ep.models) g.models.add(m);
    if (!g.projectPath && ep.cwd) g.projectPath = ep.cwd;
    if (!g.example || (ep.text.length < g.example.length && ep.text.length > 10)) {
      g.example = ep.text.slice(0, 80).replace(/\s+/g, ' ');
    }
    groups.set(key, g);
  }

  // Keep prior dismissed/promoted signatures across rescans.
  const prev = readRouteScan();
  const resolved = new Set(prev?.resolved || []);

  const ruleText = (g) => g.tier === 'T2'
    ? `"${g.label}" 유형의 단순 요청(예: "${g.example}")은 ${g.agent}(haiku) 서브에이전트로 위임한다`
    : `"${g.label}" 유형의 중간 난도 요청(예: "${g.example}")은 model: sonnet 서브에이전트로 위임한다 (설계 판단·반복 에러 발생 시 메인 모델이 이어받음)`;

  const candidates = [...groups.values()]
    .filter((g) => g.count >= MIN_RECURRENCE)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((g, i) => ({
      id: i + 1,
      signature: `${g.tier}|${g.category}|${g.project}`,
      tier: g.tier,
      category: g.category,
      label: g.label,
      agent: g.agent,
      project: g.project,
      // Real session cwd for the project (munged `project` is lossy) — lets
      // `harness promote R<N> --project` write the rule into the project the
      // pattern was detected in, not whatever directory the CLI runs from.
      projectPath: g.projectPath || null,
      count: g.count,
      models: [...g.models],
      example: g.example,
      // Concentrated in one project dir → project rule; the scan groups by
      // project already, so scope suggestion is per-candidate 'project' unless
      // the same category recurs across 2+ projects (then 'global').
      suggestedScope: 'project',
      rule: ruleText(g),
    }));

  // Same category appearing in 2+ projects → suggest global for each.
  const catProjects = new Map();
  for (const c of candidates) {
    catProjects.set(c.category, (catProjects.get(c.category) || 0) + 1);
  }
  for (const c of candidates) {
    if ((catProjects.get(c.category) || 0) >= 2) c.suggestedScope = 'global';
  }

  const cache = {
    scannedAt: new Date().toISOString(),
    days,
    totalEpisodes,
    dataBytes,
    // kept as `easyEpisodes` for statusline/back-compat; now counts T1+T2.
    easyEpisodes: tieredEpisodes,
    thresholds,
    candidates,
    resolved: [...resolved],
  };
  try {
    const dir = stateDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(routeScanCachePath(), JSON.stringify(cache, null, 2) + '\n');
  } catch {
    // best-effort — scan results are still returned
  }

  // Continuous update (user requirement): every rescan refreshes promoted
  // model-fitting rules from the new window — recurrence counts, error
  // rates, and rule-health flags — and rewrites their managed blocks.
  try {
    const { refreshModelRules } = await import('./model-rules.js');
    refreshModelRules(episodeStats, { now: cache.scannedAt });
  } catch { /* registry unwritable — scan result still valid */ }

  return cache;
}

/** Read the cached scan (null when absent/corrupt). */
export function readRouteScan() {
  try {
    return JSON.parse(readFileSync(routeScanCachePath(), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Data-driven rescan gate (see constants above). Cheap: one stat() per
 * transcript file (~32 files on measured data) — a few milliseconds.
 */
export async function shouldRescan(cache, { days = 14 } = {}) {
  if (!cache?.scannedAt) return true;
  const ts = Date.parse(cache.scannedAt);
  if (!Number.isFinite(ts)) return true;
  const age = Date.now() - ts;
  if (age < RESCAN_MIN_INTERVAL_MS) return false;

  let total = 0;
  let anyNew = false;
  try {
    for (const f of await discoverSessionFiles({ days })) {
      const s = statSync(f.path);
      total += s.size;
      if (s.mtimeMs > ts) anyNew = true;
    }
  } catch {
    return age >= RESCAN_MAX_AGE_MS; // can't stat — degrade to daily
  }
  if (!anyNew) return false; // nothing changed → identical scan, skip forever
  // Append-only transcripts: window growth ≈ new data. Files aging out of
  // the window shrink the total, making this estimate conservative.
  const newBytes = Math.max(0, total - (cache.dataBytes || 0));
  if (newBytes >= RESCAN_BIG_DELTA_BYTES) return true;
  return age >= RESCAN_MAX_AGE_MS;
}

/** Candidates not yet promoted/dismissed. */
export function openCandidates(cache) {
  if (!cache?.candidates) return [];
  const resolved = new Set(cache.resolved || []);
  return cache.candidates.filter((c) => !resolved.has(c.signature));
}

/**
 * Mark a candidate resolved (promoted or dismissed) so the chip stops and
 * rescans don't resurface it. Returns the candidate or null.
 */
export function resolveCandidate(id) {
  const cache = readRouteScan();
  if (!cache) return null;
  const cand = (cache.candidates || []).find((c) => c.id === id);
  if (!cand) return null;
  cache.resolved = [...new Set([...(cache.resolved || []), cand.signature])];
  try {
    writeFileSync(routeScanCachePath(), JSON.stringify(cache, null, 2) + '\n');
  } catch {
    return null;
  }
  return cand;
}

/**
 * Statusline helper — cheapest possible check (one small JSON read).
 * Returns `route? #N` for the top open candidate relevant to this project
 * (its own project dir, or a global-scoped suggestion), else null.
 */
export function routeWarningForStatusline(projectRoot) {
  const cache = readRouteScan();
  if (!cache) return null;
  const open = openCandidates(cache);
  if (open.length === 0) return null;
  const munged = mungeProjectPath(projectRoot || '');
  const hit = open.find((c) => c.project === munged || c.suggestedScope === 'global');
  return hit ? `route? R${hit.id}` : null;
}
