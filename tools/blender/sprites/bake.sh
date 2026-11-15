#!/bin/bash
# usage: bake.sh WORK plain <species:variant,...> [--force] [--full]
#        bake.sh WORK card  <species,...|all> [--force]
# One Blender (Cycles) process; run batches one after another, never two at once.
# No exec: the last line records the Blender exit code. BLENDER overrides the Blender binary.
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$1"; MODE="$2"; JOBS="$3"; shift 3
B="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
F='INFO\|DracoDecoder\|Deprecat\|use_nodes\|Saved:'
case "$MODE" in
  plain) "$B" -b --factory-startup --python "$HERE/bake_sprites.py" -- bake "$JOBS" --work "$WORK" "$@" 2>&1 | grep --line-buffered -v "$F"; RC=${PIPESTATUS[0]} ;;
  card)  "$B" -b --factory-startup --python "$HERE/bake_card.py" -- card "$JOBS" --work "$WORK" "$@" 2>&1 | grep --line-buffered -v "$F"; RC=${PIPESTATUS[0]} ;;
  *) echo "mode must be plain or card"; RC=2 ;;
esac
echo "EXIT=${RC} $(date +%H:%M:%S)"
