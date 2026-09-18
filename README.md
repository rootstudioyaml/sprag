<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/site/assets/logo/sprag-lockup.svg">
  <img alt="Sprag" src="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/site/assets/logo/sprag-lockup-light.svg" width="220">
</picture>

**A quality ratchet for AI coding agents. Mistakes never repeat.**

[![npm](https://img.shields.io/npm/v/sprag-cli.svg?label=sprag-cli)](https://www.npmjs.com/package/sprag-cli)
[![downloads](https://img.shields.io/npm/dm/sprag-cli.svg)](https://www.npmjs.com/package/sprag-cli)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[English](https://github.com/rootstudioyaml/sprag/blob/main/README.md) · [한국어](https://github.com/rootstudioyaml/sprag/blob/main/README.ko.md)

[sprag.io](https://sprag.io) · [Benchmark](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md)

</div>

---

**Your agent keeps working, it just stops regressing.** Sprag is named after the sprag clutch: forward motion passes freely, backspin locks. It reads the sessions Claude Code already writes and turns them into gains that compound. Every repeated failure becomes a rule loaded at session start, work a cheaper tier has proven it can do is delegated there with a per-run savings ledger as the receipt, and cache or rate-limit trouble reaches your statusline while you can still act on it.

Zero dependencies, no API key, nothing leaves your machine.

```bash
npm i -g sprag-cli   # same package as the old claude-token-saver name
```

![statusline example — routing savings on row 1, document conversion savings on row 2, diagnostics on row 3](https://raw.githubusercontent.com/rootstudioyaml/sprag/main/docs/statusline.png)

## How it works

<picture>
  <source srcset="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/docs/how-it-works.svg" type="image/svg+xml">
  <img src="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/docs/how-it-works.png" alt="What goes in: your past sessions, the task you just asked for, a document you would attach, Korean prose being written, and the tokens this turn is spending. What sprag does with it: writes a ratchet rule loaded every session, converts the document, checks the Korean as you write, prints the cost in your prompt, and routes a matched task to a haiku or sonnet sub-agent whose output the main agent reviews.">
</picture>

Everything on the left is something your session already produces. Nothing is
sent anywhere to read it. The tier decision at the bottom is the whole routing
argument in three tests: where the answer lives, whether failure makes noise,
and what that rule's own track record says.

## Measured results

| Metric | Result | | Evidence |
|---|---|---|---|
| Public benchmark accuracy | **59.1%** vs 57.9% best single model | `▰▰▰▰▰▰▰▰▰▰▰▰` | [benchmark](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md) |
| Cost for the same queries | **$268** vs gpt-5 $388, gemini-2.5-pro $734 | `▰▰▰▰▰▱▱▱▱▱▱▱` | [benchmark](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md) |
| Tokens for the same documents | **−95.9%**, 2,011,178 → 82,209 over 12 files | `▰▱▱▱▱▱▱▱▱▱▱▱` | [doc2md](https://github.com/rootstudioyaml/sprag/blob/main/docs/DOC2MD.md) |
| Delegation savings, from the ledger | **$44.67** over 69 delegated runs | `▰▰▰▰▰▰▰▰▰▰▰▱` | `sprag route-scan savings` |
| Cost per user message | **−18.6%**, $2.345 → $1.910 | `▰▰▰▰▰▰▰▰▰▰▱▱` | [report](#real-world-impact--beforeafter-report) |

The first two rows come from a fixed public dataset and do not move. The next
two are ledgers on this machine and grow as it runs, so they are dated: figures
below are as of 2026-09-18. The last row is a one-off measurement taken on
2026-05-02 under Opus 4.7 pricing, and it cannot be recomputed, because the
transcripts behind its "before" window have since aged out of local retention.

### Current, on one machine, last 30 days

| | |
|---|---|
| Delegation savings | **$42.73** in 30 days (\$23.21 in the last 7), 69 runs total |
| Where the work moved | opus-5 → sonnet-5 59 runs \$39.75 · opus-5 → haiku-4.5 10 runs \$4.92 |
| Document conversion | 12 files (xlsx, pptx, pdf), 2,011,178 → 82,209 tokens |
| Volume behind it | 175 sessions, 14,682 API calls, 3.81B input tokens |
| Cache hit rate | 92.2% |

Every figure here is what the tool reports about itself: `sprag route-scan
savings` for the delegation rows, `sprag --days 30` for the volume, and the
doc2md ledger for the conversions. None of it is a projection.


Routing savings are a ledger, not an estimate: the price difference of each delegated run, traceable back to the rule that caused it with `sprag route-scan savings`. What the ledger deliberately excludes is documented in [the command reference](https://github.com/rootstudioyaml/sprag/blob/main/docs/COMMANDS.md).

## Everything ships in one install, working from day one

| | What it does | More |
|---|---|---|
| ⚙️ **Ratchet rules** | Repeated failures become one-line rules loaded every session; candidates are detected from your logs. | [harness](https://github.com/rootstudioyaml/sprag/blob/main/docs/HARNESS.md) |
| 🔀 **Model fitting** | Log-driven delegation rules with measured error rates and savings, written to `ratchet-model.md`. | [route-scan](https://github.com/rootstudioyaml/sprag/blob/main/docs/ROUTE_SCAN.md) |
| 🅷 **Harness score** | Five operating principles checked live. Skip the verify step and `🅷 4/5` says so before you report done. | [harness](https://github.com/rootstudioyaml/sprag/blob/main/docs/HARNESS.md) |
| 📊 **Token telemetry** | Cache hit rate, TTL, context size, output spikes and both rate-limit windows, every turn. | [statusline](https://github.com/rootstudioyaml/sprag/blob/main/docs/STATUSLINE.md) |
| 📄 **doc2md** | pptx, xlsx, pdf, docx and fig converted on demand instead of pasted into context. | [doc2md](https://github.com/rootstudioyaml/sprag/blob/main/docs/DOC2MD.md) |
| 🇰🇷 **Style gates** | Write-time prose lint enforced by hook: double passives, translationese, cohesion. | [style](https://github.com/rootstudioyaml/sprag/blob/main/docs/KOREAN-STYLE.md) |

The measured −18.6% comes from the harness and ratchet; routing and conversion savings sit on top of it. The two savings figures are never added together, because they measure different things.

## The statusline in one line

```
🔀 Routing saved $2.09  |  fable→sonnet 1× $0.72 · opus→haiku 1× $0.57
🚨 5H ▰▰▰▰▰▰▰▰▰▰▰▱ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 5 · 🧠 Cache hit 98.8% · ⏳ Cache expires 59:46 · 📅 weekly ▰▰▰▰▰▱▱▱▱▱▱▱ 38% · 💵 Sep $42 · 📦 Ctx 47% of 1M
```

When something is wrong the warning chip leads the line: `🚨 5H/7D NN%`, `⚠ Ctx 500k+`, `⚠ Cache miss`, `⚠ Input spike`, `⚠ Output heavy`, `⚠ Call surge`, `⚠ Rebuild churn`, `⚠ 5m TTL`. Say the chip wording inside Claude and the Skill surfaces the root-cause code and the fix. Segment-by-segment meanings live in [the statusline reference](https://github.com/rootstudioyaml/sprag/blob/main/docs/STATUSLINE.md).

Inside a JetBrains IDE terminal the chips render as single-cell glyphs instead of emoji (`◉ Cache hit 98.8% · ◧ Ctx 47% of 1M`). The IDE's default font has no emoji glyphs, so leaving them in leaves debris from the previous frame behind — `Cache expires 4:545` and the like. [Label modes](https://github.com/rootstudioyaml/sprag/blob/main/docs/STATUSLINE.md#label-modes) covers the detail, plus `sprag mode narrow` and `mode icon-force`.

## Real-world impact — before/after report

![sprag — harness + ratchet adoption impact](https://raw.githubusercontent.com/rootstudioyaml/sprag/main/docs/harness-impact.png)

Harness 5/5 + ratchet applied to the author's own Claude Code work, normalized **per user message** (cutoff 2026-05-02, Opus 4.7 pricing):

| metric | before (7d / 739 msgs) | after (2d / 157 msgs) | Δ |
|---|---:|---:|---:|
| cost / user message | $2.345 | $1.910 | **−18.6%** |
| output tokens / message | 7,391 | 6,052 | −18.1% |
| assistant turns / message | 9.73 | 8.83 | −9.2% |
| tool calls / message | 5.72 | 5.25 | −8.2% |

The same request resolves in fewer round-trips, so first-try success goes up: the effect of PEV and Structured Task forcing one-shot delivery. The post window is only 2 days (157 msgs), so statistical confidence is low and week-to-week topic mix differs.

## Commands you will actually use

| Command | What it does |
|---|---|
| `sprag` | Last-1-day diagnostic report |
| `sprag handoff` | Back work up to markdown before a cap blocks you |
| `sprag route-scan` | Find delegation candidates in your own history (0 LLM calls) |
| `sprag route-scan savings` | The routing-savings ledger |
| `sprag harness check` | Current 🅷 harness score |
| `sprag doc2md <file>` | Convert one document to Markdown |

Every subcommand, flag and the output-language setting: [command reference](https://github.com/rootstudioyaml/sprag/blob/main/docs/COMMANDS.md).

## Deeper reading

| Doc | Covers |
|---|---|
| [Install](https://github.com/rootstudioyaml/sprag/blob/main/docs/INSTALL.md) | What the install turns on, what stays manual, how to turn each part off |
| [Statusline](https://github.com/rootstudioyaml/sprag/blob/main/docs/STATUSLINE.md) | Segments, warning chips, spike issue codes, update notifications |
| [Commands](https://github.com/rootstudioyaml/sprag/blob/main/docs/COMMANDS.md) | Full CLI surface |
| [Harness](https://github.com/rootstudioyaml/sprag/blob/main/docs/HARNESS.md) | The five principles, rule promotion, compact-window pinning, seed presets |
| [route-scan](https://github.com/rootstudioyaml/sprag/blob/main/docs/ROUTE_SCAN.md) | Tier verdicts, rule-file mechanics, scan triggers, subagent setup |
| [Tier criteria](https://github.com/rootstudioyaml/sprag/blob/main/docs/TIER_CRITERIA.md) | Why T0/T1/T2 split where they do, with sources (Korean) |
| [Benchmark](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md) | The 11,696-instance LLMRouterBench run |
| [doc2md](https://github.com/rootstudioyaml/sprag/blob/main/docs/DOC2MD.md) | Supported formats, savings evidence, editing documents, DRM cases |
| [Korean style](https://github.com/rootstudioyaml/sprag/blob/main/docs/KOREAN-STYLE.md) | What gets injected, the write-time check, before/after |
| [Not a router](https://github.com/rootstudioyaml/sprag/blob/main/docs/NOT-A-ROUTER.md) | Why realtime routing breaks the cache and costs more |
| [Gateways & environment](https://github.com/rootstudioyaml/sprag/blob/main/docs/GATEWAYS.md) | Bedrock, Vertex, LiteLLM budgets, pricing table, FAQ, how it works |

Behind a LiteLLM gateway, `sprag profile-map --refresh` now reads model aliases straight from the gateway's own `GET /model/info`, so route-scan no longer needs to wait on learned votes or a hand-edited `profile-map.json`. The refresh rides the same 5-minute check and 24-hour cache as the LiteLLM budget gauge. It never stores your auth token: each refresh reads it from `apiKeyHelper` at call time and lets it expire on the helper's own schedule. Details: [route-scan](https://github.com/rootstudioyaml/sprag/blob/main/docs/ROUTE_SCAN.md).

## Release notes

The full history moved to [CHANGELOG.md](./CHANGELOG.md) (Korean; version headings and command names are language-neutral). Recent changes:

- **v3.39.0**: `feedback` subcommand — file bug reports and feature requests straight from the terminal or a Claude session, via the gh CLI, an anonymous no-login form (auto-filed as a GitHub issue by an Apps Script relay), or a local fallback. `install` now asks before replacing an existing statusline instead of silently skipping.
- **v3.38.0**: `cohesion on` — the language-neutral cohesion rules from the Korean supplement become a standalone English injection (given-before-new, one referent per pronoun, subject consistency, bridging, merging choppy sentences). Opt-in, ~0.5k tokens per session, suppressed while `korean on` already carries them.
- **v3.37.0**: Korean guidance grows a conservative supplement (translationese, AI-writing tics, a research-backed cohesion section whose principles apply to English prose too) and the write-time lint gains 5 translationese patterns, validated at 1 false positive across 255 real files.
- **v3.35.0**: A `💵 Sep $42` segment now shows estimated spend since 00:00 on the 1st of the current month, always on — including gateway setups with no 5h/7d caps. LiteLLM gateway users get a `🔑 budget ▰▱ 34% $34/$100` gauge built from the key's budget (`GET /key/info` + `GET /user/info`, team-membership budget first, then key, then internal user — verified against a Dockerized LiteLLM).
- **v3.34.0**: seed presets offered one at a time, output-language choice at install, context warning raised to 500k.

## Feedback

Found a bug, or want a feature? Open an issue: https://github.com/rootstudioyaml/sprag/issues

No browser or GitHub login handy (corporate network, mid-session)? Submit straight from the terminal — or ask Claude to do it for you:

```bash
sprag feedback "the 5m TTL chip never clears on Bedrock"
```

It files a GitHub issue via the `gh` CLI when one is authenticated; otherwise it submits anonymously (no login, works where github.com is blocked). Pass `--anonymous` to skip the `gh` path. Version and OS metadata are attached automatically.

When reporting a bug, please include the tool version (`sprag --version`), your OS, and — if it is a statusline or warning issue — the statusline output or the `sprag last` result.

## License

MIT

---

## Who makes this

[![DeepPulse YouTube](https://img.shields.io/badge/YouTube-@DeepPulseKR-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseKR)
[![DeepPulseEN YouTube](https://img.shields.io/badge/YouTube-@DeepPulseEN-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseEN)
[![Homepage](https://img.shields.io/badge/Homepage-rootstudioyaml.github.io-2ea44f)](https://rootstudioyaml.github.io/)

Built and used at **DeepPulse**, a channel about AI developer tooling. The [launch Short (60s)](https://www.youtube.com/shorts/RaD8qMsPTnA) covers where this came from and how it is used.
