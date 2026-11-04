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
