# Statusline reference

[← README](../README.md) · [한국어](./STATUSLINE.ko.md)

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
| `🔬 high` | Effort level the session is running at (`/effort`). Magenta at `high`, which is what Claude Code resolves an unset effort to; gray below it; amber at `xhigh` and `max`, where each turn buys quality with tokens. Absent on models that carry no effort setting, and on Claude Code older than 2.1.276 |
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
