# Statusline reference

[← README](../README.md) · [한국어](#한국어)

## Reading the statusline

Once the savings ledger has entries it renders as **two rows** — routing savings on row 1, diagnostics on row 2.

```
🔀 Routing saved $2.09  |  fable→sonnet 1× $0.72 · opus→haiku 1× $0.57
⚠ Ctx 500k+ · 🅷 5/5 · 🤖 Opus 5 · 🧠 Cache hit 98.8% · ⏳ Cache expires 59:46 · ✦ current ▰▰▰▰▰▰▰▱▱▱▱▱ 62% 🔄 21:33 · 📅 weekly ▰▰▰▰▰▱▱▱▱▱▱▱ 38% 🔄 Tue 19:33 · 📦 Ctx 47% of 1M · 💰 Cache saved $1.0K · last 1d
```

With an empty ledger (no measured delegation yet) row 1 is not drawn and the layout stays single-line. If your build renders only the first row (some macOS Claude Code versions), pass `--single-line`.

| Segment | Meaning |
|---|---|
| `🔀` **row 1** | Lifetime routing savings + the model moves behind them. The breakdown sums exactly to the total, model names keep only the family (`opus→haiku`). Full audit: `route-scan savings` |
| `📄` **row 2** | Lifetime doc2md conversion savings with a per-format breakdown. Whichever of routing/conversion saved more takes row 1 |
| `🤖` | Active model |
| `🅷 5/5` | Harness principle score ([Harness mode](./HARNESS.md)) |
| `🧠` | Cache hit rate over the analysis window (green at 85%+) |
| `⏳` | Cache TTL countdown — send a message before expiry to keep the cache warm. Ticking while idle requires Claude Code v2.1.97+ (see [If the countdown looks frozen](./GATEWAYS.md)) |
| `✦ current` / `📅 weekly` | 5-hour / 7-day rate-limit window usage + reset time |
| `📦` | Context usage (e.g. `Ctx 68% of 1M`) — colored by fill. Current models default to 1M with no premium, but token volume itself drives per-turn cost and 5H/7D burn |
| `💵 Sep $42` | **Estimated spend since 00:00 on the 1st of this month** (local time). Summed per session with that session's model pricing, from this machine's session logs only. Hidden when a gateway budget chip is present, since that reports measured spend for every call the key served and two disagreeing dollar figures are worse than one (v3.35.0) |
| `💳 budget` | **LiteLLM key budget gauge.** When stdin carries no rate_limits, shows the key's `spend` against `max_budget` as `💳 budget ▰▰▰▱▱▱▱▱▱▱▱▱ 26% $1.0K/$4.0K`, with the time left on the billing cycle (v3.35.0, [below](./GATEWAYS.md)) |
| `💰` | Prompt-cache savings **over the analysis window** — a **different** number from row 1's `🔀`, which is a lifetime total from the ledger |
| `(last 1d)` | The analysis window, fused to the two chips it measures (`🧠`, `💰`) with no separator so it cannot read as the timeframe for the rest of the line. Change it with `sprag mode 7d` |
| `v3.24.0` | The version you are running. Gray, at the tail, when it is the latest one |
| `⬆ v3.24.0 → 3.25.0` | A newer release exists. Actionable, so it moves to the front of the line ([Update notifications](#-update-notifications)) |

When something is wrong, a **warning chip leads the line**:

```
🚨 5H ▰▰▰▰▰▰▰▰▰▰▰▱ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 4.8 · 🧠 Cache hit 72.1% · ⚠ Cache miss · 📅 weekly ▰▱▱▱▱▱▱▱▱▱▱▱ 12% 🔄 Sun 14:26 · 📦 Ctx 200k · last 1d
```

Chips — `🚨 5H/7D NN%` (cap imminent) · `⚠ Ctx 500k+` (a single request actually exceeded 500k) · `⚠ Cache miss` · `⚠ Input spike` · `⚠ Output heavy` · `⚠ Call surge` · `⚠ Rebuild churn` · `⚠ 5m TTL`. When both windows cross 90% at once, the sooner-resetting one is promoted to 🚨 and the other stays visible as a red segment (v2.16.0+).

### When a chip appears

Run the `/claude-token-saver` Skill inside Claude — or just say the chip wording ("5H cap is up", "cache miss") and it auto-activates. The Skill surfaces the **root-cause code + step-by-step fix**. When a cap is imminent, run `sprag handoff` to back up your work state to markdown and continue in a fresh session.

## ⬆ Update notifications

A statusline cannot open a dialog, and it re-renders every ~300ms, so it can never touch the network while drawing. The notification is therefore split in two:

- **The statusline tells you.** Up to date: a quiet gray `v3.24.0` at the tail. Newer release out: `⬆ v3.24.0 → 3.25.0` in yellow, moved to the front. Never red — nothing is broken.
- **Session start asks you.** On a new session or `/clear`, the SessionStart hook injects one line telling the model a newer version exists and to ask before installing anything. Only after you agree does it run `sprag upgrade`.
- **It says what the release adds.** Up to three lines, read from that version's release notes, so the question is "these things, worth an upgrade?" rather than "a number changed, upgrade?". Notes are optional: a release written as prose yields none, and the version alone is still offered.
- **Declining sticks.** `sprag update-check --dismiss` mutes the offer for that version; the next release asks again. The statusline chip stays — you declined the question, not the fact.

The registry lookup runs at most once every 24h in a detached background process and only ever writes a cache file (`update-check.json`) — the same shape npm's `update-notifier` uses. When that lookup finds a newer version it also reads the release notes for it, since the registry carries no changelog of its own; that request is unauthenticated (60/hour, against once a day here) and its failure costs the notes, never the notice. A failed check still stamps its timestamp, so an offline machine backs off instead of retrying on every render. Turn checks off entirely with `CTS_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER`.

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

## Label modes

The chips come in three styles. Emoji is the default; the other two exist because
some terminals cannot draw emoji without breaking the line.

| Mode | Looks like | Select with |
|---|---|---|
| `icon` | `🧠 Cache hit 98.8% · 📦 Ctx 47% of 1M` | default, or `sprag mode icon` |
| `narrow` | `◉ Cache hit 98.8% · ◧ Ctx 47% of 1M` | automatic in JetBrains IDEs, or `sprag mode narrow` / `--narrow` |
| `text` | `Cache hit 98.8% · Ctx 47% of 1M` | `sprag mode text` / `--text` |

### Why JetBrains IDEs get narrow glyphs

Inside a JetBrains IDE terminal (IntelliJ, PyCharm, WebStorm, DataGrip — anything
that sets `TERMINAL_EMULATOR=JetBrains-JediTerm`) the emoji set garbles. The
symptoms look like the statusline is computing wrong numbers:

```
⏳ Cache expires 4:545      (should read 4:54)
📦 Ctx 330% of 1M           (should read 33%)
💳 budget $1.0K/$4.:0K      (should read $4.0K)
```

Nothing is miscomputed. The countdown formatter cannot emit a value without a
colon, and percentages are clamped to 0–100, so those strings are impossible to
produce. What you are seeing is leftover characters from the previous frame.

The cause is font coverage. JetBrains Mono, the IDE default, has no glyphs for
the emoji, so the terminal draws them through a fallback font whose advance width
does not match the cell grid. Static text survives that, but a chip whose value
changes every second repaints partially, and the mismatch stays on screen as
debris. Dragging a selection across the line forces a full repaint and it reads
correctly again — the buffer was always right, only the painting was off.

Every glyph in the narrow set is a character JetBrains Mono actually ships. That
is also how the cause was found: the gauge was the one part of the line that never
garbled, and its block characters were the only ones already in the font.

The gauge itself follows the same rule. Its ticks are `▰▱` normally, but JetBrains
Mono has neither character, so narrow mode draws the same bar as `■□`, which it
does have. Both read as a row of twelve ticks; only the shape of one tick differs.

### If your terminal garbles the line too

Any terminal whose font lacks emoji glyphs can show the same debris. Only
JetBrains IDEs are detected automatically, because a program cannot ask a
terminal which font it is using. Switch manually:

```bash
sprag mode narrow    # keep a glyph on every chip, without the emoji
sprag mode text      # drop the glyphs entirely
```

To keep emoji inside a JetBrains IDE anyway, accepting the garbling:

```bash
sprag mode icon-force      # persisted
SPRAG_ICON=force           # one-off, e.g. while capturing a screenshot
```

`sprag mode` reports what actually renders and which rule decided:

```
labels:  icon
renders: narrow (IntelliJ: emoji garble in the IDE font. `sprag mode icon-force` keeps them anyway)
```


---

<a id="한국어"></a>

# Statusline reference (한국어)

## statusline 읽는 법

절감 원장에 기록이 쌓이면 statusline이 **두 줄로** 출력됩니다. 첫째 줄에는 라우팅 절감액만 표시하고, 둘째 줄에는 진단 칩을 표시합니다.

```
🔀 Routing saved $2.09  |  fable→sonnet 1× $0.72 · opus→haiku 1× $0.57
⚠ Ctx 500k+ · 🅷 5/5 · 🤖 Opus 5 · 🧠 Cache hit 98.8% · ⏳ Cache expires 59:46 · ✦ current ▰▰▰▰▰▰▰▱▱▱▱▱ 62% 🔄 21:33 · 📅 weekly ▰▰▰▰▰▱▱▱▱▱▱▱ 38% 🔄 Tue 19:33 · 📦 Ctx 47% of 1M · 💰 Cache saved $1.0K · last 1d
```

원장이 비어 있으면, 다시 말해 아직 실측된 위임이 없으면 첫째 줄을 그리지 않고 종전처럼 한 줄로 출력합니다. 일부 환경(구버전 macOS Claude Code)에서 첫째 줄만 표시된다면 `--single-line` 옵션으로 한 줄 레이아웃을 유지하십시오.

| 세그먼트 | 의미 |
|---|---|
| `🔀` **첫째 줄** | 라우팅으로 절감한 누적 금액과 모델 이동 내역입니다. 내역 합계는 누적 금액과 정확히 일치하고, 모델명은 계열만 남깁니다(`opus→haiku`). 근거는 `route-scan savings` 로 전부 확인할 수 있습니다 |
| `📄` **둘째 줄** | doc2md 문서 변환이 절감한 누적 금액과 형식별 내역입니다. 라우팅과 문서 변환 중 금액이 큰 쪽이 첫째 줄을 차지합니다 |
| `🤖` | 현재 모델 |
| `🅷 5/5` | harness 원칙 점수 ([Harness 모드](./HARNESS.md#한국어)) |
| `🧠` | 분석 구간 동안의 캐시 히트율입니다 (85%+ 녹색) |
| `⏳` | 캐시 TTL 카운트다운입니다. 만료되기 전에 메시지를 보내면 캐시가 유지됩니다. 입력이 없을 때도 초 단위로 줄어드는 표시는 Claude Code v2.1.97 이상에서 동작합니다 (아래 [카운트다운이 멈춰 보일 때](./GATEWAYS.md#한국어) 참고) |
| `✦ current` / `📅 weekly` | 5시간 / 7일 rate-limit 윈도 사용률 + 리셋 시각 |
| `📦` | 컨텍스트 사용률입니다(예: `Ctx 68% of 1M`). 사용률에 따라 녹색·노란색·빨간색으로 표시합니다. 최신 모델은 1M 컨텍스트가 기본이고 별도 요금이 붙지 않지만, 토큰량 자체가 턴당 비용과 5시간·7일 한도를 빠르게 소모시킵니다 |
| `💵 Sep $42` | **이번 달 1일 00시(로컬) 이후 지출 추정치**입니다. 이 머신의 세션 로그에만 세션별 모델 단가를 적용해 합산합니다. 게이트웨이 예산 칩이 함께 뜨는 환경에서는 표시하지 않습니다. 그 칩은 해당 키로 들어온 모든 호출의 실측 지출을 보여 주므로, 서로 어긋나는 금액이 두 개 나오면 오히려 판단을 방해합니다 (v3.35.0) |
| `💳 budget` | **LiteLLM 게이트웨이 키의 예산 게이지**입니다. stdin 에 rate_limits 가 오지 않는 환경에서 키의 `max_budget` 대비 `spend` 를 `💳 budget ▰▰▰▱▱▱▱▱▱▱▱▱ 26% $1.0K/$4.0K` 형태로 보여 주며, 결제 주기가 얼마나 남았는지 함께 표시합니다 (v3.35.0, [아래](./GATEWAYS.md#한국어)) |
| `💰` | **분석 구간 동안** 프롬프트 캐시가 절약해 준 금액입니다. 첫째 줄의 `🔀` 는 원장에 쌓인 전체 기간 누적액이라 **기준이 다른 수치입니다** |
| `(last 1d)` | 분석 구간입니다. 이 구간을 기준으로 삼는 두 칩(`🧠`, `💰`)에 구분자 없이 붙여서, 줄 전체의 기준으로 잘못 읽히지 않게 했습니다. `sprag mode 7d` 로 바꿉니다 |
| `v3.24.0` | 지금 실행 중인 sprag의 버전입니다. 최신이면 회색으로 줄 끝에 조용히 놓입니다 |
| `⬆ v3.24.0 → 3.25.0` | 새 버전이 배포되어 있다는 표시입니다. 조치가 필요한 칩이므로 줄 앞쪽으로 올라옵니다 ([업데이트 안내](#-업데이트-안내)) |

문제가 감지되면 **경고 칩을 줄 맨 앞에** 붙입니다.

```
🚨 5H ▰▰▰▰▰▰▰▰▰▰▰▱ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 4.8 · 🧠 Cache hit 72.1% · ⚠ Cache miss · 📅 weekly ▰▱▱▱▱▱▱▱▱▱▱▱ 12% 🔄 Sun 14:26 · 📦 Ctx 200k · last 1d
```

칩의 종류는 다음과 같습니다. `🚨 5H/7D NN%`(한도 임박) · `⚠ Ctx 500k+`(단일 요청이 실제로 500k를 초과) · `⚠ Cache miss` · `⚠ Input spike` · `⚠ Output heavy` · `⚠ Call surge` · `⚠ Rebuild churn` · `⚠ 5m TTL`. 두 윈도가 동시에 90%를 넘으면 리셋이 더 임박한 쪽을 🚨로 올리고, 나머지 하나는 빨간 세그먼트로 계속 표시합니다 (v2.16.0 이상).

### 경고 칩이 떴을 때

Claude Code 안에서 `/claude-token-saver` Skill을 실행하거나, 칩에 적힌 문구를 그대로 말하기만 해도("5H cap 떴어", "cache miss") Skill이 자동으로 활성화되어 **원인 코드와 단계별 해결 명령을** 보여 줍니다. 한도가 임박한 상황에서는 `sprag handoff`로 진행 중인 작업을 마크다운 파일에 백업한 뒤 새 세션에서 이어가는 방식을 권장합니다.

## ⬆ 업데이트 안내

statusline은 대화 상자를 띄울 수 없고, 300밀리초마다 다시 그려지기 때문에 그리는 시점에 네트워크를 쓸 수도 없습니다. 그래서 안내를 두 지점으로 나누었습니다.

- **statusline은 알리기만 합니다.** 최신 버전이면 줄 끝에 `v3.24.0`을 회색으로 조용히 표시하고, 새 버전이 있으면 `⬆ v3.24.0 → 3.25.0`을 줄 앞쪽에 노란색으로 올립니다. 빨간색은 쓰지 않습니다. 무엇도 고장 난 상태가 아니기 때문입니다.
- **묻는 일은 세션 시작에서 합니다.** 새 세션이나 `/clear` 시점에 SessionStart 훅이 "새 버전이 있으니 사용자에게 업그레이드할지 물어보라"는 한 줄을 모델에게 주입합니다. 모델은 사용자에게 확인한 뒤에만 `sprag upgrade`를 실행합니다. 묻지 않고 설치하지 않습니다.
- **무엇이 새로 생겼는지 함께 알립니다.** 해당 버전의 릴리스 노트에서 최대 세 줄을 읽어 붙입니다. 그래야 질문이 "숫자가 바뀌었으니 올리겠습니까"가 아니라 "이런 것들이 생겼는데 올리겠습니까"가 됩니다. 노트는 필수가 아니며, 산문으로만 쓰인 릴리스는 항목이 잡히지 않습니다. 그때도 버전 안내는 그대로 나갑니다.
- **거절은 기억합니다.** 사용자가 원치 않으면 `sprag update-check --dismiss`로 그 버전을 묻지 않도록 설정합니다. 더 새로운 버전이 배포되면 다시 묻습니다. statusline 칩은 그대로 남습니다. 거절한 것은 질문이지, 새 버전이 있다는 사실이 아니기 때문입니다.

버전 조회는 24시간에 한 번, 분리된 백그라운드 프로세스가 수행하고 결과만 파일에 남깁니다(`update-check.json`). 이 방식은 npm의 `update-notifier`가 쓰는 것과 같습니다. 그 조회에서 새 버전을 발견하면 릴리스 노트도 함께 읽습니다. npm 레지스트리는 변경 내역을 제공하지 않기 때문입니다. 이 요청은 인증이 필요 없고(시간당 60회 한도이며 여기서는 하루 한 번 씁니다), 실패하면 노트만 빠지고 안내 자체는 나갑니다. 네트워크가 끊겨 있어도 실패 시각을 기록해 두므로 매 렌더마다 재시도하지 않습니다. 확인 자체를 끄려면 환경 변수 `CTS_NO_UPDATE_CHECK=1` 또는 `NO_UPDATE_NOTIFIER`를 설정하십시오.

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

## 라벨 모드

칩은 세 가지 스타일로 나옵니다. 기본값은 이모지이며, 나머지 두 가지는 이모지를
제대로 그리지 못하는 터미널을 위해 존재합니다.

| 모드 | 표시 형태 | 선택 방법 |
|---|---|---|
| `icon` | `🧠 Cache hit 98.8% · 📦 Ctx 47% of 1M` | 기본값, 또는 `sprag mode icon` |
| `narrow` | `◉ Cache hit 98.8% · ◧ Ctx 47% of 1M` | JetBrains IDE 에서 자동 적용, 또는 `sprag mode narrow` / `--narrow` |
| `text` | `Cache hit 98.8% · Ctx 47% of 1M` | `sprag mode text` / `--text` |

### JetBrains IDE 에서 좁은 글리프를 쓰는 이유

JetBrains IDE 내장 터미널(IntelliJ, PyCharm, WebStorm, DataGrip 처럼
`TERMINAL_EMULATOR=JetBrains-JediTerm` 을 설정하는 환경)에서는 이모지 세트가
깨집니다. 증상은 statusline 이 숫자를 잘못 계산한 것처럼 보입니다.

```
⏳ Cache expires 4:545      (4:54 로 나와야 합니다)
📦 Ctx 330% of 1M           (33% 로 나와야 합니다)
💳 budget $1.0K/$4.:0K      (＄4.0K 로 나와야 합니다)
```

계산이 틀린 것은 아닙니다. 카운트다운 포매터는 콜론이 없는 값을 만들지 못하고
퍼센트는 0에서 100 사이로 잘리므로, 위와 같은 문자열은 애초에 생성될 수
없습니다. 화면에 보이는 것은 이전 프레임에서 남은 문자입니다.

원인은 폰트가 해당 문자를 가지고 있지 않다는 점입니다. IDE 기본 폰트인
JetBrains Mono 에는 이모지 글리프가 없어서 터미널이 대체 폰트로 그리는데, 그
폰트의 글자 폭이 셀 격자와 맞지 않습니다. 고정된 텍스트는 그래도 버티지만, 매초
값이 바뀌는 칩은 일부만 다시 그려지기 때문에 어긋난 만큼이 화면에 잔여물로
남습니다. 마우스로 그 줄을 드래그하면 전체가 다시 그려져 정상으로 보이는데,
버퍼는 처음부터 옳았고 화면에 그리는 단계만 어긋났다는 증거입니다.

narrow 세트의 모든 글리프는 JetBrains Mono 가 실제로 가지고 있는 문자입니다.
원인을 찾은 경로도 여기였습니다. statusline 에서 한 번도 깨지지 않은 부분이
게이지뿐이었고, 게이지가 쓰는 블록 문자만 폰트에 들어 있었습니다.

게이지도 같은 규칙을 따릅니다. 눈금은 기본적으로 `▰▱` 이지만 JetBrains Mono 에는
두 문자가 모두 없어서, narrow 모드에서는 폰트가 가지고 있는 `■□` 로 같은 바를
그립니다. 두 경우 모두 눈금 열두 칸으로 읽히고, 눈금 하나의 모양만 다릅니다.

### 다른 터미널에서도 줄이 깨진다면

이모지 글리프가 없는 폰트를 쓰는 터미널이라면 어디서든 같은 잔여물이 보일 수
있습니다. 자동으로 감지하는 것은 JetBrains IDE 뿐인데, 프로그램이 터미널에게
어떤 폰트를 쓰는지 물어볼 방법이 없기 때문입니다. 그런 경우에는 직접
전환하십시오.

```bash
sprag mode narrow    # 이모지 없이 칩마다 글리프를 남깁니다
sprag mode text      # 글리프를 모두 뺍니다
```

JetBrains IDE 에서 깨짐을 감수하고 이모지를 그대로 쓰려면 다음과 같이 합니다.

```bash
sprag mode icon-force      # 설정에 저장합니다
SPRAG_ICON=force           # 한 번만 적용합니다(예: 스크린샷을 찍는 동안)
```

`sprag mode` 는 실제로 무엇이 렌더되는지와 어느 규칙이 그렇게 정했는지 알려
줍니다.

```
labels:  icon
renders: narrow (IntelliJ: emoji garble in the IDE font. `sprag mode icon-force` keeps them anyway)
```

