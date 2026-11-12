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
