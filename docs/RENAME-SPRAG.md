# Sprag 리네임 로드맵

## 이름과 포지셔닝

- 브랜드: **Sprag**, 스프래그 클러치에서 따온 이름입니다. 축이 앞으로 도는 것은 그대로 통과시키고, 역회전하는 순간 잠급니다. 이 도구의 철학과 같습니다: 작업은 방해하지 않고, 퇴행만 막습니다.
- 태그라인: `Sprag — a quality ratchet for AI agents. Mistakes never repeat.`
- 포지셔닝 문장: "cleat guards the code; Sprag guards the agent." (cleat는 에이전트가 쓴 코드에 게이트를 걸고, Sprag는 에이전트의 행동과 운영에 랫쳇을 겁니다. 경쟁이 아니라 보완 관계입니다.)
- 발음: 스프래그 /spræɡ/. paw 계열 연상이 없어서 검색 고유성이 높습니다.

## 확보 현황 (2026-09-13 확인)

| 자산 | 상태 |
| --- | --- |
| npm `sprag` | 비어 있음. placeholder 패키지 준비 완료(스크래치패드), publish는 사용자 직접 실행 필요 |
| sprag.io | 미등록, 일반가(연 5~7만 원대)로 구매 가능 |
| sprag.ai / sprag.dev | 이미 등록됨 |
| GitHub org/repo | 미확인 — 확보 시 `sprag` 또는 `sprag-dev` 확인 필요 |

## 단계별 계획

1. **선점**: npm `sprag` placeholder publish, sprag.io 구매, GitHub 이름 확인.
2. **병행기**: `claude-token-saver`는 그대로 배포를 유지하고, `sprag` bin alias를 추가합니다. README 상단에 "Sprag로 리네임 예정" 배너를 답니다. npm 검색 유입("claude token")은 keywords와 README 첫 줄로 지킵니다.
3. **전환**: 메이저 버전에서 패키지명을 `sprag`로 바꾸고, `claude-token-saver`는 wrapper(의존성으로 sprag를 끌어오는 껍데기)로 남겨 기존 사용자 설치가 깨지지 않게 합니다.
4. **홈페이지**: `site/index.html`은 yaml-site-home-agent 패턴(단일 정적 파일 + GitHub Pages + CNAME + SEO 메타)을 차용했습니다. 히어로에 스프래그 클러치 3D 애니메이션(Three.js)을 넣어 이름의 유래를 화면이 직접 설명하게 합니다.

## 참고: 이름 결정 과정 요약

- claude-token-saver는 기능(harness, ratchet, 모델 피팅)이 이름보다 넓어져서, 프로바이더 중립 + LLM 너머 확장이 가능한 이름이 필요했습니다.
- Ratchet: 은유는 정확하지만 npm 선점 + 같은 틈새 도구(cleat)가 이 어휘로 이미 홍보 중이라 검색이 섞입니다.
- Pawl: 은유가 가장 정확했지만 paw(동물 발) 연상과 pawl.ai(반려동물 스타트업 현역 사용) 충돌로 제외했습니다.
- Sprag: 은유 정확도 동급 + 연상 오염 없음 + npm과 .io 도메인 확보 가능으로 최종 선택했습니다.

## 사이트 현황 (2026-09-13 기준)

`site/index.html` 한 파일입니다. 외부 라이브러리를 쓰지 않고, FCP는 로컬 측정에서 약 300ms입니다.

- 구조: bun.sh와 biomejs.dev 패턴을 따라 히어로에 애니메이션을 넣지 않고 실제 터미널 출력을 바로 보여 줍니다. 탭 4개(Ratchet, Routing, Statusline, doc2md)에 명령 타이핑과 줄 단위 출력 연출이 있고, statusline 탭의 수치는 실시간으로 움직입니다.
- 개념 도식: "작동 방식" 섹션 상단에 좌에서 우로 읽는 4단 구성입니다. 과거 이력 → 판단 → 실행 주체(haiku-runner, sonnet-worker, 메인 에이전트) → 메인 검수. 위임은 모델 교체가 아니라 하위 에이전트 생성이며, 판단 근거는 과거 세션 분석이라는 점을 도식과 본문이 함께 말합니다.
- 로고: `site/assets/logo/`에 마크와 락업, 파비콘 세트가 있습니다. 캠 3개짜리 단순 형태이며 16px에서도 형태가 남습니다.
- 아이콘: `site/assets/icons/` 6종이고 페이지에는 인라인 스프라이트로 넣습니다.
- 다국어: 브라우저 로케일로 한국어와 영어를 자동 판별하고, `?lang=` 파라미터와 헤더 토글, localStorage 저장을 지원합니다. 한국어일 때는 서체와 자간을 따로 잡습니다.

남은 작업: npm `sprag` placeholder 배포, sprag.io 도메인 확보, 사이트 커밋과 배포.
