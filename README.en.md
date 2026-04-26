[한국어](./README.md) · **English**

# claude-token-saver

> Renamed from `claude-cache-monitor` in v2.0. Existing users — see [Migration](#migration-from-claude-cache-monitor).

A CLI to **diagnose and save tokens on Claude Code**. Cache hit rate, TTL countdown, 1M-context detection, 5h/7d cap warnings — all in one statusline chip.

📺 [Launch Short (60s)](https://www.youtube.com/shorts/RaD8qMsPTnA)

---

## Install

```bash
# (existing users) remove the old package
npm uninstall -g claude-cache-monitor

# install — the postinstall hook auto-registers the Skill and statusline
npm i -g claude-token-saver
```

Or run once with no install: `npx claude-token-saver`.

If postinstall was skipped (e.g. `--ignore-scripts`, sudo, or sandboxed installs), register manually:

```bash
claude-token-saver install
```

## Claude Code statusline

After install, Claude Code's bottom statusline updates every 5 seconds with cache state (postinstall registers it in `~/.claude/settings.json` automatically).

```
🤖 Opus 4.7 · 🧠 Cache hit 98.0% · ⏳ Cache expires 59:51 · 📦 Ctx 200k · 💰 Cache saved $221 · last 1d
```

Risk chips lead when something's wrong:

```
🚨 5H 94% (resets in 12m) · 🤖 Opus 4.7 · 🧠 Cache hit 72.1% · ⚠ Cache miss · 📦 Ctx 200k · last 1d
```

Risk chips: `🚨 5H/7D NN%`, `⚠ 1M ON`, `⚠ Input spike`, `⚠ Cache miss`, `⚠ 5m TTL`, `⚠ Rebuild churn`, `⚠ Output heavy`, `⚠ Call surge`.

If postinstall was skipped (you already use a different statusline, etc.), wire it manually:

```json
{
  "statusLine": {
    "type": "command",
    "command": "claude-token-saver --statusline --icon",
    "refreshInterval": 5
  }
}
```

`refreshInterval: 5` keeps the TTL countdown ticking while idle. For Windows PowerShell see `examples/statusline-command.ps1`.

## Skill — mention a chip, it activates

The Claude Code Skill registered at install time auto-activates whenever you mention chip wording in chat ("cache hit rate", "1M context", "5H cap"). It runs `claude-token-saver last` to surface the most recent warning + remediation, then points you at `history` / `handoff` for follow-up. (v2.6.0 folded the legacy `/token-monitor` slash command into this Skill — older installs are cleaned up automatically the next time you run `claude-token-saver install`.)

## One-shot report

Run `claude-token-saver` for the last-day diagnostic table:

```
  Claude Token Saver — Last 1 day
  (claude-token-saver v2.9.0)
  ══════════════════════════════════════════════════

  Context window: 200k  ✓ 200k context (standard)
  Sessions: 11  |  API calls: 578  |  Cache hit rate: 98.0%
  TTL Breakdown / Cost Impact / Daily Trend …
```

If a session spiked, a `⚠ Spike detected` block leads the report with the root-cause code (table below) and an OS-aware remediation command.

## Output language

`last` / `history` / advice messages render in one language at a time (statusline chips stay symbolic). English is the default — switch via:

```bash
claude-token-saver mode ko    # or: claude-token-saver mode lang=ko
claude-token-saver mode en    # back to English
claude-token-saver mode       # show current settings
```

## Commands

| Command | What it does |
|---|---|
| `claude-token-saver` | Last-1-day diagnostic report (`--days N` to change window) |
| `claude-token-saver last` | Most recent warning + remediation (the command the Skill invokes) |
| `claude-token-saver history` | Last 7 days of chip transitions (1M ON, Cache miss, cap, …) |
| `claude-token-saver handoff` | Back current work up to `HANDOFF-YYYY-MM-DD-HHMM.md` before a cap blocks you |
| `claude-token-saver mode [keywords...]` | Configure output (`icon`/`text`, `en`/`ko`, `verbose`, `1d`/`7d`, …) |
| `claude-token-saver --statusline --icon` | One-line statusline output (called by Claude Code) |
| `claude-token-saver install` | Manually register Skill + statusline (postinstall fallback) |
| `claude-token-saver --install-hook` | Optionally auto-log cache stats on every tool call |

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

## Known environment quirks

**IntelliJ Claude Code plugin** — the statusline widget fuses prior and current frames at the character level when emoji are in the output, producing artifacts like `Cache expires 59:548`. v2.8.5+ detects `TERMINAL_EMULATOR=JetBrains-JediTerm` and falls back to text mode automatically (`--icon` is also ignored under IntelliJ). Other terminals (iTerm, Terminal, WSL, etc.) are unaffected.

## Release notes

### v2.9.0 (2026-04-27)
- **Output language is now configurable.** `last` / `history` / advice render in a single language at a time. English by default; switch with `claude-token-saver mode ko`. Statusline chips remain symbolic.
- History files stay bilingual on disk; the language toggle is applied at display time.

### v2.8.6 (2026-04-27)
- **Skill auto-registers on install.** A `postinstall` hook wires the Claude Code Skill and statusline into `~/.claude` automatically — no second command. `claude-token-saver install` still works as a fallback for `--ignore-scripts` / sudo / sandboxed environments.
- README polish in both languages; corrected the `claude-cache-monitor` alias-removal note (timing was reversed).

### v2.8.5
- IntelliJ Claude Code plugin: auto-fall back to text mode when `TERMINAL_EMULATOR=JetBrains-JediTerm` to avoid frame-fusion artefacts.

Older versions: see `git log`.

## License

MIT
