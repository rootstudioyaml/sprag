<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/site/assets/logo/sprag-lockup.svg">
  <img alt="Sprag" src="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/site/assets/logo/sprag-lockup-light.svg" width="220">
</picture>

**A quality ratchet for your coding agent. Forward motion passes, backspin locks.**

[![npm](https://img.shields.io/npm/v/sprag-cli.svg?label=sprag-cli)](https://www.npmjs.com/package/sprag-cli)
[![downloads](https://img.shields.io/npm/dm/sprag-cli.svg)](https://www.npmjs.com/package/sprag-cli)
[![license](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](./LICENSE)

[English](https://github.com/rootstudioyaml/sprag/blob/main/README.md) · [한국어](https://github.com/rootstudioyaml/sprag/blob/main/README.ko.md)

[sprag.io](https://sprag.io) · [Benchmark](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md)

</div>

---

Sprag is named after the sprag clutch: forward motion passes, backspin locks.
Your agent keeps working, it just stops regressing.

It reads the sessions you already ran, and what it finds there holds for every
session after. Repeated failures become rules loaded at session start. Work that
a cheaper tier has never got wrong goes to a sub-agent on that tier, and every
delegated run writes its own price difference to a ledger. Cache and rate-limit
trouble reaches your statusline while you can still act on it.

Nothing leaves your machine, because it reads only the logs Claude Code already
writes there. No API key, no extra model calls, no runtime dependencies.

```bash
npm i -g sprag-cli   # the old claude-token-saver package still gets the same releases
```

![statusline example: routing savings on row 1, document conversion savings on row 2, diagnostics on row 3](https://raw.githubusercontent.com/rootstudioyaml/sprag/main/docs/statusline.png)

## How it works

<picture>
  <source srcset="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/docs/how-it-works.svg" type="image/svg+xml">
  <img src="https://raw.githubusercontent.com/rootstudioyaml/sprag/main/docs/how-it-works.png" alt="What goes in: your past sessions, the task you just asked for, a document you would attach, Korean prose being written, and the tokens this turn is spending. What sprag does with it: writes a ratchet rule loaded every session, converts the document, checks the Korean as you write, prints the cost in your prompt, and routes a matched task to a haiku or sonnet sub-agent whose output the main agent reviews.">
</picture>

Everything on the left is something your session already produces. Nothing is
sent anywhere to read it. The tier decision at the bottom is the whole routing
argument in three tests: where the answer lives, whether a mistake surfaces, and
what error rate the rule was measured at.

Sprag does not swap the model you asked for. It reads what you have already run,
finds the kinds of task that never went wrong on a cheaper tier, and spawns a
sub-agent for exactly those. The main agent reviews what comes back before
anything counts as done, and the work returns to it the moment a rule stops
holding.

## Measured results

| Metric | Result | | Evidence |
|---|---|---|---|
| Public benchmark accuracy | **59.1%** vs 57.9% best single model | `▰▰▰▰▰▰▰▰▰▰▰▰` | [benchmark](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md) |
| Cost for the same queries | **$268** vs gpt-5 $388, gemini-2.5-pro $734 | `▰▰▰▰▰▱▱▱▱▱▱▱` | [benchmark](https://github.com/rootstudioyaml/sprag/blob/main/docs/BENCHMARK.md) |
| Tokens for the same documents | **−95.9%**, 2,011,178 → 82,209 over 12 files | `▰▱▱▱▱▱▱▱▱▱▱▱` | [doc2md](https://github.com/rootstudioyaml/sprag/blob/main/docs/DOC2MD.md) |
| Delegation savings, from the ledger | **$44.67** over 69 delegated runs | `▰▰▰▰▰▰▰▰▰▰▰▱` | `sprag route-scan savings` |
| Cheap tier on the same prompts | **24% of the cost**, one answer worse out of eight | `▰▰▰▱▱▱▱▱▱▱▱▱` | [A/B run](#the-cheap-tier-on-the-same-prompts) |

The first two rows answer the objection that comes up first: that moving work to
a cheaper model has to cost you accuracy. It did not. The same criteria, wired up
as a router, scored 1.2 points above the best single model at a third of the
cost. Nothing is best at everything, which is why choosing per task beats
choosing once.

Measured offline on LLMRouterBench (Findings of ACL 2026): 11,696 instances, 13
models whose answers, scores and costs ship with the dataset. No model was
called and nothing was spent. The router chose; the numbers were looked up. Run
it again and you get the same figures. It validates the criteria, not sprag's own
routing: the dataset has no Claude models, so deepseek-v3, qwen3-235b and gpt-5
stood in for cheap, mid and flagship.

The last three rows are ledgers on this machine. They grow as it runs. These were
read on 2026-09-18.

### Current, on one machine, last 30 days

```
🔀 Routing saved $44.67 total        (last 7d $23.21 · last 30d $42.73)

   opus-5 → sonnet-5     59 runs    $39.75   ▰▰▰▰▰▰▰▰▰▰▱▱
   opus-5 → haiku-4.5    10 runs     $4.92   ▰▱▱▱▱▱▱▱▱▱▱▱
```

| Also measured | Over 30 days | |
|---|---|---|
| Documents converted | 12 files, 2,011,178 → 82,209 tokens | `▰▱▱▱▱▱▱▱▱▱▱▱` |
| Cache hit rate | 92.2% | `▰▰▰▰▰▰▰▰▰▰▰▱` |
| Volume behind both | 175 sessions · 14,682 API calls · 3.81B input tokens | |

Real output, from `sprag route-scan savings`, `sprag --days 30`, and the doc2md
ledger. Nothing here is a projection.

Every delegated run records its own price difference, so `sprag route-scan savings` traces any amount back to the rule that caused it. What the ledger deliberately leaves out is written down in [the command reference](https://github.com/rootstudioyaml/sprag/blob/main/docs/COMMANDS.md).

## Everything ships in one install, working from day one

| | What it does | More |
|---|---|---|
| ⚙️ **Ratchet rules** | Repeated failures become one-line rules loaded every session. Candidates are detected from your logs, and you choose project or global scope. | [harness](https://github.com/rootstudioyaml/sprag/blob/main/docs/HARNESS.md) |
| 🔀 **Model fitting** | Log-driven delegation rules carrying the error rate they were measured at and the savings they reported, written to `ratchet-model.md`. | [route-scan](https://github.com/rootstudioyaml/sprag/blob/main/docs/ROUTE_SCAN.md) |
| 🅷 **Harness score** | Five operating principles checked live. Skip the verify step and `🅷 4/5` says so before you report done. | [harness](https://github.com/rootstudioyaml/sprag/blob/main/docs/HARNESS.md) |
| 📊 **Token telemetry** | Cache hit rate, TTL, context size, output spikes and both rate-limit windows, in the prompt every turn. | [statusline](https://github.com/rootstudioyaml/sprag/blob/main/docs/STATUSLINE.md) |
| 📄 **doc2md** | pptx, xlsx, pdf, docx and fig converted on demand, so a document costs one read instead of your whole context. | [doc2md](https://github.com/rootstudioyaml/sprag/blob/main/docs/DOC2MD.md) |
| 🇰🇷 **Style gates** | Write-time prose lint enforced by hook. Shipping today for Korean technical writing: double passives, translationese, cohesion. | [style](https://github.com/rootstudioyaml/sprag/blob/main/docs/KOREAN-STYLE.md) |

The two savings figures are never added together. They measure different things:
the routing ledger records the price difference on delegated runs, and the
conversion ledger records tokens a document did not cost.

Neither one counts what the harness and the ratchet rules save. That saving
arrives as fewer round-trips rather than as cheaper ones.

## The statusline in one line

```
🔀 Routing saved $44.67  |  opus→sonnet 59× $39.75 · opus→haiku 10× $4.92
🚨 5H ▰▰▰▰▰▰▰▰▰▰▰▱ 94% 🔄 12:36 · 🅷 5/5 · 🤖 Opus 5 · 🧠 Cache hit 98.8% · ⏳ Cache expires 59:46 · 📅 weekly ▰▰▰▰▰▱▱▱▱▱▱▱ 38% · 💵 Sep $42 · 📦 Ctx 47% of 1M
```

When something is wrong the warning chip leads the line: `🚨 5H/7D NN%`, `⚠ Ctx 500k+`, `⚠ Cache miss`, `⚠ Input spike`, `⚠ Output heavy`, `⚠ Call surge`, `⚠ Rebuild churn`, `⚠ 5m TTL`. Paste the chip text into Claude and the Skill names the root-cause code and the fix. Every segment is explained in [the statusline reference](https://github.com/rootstudioyaml/sprag/blob/main/docs/STATUSLINE.md).

Inside a JetBrains IDE terminal the chips render as single-cell glyphs instead of emoji (`◉ Cache hit 98.8% · ◧ Ctx 47% of 1M`). The IDE's default font has no emoji glyphs, so emoji leave characters from the previous frame on screen, like `Cache expires 4:545`. [Label modes](https://github.com/rootstudioyaml/sprag/blob/main/docs/STATUSLINE.md#label-modes) covers the detail, plus `sprag mode narrow` and `mode icon-force`.

## The cheap tier on the same prompts

The benchmark uses public data. This asks the same question of my own work: eight
prompts from real sessions in this repository, sent to both tiers, graded against
an answer written before the run (2026-09-17, raw data in
`video/out/measure2.json`).

| | flagship (opus-5) | cheap tier (haiku-4.5) |
|---|---:|---:|
| Cost for all eight | $2.5652 | **$0.6132** (23.9%) |
| Graded correct | 7 / 8 | 6 / 8 |
| Gave the same answer | | 6 / 8 |

The prompt both tiers missed is the useful one. It asked which files reference
`process.env` without saying whether subdirectories counted, and the two read it
differently. Adding that one condition made their answers identical. The question
was ambiguous, not hard.

The remaining miss is the cheap tier leaving entries out of a file listing. A
wrong listing is one you can see is wrong, which is the second criterion doing
its job.

So the cheap tier is not free. On this sample one lookup in eight comes back
worse, for a quarter of the price. That is why rules only send work whose failure
surfaces, and never send design or diagnosis.

## What the method has produced here

| Measured | Value | Sample | Window |
|---|---|---|---|
| Documents converted | 2,011,178 → 82,209 tokens | 12 files (xlsx, pptx, pdf) | to 2026-09-18 |
| Delegated runs | $44.67 saved, $0.65 per run | 69 runs | to 2026-09-18 |
| Ratchet rules accumulated | 37 (30 global, 7 per-project) | 4 repositories | 2026-05-08 to 09-16 |

The two counts grow differently. Ratchet rules come from mistakes a person made,
so they keep coming. Delegation rules stop: the criteria recognize a fixed set of
work types, and once each has a rule there is nothing left to promote.

## Day-to-day commands

| Command | What it does |
|---|---|
| `sprag` | Last-1-day diagnostic report |
| `sprag handoff` | Back work up to markdown before a cap blocks you |
| `sprag route-scan` | Find delegation candidates in your own history (0 LLM calls) |
| `sprag route-scan savings` | The routing-savings ledger |
| `sprag harness check` | Current 🅷 harness score |
| `sprag doc2md <file>` | Convert one document to Markdown |

Every subcommand, flag and the output-language setting: [command reference](https://github.com/rootstudioyaml/sprag/blob/main/docs/COMMANDS.md).

## Documentation

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

Behind a LiteLLM gateway, `sprag profile-map --refresh` now reads model aliases straight from the gateway's own `GET /model/info`, so route-scan no longer needs to wait on learned votes or a hand-edited `profile-map.json`. The refresh uses the same 5-minute check and 24-hour cache as the LiteLLM budget gauge. It never stores your auth token: each refresh reads it from `apiKeyHelper` at call time and lets it expire on the helper's own schedule. Details: [route-scan](https://github.com/rootstudioyaml/sprag/blob/main/docs/ROUTE_SCAN.md).

## Release notes

The full history moved to [CHANGELOG.md](./CHANGELOG.md) (Korean; version headings and command names are language-neutral). Recent changes:

- **v3.39.0**: `feedback` subcommand for filing bug reports and feature requests straight from the terminal or a Claude session, via the gh CLI, an anonymous no-login form (auto-filed as a GitHub issue by an Apps Script relay), or a local fallback. `install` now asks before replacing an existing statusline instead of silently skipping.
- **v3.38.0**: `cohesion on` turns the language-neutral cohesion rules from the Korean supplement into a standalone English injection (given-before-new, one referent per pronoun, subject consistency, bridging, merging choppy sentences). Opt-in, ~0.5k tokens per session, suppressed while `korean on` already carries them.
- **v3.37.0**: Korean guidance grows a conservative supplement (translationese, AI-writing tics, a research-backed cohesion section whose principles apply to English prose too) and the write-time lint gains 5 translationese patterns, validated at 1 false positive across 255 real files.
- **v3.35.0**: A `💵 Sep $42` segment now shows estimated spend since 00:00 on the 1st of the current month, always on, including gateway setups with no 5h/7d caps. LiteLLM gateway users get a `🔑 budget ▰▱ 34% $34/$100` gauge built from the key's budget (`GET /key/info` + `GET /user/info`, team-membership budget first, then key, then internal user, verified against a Dockerized LiteLLM).
- **v3.34.0**: seed presets offered one at a time, output-language choice at install, context warning raised to 500k.

## Feedback

Bugs and feature requests go in the issue tracker: https://github.com/rootstudioyaml/sprag/issues

With no browser or GitHub login at hand (corporate network, mid-session), submit straight from the terminal instead, or ask Claude to do it for you:

```bash
sprag feedback "the 5m TTL chip never clears on Bedrock"
```

It files a GitHub issue through the `gh` CLI when one is authenticated. Otherwise it submits anonymously, with no login, which works where github.com is blocked. Pass `--anonymous` to skip the `gh` path. Version and OS metadata are attached automatically.

For a bug, please include the tool version (`sprag --version`) and your OS. For a statusline or warning issue, add the statusline output or the `sprag last` result.

## License

Apache License 2.0. The full text is in [LICENSE](./LICENSE), and the attributions
it requires are in [NOTICE](./NOTICE).

Releases up to and including v3.47.0 went out under the MIT License. A copy
received under those terms stays under them; the new license applies to
releases after that.

**Running sprag inside a product or a paid service?** The license already permits
that, so this is not a request for permission. We would like to hear about it
anyway, because the parts that get awkward at scale are the parts we would rather
fix than have you work around: shared ratchet rules across a team, gateway setups
where the model id is an opaque profile, and per-seat budget reporting. [Open an
issue](https://github.com/rootstudioyaml/sprag/issues) or reach us through the
channels below.

---

## Who makes this

[![DeepPulse YouTube](https://img.shields.io/badge/YouTube-@DeepPulseKR-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseKR)
[![DeepPulseEN YouTube](https://img.shields.io/badge/YouTube-@DeepPulseEN-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@DeepPulseEN)
[![Homepage](https://img.shields.io/badge/Homepage-rootstudioyaml.github.io-2ea44f)](https://rootstudioyaml.github.io/)

Built at **DeepPulse**, a channel about AI developer tooling, and used there every day. The [launch Short (60s)](https://www.youtube.com/shorts/RaD8qMsPTnA) covers where it came from and how it gets used.
