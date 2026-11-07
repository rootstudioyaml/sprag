# Command reference

[← README](../README.md) · [한국어](./COMMANDS.ko.md)

## Commands

For Codex, pass `--agent codex`. Run `sprag --help --agent codex` for its command
reference, `sprag doctor --agent codex` for diagnostics, or
`sprag capabilities --agent codex` for the support matrix. Codex provides
`--statusline`, `panel`, `brief`, `last`, `history`, `handoff`, harness management,
writing guidance, document conversion/write guards, and opt-in native model routing.
See [Codex integration](./CODEX.md) for platform differences and limitations.
Codex model targets and scoped rules use `delegate model` and `delegate rules`;
Claude tier presets and savings accounting are not imported.

| Codex command | What it does |
|---|---|
| `sprag install --agent codex` | Register native hooks and the global AGENTS.md harness |
| `sprag panel run --agent codex --` | Run Codex above its session-bound tmux panel |
| `sprag route-scan --refresh --agent codex` | Discover recurring simple turns by project, provider, and model |
| `sprag delegate rules add R1 --project --agent codex` | Approve a candidate for its observed project; add `--model ID` if needed |
| `sprag route-scan savings --refresh --agent codex` | Join routed child usage to available provider prices |
| `sprag seed --agent codex` | List compatible ratchet presets |
| `sprag seed accept all --project --agent codex` | Register pending presets after the user chooses scope |
| `sprag harness promote 1 --session ID --project --agent codex` | Append a recent repeated-failure candidate for refinement |

The remaining reference describes the default Claude Code commands.

Run these in your shell (inside Claude Code, the `/claude-token-saver` Skill is the only entry point):

| Command | What it does |
|---|---|
| `sprag` | Last-30-day diagnostic report (`--days N` / `--hours N`) |
| `sprag last` | Most recent warning + remediation |
| `sprag history` | Last 7 days of warning transitions |
| `sprag handoff` | Back work up to `HANDOFF-*.md` before a cap blocks you |
| `sprag mode [keywords...]` | Output config (`icon`/`text`, `en`/`ko`, `1h`–`30d` window, …) |
| `sprag harness ...` | 🅷 Harness management (below) |
| `sprag route-scan` | Detect recurring easy work on expensive models → propose haiku-delegation ratchet rules (below) |
| `sprag route-scan savings` | The routing-savings ledger — per-model-change rollup + per-run log (the evidence behind the figure) |
| `sprag delegate agents [on\|off]` | Install, show, or remove the five delegation-only subagents (`t2-explore`, `t2-runner`, `t2-translate`, `t1-worker`, `t1h-worker`) in `~/.claude/agents`. Their `tools` allowlist excludes MCP tools, which roughly halves the first request of a subagent behind a gateway. Each file also pins `effort` by how the work is verified: `low` for the three haiku agents, whose results are checked by command output or file comparison, and `medium` for `t1-worker`, which implements a fixed design against tests. Only files sprag wrote are ever replaced or removed |
| `sprag team create [--email <e>] [--name <n>] [--code <6 digits>] [--no-join]` | Create a team from the CLI: signs you in with an emailed 6-digit code, prints the invite token and member/org commands, and joins this machine as the first member (`--no-join` skips that). Without a terminal it runs in two steps ([Team layer](./TEAM.md)) |
| `sprag team join [token] [--name <n>] [--yes]` | Opt in to the team layer: shows what will be uploaded (daily aggregates and a per-category delegation rule summary, no rule text or paths), then enrolls. Without a token it reads `SPRAG_TEAM_TOKEN` ([Team layer](./TEAM.md)) |
| `sprag team name [<n>]` | Show or change your display name after joining; the dashboard shows the new name at once |
| `sprag team leave` | Leave the team, stop uploading, and remove the member key, the rules cache and the ratchet import |
| `sprag team status [--show-payload]` | Team, plan, prompt-capture flag, display name, your standing in the office (what the overall score is made of, whether moving up takes more tokens or a larger delegated share, and the next species) and last sync; `--show-payload` prints the exact rows that would be uploaded, including the delegation rule summary |
| `sprag team sync [--force] [--rules-only]` | Upload the daily aggregates and pull approved organization and team rules now (`--force` ignores the 5-minute interval, `--rules-only` pulls rules and uploads nothing) |
| `sprag team rules` | Show the cached organization and team rules |
| `sprag team propose "<text>" [--scope ratchet\|model]` | Propose a rule to the team owner |
| `sprag cowork [sync\|on\|off\|exclude <dir>\|include <dir>]` | Finds the folders connected to the Claude app's Cowork tab and keeps a copy of the three ratchet files in each folder's `.claude/rules/sprag-cowork-ratchet.md`, because Cowork does not follow the `~/.claude` imports. The copy is refreshed at every session start, and the Code tab skips it through the `claudeMdExcludes` setting |
| `sprag saved [reset\|undo]` | Show the saved-money counters, or reset them to zero like a stopwatch (`routing`, `doc2md`, or `all`). Ledger data is kept; `undo` restores the previous counters. `--agent codex` targets the Codex counters |
| `sprag compact-window` | Warn when a 1M-context session has no auto-compact cap → pin 500k with `set` (below) |
| `sprag korean on\|off\|status` | Inject Korean writing guidance at session start and install the write-time check (below) |
| `sprag cohesion on\|off\|status\|show` | Inject English cohesion guidance (sentence-connection rules) at session start |
| `sprag korean lint block\|warn\|off` | How the write-time check handles findings |
| `sprag korean lint scope all\|prose` | Check every text file, or documents only |
| `sprag korean reply on\|off` | Toggle the Stop hook that sends back an English reply to a Korean prompt (default on; `korean off` removes it) |
| `sprag doc2md on\|off` | Convert attached documents to Markdown before the model reads them (below) |
| `sprag doc2md <file>` | Convert one file by hand. Diagnostic: it prints the refusal reason instead of swallowing it |
| `sprag delegate on\|off\|status` | On by default: append bounds, Korean guidance when it applies, and already-read paths to every Task/Agent delegation prompt, and run effort-less Sonnet delegations at high (below) |
| `sprag proof [--json]` | List the replayed delegation cases behind the tier rules: counts, the recommended setup per case, the verdict, and the cost against the Opus baseline. `--json` prints the raw summary. Full runs are at https://sprag.io/proof/ |
| `sprag mode ttl=5m\|1h\|auto` | Pin the cache TTL bucket. The default `auto` trusts the measured split, then falls back to gateway detection |
| `sprag --version` | Print the installed version |
| `sprag update-check` | Is a newer version out? (`--refresh` to ask now, `--dismiss` to mute this version's offer) |
| `sprag upgrade` | Install the latest release with the package manager that installed this copy (`--print` shows the command only) |
| `sprag install` | Register everything without asking: Skill, statusline, hooks, harness, presets, and Codex when present |
| `sprag install --manual` | Same, confirming each optional step |
| `sprag uninstall [--purge]` | Remove the hooks, statusline and skill it registered. Recorded savings are kept unless `--purge` is given |

The output language is decided once, at install time: a terminal install proposes the system locale and asks whether to use Korean, while an unattended install records what the locale says. Once recorded it is never asked again, not even on an upgrade. Change it later with `mode ko` / `mode en`, or pin it for a scripted install with `SPRAG_LANG=ko` / `SPRAG_LANG=en`. Statusline chips stay symbolic either way.

## `sprag delegate` — rewrite Task/Agent prompts before they spawn

On by default since v3.104.0. `sprag install` registers a PreToolUse hook on `Task`/`Agent` and says what it appends the first time; `sprag delegate off` turns it off and that choice survives upgrades (`SPRAG_NO_DELEGATE=1` skips it during a scripted install). The hook appends up to four sections to the delegation prompt, each conditional on its own:

| Section | Condition |
|---|---|
| Bounds and output shape | Always, whenever `presets/delegation/bounds.md` is present (it ships with the package) |
| Korean style guidance | The prompt contains Hangul, names a `.ko.*` target, or says `in Korean`, **and** `korean` is on — off skips this section even for a Korean prompt |
| Ratchet rules | `~/.claude/ratchet.md` exists **and** `~/.claude/CLAUDE.md` does not already `@`-import it |
| Already-touched paths | The calling session's transcript tail has at least one `Read`/`Edit`/`MultiEdit`/`Write`/`NotebookEdit`/`Grep`/`Glob` path inside the current working directory. Files only: a `Grep`/`Glob` argument that turns out to be a directory is dropped, since a directory offered as something to read costs the subagent one capped tool call. Paths are dropped when they hold anything that could break the rendered line (control characters, Unicode line separators, a backtick), since the list is one path per line inside a prompt. At most 15, most recent first |

The bounds section's tool-call cap depends on the target: 8 tool calls / 1,500 output tokens when `model` (or, absent that, `subagent_type`) matches `haiku`, otherwise 20 tool calls / 8,000 output tokens. When the prompt of the current turn matched a delegation rule, that rule's own calibrated cap for the tier replaces the default, so the subagent is given the same limit the routing hint stated to the main model.

Two limits worth knowing before relying on this:

- The caps are a prompt-level request, not an enforced ceiling — a subagent that ignores them is not stopped from running longer or writing more.
- A delegation that gives only `subagent_type` is matched to its model through the agent file (`t2-explore` reads as haiku, `t1h-worker` as opus). An agent name sprag does not know falls back to the 20/8,000 cap.

It also sets an effort. A delegation to a `sonnet` model that passes no `effort` and names no preset agent runs at `high` instead of Claude Code's default `medium`, and a marker line in the prompt lets route-scan count those raises (statusline `🔬↑N`, `sprag saved`). In the 2026-11-07 replay a multi-file lookup at medium was relayable in 0 of 3 runs and at high in 2 of 3, for about 25% more cost ([sprag.io/proof](https://sprag.io/proof/)). Preset agents keep the effort their files pin, and a call that passes an effort keeps it.

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

---
