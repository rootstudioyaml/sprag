# Security policy

## Supported versions

Only the latest minor release of `sprag-cli` receives security fixes. At the
time of writing that is the 3.67 line. If you are on an older minor, upgrade
first with `npm i -g sprag-cli@latest` and check whether the problem is still
there.

The old package name `claude-token-saver` stopped receiving updates at 3.55.0
and is not supported.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Report it privately
through GitHub's private vulnerability reporting:

<https://github.com/rootstudioyaml/sprag/security/advisories/new>

Include the Sprag version (`sprag --version`), your OS, the Claude Code or Codex
version, and the steps to reproduce. A proof of concept helps, but a clear
description is enough. You will get an acknowledgement in the advisory thread,
and a fix or a reasoned "not a vulnerability" answer there as well. For anything
that is not a vulnerability, use the
[issue tracker](https://github.com/rootstudioyaml/sprag/issues).

## What counts as a vulnerability

Sprag runs on your machine and edits files in your home directory. It writes
hooks and a statusline entry into `~/.claude/settings.json`, writes rule and
agent files under `~/.claude`, and reads the session logs that Claude Code and
Codex already keep. So the scope that matters is what those hooks and files can
be made to do. We treat these as vulnerabilities:

- A hook, installer or command that runs attacker-chosen code or shell
  commands, for example through a crafted session log, file name, settings
  value or release body.
- A write outside the files Sprag owns, or one that overwrites or deletes user
  settings, hooks or rules it did not create. `sprag uninstall` is expected to
  restore what the install changed.
- Leaking session content, credentials or environment values to a third party.
  Analysis is local; the only network calls are the npm and GitHub release
  lookups for upgrades and, if you configure it, your own LiteLLM endpoint.
- A way to make a hook silently weaken or bypass your existing Claude Code
  permission settings.

These are not vulnerabilities: problems that need an attacker who can already
write to your home directory, behaviour you enabled on purpose (for example a
custom hook you added next to Sprag's), and bugs in Claude Code, Codex or npm
themselves. Report those to their own projects.
