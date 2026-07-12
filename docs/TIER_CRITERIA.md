# 티어 분류 기준 설계 (3.x 핵심) — 리서치 근거 + 초안 v0

작성: 2026-07-13. deep-research(소스 21개, 주장 104건 추출 → 25건 3표 교차검증 → 21건 확정)
+ 저자 14일 세션 로그 실측(에피소드 553건)을 근거로 한 설계 문서.

## 1. 리서치가 확정해 준 사실

### 기존 라우터들의 접근과 수치
- **RouteLLM** (lmsys): 쿼리 텍스트만 보고 "강한 모델이 이길 확률"을 예측하는 이진
  분류기. Chatbot Arena 선호 데이터 8만 건으로 학습. MT Bench에서 강모델 호출 13.4%로
  품질 95% 유지, 비용 최대 3.66x 절감. **실행 로그(도구 호출·토큰)는 안 씀** —
  텍스트 기반 학습 분류기 계열. [arxiv 2406.18665, 3-0 확정]
- **FrugalGPT**: 싼 모델부터 시도하고 응답 신뢰도 스코어러가 낮게 보면 위로 올리는
  캐스케이드. GPT-4 대비 최대 98% 비용 절감 or 동비용 +4% 정확도. "실패하면 승급"
  구조의 원형. [arxiv 2305.05176, 3-0]
- **RouterArena** (2025): 학술·상용 라우터 전부 오라클(90.9%)에 크게 못 미침(1위 66.9).
  결정적 발견 두 가지: ① 기존 라우터는 **비싼 모델로 과잉 라우팅**하는 체계적 편향이
  있고 "싼 모델로 충분한 경우를 인식하는 것"이 미개척 방향, ② 난이도를 텍스트가 아니라
  **"42개 모델 중 몇 개가 실제로 맞혔나"라는 결과(outcome) 로그로 정의** — 로그 기반
  오프라인 난이도 라벨링의 학술적 근거. [arxiv 2510.00202, 3-0]
- **Routing collapse**: 학습형 라우터는 예산이 커지면 최강 모델만 고르는 퇴화로 수렴.
  같은 벤치마크에서 오라클은 최강 모델이 **20% 미만의 쿼리에만 필요**. [arxiv 2602.03478, 3-0]
- **휴리스틱 신호의 실전 사용**: 입력 길이, 명령형 키워드(analyze/compare/evaluate),
  어휘 희귀도, 구문 복잡도 — LLM 호출 없이 계산 가능한 신호들이 프로덕션 라우팅에
  실제로 쓰임. [arxiv 2603.04445 서베이, 2-1]
- **응답 레벨 신호**: 신뢰도·토큰 확률·검증기 출력 등 "생성 후" 신호는 쿼리 특징과
  구분되는 별도 신호 클래스로 인정됨 → 로그의 실패/재시도 흔적은 정당한 라우팅 신호.
  [같은 서베이, 3-0]

### Claude Code 특유의 검증된 사실
- 서브에이전트 `model:` frontmatter(haiku/sonnet/opus/fable/inherit)는 **비용 통제용
  1급 메커니즘**이고 Anthropic이 공식적으로 "Haiku 등 싼 모델로 라우팅해 비용 통제"를
  권장. [code.claude.com/docs/sub-agents, 3-0 ×2]
- Claude Code 본체는 **자동 모델 라우팅을 전혀 하지 않음** — 사소한 턴도 세션 모델이
  전체 컨텍스트를 재전송하며 처리. (= 이 도구가 메우는 공백)
- 세션 JSONL에서 Read:Edit 비율, 선행 Read 없는 Edit, 반복 Edit, 자기수정 루프 등
  **행동 메트릭을 LLM 없이 오프라인 계산 가능**하다는 선행 사례 존재
  (claude-session-analyzer: Read:Edit >6 양호 / <2 저하 등 구체 임계값 공개).
- 실무자 티어링 사례: 오케스트레이터(상위 모델) + 실행(haiku급) 분리로 토큰 5–10x 절감
  주장(mindstudio); plan mode·아키텍처 논의 → 최상위, 첫 Edit/Write/Bash → 중간,
  질문·탐색 → 최하위라는 트리거 설계(GitHub issue #67898).

### 우리 설계에 주는 함의
1. **"쉬운 것만 확실히 내리는" 보수적 강등 전략이 정확히 미개척 지대다** — 기존
   라우터의 실패는 전부 과잉 승급 쪽이고, 오라클 기준 최상위 모델이 필요한 쿼리는
   20% 미만이다. 현재 우리 로그에선 73%가 최상위 티어에 남아 있으므로 헤드룸이 크다.
2. **난이도 라벨은 텍스트 추정이 아니라 결과(outcome)에서 얻어라** — RouterArena
   방식. 우리 로그에는 이미 결과가 있다: 도구 에러, 재시도, 에피소드 길이.
3. **임계값은 절대 상수가 아니라 사용자 자신의 분포에서 보정하라** — RouteLLM의
   공식 한계가 "고정 임계값은 쿼리 분포가 바뀌면 어긋난다"이다.
4. **실패 시 승급(escalation) 경로가 있으면 강등 오판 비용이 작아진다** — FrugalGPT
   캐스케이드의 교훈. Claude Code에선 서브에이전트가 실패를 보고하면 메인 모델이
   이어받는 형태로 자연 구현된다.

## 2. 로컬 실측 (저자 14일, 에피소드 553건, requestId 중복 제거)

분위수: calls p50=3/p90=18 · out_tokens p50=3.2k/p90=18.4k · mutating p50=2/p90=15

| 밴드 (초안 기준) | 에피소드 | 출력토큰 비중 | 에러 경험률 | mutating 중앙값 |
|---|---:|---:|---:|---:|
| T2 haiku 후보 | 26.9% | 3.3% | 2% | 0 |
| T1 sonnet 후보 | 34.4% | 14% | 8% | 1 |
| T0 유지 (fable/opus) | 38.7% | 83% | 36% | 9 |

- 에러 신호가 티어를 강하게 갈라냄 (2→8→36%) — outcome 기반 라벨링의 로컬 검증.
- mutating 도구 수가 T1/T0을 가르는 핵심 축 (중앙값 1 vs 9).
- T2 후보 중 mutating≥3 오탐 위험은 149건 중 4건(그중 2건은 task-notification으로
  스킵 대상) — mutating 상한 가드 하나로 거의 차단됨.

## 3. 티어 기준 초안 v0

에피소드(한 사용자 요청이 유발한 연속 API 호출 묶음) 단위로 판정한다.

### 신호 (전부 LLM 호출 없이 JSONL에서 계산)
| 신호 | 출처 | 근거 |
|---|---|---|
| S1 호출 수 (requestId dedup) | usage 엔트리 | 기존 route-scan |
| S2 출력 토큰 합 | usage.output_tokens | 기존 route-scan |
| S3 mutating 도구 수 (Edit/Write/NotebookEdit/Bash) | tool_use 블록 | 로컬 실측 + session-analyzer 선례 |
| S4 도구 에러 수 (tool_result.is_error) | user 엔트리 | RouterArena outcome 라벨링 + 로컬 검증 |
| S5 요청 텍스트: 카테고리 정규식 + 승급 키워드 | userText | 프로덕션 휴리스틱 서베이 |
| S6 위임 흔적 (Task/Agent 도구 사용) | tool_use 블록 | 이미 위임된 에피소드 제외 |

### 판정 (위에서 아래로, 첫 매치)
```
T0 유지 (fable/opus):
  S4 ≥ 2  (에러 반복 = 어려움의 결과 증거)
  or S3 ≥ 7
  or S2 > p75(사용자 분포)        # 폴백 상수 8k
  or 승급 키워드: 설계|아키텍처|리팩토링|원인 분석|왜 |analyze|compare|evaluate|architect|refactor
  or plan-mode 진입 에피소드

T1 sonnet 후보:
  S2 ≤ p75 and S3 ≤ 6 and S4 ≤ 1 and S6 = 0
  and 카테고리 매치 (run·check·read·explore·translate 확장판)

T2 haiku 후보:
  S1 ≤ 6 and S2 ≤ max(p25, 1500) and S3 ≤ 2 and S4 = 0 and S6 = 0
  and 카테고리 매치
```

### 임계값 보정 (RouteLLM 한계 대응)
- p25/p75는 해당 사용자의 최근 14일 분포에서 스캔 시마다 재계산. 표본 <100이면
  고정 폴백(1.5k / 8k) 사용. 부동을 막기 위해 floor/ceiling: T2 상한은 [1k, 3k],
  T1 상한은 [5k, 15k] 범위로 클램프.

### 룰 승격 (기존 ratchet 파이프라인 유지)
- 같은 (티어×카테고리×프로젝트) 조합이 **3회 이상** 반복될 때만 후보 생성 (기존
  MIN_RECURRENCE 유지).
- T2 후보 → "haiku-* 서브에이전트로 위임" 룰. T1 후보 → "sonnet 서브에이전트로
  위임" 룰 (프리셋 sonnet-worker 에이전트 정의 안내 동반).
- 룰 텍스트에 가드 조건 명시: "단순", "읽기 전용", "결과가 명령 출력으로 판정되는".
- 사람 승인(opt-in promote) 유지 — 오판 비용의 최종 방어선.

### 룰 헬스체크 (신규 — outcome 피드백 루프)
- 승격된 위임 룰이 적용된 이후의 에피소드에서, 위임 대상 카테고리의 에러율·재시도율을
  추적. 에러율이 T0 평균에 접근하면(예: >20%) statusline에 `🅷⚠ rule-health R<N>`
  경고 → 조건을 좁히거나 rm 제안. RouterArena의 "결과로 난이도를 정의"를 룰 수명
  관리에 재적용한 것.

## 4. 의도적으로 채택하지 않은 것
- **학습형 분류기(BERT/임베딩)**: RouterArena 기준 최고 성능도 오라클과 24점 차이인
  데다, 학습 데이터(선호 쌍)가 우리에게 없음. zero-dep 원칙 위배. 향후 사용자 자신의
  위임 성공/실패 이력이 충분히 쌓이면 재검토.
- **실시간 라우팅**: Claude Code가 훅으로 모델 전환을 지원하지 않고, 세션 경계
  캘리브레이터가 우리 포지션 (기존 결정 유지).
- **fable/opus 분리**: 두 티어를 가를 로그 신호가 없음. T0은 "세션 모델 유지"로 통합.

## 5. 검증 계획 (구현 전)
1. 위 기준을 14일 로그에 적용해 밴드별 분포·오탐 후보를 수동 검수 (T2 전수, T1 표본 30건).
2. T2/T1 룰을 2주 운용 후 rule-health 지표로 에러율 비교 (강등 전 동일 카테고리 대비).
3. README의 "실제 효과" 섹션 방법론과 동일하게 사용자 메시지당 비용 전후 비교.

## 주요 출처
- RouteLLM: arxiv.org/abs/2406.18665 · github.com/lm-sys/routellm · lmsys.org/blog/2024-07-01-routellm
- FrugalGPT: arxiv.org/abs/2305.05176
- RouterArena: arxiv.org/pdf/2510.00202 · Routing collapse: arxiv.org/html/2602.03478v1
- 라우팅 서베이: arxiv.org/html/2603.04445v1
- Claude Code 서브에이전트 문서: code.claude.com/docs/en/sub-agents
- 실무 사례: github.com/anthropics/claude-code/issues/67898 · github.com/lucemia/claude-session-analyzer · mindstudio.ai 블로그
