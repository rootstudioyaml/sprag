# Install and what it turns on

[← README](../README.md) · [한국어](./INSTALL.ko.md)

## Getting started

**Prerequisite:** Node.js ≥ 18 (`node -v` · macOS `brew install node` · Windows `winget install OpenJS.NodeJS.LTS` · Linux/WSL: [nvm](https://github.com/nvm-sh/nvm) recommended)

```bash
npm i -g sprag-cli
```

The statusline appears at the bottom of Claude Code right away. If auto-registration was skipped (`--ignore-scripts`, sudo, sandboxed installs), run `sprag install`.

One install sets up everything: **statusline, Skill, SessionStart hook, the 🅷 Harness (5 principles), and a first route-scan.** The harness and the Korean writing guidance **show what they add and ask before enabling it.** The harness is **appended** to `~/.claude/CLAUDE.md` as a marked block (your existing content is backed up and preserved) and is left alone if one is already there.

Outside a terminal — npm `postinstall`, CI, piped stdin — the question is skipped and the old defaults apply. Use `--yes` or `--no-input` to skip it deliberately, `CTS_NO_HARNESS=1 npm i -g sprag-cli` to skip the harness entirely, and `sprag harness uninit --global` to undo it.

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
| 🅷 Harness 5 principles (`~/.claude/CLAUDE.md`) | on (shown and confirmed once at a terminal) | `harness uninit --global`, `CTS_NO_HARNESS=1` |
| doc2md hooks (Read, Edit/Write, prompt) | on | `doc2md off`, `CTS_NO_DOC2MD=1` |
| doc2md converter (markitdown venv) | offered at a terminal; an unattended install prints the command | install later with `doc2md install-converter` |
| Korean writing guidance | on when the locale is Korean (asked at a terminal) | `korean off`, `CTS_NO_KOREAN=1` |
| compact-window warning chip | on | `compact-window off` |
| Update-available chip | on | `CTS_NO_UPDATE_CHECK=1` |
| **Pinning compact-window** (`autoCompactWindow` 500k) | **off — run it yourself** | `compact-window set --global` or `--project` |
| **Model-fitting rules** (`ratchet-model.md` delegations) | **candidates are proposed only** | review and approve with `route-scan rules` |
| `handoff` (back up work before a cap) | an on-demand command | n/a |

`compact-window set` writes into Claude Code's `settings.json` and a human has to choose global or project scope, so it is never run for you. Model-fitting rules keep an approval step for the same reason: which work belongs on a cheaper tier is your call.

---
