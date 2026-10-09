# Codex 연동

[← README](../README.ko.md) · [English](./CODEX.md)

Sprag는 Codex의 기본 훅과 `AGENTS.md`를 사용합니다. Claude Code와 함께 설치할 수 있으며,
명령에 `--agent codex`를 붙이면 Codex 기록과 설정을 선택합니다. 이 옵션은 전역 기본값을 바꾸지 않습니다.

## 설치

```sh
npm i -g sprag-cli
```

Codex가 설치되어 있으면 패키지 설치가 Claude Code 연동, 추천 룰과 함께 Codex도 설정합니다.
설치 중에 묻는 것은 없으며, 단계마다 확인하려면 `sprag install --manual`을 쓰십시오.
Claude Code 설정을 건드리지 않고 Codex만 쓰려면 postinstall을 건너뛰고 Codex 설치를 직접 실행합니다.

```sh
npm i -g sprag-cli --ignore-scripts
sprag install --agent codex
```

`sprag doctor --agent codex`는 문제가 생겼을 때 쓰는 진단 명령입니다. Codex의 `/hooks`에서 등록된 명령을
검토하고 신뢰해야 훅이 동작합니다. 설치는 훅을 등록할 뿐 신뢰 설정을 바꾸지 않습니다.
관리자 정책이나 `features.hooks = false` 설정이 훅을 막을 수도 있습니다.

설정 위치는 `$CODEX_HOME`이며, 지정하지 않으면 `~/.codex`입니다. 설치는 `hooks.json`과
전역 `AGENTS.md`에 Sprag 항목을 추가하고 기존 내용을 보존합니다. 비어 있지 않은
`AGENTS.override.md`가 있으면 그 파일을 사용하며, 변경 전 사본을 남깁니다.
Claude 설정이나 `config.toml`은 고치지 않습니다.

macOS zsh 환경에서는 설치가 tmux 설치 여부를 먼저 확인합니다. tmux가 없으면 Homebrew로 설치하고,
`CTS_NO_TMUX=1`을 지정하면 이 단계를 건너뜁니다. 이어서 zsh 연동을 추가해 `codex`를 입력하면 같은
터미널 안에 패널이 인라인으로 붙으며, 이때는 별도 창을 여는 훅을 등록하지 않습니다. tmux를 설치할 수
없거나 로그인 셸이 zsh가 아니거나 이미 사용자의 `codex` 별칭·함수가 있으면 별도 Terminal 창 방식으로
대신 동작합니다. `sprag panel shell remove --agent codex`로 끈 설정은 재설치와 업그레이드에도 그대로
유지되며, `--no-panel`은 tmux 설정과 zsh 연동을 모두 건너뜁니다.
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
| 위임 원장 | Sprag가 위임한 하위 실행의 토큰에 호출 경로의 단가를 적용해 예상 차액을 계산합니다. 직접 호출은 OpenAI 정가를, LiteLLM 공급자는 그 게이트웨이의 단가를 씁니다 |

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

설치는 이제 이 연동을 기본으로 추가합니다. macOS zsh에서 `codex`를 입력할 때 tmux 패널을 함께 열려면
다음 명령을 사용하십시오. 기존 별칭이나 함수는 덮어쓰지 않습니다.

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

Codex 0.159.2에서는 `spawn_agent`가 `PreToolUse`를 거치지 않습니다(기록용 훅을 붙여 직접
확인한 결과입니다). 그래서 실제로 동작하는 경로는 프롬프트 시점입니다. 규칙에 맞는 프롬프트가
오면 `[Sprag model routing]` 안내가 붙고, `harness init`이 넣는 AGENTS.md 블록이 이 안내를
"사용자가 위임을 요청했다"는 뜻으로 읽게 합니다. 자식은 `fork_turns "none"`으로 뜨고, 부모는
같은 일을 직접 하지 않고 `wait_agent`(제한 시간 120초 이상)로 자식이 끝나기를 기다립니다. 귀속은
자식이 route id를 되받아 적는 것에 기대지 않습니다. 대신 `SubagentStart`가 대기 중인 기록(같은
부모 세션, 같은 목표 모델, 30분 이내)에 새로 뜬 자식을 매칭해 묶습니다. 어떤 자식도 가져가지
않은 안내는 부모 세션에 다음 프롬프트가 들어올 때 닫히므로, 나중에 다른 이유로 뜬 자식이 그
안내의 절감으로 잡히지 않습니다. 같은 프롬프트 시점에 아직 장부에 반영되지 않은 위임 실행도
별도 프로세스로 계산하므로, `Routing saved`는 다음 route-scan을 기다리지 않고 위임 뒤 첫
프롬프트에서 갱신됩니다.

이 안내는 부모 세션의 컨텍스트가 `codex.delegateMinContext`(기본 60000 토큰) 아래면 붙지
않습니다. 2026-09-30 실측에서 작은 세션은 스폰·대기·검증이라는 조율 비용이 자식이 아끼는
비용보다 커서, 문턱 아래에서는 안내를 붙이는 쪽이 오히려 손해였습니다. 기준은
`sprag delegate shared min-context <토큰 수|default> --agent codex`로 바꾸고, 현재 값은
`delegate shared status`에서 확인합니다. 이 값은 `sprag mode`가 "Stored config file"로 알려 주는
설정 파일에 `codex.delegateMinContext`로 저장됩니다. `PreToolUse` 재작성은 spawn을 훅으로 보내는 Codex 버전을 위해 남아
있을 뿐, 0.159.2에서는 호출되지 않습니다. 위임 원장은 자식이 쓴 토큰을 부모 모델 단가로 환산한
추정치이며, 부모가 조율에 쓴 턴은 빼지 않습니다. 끝나기 전에 중단된 자식은 부모의 일을 대신하지
못했으므로, 그 비용 전액을 손실로 기록하고 항목에 `aborted`를 표시합니다.

SessionStart는 캐시된 후보를 읽고 필요할 때 별도 프로세스에서 갱신합니다. 명시적인 `--refresh`는
대기 주기를 건너뜁니다.

Codex 0.159.2는 훅 하나가 넘긴 컨텍스트를 약 2,450토큰까지만 보존하고, 그보다 길면 가운데를
잘라 냅니다. 그래서 SessionStart는 추정치 2,000토큰 안에 들어가는 항목만 잘리지 않은 상태로
넣습니다. 우선순위는 ratchet 룰, 한국어 지침, 응집성 지침, 문서 변환 안내, 제안 순입니다. 들어가지
못한 룰과 지침은 Sprag 데이터 디렉터리의 프로젝트별 파일에 쓰고, 컨텍스트 첫머리에서 그 파일을
먼저 읽으라고 안내합니다. rollout의 `originator`로 `codex exec` 실행을 알아보며, 답할 사람이
없으므로 seed 제안과 route 안내를 넣지 않습니다.

`seed`는 공통 위임 정책과 Codex용 래칫 프리셋을 제안합니다.
래칫과 거절 기록은 도구별로 분리하지만, 승인된 공통 정책은 원래 범위 안에서 중복 제안하지 않습니다.

### 공통 위임 정책

작업 유형, T1·T2 난도, 적용 범위와 상한은 Claude와 Codex가 같은 `model-rules.json`에서
읽습니다. 기존 Claude 활성 규칙도 복사 없이 표시하며, 삭제되거나 비활성·검토 상태인 규칙은
Codex에서 위임에 사용하지 않습니다. 프로젝트 정책은 작업 디렉터리에 대해 두 도구가 각각 정하는
프로젝트 루트 가운데 하나와 일치하면 적용합니다. Claude는 `CLAUDE.md`에서, Codex는 `AGENTS.md`에서
루트를 정하며, 정책의 루트와 작업 디렉터리의 루트는 심볼릭 링크를 푼 실제 경로로 비교합니다. 모델 ID, 역할, 사용량과 절감액은
도구별로 유지합니다.

Claude를 설치하지 않은 Codex 첫 사용자도 기록을 쌓기 전에 프리셋을 승인할 수 있습니다.

```sh
sprag seed --agent codex
sprag seed accept all --global --agent codex
sprag delegate shared status --agent codex
sprag delegate on --agent codex
# 자동으로 정해진 난도별 모델을 바꾸고 싶을 때만:
sprag delegate shared map T2 --from PARENT_MODEL --model SMALL_MODEL --effort high --agent codex
sprag delegate shared map T1 --from PARENT_MODEL --model MEDIUM_MODEL --effort medium --agent codex
```

등록 전에 전역과 프로젝트 범위를 선택합니다. 프로젝트에만 적용하려면 `--global` 대신
`--project`를 지정하십시오.

`map` 줄은 선택 사항입니다. 매핑하지 않은 난도는 Claude Code가 `haiku`와 `sonnet`을 실제 모델로
풀듯이 자동으로 정해집니다. 부모 모델의 공급자에서 가격이 매겨져 있고(게이트웨이 `/model/info` 가격,
OpenAI 직접 호출이면 공개 가격), 부모보다 싸며, 이 사용자의 Codex 세션에서 이미 실행된 모델 가운데
가장 싼 모델이 T2, 그다음 모델이 T1이 됩니다. 그런 모델이 하나뿐이면 T1은 메인 모델이 처리하고, 하나도
없으면 두 난도 모두 메인 모델이 처리합니다. 자동 결정은 `delegate on` 상태에서만 동작하고, route-scan이
기록한 실행 모델을 쓰며, 아무것도 저장하지 않으므로 가격이나 실행 이력이 바뀌면 그대로 따라갑니다.
`delegate shared status`와 설치 출력에 정해진 모델이 표시되고, 정해지지 않으면 그 이유가 표시됩니다.
끄려면 `sprag delegate shared auto off --agent codex`를 실행하십시오.

명시한 매핑은 해당 난도에서 자동 결정보다 우선합니다. 매핑은 출발 모델·공급자·난도가 일치할 때만
적용하고, 한 번 지정하면 승인된 모든 작업 유형에서 사용합니다. 공급자는 Codex 설정에서 읽으며
`--provider ID`로 지정할 수도 있습니다. 매핑이나 자동 결정만으로 절감 효과를 확인한 것은 아닙니다.
Codex에서 승인할 때 `.claude` 파일은 만들지 않으며, 나중에 Claude를 시작하면 같은 정책을 Claude용
모델 표기로 생성합니다.

프롬프트 훅은 단순 작업에 T2, 여러 단계가 필요한 작업에 T1을 제시하고, 매핑된 난도마다 route 줄을
따로 줍니다. 부모는 작업에 맞는 모델 하나를 선택하고 독립적인 작업 명세, 상한, `fork_turns "none"`과
선택한 난도의 route 줄만 전달한 뒤 결과를 기다려 검증합니다. `fork_turns "none"`은 반드시 지정해야
합니다. 전체 기록을 넘기는 포크는 부모 모델을 그대로 물려받아 모델 지정을 무시하기 때문입니다.
Codex는 사용자가 요청할 때만 스폰 모델을 지정하므로, 안내 문구는 사용자가 정책과 매핑을 승인했다는
사실을 함께 밝힙니다.

제시한 난도는 각각 프롬프트 route로 기록합니다. 이 경로는 `spawn_agent`가 `PreToolUse`를 거치지 않는
Codex 0.159.2에서 Codex 전용 규칙이 쓰는 경로와 같습니다. SubagentStart는 자식이 실행하는 모델과 같은
route에 자식을 연결하고, 부모에게 다음 프롬프트가 들어오면 고르지 않은 난도의 route를 닫습니다. 그래서
제시만 하고 연결된 자식이 없는 난도는 실행으로 집계하지 않습니다. `PreToolUse`가 실행되는 버전에서는
공통 정책에 해당하는 스폰이 모델을 지정하지 않으면 스폰 훅이 매핑된 선택지를 알려 주며 그 스폰을
거부하고, 난도는 부모가 고릅니다. 스폰 훅은 난도를 임의로 정하거나 명시된 모델·사용자 정의 역할을
덮어쓰지 않으며, 부모가 자기 모델을 명시하면 작업은 그 모델에 남습니다.

공통 정책 안내도 앞에서 설명한 Codex 전용 규칙과 같은 컨텍스트 기준을 따릅니다. 이 기준은 모델의
컨텍스트 창 크기를 바꾸지 않으며, 컨텍스트 기록이 없으면 안내하지 않습니다. 매핑은 지정한 출발 모델의 세션에만 적용되므로,
`status`는 Codex 설정의 기본 모델을 기준으로 빠진 매핑을 알려 줍니다.

```sh
sprag delegate rules --agent codex
sprag delegate shared off --agent codex
sprag delegate shared on --agent codex
sprag delegate shared unmap T2 --from PARENT_MODEL --agent codex
sprag delegate shared min-context 30000 --agent codex
```

`shared off`는 공통 정책과 매핑을 보존하며 Codex 전용 규칙에는 영향을 주지 않습니다.
`unmap`은 해당 Codex 매핑만 제거합니다. 공통 정책은 `sprag route-scan rules [rm N]`에서
관리하며, 원본 삭제는 두 도구에 반영됩니다. Codex 실행 기록에는 원본 규칙 식별자와 난도를
남기지만 사용량·절감액을 Claude 통계에 더하지 않습니다. 안내 생성만으로 실행을 집계하지 않으며,
route 표지 또는 SubagentStart 연결이 매핑된 모델로 실행한 실제 자식 세션과 일치해야 기록을 연결합니다.

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

단가는 호출이 실제로 거친 경로로 정하며, 두 출처는 서로를 대신하지 않습니다.

- ChatGPT·OpenAI 로그인이나 `api.openai.com`으로 바로 가는 API 키는 내장된 OpenAI 정가를
  씁니다. 정가는 Standard 등급의 짧은 컨텍스트 단가이고 2026-10-01에 확인했습니다. 긴 컨텍스트
  할증은 반영하지 않으므로, 그 기준을 넘는 요청은 실제보다 낮게 계산됩니다.
- LiteLLM 공급자는 그 게이트웨이의 `/model/info` 단가를 씁니다. 같은 별칭 아래 배포 단가가
  다르면 계산하지 않고, 단가 캐시는 7일 동안 사용합니다. 게이트웨이가 단가를 주지 않는 모델은
  정가로 채우지 않고 미상으로 둡니다.

공급자가 다른 동명 모델은 섞지 않으며, 이미 계산한 실행은 단가 사본을 보존합니다.
`sprag delegate rules --agent codex`는 룰마다 실측 위임 건수와 실패율, 절감액을 보여 줍니다.
실패율의 95% 신뢰 하한이 20%를 넘으면(실측 5건 이상) 조건을 좁히거나 룰을 지우라고 알립니다.
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
