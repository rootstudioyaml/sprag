/**
 * gateway-auth: gateway address detection + auth-token resolution, split out
 * as a leaf module so other modules can read the LiteLLM gateway's address
 * and key without risking a circular import.
 *
 * Why this file exists: src/formatters/statusline.js imports MIN_VOTES from
 * src/model-alias.js, and src/litellm-budget.js imports from
 * formatters/statusline.js. If model-alias.js also needed gatewayBase() from
 * litellm-budget.js (to resolve gateway-supplied aliases), the import graph
 * would close a cycle: model-alias.js → litellm-budget.js →
 * formatters/statusline.js → model-alias.js. This module carries no
 * dependency on either side of that cycle, so both litellm-budget.js and
 * model-alias.js can import it safely.
 *
 * This module never persists the token it resolves. apiKeyHelper owns that
 * token's lifecycle (short TTL, refreshed on its own schedule); a cached
 * copy here would drift out of sync with that lifecycle. Callers receive the
 * key as a return value only and are expected to pass it along as a plain
 * argument, not to write it to disk, argv, logs, or error messages.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { debug } from './debug.js';

export const HELPER_TIMEOUT_MS = 10000;

/**
 * 게이트웨이 주소만 판정합니다. 캐시만 읽는 경로는 키가 필요하지 않으므로,
 * 키 확보와 주소 판정을 분리해 둡니다. apiKeyHelper 로만 인증하는 환경에는
 * 환경변수에 토큰이 없어서, 키를 함께 요구하면 렌더 경로가 통째로 탈락합니다.
 */
export function gatewayBase(env = process.env) {
  const base = (env.ANTHROPIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  // 공식 엔드포인트를 그대로 가리키면 게이트웨이가 아닙니다.
  if (/^https?:\/\/api\.anthropic\.com/i.test(base)) return null;
  return base;
}

/**
 * Claude Code 와 같은 방식으로 apiKeyHelper 를 실행해 토큰을 얻습니다.
 * 환경변수에 토큰을 두지 않고 헬퍼 스크립트로 매번 발급받는 구성이 공식 인증
 * 방식 가운데 하나이며, 그 구성에서는 statusline 자식 프로세스의 process.env
 * 안에 토큰이 존재하지 않습니다.
 *
 * 헬퍼 실행은 비용이 있으므로 갱신 경로(5분에 한 번 뜨는 detached 자식)에서만
 * 부릅니다. 수 초 간격으로 도는 렌더 경로에서 부르면 통계선이 그만큼 느려집니다.
 */
export function keyFromApiKeyHelper(cwd = process.cwd()) {
  const candidates = [
    join(cwd, '.claude', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.json'),
  ];
  for (const p of candidates) {
    let helper;
    try {
      helper = JSON.parse(readFileSync(p, 'utf8'))?.apiKeyHelper;
    } catch {
      continue;
    }
    if (typeof helper !== 'string' || !helper.trim()) continue;
    try {
      const out = execSync(helper, {
        encoding: 'utf8',
        timeout: HELPER_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      // 진행 로그를 함께 출력하는 헬퍼가 있으므로 마지막 비어 있지 않은 줄을 취합니다.
      const token = out.trim().split(/\r?\n/).filter(Boolean).pop();
      if (token) return token.trim();
    } catch (e) {
      debug('gateway-auth:helper', e);
    }
  }
  return null;
}

/** 환경변수 토큰을 먼저 보고, 없으면 apiKeyHelper 로 내려갑니다. */
export function resolveKey(env = process.env) {
  const direct = (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '').trim();
  return direct || keyFromApiKeyHelper();
}
