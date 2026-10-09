import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { loadModelRules, ruleBudget } from './model-rules.js';
import { findProjectRoot } from './harness.js';

export const SHARED_RULE_TIERS = ['T2', 'T1'];
const CATEGORIES = new Set(['paste', 'translate', 'explore', 'read', 'check', 'run']);

/** A root as a real path, so a symlinked checkout or macOS /var names one directory once. */
export function realProjectRoot(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

/**
 * Every root either agent assigns to a working directory. Claude stops at
 * CLAUDE.md and Codex at AGENTS.md, so a subdirectory holding only one of them
 * gets a different root from each agent for the same project.
 */
export function sharedProjectRoots(start) {
  const from = start || process.cwd();
  return [...new Set(['claude', 'codex'].map((agent) => realProjectRoot(findProjectRoot(from, { agent }))))];
}

/** Read a policy view of the existing registry, never its model roles or statistics. */
export function loadSharedModelRules({ includeInactive = false, ...opts } = {}) {
  return loadModelRules(opts).rules.flatMap((r) => {
    if (!r || !(r.status === 'active' || (includeInactive && ['off', 'review'].includes(r.status))) ||
        !SHARED_RULE_TIERS.includes(r.tier) || !CATEGORIES.has(r.category) ||
        !['global', 'project'].includes(r.scope)) return [];
    if (r.scope === 'project' && (typeof r.targetRoot !== 'string' || !isAbsolute(r.targetRoot))) return [];
    const targetRoot = r.scope === 'project' ? realProjectRoot(r.targetRoot) : null;
    const budget = ruleBudget(r);
    return [{ category: r.category, tier: r.tier, scope: r.scope, targetRoot,
      sharedSignature: typeof r.signature === 'string' && r.signature.length <= 512 ? r.signature
        : `${r.tier}|${r.category}|${targetRoot || '*'}`,
      budget: {
        calls: Number.isSafeInteger(budget?.calls) && budget.calls > 0 ? budget.calls : null,
        out: Number.isSafeInteger(budget?.out) && budget.out > 0 ? budget.out : null,
      } }];
  });
}

/**
 * How close a rule's scope is to the working directory: a project rule ranks
 * by the depth of its root, so in a nested project the inner root wins, and
 * any project rule outranks a global one. Registry order never decides.
 */
export function scopeRank(rule) {
  return rule.scope === 'project' && typeof rule.targetRoot === 'string' ? realProjectRoot(rule.targetRoot).length : -1;
}

/**
 * One policy per category and tier, the closest scope first (see scopeRank).
 * `start` is the working directory when known; a project policy applies when
 * its root is the root either agent assigns to that directory.
 */
export function sharedModelRulesForProject(rules, start) {
  const roots = new Set(sharedProjectRoots(start));
  const chosen = new Map();
  for (const rule of rules) {
    if (rule.scope !== 'global' && !roots.has(rule.targetRoot)) continue;
    const key = `${rule.category}|${rule.tier}`;
    if (!chosen.has(key) || scopeRank(rule) > scopeRank(chosen.get(key))) chosen.set(key, rule);
  }
  return [...chosen.values()];
}

export function sharedRuleBounds(rule) {
  const caps = [];
  if (rule.budget?.calls) caps.push(`${rule.budget.calls} tool calls`);
  if (rule.budget?.out) caps.push(`${rule.budget.out} output tokens`);
  return caps.length ? `Caller-approved cap: ${caps.join(' / ')}. Stop and report partial work before exceeding it.` : '';
}
