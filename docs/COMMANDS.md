# Command reference

[← README](../README.md) · [한국어](#한국어)

## Commands

Run these in your shell (inside Claude Code, the `/claude-token-saver` Skill is the only entry point):

| Command | What it does |
|---|---|
| `sprag` | Last-1-day diagnostic report (`--days N` / `--hours N`) |
| `sprag last` | Most recent warning + remediation |
| `sprag history` | Last 7 days of warning transitions |
| `sprag handoff` | Back work up to `HANDOFF-*.md` before a cap blocks you |
| `sprag mode [keywords...]` | Output config (`icon`/`text`, `en`/`ko`, `1h`–`30d` window, …) |
| `sprag harness ...` | 🅷 Harness management (below) |
| `sprag route-scan` | Detect recurring easy work on expensive models → propose haiku-delegation ratchet rules (below) |
| `sprag route-scan savings` | The routing-savings ledger — per-model-change rollup + per-run log (the evidence behind the figure) |
| `sprag compact-window` | Warn when a 1M-context session has no auto-compact cap → pin 400k with `set` (below) |
| `sprag korean on\|off\|status` | Inject Korean writing guidance at session start and install the write-time check (below) |
| `sprag cohesion on\|off\|status\|show` | Inject English cohesion guidance (sentence-connection rules) at session start |
| `sprag korean lint block\|warn\|off` | How the write-time check handles findings |
| `sprag korean lint scope all\|prose` | Check every text file, or documents only |
| `sprag doc2md on\|off` | Convert attached documents to Markdown before the model reads them (below) |
| `sprag doc2md <file>` | Convert one file by hand. Diagnostic: it prints the refusal reason instead of swallowing it |
| `sprag mode ttl=5m\|1h\|auto` | Pin the cache TTL bucket. The default `auto` trusts the measured split, then falls back to gateway detection |
| `sprag --version` | Print the installed version |
| `sprag update-check` | Is a newer version out? (`--refresh` to ask now, `--dismiss` to mute this version's offer) |
| `sprag upgrade` | Install the latest release with the package manager that installed this copy (`--print` shows the command only) |
| `sprag install` | Manually register Skill + statusline |
| `sprag uninstall [--purge]` | Remove the hooks, statusline and skill it registered. Recorded savings are kept unless `--purge` is given |

The output language is decided once, at install time: a terminal install proposes the system locale and asks whether to use Korean, while an unattended install records what the locale says. Once recorded it is never asked again, not even on an upgrade. Change it later with `mode ko` / `mode en`, or pin it for a scripted install with `CTS_LANG=ko` / `CTS_LANG=en`. Statusline chips stay symbolic either way.

<details>
<summary>All CLI options</summary>

| Flag | Description | Default |
|------|-------------|---------|
| `--days, -d` | Analysis period in days | 30 |
| `--hours` | Analysis window in hours (overrides `--days`) | – |
| `--format, -f` | `table` / `json` / `csv` | table |
| `--project, -p` | Filter by project directory | all |
| `--threshold` | Hit-rate alert threshold (0.0–1.0) | 0.7 |
| `--statusline` | One-line statusline output | – |
| `--icon` | Use 🧠 / ⏳ / 💰 / 📦 icons | text |
| `--verbose` | Longer labels | – |
| `--no-timer` | Hide TTL countdown | show |
| `--no-color` | Strip ANSI codes | – |
| `--segments=…` | Limit statusline segments (e.g. `model,five_hour,seven_day,saved`) | all |
| `--install-hook` / `--uninstall-hook` | Manage the PostToolUse hook | – |
</details>

---

<a id="한국어"></a>

# Command reference (한국어)

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
| `sprag mode ttl=5m\|1h\|auto` | 캐시 TTL 버킷을 직접 지정합니다. 기본값 `auto`는 실측값을 먼저 보고, 실측값이 없으면 게이트웨이 여부로 판정합니다 |
| `sprag --version` | 설치된 버전을 출력합니다 |
| `sprag update-check` | 새 버전이 있는지 확인합니다 (`--refresh`로 즉시 조회, `--dismiss`로 그 버전 안내 끄기) |
| `sprag upgrade` | 설치 경로에 맞는 명령으로 최신 버전을 설치합니다 (`--print`로 실행 없이 명령만 확인) |
| `sprag install` | Skill·statusline 수동 등록 |
| `sprag uninstall [--purge]` | 등록한 훅·statusline·Skill 제거. 기록된 절감액은 남기며, `--purge` 를 붙이면 상태 디렉터리까지 지웁니다 |

출력 언어는 설치할 때 한 번 정합니다. 터미널에서 설치하면 시스템 로케일을 기본값으로 제시하고 한국어를 쓸지 물어보며, 비대화형 설치에서는 로케일 판정을 그대로 기록합니다. 한 번 기록되면 업그레이드해도 다시 묻지 않습니다. 나중에 바꿀 때는 `mode ko`나 `mode en`을 쓰고, 스크립트에서 설치할 때는 `CTS_LANG=ko` 또는 `CTS_LANG=en`으로 지정할 수 있습니다. statusline의 칩은 언제나 기호로 표시합니다. 전체 옵션은 [전체 명령 문서](./COMMANDS.md)를 참고하십시오.
