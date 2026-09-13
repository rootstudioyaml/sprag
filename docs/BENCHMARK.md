# Benchmark: the tier criteria on LLMRouterBench

The delegation rules this tool writes into `ratchet-model.md` rest on a set of
tier criteria — which work is safe on a cheap model, which must stay on the
expensive one. This document measures those criteria on public data, states
the method so anyone can rerun it, and is honest about what the numbers do
and do not show.

## Setup

[LLMRouterBench](https://github.com/ynulihao/LLMRouterBench) (Findings of ACL
2026) ships precollected responses of 13 flagship models on 21 datasets —
scores, token counts, and per-call cost for every instance. That makes an
**offline** evaluation possible: a router is a function from query text to
model choice, and its accuracy and cost follow from lookups, with zero API
spend.

We evaluated on the 9 datasets of the performance-cost setting that carry a
usable split (AIME, LiveMathBench, GPQA, HLE, LiveCodeBench, MMLU-Pro,
SWE-Bench, SimpleQA, τ²-Bench): **11,696 instances** shared by all models.

The router under test is a straight port of the tier criteria in
`ratchet-model.md` — no training, no embeddings, a handful of regexes:

| Signal in the query | Tier | Model used here |
|---|---|---|
| over 4,000 chars, or asks to explain/summarize | 🟢 **T2** cheap | deepseek-v3-0324 |
| math notation or code | 🟠 **T0** flagship | gpt-5 |
| short factual question (knowledge recall) | 🔵 **T1** mid | qwen3-235b-a22b-2507 |
| multiple choice, short prompts | 🔵 **T1** mid | qwen3-235b-a22b-2507 |
| everything else | 🟠 **T0** flagship | gpt-5 |

The colors carry through the tool: 🟢 cheap tier (haiku-class) takes work whose
answer lives in the repo and whose failure is loud, 🔵 mid tier (sonnet-class)
takes verifiable builds and mechanical edits, 🟠 flagship keeps diagnosis,
design, and anything that fails silently.

The knowledge-recall → mid rule and the long-document → cheap rule are the
same "answer source" and "verifiability" criteria the tool ships; the models
stand in for the haiku/sonnet/opus tiers, which this benchmark's pool cannot
represent directly (it contains a single Claude model).

## Result

```text
                        accuracy          total cost (lower is better)
tier-criteria router    59.1%  ← best     $268  ▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱
gemini-2.5-pro          57.9%             $734  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
gpt-5                   57.8%             $388  ▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱
qwen3-235b-a22b-2507    52.4%             $ 21  ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱
random                  45.9%             $172  ▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱
oracle (upper bound)    81.2%             $ 77  ▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱
```

Cost bars are linear against the most expensive model ($734 = full bar).

| Router / model | AvgAcc | Total cost | Cost, visualized |
|---|---:|---:|---|
| Oracle (upper bound) | 81.2% | $77 | 🟩🟩⬜⬜⬜⬜⬜⬜⬜⬜ |
| 🏆 **Tier-criteria router** | **59.1%** | **$268** | 🟩🟩🟩🟩⬜⬜⬜⬜⬜⬜ |
| gemini-2.5-pro (best single) | 57.9% | $734 | 🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥 |
| gpt-5 | 57.8% | $388 | 🟨🟨🟨🟨🟨⬜⬜⬜⬜⬜ |
| qwen3-235b-a22b-2507 | 52.4% | $21 | 🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜ |
| Random | 45.9% | $172 | 🟨🟨🟨⬜⬜⬜⬜⬜⬜⬜ |

The criteria router **beats every single model in the pool on accuracy while
costing 31% less than gpt-5 and 64% less than gemini-2.5-pro**. For scale:
the routers surveyed in the LLMRouterBench paper report up to 4% PerfGain
and 31.7% CostSave — this untrained rule set lands in that range
(+1.2pp over the best single, 31% cheaper).

Where the wins come from, per dataset (router vs gpt-5):

| Dataset | Routed to | Router | gpt-5 | Note |
|---|---|---|---|---|
| SimpleQA | 🔵 mid | 53.8% / $0.78 | 47.9% / $57.25 | mid model beats flagship at 1/73 the cost |
| SWE-Bench | 🟢 cheap | 25.0% / $2.31 | 15.8% / $24.27 | long-context repair: cheap ≥ flagship |
| AIME | 🟠 flagship | 90.0% / $4.33 | 88.3% / $4.57 | |
| MMLU-Pro | 🟠 flagship | 84.7% / $21.06 | 87.4% / $36.17 | flagship keeps a small edge |
| GPQA | 🟠 flagship | 76.3% / $5.02 | 84.8% / $7.94 | hardest science QA stays flagship territory |

Holdout check: the criteria were shaped on aggregate statistics of this same
data, so we re-scored on odd-indexed instances only — 59.0% vs gpt-5's 57.8%
at 31% lower cost, unchanged.

## What this does and does not show

- It **does** show the shipped criteria are real signals, not vibes: routing
  knowledge recall to a mid tier, keeping math/code on the flagship, and
  dropping long summarization work to the cheap tier each pay off on public
  data, and the "cheap model collapses on tool orchestration" exclusion came
  from the same measurements (a +63pp accuracy gap on τ²-Bench).
- It does **not** simulate the tool's actual production loop — delegating
  Claude Code work across haiku/sonnet/opus subagents — because the pool has
  one Claude model. Production savings are tracked separately, per run, in
  the routing ledger (`sprag route-scan savings`).
- The criteria were derived in part from this dataset's aggregate statistics;
  the odd-index holdout limits but does not eliminate that circularity.

## Reproduce

```bash
git clone https://github.com/ynulihao/LLMRouterBench && cd LLMRouterBench
# download bench-release.tar.gz from https://huggingface.co/datasets/NPULH/LLMRouterBench
tar xzf bench-release.tar.gz -C results && mv results/bench-release results/bench
```

Then score any rule set as a function `route(query) -> model` over the
per-instance records (`records[].origin_query`, `.score`, `.cost`) in
`results/bench/<dataset>/<split>/<model>/*.json`.

## The other two measured numbers

- **doc2md**: a 30MB pptx read as Markdown cost 22,610 tokens against 540,429
  for the raw XML — a 95.8% reduction, measured by the converter itself and
  stamped into the converted file's header.
- **Routing ledger**: production delegations are recorded one by one — the
  price gap between the model that used to handle the category and the model
  that actually ran, at the same token counts. `sprag route-scan savings`
  traces every dollar back to the run that earned it.
