# Not a router

[← README](../README.md) · [한국어](#한국어)

## Not a router — 60 seconds

Sprag installs once, reads the sessions you already run, and does not ask you to change how you prompt. It never intercepts a request or swaps your model in realtime.

1. **A repeat becomes a rule.** The first failure is just work. On the second, Sprag surfaces it as a candidate; you approve the scope, and the rule loads at the start of every session after that.
2. **Safe work goes to a sub-agent.** When a task matches one your history shows is safe, Sprag spawns a sub-agent on a cheaper tier to do it and hands the result back for review. Anything that fails quietly stays with the main agent.
3. **Cost trouble shows up early.** Cache hit rate, TTL expiry, context growth and both rate-limit windows are read every turn and printed in your statusline, while you can still act on them.

### Why realtime model routing can cost more, not less

Never switching models mid-session is the point of this design.

Prompt caches are **kept per model.** Switch to a cheaper model mid-session and it starts from a cold cache, re-reading the whole conversation at full input price. A cache hit costs about a tenth of that, so past roughly 20k tokens of history **one switch can erase everything the cheaper model was going to save.** You moved the work down a tier and the bill went up: the central paradox of realtime routing.

Teams shipping routing products have turned the feature off for exactly this reason: [LLM 라우터를 만든 사람들이 직접 껐습니다 #Shorts](https://www.youtube.com/shorts/SK-GoAABjbg) (Korean).

So this tool never touches the main session's model. It delegates to **subagents only**, which leaves the main session's cache intact and runs the delegated work on a cheap model in its own context. That is why the savings are not cancelled out by cache loss.

```bash
npm i -g sprag-cli@latest
sprag route-scan         # find delegation candidates in your own history (0 LLM calls)
sprag route-scan rules   # list promoted rules · rm <N> to remove
sprag route-scan savings # audit every dollar the routing saved
```

Thresholds come from **your own last-14-day distribution (p25/p75)**, not someone else's benchmark.
Measured rule-health — whether a delegated run actually succeeded — landed in [v3.9.0](../CHANGELOG.md).

---

---

<a id="한국어"></a>

# Not a router (한국어)

## 라우터가 아닙니다: 60초 설명

설치는 한 번이면 됩니다. 이미 쓰고 있는 세션을 그대로 읽으므로, 프롬프트를 쓰는 방식을 바꾸라고 요구하지 않습니다. 요청을 실시간으로 가로채거나 모델을 바꿔치기하지도 않습니다.

1. **되풀이된 실패가 규칙이 됩니다.** 처음 겪는 실패는 그냥 작업입니다. 같은 실패가 두 번째로 나타나면 Sprag가 규칙 후보로 알립니다. 적용 범위를 승인하면 그 뒤로는 세션이 시작될 때마다 규칙이 함께 올라옵니다.
2. **안전한 작업은 하위 에이전트가 맡습니다.** 이력상 안전하다고 확인된 작업과 맞아떨어지면, 더 저렴한 티어로 하위 에이전트를 띄워 처리하고 결과를 메인에게 돌려 검수하게 합니다. 틀려도 겉으로 드러나지 않는 작업은 메인 에이전트가 계속 맡습니다.
3. **비용 문제를 미리 알려 줍니다.** 캐시 적중률과 TTL 만료, 컨텍스트 증가, 두 가지 사용량 한도를 매 턴 읽어 statusline에 띄웁니다. 아직 손쓸 수 있을 때 보입니다.

### 실시간 모델 라우팅이 오히려 비용을 키우는 이유

세션 도중에 모델을 바꾸지 않는다는 점이 이 도구의 핵심입니다.

프롬프트 캐시는 **모델별로 따로 유지됩니다.** 그래서 세션 중간에 더 싼 모델로 전환하면 새 모델은 빈 캐시에서 시작하고, 그때까지 쌓인 대화 전체를 정가로 다시 읽어야 합니다. 캐시 히트는 원래 입력가의 10분의 1 수준이므로, 대화가 2만 토큰만 넘어가도 **전환 한 번에 그날 아낀 금액이 통째로 사라집니다.** 싼 모델로 옮겼는데 청구서는 더 커지는, 실시간 라우팅의 대표적인 역설입니다.

실제로 라우팅 제품을 만들던 팀들이 같은 이유로 기능을 껐습니다: [LLM 라우터를 만든 사람들이 직접 껐습니다 #Shorts](https://www.youtube.com/shorts/SK-GoAABjbg)

이 도구는 그래서 메인 세션의 모델을 건드리지 않습니다. **서브에이전트 위임만 사용하므로** 메인 세션의 캐시는 그대로 유지되고, 위임된 작업만 별도 컨텍스트에서 싼 모델이 처리합니다. 절감액이 캐시 손실로 상쇄되지 않는 이유가 여기에 있습니다.

```bash
npm i -g sprag-cli@latest
sprag route-scan         # 지난 세션에서 위임 후보 추출 (LLM 호출 없음)
sprag route-scan rules   # 승격된 룰 확인 · rm <N> 으로 삭제
sprag route-scan savings # 위임으로 절감한 금액의 근거를 전수 확인
```

판정 기준선은 다른 사람의 벤치마크가 아니라 **사용자 본인의 최근 14일 분포(p25/p75)** 로 잡습니다.
위임한 뒤에 실제로 성공했는지까지 측정하는 rule-health는 [v3.9.0](../CHANGELOG.md)에 들어갔습니다.

---
