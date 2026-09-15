# Harness, compact-window and seed

[← README](../README.md) · [한국어](#한국어)

## 🅷 Harness mode

Bootstrap five engineering principles (Ratchet · Evidence · PEV · Structured Task · Default Safe Path) into `CLAUDE.md` with one command; the statusline scores it as `🅷 5/5`. When the same error keeps recurring, a `🅷⚠ ratchet?` nudge appears so you can promote it to a rule.

```bash
sprag harness init                # this project
sprag harness init --global       # ~/.claude/CLAUDE.md — every project
sprag harness check               # current score (global fallback honored)
sprag harness analyze             # run the transcript analysis manually (no hook needed); refreshes harness-state.json
sprag harness promote <N> --global|--project   # warning #N → ratchet rule (scope required)
sprag harness promote "<rule text>" --global|--project  # register your own hand-written rules the same way
sprag harness pull                # register the package's curated ratchet rules into your global ratchet (opt-in, dedupes)
sprag harness list / rm <N>       # view / delete rules (auto .bak)
sprag harness off | on            # toggle the 🅷 chip
```

- `promote` **requires** `--project`/`--global` in non-TTY contexts (scripts, LLM calls) — a scope choice is never silently made for the caller.
- `pull` registers the **author-curated ratchet rules** bundled with the package (`presets/ratchet-rules.json` — only general-purpose rules promoted from real recurring mistakes) into your global ratchet (`~/.claude/ratchet.md`). `install`/`init` never auto-inject anything; `pull` is always opt-in and idempotent. Drop any rule you dislike with `harness rm`.
- `seed` offers the same presets **one at a time**. Where `pull` registers the whole ratchet set in one go, `seed` covers the model-fitting presets too and asks about each of them in the first session after an install or upgrade ([below](#-seed-delegation-that-works-from-the-first-session)).
- 🅷⚠ runtime warnings (`ratchet?` `no-evidence` `PEV-skip`) expire after 30 minutes, subdirectory sessions match their project correctly, and PEV-skip counts only mutating tools (Edit/Write/Bash) so read-only research sessions don't trip it (v2.16.0+).

<details>
<summary>⚠️ <code>harness rm</code> — checklist before deleting</summary>

The whole point of the ratchet is **one-direction accumulation**. Deleting rules casually means the same mistakes return.

- **Rule too broad, blocking valid cases?** → ❌ delete ✅ narrow the condition (e.g. `"no hardcoded values"` → `"no hardcoded values outside tests"`)
- **Rule too narrow, almost never fires?** → ❌ delete ✅ leave it (zero cost)
- **Genuinely wrong?** → ✅ delete then

An auto `.bak` is kept, but **the session context that earned the rule its place is not recoverable.**
</details>


## 📦 compact-window — pin where a 1M session compacts

Claude Code compacts when usage approaches `min(autoCompactWindow, model max context)`. On a 1M window, with that value unset, compaction only fires near 800k — and until then every request re-bills the whole context. **1M is too large; the recommendation is a 400k–700k band** — 2–3.5x a 200k session's headroom for the genuinely large pastes, with the runaway tail cut off.

**Anything inside the band is left alone.** 400k is the floor where the saving beats the extra compactions, and long sessions often want more room than that. Only an unset window, or one above 700k, is warned about (a smaller one is a deliberate, more aggressive choice).

**200k sessions are never warned** — their window is already at or below 200k, so the setting cannot change anything.

```bash
sprag compact-window                       # status (model, window, value, source)
sprag compact-window set --global          # pin 500k (mid-band) in ~/.claude/settings.json
sprag compact-window set --project         # pin it in <root>/.claude/settings.json
sprag compact-window set --global --value 600k   # explicit value (100k–1M)
sprag compact-window off | on              # toggle the warning
```

- On a 1M model with the value unset or above 700k, the statusline shows `🅷⚠ compact-window?` and the session briefing hands the model the exact registration command.
- Scope (`--global`/`--project`) is **required** for `set` — a global settings file is never edited on a guess.
- Every other key in `settings.json` is preserved and a `.bak` is written first. Malformed JSON aborts the write untouched.
- An exported `CLAUDE_CODE_AUTO_COMPACT_WINDOW` beats settings.json; `set` detects that and says so.

## 🌱 seed: delegation that works from the first session

The model-fitting ratchet (`ratchet-model.md`) **starts empty.** A rule exists only after route-scan has seen the same kind of work recur in your own logs and you have approved that candidate. So a fresh install delegates nothing, and keeps delegating nothing for days — precisely the stretch where the savings would matter most.

`seed` fills that gap from presets bundled with the package.

| Presets | What they cover | File |
|---|---|---|
| 9 model-fitting | running commands, lookup, status checks, questions about pasted logs, read-and-summarize — each with a T2 (haiku) and a T1 (sonnet) rule | `presets/model-rules.json` |
| 6 ratchet | general-purpose rules promoted from mistakes that actually recurred | `presets/ratchet-rules.json` |

**How they get registered:** in the first session after an install or upgrade, the SessionStart hook hands the pending presets to the model, which walks the user through them **one at a time**. Each answer runs one of these immediately:

```bash
sprag seed                                   # pending presets + recorded answers
sprag seed accept <id> --global|--project     # register one (scope required)
sprag seed accept all --global                # when the user says "register them all"
sprag seed skip <id>                          # decline — never offered again
sprag seed reset                              # clear the answers and offer everything again
```

- **Nothing is written without a yes to that specific rule.** A declined rule stays declined across upgrades; a later release only surfaces the presets it actually added.
- A preset is withheld when you already approved a rule of the same shape (same tier and category).
- A seeded rule **does not pass someone else's statistics off as yours.** It is recorded as `preset (curated)` until a scan measures real firings and delegations, and then those numbers replace it. If its delegated error rate crosses the threshold it gets the same review flag as any other rule.
- The scope must be stated as `--global` or `--project`. The hook environment is non-TTY, so the CLI cannot ask — the model confirms with the user and passes the flag.

---

<a id="한국어"></a>

# Harness, compact-window and seed (한국어)

## 🅷 Harness 모드

다섯 원칙(Ratchet · Evidence · PEV · Structured Task · Default Safe Path)을 한 줄 명령으로 `CLAUDE.md`에 셋업하고 statusline이 `🅷 5/5`로 점수화합니다. 같은 에러가 반복되면 `🅷⚠ ratchet?` 알림이 떠서 룰로 승격할 수 있습니다.

```bash
sprag harness init                # 이 프로젝트에 셋업
sprag harness init --global       # ~/.claude/CLAUDE.md, 모든 프로젝트에 적용
sprag harness check               # 현재 점수 (글로벌 fallback 인정)
sprag harness analyze             # 훅 없이도 수동으로 전사 분석을 실행해 harness-state.json 갱신
sprag harness promote <N> --global|--project   # 경고 #N → ratchet 룰 (스코프 필수)
sprag harness promote "<룰 텍스트>" --global|--project  # 내가 직접 정의한 룰도 같은 명령으로 등록
sprag harness pull                # 패키지 동봉 큐레이션 룰 → 내 글로벌 래칫에 등록 (opt-in, 중복 스킵)
sprag harness list / rm <N>       # 룰 조회 / 삭제 (자동 .bak)
sprag harness off | on            # 🅷 표시 토글
```

- `promote`는 non-TTY 환경(스크립트나 LLM 호출)에서 `--project` 또는 `--global` 플래그가 **반드시 필요합니다.** 적용 범위가 사용자에게 묻지 않은 채 결정되는 사고를 막기 위한 설계입니다.
- `pull`은 패키지에 동봉된 **제작자 큐레이션 래칫 룰**(`presets/ratchet-rules.json`, 실제 반복 사고에서 승격된 범용 룰만)을 내 글로벌 래칫(`~/.claude/ratchet.md`)에 등록합니다. 설치(`install`)나 `init`은 아무것도 자동 주입하지 않으며, `pull`은 항상 opt-in이고 재실행해도 중복이 없습니다(멱등). 마음에 안 드는 룰은 `harness rm`으로 제거하면 됩니다.
- `seed`는 같은 프리셋을 **한 건씩** 물어보는 경로입니다. `pull`이 래칫 룰 전체를 한 번에 등록하는 명령인 데 반해, `seed`는 모델 피팅 프리셋까지 포함해 설치·업그레이드 후 첫 세션에서 한 건씩 제안합니다 ([아래](#-seed-설치-직후부터-위임이-걸리게-하는-시작-룰)).
- 🅷⚠ 런타임 경고(`ratchet?` `no-evidence` `PEV-skip`)는 30분 후 자동 만료되고, 하위 디렉터리 세션도 프로젝트에 올바르게 매칭됩니다. PEV-skip은 변경성 도구(Edit/Write/Bash)만 카운트해 읽기 위주 세션에서는 발동하지 않습니다 (v2.16.0+).

<details>
<summary>⚠️ <code>harness rm</code>은 신중하게 사용하십시오: 삭제 전 확인 사항</summary>

ratchet의 가치는 **한 방향 누적**에 있습니다. 룰을 가볍게 지우면 같은 실수가 다시 새기 시작합니다.

- **룰이 너무 광범위해서 정상 케이스도 막나?** → ❌ 삭제 ✅ 조건을 좁혀 다듬기 (예: `"하드코딩 금지"` → `"테스트 외 코드에서 하드코딩 금지"`)
- **룰이 너무 좁아 거의 발동 안 되나?** → ❌ 삭제 ✅ 그냥 두기 (비용 0)
- **정말 잘못된 룰이라 확신?** → ✅ 그때만 삭제

삭제 시 `.bak`이 남지만 **그 룰이 박힌 세션 컨텍스트(왜)는 복원되지 않습니다.**
</details>


## 📦 compact-window: 1M 컨텍스트의 자동 압축 지점 고정

Claude Code는 `min(autoCompactWindow, 모델 최대 창)`에 가까워지면 대화를 자동 압축합니다. 1M 창을 쓰면 이 값이 잡혀 있지 않은 한 80만 토큰 근처까지 가서야 압축이 걸리고, 그전까지 모든 요청이 전체 컨텍스트를 통째로 재과금합니다. **1M은 너무 크니 40만~70만 범위를 권장합니다.** 큰 붙여넣기용 여유는 200k 세션의 2~3.5배로 남기면서 꼬리만 잘라냅니다.

**권장 범위 안이면 경고하지 않습니다.** 40만은 절감이 압축 횟수를 이기는 하한이고, 긴 세션은 그보다 여유가 더 필요한 경우가 많습니다. 미설정이거나 70만을 넘을 때만 알립니다(그보다 낮게 잡은 건 더 공격적으로 아끼겠다는 선택이라 그냥 둡니다).

**200k 컨텍스트는 경고 대상이 아닙니다.** 창이 이미 200k 이하이므로 이 설정으로 달라지는 것이 없기 때문입니다.

```bash
sprag compact-window                       # 현재 상태 (모델·창·설정값·출처)
sprag compact-window set --global          # ~/.claude/settings.json 에 50만 고정 (범위 중간)
sprag compact-window set --project         # <root>/.claude/settings.json 에 고정
sprag compact-window set --global --value 600k    # 값 직접 지정 (10만~1M)
sprag compact-window off | on              # 경고 표시 토글
```

- 1M 모델인데 미설정이거나 40만을 넘으면 statusline에 `🅷⚠ compact-window?`가 뜨고, 세션 브리핑이 등록 명령까지 알려줍니다.
- 적용 범위(`--global` 또는 `--project`)는 `set`에서 **반드시 지정해야 합니다.** 글로벌 설정 파일을 사용자에게 묻지 않고 수정하는 일을 막기 위한 설계입니다.
- 기존 `settings.json`의 다른 키는 그대로 보존하고 `.bak`을 남깁니다. JSON이 깨져 있으면 아무것도 쓰지 않고 중단합니다.
- 셸에 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`가 export돼 있으면 그쪽이 settings.json보다 우선합니다 (`set`이 이 경우를 감지해 알려줍니다).

## 🌱 seed: 설치 직후부터 위임이 걸리게 하는 시작 룰

모델 피팅 래칫(`ratchet-model.md`)은 **빈 파일로 시작합니다.** route-scan이 사용자의 로그에서 같은 유형의 작업을 여러 번 관측하고, 사용자가 그 후보를 승인해야 룰이 생깁니다. 즉 갓 설치한 상태에서는 위임이 한 건도 걸리지 않고, 그 상태가 며칠 이어집니다. 정작 절감 효과가 가장 클 시기입니다.

`seed`는 패키지에 동봉된 프리셋으로 그 공백을 메웁니다.

| 프리셋 | 내용 | 파일 |
|---|---|---|
| 모델 피팅 9건 | 명령 실행·탐색·상태 확인·붙여넣은 로그 질문·읽기 요약, 각 유형의 T2(haiku)와 T1(sonnet) 룰 | `presets/model-rules.json` |
| 래칫 6건 | 실제 반복 사고에서 승격된 범용 룰 | `presets/ratchet-rules.json` |

**등록 절차:** 설치나 업그레이드 후 첫 세션에서 SessionStart 훅이 대기 중인 프리셋을 모델에게 전달하고, 모델이 **한 건씩 순서대로** 등록 여부를 묻습니다. 사용자가 답하면 곧바로 아래 명령을 실행합니다.

```bash
sprag seed                                   # 대기 중인 프리셋과 응답 기록
sprag seed accept <id> --global|--project     # 한 건 등록 (적용 범위 필수)
sprag seed accept all --global                # 사용자가 "전부 등록"이라고 답한 경우
sprag seed skip <id>                          # 거절 — 다시 묻지 않습니다
sprag seed reset                              # 응답 기록을 지워 전체를 다시 제안 대상으로
```

- **승인 없이는 아무것도 기록되지 않습니다.** 거절한 룰은 업그레이드 후에도 다시 묻지 않고, 새 릴리스에서 추가된 프리셋만 다음 세션에 제안됩니다.
- 사용자가 이미 같은 유형(같은 티어·카테고리)의 룰을 직접 승인해 두었다면 그 프리셋은 제안하지 않습니다.
- 프리셋으로 등록한 룰은 **남의 통계를 내 것처럼 표시하지 않습니다.** 등록 직후에는 `preset (curated)`로 적히고, 이후 스캔에서 실제 발화와 위임 결과가 측정되면 그 수치로 대체됩니다. 위임 에러율이 기준을 넘으면 다른 룰과 똑같이 재검토 플래그가 붙습니다.
- 적용 범위는 `--global`과 `--project` 중 반드시 명시해야 합니다. 훅 환경은 non-TTY라 CLI가 직접 물을 수 없으므로, 모델이 사용자에게 확인한 뒤 플래그를 붙여 실행합니다.
