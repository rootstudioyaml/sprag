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
import { formatResetClock } from './format-time.js';

export function routingEnabled(cfg = loadConfig()) {
  try {
    return cfg?.routing !== false;
  } catch {
    return true;
  }
}

/**
 * Whether the prompt hook may tell a low or medium effort session to hand its
 * judgement work to an Opus subagent (effortNotice). Only an explicit `false`
 * in `effortHint` is off; routing off silences it too.
 */
export function effortHintEnabled(cfg = loadConfig()) {
  try {
    return routingEnabled(cfg) && cfg?.effortHint !== false;
  } catch {
    return true;
  }
}

export function setEffortHint(on) {
  const cfg = loadConfig();
  cfg.effortHint = on !== false;
  pruneExpiredRelax(cfg);
  saveConfig(cfg);
}

export function setRoutingEnabled(on) {
  const cfg = loadConfig();
  cfg.routing = on !== false;
  pruneExpiredRelax(cfg);
  saveConfig(cfg);
}

/**
 * How far delegation goes while routing is on. 'quality' hands off only work
 * whose answer comes straight from tool output and sends judgement work up to
 * Opus; 'cost' hands off as much as the rules allow. Routing off still wins
 * over any grade.
 *
 * The grade is not a setting. It is 'quality' unless a relax window is open:
 * `relaxUntil` in config.json holds an epoch-ms deadline, and until then the
 * grade reads 'cost'. `sprag routing relax` opens the window up to the reset
 * of the busiest usage window, and once the deadline passes the grade goes
 * back to 'quality' by itself, with no write needed.
 */
export const DELEGATION_GRADES = ['quality', 'cost'];
export const DEFAULT_DELEGATION_GRADE = 'quality';

/** A grade name; null for anything else. */
export function normalizeDelegationGrade(value) {
  return DELEGATION_GRADES.includes(value) ? value : null;
}

/** The stored relax deadline in epoch ms, or null when none is stored. It may already be past. */
export function relaxUntil(cfg = loadConfig()) {
  try {
    const v = cfg?.relaxUntil;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** True while the relax deadline is still ahead of `now`. */
export function isRelaxed(cfg = loadConfig(), now = Date.now()) {
  const until = relaxUntil(cfg);
  return until !== null && until > now;
}

export function delegationGrade(cfg = loadConfig(), now = Date.now()) {
  try {
    return isRelaxed(cfg, now) ? 'cost' : DEFAULT_DELEGATION_GRADE;
  } catch {
    return DEFAULT_DELEGATION_GRADE;
  }
}

/**
 * Stores the relax deadline (epoch ms), or clears it with null. A deadline
 * that has passed is dropped from the config on any write that goes through
 * here or through the other setters in this file.
 */
export function setRelaxUntil(ms) {
  const cfg = loadConfig();
  if (typeof ms === 'number' && Number.isFinite(ms)) cfg.relaxUntil = ms;
  else delete cfg.relaxUntil;
  saveConfig(cfg);
}

/** Drops an expired relaxUntil from a config object about to be saved. */
function pruneExpiredRelax(cfg) {
  const until = relaxUntil(cfg);
  if (until !== null && until <= Date.now()) delete cfg.relaxUntil;
  else if (cfg && 'relaxUntil' in cfg && until === null) delete cfg.relaxUntil;
}

/** The deadline as the user reads it: HH:MM, with the weekday ahead of it when it is not today. */
export function relaxClock(ms, now = new Date()) {
  return formatResetClock(ms / 1000, now);
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
  if ((normalizeDelegationGrade(grade) ?? DEFAULT_DELEGATION_GRADE) !== 'quality') return true;
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
