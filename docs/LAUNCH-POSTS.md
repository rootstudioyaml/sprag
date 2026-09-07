# 배포용 게시글 초안

이 문서는 검색 색인에 필요한 외부 링크를 만들기 위한 게시글 초안 모음입니다.
현재 `claude-token-saver`라는 이름은 여러 동명 프로젝트와 충돌하고 있고, GitHub와
npm 페이지만으로는 크롤러가 찾아오지 않습니다. 아래 글들이 만들어 내는 외부 링크가
사실상 색인 여부를 가릅니다.

게시 순서는 Hacker News, Reddit, GeekNews 순을 권장합니다. Hacker News가 가장 강한
링크를 만들어 주고, 나머지 두 곳은 그 결과에 따라 문구를 조정하면 되기 때문입니다.

모든 글에서 **실시간 라우터가 아니라는 점**을 가장 먼저 말합니다. 이 분야에서 가장
흔한 오해이고, 동시에 다른 도구와 구별되는 지점이기도 합니다.

---

## 1. Hacker News (Show HN)

**Title** (80자 제한, 현재 74자)

```
Show HN: Cut Claude Code costs by delegating repeat work to cheaper models
```

**URL**

```
https://github.com/rootstudioyaml/claude-token-saver
```

**First comment** (본문 대신 첫 댓글로 맥락을 답니다. Show HN의 관례입니다.)

```
I kept noticing that my most expensive model was doing the same boring things over
and over — running the test suite, telling me where a config value lived, reading
back a log I had pasted. So I wrote something that measures how often that happens
and does something about it.

The part I want to flag, because it's the thing most people assume it does and it
doesn't: this is not a realtime router. It never swaps the model mid-session.

That restraint is the whole design. Prompt caches are kept per model, so the moment
you hand a live conversation to a cheaper model, that model starts from an empty
cache and re-reads the entire transcript at full input price. A cache hit costs
roughly a tenth of that. Past about 20k tokens of context, a single switch eats the
day's savings — you moved to the cheap model and your bill went up. Teams who
shipped realtime routing have quietly turned it off for exactly this reason.

So instead it reads the local session logs after the fact, finds request types your
expensive model handled repeatedly and that a smaller model could have handled, and
writes a delegation rule. From the next session, matching work goes to a haiku or
sonnet subagent in its own context. The main session's cache is never touched. The
analysis makes no LLM calls of its own, so the scan is free.

Savings are a ledger, not an estimate. For every delegated run it applies both price
tables to the same token counts and records the difference, and `route-scan savings`
traces each dollar back to the rule that caused it. Runs it can't attribute — work
no registered rule owns, or a model name the price table doesn't recognize — are
excluded rather than guessed at. An honest number beats a big one.

Two other things ride along, because they were the other places I was burning tokens:
a harness that blocks "all done!" reports with no evidence attached (measured -18.6%
on my own usage), and a converter that turns pptx/xlsx/pdf/docx/fig into Markdown
before the model reads them — one deck was 510k tokens as an attachment.

Zero dependencies, `npm i -g claude-token-saver`, Node 18+, MIT.

Happy to talk about the measurement side. Attributing savings honestly turned out to
be much harder than the routing itself.
```

**게시 시각**: 화요일부터 목요일 사이, 한국 시각 22시에서 24시 (미국 동부 오전)를 권장합니다.

---

## 2. Reddit

**서브레딧**: r/ClaudeAI 를 우선하고, 반응이 있으면 r/LocalLLaMA 와 r/ChatGPTCoding 으로 확장합니다.

**Title**

```
I measured which requests my expensive Claude model kept wasting itself on, then made it delegate them
```

**Body**

```
Short version: a CLI that reads your Claude Code session logs *after* the session
ends, finds the request types where an expensive model kept doing work a cheap model
could do, and registers a rule so those go to a haiku/sonnet subagent from then on.

**It is deliberately not a realtime router**, and that's the interesting part.

Prompt caches are per-model. Switch models mid-conversation and the new model starts
cold and re-reads everything at full price, where a cache hit would have cost about
a tenth. Past ~20k tokens of context, one switch cancels out a day of savings. You
end up on the cheaper model with a bigger bill.

So this never touches the main session's model. It only delegates matched work to
subagents, which run in their own context — the main cache stays warm.

Some details:

- The tier thresholds come from *your* last 14 days (p25/p75), not someone else's
  benchmark.
- It tracks whether delegated runs actually succeeded, and each rule carries a token
  cap so a bad delegation hands control back instead of grinding.
- Savings are recorded per run by applying both price tables to the same token
  counts. `route-scan savings` shows the receipts. Anything it can't attribute is
  dropped from the total instead of estimated.
- The scan itself makes no LLM calls.

Also bundles a statusline (rate-limit windows, cache hit rate, TTL countdown,
context usage) and a doc2md converter for pptx/xlsx/pdf/docx/fig, because attaching
a deck raw cost me 510k tokens once.

Zero deps, MIT, `npm i -g claude-token-saver`

https://github.com/rootstudioyaml/claude-token-saver

Curious whether the per-model cache thing matches what other people are seeing. It's
the part that surprised me most.
```

**주의**: r/ClaudeAI 는 자기 프로젝트 홍보에 규칙이 있습니다. 게시 전에 사이드바 규칙을
확인하고, 필요하면 자기 홍보 플레어를 붙이십시오. 댓글에 링크만 남기는 방식이 더 안전한
서브레딧도 있습니다.

---

## 3. GeekNews (news.hada.io)

**제목**

```
비싼 Claude 모델이 반복하던 쉬운 작업을 싼 모델로 내려보내는 CLI
```

**URL**

```
https://github.com/rootstudioyaml/claude-token-saver
```

**본문 요약**

```
Claude Code 세션 기록을 세션이 끝난 뒤에 읽어서, 비싼 모델이 반복해서 처리해 온 쉬운
요청 유형을 찾아내고, 그 유형은 다음 세션부터 haiku나 sonnet 서브에이전트가 맡도록
룰로 등록하는 CLI입니다.

의도적으로 실시간 라우터가 아닙니다. 프롬프트 캐시는 모델별로 따로 유지되기 때문에,
대화 도중에 더 싼 모델로 넘기면 그 모델은 빈 캐시에서 시작해 그때까지 쌓인 대화 전체를
정가로 다시 읽습니다. 캐시 히트가 원래 입력가의 10분의 1 수준이므로, 컨텍스트가 2만
토큰만 넘어가도 전환 한 번에 그날 아낀 금액이 상쇄됩니다. 싼 모델로 옮겼는데 청구서는
더 커지는 셈입니다.

그래서 메인 세션의 모델은 건드리지 않고, 매칭된 작업만 별도 컨텍스트의 서브에이전트로
위임합니다. 메인 캐시는 그대로 유지됩니다. 분석 과정에서 LLM을 추가로 호출하지 않으므로
스캔 자체에 드는 비용도 없습니다.

절감액은 추정이 아니라 원장 기록입니다. 위임된 실행마다 기준 모델과 실행 모델의 가격표를
같은 토큰량에 각각 적용해 차액을 남기고, route-scan savings 명령으로 금액마다 근거가 된
룰까지 역추적할 수 있습니다. 귀속할 수 없는 실행은 추정하지 않고 집계에서 뺍니다.

판정 기준선도 남의 벤치마크가 아니라 사용자 본인의 최근 14일 분포(p25/p75)로 잡습니다.

함께 들어 있는 것으로는 statusline(5시간·7일 한도, 캐시 히트율, TTL, 컨텍스트 사용률),
증거 없는 완료 보고를 막는 Harness 다섯 원칙, 그리고 pptx·xlsx·pdf·docx·fig를 모델이
읽기 전에 Markdown으로 바꾸는 doc2md가 있습니다.

의존성 0, MIT, npm i -g claude-token-saver
```

---

## 그 밖의 인바운드 링크

게시글만큼 즉각적이지는 않지만 꾸준히 도움이 되는 경로들입니다.

- `awesome-claude-code` 계열 목록 저장소에 PR을 보냅니다. 목록에 오르면 그 저장소를
  포크한 곳들에도 링크가 함께 퍼집니다.
- dev.to에 캐시가 모델별로 유지된다는 사실 하나만 다루는 기술 글을 씁니다. 제품 소개가
  아니라 현상 설명으로 쓰고, 도구는 말미에 한 줄로 언급합니다.
- Claude Code 관련 도구를 모아 두는 디렉터리 사이트에 등록합니다.

## 게시 후에 확인할 것

게시하고 하루가 지나면 다음을 확인합니다.

```bash
# 색인 여부
# 구글에서 site:rootstudioyaml.github.io 로 검색합니다.

# 저장소 유입 경로
gh api repos/rootstudioyaml/claude-token-saver/traffic/popular/referrers
```
