# Ratchet Rules (auto-grown by claude-token-saver)

같은 실수가 두 번 발생하면 여기에 한 줄 추가됩니다. 형식: "YYYY-MM-DD: <조건> → <행동>".

`claude-token-saver harness promote "<rule>"`로 룰을 추가하면 자동으로
이 파일에 append 됩니다.

## Rules

- 2026-09-16: sprag 변경을 원격에 올릴 때 → 리뷰는 origin(미러)에 작업 브랜치만 push 하고 Draft MR 을 만들며, 반영은 upstream(GitHub)에 main 만 push 한다. origin/main 에는 절대 push 하지 않는다: 미러가 upstream 에서 당겨오므로 직접 push 하면 갈라져 갱신이 멈춘다
