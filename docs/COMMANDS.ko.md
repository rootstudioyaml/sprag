# Command reference (한국어)

[← README](../README.ko.md) · [English](./COMMANDS.md)

## 주요 명령

셸에서 직접 실행합니다 (Claude Code 안에서는 `/claude-token-saver` Skill 하나만 사용):

| 명령 | 설명 |
|---|---|
| `sprag` | 최근 1일 진단 리포트 (`--days N` / `--hours N`) |
| `sprag last` | 가장 최근 경고 1건 + 처방 |
| `sprag history` | 최근 7일 경고 전이 로그 |
| `sprag handoff` | 작업 상태를 `HANDOFF-*.md`로 백업 (캡 임박 시) |
| `sprag mode [keywords...]` | 출력 설정 (`icon`/`text`, `ko`/`en`, `1h`~`30d` 윈도 등) |
| `sprag harness ...` | 🅷 Harness 관리 (아래 참고) |
| `sprag route-scan` | 상위 모델이 반복 처리한 쉬운 작업을 감지해 haiku 위임 래칫 룰을 제안합니다 (아래 참고) |
| `sprag route-scan savings` | 라우팅 절감 원장입니다. 모델 이동별 합계와 실행별 내역을 함께 보여 주며, 표시되는 금액의 근거가 됩니다 |
| `sprag compact-window` | 1M 컨텍스트를 쓰면서 자동 압축 창이 설정되지 않았으면 경고하고, `set`으로 40만에 고정합니다 (아래 참고) |
| `sprag korean on\|off\|status` | 한국어 문체 지침을 세션 시작 시 주입하고, 쓰기 시점 검사를 함께 설치합니다 (아래 참고) |
| `sprag cohesion on\|off\|status\|show` | 영어 문장 연결(응집성) 지침을 세션 시작 시 주입합니다 |
| `sprag korean lint block\|warn\|off` | 쓰기 시점 검사가 위반을 어떻게 처리할지 정합니다 |
| `sprag korean lint scope all\|prose` | 검사 범위를 모든 텍스트 파일과 문서 전용 사이에서 고릅니다 |
| `sprag doc2md on\|off` | 첨부 문서를 모델이 읽기 전에 Markdown 으로 변환합니다 (아래 참고) |
| `sprag doc2md <파일>` | 파일 하나를 직접 변환합니다. 진단 용도이며 실패 이유를 그대로 출력합니다 |
| `sprag delegate on\|off\|status` | Task/Agent 위임 프롬프트마다 상한과 필요한 경우 한국어 지침, 세션이 이미 읽은 경로를 덧붙입니다 (아래 참고) |
| `sprag mode ttl=5m\|1h\|auto` | 캐시 TTL 버킷을 직접 지정합니다. 기본값 `auto`는 실측값을 먼저 보고, 실측값이 없으면 게이트웨이 여부로 판정합니다 |
| `sprag --version` | 설치된 버전을 출력합니다 |
| `sprag update-check` | 새 버전이 있는지 확인합니다 (`--refresh`로 즉시 조회, `--dismiss`로 그 버전 안내 끄기) |
| `sprag upgrade` | 설치 경로에 맞는 명령으로 최신 버전을 설치합니다 (`--print`로 실행 없이 명령만 확인) |
| `sprag install` | Skill·statusline 수동 등록 |
| `sprag uninstall [--purge]` | 등록한 훅·statusline·Skill 제거. 기록된 절감액은 남기며, `--purge` 를 붙이면 상태 디렉터리까지 지웁니다 |

출력 언어는 설치할 때 한 번 정합니다. 터미널에서 설치하면 시스템 로케일을 기본값으로 제시하고 한국어를 쓸지 물어보며, 비대화형 설치에서는 로케일 판정을 그대로 기록합니다. 한 번 기록되면 업그레이드해도 다시 묻지 않습니다. 나중에 바꿀 때는 `mode ko`나 `mode en`을 쓰고, 스크립트에서 설치할 때는 `CTS_LANG=ko` 또는 `CTS_LANG=en`으로 지정할 수 있습니다. statusline의 칩은 언제나 기호로 표시합니다. 전체 옵션은 [전체 명령 문서](./COMMANDS.md)를 참고하십시오.

## `sprag delegate`: 위임 프롬프트를 보내기 전에 고쳐 씁니다

옵트인이고 기본값은 꺼짐입니다. `sprag delegate on` 을 실행하면 `Task`/`Agent` 호출에 PreToolUse 훅이 걸리고, 위임 프롬프트 뒤에 최대 네 섹션이 조건별로 붙습니다.

| 섹션 | 붙는 조건 |
|---|---|
| 상한과 출력 형식 | 패키지에 함께 실리는 `presets/delegation/bounds.md` 가 있으면 언제나 붙습니다 |
| 한국어 문체 지침 | 프롬프트에 한글이 있거나 `.ko.` 대상을 가리키거나 영어로 `in Korean` 이라고 적혀 있으면서, 동시에 `korean` 기능이 켜져 있을 때만 나타납니다. 한글 프롬프트라도 `korean` 이 꺼져 있으면 이 섹션은 빠집니다 |
| 래칫 안내 | `~/.claude/ratchet.md` 가 있고 `~/.claude/CLAUDE.md` 가 그 파일을 아직 `@` 로 import 하지 않았을 때 실립니다 |
| 이미 읽은 경로 | 호출한 세션의 트랜스크립트 꼬리에서 `Read`·`Edit`·`MultiEdit`·`Write`·`NotebookEdit`·`Grep`·`Glob` 가운데 현재 작업 디렉터리 안쪽 경로를 하나라도 찾았을 때 채워집니다. 파일만 올립니다. `Grep`·`Glob` 의 인자가 디렉터리면 제외합니다. 읽으라고 건네면 서브에이전트가 상한 한 칸을 실패로 쓰기 때문입니다. 줄을 끊거나 인용을 닫을 수 있는 문자(제어 문자, 유니코드 줄 구분자, 백틱)가 든 경로도 제외합니다. 이 목록은 프롬프트 안에서 한 줄이 한 경로이기 때문입니다. 가장 최근 것부터 최대 15개까지 붙습니다 |

상한과 출력 형식 섹션의 도구 호출 수는 대상마다 다릅니다. `model`(없으면 `subagent_type`)이 `haiku` 와 일치하면 도구 호출 8회·출력 1,500 토큰이고, 아니면 20회·8,000 토큰입니다.

기대기 전에 알아야 할 한계가 두 가지 있습니다.

- 상한은 프롬프트에 남기는 요청일 뿐이고 강제력을 갖지 않습니다. 서브에이전트가 상한을 넘겨도 그 실행을 막지 못합니다.
- 위임 호출에 `model` 없이 `subagent_type` 만 있고, 그 에이전트 자체가 haiku 로 설정된 경우에는 호출값만으로 이를 구분할 수 없어 느슨한 20회·8,000 토큰 상한이 그대로 적용됩니다.

