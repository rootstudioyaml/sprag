# 팀 기능

[← README](../README.ko.md) · [English](./TEAM.md)

Sprag 은 기본적으로 로컬에서만 동작합니다. 팀 기능은 켜야만 쓰이는 선택 기능입니다. 팀원마다 하루 지출과 절감액을 한 대시보드에서 보고, 팀 소유자가 승인한 래칫 룰을 함께 쓸 수 있습니다. `sprag team join <토큰>` 을 실행하거나 환경에 `SPRAG_TEAM_TOKEN` 을 지정하기 전에는 아무것도 전송하지 않습니다. `CTS_NO_TEAM_SYNC=1` 을 지정하면 다른 설정과 상관없이 팀 관련 네트워크 통신이 모두 꺼집니다.

## 보내는 것과 보내지 않는 것

참여하면 Sprag 은 로컬 날짜 기준으로 하루에 한 행씩 올립니다.

| 항목 | 내용 |
|---|---|
| 지출(USD) | 로컬 세션 로그로 계산한 금액 |
| 절감(USD) | 라우팅 원장과 doc2md 원장에서 가져온 금액 |
| 위임 실행 횟수 | 그날 위임한 실행의 수 |
| 모델 계열 비중 | 위임 실행 중 모델 계열별 비율 |
| Sprag 버전 | 설치된 버전 |
| 에이전트 | `claude` 또는 `codex` |
| 표시 이름 | 참여할 때 정한 이름이며, 기본값은 OS 사용자 이름 |

보내지 않는 것은 프롬프트, 대화 기록, 파일 경로, 프로젝트 이름, 룰 내용, API 키입니다. 룰은 직접 `sprag team propose` 를 실행할 때만 밖으로 나갑니다.

업로드는 6시간에 한 번 이하로 실행됩니다. SessionStart 훅이 띄운 분리된 자식 프로세스가 보내며, statusline 을 그리는 경로에서는 절대 실행되지 않습니다.

목적지는 `https://hiycfjwswtkixyoqkznm.supabase.co/rest/v1/rpc/*` 입니다(Supabase, ap-northeast-2 리전). 호출하는 RPC 는 `team_join`, `ledger_upsert`, `team_rules_get`, `team_rule_propose`, `team_leave` 입니다.

## 개인으로 참여하기

팀 소유자에게 초대 토큰을 받은 뒤 실행합니다.

```bash
sprag team join <토큰> --name "미나"
```

Sprag 이 올라갈 항목 목록을 보여 주고 확인을 묻습니다. `--name` 은 표시 이름이며 기본값은 OS 사용자 이름입니다. 터미널이 없는 셸에서는 `--yes` 를 붙여 확인을 대신합니다. 토큰을 생략하면 `SPRAG_TEAM_TOKEN` 을 읽습니다.

결과는 `sprag team status` 로 확인합니다.

## 조직 단위로 등록하기

구성원이 각자 명령을 실행하지 않아도 모든 컴퓨터를 등록하려면 환경에 `SPRAG_TEAM_TOKEN=<토큰>` 을 지정합니다. 흔한 위치는 두 곳입니다.

- 셸 프로필: `export SPRAG_TEAM_TOKEN=<토큰>`
- Claude Code 관리 설정: `{"env":{"SPRAG_TEAM_TOKEN":"…"}}`

컴퓨터는 다음 세션이 시작될 때 참여합니다. 그다음 첫 세션에는 팀 이름과 두 명령을 알리는 한 줄 안내가 나옵니다. `sprag team status --show-payload` 는 보내는 내용을 보여 주고, `sprag team leave` 는 전송을 멈춥니다.

`leave` 는 환경 변수보다 우선합니다. 팀에서 나온 컴퓨터는 변수가 남아 있어도 저절로 다시 참여하지 않습니다. 소유자가 새 토큰을 발급하고 구성원이 `sprag team join` 을 다시 실행해야 다시 참여합니다.

## 팀 룰

팀 소유자는 대시보드에서 룰을 승인합니다. 구성원도 룰을 제안할 수 있습니다.

```bash
sprag team propose "커밋 전에 lint 실행" --scope ratchet
```

`--scope` 는 `ratchet`(기본값) 또는 `model` 입니다. 제안은 소유자가 승인할 때까지 대기 상태로 남습니다.

승인된 룰은 다음 동기화 때 내려옵니다. Sprag 은 이를 `~/.claude/ratchet-team.md`(Codex 는 `<CODEX_HOME>/ratchet-team.md`)에 쓰고, 그 파일이 있는 동안 `~/.claude/CLAUDE.md` 의 전역 harness 블록에서 import 합니다. Sprag 이 세션을 시작할 때 파일을 통째로 다시 쓰므로 직접 고치지 마십시오. `sprag team rules` 는 받아 둔 룰을 보여 줍니다. `sprag team leave` 는 멤버 키, 캐시, import 를 지웁니다.

## 상태 확인, 전송 내용 확인, 나가기

| 명령 | 설명 |
|---|---|
| `sprag team join [토큰] [--name <이름>] [--yes]` | 팀에 참여 |
| `sprag team status [--show-payload]` | 팀, 플랜, 프롬프트 수집 설정, 표시 이름, 마지막 동기화를 보여 줍니다. `--show-payload` 를 붙이면 올라갈 하루 단위 행도 그대로 출력합니다 |
| `sprag team sync [--force]` | 지금 업로드하고 룰을 받습니다. `--force` 는 6시간 간격을 무시합니다 |
| `sprag team rules` | 받아 둔 팀 룰 보기 |
| `sprag team propose "<내용>" [--scope ratchet\|model]` | 팀에 룰 제안 |
| `sprag team leave` | 팀에서 나가고 업로드 중단 |

## 대시보드

https://sprag.io/team/ 에서 소유자가 이메일 코드로 로그인하고, 팀을 만들고, 초대 토큰을 받습니다. 여기서 최근 30일 동안의 구성원별 지출과 절감액을 보고, 룰을 승인하거나 삭제하고, 구성원을 내보낼 수 있습니다.

## 플랜

Free, Team(좌석당 월 $5), Team Plus(좌석당 월 $10, 프롬프트 수집 포함)가 있습니다. 자세한 내용은 https://sprag.io/pricing/ 에 있습니다.

## 개인정보 관련 참고

- 소유자는 구성원별 하루 합계를 봅니다. 세션이나 프롬프트는 보지 못합니다.
- 구성원은 `sprag team status --show-payload` 로 같은 내용을 직접 볼 수 있습니다.
- 프롬프트 수집은 Team Plus 정책이며, 소유자가 대시보드에서 켤 수 있습니다. 구성원은 `sprag team status` 에서 설정 상태를 확인합니다. 현재 CLI 는 프롬프트를 아직 올리지 않습니다. 업로드는 이후 별도 릴리스에서 다룹니다.
- 룰 내용은 `sprag team propose` 를 통해서만 밖으로 나갑니다.

## 파일과 환경 변수

| 이름 | 용도 |
|---|---|
| `<사용자 데이터 디렉터리>/team.json` | 참여 상태와 멤버 키(권한 0600) |
| `<사용자 데이터 디렉터리>/team-rules.json` | 마지막 동기화 때 받은 룰 |
| `~/.claude/ratchet-team.md` | Claude Code 용 승인된 팀 룰이며 `~/.claude/CLAUDE.md` 에서 import 합니다 |
| `<CODEX_HOME>/ratchet-team.md` | Codex 용 같은 룰 |
| `SPRAG_TEAM_TOKEN` | 초대 토큰이며, 다음 세션 시작 때 컴퓨터를 등록합니다 |
| `CTS_NO_TEAM_SYNC=1` | 팀 관련 네트워크 통신을 모두 끕니다 |
