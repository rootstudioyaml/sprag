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

Destination: `https://hiycfjwswtkixyoqkznm.supabase.co/rest/v1/rpc/*` (Supabase, region ap-northeast-2). The calls are the RPCs `team_join`, `ledger_upsert`, `team_rules_get`, `team_rule_propose` and `team_leave`.

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

## The dashboard

https://sprag.io/team/ is where the owner signs in with an email code, creates a team and gets the invite token. From there the owner sees per-member spend and savings for the last 30 days, approves or removes rules, and removes members.

## Plans

Free, Team ($5 per seat per month) and Team Plus ($10 per seat per month, with prompt capture). Details are on https://sprag.io/pricing/.

## Privacy notes

- The owner sees per-member daily totals, not sessions or prompts.
- A member sees the same payload with `sprag team status --show-payload`.
- Prompt capture is a Team Plus policy that the owner can switch on in the dashboard. Members see its state in `sprag team status`. The current CLI does not upload prompts yet; that is a separate, later release.
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
