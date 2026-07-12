/**
 * model-rules — the MODEL-FITTING ratchet registry.
 *
 * Model-fitting rules (tier-delegation rules promoted from route-scan) are
 * managed SEPARATELY from user-authored ratchet rules, for two reasons the
 * user set as requirements:
 *   1. They must never tangle with hand-written rules — so they live inside
 *      a tool-owned managed block in ratchet.md, regenerated wholesale.
 *   2. They must keep updating from subsequent logs — recurrence counts and
 *      post-promotion error rates are refreshed on every route-scan, and a
 *      rule whose delegated episodes start failing gets flagged for review
 *      (rule-health, per docs/TIER_CRITERIA.md).
 *
 * Registry file: <stateDir>/model-rules.json
 *   { rules: [ { signature, tier, category, label, agent, scope,   // 'project'|'global'
 *                targetRoot,           // project root path (project scope)
 *                rule, example, count, errRate, promotedAt, lastSeen,
 *                status } ] }          // 'active' | 'review'
 *
 * Managed block markers (inside .claude/ratchet.md / ~/.claude/ratchet.md):
 *   <!-- MODEL-FITTING:BEGIN ... --> ... <!-- MODEL-FITTING:END -->
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const BLOCK_BEGIN = '<!-- MODEL-FITTING:BEGIN — claude-token-saver가 로그 기반으로 자동 갱신하는 모델 피팅 랫쳇. 직접 수정하지 마세요 (제거: claude-token-saver route-scan rules rm <N>) -->';
export const BLOCK_END = '<!-- MODEL-FITTING:END -->';

// Post-promotion delegated-category error rate above this flags the rule
// for review (rule-health). Calibrated against local T0 avg error incidence.
export const HEALTH_ERR_RATE = 0.2;

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

/** Render the managed block for one ratchet target (scope+root). */
export function renderBlock(rules) {
  const lines = [BLOCK_BEGIN];
  lines.push('### Model-Fitting Rules (자동 관리 — 로그 기반 티어 위임)');
  lines.push('');
  if (rules.length === 0) {
    lines.push('_(등록된 모델 피팅 룰 없음)_');
  }
  for (const r of rules) {
    const health = r.status === 'review'
      ? ` ⚠ rule-health: 최근 위임 대상 에러율 ${Math.round((r.errRate || 0) * 100)}% — 조건을 좁히거나 제거 검토`
      : '';
    const stats = ` <!-- ×${r.count || 0}, err ${Math.round((r.errRate || 0) * 100)}%, seen ${r.lastSeen || r.promotedAt} -->`;
    lines.push(`- ${r.rule}${health}${stats}`);
  }
  lines.push(BLOCK_END);
  return lines.join('\n');
}

/**
 * Rewrite the managed block inside a ratchet.md (create file/block if
 * missing). User-authored lines outside the block are never touched.
 */
export function applyBlockToRatchet(ratchetPath, rules) {
  const block = renderBlock(rules);
  let content = '';
  if (existsSync(ratchetPath)) {
    content = readFileSync(ratchetPath, 'utf8');
  } else {
    mkdirSync(dirname(ratchetPath), { recursive: true });
    content = '# Ratchet Rules (auto-grown by claude-token-saver)\n\n## Rules\n\n';
  }
  const beginIdx = content.indexOf('<!-- MODEL-FITTING:BEGIN');
  const endIdx = content.indexOf(BLOCK_END);
  if (beginIdx !== -1 && endIdx !== -1) {
    content = content.slice(0, beginIdx) + block + content.slice(endIdx + BLOCK_END.length);
  } else {
    const sep = content.endsWith('\n') ? '\n' : '\n\n';
    content = content + sep + block + '\n';
  }
  writeFileSync(ratchetPath, content);
  return ratchetPath;
}

function ratchetPathFor(rule) {
  return rule.scope === 'global'
    ? join(homedir(), '.claude', 'ratchet.md')
    : join(rule.targetRoot, '.claude', 'ratchet.md');
}

/** Regenerate managed blocks in every ratchet.md that carries model rules. */
export function syncAllBlocks() {
  const data = loadModelRules();
  const byPath = new Map();
  for (const r of data.rules) {
    const p = ratchetPathFor(r);
    if (!byPath.has(p)) byPath.set(p, []);
    byPath.get(p).push(r);
  }
  const written = [];
  for (const [p, rules] of byPath) {
    try {
      applyBlockToRatchet(p, rules);
      written.push(p);
    } catch { /* unwritable target — skip, registry stays authoritative */ }
  }
  return written;
}

/**
 * Continuous update from logs (route-scan calls this on every refresh):
 * for each registered rule, recompute recurrence count and the error rate
 * of episodes in its (tier-eligible) category — the rule-health signal.
 *
 * `episodeStats`: Map "category|project" → { count, errCount, epCount }
 * where errCount/epCount measure post-promotion delegated-category episodes.
 */
export function refreshModelRules(episodeStats, { now } = {}) {
  const data = loadModelRules();
  let changed = false;
  for (const r of data.rules) {
    const s = episodeStats.get(`${r.category}|${r.project}`)
      || (r.scope === 'global' ? episodeStats.get(`${r.category}|*`) : null);
    if (!s) continue;
    r.count = s.count;
    r.errRate = s.epCount > 0 ? s.errCount / s.epCount : 0;
    r.lastSeen = now || r.lastSeen;
    r.status = r.errRate > HEALTH_ERR_RATE ? 'review' : 'active';
    changed = true;
  }
  if (changed) {
    saveModelRules(data);
    syncAllBlocks();
  }
  return data;
}
