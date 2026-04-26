[한국어](./README.md) · **English**

# claude-token-saver

> Renamed from `claude-cache-monitor` in v2.0. Existing users — see [Migration](#migration-from-claude-cache-monitor).

A CLI to **diagnose and save tokens on Claude Code**. Cache hit rate, TTL countdown, 1M-context detection, 5h/7d cap warnings — all in one statusline chip.

📺 [Launch Short (60s)](https://www.youtube.com/shorts/RaD8qMsPTnA)

---

## Install

```bash
# 1. (existing users) remove the old package
npm uninstall -g claude-cache-monitor

# 2. install
npm i -g claude-token-saver

# 3. wire into Claude Code (Skill + statusline guidance)
claude-token-saver install
```

Or run once with no install: `npx claude-token-saver`.

## What you see after install

**(A) One-shot report** — `claude-token-saver`:

```
Claude token saver — Last 30 days
Context window: 200k  ✓ standard
Cache hit rate: 98.2%  |  Total input: 1957.94M tokens
TTL Breakdown / Cost Impact / Daily Trend ...
```

If a session spiked, a `⚠ Spike detected` block leads the report with root cause + a paste-ready remediation command.

**(B) Statusline chip** — once wired into `~/.claude/settings.json`:

```
🧠 97.5% · ⏳ 1h 42:15 · 💰 $4.8K · 🤖 Opus 4.7 · ✦ 5H 47% · 📅 7D 9%
```

Risk chips lead when something's wrong: `🚨 5H 94%`, `⚠ 1M ON`, `⚠ Cache miss`, `⚠ 5m TTL`.

## Wire up the statusline

```json
{
  "statusLine": {
    "type": "command",
    "command": "claude-token-saver --statusline --icon",
    "refreshInterval": 5
  }
}
```

`refreshInterval: 5` keeps the TTL countdown ticking while idle (Claude Code's statusline is otherwise event-driven). 1s also works, but 5s is the recommended default to avoid constant I/O. For Windows PowerShell, see `examples/statusline-command.ps1`.

## Commands

| Command | What it does |
|---|---|
| `claude-token-saver` | Last 30 days diagnostic report |
| `claude-token-saver --days 7` | Change window |
| `claude-token-saver --statusline --icon` | One-line statusline output |
| `claude-token-saver install` | Register Claude Code Skill (auto-activates on chip wording) |
| `claude-token-saver history` | Last 7 days of chip transitions (1M ON, Cache miss, cap, …) |
| `claude-token-saver handoff` | Back current work up to `HANDOFF-YYYY-MM-DD-HHMM.md` before a cap blocks you |
| `claude-token-saver --install-hook` | Auto-log cache stats on every tool call |

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--days, -d` | Analysis period in days | 30 |
| `--format, -f` | `table` / `json` / `csv` | table |
| `--project, -p` | Filter by project directory | all |
| `--threshold` | Hit-rate alert threshold (0.0–1.0) | 0.7 |
| `--statusline` | One-line statusline output | – |
| `--icon` | Use 🧠 / ⏳ / 💰 / 📦 icons | text |
| `--verbose` | Longer labels | – |
| `--no-timer` | Hide TTL countdown | show |
| `--no-color` | Strip ANSI codes | – |
| `--segments=…` | Limit statusline segments (e.g. `model,five_hour,seven_day,saved`) | all |
| `--install-hook` / `--uninstall-hook` | Manage the PostToolUse hook | – |

## Spike issue codes

| Code | Meaning |
|---|---|
| `LARGE_INPUT_PER_REQUEST` | single request > 250k tokens → 1M context likely |
| `LOW_HIT_RATE` | cache hit rate < 50% |
| `BUCKET_5M_DOMINANT` | > 70% of cache writes hit the 5m bucket |
| `HIGH_OUTPUT_RATIO` | output/input > 0.15 (output is 5× input price) |
| `HIGH_REQUEST_COUNT` | session made 3×+ your median (tool loop?) |
| `FREQUENT_CACHE_REBUILD` | `cache_creation` > `cache_read` |

Remediation commands are OS-aware (`~/.zshrc` for macOS/Linux/WSL, `setx` for Windows).

## Migration from claude-cache-monitor

```bash
npm uninstall -g claude-cache-monitor
npm i -g claude-token-saver
```

Then update `~/.claude/settings.json` — change `claude-cache-monitor …` to `claude-token-saver …`. The v2.0 alias bin was dropped because it caused `EEXIST` on global installs.

## How it works

Claude Code logs every API call to `~/.claude/projects/<dir>/<session>.jsonl`. This tool dedupes streaming chunks by `requestId` and aggregates `cache_read_input_tokens` / `cache_creation.ephemeral_5m_input_tokens` / `cache_creation.ephemeral_1h_input_tokens` by day and session.

## Pricing (Apr 2026)

| Tier | Models | Input | 5m Write | 1h Write | Read | Output |
|---|---|---|---|---|---|---|
| `claude-opus-new` | Opus 4.5 / 4.6 / 4.7 | $5 | $6.25 | $10 | $0.50 | $25 |
| `claude-opus-legacy` | Opus 4 / 4.1 / 3 | $15 | $18.75 | $30 | $1.50 | $75 |
| `claude-sonnet` | Sonnet 3.7 / 4 / 4.5 / 4.6 | $3 | $3.75 | $6 | $0.30 | $15 |
| `claude-haiku-4-5` | Haiku 4.5 | $1 | $1.25 | $2 | $0.10 | $5 |

Source: [Anthropic pricing docs](https://docs.claude.com/en/docs/about-claude/pricing). Versions ≤ 1.0.x over-estimated Opus 4.5+ by ~3× — upgrade if you're below 1.1.0.

## Cache TTL by plan

| Plan | TTL | Controlled by |
|---|---|---|
| Max ($100–200/mo) | **1h auto** | `tengu_prompt_cache_1h_config` flag |
| Pro ($20/mo) | **5m fixed** | not configurable |
| API key | 5m default (1h via beta header) | `cache_control.ttl` |

## Environment

Node.js ≥ 18 · macOS / Windows / Linux / WSL · zero dependencies.

## Background

- [GitHub Issue #46829](https://github.com/anthropics/claude-code/issues/46829) — cache TTL regression
- [HN discussion](https://news.ycombinator.com/item?id=47736476) — 168 points, 142 comments
- [HNPulse KR](https://www.youtube.com/@HNPulseKR) — Korean HN tech deep-dives

## License

MIT
