<!-- REVIEW: confirm the release version and date, then move this draft to vX.Y.Z.md before publishing. -->

- **Sprag supports Codex through native hooks and AGENTS.md.** Harness rules, document conversion, and writing checks can coexist with the Claude Code integration.
- **A companion panel shows Codex session usage, context, and recorded limits.** Run it in a separate terminal or alongside Codex in tmux, with optional macOS launch integration.
- **Codex delegation and usage accounting stay separate from Claude Code.** Routing is opt-in, and savings estimates require attributed child usage and matching LiteLLM prices.

### Installation

For Codex-only use, skip the package's existing Claude Code postinstall:

```sh
npm i -g sprag-cli --ignore-scripts
sprag install --agent codex
```

Review and trust the registered commands in Codex `/hooks`. Registration does
not grant trust. Existing instructions and other hooks are preserved, changed
files are backed up, and `config.toml` and Claude Code settings are unchanged.
The default agent remains Claude Code; Codex commands require `--agent codex`.
Keep using the two commands above for Codex-only upgrades.

### Session Continuity

`doctor` reports integration state, while `brief`, `history`, and `handoff` help
carry recorded context into the next session. The panel follows local rollout
logs. Inline launches bind to their exact session and wait for the trusted
SessionStart hook before displaying usage. `--statusline` prints a single frame;
it is not a shell command installed in Codex's native footer.

### Accounting Limits

Cache clocks use recorded cache activity and resolved provider retention
policies, not measured expiry times. Routing estimates compare the child's
measured tokens at the parent and child prices; they are not billed savings.
Unknown prices, session billing, and exact cache expiry remain unavailable.
Document conversion counts distinct sources prepared through Codex and does not
reuse Claude-based dollar estimates. Automatic document guards cover recognized
reads and writes, not arbitrary extraction scripts.

See the [Codex guide](https://sprag.io/docs/codex/) for panel setup, supported
workflows, diagnostics, and removal.

---

## 한국어

- **Codex에서 하네스와 문서 변환, 한국어 쓰기 검사를 사용할 수 있습니다.** 네이티브 훅과 `AGENTS.md`로 연동하며, Claude Code 설정과 함께 사용할 수 있습니다.
- **동반 패널이 Codex 세션의 토큰과 컨텍스트, 기록된 사용 한도를 표시합니다.** 별도 터미널이나 tmux에서 실행하며, macOS에서는 선택적으로 자동 실행을 설정할 수 있습니다.
- **Codex 위임 규칙과 사용량 집계를 Claude Code와 분리합니다.** 위임은 명시적으로 켜야 하며, 절감 추정에는 해당 자식 세션의 사용량과 일치하는 LiteLLM 단가가 필요합니다.

### 설치

Codex만 사용한다면 기존 Claude Code용 postinstall을 건너뜁니다.

```sh
npm i -g sprag-cli --ignore-scripts
sprag install --agent codex
```

Codex의 `/hooks`에서 등록된 명령을 검토하고 신뢰해야 훅이 실행됩니다.
설치 명령은 훅을 등록할 뿐 신뢰 권한을 부여하지 않습니다. 기존 지침과
다른 도구의 훅을 보존하고 변경 파일을 백업하며, `config.toml`과 Claude Code
설정은 그대로 둡니다. 기본 에이전트는 Claude Code이므로 Codex 명령에는
`--agent codex`를 붙여야 합니다. Codex 전용 업그레이드에도 위 두 명령을 사용합니다.

### 작업 인계

`doctor`는 연동 상태를 진단하고, `brief`, `history`, `handoff`는 기록된
컨텍스트를 다음 세션으로 전달하는 데 사용합니다. 패널은 로컬 rollout 로그를
읽으며, tmux 실행은 정확한 세션에 바인딩합니다. 신뢰한 SessionStart 훅이
세션을 연결하기 전에는 다른 세션의 수치를 표시하지 않고 기다립니다.
`--statusline`은 한 번 출력하는 명령이며 Codex 네이티브 하단 표시줄에 설치하는
셸 명령이 아닙니다.

### 집계 범위

캐시 타이머는 기록된 캐시 사용과 확인한 제공자 보존 정책을 기준으로 표시하며,
실제 만료 시각을 측정하지 않습니다. 위임 절감 추정은 자식 세션의 토큰을 부모와
자식 모델의 단가로 각각 계산한 차이이며, 실제 청구액의 차이가 아닙니다.
알 수 없는 단가와 세션 청구액, 정확한 캐시 만료 시각은 미상으로 남깁니다.
문서 변환은 Codex에서 준비한 원본 경로의 고유 개수를 집계하고, Claude 기준
절감액을 가져오지 않습니다. 자동 문서 보호는 인식할 수 있는 읽기와 쓰기에
적용하며, 임의의 추출 스크립트까지 검사하지는 않습니다.

패널 설정과 지원 기능, 진단, 제거 절차는
[Codex 가이드](https://sprag.io/docs/ko/codex/)에서 확인할 수 있습니다.
