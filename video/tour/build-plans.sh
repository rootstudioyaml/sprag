#!/usr/bin/env bash
# Builds the 30 s plan promos (Pro and Enterprise) for the pricing page: record clips -> HyperFrames render ->
# music and loudness -> verify -> copy to site/assets/video/plan-<plan>-<lang>.{mp4,jpg}.
#
#   video/tour/build-plans.sh                    # both plans, both languages, record everything
#   PLANS=ent LANGS=ko video/tour/build-plans.sh # one plan, one language
#   SKIP_RECORD=1 video/tour/build-plans.sh      # reuse clips/<lang>/*.mp4
#   BGM=none video/tour/build-plans.sh           # no music
#
# Same needs as build.sh: the site server on :8788, ffmpeg/ffprobe, Node 22+, the system Chrome, puppeteer-core in
# recorder/node_modules. Run one build at a time, never two renders in parallel.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
cd "$HERE"

PLANS="${PLANS:-pro ent}"
LANGS="${LANGS:-ko en}"
BGM="${BGM:-$HOME/projects/yaml-sns-agent/public/audio/main/deeppulse-main.mp3}"
DUR=30
BGM_START="${BGM_START:-15.05}"   # the track opens with 15 s of silence
VBITRATE="${VBITRATE:-1400k}"     # 2-pass target: 30 s x (1400k video + 192k audio) is about 6 MB
HF=(npx --yes hyperframes@0.8.133)
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_UPDATE_CHECK=1
shots_pro=pro-office,pro-person,team-kpi,team-rules
shots_ent=ent-office,ent-usage,ent-person,ent-policy

curl -sf -o /dev/null http://localhost:8788/ || { echo "site server is not running on :8788"; exit 1; }
mkdir -p out

NO_BGM=0
if [ "$BGM" = none ]; then
  NO_BGM=1
  echo "music: none (BGM=none), the videos carry no audio track"
else
  [ -f "$BGM" ] || { echo "music not found: $BGM"; exit 1; }
  # 0.5 under the opening shot, 0.3 under the body, back to 0.5 for the close; 1 s fade in, 2 s fade out
  VOL="if(lt(t,7),0.5,if(lt(t,8),0.5-0.2*(t-7),if(lt(t,24),0.3,if(lt(t,25),0.3+0.2*(t-24),0.5))))"
  ffmpeg -hide_banner -loglevel error -y -i "$BGM" -af "atrim=$BGM_START:$(echo "$BGM_START + $DUR" | bc),asetpts=PTS-STARTPTS,volume='$VOL':eval=frame,afade=t=in:d=1,afade=t=out:st=$((DUR-2)):d=2" \
    -ar 48000 -ac 2 out/bgm-plans.wav
  LN=$(ffmpeg -hide_banner -nostats -i out/bgm-plans.wav -af "loudnorm=I=-14:TP=-1:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
  j() { echo "$LN" | sed -n "s/.*\"$1\" : \"\([^\"]*\)\".*/\1/p"; }
  # measured against -1 dBTP, applied with -2: the limiter plus the AAC encode overshoot about 0.7 dB (see build.sh)
  AF="loudnorm=I=-14:TP=-2:LRA=11:measured_I=$(j input_i):measured_TP=$(j input_tp):measured_LRA=$(j input_lra):measured_thresh=$(j input_thresh):offset=$(j target_offset):linear=true"
fi

for P in $PLANS; do
  case "$P" in pro) SHOTS="$shots_pro";; ent) SHOTS="$shots_ent";; *) echo "unknown plan $P"; exit 2;; esac
  for L in $LANGS; do
    echo "== $P $L =="
    [ "${SKIP_RECORD:-0}" = 1 ] || node recorder/record.mjs --lang "$L" --shots "$SHOTS"
    B="out/plan-$P-$L"
    rm -rf "$B"; mkdir -p "$B/clips"
    sed "s/__LANG__/$L/" "plans/$P.html" > "$B/index.html"
    cp plans/plan.css plans/plan.js "$B/"
    for s in ${SHOTS//,/ }; do cp -L "clips/$L/$s.mp4" "$B/clips/"; done
    "${HF[@]}" lint "$B"
    "${HF[@]}" render "$B" --fps 30 -q delivery --resolution landscape --video-frame-format png -o "$HERE/$B/video.mp4"

    OUTF="out/plan-$P-$L.mp4"
    ( cd "$B" && ffmpeg -hide_banner -loglevel error -y -i video.mp4 -an -c:v libx264 -preset slow -b:v "$VBITRATE" -pass 1 -passlogfile x264 -pix_fmt yuv420p -f mp4 /dev/null )
    if [ "$NO_BGM" = 1 ]; then
      ( cd "$B" && ffmpeg -hide_banner -loglevel error -y -i video.mp4 -an -c:v libx264 -preset slow -b:v "$VBITRATE" -pass 2 -passlogfile x264 \
          -pix_fmt yuv420p -r 30 -t $DUR -movflags +faststart "../plan-$P-$L.mp4" )
    else
      ( cd "$B" && ffmpeg -hide_banner -loglevel error -y -i video.mp4 -i ../bgm-plans.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -preset slow -b:v "$VBITRATE" -pass 2 -passlogfile x264 \
          -pix_fmt yuv420p -r 30 -af "$AF" -c:a aac -b:a 192k -ar 48000 -t $DUR -movflags +faststart "../plan-$P-$L.mp4" )
    fi
    ffmpeg -hide_banner -loglevel error -y -ss 0.25 -i "$OUTF" -frames:v 1 -q:v 3 "out/plan-$P-$L.jpg"

    # verify: format, loudness, blank frames (a sudden drop of mean luma), size
    ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,bit_rate -show_entries format=duration,size -of compact "$OUTF"
    if [ "$NO_BGM" = 0 ]; then
      EB=$(ffmpeg -hide_banner -nostats -i "$OUTF" -af ebur128=peak=true -f null - 2>&1)
      LUFS=$(echo "$EB" | grep -E '^\s+I:' | tail -1 | awk '{print $2}'); TP=$(echo "$EB" | grep -A1 'True peak:' | grep 'Peak:' | tail -1 | awk '{print $2}')
      echo "loudness $LUFS LUFS, true peak $TP dBTP"
      awk -v i="$LUFS" -v p="$TP" 'BEGIN{ exit !(i > -15 && i < -13 && p <= -1.0) }' || { echo "loudness out of range"; exit 1; }
    fi
    ffmpeg -hide_banner -loglevel error -i "$OUTF" -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=out/yavg-plan-$P-$L.txt" -f null -
    node -e '
      const v = require("fs").readFileSync(process.argv[1], "utf8").match(/YAVG=([\d.]+)/g).map(s => +s.slice(5));
      let drops = 0; for (let i = 1; i < v.length - 1; i++) if (v[i] < v[i - 1] * 0.5 && v[i] < v[i + 1] * 0.5) drops++;
      console.log(`frames ${v.length}, min YAVG ${Math.min(...v).toFixed(1)}, sudden one-frame drops ${drops}`); if (drops) process.exit(1);' "out/yavg-plan-$P-$L.txt"
    SIZE=$(stat -f %z "$OUTF"); [ "$SIZE" -le 8000000 ] || { echo "too big: $SIZE bytes"; exit 1; }

    mkdir -p "$REPO/site/assets/video"
    cp "$OUTF" "$REPO/site/assets/video/plan-$P-$L.mp4"; cp "out/plan-$P-$L.jpg" "$REPO/site/assets/video/plan-$P-$L.jpg"
    echo "$P $L done: $OUTF ($SIZE bytes)"
  done
done
