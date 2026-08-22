**한국어** · [English](./README.en.md)

[![DeepPulse YouTube](https://img.shields.io/badge/YouTube-@DeepPulseKR-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseKR)
[![DeepPulseEN YouTube](https://img.shields.io/badge/YouTube-@DeepPulseEN-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseEN)
[![Homepage](https://img.shields.io/badge/Homepage-rootstudioyaml.github.io-2ea44f)](https://rootstudioyaml.github.io/)
[![npm](https://img.shields.io/npm/v/claude-token-saver.svg)](https://www.npmjs.com/package/claude-token-saver)

# claude-token-saver

**Claude Code 토큰 사용량을 statusline 한 줄로 진단하고, 상위 모델이 반복 처리하는 easy 작업은 더 싼 모델로 내려보내는 CLI.** 의존성 0, 설치 한 줄이면 끝.

v3.x부터는 사후 모니터링을 넘어 **모델 피팅 라우팅 계층**입니다: 세션 로그를 티어(T0/T1/T2)로 분류해 "이 반복 작업은 haiku/sonnet이면 충분하다"를 룰로 승격하고, 다음 세션부터 메인 모델이 자동 위임합니다 ([route-scan](#-route-scan--이-반복-작업-더-싼-티어로-내려도-됩니다)).

```bash
npm i -g claude-token-saver   # postinstall이 statusline + Skill 자동 등록
```

![statusline 예시](./docs/statusline.png)

## 📺 영상 보고 오셨다면 — 60초

라우터가 아닙니다. 요청을 실시간으로 가로채지 않습니다.
**세션이 끝난 뒤** 로컬 기록을 읽어서, 비싼 모델이 반복해서 처리해 온 쉬운 유형을 뽑고,
그 유형은 **다음 세션부터** 싼 모델이 맡도록 룰로 겁니다. 룰은 글로벌·프로젝트로 범위가 나뉩니다.

```bash
npm i -g claude-token-saver@latest
claude-token-saver route-scan         # 내 지난 세션에서 위임 후보 뽑기 (LLM 호출 0)
claude-token-saver route-scan rules   # 승격된 룰 확인 · rm <N> 으로 삭제
```

기준선은 남의 벤치마크가 아니라 **내 최근 14일 분포(p25/p75)** 로 잡습니다.
넘긴 뒤 실제로 잘 됐는지까지 재는 실측 rule-health는 [v3.9.0](#v390-2026-08-01)에 들어갔습니다.


## ⚡ 왜 쓰나 — 30초 요약

| | |
|---|---|
| 🔀 **모델 피팅 위임** | 상위 모델(opus/fable)이 반복 처리해 온 easy 작업을 티어(T0/T1/T2)로 분류 → haiku/sonnet 위임 룰로 승격, 다음 세션부터 자동 적용 |
| 💸 **비용 실측 −18.6%** | harness+ratchet 도입 전후, 사용자 메시지당 비용 $2.35 → $1.91 (저자 로그, [상세](#실제-효과--도입-전후-리포트)) |
| 🚨 **한도 초과 예방** | 5H/7D rate-limit 윈도 90% 도달 시 즉시 경고 + `handoff`로 작업 백업 |
| 🧠 **캐시 낭비 감지** | 히트율·TTL 카운트다운·1M 컨텍스트 자동 감지 — 토큰 급증 원인을 코드로 진단 |
| 🅷 **같은 실수 차단** | 반복 에러를 감지해 ratchet 룰로 승격 — 다음 세션부터 자동 적용 |
| 💰 **절감액 가시화** | 프롬프트 캐시가 아껴준 금액을 실시간 표시 (`💰 Cache saved $2.1K`) |

📺 [출시 영상 (60초)](https://www.youtube.com/shorts/RaD8qMsPTnA)

---

## 시작하기

**사전 준비:** Node.js ≥ 18 (`node -v`로 확인 · macOS `brew install node` · Windows `winget install OpenJS.NodeJS.LTS` · Linux/WSL은 [nvm](https://github.com/nvm-sh/nvm) 권장)

```bash
npm uninstall -g claude-cache-monitor   # (구 패키지 사용자만)
npm i -g claude-token-saver
```

설치 즉시 Claude Code 하단에 statusline이 나타납니다. `--ignore-scripts`/sudo 등으로 자동 등록이 안 됐다면 `claude-token-saver install`로 수동 등록하세요.

> ⚠️ sudo 글로벌 설치는 Skill이 root의 `~/.claude`에 등록되는 함정이 있습니다 — nvm/fnm/Volta로 사용자 영역 설치를 권장합니다.

## statusline 읽는 법

```
🤖 Opus 4.8 · 🧠 Cache hit 98.0% · ⏳ Cache expires 58:38 · ✦ current █░░░░░ 15% 🔄 08:50 · 📅 weekly █▒░░░░ 24% 🔄 Thu 13:00 · 📦 Ctx 200k · 💰 Cache saved $205 · last 1d
```

| 세그먼트 | 의미 |
|---|---|
| `🤖` | 현재 모델 |
| `🅷 5/5` | harness 원칙 점수 ([Harness 모드](#-harness-모드)) |
| `🧠` | 캐시 히트율 (85%+ 녹색) |
| `⏳` | 캐시 TTL 카운트다운 — 만료 전에 메시지를 보내면 캐시 유지 |
| `✦ current` / `📅 weekly` | 5시간 / 7일 rate-limit 윈도 사용률 + 리셋 시각 |
| `📦` | 컨텍스트 사용률 (예: `Ctx 68% of 1M`) — 사용률 기준 녹/황/적. 현재 모델은 1M이 기본·프리미엄 없음이지만, 토큰량 자체가 턴당 비용과 5H/7D 한도를 태웁니다 |
| `💰` | 캐시가 절약해준 누적 금액 |
| `🔀` | **모델 위임으로 아낀 누적 비용** — 같은 일을 더 싼 모델이 대신 처리해서 아낀 금액이며, 프롬프트 캐시 절감(`💰`)과는 다른 수치입니다. 실측 위임이 없으면 표시되지 않습니다 |

문제가 감지되면 **경고 칩이 맨 앞에** 붙습니다:

```
🚨 5H █████▓ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 4.8 · 🧠 Cache hit 72.1% · ⚠ Cache miss · 📅 weekly ▓░░░░░ 12% 🔄 Sun 14:26 · 📦 Ctx 200k · last 1d
```

칩 종류 — `🚨 5H/7D NN%`(캡 임박) · `⚠ Ctx 200k+`(단일 요청이 실제로 200k 초과) · `⚠ Cache miss` · `⚠ Input spike` · `⚠ Output heavy` · `⚠ Call surge` · `⚠ Rebuild churn` · `⚠ 5m TTL`. 두 윈도가 동시에 90%+면 리셋이 임박한 쪽이 🚨로 승격되고 나머지는 빨간 세그먼트로 유지됩니다 (v2.16.0+).

### 경고 칩이 떴을 때

Claude 안에서 `/claude-token-saver` Skill을 실행하거나 칩 문구를 그대로 말하면("5H cap 떴어", "cache miss") Skill이 자동 활성화되어 **원인 코드 + 단계별 해결 명령**을 보여줍니다. 캡 임박 시에는 `claude-token-saver handoff`로 현재 작업을 마크다운으로 백업한 뒤 새 세션에서 이어가는 워크플로를 권합니다.

## 주요 명령

셸에서 직접 실행합니다 (Claude Code 안에서는 `/claude-token-saver` Skill 하나만 사용):

| 명령 | 설명 |
|---|---|
| `claude-token-saver` | 최근 1일 진단 리포트 (`--days N` / `--hours N`) |
| `claude-token-saver last` | 가장 최근 경고 1건 + 처방 |
| `claude-token-saver history` | 최근 7일 경고 전이 로그 |
| `claude-token-saver handoff` | 작업 상태를 `HANDOFF-*.md`로 백업 (캡 임박 시) |
| `claude-token-saver mode [keywords...]` | 출력 설정 (`icon`/`text`, `ko`/`en`, `1h`~`30d` 윈도 등) |
| `claude-token-saver harness ...` | 🅷 Harness 관리 (아래 참고) |
| `claude-token-saver route-scan` | 상위 모델이 반복 처리한 easy 작업 감지 → haiku 위임 랫쳇 룰 제안 (아래 참고) |
| `claude-token-saver compact-window` | 1M 컨텍스트인데 자동 압축 창이 안 잡혀 있으면 경고 → `set`으로 40만 고정 (아래 참고) |
| `claude-token-saver install` | Skill·statusline 수동 등록 |

출력 언어는 `mode ko` / `mode en`으로 전환합니다 (기본 영어, statusline 칩은 항상 기호). 전체 옵션은 [영문 README](./README.en.md#options) 참고.

## 🅷 Harness 모드

다섯 원칙(Ratchet · Evidence · PEV · Structured Task · Default Safe Path)을 한 줄 명령으로 `CLAUDE.md`에 셋업하고 statusline이 `🅷 5/5`로 점수화합니다. 같은 에러가 반복되면 `🅷⚠ ratchet?` 알림이 떠서 룰로 승격할 수 있습니다.

```bash
claude-token-saver harness init                # 이 프로젝트에 셋업
claude-token-saver harness init --global       # ~/.claude/CLAUDE.md — 모든 프로젝트 적용
claude-token-saver harness check               # 현재 점수 (글로벌 fallback 인정)
claude-token-saver harness promote <N> --project|--global   # 경고 #N → ratchet 룰 (스코프 필수)
claude-token-saver harness promote "<룰 텍스트>" --project|--global  # 내가 직접 정의한 룰도 같은 명령으로 등록
claude-token-saver harness pull                # 패키지 동봉 큐레이션 룰 → 내 글로벌 랫쳇에 등록 (opt-in, 중복 스킵)
claude-token-saver harness list / rm <N>       # 룰 조회 / 삭제 (자동 .bak)
claude-token-saver harness off | on            # 🅷 표시 토글
```

- `promote`는 non-TTY(스크립트·LLM 호출)에서 `--project`/`--global` 플래그가 **필수** — 스코프가 묻지 않고 결정되는 사고를 막기 위한 설계입니다.
- `pull`은 패키지에 동봉된 **제작자 큐레이션 랫쳇 룰**(`presets/ratchet-rules.md` — 실제 반복 사고에서 승격된 범용 룰만)을 내 글로벌 랫쳇(`~/.claude/ratchet.md`)에 등록합니다. 설치(`install`)나 `init`은 아무것도 자동 주입하지 않으며, `pull`은 항상 opt-in이고 재실행해도 중복이 없습니다(멱등). 마음에 안 드는 룰은 `harness rm`으로 제거하면 됩니다.
- 🅷⚠ 런타임 경고(`ratchet?` `no-evidence` `PEV-skip`)는 30분 후 자동 만료되고, 하위 디렉터리 세션도 프로젝트에 올바르게 매칭됩니다. PEV-skip은 변경성 도구(Edit/Write/Bash)만 카운트해 읽기 위주 세션에서는 발동하지 않습니다 (v2.16.0+).

<details>
<summary>⚠️ <code>harness rm</code>은 신중하게 — 삭제 전 체크리스트</summary>

ratchet의 가치는 **한 방향 누적**에 있습니다. 룰을 가볍게 지우면 같은 실수가 다시 새기 시작합니다.

- **룰이 너무 광범위해서 정상 케이스도 막나?** → ❌ 삭제 ✅ 조건을 좁혀 다듬기 (예: `"하드코딩 금지"` → `"테스트 외 코드에서 하드코딩 금지"`)
- **룰이 너무 좁아 거의 발동 안 되나?** → ❌ 삭제 ✅ 그냥 두기 (비용 0)
- **정말 잘못된 룰이라 확신?** → ✅ 그때만 삭제

삭제 시 `.bak`이 남지만 **그 룰이 박힌 세션 컨텍스트(왜)는 복원되지 않습니다.**
</details>


## 📦 compact-window — 1M 컨텍스트의 자동 압축 지점 고정

Claude Code는 `min(autoCompactWindow, 모델 최대 창)`에 가까워지면 대화를 자동 압축합니다. 1M 창을 쓰면 이 값이 잡혀 있지 않은 한 80만 토큰 근처까지 가서야 압축이 걸리고, 그전까지 모든 요청이 전체 컨텍스트를 통째로 재과금합니다. **1M은 너무 크니 40만~70만 범위를 권장합니다** — 큰 붙여넣기용 여유는 200k 세션의 2~3.5배로 남기면서 꼬리만 잘라냅니다.

**권장 범위 안이면 경고하지 않습니다.** 40만은 절감이 압축 횟수를 이기는 하한이고, 긴 세션은 그보다 여유가 더 필요한 경우가 많습니다. 미설정이거나 70만을 넘을 때만 알립니다(그보다 낮게 잡은 건 더 공격적으로 아끼겠다는 선택이라 그냥 둡니다).

**200k 컨텍스트는 경고 대상이 아닙니다** — 창이 이미 200k 이하라 이 설정이 바꿀 게 없습니다.

```bash
claude-token-saver compact-window                       # 현재 상태 (모델·창·설정값·출처)
claude-token-saver compact-window set --global          # ~/.claude/settings.json 에 50만 고정 (범위 중간)
claude-token-saver compact-window set --project         # <root>/.claude/settings.json 에 고정
claude-token-saver compact-window set --global --value 600k    # 값 직접 지정 (10만~1M)
claude-token-saver compact-window off | on              # 경고 표시 토글
```

- 1M 모델인데 미설정이거나 40만을 넘으면 statusline에 `🅷⚠ compact-window?`가 뜨고, 세션 브리핑이 등록 명령까지 알려줍니다.
- 스코프(`--global`/`--project`)는 `set`에서 **필수** — 글로벌 설정 파일을 묻지 않고 고치지 않기 위한 설계입니다.
- 기존 `settings.json`의 다른 키는 그대로 보존하고 `.bak`을 남깁니다. JSON이 깨져 있으면 아무것도 쓰지 않고 중단합니다.
- 셸에 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`가 export돼 있으면 그쪽이 settings.json보다 우선합니다 (`set`이 이 경우를 감지해 알려줍니다).

## 🔀 route-scan — "이 반복 작업, 더 싼 티어로 내려도 됩니다"

세션 로그에서 상위 모델(opus/fable)이 반복 처리해 온 쉬운 작업을 찾아 **haiku/sonnet 위임 룰로 승격**을 제안합니다. 전 과정 로컬, 토큰 비용 0.

- **T2 → haiku**: 탐색·조회·단순 실행 — 에러 0, 변경 거의 없음
- **T1 → sonnet**: 빌드·상태 점검 — 변경 소수, 에러 ≤1
- **T0 유지**: 에러 반복·대량 변경·설계/분석 — 세션 모델이 계속 담당

핵심 설계는 세 가지입니다:
1. 난이도는 텍스트 추측이 아니라 **결과(outcome)로 판정** — 도구 에러·변경성 도구 수·출력 토큰
2. 임계값은 **내 최근 14일 로그 분포에서 자동 보정** — 고정 상수는 워크로드가 바뀌면 어긋나므로
3. 승격된 룰은 도구 소유 별도 파일(`.claude/ratchet-model.md`)에서 **자동 갱신**되고, 위임 후 에러율이 높아지면 `⚠ rule-health`로 경고 — 룰이 스스로 낡음을 알림

```bash
claude-token-saver route-scan                    # 스캔 (24h 캐시) + 티어별 후보 출력
claude-token-saver harness promote R1 --project  # 후보 R1을 모델 피팅 룰로 등록
claude-token-saver route-scan dismiss 1          # 관심 없으면 무시 (재스캔에도 안 뜸)
claude-token-saver route-scan rules              # 등록된 모델 피팅 룰 목록 (rm <N>으로 제거)
```

더 알아보기: **티어 기준·리서치 근거** → [docs/TIER_CRITERIA.md](./docs/TIER_CRITERIA.md) · **룰 파일 구조·스캔 트리거·서브에이전트 준비** → [docs/ROUTE_SCAN.md](./docs/ROUTE_SCAN.md)

### 게이트웨이(Bedrock·LiteLLM) 경유 환경

사내 게이트웨이를 거치면 로그의 모델명 자리에 추론 프로파일 ARN이 기록됩니다. 그 문자열에는 `opus`·`haiku` 같은 단서가 없어서 예전 버전은 이것을 전부 Sonnet으로 읽었고, 그 결과 **T1(→sonnet) 위임 룰이 하나도 제안되지 않았으며 절감 집계가 0**이었습니다.

v3.10.0부터는 프로파일 ID를 역할(main·opus·sonnet·haiku)로 되돌린 뒤 `ANTHROPIC_DEFAULT_*_MODEL` 환경변수가 선언한 별칭으로 치환합니다. 매핑은 부모 세션의 `Task` 호출과 서브에이전트 기록을 `toolUseId`로 조인해 스스로 학습하며, 관측이 3건 미만이거나 역할 판정이 80% 미만으로 갈리면 **추측하지 않고 `unknown`으로 두고 위임 집계에서 제외**합니다.

자동 학습이 닿지 않는 환경을 위한 수동 경로도 있습니다. `<userDataDir>/profile-map.json`에 아래처럼 적으면 되고, 계정 ID와 리전은 `*`로 가려도 매칭됩니다.

```jsonc
{
  "modelAliases": {
    "arn:aws:bedrock:*:*:application-inference-profile/<PROFILE_ID>": "claude-opus-5"
  }
}
```

이 파일에는 사내 식별자가 평문으로 남으므로 저장소에 커밋하지 마십시오. 게이트웨이를 쓰지 않는 환경에서는 파일이 아예 만들어지지 않고 기존 동작이 그대로 유지됩니다.

## 토큰 급증 원인 코드

| 코드 | 의미 |
|---|---|
| `LARGE_INPUT_PER_REQUEST` | 단일 요청 입력이 200k 초과 — 턴당 재과금·한도 소모 급증 |
| `LOW_HIT_RATE` | 캐시 히트율 50% 미만 |
| `BUCKET_5M_DOMINANT` | 캐시 쓰기의 70%+가 5분 버킷 (Pro 플랜/Max 다운그레이드) |
| `HIGH_OUTPUT_RATIO` | 출력/입력 비율 0.15 초과 (출력 단가는 입력의 5배) |
| `HIGH_REQUEST_COUNT` | 요청 수가 중앙값의 3배+ (도구 호출 루프 의심) |
| `FREQUENT_CACHE_REBUILD` | 캐시 재작성이 읽기보다 많음 |

각 코드마다 OS별 해결 명령이 함께 출력됩니다.

## 실제 효과 — 도입 전후 리포트

![claude-token-saver — harness + ratchet 도입 효과](./docs/harness-impact.png)

harness 5/5 + ratchet을 실제 적용한 전후 비교입니다 (저자 Claude Code 로그, **사용자 메시지 1건당** 정규화, 2026-05-02 기준, Opus 4.7 가격):

| 메트릭 | 도입 전 (7일/739msg) | 도입 후 (2일/157msg) | 변화 |
|---|---:|---:|---:|
| 메시지당 비용 | $2.345 | $1.910 | **−18.6%** |
| 메시지당 출력 토큰 | 7,391 | 6,052 | −18.1% |
| 메시지당 assistant 왕복 | 9.73 | 8.83 | −9.2% |
| 메시지당 도구 호출 | 5.72 | 5.25 | −8.2% |

같은 요청을 더 적은 왕복으로 끝낸다 = 첫 시도 적중률 ↑. PEV·Structured Task가 한 번에 가게 만든 효과로 보입니다.

<details>
<summary>측정 배경 — 캐시 히트율이 빠진 이유 · 샘플 주의</summary>

- 저자는 Max 플랜(캐시 TTL 1시간)이라 히트율이 이미 ~98%에 수렴해 개선 여지가 작았습니다. **Pro 플랜(5분 TTL) 사용자는** 만료 직전 handoff 워크플로 조합으로 히트율 자체가 오를 가능성이 큽니다.
- 만료 직전 handoff 워크플로: statusline TTL 카운트다운을 보다가 만료 직전 `claude-token-saver handoff`로 작업 상태를 백업하고 새 캐시 사이클을 시작. 1M 경고·cap 칩도 같은 흐름으로 처리.
- ⚠️ 도입 후 데이터는 2일치(157msg)로 통계적 의미가 약하고, 주별 작업 토픽 차이가 섞여 있어 도구 효과만 깨끗이 분리되진 않습니다.
</details>

## 동작 원리 · 환경

Claude Code는 모든 API 응답을 `~/.claude/projects/<dir>/<session>.jsonl`에 기록합니다. 이 도구는 `cache_read_input_tokens`, `cache_creation.ephemeral_5m/1h_input_tokens` 등을 `requestId` 기준으로 중복 제거 후 집계합니다.

Node.js ≥ 18 · macOS / Linux / Windows / WSL · **의존성 0**.

<details>
<summary>알려진 환경 이슈 · 마이그레이션</summary>

**IntelliJ Claude Code plugin** — statusline 위젯이 프레임을 잘못 합성해 `59:548` 같은 잔재가 보이는 버그가 있습니다(이모지 출력에서만). v2.8.5+는 `TERMINAL_EMULATOR=JetBrains-JediTerm` 감지 시 자동으로 text 모드 폴백합니다.

**claude-cache-monitor에서 마이그레이션:**
```bash
npm uninstall -g claude-cache-monitor && npm i -g claude-token-saver
```
`~/.claude/settings.json`의 `statusLine.command`도 `claude-token-saver …`로 교체하세요.
</details>

## 릴리스 노트

### v3.12.0 (2026-08-22)
- **Routing saved가 주간·월간·누적으로 statusline 1줄째에 올라옵니다** — `🔀 Routing saved weekly $1.3 · monthly $2.0 · total $9.8`. 위임 절감 이벤트를 서브에이전트 run 단위로 원장(`delegation-ledger.json`)에 기록하고(트랜스크립트 경로 키라 재스캔이 겹쳐도 중복 집계 없음), 7일·30일·전체 합산을 표시합니다. 나머지 칩은 2줄째로 내려갑니다. 원장이 비어 있으면 기존 1줄 그대로이고, 일부 환경(macOS 구버전 Claude Code)에서 첫 줄만 보이면 `--single-line`으로 기존 레이아웃을 유지할 수 있습니다. 집계는 원장 도입 시점부터 시작합니다(소급 없음).
- **`harness check`가 컨텍스트 무게도 알려줍니다** — CLAUDE.md의 요청당 대략 토큰(~4k 가이드라인 초과 시 경고)과 `.claudeignore` 유무를 표시합니다. 자문 정보일 뿐 🅷 N/5 점수에는 반영하지 않습니다.
- **모델명이 내장된 ARN은 학습 없이 즉시 해석** — `foundation-model/anthropic.claude-…`와 시스템 교차 리전 프로파일(`inference-profile/us.anthropic.claude-…`)은 자원 ID가 곧 모델명인데도 `unknown`으로 떨어져, 학습 표본이 쌓이기 전의 게이트웨이 환경에서 위임·비용 집계가 통째로 빠졌습니다. 이제 즉시 기존 티어 분류로 넘깁니다. 불투명한 application-profile ID는 종전대로 오버라이드/학습 경로입니다.

### v3.11.0 (2026-08-21)
- **statusline에 위임 절감 칩 추가** — `🔀 Routing saved $3.2`. 모델 위임으로 아낀 누적 비용이며, 모델 이름 바로 뒤에 놓여 줄 앞쪽에서 읽힙니다. 기존 `💰 Cache saved`(프롬프트 캐시 절감)와는 다른 수치입니다. 값이 0이거나 데이터가 없으면 칩을 아예 그리지 않아 직접 API 사용자에게는 아무것도 늘지 않습니다. statusline은 `model-rules.json`을 읽기만 하며 스캔을 돌리지 않습니다(5초마다 호출되는 자리입니다). 세그먼트 이름은 `delegated`입니다.
- **역할 학습의 오분류 수정** — 서브에이전트 레코드가 부모 트랜스크립트에 `isSidechain` 없이 섞여 들어오는 경우가 있어, 그 정황 증거가 명시 증거를 이겨 haiku 프로파일이 세션 모델로 확정되곤 했습니다(실측 16건 대 1건, 합의율 정확히 80%). 이제 **명시 증거(`Task(model:)` 파라미터·에이전트 정의 frontmatter)와 정황 증거(sidechain 플래그 부재)를 분리해 집계**하고, 명시 증거가 이를 반박하면 정황 추론을 채택하지 않습니다. 확정이 안 되면 `unknown`으로 남아 집계에서 빠집니다.

### v3.10.0 (2026-08-20)
- **게이트웨이(Bedrock·LiteLLM) 환경에서 모델 티어를 다시 인식합니다** — 로그의 모델명이 추론 프로파일 ARN이면 `opus`·`haiku` 단서가 없어 Sonnet으로 폴백했고, `worthDelegating()`이 `rank > target`을 요구하므로 **T1 위임이 전부 기각**됐습니다. 절감 집계는 0, 비용은 약 1.67배 과소 계상이었습니다. 이제 프로파일 ID를 역할로 학습해(부모 `Task` 호출 ↔ 서브에이전트 `toolUseId` 정확 조인) 환경변수가 선언한 별칭으로 되돌립니다. 가격표·랭크·판정 로직은 그대로입니다.
- **확신이 없으면 숨기지 않고 드러냅니다** — 관측 3건 미만이거나 역할 동의율 80% 미만이면 `unknown`으로 두고 위임 집계에서 제외합니다. Sonnet으로 조용히 틀리던 기존 동작이 더 나빴습니다.
- **수동 오버라이드** — `<userDataDir>/profile-map.json`의 `modelAliases`에 와일드카드 패턴으로 직접 지정할 수 있습니다. 프로파일 ID·AWS 계정 ID는 소스에 전혀 넣지 않습니다.
- 게이트웨이를 쓰지 않는 환경은 **동작이 완전히 동일**합니다(파일도 만들지 않습니다).

### v3.9.2 (2026-08-01)
- **LICENSE 파일 추가 (MIT)** — `package.json`에만 있고 파일이 없어서, 사내 도입 검토 시 라이선스 확인이 막히던 문제. npm 패키지에도 포함되도록 `files`에 넣었습니다.
- **패키지 설명·키워드를 현재 기능에 맞게 교체** — 캐시 모니터링 시절 문구가 남아 있어 모델 위임(`model-routing`·`delegation`·`subagent`)으로 검색되지 않았습니다.
- **README 상단에 60초 진입로** — 라우터가 아니라 사후 분석이라는 점과, 설치부터 내 숫자 확인까지의 명령 3줄.
- **`route-scan` 최초 1회 안내** — 기능 설명 영상 링크를 딱 한 번만 출력합니다. `CTS_NO_NOTE=1`로 끕니다.

### v3.9.1 (2026-08-01)
- **compact-window 권장값이 단일 40만에서 40만~70만 범위로** — 40만은 실사용에서 너무 빡빡해 압축이 잦았습니다. 이제 범위를 제안하고, **그 안(또는 그보다 낮게) 잡아둔 세션은 경고하지 않습니다.** 미설정이거나 70만 초과일 때만 `🅷⚠ compact-window?`와 브리핑이 뜹니다. `set`의 기본값도 범위 중간인 50만으로 올렸고, 원하는 값은 `--value 600k`로 지정합니다.

### v3.9.0 (2026-08-01)

manifest.build의 "다들 LLM 라우터 만드는데 우리는 폐기했다"(7천 사용자·4개월 실사용 회고)와 이 도구의 설계를 대조해, 그쪽 실패 요인 중 아직 안 막혀 있던 것 4개를 메웠습니다. 자세한 대조는 [TIER_CRITERIA.md §3.9](./docs/TIER_CRITERIA.md).

- **rule-health가 이제 실제 위임 결과를 봅니다** — 기존 에러율의 분모는 "비싼 모델이 직접 처리했는데 형태상 위임 가능해 보이던 에피소드"였습니다. 즉 룰이 **실제로 발동했을 때 잘 됐는지는 한 번도 재지 않았고**, 매번 실패하는 룰이 있어도 신호가 안 움직였습니다. Claude Code가 서브에이전트 실행을 `<세션>/subagents/`에 따로 남기고 그 메타의 `toolUseId`가 부모의 Task 호출과 정확히 맞물리므로, 이제 실제 위임의 성패를 직접 셉니다. 실측 5건 이상 쌓인 룰은 추정 대신 실측으로 판정하고, 경고에도 어느 쪽 근거인지 표시합니다. (저자 로그 14일: 106세션 중 4세션·18런, 조인 성공률 100%)
- **룰별 절감액 표시** — 위임 실행의 토큰을 세션 모델 단가로 되돌린 차액을 14일 창으로 계산해 `route-scan rules`와 `ratchet-model.md`에 `~$` 표기로 붙입니다. 값어치 없는 룰이 눈에 보여야 정리할 수 있습니다. 위임 기록이 없는 룰은 `$0`이 아니라 `—` — 둘은 정반대를 뜻합니다.
- **세션 모델 기준 상대 티어** — 기존 게이트가 "haiku인가?" 하나뿐이라, Sonnet 세션에서도 "sonnet한테 위임하라"는 T1 룰이 만들어졌습니다. 컨텍스트만 새로 쌓고 단가 차이는 0인 순손해입니다. 이제 목표 티어가 실제로 더 싼 경우에만 후보를 만듭니다 (haiku 0 · sonnet 1 · opus 2 · fable 3).
- **위임 예산 문구(probe-then-commit)** — 룰은 통계로 만들어지지만 **발동은 요청 텍스트만 보고** 일어나고, 난이도는 대개 첫 도구 호출 뒤에야 드러납니다. 이 불일치는 못 없애니 오판 비용에 상한을 겁니다: 각 룰에 캘리브레이션된 상한(T2는 호출 8회·출력 p25, T1은 출력 p75)이 붙고, 넘길 것 같거나 에러가 나면 서브에이전트가 멈춰 진행분만 보고하고 메인 모델이 이어받습니다. 문구는 저장된 룰에 굽지 않고 렌더 시점에 조립하므로 **예전에 등록한 룰도 자동으로 적용**받고, promote 프리뷰와 실제 파일이 어긋날 수 없습니다.

### v3.8.2 (2026-08-01)
- **압축 뒤에도 경고 티어가 안 내려가던 문제 수정** — 컨텍스트 티어를 최고치로만 기억해서, 80%에서 자동 압축이 돌아 컨텍스트가 다시 비어도 티어가 1로 남았습니다. 그 세션은 창을 다시 꽉 채워도 아무 신호를 못 받았습니다. 이제 측정치가 내려가면 티어도 같이 내려가고, 다시 차오르면 정상적으로 경고합니다.
- **두 가지 창 표기 혼선 정리** — `autoCompactWindow`를 40만으로 잡으면 브리핑은 40만 기준(80%)인데 Claude Code 화면은 1M 기준(33%)이라, 같은 세션의 두 숫자가 서로 안 맞아 보였습니다. 이제 `자동 압축 창(400k)의 80%(… 화면의 1M 창 기준으로는 33%)`처럼 둘 다 적습니다.
- **압축 창이 설정돼 있으면 "새 세션 시작" 권고를 하지 않습니다** — 그 지점은 압축이 자동으로 처리하는 지점이라, 대신 결정·다음 할 일을 파일에 남기라고 안내합니다.

### v3.8.1 (2026-07-31)
- **1M 세션을 200k 창으로 오판하던 브리핑 버그 수정** — 세션 창을 "지금까지 본 가장 큰 요청"으로 추정해서, 1M 세션이라도 25만 토큰을 넘기 전까지는 200k로 취급했습니다. 그래서 입력 160k에서 "200k 창의 80%를 넘었습니다" 경고가 떴습니다(실제로는 16%). 이제 설정된 모델 ID로 창을 판정하고, `autoCompactWindow`가 잡혀 있으면 그 값이 실제로 세션이 넘어가는 지점이므로 그쪽을 기준으로 %를 계산합니다(문구에도 `(autoCompactWindow 기준)` 표기). 모델 ID를 못 읽는 경우에만 기존 관측치 추정으로 되돌아갑니다.

### v3.8.0 (2026-07-31)
- **`compact-window` 추가 — 1M 컨텍스트에서 자동 압축 지점이 방치되던 문제** — Claude Code는 `min(autoCompactWindow, 모델 최대 창)` 근처에서 압축합니다. 1M 창을 쓰면 이 값을 안 잡는 한 80만 토큰까지 커진 뒤에야 압축이 걸리고, 그전까지 모든 요청이 전체 컨텍스트를 재과금합니다. 이제 1M 모델인데 미설정이거나 40만 초과면 statusline `🅷⚠ compact-window?` + 세션 브리핑으로 알리고, `compact-window set --global|--project`로 40만을 고정합니다. 200k 컨텍스트는 설정이 영향을 주지 않으므로 경고 대상에서 제외합니다.

### v3.7.0 (2026-07-29)
- **위임 룰이 없는 서브에이전트를 가리키던 문제 수정** — 생성되는 T2 룰이 `haiku-explore`·`haiku-runner` 같은 이름을 직접 적었는데, 이 preset 에이전트들은 각자의 `~/.claude/agents/`에 있는 것이라 패키지가 배포하지 않습니다. 그래서 해당 파일이 없는 환경에서는 "존재하지 않는 에이전트로 위임하라"는 룰이 자동 생성됐습니다. 이제 기본 표현은 `model: haiku`(T1의 `model: sonnet`과 통일)이고, 에이전트 파일이 실제로 있을 때만 `haiku-explore(model: haiku)`처럼 이름을 병기합니다. 프로젝트 `.claude/agents/`도 인식합니다. 다음 `route-scan` 때 `ratchet-model.md`가 새 표현으로 다시 렌더됩니다.

### v3.6.4 (2026-07-29)
- **`🅷⚠ ratchet-unloaded`가 잘못 뜨던 버그 수정** — import 여부를 CLAUDE.md 한 파일에서만 확인했습니다. 프로젝트 `CLAUDE.md`에 harness 블록이 있으면 그 파일만 보고 판정했기 때문에, `@` import가 글로벌 `~/.claude/CLAUDE.md`에 있는 흔한 조합에서는 룰이 정상 로드되는데도 경고가 떴습니다. Claude Code는 두 파일을 모두 로드하므로 이제 양쪽의 import를 합쳐서 판정하고, 어느 쪽이 들고 있는지는 `importSource`(`project`/`global`/`both`)로 알려줍니다. 두 파일 다 import가 없을 때만 경고합니다.

### v3.6.3 (2026-07-27)
- **승인한 ratchet 룰이 세션에 전달되지 않던 버그 수정** — `harness promote`는 룰을 `ratchet.md`에 append했지만, 그 파일을 읽는 소비자가 어디에도 없었습니다. Claude Code는 `CLAUDE.md`(와 그것이 import하는 파일)만 로드하는데 harness 블록에 import 라인이 없었기 때문에, "승인된 룰은 다음 세션부터 자동 적용"은 사실상 미구현 상태였습니다. 이제 harness 블록이 `@.claude/ratchet.md`(project) / `@~/.claude/ratchet.md`(global)를 import합니다. `harness init`을 다시 돌리면 기존 블록도 제자리에서 갱신됩니다.
- **`ratchet-model.md`도 명시적으로 import** — 모델 피팅 룰도 호스트가 알아서 읽어주길 기대하지 않고 같은 경로로 전달합니다. import가 끊기지 않도록 `harness init`이 빈 파일을 미리 만들고, 마지막 룰이 사라져도 `syncAllFiles`가 파일을 지우는 대신 비웁니다.
- **`🅷⚠ ratchet-unloaded` 경고 추가** — 5개 섹션이 다 있어도 import 라인이 없으면 룰이 죽어 있는 상태라, `N/5`와 별개로 표시합니다. `harness check`도 같은 내용을 수정 명령과 함께 안내합니다.
- **`harness prune` 추가 + ratchet 크기 표시** — import된 ratchet은 매 요청마다 토큰을 씁니다. `harness check`가 룰 수와 요청당 토큰을 보여주고 ~2,000 토큰을 넘으면 경고합니다. 정리는 `harness prune [--tag <t>] [--older-than <months>] [--dry-run]` — 삭제가 아니라 `ratchet-archive.md`로 이동합니다. 룰 앞에 `[태그]`를 붙여두면(`- 2026-05-08: [video] ...`) 묶어서 정리할 수 있습니다. (`@` import는 정적이라 로드 시점 필터링은 불가능합니다 — 줄일 방법은 룰 자체를 줄이는 것뿐)

### v3.6.2 (2026-07-26)
- 문서 전용 릴리스 — 아래 v3.4.0~v3.5.3 릴리스 노트가 누락돼 있던 것을 복원했고, npm 패키지 페이지는 발행된 버전의 README를 보여주므로 이를 반영하기 위해 올립니다. 코드 변경 없음.

### v3.6.1 (2026-07-26)
- **macOS·Windows에서 상태 파일이 갈라지던 버그 수정** — `route-scan.json` / `model-rules.json` / `brief-state.json`이 각자 복제된 경로 해석 함수를 갖고 있었고, 그 복사본들은 `XDG_CONFIG_HOME`을 리눅스에서만 인정했습니다. 그래서 macOS·Windows에서 XDG를 설정하면 `config.json`·세션 캐시만 옮겨가고 위 세 파일은 플랫폼 기본 경로에 남아, 위임 후보 브리핑과 룰이 조용히 사라졌습니다. 이제 전부 `paths.js` 한 곳에서 해석합니다. (v3.6.0에서 도입한 3-OS CI가 잡아낸 버그 — 복제본이 다시 생기지 않도록 회귀 테스트 추가)
- `npm test` 스크립트가 Node 22에서 실패하던 문제 수정 (`node --test test/`의 디렉터리 인자를 Node 22가 모듈 경로로 해석).

### v3.6.0 (2026-07-26)
- **statusline 재실행 비용 제거** — 세션 파싱 결과를 `(경로, mtime, size)` 키로 캐싱. 트랜스크립트는 append-only라 이 조합이 파싱 결과의 정확한 신원이 됨. 217MB/226파일 30일 창 기준 매 갱신마다 3초씩 재파싱하던 것이 변경된 파일(사실상 현재 세션 1개)만 읽는 것으로 축소. 캐시가 깨져도 항상 전체 파싱으로 폴백하므로 실패 경로 없음.
- **ratchet-model.md 영문 렌더링** — 이 파일은 LLM이 지시문으로 읽기 때문에, 한글 전용 파일은 영어 세션의 응답까지 한글로 끌어당김. `language` 설정에 따라 헤더·룰 원문·rule-health 경고를 영문으로 렌더. 카테고리 라벨과 룰 원문은 스캔 시점에 양쪽 언어로 저장돼, 언어를 바꿔도 재스캔 없이 즉시 반영.
- **테스트·CI 도입** — `npm test`(node:test) 22개 + GitHub Actions에서 ubuntu/macOS/Windows × Node 18/22 매트릭스. 사용자 레벨 경로 처리(XDG/APPDATA/Application Support)가 단일 OS 실행으로는 잡히지 않는 부분이라 3-OS로 돌림.
- **bin/cli.js 분할** — 1,000줄 단일 파일이던 CLI를 `src/commands/*`(install, harness, route-scan, brief, handoff, history, last, mode)와 인자 파싱·stdin 페이로드 헬퍼로 분리. 동작 변경 없음.

### v3.5.3 (2026-07-22)
- **rule-health: 자가수정·하네스 가드 에러 제외** — 편집 순서 가드나 자가수정 계열(`File not read yet`, `String to replace not found`, `modified since read`, `Blocked:`, Task 라이프사이클)은 모델이 스스로 회복하는 흐름의 일부지 작업 난이도 신호가 아님. v3.4.2의 권한 노이즈 정화 연장선. 모호한 `Exit code N`·`File does not exist`는 난이도 신호로 유지.

### v3.5.2 (2026-07-21)
- **세션 시작 브리핑을 능동 전달** — SessionStart 훅 지시문이 조건부("전달할 때는")라 모델이 배경 정보로 흘려보낼 수 있었음. 사용자의 첫 메시지가 단순 인사여도 첫 응답 말미에 `※ [claude-token-saver]` 라벨로 요약 브리핑하도록 명시.
- **brief 시딩 레이스 수정** — brief 훅이 첫 실행에서 route/rule-health 이벤트를 무조건 삼키던 것을, SessionStart가 **실제로 브리핑한 시그니처만** 삼키도록 변경(`seedSessionBriefed()`). 백그라운드 재스캔이 세션 시작 직후 끝나 새 후보가 생긴 경우, 이전에는 세션 내내 전달되지 않았지만 이제 다음 프롬프트에 브리핑됨.

### v3.5.1 (2026-07-14)
- **훅 설치 시 스키마 위반 값은 덮어쓰지 않음** — `hooks.SessionStart` / `hooks.UserPromptSubmit`가 배열이 아닌 값으로 존재하면 빈 배열로 대체하던 것을, 사용자 데이터 보호 차원에서 skip + 사유 반환으로 변경. 정상 배열 병합(append·idempotent)은 회귀 없음.

### v3.5.0 (2026-07-14)
- **세션별 상태 변화 브리핑 훅 (UserPromptSubmit)** — 모델은 statusline 칩을 볼 수 없어, 세션 중 상태 변화(컨텍스트 임계 돌파, 신규 route 후보, rule-health 플립)가 사용자가 묻기 전까지 설명되지 않던 공백을 메움. 프롬프트 제출마다 실행되되 **변화가 없으면 완전 침묵**(컨텍스트 비용 0).
  - 컨텍스트 판별·브리핑 마커 모두 session_id 단위 — 창 크기 자동 감지(200k/1M), 80%/95% 티어를 각각 1회씩만 경고.
  - route/rule-health는 세션 첫 이벤트에 시드해 SessionStart 브리핑과 중복 방지, 세션 중간에 새로 생긴 것만 주입.
  - installer가 UserPromptSubmit 훅을 idempotent하게 등록, 7일 미사용 세션 상태는 자동 정리.

### v3.4.3 (2026-07-14)
- **write 우세 에피소드는 위임 후보에서 제외** — 편집 작업(Edit/Write 우세)이 범용 키워드("설명…")를 타고 read/explore로 새어 들어가던 오분류 수정. 실측에서 `Edit×5` 문서 편집이 read/T1로 잡혀 에러율 67% 노이즈를 만들었음. write 우세면 translate 키워드가 있을 때만 translate, 아니면 분류 없음(= 위임 후보 아님).

### v3.4.2 (2026-07-14)
- **rule-health 분자 정화 — 권한 계열 에러 제외** — 사용자 도구 거부·auto mode classifier 거부·permission denied류는 사용자 의사와 권한 정책의 산물이지 작업 난이도 신호가 아님. 14일 전수 감사에서 `is_error` 142건 중 약 25%가 이 계열이었고, 글로벌 run/T1 룰에 24% ⚠ 플래그를 띄운 주범이었음(제외 후 18%로 해제, 실제 run/T1 에러율 23% → 8%).

### v3.4.1 (2026-07-14)
- **rule-health 최소 표본 가드(`HEALTH_MIN_SAMPLE=10`)** — 표본 4건 중 에러 1건(25%)만으로 review 플래그가 뜨던 문제. 윈도 내 대상 에피소드가 10건 미만이면 에러율은 노이즈이므로 플래그를 유보.

### v3.4.0 (2026-07-14)
- **행동 우선(behavior-first) 분류** — `categorize()`를 first-match 정규식에서 3단 판정으로 재작성: paste 게이트 → 도구 사용 히스토그램(`behaviorPool`)으로 후보군 축소 → 가중 키워드 스코어링. **에피소드가 실제로 실행한 도구 구성이 프롬프트 표현보다 우선**한다("테스트 통과했는지 확인해줘"가 실제로 `npx playwright test`를 돌렸다면 표현과 무관하게 run 에피소드).
- ESCALATE_RE에 비가역·외부 작업 키워드 추가(제출/배포/deploy/release/merge 등) — 로그상 가벼운 run 에피소드로 보여도 위임하면 하네스의 default-safe-path 원칙이 무너짐.
- rule-health 통계 키를 `tier|category|project`로 확장 — 같은 카테고리의 T2/T1 룰이 통계를 공유하며 생기던 이중 계상 제거.
- ratchet-model.md 렌더: 같은 카테고리의 T2+T1 룰을 **요청 시점 판별 조건이 담긴 하나의 병합 룰**로 출력(기본 haiku → 다단계는 sonnet → 비가역은 메인 모델).

### v3.3.1 (2026-07-13)
- **코드 대신 풀어쓴 설명** — `R1`, `T2` 같은 코드가 설명 없이 노출돼 처음 쓰는 사람이 알 수 없던 문제 수정. 모든 사용자 대면 출력(SessionStart 훅 브리핑, `route-scan` 후보 목록, `route-scan rules` 목록)에서 티어를 `T2 (단순 작업 — haiku급이면 충분)` 식으로 풀어쓰고, scope도 `이 프로젝트만`/`모든 프로젝트(글로벌)`로 표기. 훅 브리핑에는 "사용자에게 전달할 때 코드가 아니라 풀어쓴 설명으로 브리핑하라"는 지시 포함. (statusline 칩은 폭 제약상 `route? R1` 유지 — 의미는 세션 브리핑이 설명)

### v3.3.0 (2026-07-13)
- **위임 가시화·브리핑 강화** — 모델 피팅의 전 과정이 사용자에게 보이도록:
  - SessionStart 훅이 후보마다 **등록 시 ratchet-model.md에 기록될 룰 원문**을 함께 주입 — 무엇이 등록될지 정확히 보고 승인.
  - 에러율 기준(20%) 초과로 review 상태가 된 룰은 **statusline `🅷⚠ rule-health R<N>` 칩** + 세션 시작 브리핑 양쪽으로 통지 (설계 문서에 있던 미구현 항목 구현. 우선순위: 세션 품질 경고 > rule-health > route? 후보).
  - ratchet-model.md 헤더에 위임 실행 시 `🔀 [claude-token-saver] 모델 피팅: "<유형>" → <agent> 위임` 한 줄을 먼저 표시하라는 지시 추가 — 어떤 도구가 토큰을 아끼는지 가시화.
- README에 3.x 정체성 반영 (상단 요약에 모델 피팅 위임 추가, route-scan 섹션에 리서치 근거 접이식), model-rules.js 주석-구현 불일치 수정.

### v3.2.2 (2026-07-13)
- **등록 룰 재제안 차단** — 이미 모델 피팅 룰이 있는 (티어|카테고리|프로젝트) 조합은 스캔 후보에서 자동 제외 (글로벌 룰은 전 프로젝트 커버). promote를 거치지 않고 등록된 룰(마이그레이션 등)이 후보로 되살아나던 문제 수정.

### v3.2.1 (2026-07-13)
- **최초 설치 시 즉시 패턴 분석** — `install`(npm postinstall 포함)이 캐시가 없으면 기존 세션 로그를 그 자리에서 분석해, 첫 Claude Code 세션부터 티어 위임 후보가 표시됩니다 (기존에는 두 번째 세션부터).

### v3.2.0 (2026-07-13)
- **티어 분류 (T0/T1/T2)** — route-scan이 이분법(easy/그외)에서 3티어로 진화. 신호에 변경성 도구 수·도구 에러 수 추가, 출력 임계값은 사용자 분포 기반 자동 보정(클램프 포함), 붙여넣은 화면·로그 질문 전용 카테고리 신설, 대화성 응답(출력 <100토큰) 제외. 기준 설계·리서치 근거는 `docs/TIER_CRITERIA.md`.
- **모델 피팅 랫쳇 분리** — 승격된 위임 룰은 별도 파일(`.claude/ratchet-model.md` / `~/.claude/ratchet-model.md`)에 저장돼 사용자 룰과 파일 단위로 분리. `route-scan rules [rm <N>]`로 관리하며, 하네스 CLAUDE.md 블록이 두 파일을 함께 참조.
- **로그 기반 자동 갱신 + rule-health** — 매 스캔마다 등록 룰의 반복 횟수·에러율(위임 적격 모양의 에피소드 기준)을 재계산해 파일을 재작성. 에러율 >20%면 `⚠ rule-health` 플래그로 조건 좁히기/제거를 제안.
- **데이터 트리거 재스캔** — 고정 24h TTL을 폐기하고 신규 transcript 양이 재스캔을 트리거 (~5MB 즉시 / 소량 일 1회 / 무변화 스킵 / 최소 간격 1h / promote 직후 즉시 1회).

### v3.1.0 (2026-07-13)
- **frugon 연계 제거** — `claude-token-saver frugon` 서브커맨드(JSONL 내보내기)를 삭제했습니다. 외부 분석기의 집계 리포트는 랫쳇 룰(조건→행동)로 변환할 수 없어 위임 파이프라인에 기여하지 못했고, 3.x의 방향은 **세션 로그 기반 티어 분류를 자체적으로 탄탄히** 가져가는 것입니다. route-scan은 영향 없이 그대로 동작합니다 (공용 파서는 `src/session-records.js`로 분리).

### v3.0.1 (2026-07-13)
- **`harness pull` 재정의** — v3.0.0의 "글로벌 랫쳇 → 프로젝트 복사"는 글로벌 랫쳇이 이미 프로젝트의 상위 계층으로 항상 적용되므로 무의미해 제거. `pull`은 이제 패키지에 동봉된 **제작자 큐레이션 랫쳇 룰**(`presets/ratchet-rules.md`)을 사용자의 글로벌 랫쳇에 등록합니다 — 실제 반복 사고에서 승격된 범용 룰 6종, opt-in·멱등.

### v3.0.0 (2026-07-13)
- **메이저 승격** — v2.19 frugon 연계 + v2.20 route-scan으로 "사후 토큰 모니터링 도구"에서 "반복 easy 작업을 싼 모델로 내려보내는 라우팅 계층"으로 제품 성격이 바뀌어 메이저 버전을 올립니다. Breaking change는 없습니다 (기존 명령·설정 전부 호환).
- **route-scan promote 교정** — `harness promote R<N> --project`가 이제 후보가 **감지된 프로젝트**의 `.claude/ratchet.md`에 룰을 기록합니다 (이전에는 CLI를 실행한 디렉터리에 기록되는 버그). 스캔이 후보에 실제 세션 경로(`projectPath`)를 저장하며, 이 필드가 없는 구버전 캐시에서 다른 프로젝트 후보를 승격하려 하면 `route-scan --refresh`를 안내하고 중단합니다.
- **`harness pull` 신설** — v3.0.1에서 재정의됨 (위 참고).

### v2.20.0 (2026-07-13)
- **route-scan**: 상위 모델이 반복 처리한 easy 작업 감지 → `🅷⚠ route? R<N>` 칩 + SessionStart 훅 컨텍스트 주입 + `harness promote R<N> --project|--global`로 haiku 위임 랫쳇 룰 승격.

### v2.19.0 (2026-07-12)
- **frugon 연계**: `claude-token-saver frugon` — 세션 transcript를 [frugon](https://github.com/Rodiun/frugon) 호환 JSONL로 내보내 모델 라우팅 절감 분석 (`--run`으로 즉시 분석, 캐시 가중 토큰 기본).

### v2.18.0 (2026-07-02)
- **1M 컨텍스트 경고 의미 재정의** — 현재 모델(Fable 5, Opus 4.6~4.8, Sonnet 5)은 전부 1M 윈도가 기본이고 Opus 4.7부터 장기 컨텍스트 프리미엄도 없어, "1M 모드 ON = 비쌈" 프레임을 폐기했습니다. 경고는 이제 **실사용 신호**입니다: `⚠ 1M ON` → `⚠ Ctx 200k+`(단일 요청이 실제로 200k 초과), 처방도 "1M 끄기" 우선에서 "`/compact`/`/clear` + `/effort` 점검" 우선으로 재정렬. 잘못된 "200k 초과 시 장기 요금 적용" 문구 정정.
- **📦 세그먼트가 실시간 사용률 표시** — Claude Code stdin의 `context_window.used_percentage`를 사용해 `📦 Ctx 68% of 1M` 형태로 렌더 (사용률 기준 녹 <70 / 황 70–89 / 적 90+). stdin이 없으면 기존 크기 추론으로 폴백하되 1M은 빨강 대신 노랑.
- 구버전 히스토리 호환: `⚠ 1M ON` 칩·구 디테일 문구도 계속 해석됩니다.

### v2.17.0 (2026-07-02)
- **Fable 5 가격 티어 추가** — `claude-fable-5`/`claude-mythos-5`가 Sonnet 단가($3/$15)로 폴백돼 비용이 ~3배 과소 추정되던 문제 수정. 실제 단가(입력 $10 / 출력 $50 / 캐시쓰기 5m $12.50·1h $20 / 캐시읽기 $1) 적용.
- README 전면 개편 — 최상위 임팩트 요약, 세그먼트 표, harness scope 플래그 문서화, 가격 테이블 최신화.

### v2.16.0 (2026-07-02)
- **statusline 버그 수정** — 두 윈도 동시 90%+ 시 하나가 사라지던 문제(cap-warn 승격분만 숨김), `--no-color` 출력의 ANSI escape 제거, 세션 데이터 없어도 cap-warn·🅷·모델 칩 유지.
- **harness 경고 정확도** — 🅷⚠ 경고 30분 자동 만료(무기한 잔류 수정), 하위 디렉터리 세션 매칭, cwd 없는 상태의 전 프로젝트 누출 수정.
- **PEV-skip 오탐 감소** — 변경성 도구만 카운트(Read/Grep 제외), 윈도를 어시스턴트 턴 기준으로.

<details>
<summary>이전 버전 (v2.8.5 ~ v2.15.0)</summary>

### v2.15.0 (2026-06-13)
- **글로벌 harness init** — `harness init --global`이 `~/.claude/CLAUDE.md`(+ `~/.claude/ratchet.md`)에 5개 섹션을 설치해 모든 프로젝트에 적용. `harness check`는 글로벌을 fallback으로 인정(`🅷 5/5 (covered by global)`).
- npm homepage 변경, @DeepPulseEN 채널·홈페이지 배지 추가.

### v2.13.x (2026-05-04)
- "실제 효과" 섹션을 harness+ratchet 도입 전후 리포트로 재구성, statusline 스크린샷·임팩트 차트 추가, npm 메타데이터 정비, YouTube 핸들 정정.

### v2.11.0 (2026-05-02)
- `harness list` / `harness rm <N>` 추가 (자동 `.bak` 백업, 삭제 전 "조건 좁히기 우선" 안내).

### v2.9.x (2026-04-27)
- 출력 언어 전환(`mode ko`/`en`) 추가 — `last`/`history`/처방이 한 언어로 출력. Skill이 사용자 언어로 응답하도록 지시 추가. README에 Node.js 사전 설치 안내·Skill 워크플로 4단계 추가. `language` 설정 위치 정리.

### v2.8.6 (2026-04-27)
- **Skill 자동 등록** — postinstall 훅이 Skill과 statusline을 `~/.claude`에 자동 등록.

### v2.8.5
- IntelliJ plugin 프레임 합성 버그 회피 — JediTerm 감지 시 자동 text 모드.

더 이전 버전은 `git log` 참고.
</details>

## 라이선스

MIT
