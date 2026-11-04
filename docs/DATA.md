# What Sprag sends

[← README](../README.md) · [한국어](./DATA.ko.md)

This page lists, plan by plan, what leaves your computer when you use the open-source CLI, Pro or Enterprise. Each item names the source file it comes from, so you can check it against the code in this repository. Checked against sprag-cli 3.97.

## Summary

- **Open source (free CLI)**: nothing that identifies you goes to a Sprag server, and there is no account. The only outbound requests are anonymous lookups, such as checking for a new version and for the published presets. They carry no usage data and no identifier.
- **Pro**: only computers that joined a team upload, one row of numbers per day: spend, savings, delegation counts and similar figures. Prompts, code, file paths and project names are not sent.
- **Enterprise**: the same daily numbers as Pro. Prompts a person typed are added only when an organization owner or admin turns prompt capture on for a team. Secrets and personal data are masked on your computer before upload, and nothing written before capture was turned on is sent.

The team layer starts only when you run `sprag team join` or your organization deploys `SPRAG_TEAM_TOKEN`. Until then a computer sends no figures, even under a Pro or Enterprise contract.

## At a glance

| Data | Open source | Pro | Enterprise |
|---|---|---|---|
| Prompt text | not sent | not sent | teams with capture on only, after masking |
| Assistant replies, tool output | not sent | not sent | not sent |
| Source code, file contents | not sent | not sent | not sent (text you paste into a prompt is part of that prompt) |
| File paths, full project paths | not sent | not sent | not sent |
| Project folder name | not sent | not sent | the last folder name of the path, once per captured prompt |
| API keys, tokens, passwords | not sent | not sent | not sent (key-shaped values inside a prompt are masked before upload) |
| Hostname, OS user name | not sent | not sent | not sent |
| Email address | not sent | owners and admins who sign in to the dashboard | same as Pro |
| Daily spend, savings, delegation counts | not sent | sent | sent |
| OS name and version | not sent | sent | sent |
| Display name | not sent | sent (a random ID by default) | sent (a random ID by default) |
| Delegation rule summary (numbers only) | not sent | sent | sent |
| Rule text | not sent | only when you run `sprag team propose` | same as Pro |
| Anonymous version and preset checks | the request only | the request only | the request only |

## Open source (free CLI)

Sprag's analysis reads the session logs Claude Code and Codex already keep on your computer. The statusline, route-scan, the savings ledger and doc2md conversion all work on local files. The statusline never waits on the network: the requests below go out from a detached child process, and the screen reads only the cached answer.

### Anonymous requests Sprag makes

| Destination | When | What is sent | Turn off |
|---|---|---|---|
| `sprag-cli/latest` on your npm registry | about once a day | the request only, without the registry auth token | `SPRAG_NO_UPDATE_CHECK=1` |
| `api.github.com/repos/rootstudioyaml/sprag/releases/tags/<version>` | only when a newer version exists | the request only; it fetches three highlights of that release | same switch |
| `presets_version` and `presets_published` on the Sprag preset server (Supabase) | at most once every 24 hours | the request only, with the public key every install shares; no member key and no device ID | `SPRAG_NO_PRESET_SYNC=1` |

The two preset functions are read-only SQL queries over the published presets, and they record nothing about the caller. A fetched preset bundle is applied only after its signature checks out against a public key built into the CLI. As with any request on the internet, the receiving server does see the IP address it came from.

Source: `src/update-check.js`, `src/preset-sync.js`, `src/presets-source.js`

### Requests made on your behalf to other services

These never reach a Sprag server. They go to a service you already use, with your own credentials.

| Destination | Condition | Content | Turn off |
|---|---|---|---|
| `api.anthropic.com/api/oauth/usage` | signed in with a claude.ai account on a plan other than Pro or Max (Team, Enterprise and so on), to draw the budget gauge | the sign-in token Claude Code stored, sent to Anthropic only; it is used in memory and never written to a file or log | `sprag mode no-oauth-budget` or `SPRAG_OAUTH_BUDGET=0` |
| your LiteLLM gateway | `ANTHROPIC_BASE_URL` points at a gateway | budget and price lookups with the gateway key you already use; the key is not written to any cache file | unset `ANTHROPIC_BASE_URL` or drop the budget segment |
| npm, PyPI | you accept `sprag upgrade` or install the doc2md converter | an ordinary package install | decline the install |
| a GitHub issue or an anonymous Google Form | only when you run `sprag feedback` | the message you typed, plus Sprag version, OS and Node.js version | do not run the command |

Source: `src/oauth-budget.js`, `src/litellm-budget.js`, `src/gateway-spend.js`, `src/commands/feedback.js`. The full list of destinations is in the [network table of the install guide](./INSTALL.md#network-access).

## Pro

### When it starts

A computer joins a team in one of two ways. When you run `sprag team join <token>`, Sprag first prints the list of what will be uploaded and asks you to confirm. When your organization puts `SPRAG_TEAM_TOKEN` in a shell profile or in Claude Code's managed settings, the computer joins at the next session and the first session shows a one-line notice naming the team and the commands to inspect or stop it.

### What goes up

A joined computer uploads one row per local calendar day, at most once every 5 minutes, covering up to the last 30 days.

- **Money**: Claude spend, Codex spend, gateway spend, total spend, delegation cost, subagent cost and savings (all USD), plus spend per model family (names such as `opus` and `sonnet`)
- **Counts**: delegated runs, the share of each model family, and the number of sessions left out because their price was unknown
- **Device**: OS name and version (for example macOS 26), Sprag version, agent (`claude` or `codex`), display name and device ID
- **Gateway user hash**: only with a LiteLLM gateway. The first 16 hex characters of a hash over the gateway address and your gateway user ID, used to count one person's two computers once
- **Delegation rule summary**: per category and tier, numbers only, such as delegation count, failure rate, savings, budgets and the start date

The default display name and device ID are a random value such as `member-3f9a2c71`, made once per computer. Earlier versions used the OS login name, which could put a real name on the server, so it was replaced with the random ID. If you want your name on the dashboard, set it yourself with `sprag team name "Name"`. The CPU architecture field remains an argument of the server function but is always sent empty.

The rule summary is built from an allowlist. The local rule file holds project paths and prompt excerpts, so each summary row is a new object whose 12 fixed keys are filled only with numbers and fixed words. `test/team-rule-stats.test.js` pins the key set and checks that no path or example text survives into the output.

Source: `aggregateDaily` and `deviceInfo` in `src/team-sync.js`, `src/member-id.js`, `src/team-rule-stats.js`

### What comes down

The same sync pulls the rules your organization approved, the organization's minimum Sprag version, and your dashboard standing (the statusline `team` chip). A computer below the minimum version upgrades itself at the next session. That is the only case where Sprag installs a package without asking.

### Who sees it

Organization owners and admins see each member's daily totals at sprag.io/team. They cannot see session contents or prompts. Sprag operators see organization-level totals and seat status in the operator console, for support and billing.

## Enterprise

Enterprise uploads the same daily numbers as Pro and adds prompt capture. Capture starts switched off. An organization owner or admin turns it on per team in the dashboard, and every member can see whether it is on with `sprag team status` ("Prompt capture: on").

### What is captured

Only prompts a person typed in their main Claude Code and Codex sessions. Each prompt carries three values:

- the time it was typed
- the project folder name (the last part of the path only, never the full path)
- the text (up to 20,000 characters)

Text pasted into a prompt is part of that prompt's text. If company policy treats some code or documents as sensitive, let members know before they paste them into a prompt.

### What is never sent

Assistant replies, tool output, the contents of files Claude read, subagent transcripts, slash-command wrappers, system reminders, local paths, background-task notifications, messages from other agents, and `!` shell commands with their output. Transcript file paths are not sent either: a file is told apart by the first 16 hex characters of the SHA-256 of its path.

### What is masked before upload

Masking happens on your computer, before upload.

| Kind | Replaced with |
|---|---|
| API keys and tokens (`sk-...`, `sk-ant-...`, `ghp_...`, `github_pat_...`, `AKIA...`, `xox?-...`), `Bearer` tokens, private key blocks, assignments shaped like `KEY=`, `TOKEN=`, `PASSWORD=`, `SECRET=` | `[redacted]` |
| Email addresses | `[redacted:email]` |
| Korean phone numbers | `[redacted:phone]` |
| Korean resident registration numbers | `[redacted:rrn]` |
| Card numbers | `[redacted:card]` |

The patterns are tuned not to mangle code snippets, so an unusually shaped secret can slip through. The safest place for a secret is outside the prompt.

### History is never uploaded

The first time a computer sees capture switched on, it marks the current end of every transcript file as the starting point. Only prompts typed after that go up, so conversations from before the policy reached the computer never leave it. Switching capture off deletes the starting-point file, and switching it on again starts from the end of every file at that moment. Prompts typed while capture was off are never uploaded later.

### Who sees it

Captured prompts are read by the organization's owners and admins in the Prompts tab at sprag.io/team. Sprag operators (superusers) can open the same view in the operator console for support and incident response. The server function `prompt_access_check` lets only these two roles through, and only on the Enterprise plan; Pro organizations see the tab locked.

Source: `src/team-prompts.js`

## Storage and security on the server

- **Location**: Supabase, Seoul region (ap-northeast-2)
- **In transit**: every request to a Sprag server uses HTTPS
- **Access path**: computers cannot write tables directly; they call fixed server functions, and each function checks the member key and touches only that member's rows. The dashboard uses row-level access control, so each person sees only their own organization's data
- **Member key**: kept in `team.json` in the user data directory with mode 0600
- **Retention**: organization data is deleted within 30 days after the organization closes. When an owner or admin deletes a removed computer, that computer's usage history and prompts are erased at once
- **Third parties**: data is not sold. Processors are listed in the [privacy policy](https://sprag.io/privacy/)
- **Website**: sprag.io has no advertising cookies and no analytics scripts

## Checking it yourself

`sprag team status --show-payload` prints the device info, daily rows and rule summary that the next sync would upload. With Enterprise capture on, it also shows how many prompts are waiting and the first 80 characters of one of them. It computes all of this locally, without touching the network.

To turn every request off, put these three lines in your shell profile and run `sprag mode no-oauth-budget` once.

```bash
export SPRAG_NO_UPDATE_CHECK=1   # version check and preset check
export SPRAG_NO_PRESET_SYNC=1    # preset check
export SPRAG_NO_TEAM_SYNC=1      # every team upload
```

A computer that has joined a team and sees `SPRAG_NO_TEAM_SYNC=1` sends one status call saying uploads are paused. It carries no usage data; the dashboard uses it to tell a paused computer from one that went quiet. To leave the team entirely, run `sprag team leave`.

The CLI code is open under the Apache-2.0 license. You can read the source files named above yourself, and the team layer is covered in detail in the [team guide](./TEAM.md).

## Contact

Send questions about data handling, and requests to see, correct or delete your data, to support@sprag.io. Report security vulnerabilities through [SECURITY.md](../SECURITY.md).
