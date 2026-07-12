# claude-token-saver 추천 Ratchet 룰 (curated presets)

이 파일은 패키지에 동봉되는 제작자 큐레이션 랫쳇 룰입니다.
`claude-token-saver harness pull`을 실행하면 아래 룰이 사용자의
글로벌 랫쳇(`~/.claude/ratchet.md`)에 등록됩니다 (opt-in, 중복 자동 스킵).

실제 반복 실수에서 승격된 룰만 담습니다 — 이론이 아니라 사고 이력.

## Rules

- 웹 fetch/search에서 robots·UA 차단('unable to fetch' 등)이 발생하면 → curl에 브라우저 UA(Mozilla/5.0 ... Chrome/...) 헤더를 붙여 재시도. reddit 등은 .json 엔드포인트 + UA 조합으로 접근 가능
- ratchet 룰 promote 호출 직전 사용자에게 scope(project/global)를 먼저 묻는다 — Bash 환경은 non-TTY라 CLI readline 프롬프트가 안 뜨므로, 호출자(LLM)가 대신 묻고 --project/--global 플래그를 명시해 실행
- 자동화 도구가 grep·정규식으로 찾는 마커 텍스트(헤더·앵커·키워드 라인)는 리팩터링·압축·수정 금지 — 정확 매칭 검출은 한 글자만 바뀌어도 깨짐
- 자동화 설계에서 vision/screenshot 루프가 보이면 → 호출 가능한 함수·API·MCP tool부터 찾는다. 통제 가능한 내부 도구는 무조건 API, 통제 불가 외부 SaaS만 vision 차선책. 인터페이스를 바꾼 뒤에 모델을 내린다 — 거꾸로 가면 토큰 폭발
- 입력 데이터(ground-truth) 변경 시 그에 의존하는 모든 파생 자산을 끝까지 재생성한다 — 중간 단계를 생략하면 stale 산출물이 새 입력 위에 얹혀 결과가 깨짐
- 탐색·조회·상태 확인·명령 실행 같은 단순 요청은 haiku 서브에이전트(haiku-explore·haiku-runner 등)로 위임해 상위 모델 토큰을 아낀다
