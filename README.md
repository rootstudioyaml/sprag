**한국어** · [English](./README.en.md)

[![DeepPulse YouTube](https://img.shields.io/badge/YouTube-@DeepPulseKR-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseKR)
[![DeepPulseEN YouTube](https://img.shields.io/badge/YouTube-@DeepPulseEN-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseEN)
[![Homepage](https://img.shields.io/badge/Homepage-rootstudioyaml.github.io-2ea44f)](https://rootstudioyaml.github.io/)
[![npm](https://img.shields.io/npm/v/claude-token-saver.svg)](https://www.npmjs.com/package/claude-token-saver)

# claude-token-saver

**Claude Code 토큰 사용량을 statusline 한 줄로 진단하고 절약하는 CLI.** 의존성 0, 설치 한 줄이면 끝.

```bash
npm i -g claude-token-saver   # postinstall이 statusline + Skill 자동 등록
```

![statusline 예시](./docs/statusline.png)

## ⚡ 왜 쓰나 — 30초 요약

| | |
|---|---|
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
| `claude-token-saver frugon` | 세션 기록 → [frugon](https://github.com/Rodiun/frugon) 호환 JSONL 내보내기 (모델 라우팅 절감 분석, 아래 참고) |
| `claude-token-saver route-scan` | 상위 모델이 반복 처리한 easy 작업 감지 → haiku 위임 랫쳇 룰 제안 (아래 참고) |
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
claude-token-saver harness pull                # 글로벌 랫쳇 룰을 이 프로젝트로 가져오기 (중복 자동 스킵)
claude-token-saver harness pull --harness      # 글로벌 하네스 블록(5개 섹션)까지 함께 가져오기
claude-token-saver harness list / rm <N>       # 룰 조회 / 삭제 (자동 .bak)
claude-token-saver harness off | on            # 🅷 표시 토글
```

- `promote`는 non-TTY(스크립트·LLM 호출)에서 `--project`/`--global` 플래그가 **필수** — 스코프가 묻지 않고 결정되는 사고를 막기 위한 설계입니다.
- 설치(`install`)나 `init`은 프로젝트에 룰을 자동 주입하지 않습니다. 글로벌에 쌓아둔 룰을 새 프로젝트에서 쓰고 싶을 때만 `harness pull`로 명시적으로 가져오세요 (재실행해도 중복 없음).
- 🅷⚠ 런타임 경고(`ratchet?` `no-evidence` `PEV-skip`)는 30분 후 자동 만료되고, 하위 디렉터리 세션도 프로젝트에 올바르게 매칭됩니다. PEV-skip은 변경성 도구(Edit/Write/Bash)만 카운트해 읽기 위주 세션에서는 발동하지 않습니다 (v2.16.0+).

<details>
<summary>⚠️ <code>harness rm</code>은 신중하게 — 삭제 전 체크리스트</summary>

ratchet의 가치는 **한 방향 누적**에 있습니다. 룰을 가볍게 지우면 같은 실수가 다시 새기 시작합니다.

- **룰이 너무 광범위해서 정상 케이스도 막나?** → ❌ 삭제 ✅ 조건을 좁혀 다듬기 (예: `"하드코딩 금지"` → `"테스트 외 코드에서 하드코딩 금지"`)
- **룰이 너무 좁아 거의 발동 안 되나?** → ❌ 삭제 ✅ 그냥 두기 (비용 0)
- **정말 잘못된 룰이라 확신?** → ✅ 그때만 삭제

삭제 시 `.bak`이 남지만 **그 룰이 박힌 세션 컨텍스트(왜)는 복원되지 않습니다.**
</details>

## 🔀 frugon 연계 — "어떤 호출을 싼 모델로 내릴 수 있나"

claude-token-saver가 캐시·컨텍스트 낭비를 잡는다면, [frugon](https://github.com/Rodiun/frugon)(로컬 LLM 비용 분석기)은 **모델 라우팅** 절감 — 굳이 비싼 모델이 필요 없는 호출 찾기 — 을 다룹니다. `frugon` 서브커맨드가 둘을 연결합니다:

```bash
claude-token-saver frugon               # 최근 30일 세션 → ./frugon-export.jsonl
claude-token-saver frugon --run         # 내보내기 + frugon analyze 바로 실행
claude-token-saver frugon --days 7 --project myproj --out logs.jsonl
```

- `~/.claude/projects/`의 transcript를 frugon이 읽는 OpenAI 호환 JSONL로 변환합니다. **분석은 전부 로컬** — 로그도 키도 밖으로 나가지 않습니다 (frugon의 원칙과 동일).
- **캐시 가중 토큰(기본):** frugon은 프롬프트 캐싱을 모르기 때문에 물리 토큰을 그대로 주면 비용이 ~10배 과대평가됩니다. 기본값은 캐시 read 0.1x · 5m write 1.25x · 1h write 2x를 접어 넣은 유효 토큰이라 frugon의 달러 견적이 실제 청구액과 일치합니다. 물리 토큰이 필요하면 `--raw-tokens`.
- frugon의 easy/hard 분류가 쓰는 신호(프롬프트·응답 토큰, 대화 깊이)와 `--measure` 품질 검증에 쓰는 마지막 유저 프롬프트·응답 텍스트를 보존합니다. 텍스트를 빼고 싶으면 `--no-content`.
- frugon 설치: `pipx install frugon` (모델이 unpriced로 나오면 `frugon update`).

## 🔀 route-scan — "이 반복 작업, haiku로 내려도 됩니다"

frugon 연계의 실전 버전입니다. frugon식 난이도 분석을 **에피소드(사용자 요청) 단위**로 세션 기록에 적용해, 상위 모델(opus/fable)이 반복 처리해 온 easy 작업을 찾아 haiku 서브에이전트 위임 룰로 승격하도록 제안합니다. 전 과정 로컬, 토큰 비용 0.

```bash
claude-token-saver route-scan                    # 스캔 (24h 캐시) + 후보 출력
claude-token-saver harness promote R1 --project  # 후보 R1을 랫쳇 룰로 등록
claude-token-saver route-scan dismiss 1          # 관심 없으면 무시 (재스캔에도 안 뜸)
```

동작 구조 (실시간 라우팅이 아니라 **세션 경계 캘리브레이션**):
1. `install` 시 SessionStart 훅이 등록되어, 새 세션 시작·`/clear` 때 캐시된 스캔 결과를 세션 컨텍스트로 주입합니다 (스캔 자체는 백그라운드에서 일 1회).
2. 반복(≥3회) easy 패턴이 있으면 statusline에 `🅷⚠ route? R1` 칩이 뜨고, Claude가 등록 여부와 scope(`--project`/`--global`)를 물어봅니다.
3. 등록된 룰은 ratchet.md에 쌓여 **다음 세션부터 메인 모델이 해당 유형을 haiku 서브에이전트로 자동 위임**합니다.

권장 사전 준비: `~/.claude/agents/`에 `model: haiku` 서브에이전트(예: haiku-explore / haiku-runner / haiku-translate)를 만들어 두면 룰이 바로 실행 가능해집니다.

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

### v3.0.0 (2026-07-13)
- **메이저 승격** — v2.19 frugon 연계 + v2.20 route-scan으로 "사후 토큰 모니터링 도구"에서 "반복 easy 작업을 싼 모델로 내려보내는 라우팅 계층"으로 제품 성격이 바뀌어 메이저 버전을 올립니다. Breaking change는 없습니다 (기존 명령·설정 전부 호환).
- **route-scan promote 교정** — `harness promote R<N> --project`가 이제 후보가 **감지된 프로젝트**의 `.claude/ratchet.md`에 룰을 기록합니다 (이전에는 CLI를 실행한 디렉터리에 기록되는 버그). 스캔이 후보에 실제 세션 경로(`projectPath`)를 저장하며, 이 필드가 없는 구버전 캐시에서 다른 프로젝트 후보를 승격하려 하면 `route-scan --refresh`를 안내하고 중단합니다.
- **`harness pull` 신설** — 글로벌 랫쳇 룰을 프로젝트로 명시적으로 가져옵니다 (`--harness`로 글로벌 하네스 블록까지). 룰 텍스트 기준 중복 자동 스킵이라 재실행해도 안전(멱등). 설치·init은 계속 아무것도 자동 주입하지 않습니다 — 가져오기는 항상 opt-in.

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
