**한국어** · [English](./README.en.md)

# claude-token-saver

> v2.0에서 `claude-cache-monitor` → `claude-token-saver`로 이름이 바뀌었습니다. 기존 사용자는 [마이그레이션](#마이그레이션-claude-cache-monitor에서) 참고.

Claude Code의 **토큰 사용량을 진단·절약**하는 CLI. 캐시 히트율, TTL 카운트다운, 1M 컨텍스트 감지, 5h/7d 한도 경고를 statusline 한 줄로 보여줍니다.

📺 [출시 영상 (60초)](https://www.youtube.com/shorts/RaD8qMsPTnA)

---

## 설치

```bash
# 1. (기존 사용자) 구 패키지 제거
npm uninstall -g claude-cache-monitor

# 2. 설치
npm i -g claude-token-saver

# 3. Claude Code 통합 (Skill + statusline 안내)
claude-token-saver install
```

설치 없이 한 번만 실행하려면 `npx claude-token-saver`.

## 설치 후 보이는 것

**(A) 단발 리포트** — `claude-token-saver` 실행 시:

```
Claude 토큰 아껴쓰기 — Last 30 days
Context window: 200k  ✓ 표준
Cache hit rate: 98.2%  |  Total input: 1957.94M tokens
TTL Breakdown / Cost Impact / Daily Trend ...
```

급증 세션이 있으면 상단에 `⚠ 토큰 급증 감지` 블록과 원인·해결 명령이 함께 출력됩니다.

**(B) statusline 한 줄** — `~/.claude/settings.json`에 등록 시:

```
🧠 97.5% · ⏳ 1h 42:15 · 💰 $4.8K · 🤖 Opus 4.7 · ✦ 5H 47% · 📅 7D 9%
```

위험 상황에서는 칩이 앞으로 튀어나옵니다 — `🚨 5H 94%`, `⚠ 1M ON`, `⚠ Cache miss`, `⚠ 5m TTL` 등.

## statusline 등록

```json
{
  "statusLine": {
    "type": "command",
    "command": "claude-token-saver --statusline --icon",
    "refreshInterval": 1
  }
}
```

`refreshInterval: 1`은 TTL 카운트다운이 idle 상태에서도 1초마다 갱신되게 합니다. Windows(PowerShell)는 `examples/statusline-command.ps1` 참고.

## 주요 명령

| 명령 | 설명 |
|---|---|
| `claude-token-saver` | 최근 30일 진단 리포트 |
| `claude-token-saver --days 7` | 기간 변경 |
| `claude-token-saver --statusline --icon` | statusline용 한 줄 |
| `claude-token-saver install` | Claude Code Skill 자동 등록 (칩 단어 언급 시 자동 활성) |
| `claude-token-saver history` | 최근 7일간 칩 전이 로그 (1M ON, Cache miss, cap 등) |
| `claude-token-saver handoff` | 현재 작업을 `HANDOFF-YYYY-MM-DD-HHMM.md`로 백업 (cap 임박 시) |
| `claude-token-saver --install-hook` | 매 도구 호출마다 캐시 통계 자동 로깅 |

전체 옵션은 `--help` 또는 [영문 README](./README.en.md#options).

## 진단되는 급증 원인

| 코드 | 의미 |
|---|---|
| `LARGE_INPUT_PER_REQUEST` | 단일 요청 250k+ → 1M 컨텍스트 의심 |
| `LOW_HIT_RATE` | 캐시 히트율 < 50% |
| `BUCKET_5M_DOMINANT` | 캐시 쓰기의 70%+가 5분 버킷 (Pro 플랜 또는 Max 다운그레이드) |
| `HIGH_OUTPUT_RATIO` | 출력/입력 > 0.15 (출력은 입력의 5배 가격) |
| `FREQUENT_CACHE_REBUILD` | 캐시 재작성이 읽기보다 많음 |

각 코드마다 OS별 해결 명령(`~/.zshrc` / `setx`)이 함께 출력됩니다.

## 마이그레이션 (claude-cache-monitor에서)

```bash
npm uninstall -g claude-cache-monitor
npm i -g claude-token-saver
```

`~/.claude/settings.json`의 `statusLine.command`를 `claude-cache-monitor …` → `claude-token-saver …`로 교체하세요. v2.0 이전의 `claude-cache-monitor` 바이너리 별칭은 npm 충돌(EEXIST) 때문에 제거됐습니다.

## 동작 원리

Claude Code는 모든 API 응답을 `~/.claude/projects/<dir>/<session>.jsonl`에 기록합니다. 이 도구는 `cache_read_input_tokens`, `cache_creation.ephemeral_5m/1h_input_tokens` 등을 `requestId`로 중복 제거 후 일·세션 단위로 집계합니다.

## 환경

Node.js ≥ 18 · macOS / Linux / Windows / WSL · 의존성 0.

## 라이선스

MIT
