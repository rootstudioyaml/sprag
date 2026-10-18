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

Not sent: prompts, transcripts, file paths, project names, rule text, API keys. A rule leaves your machine only when you run `sprag team propose` yourself.

The upload runs at most once every 6 hours, from a detached child process that the SessionStart hook spawns. It never runs on the statusline path.

Destination: `https://hiycfjwswtkixyoqkznm.supabase.co/rest/v1/rpc/*` (Supabase, region ap-northeast-2). The calls are the RPCs `team_join`, `ledger_upsert`, `team_rules_get`, `team_rule_propose`, `team_leave` and `member_set_sync` (the upload-switch status call, see "The upload switch"); `sprag team create` also calls `team_create` with your sign-in session.

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

Owners and admins approve rules in the dashboard. Members can also suggest one:

```bash
sprag team propose "Run lint before every commit" --scope ratchet
```

`--scope` is `ratchet` (the default) or `model`. A proposal stays pending until an owner or admin approves it.

Approved rules come back with the next sync. Sprag writes them to `~/.claude/ratchet-team.md` (Codex: `<CODEX_HOME>/ratchet-team.md`) and imports that file from the global harness block of `~/.claude/CLAUDE.md` for as long as the file exists. Do not edit the file by hand, because Sprag rewrites it at session start. `sprag team rules` lists the cached rules. `sprag team leave` removes the member key, the cache and the import.

## Status, payload and leaving

| Command | What it does |
|---|---|
| `sprag team join [token] [--name <n>] [--yes]` | Join a team |
| `sprag team status [--show-payload]` | Team, plan, prompt-capture flag, display name, last sync. `--show-payload` also prints the exact daily rows that would be uploaded |
| `sprag team sync [--force]` | Upload now and pull rules. `--force` ignores the 6-hour interval |
| `sprag team rules` | Show the cached team rules |
| `sprag team propose "<text>" [--scope ratchet\|model]` | Propose a rule to the team |
| `sprag team leave` | Leave the team and stop uploading |

## Organizations and seats

Every team belongs to an organization, and seats are bought per organization, not per team. Teams you create without naming an organization get a new one automatically, so existing setups keep working.

- **What a seat is.** One machine (one member key) that has not left and either sent anything in the last 30 days or is paused. A machine that has been silent for 30 days or more without being paused holds no seat. Members who left are not counted.
- **Second machine.** When the same person uses two machines, an owner or admin can merge the second one into the first so the two share one seat. In the dashboard, use "Merge seat" on the member row; "Unmerge" gives it its own seat back. A merged row shows "shares a seat with <name>".
- **The limit.** Each organization has a seat limit. A join past the limit is refused: `sprag team join` exits 1 with "This organization has no free seat. Ask your Sprag admin to raise the seat limit", and an environment auto-join stays silent and tries again at a later session start. Lowering the limit below current use never removes anyone; it only refuses new joins until Sprag raises it again.
- **Roles.** There are three permission levels. The superuser is Sprag staff: it sets the plan and the seat limit, suspends organizations, adds owners, and sees every organization at sprag.io/ops/. An owner is a company's top level: it appoints and removes admins, and does everything an admin does. An admin is a company's management level: it creates teams and manages members, rules and seats. The person who created a team has no special rights over it; only the organization's owners and admins and the superuser manage teams. Owners and admins see the seat limit in the dashboard. To add seats, write to sales@sprag.io.
- **The plan.** Sprag sets the plan (`team` or `business`) on the organization; owners and admins cannot change it. Prompt capture can be switched on only while the organization is on Business. To change the plan, contact us.

Create a team inside an existing organization from the CLI with `sprag team create --org <org-id>`. The command prints the organization name and how many seats are used. `sprag team status` shows the organization name.

## The upload switch

`SPRAG_NO_TEAM_SYNC=1` (the old name `CTS_NO_TEAM_SYNC` is still read) stops every usage upload. A joined machine sends one status-only call, `member_set_sync`, with no usage data, the first time it sees the switch on, and one more when it is off again. After that it uploads immediately. That call is how the dashboard can tell a paused machine from a silent one. A paused machine keeps its seat until an owner or admin removes it.

## The dashboard

https://sprag.io/team/ is where an owner or admin signs in with an email code, creates a team and gets the invite token. From there they see per-member spend and savings for the last 30 days, approve or remove rules, and remove members. The organization panel shows the plan, seats used against the limit, admins and every team. The superuser sees every organization at sprag.io/ops/.

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

Free, Team ($5 per seat per month) and Business ($10 per seat per month, with prompt capture). Details are on https://sprag.io/pricing/.

## Privacy notes

- Owners and admins see per-member daily totals, not sessions or prompts.
- A member sees the same payload with `sprag team status --show-payload`.
- Prompt capture is a Business policy that an owner or admin can switch on in the dashboard. Members see its state in `sprag team status`. The current CLI does not upload prompts yet; that is a separate, later release.
- Rule text leaves your machine only through `sprag team propose`.

## Files and environment variables

| Name | Purpose |
|---|---|
| `<user data dir>/team.json` | Membership state and the member key (mode 0600) |
| `<user data dir>/team-rules.json` | Rules pulled at the last sync |
| `~/.claude/ratchet-team.md` | Approved team rules for Claude Code, imported from `~/.claude/CLAUDE.md` |
| `<CODEX_HOME>/ratchet-team.md` | The same rules for Codex |
| `SPRAG_TEAM_TOKEN` | Invite token; enrolls the machine at the next session start |
| `SPRAG_NO_TEAM_SYNC=1` | Stops every usage upload. A joined machine sends only one status-only call when it first sees the switch on and when it is off again (old name `CTS_NO_TEAM_SYNC` still read) |
