# Gateways, pricing, FAQ and environment (한국어)

[← README](../README.ko.md) · [English](./GATEWAYS.md)

## 🌐 Bedrock·Vertex 경유 환경

게이트웨이를 거치면 응답이 캐시 쓰기 합계만 내려보내고 5분·1시간 버킷별 분해 값은 채우지 않습니다. 그래서 이 도구가 "캐시 쓰기가 아직 없다"와 "이 제공자는 알려 주지 않는다"를 구별하지 못했고, 판정 불가일 때 1시간을 기본값으로 잡았습니다. Bedrock 은 5분 버킷만 제공하므로 남은 시간이 최대 12배로 부풀어 보였습니다.

v3.26.0부터 트랜스크립트의 모델 ID로 게이트웨이를 감지해 다음을 바로잡습니다.

- 판정 불가일 때의 카운트다운 기본값이 5분이 되고, 버킷 라벨이 `5m?` 로 표시됩니다. 실측값은 `5m`, 추정은 `5m?`, 근거 없음은 `?` 로 세 단계를 구분합니다.
- 5분 버킷에서는 카운트다운 색이 비율이 아니라 절대 시간을 따릅니다. 5분의 30%는 90초여서, 초록이 주는 여유가 실제와 어긋났습니다.
- `⚠ 5m TTL` 경고가 이 환경에도 도달합니다. 다만 조언 문구는 다릅니다. 구독 플랜을 바꿔도 해소되지 않는 환경이므로 플랜 전환을 권하지 않습니다.
- `Extra cost if 5m-only` 는 1시간 쓰기가 있는 경우에만 묻습니다. 이미 5분 전용인 환경에서는 질문 자체가 성립하지 않아 `+$0` 이 잘못 읽혔습니다.
- 위임 건이 모델 ID 해석 실패로 버려졌으면 statusline 에 `🔀 N unresolved` 로 알립니다. 이전에는 "위임한 적 없음"과 화면상 구별되지 않았습니다.
- 환경변수를 `foundation-model` ARN 으로 지정한 경우에도 모델을 해석합니다. 이름을 담고 있지 않은 `application-inference-profile` ID 는 그대로 거부합니다. 값을 추측해 넣으면 원장에 틀린 금액이 들어가기 때문입니다.

감지가 틀리면 `sprag mode ttl=5m`(또는 `ttl=1h`)로 직접 지정할 수 있습니다. 지정값이 실측값보다 우선합니다.

### LiteLLM: 5h/7d cap 대신 키 예산을 보여 줍니다 (v3.35.0)

LiteLLM 프록시로 Bedrock 등을 쓰면 Claude Code stdin 에 `rate_limits` 가 오지 않아 `✦ current`·`📅 weekly` 게이지가 아예 없습니다. 대신 LiteLLM 은 키별 `max_budget` 과 `spend` 를 관리하므로, 그 값을 가져와 같은 지점에 예산 게이지를 그립니다.

- 감지 조건: `ANTHROPIC_BASE_URL` 이 공식 엔드포인트가 아닌 환경. 키는 `ANTHROPIC_AUTH_TOKEN`(또는 `ANTHROPIC_API_KEY`)에서 먼저 찾고, 없으면 `settings.json` 의 `apiKeyHelper` 를 실행해 얻습니다. 헬퍼 실행은 5분에 한 번 뜨는 갱신 프로세스 안에서만 하므로 통계선 렌더는 느려지지 않습니다 (v3.43.0).
- `/key/info` 가 404 를 주어도 갱신을 멈추지 않습니다. Okta JWT 같은 커스텀 인증을 쓰는 배포에서는 404 가 정상이고, 예산은 `/user/info` 에 들어 있습니다. 두 엔드포인트가 모두 실패할 때만 실패로 봅니다 (v3.43.0).
- 팀 멤버십이 아니라 internal user 한도로 게이지를 그리게 되면 `budget (user)` 로 출처를 함께 표시합니다. LiteLLM 이 차단 여부를 판정할 때 보는 값은 팀 멤버십 한도라서, 두 값이 수백 배 어긋나는 배포가 있습니다 (v3.43.0).
- 조회는 LiteLLM 의 `GET /key/info` 와 `GET /user/info` 로 하고, 호출 키 자신의 정보만 받습니다. 예산 출처는 실무에서 가장 많이 쓰는 **팀 멤버십 예산**(team_memberships 의 spend·max_budget)을 먼저 보고, 없으면 키 자체의 max_budget, 그다음 internal user 예산 순으로 고릅니다. 렌더는 캐시 파일만 읽으며, 갱신은 5분에 한 번 분리된 백그라운드 프로세스가 수행합니다 (update-check 와 같은 구조라 statusline 이 네트워크를 기다리지 않습니다).
- `max_budget` 이 없는 무제한 키는 게이지를 만들지 않습니다. 이 경우에도 `💵` 월 지출 세그먼트는 세션 로그 기반이라 그대로 표시됩니다.
- 상태 확인: `sprag litellm-budget` (게이지·사용·잔여 금액 출력) · `--json` (캐시 원본) · `--refresh` (즉시 조회).

세션 기본 모델이 sonnet 이면 sonnet 위임 규칙(T1)은 구조적으로 절감이 0입니다. 같은 급으로 내려보내 봐야 차액이 없기 때문이며 이는 정상 동작입니다. 다만 `route-scan rules` 가 이 경우를 "아직 위임 없음"과 같은 문구로 표시해 고장처럼 보였으므로, 이제 현재 기본 모델 기준으로 적용되지 않는다는 사실을 따로 적습니다.

## FAQ

**claude-token-saver와 같은 도구인가요?** 네. Sprag가 새 이름이고 npm 패키지는 `sprag-cli`입니다. `claude-token-saver` 패키지도 같은 릴리스를 계속 받으므로 기존 설치는 그대로 동작합니다.

**LLM을 호출하거나 API 키가 필요한가요?** 아니요. Claude Code가 이미 내 컴퓨터에 남기는 세션 로그를 사후 분석할 뿐입니다. 추가 모델 호출도, 키도 없고, 데이터가 밖으로 나가지 않습니다.

**프롬프트 습관을 바꿔야 하나요?** 아니요. 설치 때 hook과 statusline을 한 번 등록하면, 지금 하던 방식 그대로 쓰는 동안 규칙과 위임, 경고가 세션 안에 나타납니다.

**절감액 수치는 어디서 나오나요?** 위임 실행마다 실제 가격 차이가 장부에 한 줄씩 기록됩니다. 라우팅 기준은 공개 데이터로 벤치마크했고, 방법은 [docs/BENCHMARK.md](./BENCHMARK.md)에 있습니다.

## 동작 원리 · 환경

Claude Code는 모든 API 응답을 `~/.claude/projects/<dir>/<session>.jsonl`에 기록합니다. 이 도구는 `cache_read_input_tokens`, `cache_creation.ephemeral_5m/1h_input_tokens` 등을 `requestId` 기준으로 중복 제거 후 집계합니다.

Node.js ≥ 18 · macOS / Linux / Windows / WSL · **의존성 0**.

<details>
<summary>알려진 환경 이슈 · 마이그레이션</summary>

**IntelliJ Claude Code plugin:** statusline 위젯이 프레임을 잘못 합성해 `59:548` 같은 잔재가 보이는 버그가 있습니다(이모지 출력에서만). v2.8.5+는 `TERMINAL_EMULATOR=JetBrains-JediTerm` 감지 시 자동으로 text 모드 폴백합니다.

**TTL 카운트다운이 멈춰 보일 때:** 카운트다운이 입력 없이도 초 단위로 줄어들려면 Claude Code 가 statusline 명령을 주기적으로 다시 실행해야 하고, 그 주기는 `~/.claude/settings.json` 의 `statusLine.refreshInterval`(초 단위, v2.1.97 이상)이 정합니다. 이 값이 없으면 대화가 갱신될 때만 다시 그려져서 멈춘 것처럼 보입니다. 터미널마다 동작이 다르면 세 가지를 확인하십시오. ① 그 머신의 Claude Code 버전이 2.1.97 이상인지, ② 프로젝트 `.claude/settings.json` 이나 `settings.local.json` 이 `statusLine` 을 refreshInterval 없이 덮어쓰고 있지 않은지, ③ statusline 래퍼가 PATH 에서 `sprag` 를 찾지 못해 매 렌더마다 `npx` 폴백으로 수 초씩 걸리고 있지 않은지 (비로그인 셸에서 nvm 이 로드되지 않는 터미널이 여기에 해당합니다). `sprag install` 을 다시 실행하면 refreshInterval 을 5초로 복구합니다.

**claude-cache-monitor에서 마이그레이션:**
```bash
npm uninstall -g claude-cache-monitor && npm i -g sprag-cli
```
`~/.claude/settings.json`의 `statusLine.command`도 `sprag …`로 교체하세요.
</details>
