# Team layer

[← README](../README.md) · [한국어](./TEAM.ko.md)

Sprag is local-only by default. The team layer is an opt-in add-on that lets a group see each member's daily spend and savings in one dashboard, and share the ratchet rules an owner or admin approves. Nothing is sent until you run `sprag team join <token>` or your environment sets `SPRAG_TEAM_TOKEN`. `SPRAG_NO_TEAM_SYNC=1` stops every usage upload, whatever else is configured.

## What is sent and what is not

After you join, Sprag uploads one row per local calendar day:

| Field | Meaning |
|---|---|
| Spend (USD) | priced from your local session logs |
| Savings (USD) | from the routing and doc2md ledgers |
| Delegated runs | how many runs were delegated that day |
| Model-family share | the share of those runs that went to each model family |
| Sprag version | the installed version |
| Agent | `claude` or `codex` |
| Display name | the name you chose at join; the default is your OS user name |
| Operating system | OS name and version (for example macOS 26, Windows 11, Ubuntu 24.04) and CPU architecture (arm64 or x64); sent once after joining and again only if it changes. Nothing that identifies the machine by name: no hostname, no user name, no path |

Not sent: prompts, transcripts, file paths, project names, rule text, API keys. The one exception is the opt-in prompt upload of an Enterprise team with prompt capture on, described under "Prompt usage (Enterprise)". A rule leaves your machine only when you run `sprag team propose` yourself.

The daily aggregate upload runs at most once every 6 hours after the last successful one, from a detached child process that the SessionStart hook (and the prompt hook, which only reads a small local file) spawns. If a sync fails, for example because the network is down, it is retried after 15, then 30, then 60 minutes (60 at most) instead of waiting 6 hours. The CLI remembers the last day it uploaded and re-sends from the day before it, up to 30 days, so a machine that was offline for days catches up on its first successful sync. Re-sending a day is safe because each day is an upsert. The prompt upload of an Enterprise team with capture on has its own 30-minute timer (see "Prompt usage (Enterprise)"). It never runs on the statusline path.

Destination: `https://hiycfjwswtkixyoqkznm.supabase.co/rest/v1/rpc/*` (Supabase, region ap-northeast-2). The calls are the RPCs `team_join`, `ledger_upsert`, `team_rules_get`, `team_rule_propose`, `team_leave`, `prompt_chunk_put` (Enterprise prompt capture only) and `member_set_sync` (the upload-switch status call, see "The upload switch"); `sprag team create` also calls `team_create` with your sign-in session.

## Create a team from the CLI

You can set up a team without the web dashboard. Signing in uses a 6-digit code emailed to you (valid 15 minutes). Sprag never stores the sign-in session.

In a terminal, run one command and answer the prompts (email, code, team name):

```bash
sprag team create
```

From an agent or any shell without a terminal, it takes two steps:

```bash
sprag team create --email you@example.com --name "Acme"
# the code arrives by email, then:
sprag team create --email you@example.com --name "Acme" --code 123456
```

The first step only sends the code. The second verifies it and creates the team. It then prints the invite token, the member command (`npm i -g sprag-cli@latest && sprag team join <token>`), the organization line (`export SPRAG_TEAM_TOKEN=<token>`) and the dashboard address. Sign in to https://sprag.io/team/ with the same email to manage the team.

By default this machine joins as the first member and runs one sync. Pass `--no-join` to skip that. If this machine is already in a team, run `sprag team leave` first or pass `--no-join`.

## Join as an individual

An owner or admin gives you an invite token. Then:

```bash
sprag team join <token> --name "Mina"
```

Sprag prints the list of what will be uploaded and asks for confirmation. `--name` sets the display name (default: your OS user name). In a shell without a terminal, pass `--yes` to confirm. If you leave the token out, Sprag reads `SPRAG_TEAM_TOKEN`.

Check the result with `sprag team status`.

## Enroll an organization

To enroll every machine without each person running a command, set `SPRAG_TEAM_TOKEN=<token>` in the environment. Two common places:

- a shell profile: `export SPRAG_TEAM_TOKEN=<token>`
- Claude Code managed settings: `{"env":{"SPRAG_TEAM_TOKEN":"…"}}`

The machine joins at the next session start. The first session after that prints a one-line notice that names the team and the two commands that matter: `sprag team status --show-payload` shows what is sent, and `sprag team leave` stops it.

`leave` wins over the environment. A machine that left does not rejoin on its own, even with the variable still set. It rejoins only after an owner or admin issues a new token and the member runs `sprag team join` again.

## Team rules

Rules come at two levels. **Organization rules** apply to every team in the organization; owners and admins write them on the Rules tab of the dashboard. **Team rules** apply to one team; owners and admins approve them there too. An approved team rule can be applied to the whole organization with one click ("Apply to whole organization"): it moves to the organization level and its team copy is retired, so no machine receives it twice.

Members can suggest a team rule:

```bash
sprag team propose "Run lint before every commit" --scope ratchet
```

`--scope` is `ratchet` (the default) or `model`. A proposal stays pending until an owner or admin approves it.

**When a rule arrives.** Approved rules reach a machine at its next session start. A machine checks for new rules at most every hour and uploads usage every 6 hours; `sprag team sync --force` then a new session applies them at once. Both kinds of sync rewrite the rule files as soon as the rules arrive, so the next session reads them without another round trip. `sprag team sync --rules-only` pulls the rules alone and uploads nothing.

Sprag writes the rules to `~/.claude/ratchet-team.md` (Codex: `<CODEX_HOME>/ratchet-team.md`), organization rules first and then team rules, each with its model rules in a sub-section, and imports that file from the global harness block of `~/.claude/CLAUDE.md` for as long as the file exists. Do not edit the file by hand, because Sprag rewrites it. `sprag team rules` lists the cached rules as `- [org · model] text` or `- [team · ratchet] text`. `sprag team leave` removes the member key, the cache and the import.

## Status, payload and leaving

| Command | What it does |
|---|---|
| `sprag team join [token] [--name <n>] [--yes]` | Join a team |
| `sprag team status [--show-payload]` | Team, plan, prompt-capture flag, display name, last sync. `--show-payload` also prints the device info and the exact daily rows that would be uploaded |
| `sprag team sync [--force] [--rules-only]` | Upload now and pull rules. `--force` ignores the 6-hour interval; `--rules-only` pulls the organization and team rules and uploads nothing |
| `sprag team rules` | Show the cached organization and team rules |
| `sprag team propose "<text>" [--scope ratchet\|model]` | Propose a rule to the team |
| `sprag team leave` | Leave the team and stop uploading |

## Organizations and seats

Every team belongs to an organization, and seats are bought per organization, not per team. Teams you create without naming an organization get a new one automatically, so existing setups keep working.

- **What a seat is.** One machine (one member key) that has not left and either sent anything in the last 30 days or is paused. A machine that has been silent for 30 days or more without being paused holds no seat. Members who left are not counted.
- **Second machine.** When the same person uses two machines, an owner or admin can merge the second one into the first so the two share one seat. In the dashboard, use "Merge seat" on the member row; "Unmerge" gives it its own seat back. A merged row shows "shares a seat with <name>".
- **The limit.** Each organization has a seat limit. A join past the limit is refused: `sprag team join` exits 1 with "This organization has no free seat. Ask your organization owner or admin to add seats", and an environment auto-join stays silent and tries again at a later session start. Lowering the limit below current use never removes anyone; it only refuses new joins until Sprag raises it again.
- **Roles.** There are three permission levels. The superuser is Sprag staff: it sets the plan and the seat limit, suspends organizations, adds owners, and sees every organization at sprag.io/ops/. An owner is a company's top level: it appoints and removes admins, and does everything an admin does. An admin is a company's management level: it creates teams and manages members, rules and seats. The person who created a team has no special rights over it; only the organization's owners and admins and the superuser manage teams. Owners and admins see the seat limit in the dashboard. To add seats, write to sales@sprag.io.
- **The plan.** Sprag sets the plan (`pro` or `enterprise`) on the organization; owners and admins cannot change it. Prompt capture can be switched on only while the organization is on Enterprise. To change the plan, contact us.

Create a team inside an existing organization from the CLI with `sprag team create --org <org-id>`. The command prints the organization name and how many seats are used. `sprag team status` shows the organization name.

## The upload switch

`SPRAG_NO_TEAM_SYNC=1` (the old name `CTS_NO_TEAM_SYNC` is still read) stops every usage upload. A joined machine sends one status-only call, `member_set_sync`, with no usage data, the first time it sees the switch on, and one more when it is off again. After that it uploads immediately. That call is how the dashboard can tell a paused machine from a silent one. A paused machine keeps its seat until an owner or admin removes it.

## The dashboard

https://sprag.io/team/ is where an owner or admin signs in with an email code, creates a team and gets the invite token. From there they see per-member spend and savings, manage organization and team rules on the Rules tab, and remove members. The organization panel shows the plan, seats used against the limit, admins and every team. The superuser sees every organization at sprag.io/ops/.

A date range control at the top of the dashboard (7d, 30d, 90d, This month, Last month or Custom) sets the period for the members table, the Usage chart and the prompt usage tab. It defaults to the last 30 days, uses your local calendar days with the end date included, and allows 365 days at most. The choice is kept in the page address (`?from=2026-10-01&to=2026-10-18`), so a reload or a shared link shows the same period. The superuser console at /ops/ has the same control for the organization table, the organization header and its prompt usage.

### The seat roster

Owners and admins get a seat roster on /team. Each row is one machine and shows:

- **Upload switch.** On or Off.
- **Signal.** `ok`: an upload within 48 hours. `late`: the switch is on but there has been no upload for 48 hours or more. `paused`: the switch is off. `silent`: no contact for 30 days or more; the machine holds no seat. `left`: the member ran `sprag team leave`. `removed`: an owner or admin removed it.
- **Dates and version.** Last upload, last contact, paused since, and the Sprag version.

Row actions:

- **Remove** frees the seat, and the machine's key stops working.
- **Restore** brings back only machines that an owner or admin removed, and only within the seat limit.
- **Seat merge** and unmerge, as described above.

Below the roster, an activity log lists joined, paused, resumed, left, removed and restored events, with who did each one: member, owner, admin or superuser.

## Plans

Free, Pro ($5 per seat per month) and Enterprise ($10 per seat per month, with prompt capture and per-user prompt usage). Volume or annual invoicing is a custom agreement; write to sales@sprag.io. Details are on https://sprag.io/pricing/.

## Prompt usage (Enterprise)

Owners and admins of an Enterprise organization get a Prompts tab on sprag.io/team: a per-user table of prompts, characters, average length, active days and last prompt, and a searchable prompt list per user. Prompts are stored only for Enterprise teams that have prompt capture switched on; Pro organizations see a locked state.

**What is captured.** Only the prompts you typed yourself, from your main Claude Code sessions (`~/.claude/projects/**/*.jsonl`) and Codex sessions (`<CODEX_HOME or ~/.codex>/sessions/**/*.jsonl`). Each prompt goes up as its time, the project folder's name (the last part of the path, never the full path) and its text, cut at 20,000 characters. Not captured: assistant replies, tool output, file contents, subagent transcripts, slash-command wrappers, system reminders, or any file path.

**Redaction.** Before upload, obvious secrets are replaced with `[redacted]`: API keys and tokens (`sk-...`, `sk-ant-...`, `ghp_...`, `gho_...`, `github_pat_...`, `AKIA...`, `xox[abpr]-...`), `Bearer` tokens, private key blocks, and `KEY=`, `TOKEN=`, `PASSWORD=` and `SECRET=` assignments. This catches common shapes, not every secret, so do not paste secrets into prompts on a machine with capture on.

**No backfill.** The first time a machine sees prompt capture on, it marks the end of every existing transcript and uploads only what you type after that. Nothing written before the policy reached your machine is sent, and what you type while capture is off is never sent later. Transcripts created afterwards are read from their start. When the policy turns off, the machine forgets its place (`prompts-offsets.json`), so switching it on again starts fresh at the end of every file.

**Cadence.** Prompts are uploaded about every 30 minutes while Claude Code or Codex is in use; the daily aggregate stays at every 6 hours. A prompt you submit checks a small local timer and, when 30 minutes have passed, starts a detached background upload (no network and no parsing happen in the hook itself). A session start and `sprag team sync --force` also upload. One run sends at most 2,000 prompts or 8 MB; the rest waits for the next sync. The file path is never sent; each file is identified by the first 16 characters of a hash of its path, and a repeated chunk is ignored by the server.

**Check it.** `sprag team status` shows "Prompt capture: on" and the time and count of the last prompt upload. `sprag team status --show-payload` also shows how many prompts are waiting and one example (time, project, first 80 characters), never the full text of the pending prompts.

**How to stop.** Ask an owner or admin to switch prompt capture off for the team (the next sync stops the upload and clears the position file); set `SPRAG_NO_TEAM_SYNC=1` to stop every upload right away; or run `sprag team leave`.

## Privacy notes

- Owners and admins see per-member daily totals, not sessions or prompts, unless the organization is on Enterprise and the team has prompt capture switched on.
- A member sees the same payload with `sprag team status --show-payload`.
- Prompt capture is an Enterprise policy that an owner or admin can switch on in the dashboard. Members see its state in `sprag team status`. When capture is on, the CLI uploads the prompts you type after the policy reached your machine (see "Prompt usage (Enterprise)").
- Rule text leaves your machine only through `sprag team propose`.

## Files and environment variables

| Name | Purpose |
|---|---|
| `<user data dir>/team.json` | Membership state and the member key (mode 0600) |
| `<user data dir>/team-rules.json` | Organization and team rules pulled at the last sync |
| `<user data dir>/prompts-offsets.json` | Where the prompt uploader stopped in each transcript; exists only while prompt capture is on |
| `~/.claude/ratchet-team.md` | Approved organization and team rules for Claude Code, imported from `~/.claude/CLAUDE.md` |
| `<CODEX_HOME>/ratchet-team.md` | The same rules for Codex |
| `SPRAG_TEAM_TOKEN` | Invite token; enrolls the machine at the next session start |
| `SPRAG_NO_TEAM_SYNC=1` | Stops every usage upload. A joined machine sends only one status-only call when it first sees the switch on and when it is off again (old name `CTS_NO_TEAM_SYNC` still read) |
