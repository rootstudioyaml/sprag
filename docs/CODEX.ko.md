# Codex 연동

[← README](../README.ko.md) · [English](./CODEX.md)

Sprag는 Codex의 기본 훅과 `AGENTS.md`를 사용합니다. Claude Code와 함께 설치할 수 있으며,
명령에 `--agent codex`를 붙이면 Codex 기록과 설정을 선택합니다. 이 옵션은 전역 기본값을 바꾸지 않습니다.

## 설치

```sh
npm i -g sprag-cli --ignore-scripts
sprag install --agent codex
sprag doctor --agent codex
```

이미 Sprag를 설치했다면 두 번째 명령부터 실행하십시오. Codex의 `/hooks`에서 등록된 명령을
검토하고 신뢰해야 훅이 동작합니다. 설치는 훅을 등록할 뿐 신뢰 설정을 바꾸지 않습니다.
관리자 정책이나 `features.hooks = false` 설정이 훅을 막을 수도 있습니다.

설정 위치는 `$CODEX_HOME`이며, 지정하지 않으면 `~/.codex`입니다. 설치는 `hooks.json`과
전역 `AGENTS.md`에 Sprag 항목을 추가하고 기존 내용을 보존합니다. 비어 있지 않은
`AGENTS.override.md`가 있으면 그 파일을 사용하며, 변경 전 사본을 남깁니다.
Claude 설정이나 `config.toml`은 고치지 않습니다.

macOS에서는 별도 패널을 여는 훅도 기본 등록합니다. `--no-panel`로 제외할 수 있고,
`sprag panel auto off --agent codex`로 끈 설정은 재설치해도 유지합니다.
패널 실행 여부는 `sprag panel doctor --agent codex`로 확인하십시오.

## 지원 기능

| 기능 | Codex 동작 |
|---|---|
| 하네스 | 전역·프로젝트 AGENTS.md에 다섯 원칙을 등록합니다 |
| 래칫 규칙 | 전역·프로젝트 규칙을 세션 시작과 재개 시 전달합니다 |
| 반복 실패 탐지 | 최근 명령·패치 실패에서 `ratchet?` 후보를 찾습니다 |
| 위임 후보 | 프로젝트·공급자·상위 모델별로 반복된 단순 작업을 찾습니다 |
| seed | 호환되는 래칫 프리셋을 제안하고 응답을 별도 저장합니다 |
| 문서 변환 | PDF·Office·Figma 문서를 Markdown으로 변환하고 캐시 덮어쓰기를 막습니다 |
| 한국어 검사 | 파일 쓰기 후 문체 위반을 검사하며 block·warn·off를 지원합니다 |
| 상태 표시 | 별도 패널, tmux 패널, 일회성 상태줄을 제공합니다 |
| 브리핑·이력 | 최신 컨텍스트와 사용량 경고를 알리고 세션별로 저장합니다 |
| 위임 원장 | Sprag가 위임한 하위 실행과 LiteLLM 단가로 예상 차액을 계산합니다 |

## 패널과 보고서

```sh
sprag panel --agent codex
sprag panel run --agent codex --
sprag --statusline --text --agent codex
sprag --agent codex --days 7 --format json
sprag brief --agent codex
sprag history --agent codex --days 7
sprag handoff --agent codex
```

별도 패널은 현재 프로젝트의 최신 기본 세션을 따릅니다. `--session ID`를 붙이면 특정 세션을
고정합니다. tmux 패널은 실행마다 별도 연결 파일을 사용하므로 같은 프로젝트의 다른 세션이
화면을 차지하지 않습니다. 연결 전에는 대기 상태를 표시합니다. 일부 Codex 버전은 첫 프롬프트를
제출한 뒤에 SessionStart 훅을 실행하므로 그때 패널 연결이 이루어집니다.

tmux 실행은 `--no-daemon`과 호출별 상태줄 설정을 사용합니다. Codex의 모델·추론 수준과
설정 파일은 바꾸지 않으며, `--keep-native-statusline`으로 기존 상태줄을 유지할 수 있습니다.
패널은 Codex 기본 상태줄에 셸 명령을 넣는 방식이 아닙니다.

macOS zsh에서 `codex`를 입력할 때 tmux 패널을 함께 열려면 다음 명령을 사용하십시오.
기존 별칭이나 함수는 덮어쓰지 않습니다.

```sh
sprag panel shell install --agent codex
sprag panel shell remove --agent codex
```

사용량은 로컬 `sessions`와 `archived_sessions`의 rollout 기록에서 읽습니다. 중복된 누적 토큰을
다시 더하지 않으며, 캐시 입력과 추론 출력도 각각 입력·출력에 이미 포함된 부분으로 처리합니다.
기록은 안정된 공개 API가 아니므로 일부가 빠지거나 형식이 바뀌면 값이 불완전할 수 있습니다.
사용량 갱신 횟수는 정확한 API 호출 횟수가 아닙니다.

## 위임 후보와 프리셋

```sh
sprag route-scan --refresh --agent codex
sprag delegate rules add R1 --project --agent codex
sprag route-scan dismiss R1 --agent codex
sprag delegate on --agent codex
sprag seed --agent codex
sprag seed accept all --project --agent codex
sprag seed skip all --agent codex
sprag seed reset --agent codex
```

위임 후보에는 같은 유형의 완료된 단순 작업이 세 번 이상 필요합니다. 중단된 작업과 이미 위임한
작업, 오류가 많은 작업, 도중에 사용자가 방향을 바꾼 작업은 제외합니다. 같은 세션의 보관 사본도
중복 집계하지 않습니다. 등록 전에는 사용자가 전역과 프로젝트 중 적용 범위를 정해야 합니다.

단가와 실행 근거를 확인할 수 있으면 더 저렴한 모델을 제안합니다. 단가가 없으면 후보를 유지하되
등록할 때 `--model ID`를 요구합니다. 모델 사용 가능 여부는 실제 공급자 설정에 달려 있습니다.
명시한 모델과 사용자 정의 역할은 유지하며, 사용할 수 없는 하위 에이전트 도구를 만들어 내지 않습니다.

SessionStart는 캐시된 후보를 읽고 필요할 때 별도 프로세스에서 갱신합니다. 명시적인 `--refresh`는
대기 주기를 건너뜁니다. `seed`는 Claude의 Haiku·Sonnet 프리셋을 가져오지 않으며,
Codex의 수락·거절 기록도 Claude 기록과 분리합니다.

## 래칫 규칙

```sh
sprag harness init --project --agent codex
sprag harness promote "Run the changed module's tests before completion." --project --agent codex
sprag harness list --project --agent codex
sprag harness promote 1 --session SESSION_ID --project --agent codex
sprag harness prune --global --older-than 6 --dry-run --agent codex
```

규칙은 `<프로젝트>/.codex/ratchet.md`나 `$CODEX_HOME/ratchet.md`에 저장합니다.
반복 실패 탐지는 최근 2 MiB, 도구가 실행된 30턴, 30분 범위를 확인합니다. 검색 결과가 없다는
종료 코드 등은 제외합니다. 숫자로 후보를 등록하면 원인과 예방책을 적을 TODO가 생기므로,
원인을 확인한 뒤 완전한 조건·행동 규칙으로 다듬어야 합니다. 후보 번호는 세션별 임시 값입니다.

## 문서와 문체

```sh
sprag doc2md install-converter --agent codex
sprag doc2md report.pdf --agent codex
sprag korean on --agent codex
sprag korean lint warn --agent codex
sprag cohesion on --agent codex
```

문서 변환기는 Claude와 공유하지만 Codex는 별도 Markdown 뷰와 문서 누계를 사용합니다.
변환 캐시를 고쳐도 원본에는 반영되지 않습니다. 문서를 수정하려면 원본을 복사하고 형식을
지원하는 라이브러리로 복사본을 편집한 뒤 다시 변환하십시오. 텍스트 추출만으로 차트·이미지·배치를
검증했다고 말할 수 없습니다. 실패와 잘린 결과는 그대로 보고해야 합니다.

훅은 지원되는 파일 읽기와 단순한 `cat`·`head`·`tail`, 인식 가능한 쓰기 대상을 처리합니다.
임의의 추출 스크립트나 복합 셸 명령을 모두 가로채지는 않습니다. `doc2md off`는 Codex의 자동
변환과 문서 쓰기 보호를 끕니다. 문체 설정은 공유하지만 기능을 켤 때는 Codex 훅을 먼저 등록합니다.

## 단가와 한계

```sh
sprag route-scan savings --refresh --agent codex
sprag cache status --refresh --agent codex
sprag capabilities --agent codex
```

위임 원장은 Sprag가 실행 시 기록한 route ID와 하위 세션 기록이 일치할 때만 집계합니다.
하위 실행의 토큰을 고정하고 부모·자식 단가를 각각 적용한 차이이므로, 실제 청구서의 절감액은
아닙니다. 손해는 음수로 남기며 단가나 사용량이 없으면 0 대신 미상으로 표시합니다.

단가는 설정된 LiteLLM의 `/model/info`에서 읽습니다. 공급자가 다른 동명 모델을 섞지 않고,
같은 별칭 아래 배포 단가가 다르면 계산하지 않습니다. 단가 캐시는 7일 동안 사용하며 이미
계산한 실행은 단가 사본을 보존합니다. 직접 OpenAI 연결이나 구독 요금은 추정하지 않습니다.
위임 후 `--refresh`로 원장을 갱신할 수 있고, 아직 일치하지 않은 기록은 7일 동안 찾습니다.

캐시 타이머는 확인된 공급자 정책과 기록된 캐시 사용 시각을 보여 줍니다. 정확한 만료 시각이나
다음 요청의 적중을 보장하지 않습니다. 패널의 LiteLLM 예산·단가 조회는 기존 인증 정보를
사용하며, 원본 세션 내용을 전송하지 않습니다. 일회성 상태줄은 저장된 정보만 읽습니다.

## 제거와 업그레이드

```sh
sprag uninstall --agent codex
npm i -g sprag-cli --ignore-scripts
sprag install --agent codex
```

제거는 Codex 훅과 전역 하네스 블록만 대상으로 합니다. 프로젝트 하네스, 래칫 규칙, 백업과
공유 상태는 남습니다. 일반 npm 설치는 Claude postinstall을 실행하므로 Codex만 사용한다면
업그레이드에도 `--ignore-scripts`를 유지하십시오.

공식 인터페이스는 [Codex 훅](https://developers.openai.com/codex/hooks/)과
[AGENTS.md 안내](https://developers.openai.com/codex/guides/agents-md/),
[설정 참조](https://developers.openai.com/codex/config-reference/)에서 확인할 수 있습니다.
