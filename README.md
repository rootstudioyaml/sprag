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
| `📦` | 컨텍스트 윈도 (1M이면 빨간 경고 — 비용 급증 요인) |
| `💰` | 캐시가 절약해준 누적 금액 |

문제가 감지되면 **경고 칩이 맨 앞에** 붙습니다:

```
🚨 5H █████▓ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 4.8 · 🧠 Cache hit 72.1% · ⚠ Cache miss · 📅 weekly ▓░░░░░ 12% 🔄 Sun 14:26 · 📦 Ctx 200k · last 1d
```

칩 종류 — `🚨 5H/7D NN%`(캡 임박) · `⚠ 1M ON` · `⚠ Cache miss` · `⚠ Input spike` · `⚠ Output heavy` · `⚠ Call surge` · `⚠ Rebuild churn` · `⚠ 5m TTL`. 두 윈도가 동시에 90%+면 리셋이 임박한 쪽이 🚨로 승격되고 나머지는 빨간 세그먼트로 유지됩니다 (v2.16.0+).

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
| `claude-token-saver install` | Skill·statusline 수동 등록 |

출력 언어는 `mode ko` / `mode en`으로 전환합니다 (기본 영어, statusline 칩은 항상 기호). 전체 옵션은 [영문 README](./README.en.md#options) 참고.

## 🅷 Harness 모드

다섯 원칙(Ratchet · Evidence · PEV · Structured Task · Default Safe Path)을 한 줄 명령으로 `CLAUDE.md`에 셋업하고 statusline이 `🅷 5/5`로 점수화합니다. 같은 에러가 반복되면 `🅷⚠ ratchet?` 알림이 떠서 룰로 승격할 수 있습니다.

```bash
claude-token-saver harness init                # 이 프로젝트에 셋업
claude-token-saver harness init --global       # ~/.claude/CLAUDE.md — 모든 프로젝트 적용
claude-token-saver harness check               # 현재 점수 (글로벌 fallback 인정)
claude-token-saver harness promote <N> --project|--global   # 경고 #N → ratchet 룰 (스코프 필수)
claude-token-saver harness list / rm <N>       # 룰 조회 / 삭제 (자동 .bak)
claude-token-saver harness off | on            # 🅷 표시 토글
```

- `promote`는 non-TTY(스크립트·LLM 호출)에서 `--project`/`--global` 플래그가 **필수** — 스코프가 묻지 않고 결정되는 사고를 막기 위한 설계입니다.
- 🅷⚠ 런타임 경고(`ratchet?` `no-evidence` `PEV-skip`)는 30분 후 자동 만료되고, 하위 디렉터리 세션도 프로젝트에 올바르게 매칭됩니다. PEV-skip은 변경성 도구(Edit/Write/Bash)만 카운트해 읽기 위주 세션에서는 발동하지 않습니다 (v2.16.0+).

<details>
<summary>⚠️ <code>harness rm</code>은 신중하게 — 삭제 전 체크리스트</summary>

ratchet의 가치는 **한 방향 누적**에 있습니다. 룰을 가볍게 지우면 같은 실수가 다시 새기 시작합니다.

- **룰이 너무 광범위해서 정상 케이스도 막나?** → ❌ 삭제 ✅ 조건을 좁혀 다듬기 (예: `"하드코딩 금지"` → `"테스트 외 코드에서 하드코딩 금지"`)
- **룰이 너무 좁아 거의 발동 안 되나?** → ❌ 삭제 ✅ 그냥 두기 (비용 0)
- **정말 잘못된 룰이라 확신?** → ✅ 그때만 삭제

삭제 시 `.bak`이 남지만 **그 룰이 박힌 세션 컨텍스트(왜)는 복원되지 않습니다.**
</details>

## 토큰 급증 원인 코드

| 코드 | 의미 |
|---|---|
| `LARGE_INPUT_PER_REQUEST` | 단일 요청 250k+ → 1M 컨텍스트 의심 |
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
