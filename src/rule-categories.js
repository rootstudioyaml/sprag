/**
 * rule-categories — the request categories and tiers a model-fitting rule can
 * name, with the labels the rule sentence quotes.
 *
 * route-scan classifies requests into these categories (it adds the keyword
 * tables), shared-model-rules validates against them, and the team layer
 * (team-rule-stats, team-ratchet) uses them to check and redraw a rule that
 * arrives as a structured record. The module imports nothing, so any of them
 * can use it without closing an import cycle.
 */

export const RULE_TIERS = Object.freeze(['T2', 'T1', 'T1H']);

// The Korean labels moved here unchanged from route-scan.js. Stored rules, the
// rendered ratchet files and the tests quote them byte for byte, so the middle
// dots stay as they were (an existing fixed expression, not new prose).
export const RULE_CATEGORY_LABELS = Object.freeze({
  paste: Object.freeze({ id: 'paste', label: '붙여넣은 화면·로그 질문', labelEn: 'questions about pasted screens/logs' }),
  translate: Object.freeze({ id: 'translate', label: '배치 번역·정형 텍스트 변환', labelEn: 'batch translation / mechanical text transforms' }),
  explore: Object.freeze({ id: 'explore', label: '탐색·조회 (파일/값 찾기)', labelEn: 'lookup (finding files/values)' }),
  read: Object.freeze({ id: 'read', label: '읽기·요약·설명', labelEn: 'reading / summarizing / explaining' }),
  check: Object.freeze({ id: 'check', label: '상태 확인·검증', labelEn: 'status checks / verification' }),
  run: Object.freeze({ id: 'run', label: '명령 실행 (빌드·테스트·git)', labelEn: 'running commands (build/test/git)' }),
});

export const RULE_CATEGORY_IDS = Object.freeze(Object.keys(RULE_CATEGORY_LABELS));

export const isRuleTier = (v) => typeof v === 'string' && RULE_TIERS.includes(v);
export const isRuleCategory = (v) => typeof v === 'string' && Object.hasOwn(RULE_CATEGORY_LABELS, v);
