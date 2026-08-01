# 구현 계획 — Manifest 라우터 폐기 인사이트 반영 (route-scan v4)

작성: 2026-08-01 (Fable 5 분석 세션). 구현은 Opus 세션에서 이 문서 기준으로 진행.
배경: HN 49126630 "Everyone is building LLM routers, we deprecated ours"
(manifest.build, 7천 사용자 4개월 실측 후 폐기) 글·댓글 전체와 route-scan 설계 대조.

## 대조 결론 (분석 요약)

Manifest 실패 4요인 중 ①프롬프트만으로 복잡도 판정 불가 ②캐시>라우팅
③동작 일관성 파괴는 route-scan의 post-hoc 에피소드 채점 + 서브에이전트 분리
컨텍스트 구조가 이미 회피. 남은 갭 4개를 이번에 구현한다.

| # | 갭 | 근거 (HN 댓글) | 우선순위 |
|---|---|---|---|
| A | rule-health가 프록시 측정 — 실제 위임 실행의 성패를 안 잼 | "불확실성은 측정 안 하면 비용" (④) | 1 |
| B | 티어가 세션 모델 상대적이지 않음 — 세션이 Sonnet이면 T1 위임 무의미 | try-working "풀은 작게, 확실히 차등화" | 2 |
| C | 룰별 절감액 미집계 — 룰 가치가 안 보임 | 0xDEAFBEAD O(N) 절감 논리 | 3 |
| D | 룰 적용 시점이 request-time으로 회귀 — 예산·중단 프로토콜 부재 | KoleSeise1277 "난이도는 첫 툴콜 뒤에 드러남", seizethecheese trajectory 라우팅 | 4 |

E(오프라인 bakeoff, daeken 댓글)는 이번 범위 제외 — 말미에 메모만.

---

## 데이터 소스 (검증 완료)

서브에이전트 transcript가 메인 세션과 별도 파일로 존재:

```
~/.claude/projects/<munged>/<sessionId>/subagents/agent-<id>.jsonl
~/.claude/projects/<munged>/<sessionId>/subagents/agent-<id>.meta.json
```

- `meta.json`: `{ agentType, description, toolUseId, spawnDepth }`
- `agent-*.jsonl`: 메인과 같은 포맷 (`isSidechain:true`, assistant 엔트리에
  `message.model`·`message.usage`, tool_result의 `is_error`)
- 조인: `meta.toolUseId` ↔ 메인 transcript의 Task/Agent `tool_use` 블록 `id`.
  그 tool_use가 속한 에피소드의 category/tier로 위임 실행을 귀속.
- 조인 실패 폴백: 타임스탬프 겹침(서브에이전트 첫/마지막 entry timestamp가
  에피소드 구간에 포함)으로 귀속. 그래도 실패하면 `uncategorized`로 집계만.
- 현재 `parser.js discoverSessionFiles`(parser.js:128 부근)는 프로젝트 디렉터리
  직속 `*.jsonl`만 수집 — 서브 디렉터리는 안 봄. 새 디스커버리 필요.

---

## Workstream A — 위임 실행 실측 → rule-health v2

**목표**: rule-health의 err 신호를 "비싼 모델이 직접 처리한 shape-eligible
에피소드"(프록시)에서 "실제로 위임된 서브에이전트 실행의 성패"(실측)로 승격.
프록시는 표본 부족 시 폴백으로 유지.

### 새 모듈 `src/subagent-records.js`

```js
// discoverSubagentRuns({ days }) →
//   [{ sessionPath, projectDir, agentId, agentType, toolUseId, model,
//      calls, outTokens, inTokens, cacheRead, cacheCreation,
//      toolErrors, startedAt, endedAt }]
```

- 세션 파일별로 `<dirname>/<basename(.jsonl 제거)>/subagents/` 존재 시 스캔.
- jsonl 파싱은 `collectSessionRecords` 재사용 가능하면 재사용(같은 포맷).
  `isRealToolError`(session-records.js:58)도 그대로 적용 — 거절/자기교정
  오염 방지 로직 재사용.
- `meta.json` 없거나 깨져도 jsonl만으로 model·usage 집계는 진행.

### route-scan 통합 (src/route-scan.js)

- `runRouteScan` Pass 1에서 에피소드 수집 시, 각 에피소드에 Task/Agent
  tool_use id 목록을 보존해야 조인 가능 → `session-records.js`의 레코드에
  `delegationToolUseIds: []` 필드 추가 (tool_use 블록 중
  DELEGATION_TOOLS 매치 시 `b.id` 수집, session-records.js:115-121).
- 새 Pass 2.5: 서브에이전트 실행을 에피소드에 조인 →
  `delegatedStats` Map `"tier|category|project"` →
  `{ runs, errRuns, outTokens, subModelTokensByTier }` 집계.
  tier는 **룰 레지스트리의 해당 카테고리 룰 tier** 기준(에피소드 shape 아님 —
  위임됐다는 사실 자체가 룰 적용의 결과이므로).
  레지스트리에 룰 없는 위임(수동 위임)은 `*|category|*`로만 집계.

### model-rules 확장 (src/model-rules.js)

- 레지스트리 엔트리에 추가: `delegatedRuns`, `delegatedErrRate`,
  `savedUsd`(C에서), `healthSource: 'delegated'|'proxy'`.
- `refreshModelRules(episodeStats, delegatedStats, { now })` 시그니처 확장.
- rule-health 판정(model-rules.js:242):
  ```
  delegatedRuns >= HEALTH_MIN_SAMPLE_DELEGATED(5)
    → delegatedErrRate > HEALTH_ERR_RATE 로 판정 (healthSource: 'delegated')
  아니면 기존 프록시 판정 유지 (healthSource: 'proxy')
  ```
- 렌더(model-rules.js:130 statsOf): `×N, err M% | 위임 실측 ×R, err S%`
  형태로 병기. 실측 없으면 기존 표기 유지 (하위호환).

### 수용 기준

- [ ] 신규 fixture: 가짜 세션 + subagents 디렉터리로 discover→join→집계
      단위 테스트 (조인 성공 / meta 없음 / 타임스탬프 폴백 3케이스)
- [ ] 실측 표본 ≥5인 룰은 healthSource가 'delegated'로 전환됨
- [ ] 기존 test 전체 green (`npm test`)
- [ ] `route-scan rules` 출력에 위임 실측 칼럼 표시

---

## Workstream B — 세션 모델 상대 티어

**목표**: 위임 목표 티어가 에피소드를 처리한 모델보다 실제로 싼 경우에만
후보 생성·룰 적용. 세션 기본 모델이 Fable 5로 바뀐 지금 즉시 실익.

### 구현

- `src/cost.js`에 `modelRank(model)` export 추가 — `detectPricingTier` 재사용:
  ```
  fable/mythos=3, opus(legacy·new)=2, sonnet=1, haiku=0
  ```
- `route-scan.js:231 isExpensiveModel` 대체:
  - T2 후보(목표 haiku=0): episode 모델 rank ≥ 1 필요 (현행과 동일 효과)
  - T1 후보(목표 sonnet=1): episode 모델 rank ≥ 2 필요 — **이게 핵심 변경**.
    현재는 sonnet 세션의 T1 에피소드도 후보로 잡혀 "sonnet→sonnet 위임"
    룰이 생성될 수 있음.
- `tierOf`는 그대로 두고 Pass 2 진입부(route-scan.js:314)에서 rank 필터.
  rule-health 분모(bumpStats) 경로에도 동일 필터 적용 — 안 그러면 실측/프록시
  분모가 어긋남.
- 룰 텍스트에 가드 한 줄 추가 (renderModelRatchet 병합 룰 포함):
  ko: "세션 모델이 위임 목표와 같은 급 이하면 위임하지 않는다"
  en: "Skip delegation when the session model is already at or below the target tier"

### 수용 기준

- [ ] sonnet 모델 에피소드가 T1 후보를 만들지 않음 (단위 테스트)
- [ ] fable/opus 에피소드는 기존과 동일하게 T1/T2 후보 생성
- [ ] 기존 등록 룰 마이그레이션: refresh 시 스탯만 새 필터 기준으로 갱신
      (룰 자체는 사용자 소유 — 자동 삭제 금지, rule-health로 자연 정리)

---

## Workstream C — 룰별 절감액 집계

**목표**: 룰의 실측 가치(USD)를 레지스트리·`route-scan rules`·통계에 노출.

### 계산 (근사, 명시적 표기)

위임 실행 r (A의 산출물) 각각에 대해:

```
counterfactual = estimateCost(r.tokens, sessionModelOfThatEpisode).actual
actualCost     = estimateCost(r.tokens, r.model).actual
saved          = max(0, counterfactual - actualCost)
```

- 토큰량 동일 가정(같은 일을 세션 모델이 했어도 같은 토큰) — 보수적이지 않은
  근사임을 렌더 문구에 "추정"으로 명시. estimateCost는 cost.js:118 그대로 재사용
  (totals shape 맞춰 input/cacheRead/cacheCreation/output 전달).
- 룰별 14일 윈도 누적 `savedUsd` → refresh 때마다 재계산(누적 아님, 윈도 스냅샷).

### 노출

- `route-scan rules` 목록: `💰 ~$X.XX/14d` 칼럼.
- ratchet-model.md의 stats 주석(statsOf)에 `saved ~$X` 추가.
- (옵션, 시간 남으면) stats/brief 요약에 위임 절감 합계 한 줄.

### 수용 기준

- [ ] 절감 계산 단위 테스트 (fable 세션 + haiku 위임 케이스 수치 검증)
- [ ] 위임 실측 0건인 룰은 `$0` 아닌 `—` 표시 (오해 방지)

---

## Workstream D — probe-then-commit 룰 문구

**목표**: 룰 적용 시점(request-time)의 오판 비용을 예산·중단 프로토콜로 캡.
코드 변경은 룰 텍스트 생성부만 — 가장 싼 워크스트림.

### 구현

- `route-scan.js ruleText/ruleTextEn`(:376-381)과
  `model-rules.js renderModelRatchet` 병합 룰(:147-153)에 예산 절 추가:
  ko: "위임 시 예산을 함께 명시한다 — 도구 호출 {T2_MAX_CALLS+2}회 또는 출력
  {t2Out} 토큰 초과가 예상되는 시점, 혹은 에러 발생 시 서브에이전트는 부분
  결과만 보고하고 멈추며 메인 모델이 이어받는다"
  (T1 룰은 {T1 상한} 기준. 숫자는 캘리브레이션 결과를 렌더 시점에 삽입 —
  하드코딩 금지. thresholds를 registry에 스냅샷 저장 필요:
  promote 시 `thresholdsAt` 필드로.)
- 프리셋 에이전트(md) 쪽은 이 패키지 소유가 아님(agents.js 주석 참조) —
  건드리지 않는다. 룰 문구만으로 전달.

### 수용 기준

- [ ] 렌더 스냅샷 테스트: ko/en 각각 예산 절 포함 확인
- [ ] 기존 `harness-ratchet-import.test.js` 등 렌더 의존 테스트 green

---

## 공통 마무리

- [ ] `docs/TIER_CRITERIA.md`에 rule-health v2(실측 우선)·상대 티어·절감액 절 추가
- [ ] `docs/ROUTE_SCAN.md` 갱신
- [ ] README 기능 목록 한 줄씩 (ko/en)
- [ ] CHANGELOG + 버전: minor bump (v3.x → v3.(x+1).0)
- [ ] 커밋 분리: A, B, C, D 각각 별 커밋 (feat(route-scan): ...)

## 리스크

- 서브에이전트 jsonl 포맷은 Claude Code 내부 구현 — 버전에 따라 변동 가능.
  파싱은 방어적으로(필드 없으면 skip), 실패 시 프록시 폴백이 있으므로 안전.
- subagents 디렉터리 스캔 비용: 세션당 디렉터리 1개 stat + 파일 N개 파싱.
  rescan 게이트(route-scan.js:463)가 이미 빈도를 제한 — dataBytes 계산에
  서브에이전트 파일 크기도 합산해 게이트 정확도 유지.
- B의 rank 필터로 기존 T1 룰 스탯 분모가 줄어 err% 튈 수 있음 —
  HEALTH_MIN_SAMPLE 가드가 이미 방어.

## 범위 제외 (후속 메모)

- E. 오프라인 bakeoff: `route-scan verify R<N>` — T2 판정 과거 에피소드를
  haiku로 리플레이해 승격 전 검증. LLM 호출 발생(현재 철학 "LLM 호출 0회"와
  충돌)이라 별도 옵트인 설계 필요. 이번 릴리스 제외.
