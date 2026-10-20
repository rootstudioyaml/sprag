# route-scan internals

[← README](../README.md) · [한국어](./ROUTE_SCAN.ko.md)

Tier criteria and research evidence: [TIER_CRITERIA.md](./TIER_CRITERIA.md) (Korean).

## Model-fitting ratchet — a separate file, continuously refreshed

Promoted delegation rules never mix with hand-written ratchet rules: they live in a
**separate, fully tool-owned file** — `.claude/ratchet-model.md` per project,
`~/.claude/ratchet-model.md` for global scope — regenerated wholesale on every scan,
and they stay alive afterward:

- **Auto-refresh**: every rescan recomputes recurrence counts and the category's error
  rate from fresh logs and rewrites the file. Your `ratchet.md` is never touched by
  stat churn, so repos that commit `.claude/` see no diff noise (`ratchet-model.md` is
  safe to gitignore — it's always regenerable from the registry).
- **rule-health**: when the delegated category's error rate exceeds 20%, the rule gets
  a `⚠ rule-health` flag suggesting you narrow or remove it — the "define difficulty
  by outcome" principle applied to rule lifecycle. Once a rule has 5 or more real
  delegation runs, it is judged on **their measured error rate** instead of the
  estimate drawn from request shape, and the warning text says which one it used.
- **Measurement and savings**: the subagent run logs (`<session>/subagents/`) are read
  to show, per rule, how many delegations actually ran and their error rate, over a
  14-day window. It also shows the saving against what the session model would have
  cost for the same work (`~$`, an approximation that holds token counts equal). A
  rule with no delegation record shows `—`, not `$0`.
- **Budget line**: each rule carries a calibrated cap (T2: 8 tool calls and output p25;
  T1: output p75). If the work is expected to exceed it, or an error occurs, the
  subagent stops and the main model takes over. It bounds the cost of a misjudgement
  that comes from a rule firing on request text alone.
- **Relative tier**: no candidate is created when the session model is already at or
  below the delegation target's tier (this fixed "sonnet delegation" rules appearing
  in Sonnet sessions).
- Your rules are managed by `harness list/rm`; model-fitting rules by
  `route-scan rules [rm <N>]` — separate files, separate indexes.
- The CLAUDE.md ratchet section planted by `harness init` references both files, so
  Claude applies them together (existing users: re-run `harness init`).

## How it works — session-boundary calibration, NOT a real-time router

1. `install` registers a SessionStart hook that injects cached scan results as session
   context on startup and `/clear`. Rescans are **data-triggered, not time-triggered**:
   ~5MB of new transcripts rescans immediately, a small trickle rescans daily, no
   change means no rescan. A 1-hour minimum-interval guard applies; promoting a rule
   triggers one immediate refresh to establish its stat baseline.
2. When a recurring (≥3×) pattern exists, the statusline shows a `🅷⚠ route? R1` chip
   and Claude asks whether to register it, and at which scope (`--project`/`--global`).
3. Promoted rules make **the main model delegate that work type to a haiku/sonnet
   subagent automatically from the next session on**.

**A delegation that actually ran skips the gate in step 1 and rescans on the spot.** A
PostToolUse hook on `Task`/`Agent` kicks a detached scan, so the `🔀 Routing saved`
figure is current on the next render. The gate is there to skip scans that would
reproduce the same numbers, and a delegation is the one event guaranteed to change
them — while its own transcript is nowhere near 5MB, so leaving it to the gate meant
waiting an hour at best and a day at worst. Measured: a scan is ~0.5s over 14 days
and 67MB, and delegations run ~1.6×/day, so this costs well under a second a day. A
30-second floor keeps a fan-out of parallel agents to a single scan.

## Recommended companion setup

Create `model: haiku` subagents under `~/.claude/agents/` (e.g. haiku-explore /
haiku-runner / haiku-translate) plus a `model: sonnet` general worker so the rules are
immediately actionable.

A rule names only its category and tier (T2, T1, T1H), never an agent. Each delegation
agent in the presets says which `tier` it serves and for which `categories` (`*` for all),
and Claude delegates to the first agent that matches: haiku-runner for run,
haiku-explore for lookup, reading, checks and pasted logs, sonnet-worker for T1,
opus-worker for T1H. Without that agent's file the rule says `model: <alias>`. Codex
reads the same tier and uses the model mapped to it.


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
sprag route-scan                    # scan (24h cache) + tiered candidates
sprag harness promote R1 --project  # promote candidate R1 to a model-fitting rule
sprag route-scan dismiss 1          # not interested — won't resurface
sprag route-scan rules              # list model-fitting rules (rm <N> to remove)
sprag route-scan savings            # the savings ledger — which rule moved work off which model, onto which
```

`route-scan savings` shows the evidence behind the one `🔀 Routing saved` line on the statusline. It prints totals per model change and a per-run breakdown, so you can trace where the figure came from.

```
🔀 Routing saved, lifetime $2.09  (last 7d $1.40 · 30d $2.09)

By model change:
  claude-fable-5 → claude-sonnet-5  —  1 run, $0.72
  claude-opus-5 → claude-haiku-4-5  —  1 run, $0.57
```

Dig deeper: **tier criteria & research evidence** → [docs/TIER_CRITERIA.md](./TIER_CRITERIA.md) (Korean) · **rule-file mechanics, scan triggers, subagent setup** → earlier on this page

### Behind a gateway (Bedrock / LiteLLM)

Through a corporate gateway the transcript records an inference-profile ARN where the model id belongs. That string says nothing about `opus` or `haiku`, so older versions read every session as Sonnet — which made **T1 (→sonnet) rules unreachable and zeroed the savings figures**.

The mapping now resolves in three steps, cheapest first:

1. **LiteLLM gateway, `/model/info` reachable.** The gateway already knows which profile id or ARN backs which model name, so nothing needs to be learned. `sprag profile-map` prints the cached mapping (gateway address, deployment count, one `<key> → <alias>` line per entry); `sprag profile-map --refresh` pulls a fresh copy from `GET /model/info` and writes only the `gateway` section of `profile-map.json`. The refresh runs in the same child process and on the same cadence as the LiteLLM budget gauge: a 5-minute check, and a 24-hour TTL on the cached map. Keeping it current costs no extra call.
2. **Gateway without that route, or `/model/info` blocked.** This is the mapping v3.10.0 introduced and nothing about it changed: the profile id is mapped back to a role (main, opus, sonnet, haiku) and then to the alias your `ANTHROPIC_DEFAULT_*_MODEL` variables declare, learned by joining each parent `Task` call to the subagent run it spawned via `toolUseId`. Below three observations, or when the role votes agree less than 80% of the time, the id stays `unknown` and drops out of the delegation aggregate rather than being guessed at.
3. **Neither resolves it.** Write the mapping yourself in `<userDataDir>/profile-map.json`. Account id and region may be wildcarded:

```jsonc
{
  "modelAliases": {
    "arn:aws:bedrock:*:*:application-inference-profile/<PROFILE_ID>": "claude-opus-5",
    "prod-large": "claude-opus-5",   // house aliases map the same way
    "team-*": "claude-haiku-4-5"
  }
}
```

**Map house aliases that carry no family name** (`prod-large`, `team-fast`) here too — `sprag profile-map` lists any key it could not resolve from the gateway, so you know which ones still need a manual line. Shapes that keep the family name are recognized as-is — Bedrock (`anthropic.claude-opus-4-5-v1:0`), Vertex (`claude-opus-4-5@20251101`), and the 1M suffix (`claude-sonnet-4-5[1m]`) — but an alias without one cannot be priced. Rather than report a wrong figure, routing-savings **drops those runs from the aggregate** (both sides of the comparison must be recognizable); one line in the table above brings them back.

Sprag never stores your auth token. Step 1's refresh reads it from `apiKeyHelper` at call time and spends it on that one `/model/info` request only; the token's TTL already belongs to the helper, and a cached copy inside sprag would drift out of sync with it. `profile-map.json` holds only profile ids and model aliases — no AWS account id — but it still holds internal identifiers in plain text, so do not commit it. On a direct-API machine none of this ever runs and behaviour is unchanged.
