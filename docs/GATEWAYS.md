# Gateways, pricing, FAQ and environment

[← README](../README.md) · [한국어](./GATEWAYS.ko.md)

## 🌐 Behind a gateway (Bedrock / Vertex)

A gateway reports the cache-creation total but never the 5m/1h split. That left the tool unable to tell "nothing cached yet" from "this provider does not say", and the fallback assumed an hour — for a window that is really five minutes on Bedrock, overstating it twelvefold.

Since v3.26.0 the gateway is detected from the model ids in the transcript, which fixes:

- The countdown falls back to 5 minutes, labelled `5m?`. Three grades of certainty get three labels: measured (`5m`), inferred (`5m?`), unknown (`?`).
- In a 5-minute bucket the countdown colour follows absolute time rather than a percentage. 30% of five minutes is 90 seconds, and green there promised comfort that was not there.
- The `⚠ 5m TTL` warning finally reaches these users — with different advice, since no subscription plan changes a gateway's TTL.
- `Extra cost if 5m-only` is only asked of sessions that have 1h writes to lose. Elsewhere the arithmetically honest `+$0` read as an endorsement of the bucket you are already stuck in.
- Delegated runs dropped for an unpriceable model id show as `🔀 N unresolved` instead of nothing, which used to be indistinguishable from never having delegated.
- Environment variables set to a `foundation-model` ARN now resolve. An opaque `application-inference-profile` id still does not: guessing at it is how wrong prices enter the ledger.

If the detection is wrong, pin it with `sprag mode ttl=5m` (or `ttl=1h`). An explicit value outranks the measurement.

### LiteLLM: your key budget stands in for the missing 5h/7d caps (v3.35.0)

Behind a LiteLLM proxy (Bedrock and friends), Claude Code's stdin never carries `rate_limits`, so the `✦ current` / `📅 weekly` gauges simply do not exist. LiteLLM does track per-key budgets, so the statusline draws a budget gauge in their place.

- Detection: `ANTHROPIC_BASE_URL` points somewhere other than the official endpoint. The key comes from `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`, or — when neither is set — from running the `apiKeyHelper` script in `settings.json`. The helper only runs inside the 5-minute refresh child, never on the render path (v3.43.0).
- A 404 from `/key/info` no longer aborts the refresh: custom-auth deployments (Okta JWT and friends) always 404 there, and the budget lives in `/user/info`. Only a failure of both endpoints counts as a failure (v3.43.0).
- When the gauge falls back to the internal-user budget it is labeled `budget (user)`. LiteLLM enforces the team-membership limit, which can differ from the user limit by orders of magnitude (v3.43.0).
- The proxy is asked via `GET /key/info` and `GET /user/info` — only the calling key's own data. Renders read a cache file; a detached background process refreshes it every 5 minutes (same shape as the update check), so the statusline never waits on the network.
- Budget source priority follows real-world usage: the **team-membership budget** (`team_memberships[].spend` + its linked budget table row) first, then the key's own `max_budget`, then the internal-user budget. Verified against a Dockerized LiteLLM, including memberships whose budget diverges from the team max into a separate budget-table row.
- Unlimited keys (no `max_budget`) get no gauge. The `💵` monthly-spend segment still shows, since it comes from session logs.
- Inspect with `sprag litellm-budget` (gauge with used/remaining amounts), `--json` (raw cache), or `--refresh` (query now).

One related non-bug: if your session model is already sonnet, a sonnet-delegation (T1) rule can never save anything, because there is no price gap to capture. That is correct, but `route-scan rules` displayed it identically to "no delegations yet", so it now says outright that the rule does not apply at the current default model.

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

## FAQ

**Is this the same tool as claude-token-saver?** Yes. Sprag is the new name; the npm package is `sprag-cli`, and the `claude-token-saver` package keeps receiving the same releases so nothing breaks.

**Does it call an LLM or need an API key?** No. Everything is post-hoc analysis of the session logs Claude Code already writes on your machine. No extra model calls, no key, no telemetry leaves your computer.

**Will it change how I prompt?** No. It installs hooks and a statusline once, then works from what you already do. Rules, delegation, and warnings show up inside your normal sessions.

**Where do the savings numbers come from?** Each delegated run writes a ledger entry with the actual price difference. The tier criteria behind the routing are benchmarked on public data; the method is in [docs/BENCHMARK.md](./BENCHMARK.md).

## How it works · Environment

Claude Code logs every API call to `~/.claude/projects/<dir>/<session>.jsonl`. This tool dedupes streaming chunks by `requestId` and aggregates `cache_read_input_tokens` / `cache_creation.ephemeral_5m/1h_input_tokens` by day and session.

Node.js ≥ 18 · macOS / Linux / Windows / WSL · **zero dependencies**.

<details>
<summary>Known quirks · Migration · Background</summary>

**IntelliJ Claude Code plugin** — the statusline widget fuses frames at the character level when emoji are present (`59:548` artifacts). v2.8.5+ detects `TERMINAL_EMULATOR=JetBrains-JediTerm` and falls back to text mode automatically.

**If the countdown looks frozen:** ticking while idle requires Claude Code to re-run the statusline command on a timer, controlled by `statusLine.refreshInterval` (seconds, Claude Code v2.1.97+) in `~/.claude/settings.json`. Without it the line only redraws when the conversation updates. If behavior differs per terminal, check three things: ① that machine's Claude Code is ≥ 2.1.97; ② no project `.claude/settings.json` / `settings.local.json` overrides `statusLine` without a refreshInterval; ③ the statusline wrapper actually finds `sprag` on PATH instead of falling back to a multi-second `npx` run on every render (typical when nvm is not loaded in non-login shells). Re-running `sprag install` restores refreshInterval=5.

**Migration from claude-cache-monitor:**
```bash
npm uninstall -g claude-cache-monitor && npm i -g sprag-cli
```
Also update `statusLine.command` in `~/.claude/settings.json` to `sprag …`.

**Background:** [GitHub Issue #46829](https://github.com/anthropics/claude-code/issues/46829) (cache TTL regression) · [HN discussion](https://news.ycombinator.com/item?id=47736476)
</details>

---
