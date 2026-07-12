# route-scan 동작 상세

티어 기준·리서치 근거는 [TIER_CRITERIA.md](./TIER_CRITERIA.md) 참고. 이 문서는 룰 파일
구조·스캔 트리거·사전 준비 등 운용 상세를 다룬다.

## 모델 피팅 랫쳇 — 사용자 룰과 파일부터 분리, 로그 기반 자동 갱신

승격된 위임 룰은 손으로 쓴 랫쳇 룰과 섞이지 않도록 **별도 파일**에 저장됩니다 —
프로젝트는 `.claude/ratchet-model.md`, 글로벌은 `~/.claude/ratchet-model.md`. 이 파일은
전적으로 도구 소유라 매 스캔마다 통째로 재생성되며, 이후에도 살아 움직입니다:

- **자동 갱신**: 매 스캔마다 반복 횟수·해당 유형의 에러율을 최신 로그로 다시 계산해
  파일을 재작성합니다. 통계가 바뀌어도 사용자의 `ratchet.md`는 전혀 건드리지 않으므로,
  `.claude/`를 커밋하는 프로젝트에서도 diff 소음이 없습니다 (`ratchet-model.md`는
  gitignore해도 무방 — 레지스트리에서 항상 재생성 가능).
- **rule-health**: 위임 대상 유형의 에러율이 20%를 넘으면 룰에 `⚠ rule-health` 경고가
  붙어 조건을 좁히거나 제거하라고 알립니다 — "결과(outcome)로 난이도를 정의"하는
  원칙을 룰 수명 관리에 재적용한 것.
- 사용자 룰은 `harness list/rm`, 모델 피팅 룰은 `route-scan rules [rm <N>]`로 각각
  관리 — 서로의 파일도 인덱스도 침범하지 않습니다.
- `harness init`이 심는 CLAUDE.md 랫쳇 섹션이 두 파일을 모두 참조하므로 Claude가
  세션에서 함께 적용합니다 (기존 사용자는 `harness init` 재실행으로 블록 갱신).

## 동작 구조 — 실시간 라우팅이 아니라 세션 경계 캘리브레이션

1. `install` 시 SessionStart 훅이 등록되어, 새 세션 시작·`/clear` 때 캐시된 스캔
   결과를 세션 컨텍스트로 주입합니다. 재스캔은 시간이 아니라 **데이터가 트리거**:
   마지막 스캔 이후 새 transcript가 ~5MB 이상 쌓이면 즉시, 소량이면 하루 1회, 아무
   변화가 없으면 아예 돌지 않습니다 (변화 없는 재스캔은 결과가 동일하므로). 최소 간격
   1시간 가드 포함, 룰 등록(promote) 직후에는 통계 기준선 확보를 위해 즉시 1회.
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
2. When a recurring (≥3×) pattern exists, the statusline shows a `🅷⚠ route? R1` chip
   and Claude asks whether to register it, and at which scope (`--project`/`--global`).
3. Promoted rules make **the main model delegate that work type to a haiku/sonnet
   subagent automatically from the next session on**.

## Recommended companion setup

Create `model: haiku` subagents under `~/.claude/agents/` (e.g. haiku-explore /
haiku-runner / haiku-translate) plus a `model: sonnet` general worker so the rules are
immediately actionable.
