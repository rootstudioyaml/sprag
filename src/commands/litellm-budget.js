/**
 * Subcommand: litellm-budget · LiteLLM 게이트웨이 키의 max_budget/spend 조회.
 *   sprag litellm-budget            # 캐시된 예산을 게이지·금액으로 출력
 *   sprag litellm-budget --json     # 캐시 원본 JSON 출력
 *   sprag litellm-budget --refresh  # 지금 프록시에 물어봄 (detached 자식이 사용)
 */

import { debug } from '../debug.js';

export async function run({ hasFlag }) {
  const { gatewayBase, readBudgetState, refreshBudgetState, formatBudgetReport, resolveKey } =
    await import('../litellm-budget.js');
  const quiet = hasFlag('--quiet');
  if (hasFlag('--refresh')) {
    try {
      // apiKeyHelper 가 토큰 수명(TTL)을 소유합니다. 헬퍼를 한 번만 불러 그
      // 키를 예산 갱신과 게이트웨이 모델맵 갱신 양쪽에 재사용합니다. 갱신
      // 경로마다 resolveKey() 를 다시 부르면 사본을 만드는 셈이 되고, 헬퍼
      // 호출 횟수도 그만큼 늘어납니다.
      const key = resolveKey();
      let next = null;
      if (key) {
        next = await refreshBudgetState(process.env, fetch, key);
        const { maybeRefreshGatewayModelMap } = await import('../litellm-models.js');
        await maybeRefreshGatewayModelMap({ base: gatewayBase(), key });
      }
      if (!quiet) console.log(JSON.stringify(next, null, 2));
    } catch (e) {
      debug('litellm-budget:refresh', e);
      if (!quiet) console.error(`litellm-budget refresh failed: ${e.message}`);
      process.exitCode = 1;
    }
    return;
  }
  // 읽기 경로는 캐시만 보므로 키를 요구하지 않습니다 (apiKeyHelper 환경 배려).
  const base = gatewayBase();
  if (!base) {
    console.log('게이트웨이가 감지되지 않았습니다 (ANTHROPIC_BASE_URL 필요).');
    return;
  }
  const state = readBudgetState();
  if (hasFlag('--json')) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (state.base !== base || state.maxBudget === undefined) {
    console.log('예산 캐시가 비어 있습니다. `sprag litellm-budget --refresh` 로 먼저 조회하십시오.');
    return;
  }
  // Same resolver the statusline uses: this report draws a gauge too, and a
  // glyph the terminal's font lacks garbles here exactly as it does there.
  const { resolveLabelMode } = await import('../statusline-mode.js');
  const { statuslineDefaults } = await import('../config.js');
  const { mode: labelMode } = resolveLabelMode({ hasFlag, cfg: statuslineDefaults() });
  for (const line of formatBudgetReport(state, new Date(), labelMode)) console.log(line);
}
