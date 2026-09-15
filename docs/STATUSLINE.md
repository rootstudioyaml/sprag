# Statusline reference

[← README](../README.md) · [한국어](#한국어)

## Reading the statusline

Once the savings ledger has entries it renders as **two rows** — routing savings on row 1, diagnostics on row 2.

```
🔀 Routing saved $2.09  |  fable→sonnet 1× $0.72 · opus→haiku 1× $0.57
⚠ Ctx 500k+ · 🅷 5/5 · 🤖 Opus 5 · 🧠 Cache hit 98.8% · ⏳ Cache expires 59:46 · ✦ current ███▓░░ 62% 🔄 21:33 · 📅 weekly ██▒░░░ 38% 🔄 Tue 19:33 · 📦 Ctx 47% of 1M · 💰 Cache saved $1.0K · last 1d
```

With an empty ledger (no measured delegation yet) row 1 is not drawn and the layout stays single-line. If your build renders only the first row (some macOS Claude Code versions), pass `--single-line`.

| Segment | Meaning |
|---|---|
| `🔀` **row 1** | Lifetime routing savings + the model moves behind them. The breakdown sums exactly to the total, model names keep only the family (`opus→haiku`). Full audit: `route-scan savings` |
| `📄` **row 2** | Lifetime doc2md conversion savings with a per-format breakdown. Whichever of routing/conversion saved more takes row 1 |
| `🤖` | Active model |
| `🅷 5/5` | Harness principle score ([Harness mode](./HARNESS.md)) |
| `🧠` | Cache hit rate (green at 85%+) |
| `⏳` | Cache TTL countdown — send a message before expiry to keep the cache warm. Ticking while idle requires Claude Code v2.1.97+ (see [If the countdown looks frozen](./GATEWAYS.md)) |
| `✦ current` / `📅 weekly` | 5-hour / 7-day rate-limit window usage + reset time |
| `📦` | Context usage (e.g. `Ctx 68% of 1M`) — colored by fill. Current models default to 1M with no premium, but token volume itself drives per-turn cost and 5H/7D burn |
| `💵 Sep $42` | **Estimated spend since 00:00 on the 1st of this month** (local time). Summed per session with that session's model pricing; always shown, even on gateways with no 5h/7d caps (v3.35.0) |
| `🔑 budget` | **LiteLLM key budget gauge.** When stdin carries no rate_limits, shows the key's `spend` against `max_budget` as `🔑 budget ▰▱ 34% $34/$100` (v3.35.0, [below](./GATEWAYS.md)) |
| `💰` | Cumulative savings from prompt caching — a **different** number from row 1's `🔀` (model routing) |
| `v3.24.0` | The version you are running. Gray, at the tail, when it is the latest one |
| `⬆ v3.24.0 → 3.25.0` | A newer release exists. Actionable, so it moves to the front of the line ([Update notifications](#-update-notifications)) |

When something is wrong, a **warning chip leads the line**:

```
🚨 5H █████▓ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 4.8 · 🧠 Cache hit 72.1% · ⚠ Cache miss · 📅 weekly ▓░░░░░ 12% 🔄 Sun 14:26 · 📦 Ctx 200k · last 1d
```

Chips — `🚨 5H/7D NN%` (cap imminent) · `⚠ Ctx 500k+` (a single request actually exceeded 500k) · `⚠ Cache miss` · `⚠ Input spike` · `⚠ Output heavy` · `⚠ Call surge` · `⚠ Rebuild churn` · `⚠ 5m TTL`. When both windows cross 90% at once, the sooner-resetting one is promoted to 🚨 and the other stays visible as a red segment (v2.16.0+).

### When a chip appears

Run the `/claude-token-saver` Skill inside Claude — or just say the chip wording ("5H cap is up", "cache miss") and it auto-activates. The Skill surfaces the **root-cause code + step-by-step fix**. When a cap is imminent, run `sprag handoff` to back up your work state to markdown and continue in a fresh session.

## ⬆ Update notifications

A statusline cannot open a dialog, and it re-renders every ~300ms, so it can never touch the network while drawing. The notification is therefore split in two:

- **The statusline tells you.** Up to date: a quiet gray `v3.24.0` at the tail. Newer release out: `⬆ v3.24.0 → 3.25.0` in yellow, moved to the front. Never red — nothing is broken.
- **Session start asks you.** On a new session or `/clear`, the SessionStart hook injects one line telling the model a newer version exists and to ask before installing anything. Only after you agree does it run `sprag upgrade`.
- **Declining sticks.** `sprag update-check --dismiss` mutes the offer for that version; the next release asks again. The statusline chip stays — you declined the question, not the fact.

The registry lookup runs at most once every 24h in a detached background process and only ever writes a cache file (`update-check.json`) — the same shape npm's `update-notifier` uses. A failed check still stamps its timestamp, so an offline machine backs off instead of retrying on every render. Turn checks off entirely with `CTS_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER`.

## Spike issue codes

| Code | Meaning |
|---|---|
| `LARGE_INPUT_PER_REQUEST` | single request > 200k input tokens — per-turn re-billing and cap burn spike |
| `LOW_HIT_RATE` | cache hit rate < 50% |
| `BUCKET_5M_DOMINANT` | > 70% of cache writes hit the 5m bucket |
| `HIGH_OUTPUT_RATIO` | output/input > 0.15 (output is 5× input price) |
| `HIGH_REQUEST_COUNT` | session made 3×+ your median (tool loop?) |
| `FREQUENT_CACHE_REBUILD` | `cache_creation` > `cache_read` |

Remediation commands are OS-aware (`~/.zshrc` for macOS/Linux/WSL, `setx` for Windows).

---

<a id="한국어"></a>

# Statusline reference (한국어)

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
| `🅷 5/5` | harness 원칙 점수 ([Harness 모드](./HARNESS.md#한국어)) |
| `🧠` | 캐시 히트율 (85%+ 녹색) |
| `⏳` | 캐시 TTL 카운트다운입니다. 만료되기 전에 메시지를 보내면 캐시가 유지됩니다. 입력이 없을 때도 초 단위로 줄어드는 표시는 Claude Code v2.1.97 이상에서 동작합니다 (아래 [카운트다운이 멈춰 보일 때](./GATEWAYS.md#한국어) 참고) |
| `✦ current` / `📅 weekly` | 5시간 / 7일 rate-limit 윈도 사용률 + 리셋 시각 |
| `📦` | 컨텍스트 사용률입니다(예: `Ctx 68% of 1M`). 사용률에 따라 녹색·노란색·빨간색으로 표시합니다. 최신 모델은 1M 컨텍스트가 기본이고 별도 요금이 붙지 않지만, 토큰량 자체가 턴당 비용과 5시간·7일 한도를 빠르게 소모시킵니다 |
| `💵 Sep $42` | **이번 달 1일 00시(로컬) 이후 지출 추정치**입니다. 세션 로그에 세션별 모델 단가를 적용해 합산하며, 5h/7d cap 이 없는 게이트웨이 환경에서도 항상 표시됩니다 (v3.35.0) |
| `🔑 budget` | **LiteLLM 게이트웨이 키의 예산 게이지**입니다. stdin 에 rate_limits 가 오지 않는 환경에서 키의 `max_budget` 대비 `spend` 를 `🔑 budget ▰▱ 34% $34/$100` 형태로 보여 줍니다 (v3.35.0, [아래](./GATEWAYS.md#한국어)) |
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

## ⬆ 업데이트 안내

statusline은 대화 상자를 띄울 수 없고, 300밀리초마다 다시 그려지기 때문에 그리는 시점에 네트워크를 쓸 수도 없습니다. 그래서 안내를 두 지점으로 나누었습니다.

- **statusline은 알리기만 합니다.** 최신 버전이면 줄 끝에 `v3.24.0`을 회색으로 조용히 표시하고, 새 버전이 있으면 `⬆ v3.24.0 → 3.25.0`을 줄 앞쪽에 노란색으로 올립니다. 빨간색은 쓰지 않습니다. 무엇도 고장 난 상태가 아니기 때문입니다.
- **묻는 일은 세션 시작에서 합니다.** 새 세션이나 `/clear` 시점에 SessionStart 훅이 "새 버전이 있으니 사용자에게 업그레이드할지 물어보라"는 한 줄을 모델에게 주입합니다. 모델은 사용자에게 확인한 뒤에만 `sprag upgrade`를 실행합니다. 묻지 않고 설치하지 않습니다.
- **거절은 기억합니다.** 사용자가 원치 않으면 `sprag update-check --dismiss`로 그 버전을 묻지 않도록 설정합니다. 더 새로운 버전이 배포되면 다시 묻습니다. statusline 칩은 그대로 남습니다. 거절한 것은 질문이지, 새 버전이 있다는 사실이 아니기 때문입니다.

버전 조회는 24시간에 한 번, 분리된 백그라운드 프로세스가 수행하고 결과만 파일에 남깁니다(`update-check.json`). 이 방식은 npm의 `update-notifier`가 쓰는 것과 같습니다. 네트워크가 끊겨 있어도 실패 시각을 기록해 두므로 매 렌더마다 재시도하지 않습니다. 확인 자체를 끄려면 환경 변수 `CTS_NO_UPDATE_CHECK=1` 또는 `NO_UPDATE_NOTIFIER`를 설정하십시오.

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
