<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/site/assets/logo/sprag-lockup.svg">
  <img alt="Sprag" src="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/site/assets/logo/sprag-lockup-light.svg" width="220">
</picture>

**AI 코딩 에이전트용 품질 래칫**<br>**같은 실수는 두 번 없습니다**

[![npm](https://img.shields.io/npm/v/sprag-cli.svg?label=sprag-cli)](https://www.npmjs.com/package/sprag-cli)
[![downloads](https://img.shields.io/npm/dm/claude-token-saver.svg)](https://www.npmjs.com/package/claude-token-saver)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[sprag.io](https://sprag.io) · [벤치마크](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md) · [English](https://github.com/rootstudioyaml/sprag/blob/main/README.md)

</div>

---

---

# Sprag

**AI 코딩 에이전트에 거는 품질 래칫입니다. 에이전트는 그대로 일하고, 퇴행만 막습니다.** 이름은 스프래그 클러치에서 왔습니다. 앞으로 도는 힘은 그대로 통과시키고, 역회전하는 순간 잠기는 부품입니다. Sprag는 Claude Code가 이미 남기는 세션 기록을 읽어 누적되는 이득으로 바꿉니다. 되풀이된 실패는 세션마다 올라오는 규칙이 되고, 저렴한 티어가 감당한다고 증명된 작업은 절감액 원장을 영수증 삼아 그쪽으로 위임되며, 캐시와 사용량 한도 문제는 아직 손쓸 수 있을 때 statusline에 나타납니다.

의존성 0, API 키 불요, 데이터는 컴퓨터 밖으로 나가지 않습니다.

```bash
npm i -g sprag-cli   # 예전 이름 claude-token-saver 와 같은 패키지입니다
```

![statusline 예시. 첫 줄은 라우팅 절감액, 둘째 줄은 문서 변환 절감액, 셋째 줄은 진단 칩입니다](./docs/statusline.png)

## 숫자 네 개

| 지표 | 결과 | | 근거 |
|---|---|---|---|
| 공개 벤치마크 정확도 | **59.1%** · 단일 최고 모델 57.9% | `▰▰▰▰▰▰▰▰▰▰▰▰` | [벤치마크](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md) |
| 같은 문항 총비용 | **$268** · gpt-5 $388 · gemini-2.5-pro $734 | `▰▰▰▰▰▱▱▱▱▱▱▱` | [벤치마크](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md) |
| 문서 토큰 | **−95.8%** · 540,429 → 22,610 | `▰▱▱▱▱▱▱▱▱▱▱▱` | [doc2md](https://github.com/rootstudioyaml/sprag/blob/main/docs/DOC2MD.md) |
| 메시지당 비용 | **−18.6%** · $2.345 → $1.910 | `▰▰▰▰▰▰▰▰▰▰▱▱` | [실측 리포트](#실제-효과-도입-전후-리포트) |

```text
                      정확도            총비용 (11,696문항)
티어 기준 라우터      59.1%  ← 최고     $268  ▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱
gpt-5                 57.8%             $388  ▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱
gemini-2.5-pro        57.9%             $734  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
```

라우팅 절감액은 추정치가 아니라 위임 한 건 한 건의 차액을 적은 원장입니다. `sprag route-scan savings` 가 모든 금액을 룰 단위까지 역추적해 보여 줍니다. 집계에서 무엇을 빼는지까지 [원장 문서](https://github.com/rootstudioyaml/sprag/blob/main/docs/COMMANDS.md)에 적어 두었습니다.

## 설치 한 번에 전부 들어 있고, 첫날부터 동작합니다

| | 하는 일 | 더 보기 |
|---|---|---|
| ⚙️ **래칫 규칙** | 되풀이된 실패가 한 줄짜리 규칙이 되어 매 세션에 올라옵니다. 후보는 기록에서 자동으로 찾아 줍니다. | [Harness](https://github.com/rootstudioyaml/sprag/blob/main/docs/HARNESS.md) |
| 🔀 **모델 피팅** | 기록에서 뽑은 위임 규칙에 측정한 오류율과 절감액을 붙여 `ratchet-model.md`에 적습니다. | [route-scan](https://github.com/rootstudioyaml/sprag/blob/main/docs/ROUTE_SCAN.md) |
| 🅷 **하네스 점수** | 다섯 가지 운영 원칙을 실시간으로 점검합니다. 검증 단계를 건너뛰면 `🅷 4/5`가 먼저 알려 줍니다. | [Harness](https://github.com/rootstudioyaml/sprag/blob/main/docs/HARNESS.md) |
| 📊 **토큰 텔레메트리** | 캐시 적중률과 TTL, 컨텍스트 크기, 출력 급증, 두 가지 사용량 한도를 매 턴 표시합니다. | [statusline](https://github.com/rootstudioyaml/sprag/blob/main/docs/STATUSLINE.md) |
| 📄 **doc2md** | pptx와 xlsx, pdf, docx, fig를 필요할 때 Markdown 으로 바꿔 읽습니다. | [doc2md](https://github.com/rootstudioyaml/sprag/blob/main/docs/DOC2MD.md) |
| 🇰🇷 **문체 게이트** | 쓰는 시점에 hook으로 검사합니다. 이중 피동과 번역투, 문장 연결을 살핍니다. | [문체 지침](https://github.com/rootstudioyaml/sprag/blob/main/docs/KOREAN-STYLE.md) |

실측 −18.6%는 하네스와 래칫의 몫이고, 라우팅과 문서 변환 절감액은 그 위에 얹힙니다. 두 절감액은 성격이 달라서 한 숫자로 합치지 않습니다.

## statusline 한 줄로 보는 상태

```
🔀 라우팅 절감 $2.09  |  fable→sonnet 1회 $0.72 · opus→haiku 1회 $0.57
🚨 5H █████▓ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 5 · 🧠 Cache hit 98.8% · ⏳ Cache expires 59:46 · 📅 weekly ██▒░░░ 38% · 💵 Sep $42 · 📦 Ctx 47% of 1M
```

문제가 생기면 경고 칩이 줄 맨 앞으로 옵니다. `🚨 5H/7D NN%`, `⚠ Ctx 500k+`, `⚠ Cache miss`, `⚠ Input spike`, `⚠ Output heavy`, `⚠ Call surge`, `⚠ Rebuild churn`, `⚠ 5m TTL` 여덟 가지이며, 칩 문구를 그대로 말하면 Skill이 원인 코드와 조치 순서를 꺼내 줍니다. 세그먼트별 의미와 색 기준은 [statusline 문서](https://github.com/rootstudioyaml/sprag/blob/main/docs/STATUSLINE.md)에 정리했습니다.

## 실제 효과: 도입 전후 리포트

![sprag: harness와 ratchet 도입 효과](./docs/harness-impact.png)

harness 5/5 + ratchet을 실제 적용한 전후 비교입니다 (저자 Claude Code 로그, **사용자 메시지 1건당** 정규화, 2026-05-02 기준, Opus 4.7 가격).

| 메트릭 | 도입 전 (7일/739msg) | 도입 후 (2일/157msg) | 변화 |
|---|---:|---:|---:|
| 메시지당 비용 | $2.345 | $1.910 | **−18.6%** |
| 메시지당 출력 토큰 | 7,391 | 6,052 | −18.1% |
| 메시지당 assistant 왕복 | 9.73 | 8.83 | −9.2% |
| 메시지당 도구 호출 | 5.72 | 5.25 | −8.2% |

같은 요청을 더 적은 왕복으로 끝내므로 첫 시도 적중률이 오릅니다. PEV와 Structured Task가 한 번에 가게 만든 효과로 보입니다. 표본이 2일치(157msg)라 통계적 의미는 약하고, 주별 작업 토픽 차이도 섞여 있습니다.

## 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `sprag` | 최근 1일 진단 리포트 |
| `sprag handoff` | 한도에 막히기 전에 작업 상태를 백업 |
| `sprag route-scan` | 내 기록에서 위임 후보 찾기 (LLM 호출 0회) |
| `sprag route-scan savings` | 라우팅 절감 원장 조회 |
| `sprag harness check` | 🅷 하네스 점수 확인 |
| `sprag doc2md <파일>` | 문서 한 건을 Markdown 으로 변환 |

전체 명령과 옵션, 출력 언어 설정은 [명령 문서](https://github.com/rootstudioyaml/sprag/blob/main/docs/COMMANDS.md)에 있습니다.

## 더 깊은 내용

| 문서 | 다루는 내용 |
|---|---|
| [설치와 기본 설정](https://github.com/rootstudioyaml/sprag/blob/main/docs/INSTALL.md) | 설치 직후 켜지는 기능, 직접 켜야 하는 기능, 끄는 방법 |
| [statusline](https://github.com/rootstudioyaml/sprag/blob/main/docs/STATUSLINE.md) | 세그먼트 의미, 경고 칩, 토큰 급증 원인 코드, 업데이트 안내 |
| [명령](https://github.com/rootstudioyaml/sprag/blob/main/docs/COMMANDS.md) | 전체 서브커맨드와 CLI 옵션 |
| [Harness](https://github.com/rootstudioyaml/sprag/blob/main/docs/HARNESS.md) | 5원칙, 래칫 승격, compact-window 고정, seed 프리셋 |
| [route-scan](https://github.com/rootstudioyaml/sprag/blob/main/docs/ROUTE_SCAN.md) | 티어 판정, 룰 파일 구조, 스캔 시점, 서브에이전트 설정 |
| [티어 판별 기준](https://github.com/rootstudioyaml/sprag/blob/main/docs/TIER_CRITERIA.md) | T0·T1·T2 를 가르는 근거와 연구 출처 |
| [벤치마크](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md) | LLMRouterBench 11,696문항 재현 결과 |
| [doc2md](https://github.com/rootstudioyaml/sprag/blob/main/docs/DOC2MD.md) | 변환 대상 포맷, 절감 근거, 문서 수정 절차, DRM 문서 |
| [한국어 문체 지침](https://github.com/rootstudioyaml/sprag/blob/main/docs/KOREAN-STYLE.md) | 주입 내용, 쓰기 시점 검사, 적용 전후 비교 |
| [라우터가 아닌 이유](https://github.com/rootstudioyaml/sprag/blob/main/docs/NOT-A-ROUTER.md) | 실시간 라우팅이 캐시를 깨서 비용을 키우는 구조 |
| [게이트웨이와 환경](https://github.com/rootstudioyaml/sprag/blob/main/docs/GATEWAYS.md) | Bedrock·Vertex·LiteLLM, 가격표, FAQ, 동작 원리 |

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
