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

## 캐스트 머리 들기 (`lift_heads.py`)

2026-11-11에 사무실 배치를 바꿔 동물이 카메라를 보고 앉게 했습니다. 카메라는 약 30도 위에서 내려다보는데 모델은 머리를 숙이고 있어서 화면에 이마와 정수리가 많이 보였습니다. 이 스크립트는 목 높이 위 정점을 X축으로 들어 올려 얼굴이 보이게 합니다. 목 구간은 부드럽게 섞고 노멀도 같은 각도로 돌립니다. 텍스처와 UV와 재질은 건드리지 않습니다.

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/blender/lift_heads.py -- <원본 폴더> <출력 폴더> cat,dog 18
```

- 마지막 인자는 각도이고 기본값은 18도입니다. 지금 저장소의 glb 60개는 이 값을 한 번 적용한 결과이므로 같은 파일에 다시 돌리면 머리가 두 번 들립니다.
- 앉은 자세는 눈 하이라이트(`white` 재질) 위치에서 목 높이를 구합니다. 선 자세(`-pose`)는 눈을 감아 하이라이트가 없으므로 같은 종 앉은 자세의 값을 환경변수 `ZE`와 `U`로 넘깁니다.
- 원래 생성기(`chibi_blender_v54.py`)는 임시 폴더에만 있다가 사라졌습니다. 모델을 고칠 때는 glb를 직접 불러와 고치는 이 방식을 씁니다.
- 고친 뒤에는 `npm run blender:thumbs`로 아틀라스를 다시 만듭니다.

## 캐스트 슬리버 면 지우기 (`fix_slivers.py`)

원래 생성기가 목도리(`acc_nks_c1`)의 정점 하나를 멀리 보내서 귀까지 이어지는 가는 면이 생긴 모델이 있습니다. 여우 선 자세 모델에서는 렌더에 목도리에서 왼쪽 귀로 올라가는 파란 선으로 보였습니다. 이 스크립트는 glb를 불러와 그런 면만 지우고 어느 면에도 쓰이지 않는 정점도 함께 지운 뒤 `lift_heads.py`와 같은 설정(Draco, 텍스처 포함)으로 다시 내보냅니다.

```sh
# 검사만(파일을 쓰지 않음)
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/blender/fix_slivers.py -- site/assets/scene/cast - all
# 고쳐서 다른 폴더에 저장
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/blender/fix_slivers.py -- <원본 폴더> <출력 폴더> fox,fox-pose,penguin,penguin-pose
```

- 판정은 재질마다 따로 합니다. 면의 가장 긴 모서리가 그 재질 면의 99퍼센타일 2배를 넘고 동시에 0.25를 넘는 면만 지웁니다. 인자로 `ratio`와 `min`을 바꿀 수 있습니다(기본값 2와 0.25).
- 2026-11-12에 60개를 훑은 결과는 여우 두 파일(5면씩)과 펭귄 두 파일(3면씩)입니다. 큰 평면 같은 보통 면은 0.21 이하라 걸리지 않았습니다.
- 임계값을 3배로 잡으면 앉은 자세 여우(가장 긴 모서리 0.275, 99퍼센타일 0.102)를 놓칩니다. 그래서 2배를 씁니다.
- 지운 면이 보이던 부분은 렌더로 확인합니다. 펭귄은 머리 안쪽에 묻혀 있어 어느 각도의 렌더에서도 눈에 띄지 않았습니다.
- 고친 뒤에는 이름, 재질 수, 텍스처 이미지, 파일 크기(±10%)가 그대로인지 확인하고 `CAST_Q`를 올리십시오. 파일이 바뀐 종은 털 스프라이트와 프로필 카드도 다시 굽습니다.
- 같은 파일에 다시 돌려도 안전합니다. 지울 면이 없으면 파일을 쓰지 않습니다.

## 캐스트 착용물 지우기 (`strip_wear.py`)

2026-11-15부터 멤버가 상점에서 착용물을 직접 고릅니다. 그래서 원래 생성기가 모델에 구워 넣은 착용물을 모두 지웠습니다. 모자, 비니, 리본, 헤드폰, 반다나, 나비넥타이, 목도리, 안경, 이마에 올린 선글라스, 후드, 금목걸이와 펜던트, 귀 장식이 여기에 해당합니다. 이 스크립트는 glb를 불러와 착용물 재질의 면을 지우고, 어느 면에도 쓰이지 않게 된 정점과 비어 버린 재질 칸도 함께 없앤 뒤 `fix_slivers.py`와 같은 설정(Draco, 텍스처 포함)으로 다시 내보냅니다.

```sh
# 검사만(파일을 쓰지 않음)
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/blender/strip_wear.py -- site/assets/scene/cast - all
# 지워서 다른 폴더에 저장
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/blender/strip_wear.py -- <원본 폴더> <출력 폴더> all
```

- 착용물은 `face` 메시에 있고 재질 이름이 `acc_`로 시작합니다. 이 이름 규칙을 벗어난 착용물이 있으면 스크립트의 `EXTRA` 목록에 재질 이름을 그대로 적습니다. 2026-11-15에 62개를 렌더로 확인했을 때는 규칙을 벗어난 착용물이 없었습니다.
- 셔츠와 셔츠 줄무늬, 로고 배지는 옷이라서 남깁니다. 뿔, 갈기, 부리, 꼬리, 날개, 가시처럼 몸에 붙은 부분도 남깁니다. 왕관과 명절 모자는 실행 중에 붙이므로 파일에 없습니다.
- 검사만 할 때는 파일마다 재질 이름과 면 수, 지울지 여부를 한 줄씩 출력합니다. 마지막 줄이 `CLEAN <이름> 0`이면 지울 면이 없다는 뜻입니다.
- 몸통 메시 `chibi`의 정점과 UV, 텍스처는 바뀌지 않습니다. 고친 뒤에는 원본과 결과를 다시 불러와 `chibi`의 정점 수와 범위, UV, 텍스처 바이트가 같은지 확인했습니다.
- 착용물을 지운 부분은 정면 사선과 뒤통수 위 두 각도의 전후 렌더로 확인합니다. 사무실 카메라가 약 30도 위에서 내려다보므로 머리 위쪽이 특히 중요합니다.
- 같은 파일에 다시 돌려도 안전합니다. 지울 면이 없으면 파일을 쓰지 않습니다. 고친 뒤에는 `npm run blender:thumbs`로 아틀라스를 다시 만들고 `CAST_Q`를 올립니다. 털 스프라이트와 프로필 카드도 다시 굽습니다.

## 털 스프라이트와 프로필 카드 (`sprites/`)

사무실에서 앉은 동물을 가까이 당기면 3D 모델 대신 Cycles로 털을 심어 구운 그림이 보입니다. 프로필 카드도 선 자세 모델을 같은 방식으로 구운 그림을 씁니다. 이 폴더의 스크립트가 두 종류의 시트를 굽습니다. 런타임은 `site/assets/scene/sprites.js`이고 시트 목록은 `site/assets/scene/sprites/manifest.json`에 있습니다. `test/office-sprites.test.js`가 manifest의 모양을 검사합니다.

- `bake_fur.py`는 털을 심는 방법(Curves, Principled Hair BSDF, 베이크 텍스처 색, 사무실 해와 림 방향에 고정한 조명)을 담은 공통 코드입니다. 혼자 실행하지 않고 아래 두 스크립트가 불러 씁니다.
- `bake_sprites.py`는 앉은 자세 모델(`site/assets/scene/cast/<종>.glb`)을 직교 카메라로 다섯 방위각(-34, -17, 0, 17, 34도)에서 렌더해 `<종>-<변형>.webp`를 만듭니다. 칸은 384×448이고 2배로 렌더한 뒤 줄입니다. 변형은 `plain`과 고양이의 `santa`, `reindeer`, `nose`입니다. 연말 변형은 착용물 둘레만 다시 렌더해 `plain` 프레임 위에 덮으므로 같은 종의 `plain`을 먼저 굽습니다.
- `bake_card.py`는 선 자세 모델(`<종>-pose.glb`)을 다섯 각도(0.22에서 0.66 라디안)로 돌려 가며 렌더해 `<종>-card.webp`를 만듭니다. 카메라는 사무실 카드 카메라와 같은 원근 카메라(세로 화각 26도)입니다. 칸은 480×640이고 `ghost`는 카드가 없습니다.
- `geom.json`은 시트의 기하(직교 높이 `Hu`, 중심 `uc`, `anchor`, 종별 변형 목록)를 고정합니다. 런타임의 `anchor`와 `unitsPerPx`가 이 값에서 나오므로 모델을 고쳐도 이 파일은 그대로 둡니다. `bake_sprites.py -- bounds`는 새 값을 작업 폴더의 `geom.json`에 쓰기만 하고 이 파일을 바꾸지 않습니다.
- `manifest.py`는 manifest를 다시 씁니다. 시트는 작업 폴더의 `out/`이나 사이트 폴더에 있으면 있는 것으로 칩니다. 카드 카메라(`cam`, `at`)는 작업 폴더의 `card.json`에서 가져옵니다. 이 파일은 처음 구울 때 사이트 manifest의 카드 항목에서 시작하므로 다시 굽지 않은 종의 값도 남습니다.
- `bake.sh`는 Blender 한 번을 띄워 한 묶음을 굽고 마지막 줄에 `EXIT=<코드>`를 남깁니다. 환경변수 `BLENDER`로 Blender 경로를 바꿀 수 있습니다.

작업 폴더(`WORK`)는 저장소 밖의 임시 폴더로 정합니다. 시트는 `WORK/out/`에, 원본 크기 프레임과 PNG 시트는 `WORK/frames/`와 `WORK/sheets/`에 생깁니다. 이미 있는 시트는 건너뛰므로 멈춘 묶음을 다시 실행하면 이어서 굽습니다. 다시 구우려면 `--force`를 붙입니다.

```sh
# 앉은 자세 시트(고양이는 plain을 먼저)
tools/blender/sprites/bake.sh /tmp/sprag-sprites plain cat:plain,cat:santa,cat:reindeer,cat:nose,dog:plain --force
# 프로필 카드 시트(all은 src/office-species.js의 ghost를 뺀 모든 종)
tools/blender/sprites/bake.sh /tmp/sprag-sprites card cat,dog --force
# manifest 다시 쓰기, 결과는 WORK/out/manifest.json
python3 tools/blender/sprites/manifest.py --work /tmp/sprag-sprites all
# 확인 뒤 사이트로 복사
cp -p /tmp/sprag-sprites/out/*.webp /tmp/sprag-sprites/out/manifest.json site/assets/scene/sprites/
```

- Cycles는 한 번에 하나만 돌립니다. 두 묶음을 함께 돌리면 GPU를 나눠 쓰느라 둘 다 느려집니다.
- M2 Max GPU(Metal, 128샘플)에서 시트 한 장에 앉은 자세는 약 55초에서 120초, 카드는 약 95초에서 205초가 걸립니다(2026-11-12 기록). 31종의 앉은 자세와 30종의 카드, 고양이 변형 3장을 모두 구우면 약 2시간입니다. 2026-11-15에 착용물을 지운 61장을 다시 구울 때는 다른 Blender가 같은 GPU를 함께 써서 앉은 자세가 약 100초에서 305초, 카드가 약 105초에서 435초 걸렸고 모두 합쳐 약 3시간 40분이 걸렸습니다.
- WebP 품질은 앉은 자세 시트가 150KB, 카드 시트가 220KB를 넘지 않는 가장 높은 값으로 고릅니다. 인코딩에는 `cwebp`가 필요합니다(`brew install webp`).
- 캐스트 모델(`site/assets/scene/cast/*.glb`)을 고치면 바뀐 종의 시트를 반드시 다시 굽습니다. 다시 굽지 않으면 가까이 당겼을 때와 프로필 카드에 옛 모습이 보입니다. 굽고 나면 옛 시트와 새 시트의 가운데 칸을 나란히 놓고 틀과 털, 조명, 투명 배경이 그대로인지 확인한 뒤 복사합니다.

## 캐스트 정수리 자국 고치기 (`fix_crown.py`)

착용물을 지우고 나니 모자 아래에 가려 있던 피부가 드러난 종이 있었습니다. 너구리와 다람쥐는 정수리에 네모난 얼룩이 있었습니다. 다람쥐와 치타는 비니 테와 머리띠가 남긴 가는 띠 자국이 이마를 가로질렀습니다. 병아리는 정수리에 털 무늬 없는 원판이 보였고 용은 이마에 선글라스 테두리 자국이 남았습니다. 사무실 카메라는 약 30도 위에서 앉은 동물을 보므로 모든 방문자에게 정수리가 보입니다. 이 스크립트는 몸통 메시 `chibi`의 텍스처에서 그 자국만 고치고 `fix_slivers.py`와 같은 설정(Draco, 텍스처 포함)으로 다시 내보냅니다.

```sh
# 판정만(파일을 쓰지 않음). CROWN_DEBUG 를 주면 UV 공간 진단 그림을 씁니다
CROWN_DEBUG=/tmp/crown /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/blender/fix_crown.py -- site/assets/scene/cast - raccoon,chick
# 고쳐서 다른 폴더에 저장. 네 번째 인자는 착용물을 지우기 전 glb 폴더입니다
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/blender/fix_crown.py -- <원본 폴더> <출력 폴더> raccoon,raccoon-pose <지우기 전 폴더>
```

- 정수리는 기하로 정합니다. 눈 위 `chibi` 정점에 구를 맞추고 텍셀마다 구 중심에서 본 높이와 방향을 구합니다. 종 표 `SPECIES`에 적은 높이 아래와 정면 얼굴 무늬 범위는 뺍니다. 구 반지름의 1.07배 밖(귀와 뿔)도 뺍니다.
- 기준 털 색은 정수리 아래 뒤쪽 띠에서 잽니다. 정수리 텍셀 가운데 이 색과 덩어리째 다른 곳을 자국으로 봅니다. 150텍셀보다 작은 점은 털 잔무늬로 보고 남깁니다.
- 띠 자국은 털과 색이 비슷해서 색으로는 잡히지 않습니다. 종 표에 `footprint`가 있는 종(다람쥐, 치타, 용)은 지우기 전 파일의 머리 착용물 표면에서 0.03 안쪽에 있는 정수리 텍셀도 자국으로 봅니다. 그래서 이 종들은 네 번째 인자가 있어야 합니다. 지우기 전 파일은 착용물을 지운 커밋 바로 앞의 저장소 파일입니다.
- 자국 텍셀은 둘레 털의 저주파 색으로 바꿉니다. 그 위에 자국 자신의 고주파 무늬를 털과 같은 세기로 맞춰 얹습니다. 원래 구운 무늬라서 UV 섬 경계를 넘어도 이어집니다. 착용물이 덮었던 부분은 자기 무늬가 띠 자국을 담고 있어서 좋은 털에서 떠 온 무늬를 씁니다. 가장자리는 부드럽게 섞고 기본색 텍스처와 노멀 맵에 같은 마스크를 씁니다.
- 정수리 면이 쓰는 텍셀 밖은 바꾸지 않습니다. 실행할 때마다 바뀐 텍셀 수와 정수리 밖 변경 수(`outside_region`)를 출력하며 이 값은 0이어야 합니다. JPEG 는 원본의 양자화표에서 품질 값을 거꾸로 구해 같은 품질로 다시 저장합니다. 정수리 밖에는 재압축 오차만 남고 그 크기도 출력합니다.
- 다시 저장할 때 `save_render`를 쓰면 장면의 보기 변환(AgX)이 입혀져 텍스처 전체의 색이 바랩니다. 그래서 `Image.save`로 바이트를 그대로 씁니다.
- `crease` 항목을 적은 종은 주름 띠 정점의 구 중심 거리를 이웃 평균으로 고르게 합니다. 지금 표에는 이 항목을 쓰는 종이 없습니다. 2026-11-15에 다람쥐와 치타의 이마 선을 기하만 렌더해 보니 머리는 매끈했고 선은 텍스처에 있었습니다. 치타는 정수리의 점 무늬가 `face` 메시 위에 떠 있어서 머리 표면을 움직이면 점이 묻힙니다.
- 허스키, 돼지, 늑대, 햄스터는 표에 없습니다. 허스키의 흰 조각은 이마의 흰 줄무늬와 바로 붙어 있어 색으로 가를 수 없었습니다. 돼지와 늑대는 자국이 다 지워지지 않았고 햄스터는 고친 차이가 보이지 않았습니다. 늑대와 허스키의 선 자세 모델은 구 맞춤이 어긋나 정수리 텍셀을 거의 찾지 못했습니다.
- 2026-11-15에 저장소의 파일(너구리, 다람쥐, 치타, 병아리, 용의 앉은 자세와 선 자세 10개)에 한 번 적용했습니다. 같은 파일에 다시 돌리지 마십시오. 털이 이미 고쳐진 뒤라 판정이 달라집니다. 고친 뒤에는 `npm run blender:thumbs`로 아틀라스를 다시 만들고 털 스프라이트와 프로필 카드도 다시 굽습니다.

## 타운 소품 (`props_town.py`)

운영자 화면 3D 타운의 나무, 덤불, 가로등 모델을 만들어 glb 한 장으로 내보냅니다. 형태는 모두 bpy와 bmesh로 절차적으로 만들고 외부 에셋은 쓰지 않습니다. 난수는 고정 시드라서 같은 Blender에서는 같은 결과가 나옵니다.

```sh
npm run blender:props
# 미리보기까지 만드는 명령
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/blender/props_town.py -- --out site/assets/scene/props/town-props.glb \
  --preview /tmp/townq/props-preview.png
```

출력은 `site/assets/scene/props/town-props.glb`이고 Draco로 압축합니다. `--preview`를 주면 소품 7개를 한 줄로 놓고 Cycles로 1600×600을 렌더합니다. 수관에는 미리보기에서만 초록, 분홍, 주황, 침엽수 초록을 곱합니다. 옵션은 `--samples 96`과 `--device auto|cpu|gpu`입니다. 모델링과 AO 계산은 약 1초, 렌더까지 합쳐 약 4초가 걸립니다.

### 메시 이름

메인 코드가 이름으로 메시를 찾으므로 이름을 바꾸지 마십시오. 단위는 미터이고 +Y가 위입니다. 원점은 바닥 중심이며 변환은 적용된 상태라 정점이 실제 좌표를 갖습니다.

| 이름 | 형태 | 크기 |
|---|---|---|
| `tree_round_trunk` | 살짝 휘고 밑동이 넓은 줄기와 가지 2개 | 높이 1.6, 밑동 반지름 0.16 |
| `tree_round_canopy` | 구 6개를 합친 뭉게구름 수관, 아래가 평평함 | 지름 2.1, 높이 1.7, 바닥 높이 1.05 |
| `tree_tall_trunk` | 곧은 줄기 | 높이 약 1.95 |
| `tree_tall_canopy` | 길쭉한 타원 수관과 작은 볼록 3개 | 지름 1.4, 높이 2.0, 바닥 높이 1.2 |
| `pine_trunk` | 짧은 줄기 | 높이 약 1.45 |
| `pine_canopy` | 둥글게 다듬은 3단 원뿔 | 전체 높이 3.0, 맨 아래 단 지름 2.0 |
| `bush_canopy` | 납작한 덩어리 3개를 합친 덤불, 줄기 없음 | 지름 1.4, 높이 0.9 |
| `lamp_pole` | 받침대, 가는 기둥, 곡선 팔, 갓 | 높이 2.3, 기둥 반지름 0.06 |
| `lamp_head` | 갓 아래 둥근 전구 | 지름 0.4, 중심 높이 2.1 |

### 정점 색 규칙

색은 정점 색 `COLOR_0`에만 담고 텍스처와 재질은 내보내지 않습니다. 메인 코드는 지오메트리와 `COLOR_0`만 읽습니다. 값은 선형 색이고 AO는 정점마다 노멀 반구로 광선을 쏴서 계산합니다. 하늘 쪽 항을 더해 아래쪽이 위쪽보다 어둡게 나옵니다.

- 수관(`*_canopy`)과 `lamp_head`는 회색조 AO만 담습니다. 가려지지 않은 곳이 1.0이고 가장 어두운 곳이 0.55입니다. 색은 인스턴스가 칠합니다.
- 줄기(`*_trunk`)는 `#8a6a4a`, 가로등 기둥(`lamp_pole`)은 `#5b5668`에 AO를 곱해 구워 둡니다.

### 예산

- 수관 하나는 삼각형 1,200개 이하이고 줄기와 기둥은 300개 이하이며 덤불은 600개 이하입니다. 넘으면 스크립트가 오류로 멈춥니다.
- 노멀은 스무스이고 파일 크기는 200KB 이하입니다. `test/scene-props.test.js`가 이름, `COLOR_0`, 파일 크기를 검사합니다.

## Sprag 회전체 (`sprag_rotor.py`)

홈 첫 화면과 "작동 방식" 단계, 위임 흐름도에서 도는 회전체 그림을 렌더합니다. Sprag 마크(`site/assets/logo/sprag-mark.svg`)를 한 덩어리의 가공 부품으로 모델링했습니다. 바깥 링과 허브는 단면을 360도 돌려 만들고 모따기와 홈을 넣었습니다. 두 링 사이에 기울어진 스프래그 3개와 코일 스프링 3개가 있습니다. 링 사이는 마크처럼 비워 두고 바닥과 그림자는 넣지 않습니다. 사이트가 그라데이션과 퍼지는 그림자를 쓰지 않기 때문입니다.

카메라는 정면 위에서 내려다보고 조명은 모든 방향에서 같습니다. 그래서 페이지가 그림을 돌려도 하이라이트가 따라 돌지 않습니다.

```sh
blender -b --factory-startup --python tools/blender/sprag_rotor.py -- /tmp/rotor 1400 256
```

결과는 두 장입니다. `sprag-rotor-xl.png`는 밝은 화면용 짙은 금속이고 `sprag-rotor-light-xl.png`는 어두운 화면용 은색입니다. 사이트에는 WebP로 넣습니다. 1400px 원본은 `-xl`로, 512px로 줄인 것은 접미사 없이 씁니다.

```sh
ffmpeg -i /tmp/rotor/sprag-rotor-xl.png -c:v libwebp -quality 88 -pix_fmt yuva420p site/assets/sprag-rotor-xl.webp
ffmpeg -i /tmp/rotor/sprag-rotor-xl.png -vf scale=512:512:flags=lanczos -c:v libwebp -quality 88 -pix_fmt yuva420p site/assets/sprag-rotor.webp
```

Windows의 Blender 4.5 Cycles CPU에서 두 장을 렌더하는 데 약 6분이 걸립니다.
