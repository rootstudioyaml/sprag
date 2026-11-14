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
    '  위임 프롬프트는 다른 문맥 없이 실행할 수 있는 설계서로 쓰고 아래 항목을 담습니다.',
    '    1. 목표와 이유',
    '    2. 확정한 설계: 인터페이스, 이름, 데이터 모양, 경계 사례의 동작',
    '    3. 수정할 파일, 건드리지 않을 범위, 그 밖의 제약',
    '    4. 함께 고칠 곳: 바꾸는 함수나 값을 쓰는 다른 호출 지점, 사본, 문서',
    '    5. 따라야 할 저장소 규약: 테스트가 강제하는 목록, 등록 절차, 문체 규칙',
    '    6. 검사할 수 있는 문장으로 쓴 완료 기준',
    '    7. 대상 테스트와 전체 테스트를 돌리는 명령',
    '    8. 보고 형식: 바꾼 파일, 실행한 명령과 실제 결과, 하지 못한 것',
    '    9. 권장 모델과 선택 이유',
    '  4번과 5번은 메인 모델이 위임 전에 직접 찾아서 적습니다. 워커는 설계서에 없는 호출 지점과',
    '  규약을 알지 못합니다(실측: 구현 10건 재생에서 부분 판정 6건 중 3건이 여기서 나왔습니다).',
    '  구현 위임에는 출력 토큰 상한을 적지 않습니다. 조회 룰의 상한은 구현에 맞지 않습니다(실측: 구현',
    '  10건의 출력은 13,000~39,000 토큰이었고 8,000 토큰 상한을 받은 워커는 테스트를 쓰기 전에',
    '  멈췄습니다). 범위는 수정할 파일과 완료 기준으로 정합니다. 설계가 코드와 맞지 않으면 다른',
    '  설계로 구현하지 말고 멈춰서 보고하라고 적습니다.',
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
    '  Never use haiku or T2 for implementation.',
    '  Write the delegation prompt as a specification that runs without other context. It states:',
    '    1. the goal and the reason for it',
    '    2. the settled design: interfaces, names, data shapes, edge-case behaviour',
    '    3. the files to change, what must stay untouched, and any other constraint',
    '    4. what else must change with it: other callers of a changed function or value, copies, documents',
    '    5. the repository conventions that apply: lists a test enforces, registration steps, style rules',
    '    6. completion criteria written as checkable statements',
    '    7. the commands for the targeted tests and for the full suite',
    '    8. the report format: files changed, commands run with their actual results, what was not done',
    '    9. the recommended model with a one-line reason',
    '  The main model finds items 4 and 5 itself before delegating: the worker cannot know a caller',
    '  or a convention the specification leaves out (measured: 3 of 6 partial results in a replay of',
    '  10 implementations came from exactly that). State no output-token cap for an implementation:',
    '  a lookup rule\'s cap does not fit one (measured: the 10 implementations wrote 13,000 to 39,000',
    '  output tokens, and the worker held to 8,000 stopped before writing its tests). Scope is set by',
    '  the files and the completion criteria. Tell the worker to stop and report, not to implement a',
    '  different design, when the design does not fit the code.',
    '  Changes of roughly 50 lines or less in files already in context, or one short dependency chain,',
    '  stay on the main model. Codex also stays on the main model if T1 is unresolved.',
    '  If delegation is off, or the model or subagent tools are unavailable,',
    '  stay on the main model and say why.',
    '  Wait for the child instead of duplicating its implementation. The main model',
    '  verifies the diff and actual test results before reporting completion.',
  ].join('\n');
}
