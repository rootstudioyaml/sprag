# Korean writing guidance

[← README](../README.md) · [한국어](#한국어)

## 🇰🇷 Korean writing guidance

Injects guidance that corrects how Claude writes Korean (dropped sentence parts, noun-stopped sentences, translationese, em-dash overuse) **once per session.**

```bash
sprag korean on       # on, for every project
sprag korean status   # state, cost, provenance
sprag korean show     # print the guidance itself
sprag korean off      # off
```

Claude Code's output styles can do the same thing, but an output style is **a single global slot**: turning it on takes that slot away from anything else and has to be configured per machine. This ships the guidance inside the package and delivers it through the SessionStart hook that is already installed, so it **applies wherever the CLI is installed and leaves the output-style slot free.** It survives `/clear`, because the hook fires again.

Cost is **~1.5k tokens per session, injected once at session start rather than per turn**, and covered by the prompt cache from the second request on. When it is on, a `✍️` chip appears in the statusline.

### Before and after

From a real pipeline (yaml-sns-agent), where a Slack bot shells out to `claude -p` to investigate the repository and answers in a thread. The guidance was toggled off and then on, with the same question both times: "explain in three Korean sentences how to narrow down a render failure."

**Before** (guidance off)

> 렌더 실패 원인 좁히기 3단계: 먼저 `hn:still --check`로 스틸이 명세보다 최신인지(FRESH/STALE) 확인 — STALE이면 재생성 안 해서 옛 자산으로 렌더 시도한 게 원인. 다음 caption-blocks가 최신 나레이션과 단어열 일치하는지 직접 대조 — TTS 재생성 후 blocks 재생성 빠지면 자막·음성 어긋나 렌더 깨짐.

**After** (guidance on)

> 먼저 `hn:still --check` 돌려 스틸이 명세보다 최신인지 확인한다. STALE이면 재생성 안 해서 생긴 문제.
>
> 다음 caption-blocks가 captions.json 단어열과 일치하는지 본다. 내레이션 재TTS 후 blocks 재생성 빠지면 옛 자막이 새 음성 위에 뜬다.

Three things change. Clauses chained with em dashes become separate sentences, so one sentence carries one fact. Noun-stopped phrases (확인, 대조, 렌더 깨짐 — "check", "compare", "render breaks") become predicates (확인한다, 본다, 뜬다), which makes it explicit that these are steps to take. And the particles come back where they had been dropped, so subject and object are legible on the first read.

The technical content is identical in both. The guidance touches sentence construction only, not judgement or accuracy: the answer does not change, it just stops needing a second read. In a channel people scroll through, that difference cuts follow-up questions — and the tokens those follow-ups would have cost.

### The supplement: cohesion and conservative correctness rules

The vendored fluent-korean text ships unmodified; everything collected since lives in a separate supplement (`presets/korean-style/supplement.md`) appended to the same injection. It was compiled conservatively — only clauses that are nearly always an improvement, sourced from the National Institute of Korean Language's public-language guidelines, the Kubernetes Korean localization guide, and three peer-reviewed studies on text cohesion in Korean writing.

It adds three layers:

- **Translationese**: double passives, Japanese-derived calques, `~에 있어서`, possession-verb renderings of English *have*. The machine-checkable ones also run in the write-time lint (below).
- **AI-writing tics**: automatic intensifiers ("다양한", "핵심적인"), signpost sentences, rhetorical question-then-answer, unconditionally upbeat endings.
- **Cohesion** — how sentences connect, which no regex can check. The research finding that shapes this section: surface connectives (conjunctions, demonstratives) correlate *negatively or not at all* with judged text quality, while elaboration — the next sentence picking up and unpacking what the previous one introduced — is the only connection type with a positive correlation. So the guidance says: when a transition feels rough, fix the information order (given before new), don't add a connective.

**Most of the cohesion layer is not Korean-specific.** Given-before-new ordering (the "given-new contract"), one clear referent per pronoun, keeping one subject per paragraph, bridging sentences instead of leaping, and merging choppy repetitive sentences into a modifier-plus-core structure apply to English prose the same way — the studies happen to be about Korean learners, but the principles they validate are the standard cohesion model from text linguistics. If you write English deliverables with Claude, run `sprag cohesion on` — it injects exactly those five rules as a standalone English block (~0.5k tokens per session), no Korean feature required. While `korean on` is active the block is suppressed, because the Korean supplement already carries the same rules.

A final subsection lists what must **not** be "corrected": settled domain terms, formal register, and verbatim quotations — every lint finding is a request to confirm, not a verdict.

### The write-time check (v3.24.0)

Injecting the guidance once at session start turned out to be half the job. The model reads it, then writes dozens of files over the next hours with nothing re-reading the output. Sessions with the guidance active still shipped violations into documents, and it surfaced only when a human read the finished artifact. An August 2026 fix reworded the scope sentence to address this; it recurred, because rewording an instruction does not add a checkpoint.

From v3.24.0 `korean on` also installs a PostToolUse hook. It opens the file the model just wrote, runs the clauses a machine can decide, and hands any findings back. The file is already saved, so nothing is lost — the model fixes it on the spot.

```bash
sprag korean lint block   # default: findings are handed back as blocking feedback
sprag korean lint warn    # print findings, do not block
sprag korean lint off     # disable the check

sprag korean lint scope all     # default: every text file the session writes
sprag korean lint scope prose   # documents only

sprag korean lint docs/*.md     # check files already on disk
```

Checked: 15 figurative phrases, translationese markers, separators (`—`·`ㅡ`·`|`), three or more `의` particles in one phrase, a period after a nominal ending, and since v3.42.7 two consecutive sentences closing on the identical predicate. Clauses that genuinely need judgement — dropped sentence elements, word choice, near-miss repetition — stay with the guidance text.

Bash writes are checked too (v3.42.7). A heredoc, a `tee`, or a `sed -i` puts Korean on disk exactly like Write does, and a subagent handed Bash but not Write reaches for `cat > file` first — so leaving Bash off the matcher exempted every artifact produced by delegated work. Only redirection targets are recognised, never the command body, so Korean inside an `echo` is not mistaken for prose.

A file that must quote the banned forms — a fixture for this checker, a style report — opts out with one `korean-lint: off` line anywhere in it.

The default `all` scope covers code comments, UI strings, subtitles, templates, and build output, not just documents. The vendored guidance exempts comments, but comments are read by people and generated artifacts (PDF, HTML) are assembled from those strings, so exempting them reopens the exact gap that was reported. Only installed dependencies, VCS internals, lockfiles, and binary or image files are skipped; `dist/` and `build/` are checked. `korean lint scope prose` restores the narrow reading.

The scope sentence in the injected guidance is generated from the same setting, so the model is never told one rule while being corrected against another.

### The encoding rule that ships with it (v3.23.2)

Alongside the writing guidance, one more line is injected: **non-ASCII strings in tool-call parameters must be written as literal UTF-8, never as `\uXXXX` unicode escapes.**

When the model puts Korean into a Write or Edit parameter as escapes, those escapes are sometimes not decoded into code points at all: the literal text `한` lands in the file. The artifact carries mojibake, and the model keeps editing on top of it without noticing that what it wrote and what the file holds have diverged. Not writing escapes in the first place removes the path entirely, so the rule blocks the input instead of repairing the output.

This line lives in sprag's own framing paragraph, not in the vendored fluent-korean text. It governs encoding rather than style, and the vendored wording is kept unmodified. For the same reason it carries no exceptions, unlike the style rules that skip code and commit messages. It adds roughly 60 tokens per session.

> **Evidence**
> The same failure is reported against Claude Code: [#12417, unicode handling regression](https://github.com/anthropics/claude-code/issues/12417) and [#26141, Edit silently corrupting unicode](https://github.com/anthropics/claude-code/issues/26141).

### Asked at install time

The install **prints what the guidance changes, its per-session cost and its source, then asks.** A Korean system locale (`ko_KR` and friends; on macOS the system setting is checked too) makes the question default to yes; anything else defaults to no, so users who never write Korean are not billed 1.5k tokens a session. The locale is only a default, so an English-locale machine used for Korean work can still turn it on right there.

Installs with nobody attached — npm `postinstall`, CI, piped stdin — skip the question and apply the locale default, because a blocked prompt hangs the install. In that case, if the locale is not Korean the setting is **left undecided rather than recorded**, so a later run at a terminal still gets to ask. Use `--yes` or `--no-input` to force the non-interactive path, or `CTS_NO_KOREAN=1` to skip the feature entirely. **Once you have turned it on or off yourself, that choice sticks — an upgrade never overrides it.**

> **Source and license**
> The guidance text comes from [fluent-korean](https://github.com/snflkd/fluent-korean). Copyright (c) 2026 snflkd, MIT License.
> The wording is unmodified; only the output-style frontmatter was removed. The full license ships with the package at `presets/korean-style/LICENSE-fluent-korean`.

---

<a id="한국어"></a>

# Korean writing guidance (한국어)

## 🇰🇷 한국어 문체 지침

Claude가 한국어로 쓸 때 나타나는 문체 결함(문장 성분 생략, 명사형 종결, 번역체, 엠대시 남용)을 교정하는 지침을 **세션 시작 시 한 번 주입합니다.**

```bash
sprag korean on       # 켜기 (모든 프로젝트에 적용)
sprag korean status   # 상태·비용·출처 확인
sprag korean show     # 지침 원문 출력
sprag korean off      # 끄기
```

Claude Code의 output style로도 같은 일을 할 수 있지만, output style은 **전역 슬롯 하나**라서 켜는 순간 다른 스타일을 못 쓰게 되고 머신마다 따로 설정해야 합니다. 이 기능은 지침을 패키지에 담고 이미 설치된 SessionStart 훅으로 전달하므로, **CLI가 설치된 모든 프로젝트에 적용되며 output style 슬롯은 비워 둡니다.** `/clear` 이후에도 훅이 다시 실행되어 유지됩니다.

비용은 **세션당 약 1,500 토큰이며 매 턴이 아니라 세션 시작에 한 번만** 주입됩니다. 두 번째 요청부터는 프롬프트 캐시에 올라가므로 추가 부담이 거의 없습니다. 켜져 있으면 statusline에 `✍️` 칩이 표시됩니다.

### 적용 전후 비교

슬랙 봇이 `claude -p`로 저장소를 조사하고 결과를 스레드에 답하는 실제 파이프라인(yaml-sns-agent)에서, 지침만 껐다 켜고 같은 질문을 던진 결과입니다. 질문은 "렌더가 실패했을 때 원인을 어떻게 좁히는지 한국어 3문장으로 설명해라"였습니다.

**이전** (지침 꺼짐)

> 렌더 실패 원인 좁히기 3단계: 먼저 `hn:still --check`로 스틸이 명세보다 최신인지(FRESH/STALE) 확인합니다. STALE이면 재생성 안 해서 옛 자산으로 렌더 시도한 게 원인. 다음 caption-blocks가 최신 나레이션과 단어열 일치하는지 직접 대조합니다. TTS 재생성 후 blocks 재생성 빠지면 자막·음성 어긋나 렌더 깨짐.

**이후** (지침 켜짐)

> 먼저 `hn:still --check` 돌려 스틸이 명세보다 최신인지 확인한다. STALE이면 재생성 안 해서 생긴 문제.
>
> 다음 caption-blocks가 captions.json 단어열과 일치하는지 본다. 내레이션 재TTS 후 blocks 재생성 빠지면 옛 자막이 새 음성 위에 뜬다.

바뀐 지점은 세 가지입니다. 첫째, 엠대시로 이어 붙이던 절이 마침표로 끊어져 한 문장이 한 가지 사실만 전달합니다. 둘째, "확인", "대조", "렌더 깨짐" 같은 명사형 종결이 "확인한다", "본다", "뜬다"처럼 서술어로 바뀌어 무엇을 하라는 것인지가 분명해집니다. 셋째, "자막·음성 어긋나"처럼 조사가 빠졌던 지점에 조사가 돌아와 어떤 성분이 주어이고 목적어인지 읽는 즉시 잡힙니다.

기술적 내용은 양쪽이 동일합니다. 지침은 판단이나 정확도가 아니라 문장의 완성도에만 관여하므로, 답이 달라지는 것이 아니라 같은 답을 다시 읽지 않아도 되는 형태로 만들어 줍니다. 슬랙처럼 사람이 스크롤하며 읽는 채널에서는 이 차이가 되묻는 횟수를 줄이고, 되묻지 않는 만큼 토큰도 아낍니다.

### 보강 지침: 응집성과 보수적 교정 규칙 (v3.37.0)

들여온 fluent-korean 본문은 원형 그대로 두고, 그 뒤로 수집한 지침은 별도 파일(`presets/korean-style/supplement.md`)에 담아 같은 주입에 이어 붙입니다. 수집 기준은 보수적입니다. 거의 항상 고치는 편이 나은 조항만 실었고, 출처는 국립국어원 공공언어 지침, 쿠버네티스 문서 한글화 가이드, 그리고 한국어 텍스트 응집성을 다룬 학술 논문 세 편입니다.

세 층이 더해집니다.

- **번역투**: 이중 피동, 일본어에서 온 굳은 표현, `~에 있어서`, 영어 have를 직역한 '가지다' 남용. 기계가 판정할 수 있는 것은 쓰기 시점 검사(아래)에도 함께 들어갑니다.
- **상투 패턴**: 자동으로 붙는 수식어("다양한", "핵심적인"), 표지판 문장, 수사적 질문 뒤 즉답, 근거 없는 긍정 마무리.
- **응집성**: 문장이 이어지는 방식이라 정규식으로는 검사하지 못합니다. 이 절의 방향을 정한 연구 결과가 있습니다. 접속어·지시어 같은 표층 연결 장치는 글의 품질과 상관이 없거나 오히려 부적 상관이고, 앞 문장이 내놓은 정보를 다음 문장이 받아 풀어 주는 상술형 연결만 정적 상관을 보였습니다. 그래서 지침은 연결이 어색할 때 접속어를 더하지 말고 정보의 배열(아는 것 먼저, 새 것 나중)을 고치라고 말합니다.

응집성 층의 원칙 대부분은 한국어에만 해당하지 않습니다. 구정보 우선 배열, 대명사의 단일 지시, 문단 안 주어 유지, 비약을 잇는 다리 문장, 짧은 반복 문장 병합은 영어 산문에도 그대로 적용됩니다. 논문이 한국어 학습자를 다뤘을 뿐, 검증된 원칙은 텍스트언어학의 표준 응집성 모형입니다. 영어 산출물에는 `sprag cohesion on`이 같은 다섯 원칙을 영어 블록으로 주입합니다 (korean 지침이 켜져 있으면 중복이라 생략됩니다).

마지막 절은 고치면 안 되는 것을 명시합니다. 정착된 전문 용어, 문어체, 원문 인용이 그것이고, 검사가 내는 지적은 판정이 아니라 확인 요청입니다.

### 쓰기 시점 검사 (v3.24.0)

지침을 세션 시작에 한 번 넣는 것만으로는 부족했습니다. 모델은 지침을 한 번 읽고 그 뒤로 파일 수십 개를 쓰는데, 그동안 결과물을 다시 읽어 보는 단계가 없었습니다. 그래서 지침이 켜진 세션이 규약에 어긋나는 문장을 문서에 그대로 실어 보냈고, 사람이 완성본을 읽을 때에야 드러났습니다. 2026년 8월에 적용 범위 문장을 고쳐서 같은 문제를 잡으려 했지만, 문장을 고쳐도 검사 단계가 없다는 조건은 그대로였기 때문에 재발했습니다.

v3.24.0부터 `korean on`이 PostToolUse 훅을 함께 설치합니다. 모델이 방금 쓴 파일을 열어서 기계로 판정할 수 있는 조항을 검사하고, 위반이 있으면 모델에게 되돌려 보냅니다. 파일은 이미 저장된 뒤이므로 잃는 것은 없고, 모델이 즉시 고칩니다.

```bash
sprag korean lint block   # 기본값. 위반을 되돌려 보내 고치게 합니다
sprag korean lint warn    # 알리기만 하고 진행을 막지 않습니다
sprag korean lint off     # 검사하지 않습니다

sprag korean lint scope all     # 기본값. 세션이 쓴 모든 텍스트 파일
sprag korean lint scope prose   # 마크다운·텍스트 문서만

sprag korean lint docs/*.md     # 이미 저장된 파일을 직접 검사
```

검사 항목은 사람이 판정할 필요가 없는 것들입니다. 비유 어휘 15종(`~는 자리`, `~의 흐름`, `닿는다`, `걷어내다`, `발목을 잡다` 등), 번역체 표지(`~에 대한`, `~를 위한`, `~되어지`), 구분자(`—`·`ㅡ`·`|`), 한 구에 세 번 이상 이어지는 조사 `의`, 명사형 종결 뒤의 마침표, 그리고 v3.42.7부터는 이어지는 두 문장이 똑같은 서술어로 끝나는 종결 반복입니다. 판단이 필요한 조항(성분 생략, 한자어 선택, 비슷하지만 똑같지는 않은 반복)은 그대로 지침이 담당합니다.

검사 대상에는 Bash로 쓴 파일도 들어갑니다(v3.42.7). heredoc과 `tee`, `sed -i`는 Write와 똑같이 한국어를 디스크에 남기고, Write 도구가 없는 하위 에이전트는 `cat > 파일`부터 집습니다. 그래서 Bash를 빼 두면 위임해서 만든 결과물 전체가 검사를 비켜 갔습니다. 리다이렉션 대상 경로만 인식하고 명령문 자체는 읽지 않으므로, `echo`에 담긴 한국어가 잘못 걸리는 일은 없습니다.

검사기를 시험하는 파일이나 문체 보고서처럼 금지된 표현을 일부러 담아야 하는 파일에는 `korean-lint: off` 한 줄을 넣으면 그 파일을 건너뜁니다.

기본 범위 `all`은 문서뿐 아니라 **코드 주석과 화면에 나가는 문자열, 자막·템플릿, 생성 결과물까지** 검사합니다. 벤더링한 지침 원문은 코드 주석을 예외로 두지만, 주석도 사람이 읽고 PDF·HTML 같은 산출물은 그 문자열들로 조립되기 때문에 예외로 두면 정확히 문제가 됐던 경로가 다시 열립니다. 검사에서 빠지는 것은 설치된 의존성(`node_modules`), VCS 내부, 락 파일, 그리고 이진·이미지 파일뿐입니다. `dist`나 `build` 같은 산출물 디렉터리는 검사합니다. 원문 규약대로 문서만 보고 싶으면 `korean lint scope prose`로 되돌립니다.

주입문의 적용 범위 안내도 이 설정에서 생성합니다. 모델에게 알리는 범위와 검사하는 범위가 갈라지면 8월과 같은 상태로 돌아가기 때문입니다.

### 함께 주입되는 인코딩 규칙 (v3.23.2)

문체 지침과 별도로, **도구 호출 인자에 담는 비ASCII 문자열은 리터럴 UTF-8로 쓰고 `\uXXXX` 유니코드 이스케이프로는 쓰지 말라**는 한 줄이 같이 주입됩니다.

모델이 Write나 Edit의 인자에 한국어를 이스케이프로 적으면, 그 이스케이프가 코드 포인트로 해석되지 않고 `한` 같은 문자열 그대로 파일에 기록되는 경우가 있습니다. 결과물에는 깨진 글자가 남고, 모델은 자기가 쓴 값과 파일 내용이 다르다는 사실을 알아차리지 못한 채 다음 편집을 이어 갑니다. 이스케이프를 쓰지 않으면 이 경로 자체가 생기지 않으므로, 사후에 복구하는 대신 입력 단계에서 막습니다.

이 한 줄은 fluent-korean 원문이 아니라 sprag가 직접 쓰는 안내 문단에 들어갑니다. 문체가 아니라 표기 방식을 정하는 규칙이고, 벤더링한 원문은 수정하지 않는다는 원칙을 지켜야 하기 때문입니다. 같은 이유로 코드와 커밋 메시지에 적용하지 않는 문체 예외와 달리, 이 규칙에는 예외를 두지 않습니다. 세션당 약 60 토큰이 늘어납니다.

> **근거**
> 같은 현상이 Claude Code 저장소에 보고되어 있습니다: [#12417 유니코드 처리 회귀](https://github.com/anthropics/claude-code/issues/12417), [#26141 Edit 도구가 유니코드를 조용히 손상시키는 문제](https://github.com/anthropics/claude-code/issues/26141).

### 설치할 때 물어봅니다

설치 과정에서 **지침의 내용과 세션당 비용, 출처를 먼저 보여 준 다음 켤지 물어봅니다.** 시스템 로캘이 한국어이면(`ko_KR` 등, macOS는 시스템 설정까지 확인) 질문의 기본값이 "켬"이 되고, 한국어 환경이 아니면 기본값이 "끔"입니다. 로캘은 답이 아니라 기본값일 뿐이므로 영어 로캘에서 한국어로 작업하는 경우에도 설치 중에 바로 켤 수 있습니다.

npm의 `postinstall`이나 CI처럼 사람이 붙어 있지 않은 설치에서는 질문을 건너뛰고 로캘 기본값을 그대로 적용합니다. 프롬프트가 멈춰 서면 설치 자체가 걸리기 때문입니다. 이때 로캘이 한국어가 아니면 **설정을 저장하지 않고 미결정으로 남겨 두므로**, 나중에 터미널에서 다시 설치하면 그때 물어봅니다. 질문 없이 기본값으로 넘기려면 `--yes`나 `--no-input`을, 기능 자체를 건너뛰려면 `CTS_NO_KOREAN=1`을 쓰십시오. **한 번이라도 직접 켜거나 끈 뒤에는 그 선택을 유지하므로, 업데이트 설치가 사용자의 결정을 되돌리지 않습니다.**

> **출처와 라이선스**
> 지침 원문은 [fluent-korean](https://github.com/snflkd/fluent-korean)에서 가져왔습니다. Copyright (c) 2026 snflkd, MIT License.
> 원문은 수정하지 않았고 output style 프런트매터만 제거했습니다. 라이선스 전문은 패키지의 `presets/korean-style/LICENSE-fluent-korean`에 함께 배포합니다.
