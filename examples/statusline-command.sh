#!/bin/sh
# Claude Code statusline (POSIX sh — works on macOS, Linux, and WSL)
# Prints "user@host:cwd" then appends sprag as a second segment.
#
# Install:
#   1) npm install -g sprag-cli
#   2) Save this file as: ~/.claude/statusline-command.sh
#      chmod +x ~/.claude/statusline-command.sh  (optional)
#   3) In ~/.claude/settings.json:
#      {
#        "statusLine": {
#          "type": "command",
#          "command": "bash ~/.claude/statusline-command.sh",
#          "refreshInterval": 1
#        }
#      }
#
# refreshInterval keeps the TTL countdown ticking while you're idle.
# Drop to 2 or 5 if you want lower local CPU.

input=$(cat)

# Extract cwd without jq dependency (jq may not be installed system-wide).
cwd=$(echo "$input" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
cwd=${cwd:-$(pwd)}

# 1) user@host:cwd
printf '\033[01;32m%s@%s\033[00m:\033[01;34m%s\033[00m' "$(whoami)" "$(hostname -s)" "$cwd"

# 2) cache monitor (appended). Separator " | ". Falls back silently.
printf ' \033[90m|\033[00m '
# `claude-token-saver` is the older binary name, still installed by the current
# package; the npx fallback names `sprag-cli`, since the old package name is
# deprecated on npm and would fetch a version that stopped receiving releases.
if command -v sprag >/dev/null 2>&1; then
  sprag --statusline --icon 2>/dev/null || true
elif command -v claude-token-saver >/dev/null 2>&1; then
  claude-token-saver --statusline --icon 2>/dev/null || true
else
  npx --yes sprag-cli@latest --statusline --icon 2>/dev/null || true
fi
