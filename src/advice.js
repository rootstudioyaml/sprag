/**
 * Human-readable advice for each diagnostic issue code.
 * Platform-specific commands are selected from process.platform.
 */

function platformKind() {
  if (process.platform === 'win32') return 'win';
  // WSL shows up as 'linux' but $WSL_DISTRO_NAME is set — treat as linux either way.
  return 'posix';
}

function disable1mEnvSnippet() {
  if (platformKind() === 'win') {
    return [
      'setx CLAUDE_CODE_DISABLE_1M_CONTEXT 1',
      '(PowerShell) $env:CLAUDE_CODE_DISABLE_1M_CONTEXT = "1"',
    ];
  }
  return [
    "echo 'export CLAUDE_CODE_DISABLE_1M_CONTEXT=1' >> ~/.zshrc && source ~/.zshrc",
    '(bash) echo \'export CLAUDE_CODE_DISABLE_1M_CONTEXT=1\' >> ~/.bashrc && source ~/.bashrc',
  ];
}

function toggleShortcut() {
  return platformKind() === 'win' ? 'Alt + P' : '⌥ P (mac) / Alt + P (linux)';
}

/**
 * Each entry has parallel English / Korean fields. table.js only reads the
 * English fields (kept stable so the existing report layout doesn't shift).
 * `last` (bin/cli.js) renders both, English first then `└ Korean` continuation
 * — same bilingual style as the history.md file.
 *
 * `commandsKo` is optional per action: when a command is a literal code
 * snippet (e.g. `export CLAUDE_CODE_DISABLE_1M_CONTEXT=1`), there's nothing
 * to translate, so it's fine to omit and fall back to `commands`. When the
 * command is descriptive prose, provide a Korean version.
 */
export const ISSUE_MESSAGES = {
  LARGE_INPUT_PER_REQUEST: {
    title: 'Per-request input tokens are unusually large (1M context suspected)',
    titleKo: '요청당 입력 토큰이 비정상적으로 큼 (1M 컨텍스트 의심)',
    explain:
      'Since Opus 4.7, 1M context is priced at the standard rate, and Max plans auto-promote ' +
      'sessions to 1M. Once context goes past 200k, long-context pricing kicks in and cache reuse drops.',
    explainKo:
      'Opus 4.7부터 1M 컨텍스트가 표준 요금이 되었고, Max 플랜은 세션을 자동으로 1M으로 승격합니다. ' +
      '200k를 넘는 순간 장기 컨텍스트 요금이 적용되며 캐시 재사용률도 떨어집니다.',
    actions: () => [
      {
        label: 'Disable 1M context (env var)',
        labelKo: '1M 컨텍스트 끄기 (환경변수)',
        commands: disable1mEnvSnippet(),
      },
      {
        label: 'In-session toggle',
        labelKo: '세션 내 즉시 토글',
        commands: [`Press ${toggleShortcut()} to toggle on/off instantly`],
        commandsKo: [`${toggleShortcut()} 누르면 즉시 on/off 토글`],
      },
      {
        label: 'Cap extended-thinking budget (⚠ check /effort first)',
        labelKo: '확장 사고(thinking) 예산 제한 (⚠ /effort 먼저 확인)',
        commands: [
          '⚠ Run `/effort` to check current level — `xhigh` is the #1 cap killer',
          '/effort medium  — Anthropic-official default (use this for normal coding)',
          '/effort low     — for simple edits, labeling, boilerplate',
          '/effort xhigh   — ONLY for complex architecture / multi-file refactor planning, then revert',
          'export MAX_THINKING_TOKENS=8000  # global hard cap (overrides /effort)',
        ],
        commandsKo: [
          '⚠ `/effort`로 현재 단계 확인 — `xhigh`가 캡 소진의 1순위 원인',
          '/effort medium  — Anthropic 공식 기본값 (일반 코딩은 이걸로)',
          '/effort low     — 단순 편집·라벨링·보일러플레이트',
          '/effort xhigh   — 복잡한 아키텍처·다파일 리팩터 계획 한정, 끝나면 즉시 복귀',
          'export MAX_THINKING_TOKENS=8000  # 전역 하드 캡 (/effort 위에 우선 적용)',
        ],
      },
      {
        label: 'Plan mode preemptively (Shift+Tab)',
        labelKo: 'Plan 모드 선제 사용 (Shift+Tab)',
        commands: [
          'Plan mode forces a written plan before any edits — prevents wrong-direction rework',
          'Rework after a misread spec costs more tokens than 1 extra plan turn',
        ],
        commandsKo: [
          'Plan 모드는 편집 전에 계획을 쓰게 강제 — 잘못된 방향 재작업 방지',
          '스펙 오독 후 재작업이 plan 1턴 추가보다 훨씬 비쌈',
        ],
      },
      {
        label: 'Compact or clear when context grows',
        labelKo: '컨텍스트가 커지면 /compact 또는 /clear',
        commands: [
          '/compact  — summarize the session history in place',
          '/clear    — drop history entirely at a clean task boundary',
        ],
        commandsKo: [
          '/compact — 세션 히스토리를 그 자리에서 요약',
          '/clear   — 작업 분기점에서 히스토리를 통째로 비우기',
        ],
      },
      {
        label: '⚠ Known bug #31640',
        labelKo: '⚠ 알려진 버그 #31640',
        commands: [
          '/model 200k selection sometimes does not stick — context stays at 1M.',
          'To force off: set the env var above and restart Claude Code.',
        ],
        commandsKo: [
          '/model 200k 선택이 가끔 적용되지 않음 — 컨텍스트가 1M으로 유지됨.',
          '강제로 끄려면 위의 환경변수를 설정하고 Claude Code를 재시작.',
        ],
      },
    ],
  },
  LOW_HIT_RATE: {
    title: 'Cache hit rate is low',
    titleKo: '캐시 적중률이 낮음',
    explain:
      'A low hit rate means the same prompt prefix is being rewritten on every call, ' +
      'inflating input cost.',
    explainKo:
      '적중률이 낮다는 건 동일한 프롬프트 prefix가 매 호출마다 다시 쓰이고 있다는 뜻이며, ' +
      '입력 비용을 부풀립니다.',
    actions: () => [
      {
        label: 'Avoid opening fresh sessions too often',
        labelKo: '새 세션을 너무 자주 열지 말기',
        commands: [
          'Continue the same task in the same session (context switching = cache miss)',
          'Resume with `claude --continue` instead of starting fresh — preserves the prefix cache',
        ],
        commandsKo: [
          '같은 작업은 같은 세션에서 계속 (컨텍스트 전환 = 캐시 미스)',
          '새로 시작 대신 `claude --continue`로 재개 — prefix 캐시 보존',
        ],
      },
      {
        label: 'Stabilize the prompt prefix',
        labelKo: '프롬프트 prefix 안정화',
        commands: [
          'System prompts / tool definitions that change per request invalidate the cache every time',
          'Trim CLAUDE.md — every line ships on every turn; keep only durable rules',
        ],
        commandsKo: [
          '요청마다 바뀌는 시스템 프롬프트 / 도구 정의는 매번 캐시를 무효화',
          'CLAUDE.md 다이어트 — 모든 줄이 매 턴 실림; 영속적인 규칙만 유지',
        ],
      },
    ],
  },
  BUCKET_5M_DOMINANT: {
    title: 'Most cache writes are landing in the 5-minute TTL bucket',
    titleKo: '캐시 쓰기 대부분이 5분 TTL 버킷에 들어가고 있음',
    explain:
      'Pro plan is locked to 5m TTL. Gaps longer than 5 minutes expire the cache and force ' +
      'a costly rebuild.',
    explainKo:
      'Pro 플랜은 5분 TTL로 고정됩니다. 5분을 넘는 공백마다 캐시가 만료되고 비싼 재빌드가 강제됩니다.',
    actions: () => [
      {
        label: 'The 5-minute rule',
        labelKo: '5분 규칙',
        commands: [
          'Sending any prompt within 5 minutes keeps the prefix cache warm',
          'Upgrade to Max for the 1h TTL bucket on long tasks',
        ],
        commandsKo: [
          '5분 이내 어떤 프롬프트든 보내면 prefix 캐시가 유지됨',
          '긴 작업은 Max 플랜으로 업그레이드해서 1시간 TTL 버킷 사용',
        ],
      },
    ],
  },
  HIGH_OUTPUT_RATIO: {
    title: 'Output share is abnormally high',
    titleKo: '출력 비중이 비정상적으로 높음',
    explain:
      'Output tokens are 5x+ pricier than input. Check whether the agent is regenerating ' +
      'long content unnecessarily.',
    explainKo:
      '출력 토큰은 입력보다 5배 이상 비쌉니다. 에이전트가 불필요하게 긴 컨텐츠를 ' +
      '반복 생성하고 있지 않은지 확인하세요.',
    actions: () => [
      {
        label: 'Cap output length',
        labelKo: '출력 길이 줄이기',
        commands: [
          'Avoid full-file rewrites — prefer the Edit tool',
          'Move long doc/README generation requests into scripts to shrink output',
        ],
        commandsKo: [
          '파일 전체 재작성 피하기 — Edit 도구 우선 사용',
          '긴 문서/README 생성 요청은 스크립트로 옮겨 출력 축소',
        ],
      },
      {
        label: 'Cap extended-thinking budget (⚠ check /effort)',
        labelKo: '확장 사고(thinking) 예산 제한 (⚠ /effort 확인)',
        commands: [
          '⚠ Check `/effort` — `xhigh` burns thinking tokens that count as output',
          '/effort medium  — Anthropic-official default; switch back from xhigh',
          'export MAX_THINKING_TOKENS=8000  # global hard cap',
        ],
        commandsKo: [
          '⚠ `/effort` 확인 — `xhigh`는 thinking 토큰을 다량 소비 (출력으로 집계)',
          '/effort medium  — Anthropic 공식 기본값; xhigh에서 복귀',
          'export MAX_THINKING_TOKENS=8000  # 전역 하드 캡',
        ],
      },
      {
        label: 'Model matching strategy (80/15/5 rule)',
        labelKo: '모델 매칭 전략 (80/15/5 비율)',
        commands: [
          'Sonnet 80% — daily coding, edits, refactors',
          'Opus 15%  — complex design, multi-file refactor planning, deep debugging',
          'Haiku 5%  — boilerplate, labeling, summaries, subagent work',
          'Switch with `/model sonnet` / `/model opus` / `/model haiku`',
        ],
        commandsKo: [
          'Sonnet 80% — 일상 코딩, 편집, 리팩터링',
          'Opus 15%  — 복잡한 설계, 다파일 리팩터 계획, 깊은 디버깅',
          'Haiku 5%  — 보일러플레이트, 라벨링, 요약, 서브에이전트 작업',
          '`/model sonnet` / `/model opus` / `/model haiku`로 전환',
        ],
      },
    ],
  },
  HIGH_REQUEST_COUNT: {
    title: 'API calls in this session are 3x+ the baseline',
    titleKo: '이번 세션의 API 호출이 평소 대비 3배 이상',
    explain:
      'Excessive tool calls or retry/loop patterns rebroadcast the prefix on every call, ' +
      'spiking input cost.',
    explainKo:
      '과도한 도구 호출 또는 재시도/루프 패턴은 매 호출마다 prefix를 재전송해 입력 비용을 폭증시킵니다.',
    actions: () => [
      {
        label: 'Parallel / batch processing',
        labelKo: '병렬 / 배치 처리',
        commands: ['Bundle independent investigations into one message with multiple tool calls'],
        commandsKo: ['독립적인 조사 작업은 도구 호출 여러 개를 한 메시지로 묶어서 보내기'],
      },
      {
        label: 'Watch for loops',
        labelKo: '루프 감시',
        commands: ['Check that the agent is not repeating the same test/search in a loop'],
        commandsKo: ['에이전트가 동일한 테스트/검색을 루프로 반복하고 있지 않은지 확인'],
      },
      {
        label: 'Delegate large searches to a subagent (Sonnet by default)',
        labelKo: '대형 검색은 서브에이전트로 위임 (Sonnet 기본)',
        commands: [
          'Use the Task tool with the Explore subagent for repo-wide searches',
          'Pin custom subagents to Sonnet/Haiku in their frontmatter: `model: sonnet`',
          'The subagent runs in its own context — main session keeps a clean prefix',
        ],
        commandsKo: [
          '레포 전반 검색은 Task 도구의 Explore 서브에이전트로 위임',
          '커스텀 서브에이전트는 frontmatter에 `model: sonnet` 명시 (Opus 자동 상속 방지)',
          '서브에이전트는 자체 컨텍스트에서 실행 — 메인 세션 prefix가 깨끗하게 유지됨',
        ],
      },
      {
        label: 'Migrate MCP servers → Skills / CLI',
        labelKo: 'MCP 서버 → Skills / CLI 전환',
        commands: [
          '30 MCP tools ≈ 3,600 tokens loaded every turn — measured by mcp2cli (HN 146pts)',
          'Replacing rarely-used MCPs with Skills (loaded on demand) or shell CLI cuts ~96%',
          'Audit `.mcp.json` and disable everything not used weekly',
        ],
        commandsKo: [
          'MCP 도구 30개 ≈ 매 턴 3,600 토큰 상시 로드 (mcp2cli 측정, HN 146pts)',
          '드물게 쓰는 MCP를 Skills(필요 시 로드) 또는 셸 CLI로 대체하면 ~96% 절감',
          '`.mcp.json` 점검해 주간에 안 쓰는 건 모두 비활성화',
        ],
      },
      {
        label: 'Trim hooks that inject context',
        labelKo: '컨텍스트 주입 훅 정리',
        commands: ['Disable noisy PreToolUse/PostToolUse hooks unless they earn their tokens'],
        commandsKo: ['값을 못 하는 PreToolUse/PostToolUse 훅은 비활성화'],
      },
    ],
  },
  TTL_EXPIRY_IMMINENT: {
    title: 'Cache TTL is about to expire',
    titleKo: '캐시 TTL 만료 임박',
    explain:
      'Once the TTL window closes, the entire prefix cache is discarded and must be rebuilt ' +
      'from scratch on the next call — paying full input cost again.',
    explainKo:
      'TTL 창이 닫히면 prefix 캐시 전체가 폐기되고 다음 호출에서 처음부터 재구축해야 합니다 — ' +
      '전체 입력 비용이 다시 청구됩니다.',
    actions: () => [
      {
        label: 'Send any prompt within the TTL window',
        labelKo: 'TTL 창 안에 어떤 프롬프트든 보내기',
        commands: [
          'Even a short "." or summary request resets the TTL clock',
          'Pro plan TTL = 5 min; Max plan TTL = 1 hour',
        ],
        commandsKo: [
          '"." 한 글자나 짧은 요약 요청만 해도 TTL 타이머가 리셋됨',
          'Pro 플랜 TTL = 5분; Max 플랜 TTL = 1시간',
        ],
      },
      {
        label: 'Use /compact before going idle',
        labelKo: '자리를 비우기 전에 /compact 실행',
        commands: [
          '/compact summarizes the conversation in place and re-anchors the cache',
          'The compacted summary is much smaller — next rebuild is cheaper',
        ],
        commandsKo: [
          '/compact는 대화를 그 자리에서 요약하고 캐시를 재고정',
          '요약된 컨텍스트는 훨씬 작아서 다음 재빌드 비용도 줄어듦',
        ],
      },
      {
        label: 'Upgrade to Max for 1h TTL',
        labelKo: 'Max 플랜으로 업그레이드해 1시간 TTL 확보',
        commands: [
          'Pro plan is capped at 5-minute TTL — any break longer than that expires the cache',
          'Max plan uses the 1-hour extended TTL bucket by default',
        ],
        commandsKo: [
          'Pro 플랜은 5분 TTL 고정 — 5분 이상 공백이면 캐시 만료',
          'Max 플랜은 기본적으로 1시간 TTL 버킷을 사용',
        ],
      },
    ],
  },
  CONTEXT_NEAR_LIMIT: {
    title: 'Context window is approaching the limit',
    titleKo: '컨텍스트 창이 한계에 근접',
    explain:
      'As context grows toward 200k (or 1M), each turn becomes more expensive and cache ' +
      'reuse efficiency drops. Past 200k, long-context pricing applies.',
    explainKo:
      '컨텍스트가 200k(또는 1M)에 가까워질수록 매 턴 비용이 높아지고 캐시 재사용 효율이 떨어집니다. ' +
      '200k를 넘으면 장기 컨텍스트 요금이 적용됩니다.',
    actions: () => [
      {
        label: '/compact at the next natural break',
        labelKo: '다음 자연스러운 중단점에서 /compact',
        commands: [
          '/compact replaces the full conversation with a compact summary',
          'Run it before context hits the limit — not after (compaction itself costs tokens)',
        ],
        commandsKo: [
          '/compact는 전체 대화를 압축 요약으로 교체',
          '한계에 도달하기 전에 실행 — 이후엔 compact 자체도 비쌈',
        ],
      },
      {
        label: 'Re-attach only what you need after /clear',
        labelKo: '/clear 후 필요한 것만 재첨부',
        commands: [
          '/clear resets context to zero — cheapest option when task scope has shifted',
          'Re-read only the files Claude needs right now, not everything from before',
        ],
        commandsKo: [
          '/clear는 컨텍스트를 완전 초기화 — 작업 범위가 바뀌었을 때 가장 저렴',
          '지금 필요한 파일만 다시 읽기, 이전 파일 전부 재로드 금지',
        ],
      },
      {
        label: 'Avoid 1M context unless required',
        labelKo: '필요하지 않으면 1M 컨텍스트 비활성화',
        commands: [
          'export CLAUDE_MODEL_CONTEXT=200000  # force 200k cap',
          'Max plan auto-promotes to 1M — disable if you don\'t need it',
        ],
        commandsKo: [
          'export CLAUDE_MODEL_CONTEXT=200000  # 200k로 고정',
          'Max 플랜은 자동으로 1M 승격 — 불필요하면 비활성화',
        ],
      },
    ],
  },
  FREQUENT_CACHE_REBUILD: {
    title: 'Cache writes outweigh cache reads',
    titleKo: '캐시 쓰기가 읽기보다 많음',
    explain:
      'The cache is being created but not reused. Common when sessions are short-lived or ' +
      'restarted after TTL expiry.',
    explainKo:
      '캐시가 만들어지지만 재사용되지 않고 있습니다. 세션이 짧거나 TTL 만료 후 재시작될 때 흔합니다.',
    actions: () => [
      {
        label: 'Check session continuity',
        labelKo: '세션 연속성 점검',
        commands: ['Continue one task in one Claude Code session'],
        commandsKo: ['하나의 작업은 하나의 Claude Code 세션에서 계속'],
      },
      {
        label: 'Use /compact at task boundaries',
        labelKo: '작업 분기점에서 /compact 사용',
        commands: [
          '/compact summarizes prior turns in place — keeps the session alive without re-reading everything',
          'Better than starting a fresh session, which forces a full prefix rebuild',
        ],
        commandsKo: [
          '/compact는 이전 턴을 그 자리에서 요약 — 전체 재읽기 없이 세션 유지',
          '새 세션을 여는 것보다 나음 (새 세션은 prefix 전체 재구축 강제)',
        ],
      },
      {
        label: 'Avoid re-reading large files',
        labelKo: '큰 파일 반복 Read 피하기',
        commands: [
          'Prefer `git diff` to see what changed instead of re-reading the whole file',
          'Edit returns success silently — no need to Read after editing',
        ],
        commandsKo: [
          '파일 전체 다시 읽기 대신 `git diff`로 변경분만 확인',
          'Edit는 성공 시 조용히 끝남 — 편집 후 Read 다시 할 필요 없음',
        ],
      },
    ],
  },
};

/**
 * One-line action tips per issue code — bilingual. Used by history.js to
 * inline a "what to do" hint right below each warning event in the daily
 * markdown file, so the file alone is enough to answer "what was the warning,
 * and how do I fix it" without re-running the tool.
 *
 * The full multi-step advice still lives in `ISSUE_MESSAGES[code].actions()`;
 * `claude-token-saver last` prints that long form on demand.
 */
export const ISSUE_TIPS = {
  LARGE_INPUT_PER_REQUEST: {
    en: 'Check `/effort` — `xhigh` is the #1 cap killer; switch to `/effort medium` (or `low`); disable 1M context; `/compact` when context grows',
    ko: '`/effort` 확인 — `xhigh`가 캡 소진 1순위 원인, `medium`(또는 `low`)으로 복귀; 1M 컨텍스트 끄기; 컨텍스트 커지면 `/compact`',
  },
  LOW_HIT_RATE: {
    en: 'Continue with `claude --continue`; keep CLAUDE.md trim — every line ships every turn',
    ko: '`claude --continue`로 재개; CLAUDE.md 다이어트 — 모든 줄이 매 턴 실림',
  },
  BUCKET_5M_DOMINANT: {
    en: 'Send any prompt within 5min to keep cache warm; Max plan unlocks 1h TTL',
    ko: '5분 이내 한 번 더 보내 캐시 유지; Max 플랜은 1시간 TTL 제공',
  },
  HIGH_OUTPUT_RATIO: {
    en: 'Check `/effort` (`xhigh` inflates output); prefer Edit over full rewrites; model matching: Sonnet 80% / Opus 15% / Haiku 5%',
    ko: '`/effort` 확인 (`xhigh`는 출력 폭증); Edit 도구 우선 (전체 재작성 피하기); 모델 매칭: Sonnet 80% / Opus 15% / Haiku 5%',
  },
  HIGH_REQUEST_COUNT: {
    en: 'Bundle calls into one message; delegate to subagents (`model: sonnet`); migrate MCP→Skills/CLI (30 tools = ~3,600 tokens/turn)',
    ko: '호출은 한 메시지에 묶기; 서브에이전트(`model: sonnet`)로 위임; MCP→Skills/CLI 전환 (30 tools ≈ 매 턴 3,600 토큰)',
  },
  FREQUENT_CACHE_REBUILD: {
    en: 'Continue one task in one session; use `/compact` at boundaries; avoid re-reading large files (use `git diff`)',
    ko: '한 작업은 한 세션에서; 분기점에선 `/compact`; 큰 파일 재읽기 대신 `git diff`',
  },
  TTL_EXPIRY_IMMINENT: {
    en: 'Send any prompt now to reset the TTL clock; or `/compact` before going idle (Pro = 5min, Max = 1h)',
    ko: '지금 바로 아무 프롬프트나 보내 TTL 타이머 리셋; 또는 자리 비우기 전 `/compact` (Pro = 5분, Max = 1시간)',
  },
  CONTEXT_NEAR_LIMIT: {
    en: '`/compact` before hitting the limit; `/clear` + re-attach only needed files; disable 1M: `export CLAUDE_MODEL_CONTEXT=200000`',
    ko: '한계 도달 전 `/compact`; `/clear` 후 필요한 파일만 재첨부; 1M 끄기: `export CLAUDE_MODEL_CONTEXT=200000`',
  },
};

/**
 * Chip text → diagnostic codes. Some chips fire without a `detail` line that
 * includes the code (e.g. `⚠ 1M ON`, which only carries context info), so we
 * need a fallback so history.js can still surface the right tip.
 */
export const CHIP_TO_CODES = {
  '⚠ 1M ON': ['LARGE_INPUT_PER_REQUEST'],
  '⚠ Cache miss': ['LOW_HIT_RATE'],
  '⚠ Input spike': ['LARGE_INPUT_PER_REQUEST'],
  '⚠ 5m TTL': ['BUCKET_5M_DOMINANT'],
  '⚠ Rebuild churn': ['FREQUENT_CACHE_REBUILD'],
  '⚠ Output heavy': ['HIGH_OUTPUT_RATIO'],
  '⚠ Call surge': ['HIGH_REQUEST_COUNT'],
  '⏳ Cache expires': ['TTL_EXPIRY_IMMINENT'],
  '⏳': ['TTL_EXPIRY_IMMINENT'],
  '📦': ['CONTEXT_NEAR_LIMIT'],
};

/**
 * Cap-warn (5h/7d >=90%) advice — bilingual. Always points at `handoff`
 * because once the cap blocks you, you need a fresh session to continue.
 */
export const CAP_TIPS = {
  en: 'Run `claude-token-saver handoff` to back up state before the cap blocks you',
  ko: '`claude-token-saver handoff` 실행해서 캡 도달 전에 상태 백업',
};

/**
 * For the statusline: the single most relevant short chip (1~2 words).
 * Priority reflects what a user can act on *right now*.
 * Kept short and English-only — these ride along on a single-line statusline
 * shown to a global audience.
 */
export function chipForIssues(issues, contextWindow) {
  if (contextWindow?.size === '1M') return '⚠ 1M ON';
  const codes = issues.map((i) => i.code);
  if (codes.includes('LARGE_INPUT_PER_REQUEST')) return '⚠ Input spike';
  if (codes.includes('BUCKET_5M_DOMINANT')) return '⚠ 5m TTL';
  if (codes.includes('LOW_HIT_RATE')) return '⚠ Cache miss';
  if (codes.includes('FREQUENT_CACHE_REBUILD')) return '⚠ Rebuild churn';
  if (codes.includes('HIGH_OUTPUT_RATIO')) return '⚠ Output heavy';
  if (codes.includes('HIGH_REQUEST_COUNT')) return '⚠ Call surge';
  return null;
}
