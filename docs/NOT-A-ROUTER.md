# Not a router

[← README](../README.md) · [한국어](./NOT-A-ROUTER.ko.md)

## Not a router — 60 seconds

Sprag installs once, reads the sessions you already run, and does not ask you to change how you prompt. It never intercepts a request or swaps your model in realtime.

1. **A repeat becomes a rule.** The first failure is just work. On the second, Sprag surfaces it as a candidate; you approve the scope, and the rule loads at the start of every session after that.
2. **Safe work goes to a sub-agent.** When a task matches one your history shows is safe, Sprag spawns a sub-agent on a cheaper tier to do it and hands the result back for review. Anything that fails quietly stays with the main agent.
3. **Cost trouble shows up early.** Cache hit rate, TTL expiry, context growth and both rate-limit windows are read every turn and printed in your statusline, while you can still act on them.

### Why realtime model routing can cost more, not less

Never switching models mid-session is the point of this design.

Prompt caches are **kept per model.** Switch to a cheaper model mid-session and it starts from a cold cache, re-reading the whole conversation at full input price. A cache hit costs about a tenth of that, so past roughly 20k tokens of history **one switch can erase everything the cheaper model was going to save.** You moved the work down a tier and the bill went up: the central paradox of realtime routing.

Teams shipping routing products have turned the feature off for exactly this reason: [LLM 라우터를 만든 사람들이 직접 껐습니다 #Shorts](https://www.youtube.com/shorts/SK-GoAABjbg) (Korean).

So this tool never touches the main session's model. It delegates to **subagents only**, which leaves the main session's cache intact and runs the delegated work on a cheap model in its own context. That is why the savings are not cancelled out by cache loss.

```bash
npm i -g sprag-cli@latest
sprag route-scan         # find delegation candidates in your own history (0 LLM calls)
sprag route-scan rules   # list promoted rules · rm <N> to remove
sprag route-scan savings # audit every dollar the routing saved
```

Thresholds come from **your own last-14-day distribution (p25/p75)**, not someone else's benchmark.
Measured rule-health — whether a delegated run actually succeeded — landed in [v3.9.0](../CHANGELOG.md).

---

---
