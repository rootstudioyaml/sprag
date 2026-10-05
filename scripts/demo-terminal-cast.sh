#!/usr/bin/env bash
# Drive the 2b "new-features" demo for screen recording.
# Usage:
#   bash scripts/demo-terminal-cast.sh
#
# What it does (with paced delays the user sees on camera):
#   1. clears screen, prints a small banner
#   2. seeds the history file with two warning transitions + one resolved
#      (so `history` has something interesting to render)
#   3. runs `claude-token-saver install` (skill + slash command)
#   4. runs `claude-token-saver history` (recent transitions)
#   5. prints a hand-off line telling the recorder to switch to Claude Code
#      and type `/token-monitor`
#
# Re-runnable. Idempotent. Reset history first if you want a clean slate:
#   rm -f ~/.config/claude-token-saver/history/*.md ~/.config/claude-token-saver/last-chip.json

set -e

P() { sleep "$1"; }       # pause shorthand for legibility
hr() { printf '\033[90m%s\033[0m\n' "─────────────────────────────────────────────────────────"; }

clear
printf '\033[1;36m▶ claude-token-saver — install · history · /token-monitor\033[0m\n'
hr
P 1.5

# 1) Install — writes skill + slash command
printf '\033[33m$ claude-token-saver install\033[0m\n'
P 0.7
claude-token-saver install
P 2.5

hr
P 1

# 2) Seed history with realistic transitions for the demo (no-op if it already
# has events; the dedupe state lives in last-chip.json)
CHECKOUT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node -e "
import('claude-token-saver/src/history.js').then(({ recordChip }) => {
  recordChip('⚠ 1M ON', { detail: 'Context auto-promoted to 1M (max single-request 280k tokens)' });
  recordChip('⚠ Cache miss', { detail: 'session abc12345: LOW_HIT_RATE, FREQUENT_CACHE_REBUILD' });
  recordChip(null);
}).catch(() => {
  // Fallback: the checkout this script lives in, if the global package isn't found
  import(process.argv[1]).then(({ recordChip }) => {
    recordChip('⚠ 1M ON', { detail: 'Context auto-promoted to 1M (max single-request 280k tokens)' });
    recordChip('⚠ Cache miss', { detail: 'session abc12345: LOW_HIT_RATE, FREQUENT_CACHE_REBUILD' });
    recordChip(null);
  });
});
" "$CHECKOUT/src/history.js" 2>/dev/null || true

# 3) History — show the auto-captured chip transitions
printf '\033[33m$ claude-token-saver history --days 1\033[0m\n'
P 0.7
claude-token-saver history --days 1
P 3

hr
P 0.8

# 4) Hand-off card for /token-monitor (recorder switches to Claude Code window)
printf '\033[1;32mNext:\033[0m  open Claude Code in any project and type \033[1;36m/token-monitor\033[0m\n'
printf '       the slash command runs `history` + a fresh report and summarizes both.\n'
P 4
