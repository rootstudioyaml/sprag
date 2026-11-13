# What Sprag sends

[← README](../README.md) · [한국어](./DATA.ko.md)

This page covers only the data Sprag uploads to its server, plan by plan. Download-only lookups such as the new-version check upload nothing, so they are left out.

| Plan | Uploaded to the server |
|---|---|
| Open source (free CLI) | nothing |
| Pro | daily numeric totals from computers that joined a team |
| Enterprise | the Pro totals, plus prompts people typed, only for teams with capture on |

## Open source

Nothing is uploaded and no account is needed. All analysis runs on the session logs already on your computer. Only when you run `sprag feedback` yourself are the message you typed, the version and the OS passed on.

## Pro

Only computers that ran `sprag team join` or got `SPRAG_TEAM_TOKEN` from their organization upload. Before joining, nothing goes up, even under a contract.

**Uploaded** (one row per day)
- spend, savings and delegation cost (USD), and delegation counts
- spend and share per model family (names such as `opus` and `sonnet`)
- OS name and version, Sprag version, display name (a random ID such as `member-3f9a2c71` by default)
- delegation rule summary: numbers only, such as counts, failure rate and savings per category

**Not uploaded**: prompts, conversations, code, file paths, project names, rule text, API keys, hostnames, error messages

Organization owners and admins see only each member's daily totals.

## Enterprise

The same totals as Pro. Only when an organization owner or admin turns prompt capture on for a team, these are added:

- the text of prompts typed in main sessions (up to 20,000 characters), the time, and a per-machine alias of the project (`p-` plus 10 hex characters), not its name
- API keys, tokens, passwords, emails, phone numbers, Korean resident registration numbers and card numbers are masked as `[redacted]`, network addresses as `<host>`, URLs as `<url>` and file paths as `<path>`, all on your computer before upload
- nothing written before capture was turned on is uploaded
- assistant replies, tool output and file contents are not uploaded

Prompts can be read only by that organization's owners and admins, and by Sprag operators handling support.

## Check and turn off

- `sprag team status --show-payload`: prints exactly what the next upload contains
- `SPRAG_NO_TEAM_SYNC=1`: stops every upload
- `sprag team leave`: leaves the team

Data is stored over HTTPS in Supabase's Seoul region and deleted within 30 days after an organization closes. Questions go to support@sprag.io. Item-level detail is in the [team guide](./TEAM.md).
