#!/usr/bin/env bash
# Submit every sprag.io URL in site/sitemap.xml to IndexNow (Bing, Yandex,
# Seznam, Naver).
#
# IndexNow verifies ownership with a key file served from the same host, so this
# needs no console account and no human step. Google ignores IndexNow, so this
# covers the other engines only.
#
# Run this AFTER the site is deployed, otherwise the key file or new pages 404
# and the submission is rejected.
set -euo pipefail

KEY=b8be2d3d02883e4df4ee28725d5fe8b3
HOST=sprag.io
BASE="https://$HOST"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Checking that the key file is reachable..."
if ! curl -sf "$BASE/$KEY.txt" > /dev/null; then
  echo "Key file not reachable at $BASE/$KEY.txt; is the site deployed yet?" >&2
  exit 1
fi

urls=$(grep -o '<loc>[^<]*' "$ROOT/site/sitemap.xml" | sed 's/<loc>//' | node -e \
  'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.stringify(d.trim().split("\n"))))')
echo "Submitting $(node -e "console.log(JSON.parse(process.argv[1]).length)" "$urls") URLs..."

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST 'https://api.indexnow.org/indexnow' \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"host\":\"$HOST\",\"key\":\"$KEY\",\"keyLocation\":\"$BASE/$KEY.txt\",\"urlList\":$urls}")

echo "IndexNow responded $code"
case "$code" in
  200|202) echo "Accepted." ;;
  *) echo "Not accepted; see https://www.indexnow.org/documentation for the code meaning." >&2; exit 1 ;;
esac
