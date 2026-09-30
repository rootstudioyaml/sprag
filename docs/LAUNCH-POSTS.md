# 배포용 게시글 초안

이 문서는 외부 유입과 검색 색인에 필요한 링크를 만들기 위한 게시글 초안 모음입니다.
`sprag`라는 이름으로 검색해 들어오는 사람은 거의 없습니다. 사람들은 "Claude Code 토큰
줄이기", "Codex 사용량", "5시간 한도" 같은 문제로 검색하므로, 글의 제목과 첫 문장은
이름이 아니라 그 문제로 시작합니다.

2026-09-30 기준 실측 기준선은 GitHub 방문자 14일간 31명(Google 유입 4명)입니다. 게시 후
같은 명령으로 다시 재서 비교합니다(맨 아래 "게시 후에 확인할 것").

게시 순서는 Reddit(r/ClaudeCode), Hacker News, GeekNews 순을 권장합니다. 문제를 겪는
사용자가 가장 많이 모인 곳에서 반응을 먼저 보고, 반응이 좋았던 문구로 HN 제목을 정합니다.

모든 글은 **같은 요청 12개를 두 터미널에서 돌린 실측($6.68 대 $1.83)**으로 시작하고,
두 번째로 **실시간 라우터가 아니라는 점**을 말합니다. 앞의 것은 관심을 끌고, 뒤의 것은
이 분야에서 가장 흔한 오해를 먼저 막아 줍니다.

게시는 사람이 직접 합니다. 커뮤니티 대부분이 자동 게시나 대리 게시를 금지합니다.

---

## 1. Reddit

**서브레딧**: r/ClaudeCode 를 먼저 올리고, 반응을 본 뒤 r/ClaudeAI, r/codex 로 넓힙니다.
r/codex 판은 본문의 Claude 예시를 Codex 예시로 바꾸고 제목도 Codex로 바꿉니다.

**Title**

```
Same 12 requests in two Claude Code terminals: $6.68 vs $1.83. Here's what the cheaper one did differently
```

**Body**

```
I ran the same 12 everyday requests (lookups, test runs, reading a pasted log, a
couple of real edits, one big pptx) in two terminals. Same model, same prompts.
One ended the day at $6.68, the other at $1.83, priced at public list rates.
41-second video: https://sprag.io/assets/video/sprag-compare-en.mp4

The cheaper terminal did two things:

1. Lookups and test runs went to a Haiku/Sonnet subagent instead of the main
   Opus session. The main model never changed.
2. The deck went in as Markdown instead of an attachment (540k tokens -> 23k).

Point 1 is where most people's intuition goes wrong, so: **this is not a realtime
router.** Prompt caches are per-model. Switch models mid-conversation and the new
model starts cold and re-reads everything at full price, where a cache hit costs
about a tenth. Past ~20k tokens of context, one switch cancels a day of savings.
Delegating to a subagent leaves the main session's cache warm.

Which requests are safe to hand down isn't guessed. The tool reads your own
Claude Code (and Codex) session logs after the fact, finds request types the
expensive model kept handling, and proposes a rule. Thresholds come from your last
14 days, not someone else's benchmark. The scan makes no LLM calls.

Savings are a ledger, not an estimate: each delegated run gets both price tables
applied to the same token counts, and `sprag route-scan savings` shows the receipts.
Runs it can't attribute are dropped from the total.

It also puts cache TTL, 5h/7d limits and spend in the statusline, which is how I
noticed the problem in the first place.

Open source (Apache-2.0), local only, no API key: `npm i -g sprag-cli`
https://github.com/rootstudioyaml/sprag

Curious whether the per-model cache thing matches what others see.
```

**주의**: 서브레딧마다 자기 프로젝트 홍보 규칙이 다릅니다. 게시 전에 사이드바 규칙을
확인하고, 필요하면 자기 홍보 플레어를 붙이십시오. 링크를 본문 대신 댓글에 두어야 하는
곳도 있습니다.

---

## 2. Hacker News (Show HN)

**Title** (80자 제한, 현재 80자)

```
Show HN: Sprag – cut Claude Code and Codex spend by delegating to cheaper models
```

**URL**

```
https://github.com/rootstudioyaml/sprag
```

**First comment** (본문 대신 첫 댓글로 맥락을 답니다. Show HN의 관례입니다.)

```
I kept noticing my most expensive model doing the same boring things over and
over: running the test suite, telling me where a config value lived, reading back
a log I had pasted. So I wrote something that measures how often that happens and
does something about it. On a fixed set of 12 requests it took one day's cost from
$6.68 to $1.83 at list prices (video in the README).

The part I want to flag, because it's what most people assume it does and it
doesn't: this is not a realtime router. It never swaps the model mid-session.

That restraint is the whole design. Prompt caches are kept per model, so the moment
you hand a live conversation to a cheaper model, that model starts from an empty
cache and re-reads the entire transcript at full input price. A cache hit costs
roughly a tenth of that. Past about 20k tokens of context, a single switch eats the
day's savings.

So instead it reads the local session logs after the fact, finds request types the
expensive model handled repeatedly and a smaller model could have handled, and
proposes a delegation rule. From the next session, matching work goes to a
subagent on a cheaper tier in its own context. The main session's cache is never
touched. The analysis makes no LLM calls, so the scan is free. It works on Claude
Code and on Codex CLI (native spawn_agent hooks).

Savings are a ledger, not an estimate. For every delegated run it applies both
price tables to the same token counts and records the difference, and
`sprag route-scan savings` traces each dollar back to the rule that caused it.
Runs it can't attribute are excluded rather than guessed at.

Two other things ride along, because they were the other places I was burning
tokens: a statusline with cache TTL and 5h/7d limit windows, and a converter that
turns pptx/xlsx/pdf/docx into Markdown before the model reads them. One deck was
540k tokens as an attachment and 23k as Markdown.

`npm i -g sprag-cli`, Node 18+, Apache-2.0, runs locally.

Happy to talk about the measurement side. Attributing savings honestly turned out
to be harder than the routing itself.
```

**게시 시각**: 화요일부터 목요일 사이, 한국 시각 22시에서 24시(미국 동부 오전)를 권장합니다.

---

## 3. GeekNews (news.hada.io)

**제목**

```
같은 요청 12개에 $6.68 대 $1.83, Claude Code·Codex 토큰을 줄이는 CLI Sprag
```

**URL**

```
https://github.com/rootstudioyaml/sprag
```

**본문 요약**

```
같은 요청 12개를 두 터미널에서 돌렸을 때 하루 비용이 공개 정가 기준 $6.68에서
$1.83으로 줄었습니다. 차이를 만든 것은 두 가지입니다. 조회와 테스트 실행은 메인
세션 대신 Haiku나 Sonnet 서브에이전트가 맡았고, 발표 자료는 첨부 대신 Markdown으로
들어갔습니다(54만 토큰이 2만 3천 토큰으로 줄었습니다).

의도적으로 실시간 라우터가 아닙니다. 프롬프트 캐시는 모델별로 따로 유지되기 때문에,
대화 도중에 더 싼 모델로 넘기면 그 모델은 빈 캐시에서 시작해 그때까지 쌓인 대화
전체를 정가로 다시 읽습니다. 캐시 히트는 원래 입력가의 10분의 1 수준이므로,
컨텍스트가 2만 토큰만 넘어가도 전환 한 번에 그날 아낀 금액이 상쇄됩니다. 그래서
메인 세션의 모델은 건드리지 않고, 매칭된 작업만 별도 컨텍스트의 서브에이전트로
위임합니다.

어떤 작업을 넘길지는 사용자 본인의 세션 기록으로 정합니다. Claude Code와 Codex가
남긴 로그를 세션이 끝난 뒤 읽어서, 비싼 모델이 반복해 처리한 쉬운 요청 유형을 찾아
룰을 제안합니다. 판정 기준선은 최근 14일 분포에서 잡고, 분석 과정에서 LLM을
호출하지 않으므로 스캔 비용도 없습니다.

절감액은 추정이 아니라 원장 기록입니다. 위임된 실행마다 두 가격표를 같은 토큰량에
적용해 차액을 남기고, sprag route-scan savings 로 금액마다 근거가 된 룰까지
역추적합니다. 귀속할 수 없는 실행은 집계에서 뺍니다.

statusline에는 캐시 TTL, 5시간·7일 한도, 지출액이 실시간으로 나옵니다.

Apache-2.0, 로컬 실행, API 키 불필요, npm i -g sprag-cli
```

---

## 4. dev.to (기술 글)

제품 소개가 아니라 현상 설명 글로 씁니다. 도구는 마지막 문단에 한 줄로만 언급합니다.

**제목 후보**

```
Switching Claude Code to a cheaper model mid-session can raise your bill. Here's why.
```

**골자**: 프롬프트 캐시가 모델별로 유지된다는 사실, 컨텍스트 2만 토큰 이상에서 전환
한 번이 절감분을 상쇄하는 계산, 서브에이전트 위임은 왜 이 문제를 피하는지. 근거와
수치는 docs/NOT-A-ROUTER.md 에서 가져옵니다. 사이트의 가이드 페이지
(sprag.io/docs/reduce-claude-code-tokens/)를 canonical 참조로 링크합니다.

---

## 그 밖의 인바운드 링크 (2026-09-30 현황)

- hesreallyhim/awesome-claude-code: 이슈 양식으로만 추천을 받습니다. #2827 을
  2026-09-13에 제출했고 검증 봇은 통과했지만 메인테이너 응답은 아직 없습니다.
  한 번에 하나만 추천할 수 있으므로 재제출하지 않습니다. 2026-09-30에 정정 댓글을
  남겼습니다.
- ai-for-developers/awesome-ai-coding-tools: CLI Tools 섹션에 PR #810 을 2026-09-30에
  올렸습니다.
- 제외한 곳: rohitg00/awesome-claude-code-toolkit(2026-05 이후 머지 없음, 열린 PR 343개),
  composio-community/awesome-codex-skills(Codex 스킬 전용 목록이라 범위 밖).

## 게시 후에 확인할 것

게시하고 하루가 지나면 다음을 확인합니다.

```bash
# 저장소 유입 경로와 방문자 수 (기준선: 14일간 31명, Google 4명)
gh api repos/rootstudioyaml/sprag/traffic/popular/referrers
gh api repos/rootstudioyaml/sprag/traffic/views --jq '{count,uniques}'

# 색인 여부: 구글에서 site:sprag.io 로 검색합니다.
```
