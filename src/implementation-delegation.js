import { agentPhrase, agentPhraseEn, resolveAgentName } from './agents.js';

/** Shared policy, rendered with each client's native model selector. */
export function implementationDelegationRule(agent = 'claude', lang = 'en') {
  const target = agent === 'codex'
    ? 'the resolved T1 model for the current parent model and provider (explicit mapping first, automatic resolution otherwise)'
    : (resolveAgentName('sonnet', null) ? agentPhraseEn('sonnet', { root: null }) : 'a model: sonnet subagent');
  const targetKo = resolveAgentName('sonnet', null) ? agentPhrase('sonnet', { root: null }) : 'model: sonnet 서브에이전트';
  if (lang === 'ko') return [
    '- **구현 분업**: 여러 파일을 고칠 때 설계와 스펙 확정은 메인 모델이 맡습니다.',
    `  구현은 ${agent === 'codex' ? '현재 부모 모델과 프로바이더의 T1 모델' : targetKo}에 위임합니다.`,
    '  Claude는 sonnet을 쓰고, Codex는 명시적 T1 매핑을 우선하며 없으면 자동 해석한 T1을 씁니다.',
    '  두 모델의 성능이 같다고 가정하지 않으며 haiku나 T2에 구현을 맡기지 않습니다.',
    '  위임 프롬프트에는 설계, 수정할 파일, 제약, 완료 기준, 테스트 명령, 예산과',
    '  권장 모델 및 선택 이유를 적어 다른 문맥 없이 실행할 수 있게 합니다.',
    '  이미 읽은 파일의 약 50줄 이하 변경이나 의존 단계가 하나인 짧은 구현은',
    '  분업 비용을 고려해 메인 모델이 직접 처리합니다. Codex에서 T1을 해석하지 못하면',
    '  메인이 이어받습니다. 위임이 꺼져 있거나 하위 모델 또는 위임 도구를 사용할 수',
    '  없어도 메인이 처리하고 그 이유를 알립니다.',
    '  메인 모델은 위임 완료를 기다리고 같은 구현을 중복 실행하지 않습니다.',
    '  반환된 diff와 테스트 결과를 직접 검증한 뒤 완료로 보고합니다.',
  ].join('\n');
  return [
    '- **Implementation split**: the main model fixes the design and specification,',
    `  then delegates multi-file implementation to ${target}.`,
    '  Claude uses sonnet; Codex uses its resolved T1, not a presumed Sonnet equivalent.',
    '  Never use haiku or T2 for implementation. Give a self-contained specification',
    '  with owned files, constraints, completion criteria, test commands, a budget,',
    '  and the recommended model with a one-line reason. Changes of roughly',
    '  50 lines or less in files already in context, or one short dependency chain,',
    '  stay on the main model. Codex also stays on the main model if T1 is unresolved.',
    '  If delegation is off, or the model or subagent tools are unavailable,',
    '  stay on the main model and say why.',
    '  Wait for the child instead of duplicating its implementation. The main model',
    '  verifies the diff and actual test results before reporting completion.',
  ].join('\n');
}
