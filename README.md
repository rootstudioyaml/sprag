**English** · [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/claude-token-saver.svg)](https://www.npmjs.com/package/claude-token-saver)

🌐 **[Project page](https://rootstudioyaml.github.io/claude-token-saver/)**

# claude-token-saver

**Shows what it saved, on two lines.** It moves the easy work your expensive model keeps repeating onto cheaper ones, and turns documents the model cannot read into Markdown. Both figures are ledger entries rather than estimates, and whichever saved more takes the top line. Zero dependencies, one-line install.

![statusline example — routing savings on row 1, document conversion savings on row 2, diagnostics on row 3](./docs/statusline.png)

```bash
npm i -g claude-token-saver
```

Four numbers are the whole pitch.

- **Beats every single model on public benchmark data**: the shipped tier criteria score 59.1% on 11,696 LLMRouterBench instances against the best single model's 57.9% — at 31% less than gpt-5, 64% less than gemini-2.5-pro ([benchmark](./docs/BENCHMARK.md))
- **95.8% fewer tokens per document**: a 30MB deck read as Markdown cost 22,610 tokens instead of 540,429 ([evidence](#-doc2md--documents-become-markdown-before-the-model-reads-them))
- **18.6% lower cost**: measured before/after adopting the Harness principles ([evidence](#real-world-impact--beforeafter-report))
- **Routing savings are a per-run ledger**: the price difference of each delegated run, not an estimate ([evidence](#-the-savings-figure-is-a-ledger-entry-not-an-estimate))

```text
                      accuracy          total cost, 11,696 queries
tier-criteria router  59.1%  ← best     $268  ▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱
gpt-5                 57.8%             $388  ▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱
gemini-2.5-pro        57.9%             $734  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
```

Since v3.35.0 spend is visible too: month-to-date spend shows as `💵 Sep $42`, and on LiteLLM gateways (Bedrock and friends) with no 5h/7d caps, your key budget renders as a `🔑 budget ▰▱ 34% $34/$100` gauge.

## Four parts, working together

| | What it does | Effect |
|---|---|---|
| 🔀 **Routing** | Delegates recurring easy work to cheaper models | Savings recorded per run in a ledger; criteria [benchmarked](./docs/BENCHMARK.md) on public data |
| 📄 **Document conversion** | Turns pptx/xlsx/pdf/docx/fig into Markdown before the model reads them | **510,000 tokens** saved on one deck ([below](#-doc2md--documents-become-markdown-before-the-model-reads-them)) |
| 🅷 **Harness** | Blocks the token-burning habits: unevidenced "done", skipped verification (5 principles) | **−18.6% cost** ([measured](#real-world-impact--beforeafter-report)) |
| ⚙️ **Ratchet** | Freezes each error you hit into a rule | Same mistake stops recurring |

One install sets up all four. The measured −18.6% comes from the harness and ratchet; routing and conversion savings sit on top of it.

The two savings figures are never added together, because they answer different questions. Routing says "the same work ran on a cheaper model". Conversion says "a file you could not read became readable, without pushing the original through the context window". The statusline gives each its own line and puts the larger one first.

## Contents

- **Start here**: [Getting started](#getting-started) · [Reading the statusline](#reading-the-statusline) · [Commands](#commands)
- **Savings**: [The routing ledger](#-the-savings-figure-is-a-ledger-entry-not-an-estimate) · [route-scan](#-route-scan--this-recurring-task-could-run-on-a-cheaper-tier) · [doc2md](#-doc2md--documents-become-markdown-before-the-model-reads-them) · [seed](#-seed-delegation-that-works-from-the-first-session) · [Benchmark](./docs/BENCHMARK.md)
- **Guardrails**: [Harness](#-harness-mode) · [compact-window](#-compact-window--pin-where-a-1m-session-compacts) · [Korean writing guidance](#-korean-writing-guidance)
- **Spend & environments**: [Monthly spend · LiteLLM key budget](#litellm-your-key-budget-stands-in-for-the-missing-5h7d-caps-v3350) · [Gateways (Bedrock/Vertex)](#-behind-a-gateway-bedrock--vertex) · [Spike issue codes](#spike-issue-codes) · [Measured impact](#real-world-impact--beforeafter-report)

## Getting started

**Prerequisite:** Node.js ≥ 18 (`node -v` · macOS `brew install node` · Windows `winget install OpenJS.NodeJS.LTS` · Linux/WSL: [nvm](https://github.com/nvm-sh/nvm) recommended)

```bash
npm uninstall -g claude-cache-monitor   # (previous-package users only)
npm i -g claude-token-saver
```

The statusline appears at the bottom of Claude Code right away. If auto-registration was skipped (`--ignore-scripts`, sudo, sandboxed installs), run `claude-token-saver install`.

One install sets up everything: **statusline, Skill, SessionStart hook, the 🅷 Harness (5 principles), and a first route-scan.** The harness and the Korean writing guidance **show what they add and ask before enabling it.** The harness is **appended** to `~/.claude/CLAUDE.md` as a marked block (your existing content is backed up and preserved) and is left alone if one is already there.

Outside a terminal — npm `postinstall`, CI, piped stdin — the question is skipped and the old defaults apply. Use `--yes` or `--no-input` to skip it deliberately, `CTS_NO_HARNESS=1 npm i -g claude-token-saver` to skip the harness entirely, and `claude-token-saver harness uninit --global` to undo it.

> ⚠️ Avoid `sudo` global installs — the Skill lands in root's `~/.claude` instead of yours. Use nvm/fnm/Volta or `npm config set prefix ~/.npm-global`.

### What the install turns on, and what stays manual

Everything that costs nothing until it is needed is on after a plain install. The only manual items are the ones that change Claude Code's own settings or need a human to pick a scope.

| Feature | After install | How to turn it off |
|---|---|---|
| statusline (diagnostic chips, savings ledger) | on | `claude-token-saver uninstall` |
| `/claude-token-saver` Skill | on | same |
| SessionStart hook (route-scan refresh) | on | same |
| UserPromptSubmit hook (brief injection) | on | same |
| First route-scan (last 14 days of logs) | runs once during the install | n/a |
| 🅷 Harness 5 principles (`~/.claude/CLAUDE.md`) | on (shown and confirmed once at a terminal) | `harness uninit --global`, `CTS_NO_HARNESS=1` |
| doc2md hooks (Read, Edit/Write, prompt) | on | `doc2md off`, `CTS_NO_DOC2MD=1` |
| doc2md converter (markitdown venv) | offered at a terminal; an unattended install prints the command | install later with `doc2md install-converter` |
| Korean writing guidance | on when the locale is Korean (asked at a terminal) | `korean off`, `CTS_NO_KOREAN=1` |
| compact-window warning chip | on | `compact-window off` |
| Update-available chip | on | `CTS_NO_UPDATE_CHECK=1` |
| **Pinning compact-window** (`autoCompactWindow` 500k) | **off — run it yourself** | `compact-window set --global` or `--project` |
| **Model-fitting rules** (`ratchet-model.md` delegations) | **candidates are proposed only** | review and approve with `route-scan rules` |
| `handoff` (back up work before a cap) | an on-demand command | n/a |

`compact-window set` writes into Claude Code's `settings.json` and a human has to choose global or project scope, so it is never run for you. Model-fitting rules keep an approval step for the same reason: which work belongs on a cheaper tier is your call.


## 🔀 The savings figure is a ledger entry, not an estimate

Every delegated run is recorded like this:

```
   before             after          gap
  claude-opus-5  →  haiku-4-5   =   $0.57
  (the model         (what          (same token counts,
   handling this      actually       priced against
   before the rule)   ran it)        both models)
```

```bash
$ claude-token-saver route-scan savings      # trace every dollar back to its rule

🔀 Routing saved, lifetime $2.09  (last 7d $1.40 · 30d $2.09)

By model change:
  claude-fable-5 → claude-sonnet-5   —  1 run, $0.72
  claude-opus-5 → claude-haiku-4-5   —  1 run, $0.57

By run (newest first):
  2026-08-22    $0.51  claude-fable-5 → claude-haiku-4-5
            rule: T2|paste|-Users-me-projects-my-app
```

**What is excluded** — an honest number beats a big one:

- Delegations no registered rule covers (`Explore`, your own agents, plugin subagents): this tool did not route them.
- Model ids the pricing table cannot recognize: the run is dropped rather than priced wrong.

---

## ⚡ What else the statusline catches

| | |
|---|---|
| 🚨 **No surprise rate limits** | Warns when the 5H/7D window hits 90%; `handoff` backs up your work |
| 🧠 **Cache waste detection** | Hit rate, TTL, 1M-context detection — spikes diagnosed with issue codes |
| 💵 **Spend visibility** | Month-to-date spend (`💵 Sep $42`) always on; behind a LiteLLM gateway the key budget gauge (`🔑 budget 34% $34/$100`) stands in for the missing 5h/7d caps ([below](#litellm-your-key-budget-stands-in-for-the-missing-5h7d-caps-v3350)) |
| 🇰🇷 **Korean writing guidance** | Offered at install time, defaulting to your locale ([below](#-korean-writing-guidance)) |

## Not a router — 60 seconds

It never intercepts a request in realtime.
**After a session ends** it reads your local logs, finds the easy patterns your expensive model
kept handling, and promotes them into rules so a cheaper model takes them **from the next session
onward**. Rules are scoped global or per-project.

### Why realtime model routing can cost more, not less

Never switching models mid-session is the point of this design.

Prompt caches are **kept per model.** Switch to a cheaper model mid-session and it starts from a cold cache, re-reading the whole conversation at full input price. A cache hit costs about a tenth of that, so past roughly 20k tokens of history **one switch can erase everything the cheaper model was going to save.** You moved the work down a tier and the bill went up: the central paradox of realtime routing.

Teams shipping routing products have turned the feature off for exactly this reason: [LLM 라우터를 만든 사람들이 직접 껐습니다 #Shorts](https://www.youtube.com/shorts/SK-GoAABjbg) (Korean).

So this tool never touches the main session's model. It delegates to **subagents only**, which leaves the main session's cache intact and runs the delegated work on a cheap model in its own context. That is why the savings are not cancelled out by cache loss.

```bash
npm i -g claude-token-saver@latest
claude-token-saver route-scan         # find delegation candidates in your own history (0 LLM calls)
claude-token-saver route-scan rules   # list promoted rules · rm <N> to remove
claude-token-saver route-scan savings # audit every dollar the routing saved
```

Thresholds come from **your own last-14-day distribution (p25/p75)**, not someone else's benchmark.
Measured rule-health — whether a delegated run actually succeeded — landed in [v3.9.0](#v390-2026-08-01).

---

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
| `🅷 5/5` | Harness principle score ([Harness mode](#-harness-mode)) |
| `🧠` | Cache hit rate (green at 85%+) |
| `⏳` | Cache TTL countdown — send a message before expiry to keep the cache warm. Ticking while idle requires Claude Code v2.1.97+ (see [If the countdown looks frozen](#how-it-works--environment)) |
| `✦ current` / `📅 weekly` | 5-hour / 7-day rate-limit window usage + reset time |
| `📦` | Context usage (e.g. `Ctx 68% of 1M`) — colored by fill. Current models default to 1M with no premium, but token volume itself drives per-turn cost and 5H/7D burn |
| `💵 Sep $42` | **Estimated spend since 00:00 on the 1st of this month** (local time). Summed per session with that session's model pricing; always shown, even on gateways with no 5h/7d caps (v3.35.0) |
| `🔑 budget` | **LiteLLM key budget gauge.** When stdin carries no rate_limits, shows the key's `spend` against `max_budget` as `🔑 budget ▰▱ 34% $34/$100` (v3.35.0, [below](#-behind-a-gateway-bedrock--vertex)) |
| `💰` | Cumulative savings from prompt caching — a **different** number from row 1's `🔀` (model routing) |
| `v3.24.0` | The version you are running. Gray, at the tail, when it is the latest one |
| `⬆ v3.24.0 → 3.25.0` | A newer release exists. Actionable, so it moves to the front of the line ([Update notifications](#-update-notifications)) |

When something is wrong, a **warning chip leads the line**:

```
🚨 5H █████▓ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 4.8 · 🧠 Cache hit 72.1% · ⚠ Cache miss · 📅 weekly ▓░░░░░ 12% 🔄 Sun 14:26 · 📦 Ctx 200k · last 1d
```

Chips — `🚨 5H/7D NN%` (cap imminent) · `⚠ Ctx 500k+` (a single request actually exceeded 500k) · `⚠ Cache miss` · `⚠ Input spike` · `⚠ Output heavy` · `⚠ Call surge` · `⚠ Rebuild churn` · `⚠ 5m TTL`. When both windows cross 90% at once, the sooner-resetting one is promoted to 🚨 and the other stays visible as a red segment (v2.16.0+).

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
| `claude-token-saver route-scan savings` | The routing-savings ledger — per-model-change rollup + per-run log (the evidence behind the figure) |
| `claude-token-saver compact-window` | Warn when a 1M-context session has no auto-compact cap → pin 400k with `set` (below) |
| `claude-token-saver korean on\|off\|status` | Inject Korean writing guidance at session start and install the write-time check (below) |
| `claude-token-saver cohesion on\|off\|status\|show` | Inject English cohesion guidance (sentence-connection rules) at session start |
| `claude-token-saver korean lint block\|warn\|off` | How the write-time check handles findings |
| `claude-token-saver korean lint scope all\|prose` | Check every text file, or documents only |
| `claude-token-saver doc2md on\|off` | Convert attached documents to Markdown before the model reads them (below) |
| `claude-token-saver doc2md <file>` | Convert one file by hand. Diagnostic: it prints the refusal reason instead of swallowing it |
| `claude-token-saver mode ttl=5m\|1h\|auto` | Pin the cache TTL bucket. The default `auto` trusts the measured split, then falls back to gateway detection |
| `claude-token-saver --version` | Print the installed version |
| `claude-token-saver update-check` | Is a newer version out? (`--refresh` to ask now, `--dismiss` to mute this version's offer) |
| `claude-token-saver upgrade` | Install the latest release with the package manager that installed this copy (`--print` shows the command only) |
| `claude-token-saver install` | Manually register Skill + statusline |
| `claude-token-saver uninstall [--purge]` | Remove the hooks, statusline and skill it registered. Recorded savings are kept unless `--purge` is given |

The output language is decided once, at install time: a terminal install proposes the system locale and asks whether to use Korean, while an unattended install records what the locale says. Once recorded it is never asked again, not even on an upgrade. Change it later with `mode ko` / `mode en`, or pin it for a scripted install with `CTS_LANG=ko` / `CTS_LANG=en`. Statusline chips stay symbolic either way.

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

## ⬆ Update notifications

A statusline cannot open a dialog, and it re-renders every ~300ms, so it can never touch the network while drawing. The notification is therefore split in two:

- **The statusline tells you.** Up to date: a quiet gray `v3.24.0` at the tail. Newer release out: `⬆ v3.24.0 → 3.25.0` in yellow, moved to the front. Never red — nothing is broken.
- **Session start asks you.** On a new session or `/clear`, the SessionStart hook injects one line telling the model a newer version exists and to ask before installing anything. Only after you agree does it run `claude-token-saver upgrade`.
- **Declining sticks.** `claude-token-saver update-check --dismiss` mutes the offer for that version; the next release asks again. The statusline chip stays — you declined the question, not the fact.

The registry lookup runs at most once every 24h in a detached background process and only ever writes a cache file (`update-check.json`) — the same shape npm's `update-notifier` uses. A failed check still stamps its timestamp, so an offline machine backs off instead of retrying on every render. Turn checks off entirely with `CTS_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER`.

## 🅷 Harness mode

Bootstrap five engineering principles (Ratchet · Evidence · PEV · Structured Task · Default Safe Path) into `CLAUDE.md` with one command; the statusline scores it as `🅷 5/5`. When the same error keeps recurring, a `🅷⚠ ratchet?` nudge appears so you can promote it to a rule.

```bash
claude-token-saver harness init                # this project
claude-token-saver harness init --global       # ~/.claude/CLAUDE.md — every project
claude-token-saver harness check               # current score (global fallback honored)
claude-token-saver harness analyze             # run the transcript analysis manually (no hook needed); refreshes harness-state.json
claude-token-saver harness promote <N> --project|--global   # warning #N → ratchet rule (scope required)
claude-token-saver harness promote "<rule text>" --project|--global  # register your own hand-written rules the same way
claude-token-saver harness pull                # register the package's curated ratchet rules into your global ratchet (opt-in, dedupes)
claude-token-saver harness list / rm <N>       # view / delete rules (auto .bak)
claude-token-saver harness off | on            # toggle the 🅷 chip
```

- `promote` **requires** `--project`/`--global` in non-TTY contexts (scripts, LLM calls) — a scope choice is never silently made for the caller.
- `pull` registers the **author-curated ratchet rules** bundled with the package (`presets/ratchet-rules.json` — only general-purpose rules promoted from real recurring mistakes) into your global ratchet (`~/.claude/ratchet.md`). `install`/`init` never auto-inject anything; `pull` is always opt-in and idempotent. Drop any rule you dislike with `harness rm`.
- `seed` offers the same presets **one at a time**. Where `pull` registers the whole ratchet set in one go, `seed` covers the model-fitting presets too and asks about each of them in the first session after an install or upgrade ([below](#-seed-delegation-that-works-from-the-first-session)).
- 🅷⚠ runtime warnings (`ratchet?` `no-evidence` `PEV-skip`) expire after 30 minutes, subdirectory sessions match their project correctly, and PEV-skip counts only mutating tools (Edit/Write/Bash) so read-only research sessions don't trip it (v2.16.0+).

<details>
<summary>⚠️ <code>harness rm</code> — checklist before deleting</summary>

The whole point of the ratchet is **one-direction accumulation**. Deleting rules casually means the same mistakes return.

- **Rule too broad, blocking valid cases?** → ❌ delete ✅ narrow the condition (e.g. `"no hardcoded values"` → `"no hardcoded values outside tests"`)
- **Rule too narrow, almost never fires?** → ❌ delete ✅ leave it (zero cost)
- **Genuinely wrong?** → ✅ delete then

An auto `.bak` is kept, but **the session context that earned the rule its place is not recoverable.**
</details>


## 📦 compact-window — pin where a 1M session compacts

Claude Code compacts when usage approaches `min(autoCompactWindow, model max context)`. On a 1M window, with that value unset, compaction only fires near 800k — and until then every request re-bills the whole context. **1M is too large; the recommendation is a 400k–700k band** — 2–3.5x a 200k session's headroom for the genuinely large pastes, with the runaway tail cut off.

**Anything inside the band is left alone.** 400k is the floor where the saving beats the extra compactions, and long sessions often want more room than that. Only an unset window, or one above 700k, is warned about (a smaller one is a deliberate, more aggressive choice).

**200k sessions are never warned** — their window is already at or below 200k, so the setting cannot change anything.

```bash
claude-token-saver compact-window                       # status (model, window, value, source)
claude-token-saver compact-window set --global          # pin 500k (mid-band) in ~/.claude/settings.json
claude-token-saver compact-window set --project         # pin it in <root>/.claude/settings.json
claude-token-saver compact-window set --global --value 600k   # explicit value (100k–1M)
claude-token-saver compact-window off | on              # toggle the warning
```

- On a 1M model with the value unset or above 700k, the statusline shows `🅷⚠ compact-window?` and the session briefing hands the model the exact registration command.
- Scope (`--global`/`--project`) is **required** for `set` — a global settings file is never edited on a guess.
- Every other key in `settings.json` is preserved and a `.bak` is written first. Malformed JSON aborts the write untouched.
- An exported `CLAUDE_CODE_AUTO_COMPACT_WINDOW` beats settings.json; `set` detects that and says so.

## 🔀 route-scan — "this recurring task could run on a cheaper tier"

Finds the easy work your expensive model (opus/fable) keeps redoing in your session logs and proposes **haiku/sonnet delegation rules**. Fully local, zero token cost.

- **T2 → haiku**: lookups, pasted-screen Q&A, simple runs — zero errors, near-zero mutation
- **T1 → sonnet**: build pipelines, status checks — few mutations, ≤1 error
- **T0 stays**: repeated errors, heavy mutation, design/analysis — the session model keeps it

Three design pillars:
1. Difficulty is judged by **outcome, not text guessing** — tool errors, mutating tool calls, output tokens
2. Thresholds **auto-calibrate to your own 14-day distribution** — fixed constants drift with workload
3. Promoted rules live in a tool-owned file (`.claude/ratchet-model.md`) that **refreshes itself every scan**, and a `⚠ rule-health` flag fires when a delegated category's error rate climbs — rules report their own staleness

```bash
claude-token-saver route-scan                    # scan (24h cache) + tiered candidates
claude-token-saver harness promote R1 --project  # promote candidate R1 to a model-fitting rule
claude-token-saver route-scan dismiss 1          # not interested — won't resurface
claude-token-saver route-scan rules              # list model-fitting rules (rm <N> to remove)
claude-token-saver route-scan savings            # the savings ledger — which rule moved work off which model, onto which
```

Dig deeper: **tier criteria & research evidence** → [docs/TIER_CRITERIA.md](./docs/TIER_CRITERIA.md) (Korean) · **rule-file mechanics, scan triggers, subagent setup** → [docs/ROUTE_SCAN.md](./docs/ROUTE_SCAN.md) (Korean + English)

### Behind a gateway (Bedrock / LiteLLM)

Through a corporate gateway the transcript records an inference-profile ARN where the model id belongs. That string says nothing about `opus` or `haiku`, so older versions read every session as Sonnet — which made **T1 (→sonnet) rules unreachable and zeroed the savings figures**.

Since v3.10.0 the profile id is mapped back to a role (main, opus, sonnet, haiku) and then to the alias your `ANTHROPIC_DEFAULT_*_MODEL` variables declare. The mapping is learned by joining each parent `Task` call to the subagent run it spawned via `toolUseId`. Below three observations, or when the role votes agree less than 80% of the time, the id stays `unknown` and drops out of the delegation aggregate rather than being guessed at.

For environments the learner cannot reach, write the mapping yourself in `<userDataDir>/profile-map.json`. Account id and region may be wildcarded:

```jsonc
{
  "modelAliases": {
    "arn:aws:bedrock:*:*:application-inference-profile/<PROFILE_ID>": "claude-opus-5",
    "prod-large": "claude-opus-5",   // house aliases map the same way
    "team-*": "claude-haiku-4-5"
  }
}
```

**Map house aliases that carry no family name** (`prod-large`, `team-fast`) here too. Shapes that keep the family name are recognized as-is — Bedrock (`anthropic.claude-opus-4-5-v1:0`), Vertex (`claude-opus-4-5@20251101`), and the 1M suffix (`claude-sonnet-4-5[1m]`) — but an alias without one cannot be priced. Rather than report a wrong figure, routing-savings **drops those runs from the aggregate** (both sides of the comparison must be recognizable); one line in the table above brings them back.

That file holds internal identifiers in plain text — do not commit it. On a direct-API machine it is never created and behaviour is unchanged.

## 🌱 seed: delegation that works from the first session

The model-fitting ratchet (`ratchet-model.md`) **starts empty.** A rule exists only after route-scan has seen the same kind of work recur in your own logs and you have approved that candidate. So a fresh install delegates nothing, and keeps delegating nothing for days — precisely the stretch where the savings would matter most.

`seed` fills that gap from presets bundled with the package.

| Presets | What they cover | File |
|---|---|---|
| 9 model-fitting | running commands, lookup, status checks, questions about pasted logs, read-and-summarize — each with a T2 (haiku) and a T1 (sonnet) rule | `presets/model-rules.json` |
| 6 ratchet | general-purpose rules promoted from mistakes that actually recurred | `presets/ratchet-rules.json` |

**How they get registered:** in the first session after an install or upgrade, the SessionStart hook hands the pending presets to the model, which walks the user through them **one at a time**. Each answer runs one of these immediately:

```bash
claude-token-saver seed                                   # pending presets + recorded answers
claude-token-saver seed accept <id> --global|--project     # register one (scope required)
claude-token-saver seed accept all --global                # when the user says "register them all"
claude-token-saver seed skip <id>                          # decline — never offered again
claude-token-saver seed reset                              # clear the answers and offer everything again
```

- **Nothing is written without a yes to that specific rule.** A declined rule stays declined across upgrades; a later release only surfaces the presets it actually added.
- A preset is withheld when you already approved a rule of the same shape (same tier and category).
- A seeded rule **does not pass someone else's statistics off as yours.** It is recorded as `preset (curated)` until a scan measures real firings and delegations, and then those numbers replace it. If its delegated error rate crosses the threshold it gets the same review flag as any other rule.
- The scope must be stated as `--global` or `--project`. The hook environment is non-TTY, so the CLI cannot ask — the model confirms with the user and passes the flag.

## 🇰🇷 Korean writing guidance

Injects guidance that corrects how Claude writes Korean (dropped sentence parts, noun-stopped sentences, translationese, em-dash overuse) **once per session.**

```bash
claude-token-saver korean on       # on, for every project
claude-token-saver korean status   # state, cost, provenance
claude-token-saver korean show     # print the guidance itself
claude-token-saver korean off      # off
```

Claude Code's output styles can do the same thing, but an output style is **a single global slot**: turning it on takes that slot away from anything else and has to be configured per machine. This ships the guidance inside the package and delivers it through the SessionStart hook that is already installed, so it **applies wherever the CLI is installed and leaves the output-style slot free.** It survives `/clear`, because the hook fires again.

Cost is **~1.5k tokens per session, injected once at session start rather than per turn**, and covered by the prompt cache from the second request on. When it is on, a `✍️` chip appears in the statusline.

### Before and after

From a real pipeline (yaml-sns-agent), where a Slack bot shells out to `claude -p` to investigate the repository and answers in a thread. The guidance was toggled off and then on, with the same question both times: "explain in three Korean sentences how to narrow down a render failure."

**Before** (guidance off)

> 렌더 실패 원인 좁히기 3단계: 먼저 `hn:still --check`로 스틸이 명세보다 최신인지(FRESH/STALE) 확인 — STALE이면 재생성 안 해서 옛 자산으로 렌더 시도한 게 원인. 다음 caption-blocks가 최신 나레이션과 단어열 일치하는지 직접 대조 — TTS 재생성 후 blocks 재생성 빠지면 자막·음성 어긋나 렌더 깨짐.

**After** (guidance on)

> 먼저 `hn:still --check` 돌려 스틸이 명세보다 최신인지 확인한다. STALE이면 재생성 안 해서 생긴 문제.
>
> 다음 caption-blocks가 captions.json 단어열과 일치하는지 본다. 내레이션 재TTS 후 blocks 재생성 빠지면 옛 자막이 새 음성 위에 뜬다.

Three things change. Clauses chained with em dashes become separate sentences, so one sentence carries one fact. Noun-stopped phrases (확인, 대조, 렌더 깨짐 — "check", "compare", "render breaks") become predicates (확인한다, 본다, 뜬다), which makes it explicit that these are steps to take. And the particles come back where they had been dropped, so subject and object are legible on the first read.

The technical content is identical in both. The guidance touches sentence construction only, not judgement or accuracy: the answer does not change, it just stops needing a second read. In a channel people scroll through, that difference cuts follow-up questions — and the tokens those follow-ups would have cost.

### The supplement: cohesion and conservative correctness rules

The vendored fluent-korean text ships unmodified; everything collected since lives in a separate supplement (`presets/korean-style/supplement.md`) appended to the same injection. It was compiled conservatively — only clauses that are nearly always an improvement, sourced from the National Institute of Korean Language's public-language guidelines, the Kubernetes Korean localization guide, and three peer-reviewed studies on text cohesion in Korean writing.

It adds three layers:

- **Translationese**: double passives, Japanese-derived calques, `~에 있어서`, possession-verb renderings of English *have*. The machine-checkable ones also run in the write-time lint (below).
- **AI-writing tics**: automatic intensifiers ("다양한", "핵심적인"), signpost sentences, rhetorical question-then-answer, unconditionally upbeat endings.
- **Cohesion** — how sentences connect, which no regex can check. The research finding that shapes this section: surface connectives (conjunctions, demonstratives) correlate *negatively or not at all* with judged text quality, while elaboration — the next sentence picking up and unpacking what the previous one introduced — is the only connection type with a positive correlation. So the guidance says: when a transition feels rough, fix the information order (given before new), don't add a connective.

**Most of the cohesion layer is not Korean-specific.** Given-before-new ordering (the "given-new contract"), one clear referent per pronoun, keeping one subject per paragraph, bridging sentences instead of leaping, and merging choppy repetitive sentences into a modifier-plus-core structure apply to English prose the same way — the studies happen to be about Korean learners, but the principles they validate are the standard cohesion model from text linguistics. If you write English deliverables with Claude, run `claude-token-saver cohesion on` — it injects exactly those five rules as a standalone English block (~0.5k tokens per session), no Korean feature required. While `korean on` is active the block is suppressed, because the Korean supplement already carries the same rules.

A final subsection lists what must **not** be "corrected": settled domain terms, formal register, and verbatim quotations — every lint finding is a request to confirm, not a verdict.

### The write-time check (v3.24.0)

Injecting the guidance once at session start turned out to be half the job. The model reads it, then writes dozens of files over the next hours with nothing re-reading the output. Sessions with the guidance active still shipped violations into documents, and it surfaced only when a human read the finished artifact. An August 2026 fix reworded the scope sentence to address this; it recurred, because rewording an instruction does not add a checkpoint.

From v3.24.0 `korean on` also installs a PostToolUse hook. It opens the file the model just wrote, runs the clauses a machine can decide, and hands any findings back. The file is already saved, so nothing is lost — the model fixes it on the spot.

```bash
claude-token-saver korean lint block   # default: findings are handed back as blocking feedback
claude-token-saver korean lint warn    # print findings, do not block
claude-token-saver korean lint off     # disable the check

claude-token-saver korean lint scope all     # default: every text file the session writes
claude-token-saver korean lint scope prose   # documents only

claude-token-saver korean lint docs/*.md     # check files already on disk
```

Checked: 15 figurative phrases, translationese markers, separators (`—`·`ㅡ`·`|`), three or more `의` particles in one phrase, and a period after a nominal ending. Clauses that need judgement stay with the guidance text.

The default `all` scope covers code comments, UI strings, subtitles, templates, and build output, not just documents. The vendored guidance exempts comments, but comments are read by people and generated artifacts (PDF, HTML) are assembled from those strings, so exempting them reopens the exact gap that was reported. Only installed dependencies, VCS internals, lockfiles, and binary or image files are skipped; `dist/` and `build/` are checked. `korean lint scope prose` restores the narrow reading.

The scope sentence in the injected guidance is generated from the same setting, so the model is never told one rule while being corrected against another.

### The encoding rule that ships with it (v3.23.2)

Alongside the writing guidance, one more line is injected: **non-ASCII strings in tool-call parameters must be written as literal UTF-8, never as `\uXXXX` unicode escapes.**

When the model puts Korean into a Write or Edit parameter as escapes, those escapes are sometimes not decoded into code points at all: the literal text `한` lands in the file. The artifact carries mojibake, and the model keeps editing on top of it without noticing that what it wrote and what the file holds have diverged. Not writing escapes in the first place removes the path entirely, so the rule blocks the input instead of repairing the output.

This line lives in claude-token-saver's own framing paragraph, not in the vendored fluent-korean text. It governs encoding rather than style, and the vendored wording is kept unmodified. For the same reason it carries no exceptions, unlike the style rules that skip code and commit messages. It adds roughly 60 tokens per session.

> **Evidence**
> The same failure is reported against Claude Code: [#12417, unicode handling regression](https://github.com/anthropics/claude-code/issues/12417) and [#26141, Edit silently corrupting unicode](https://github.com/anthropics/claude-code/issues/26141).

### Asked at install time

The install **prints what the guidance changes, its per-session cost and its source, then asks.** A Korean system locale (`ko_KR` and friends; on macOS the system setting is checked too) makes the question default to yes; anything else defaults to no, so users who never write Korean are not billed 1.5k tokens a session. The locale is only a default, so an English-locale machine used for Korean work can still turn it on right there.

Installs with nobody attached — npm `postinstall`, CI, piped stdin — skip the question and apply the locale default, because a blocked prompt hangs the install. In that case, if the locale is not Korean the setting is **left undecided rather than recorded**, so a later run at a terminal still gets to ask. Use `--yes` or `--no-input` to force the non-interactive path, or `CTS_NO_KOREAN=1` to skip the feature entirely. **Once you have turned it on or off yourself, that choice sticks — an upgrade never overrides it.**

> **Source and license**
> The guidance text comes from [fluent-korean](https://github.com/snflkd/fluent-korean). Copyright (c) 2026 snflkd, MIT License.
> The wording is unmodified; only the output-style frontmatter was removed. The full license ships with the package at `presets/korean-style/LICENSE-fluent-korean`.

## 📄 doc2md — documents become Markdown before the model reads them

`Read` a pptx, xlsx, pdf or docx and the raw bytes go into the context window, where the model cannot read them. This intercepts that `Read`, converts the file once, and hands over the Markdown instead.

**This is opt-in.** Installing the CLI does not turn it on: both commands below are required, and a registered hook with no converter behind it does nothing at all.

Three situations, three different interception points:

| Situation | Where it is caught |
|---|---|
| A document path typed in the prompt (`@path`, quoted, or relative) | `UserPromptSubmit`: converted, and the conversion's path is handed back as context |
| A document opened with `Read` mid-task | PDFs are caught by `PreToolUse(Read)`. pptx/xlsx/docx/fig are not: Claude Code refuses them as binary *before* any hook runs, so the session-start note tells the model to run `doc2md <path>` instead |
| A document attached to the message | **Not catchable.** No hook event receives attachment content. The session-start note has the model ask for a path next time |

That second row is measured, not assumed: a `.pdf` Read fires the hook, and a `.pptx` Read in the same session leaves no hook log entry at all.

```bash
claude-token-saver doc2md on                  # register the hooks (the converter installs itself)
claude-token-saver doc2md                     # check converter + hook registration
claude-token-saver doc2md report.pptx         # convert by hand and see the result
claude-token-saver doc2md install-converter   # only to get the install out of the way early
```

**The converter installs itself.** Any rollout step a person has to be told about is a step some of them skip, so the converter installs in the background the moment a document first shows up, and converts as soon as it is ready. Measured: about 30s for the first document (15s install plus markitdown's first import), then 3.7s for a new document and 0.1s on a cache hit. The `.fig` parser installs in half a second on the first Figma file.

It installs on first use rather than at `install` time: the venv is 47MB, and someone who never opens a document should not pay for it. Set `CTS_DOC2MD_NO_AUTOINSTALL=1` to turn the automatic install off.

**Python 3.10+ is required** — markitdown's own floor, and macOS still ships 3.9 as `/usr/bin/python3`. The venv is built on an interpreter chosen by version rather than by PATH order. Built on 3.9, pip resolves markitdown to a 2019 placeholder release (0.0.1a1): the install looks like it worked and every conversion then dies at import. This was found by walking into it. When nothing on the machine is new enough, the message points at `brew install python` instead of at an install command that cannot succeed.

The converter goes into a venv this tool owns (`<state dir>/doc2md-venv`): no system interpreter is touched, and uninstalling the CLI takes it along. An existing markitdown on `uv tool` or `PATH` is preferred over building a new one.

Conversion is [markitdown](https://github.com/microsoft/markitdown). Slide numbers, heading levels, tables, speaker notes and per-sheet headings all survive, and non-Latin text comes through intact.

Several things it deliberately does not do:

- **Images are not converted.** markitdown returns nothing for them, and OCR misread resource names in testing (`c5.xlarge` as `c.xlarge`). In a document where those names *are* the content, wrong text is worse than none. The model reads images natively anyway.
- **A missing converter never fails silently.** The install command is shown once, then the original `Read` proceeds untouched. Repeating the notice on every read would be its own nuisance; saying nothing is how a broken converter hides. Run `doc2md` with no arguments to see the converter and hook registration together.
- **Conversions never land in your project.** They go under the tool's own state directory with mode `0700`, so there is nothing to add to `.gitignore`. Filenames matching payroll/contract/secret patterns are skipped entirely.
- **Zip bombs are refused.** pptx/xlsx/docx are zip containers: the declared sizes are checked first, and since those are written by whoever built the file, the real decompressed bytes are counted against a ceiling too.
- **Spreadsheets are capped by rows, not bytes.** Conversion time tracks row count (measured: a 6.3MB PDF in 0.9s, a 5.8MB workbook in 47.75s). Past 50,000 rows only the head is converted, and **the truncation and the true row count are both stated** in what the model is told.

### What a conversion saves

Every conversion is stamped with a provenance header: which original, when, how many tokens. Savings show up on the statusline's own `📄 Doc2md saved` line.

The baseline is what you would have done without a converter, and that differs by format. Both were measured on 2026-09-06.

**PDF is priced against attaching it.** The same one-line prompt was sent through `claude --print --input-format stream-json` with and without the file as a document block. The control turn cost 42,204 tokens, twice, to the token.

| Attached file | Size | Extra tokens | Per page |
|---|---|---|---|
| Résumé PDF | 7 pages | +20,537 | 2,934 |
| Résumé PDF | 5 pages | +12,709 | 2,542 |

An attached PDF is read whole, but every page costs 2,500–2,900 tokens against 5,531 for the conversion. The coefficient used is 2,500 per page — below both measurements, so the figure understates rather than flatters.

**pptx/xlsx/docx are priced against unpacking the container.** These never reach the model as attachments at all: the same probe on a docx added 78 tokens and the model replied that it had no file, and `Read` refuses the format outright. What you actually do without a converter is unzip the archive and read its XML, where tags and style attributes outweigh the words.

| Original | Body XML | Conversion | Ratio |
|---|---|---|---|
| Deck, pptx (31.8MB) | ~540,429 tokens | ~22,610 tokens | 23.8× |
| Résumé, docx (189KB) | ~79,621 tokens | ~1,684 tokens | 47.3× |

This baseline is measured per file from the real XML size, not applied as a per-format ratio. `.xls` is not a zip container and has no markup to measure, so it claims nothing.

### Figma `.fig` converts too

Planning documents are moving from PowerPoint to Figma, so the same hook catches `.fig`. A `.fig` is a zip, but the `canvas.fig` inside it is Figma's private binary (kiwi format), which markitdown cannot open — so this one format is converted in Node with [openfig-core](https://github.com/OpenFig-org/openfig-core) (MIT). `doc2md install-converter` places it beside markitdown in the tool's state directory; the package itself still ships zero dependencies.

The result is an outline: pages and frames become headings, text nodes become body lines, and shapes are counted rather than listed — in a planning document the words are the content, and two hundred `Rectangle 173` lines would drown them. A file with no text at all is refused rather than dressed up as an empty document.

Verified against real files: a community Bootstrap UI kit (8.1MB, 4,155 nodes, 1,312 of them text) and a 52MB Tailwind kit, each converting in under a second. Both `.fig` vintages parse — the current zip container and the older bare fig-kiwi stream.

**`.fig` saves the most of any format.** Unlike the Office containers, `Read` does not refuse a `.fig`: the extension means nothing to it, so it pulls the binary in as text and the context window fills with tokenised noise. Measured against the same 42,760-token control:

| File | Size | Extra tokens for a Read | Conversion |
|---|---|---|---|
| plan.fig | 26KB | +44,195 | 100 tokens |
| bootstrap-kit.fig | 8.1MB | +43,994 | 18,397 tokens |

Two files three hundred times apart in size cost the same, because Read truncates long before the file ends — you pay for a whole document and receive a fraction of one. The baseline is therefore a flat 44,000 tokens. For comparison, the same probe on a pptx cost +317 tokens and on a docx +185: a refusal message, and nothing else.

#### Why the baseline does not scale with file size

A baseline has to be what would actually have been spent without the converter. Intuition says a bigger file burns more, but the `Read` tool has a cap (2,000 lines by default, plus a per-line character limit), and a binary file hits it almost immediately: even the 26KB file was already truncated, which is why two files 300× apart came out 201 tokens apart. Had the 8.1MB file gone in whole it would have been millions of tokens — money nobody could have spent, since it does not fit in a 200k context window. Claiming to have saved unspendable money is flattery, not measurement.

The same principle runs through every baseline here:

- **`.fig`, flat 44,000** — set below both measurements (44,195 and 43,994). A model could burn size-proportional tokens by re-Reading at successive offsets, but one Read is what a sane agent does once the bytes turn out to be binary noise, so one Read is the honest counterfactual.
- **PDF, 2,500 per page** — below both measured values (2,542 and 2,934).
- **Office formats, the file's actual XML size** — the one case where proportional is right, because a person really does end up reading that XML; it is measured per file rather than applied as a ratio.

The common rule: wherever an estimate and a measurement diverge, the lower number wins. A figure the user can trust is worth more than one that flatters the tool.

### Editing a document: copy, then script

Conversion is one-way — editing the cached `.md` changes nothing in the source. The hook refuses `Edit`/`Write` on both the cache and the original binary, and points at the right path instead: copy the original, edit the copy with a script, re-convert the copy to verify.

`install-converter` puts the editing libraries (python-pptx, python-docx, openpyxl) in the same venv, so a structural request like "swap the chart on slide 23 for a line chart" is a short script the agent writes on the spot. `.fig` edits go through openfig-core, which encodes as well as parses.

All four formats were exercised end to end on 2026-09-06: 10 docx run replacements plus three consecutive re-saves, a pptx bar-to-line chart swap with an added data point, xlsx value edits and a new row, and a fig text edit with re-encode and re-parse. In every case the original was byte-identical afterwards and the re-converted copy showed the change. One caveat: removing a chart shape from a pptx leaves the old chart XML part orphaned — PowerPoint ignores it, but delete the part and its rels for a clean file. Charts and images never appear in a conversion, so visual edits must be confirmed in the application itself.

### DRM-wrapped documents

Encryption and DRM are different problems with different answers. Enterprise DRM (Fasoo, MarkAny, SoftCamp and the like) does not password a document — it wraps the whole file, and only processes the vendor's agent has whitelisted ever see plaintext. Python is not one of them, so what sits on disk is ciphertext behind a vendor header, and **no password will open it.**

The first bytes decide which story to tell: a zip header means a truncated download, an OLE container means a password, and neither means the file is not that format at all.

```
✗ bad-archive: File is not a zip file            → download it again
✗ encrypted: password-protected Office file      → ask for an unlocked copy
✗ drm-protected: DRM-wrapped file (FASOO)        → ask for a copy released from DRM
```

Vendor names are matched only to say which client to go to; the classification stands without recognising the vendor. PDFs are judged the same way through their public DRM security-handler names (FOPN_foweb, EBX_HANDLER, Adobe.APS).

### Locked documents, and Windows

**A password-protected document is a state, not an error.** Office encrypts by wrapping the package in an OLE compound file rather than a zip, so opening one as a zip used to report "not a zip file" — which reads as a broken download and sends the user after the wrong problem. It is now identified before conversion:

```
✗ encrypted: password-protected Office file (OLE-wrapped)
✗ encrypted: password-protected PDF
```

The model is told to ask for an unlocked copy. This tool never asks for or stores a password, and never blocks the original `Read`, so work continues either way. A PDF that merely restricts printing still opens and still converts — checked against a false positive — and a legacy `.xls`, which is an OLE file by design, is not mistaken for an encrypted one.

**Windows is supported.** For teams with Windows machines:

- The Python search uses the `py -3` launcher. `python3` is rarely on PATH there, and a bare `python` may be the Store alias stub that opens a web page instead of running anything. Venv interpreters are looked for at `Scripts\python.exe`.
- The `.fig` parser installs through `npm.cmd` via the shell, and the package spec dropped its caret (`openfig-core@0.4.x`): in cmd.exe `^` is the escape character and never reaches npm.
- The background install and every child process set `windowsHide`, so no console window appears in the middle of someone's prompt.

`claude-token-saver doc2md --clean` empties the conversion cache; `doc2md off` removes the hook. Removal filters for this tool's own entry, so anything else you registered under `PreToolUse` stays.

## 🌐 Behind a gateway (Bedrock / Vertex)

A gateway reports the cache-creation total but never the 5m/1h split. That left the tool unable to tell "nothing cached yet" from "this provider does not say", and the fallback assumed an hour — for a window that is really five minutes on Bedrock, overstating it twelvefold.

Since v3.26.0 the gateway is detected from the model ids in the transcript, which fixes:

- The countdown falls back to 5 minutes, labelled `5m?`. Three grades of certainty get three labels: measured (`5m`), inferred (`5m?`), unknown (`?`).
- In a 5-minute bucket the countdown colour follows absolute time rather than a percentage. 30% of five minutes is 90 seconds, and green there promised comfort that was not there.
- The `⚠ 5m TTL` warning finally reaches these users — with different advice, since no subscription plan changes a gateway's TTL.
- `Extra cost if 5m-only` is only asked of sessions that have 1h writes to lose. Elsewhere the arithmetically honest `+$0` read as an endorsement of the bucket you are already stuck in.
- Delegated runs dropped for an unpriceable model id show as `🔀 N unresolved` instead of nothing, which used to be indistinguishable from never having delegated.
- Environment variables set to a `foundation-model` ARN now resolve. An opaque `application-inference-profile` id still does not: guessing at it is how wrong prices enter the ledger.

If the detection is wrong, pin it with `claude-token-saver mode ttl=5m` (or `ttl=1h`). An explicit value outranks the measurement.

### LiteLLM: your key budget stands in for the missing 5h/7d caps (v3.35.0)

Behind a LiteLLM proxy (Bedrock and friends), Claude Code's stdin never carries `rate_limits`, so the `✦ current` / `📅 weekly` gauges simply do not exist. LiteLLM does track per-key budgets, so the statusline draws a budget gauge in their place.

- Detection: `ANTHROPIC_BASE_URL` points somewhere other than the official endpoint, and `ANTHROPIC_AUTH_TOKEN` (or `ANTHROPIC_API_KEY`) is set.
- The proxy is asked via `GET /key/info` and `GET /user/info` — only the calling key's own data. Renders read a cache file; a detached background process refreshes it every 5 minutes (same shape as the update check), so the statusline never waits on the network.
- Budget source priority follows real-world usage: the **team-membership budget** (`team_memberships[].spend` + its linked budget table row) first, then the key's own `max_budget`, then the internal-user budget. Verified against a Dockerized LiteLLM, including memberships whose budget diverges from the team max into a separate budget-table row.
- Unlimited keys (no `max_budget`) get no gauge. The `💵` monthly-spend segment still shows, since it comes from session logs.
- Inspect with `claude-token-saver litellm-budget` (cached) or `litellm-budget --refresh` (query now).

One related non-bug: if your session model is already sonnet, a sonnet-delegation (T1) rule can never save anything, because there is no price gap to capture. That is correct, but `route-scan rules` displayed it identically to "no delegations yet", so it now says outright that the rule does not apply at the current default model.

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

**If the countdown looks frozen:** ticking while idle requires Claude Code to re-run the statusline command on a timer, controlled by `statusLine.refreshInterval` (seconds, Claude Code v2.1.97+) in `~/.claude/settings.json`. Without it the line only redraws when the conversation updates. If behavior differs per terminal, check three things: ① that machine's Claude Code is ≥ 2.1.97; ② no project `.claude/settings.json` / `settings.local.json` overrides `statusLine` without a refreshInterval; ③ the statusline wrapper actually finds `claude-token-saver` on PATH instead of falling back to a multi-second `npx` run on every render (typical when nvm is not loaded in non-login shells). Re-running `claude-token-saver install` restores refreshInterval=5.

**Migration from claude-cache-monitor:**
```bash
npm uninstall -g claude-cache-monitor && npm i -g claude-token-saver
```
Also update `statusLine.command` in `~/.claude/settings.json` to `claude-token-saver …`.

**Background:** [GitHub Issue #46829](https://github.com/anthropics/claude-code/issues/46829) (cache TTL regression) · [HN discussion](https://news.ycombinator.com/item?id=47736476)
</details>

## Release notes

The full history moved to [CHANGELOG.md](./CHANGELOG.md) (Korean; version headings and command names are language-neutral). Recent changes:

- **v3.39.0**: `feedback` subcommand — file bug reports and feature requests straight from the terminal or a Claude session, via the gh CLI, an anonymous no-login form (auto-filed as a GitHub issue by an Apps Script relay), or a local fallback. `install` now asks before replacing an existing statusline instead of silently skipping.
- **v3.38.0**: `cohesion on` — the language-neutral cohesion rules from the Korean supplement become a standalone English injection (given-before-new, one referent per pronoun, subject consistency, bridging, merging choppy sentences). Opt-in, ~0.5k tokens per session, suppressed while `korean on` already carries them.
- **v3.37.0**: Korean guidance grows a conservative supplement (translationese, AI-writing tics, a research-backed cohesion section whose principles apply to English prose too) and the write-time lint gains 5 translationese patterns, validated at 1 false positive across 255 real files.
- **v3.35.0**: A `💵 Sep $42` segment now shows estimated spend since 00:00 on the 1st of the current month, always on — including gateway setups with no 5h/7d caps. LiteLLM gateway users get a `🔑 budget ▰▱ 34% $34/$100` gauge built from the key's budget (`GET /key/info` + `GET /user/info`, team-membership budget first, then key, then internal user — verified against a Dockerized LiteLLM).
- **v3.34.0**: seed presets offered one at a time, output-language choice at install, context warning raised to 500k.

## Feedback

Found a bug, or want a feature? Open an issue: https://github.com/rootstudioyaml/claude-token-saver/issues

No browser or GitHub login handy (corporate network, mid-session)? Submit straight from the terminal — or ask Claude to do it for you:

```bash
claude-token-saver feedback "the 5m TTL chip never clears on Bedrock"
```

It files a GitHub issue via the `gh` CLI when one is authenticated; otherwise it submits anonymously (no login, works where github.com is blocked). Pass `--anonymous` to skip the `gh` path. Version and OS metadata are attached automatically.

When reporting a bug, please include the tool version (`claude-token-saver --version`), your OS, and — if it is a statusline or warning issue — the statusline output or the `claude-token-saver last` result.

## License

MIT

---

## Who makes this

[![DeepPulse YouTube](https://img.shields.io/badge/YouTube-@DeepPulseKR-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseKR)
[![DeepPulseEN YouTube](https://img.shields.io/badge/YouTube-@DeepPulseEN-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseEN)
[![Homepage](https://img.shields.io/badge/Homepage-rootstudioyaml.github.io-2ea44f)](https://rootstudioyaml.github.io/)

Built and used at **DeepPulse**, a channel about AI developer tooling. The [launch Short (60s)](https://www.youtube.com/shorts/RaD8qMsPTnA) covers where this came from and how it is used.
