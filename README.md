**한국어** · [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/claude-token-saver.svg)](https://www.npmjs.com/package/claude-token-saver)

# claude-token-saver

## 🔀 Routing saved: 이 도구가 존재하는 이유

![statusline 예시. 첫째 줄은 라우팅 절감액이고 둘째 줄은 진단 칩입니다](./docs/statusline.png)

**statusline 첫째 줄에 표시되는 이 금액이 이 도구의 전부입니다.** 비싼 모델이 반복해서 처리해 온 쉬운 작업을 더 싼 모델에 넘겨서 **실제로 절감한 비용**이며, 그 옆에는 어느 모델에서 어느 모델로 작업이 옮겨 가면서 그 금액이 발생했는지가 함께 표시됩니다.

이 숫자는 추정치나 홍보 문구가 아니라 **원장(ledger)에 기록된 실측값입니다.** 위임된 서브에이전트 실행 하나하나마다 다음 세 가지를 기록합니다.

- **기준 모델(before):** 룰을 승격하기 전에 그 유형을 실제로 처리하던 모델입니다.
- **실행 모델(after):** 그 작업을 실제로 처리한 모델입니다.
- **차액:** 동일한 토큰량에 두 모델의 가격표를 각각 적용해 계산한 값입니다.

그래서 `route-scan savings` 명령 한 번이면 **모든 금액을 어떤 룰이 만들어 냈는지까지 거슬러 확인할 수 있습니다.**

```bash
$ claude-token-saver route-scan savings

🔀 라우팅 절감 누적 $2.09  (최근 7일 $1.40 · 30일 $2.09)

모델 이동별:
  claude-fable-5 → claude-sonnet-5           —  1회, $0.72
  claude-opus-5 → claude-haiku-4-5           —  1회, $0.57

실행별 (최근순):
  2026-08-22    $0.51  claude-fable-5 → claude-haiku-4-5
            룰: T2|paste|-Users-me-projects-my-app
```

**정직하게 집계하는 것이 이 도구의 설계 원칙입니다.** 등록된 룰이 담당하지 않는 위임(`Explore`, 사용자가 직접 만든 에이전트, 플러그인이 제공하는 에이전트)은 이 도구가 라우팅한 결과가 아니므로 **금액에서 제외합니다.** 가격표가 모델명을 인식하지 못하는 경우에도 틀린 금액을 표시하는 대신 **그 실행을 집계에서 제외합니다.** 그래서 금액이 작게 나올 수는 있어도, 표시되는 값은 언제나 실제로 절감한 금액입니다.

```bash
npm i -g claude-token-saver   # postinstall이 statusline + Skill 자동 등록
```

---

## ⚡ 왜 쓰는가: 30초 요약

| | |
|---|---|
| 🔀 **라우팅 절감액 실측** | 위임으로 절감한 금액을 실행 단위로 원장에 기록하고, statusline 첫째 줄에 누적액과 모델 이동 내역을 함께 표시합니다 (`route-scan savings`로 전수 확인) |
| 🎯 **모델 피팅 위임** | 상위 모델(opus·fable)이 반복 처리해 온 쉬운 작업을 티어(T0/T1/T2)로 분류한 뒤 haiku·sonnet 위임 룰로 승격하고, 다음 세션부터 자동으로 적용합니다 |
| 💸 **비용 실측 −18.6%** | harness와 ratchet을 도입하기 전후로 사용자 메시지당 비용이 $2.35에서 $1.91로 줄었습니다 (저자의 실사용 로그, [상세](#실제-효과-도입-전후-리포트)) |
| 🚨 **한도 초과 예방** | 5시간·7일 rate-limit 윈도가 90%에 도달하면 즉시 경고하고, `handoff`로 진행 중인 작업을 백업합니다 |
| 🧠 **캐시 낭비 감지** | 히트율과 TTL 카운트다운, 1M 컨텍스트 사용 여부를 자동으로 감지해 토큰이 급증한 원인을 코드로 진단합니다 |
| 🅷 **같은 실수 차단** | 반복되는 에러를 감지해 ratchet 룰로 승격하고, 다음 세션부터 자동으로 적용합니다 |

## 라우터가 아닙니다: 60초 설명

이 도구는 요청을 실시간으로 가로채지 않습니다.
**세션이 끝난 뒤에** 로컬 기록을 읽어서 비싼 모델이 반복해서 처리해 온 쉬운 유형을 찾아내고,
그 유형은 **다음 세션부터** 더 싼 모델이 맡도록 룰로 등록합니다. 룰의 적용 범위는 글로벌과 프로젝트로 나뉩니다.

### 실시간 모델 라우팅이 오히려 비용을 키우는 이유

세션 도중에 모델을 바꾸지 않는다는 점이 이 도구의 핵심입니다.

프롬프트 캐시는 **모델별로 따로 유지됩니다.** 그래서 세션 중간에 더 싼 모델로 전환하면 새 모델은 빈 캐시에서 시작하고, 그때까지 쌓인 대화 전체를 정가로 다시 읽어야 합니다. 캐시 히트는 원래 입력가의 10분의 1 수준이므로, 대화가 2만 토큰만 넘어가도 **전환 한 번에 그날 아낀 금액이 통째로 사라집니다.** 싼 모델로 옮겼는데 청구서는 더 커지는, 실시간 라우팅의 대표적인 역설입니다.

실제로 라우팅 제품을 만들던 팀들이 같은 이유로 기능을 껐습니다: [LLM 라우터를 만든 사람들이 직접 껐습니다 #Shorts](https://www.youtube.com/shorts/SK-GoAABjbg)

이 도구는 그래서 메인 세션의 모델을 건드리지 않습니다. **서브에이전트 위임만 사용하므로** 메인 세션의 캐시는 그대로 유지되고, 위임된 작업만 별도 컨텍스트에서 싼 모델이 처리합니다. 절감액이 캐시 손실로 상쇄되지 않는 이유가 여기에 있습니다.

```bash
npm i -g claude-token-saver@latest
claude-token-saver route-scan         # 지난 세션에서 위임 후보 추출 (LLM 호출 없음)
claude-token-saver route-scan rules   # 승격된 룰 확인 · rm <N> 으로 삭제
claude-token-saver route-scan savings # 위임으로 절감한 금액의 근거를 전수 확인
```

판정 기준선은 다른 사람의 벤치마크가 아니라 **사용자 본인의 최근 14일 분포(p25/p75)** 로 잡습니다.
위임한 뒤에 실제로 성공했는지까지 측정하는 rule-health는 [v3.9.0](#v390-2026-08-01)에 들어갔습니다.

---

## 시작하기

**사전 준비:** Node.js ≥ 18 (`node -v`로 확인 · macOS `brew install node` · Windows `winget install OpenJS.NodeJS.LTS` · Linux/WSL은 [nvm](https://github.com/nvm-sh/nvm) 권장)

```bash
npm uninstall -g claude-cache-monitor   # (구 패키지 사용자만)
npm i -g claude-token-saver
```

설치하면 Claude Code 화면 하단에 statusline이 곧바로 나타납니다. `--ignore-scripts` 옵션이나 sudo 사용 등으로 자동 등록이 되지 않았다면 `claude-token-saver install`을 실행해 직접 등록하십시오.

설치 한 번으로 **statusline과 Skill, SessionStart 훅, 🅷 Harness(5원칙), 최초 route-scan이** 모두 준비됩니다. Harness는 `~/.claude/CLAUDE.md`에 표시가 붙은 블록으로 **추가되며**, 기존에 작성해 둔 내용은 백업한 뒤 그대로 보존합니다. 이미 설정되어 있는 경우에는 아무것도 바꾸지 않습니다. 자동 설정을 원하지 않으면 `CTS_NO_HARNESS=1 npm i -g claude-token-saver`로 건너뛸 수 있고, 이미 적용한 설정을 되돌리려면 `claude-token-saver harness uninit --global`을 실행하십시오.

> ⚠️ sudo로 글로벌 설치를 하면 Skill이 사용자 계정이 아니라 root의 `~/.claude`에 등록되는 함정이 있습니다. nvm이나 fnm, Volta를 사용해 사용자 영역에 설치하기를 권장합니다.

## statusline 읽는 법

절감 원장에 기록이 쌓이면 statusline이 **두 줄로** 출력됩니다. 첫째 줄에는 라우팅 절감액만 표시하고, 둘째 줄에는 진단 칩을 표시합니다.

```
🔀 Routing saved $2.09  |  fable→sonnet 1× $0.72 · opus→haiku 1× $0.57
⚠ Ctx 200k+ · 🅷 5/5 · 🤖 Opus 5 · 🧠 Cache hit 98.8% · ⏳ Cache expires 59:46 · ✦ current ███▓░░ 62% 🔄 21:33 · 📅 weekly ██▒░░░ 38% 🔄 Tue 19:33 · 📦 Ctx 47% of 1M · 💰 Cache saved $1.0K · last 1d
```

원장이 비어 있으면, 다시 말해 아직 실측된 위임이 없으면 첫째 줄을 그리지 않고 종전처럼 한 줄로 출력합니다. 일부 환경(구버전 macOS Claude Code)에서 첫째 줄만 표시된다면 `--single-line` 옵션으로 한 줄 레이아웃을 유지하십시오.

| 세그먼트 | 의미 |
|---|---|
| `🔀` **첫째 줄** | **라우팅으로 절감한 누적 금액과 모델 이동 내역입니다.** 누적 금액은 녹색으로, 내역은 회색으로 표시합니다. 내역을 모두 더하면 누적 금액과 정확히 일치하며(잘라내지 않고 전부 표시합니다), 버전 숫자는 계속 바뀌므로 계열명만 남깁니다(`claude-opus-4-5-…` → `opus`). 근거를 전부 확인하려면 `route-scan savings`를 실행하십시오 |
| `🤖` | 현재 모델 |
| `🅷 5/5` | harness 원칙 점수 ([Harness 모드](#-harness-모드)) |
| `🧠` | 캐시 히트율 (85%+ 녹색) |
| `⏳` | 캐시 TTL 카운트다운입니다. 만료되기 전에 메시지를 보내면 캐시가 유지됩니다 |
| `✦ current` / `📅 weekly` | 5시간 / 7일 rate-limit 윈도 사용률 + 리셋 시각 |
| `📦` | 컨텍스트 사용률입니다(예: `Ctx 68% of 1M`). 사용률에 따라 녹색·노란색·빨간색으로 표시합니다. 최신 모델은 1M 컨텍스트가 기본이고 별도 요금이 붙지 않지만, 토큰량 자체가 턴당 비용과 5시간·7일 한도를 빠르게 소모시킵니다 |
| `💰` | 프롬프트 캐시가 절약해 준 누적 금액입니다. 첫째 줄의 `🔀`(모델 라우팅 절감액)와는 **서로 다른 수치입니다** |

문제가 감지되면 **경고 칩을 줄 맨 앞에** 붙입니다.

```
🚨 5H █████▓ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 4.8 · 🧠 Cache hit 72.1% · ⚠ Cache miss · 📅 weekly ▓░░░░░ 12% 🔄 Sun 14:26 · 📦 Ctx 200k · last 1d
```

칩의 종류는 다음과 같습니다. `🚨 5H/7D NN%`(한도 임박) · `⚠ Ctx 200k+`(단일 요청이 실제로 200k를 초과) · `⚠ Cache miss` · `⚠ Input spike` · `⚠ Output heavy` · `⚠ Call surge` · `⚠ Rebuild churn` · `⚠ 5m TTL`. 두 윈도가 동시에 90%를 넘으면 리셋이 더 임박한 쪽을 🚨로 올리고, 나머지 하나는 빨간 세그먼트로 계속 표시합니다 (v2.16.0 이상).

### 경고 칩이 떴을 때

Claude Code 안에서 `/claude-token-saver` Skill을 실행하거나, 칩에 적힌 문구를 그대로 말하기만 해도("5H cap 떴어", "cache miss") Skill이 자동으로 활성화되어 **원인 코드와 단계별 해결 명령을** 보여 줍니다. 한도가 임박한 상황에서는 `claude-token-saver handoff`로 진행 중인 작업을 마크다운 파일에 백업한 뒤 새 세션에서 이어가는 방식을 권장합니다.

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
| `claude-token-saver route-scan` | 상위 모델이 반복 처리한 쉬운 작업을 감지해 haiku 위임 랫쳇 룰을 제안합니다 (아래 참고) |
| `claude-token-saver route-scan savings` | 라우팅 절감 원장입니다. 모델 이동별 합계와 실행별 내역을 함께 보여 주며, 표시되는 금액의 근거가 됩니다 |
| `claude-token-saver compact-window` | 1M 컨텍스트를 쓰면서 자동 압축 창이 설정되지 않았으면 경고하고, `set`으로 40만에 고정합니다 (아래 참고) |
| `claude-token-saver install` | Skill·statusline 수동 등록 |

출력 언어는 `mode ko`와 `mode en`으로 전환합니다. 기본값은 영어이며, statusline의 칩은 언제나 기호로 표시합니다. 전체 옵션은 [영문 README](./README.en.md#options)를 참고하십시오.

## 🅷 Harness 모드

다섯 원칙(Ratchet · Evidence · PEV · Structured Task · Default Safe Path)을 한 줄 명령으로 `CLAUDE.md`에 셋업하고 statusline이 `🅷 5/5`로 점수화합니다. 같은 에러가 반복되면 `🅷⚠ ratchet?` 알림이 떠서 룰로 승격할 수 있습니다.

```bash
claude-token-saver harness init                # 이 프로젝트에 셋업
claude-token-saver harness init --global       # ~/.claude/CLAUDE.md, 모든 프로젝트에 적용
claude-token-saver harness check               # 현재 점수 (글로벌 fallback 인정)
claude-token-saver harness promote <N> --project|--global   # 경고 #N → ratchet 룰 (스코프 필수)
claude-token-saver harness promote "<룰 텍스트>" --project|--global  # 내가 직접 정의한 룰도 같은 명령으로 등록
claude-token-saver harness pull                # 패키지 동봉 큐레이션 룰 → 내 글로벌 랫쳇에 등록 (opt-in, 중복 스킵)
claude-token-saver harness list / rm <N>       # 룰 조회 / 삭제 (자동 .bak)
claude-token-saver harness off | on            # 🅷 표시 토글
```

- `promote`는 non-TTY 환경(스크립트나 LLM 호출)에서 `--project` 또는 `--global` 플래그가 **반드시 필요합니다.** 적용 범위가 사용자에게 묻지 않은 채 결정되는 사고를 막기 위한 설계입니다.
- `pull`은 패키지에 동봉된 **제작자 큐레이션 랫쳇 룰**(`presets/ratchet-rules.md` — 실제 반복 사고에서 승격된 범용 룰만)을 내 글로벌 랫쳇(`~/.claude/ratchet.md`)에 등록합니다. 설치(`install`)나 `init`은 아무것도 자동 주입하지 않으며, `pull`은 항상 opt-in이고 재실행해도 중복이 없습니다(멱등). 마음에 안 드는 룰은 `harness rm`으로 제거하면 됩니다.
- 🅷⚠ 런타임 경고(`ratchet?` `no-evidence` `PEV-skip`)는 30분 후 자동 만료되고, 하위 디렉터리 세션도 프로젝트에 올바르게 매칭됩니다. PEV-skip은 변경성 도구(Edit/Write/Bash)만 카운트해 읽기 위주 세션에서는 발동하지 않습니다 (v2.16.0+).

<details>
<summary>⚠️ <code>harness rm</code>은 신중하게 사용하십시오: 삭제 전 확인 사항</summary>

ratchet의 가치는 **한 방향 누적**에 있습니다. 룰을 가볍게 지우면 같은 실수가 다시 새기 시작합니다.

- **룰이 너무 광범위해서 정상 케이스도 막나?** → ❌ 삭제 ✅ 조건을 좁혀 다듬기 (예: `"하드코딩 금지"` → `"테스트 외 코드에서 하드코딩 금지"`)
- **룰이 너무 좁아 거의 발동 안 되나?** → ❌ 삭제 ✅ 그냥 두기 (비용 0)
- **정말 잘못된 룰이라 확신?** → ✅ 그때만 삭제

삭제 시 `.bak`이 남지만 **그 룰이 박힌 세션 컨텍스트(왜)는 복원되지 않습니다.**
</details>


## 📦 compact-window: 1M 컨텍스트의 자동 압축 지점 고정

Claude Code는 `min(autoCompactWindow, 모델 최대 창)`에 가까워지면 대화를 자동 압축합니다. 1M 창을 쓰면 이 값이 잡혀 있지 않은 한 80만 토큰 근처까지 가서야 압축이 걸리고, 그전까지 모든 요청이 전체 컨텍스트를 통째로 재과금합니다. **1M은 너무 크니 40만~70만 범위를 권장합니다** — 큰 붙여넣기용 여유는 200k 세션의 2~3.5배로 남기면서 꼬리만 잘라냅니다.

**권장 범위 안이면 경고하지 않습니다.** 40만은 절감이 압축 횟수를 이기는 하한이고, 긴 세션은 그보다 여유가 더 필요한 경우가 많습니다. 미설정이거나 70만을 넘을 때만 알립니다(그보다 낮게 잡은 건 더 공격적으로 아끼겠다는 선택이라 그냥 둡니다).

**200k 컨텍스트는 경고 대상이 아닙니다.** 창이 이미 200k 이하이므로 이 설정으로 달라지는 것이 없기 때문입니다.

```bash
claude-token-saver compact-window                       # 현재 상태 (모델·창·설정값·출처)
claude-token-saver compact-window set --global          # ~/.claude/settings.json 에 50만 고정 (범위 중간)
claude-token-saver compact-window set --project         # <root>/.claude/settings.json 에 고정
claude-token-saver compact-window set --global --value 600k    # 값 직접 지정 (10만~1M)
claude-token-saver compact-window off | on              # 경고 표시 토글
```

- 1M 모델인데 미설정이거나 40만을 넘으면 statusline에 `🅷⚠ compact-window?`가 뜨고, 세션 브리핑이 등록 명령까지 알려줍니다.
- 적용 범위(`--global` 또는 `--project`)는 `set`에서 **반드시 지정해야 합니다.** 글로벌 설정 파일을 사용자에게 묻지 않고 수정하는 일을 막기 위한 설계입니다.
- 기존 `settings.json`의 다른 키는 그대로 보존하고 `.bak`을 남깁니다. JSON이 깨져 있으면 아무것도 쓰지 않고 중단합니다.
- 셸에 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`가 export돼 있으면 그쪽이 settings.json보다 우선합니다 (`set`이 이 경우를 감지해 알려줍니다).

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
claude-token-saver route-scan                    # 스캔 (24h 캐시) + 티어별 후보 출력
claude-token-saver harness promote R1 --project  # 후보 R1을 모델 피팅 룰로 등록
claude-token-saver route-scan dismiss 1          # 관심 없으면 무시 (재스캔에도 안 뜸)
claude-token-saver route-scan rules              # 등록된 모델 피팅 룰 목록 (rm <N>으로 제거)
claude-token-saver route-scan savings            # 절감 원장: 어느 룰이 어떤 모델에서 어떤 모델로 옮겼는지
```

`route-scan savings`는 statusline의 `🔀 Routing saved` 한 줄 뒤에 있는 근거를 그대로 보여줍니다. 모델 이동별 합계와 실행별 내역이 함께 나오므로, 금액이 어디서 나왔는지 추적할 수 있습니다.

```
🔀 라우팅 절감 누적 $2.09  (최근 7일 $1.40 · 30일 $2.09)

모델 이동별:
  claude-fable-5 → claude-sonnet-5  —  1회, $0.72
  claude-opus-5 → claude-haiku-4-5  —  1회, $0.57
```

더 알아보기: **티어 기준·리서치 근거** → [docs/TIER_CRITERIA.md](./docs/TIER_CRITERIA.md) · **룰 파일 구조·스캔 트리거·서브에이전트 준비** → [docs/ROUTE_SCAN.md](./docs/ROUTE_SCAN.md)

### 게이트웨이(Bedrock·LiteLLM) 경유 환경

사내 게이트웨이를 거치면 로그의 모델명 자리에 추론 프로파일 ARN이 기록됩니다. 그 문자열에는 `opus`·`haiku` 같은 단서가 없어서 예전 버전은 이것을 전부 Sonnet으로 읽었고, 그 결과 **T1(→sonnet) 위임 룰이 하나도 제안되지 않았으며 절감 집계가 0**이었습니다.

v3.10.0부터는 프로파일 ID를 역할(main·opus·sonnet·haiku)로 되돌린 뒤 `ANTHROPIC_DEFAULT_*_MODEL` 환경변수가 선언한 별칭으로 치환합니다. 매핑은 부모 세션의 `Task` 호출과 서브에이전트 기록을 `toolUseId`로 조인해 스스로 학습하며, 관측이 3건 미만이거나 역할 판정이 80% 미만으로 갈리면 **추측하지 않고 `unknown`으로 두고 위임 집계에서 제외**합니다.

자동 학습이 닿지 않는 환경을 위한 수동 경로도 있습니다. `<userDataDir>/profile-map.json`에 아래처럼 적으면 되고, 계정 ID와 리전은 `*`로 가려도 매칭됩니다.

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

## 토큰 급증 원인 코드

| 코드 | 의미 |
|---|---|
| `LARGE_INPUT_PER_REQUEST` | 단일 요청의 입력이 200k를 초과했습니다. 턴마다 다시 과금되고 한도 소모가 급격히 늘어납니다 |
| `LOW_HIT_RATE` | 캐시 히트율 50% 미만 |
| `BUCKET_5M_DOMINANT` | 캐시 쓰기의 70%+가 5분 버킷 (Pro 플랜/Max 다운그레이드) |
| `HIGH_OUTPUT_RATIO` | 출력/입력 비율 0.15 초과 (출력 단가는 입력의 5배) |
| `HIGH_REQUEST_COUNT` | 요청 수가 중앙값의 3배+ (도구 호출 루프 의심) |
| `FREQUENT_CACHE_REBUILD` | 캐시 재작성이 읽기보다 많음 |

각 코드마다 OS별 해결 명령이 함께 출력됩니다.

## 실제 효과: 도입 전후 리포트

![claude-token-saver: harness와 ratchet 도입 효과](./docs/harness-impact.png)

harness 5/5 + ratchet을 실제 적용한 전후 비교입니다 (저자 Claude Code 로그, **사용자 메시지 1건당** 정규화, 2026-05-02 기준, Opus 4.7 가격):

| 메트릭 | 도입 전 (7일/739msg) | 도입 후 (2일/157msg) | 변화 |
|---|---:|---:|---:|
| 메시지당 비용 | $2.345 | $1.910 | **−18.6%** |
| 메시지당 출력 토큰 | 7,391 | 6,052 | −18.1% |
| 메시지당 assistant 왕복 | 9.73 | 8.83 | −9.2% |
| 메시지당 도구 호출 | 5.72 | 5.25 | −8.2% |

같은 요청을 더 적은 왕복으로 끝낸다 = 첫 시도 적중률 ↑. PEV·Structured Task가 한 번에 가게 만든 효과로 보입니다.

<details>
<summary>측정 배경: 캐시 히트율을 제외한 이유와 표본에 관한 주의 사항</summary>

- 저자는 Max 플랜(캐시 TTL 1시간)이라 히트율이 이미 ~98%에 수렴해 개선 여지가 작았습니다. **Pro 플랜(5분 TTL) 사용자는** 만료 직전 handoff 워크플로 조합으로 히트율 자체가 오를 가능성이 큽니다.
- 만료 직전 handoff 워크플로: statusline TTL 카운트다운을 보다가 만료 직전 `claude-token-saver handoff`로 작업 상태를 백업하고 새 캐시 사이클을 시작. 1M 경고·cap 칩도 같은 흐름으로 처리.
- ⚠️ 도입 후 데이터는 2일치(157msg)로 통계적 의미가 약하고, 주별 작업 토픽 차이가 섞여 있어 도구 효과만 깨끗이 분리되진 않습니다.
</details>

## 동작 원리 · 환경

Claude Code는 모든 API 응답을 `~/.claude/projects/<dir>/<session>.jsonl`에 기록합니다. 이 도구는 `cache_read_input_tokens`, `cache_creation.ephemeral_5m/1h_input_tokens` 등을 `requestId` 기준으로 중복 제거 후 집계합니다.

Node.js ≥ 18 · macOS / Linux / Windows / WSL · **의존성 0**.

<details>
<summary>알려진 환경 이슈 · 마이그레이션</summary>

**IntelliJ Claude Code plugin:** statusline 위젯이 프레임을 잘못 합성해 `59:548` 같은 잔재가 보이는 버그가 있습니다(이모지 출력에서만). v2.8.5+는 `TERMINAL_EMULATOR=JetBrains-JediTerm` 감지 시 자동으로 text 모드 폴백합니다.

**claude-cache-monitor에서 마이그레이션:**
```bash
npm uninstall -g claude-cache-monitor && npm i -g claude-token-saver
```
`~/.claude/settings.json`의 `statusLine.command`도 `claude-token-saver …`로 교체하세요.
</details>

## 릴리스 노트

### v3.18.0 (2026-08-22)
- **한국어 문서를 다시 다듬었습니다** — 문장 성분을 생략하지 않고 서술어로 끝맺는 형태로 본문을 고쳐 썼습니다. 의미를 지나치게 함축하던 엠대시는 콜론과 접속사로 바꾸었습니다.
- **실시간 모델 라우팅이 비용을 키우는 이유를 설명에 추가했습니다** — 프롬프트 캐시가 모델별로 유지되기 때문에 세션 중간에 모델을 바꾸면 절감액이 캐시 손실로 상쇄된다는 점, 그래서 이 도구가 서브에이전트 위임만 사용한다는 점을 명시했습니다.

### v3.17.0 (2026-08-22)
- **설치 한 번으로 🅷 Harness까지 적용됩니다** — 지금까지는 설치 후 `harness init`을 따로 실행해야 statusline의 🅷 점수와 ratchet 룰 전달이 동작했습니다. 이제 설치가 `~/.claude/CLAUDE.md`에 5원칙 블록을 **추가**합니다(기존 내용은 백업 후 보존, 이미 있으면 건드리지 않음). 건너뛰려면 `CTS_NO_HARNESS=1`, 되돌리려면 `harness uninit --global`.
- **README 상단을 statusline 실제 스크린샷으로 교체** — 코드 블록 대신 실제 캡처를 최상단에 두고, 아래쪽에 중복으로 있던 이미지는 뺐습니다.

### v3.16.0 (2026-08-22)
- **README를 라우팅 절감 중심으로 재구성** — 이 도구의 핵심이 무엇인지 첫 화면에서 바로 보이도록 `🔀 Routing saved`를 최상단에 올리고, 금액이 원장에서 어떻게 나오는지(before/after/차액)와 `route-scan savings` 실제 출력을 함께 실었습니다. 채널·홈페이지 배지는 최하단 "만든 곳"으로 내렸습니다.
- **statusline 스크린샷을 현재 2줄 레이아웃으로 갱신** — 목업이 아니라 실제 출력을 캡처합니다. `npm run docs:statusline`으로 재생성할 수 있습니다(headless Chrome 사용, 의존성 추가 없음).

### v3.15.0 (2026-08-22)
- **statusline 헤드라인을 누적 한 줄로 줄였습니다** — `🔀 Routing saved $2.09 | fable→sonnet 1× $0.72 · opus→haiku 1× $0.57 …`. 주간·월간 합계는 뺐습니다. 뒤에 붙는 모델 이동 내역이 누적 기준 분해인데 롤링 창 세 개와 나란히 있으면 어느 것의 내역인지 읽히지 않았습니다. 한 줄 전체가 한 시점 기준이 되면 어긋날 여지가 없습니다. 주간·월간은 `route-scan savings`에서 계속 확인할 수 있습니다.
- **모델별 절감 내역은 회색으로** — 녹색은 누적 금액 하나에만 남깁니다. 구성 요소마다 같은 녹색을 반복하면 줄 전체가 한 덩어리로 시끄러워져 먼저 눈이 닿을 곳이 사라집니다.

### v3.14.0 (2026-08-22)
- **statusline 헤드라인이 모델 이동을 함께 보여줍니다** — `🔀 Routing saved weekly $1.4 · monthly $2.1 · total $2.1 | fable→sonnet 1× $0.72 · opus→haiku 1× $0.57 …`. 버전 숫자는 계속 올라가고 statusline에서는 잡음이라 계열명만 남깁니다(`claude-opus-4-5-20251101-v1:0` → `opus`). 이동 목록은 **자르지 않고 전부** 표시합니다 — 금액이 `total` 옆에 붙어 있어서 일부만 보이면 합계를 잘못 말하게 됩니다. 계열 단위로 접히면 조합 수가 원래 많지 않아 줄은 짧게 유지됩니다.
- **`route-scan savings` 추가** — 헤드라인 뒤에 있는 근거를 그대로 조회합니다. 모델 이동별 합계(어느 모델에서 어느 모델로 몇 회, 얼마)와 실행별 내역(날짜·금액·모델 이동·해당 룰)이 함께 나옵니다.
- **기준 모델을 최고가가 아니라 '가장 많이 처리한 모델'로 정합니다** — 한 트랜스크립트에 모델이 섞이는 일이 흔한데(세션 중 모델 전환 등) 최고가를 고르면 Fable 기록 한 건이 Opus가 서른 번 처리한 카테고리의 기준을 차지해 이후 절감액을 전부 부풀렸습니다. 동수일 때만 비싼 쪽으로 기웁니다. 옛 정의로 굳은 기준은 1회 재계산됩니다.
- **원장 기록을 룰 갱신 뒤로 옮겼습니다** — 앞서 기록하면 기준이 바뀐 스캔이 새 기준을 저장하면서 청구는 옛 기준으로 해, 합계가 두 번째 스캔에야 맞았습니다.

### v3.13.0 (2026-08-22)
- **라우팅 절감액의 기준을 '승격 전 모델 → 위임 모델' 차액으로 바꿨습니다** — 이전에는 세션의 최상위 모델을 반사실로 잡아, 그 모델이 해당 유형을 실제로 처리한 적이 없어도 차액을 절감으로 기록했습니다. 이제 각 룰이 **승격 전 그 유형을 직접 처리하던 모델**(baseline)을 기억하고, 그 기준 대비로만 계산합니다. baseline은 한 번 정해지면 고정됩니다 — 룰이 효력을 낼수록 직접 처리 사례가 줄어 기준이 흘러내리고, 그러면 룰이 만든 절감이 스스로 작아지기 때문입니다.
- **룰이 커버하지 않는 위임은 집계에서 뺐습니다** — `Explore`, 직접 만든 에이전트, 플러그인 에이전트처럼 이 도구와 무관하게 돌던 서브에이전트 실행까지 절감으로 잡히고 있었습니다. 도구가 라우팅하지 않은 작업의 절감을 도구 성과로 표시하면 안 됩니다. 원장 이벤트에 `rule`/`from`/`to`를 남겨 어느 룰이 어떤 모델 차이를 만들었는지 추적할 수 있습니다.
- **원장 스키마 version 2** — 반사실 기준이 달라진 만큼 v1 항목은 마이그레이션 없이 폐기합니다(두 의미를 한 합계에 섞을 수 없습니다). 다음 `route-scan`이 귀속 가능한 절감만 다시 채웁니다.
- **사내 별칭 모델명이 조용히 Sonnet으로 계산되지 않습니다** — 게이트웨이가 계열명 없는 별칭(`prod-large` 등)을 모델명으로 기록하면 가격표 기본값이 걸려 Sonnet으로 계산됐고, 그 결과 없는 절감이 생기거나 있는 절감이 지워졌습니다. 이제 비교 양쪽 모두 계열명이 남아 있는 id일 때만 집계합니다. Bedrock(`anthropic.claude-opus-4-5-v1:0`)·Vertex(`claude-opus-4-5@20251101`)·1M 접미사(`claude-sonnet-4-5[1m]`)는 그대로 인식되고, 사내 별칭은 `profile-map.json`의 `modelAliases`에 한 줄 추가하면 집계에 복귀합니다(와일드카드 가능).
- `harness check`가 CLAUDE.md 크기와 `.claudeignore` 유무를 함께 보고합니다(자문 정보, 🅷 점수에는 미반영).

### v3.12.1 (2026-08-22)
- **라우팅 절감 헤드라인의 가독성 정리** — 금액을 절감 녹색으로 칠하고(그 줄에서 유일하게 명확한 호재입니다), `wk`·`mo`·`all` 축약을 `weekly`·`monthly`·`total`로 풀었으며, 금액이 앞서던 순서를 뒤집어 기간이 먼저 오게 했습니다. 금액 셋이 연달아 나오면 뒤따르는 기간 표시를 찾기 전까지 한 덩어리로 읽혔습니다.

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

---

## 만든 곳

[![DeepPulse YouTube](https://img.shields.io/badge/YouTube-@DeepPulseKR-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseKR)
[![DeepPulseEN YouTube](https://img.shields.io/badge/YouTube-@DeepPulseEN-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseEN)
[![Homepage](https://img.shields.io/badge/Homepage-rootstudioyaml.github.io-2ea44f)](https://rootstudioyaml.github.io/)

AI 개발 도구를 다루는 채널 **DeepPulse**에서 만들고 씁니다. 이 도구의 배경과 사용법은 [출시 영상(60초)](https://www.youtube.com/shorts/RaD8qMsPTnA)에서 볼 수 있습니다.
