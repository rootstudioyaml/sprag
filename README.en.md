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
| `claude-token-saver route-scan` | Detect recurring easy work on expensive models → propose haiku-delegation ratchet rules (below) |
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
claude-token-saver harness promote "<rule text>" --project|--global  # register your own hand-written rules the same way
claude-token-saver harness pull                # register the package's curated ratchet rules into your global ratchet (opt-in, dedupes)
claude-token-saver harness list / rm <N>       # view / delete rules (auto .bak)
claude-token-saver harness off | on            # toggle the 🅷 chip
```

- `promote` **requires** `--project`/`--global` in non-TTY contexts (scripts, LLM calls) — a scope choice is never silently made for the caller.
- `pull` registers the **author-curated ratchet rules** bundled with the package (`presets/ratchet-rules.md` — only general-purpose rules promoted from real recurring mistakes) into your global ratchet (`~/.claude/ratchet.md`). `install`/`init` never auto-inject anything; `pull` is always opt-in and idempotent. Drop any rule you dislike with `harness rm`.
- 🅷⚠ runtime warnings (`ratchet?` `no-evidence` `PEV-skip`) expire after 30 minutes, subdirectory sessions match their project correctly, and PEV-skip counts only mutating tools (Edit/Write/Bash) so read-only research sessions don't trip it (v2.16.0+).

<details>
<summary>⚠️ <code>harness rm</code> — checklist before deleting</summary>

The whole point of the ratchet is **one-direction accumulation**. Deleting rules casually means the same mistakes return.

- **Rule too broad, blocking valid cases?** → ❌ delete ✅ narrow the condition (e.g. `"no hardcoded values"` → `"no hardcoded values outside tests"`)
- **Rule too narrow, almost never fires?** → ❌ delete ✅ leave it (zero cost)
- **Genuinely wrong?** → ✅ delete then

An auto `.bak` is kept, but **the session context that earned the rule its place is not recoverable.**
</details>


## 🔀 route-scan — "this recurring task could run on a cheaper tier"

Analyzes your session history at the **episode (user request) level**, classifies the work your expensive model (opus/fable) keeps doing into **tiers**, and proposes delegation rules. Fully local, zero token cost. Criteria design and evidence: [docs/TIER_CRITERIA.md](./docs/TIER_CRITERIA.md).

- **T2 → haiku**: few calls, tiny output, near-zero mutation, no errors (lookups, pasted-screen Q&A, simple runs)
- **T1 → sonnet**: moderate output, few mutations, ≤1 error (build pipelines, status checks)
- **T0 stays**: repeated errors, heavy mutation, big output, design/analysis keywords — the session model keeps it

Signals: call count, output tokens, **mutating tool calls (Edit/Write/Bash)**, **tool errors**, and request text. Output thresholds are auto-calibrated from your own 14-day distribution (fixed constants drift with workload).

```bash
claude-token-saver route-scan                    # scan (24h cache) + tiered candidates
claude-token-saver harness promote R1 --project  # promote candidate R1 to a model-fitting rule
claude-token-saver route-scan dismiss 1          # not interested — won't resurface
claude-token-saver route-scan rules              # list model-fitting rules (rm <N> to remove)
```

### Model-fitting ratchet — a separate file, continuously refreshed

Promoted delegation rules never mix with hand-written ratchet rules: they live in a **separate, fully tool-owned file** — `.claude/ratchet-model.md` per project, `~/.claude/ratchet-model.md` for global scope — regenerated wholesale on every scan, and they stay alive afterward:

- **Auto-refresh**: every rescan recomputes recurrence counts and the category's error rate from fresh logs and rewrites the file. Your `ratchet.md` is never touched by stat churn, so repos that commit `.claude/` see no diff noise (`ratchet-model.md` is safe to gitignore — it's always regenerable from the registry).
- **rule-health**: when the delegated category's error rate exceeds 20%, the rule gets a `⚠ rule-health` flag suggesting you narrow or remove it — the "define difficulty by outcome" principle applied to rule lifecycle.
- Your rules are managed by `harness list/rm`; model-fitting rules by `route-scan rules [rm <N>]` — separate files, separate indexes.
- The CLAUDE.md ratchet section planted by `harness init` references both files, so Claude applies them together (existing users: re-run `harness init` to refresh the block).

How it works (session-boundary calibration, NOT a real-time router):
1. `install` registers a SessionStart hook that injects the cached scan results as session context on startup and `/clear`. Rescans are **data-triggered, not time-triggered**: ~5MB of new transcripts since the last scan rescans immediately, a small trickle rescans daily, and no change means no rescan at all (an unchanged-input scan is deterministic). A 1-hour minimum-interval guard applies, and promoting a rule triggers one immediate refresh to establish its stat baseline.
2. When a recurring (≥3×) pattern exists, the statusline shows a `🅷⚠ route? R1` chip and Claude asks you whether to register it, and at which scope (`--project`/`--global`).
3. Promoted rules make **the main model delegate that work type to a haiku/sonnet subagent automatically from the next session on**.

Recommended companion setup: create `model: haiku` subagents under `~/.claude/agents/` (e.g. haiku-explore / haiku-runner / haiku-translate) plus a `model: sonnet` general worker so the rules are immediately actionable.

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

### v3.2.0 (2026-07-13)
- **Tier classification (T0/T1/T2)** — route-scan grows from a binary easy/other split into three tiers. New signals: mutating tool calls and tool errors; output thresholds auto-calibrate to the user's own distribution (clamped); a dedicated category for pasted screen/log Q&A; conversational episodes (<100 output tokens) excluded. Design and research evidence in `docs/TIER_CRITERIA.md`.
- **Model-fitting ratchet separated** — promoted delegation rules live in their own file (`.claude/ratchet-model.md` / `~/.claude/ratchet-model.md`), file-level-separated from hand-written rules, managed via `route-scan rules [rm <N>]`; the harness CLAUDE.md block references both files.
- **Log-driven auto-refresh + rule-health** — every rescan recomputes each registered rule's recurrence count and error rate (over delegation-shaped episodes) and rewrites the file. An error rate >20% flags the rule with `⚠ rule-health`, suggesting narrowing or removal.
- **Data-triggered rescans** — the fixed 24h TTL is gone; new transcript volume triggers rescans (~5MB → immediately, a trickle → daily, no change → skip, 1h minimum interval, one immediate refresh after promote).

### v3.1.0 (2026-07-13)
- **frugon integration removed** — the `claude-token-saver frugon` JSONL-export subcommand is gone. An external analyzer's aggregate report can't be turned into ratchet rules (condition → action), so it never fed the delegation pipeline; 3.x instead invests in **first-party tier classification over session logs**. route-scan is unaffected (the shared parser moved to `src/session-records.js`).

### v3.0.1 (2026-07-13)
- **`harness pull` redefined** — v3.0.0's "copy global ratchet → project" was pointless (the global ratchet already applies to every project as the upper layer of the hierarchy) and is removed. `pull` now registers the **author-curated ratchet rules** bundled with the package (`presets/ratchet-rules.md`) into your global ratchet — six general-purpose rules promoted from real recurring mistakes; opt-in and idempotent.

### v3.0.0 (2026-07-13)
- **Major bump** — with v2.19's frugon integration and v2.20's route-scan, the product's character shifted from "after-the-fact token monitor" to "a routing layer that pushes recurring easy work down to cheaper models", so this ships as a major. No breaking changes (every existing command and setting remains compatible).
- **route-scan promote fix** — `harness promote R<N> --project` now writes the rule into the `.claude/ratchet.md` of the project the candidate was **detected in** (previously it landed in whatever directory the CLI ran from). The scan stores each candidate's real session path (`projectPath`); promoting a foreign-project candidate from a pre-3.0 cache without that field is refused with a pointer to `route-scan --refresh`.
- **New `harness pull`** — redefined in v3.0.1 (see above).

### v2.20.0 (2026-07-13)
- **route-scan**: detect recurring easy work on expensive models → `🅷⚠ route? R<N>` chip + SessionStart hook context injection + `harness promote R<N> --project|--global` to promote haiku-delegation ratchet rules.

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
