# 검토: R(모델 피팅 룰) 조건 체크 우선순위 문제

대상: `src/route-scan.js`, `src/model-rules.js` (2026-07-14 기준)
계기: 사용자 체감 — "r 조건 체크하는 우선순위에 문제가 있는 듯"

## 요약

우선순위 문제는 실재하며, 서로 다른 층위에서 3개가 겹쳐 있다.

1. **[가장 체감 큰 문제] 같은 카테고리에 T2(haiku)·T1(sonnet) 룰이 동시 등록되는데, 렌더된 ratchet-model.md에 어느 룰이 먼저인지 판별 기준이 없다.**
2. **categorize()의 first-match 순서가 오분류를 만든다** — `explore`/`read`가 `run`보다 먼저, `run`이 `check`보다 먼저.
3. **rule-health 갱신이 tier를 무시하고 category 단위로만 집계**되어 T2·T1 룰이 같은 통계(×13, err 8%)를 공유한다.

---

## Finding A — 동일 카테고리 T1/T2 룰 충돌 (판별 우선순위 부재)

현재 이 프로젝트(`yaml-app-secretranchat-agent/.claude/ratchet-model.md`)에 실제로 발생:

```
- "명령 실행 (빌드·테스트·git)" 단순 요청(예: "빌드") → haiku-runner 위임        ← T2 룰
- "명령 실행 (빌드·테스트·git)" 중간 난도 요청(예: "빌드 연결하고 제출까지") → sonnet ← T1 룰
```

- 티어 판정(`tierOf`, route-scan.js:190-202)은 **에피소드가 끝난 뒤의 결과값**(호출 수, 출력 토큰, mutating 횟수, 에러)으로 계산된다. 즉 요청이 들어오는 시점에는 T1인지 T2인지 알 수 없다.
- 그런데 렌더된 룰(model-rules.js:301-303)은 "단순 요청" / "중간 난도 요청"이라는 라벨만 주고 **판별 조건을 안 준다**. 룰을 읽는 LLM 입장에서 "빌드"라는 새 요청이 haiku-runner 대상인지 sonnet 대상인지 결정할 근거가 없음 → 어느 줄을 먼저 매칭하느냐가 사실상 랜덤.
- 원인: 중복 억제 체크 `hasRule()`(route-scan.js:297-299)이 `r.tier === g.tier && r.category === g.category`로 tier까지 일치해야 억제하므로, 같은 카테고리의 T1·T2 후보가 각각 승격 가능.

**수정 방향(제안):**
- (a) 렌더 시 같은 category의 룰을 묶어 하나의 조건부 룰로 출력: "명령 실행 유형 → 기본 haiku-runner, 단 다단계·외부 제출·설계 판단이 섞이면 sonnet, 그래도 막히면 메인" — 판별 힌트(예상 규모·키워드)를 명시.
- (b) 또는 promote 시 같은 category에 기존 tier 룰이 있으면 병합/선택을 사용자에게 묻기.

## Finding B — categorize() first-match 순서 오분류

route-scan.js:66-103, 검사 순서 = paste → translate → explore → read → run → check.

실측 (재현 스크립트 실행 결과):

| 입력 | 분류 결과 | 기대 |
|---|---|---|
| "테스트 통과했는지 **확인**해줘" | run (테스트) | check |
| "최초 인스톨시 … 잘 진행되는지 테스트해보고 싶은데" | run | check/E2E |
| "빌드 연결하고 **제출**까지 해줘" | run | 위임 부적합(외부 제출) |
| "IAP 상품 먼저 등록할게 방법 **알려줘**" | read | 절차 안내(read 아님) |
| "어디서 빌드 실행해?" | explore (어디) | run/explore 애매 |
| "이 함수 뭐 하는지 grep으로 찾아서 실행해봐" | explore | 복합 |

문제 패턴:
- `read` 정규식의 `알려줘|보여줘|what`이 지나치게 넓어 how-to·모니터링 요청까지 흡수.
- `run` 정규식의 `테스트`가 "테스트해보고 싶다"(검증 의도)까지 흡수하고, `check`는 맨 마지막이라 사실상 잔여 카테고리.
- `paste`(길이 ≥400)가 모든 것에 우선 — 긴 로그를 붙인 빌드 요청도 paste로 분류(주석상 의도된 동작이지만, run+로그 케이스에서 haiku-explore로 잘못 위임).
- "제출"(스토어 제출) 같은 **비가역·외부 작업 키워드가 위임 후보에서 제외되지 않음**. ESCALATE_RE(route-scan.js:45)에 설계·분석 키워드만 있고 deploy/제출/submit/배포/결제류가 없다.

**수정 방향(제안):** check를 run보다 앞으로 이동 + `run` 정규식에서 `테스트`를 의도 구분(테스트 실행 vs 검증 요청), ESCALATE_RE에 외부/비가역 키워드(제출|submit|deploy|배포|release|merge) 추가.

## Finding C — rule-health 통계가 tier 무시

- `episodeStats` 키는 `category|project`뿐 (route-scan.js:256-257), `refreshModelRules`(model-rules.js:184-188)가 이 값을 T1·T2 룰 모두에 그대로 덮어씀.
- 실제 증상: ratchet-model.md에서 run 카테고리 T2 룰과 T1 룰이 **동일한 ×13, err 8%** 표기 — 13개 에피소드가 두 룰에 이중 계상.
- promote 시점 count(=tier별 재발 횟수)가 첫 refresh에서 category 전체 count로 덮어써져 의미가 바뀜.

**수정 방향(제안):** episodeStats 키를 `tier|category|project`로 확장하거나, refresh 시 tier별로 shapeTier를 나눠 집계.

## 부수 관찰

- route-scan.js:263 `cat.id` — `cat`이 null이면 tierOf가 T0을 반환해 continue되므로 null-deref는 없음 (문제 아님).
- SessionStart 훅의 R1 예시("…테스트해보고 싶은데")도 Finding B의 오분류 산물 — 등록 전이라면 promote 보류 권장.

## 수정 내역 (2026-07-14 적용 완료)

사용자 체감 증상 = Finding B. A·B·C 모두 수정.

- **B** `src/route-scan.js`
  - CATEGORIES 순서: `check`를 `run` 앞으로 이동 (paste → translate → explore → read → **check → run**), check 정규식에 `되는지` 추가.
  - ESCALATE_RE에 비가역·외부 작업 키워드 추가: `제출|배포|출시|submit|deploy|release|publish|merge`.
  - ruleText: T2 룰에 "비가역 작업 섞이면 위임하지 않음", T1 룰에 "비가역 작업 시 메인 이어받음" 명시.
  - 검증: 9개 케이스 전부 PASS ("테스트 통과했는지 확인해줘"→check, "빌드 돌려줘"→run, "제출/배포/merge"→escalate).
- **A** `src/model-rules.js` renderModelRatchet: 같은 category의 T2+T1 룰을 판별 조건이 담긴 하나의 병합 룰로 렌더 (기본 haiku → 다단계는 sonnet → 비가역·반복 에러는 메인 직접).
- **C** episodeStats 키를 `tier|category|project`로 확장 (route-scan.js bumpStats + model-rules.js refreshModelRules). 재스캔 후 run 카테고리 통계가 T2 ×1 / T1 ×7로 분리됨 (기존: 양쪽 다 ×13 이중 계상).

적용 후 `route-scan --refresh` 실행 → 프로젝트/글로벌 ratchet-model.md 재생성 확인.
기존에 훅이 제안했던 R1 후보("…테스트해보고 싶은데" → run/T1)는 재분류 후 후보에서 사라짐 (오분류 산물이었음을 확인).
