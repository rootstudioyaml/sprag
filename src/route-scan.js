/**
 * route-scan — detect recurring "easy" work running on expensive models and
 * propose model-delegation ratchet rules.
 *
 * Runs the frugon-style difficulty idea at the EPISODE level (one user
 * request = the consecutive API calls it triggered), because per-call scoring
 * saturates on Claude Code's large session contexts. An episode is easy when
 * the whole request finished in few calls with little generation — exactly
 * the work a haiku subagent could take.
 *
 * Fully local, zero token cost. Results are cached (24h) so the SessionStart
 * hook can read them without re-parsing a month of transcripts.
 *
 * Pipeline position (per design discussion): frugon/this scan is NOT a
 * real-time router — it is a session-boundary calibrator that feeds the
 * existing ratchet promote flow (`harness promote R<N> --project|--global`).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { discoverSessionFiles } from './parser.js';
import { collectSessionRecords } from './frugon-export.js';

// Episode is "easy" when the whole user request finished within these bounds.
// Calibrated on real data (2026-07): 27% of episodes, 3-6% of tokens.
export const EASY_MAX_CALLS = 6;
export const EASY_MAX_OUT_TOKENS = 1500;
// A pattern must recur this often before we nag about it.
export const MIN_RECURRENCE = 3;
// Cache is fresh for a day — the SessionStart hook never rescans inline.
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Category → recommended haiku subagent. First match wins; order matters
// (translate before read: "번역해줘" also matches the read keywords).
const CATEGORIES = [
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
  for (const c of CATEGORIES) if (c.re.test(text)) return c;
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
      cur = { text, calls: 0, out: 0, models: new Set(), cwd: '' };
      episodes.push(cur);
    }
    cur.calls += 1;
    cur.out += r.completion_tokens;
    cur.models.add(r.model);
    if (!cur.cwd && r.cwd) cur.cwd = r.cwd;
  }
  return episodes;
}

function isExpensiveModel(model) {
  return !/haiku/i.test(model);
}

/**
 * Scan transcripts and build delegation candidates.
 * Returns the cache object (also written to disk).
 */
export async function runRouteScan({ days = 14 } = {}) {
  const files = await discoverSessionFiles({ days });
  const groups = new Map(); // "category|project" → aggregate
  let totalEpisodes = 0;
  let easyEpisodes = 0;

  for (const f of files) {
    let records;
    try {
      // Raw counts are irrelevant here (we classify by output size), and
      // content is required for categorization.
      records = await collectSessionRecords(f.path, { cacheWeighted: false, includeContent: true });
    } catch {
      continue;
    }
    for (const ep of toEpisodes(records)) {
      if (!ep.text) continue;
      totalEpisodes += 1;
      const easy = ep.calls <= EASY_MAX_CALLS && ep.out <= EASY_MAX_OUT_TOKENS;
      if (!easy) continue;
      easyEpisodes += 1;
      if (isSkippable(ep.text)) continue;
      if (![...ep.models].some(isExpensiveModel)) continue; // already cheap
      const cat = categorize(ep.text);
      if (!cat) continue;
      const key = `${cat.id}|${f.projectDir}`;
      const g = groups.get(key) || {
        category: cat.id,
        label: cat.label,
        agent: cat.agent,
        project: f.projectDir,
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
  }

  // Keep prior dismissed/promoted signatures across rescans.
  const prev = readRouteScan();
  const resolved = new Set(prev?.resolved || []);

  const candidates = [...groups.values()]
    .filter((g) => g.count >= MIN_RECURRENCE)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((g, i) => ({
      id: i + 1,
      signature: `${g.category}|${g.project}`,
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
      rule: `"${g.label}" 유형의 단순 요청(예: "${g.example}")은 ${g.agent}(haiku) 서브에이전트로 위임한다`,
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
    easyEpisodes,
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

export function isCacheFresh(cache) {
  if (!cache?.scannedAt) return false;
  const ts = Date.parse(cache.scannedAt);
  return Number.isFinite(ts) && Date.now() - ts < CACHE_TTL_MS;
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
