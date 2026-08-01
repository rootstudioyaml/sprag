# 고정 Discussion 초안 (Show and tell)

토큰 권한 부족으로 CLI 생성이 막혀 초안만 남긴다.
생성: https://github.com/rootstudioyaml/claude-token-saver/discussions/new?category=show-and-tell
생성 후 우측 ⋯ → Pin discussion.

## Title

어떤 작업을 어느 티어로 내렸나요? / What did you delegate, and to which tier?

## Body

`route-scan`이 여러분의 로그에서 무엇을 찾아냈는지 궁금합니다.

이 스레드에 한 줄씩 남겨 주세요 — 어떤 반복 작업이 어느 티어로 내려갔고, 실제로 잘 굴러갔는지.
민감한 내용은 빼고, 유형만 적으셔도 충분합니다.

```
작업 유형 :
판정 티어 : T2 / T1
적용 범위 : global / project
넘긴 뒤  : 잘 됨 / 다시 올렸음 (이유)
```

확인 명령:

```bash
claude-token-saver route-scan         # 후보
claude-token-saver route-scan rules   # 승격된 룰 + 실측 rule-health
```

---

I'd like to know what `route-scan` found in your logs.

Drop a line here: which recurring task got demoted to which tier, and whether it actually held up.
Task type only is fine — no need to share anything sensitive.

```
task type   :
tier        : T2 / T1
scope       : global / project
after moving: held up / promoted back (why)
```

무엇을 내리면 안 되는지에 대한 반례가 특히 반갑습니다. 임계값은 남의 벤치마크가 아니라
각자의 최근 14일 분포에서 나오기 때문에, 실패 사례가 기준선을 다듬는 데 제일 쓸모 있습니다.

Counter-examples are especially welcome. Thresholds come from each user's own last-14-day
distribution, so the failures are what actually sharpen the baseline.
