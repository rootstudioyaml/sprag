/**
 * model-alias의 게이트웨이 단계(gateway.aliases, LiteLLM `/model/info`에서
 * 파생) 우선순위와 조회 방식을 검증합니다.
 *
 * 확인할 순서는: 사용자 override > gateway.aliases > (ARN이 아니면 그대로
 * 반환) > 자기서술 프로파일 ID > learned 투표 > unknown. gateway 단계가
 * isGatewayModelId 의 조기 반환보다 앞에 있어야, 계열명이 없는 사내 별칭
 * (ARN이 아닌 문자열)도 게이트웨이 매핑으로 해석된다.
 *
 * model-alias.test.js 의 isolated() 관례를 그대로 따르되, ANTHROPIC_BASE_URL
 * 도 함께 임시값으로 돌립니다. gateway.aliases 는 예산 캐시와 같은 방식으로
 * base 단위로 격리되므로, base 처리도 별도로 검증합니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveModelAlias,
  resetModelAliasCache,
  saveProfileMap,
  loadProfileMap,
  UNKNOWN_MODEL,
} from '../src/model-alias.js';

const GATEWAY_BASE = 'https://litellm.example.com';
const ACCOUNT = '000000000000';

const arn = (pid) =>
  `converse/arn:aws:bedrock:ap-northeast-2:${ACCOUNT}:application-inference-profile/${pid}`;

const OPUS_ALIAS = 'ap-northeast-2.anthropic.claude-opus-5[1m]';
const SONNET_ALIAS = 'ap-northeast-2.anthropic.claude-sonnet-5[1m]';
const HAIKU_ALIAS = 'global.anthropic.claude-haiku-4-5[1m]';

/** model-alias.test.js 의 isolated() 와 같되, ANTHROPIC_BASE_URL 도 함께 돌립니다. */
function isolated(t, { base = GATEWAY_BASE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-alias-gw-'));
  const prev = {
    xdg: process.env.XDG_CONFIG_HOME,
    base: process.env.ANTHROPIC_BASE_URL,
    model: process.env.ANTHROPIC_MODEL,
    opus: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    sonnet: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    haiku: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  };
  process.env.XDG_CONFIG_HOME = dir;
  if (base === null) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = base;
  process.env.ANTHROPIC_MODEL = OPUS_ALIAS;
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = OPUS_ALIAS;
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = SONNET_ALIAS;
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = HAIKU_ALIAS;
  resetModelAliasCache();
  t.after(() => {
    for (const [k, v] of [
      ['XDG_CONFIG_HOME', prev.xdg],
      ['ANTHROPIC_BASE_URL', prev.base],
      ['ANTHROPIC_MODEL', prev.model],
      ['ANTHROPIC_DEFAULT_OPUS_MODEL', prev.opus],
      ['ANTHROPIC_DEFAULT_SONNET_MODEL', prev.sonnet],
      ['ANTHROPIC_DEFAULT_HAIKU_MODEL', prev.haiku],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetModelAliasCache();
  });
  return dir;
}

/** profile-map.json 의 gateway 절만 바꿔 씁니다. modelAliases·learned는 그대로 둡니다. */
function withGateway(gateway) {
  saveProfileMap({ ...loadProfileMap(), gateway });
  resetModelAliasCache();
}

function gatewaySection(aliases, extra = {}) {
  return {
    base: GATEWAY_BASE,
    fetchedAt: new Date().toISOString(),
    aliases,
    skipped: [],
    count: Object.keys(aliases).length,
    ...extra,
  };
}

test('우선순위: 같은 ID에 modelAliases와 gateway.aliases가 모두 있으면 modelAliases가 이긴다', (t) => {
  isolated(t);
  const pid = 'zzzz0000aaaa';
  withGateway(gatewaySection({ [pid]: 'global.anthropic.claude-haiku-4-5' }));
  saveProfileMap({
    ...loadProfileMap(),
    modelAliases: { [`arn:aws:bedrock:*:*:application-inference-profile/${pid}`]: 'claude-opus-5-override' },
  });
  resetModelAliasCache();
  assert.equal(resolveModelAlias(arn(pid)), 'claude-opus-5-override');
});

test('gateway.aliases가 learned보다 앞선다 (learned가 다른 답을 갖고 있어도 gateway가 이긴다)', (t) => {
  isolated(t);
  const pid = 'zzzz1111bbbb';
  saveProfileMap({
    ...loadProfileMap(),
    gateway: gatewaySection({ [pid]: HAIKU_ALIAS }),
    learned: { [pid]: { role: 'sonnet', votes: { sonnet: 10 }, total: 10 } },
  });
  resetModelAliasCache();
  const resolved = resolveModelAlias(arn(pid));
  assert.equal(resolved, HAIKU_ALIAS);
  assert.notEqual(resolved, SONNET_ALIAS, 'learned 쪽 답이 나오면 안 됩니다');
});

test('ARN 문자열(converse/ 접두어 포함, 접두어 없는 bare ARN 포함)이 프로파일 ID를 통해 해석된다', (t) => {
  isolated(t);
  const pid = 'zzzz2222cccc';
  withGateway(gatewaySection({ [pid]: 'global.anthropic.claude-opus-4-7' }));
  assert.equal(resolveModelAlias(arn(pid)), 'global.anthropic.claude-opus-4-7');

  const bareArn = `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/${pid}`;
  assert.equal(resolveModelAlias(bareArn), 'global.anthropic.claude-opus-4-7');
});

test('계열명 없는 사내 별칭(ARN이 아닌 문자열)이 gateway.aliases로 해석된다', (t) => {
  isolated(t);
  withGateway(gatewaySection({ 'prod-large': 'anthropic.claude-opus-5' }));
  // ARN이 아니므로, 게이트웨이 조회가 isGatewayModelId 조기 반환보다 앞서지
  // 않으면 이 문자열이 그대로 반환되어 Sonnet으로 계산된다.
  assert.equal(resolveModelAlias('prod-large'), 'anthropic.claude-opus-5');
});

test('끝의 대괄호 접미어가 붙은 id도 해석된다', (t) => {
  isolated(t);
  withGateway(gatewaySection({ 'prod-large': 'anthropic.claude-opus-5' }));
  // 트랜스크립트는 컨텍스트 창 접미어를 붙여 기록하지만, /model/info가 돌려주는
  // 하우스 별칭 키에는 그 접미어가 없다.
  assert.equal(resolveModelAlias('prod-large[1m]'), 'anthropic.claude-opus-5');
});

test('gateway.base가 현재 ANTHROPIC_BASE_URL과 다르면 gateway.aliases를 무시한다', (t) => {
  isolated(t);
  saveProfileMap({
    ...loadProfileMap(),
    gateway: { ...gatewaySection({ 'prod-large': 'anthropic.claude-opus-5' }), base: 'https://other.example.com' },
  });
  resetModelAliasCache();
  // 다른 게이트웨이의 캐시이므로 무시되고, ARN이 아닌 하우스 별칭은 그대로
  // 반환된다(override도 없으므로 변형 없이 되돌아온다).
  assert.equal(resolveModelAlias('prod-large'), 'prod-large');

  const pid = 'zzzz3333dddd';
  saveProfileMap({
    ...loadProfileMap(),
    gateway: { ...gatewaySection({ [pid]: HAIKU_ALIAS }), base: 'https://other.example.com' },
  });
  resetModelAliasCache();
  assert.equal(resolveModelAlias(arn(pid)), UNKNOWN_MODEL, 'ARN은 학습된 매핑도 없으므로 unknown으로 남아야 합니다');
});

test('gateway 절이 없으면 기존 동작(learned·자기서술 pid·unknown)이 그대로다', (t) => {
  isolated(t);
  const pidLearned = 'zzzz4444eeee';
  saveProfileMap({
    ...loadProfileMap(),
    learned: { [pidLearned]: { role: 'haiku', votes: { haiku: 4 }, total: 4 } },
  });
  resetModelAliasCache();
  assert.equal(resolveModelAlias(arn(pidLearned)), HAIKU_ALIAS);

  // foundation-model ARN: 리소스 자체가 모델 id라 학습 없이도 해석된다.
  const fm = resolveModelAlias(
    'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
  );
  assert.equal(fm, 'anthropic.claude-haiku-4-5-20251001-v1:0');

  // 매핑 없는 ARN은 unknown으로 남는다.
  assert.equal(resolveModelAlias(arn('zzzz5555ffff')), UNKNOWN_MODEL);
});

test('ANTHROPIC_BASE_URL이 없는 머신에서는 gateway 절이 있어도 무시된다', (t) => {
  isolated(t, { base: null });
  withGateway(gatewaySection({ 'prod-large': 'anthropic.claude-opus-5' }));
  assert.equal(resolveModelAlias('prod-large'), 'prod-large');

  const pid = 'zzzz6666aaaa';
  withGateway(gatewaySection({ [pid]: HAIKU_ALIAS }));
  assert.equal(resolveModelAlias(arn(pid)), UNKNOWN_MODEL);
});
