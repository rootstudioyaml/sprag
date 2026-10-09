# Codex Integration

[← README](../README.md) · [한국어](./CODEX.ko.md)

Sprag supports Codex through its native `AGENTS.md` and `hooks.json` interfaces.
The default agent remains Claude Code. Pass `--agent codex` before or after the
subcommand to select Codex explicitly; this does not change a global default.

## Install

```sh
npm i -g sprag-cli
```

The package install sets up Codex on its own when Codex is present, together
with the Claude Code integration and the bundled presets; nothing is asked
(`sprag install --manual` asks at each step). For a Codex-only installation that
leaves Claude Code settings alone, skip the postinstall and run the Codex
install directly:

```sh
npm i -g sprag-cli --ignore-scripts
sprag install --agent codex
```

Both integrations can coexist. Codex installation uses `$CODEX_HOME` when set,
otherwise `~/.codex`. It adds the integration hooks to `hooks.json` and a marked harness
block to the global `AGENTS.md`. A non-empty `AGENTS.override.md` takes precedence,
so the block is added there instead when present. Existing instructions and
other hooks are preserved; changed files are backed up. `config.toml`, hook
trust settings, and Claude Code settings are never changed by this command.

Open **`/hooks` in Codex**, review the Sprag commands, and trust them. New or
changed hooks do not run until trusted. Use a Codex release that supports the
events documented below. Admin policies or `features.hooks = false` may disable
hooks. The `sprag` executable and Node.js must be on Codex's PATH.

On macOS with zsh, installation also makes sure tmux is present: it installs
tmux with Homebrew when missing (skip this with `CTS_NO_TMUX=1`) and adds the
zsh integration so typing `codex` shows the panel inline in the same terminal.
The separate-window hook is then not registered. When tmux cannot be
installed, the login shell is not zsh, or an existing `codex` alias or
function is already present, installation falls back to the separate window
instead. `sprag panel shell remove --agent codex` is remembered across
reinstalls and upgrades, and `--no-panel` skips both.
An explicit `panel auto off` preference survives reinstall. Installation
reports registration, not successful activation. After approval and restarting
Codex, run `sprag panel doctor --agent codex` to check the last hook execution,
any launch failure, and recent rendered frames. These diagnostics are local;
they do not read or change Codex's trust database.

`CTS_NO_HARNESS=1` skips the global harness. Korean guidance is opt-in, using the
existing shared Sprag preference:

```sh
sprag korean on --agent codex
sprag korean lint warn --agent codex
sprag doc2md install-converter --agent codex
```

`korean on`, `cohesion on`, `brief on`, `doc2md on`, and `delegate on`
register Codex hooks before saving the enabled preference. If hook registration
fails, the preference stays unchanged. Review new or changed definitions in
`/hooks`; registration does not grant trust. Turning a feature off keeps the
shared hooks needed by other features.

## Supported Workflows

| Feature | Codex behavior |
|---|---|
| Harness | Five principles in global or project `AGENTS.md`, with override-file support |
| Ratchet rules | Separate Codex files; global and project rules injected at SessionStart, including resume and compaction |
| Korean guidance / English cohesion | SessionStart injection using shared Sprag preferences |
| Korean write-time lint | PostToolUse feedback for `apply_patch` and recognized shell write targets; block, warn, and off modes |
| Documents | Shared converter, prompt paths, supported file reads, and recognized document/cache write guards; `sprag doc2md <file> --agent codex` also works manually |
| Token report | Table, JSON, or CSV from local Codex rollout logs, with time and project filters |
| Statusline | `--statusline` or `--format statusline` renders the compact panel once, with wrapping and label/color preferences |
| Briefing | UserPromptSubmit reports fresh context/limit threshold crossings once per session and threshold cycle |
| Warning history | `last` and `history` read Codex-only, per-session records of context (80%/95%) and rate-limit (90%) warnings and handoffs; cache and TTL chips are not recorded |
| Handoff | Git state, session/model, recorded context/tokens/limits, and fillable remaining-work sections |
| Subagents | Opt-in native spawn model routing, scoped category rules, and SubagentStart guidance |
| Cache timer | Resolved provider retention policy after recorded cache usage; exact expiry is unknown |
| Route discovery | Repeated simple turns grouped by project, provider, and parent model; no automatic registration |
| Ratchet detection | Recent repeated command/patch failures produce `ratchet?` candidates |
| Seed presets | Compatible ratchet rules, separate decisions, explicit registration scope |
| Routing saved | Sprag-attributed child tokens priced by the path the call took (OpenAI list prices for direct calls, the gateway's `/model/info` prices for a LiteLLM provider); signed, so a pricier child is a loss; an estimate, not billed savings |
| Diagnostics | `doctor` checks user config, hook registration, harness, logs, panel activity, and preferences |
| Capability matrix | `capabilities` lists supported, partial, native, and unsupported areas without invoking a model |

The document converter is shared with Claude Code and requires its optional
converter dependencies. Disable automatic Codex conversion and write guards with
`sprag doc2md off --agent codex` or `CTS_NO_DOC2MD=1`. PreToolUse handles supported
file-read calls and literal single-file `cat`, `head`, and `tail` reads. Successful
conversion blocks the original read with the Markdown path for a retry. Conversion
failures are reported; unsafe archives are denied. Patches and recognized shell
text writes cannot overwrite binary documents or conversion caches. Arbitrary
extraction scripts and compound shell reads are not intercepted; use the manual
command. Text extraction never verifies charts, images, or layout.

Conversion hooks have a 600-second outer timeout to accommodate interpreter
probes and multiple conversions; each converter invocation retains its own
120-second limit. An unavailable Codex cache view is reported as
`cache-unavailable` without suppressing other document results or the context
briefing. Both byte-clipped output and converter-reported truncation are marked
as incomplete in read and prompt feedback.

Codex keeps document accounting separate from Claude. `Doc2md N docs (Codex total)`
counts distinct source paths successfully prepared through Codex, including reuse
of an existing conversion. Reusing or reconverting a source does not increment its
count. The total is scoped to Codex home, not the current session. Old shared
history is not imported. Counts are sorted by frequency, then extension, with no
Claude pricing involved. Codex reads a neutral Markdown view without the shared
cache's Claude-based savings banner; the shared cache remains unchanged.

## Diagnostics And Continuity

```sh
sprag doctor --agent codex
sprag doctor --agent codex --format json
sprag capabilities --agent codex
sprag brief --agent codex
sprag brief on --agent codex
sprag last --agent codex
sprag history --agent codex --days 7 --format json
sprag history --agent codex --session SESSION_ID
sprag handoff --agent codex --cwd /path/to/repo
sprag delegate on --agent codex
```

The doctor is read-only. It reports missing/outdated hook definitions, including
insufficient timeouts or asynchronous handlers, disabled
hooks in user config, and unavailable logs without treating registration as
proof of trust. Its config report excludes provider credentials and is not an
effective-config resolver: active profiles, project config, managed policy,
and invocation overrides can differ. Check Codex `/hooks` for approval.

Briefing is enabled by default after installing and trusting the prompt hook.
It reads at most the latest 256 KiB of the current transcript and warns when
recorded input reaches 80% or 95% of the recorded context window, or a reported
rate-limit window reaches 90%. Missing measurements, measurements older than
five minutes, and expired limits do not generate new warnings. Lower fresh
context measurements re-arm the warning after compaction. `brief off` disables
automatic briefing without disabling document conversion; bare `brief` shows
current warnings without recording or consuming the automatic notification.

History records automatic warning entries, not every tool call or a complete
audit log. Files are separated by Codex home and session beneath Sprag's state
directory; each keeps up to 200 warning entries. `--project` filters history by
substring and `--session` by exact ID. The history remains separate from Claude
warning records. A handoff file is never overwritten and identifies quota
values as recorded snapshots, not live responses. Fill in its remaining-work
sections before using it to continue in another session.

Delegation is independently opt-in via `delegate on`. As of Codex 0.159.2,
`spawn_agent` never reaches `PreToolUse` (measured directly: a recording hook
saw only `Bash` calls while a spawn happened), so the rewrite below cannot see
or steer it. The live path instead runs at prompt time: `UserPromptSubmit`
checks the prompt against your category rules and, on a match, appends a
`[Sprag model routing]` note naming the target model, effort, and a route id.
That note by itself changes nothing, because Codex's own instructions tell it not to
spawn subagents unless something explicitly asked for it. So `harness init`'s
AGENTS.md block adds the missing half: a `[Sprag model routing]` note *is* the
user's delegation request, and the agent should spawn exactly what it describes
with `fork_turns "none"`, then wait for it (`wait_agent` with a timeout of at least
120 seconds) instead of doing the same task itself. Attribution does not depend on the child echoing the
route id back: `SubagentStart` binds the id to whichever spawned child matches
the pending route (same parent thread, same target model, within 30 minutes),
so a route is credited even when the child's own first message never repeats it.
A hint that no child claimed is closed when the parent's next prompt arrives, so
a child spawned later for some other reason is not credited to it. That same
prompt also prices any delegated run the ledger has not joined yet, in a
detached process, so `Routing saved` follows a delegation by one prompt instead
of waiting for the next route scan.

The hint is withheld below `codex.delegateMinContext` (default 60000 input
tokens, read from the parent's own rollout). Measured 2026-09-30: a small
parent session spends more on the coordinating turn (spawning, waiting,
verifying) than a delegated child saves, so under the floor Sprag leaves the
request on the main agent instead of proposing a loss. Change it with
`sprag delegate shared min-context <tokens|default> --agent codex`;
`delegate shared status` shows the current value. It is stored as
`codex.delegateMinContext` in the config file `sprag mode` prints under
"Stored config file".

The `PreToolUse` rewrite (native `spawn_agent` arguments using Codex's
`message`, `model`, and `reasoning_effort` fields, preserving explicit model
choices and custom roles) is kept for Codex versions that do route spawns
through hooks; on 0.159.2 it simply never fires. `SubagentStart` injects scoped
ratchets and enabled writing guidance regardless of which path routed the
child. Bounds are instructions, not an enforced tool-call budget. Normal Codex
sandbox and approval rules still apply. Review new hooks in `/hooks`.

```sh
sprag delegate on --agent codex
sprag delegate model gpt-6-luna --effort high --agent codex
sprag delegate model off --agent codex
sprag delegate rules add explore --from gpt-6-astra --model gpt-6-luna --project --agent codex
sprag delegate rules --agent codex
sprag delegate rules rm 1 --agent codex
```

Use model IDs available from your provider. A default target applies to built-in
spawns without an explicit model. Category rules (`paste`, `translate`, `explore`,
`read`, `check`, `run`) reuse Sprag's classifier and escalation gates, require an
exact parent model, and prefer project rules over global rules. Matching prompts
request native delegation; unavailable subagent tools leave work on the main
agent. Codex-only rules take precedence over shared policies.

### Shared Delegation Policies

Work categories, T1/T2 difficulty, scope, and caps use the same
`model-rules.json` registry in Claude Code and Codex. Existing active Claude
policies are visible immediately; there is no copy or migration. Deleted,
disabled, and review-state policies are not routed by Codex. Project policies
remain project-scoped. A project policy applies when its root is the root either
agent assigns to the working directory (Claude stops at `CLAUDE.md`, Codex at
`AGENTS.md`), compared as real paths. Model IDs, roles, usage, and savings are
not shared.

A Codex-first user needs no Claude installation or transcript history:

```sh
sprag seed --agent codex
sprag seed accept all --global --agent codex  # or --project, after choosing scope
sprag delegate shared status --agent codex
sprag delegate shared map T2 --from PARENT_MODEL --model SMALL_MODEL --effort high --agent codex
sprag delegate shared map T1 --from PARENT_MODEL --model MEDIUM_MODEL --effort medium --agent codex
sprag delegate on --agent codex
```

Replace the model placeholders with available, lower-cost models from your
provider; mappings do not prove availability or savings. Each mapping applies
to one exact parent model, provider, and tier, across every approved category.
`--provider ID` overrides the provider read from Codex config. Without a mapping,
that tier stays on the main agent. No Haiku/Sonnet-to-GPT equivalence is assumed.
Codex seed acceptance writes the common registry without creating `.claude`;
Claude renders its own view when it is installed or starts later.

The prompt hook offers T2 for a simple bounded task and T1 for multi-step work,
and gives each mapped tier its own route line. The caller chooses at most one
model and passes a self-contained task, the cap, `fork_turns "none"`, and only
the chosen tier's route line. `fork_turns "none"` is required: a full-history
fork inherits the parent model and ignores a model override. The hint states
that the user approved the policy and mapping, because Codex sets a spawn model
only on the user's request. The parent waits for and verifies the result.

Each offered tier is recorded as a prompt route, the same path Codex-only rules
use on Codex 0.159.2, where `spawn_agent` bypasses `PreToolUse`. SubagentStart
binds the child to the route whose model it runs, and the parent's next prompt
closes the tier it did not choose, so an offered tier never counts as a run
without a matching child. Where `PreToolUse` does run, a spawn that matches a
shared policy without naming a model is denied with the mapped choices so the
caller picks the tier. The spawn hook does not guess difficulty or override an
explicit model or custom role, and naming the parent's own model keeps the task
on that model.

Shared hints use the same context gate as Codex-only rules, described above;
it does not change any model's context window, and missing context stays below
the gate. `status` checks mappings against the default model in Codex config, because a
mapping routes only sessions on the parent model it names.

```sh
sprag delegate rules --agent codex
sprag delegate shared off --agent codex
sprag delegate shared on --agent codex
sprag delegate shared unmap T2 --from PARENT_MODEL --agent codex
sprag delegate shared min-context 30000 --agent codex
```

`shared off` retains policies and mappings and leaves Codex-only rules intact.
`unmap` removes only that Codex mapping. Edit/remove common policies through
`sprag route-scan rules [rm N]`; removal affects both consumers. Codex routing
records retain the source policy signature and tier, but their token and savings
totals never enter Claude's statistics. A hint is not proof that a child ran:
accounting requires the route marker or a SubagentStart binding to a matching
child rollout that ran the mapped model.

The routing ledger (`Routing Saved` below) prices a child's own tokens at the
parent model's rate as the counterfactual; it does not charge or subtract the
parent's coordination turn, so a delegation that barely clears the context
floor can still show a positive but overstated saving. A child that was
interrupted before it finished replaced no parent work, so its whole cost is
booked as a loss and the entry is marked `aborted`.

## Harness Commands

```sh
sprag harness init --agent codex                 # current project
sprag harness check --agent codex                # project, or global fallback
sprag harness init --agent codex --global
sprag harness promote --agent codex --project "Run the changed module's tests before reporting completion."
sprag harness list --agent codex --project
sprag harness rm 1 --agent codex --project
sprag harness prune --agent codex --global --older-than 6 --dry-run
sprag harness uninit --agent codex --project
```

Rules live in `<project>/.codex/ratchet.md` or `$CODEX_HOME/ratchet.md`.
The harness also instructs Codex to retrieve both files, since Claude's `@file`
import syntax is not used. Promotion always requires an explicit scope.
`rm` and `prune` preserve backups; `uninit` removes only the managed block.

The panel detects repeated command or patch failures in the recent rollout tail
(up to 2 MiB, 30 tool-bearing turns, 30 minutes). Lookup misses and ordinary
`grep`/`diff` exit-1 results are excluded. A `ratchet? #1 x2` chip identifies a
candidate in that session. Inspect it before promoting:

```sh
sprag harness promote 1 --session SESSION_ID --project --agent codex
```

This appends an editable TODO for the cause and prevention, not a diagnosed fix.
Prefer promoting a complete condition/action rule after confirming its cause.
Candidate IDs are session-local and temporary; Claude candidate IDs are not imported.

## Route Discovery And Presets

```sh
sprag route-scan --refresh --days 14 --agent codex
sprag delegate rules add R1 --project --agent codex
sprag route-scan dismiss R1 --agent codex
sprag seed --agent codex
sprag seed accept all --project --agent codex
sprag seed skip all --agent codex
sprag seed reset --agent codex
```

Route candidates need at least three completed simple turns with the same
category, provider, parent model, and project. Aborted, already delegated,
high-error, complex, and mid-turn steering requests are excluded. Archived
copies of one session do not count twice. Modern turn usage takes precedence;
older cumulative `token_count` records are supported without double-counting.

Targets need a lower price at the observed token mix and evidence that the model
is usable: a recorded run, an existing provider-scoped rule, or the configured
default target. Without matching prices, the candidate remains available but
approval requires `--model <id>`. Availability still depends on the active provider.
SessionStart reads cached candidates and schedules an eligible refresh outside
the hook. Small log changes refresh at most daily; a 5 MiB increase can refresh
after an hour. `--refresh` bypasses that schedule.

Codex 0.159.2 keeps about 2,450 tokens of one hook's context and cuts the
middle of anything longer. SessionStart therefore fits its parts whole within a
2,000-token estimate, in priority order: ratchet rules, Korean guidance,
cohesion guidance, the document note, then offers. Rules and guidance that do
not fit are written to a per-project file under the Sprag data directory, and
the context opens with an instruction to read it. `codex exec` runs, recognized
from the rollout's `originator`, get no seed offer or route notice, since no one
can answer them.

`seed` offers common delegation policies without Claude model names, plus
compatible Codex ratchet presets. Ratchet and skip decisions remain agent-specific;
an approved common policy suppresses duplicate offers within its scope in either
agent. Both seed acceptance and
route approval require the user's choice of global or project scope. A project
route is saved for the project where it was observed. Enable delegation with
`sprag delegate on --agent codex` and trust the hooks before expecting rules to run.

## Reports

### One-Shot Statusline

```sh
sprag --statusline --agent codex
sprag --statusline --agent codex --text --no-color --columns 80
sprag --format statusline --agent codex --session SESSION_ID
sprag --statusline --agent codex --single-line
```

This is terminal output, not a shell command installed into Codex's native
footer. It reads local logs, does not fetch gateway budgets, and exits after
one frame. Chips wrap to terminal width (100 columns when piped), with an
explicit `--columns` override. `--single-line` produces one unwrapped line for
external terminal integrations. It shares `mode text|narrow|icon`, timer, and color
preferences with the panel; explicit `--text`, `--narrow`, and `--no-color`
flags are supported, along with `--timer` and `--no-timer`.
Claude's TTL buckets and routing options do not apply.

### Cache Timer And Display Order

Both panel layouts and the one-shot statusline use a Codex-specific order:
warnings, usage limits/budget, context, cache timer, model/effort, session
cache/token totals, Codex lifetime document counts, then harness/preferences and
version. Session measurements stay together before lifetime totals. Claude's
statusline order is unchanged.

The cache clock starts from a new recorded cache read or write, not the latest
tool event, prompt, or repeated quota snapshot. Each session has its own clock;
changing models invalidates the old model's clock until new cache usage arrives.
`Cache 29:59 (Bedrock 30m)` uses the documented minimum retention for a resolved
supported model, not a server expiration timestamp or a promise of a cache hit.
For LiteLLM, Sprag queries the configured `/model/info` endpoint and checks the
actual deployment/base model. All deployments behind an alias must agree.
Only sanitized policy and price fields are persisted; policy freshness is five minutes. Secrets
and raw deployment records are not stored. The live panel refreshes policies;
one-shot statuslines remain offline. Unresolved, earlier, or unknown models show
cache age with `TTL unknown`; no observed cache activity shows `Cache timer n/a`.
The tilde and old unverified-policy labels are removed. After the window passes, the display
says `window elapsed` and `expiry unknown`, never `EXPIRED`.

```sh
sprag cache status --agent codex
sprag cache status --refresh --agent codex
sprag cache 30m --agent codex
sprag cache auto --agent codex
sprag cache off --agent codex
sprag --statusline --agent codex --no-timer
```

A configured duration (1 minute through 24 hours) changes only Sprag's display
estimate, not the request or provider retention. It is stored separately from
Claude's `mode ttl=5m|1h|auto`. The shared `mode no-timer` also hides the Codex
clock; `--timer` overrides that preference, but not `cache off`.

### Routing Saved

```sh
sprag route-scan savings --refresh --agent codex
sprag route-scan savings --format json --agent codex
```

The separate Codex ledger joins a spawn-time route ID, or a validated shared
prompt-hint marker on clients that skip the spawn hook, to the child's own
rollout. An unrelated explicit model choice or cheaper subagent earns no credit.
The estimate holds the child's measured tokens
constant and prices them at the parent and child rates. Negative differences
remain negative; this is not a comparison of actual billed totals.

Prices follow the path each call took, and the two sources never fall back to
each other:

- ChatGPT/OpenAI login or an API key straight to `api.openai.com` uses the
  built-in OpenAI list prices (Standard tier, short-context rates, checked
  2026-10-01). Long-context surcharges are not modeled, so requests past the
  long-context threshold are under-priced.
- A LiteLLM provider uses that gateway's `/model/info` prices, with agreement
  required across deployments behind an alias. Price snapshots last seven days.
  A model the gateway does not price stays unpriced; it is not filled in from
  the list prices.

`sprag delegate rules --agent codex` shows each rule's measured runs, failure
rate and signed saving. A rule is flagged for review when the 95% lower bound
of its failure rate exceeds 20% over at least five runs, as on the Claude side.

Providers are kept separate. Negative values are losses: the child ran on a
pricier model than the parent, and the loss reduces the totals. Missing rates or usage produce unpriced entries, never invented zeroes. A priced
entry keeps its rate snapshot across later outages. Pending route records are
matched for seven days; saved ledger entries remain afterward. Run `--refresh`
after delegation to update the ledger without waiting for the next route scan.

Claude's ledger is never imported. Document conversion shows distinct document
counts rather than a Codex dollar saving or billing measurement.

### Live Companion Panel

Codex 0.157.1 was observed to defer SessionStart until the first submitted prompt,
even after hook trust is granted. Installation now adds this shell integration by
default on macOS zsh; to install or remove it manually:

```sh
sprag panel shell install --agent codex
```

Install tmux first (`brew install tmux` on macOS), then open a new terminal.
This adds a backed-up, marked function to `$ZDOTDIR/.zshrc` (or `~/.zshrc`).
Interactive Codex runs above a compact Sprag panel in the SAME terminal.
An isolated tmux server leaves existing tmux sessions and configuration alone.
Each inline launch has its own session binding. The runner adds `--no-daemon`
so the trusted SessionStart hook receives that launch's environment instead of
a shared app-server's environment. The hook supplies the exact session ID and
transcript path; another active session in the same project cannot take over
the panel. Before the hook runs, the panel shows **Waiting for session binding**,
not another session's usage. On versions that defer SessionStart, submit the
first prompt to bind the panel. Install and trust the Sprag SessionStart hook
to enable binding; disabling hooks leaves the panel waiting.
Resume, clear, and compaction hooks refresh the binding. Each compact frame
identifies its session by the last eight ID characters. Inline remote-server
invocations are rejected because their hook environment and logs are not local;
use standalone Codex and an explicitly pinned panel with accessible local logs.
Codex arguments and exit status are preserved. The inline runner prepends
`-c 'tui.status_line=[]'` so Codex's model/effort/directory row does not duplicate
the Sprag panel. This is an invocation-only override: it does not edit
`config.toml`, change the model or effort, or affect standalone Codex runs.
Codex's startup banner, shortcut hints, approval prompts, and other notices
remain visible. To keep the native row, run
`sprag panel run --agent codex --keep-native-statusline --` followed by Codex
arguments. An explicit later Codex `-c 'tui.status_line=["current-dir"]'` also
overrides Sprag's default. Restart the inline session to apply a runner update.
Exiting Codex closes the panel;
detaching also ends this temporary session. For explicit launch without shell
integration, run `sprag panel run --agent codex --` followed by Codex arguments.
An existing codex alias/function is not overwritten. It does not bypass hook
trust: it starts the local display independently. The panel-start hook skips
opening a separate window inside this layout. Remove the shell function with
`sprag panel shell remove --agent codex` and open a new terminal.
The shell integration currently targets common plain, prompt, and resume
invocations; use the explicit panel command for unusual global-option/subcommand
combinations. Non-TTY invocations and recognized utility commands do not open windows.

On macOS, enable automatic opening when Codex starts or resumes:

```sh
sprag panel auto on --agent codex
sprag panel --open --agent codex
```

The first command registers a separate `panel-start` SessionStart hook. Review
and trust that new hook in Codex `/hooks`, then restart or resume Codex. It opens
a macOS Terminal window pinned to the hook's session ID; only a panel for that
same session and Codex home is reused. Concurrent sessions get separate windows.
Reused windows are unminimized, their panel tab is selected, and Terminal is
brought forward so a background panel does not look like a failed launch.
Clear and compaction events do not open windows. macOS may request Terminal
automation permission. Codex's native footer is unchanged. Disable automatic
opening with `sprag panel auto off --agent codex`; check registration with
`sprag panel auto status --agent codex`. Reinstall preserves this preference.
`--open --session SESSION_ID` opens or reuses a pinned window immediately.
Without `--session`, `--open` creates a project-following window. Other platforms use a manual
terminal or tmux split as below. Hook trust is never bypassed by Sprag.

Run this in a separate terminal window or a tmux split alongside Codex:

```sh
sprag panel --agent codex
sprag panel --agent codex --project /path/to/repo
sprag panel --agent codex --session SESSION_ID --interval 2
sprag panel --agent codex --once --no-color
```

The manually launched panel refreshes every two seconds and follows the latest main session in
the current project (including subdirectories and filesystem path aliases).
Subagent rollouts do not replace the main display. `--session` pins an exact
session ID, including a child when explicitly selected. Pinned and bound sessions
are looked up even when their logs are older than seven days or have been archived.
`--days` controls project-following discovery (default seven days). `--project` is a directory
path in panel mode, not the report's substring filter. Press `r` to refresh and
`q` or Ctrl-C to exit. The terminal's screen and cursor are restored on exit.
Piped output requires `--once` so scripts cannot accidentally start an endless loop.
Use `sprag panel doctor --agent codex --session SESSION_ID` to inspect rendering
for one session; without an ID, diagnostics show the last project-wide activity.

The display shows model/effort, recorded working/idle/interrupted state when
available, latest recorded input context, cache hit rate,
session token totals, recorded rate-limit gauges/reset times, harness score,
ratchet counts, hook registration, and Korean/cohesion/doc2md/brief/delegate
preferences. Preference labels do not claim
that hooks are trusted. Logs older than five minutes are marked stale. Reset
times that have elapsed are marked as awaiting a new usage event, not zero usage.
Unreported limits, session cost, exact cache expiry, and unpriced routing estimates remain unknown.
Non-ASCII dynamic labels are replaced with `?` to maintain terminal cell widths.

The inline compact panel reuses Claude's icon/narrow/text preferences and
segmented gauges. Chips wrap as units instead of losing their trailing values;
the pane grows with the content while keeping at least ten rows for Codex.
If the terminal is too small, a remaining-row count marks hidden content.
Cache reuse is shown in tokens, not an inferred dollar saving. Document counts
and format breakdowns come from Codex's own document records and are labelled
`Codex total`; Claude-based dollar estimates are not attributed to Codex.
Unavailable cost and limit placeholders are hidden in compact mode. Cache timer
availability and unpriced routing accounting remain explicit.

The panel is a separate terminal UI, not an injection into Codex's native footer.
It consumes local rollout logs without invoking a model or modifying Codex config.
For a configured LiteLLM provider, the existing budget reader also queries that
provider's budget and model-info endpoints, using its configured environment key or auth helper.
Both full and compact views show a returned budget, with its source and freshness,
separately from unavailable per-session cost. Document counts cover Codex history
in both views; Claude dollar-saving estimates are excluded.
Unchanged files are cached for the panel's lifetime; changed logs are reparsed.

```sh
sprag --agent codex --days 7
sprag --agent codex --hours 6 --format json
sprag --agent codex --project my-project --format csv
sprag --agent codex --session SESSION_ID --format json
```

Sprag reads `.jsonl` files under `$CODEX_HOME/sessions` and
`$CODEX_HOME/archived_sessions`, not `history.jsonl`. The project filter matches
the session metadata's working directory. Usage is filtered within each session,
not just by file modification time. A session without token-count records does
not appear in the report.

Cumulative token-count deltas prevent repeated usage events from being counted
twice. Cached input is included in total input, and reasoning is included in
output; neither subset is added twice. Usage updates are **not an exact API call
count**. JSON retains the existing summary field `apiCalls` for compatibility,
but its Codex value counts usage updates. Context size comes from recorded
`last_token_usage`, not Claude's 200k/1M heuristic.
The top-level JSON field `usageUpdates` names that count explicitly.

Rollout JSONL is not a stable public Codex interface. Missing or malformed records
are skipped, and incomplete/copied/reset logs can only give best-effort totals.
Reports show **cost and exact cache TTL as unavailable** (`null` in JSON). They do not
apply Anthropic prices, infer subscription charges, or claim Claude's cache TTL.
Document counts are not a measurement of Codex billing or avoided tokens.

## Limits And Removal

Claude's cap/TTL heuristics, Haiku/Sonnet model identifiers, and the Claude
`compact-window` command do not apply to Codex. Codex provides its own
`model_auto_compact_token_limit` setting; Sprag does not apply Claude's 1M
heuristic or change that setting. Codex's native `tui.status_line` accepts
item identifiers, not a Sprag shell command. Unsupported integration commands
fail explicitly rather than modifying Claude settings.

Use `sprag panel --agent codex` for the live display or
`sprag --statusline --agent codex` for one-shot terminal output.
Rate-limit gauges use Codex's recorded values only. Run
`sprag capabilities --agent codex` for the complete support matrix.

```sh
sprag uninstall --agent codex
```

Removal takes out Sprag's Codex hooks and global harness block. It keeps project
harnesses, ratchet rules, backups, other hooks, and shared Sprag state.
`--purge` is intentionally unsupported for Codex. Remove a project block with
`sprag harness uninit --agent codex --project` in that project.

Normal npm upgrades still run the package's Claude postinstall. Codex-only users
should keep using `npm i -g sprag-cli --ignore-scripts` followed by
`sprag install --agent codex` when upgrading.

## Official References

- [Codex hooks, event schemas, and trust](https://developers.openai.com/codex/hooks/)
- [AGENTS.md discovery and overrides](https://developers.openai.com/codex/guides/agents-md/)
- [Codex configuration reference](https://developers.openai.com/codex/config-reference/)
- [Prompt cache lifetime](https://developers.openai.com/api/docs/guides/prompt-caching#cache-lifetime)
- [Codex subagent configuration](https://developers.openai.com/codex/subagents/)
