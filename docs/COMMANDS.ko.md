# 명령어 모음

[← README](../README.ko.md) · [English](./COMMANDS.md)

## 주요 명령

Codex에서는 `--agent codex`를 붙입니다. 아래 표에서 Codex 명령을 확인하고,
[Codex 연동 안내](./CODEX.ko.md)에서 플랫폼별 차이와 제한을 살펴보십시오.

| Codex 명령 | 설명 |
|---|---|
| `sprag install --agent codex` | 기본 훅과 전역 AGENTS.md 하네스를 등록합니다 |
| `sprag panel run --agent codex --` | Codex와 세션별 패널을 tmux에서 함께 실행합니다 |
| `sprag route-scan --refresh --agent codex` | 프로젝트·공급자·모델별 반복 작업을 찾습니다 |
| `sprag delegate rules add R1 --project --agent codex` | 관찰한 프로젝트에 후보 규칙을 등록합니다. 필요하면 `--model ID`를 붙이십시오 |
| `sprag route-scan savings --refresh --agent codex` | 위임된 하위 실행과 확인 가능한 단가로 예상 차액을 계산합니다 |
| `sprag seed --agent codex` | 호환되는 래칫 프리셋을 나열합니다 |
| `sprag seed accept all --project --agent codex` | 사용자가 범위를 선택한 뒤 대기 중인 프리셋을 등록합니다 |

이하의 명령은 기본 대상인 Claude Code를 설명합니다.

셸에서 직접 실행합니다 (Claude Code 안에서는 `/claude-token-saver` Skill 하나만 사용):

| 명령 | 설명 |
|---|---|
| `sprag` | 최근 30일 진단 리포트 (`--days N` / `--hours N`) |
| `sprag last` | 가장 최근 경고 1건 + 처방 |
| `sprag history` | 최근 7일 경고 전이 로그 |
| `sprag handoff` | 작업 상태를 `HANDOFF-*.md`로 백업 (캡 임박 시) |
| `sprag mode [keywords...]` | 출력 설정 (`icon`/`text`, `ko`/`en`, `1h`~`30d` 윈도 등) |
| `sprag harness ...` | 🅷 Harness 관리 (아래 참고) |
| `sprag route-scan` | 상위 모델이 반복 처리한 쉬운 작업을 감지해 haiku 위임 래칫 룰을 제안합니다 (아래 참고) |
| `sprag route-scan savings` | 라우팅 절감 원장입니다. 모델 이동별 합계와 실행별 내역을 함께 보여 주며, 표시되는 금액의 근거가 됩니다 |
| `sprag delegate agents [on\|off]` | 위임 전용 서브에이전트 다섯 개(`t2-explore`, `t2-runner`, `t2-translate`, `t1-worker`, `t1h-worker`)를 `~/.claude/agents` 에 설치하거나 상태를 보여 주고 제거합니다. `tools` 허용 목록에 MCP 도구가 없어서, 게이트웨이 뒤에서 서브에이전트의 첫 요청이 절반 가까이 줄어듭니다. 파일마다 `effort` 도 검증 방식에 맞춰 고정합니다. 결과를 명령 출력이나 파일 대조로 확인하는 haiku 에이전트 셋은 `low`, 확정된 설계를 테스트에 맞춰 구현하는 `t1-worker` 는 `medium` 입니다. sprag 가 쓴 파일만 덮어쓰거나 지웁니다 |
| `sprag team create [--email <e>] [--name <이름>] [--code <6자리>] [--no-join]` | CLI에서 팀을 만듭니다. 메일로 받은 6자리 코드로 로그인하고, 초대 토큰과 멤버·조직용 명령을 출력하며, 이 PC를 첫 멤버로 참여시킵니다 (`--no-join` 은 참여 생략). 터미널이 없으면 두 단계로 나뉩니다 ([팀 기능](./TEAM.ko.md)) |
| `sprag team join [토큰] [--name <이름>] [--yes]` | 팀 기능을 켭니다. 올라갈 내용(하루 단위 집계와 카테고리별 위임 룰 요약뿐이며 룰 본문과 경로는 없습니다)을 보여 준 뒤 등록합니다. 토큰을 생략하면 `SPRAG_TEAM_TOKEN` 을 읽습니다 ([팀 기능](./TEAM.ko.md)) |
| `sprag team name [<이름>]` | 참여한 뒤에 표시 이름을 보거나 바꿉니다. 대시보드에 새 이름이 바로 나옵니다 |
| `sprag team leave` | 팀에서 나가고 업로드를 멈추며, 멤버 키, 룰 캐시, 래칫 import 를 지웁니다 |
| `sprag team status [--show-payload]` | 팀, 플랜, 프롬프트 수집 설정, 표시 이름, 사무실 순위(종합 점수의 구성, 올라가려면 토큰을 더 써야 하는지 위임 몫을 늘려야 하는지, 다음 등급까지의 거리), 마지막 동기화를 보여 줍니다. `--show-payload` 는 올라갈 행과 위임 룰 요약을 그대로 출력합니다 |
| `sprag team sync [--force] [--rules-only]` | 지금 하루 집계를 올리고 승인된 조직·팀 룰을 받습니다 (`--force` 는 5분 간격을 무시, `--rules-only` 는 룰만 받고 아무것도 올리지 않음) |
| `sprag team rules` | 받아 둔 조직·팀 룰 보기 |
| `sprag team propose "<내용>" [--scope ratchet\|model]` | 팀 소유자에게 룰 제안 |
| `sprag cowork [sync\|on\|off\|exclude <폴더>\|include <폴더>]` | Claude 앱 Cowork 탭에 연결했던 폴더를 찾아, 각 폴더의 `.claude/rules/sprag-cowork-ratchet.md` 에 래칫 세 파일의 사본을 둡니다. Cowork는 `~/.claude` 의 import를 읽지 않기 때문입니다. 세션을 시작할 때마다 자동으로 갱신되며, Code 탭은 `claudeMdExcludes` 설정으로 이 사본을 읽지 않습니다 |
| `sprag saved [reset\|undo]` | 절감 금액 카운터를 보여 주거나 스톱워치처럼 0으로 초기화합니다 (`routing`, `doc2md`, `all`). 원장 기록은 지우지 않고, `undo`로 이전 카운터를 되돌립니다. `--agent codex`는 Codex 카운터를 다룹니다 |
| `sprag compact-window` | 1M 컨텍스트를 쓰면서 자동 압축 창이 설정되지 않았으면 경고하고, `set`으로 50만에 고정합니다 (아래 참고) |
| `sprag korean on\|off\|status` | 한국어 문체 지침을 세션 시작 시 주입하고, 쓰기 시점 검사를 함께 설치합니다 (아래 참고) |
| `sprag cohesion on\|off\|status\|show` | 영어 문장 연결(응집성) 지침을 세션 시작 시 주입합니다 |
| `sprag korean lint block\|warn\|off` | 쓰기 시점 검사가 위반을 어떻게 처리할지 정합니다 |
| `sprag korean lint scope all\|prose` | 검사 범위를 모든 텍스트 파일과 문서 전용 사이에서 고릅니다 |
| `sprag korean reply on\|off` | 한국어 질문에 영어로 답했을 때 되돌려 보내는 Stop 훅을 켜고 끕니다 (기본값 켜짐, `korean off` 는 훅을 제거합니다) |
| `sprag doc2md on\|off` | 첨부 문서를 모델이 읽기 전에 Markdown 으로 변환합니다 (아래 참고) |
| `sprag doc2md <파일>` | 파일 하나를 직접 변환합니다. 진단 용도이며 실패 이유를 그대로 출력합니다 |
| `sprag delegate on\|off\|status` | 기본으로 켜져 있습니다. Task/Agent 위임 프롬프트마다 상한과 필요한 경우 한국어 지침, 세션이 이미 읽은 경로를 덧붙이고 effort 없는 Sonnet 위임을 high로 올립니다 (아래 참고) |
| `sprag proof [--json]` | 티어 규칙의 근거가 된 위임 재생 사례를 보여 줍니다. 사례 수와 사례별 추천 설정, 판정, Opus 기준선 대비 비용이 나옵니다. `--json` 은 요약 원본을 출력합니다. 전체 실행 기록은 https://sprag.io/proof/ 에 있습니다 |
| `sprag mode ttl=5m\|1h\|auto` | 캐시 TTL 버킷을 직접 지정합니다. 기본값 `auto`는 실측값을 먼저 보고, 실측값이 없으면 게이트웨이 여부로 판정합니다 |
| `sprag mode compact=0..3` | 상태줄에 보이는 양을 고릅니다. `0`은 기본 긴 라벨, `1`은 짧은 라벨(`compact`와 같음), `2`는 헤드라인 줄(Routing saved와 팀 줄)을 칩으로 접고 경고, 사용량, Ctx, TTL, 모델, 라우팅 칩만 두 줄 안에 남깁니다. `3`은 경고, 사용량, Ctx, TTL 칩만 한 줄에 남깁니다. `--segments`로 이름을 고르면 그 목록이 우선합니다. `--compact-level N`은 한 번만 덮어씁니다 |
| `sprag --version` | 설치된 버전을 출력합니다 |
| `sprag update-check` | 새 버전이 있는지 확인합니다 (`--refresh`로 즉시 조회, `--dismiss`로 그 버전 안내 끄기) |
| `sprag upgrade` | 설치 경로에 맞는 명령으로 최신 버전을 설치합니다 (`--print`로 실행 없이 명령만 확인) |
| `sprag install` | 묻지 않고 전부 등록합니다: Skill, statusline, 훅, 하네스, 추천 룰, 그리고 설치된 경우 Codex |
| `sprag install --manual` | 같은 설치를 단계마다 확인하며 진행합니다 |
| `sprag uninstall [--purge]` | 등록한 훅·statusline·Skill 제거. 기록된 절감액은 남기며, `--purge` 를 붙이면 상태 디렉터리까지 지웁니다 |

출력 언어는 설치할 때 한 번 정합니다. 터미널에서 설치하면 시스템 로케일을 기본값으로 제시하고 한국어를 쓸지 물어보며, 비대화형 설치에서는 로케일 판정을 그대로 기록합니다. 한 번 기록되면 업그레이드해도 다시 묻지 않습니다. 나중에 바꿀 때는 `mode ko`나 `mode en`을 쓰고, 스크립트에서 설치할 때는 `SPRAG_LANG=ko` 또는 `SPRAG_LANG=en`으로 지정할 수 있습니다. statusline의 칩은 언제나 기호로 표시합니다. 전체 옵션은 [전체 명령 문서](./COMMANDS.md)를 참고하십시오.

## `sprag delegate`: 위임 프롬프트를 보내기 전에 고쳐 씁니다

v3.104.0부터 기본으로 켜져 있습니다. `sprag install` 이 `Task`/`Agent` 호출에 PreToolUse 훅을 걸고 처음 등록할 때 무엇을 덧붙이는지 알립니다. `sprag delegate off` 로 끄면 업그레이드 뒤에도 꺼진 채로 남고, 스크립트로 설치할 때는 `SPRAG_NO_DELEGATE=1` 로 건너뜁니다. 훅은 위임 프롬프트 뒤에 최대 네 섹션을 조건별로 붙입니다.

| 섹션 | 붙는 조건 |
|---|---|
| 상한과 출력 형식 | 패키지에 함께 실리는 `presets/delegation/bounds.md` 가 있으면 언제나 붙습니다 |
| 한국어 문체 지침 | 프롬프트에 한글이 있거나 `.ko.` 대상을 가리키거나 영어로 `in Korean` 이라고 적혀 있으면서, 동시에 `korean` 기능이 켜져 있을 때만 나타납니다. 한글 프롬프트라도 `korean` 이 꺼져 있으면 이 섹션은 빠집니다 |
| 래칫 안내 | `~/.claude/ratchet.md` 가 있고 `~/.claude/CLAUDE.md` 가 그 파일을 아직 `@` 로 import 하지 않았을 때 실립니다 |
| 이미 읽은 경로 | 호출한 세션의 트랜스크립트 꼬리에서 `Read`·`Edit`·`MultiEdit`·`Write`·`NotebookEdit`·`Grep`·`Glob` 가운데 현재 작업 디렉터리 안쪽 경로를 하나라도 찾았을 때 채워집니다. 파일만 올립니다. `Grep`·`Glob` 의 인자가 디렉터리면 제외합니다. 읽으라고 건네면 서브에이전트가 상한 한 칸을 실패로 쓰기 때문입니다. 줄을 끊거나 인용을 닫을 수 있는 문자(제어 문자, 유니코드 줄 구분자, 백틱)가 든 경로도 제외합니다. 이 목록은 프롬프트 안에서 한 줄이 한 경로이기 때문입니다. 가장 최근 것부터 최대 15개까지 붙습니다 |

상한과 출력 형식 섹션의 도구 호출 수는 대상마다 다릅니다. `model`(없으면 `subagent_type`)이 `haiku` 와 일치하면 도구 호출 8회·출력 1,500 토큰이고, 아니면 20회·8,000 토큰입니다. 이번 턴의 프롬프트가 위임 룰에 해당했다면 이 기본값 대신 그 룰이 보정해 둔 상한을 씁니다. 그래서 서브에이전트가 받는 상한이 위임 안내가 메인 모델에 알린 상한과 같습니다. 구현 위임은 출력 토큰 상한을 받지 않습니다. 구현 위임이란 구현할 수 있는 대상에게 보내면서 프롬프트가 구현 설계서로 읽히고 읽기 전용이라고 밝히지 않은 위임입니다. 프롬프트에 적은 도구 호출 예산은 그대로 적용됩니다.

기대기 전에 알아야 할 한계가 두 가지 있습니다.

- 상한은 프롬프트에 남기는 요청일 뿐이고 강제력을 갖지 않습니다. 서브에이전트가 상한을 넘겨도 그 실행을 막지 못합니다.
- `subagent_type` 만 있는 위임은 에이전트 파일로 모델을 찾습니다. `t2-explore` 는 haiku로, `t1h-worker` 는 opus로 읽습니다. sprag가 모르는 에이전트 이름이면 20회와 8,000 토큰 상한을 씁니다.

effort도 정합니다. `effort` 없이 `sonnet` 모델로 보낸 위임은 프리셋 에이전트가 아니면 Claude Code 기본값인 `medium` 대신 `high` 로 돕니다. 프롬프트 끝에 붙는 표식 줄을 route-scan이 읽어 effort 상향 장부에 적습니다. 상태줄 맨 위 `🔬🔥 Effort guard ×N` 줄과 `sprag saved` 는 이 장부를 라우팅 절감과 같은 초기화 기준(`sprag saved reset routing`)으로 셉니다. 가드는 절감 장치가 아니라 품질 장치입니다. 상향은 토큰을 더 쓰고 막는 것은 아무도 다시 돌릴 줄 모르는 조용한 오답이므로 금액을 주장하지 않습니다. 줄에는 횟수만 적고(`🔬🔥 Effort guard ×N since 11/1  |  sonnet medium→high`) 한 줄 배치에서는 `🔬↑N` 칩이 됩니다. `sprag saved` 는 상향한 위임의 실행 비용을 덧붙입니다. 그 위임이 라우팅으로 아낀 금액은 라우팅 절감에 남습니다. 2026-11-07 재생 실험에서 여러 파일 조회는 medium에서 3회 중 0회, high에서 3회 중 2회 그대로 전달할 수 있었고 비용은 약 25% 늘었습니다([sprag.io/proof](https://sprag.io/proof/)). 프리셋 에이전트는 파일에 고정된 effort를 따르고, 호출이 effort를 넘기면 그 값을 그대로 둡니다.
