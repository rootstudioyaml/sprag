/**
 * routing-switch — the master switch for model delegation.
 *
 * sprag puts delegation instructions into a Claude Code session through
 * several paths: ratchet-model.md, the preset ratchet rules, the per-prompt
 * route hint, the route-scan briefing, and the Codex prompt hook. One flag in
 * config.json (`routing`) turns all of them off together. Only an explicit
 * `false` means off; a missing key is on, so existing installs keep working.
 */

import { loadConfig, saveConfig } from './config.js';

export function routingEnabled(cfg = loadConfig()) {
  try {
    return cfg?.routing !== false;
  } catch {
    return true;
  }
}

export function setRoutingEnabled(on) {
  const cfg = loadConfig();
  cfg.routing = on !== false;
  saveConfig(cfg);
}

/**
 * How far delegation goes while routing is on. 'quality' hands off only work
 * whose answer comes straight from tool output and sends judgement work up to
 * Opus; 'cost' hands off as much as the rules allow. A missing or unknown
 * value reads as 'quality'. Routing off still wins over any grade.
 *
 * Earlier versions stored three grades. A stored 'balanced' reads as 'quality'
 * and a stored 'saving' as 'cost', so a config written then keeps meaning
 * what it meant (LEGACY_GRADES).
 */
export const DELEGATION_GRADES = ['quality', 'cost'];
export const DEFAULT_DELEGATION_GRADE = 'quality';
export const LEGACY_GRADES = { balanced: 'quality', saving: 'cost' };

/** A grade name, or an old one mapped to its successor; null for anything else. */
export function normalizeDelegationGrade(value) {
  if (DELEGATION_GRADES.includes(value)) return value;
  return Object.hasOwn(LEGACY_GRADES, value) ? LEGACY_GRADES[value] : null;
}

export function delegationGrade(cfg = loadConfig()) {
  try {
    return normalizeDelegationGrade(cfg?.delegationGrade) ?? DEFAULT_DELEGATION_GRADE;
  } catch {
    return DEFAULT_DELEGATION_GRADE;
  }
}

/** Stores the grade; an old name is stored as the grade that replaced it. */
export function setDelegationGrade(grade) {
  const g = normalizeDelegationGrade(grade);
  if (g === null) throw new Error(`unknown delegation grade: ${grade}`);
  const cfg = loadConfig();
  cfg.delegationGrade = g;
  saveConfig(cfg);
}

/** The grade as the user reads it: ko 품질 우선/비용 우선, en quality/cost. */
const GRADE_LABELS = {
  ko: { quality: '품질 우선', cost: '비용 우선' },
  en: { quality: 'quality', cost: 'cost' },
};
export function gradeLabel(grade, lang = 'en') {
  const g = normalizeDelegationGrade(grade) ?? grade;
  return (GRADE_LABELS[lang] || GRADE_LABELS.en)[g] ?? grade;
}

/**
 * At grade 'quality' a T2 (haiku) rule survives only for the categories whose
 * answer is copied out of text the model is handed: pasted logs, reading and
 * translating. A lookup, check or command run goes to T1 or stays on the main
 * model, because a lookup that stops early is wrong without saying so. T1 and
 * T1H rules are untouched, and so is grade 'cost'.
 */
export const QUALITY_T2_CATEGORIES = new Set(['paste', 'read', 'translate']);

/** False when this grade drops the rule (see QUALITY_T2_CATEGORIES). */
export function gradeKeepsRule(grade, rule) {
  if (normalizeDelegationGrade(grade) !== 'quality') return true;
  return rule?.tier !== 'T2' || QUALITY_T2_CATEGORIES.has(rule.category);
}

// Preset ratchet rules (presets/ratchet-rules.json) whose text tells the model
// to delegate: fix-f558f9 sends simple lookups and commands to T2 agents and
// fix-777a15 sends multi-file implementation to the T1 worker. The other
// presets are general habits that stay useful with delegation off.
export const DELEGATION_PRESET_IDS = new Set(['fix-f558f9', 'fix-777a15']);

/**
 * Body of ratchet-model.md while routing is off. The file stays in place
 * because CLAUDE.md imports its path, but it carries no delegation rule and
 * no approval wording.
 */
export function routingOffRatchetText(lang = 'en') {
  if (lang === 'ko') {
    return [
      '# Model-Fitting Ratchet (sprag 자동 관리)',
      '',
      'sprag 모델 위임이 꺼져 있어 이 파일은 위임 룰을 싣지 않습니다.',
      '서브에이전트 사용은 사용자의 요청과 세션의 다른 지침을 따르십시오.',
      '',
      '등록된 룰은 보관되어 있습니다. `sprag routing on` 으로 다시 켜면 이 파일이 채워집니다.',
      '',
    ].join('\n');
  }
  return [
    '# Model-Fitting Ratchet (managed by sprag)',
    '',
    'sprag model delegation is off, so this file carries no delegation rules.',
    'Use subagents as the user asks and as the other instructions in the session say.',
    '',
    'Registered rules are kept. Run `sprag routing on` to turn delegation back on and this file is filled again.',
    '',
  ].join('\n');
}
