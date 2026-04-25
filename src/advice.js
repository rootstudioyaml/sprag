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
        commands: ['Continue the same task in the same session (context switching = cache miss)'],
        commandsKo: ['같은 작업은 같은 세션에서 계속 (컨텍스트 전환 = 캐시 미스)'],
      },
      {
        label: 'Stabilize the prompt prefix',
        labelKo: '프롬프트 prefix 안정화',
        commands: ['System prompts / tool definitions that change per request invalidate the cache every time'],
        commandsKo: ['요청마다 바뀌는 시스템 프롬프트 / 도구 정의는 매번 캐시를 무효화'],
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
    en: 'Disable 1M context: `export CLAUDE_CODE_DISABLE_1M_CONTEXT=1` (or ⌥P toggle)',
    ko: '1M 컨텍스트 끄기: `export CLAUDE_CODE_DISABLE_1M_CONTEXT=1` (또는 ⌥P 토글)',
  },
  LOW_HIT_RATE: {
    en: 'Continue same task in same session; keep prompt prefix stable',
    ko: '같은 작업은 같은 세션에서 계속; 프롬프트 prefix 안정 유지',
  },
  BUCKET_5M_DOMINANT: {
    en: 'Send any prompt within 5min to keep cache warm; Max plan unlocks 1h TTL',
    ko: '5분 이내 한 번 더 보내 캐시 유지; Max 플랜은 1시간 TTL 제공',
  },
  HIGH_OUTPUT_RATIO: {
    en: 'Avoid full-file rewrites — prefer Edit tool; move long generations to scripts',
    ko: '파일 전체 재작성 피하기 — Edit 도구 사용; 긴 생성은 스크립트로',
  },
  HIGH_REQUEST_COUNT: {
    en: 'Bundle independent calls into one message; check for retry loops',
    ko: '독립 호출은 한 메시지에 묶기; 재시도 루프 점검',
  },
  FREQUENT_CACHE_REBUILD: {
    en: 'Continue one task in one session — short sessions trigger rebuild',
    ko: '한 작업은 한 세션에서 — 짧은 세션은 재빌드 유발',
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
