# Korean writing guidance

[← README](../README.md) · [한국어](./KOREAN-STYLE.ko.md)

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
