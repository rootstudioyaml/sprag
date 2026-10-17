# Install and what it turns on (한국어)

[← README](../README.ko.md) · [English](./INSTALL.md)

Sprag는 Claude Code와 Codex를 지원합니다. 기본 대상은 Claude Code이며,
`--agent codex`를 붙이면 다른 연동은 그대로 두고 Codex 명령을 실행합니다.

## Codex 설치

```bash
npm i -g sprag-cli
```

명령 하나로 두 에이전트를 함께 설정합니다. 설치는 Claude Code 연동과 동봉된 추천 룰을
전체 프로젝트에 등록하고, Codex가 설치되어 있으면(`~/.codex` 또는 `$CODEX_HOME`)
Codex 훅과 `AGENTS.md` 하네스도 등록합니다. 설치 중에 묻는 것은 없으며, 단계마다
확인하려면 `sprag install --manual`을 쓰십시오.

남는 절차는 Codex 쪽 한 가지입니다. **Codex에서 `/hooks`를 열어** Sprag 훅을
신뢰하십시오. Codex가 이 승인을 요구하므로 설치 프로그램이 대신할 수 없습니다.
`sprag doctor --agent codex`는 문제가 생겼을 때만 쓰는 진단 명령입니다.

Claude Code 설정을 건드리지 않고 Codex만 쓰려면 다음과 같이 설치하십시오.

```bash
npm i -g sprag-cli --ignore-scripts
sprag install --agent codex
```

별도 터미널에서는 `sprag panel --agent codex`, tmux에서는 `sprag panel run --agent codex --`를 사용합니다.
모델 위임은 직접 켜야 하며, 나중에 규칙을 추가할 때는 적용 범위를 지정해야 합니다.
[Codex 연동 안내](./CODEX.ko.md)에서 기능과 제한을 확인할 수 있습니다.

## Claude Code 설치

**사전 준비:** Node.js ≥ 20 (`node -v`로 확인 · macOS `brew install node` · Windows `winget install OpenJS.NodeJS.LTS` · Linux/WSL은 [nvm](https://github.com/nvm-sh/nvm) 권장)

```bash
npm i -g sprag-cli
```

설치하면 Claude Code 화면 하단에 statusline이 곧바로 나타납니다. `--ignore-scripts` 옵션이나 sudo 사용 등으로 자동 등록이 되지 않았다면 `sprag install`을 실행해 직접 등록하십시오.

설치 한 번으로 **statusline과 Skill, SessionStart 훅, 🅷 Harness(5원칙), 최초 route-scan이** 모두 준비됩니다. Harness와 한국어 문체 지침은 **무엇이 추가되는지 보여 준 뒤 켤지 물어봅니다.** Harness는 `~/.claude/CLAUDE.md`에 표시가 붙은 블록으로 **추가되며**, 기존에 작성해 둔 내용은 백업한 뒤 그대로 보존합니다. 이미 설정되어 있는 경우에는 아무것도 바꾸지 않습니다.

npm의 `postinstall`은 전역 npm 설치일 때만 설정을 실행합니다. 프로젝트 의존성으로 설치한 경우와 `npx` 캐시, `CI`가 설정된 환경에서는 건너뛰고 그 사실을 한 줄로 알립니다. 훅이 `sprag` 명령을 이름으로 호출하는데, 이런 설치는 `sprag`를 PATH에 올리지 않기 때문입니다. `SPRAG_POSTINSTALL=1`은 설정을 강제로 실행하고 `SPRAG_POSTINSTALL=0`은 건너뜁니다. 어느 경우든 `sprag install`을 직접 실행하면 같은 설정이 적용됩니다.

터미널이 아닌 환경(npm의 `postinstall`, CI, 파이프 입력)에서는 질문을 건너뛰고 기존 기본값을 적용합니다. 질문 없이 진행하려면 `--yes`나 `--no-input`, 아예 건너뛰려면 `CTS_NO_HARNESS=1 npm i -g sprag-cli`를 쓰십시오. 이미 적용한 설정을 되돌리려면 `sprag harness uninit --global`을 실행하십시오.

> ⚠️ sudo로 글로벌 설치를 하면 Skill이 사용자 계정이 아니라 root의 `~/.claude`에 등록되는 함정이 있습니다. nvm이나 fnm, Volta를 사용해 사용자 영역에 설치하기를 권장합니다.

### 설치하면 켜지는 기능과 직접 켜야 하는 기능

설치 시점에 비용이 들지 않는 기능은 전부 자동으로 켜집니다. 수동으로 남겨 둔 항목은 Claude Code 자체의 설정을 바꾸거나, 적용 범위를 사람이 정해 주어야 하는 것들뿐입니다.

| 기능 | 설치 직후 상태 | 끄는 방법 |
|---|---|---|
| statusline (진단 칩·절감 원장) | 켜짐 | `sprag uninstall` |
| `/claude-token-saver` Skill | 켜짐 | 위와 같습니다 |
| SessionStart 훅 (route-scan 재분석) | 켜짐 | 위와 같습니다 |
| UserPromptSubmit 훅 (brief 주입) | 켜짐 | 위와 같습니다 |
| 최초 route-scan (최근 14일 로그 분석) | 설치 중 즉시 1회 실행 | 해당 없습니다 |
| 🅷 Harness 5원칙 (`~/.claude/CLAUDE.md`) | 켜짐 (터미널에서는 내용을 보여 주고 한 번 묻습니다) | `harness uninit --global` · `CTS_NO_HARNESS=1` |
| doc2md 훅 (Read·Edit·Write·프롬프트) | 켜짐 | `doc2md off` · `CTS_NO_DOC2MD=1` |
| doc2md 변환기(markitdown venv) | 터미널에서 설치 여부를 묻고, 비대화형 설치에서는 명령만 안내합니다 | `doc2md install-converter` 로 나중에 설치 |
| 한국어 문체 지침 | 시스템 로케일이 한국어면 켜짐 (터미널에서는 묻습니다) | `korean off` · `CTS_NO_KOREAN=1` |
| compact-window 경고 칩 | 켜짐 | `compact-window off` |
| 업데이트 안내 칩 | 켜짐 | `CTS_NO_UPDATE_CHECK=1` |
| ⭐ 스타 안내 (라우팅·doc2md 절감이 $10 에 이르면 하루 동안 한 번만) | 켜짐 | `CTS_NO_NOTE=1` |
| **compact-window 값 고정** (`autoCompactWindow` 500k) | **꺼짐 — 직접 실행해야 합니다** | `compact-window set --global` 또는 `--project` |
| **모델 피팅 룰 승인** (`ratchet-model.md` 위임 룰) | **후보만 제안합니다** | `route-scan rules` 로 확인하고 승인·삭제 |
| `handoff` (한도 임박 시 작업 백업) | 필요할 때 직접 실행하는 명령입니다 | 해당 없습니다 |

`compact-window set` 은 Claude Code 의 `settings.json` 에 값을 적고, 전역과 프로젝트 중 어디에 적을지는 사람이 정해야 하므로 자동으로 실행하지 않습니다. 모델 피팅 룰도 같은 이유로 승인 단계를 남겨 두었습니다. 어떤 작업을 더 싼 티어에 맡길지는 사용자의 판단이 필요합니다.

### 네트워크 접근

Sprag 이 측정하는 값은 모두 사용자 컴퓨터의 파일에서 나옵니다. 아래 표는 Sprag 이 네트워크로 나가는 지점 전부이며, 게시된 패키지(3.68.0)를 정적으로 스캔해서 뽑았습니다. statusline 을 그리는 동안 네트워크를 기다리는 일은 없습니다. 요청은 분리된 자식 프로세스가 보내고, 그리는 쪽은 캐시된 답만 읽습니다.

| 목적지 | 시점 | 보내는 내용 | 끄는 방법 |
|---|---|---|---|
| `registry.npmjs.org/sprag-cli/latest` | statusline 에서 하루 한 번, SessionStart 훅에서 3시간마다 | 요청 자체만 보내고 식별 정보는 없습니다 | `CTS_NO_UPDATE_CHECK=1` 또는 `NO_UPDATE_NOTIFIER=1` |
| `api.github.com/repos/rootstudioyaml/sprag/releases/tags/<버전>` | 위 확인에서 새 버전이 보이면 그 릴리스의 핵심 세 줄을 가져옵니다 | 요청 자체만 보냅니다 | 위와 같습니다 |
| 사용자의 LiteLLM 게이트웨이: `GET /key/info`, `/user/info`, `/model/info` | `ANTHROPIC_BASE_URL` 이 게이트웨이를 가리키고 키가 있을 때만 동작합니다. 예산 게이지는 statusline 주기로, `/model/info` 는 `sprag profile-map --refresh` 를 실행할 때나 예산 갱신에 편승해서 갱신합니다. Codex 는 자체 설정의 provider 주소를 씁니다 | 사용자가 이미 쓰는 키를 `Authorization` 헤더에 넣습니다. 키는 Sprag 의 캐시 파일에 적지 않습니다 | `ANTHROPIC_BASE_URL` 을 해제하거나 `sprag mode` 에서 예산 세그먼트를 뺍니다 |
| `gh` CLI 를 통한 GitHub 이슈 | `sprag feedback` 을 실행했고 `gh` 가 로그인된 경우에만 | 입력한 메시지와 버전·OS·Node.js 버전 | `--anonymous` 를 붙이면 `gh` 경로를 건너뜁니다 |
| `docs.google.com/forms/…/formResponse` | `sprag feedback` 을 실행했고 `gh` 를 쓸 수 없는 경우에만 | 같은 메시지와 메타데이터를 관리자가 읽는 익명 폼으로 보냅니다 | `feedback` 을 실행하지 않으면 됩니다. 실행하면 미리 채운 이슈 URL 과 함께 로컬 사본도 남습니다 |
| `npm install -g sprag-cli@<버전>` | `sprag upgrade` 에서 제안을 수락한 뒤에만 | 일반 npm 설치입니다 | 제안을 거절합니다 |
| Sprag 전용 venv 에 `pip install markitdown`, Sprag 데이터 디렉터리에 `npm install openfig-core` | doc2md 변환기를 터미널에서 설치하기로 했을 때, 또는 문서가 처음 변환기를 필요로 할 때 | 일반 패키지 설치입니다. `openfig-core` 는 `--ignore-scripts` 로 설치합니다 | `CTS_DOC2MD_NO_AUTOINSTALL=1` 로 자동 설치만 막을 수 있습니다 |

사용량 데이터, 트랜스크립트 내용, 프로젝트 경로는 컴퓨터 밖으로 나가지 않습니다. 절감 원장과 route-scan 룰, 히스토리 파일은 Skill 의 저장 위치 절에 적힌 사용자 데이터 디렉터리에만 남습니다.
