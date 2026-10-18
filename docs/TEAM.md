# Team layer

[← README](../README.md) · [한국어](./TEAM.ko.md)

Sprag is local-only by default. The team layer is an opt-in add-on that lets a group see each member's daily spend and savings in one dashboard, and share the ratchet rules the team owner approves. Nothing is sent until you run `sprag team join <token>` or your environment sets `SPRAG_TEAM_TOKEN`. `CTS_NO_TEAM_SYNC=1` turns off all team network traffic, whatever else is configured.

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

Destination: `https://hiycfjwswtkixyoqkznm.supabase.co/rest/v1/rpc/*` (Supabase, region ap-northeast-2). The calls are the RPCs `team_join`, `ledger_upsert`, `team_rules_get`, `team_rule_propose` and `team_leave`; `sprag team create` also calls `team_create` with your sign-in session.

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

The team owner gives you an invite token. Then:

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

`leave` wins over the environment. A machine that left does not rejoin on its own, even with the variable still set. It rejoins only after the owner issues a new token and the member runs `sprag team join` again.

## Team rules

The team owner approves rules in the dashboard. Members can also suggest one:

```bash
sprag team propose "Run lint before every commit" --scope ratchet
```

`--scope` is `ratchet` (the default) or `model`. A proposal stays pending until the owner approves it.

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

- **What a seat is.** One machine (one member key) that was active in the last 30 days and has not left. Members who left are not counted.
- **Second machine.** When the same person uses two machines, an admin can merge the second one into the first so the two share one seat. In the dashboard, use "Merge seat" on the member row; "Unmerge" gives it its own seat back. A merged row shows "shares a seat with <name>".
- **The limit.** Each organization has a seat limit. A join past the limit is refused: `sprag team join` exits 1 with "This organization has no free seat. Ask your Sprag admin to raise the seat limit", and an environment auto-join stays silent and tries again at a later session start. Lowering the limit below current use never removes anyone; it only refuses new joins until Sprag raises it again.
- **Roles.** The organization owner appoints or removes admins and renames the organization; the seat limit is set by Sprag, and owners see it in the dashboard. To add seats, write to sales@sprag.io. An admin creates teams, assigns team owners and sees every team in the organization. A team owner manages only their own team, as before.
- **The plan.** Sprag sets the plan (`team` or `business`) on the organization; owners cannot change it. Prompt capture can be switched on only while the organization is on Business. To change the plan, contact us.

Create a team inside an existing organization from the CLI with `sprag team create --org <org-id>`. The command prints the organization name and how many seats are used. `sprag team status` shows the organization name.

## The dashboard

https://sprag.io/team/ is where the owner signs in with an email code, creates a team and gets the invite token. From there the owner sees per-member spend and savings for the last 30 days, approves or removes rules, and removes members. Organization owners and admins also get an organization panel: plan, seats used against the limit, admins, every team with its owner, and merge or unmerge of seats.

## Plans

Free, Team ($5 per seat per month) and Business ($10 per seat per month, with prompt capture). Details are on https://sprag.io/pricing/.

## Privacy notes

- The owner sees per-member daily totals, not sessions or prompts.
- A member sees the same payload with `sprag team status --show-payload`.
- Prompt capture is a Business policy that the owner can switch on in the dashboard. Members see its state in `sprag team status`. The current CLI does not upload prompts yet; that is a separate, later release.
- Rule text leaves your machine only through `sprag team propose`.

## Files and environment variables

| Name | Purpose |
|---|---|
| `<user data dir>/team.json` | Membership state and the member key (mode 0600) |
| `<user data dir>/team-rules.json` | Rules pulled at the last sync |
| `~/.claude/ratchet-team.md` | Approved team rules for Claude Code, imported from `~/.claude/CLAUDE.md` |
| `<CODEX_HOME>/ratchet-team.md` | The same rules for Codex |
| `SPRAG_TEAM_TOKEN` | Invite token; enrolls the machine at the next session start |
| `CTS_NO_TEAM_SYNC=1` | Disables all team network traffic |
