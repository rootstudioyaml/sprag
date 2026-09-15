# route-scan 동작 상세

티어 기준·리서치 근거는 [TIER_CRITERIA.md](./TIER_CRITERIA.md) 참고. 이 문서는 룰 파일
구조·스캔 트리거·사전 준비 등 운용 상세를 다룬다.

## 모델 피팅 래칫 — 사용자 룰과 파일부터 분리, 로그 기반 자동 갱신

승격된 위임 룰은 손으로 쓴 래칫 룰과 섞이지 않도록 **별도 파일**에 저장됩니다.
프로젝트는 `.claude/ratchet-model.md`, 글로벌은 `~/.claude/ratchet-model.md`. 이 파일은
전적으로 도구 소유라 매 스캔마다 통째로 재생성되며, 이후에도 살아 움직입니다:

- **자동 갱신**: 매 스캔마다 반복 횟수·해당 유형의 에러율을 최신 로그로 다시 계산해
  파일을 재작성합니다. 통계가 바뀌어도 사용자의 `ratchet.md`는 전혀 건드리지 않으므로,
  `.claude/`를 커밋하는 프로젝트에서도 diff 소음이 없습니다 (`ratchet-model.md`는
  gitignore해도 무방하고, 레지스트리에서 항상 재생성 가능).
- **rule-health**: 위임 대상 유형의 에러율이 20%를 넘으면 룰에 `⚠ rule-health` 경고가
  붙어 조건을 좁히거나 제거하라고 알립니다. 이는 "결과(outcome)로 난이도를 정의"하는
  원칙을 룰 수명 관리에 재적용한 것. 실제 위임 실행이 5건 이상 쌓인 룰은 형태 기반
  추정 대신 **그 실행들의 실측 에러율**로 판정합니다(경고 문구에 어느 쪽인지 표기).
- **실측·절감액**: 서브에이전트 실행 기록(`<세션>/subagents/`)을 읽어 룰별로 실제
  위임 횟수·에러율과, 세션 모델이 같은 일을 했을 때 대비 절감액(`~$`, 토큰량 동일
  가정의 근사)을 14일 윈도로 표시합니다. 위임 기록이 없으면 `$0`이 아니라 `—`.
- **예산 문구**: 각 룰에 캘리브레이션된 상한(T2는 도구 호출 8회·출력 p25, T1은 출력
  p75)이 붙어, 초과가 예상되거나 에러가 나면 서브에이전트가 멈추고 메인 모델이
  이어받게 합니다. 룰이 요청 텍스트만 보고 발동하는 데서 오는 오판 비용의 상한.
- **상대 티어**: 세션 모델이 이미 위임 목표와 같은 급 이하이면 후보를 만들지 않습니다
  (Sonnet 세션에서 "sonnet 위임" 룰이 생기던 문제).
- 사용자 룰은 `harness list/rm`, 모델 피팅 룰은 `route-scan rules [rm <N>]`로 각각
  관리하며, 서로의 파일도 인덱스도 침범하지 않습니다.
- `harness init`이 심는 CLAUDE.md 래칫 섹션이 두 파일을 모두 참조하므로 Claude가
  세션에서 함께 적용합니다 (기존 사용자는 `harness init` 재실행으로 블록 갱신).

## 동작 구조 — 실시간 라우팅이 아니라 세션 경계 캘리브레이션

1. `install` 시 SessionStart 훅이 등록되어, 새 세션 시작·`/clear` 때 캐시된 스캔
   결과를 세션 컨텍스트로 주입합니다. 재스캔은 시간이 아니라 **데이터가 트리거**:
   마지막 스캔 이후 새 transcript가 ~5MB 이상 쌓이면 즉시, 소량이면 하루 1회, 아무
   변화가 없으면 아예 돌지 않습니다 (변화 없는 재스캔은 결과가 동일하므로). 최소 간격
   1시간 가드 포함, 룰 등록(promote) 직후에는 통계 기준선 확보를 위해 즉시 1회.

   **위임이 실제로 실행되면 이 게이트를 건너뛰고 바로 재스캔합니다.** PostToolUse 훅이
   `Task`·`Agent` 호출을 받아 백그라운드로 스캔을 띄우므로, `🔀 Routing saved` 금액이
   다음 렌더에 반영됩니다. 게이트는 "결과가 같을 스캔을 건너뛴다"는 취지인데 위임은
   결과가 반드시 달라지는 사건이고, 위임 한 건의 로그는 5MB에 한참 못 미쳐서 그냥 두면
   최소 1시간에서 최대 하루를 기다려야 했습니다. 스캔은 실측 0.5초(14일·67MB 기준),
   위임은 하루 평균 1.6회라서 추가 비용이 하루 1초 미만입니다. 병렬 위임이 한꺼번에
   끝나도 30초 하한 때문에 스캔은 한 번만 돕니다.
2. 반복(≥3회) 패턴이 있으면 statusline에 `🅷⚠ route? R1` 칩이 뜨고, Claude가 등록
   여부와 scope(`--project`/`--global`)를 물어봅니다.
3. 등록된 룰은 **다음 세션부터 메인 모델이 해당 유형을 haiku/sonnet 서브에이전트로
   자동 위임**하게 합니다.

## 권장 사전 준비

`~/.claude/agents/`에 `model: haiku` 서브에이전트(예: haiku-explore / haiku-runner /
haiku-translate)와 `model: sonnet` 범용 서브에이전트를 만들어 두면 룰이 바로 실행
가능해집니다.

---

# route-scan internals (English)

Tier criteria and research evidence: [TIER_CRITERIA.md](./TIER_CRITERIA.md).

## Model-fitting ratchet — a separate file, continuously refreshed

Promoted delegation rules never mix with hand-written ratchet rules: they live in a
**separate, fully tool-owned file** — `.claude/ratchet-model.md` per project,
`~/.claude/ratchet-model.md` for global scope — regenerated wholesale on every scan,
and they stay alive afterward:

- **Auto-refresh**: every rescan recomputes recurrence counts and the category's error
  rate from fresh logs and rewrites the file. Your `ratchet.md` is never touched by
  stat churn, so repos that commit `.claude/` see no diff noise (`ratchet-model.md` is
  safe to gitignore — it's always regenerable from the registry).
- **rule-health**: when the delegated category's error rate exceeds 20%, the rule gets
  a `⚠ rule-health` flag suggesting you narrow or remove it — the "define difficulty
  by outcome" principle applied to rule lifecycle.
- Your rules are managed by `harness list/rm`; model-fitting rules by
  `route-scan rules [rm <N>]` — separate files, separate indexes.
- The CLAUDE.md ratchet section planted by `harness init` references both files, so
  Claude applies them together (existing users: re-run `harness init`).

## How it works — session-boundary calibration, NOT a real-time router

1. `install` registers a SessionStart hook that injects cached scan results as session
   context on startup and `/clear`. Rescans are **data-triggered, not time-triggered**:
   ~5MB of new transcripts rescans immediately, a small trickle rescans daily, no
   change means no rescan. A 1-hour minimum-interval guard applies; promoting a rule
   triggers one immediate refresh to establish its stat baseline.

   **A delegation that actually ran skips that gate and rescans on the spot.** A
   PostToolUse hook on `Task`/`Agent` kicks a detached scan, so the `🔀 Routing saved`
   figure is current on the next render. The gate is there to skip scans that would
   reproduce the same numbers, and a delegation is the one event guaranteed to change
   them — while its own transcript is nowhere near 5MB, so leaving it to the gate meant
   waiting an hour at best and a day at worst. Measured: a scan is ~0.5s over 14 days
   and 67MB, and delegations run ~1.6×/day, so this costs well under a second a day. A
   30-second floor keeps a fan-out of parallel agents to a single scan.
2. When a recurring (≥3×) pattern exists, the statusline shows a `🅷⚠ route? R1` chip
   and Claude asks whether to register it, and at which scope (`--project`/`--global`).
3. Promoted rules make **the main model delegate that work type to a haiku/sonnet
   subagent automatically from the next session on**.

## Recommended companion setup

Create `model: haiku` subagents under `~/.claude/agents/` (e.g. haiku-explore /
haiku-runner / haiku-translate) plus a `model: sonnet` general worker so the rules are
immediately actionable.


---

## From the README (English)

## 🔀 route-scan — "this recurring task could run on a cheaper tier"

Finds the easy work your expensive model (opus/fable) keeps redoing in your session logs and proposes **haiku/sonnet delegation rules**. Fully local, zero token cost.

- **T2 → haiku**: lookups, pasted-screen Q&A, simple runs — zero errors, near-zero mutation
- **T1 → sonnet**: build pipelines, status checks — few mutations, ≤1 error
- **T0 stays**: repeated errors, heavy mutation, design/analysis — the session model keeps it

Three design pillars:
1. Difficulty is judged by **outcome, not text guessing** — tool errors, mutating tool calls, output tokens
2. Thresholds **auto-calibrate to your own 14-day distribution** — fixed constants drift with workload
3. Promoted rules live in a tool-owned file (`.claude/ratchet-model.md`) that **refreshes itself every scan**, and a `⚠ rule-health` flag fires when a delegated category's error rate climbs — rules report their own staleness

```bash
sprag route-scan                    # scan (24h cache) + tiered candidates
sprag harness promote R1 --project  # promote candidate R1 to a model-fitting rule
sprag route-scan dismiss 1          # not interested — won't resurface
sprag route-scan rules              # list model-fitting rules (rm <N> to remove)
sprag route-scan savings            # the savings ledger — which rule moved work off which model, onto which
```

Dig deeper: **tier criteria & research evidence** → [docs/TIER_CRITERIA.md](./TIER_CRITERIA.md) (Korean) · **rule-file mechanics, scan triggers, subagent setup** → [docs/ROUTE_SCAN.md](./ROUTE_SCAN.md) (Korean + English)

### Behind a gateway (Bedrock / LiteLLM)

Through a corporate gateway the transcript records an inference-profile ARN where the model id belongs. That string says nothing about `opus` or `haiku`, so older versions read every session as Sonnet — which made **T1 (→sonnet) rules unreachable and zeroed the savings figures**.

Since v3.10.0 the profile id is mapped back to a role (main, opus, sonnet, haiku) and then to the alias your `ANTHROPIC_DEFAULT_*_MODEL` variables declare. The mapping is learned by joining each parent `Task` call to the subagent run it spawned via `toolUseId`. Below three observations, or when the role votes agree less than 80% of the time, the id stays `unknown` and drops out of the delegation aggregate rather than being guessed at.

For environments the learner cannot reach, write the mapping yourself in `<userDataDir>/profile-map.json`. Account id and region may be wildcarded:

```jsonc
{
  "modelAliases": {
    "arn:aws:bedrock:*:*:application-inference-profile/<PROFILE_ID>": "claude-opus-5",
    "prod-large": "claude-opus-5",   // house aliases map the same way
    "team-*": "claude-haiku-4-5"
  }
}
```

**Map house aliases that carry no family name** (`prod-large`, `team-fast`) here too. Shapes that keep the family name are recognized as-is — Bedrock (`anthropic.claude-opus-4-5-v1:0`), Vertex (`claude-opus-4-5@20251101`), and the 1M suffix (`claude-sonnet-4-5[1m]`) — but an alias without one cannot be priced. Rather than report a wrong figure, routing-savings **drops those runs from the aggregate** (both sides of the comparison must be recognizable); one line in the table above brings them back.

That file holds internal identifiers in plain text — do not commit it. On a direct-API machine it is never created and behaviour is unchanged.

## README 발췌 (한국어)

## 🔀 route-scan: "이 반복 작업은 더 싼 티어로 내려도 됩니다"

세션 로그에서 상위 모델(opus/fable)이 반복 처리해 온 쉬운 작업을 찾아 **haiku/sonnet 위임 룰로 승격**을 제안합니다. 전 과정 로컬, 토큰 비용 0.

- **T2 → haiku:** 탐색과 조회, 단순 실행에 해당합니다. 에러가 없고 변경도 거의 없는 작업입니다.
- **T1 → sonnet:** 빌드와 상태 점검에 해당합니다. 변경이 적고 에러가 1건 이하인 작업입니다.
- **T0 유지:** 에러가 반복되거나 변경이 많거나 설계와 분석이 필요한 작업입니다. 세션 모델이 계속 담당합니다.

핵심 설계는 세 가지입니다:
1. 난이도를 텍스트로 추측하지 않고 **실제 결과로 판정합니다.** 도구 에러와 변경을 일으킨 도구의 수, 출력 토큰을 근거로 삼습니다.
2. 임계값은 **사용자의 최근 14일 로그 분포에서 자동으로 보정합니다.** 고정된 상수는 워크로드가 바뀌면 곧 어긋나기 때문입니다.
3. 승격된 룰은 도구가 관리하는 별도 파일(`.claude/ratchet-model.md`)에서 **자동으로 갱신되며,** 위임한 뒤 에러율이 높아지면 `⚠ rule-health`로 경고합니다. 룰이 낡았다는 사실을 스스로 알리는 셈입니다.

```bash
sprag route-scan                    # 스캔 (24h 캐시) + 티어별 후보 출력
sprag harness promote R1 --project  # 후보 R1을 모델 피팅 룰로 등록
sprag route-scan dismiss 1          # 관심 없으면 무시 (재스캔에도 안 뜸)
sprag route-scan rules              # 등록된 모델 피팅 룰 목록 (rm <N>으로 제거)
sprag route-scan savings            # 절감 원장: 어느 룰이 어떤 모델에서 어떤 모델로 옮겼는지
```

`route-scan savings`는 statusline의 `🔀 Routing saved` 한 줄 뒤에 있는 근거를 그대로 보여줍니다. 모델 이동별 합계와 실행별 내역이 함께 나오므로, 금액이 어디서 나왔는지 추적할 수 있습니다.

```
🔀 라우팅 절감 누적 $2.09  (최근 7일 $1.40 · 30일 $2.09)

모델 이동별:
  claude-fable-5 → claude-sonnet-5  —  1회, $0.72
  claude-opus-5 → claude-haiku-4-5  —  1회, $0.57
```

더 알아보기: **티어 기준·리서치 근거** → [docs/TIER_CRITERIA.md](./TIER_CRITERIA.md) · **룰 파일 구조·스캔 트리거·서브에이전트 준비** → [docs/ROUTE_SCAN.md](./ROUTE_SCAN.md)

### 게이트웨이(Bedrock·LiteLLM) 경유 환경

사내 게이트웨이를 거치면 로그의 모델명 필드에 추론 프로파일 ARN이 기록됩니다. 그 문자열에는 `opus`·`haiku` 같은 단서가 없어서 예전 버전은 이것을 전부 Sonnet으로 읽었고, 그 결과 **T1(→sonnet) 위임 룰이 하나도 제안되지 않았으며 절감 집계가 0**이었습니다.

v3.10.0부터는 프로파일 ID를 역할(main·opus·sonnet·haiku)로 되돌린 뒤 `ANTHROPIC_DEFAULT_*_MODEL` 환경변수가 선언한 별칭으로 치환합니다. 매핑은 부모 세션의 `Task` 호출과 서브에이전트 기록을 `toolUseId`로 조인해 스스로 학습하며, 관측이 3건 미만이거나 역할 판정이 80% 미만으로 갈리면 **추측하지 않고 `unknown`으로 두고 위임 집계에서 제외**합니다.

자동 학습이 닿지 않는 환경에서 쓸 수 있는 수동 경로도 있습니다. `<userDataDir>/profile-map.json`에 아래처럼 적으면 되고, 계정 ID와 리전은 `*`로 가려도 매칭됩니다.

```jsonc
{
  "modelAliases": {
    "arn:aws:bedrock:*:*:application-inference-profile/<PROFILE_ID>": "claude-opus-5",
    "prod-large": "claude-opus-5",   // 사내 별칭도 같은 방식으로 매핑됩니다
    "team-*": "claude-haiku-4-5"
  }
}
```

**모델명에 `opus`·`sonnet`·`haiku`·`fable` 이 들어 있지 않은 사내 별칭**(`prod-large`, `team-fast` 등)도 이 표로 매핑하십시오. Bedrock(`anthropic.claude-opus-4-5-v1:0`)·Vertex(`claude-opus-4-5@20251101`)·1M 접미사(`claude-sonnet-4-5[1m]`) 같이 계열명이 남아 있는 형태는 그대로 인식되지만, 계열명이 사라진 별칭은 가격표가 알아볼 수 없습니다. 이 경우 라우팅 절감 계산은 **틀린 금액을 내놓는 대신 그 실행을 집계에서 제외**하며(비교 양쪽 모두 인식 가능한 이름이어야 합니다), 위 표에 한 줄 추가하면 다시 집계에 들어옵니다.

이 파일에는 사내 식별자가 평문으로 남으므로 저장소에 커밋하지 마십시오. 게이트웨이를 쓰지 않는 환경에서는 파일이 아예 만들어지지 않고 기존 동작이 그대로 유지됩니다.
