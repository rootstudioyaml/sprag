# Sprag tour video

A 90 second product tour of the Sprag dashboards in two languages, played on the hidden page `site/tour/`
(not linked from any nav, not in `sitemap.xml`, `noindex`). No narration: captions and music only.
No Sprag revenue appears anywhere (the town is recorded with `norev=1`).

## Files

| Path | What |
|---|---|
| `index.html` | HyperFrames composition template (1920x1080, 30 fps, 90 s). `__LANG__` is replaced per language; captions for both languages live in it. |
| `recorder/record.mjs` | Records every shot from the demo pages with puppeteer-core and the system Chrome. |
| `recorder/package.json` | Pins `puppeteer-core` 25.14.0 (`cd recorder && npm i`, or set `TOUR_NODE_MODULES` to an existing `node_modules`). |
| `build.sh` | Record, render, music and loudness, verify, copy to `site/tour/`. |
| `clips/<lang>/*.mp4` | Recorded clips (gitignored). |
| `out/` | Build folders, `sprag-tour-<lang>.mp4`, `poster-<lang>.jpg` (gitignored). |

## Build

```sh
node scripts/serve-site.mjs 8788          # the site server, from the repo root
cd video/tour/recorder && npm i && cd ..  # once
./build.sh                                # both languages; LANGS=ko for one, SKIP_RECORD=1 to reuse clips, BGM=none for no music
```

Recording takes a few minutes per language, the render about as long. Run one build at a time.

## How the clips are recorded

- Pages are opened in demo mode with `?demo=1&rec=1`; `/ops` also gets `&norev=1` and `tod=` / `wx=` so the town never
  asks Open-Meteo (the recorder also blocks that host). With `rec=1` the pages put the scene handles on
  `window.__sprag = { town, office }`; each handle has `view.setPose({th, ph, zoom, x, z})`, `ready()`,
  `orgs()` / `people()` / `server()` and `selectOrg(id)` / `selectPerson(id)` / `closeDrawer()`.
  In the team console `rec=1` also keeps rules added through the form for the session, so the Rules shot is the real form.
- Time is CDP virtual time: each frame advances the page clock by exactly 1/30 s and then takes a screenshot, so
  animation runs at a true 30 fps however slow the capture is. `Math.random` is seeded and the clock starts at
  2026-10-18 12:00 KST. A 1 px WebGL canvas cleared every frame keeps Chrome producing compositor frames on still pages
  (without it, screenshots on a page with no animation never return under paused virtual time).
- The viewport is 1280x720 at device scale 1.5, so screenshots are 1920x1080 and the dashboard text reads at video size.
  Scene shots put the scene card in its full-window overlay and hide the zoom buttons. The mouse is never drawn.
- Camera moves are keyframed poses eased per frame; the day/night clips are slices of one camera path, so the crossfades line up.

## Timeline

| t (s) | Shot | KO caption | EN caption |
|---|---|---|---|
| 0-8 | town at night in rain, zoom out from the HQ, saving counter | AI 비용이 어디로 가는지, 이제 보입니다 | See where your team's AI spend really goes |
| 8-20 | a company's drawer, then its office | 표 대신, 걸어 들어가는 대시보드 | Not a spreadsheet. A dashboard you walk into |
| 20-38 | lion, orbit, bots to the server, chick with coffee | AI 파워 유저부터 이제 막 시작한 사람까지 | From AI power users to those just getting started |
| 38-50 | person card, model mix, daily chart | 비용, 절감, 맡긴 모델까지 사람마다 한 장 | Spend, savings and model mix, one card per person |
| 50-64 | KPI cards and range rail, seat movement, Cmd+K | 기간별로 비교하고, 좌석 변동까지 한눈에 | Compare any period, see every seat change |
| 64-76 | add a model rule, then `sprag team rules` in a terminal | 라우팅 규칙은 중앙에서 한 번, 모든 PC에 자동으로 | Set routing rules once, every machine follows |
| 76-84 | dawn, day, dusk, snowy night | 매일 들어오고 싶은 대시보드 | A dashboard you'll actually want to open |
| 84-90 | logo, closing line, sprag.io | AI를 쓰는 팀의 관리, Sprag가 가볍게 만듭니다 | Sprag makes managing AI teams light work |

Cuts are 0.45 s crossfades. Captions are 42 px Noto Sans KR 700 on a dark pill, 96 px above the bottom edge.

## Audio and output

The music (`deeppulse-main.mp3`, the owner's track) starts at 15.05 s because the file opens with 15 s of silence.
`build.sh` mixes it with ffmpeg rather than an `<audio>` element (HyperFrames muxes `<audio>` correctly, checked with a
3 s test, but a volume envelope is simpler in ffmpeg): 0.5 under the hook, 0.3 under the body, 0.5 for the close,
1 s fade in, 2 s fade out, then a 2-pass `loudnorm` to -14 LUFS, -1 dBTP, LRA 11. Video is H.264 yuv420p, 2-pass at
1050 kbit/s so each file stays under 15 MB, AAC 48 kHz 192 kbit/s, `+faststart`. The poster is the frame at 2 s.
`build.sh` fails if a file is over 15 MB or has a one-frame luma drop (a blank frame).
