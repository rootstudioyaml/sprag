# Blender 도구

## 캐스트 썸네일 아틀라스 (`render_thumbs.py`)

동물 캐스트의 선 자세 모델(`site/assets/scene/cast/<key>-pose.glb`)을 렌더해 썸네일 아틀라스 한 장을 만듭니다. 범례 줄과 도감, 서랍 헤더, 타운 서랍의 동물 분포가 이 아틀라스를 씁니다(`speciesThumb` in `site/assets/scene/office-scene.js`).

Blender 버전은 5.2.3으로 고정합니다. 버전이 바뀌면 조명과 디노이즈 결과가 달라질 수 있습니다.

```sh
npm run blender:thumbs
# 같은 명령
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/blender/render_thumbs.py -- --out /tmp/sprag-thumbs
```

옵션은 다음과 같습니다.

- `--only cat,dog`: 지정한 종만 렌더합니다. 아틀라스는 쓰지 않습니다.
- `--samples 96`: Cycles 샘플 수입니다.
- `--device auto|cpu|gpu`: 기본값 auto는 METAL GPU가 있으면 GPU를 씁니다.
- `--webp <경로>`: 아틀라스 출력 경로입니다. 기본값은 `site/assets/scene/cast/atlas.webp`입니다.

M2 Max GPU에서 31종을 렌더하는 데 약 24초가 걸립니다.

### 칸 순서

칸 순서는 `src/office-species.js`의 `row('<key>'` 순서(GRADES 30종)를 따르고 마지막에 `ghost`를 붙여 31칸입니다. 스크립트는 이 순서를 파일에서 읽으므로 종을 더하거나 순서를 바꾸면 아틀라스를 다시 렌더해야 합니다. 사이트의 `GRADES`도 같은 순서여야 하며 `test/scene-atlas.test.js`가 두 순서를 비교합니다.

### 아틀라스 규격

- 8열 4행이고 칸 하나는 160×160입니다. 전체는 1280×640이고 배경은 투명합니다.
- 칸 i는 열 `i % 8`, 행 `floor(i / 8)`에 놓입니다. 32번째 칸은 비워 둡니다.
- 종마다 320×320으로 렌더한 뒤 절반으로 줄여 넣습니다.
- WebP는 250KB 이하가 되는 가장 높은 품질로 인코딩합니다. 인코딩에는 `cwebp`가 필요합니다(`brew install webp`).
