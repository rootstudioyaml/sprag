<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/site/assets/logo/sprag-lockup.svg">
  <img alt="Sprag" src="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/site/assets/logo/sprag-lockup-light.svg" width="220">
</picture>

**AI 코딩 에이전트용 품질 래칫. 같은 실수는 두 번 없습니다.**

[![npm](https://img.shields.io/npm/v/sprag-cli.svg?label=sprag-cli)](https://www.npmjs.com/package/sprag-cli)
[![downloads](https://img.shields.io/npm/dm/claude-token-saver.svg)](https://www.npmjs.com/package/claude-token-saver)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[sprag.io](https://sprag.io) · [벤치마크](./docs/BENCHMARK.md) · [English](./README.md)

</div>

---

# Sprag (sprag)

**아낀 돈을 두 줄로 보여 줍니다.** 비싼 모델이 반복하던 쉬운 작업을 싼 모델로 내려보내고, 모델이 읽지 못하는 문서를 Markdown 으로 바꿉니다. 두 절감액 모두 추정이 아니라 원장 기록입니다. 의존성 0, 설치 한 줄.

![statusline 예시. 첫 줄은 라우팅 절감액, 둘째 줄은 문서 변환 절감액, 셋째 줄은 진단 칩입니다](./docs/statusline.png)

```bash
npm i -g sprag-cli   # or: npm i -g claude-token-saver (same package, old name)
# already have claude-token-saver? switching names needs a swap (same bins):
#   npm uninstall -g claude-token-saver && npm i -g sprag-cli
```

숫자 네 개가 이 도구의 전부입니다.

- **공개 벤치마크에서 단일 모델 전부를 이깁니다**: 이 도구가 배포하는 티어 판별 기준을 LLMRouterBench 11,696문항에 적용하면 59.1%로, 단일 최고 모델(57.9%)을 넘어서면서 비용은 gpt-5 대비 31%, gemini-2.5-pro 대비 64% 쌉니다 ([벤치마크](./docs/BENCHMARK.md))
- **문서 토큰 95.8% 절감**: 30MB 발표자료를 Markdown 으로 읽으면 540,429 토큰이 22,610 토큰이 됩니다 ([근거](#-doc2md-문서를-읽기-전에-markdown-으로-바꿉니다))
- **비용 18.6% 절감**: Harness 5원칙 도입 전후 실측입니다 ([근거](#실제-효과-도입-전후-리포트))
- **라우팅 절감액은 실행 단위 원장**: 추정치가 아니라 위임 한 건 한 건의 차액 기록입니다 ([근거](#-절감액은-추정이-아니라-원장-기록입니다))

```text
                      정확도            총비용 (11,696문항)
티어 기준 라우터      59.1%  ← 최고     $268  ▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱
gpt-5                 57.8%             $388  ▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱
gemini-2.5-pro        57.9%             $734  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
```

v3.35.0 부터는 지출도 보입니다. 이번 달 1일 이후 쓴 금액을 `💵 Sep $42` 로 상시 표시하고, 5h/7d cap 이 아예 없는 LiteLLM 게이트웨이(Bedrock 등) 환경에서는 키 예산을 `🔑 budget ▰▱ 34% $34/$100` 게이지로 보여 줍니다.

## 네 가지가 함께 돌아갑니다

| | 하는 일 | 효과 |
|---|---|---|
| 🔀 **라우팅** | 반복되는 쉬운 작업을 더 싼 모델에 위임 | 절감액을 원장에 실측 기록, 판별 기준은 공개 데이터로 [벤치마크](./docs/BENCHMARK.md) |
| 📄 **문서 변환** | pptx·xlsx·pdf·docx·fig 를 읽기 전에 Markdown 으로 변환 | 발표자료 한 건에 **51만 토큰** 절약 |
| 🅷 **Harness** | 증거 없는 완료 보고·검증 생략 차단 (5원칙) | **비용 −18.6%** |
| ⚙️ **Ratchet** | 한 번 겪은 에러를 룰로 고정 | 같은 실수 재발 차단 |

설치 한 번이면 넷 다 적용됩니다. 실측 −18.6%는 Harness와 ratchet의 몫이고, 라우팅과 문서 변환 절감액은 그 위에 얹힙니다. 두 절감액은 성격이 달라서 한 숫자로 합치지 않고, statusline 이 각각의 줄로 보여 주며 금액이 큰 쪽을 위에 놓습니다.

## 목차

- **먼저 볼 것**: [시작하기](#시작하기) · [statusline 읽는 법](#statusline-읽는-법) · [주요 명령](#주요-명령)
- **절감 기능**: [라우팅 절감 원장](#-절감액은-추정이-아니라-원장-기록입니다) · [route-scan](#-route-scan-이-반복-작업은-더-싼-티어로-내려도-됩니다) · [doc2md](#-doc2md-문서를-읽기-전에-markdown-으로-바꿉니다) · [seed](#-seed-설치-직후부터-위임이-걸리게-하는-시작-룰) · [벤치마크](./docs/BENCHMARK.md)
- **가드레일**: [Harness](#-harness-모드) · [compact-window](#-compact-window-1m-컨텍스트의-자동-압축-지점-고정) · [한국어 문체](#-한국어-문체-지침)
- **비용 가시화·환경**: [이번 달 지출·LiteLLM 키 예산](#litellm-5h7d-cap-대신-키-예산을-보여-줍니다-v3350) · [게이트웨이(Bedrock·Vertex)](#-bedrockvertex-경유-환경) · [토큰 급증 원인 코드](#토큰-급증-원인-코드) · [실측 효과](#실제-효과-도입-전후-리포트)

## 시작하기

**사전 준비:** Node.js ≥ 18 (`node -v`로 확인 · macOS `brew install node` · Windows `winget install OpenJS.NodeJS.LTS` · Linux/WSL은 [nvm](https://github.com/nvm-sh/nvm) 권장)

```bash
npm i -g sprag-cli
```

설치하면 Claude Code 화면 하단에 statusline이 곧바로 나타납니다. `--ignore-scripts` 옵션이나 sudo 사용 등으로 자동 등록이 되지 않았다면 `sprag install`을 실행해 직접 등록하십시오.

설치 한 번으로 **statusline과 Skill, SessionStart 훅, 🅷 Harness(5원칙), 최초 route-scan이** 모두 준비됩니다. Harness와 한국어 문체 지침은 **무엇이 추가되는지 보여 준 뒤 켤지 물어봅니다.** Harness는 `~/.claude/CLAUDE.md`에 표시가 붙은 블록으로 **추가되며**, 기존에 작성해 둔 내용은 백업한 뒤 그대로 보존합니다. 이미 설정되어 있는 경우에는 아무것도 바꾸지 않습니다.

터미널이 아닌 환경(npm의 `postinstall`, CI, 파이프 입력)에서는 질문을 건너뛰고 기존 기본값을 적용합니다. 질문 없이 진행하려면 `--yes`나 `--no-input`, 아예 건너뛰려면 `CTS_NO_HARNESS=1 npm i -g sprag-cli`를 쓰십시오. 이미 적용한 설정을 되돌리려면 `sprag harness uninit --global`을 실행하십시오.

> ⚠️ sudo로 글로벌 설치를 하면 Skill이 사용자 계정이 아니라 root의 `~/.claude`에 등록되는 함정이 있습니다. nvm이나 fnm, Volta를 사용해 사용자 영역에 설치하기를 권장합니다.

### 설치하면 켜지는 기능과 직접 켜야 하는 기능

설치 시점에 비용이 들지 않는 기능은 전부 자동으로 켜집니다. 수동으로 남겨 둔 항목은 Claude Code 자체의 설정을 바꾸거나, 적용 범위를 사람이 정해 주어야 하는 것들뿐입니다.

| 기능 | 설치 직후 상태 | 끄는 방법 |
|---|---|---|
| statusline (진단 칩·절감 원장) | 켜짐 | `sprag uninstall` |
| `/claude-token-saver` Skill | 켜짐 | 위와 같습니다 |
| SessionStart 훅 (route-scan 재분석) | 켜짐 | 위와 같습니다 |
| UserPromptSubmit 훅 (brief 주입) | 켜짐 | 위와 같습니다 |
| 최초 route-scan (최근 14일 로그 분석) | 설치 중 즉시 1회 실행 | 해당 없습니다 |
| 🅷 Harness 5원칙 (`~/.claude/CLAUDE.md`) | 켜짐 (터미널에서는 내용을 보여 주고 한 번 묻습니다) | `harness uninit --global` · `CTS_NO_HARNESS=1` |
| doc2md 훅 (Read·Edit·Write·프롬프트) | 켜짐 | `doc2md off` · `CTS_NO_DOC2MD=1` |
| doc2md 변환기(markitdown venv) | 터미널에서 설치 여부를 묻고, 비대화형 설치에서는 명령만 안내합니다 | `doc2md install-converter` 로 나중에 설치 |
| 한국어 문체 지침 | 시스템 로케일이 한국어면 켜짐 (터미널에서는 묻습니다) | `korean off` · `CTS_NO_KOREAN=1` |
| compact-window 경고 칩 | 켜짐 | `compact-window off` |
| 업데이트 안내 칩 | 켜짐 | `CTS_NO_UPDATE_CHECK=1` |
| **compact-window 값 고정** (`autoCompactWindow` 500k) | **꺼짐 — 직접 실행해야 합니다** | `compact-window set --global` 또는 `--project` |
| **모델 피팅 룰 승인** (`ratchet-model.md` 위임 룰) | **후보만 제안합니다** | `route-scan rules` 로 확인하고 승인·삭제 |
| `handoff` (한도 임박 시 작업 백업) | 필요할 때 직접 실행하는 명령입니다 | 해당 없습니다 |

`compact-window set` 은 Claude Code 의 `settings.json` 에 값을 적고, 전역과 프로젝트 중 어디에 적을지는 사람이 정해야 하므로 자동으로 실행하지 않습니다. 모델 피팅 룰도 같은 이유로 승인 단계를 남겨 두었습니다. 어떤 작업을 더 싼 티어에 맡길지는 사용자의 판단이 필요합니다.


## 🔀 절감액은 추정이 아니라 원장 기록입니다

위임된 실행 하나하나를 이렇게 기록합니다.

```
   기준 모델          실행 모델         차액
  claude-opus-5  →  haiku-4-5   =   $0.57
  (룰 승격 전         (실제로         (같은 토큰량에
   이 유형을           처리한          두 모델 가격표를
   처리하던 모델)      모델)           각각 적용)
```

```bash
$ sprag route-scan savings      # 모든 금액을 룰 단위까지 역추적

🔀 라우팅 절감 누적 $2.09  (최근 7일 $1.40 · 30일 $2.09)

모델 이동별:
  claude-fable-5 → claude-sonnet-5   —  1회, $0.72
  claude-opus-5 → claude-haiku-4-5   —  1회, $0.57

실행별 (최근순):
  2026-08-22    $0.51  claude-fable-5 → claude-haiku-4-5
            룰: T2|paste|-Users-me-projects-my-app
```

**집계에서 빼는 것들**: 정직한 숫자가 작은 숫자보다 낫기 때문입니다.

- 등록된 룰이 담당하지 않는 위임(`Explore`, 직접 만든 에이전트, 플러그인 에이전트): 이 도구가 라우팅한 결과가 아닙니다.
- 가격표가 인식하지 못하는 모델명: 틀린 금액을 쓰느니 그 실행을 뺍니다.

---

## ⚡ 그 밖에 statusline이 잡아 주는 것

| | |
|---|---|
| 🚨 **한도 초과 예방** | 5시간·7일 rate-limit 윈도가 90%에 닿으면 경고하고, `handoff`로 작업을 백업합니다 |
| 🧠 **캐시 낭비 감지** | 히트율·TTL·1M 컨텍스트를 감지해 토큰 급증 원인을 코드로 진단합니다 |
| 💵 **비용 가시화** | 이번 달 지출(`💵 Sep $42`)을 상시 표시하고, LiteLLM 게이트웨이에서는 키 예산 게이지(`🔑 budget 34% $34/$100`)로 5h/7d cap 을 대신합니다 ([아래](#litellm-5h7d-cap-대신-키-예산을-보여-줍니다-v3350)) |
| 🇰🇷 **한국어 문체 교정** | 한국어 환경이면 자동으로 켜집니다 ([아래](#-한국어-문체-지침)) |

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
npm i -g sprag-cli@latest
sprag route-scan         # 지난 세션에서 위임 후보 추출 (LLM 호출 없음)
sprag route-scan rules   # 승격된 룰 확인 · rm <N> 으로 삭제
sprag route-scan savings # 위임으로 절감한 금액의 근거를 전수 확인
```

판정 기준선은 다른 사람의 벤치마크가 아니라 **사용자 본인의 최근 14일 분포(p25/p75)** 로 잡습니다.
위임한 뒤에 실제로 성공했는지까지 측정하는 rule-health는 [v3.9.0](#v390-2026-08-01)에 들어갔습니다.

---

## statusline 읽는 법

절감 원장에 기록이 쌓이면 statusline이 **두 줄로** 출력됩니다. 첫째 줄에는 라우팅 절감액만 표시하고, 둘째 줄에는 진단 칩을 표시합니다.

```
🔀 Routing saved $2.09  |  fable→sonnet 1× $0.72 · opus→haiku 1× $0.57
⚠ Ctx 500k+ · 🅷 5/5 · 🤖 Opus 5 · 🧠 Cache hit 98.8% · ⏳ Cache expires 59:46 · ✦ current ███▓░░ 62% 🔄 21:33 · 📅 weekly ██▒░░░ 38% 🔄 Tue 19:33 · 📦 Ctx 47% of 1M · 💰 Cache saved $1.0K · last 1d
```

원장이 비어 있으면, 다시 말해 아직 실측된 위임이 없으면 첫째 줄을 그리지 않고 종전처럼 한 줄로 출력합니다. 일부 환경(구버전 macOS Claude Code)에서 첫째 줄만 표시된다면 `--single-line` 옵션으로 한 줄 레이아웃을 유지하십시오.

| 세그먼트 | 의미 |
|---|---|
| `🔀` **첫째 줄** | 라우팅으로 절감한 누적 금액과 모델 이동 내역입니다. 내역 합계는 누적 금액과 정확히 일치하고, 모델명은 계열만 남깁니다(`opus→haiku`). 근거는 `route-scan savings` 로 전부 확인할 수 있습니다 |
| `📄` **둘째 줄** | doc2md 문서 변환이 절감한 누적 금액과 형식별 내역입니다. 라우팅과 문서 변환 중 금액이 큰 쪽이 첫째 줄을 차지합니다 |
| `🤖` | 현재 모델 |
| `🅷 5/5` | harness 원칙 점수 ([Harness 모드](#-harness-모드)) |
| `🧠` | 캐시 히트율 (85%+ 녹색) |
| `⏳` | 캐시 TTL 카운트다운입니다. 만료되기 전에 메시지를 보내면 캐시가 유지됩니다. 입력이 없을 때도 초 단위로 줄어드는 표시는 Claude Code v2.1.97 이상에서 동작합니다 (아래 [카운트다운이 멈춰 보일 때](#동작-원리--환경) 참고) |
| `✦ current` / `📅 weekly` | 5시간 / 7일 rate-limit 윈도 사용률 + 리셋 시각 |
| `📦` | 컨텍스트 사용률입니다(예: `Ctx 68% of 1M`). 사용률에 따라 녹색·노란색·빨간색으로 표시합니다. 최신 모델은 1M 컨텍스트가 기본이고 별도 요금이 붙지 않지만, 토큰량 자체가 턴당 비용과 5시간·7일 한도를 빠르게 소모시킵니다 |
| `💵 Sep $42` | **이번 달 1일 00시(로컬) 이후 지출 추정치**입니다. 세션 로그에 세션별 모델 단가를 적용해 합산하며, 5h/7d cap 이 없는 게이트웨이 환경에서도 항상 표시됩니다 (v3.35.0) |
| `🔑 budget` | **LiteLLM 게이트웨이 키의 예산 게이지**입니다. stdin 에 rate_limits 가 오지 않는 환경에서 키의 `max_budget` 대비 `spend` 를 `🔑 budget ▰▱ 34% $34/$100` 형태로 보여 줍니다 (v3.35.0, [아래](#-bedrockvertex-경유-환경)) |
| `💰` | 프롬프트 캐시가 절약해 준 누적 금액입니다. 첫째 줄의 `🔀`(모델 라우팅 절감액)와는 **서로 다른 수치입니다** |
| `v3.24.0` | 지금 실행 중인 sprag의 버전입니다. 최신이면 회색으로 줄 끝에 조용히 놓입니다 |
| `⬆ v3.24.0 → 3.25.0` | 새 버전이 배포되어 있다는 표시입니다. 조치가 필요한 칩이므로 줄 앞쪽으로 올라옵니다 ([업데이트 안내](#-업데이트-안내)) |

문제가 감지되면 **경고 칩을 줄 맨 앞에** 붙입니다.

```
🚨 5H █████▓ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 4.8 · 🧠 Cache hit 72.1% · ⚠ Cache miss · 📅 weekly ▓░░░░░ 12% 🔄 Sun 14:26 · 📦 Ctx 200k · last 1d
```

칩의 종류는 다음과 같습니다. `🚨 5H/7D NN%`(한도 임박) · `⚠ Ctx 500k+`(단일 요청이 실제로 500k를 초과) · `⚠ Cache miss` · `⚠ Input spike` · `⚠ Output heavy` · `⚠ Call surge` · `⚠ Rebuild churn` · `⚠ 5m TTL`. 두 윈도가 동시에 90%를 넘으면 리셋이 더 임박한 쪽을 🚨로 올리고, 나머지 하나는 빨간 세그먼트로 계속 표시합니다 (v2.16.0 이상).

### 경고 칩이 떴을 때

Claude Code 안에서 `/claude-token-saver` Skill을 실행하거나, 칩에 적힌 문구를 그대로 말하기만 해도("5H cap 떴어", "cache miss") Skill이 자동으로 활성화되어 **원인 코드와 단계별 해결 명령을** 보여 줍니다. 한도가 임박한 상황에서는 `sprag handoff`로 진행 중인 작업을 마크다운 파일에 백업한 뒤 새 세션에서 이어가는 방식을 권장합니다.

## 주요 명령

셸에서 직접 실행합니다 (Claude Code 안에서는 `/claude-token-saver` Skill 하나만 사용):

| 명령 | 설명 |
|---|---|
| `sprag` | 최근 1일 진단 리포트 (`--days N` / `--hours N`) |
| `sprag last` | 가장 최근 경고 1건 + 처방 |
| `sprag history` | 최근 7일 경고 전이 로그 |
| `sprag handoff` | 작업 상태를 `HANDOFF-*.md`로 백업 (캡 임박 시) |
| `sprag mode [keywords...]` | 출력 설정 (`icon`/`text`, `ko`/`en`, `1h`~`30d` 윈도 등) |
| `sprag harness ...` | 🅷 Harness 관리 (아래 참고) |
| `sprag route-scan` | 상위 모델이 반복 처리한 쉬운 작업을 감지해 haiku 위임 랫쳇 룰을 제안합니다 (아래 참고) |
| `sprag route-scan savings` | 라우팅 절감 원장입니다. 모델 이동별 합계와 실행별 내역을 함께 보여 주며, 표시되는 금액의 근거가 됩니다 |
| `sprag compact-window` | 1M 컨텍스트를 쓰면서 자동 압축 창이 설정되지 않았으면 경고하고, `set`으로 40만에 고정합니다 (아래 참고) |
| `sprag korean on\|off\|status` | 한국어 문체 지침을 세션 시작 시 주입하고, 쓰기 시점 검사를 함께 설치합니다 (아래 참고) |
| `sprag cohesion on\|off\|status\|show` | 영어 문장 연결(응집성) 지침을 세션 시작 시 주입합니다 |
| `sprag korean lint block\|warn\|off` | 쓰기 시점 검사가 위반을 어떻게 처리할지 정합니다 |
| `sprag korean lint scope all\|prose` | 검사 범위를 모든 텍스트 파일과 문서 전용 사이에서 고릅니다 |
| `sprag doc2md on\|off` | 첨부 문서를 모델이 읽기 전에 Markdown 으로 변환합니다 (아래 참고) |
| `sprag doc2md <파일>` | 파일 하나를 직접 변환합니다. 진단 용도이며 실패 이유를 그대로 출력합니다 |
| `sprag mode ttl=5m\|1h\|auto` | 캐시 TTL 버킷을 직접 지정합니다. 기본값 `auto`는 실측값을 먼저 보고, 실측값이 없으면 게이트웨이 여부로 판정합니다 |
| `sprag --version` | 설치된 버전을 출력합니다 |
| `sprag update-check` | 새 버전이 있는지 확인합니다 (`--refresh`로 즉시 조회, `--dismiss`로 그 버전 안내 끄기) |
| `sprag upgrade` | 설치 경로에 맞는 명령으로 최신 버전을 설치합니다 (`--print`로 실행 없이 명령만 확인) |
| `sprag install` | Skill·statusline 수동 등록 |
| `sprag uninstall [--purge]` | 등록한 훅·statusline·Skill 제거. 기록된 절감액은 남기며, `--purge` 를 붙이면 상태 디렉터리까지 지웁니다 |

출력 언어는 설치할 때 한 번 정합니다. 터미널에서 설치하면 시스템 로케일을 기본값으로 제시하고 한국어를 쓸지 물어보며, 비대화형 설치에서는 로케일 판정을 그대로 기록합니다. 한 번 기록되면 업그레이드해도 다시 묻지 않습니다. 나중에 바꿀 때는 `mode ko`나 `mode en`을 쓰고, 스크립트에서 설치할 때는 `CTS_LANG=ko` 또는 `CTS_LANG=en`으로 지정할 수 있습니다. statusline의 칩은 언제나 기호로 표시합니다. 전체 옵션은 [영문 README](./README.md#options)를 참고하십시오.

## ⬆ 업데이트 안내

statusline은 대화 상자를 띄울 수 없고, 300밀리초마다 다시 그려지기 때문에 그리는 시점에 네트워크를 쓸 수도 없습니다. 그래서 안내를 두 지점으로 나누었습니다.

- **statusline은 알리기만 합니다.** 최신 버전이면 줄 끝에 `v3.24.0`을 회색으로 조용히 표시하고, 새 버전이 있으면 `⬆ v3.24.0 → 3.25.0`을 줄 앞쪽에 노란색으로 올립니다. 빨간색은 쓰지 않습니다. 무엇도 고장 난 상태가 아니기 때문입니다.
- **묻는 일은 세션 시작에서 합니다.** 새 세션이나 `/clear` 시점에 SessionStart 훅이 "새 버전이 있으니 사용자에게 업그레이드할지 물어보라"는 한 줄을 모델에게 주입합니다. 모델은 사용자에게 확인한 뒤에만 `sprag upgrade`를 실행합니다. 묻지 않고 설치하지 않습니다.
- **거절은 기억합니다.** 사용자가 원치 않으면 `sprag update-check --dismiss`로 그 버전을 묻지 않도록 설정합니다. 더 새로운 버전이 배포되면 다시 묻습니다. statusline 칩은 그대로 남습니다. 거절한 것은 질문이지, 새 버전이 있다는 사실이 아니기 때문입니다.

버전 조회는 24시간에 한 번, 분리된 백그라운드 프로세스가 수행하고 결과만 파일에 남깁니다(`update-check.json`). 이 방식은 npm의 `update-notifier`가 쓰는 것과 같습니다. 네트워크가 끊겨 있어도 실패 시각을 기록해 두므로 매 렌더마다 재시도하지 않습니다. 확인 자체를 끄려면 환경 변수 `CTS_NO_UPDATE_CHECK=1` 또는 `NO_UPDATE_NOTIFIER`를 설정하십시오.

## 🅷 Harness 모드

다섯 원칙(Ratchet · Evidence · PEV · Structured Task · Default Safe Path)을 한 줄 명령으로 `CLAUDE.md`에 셋업하고 statusline이 `🅷 5/5`로 점수화합니다. 같은 에러가 반복되면 `🅷⚠ ratchet?` 알림이 떠서 룰로 승격할 수 있습니다.

```bash
sprag harness init                # 이 프로젝트에 셋업
sprag harness init --global       # ~/.claude/CLAUDE.md, 모든 프로젝트에 적용
sprag harness check               # 현재 점수 (글로벌 fallback 인정)
sprag harness analyze             # 훅 없이도 수동으로 전사 분석을 실행해 harness-state.json 갱신
sprag harness promote <N> --project|--global   # 경고 #N → ratchet 룰 (스코프 필수)
sprag harness promote "<룰 텍스트>" --project|--global  # 내가 직접 정의한 룰도 같은 명령으로 등록
sprag harness pull                # 패키지 동봉 큐레이션 룰 → 내 글로벌 랫쳇에 등록 (opt-in, 중복 스킵)
sprag harness list / rm <N>       # 룰 조회 / 삭제 (자동 .bak)
sprag harness off | on            # 🅷 표시 토글
```

- `promote`는 non-TTY 환경(스크립트나 LLM 호출)에서 `--project` 또는 `--global` 플래그가 **반드시 필요합니다.** 적용 범위가 사용자에게 묻지 않은 채 결정되는 사고를 막기 위한 설계입니다.
- `pull`은 패키지에 동봉된 **제작자 큐레이션 랫쳇 룰**(`presets/ratchet-rules.json`, 실제 반복 사고에서 승격된 범용 룰만)을 내 글로벌 랫쳇(`~/.claude/ratchet.md`)에 등록합니다. 설치(`install`)나 `init`은 아무것도 자동 주입하지 않으며, `pull`은 항상 opt-in이고 재실행해도 중복이 없습니다(멱등). 마음에 안 드는 룰은 `harness rm`으로 제거하면 됩니다.
- `seed`는 같은 프리셋을 **한 건씩** 물어보는 경로입니다. `pull`이 랫쳇 룰 전체를 한 번에 등록하는 명령인 데 반해, `seed`는 모델 피팅 프리셋까지 포함해 설치·업그레이드 후 첫 세션에서 한 건씩 제안합니다 ([아래](#-seed-설치-직후부터-위임이-걸리게-하는-시작-룰)).
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

Claude Code는 `min(autoCompactWindow, 모델 최대 창)`에 가까워지면 대화를 자동 압축합니다. 1M 창을 쓰면 이 값이 잡혀 있지 않은 한 80만 토큰 근처까지 가서야 압축이 걸리고, 그전까지 모든 요청이 전체 컨텍스트를 통째로 재과금합니다. **1M은 너무 크니 40만~70만 범위를 권장합니다.** 큰 붙여넣기용 여유는 200k 세션의 2~3.5배로 남기면서 꼬리만 잘라냅니다.

**권장 범위 안이면 경고하지 않습니다.** 40만은 절감이 압축 횟수를 이기는 하한이고, 긴 세션은 그보다 여유가 더 필요한 경우가 많습니다. 미설정이거나 70만을 넘을 때만 알립니다(그보다 낮게 잡은 건 더 공격적으로 아끼겠다는 선택이라 그냥 둡니다).

**200k 컨텍스트는 경고 대상이 아닙니다.** 창이 이미 200k 이하이므로 이 설정으로 달라지는 것이 없기 때문입니다.

```bash
sprag compact-window                       # 현재 상태 (모델·창·설정값·출처)
sprag compact-window set --global          # ~/.claude/settings.json 에 50만 고정 (범위 중간)
sprag compact-window set --project         # <root>/.claude/settings.json 에 고정
sprag compact-window set --global --value 600k    # 값 직접 지정 (10만~1M)
sprag compact-window off | on              # 경고 표시 토글
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

더 알아보기: **티어 기준·리서치 근거** → [docs/TIER_CRITERIA.md](./docs/TIER_CRITERIA.md) · **룰 파일 구조·스캔 트리거·서브에이전트 준비** → [docs/ROUTE_SCAN.md](./docs/ROUTE_SCAN.md)

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

## 🌱 seed: 설치 직후부터 위임이 걸리게 하는 시작 룰

모델 피팅 랫쳇(`ratchet-model.md`)은 **빈 파일로 시작합니다.** route-scan이 사용자의 로그에서 같은 유형의 작업을 여러 번 관측하고, 사용자가 그 후보를 승인해야 룰이 생깁니다. 즉 갓 설치한 상태에서는 위임이 한 건도 걸리지 않고, 그 상태가 며칠 이어집니다. 정작 절감 효과가 가장 클 시기입니다.

`seed`는 패키지에 동봉된 프리셋으로 그 공백을 메웁니다.

| 프리셋 | 내용 | 파일 |
|---|---|---|
| 모델 피팅 9건 | 명령 실행·탐색·상태 확인·붙여넣은 로그 질문·읽기 요약, 각 유형의 T2(haiku)와 T1(sonnet) 룰 | `presets/model-rules.json` |
| 랫쳇 6건 | 실제 반복 사고에서 승격된 범용 룰 | `presets/ratchet-rules.json` |

**등록 절차:** 설치나 업그레이드 후 첫 세션에서 SessionStart 훅이 대기 중인 프리셋을 모델에게 전달하고, 모델이 **한 건씩 순서대로** 등록 여부를 묻습니다. 사용자가 답하면 곧바로 아래 명령을 실행합니다.

```bash
sprag seed                                   # 대기 중인 프리셋과 응답 기록
sprag seed accept <id> --global|--project     # 한 건 등록 (적용 범위 필수)
sprag seed accept all --global                # 사용자가 "전부 등록"이라고 답한 경우
sprag seed skip <id>                          # 거절 — 다시 묻지 않습니다
sprag seed reset                              # 응답 기록을 지워 전체를 다시 제안 대상으로
```

- **승인 없이는 아무것도 기록되지 않습니다.** 거절한 룰은 업그레이드 후에도 다시 묻지 않고, 새 릴리스에서 추가된 프리셋만 다음 세션에 제안됩니다.
- 사용자가 이미 같은 유형(같은 티어·카테고리)의 룰을 직접 승인해 두었다면 그 프리셋은 제안하지 않습니다.
- 프리셋으로 등록한 룰은 **남의 통계를 내 것처럼 표시하지 않습니다.** 등록 직후에는 `preset (curated)`로 적히고, 이후 스캔에서 실제 발화와 위임 결과가 측정되면 그 수치로 대체됩니다. 위임 에러율이 기준을 넘으면 다른 룰과 똑같이 재검토 플래그가 붙습니다.
- 적용 범위는 `--global`과 `--project` 중 반드시 명시해야 합니다. 훅 환경은 non-TTY라 CLI가 직접 물을 수 없으므로, 모델이 사용자에게 확인한 뒤 플래그를 붙여 실행합니다.

## 🇰🇷 한국어 문체 지침

Claude가 한국어로 쓸 때 나타나는 문체 결함(문장 성분 생략, 명사형 종결, 번역체, 엠대시 남용)을 교정하는 지침을 **세션 시작 시 한 번 주입합니다.**

```bash
sprag korean on       # 켜기 (모든 프로젝트에 적용)
sprag korean status   # 상태·비용·출처 확인
sprag korean show     # 지침 원문 출력
sprag korean off      # 끄기
```

Claude Code의 output style로도 같은 일을 할 수 있지만, output style은 **전역 슬롯 하나**라서 켜는 순간 다른 스타일을 못 쓰게 되고 머신마다 따로 설정해야 합니다. 이 기능은 지침을 패키지에 담고 이미 설치된 SessionStart 훅으로 전달하므로, **CLI가 설치된 모든 프로젝트에 적용되며 output style 슬롯은 비워 둡니다.** `/clear` 이후에도 훅이 다시 실행되어 유지됩니다.

비용은 **세션당 약 1,500 토큰이며 매 턴이 아니라 세션 시작에 한 번만** 주입됩니다. 두 번째 요청부터는 프롬프트 캐시에 올라가므로 추가 부담이 거의 없습니다. 켜져 있으면 statusline에 `✍️` 칩이 표시됩니다.

### 적용 전후 비교

슬랙 봇이 `claude -p`로 저장소를 조사하고 결과를 스레드에 답하는 실제 파이프라인(yaml-sns-agent)에서, 지침만 껐다 켜고 같은 질문을 던진 결과입니다. 질문은 "렌더가 실패했을 때 원인을 어떻게 좁히는지 한국어 3문장으로 설명해라"였습니다.

**이전** (지침 꺼짐)

> 렌더 실패 원인 좁히기 3단계: 먼저 `hn:still --check`로 스틸이 명세보다 최신인지(FRESH/STALE) 확인합니다. STALE이면 재생성 안 해서 옛 자산으로 렌더 시도한 게 원인. 다음 caption-blocks가 최신 나레이션과 단어열 일치하는지 직접 대조합니다. TTS 재생성 후 blocks 재생성 빠지면 자막·음성 어긋나 렌더 깨짐.

**이후** (지침 켜짐)

> 먼저 `hn:still --check` 돌려 스틸이 명세보다 최신인지 확인한다. STALE이면 재생성 안 해서 생긴 문제.
>
> 다음 caption-blocks가 captions.json 단어열과 일치하는지 본다. 내레이션 재TTS 후 blocks 재생성 빠지면 옛 자막이 새 음성 위에 뜬다.

바뀐 지점은 세 가지입니다. 첫째, 엠대시로 이어 붙이던 절이 마침표로 끊어져 한 문장이 한 가지 사실만 전달합니다. 둘째, "확인", "대조", "렌더 깨짐" 같은 명사형 종결이 "확인한다", "본다", "뜬다"처럼 서술어로 바뀌어 무엇을 하라는 것인지가 분명해집니다. 셋째, "자막·음성 어긋나"처럼 조사가 빠졌던 지점에 조사가 돌아와 어떤 성분이 주어이고 목적어인지 읽는 즉시 잡힙니다.

기술적 내용은 양쪽이 동일합니다. 지침은 판단이나 정확도가 아니라 문장의 완성도에만 관여하므로, 답이 달라지는 것이 아니라 같은 답을 다시 읽지 않아도 되는 형태로 만들어 줍니다. 슬랙처럼 사람이 스크롤하며 읽는 채널에서는 이 차이가 되묻는 횟수를 줄이고, 되묻지 않는 만큼 토큰도 아낍니다.

### 보강 지침: 응집성과 보수적 교정 규칙 (v3.37.0)

들여온 fluent-korean 본문은 원형 그대로 두고, 그 뒤로 수집한 지침은 별도 파일(`presets/korean-style/supplement.md`)에 담아 같은 주입에 이어 붙입니다. 수집 기준은 보수적입니다. 거의 항상 고치는 편이 나은 조항만 실었고, 출처는 국립국어원 공공언어 지침, 쿠버네티스 문서 한글화 가이드, 그리고 한국어 텍스트 응집성을 다룬 학술 논문 세 편입니다.

세 층이 더해집니다.

- **번역투**: 이중 피동, 일본어에서 온 굳은 표현, `~에 있어서`, 영어 have를 직역한 '가지다' 남용. 기계가 판정할 수 있는 것은 쓰기 시점 검사(아래)에도 함께 들어갑니다.
- **상투 패턴**: 자동으로 붙는 수식어("다양한", "핵심적인"), 표지판 문장, 수사적 질문 뒤 즉답, 근거 없는 긍정 마무리.
- **응집성**: 문장이 이어지는 방식이라 정규식으로는 검사하지 못합니다. 이 절의 방향을 정한 연구 결과가 있습니다. 접속어·지시어 같은 표층 연결 장치는 글의 품질과 상관이 없거나 오히려 부적 상관이고, 앞 문장이 내놓은 정보를 다음 문장이 받아 풀어 주는 상술형 연결만 정적 상관을 보였습니다. 그래서 지침은 연결이 어색할 때 접속어를 더하지 말고 정보의 배열(아는 것 먼저, 새 것 나중)을 고치라고 말합니다.

응집성 층의 원칙 대부분은 한국어에만 해당하지 않습니다. 구정보 우선 배열, 대명사의 단일 지시, 문단 안 주어 유지, 비약을 잇는 다리 문장, 짧은 반복 문장 병합은 영어 산문에도 그대로 적용됩니다. 논문이 한국어 학습자를 다뤘을 뿐, 검증된 원칙은 텍스트언어학의 표준 응집성 모형입니다. 영어 산출물에는 `sprag cohesion on`이 같은 다섯 원칙을 영어 블록으로 주입합니다 (korean 지침이 켜져 있으면 중복이라 생략됩니다).

마지막 절은 고치면 안 되는 것을 명시합니다. 정착된 전문 용어, 문어체, 원문 인용이 그것이고, 검사가 내는 지적은 판정이 아니라 확인 요청입니다.

### 쓰기 시점 검사 (v3.24.0)

지침을 세션 시작에 한 번 넣는 것만으로는 부족했습니다. 모델은 지침을 한 번 읽고 그 뒤로 파일 수십 개를 쓰는데, 그동안 결과물을 다시 읽어 보는 단계가 없었습니다. 그래서 지침이 켜진 세션이 규약에 어긋나는 문장을 문서에 그대로 실어 보냈고, 사람이 완성본을 읽을 때에야 드러났습니다. 2026년 8월에 적용 범위 문장을 고쳐서 같은 문제를 잡으려 했지만, 문장을 고쳐도 검사 단계가 없다는 조건은 그대로였기 때문에 재발했습니다.

v3.24.0부터 `korean on`이 PostToolUse 훅을 함께 설치합니다. 모델이 방금 쓴 파일을 열어서 기계로 판정할 수 있는 조항을 검사하고, 위반이 있으면 모델에게 되돌려 보냅니다. 파일은 이미 저장된 뒤이므로 잃는 것은 없고, 모델이 즉시 고칩니다.

```bash
sprag korean lint block   # 기본값. 위반을 되돌려 보내 고치게 합니다
sprag korean lint warn    # 알리기만 하고 진행을 막지 않습니다
sprag korean lint off     # 검사하지 않습니다

sprag korean lint scope all     # 기본값. 세션이 쓴 모든 텍스트 파일
sprag korean lint scope prose   # 마크다운·텍스트 문서만

sprag korean lint docs/*.md     # 이미 저장된 파일을 직접 검사
```

검사 항목은 사람이 판정할 필요가 없는 것들입니다. 비유 어휘 15종(`~는 자리`, `~의 흐름`, `닿는다`, `걷어내다`, `발목을 잡다` 등), 번역체 표지(`~에 대한`, `~를 위한`, `~되어지`), 구분자(`—`·`ㅡ`·`|`), 한 구에 세 번 이상 이어지는 조사 `의`, 명사형 종결 뒤의 마침표입니다. 판단이 필요한 조항(성분 생략, 한자어 선택)은 그대로 지침이 담당합니다.

기본 범위 `all`은 문서뿐 아니라 **코드 주석과 화면에 나가는 문자열, 자막·템플릿, 생성 결과물까지** 검사합니다. 벤더링한 지침 원문은 코드 주석을 예외로 두지만, 주석도 사람이 읽고 PDF·HTML 같은 산출물은 그 문자열들로 조립되기 때문에 예외로 두면 정확히 문제가 됐던 경로가 다시 열립니다. 검사에서 빠지는 것은 설치된 의존성(`node_modules`), VCS 내부, 락 파일, 그리고 이진·이미지 파일뿐입니다. `dist`나 `build` 같은 산출물 디렉터리는 검사합니다. 원문 규약대로 문서만 보고 싶으면 `korean lint scope prose`로 되돌립니다.

주입문의 적용 범위 안내도 이 설정에서 생성합니다. 모델에게 알리는 범위와 검사하는 범위가 갈라지면 8월과 같은 상태로 돌아가기 때문입니다.

### 함께 주입되는 인코딩 규칙 (v3.23.2)

문체 지침과 별도로, **도구 호출 인자에 담는 비ASCII 문자열은 리터럴 UTF-8로 쓰고 `\uXXXX` 유니코드 이스케이프로는 쓰지 말라**는 한 줄이 같이 주입됩니다.

모델이 Write나 Edit의 인자에 한국어를 이스케이프로 적으면, 그 이스케이프가 코드 포인트로 해석되지 않고 `한` 같은 문자열 그대로 파일에 기록되는 경우가 있습니다. 결과물에는 깨진 글자가 남고, 모델은 자기가 쓴 값과 파일 내용이 다르다는 사실을 알아차리지 못한 채 다음 편집을 이어 갑니다. 이스케이프를 쓰지 않으면 이 경로 자체가 생기지 않으므로, 사후에 복구하는 대신 입력 단계에서 막습니다.

이 한 줄은 fluent-korean 원문이 아니라 sprag가 직접 쓰는 안내 문단에 들어갑니다. 문체가 아니라 표기 방식을 정하는 규칙이고, 벤더링한 원문은 수정하지 않는다는 원칙을 지켜야 하기 때문입니다. 같은 이유로 코드와 커밋 메시지에 적용하지 않는 문체 예외와 달리, 이 규칙에는 예외를 두지 않습니다. 세션당 약 60 토큰이 늘어납니다.

> **근거**
> 같은 현상이 Claude Code 저장소에 보고되어 있습니다: [#12417 유니코드 처리 회귀](https://github.com/anthropics/claude-code/issues/12417), [#26141 Edit 도구가 유니코드를 조용히 손상시키는 문제](https://github.com/anthropics/claude-code/issues/26141).

### 설치할 때 물어봅니다

설치 과정에서 **지침의 내용과 세션당 비용, 출처를 먼저 보여 준 다음 켤지 물어봅니다.** 시스템 로캘이 한국어이면(`ko_KR` 등, macOS는 시스템 설정까지 확인) 질문의 기본값이 "켬"이 되고, 한국어 환경이 아니면 기본값이 "끔"입니다. 로캘은 답이 아니라 기본값일 뿐이므로 영어 로캘에서 한국어로 작업하는 경우에도 설치 중에 바로 켤 수 있습니다.

npm의 `postinstall`이나 CI처럼 사람이 붙어 있지 않은 설치에서는 질문을 건너뛰고 로캘 기본값을 그대로 적용합니다. 프롬프트가 멈춰 서면 설치 자체가 걸리기 때문입니다. 이때 로캘이 한국어가 아니면 **설정을 저장하지 않고 미결정으로 남겨 두므로**, 나중에 터미널에서 다시 설치하면 그때 물어봅니다. 질문 없이 기본값으로 넘기려면 `--yes`나 `--no-input`을, 기능 자체를 건너뛰려면 `CTS_NO_KOREAN=1`을 쓰십시오. **한 번이라도 직접 켜거나 끈 뒤에는 그 선택을 유지하므로, 업데이트 설치가 사용자의 결정을 되돌리지 않습니다.**

> **출처와 라이선스**
> 지침 원문은 [fluent-korean](https://github.com/snflkd/fluent-korean)에서 가져왔습니다. Copyright (c) 2026 snflkd, MIT License.
> 원문은 수정하지 않았고 output style 프런트매터만 제거했습니다. 라이선스 전문은 패키지의 `presets/korean-style/LICENSE-fluent-korean`에 함께 배포합니다.

## 📄 doc2md: 문서를 읽기 전에 Markdown 으로 바꿉니다

기획서와 보고서는 대부분 pptx·xlsx·pdf·docx·fig 로 옵니다. 이 형식들을 그대로 다루면 두 가지 중 하나가 일어납니다. Claude Code 가 이진 파일이라며 거부해서 아무것도 못 읽거나, 압축을 풀어 본문 XML 을 읽느라 토큰을 태우거나. 30MB 짜리 발표자료 하나가 XML 로는 **54만 토큰**이고, 200k 컨텍스트에는 들어가지도 않습니다.

doc2md 는 그 파일을 한 번 변환해 두고 원본 대신 변환본을 읽게 합니다. 같은 발표자료가 22,610 토큰이 됩니다.

**이 기능은 옵트인입니다.** 설치만으로는 켜지지 않고, 아래 두 명령을 모두 실행해야 동작합니다. 훅만 등록하고 변환기가 없으면 아무 일도 일어나지 않습니다.

세 가지 경로를 덮습니다. 각각 걸리는 지점이 다릅니다.

| 상황 | 개입 지점 |
|---|---|
| 프롬프트에 문서 경로를 적음 (`@경로`·따옴표·상대 경로 모두) | `UserPromptSubmit`. 변환한 뒤 변환본 경로를 컨텍스트로 넣습니다 |
| 작업 도중 문서를 `Read` | pdf 는 `PreToolUse(Read)` 가 잡습니다. pptx·xlsx·docx 는 Claude Code 가 이진 파일이라며 훅보다 먼저 거부하므로, 세션 시작 안내문이 모델에게 `doc2md <경로>` 를 실행하도록 지시합니다 |
| 문서를 메시지에 직접 첨부 | **훅으로 잡을 수 없습니다.** 어떤 훅 이벤트도 첨부 내용을 받지 못합니다. 세션 시작 안내문이 다음부터 경로로 달라고 사용자에게 안내하도록 모델에게 지시합니다 |

두 번째 줄의 제약은 실측으로 확인한 것입니다. `.pdf` 를 Read 하면 훅이 실행되고, 같은 세션에서 `.pptx` 를 Read 하면 훅 로그에 아무 기록도 남지 않습니다.

```bash
sprag doc2md on                  # 훅 등록 (변환기는 첫 문서에서 자동 설치)
sprag doc2md                     # 변환기·훅 등록 상태 확인
sprag doc2md 보고서.pptx          # 직접 변환해 결과 확인
sprag doc2md install-converter   # 설치를 미리 끝내 두고 싶을 때만
```

**변환기는 알아서 깔립니다.** 팀에 배포할 때 각자 설치 명령을 실행하게 만들면 그 단계에서 빠지는 사람이 생깁니다. 그래서 문서가 처음 등장하는 시점에 변환기가 백그라운드로 설치되고, 설치가 끝나는 대로 곧바로 변환합니다. 실측으로 첫 문서는 약 30초(설치 15초 + markitdown 최초 임포트), 이후로는 새 문서 3.7초, 캐시 적중 0.1초입니다. `.fig` 파서는 첫 Figma 파일에서 0.5초 만에 깔립니다.

설치는 `install` 단계가 아니라 첫 사용 시점에 합니다. venv 가 47MB 라서, 문서를 다루지 않는 사람은 낼 이유가 없는 비용입니다. 자동 설치를 끄려면 `CTS_DOC2MD_NO_AUTOINSTALL=1` 을 설정하십시오.

**파이썬 3.10 이상이 필요합니다.** markitdown 의 요구 사항이고, macOS 기본 `/usr/bin/python3` 는 3.9 입니다. 이 도구는 PATH 순서를 따르지 않고 3.10 이상인 인터프리터를 골라 venv 를 만듭니다. 3.9 로 만들면 pip 가 markitdown 을 2019 년 자리표시자 릴리스(0.0.1a1)로 해석해서, 설치는 성공한 것처럼 보이지만 모든 변환이 임포트 단계에서 죽습니다. 실제로 이 함정을 밟고 잡았습니다. 3.10 이상이 아예 없으면 설치 명령을 안내하는 대신 `brew install python` 을 안내합니다.

변환기는 도구 전용 venv(`<상태 디렉터리>/doc2md-venv`)에 설치합니다. 시스템 파이썬을 건드리지 않고, CLI를 지우면 함께 사라집니다. 이미 `uv tool` 이나 다른 경로에 markitdown 이 있으면 그쪽을 먼저 씁니다.

변환은 [markitdown](https://github.com/microsoft/markitdown)이 담당하며, 슬라이드 번호와 제목 계층, 표, 발표자 노트, 시트 구분이 모두 남습니다. 한글도 깨지지 않습니다.

몇 가지는 의도적으로 하지 않습니다.

- **이미지는 변환하지 않습니다.** markitdown 이 빈 결과를 돌려주고, OCR 은 실측에서 리소스 이름을 틀리게 읽었습니다(`c5.xlarge` 를 `c.xlarge` 로). 이름 자체가 내용인 문서에서는 텍스트가 없느니만 못합니다. 모델이 이미지는 직접 읽습니다.
- **변환기가 없어도 알리지 않고 지나가지 않습니다.** 설치 명령을 한 번 안내한 뒤 원본 `Read` 를 그대로 통과시킵니다. 매번 알리면 그것대로 방해가 되고, 아무 말도 하지 않으면 고장을 숨기게 됩니다. `doc2md` 를 인자 없이 실행하면 변환기와 훅 등록 상태를 한 번에 확인할 수 있습니다.
- **변환본은 프로젝트 안에 남기지 않습니다.** 도구의 상태 디렉터리 아래 권한 `0700` 으로 저장하므로 `.gitignore` 에 무엇을 추가할 필요가 없습니다. 파일명이 급여·계약·개인정보 같은 패턴에 걸리면 아예 변환하지 않습니다.
- **압축 폭탄은 막습니다.** pptx·xlsx·docx 는 zip 컨테이너입니다. 선언된 크기를 먼저 걸러 내고, 선언은 조작될 수 있으므로 실제 해제 바이트도 상한과 대조합니다.
- **엑셀은 행 수로 자릅니다.** 변환 시간은 파일 크기가 아니라 행 수를 따릅니다(실측: PDF 6.3MB 0.9초, 엑셀 5.8MB 47.75초). 5만 행을 넘으면 앞부분만 변환하고, **잘랐다는 사실과 전체 행 수를 안내에 함께 적습니다.**

### 더 깊은 내용은 별도 문서에 있습니다

절감액을 어떻게 실측해 산정하는지(PDF 첨부 대비, 오피스 XML 대비, `.fig` 고정 기준선), 피그마 `.fig` 변환, 문서를 수정할 때의 복사본·스크립트 절차, DRM·암호 문서 판별, Windows 지원 세부는 [docs/DOC2MD.md](./docs/DOC2MD.md)로 옮겼습니다. 요지는 세 가지입니다.

- 절감 기준선은 항상 실측치보다 **낮게** 잡습니다. 도구를 돋보이게 하는 숫자보다 신뢰할 수 있는 숫자가 가치 있습니다.
- `.fig` 절감이 가장 큽니다. `Read` 가 이진 파일을 거부하지 않고 그대로 읽어 회당 약 44,000 토큰을 태우기 때문입니다.
- 암호 문서와 DRM 문서는 오류가 아니라 상태로 판별해 안내합니다. 원본 `Read` 를 막지 않으므로 작업이 중단되지 않습니다.

## 🌐 Bedrock·Vertex 경유 환경

게이트웨이를 거치면 응답이 캐시 쓰기 합계만 내려보내고 5분·1시간 버킷별 분해 값은 채우지 않습니다. 그래서 이 도구가 "캐시 쓰기가 아직 없다"와 "이 제공자는 알려 주지 않는다"를 구별하지 못했고, 판정 불가일 때 1시간을 기본값으로 잡았습니다. Bedrock 은 5분 버킷만 제공하므로 남은 시간이 최대 12배로 부풀어 보였습니다.

v3.26.0부터 트랜스크립트의 모델 ID로 게이트웨이를 감지해 다음을 바로잡습니다.

- 판정 불가일 때의 카운트다운 기본값이 5분이 되고, 버킷 라벨이 `5m?` 로 표시됩니다. 실측값은 `5m`, 추정은 `5m?`, 근거 없음은 `?` 로 세 단계를 구분합니다.
- 5분 버킷에서는 카운트다운 색이 비율이 아니라 절대 시간을 따릅니다. 5분의 30%는 90초여서, 초록이 주는 여유가 실제와 어긋났습니다.
- `⚠ 5m TTL` 경고가 이 환경에도 도달합니다. 다만 조언 문구는 다릅니다. 구독 플랜을 바꿔도 해소되지 않는 환경이므로 플랜 전환을 권하지 않습니다.
- `Extra cost if 5m-only` 는 1시간 쓰기가 있는 경우에만 묻습니다. 이미 5분 전용인 환경에서는 질문 자체가 성립하지 않아 `+$0` 이 잘못 읽혔습니다.
- 위임 건이 모델 ID 해석 실패로 버려졌으면 statusline 에 `🔀 N unresolved` 로 알립니다. 이전에는 "위임한 적 없음"과 화면상 구별되지 않았습니다.
- 환경변수를 `foundation-model` ARN 으로 지정한 경우에도 모델을 해석합니다. 이름을 담고 있지 않은 `application-inference-profile` ID 는 그대로 거부합니다. 값을 추측해 넣으면 원장에 틀린 금액이 들어가기 때문입니다.

감지가 틀리면 `sprag mode ttl=5m`(또는 `ttl=1h`)로 직접 지정할 수 있습니다. 지정값이 실측값보다 우선합니다.

### LiteLLM: 5h/7d cap 대신 키 예산을 보여 줍니다 (v3.35.0)

LiteLLM 프록시로 Bedrock 등을 쓰면 Claude Code stdin 에 `rate_limits` 가 오지 않아 `✦ current`·`📅 weekly` 게이지가 아예 없습니다. 대신 LiteLLM 은 키별 `max_budget` 과 `spend` 를 관리하므로, 그 값을 가져와 같은 지점에 예산 게이지를 그립니다.

- 감지 조건: `ANTHROPIC_BASE_URL` 이 공식 엔드포인트가 아니고, `ANTHROPIC_AUTH_TOKEN`(또는 `ANTHROPIC_API_KEY`)이 설정된 환경.
- 조회는 LiteLLM 의 `GET /key/info` 와 `GET /user/info` 로 하고, 호출 키 자신의 정보만 받습니다. 예산 출처는 실무에서 가장 많이 쓰는 **팀 멤버십 예산**(team_memberships 의 spend·max_budget)을 먼저 보고, 없으면 키 자체의 max_budget, 그다음 internal user 예산 순으로 고릅니다. 렌더는 캐시 파일만 읽으며, 갱신은 5분에 한 번 분리된 백그라운드 프로세스가 수행합니다 (update-check 와 같은 구조라 statusline 이 네트워크를 기다리지 않습니다).
- `max_budget` 이 없는 무제한 키는 게이지를 만들지 않습니다. 이 경우에도 `💵` 월 지출 세그먼트는 세션 로그 기반이라 그대로 표시됩니다.
- 상태 확인: `sprag litellm-budget` (캐시 출력) · `litellm-budget --refresh` (즉시 조회).

세션 기본 모델이 sonnet 이면 sonnet 위임 규칙(T1)은 구조적으로 절감이 0입니다. 같은 급으로 내려보내 봐야 차액이 없기 때문이며 이는 정상 동작입니다. 다만 `route-scan rules` 가 이 경우를 "아직 위임 없음"과 같은 문구로 표시해 고장처럼 보였으므로, 이제 현재 기본 모델 기준으로 적용되지 않는다는 사실을 따로 적습니다.

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

![sprag: harness와 ratchet 도입 효과](./docs/harness-impact.png)

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
- 만료 직전 handoff 워크플로: statusline TTL 카운트다운을 보다가 만료 직전 `sprag handoff`로 작업 상태를 백업하고 새 캐시 사이클을 시작. 1M 경고·cap 칩도 같은 흐름으로 처리.
- ⚠️ 도입 후 데이터는 2일치(157msg)로 통계적 의미가 약하고, 주별 작업 토픽 차이가 섞여 있어 도구 효과만 깨끗이 분리되진 않습니다.
</details>

## 동작 원리 · 환경

Claude Code는 모든 API 응답을 `~/.claude/projects/<dir>/<session>.jsonl`에 기록합니다. 이 도구는 `cache_read_input_tokens`, `cache_creation.ephemeral_5m/1h_input_tokens` 등을 `requestId` 기준으로 중복 제거 후 집계합니다.

Node.js ≥ 18 · macOS / Linux / Windows / WSL · **의존성 0**.

<details>
<summary>알려진 환경 이슈 · 마이그레이션</summary>

**IntelliJ Claude Code plugin:** statusline 위젯이 프레임을 잘못 합성해 `59:548` 같은 잔재가 보이는 버그가 있습니다(이모지 출력에서만). v2.8.5+는 `TERMINAL_EMULATOR=JetBrains-JediTerm` 감지 시 자동으로 text 모드 폴백합니다.

**TTL 카운트다운이 멈춰 보일 때:** 카운트다운이 입력 없이도 초 단위로 줄어들려면 Claude Code 가 statusline 명령을 주기적으로 다시 실행해야 하고, 그 주기는 `~/.claude/settings.json` 의 `statusLine.refreshInterval`(초 단위, v2.1.97 이상)이 정합니다. 이 값이 없으면 대화가 갱신될 때만 다시 그려져서 멈춘 것처럼 보입니다. 터미널마다 동작이 다르면 세 가지를 확인하십시오. ① 그 머신의 Claude Code 버전이 2.1.97 이상인지, ② 프로젝트 `.claude/settings.json` 이나 `settings.local.json` 이 `statusLine` 을 refreshInterval 없이 덮어쓰고 있지 않은지, ③ statusline 래퍼가 PATH 에서 `sprag` 를 찾지 못해 매 렌더마다 `npx` 폴백으로 수 초씩 걸리고 있지 않은지 (비로그인 셸에서 nvm 이 로드되지 않는 터미널이 여기에 해당합니다). `sprag install` 을 다시 실행하면 refreshInterval 을 5초로 복구합니다.

**claude-cache-monitor에서 마이그레이션:**
```bash
npm uninstall -g claude-cache-monitor && npm i -g sprag-cli
```
`~/.claude/settings.json`의 `statusLine.command`도 `sprag …`로 교체하세요.
</details>

## 릴리스 노트

전체 내역은 [CHANGELOG.md](./CHANGELOG.md)로 옮겼습니다. 최근 변경은 다음과 같습니다.

- **v3.39.0**: `feedback` 서브커맨드가 터미널이나 Claude 세션에서 버그 제보·기능 제안을 바로 제출합니다. gh CLI가 있으면 이슈 직접 등록, 없으면 로그인 없는 익명 제출(릴레이가 이슈로 자동 등록), 오프라인이면 로컬 저장. `install`은 기존 statusline이 있으면 조용히 건너뛰지 않고 교체 여부를 묻습니다.
- **v3.38.0**: `cohesion on`이 응집성 다섯 원칙을 영어 블록으로 주입합니다. 옵트인이고, korean 지침이 켜져 있으면 중복 주입을 막습니다.
- **v3.37.0**: 한국어 지침에 보강 지침(supplement)이 붙습니다. 번역투·상투 패턴·응집성(문장 이어짐) 조항이며, 쓰기 시점 검사에도 번역투 5종이 추가됐습니다. 실파일 255개 실측에서 오탐 1건으로 검증했습니다.
- **v3.35.0**: 이번 달 1일 00시 이후 지출 추정치를 `💵 Sep $42` 세그먼트로 상시 표시합니다. LiteLLM 게이트웨이 사용자는 키의 max_budget/spend 를 `🔑 budget` 게이지로 봅니다 (5h/7d cap 이 없는 Bedrock·LiteLLM 환경 대응).
- **v3.34.0**: seed 프리셋 제안, 설치 시 출력 언어 선택, 컨텍스트 경고 500k 상향. 상세는 CHANGELOG 참고.

## 피드백

버그 제보와 기능 제안은 GitHub 이슈로 받습니다: https://github.com/rootstudioyaml/sprag/issues

브라우저나 GitHub 로그인이 어려운 환경(사내망, 세션 도중)이라면 터미널에서 바로 제출할 수 있고, Claude에게 대신 제출해 달라고 요청해도 됩니다.

```bash
sprag feedback "Bedrock에서 5m TTL 칩이 사라지지 않아요"
```

`gh` CLI가 인증되어 있으면 GitHub 이슈로 바로 등록하고, 없으면 로그인이 필요 없는 익명 경로로 제출합니다(github.com이 막힌 사내망에서도 동작합니다). `gh` 경로를 건너뛰려면 `--anonymous`를 붙입니다. 도구 버전과 OS 정보는 자동으로 첨부됩니다.

버그를 제보하실 때는 도구 버전(`sprag --version`)과 OS를 함께 적어 주시고, statusline이나 경고 관련 문제라면 statusline 출력이나 `sprag last` 결과를 덧붙여 주시면 원인을 빨리 찾을 수 있습니다.

## 라이선스

MIT

---

## 만든 곳

[![DeepPulse YouTube](https://img.shields.io/badge/YouTube-@DeepPulseKR-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseKR)
[![DeepPulseEN YouTube](https://img.shields.io/badge/YouTube-@DeepPulseEN-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseEN)
[![Homepage](https://img.shields.io/badge/Homepage-rootstudioyaml.github.io-2ea44f)](https://rootstudioyaml.github.io/)

AI 개발 도구를 다루는 채널 **DeepPulse**에서 만들고 씁니다. 이 도구의 배경과 사용법은 [출시 영상(60초)](https://www.youtube.com/shorts/RaD8qMsPTnA)에서 볼 수 있습니다.
