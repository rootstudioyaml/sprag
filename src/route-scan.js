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
import { userDataDir } from './paths.js';
import { discoverSessionFiles } from './parser.js';
import { collectSessionRecords } from './session-records.js';
import { collectSubagentRuns, indexRuns, runsForEpisode } from './subagent-records.js';
import { estimateCost, modelRank, TIER_TARGET_RANK, tierForRank } from './cost.js';
import { learnProfileMapping, resetModelAliasCache } from './model-alias.js';
import { agentPhrase, agentPhraseEn } from './agents.js';

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
// Irreversible/external actions (store submission, deploy, release, merge)
// are included — they may look like light "run" episodes in the logs, but
// delegating them defeats the harness's default-safe-path rule.
export const ESCALATE_RE = /설계|아키텍처|리팩토링|원인 분석|개선할|검토해보|비교|왜 |제출|배포|출시|analyze|compare|evaluate|architect|refactor|submit|deploy|release|publish|merge/i;
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

// Categories → recommended subagent. Classification is behavior-first with
// weighted keyword scoring as fallback — see categorize().
const PASTE_MIN_LEN = 400;
const CATEGORIES = [
  {
    id: 'paste',
    label: '붙여넣은 화면·로그 질문',
    labelEn: 'questions about pasted screens/logs',
    agent: 'haiku-explore',
    kw: null, // matched by length, see categorize()
  },
  {
    id: 'translate',
    label: '배치 번역·정형 텍스트 변환',
    labelEn: 'batch translation / mechanical text transforms',
    agent: 'haiku-translate',
    kw: [[/번역|translate/i, 2], [/변환해|표로 정리|포맷팅/i, 1]],
  },
  {
    id: 'explore',
    label: '탐색·조회 (파일/값 찾기)',
    labelEn: 'lookup (finding files/values)',
    agent: 'haiku-explore',
    kw: [[/grep|검색|search|find/i, 2], [/찾아|어디|위치|목록|살펴/i, 1]],
  },
  {
    id: 'read',
    label: '읽기·요약·설명',
    labelEn: 'reading / summarizing / explaining',
    agent: 'haiku-explore',
    kw: [[/요약|summar|explain/i, 2], [/읽어|설명|정리해|보여줘|알려줘|뭐야|what/i, 1]],
  },
  {
    id: 'check',
    label: '상태 확인·검증',
    labelEn: 'status checks / verification',
    agent: 'haiku-explore',
    kw: [[/확인|검증|verify|점검/i, 2], [/맞아\?|되나|됐나|됐어|되는지|괜찮|체크|check|status/i, 1]],
  },
  {
    id: 'run',
    label: '명령 실행 (빌드·테스트·git)',
    labelEn: 'running commands (build/test/git)',
    agent: 'haiku-runner',
    kw: [[/git |commit|push|npm |pip|빌드해|빌드 돌/i, 2], [/실행|돌려|run |build|빌드|테스트|설치/i, 1]],
  },
];

// ── Behavior signal (1st) — what the episode actually DID ────────────────
// The tool-call histogram is ground truth the prompt's wording is not:
// "테스트 통과했는지 확인해줘" that actually ran `npx playwright test` IS a
// run episode regardless of phrasing. Keyword scores only pick within (or,
// when behavior is inconclusive, across) the plausible pool.
const RUN_TOOLS = new Set(['Bash']);
const LOOKUP_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const MIN_BEHAVIOR_CALLS = 2; // fewer calls than this → too little behavior to trust

/**
 * Narrow the candidate categories from the episode's tool mix.
 * Returns { ids, fallback } — ids are the candidate categories, fallback is
 * the id to use when keywords stay silent (null = keywords are REQUIRED, an
 * id-less episode is not a delegation candidate). Returns null when behavior
 * is inconclusive.
 */
export function behaviorPool(toolCounts) {
  let run = 0, lookup = 0, write = 0, total = 0;
  for (const [name, n] of Object.entries(toolCounts || {})) {
    total += n;
    if (RUN_TOOLS.has(name)) run += n;
    else if (LOOKUP_TOOLS.has(name)) lookup += n;
    else if (WRITE_TOOLS.has(name)) write += n;
  }
  if (total < MIN_BEHAVIOR_CALLS) return null;
  if (run > lookup + write) return { ids: ['run'], fallback: 'run' };
  if (lookup > run + write) return { ids: ['explore', 'read', 'check', 'translate'], fallback: 'explore' };
  // Write-dominant episodes are EDITING work, not delegable lookups — without
  // this they leak into read/explore via generic keywords ("설명이 필요해보이는데"
  // + Edit×5 landed in read/T1). Only translate legitimately writes, so it is
  // the sole candidate — and only with explicit translate keywords (no
  // silent fallback: an editing episode is not a delegation candidate).
  if (write > run + lookup) return { ids: ['translate'], fallback: null };
  return null; // mixed — no reliable verdict, keywords decide
}

/** Weighted keyword score for one category (0 when it has no kw table). */
function keywordScore(cat, text) {
  if (!cat.kw) return 0;
  let score = 0;
  for (const [re, w] of cat.kw) if (re.test(text)) score += w;
  return score;
}

// Episodes that are not user-delegable requests: bare continuations, injected
// notifications, image pastes. These are easy but there is nothing to route.
const SKIP_RE = /^(계속|이어서|continue|다음|proceed|진행|응|네|넵|ok|okay|yes|ㄱ+|고고)\b/i;
const SKIP_PREFIX = ['<task-notification', '<system', '[Image:', '<local-command'];

// Single source of truth for the state dir (paths.js). A local copy used to
// live here and honored XDG_CONFIG_HOME on Linux only, so on macOS/Windows an
// XDG override split this cache away from config.json and the session cache.
const stateDir = userDataDir;

export function routeScanCachePath() {
  return join(stateDir(), 'route-scan.json');
}

/** Munge an absolute path the way Claude Code names project dirs. */
export function mungeProjectPath(p) {
  return String(p).replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Classify an episode. Gates (paste by length) run first, then the tool-mix
 * behavior signal narrows the candidate pool, then weighted keyword scores
 * pick within it (highest score wins; ties fall back to CATEGORIES order).
 * A behavior verdict without any keyword hit still classifies (pool's first
 * id); no behavior AND no keyword hit → null (nothing delegable to name).
 */
export function categorize(text, toolCounts) {
  if (text.length >= PASTE_MIN_LEN) return CATEGORIES.find((c) => c.id === 'paste');
  const pool = behaviorPool(toolCounts);
  const eligible = pool
    ? pool.ids.map((id) => CATEGORIES.find((c) => c.id === id))
    : CATEGORIES.filter((c) => c.kw);
  let best = null;
  let bestScore = 0;
  for (const c of eligible) {
    const s = keywordScore(c, text);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  if (best) return best;
  if (pool?.fallback) return CATEGORIES.find((c) => c.id === pool.fallback);
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
      cur = {
        text, calls: 0, out: 0, mutating: 0, errors: 0, delegated: 0,
        models: new Set(), cwd: '', tools: {},
        // Delegation attribution (subagent-records): exact join key, plus the
        // episode's time span for the fallback when a run has no meta file.
        delegationToolUseIds: [], startedAt: null, endedAt: null,
      };
      episodes.push(cur);
    }
    cur.calls += 1;
    cur.out += r.completion_tokens;
    cur.mutating += r.mutatingToolCalls || 0;
    cur.errors += r.toolErrors || 0;
    cur.delegated += r.delegationCalls || 0;
    for (const [name, n] of Object.entries(r.toolCounts || {})) {
      cur.tools[name] = (cur.tools[name] || 0) + n;
    }
    for (const id of r.delegationToolUseIds || []) cur.delegationToolUseIds.push(id);
    if (r.timestamp) {
      const t = Date.parse(r.timestamp);
      if (Number.isFinite(t)) {
        if (cur.startedAt === null || t < cur.startedAt) cur.startedAt = t;
        if (cur.endedAt === null || t > cur.endedAt) cur.endedAt = t;
      }
    }
    cur.models.add(r.model);
    if (!cur.cwd && r.cwd) cur.cwd = r.cwd;
  }
  return episodes;
}

/**
 * Price rank of the model that actually handled the episode (the most
 * expensive one, when a session switched models mid-episode).
 */
export function episodeRank(ep) {
  let rank = -1;
  for (const m of ep.models) rank = Math.max(rank, modelRank(m));
  return rank;
}

/**
 * Delegation only pays when the target tier is strictly cheaper than what ran
 * the work. Without this a Sonnet session produced "delegate to sonnet" T1
 * rules — a subagent rebuilding context for zero price difference, which is a
 * net loss. (Replaces the old boolean "is it haiku?" test, which could not
 * tell a Sonnet session from a Fable one.)
 */
export function worthDelegating(tier, rank) {
  const target = TIER_TARGET_RANK[tier];
  return target !== undefined && rank > target;
}

/**
 * USD a delegated run saved versus the session model doing the same work.
 * Approximation, deliberately stated as one: it holds token counts constant,
 * which a cheaper model would not reproduce exactly. Directionally right and
 * enough to rank rules by value, so it is rendered as "~$X".
 */
export function runSaving(run, mainModel) {
  if (!run.model || !mainModel) return 0;
  const totals = {
    input: run.input,
    cacheCreation: run.cacheCreation,
    cacheRead: run.cacheRead,
    ephemeral5m: run.ephemeral5m,
    ephemeral1h: run.ephemeral1h,
    output: run.out,
  };
  const actual = estimateCost(totals, run.model).actual;
  const counterfactual = estimateCost(totals, mainModel).actual;
  return Math.max(0, counterfactual - actual);
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

  // Behind a Bedrock/LiteLLM gateway the transcripts carry an inference-profile
  // ARN where the model id belongs, which reads as Sonnet and rejects every T1
  // rule. Refresh the profile→role mapping before parsing so this scan resolves
  // those ids; on a direct-API machine it finds nothing and writes nothing.
  resetModelAliasCache();
  try {
    await learnProfileMapping({ sessionPaths: files.map((f) => f.path) });
  } catch { /* learning is an optimization — the scan still runs without it */ }
  resetModelAliasCache();

  // Pass 1 — collect episodes (needed up front: thresholds are calibrated
  // from the full window's output distribution before any tiering).
  const all = []; // { ep, projectDir, sessionPath }
  let dataBytes = 0; // window size snapshot — the rescan gate diffs against it
  const runIndexBySession = new Map(); // sessionPath → indexRuns() result
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
      all.push({ ep, projectDir: f.projectDir, sessionPath: f.path });
    }
    // Subagent transcripts of this session — the real outcome of every
    // delegation it made. Best-effort: sessions that never delegated have no
    // directory and cost one failed readdir.
    const runs = await collectSubagentRuns(f.path);
    if (runs.length > 0) {
      runIndexBySession.set(f.path, indexRuns(runs));
      // Subagent bytes count toward the window size so the rescan gate stays
      // accurate for delegation-heavy workloads.
      for (const r of runs) dataBytes += r.bytes || 0;
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
    const epRank = episodeRank(ep);
    if (!worthDelegating('T2', epRank)) continue; // already at the cheapest tier
    const cat = categorize(ep.text, ep.tools);
    if (cat) {
      // rule-health denominator: episodes that LOOK delegable by shape
      // (tier judged with the error signal zeroed — using real errors here
      // would be circular, since T2 requires errors=0 by definition). The
      // numerator is those that still hit errors: exactly the "light-looking
      // work in this category keeps failing" risk a delegation rule cares about.
      // Keyed by tier as well: a category can carry both a T2 and a T1 rule,
      // and sharing one category-wide stat would double-count every episode
      // into both rules (identical ×N / err% on unrelated tiers).
      const shapeTier = tierOf({ ...ep, errors: 0 }, cat, thresholds);
      // Same rank gate as the candidate path below — a denominator counting
      // episodes that can't produce a rule would skew that rule's error rate.
      if ((shapeTier === 'T1' || shapeTier === 'T2') && worthDelegating(shapeTier, epRank)) {
        bumpStats(`${shapeTier}|${cat.id}|${projectDir}`, ep);
        bumpStats(`${shapeTier}|${cat.id}|*`, ep);
      }
    }
    const tier = tierOf(ep, cat, thresholds);
    if (tier !== 'T1' && tier !== 'T2') continue;
    if (!worthDelegating(tier, epRank)) continue;
    tieredEpisodes += 1;
    const key = `${tier}|${cat.id}|${projectDir}`;
    const g = groups.get(key) || {
      tier,
      category: cat.id,
      label: cat.label,
      labelEn: cat.labelEn,
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

  // Pass 3 — measured delegation outcomes (rule-health v2). Episodes that
  // DID delegate are excluded from tiering by design (tierOf returns T0 when
  // ep.delegated > 0: there is nothing left to route). But they are exactly
  // where a promoted rule's real success rate lives, so they get their own
  // pass: join each episode to the subagent transcripts it spawned, and file
  // the outcome under the tier that run's model represents — a haiku run is a
  // T2 rule firing, a sonnet run a T1 one. Runs that were not a downgrade
  // (same tier or higher) carry no delegation saving and are skipped.
  const delegatedStats = new Map(); // "tier|category|project" → outcome aggregate
  const bumpDelegated = (key, run, saved) => {
    const d = delegatedStats.get(key) || { runs: 0, errRuns: 0, outTokens: 0, savedUsd: 0 };
    d.runs += 1;
    if (run.toolErrors > 0) d.errRuns += 1;
    d.outTokens += run.out || 0;
    d.savedUsd += saved;
    delegatedStats.set(key, d);
  };
  for (const [sessionPath, index] of runIndexBySession) {
    const used = new Set();
    for (const { ep, projectDir, sessionPath: epSession } of all) {
      if (epSession !== sessionPath) continue;
      if (!ep.delegationToolUseIds.length && index.unjoined.length === 0) continue;
      const runs = runsForEpisode(index, ep, used);
      if (runs.length === 0) continue;
      const cat = categorize(ep.text, ep.tools);
      if (!cat) continue;
      // Counterfactual = the priciest model on the episode, i.e. what would
      // have done the work had it not been handed off.
      let mainModel = null;
      let mainRank = -1;
      for (const m of ep.models) {
        const r = modelRank(m);
        if (r > mainRank) { mainRank = r; mainModel = m; }
      }
      for (const run of runs) {
        const runTier = tierForRank(modelRank(run.model));
        if (!runTier || !worthDelegating(runTier, mainRank)) continue;
        const saved = runSaving(run, mainModel);
        bumpDelegated(`${runTier}|${cat.id}|${projectDir}`, run, saved);
        bumpDelegated(`${runTier}|${cat.id}|*`, run, saved);
      }
    }
  }

  // Keep prior dismissed/promoted signatures across rescans.
  const prev = readRouteScan();
  const resolved = new Set(prev?.resolved || []);

  // Never re-propose a pattern that already has a registered model-fitting
  // rule (a global rule covers the category in every project). Without this,
  // rules that entered the registry outside the promote flow — migrations,
  // future imports — would resurface as candidates forever.
  let registered = [];
  try {
    const { loadModelRules } = await import('./model-rules.js');
    registered = loadModelRules().rules;
  } catch { /* registry unreadable — candidates may repeat until promote */ }
  const hasRule = (g) => registered.some((r) =>
    r.tier === g.tier && r.category === g.category &&
    (r.scope === 'global' || r.project === g.project));

  // Both languages are computed at scan time and stored on the candidate, so
  // switching `language` later re-renders (and promotes) correctly without
  // waiting for a rescan.
  // The probe-then-commit budget is deliberately NOT baked into this text:
  // model-rules composes it on (composeRuleText), so rules promoted before
  // budgets existed gain the clause too, and the promote preview can never
  // drift from what lands in the file. What the candidate carries is the
  // calibrated budget itself — the user's own thresholds, snapshotted at scan
  // time rather than hardcoded downstream.
  const budgetOf = (g) => ({
    calls: g.tier === 'T2' ? T2_MAX_CALLS + 2 : null,
    out: g.tier === 'T2' ? thresholds.t2Out : thresholds.t1Out,
  });
  const ruleText = (g) => g.tier === 'T2'
    ? `"${g.label}" 유형의 단순 요청(예: "${g.example}")은 ${agentPhrase(g.agent)} 서브에이전트로 위임한다 (설계 판단·배포·스토어 제출 같은 비가역 작업이 섞이면 위임하지 않음)`
    : `"${g.label}" 유형의 중간 난도 요청(예: "${g.example}")은 model: sonnet 서브에이전트로 위임한다 (설계 판단·비가역 작업·반복 에러 발생 시 메인 모델이 이어받음)`;
  const ruleTextEn = (g) => g.tier === 'T2'
    ? `Delegate simple "${g.labelEn}" requests (e.g. "${g.example}") to ${agentPhraseEn(g.agent)} — never when the request mixes in design judgement or irreversible work like deploy/release/submission`
    : `Delegate moderate "${g.labelEn}" requests (e.g. "${g.example}") to a model: sonnet subagent — hand back to the main model on design judgement, irreversible work, or repeated errors`;

  const candidates = [...groups.values()]
    .filter((g) => g.count >= MIN_RECURRENCE && !hasRule(g))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((g, i) => ({
      id: i + 1,
      signature: `${g.tier}|${g.category}|${g.project}`,
      tier: g.tier,
      category: g.category,
      label: g.label,
      labelEn: g.labelEn,
      agent: g.agent,
      project: g.project,
      // Real session cwd for the project (munged `project` is lossy) — lets
      // `harness promote R<N> --project` write the rule into the project the
      // pattern was detected in, not whatever directory the CLI runs from.
      projectPath: g.projectPath || null,
      count: g.count,
      models: [...g.models],
      example: g.example,
      // Snapshot of the calibrated budget this rule was written against, so
      // the merged T2+T1 rendering in ratchet-model.md can restate it without
      // re-running a scan.
      budget: budgetOf(g),
      // Concentrated in one project dir → project rule; the scan groups by
      // project already, so scope suggestion is per-candidate 'project' unless
      // the same category recurs across 2+ projects (then 'global').
      suggestedScope: 'project',
      rule: ruleText(g),
      ruleEn: ruleTextEn(g),
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
    refreshModelRules(episodeStats, delegatedStats, { now: cache.scannedAt });
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

/**
 * Human-readable labels for the T0/T1/T2 codes and scope values — used by
 * every user-facing listing so a bare code never appears without its meaning
 * (first-time users can't be expected to know the tier vocabulary).
 */
export function tierLabel(tier, lang = 'ko') {
  const ko = {
    T2: '단순 작업 — haiku급이면 충분',
    T1: '중간 난도 — sonnet급이면 충분',
    T0: '고난도 — 지금 모델 유지',
  };
  const en = {
    T2: 'simple — haiku-class is enough',
    T1: 'moderate — sonnet-class is enough',
    T0: 'hard — stays on the session model',
  };
  return (lang === 'ko' ? ko : en)[tier] || tier;
}

export function scopeLabel(scope, lang = 'ko') {
  if (lang === 'ko') return scope === 'global' ? '모든 프로젝트(글로벌)' : '이 프로젝트만';
  return scope === 'global' ? 'all projects (global)' : 'this project only';
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
