# Install and what it turns on

[← README](../README.md) · [한국어](./INSTALL.ko.md)

## Getting started

Sprag supports Claude Code and Codex. Commands default to Claude Code; use
`--agent codex` to select Codex without changing the other integration.

### Codex

```bash
npm i -g sprag-cli
```

One command sets up both agents. The install registers the Claude Code
integration and the bundled rule presets for every project, and when Codex is
installed (`~/.codex` or `$CODEX_HOME` exists) it also registers the Codex hooks
and the `AGENTS.md` harness. Nothing is asked; pass `sprag install --manual` to
confirm each step instead.

The one step left is Codex's own: open **`/hooks` in Codex** and trust the Sprag
hooks. Codex requires that approval, so no installer can do it for you.
`sprag doctor --agent codex` is for troubleshooting only.

To use Codex without touching Claude Code settings:

```bash
npm i -g sprag-cli --ignore-scripts
sprag install --agent codex
```

Use `sprag panel --agent codex` in a companion terminal, or
`sprag panel run --agent codex --` for a tmux layout. Model routing is opt-in;
rules you add later require an explicit scope. See [Codex workflows and limits](./CODEX.md).

### Claude Code

**Prerequisite:** Node.js ≥ 20 (`node -v` · macOS `brew install node` · Windows `winget install OpenJS.NodeJS.LTS` · Linux/WSL: [nvm](https://github.com/nvm-sh/nvm) recommended)

```bash
npm i -g sprag-cli
```

The statusline appears at the bottom of Claude Code right away. If auto-registration was skipped (`--ignore-scripts`, sudo, sandboxed installs), run `sprag install`.

One install sets up everything: **statusline, Skill, SessionStart hook, the 🅷 Harness (5 principles), the bundled rule presets, and a first route-scan.** Nothing is asked by default; `sprag install --manual` shows what the harness, the presets and the Korean writing guidance add and asks before enabling each. The harness is **appended** to `~/.claude/CLAUDE.md` as a marked block (your existing content is backed up and preserved) and is left alone if one is already there.

Setup runs from npm's `postinstall` only for a global npm install. A project dependency install, the `npx` cache and anything with `CI` set skip it and print one line saying so, because the hooks call `sprag` by name and those installs do not put it on PATH. `SPRAG_POSTINSTALL=1` forces the setup and `SPRAG_POSTINSTALL=0` skips it; either way `sprag install` does the same thing by hand.

Outside a terminal — npm `postinstall`, CI, piped stdin — the question is skipped and the old defaults apply. Use `--yes` or `--no-input` to skip it deliberately, `SPRAG_NO_HARNESS=1 npm i -g sprag-cli` to skip the harness entirely, and `sprag harness uninit --global` to undo it.

> ⚠️ Avoid `sudo` global installs — the Skill lands in root's `~/.claude` instead of yours. Use nvm/fnm/Volta or `npm config set prefix ~/.npm-global`.

### What the install turns on, and what stays manual

Everything that costs nothing until it is needed is on after a plain install. The only manual items are the ones that change Claude Code's own settings or need a human to pick a scope.

| Feature | After install | How to turn it off |
|---|---|---|
| statusline (diagnostic chips, savings ledger) | on | `sprag uninstall` |
| `/claude-token-saver` Skill | on | same |
| SessionStart hook (route-scan refresh) | on | same |
| UserPromptSubmit hook (brief injection) | on | same |
| First route-scan (last 14 days of logs) | runs once during the install | n/a |
| 🅷 Harness 5 principles (`~/.claude/CLAUDE.md`) | on (shown and confirmed once at a terminal) | `harness uninit --global`, `SPRAG_NO_HARNESS=1` |
| doc2md hooks (Read, Edit/Write, prompt) | on | `doc2md off`, `SPRAG_NO_DOC2MD=1` |
| doc2md converter (markitdown venv) | offered at a terminal; an unattended install prints the command | install later with `doc2md install-converter` |
| Korean writing guidance | on when the locale is Korean (asked at a terminal) | `korean off`, `SPRAG_NO_KOREAN=1` |
| compact-window warning chip | on | `compact-window off` |
| Update-available chip | on | `SPRAG_NO_UPDATE_CHECK=1` |
| ⭐ Star note (once, for a day, after $10 saved by routing and doc2md) | on | `SPRAG_NO_NOTE=1` |
| **Pinning compact-window** (`autoCompactWindow` 500k) | **off — run it yourself** | `compact-window set --global` or `--project` |
| **Model-fitting rules** (`ratchet-model.md` delegations) | **candidates are proposed only** | review and approve with `route-scan rules` |
| `handoff` (back up work before a cap) | an on-demand command | n/a |

`compact-window set` writes into Claude Code's `settings.json` and a human has to choose global or project scope, so it is never run for you. Model-fitting rules keep an approval step for the same reason: which work belongs on a cheaper tier is your call.

The `SPRAG_` variables above used to carry a `CTS_` prefix (`CTS_NO_UPDATE_CHECK`, `CTS_NO_HARNESS` and so on). The old `CTS_` names are still read, and the `SPRAG_` name wins when both are set.

### Network access

Everything Sprag measures comes from files on your machine. The list below is every place it talks to over the network, taken from a static scan of the published package (3.68.0) plus the opt-in team layer added in 3.70.0. Nothing here runs while the statusline renders: fetches happen in a detached child and the render path reads the cached answer.

| Destination | When | What is sent | How to turn it off |
|---|---|---|---|
| `<npm registry>/sprag-cli/latest`: the registry comes from `npm_config_registry` or the `registry=` line of `~/.npmrc` (default `registry.npmjs.org`), with no fallback to npmjs | once a day from the statusline, every 3 hours from the SessionStart hook | the request only; no identifiers. Registry auth tokens (`_authToken`) are not sent, so a registry that requires authentication for reads makes the check fail | `SPRAG_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER=1` |
| `api.github.com/repos/rootstudioyaml/sprag/releases/tags/<version>` | with the registry check, when a newer version exists, to show its three highlights | the request only | same switch |
| `https://hiycfjwswtkixyoqkznm.supabase.co/rest/v1/rpc/presets_version` and `presets_published` (Supabase, read-only) | at most once every 24 hours, from the SessionStart hook's detached child; `presets_published` only when the published version has changed. `sprag presets sync` checks now | the request only, with the public anon key: no member key and no identifiers. The published ratchet, model-routing and delegation-agent presets are applied only when their signature verifies against a key built into the CLI. Offline, blocked or unverified, the presets bundled in the package stay in use, and `sprag presets status` says which copy is active and why | `SPRAG_NO_PRESET_SYNC=1` or `SPRAG_NO_UPDATE_CHECK=1` |
| your LiteLLM gateway: `GET /key/info`, `/user/info`, `/model/info` | only when `ANTHROPIC_BASE_URL` points at a gateway and a key is available; the budget gauge refreshes on the statusline's cadence, `/model/info` on `sprag profile-map --refresh` or alongside a budget refresh. Codex uses the provider base from its own config | your own key as the `Authorization` header; the key is never written to Sprag's cache files | unset `ANTHROPIC_BASE_URL`, or `sprag mode` without the budget segment |
| GitHub issue via the `gh` CLI | `sprag feedback` only, when `gh` is logged in | the message you typed, plus version, OS and Node.js version | `--anonymous` skips the `gh` path |
| `docs.google.com/forms/…/formResponse` | `sprag feedback` only, when `gh` is not available | the same message and metadata, to an anonymous form the maintainer reads | do not run `feedback`; `sprag feedback` also saves a local copy with a prefilled issue URL |
| `npm install -g sprag-cli@<version>` | `sprag upgrade`, after you accept the offer | an ordinary npm install | decline the offer |
| `pip install markitdown` into Sprag's own venv; `npm install openfig-core` into Sprag's data directory | the doc2md converter, when you accept the install at a terminal or a document first needs it | ordinary package installs; `openfig-core` installs with `--ignore-scripts` | `SPRAG_DOC2MD_NO_AUTOINSTALL=1` stops the automatic case |
| `https://hiycfjwswtkixyoqkznm.supabase.co/rest/v1/rpc/*` (Supabase) | only after `sprag team join` or with `SPRAG_TEAM_TOKEN` set; then every 5 minutes from the detached child that the SessionStart and prompt hooks spawn | daily aggregates per local day: spend (USD), savings (USD), delegated-run count, model-family share, Sprag version, agent, your display name, plus the OS name and version and the CPU architecture (no hostname, user name or path; sent once after joining and again only on change, through `member_set_info`). No prompts, transcripts, file paths, project names or API keys. A rule goes up only with `sprag team propose`, and a new display name only with `sprag team name` (`member_set_name`). One status-only call (`member_set_sync`, no usage data) goes out the first time the machine sees `SPRAG_NO_TEAM_SYNC=1` on and once when it is off again. See [Team layer](./TEAM.md) | `sprag team leave` or `SPRAG_NO_TEAM_SYNC=1` (stops every usage upload) |
| `https://hiycfjwswtkixyoqkznm.supabase.co/rest/v1/rpc/prompt_chunk_put` (Supabase) | only for a member of an Enterprise team whose policy has prompt capture on; about every 30 minutes while Claude Code or Codex is in use (a prompt submit starts a detached background upload when 30 minutes have passed), and at session start | the prompts you typed in your main Claude Code and Codex sessions after the policy reached your machine: time, project folder name and text (cut at 20,000 characters), with obvious secrets replaced by `[redacted]`. No assistant replies, tool output, file contents, subagent transcripts or file paths. At most 2,000 prompts or 8 MB per run. See [Team layer](./TEAM.md) | the team's prompt capture policy (owner or admin), `SPRAG_NO_TEAM_SYNC=1` or `sprag team leave` |

No usage data, transcript content or project paths leave the machine, unless you join a team. A team receives only the daily aggregates listed in the team-layer rows of the table above and, for an Enterprise team with prompt capture on, the prompt upload described in the row after it. The savings ledger, the route-scan rules and the history files stay under the user-data directory listed in the Skill's storage section.

On Node 22.19 or 24.5 and later, these requests also trust the operating system's certificate store (macOS Keychain, Windows certificate store, the Linux system bundle), on top of Node's bundled roots and `NODE_EXTRA_CA_CERTS`. Behind a corporate proxy that re-signs HTTPS with a root installed only in the system store, the update check, preset sync and team sync keep working without extra setup. The store is read once, just before the first request, never while the statusline renders. `SPRAG_SYSTEM_CA=0` turns this off; with `NODE_USE_SYSTEM_CA=1` or `--use-system-ca`, Node has already loaded the store and Sprag leaves it alone. Older Node versions keep the bundled roots only, so set `NODE_EXTRA_CA_CERTS` there.

---
