/**
 * Subcommand: oauth-budget, claude.ai usage-credit 예산(Enterprise) 조회.
 *   sprag oauth-budget            # 캐시된 예산을 게이지와 금액으로 출력
 *   sprag oauth-budget --json     # 캐시 원본 JSON 출력
 *   sprag oauth-budget --refresh  # 지금 조회 (detached 자식이 사용, opt-in 과 무관)
 */

import { debug } from '../debug.js';

export async function run({ hasFlag }) {
  const { oauthBudgetEnabled, readOauthState, refreshOauthBudgetState, formatOauthBudgetReport } =
    await import('../oauth-budget.js');
  const quiet = hasFlag('--quiet');
  if (hasFlag('--refresh')) {
    try {
      const next = await refreshOauthBudgetState(process.env, fetch);
      if (!quiet) console.log(JSON.stringify(next, null, 2));
    } catch (e) {
      debug('oauth-budget:refresh', e);
      if (!quiet) console.error(`oauth-budget refresh failed: ${e.message}`);
      process.exitCode = 1;
    }
    return;
  }
  if (!oauthBudgetEnabled()) {
    console.log('꺼져 있습니다. `sprag mode oauth-budget` 으로 켜십시오 (SPRAG_OAUTH_BUDGET=1 도 됩니다).');
    return;
  }
  const state = readOauthState();
  if (hasFlag('--json')) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  const { resolveLabelMode } = await import('../statusline-mode.js');
  const { statuslineDefaults } = await import('../config.js');
  const { mode: labelMode } = resolveLabelMode({ hasFlag, cfg: statuslineDefaults() });
  for (const line of formatOauthBudgetReport(state, new Date(), labelMode)) console.log(line);
}
