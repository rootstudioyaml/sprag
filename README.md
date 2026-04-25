# claude-token-saver

> **Renamed from `claude-cache-monitor` in v2.0.** The old npm package is deprecated and points here. The `claude-cache-monitor` binary is gone — use `claude-token-saver` instead. See [migration notes](#migration-from-claude-cache-monitor).

> 📺 **출시 영상 (60초)** — 왜 만들었고, 무엇을 보여주는지:
> **[▶ Watch the launch Short](https://www.youtube.com/shorts/RaD8qMsPTnA)** · [All DeepPulse Shorts](https://www.youtube.com/@HNPulseKR/shorts)
>
> [![claude-token-saver launch](https://img.youtube.com/vi/RaD8qMsPTnA/hqdefault.jpg)](https://www.youtube.com/shorts/RaD8qMsPTnA)
>
> Earlier context (cache TTL 1h→5m incident, the reason this tool exists): [HNPulse #025](https://www.youtube.com/shorts/oSx2sg935nI)

**Save tokens on Claude Code.** Catch the session that suddenly burned 10× your usual input, figure out *why*, and get a one-line remediation you can paste.

**Why I built this.** I'm on the Max plan. On Opus 4.6 I never hit the *current-session* cap. After Opus 4.7 rolled out, I started hitting it on the same workflow — repeatedly. The official token statistics didn't match what I was actually feeling, and Claude Code's UI doesn't show prompt-cache health. This tool is what let me see *why*: low cache hit rate, 5m TTL writes that should have been 1h, 1M context auto-promoted in the background.

v2.1 (2026-04) adds the workflow that follows the diagnosis:
- **`claude-token-saver install`** — one command writes a Claude Code Skill that auto-activates when you mention "cache hit rate" / "1M context" / "5H cap" — no slash command needed.
- **`claude-token-saver history`** — every warning chip transition is auto-logged to a daily Markdown file, so you can answer "when did this start" without grepping logs.
- **Cross-platform paths** — Windows (`%APPDATA%`), macOS (`~/Library/Application Support`), Linux (`~/.config` / XDG) all handled.

v1.5 adds three things on top of the original `claude-cache-monitor`:
- **Spike diagnosis** — detect recent sessions whose input tokens exploded vs. your own baseline, and name the cause (1M context, 5m TTL churn, cache rebuild, chatty output).
- **1M-context detection** — Opus 4.7+ auto-enables 1M context on Max plans, silently. This tool surfaces it on the statusline as `Ctx 1M` (red) vs. `Ctx 200k` (green), with the OS-specific command to turn it off.
- **Actionable advice** — OS-aware remediation (`~/.zshrc` vs. `setx`) and the warning for the known `/model` toggle bug ([anthropics/claude-code#31640](https://github.com/anthropics/claude-code/issues/31640)).

The original functionality still works: cache hit rate, TTL breakdown, cost impact vs. no-cache, TTL countdown timer, and Claude Code statusline integration.

**Run it standalone or wire it into Claude Code's statusline.** Use `npx claude-token-saver` as a one-shot report, or wire it into Claude Code's native statusline for an always-on chip. See [Two Ways to Use It](#two-ways-to-use-it).

---

**Claude Code 토큰 아껴쓰기 도구.** 평소보다 10배 토큰을 태운 세션을 찾고, *왜 튀었는지* 진단하고, 붙여넣을 수 있는 한 줄 해결책까지 내줍니다.

v1.5 신규:
- **토큰 급증 진단** — 최근 세션 중 내 평소 기준보다 입력 토큰이 폭증한 세션을 찾아 원인까지 분류 (1M 컨텍스트 / 5분 TTL 반복 쓰기 / 캐시 재작성 / 출력 과다).
- **1M 컨텍스트 감지** — Opus 4.7부터 Max 플랜은 1M 컨텍스트가 자동 ON. Statusline에 `Ctx 1M`(빨강) / `Ctx 200k`(초록)으로 표시하고, OS별 OFF 명령까지 안내.
- **실행 가능한 권장 액션** — macOS/Linux/WSL는 `~/.zshrc`, Windows는 `setx` 명령. [`/model`로 200k 선택해도 1M에 머무는 알려진 버그](https://github.com/anthropics/claude-code/issues/31640)에 대한 경고 포함.

기존 기능(캐시 히트율·TTL 분포·비용 절감·TTL 카운트다운·statusline)은 그대로 유지됩니다.

**단독 도구로도, Claude Code statusline 통합으로도 동작합니다.** `npx claude-token-saver` 한 줄로 진단 리포트만 보거나, 내장 statusline에 연결해 상시 표시할 수 있습니다. 자세한 용법은 [Two Ways to Use It](#two-ways-to-use-it) 참고.

## Quick Start

```bash
# Run instantly (no install required)
npx claude-token-saver

# Last 7 days only
npx claude-token-saver --days 7

# JSON output (for pipelines)
npx claude-token-saver --format json

# CSV output (for spreadsheets)
npx claude-token-saver --format csv
```

> **Upgrading from `claude-cache-monitor`?** Uninstall the old package first, then install the new one and update your settings command name:
> ```bash
> npm uninstall -g claude-cache-monitor && npm i -g claude-token-saver
> ```
> After upgrading, change any `claude-cache-monitor …` invocations (including `statusLine.command` in `~/.claude/settings.json`) to `claude-token-saver …`. See [Migration](#migration-from-claude-cache-monitor).

## Spike Diagnosis (new in v1.5.0)

When you run `npx claude-token-saver`, sessions from the last 24 hours whose total input tokens are **≥ 3× your p95 baseline** (or whose single-request context exceeds 250k, indicating 1M context) appear at the top of the report with root causes and remediation commands. Example output:

```
  ⚠ 토큰 급증 감지
  ──────────────────────────────────────────────────
  컨텍스트 모드 추정: 1M  (최근 단일 요청 최대 480k 토큰)

  • a1b2c3d4 [myproject]  총 입력 320.45M  (5.2× p95, 요청 142회)
      단일 요청 최대 컨텍스트: 480k 토큰
      · 요청당 입력 토큰이 평소보다 매우 큽니다 (1M 컨텍스트 의심)

  권장 액션
  ──────────────────────────────────────────────────
  ▸ 요청당 입력 토큰이 평소보다 매우 큽니다 (1M 컨텍스트 의심)
    Opus 4.7부터 1M 컨텍스트가 표준 가격으로 풀리면서 Max 플랜은 자동으로 1M로 승격됩니다 ...
    - 1M 컨텍스트 OFF (환경변수)
        echo 'export CLAUDE_CODE_DISABLE_1M_CONTEXT=1' >> ~/.zshrc && source ~/.zshrc
    - 세션 내 토글
        단축키 ⌥ P (mac) / Alt + P (linux) 로 즉시 On/Off
    - ⚠ 알려진 버그 #31640
        /model 로 200k 선택해도 컨텍스트가 1M에 머무는 케이스가 있습니다.
        확실히 끄려면 위 환경변수를 설정한 뒤 Claude Code를 재시작하세요.
```

Issue codes detected:

| Code | Meaning |
|---|---|
| `LARGE_INPUT_PER_REQUEST` | avg input/request is 8×+ your baseline, or a single request > 250k tokens → 1M context likely |
| `LOW_HIT_RATE` | cache hit rate < 50% and materially below your baseline |
| `BUCKET_5M_DOMINANT` | > 70% of cache writes land in the 5m bucket (Pro plan, or Max users getting downgraded) |
| `HIGH_OUTPUT_RATIO` | output/input > 0.15 (output is 5× input price — matters a lot) |
| `HIGH_REQUEST_COUNT` | session made 3×+ your median request count (tool-loop suspect) |
| `FREQUENT_CACHE_REBUILD` | `cache_creation` > `cache_read` (cache being made, not reused) |

Remediation commands are chosen from `process.platform` — macOS/Linux/WSL get `~/.zshrc` snippets, Windows gets `setx` and the PowerShell equivalent.

## Two Ways to Use It

| Mode | What you run | When to pick this |
|---|---|---|
| **1. Standalone CLI report** | `npx claude-token-saver` | One-off diagnosis. Prints the full report (spikes + cache + cost + trend). Zero setup. |
| **2. Claude Code statusline** | `claude-token-saver --statusline` wired via `~/.claude/settings.json` | You want the chip (hit rate · TTL countdown · Ctx 200k/1M · spike) visible all the time. |

Detail for each mode below.

## Statusline Mode (new in v1.2.0)

Always-on one-line display in Claude Code's native statusline — no need to run commands manually.

Claude Code 내장 statusline에 한 줄로 상시 표시. 커맨드 수동 실행 불필요.

```bash
# Preview (prints one line — text mode, default)
npx claude-token-saver --statusline
#  → Cache hit 97.5% · Expires 1h 42:15 · Cost saved $4.8K · Ctx 200k · 7d

# When 1M context is silently on and a session is spiking:
#  → Cache hit 88.0% · Expires 1h 42:15 · Cost saved $4.8K · Ctx 1M · ⚠ 1M컨텍스트 · 7d

# Icon mode (🧠 / ⏳ / 💰 / 📦)
npx claude-token-saver --statusline --icon
#  → 🧠 97.5% · ⏳ 1h 42:15 · 💰 $4.8K · 📦 200k · 7d

# Verbose (longer labels; combines with --icon too)
npx claude-token-saver --statusline --verbose
#  → Cache hit 97.5% · 1h bucket · expires in 42:15 · Cost saved $4.8K · last 7d

npx claude-token-saver --statusline --icon --verbose
#  → 🧠 Cache hit 97.5% · ⏳ Expires 1h 42:15 · 💰 Cost saved $4.8K · last 7d

# Hide the TTL countdown
npx claude-token-saver --statusline --no-timer

# No ANSI color (plain text)
npx claude-token-saver --statusline --no-color
```

### TTL countdown (v1.2.1+)

Your subscription plan fixes the TTL bucket (5m for Pro, 1h for Max) — the actionable number isn't the bucket, it's **how much time is left on your last API call's cache entry**. The `TTL 1h MM:SS` segment is a live stopwatch against the dominant bucket:

구독 플랜이 TTL 값(Pro = 5분, Max = 1시간)을 고정하므로 의미 있는 수치는 "버킷"이 아니라 "마지막 API 호출의 캐시가 만료되기까지 몇 초"입니다. `TTL 1h MM:SS` 세그먼트가 그 스톱워치입니다 (앞쪽이 버킷, 뒤쪽이 남은 시간):

- 🟢 &gt;30% remaining — plenty of time to send the next prompt within TTL
- 🟡 10–30% remaining — consider firing a cheap prompt soon to keep prefix cached
- 🔴 &lt;10% remaining or `EXPIRED` — next prompt will pay cache-write cost again

This enables the "5-minute rule" in practice: a quick dummy question before the timer hits zero resets the TTL and preserves the prefix cache.

### Enable in Claude Code

The Claude Code statusline is event-driven — it only re-renders on assistant messages / mode changes. To keep the countdown ticking while you're idle, set `refreshInterval: 1` alongside the `statusLine` command.

#### macOS / Linux / WSL

```json
{
  "statusLine": {
    "type": "command",
    "command": "claude-token-saver --statusline --icon",
    "refreshInterval": 1
  }
}
```

Or combine with an existing statusline script — see [`examples/statusline-command.sh`](examples/statusline-command.sh) for a drop-in that prints `user@host:cwd | <token-saver segment>`.

#### Windows (native PowerShell, not WSL)

Use the PowerShell example in [`examples/statusline-command.ps1`](examples/statusline-command.ps1):

```json
{
  "statusLine": {
    "type": "command",
    "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\\.claude\\statusline-command.ps1",
    "refreshInterval": 1
  }
}
```

Works best in **Windows Terminal** or **PowerShell 7+** (ANSI color + emoji). Classic `conhost cmd` may garble emoji — prefer `--no-icon`-style plain text or use Windows Terminal.

#### Windows (WSL)

Same as Linux — install the package in your WSL Node.js and point to the POSIX sh script.

Claude Code calls this every ~300ms on events, plus once per `refreshInterval` second while idle. Colors are emitted when the terminal supports them:

- **Hit rate** — 🟢 ≥85% · 🟡 70–85% · 🔴 <70%
- **TTL bucket** — 🟢 1h (good) · 🟡 5m (warning)
- **Countdown** — 🟢 >30% remaining · 🟡 10–30% · 🔴 <10% or EXPIRED
- **Context window** — 🟢 `Ctx 200k` (standard) · 🔴 `Ctx 1M` (Opus 4.7+ Max auto-enabled — expensive if unintended)
- **Spike chip** — appears only when the current session is flagged (e.g. `⚠ 1M컨텍스트`, `⚠ 5m TTL`, `⚠ 캐시미스`, `⚠ 입력폭주`)

Statusline mode uses the last 7 days by default (override with `--days N`) and never emits multi-line errors, so your statusline stays clean even when there's no session data yet.

## Claude Code integration (`install`) — new in v2.1

One command wires up everything else this README mentions:

```bash
claude-token-saver install
```

This writes one file under your Claude user dir:
- `~/.claude/skills/claude-token-saver/SKILL.md` — auto-activates whenever you mention chip wording ("⚠ 1M ON", "cache miss", "5H cap", etc.) or ask for a token report. Claude Code will then read `claude-token-saver last`, drill into history if needed, and explain the warning.

If you previously installed v2.5.x or earlier, `install` also removes the now-redundant legacy `~/.claude/commands/token-monitor.md` slash command — its workflow is fully absorbed into the skill (same behavior, triggered by intent rather than typing `/token-monitor`).

Re-run with `--force` to overwrite the skill file.

## Warning history (`history`) — new in v2.1

The statusline path auto-logs every chip transition (none → ⚠, ⚠ A → ⚠ B, ⚠ → resolved) to a daily Markdown file. Read it back with:

```bash
claude-token-saver history             # last 7 days
claude-token-saver history --days 30   # wider window
claude-token-saver history --list      # just list available dates
```

Sample output:

```
# Token Monitor — 2026-04-25

## Events
- 09:14:02 ⚠ 1M ON  — Context auto-promoted to 1M (max single-request 280k tokens)
- 09:42:18 ⚠ 1M ON → ⚠ Cache miss  — session abc12345: LOW_HIT_RATE
- 10:05:47 ✓ resolved (was ⚠ Cache miss)
```

Storage paths (cross-platform):
- **Windows**: `%APPDATA%\claude-token-saver\history\YYYY-MM-DD.md`
- **macOS**: `~/Library/Application Support/claude-token-saver/history/YYYY-MM-DD.md`
- **Linux**: `$XDG_CONFIG_HOME/claude-token-saver/history/YYYY-MM-DD.md` (or `~/.config/...`)

Each day's file is plain Markdown — open it in any editor. Transitions are deduped, so the 1Hz statusline refresh doesn't spam.

## Model + /usage segments (new in v2.3, generic in v2.4)

Three more segments mirror the data Claude Code's `/usage` slash command shows, so you don't have to slash for it every few minutes:

| Segment     | Icon mode example     | Source                          |
| ----------- | --------------------- | ------------------------------- |
| `model`     | `🤖 Opus 4.7`         | stdin `model.display_name`      |
| `five_hour` | `✦ current ███▒░░ 47% 🔄 21:10`     | stdin `rate_limits.five_hour`   |
| `seven_day` | `📅 weekly ▒░░░░░ 9% 🔄 Thu 13:00`   | stdin `rate_limits.seven_day`   |

The window segments stay quiet under 70% (calm emerald), warm to amber at 70–89%, and yield to the leading `🚨 5H █████▓ 94%` / `🚨 7D █████▒ 92%` cap-warn chip at 90%+ — so you never see the same window twice. The gauge is 6 cells wide using a single density family (`█▓▒░`), so the fill→empty boundary reads as one smooth gradient instead of an awkward step between fractional and shaded glyphs. Colors render as a Tailwind-inspired muted palette (emerald-400 / amber-400 / rose-400) on truecolor terminals (`COLORTERM=truecolor`), with a graceful fallback to 8-color ANSI elsewhere. Filter the layout with `--segments=` if you only want a subset:

```bash
claude-token-saver --statusline --icon --segments=model,five_hour,seven_day,saved
```

`5h` and `7d` are kept as aliases for the older config files. Any new `rate_limits.*` window Anthropic ships (e.g. a Sonnet-only weekly bucket) renders automatically with a derived label — no config or version bump needed. As of 2026-04-25 the stdin contract exposes only `five_hour` + `seven_day`; the third row in `/usage` ("Current week — Sonnet only") is not in the payload yet, so we mirror what's there.

## Cap-warn + handoff (new in v2.2)

Claude Code's statusline payload now includes rate-limit usage (`rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage`). claude-token-saver leads the statusline with a `🚨 5H 94%` (or `🚨 7D 92%`) chip the moment either window crosses **90%**, and writes the transition into history:

```
- 14:32:08 🚨 5H 94% cap warning (resets in 1h 38m)
- 16:10:21 ✓ 5H cap warning resolved
```

When you see the chip, back up the work in flight before the cap blocks you:

```bash
claude-token-saver handoff
```

That writes `./HANDOFF-YYYY-MM-DD-HHMM.md` in the current directory with:

- timestamp, cwd, git branch / HEAD / dirty file list
- the 5h/7d cap snapshot (and "resets in Hh Mm")
- empty fillable sections for *what I just did*, *TODO*, *where to pick up next*, *gotchas*
- a one-line resume prompt for a fresh Claude Code session:

  ```
  Read the most recent HANDOFF-*.md in this directory and continue the work.
  ```

The handoff write is also recorded in history (`📝 handoff written: …`), so `claude-token-saver history` and the auto-skill show both the cap-warn and the backup event next to each other.

## Hook Setup

Automatically logs cache stats on every tool call and alerts when hit rate drops below a threshold.

매 도구 호출마다 자동으로 캐시 통계를 기록하고, 히트율이 임계값 이하로 떨어지면 경고합니다.

```bash
# Install hook (default threshold 70%)
npx claude-token-saver --install-hook

# Custom threshold
npx claude-token-saver --install-hook --threshold 0.8

# Remove hook
npx claude-token-saver --uninstall-hook
```

When the hook is installed:
- Session-level stats are automatically recorded to `~/.claude/cache-stats.jsonl`
- A warning is displayed in Claude Code when hit rate falls below the threshold

## Output Example

```
  Claude 토큰 아껴쓰기 — Last 30 days
  (claude-token-saver v2.0.1)
  ══════════════════════════════════════════════════

  Context window: 200k  ✓ 200k 컨텍스트 (표준)
  (최근 단일 요청 최대 83k 토큰)

  Summary
  Sessions: 380  |  API calls: 10,813  |  Model: claude-opus-new
  Cache hit rate: 98.2%  |  Total input: 1957.94M tokens

  TTL Breakdown
  ┌────────────────────┬──────────────────┬──────────────────┐
  │                    │     5m Ephemeral │      1h Extended │
  ├────────────────────┼──────────────────┼──────────────────┤
  │ Cache writes       │    167.7K (0.5%) │    34.8M (99.5%) │
  └────────────────────┴──────────────────┴──────────────────┘

  Cost Impact (estimated)
  ┌──────────────────────────┬──────────────┐
  │ Actual cost              │      $793.93 │
  │ Without cache            │     $5958.52 │
  ├──────────────────────────┼──────────────┤
  │ Savings                  │ $5164.6 (86.7%) │
  │ Extra cost if 5m-only    │     +$239.99 │
  └──────────────────────────┴──────────────┘

  Daily Trend
  ┌────────────┬──────────┬─────────┬────────────┬────────────┬───────┐
  │ Date       │  HitRate │   Calls │       Read │      Write │   5m% │
  ├────────────┼──────────┼─────────┼────────────┼────────────┼───────┤
  │ 2026-04-10 │    98.5% │     341 │     88.98M │      1.35M │  0.0% │
  │ 2026-04-11 │    97.1% │     118 │      9.51M │      0.27M │  0.0% │
  │ 2026-04-12 │    91.7% │      77 │      2.69M │      0.22M │  0.0% │
  └────────────┴──────────┴─────────┴────────────┴────────────┴───────┘
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--days, -d` | Analysis period in days | 30 |
| `--format, -f` | Output format: `table`, `json`, `csv` | table |
| `--project, -p` | Filter by project directory | all |
| `--threshold` | Cache hit rate alert threshold (0.0-1.0) | 0.7 |
| `--install-hook` | Install Claude Code PostToolUse hook | - |
| `--uninstall-hook` | Remove hook | - |
| `--statusline` | Emit one-line output for Claude Code statusline API | - |
| `--icon` | (with `--statusline`) use 🧠 / ⏳ / 💰 icons instead of word labels | text |
| `--verbose` | (with `--statusline`) use longer labels | - |
| `--no-timer` | (with `--statusline`) hide the TTL countdown | show |
| `--no-color` | Strip ANSI escape codes | - |

Statusline segments always include the context-window chip (`Ctx 200k`/`Ctx 1M` or `📦 200k`/`📦 1M` in `--icon` mode). A spike chip is appended only when the most recent session is diagnosed as a spike.

## How It Works

Claude Code logs usage data for every API call into session JSONL files:

```
~/.claude/projects/<project-dir>/<session-id>.jsonl
```

Each API response contains these fields:
- `cache_read_input_tokens` — tokens read from cache (cheap, 0.1x)
- `cache_creation_input_tokens` — tokens written to cache (expensive, 1.25x~2x)
- `cache_creation.ephemeral_5m_input_tokens` — tokens created with 5-minute TTL
- `cache_creation.ephemeral_1h_input_tokens` — tokens created with 1-hour TTL

This tool deduplicates streaming chunks by `requestId` and aggregates by day/session.

## Key Findings

Cache TTL is determined by your subscription plan, not by user choice:

| Plan | Cache TTL | Controlled by |
|------|-----------|---------------|
| **Max** ($100~200/mo) | **1h automatic** | `tengu_prompt_cache_1h_config` feature flag |
| **Pro** ($20/mo) | **5m fixed** | Not configurable |
| **API key** | **5m default** (1h via beta header) | `cache_control.ttl` parameter |

## Pricing (updated 2026-04 for Opus 4.7)

Cost estimates use current Anthropic pricing, auto-detected from the model id in session logs:

| Tier (internal id) | Matching models | Input | 5m Cache Write | 1h Cache Write | Cache Read | Output |
|---|---|---|---|---|---|---|
| `claude-opus-new` | Opus **4.5 / 4.6 / 4.7** | $5 | $6.25 | $10 | $0.50 | $25 |
| `claude-opus-legacy` | Opus 4 / 4.1 / 3 | $15 | $18.75 | $30 | $1.50 | $75 |
| `claude-sonnet` | Sonnet 3.7 / 4 / 4.5 / 4.6 | $3 | $3.75 | $6 | $0.30 | $15 |
| `claude-haiku-4-5` | Haiku 4.5 | $1 | $1.25 | $2 | $0.10 | $5 |
| `claude-haiku-3-5` | Haiku 3.5 | $0.80 | $1 | $1.6 | $0.08 | $4 |
| `claude-haiku-3` | Haiku 3 | $0.25 | $0.30 | $0.50 | $0.03 | $1.25 |

5m and 1h cache writes are now billed at separate rates (previously applied a single blended rate). Prior versions (≤ 1.0.x) used legacy Opus 4 pricing for all Opus models, over-estimating Opus 4.5+ costs by ~3x — **upgrade to 1.1.0 if you run Opus 4.5 or newer**.

Source: [Anthropic pricing documentation](https://docs.claude.com/en/docs/about-claude/pricing)

## Platform Support

Works on **macOS**, **Windows**, and **Linux**. Requires Node.js >= 18.

Zero dependencies.

## Background

- [GitHub Issue #46829](https://github.com/anthropics/claude-code/issues/46829): Cache TTL regression analysis
- [HN Discussion](https://news.ycombinator.com/item?id=47736476): Community reaction (168 points, 142 comments)
- [HNPulse KR](https://www.youtube.com/@HNPulseKR): Hacker News tech deep-dives in Korean ([Shorts](https://www.youtube.com/@HNPulseKR/shorts))

## Migration from claude-cache-monitor

v2.0 renamed the package to reflect the expanded scope (spike diagnosis + 1M-context detection + remediation, not just cache monitoring).

### New users

```bash
npm i -g claude-token-saver
# or, no install:
npx claude-token-saver
```

Skip the rest of this section.

### Upgrading from `claude-cache-monitor` v1.x

Two steps:

```bash
# 1. Remove the old package (its claude-cache-monitor bin is now obsolete).
npm uninstall -g claude-cache-monitor

# 2. Install the new one.
npm i -g claude-token-saver
```

Then update any `claude-cache-monitor …` references. The main one is `statusLine.command` in `~/.claude/settings.json`:

```jsonc
// before
"command": "claude-cache-monitor --statusline --icon"

// after
"command": "claude-token-saver --statusline --icon"
```

### Why we dropped the `claude-cache-monitor` bin alias

Earlier v2.0 releases shipped a `claude-cache-monitor` bin alongside `claude-token-saver` so existing settings would keep working without edits. In practice this caused an `EEXIST: file already exists` error on `npm i -g claude-token-saver` when v1.x was still installed — and that collision forced the uninstall step anyway. Dropping the alias makes the upgrade path a clean two-liner and lets `npm i -g claude-token-saver` succeed directly if you've never installed the old one.

### Zero-install (npx)

```bash
npx claude-token-saver@latest --statusline --icon
```

No uninstall needed; npm just fetches the new name.

## License

MIT

