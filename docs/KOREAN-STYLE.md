# Korean writing guidance

[← README](../README.md) · [한국어](./KOREAN-STYLE.ko.md)

## 🇰🇷 Korean writing guidance

Injects rules that correct how Claude writes Korean **once per session.**

```bash
sprag korean on       # on, for every project
sprag korean status   # state, cost, provenance
sprag korean show     # print the rules themselves
sprag korean off      # off
```

Claude Code's output styles can do the same thing, but an output style is **a single global slot**: turning it on takes that slot away from anything else and has to be configured per machine. This ships the guidance inside the package and delivers it through the SessionStart hook that is already installed, so it **applies wherever the CLI is installed and leaves the output-style slot free.** It survives `/clear`, because the hook fires again.

Cost is **~1.8k tokens per session, injected once at session start rather than per turn**, and covered by the prompt cache from the second request on. When it is on, a `✍️` chip appears in the statusline.

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

### Design

Korean style is handled in three layers.

1. **Rules with evidence** (`presets/korean-style/rules.md`), injected once per session. Every clause carries a measurement or a cited study, and taste without evidence stays out. The over-correction guard, which forbids "fixing" forms people use more than LLMs do, was admitted by the same bar.
2. **A write-time check** (`src/korean-lint.cjs`). The clauses a string comparison or a regex can decide are checked the moment a file is written. Guidance is read once, while the check runs on every write, so any clause that can be decided belongs to the check.
3. **A measurement loop.** A new check pattern goes in only after its sampled precision on a real corpus is known, and after a rule change the output before and after is measured with the same metrics. The v3.91.0 replacement of the rules came out of this loop.

The target is less grammar than the habits readers recognise as machine voice. In a rubric study every LLM essay got full marks for orthography. What readers object to is prose that is too even and too formulaic, so the rules ask for concrete facts and broken patterns rather than more polish.

### sprag's own rules (v3.91.0)

Since v3.91.0 the injected text is a single file sprag writes itself, `presets/korean-style/rules.md`. The guidance shipped through v3.90 was replaced because of measurement: the old guidance did not touch the two strongest habits that make Korean read as machine-written.

- **A comma after a connective ending.** This was the strongest signal in KatFishNet (ACL 2025), a study of LLM-generated Korean: in essays, people put a comma after a connective ending 4.10% of the time and LLMs 19.83%. In DeepPulse narration the rate *rose* after the old guidance was injected, from 5.12 to 9.20 per 1,000 characters.
- **Middle-dot lists** such as `직급·처우` or `커밋·푸시했다`, which drop the particle and glue words together. In October 2026 transcripts, assistant replies used the middle dot 7.3 times as often as user messages. The old write-time lint contributed: it suggested the middle dot as a replacement for the em dash.

The new rules have nine sections: commas and middle dots, complete sentences, formulaic constructions ("not A but B" contrasts, punchline paragraph endings, answering one's own question), specificity, translationese, cohesion, an over-correction guard, and reading aloud. Every clause cites its evidence in the file header; the full list is under [References](#references) below.

**Most of the cohesion section is not Korean-specific.** Given-before-new ordering, one clear referent per pronoun, keeping one subject per paragraph, and bridging sentences instead of leaping apply to English prose the same way. For English deliverables, `sprag cohesion on` injects those rules as a standalone English block (~0.5k tokens per session). While `korean on` is active the block is suppressed, because the Korean rules already carry them.

The over-correction section lists what must **not** be changed. People use `~를 통해` and `~것이다` about twice as often as LLMs do, so they are never replaced wholesale. Settled domain terms, formal register, and verbatim quotations stay too, and every lint finding is a request to confirm, not a verdict.

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

Checked: 15 figurative phrases, translationese markers, separators (`—`, `ㅡ`, `|`), three or more `의` particles in one phrase, a period after a nominal ending, and since v3.42.7 two consecutive sentences closing on the identical predicate. v3.91.0 adds four: a second comma after a connective ending in one paragraph, a comma after a conjunctive adverb, a middle dot between Hangul words (table cells and settled pairs such as `한·중` excepted), and a second `아니라` contrast in one paragraph. Clauses that genuinely need judgement — dropped sentence elements, word choice, near-miss repetition — stay with the guidance text.

Bash writes are checked too (v3.42.7). A heredoc, a `tee`, or a `sed -i` puts Korean on disk exactly like Write does, and a subagent handed Bash but not Write reaches for `cat > file` first — so leaving Bash off the matcher exempted every artifact produced by delegated work. Only redirection targets are recognised, never the command body, so Korean inside an `echo` is not mistaken for prose.

A file that must quote the banned forms — a fixture for this checker, a style report — opts out with one `korean-lint: off` line anywhere in it.

The default `all` scope covers code comments, UI strings, subtitles, templates, and build output, not just documents. Comments are read by people and generated artifacts (PDF, HTML) are assembled from those strings, so exempting them reopens the exact gap that was reported. Only installed dependencies, VCS internals, lockfiles, and binary or image files are skipped; `dist/` and `build/` are checked. `korean lint scope prose` narrows the check to documents.

The scope sentence in the injected guidance is generated from the same setting, so the model is never told one rule while being corrected against another.

### The reply-language check

The lint hook only sees files the model writes. A different slip writes no file: after a long stretch of English work (commit messages, release notes) the model sometimes answers a Korean prompt in English. That is decidable by counting letters, so `korean on` also installs a Stop hook, `sprag korean --reply-hook`, that reads the tail of the transcript when a turn ends.

It blocks the stop and asks for the same answer in Korean when the last real prompt is Korean (at least 4 Hangul syllables, Hangul at least 30% of letters) and the final reply is English (at least 80 Latin letters, Hangul under 15%). Code blocks, inline code, URLs, paths and system reminders are ignored. A prompt that asks for English (`영어로`, `영문으로`, `in English`) is skipped. Measured on 2,204 Korean-prompt turns from 14 days of real transcripts: 8 flagged, all true positives. It never fires twice in a row, because Claude Code sets `stop_hook_active` while the model is already continuing from a Stop hook.

```bash
sprag korean reply off   # keep the hook installed but make it a no-op
sprag korean reply on    # default
```

`sprag korean off` removes the hook entirely, and `sprag korean` shows the current state.

### The encoding rule that ships with it (v3.23.2)

Alongside the writing guidance, one more line is injected: **non-ASCII strings in tool-call parameters must be written as literal UTF-8, never as `\uXXXX` unicode escapes.**

When the model puts Korean into a Write or Edit parameter as escapes, those escapes are sometimes not decoded into code points at all: the literal text `한` lands in the file. The artifact carries mojibake, and the model keeps editing on top of it without noticing that what it wrote and what the file holds have diverged. Not writing escapes in the first place removes the path entirely, so the rule blocks the input instead of repairing the output.

This line lives in sprag's framing paragraph, not in the style rules file, because it governs encoding rather than style. Unlike the style rules, which skip commit messages, it carries no exceptions. It adds roughly 60 tokens per session.

> **Evidence**
> The same failure is reported against Claude Code: [#12417, unicode handling regression](https://github.com/anthropics/claude-code/issues/12417) and [#26141, Edit silently corrupting unicode](https://github.com/anthropics/claude-code/issues/26141).

### Asked at install time

The install **prints what the guidance changes, its per-session cost and its source, then asks.** A Korean system locale (`ko_KR` and friends; on macOS the system setting is checked too) makes the question default to yes; anything else defaults to no, so users who never write Korean are not billed 1.5k tokens a session. The locale is only a default, so an English-locale machine used for Korean work can still turn it on right there.

Installs with nobody attached — npm `postinstall`, CI, piped stdin — skip the question and apply the locale default, because a blocked prompt hangs the install. In that case, if the locale is not Korean the setting is **left undecided rather than recorded**, so a later run at a terminal still gets to ask. Use `--yes` or `--no-input` to force the non-interactive path, or `SPRAG_NO_KOREAN=1` to skip the feature entirely. **Once you have turned it on or off yourself, that choice sticks — an upgrade never overrides it.**

### References

The rules file header lists the same sources clause by clause.

**Detecting and measuring LLM Korean**

- Park, S., Kim, S., Kim, D.-K., Han, Y.-S. (2025). KatFishNet: Detecting LLM-Generated Korean Text through Linguistic Feature Analysis. *ACL 2025*. [arXiv:2503.00032](https://arxiv.org/abs/2503.00032). Detects LLM Korean from comma use, commas after connective endings, spacing and POS-combination diversity; comma features alone reach 94.88 AUC on essays.
- Park, S., Han, Y.-S. (2026). When LLM Essays Outscore Student Essays: What a Korean Writing Rubric Rewards and Where Readers Disagree. [arXiv:2601.19913](https://arxiv.org/abs/2601.19913). LLM essays hit the maximum on orthography and register; student essays led on creativity and natural phrasing.
- epoko77-ai/im-not-ai, [evidence.md](https://github.com/epoko77-ai/im-not-ai/blob/main/docs/en/evidence.md). A public log-likelihood comparison of 60 AI and 60 human pieces: "A가 아니라 B" contrasts at 9.2x, while people used `~를 통해` and `~것이다` twice as often. Not peer reviewed.
- Fowler, M. (2026). [LLM Voice](https://martinfowler.com/bliki/LLM-Voice.html). The observation that readers spot smooth but soulless prose, and the read-it-aloud principle.

**Translationese and public-language guidance**

- National Institute of Korean Language, 「한눈에 알아보는 공공언어 바로 쓰기」.
- Hangeul Culture Association, [translationese correction cases](https://www.urimal.org/4544).
- Kubernetes Korean [localization guide](https://kubernetes.io/ko/docs/contribute/localization_ko/), for the first-mention bilingual rule.
- 김은일, 안경록, 정연창 (2011). [영어 수동문의 한국어 번역에 대한 기능문법적 설명](https://www.earticle.net/Article/A139223). 언어과학 18(1). 68.7% of English passives were rendered as Korean actives.

**Cohesion**

- 「한국어 교육과 결속성(cohesion) 및 응집성(coherence)의 문제」, KCI ART002501143. Cohesive devices show no or negative correlation with text quality.
- 「한국어 학습자의 쓰기 텍스트에 나타난 응결성과 응집성의 상관분석」, 우리말글, KCI ART002240473. Overused substitution correlates negatively; only elaborative linking correlates positively.
- 「한국어 학습자 텍스트의 내용적 오류 양상: 응집성 중심」 (2023), DBpia NODE11604445.

**sprag's own measurements** (2026-11-01)

- 60 DeepPulse narration episodes: connective commas, sentence length and "not A but B" contrasts before and after the guidance was injected.
- 132 Claude Code transcripts: middle dots (7.3x) and connective commas (3.9x) in assistant replies against user messages.
- 297 Korean documents in yaml-sns-agent: sampled precision for each check pattern.
