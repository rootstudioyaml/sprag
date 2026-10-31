#!/usr/bin/env bash
# Builds the 37 s v3.90.0 explainer (usage-limit pressure and the new savings basis), pure HTML and GSAP, no recording:
# HyperFrames render -> music and loudness -> verify -> copy to site/assets/video/sprag-explain-<lang>.{mp4,jpg}
# and cut the README GIF docs/sprag-explain-<lang>.gif.
#
#   video/tour/build-explain.sh               # both languages
#   LANGS=ko video/tour/build-explain.sh      # one language
#   BGM=none video/tour/build-explain.sh      # no music
#   SKIP_RENDER=1 video/tour/build-explain.sh # reuse out/explain-<lang>/video.mp4, redo music, checks and copies
#
# Needs ffmpeg/ffprobe, Node 22+, the system Chrome, and network for the Google Fonts and GSAP CDN links in the template
# (same as build-plans.sh). Run one build at a time, never two renders in parallel.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
cd "$HERE"

LANGS="${LANGS:-ko en}"
BGM="${BGM:-$HOME/projects/yaml-sns-agent/public/audio/main/deeppulse-main.mp3}"
DUR=37
BGM_START="${BGM_START:-15.05}"   # the track opens with 15 s of silence
VBITRATE="${VBITRATE:-1400k}"     # 2-pass target: 37 s x (1400k video + 192k audio) is about 7.4 MB
POSTER_AT="${POSTER_AT:-3.2}"     # the hook with its headline fully shown
HF=(npx --yes hyperframes@0.8.133)
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_UPDATE_CHECK=1

mkdir -p out

NO_BGM=0
if [ "$BGM" = none ]; then
  NO_BGM=1
  echo "music: none (BGM=none), the videos carry no audio track"
else
  [ -f "$BGM" ] || { echo "music not found: $BGM"; exit 1; }
  # 0.5 under the hook, 0.3 under the body, back to 0.5 for the close; 1 s fade in, 2 s fade out
  VOL="if(lt(t,3.5),0.5,if(lt(t,4.5),0.5-0.2*(t-3.5),if(lt(t,32),0.3,if(lt(t,33),0.3+0.2*(t-32),0.5))))"
  ffmpeg -hide_banner -loglevel error -y -i "$BGM" -af "atrim=$BGM_START:$(echo "$BGM_START + $DUR" | bc),asetpts=PTS-STARTPTS,volume='$VOL':eval=frame,afade=t=in:d=1,afade=t=out:st=$((DUR-2)):d=2" \
    -ar 48000 -ac 2 out/bgm-explain.wav
  LN=$(ffmpeg -hide_banner -nostats -i out/bgm-explain.wav -af "loudnorm=I=-14:TP=-1:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
  j() { echo "$LN" | sed -n "s/.*\"$1\" : \"\([^\"]*\)\".*/\1/p"; }
  # measured against -1 dBTP, applied with -2 plus a 0.72 sample-peak limiter: this track is dynamic (crest about 9 dB), so
  # without the limiter the AAC encode landed at -0.7 dBTP, over the -1.0 limit; with it the file measures -1.4 dBTP
  AF="loudnorm=I=-14:TP=-2:LRA=11:measured_I=$(j input_i):measured_TP=$(j input_tp):measured_LRA=$(j input_lra):measured_thresh=$(j input_thresh):offset=$(j target_offset):linear=true,alimiter=limit=0.72:level=disabled"
fi

for L in $LANGS; do
  echo "== explain $L =="
  B="out/explain-$L"
  if [ "${SKIP_RENDER:-0}" != 1 ]; then
    rm -rf "$B"; mkdir -p "$B"
    sed "s/__LANG__/$L/" explain/sprag-explain.html > "$B/index.html"
    "${HF[@]}" lint "$B"
    "${HF[@]}" render "$B" --fps 30 -q delivery --resolution landscape --video-frame-format png -o "$HERE/$B/video.mp4"
  fi

  OUTF="out/sprag-explain-$L.mp4"
  ( cd "$B" && ffmpeg -hide_banner -loglevel error -y -i video.mp4 -an -c:v libx264 -preset slow -b:v "$VBITRATE" -pass 1 -passlogfile x264 -pix_fmt yuv420p -f mp4 /dev/null )
  if [ "$NO_BGM" = 1 ]; then
    ( cd "$B" && ffmpeg -hide_banner -loglevel error -y -i video.mp4 -an -c:v libx264 -preset slow -b:v "$VBITRATE" -pass 2 -passlogfile x264 \
        -pix_fmt yuv420p -r 30 -t $DUR -movflags +faststart "../sprag-explain-$L.mp4" )
  else
    ( cd "$B" && ffmpeg -hide_banner -loglevel error -y -i video.mp4 -i ../bgm-explain.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -preset slow -b:v "$VBITRATE" -pass 2 -passlogfile x264 \
        -pix_fmt yuv420p -r 30 -af "$AF" -c:a aac -b:a 192k -ar 48000 -t $DUR -movflags +faststart "../sprag-explain-$L.mp4" )
  fi
  ffmpeg -hide_banner -loglevel error -y -ss "$POSTER_AT" -i "$OUTF" -frames:v 1 -q:v 3 "out/sprag-explain-$L.jpg"

  # verify: format, loudness, blank frames (a sudden drop of mean luma), size
  ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,bit_rate -show_entries format=duration,size -of compact "$OUTF"
  if [ "$NO_BGM" = 0 ]; then
    EB=$(ffmpeg -hide_banner -nostats -i "$OUTF" -af ebur128=peak=true -f null - 2>&1)
    LUFS=$(echo "$EB" | grep -E '^\s+I:' | tail -1 | awk '{print $2}'); TP=$(echo "$EB" | grep -A1 'True peak:' | grep 'Peak:' | tail -1 | awk '{print $2}')
    echo "loudness $LUFS LUFS, true peak $TP dBTP"
    awk -v i="$LUFS" -v p="$TP" 'BEGIN{ exit !(i > -15 && i < -13 && p <= -1.0) }' || { echo "loudness out of range"; exit 1; }
  fi
  ffmpeg -hide_banner -loglevel error -i "$OUTF" -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=out/yavg-explain-$L.txt" -f null -
  node -e '
    const v = require("fs").readFileSync(process.argv[1], "utf8").match(/YAVG=([\d.]+)/g).map(s => +s.slice(5));
    let drops = 0; for (let i = 1; i < v.length - 1; i++) if (v[i] < v[i - 1] * 0.5 && v[i] < v[i + 1] * 0.5) drops++;
    console.log(`frames ${v.length}, min YAVG ${Math.min(...v).toFixed(1)}, sudden one-frame drops ${drops}`); if (drops) process.exit(1);' "out/yavg-explain-$L.txt"
  SIZE=$(stat -f %z "$OUTF"); [ "$SIZE" -le 8000000 ] || { echo "too big: $SIZE bytes"; exit 1; }

  mkdir -p "$REPO/site/assets/video" "$REPO/docs"
  cp "$OUTF" "$REPO/site/assets/video/sprag-explain-$L.mp4"; cp "out/sprag-explain-$L.jpg" "$REPO/site/assets/video/sprag-explain-$L.jpg"

  # README GIF: width 760 like docs/sprag-compare-<lang>.gif (1.6 to 1.8 MB), so 6 fps and 64 colours to stay under 1.6 MB
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "$OUTF" -vf "fps=${GIF_FPS:-6},scale=760:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${GIF_COLORS:-64}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
    -loop 0 "$REPO/docs/sprag-explain-$L.gif"
  GSIZE=$(stat -f %z "$REPO/docs/sprag-explain-$L.gif")
  [ "$GSIZE" -le 1600000 ] || { echo "gif too big: $GSIZE bytes"; exit 1; }
  echo "$L done: $OUTF ($SIZE bytes), gif $GSIZE bytes"
done
