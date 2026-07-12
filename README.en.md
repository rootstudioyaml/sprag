[한국어](./README.md) · **English**

[![DeepPulse YouTube](https://img.shields.io/badge/YouTube-@DeepPulseKR-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseKR)
[![DeepPulseEN YouTube](https://img.shields.io/badge/YouTube-@DeepPulseEN-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseEN)
[![Homepage](https://img.shields.io/badge/Homepage-rootstudioyaml.github.io-2ea44f)](https://rootstudioyaml.github.io/)
[![npm](https://img.shields.io/npm/v/claude-token-saver.svg)](https://www.npmjs.com/package/claude-token-saver)

# claude-token-saver

**Diagnose and save Claude Code tokens from a single statusline.** Zero dependencies, one-line install.

```bash
npm i -g claude-token-saver   # postinstall auto-registers the statusline + Skill
```

![statusline example](./docs/statusline.png)

## ⚡ Why — the 30-second pitch

| | |
|---|---|
| 💸 **−18.6% measured cost** | Cost per user message $2.35 → $1.91 after adopting harness+ratchet (author's logs, [details](#real-world-impact--beforeafter-report)) |
| 🚨 **No surprise rate limits** | Instant warning when the 5H/7D window hits 90% + `handoff` to back up your work |
| 🧠 **Cache waste detection** | Hit rate, TTL countdown, 1M-context detection — token spikes diagnosed with issue codes |
| 🅷 **Stop repeating mistakes** | Recurring errors get promoted to ratchet rules — auto-applied from the next session |
| 💰 **Savings made visible** | See what prompt caching saved you, live (`💰 Cache saved $2.1K`) |

📺 [Launch Short (60s)](https://www.youtube.com/shorts/RaD8qMsPTnA)

---

## Getting started

**Prerequisite:** Node.js ≥ 18 (`node -v` · macOS `brew install node` · Windows `winget install OpenJS.NodeJS.LTS` · Linux/WSL: [nvm](https://github.com/nvm-sh/nvm) recommended)

```bash
npm uninstall -g claude-cache-monitor   # (previous-package users only)
npm i -g claude-token-saver
```

The statusline appears at the bottom of Claude Code right away. If auto-registration was skipped (`--ignore-scripts`, sudo, sandboxed installs), run `claude-token-saver install`.

> ⚠️ Avoid `sudo` global installs — the Skill lands in root's `~/.claude` instead of yours. Use nvm/fnm/Volta or `npm config set prefix ~/.npm-global`.

## Reading the statusline

```
🤖 Opus 4.8 · 🧠 Cache hit 98.0% · ⏳ Cache expires 58:38 · ✦ current █░░░░░ 15% 🔄 08:50 · 📅 weekly █▒░░░░ 24% 🔄 Thu 13:00 · 📦 Ctx 200k · 💰 Cache saved $205 · last 1d
```

| Segment | Meaning |
|---|---|
| `🤖` | Active model |
| `🅷 5/5` | Harness principle score ([Harness mode](#-harness-mode)) |
| `🧠` | Cache hit rate (green at 85%+) |
| `⏳` | Cache TTL countdown — send a message before expiry to keep the cache warm |
| `✦ current` / `📅 weekly` | 5-hour / 7-day rate-limit window usage + reset time |
| `📦` | Context usage (e.g. `Ctx 68% of 1M`) — colored by fill. Current models default to 1M with no premium, but token volume itself drives per-turn cost and 5H/7D burn |
| `💰` | Cumulative savings from prompt caching |

When something is wrong, a **warning chip leads the line**:

```
🚨 5H █████▓ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 4.8 · 🧠 Cache hit 72.1% · ⚠ Cache miss · 📅 weekly ▓░░░░░ 12% 🔄 Sun 14:26 · 📦 Ctx 200k · last 1d
```

Chips — `🚨 5H/7D NN%` (cap imminent) · `⚠ Ctx 200k+` (a single request actually exceeded 200k) · `⚠ Cache miss` · `⚠ Input spike` · `⚠ Output heavy` · `⚠ Call surge` · `⚠ Rebuild churn` · `⚠ 5m TTL`. When both windows cross 90% at once, the sooner-resetting one is promoted to 🚨 and the other stays visible as a red segment (v2.16.0+).

### When a chip appears

Run the `/claude-token-saver` Skill inside Claude — or just say the chip wording ("5H cap is up", "cache miss") and it auto-activates. The Skill surfaces the **root-cause code + step-by-step fix**. When a cap is imminent, run `claude-token-saver handoff` to back up your work state to markdown and continue in a fresh session.

## Commands

Run these in your shell (inside Claude Code, the `/claude-token-saver` Skill is the only entry point):

| Command | What it does |
|---|---|
| `claude-token-saver` | Last-1-day diagnostic report (`--days N` / `--hours N`) |
| `claude-token-saver last` | Most recent warning + remediation |
| `claude-token-saver history` | Last 7 days of warning transitions |
| `claude-token-saver handoff` | Back work up to `HANDOFF-*.md` before a cap blocks you |
| `claude-token-saver mode [keywords...]` | Output config (`icon`/`text`, `en`/`ko`, `1h`–`30d` window, …) |
| `claude-token-saver harness ...` | 🅷 Harness management (below) |
| `claude-token-saver frugon` | Export sessions → [frugon](https://github.com/Rodiun/frugon)-compatible JSONL (model-routing savings analysis, below) |
| `claude-token-saver install` | Manually register Skill + statusline |

Switch output language with `mode ko` / `mode en` (English default; statusline chips stay symbolic).

<details>
<summary>All CLI options</summary>

| Flag | Description | Default |
|------|-------------|---------|
| `--days, -d` | Analysis period in days | 30 |
| `--hours` | Analysis window in hours (overrides `--days`) | – |
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
</details>

## 🅷 Harness mode

Bootstrap five engineering principles (Ratchet · Evidence · PEV · Structured Task · Default Safe Path) into `CLAUDE.md` with one command; the statusline scores it as `🅷 5/5`. When the same error keeps recurring, a `🅷⚠ ratchet?` nudge appears so you can promote it to a rule.

```bash
claude-token-saver harness init                # this project
claude-token-saver harness init --global       # ~/.claude/CLAUDE.md — every project
claude-token-saver harness check               # current score (global fallback honored)
claude-token-saver harness promote <N> --project|--global   # warning #N → ratchet rule (scope required)
claude-token-saver harness list / rm <N>       # view / delete rules (auto .bak)
claude-token-saver harness off | on            # toggle the 🅷 chip
```

- `promote` **requires** `--project`/`--global` in non-TTY contexts (scripts, LLM calls) — a scope choice is never silently made for the caller.
- 🅷⚠ runtime warnings (`ratchet?` `no-evidence` `PEV-skip`) expire after 30 minutes, subdirectory sessions match their project correctly, and PEV-skip counts only mutating tools (Edit/Write/Bash) so read-only research sessions don't trip it (v2.16.0+).

<details>
<summary>⚠️ <code>harness rm</code> — checklist before deleting</summary>

The whole point of the ratchet is **one-direction accumulation**. Deleting rules casually means the same mistakes return.

- **Rule too broad, blocking valid cases?** → ❌ delete ✅ narrow the condition (e.g. `"no hardcoded values"` → `"no hardcoded values outside tests"`)
- **Rule too narrow, almost never fires?** → ❌ delete ✅ leave it (zero cost)
- **Genuinely wrong?** → ✅ delete then

An auto `.bak` is kept, but **the session context that earned the rule its place is not recoverable.**
</details>

## 🔀 frugon integration — "which calls could a cheaper model handle?"

claude-token-saver catches cache/context waste; [frugon](https://github.com/Rodiun/frugon) (a local LLM cost analyzer) covers **model routing** — finding calls that never needed your most expensive model. The `frugon` subcommand bridges the two:

```bash
claude-token-saver frugon               # last 30 days → ./frugon-export.jsonl
claude-token-saver frugon --run         # export + run frugon analyze immediately
claude-token-saver frugon --days 7 --project myproj --out logs.jsonl
```

- Converts `~/.claude/projects/` transcripts into the OpenAI-compatible JSONL frugon reads. **Analysis is fully local** — no logs or keys leave your machine (same principle frugon holds).
- **Cache-weighted tokens (default):** frugon doesn't know about prompt caching, so raw physical tokens would overstate your spend ~10x. By default the export folds in Anthropic's cache multipliers (read 0.1x · 5m write 1.25x · 1h write 2x) so frugon's dollar figures match your real bill. Use `--raw-tokens` for physical counts.
- Preserves the signals frugon's easy/hard router reads (prompt/completion tokens, conversation depth) plus the last user prompt and reply text for `--measure` quality sampling. Strip text with `--no-content`.
- Install frugon with `pipx install frugon` (if models show as unpriced, run `frugon update`).

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

## Real-world impact — before/after report

![claude-token-saver — harness + ratchet adoption impact](./docs/harness-impact.png)

harness 5/5 + ratchet applied to the author's own Claude Code work, normalized **per user message** (cutoff 2026-05-02, Opus 4.7 pricing):

| metric | before (7d / 739 msgs) | after (2d / 157 msgs) | Δ |
|---|---:|---:|---:|
| cost / user message | $2.345 | $1.910 | **−18.6%** |
| output tokens / message | 7,391 | 6,052 | −18.1% |
| assistant turns / message | 9.73 | 8.83 | −9.2% |
| tool calls / message | 5.72 | 5.25 | −8.2% |

Same request resolved in fewer round-trips → first-try success rate up — the effect of PEV + Structured Task forcing one-shot delivery.

<details>
<summary>Measurement notes — why cache hit rate isn't included · sample caveats</summary>

- The author is on the Max plan (1-hour cache TTL) with hit rate already converged near ~98%, so little headroom there. **Pro-plan users (5-minute TTL)** likely see hit rate itself rise with the handoff-before-expiry workflow.
- Handoff-before-expiry: watch the TTL countdown, run `claude-token-saver handoff` just before expiry to dump work state into a markdown brief, start a fresh cache cycle. Same flow handles the 1M warning and cap chips.
- ⚠️ POST window is only 2 days (157 msgs); statistical confidence is low, and week-to-week topic mix differs, so the tool effect isn't cleanly isolated.
</details>

## Pricing (Jul 2026)

Per million tokens (USD), as used by the cost estimator:

| Tier | Models | Input | 5m Write | 1h Write | Read | Output |
|---|---|---|---|---|---|---|
| `claude-fable-5` | Fable 5 / Mythos 5 | $10 | $12.50 | $20 | $1 | $50 |
| `claude-opus-new` | Opus 4.5 / 4.6 / 4.7 / 4.8 | $5 | $6.25 | $10 | $0.50 | $25 |
| `claude-opus-legacy` | Opus 4 / 4.1 / 3 | $15 | $18.75 | $30 | $1.50 | $75 |
| `claude-sonnet` | Sonnet 3.7 / 4 / 4.5 / 4.6 / 5 | $3 | $3.75 | $6 | $0.30 | $15 |
| `claude-haiku-4-5` | Haiku 4.5 | $1 | $1.25 | $2 | $0.10 | $5 |

Source: [Anthropic pricing docs](https://platform.claude.com/docs/en/about-claude/pricing). Sonnet 5 has an introductory $2/$10 rate through 2026-08-31; the estimator uses the standard sticker. Versions ≤ 2.16.x priced Fable 5 at the Sonnet tier (~3× under-estimate) — upgrade to 2.17.0+.

### Cache TTL by plan

| Plan | TTL | Controlled by |
|---|---|---|
| Max ($100–200/mo) | **1h auto** | `tengu_prompt_cache_1h_config` flag |
| Pro ($20/mo) | **5m fixed** | not configurable |
| API key | 5m default (1h via beta header) | `cache_control.ttl` |

## How it works · Environment

Claude Code logs every API call to `~/.claude/projects/<dir>/<session>.jsonl`. This tool dedupes streaming chunks by `requestId` and aggregates `cache_read_input_tokens` / `cache_creation.ephemeral_5m/1h_input_tokens` by day and session.

Node.js ≥ 18 · macOS / Linux / Windows / WSL · **zero dependencies**.

<details>
<summary>Known quirks · Migration · Background</summary>

**IntelliJ Claude Code plugin** — the statusline widget fuses frames at the character level when emoji are present (`59:548` artifacts). v2.8.5+ detects `TERMINAL_EMULATOR=JetBrains-JediTerm` and falls back to text mode automatically.

**Migration from claude-cache-monitor:**
```bash
npm uninstall -g claude-cache-monitor && npm i -g claude-token-saver
```
Also update `statusLine.command` in `~/.claude/settings.json` to `claude-token-saver …`.

**Background:** [GitHub Issue #46829](https://github.com/anthropics/claude-code/issues/46829) (cache TTL regression) · [HN discussion](https://news.ycombinator.com/item?id=47736476) · [DeepPulse KR](https://www.youtube.com/@DeepPulseKR) / [EN](https://www.youtube.com/@DeepPulseEN) · [Homepage](https://rootstudioyaml.github.io/)
</details>

## Release notes

### v2.19.0 (2026-07-12)
- **frugon integration**: `claude-token-saver frugon` — export session transcripts as [frugon](https://github.com/Rodiun/frugon)-compatible JSONL for model-routing savings analysis (`--run` to analyze immediately; cache-weighted tokens by default).

### v2.18.0 (2026-07-02)
- **1M-context warning re-scoped** — current models (Fable 5, Opus 4.6–4.8, Sonnet 5) all default to a 1M window with no long-context premium since Opus 4.7, so the "1M mode ON = expensive" framing is retired. The warning is now a **usage signal**: `⚠ 1M ON` → `⚠ Ctx 200k+` (a single request actually exceeded 200k), and remediation is reordered to lead with `/compact`/`/clear` + `/effort` instead of "disable 1M". The incorrect "long-context pricing kicks in past 200k" copy is fixed.
- **📦 segment shows live usage** — reads `context_window.used_percentage` from Claude Code's stdin and renders `📦 Ctx 68% of 1M`, colored by fill (green <70 / yellow 70–89 / red 90+). Falls back to transcript-inferred size when stdin is absent (1M now yellow, not red).
- Back-compat: the legacy `⚠ 1M ON` chip and old detail strings in existing history files still resolve.

### v2.17.0 (2026-07-02)
- **Fable 5 pricing tier** — `claude-fable-5`/`claude-mythos-5` previously fell through to the Sonnet tier ($3/$15), under-estimating costs ~3×. Now priced at the real rates ($10 input / $50 output / $12.50 5m-write / $20 1h-write / $1 read).
- README overhaul — top-level impact summary, segment table, harness scope-flag docs, pricing table brought current.

### v2.16.0 (2026-07-02)
- **Statusline fixes** — when two rate-limit windows are ≥90% at once, only the cap-warn-promoted window is suppressed (the other stayed hidden before); `--no-color` output is truly ANSI-free; the no-session fallback line keeps cap-warn / 🅷 / model chips.
- **Harness warning accuracy** — 🅷⚠ warnings expire after 30 minutes (previously lingered indefinitely); session cwd normalized to the project root (subdirectory launches match); no-cwd states no longer leak into every project.
- **Fewer PEV-skip false positives** — only mutating tools count; windows sliced by assistant turns.

<details>
<summary>Older versions (v2.8.5 – v2.15.0)</summary>

### v2.15.0 (2026-06-13)
- **Global harness init** — `harness init --global` installs the 5 sections into `~/.claude/CLAUDE.md` (+ `~/.claude/ratchet.md`), applying to every project. `harness check` honors global as a fallback (`🅷 5/5 (covered by global)`).
- npm homepage change; @DeepPulseEN + homepage badges.

### v2.13.x (2026-05-04)
- "Real-world impact" restructured as the harness+ratchet before/after report; statusline screenshot + impact chart; npm metadata cleanup; YouTube handle fix.

### v2.11.0 (2026-05-02)
- `harness list` / `harness rm <N>` (auto `.bak`, "narrow the condition first" guidance).

### v2.9.x (2026-04-27)
- Output language toggle (`mode ko`/`en`) for `last`/`history`/advice; Skill responds in the configured language; Node.js prerequisite block; Skill workflow guide; `language` config location cleanup.

### v2.8.6 (2026-04-27)
- **Skill auto-registers on install** via postinstall hook.

### v2.8.5
- IntelliJ plugin frame-fusion workaround — auto text mode under JediTerm.

Older versions: see `git log`.
</details>

## License

MIT
