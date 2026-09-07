#!/usr/bin/env bash
# Submit the project page to IndexNow (Bing, Yandex, Seznam, Naver).
#
# IndexNow verifies ownership with a key file served from the same host, so this
# needs no console account and no human step — unlike Google Search Console,
# which has no submission API for a domain you cannot verify interactively.
# Google ignores IndexNow, so this covers the other engines only.
#
# Run this AFTER GitHub Pages is live, otherwise the key file 404s and the
# submission is rejected.
set -euo pipefail

KEY=b8be2d3d02883e4df4ee28725d5fe8b3
HOST=rootstudioyaml.github.io
BASE="https://$HOST/claude-token-saver"

echo "Checking that the key file is reachable..."
if ! curl -sf "$BASE/$KEY.txt" > /dev/null; then
  echo "Key file not reachable at $BASE/$KEY.txt — is Pages deployed yet?" >&2
  exit 1
fi

echo "Submitting $BASE/ ..."
code=$(curl -s -o /dev/null -w '%{http_code}' \
  "https://api.indexnow.org/indexnow?url=$BASE/&key=$KEY&keyLocation=$BASE/$KEY.txt")

echo "IndexNow responded $code"
case "$code" in
  200|202) echo "Accepted." ;;
  *) echo "Not accepted — see https://www.indexnow.org/documentation for the code meaning." >&2; exit 1 ;;
esac
