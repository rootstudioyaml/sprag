/**
 * model-rules — the MODEL-FITTING ratchet registry.
 *
 * Model-fitting rules (tier-delegation rules promoted from route-scan) are
 * managed SEPARATELY from user-authored ratchet rules, for two reasons the
 * user set as requirements:
 *   1. They must never tangle with hand-written rules — so they live in a
 *      fully tool-owned FILE (ratchet-model.md) next to ratchet.md,
 *      regenerated wholesale. A separate file (rather than a managed block
 *      inside ratchet.md) keeps auto-refresh churn out of the user's file:
 *      per-scan stat updates only ever touch ratchet-model.md, which can be
 *      gitignored, and there are no block markers a hand edit could corrupt.
 *   2. They must keep updating from subsequent logs — recurrence counts and
 *      post-promotion error rates are refreshed on every route-scan, and a
 *      rule whose delegated episodes start failing gets flagged for review
 *      (rule-health, per docs/TIER_CRITERIA.md).
 *
 * Registry file (source of truth): <stateDir>/model-rules.json
 *   { rules: [ { signature, tier, category, label, agent, scope,   // 'project'|'global'
 *                targetRoot,           // project root path (project scope)
 *                rule, example, count, errRate, promotedAt, lastSeen,
 *                status } ] }          // 'active' | 'review'
 *
 * Rendered files (regenerated from the registry, never edited in place):
 *   project scope → <root>/.claude/ratchet-model.md
 *   global scope  → ~/.claude/ratchet-model.md
 * The harness CLAUDE.md block points Claude at these files alongside
 * ratchet.md.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// Post-promotion delegated-category error rate above this flags the rule
// for review (rule-health). Calibrated against local T0 avg error incidence.
export const HEALTH_ERR_RATE = 0.2;
// Below this many shape-eligible episodes in the window the error rate is
// noise (1 error in 4 episodes = 25% — instant flag), so the review flag is
// withheld until the sample is large enough to mean something.
export const HEALTH_MIN_SAMPLE = 10;

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

export function modelRulesPath() {
  return join(stateDir(), 'model-rules.json');
}

export function loadModelRules() {
  try {
    const data = JSON.parse(readFileSync(modelRulesPath(), 'utf8'));
    return Array.isArray(data.rules) ? data : { rules: [] };
  } catch {
    return { rules: [] };
  }
}

export function saveModelRules(data) {
  const dir = stateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(modelRulesPath(), JSON.stringify(data, null, 2) + '\n');
}

/** Add (or re-activate) a promoted rule; returns the stored entry. */
export function addModelRule(entry) {
  const data = loadModelRules();
  const existing = data.rules.find((r) => r.signature === entry.signature && r.scope === entry.scope);
  if (existing) {
    Object.assign(existing, entry, { status: 'active' });
    saveModelRules(data);
    return existing;
  }
  const stored = { status: 'active', errRate: 0, ...entry };
  data.rules.push(stored);
  saveModelRules(data);
  return stored;
}

export function removeModelRule(index1) {
  const data = loadModelRules();
  if (index1 < 1 || index1 > data.rules.length) return null;
  const [removed] = data.rules.splice(index1 - 1, 1);
  saveModelRules(data);
  return removed;
}

/** Render the full ratchet-model.md for one target (scope+root). */
export function renderModelRatchet(rules) {
  const lines = [
    '# Model-Fitting Ratchet (claude-token-saver 자동 관리)',
    '',
    '로그 기반 티어 위임 룰. 이 파일은 route-scan이 매 스캔마다 통째로 재생성하므로',
    '직접 수정하지 마세요 — 목록/제거: `claude-token-saver route-scan rules [rm <N>]`.',
    '',
    '아래 룰에 따라 위임을 실행할 때는 사용자에게 다음 한 줄을 먼저 표시할 것',
    '(어떤 도구가 토큰을 아끼고 있는지 가시화):',
    '`🔀 [claude-token-saver] 모델 피팅: "<유형>" → <agent> 위임`',
    '',
    '## Rules',
    '',
  ];
  const healthOf = (r) => r.status === 'review'
    ? ` ⚠ rule-health: 최근 위임 대상 에러율 ${Math.round((r.errRate || 0) * 100)}% — 조건을 좁히거나 제거 검토`
    : '';
  const statsOf = (r) => `×${r.count || 0}, err ${Math.round((r.errRate || 0) * 100)}%, seen ${r.lastSeen || r.promotedAt}`;

  // A category can carry both a T2 (haiku) and a T1 (sonnet) rule. Tier is
  // only known after an episode finishes, so two separate bullets give the
  // reading LLM no way to pick one at request time — merge such pairs into a
  // single conditional rule with explicit request-time criteria (default to
  // the cheap agent, escalate on multi-step scope, hand back on judgement /
  // irreversible actions).
  const byCategory = new Map();
  for (const r of rules) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category).push(r);
  }
  for (const group of byCategory.values()) {
    const t2 = group.find((r) => r.tier === 'T2');
    const t1 = group.find((r) => r.tier === 'T1');
    if (t2 && t1) {
      const rule =
        `"${t2.label}" 유형 요청은 기본적으로 ${t2.agent}(haiku) 서브에이전트로 위임한다(예: "${t2.example}"). ` +
        `여러 단계·여러 파일 수정이 얽힌 중간 난도 요청(예: "${t1.example}")은 model: sonnet 서브에이전트로 위임한다. ` +
        `설계 판단·배포·스토어 제출 같은 비가역 작업이 섞이거나 위임 중 에러가 반복되면 위임하지 말고 메인 모델이 직접 처리한다`;
      lines.push(`- ${rule}${healthOf(t2)}${healthOf(t1)} <!-- T2 ${statsOf(t2)} / T1 ${statsOf(t1)} -->`);
      for (const r of group) {
        if (r !== t2 && r !== t1) lines.push(`- ${r.rule}${healthOf(r)} <!-- ${statsOf(r)} -->`);
      }
    } else {
      for (const r of group) lines.push(`- ${r.rule}${healthOf(r)} <!-- ${statsOf(r)} -->`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Statusline helper (docs/TIER_CRITERIA.md §rule-health) — cheapest possible
 * check, one small JSON read. Returns `rule-health R<N>` for the first
 * review-flagged rule relevant to this project (its own root, or global
 * scope), else null. N is the 1-based registry index, matching the numbering
 * of `route-scan rules [rm <N>]` so the fix command is one lookup away.
 */
export function ruleHealthWarningForStatusline(projectRoot) {
  const { rules } = loadModelRules();
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.status !== 'review') continue;
    if (r.scope === 'global' || r.targetRoot === projectRoot) return `rule-health R${i + 1}`;
  }
  return null;
}

export function modelRatchetPathFor(scope, targetRoot) {
  return scope === 'global'
    ? join(homedir(), '.claude', 'ratchet-model.md')
    : join(targetRoot, '.claude', 'ratchet-model.md');
}

/**
 * Regenerate ratchet-model.md for every target that carries model rules.
 * A target whose rules are all gone gets its file removed (it's fully
 * tool-owned, so deletion is safe).
 */
export function syncAllFiles({ previousPaths = [] } = {}) {
  const data = loadModelRules();
  const byPath = new Map();
  for (const r of data.rules) {
    const p = modelRatchetPathFor(r.scope, r.targetRoot);
    if (!byPath.has(p)) byPath.set(p, []);
    byPath.get(p).push(r);
  }
  const written = [];
  for (const [p, rules] of byPath) {
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, renderModelRatchet(rules));
      written.push(p);
    } catch { /* unwritable target — skip, registry stays authoritative */ }
  }
  for (const p of previousPaths) {
    if (!byPath.has(p) && existsSync(p)) {
      try { unlinkSync(p); } catch { /* leave stale file; regenerated next sync */ }
    }
  }
  return written;
}

/**
 * Continuous update from logs (route-scan calls this on every refresh):
 * for each registered rule, recompute recurrence count and the error rate
 * of episodes in its (tier-eligible) category — the rule-health signal.
 *
 * `episodeStats`: Map "tier|category|project" (plus a "tier|category|*"
 * wildcard key that global-scope rules fall back to) → { count, errCount,
 * epCount }. Tier is part of the key so a category carrying both a T2 and a
 * T1 rule doesn't double-count every episode into both rules' stats.
 * errCount/epCount measure the scan window's shape-eligible episodes — ones
 * an expensive model handled directly that still look T1/T2 by shape (tier
 * judged with the error signal zeroed; see route-scan's rule-health pass).
 */
export function refreshModelRules(episodeStats, { now } = {}) {
  const data = loadModelRules();
  let changed = false;
  for (const r of data.rules) {
    const s = episodeStats.get(`${r.tier}|${r.category}|${r.project}`)
      || (r.scope === 'global' ? episodeStats.get(`${r.tier}|${r.category}|*`) : null);
    if (!s) continue;
    r.count = s.count;
    r.errRate = s.epCount > 0 ? s.errCount / s.epCount : 0;
    r.lastSeen = now || r.lastSeen;
    r.status = r.errRate > HEALTH_ERR_RATE && s.epCount >= HEALTH_MIN_SAMPLE ? 'review' : 'active';
    changed = true;
  }
  if (changed) {
    saveModelRules(data);
    syncAllFiles();
  }
  return data;
}
