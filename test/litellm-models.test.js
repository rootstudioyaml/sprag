/**
 * litellm-models · LiteLLM `/model/info` 로부터 프로파일 ID → 모델 계열 매핑을
 * 뽑아내는 순수 함수(deriveAliasesFromModelInfo)와, 그 결과를 profile-map.json의
 * gateway 절로 캐시하는 갱신 경로(refreshGatewayModelMap 등)를 검증합니다.
 *
 * XDG_CONFIG_HOME 을 임시 디렉터리로 돌려 실제 사용자 캐시를 건드리지 않고,
 * fetch 는 항상 주입한 스텁으로 대체합니다(model-alias.test.js·
 * litellm-budget.test.js 와 같은 관례).
 *
 * 이 파일이 지키는 핵심 제약: apiKeyHelper 가 발급한 토큰은 이 모듈이 사본을
 * 만들면 안 됩니다. 성공 경로 테스트마다 키가 profile-map.json 에 남지 않는지
 * 확인하고, 별도로 "키 유출 금지" 회귀 테스트를 하나 더 둡니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MODEL_MAP_TTL_MS,
  deriveAliasesFromModelInfo,
  readGatewayModelMap,
  isGatewayModelMapStale,
  refreshGatewayModelMap,
  maybeRefreshGatewayModelMap,
} from '../src/litellm-models.js';
import {
  loadProfileMap,
  saveProfileMap,
  resetModelAliasCache,
  profileMapPath,
} from '../src/model-alias.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/litellm-model-info.json', import.meta.url), 'utf8'),
);

// Recon 이 넘긴 기대값을 그대로 베끼지 않고, deriveAliasesFromModelInfo 의 규칙
// (model_name → base_model → litellm_params.model 순, 인식되면 그 후보를 채택)
// 을 픽스처의 11개 항목에 손으로 대조해 다시 계산한 값입니다.
//   - index 0 "claude-sonnet": model_name 자체가 이미 별칭이고 litellm_params.model
//     이 ARN 이 아니라 pid 도 없으므로 키가 생기지 않는다 (의도된 동작).
//   - index 1~8: model_name 이 이미 계열명을 담고 있어 그대로 별칭이 되고,
//     litellm_params.model 의 ARN 에서 뽑은 프로파일 ID 가 키가 된다.
//   - index 9 "prod-large": model_name 은 계열명이 없어 인식되지 않고, base_model
//     "bedrock/anthropic.claude-opus-5" 에서 접두어를 뗀 값이 별칭이 되며,
//     litellm_params.model 이 ARN 이 아니라 pid 가 없으므로 model_name 자체가 키가 된다.
//   - index 10 "team-fast-classifier": 세 후보(모두 확인) 모두 계열명이 없어 skipped.
const EXPECTED_ALIASES = {
  hox8qyp7g09c: 'global.anthropic.claude-opus-4-6-v1',
  '4vfhhy1cxgkp': 'ap-northeast-2.anthropic.claude-opus-4-8',
  bs5slaushw2i: 'global.anthropic.claude-sonnet-4-6',
  '1u1pzc316exg': 'ap-northeast-2.anthropic.claude-opus-5',
  j8m3m2gtsrll: 'global.anthropic.claude-opus-4-7',
  '6cpo55oho9t5': 'ap-northeast-2.anthropic.claude-sonnet-5',
  svz6i349uyle: 'global.anthropic.claude-haiku-4-5',
  taurvkifygmo: 'house.claude-opus-5',
  'prod-large': 'anthropic.claude-opus-5',
};

const GATEWAY_BASE = 'https://litellm.example.com';

/** XDG_CONFIG_HOME 과 ANTHROPIC_BASE_URL 을 임시값으로 돌립니다. */
function isolated(t, { base = GATEWAY_BASE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-models-'));
  const prev = {
    xdg: process.env.XDG_CONFIG_HOME,
    base: process.env.ANTHROPIC_BASE_URL,
  };
  process.env.XDG_CONFIG_HOME = dir;
  if (base === null) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = base;
  resetModelAliasCache();
  t.after(() => {
    if (prev.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev.xdg;
    if (prev.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = prev.base;
    resetModelAliasCache();
  });
  return dir;
}

// ── deriveAliasesFromModelInfo ──────────────────────────────────────────

test('deriveAliasesFromModelInfo: 픽스처에서 기대한 키 → 별칭 매핑을 정확히 만든다', () => {
  const result = deriveAliasesFromModelInfo(FIXTURE);
  assert.deepEqual(result.aliases, EXPECTED_ALIASES);
  assert.equal(result.count, FIXTURE.data.length);
});

test('ARN 항목은 프로파일 ID로만 키가 잡히고, 전체 ARN·AWS 계정 ID는 들어가지 않는다', () => {
  const result = deriveAliasesFromModelInfo(FIXTURE);
  for (const key of Object.keys(result.aliases)) {
    assert.doesNotMatch(key, /arn:/, `alias key "${key}" 에 전체 ARN이 들어가면 안 됩니다`);
    // 픽스처는 계정 ID를 000000000000 으로 스크럽했지만, 어떤 12자리 숫자든
    // 키에 나타나면 안 된다는 계약이므로 자릿수 자체를 단정합니다.
    assert.doesNotMatch(key, /\d{12}/, `alias key "${key}" 에 AWS 계정 ID가 들어가면 안 됩니다`);
  }
  assert.equal(result.aliases.hox8qyp7g09c, 'global.anthropic.claude-opus-4-6-v1');
});

test('계열명 없는 사내 별칭은 base_model을 거쳐 model_name 키로 들어간다', () => {
  const result = deriveAliasesFromModelInfo(FIXTURE);
  // "prod-large" 는 litellm_params.model 이 ARN이 아니라 프로파일 ID가 없으므로,
  // model_name 자신이 유일한 키다.
  assert.equal(result.aliases['prod-large'], 'anthropic.claude-opus-5');
});

test('세 후보 모두 인식 불가인 항목은 aliases에 들어가지 않고 skipped에 들어간다', () => {
  const result = deriveAliasesFromModelInfo(FIXTURE);
  assert.ok(!('team-fast-classifier' in result.aliases));
  assert.deepEqual(result.skipped, ['team-fast-classifier']);
});

test('잘못된 입력에도 던지지 않고 빈 결과를 돌려준다', () => {
  for (const bad of [null, undefined, {}, { data: 'x' }, { data: null }, 'nonsense', 42]) {
    assert.deepEqual(
      deriveAliasesFromModelInfo(bad),
      { aliases: {}, skipped: [], count: 0 },
      `입력 ${JSON.stringify(bad)} 에서 던지거나 다른 모양을 돌려주면 안 됩니다`,
    );
  }
});

test('MODEL_MAP_TTL_MS는 24시간이다', () => {
  assert.equal(MODEL_MAP_TTL_MS, 24 * 60 * 60 * 1000);
});

// ── readGatewayModelMap / isGatewayModelMapStale ────────────────────────

test('readGatewayModelMap: base가 일치할 때만 gateway 절을 돌려준다', (t) => {
  isolated(t);
  const section = {
    base: GATEWAY_BASE,
    fetchedAt: new Date().toISOString(),
    aliases: { a: 'global.anthropic.claude-opus-5' },
    skipped: [],
    count: 1,
  };
  saveProfileMap({ ...loadProfileMap(), gateway: section });
  resetModelAliasCache();
  assert.deepEqual(readGatewayModelMap(), section);

  // 다른 게이트웨이의 캐시는 예산 캐시와 같은 방식으로 격리되어 무시된다.
  saveProfileMap({ ...loadProfileMap(), gateway: { ...section, base: 'https://other.example.com' } });
  resetModelAliasCache();
  assert.equal(readGatewayModelMap(), null);
});

test('isGatewayModelMapStale: gateway 절이 없으면 stale', (t) => {
  isolated(t);
  assert.equal(isGatewayModelMapStale(), true);
});

test('isGatewayModelMapStale: gateway 절은 있지만 fetchedAt이 없으면 stale', (t) => {
  isolated(t);
  saveProfileMap({
    ...loadProfileMap(),
    gateway: { base: GATEWAY_BASE, aliases: {}, skipped: [], count: 0 },
  });
  resetModelAliasCache();
  assert.equal(isGatewayModelMapStale(), true);
});

test('isGatewayModelMapStale: base가 다르면 stale', (t) => {
  isolated(t);
  saveProfileMap({
    ...loadProfileMap(),
    gateway: {
      base: 'https://other.example.com',
      fetchedAt: new Date().toISOString(),
      aliases: {},
      skipped: [],
      count: 0,
    },
  });
  resetModelAliasCache();
  assert.equal(isGatewayModelMapStale(), true);
});

test('isGatewayModelMapStale: fetchedAt이 오래됐으면 true, 신선하면 false', (t) => {
  isolated(t);
  const now = Date.now();
  saveProfileMap({
    ...loadProfileMap(),
    gateway: {
      base: GATEWAY_BASE,
      fetchedAt: new Date(now - MODEL_MAP_TTL_MS - 1000).toISOString(),
      aliases: {},
      skipped: [],
      count: 0,
    },
  });
  resetModelAliasCache();
  assert.equal(isGatewayModelMapStale(process.env, now), true, '만료된 fetchedAt은 stale이어야 합니다');

  saveProfileMap({
    ...loadProfileMap(),
    gateway: {
      base: GATEWAY_BASE,
      fetchedAt: new Date(now - 1000).toISOString(),
      aliases: {},
      skipped: [],
      count: 0,
    },
  });
  resetModelAliasCache();
  assert.equal(isGatewayModelMapStale(process.env, now), false, '방금 받아온 캐시는 stale이 아니어야 합니다');
});

// ── refreshGatewayModelMap ───────────────────────────────────────────────

test('refreshGatewayModelMap: key가 없으면 fetch를 부르지 않고 null을 돌려준다', async (t) => {
  isolated(t);
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  const result = await refreshGatewayModelMap({ base: GATEWAY_BASE, key: null, fetchImpl });
  assert.equal(result, null);
  assert.equal(called, false, 'key가 없을 때 fetch가 불리면 안 됩니다');
});

test('refreshGatewayModelMap: 비 200 응답이면 파일을 쓰지 않고 null을 돌려준다', async (t) => {
  isolated(t);
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const result = await refreshGatewayModelMap({ base: GATEWAY_BASE, key: 'sk-test', fetchImpl });
  assert.equal(result, null);
  assert.equal(readGatewayModelMap(), null);
});

test('refreshGatewayModelMap: JSON 파싱에 실패하면 파일을 쓰지 않고 null을 돌려준다', async (t) => {
  isolated(t);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('malformed body');
    },
  });
  const result = await refreshGatewayModelMap({ base: GATEWAY_BASE, key: 'sk-test', fetchImpl });
  assert.equal(result, null);
  assert.equal(readGatewayModelMap(), null);
});

test('refreshGatewayModelMap: 타임아웃(요청이 중단됨)이면 파일을 쓰지 않고 null을 돌려준다', async (t) => {
  isolated(t);
  const fetchImpl = async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };
  const result = await refreshGatewayModelMap({ base: GATEWAY_BASE, key: 'sk-test', fetchImpl });
  assert.equal(result, null);
  assert.equal(readGatewayModelMap(), null);
});

test('refreshGatewayModelMap: authorization 헤더가 Bearer <key>로 붙는다', async (t) => {
  isolated(t);
  let seenUrl = null;
  let seenHeaders = null;
  const fetchImpl = async (url, opts) => {
    seenUrl = url;
    seenHeaders = opts.headers;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  const result = await refreshGatewayModelMap({ base: GATEWAY_BASE, key: 'sk-header-test', fetchImpl });
  assert.equal(seenUrl, `${GATEWAY_BASE}/model/info`);
  assert.equal(seenHeaders.authorization, 'Bearer sk-header-test');
  assert.equal(seenHeaders.accept, 'application/json');
  assert.ok(result);
  assert.equal(result.count, 0);
});

test('refreshGatewayModelMap: 기존 modelAliases와 learned를 보존한다', async (t) => {
  isolated(t);
  saveProfileMap({
    ...loadProfileMap(),
    modelAliases: { 'house-alias': 'claude-opus-5' },
    learned: { pid1: { role: 'haiku', votes: { haiku: 4 }, total: 4 } },
  });
  resetModelAliasCache();

  const payload = {
    data: [
      {
        model_name: 'global.anthropic.claude-haiku-4-5',
        litellm_params: {
          model:
            'bedrock/converse/arn:aws:bedrock:ap-northeast-2:000000000000:application-inference-profile/svz6i349uyle',
        },
        model_info: {},
      },
    ],
  };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });
  await refreshGatewayModelMap({ base: GATEWAY_BASE, key: 'sk-preserve-test', fetchImpl });

  const map = loadProfileMap();
  assert.deepEqual(map.modelAliases, { 'house-alias': 'claude-opus-5' });
  assert.deepEqual(map.learned.pid1, { role: 'haiku', votes: { haiku: 4 }, total: 4 });
  assert.equal(map.gateway.base, GATEWAY_BASE);
  assert.equal(map.gateway.aliases.svz6i349uyle, 'global.anthropic.claude-haiku-4-5');
});

test('refreshGatewayModelMap: 키 유출 금지 회귀 테스트, profile-map.json에 키 문자열이 남지 않는다', async (t) => {
  isolated(t);
  const SECRET_KEY = 'sk-must-never-be-persisted-9f8e7d6c5b4a3210';
  const payload = {
    data: [
      {
        model_name: 'global.anthropic.claude-haiku-4-5',
        litellm_params: {
          model:
            'bedrock/converse/arn:aws:bedrock:ap-northeast-2:000000000000:application-inference-profile/svz6i349uyle',
        },
        model_info: {},
      },
    ],
  };
  const fetchImpl = async (_url, opts) => {
    // 헤더에 키가 담겨 나가는 것은 정상이고, 검사 대상은 "저장"입니다.
    assert.equal(opts.headers.authorization, `Bearer ${SECRET_KEY}`);
    return { ok: true, status: 200, json: async () => payload };
  };

  const result = await refreshGatewayModelMap({ base: GATEWAY_BASE, key: SECRET_KEY, fetchImpl });
  assert.ok(result, '성공 응답이어야 이 회귀 테스트가 실제로 파일을 쓰는 경로를 검증합니다');

  const raw = readFileSync(profileMapPath(), 'utf8');
  assert.doesNotMatch(
    raw,
    new RegExp(SECRET_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'profile-map.json에 인증 키가 그대로 남아있으면 안 됩니다',
  );
});

// ── maybeRefreshGatewayModelMap ──────────────────────────────────────────

test('maybeRefreshGatewayModelMap: 신선하면 refresh를 부르지 않고 null을 돌려준다', async (t) => {
  isolated(t);
  const now = Date.now();
  saveProfileMap({
    ...loadProfileMap(),
    gateway: {
      base: GATEWAY_BASE,
      fetchedAt: new Date(now - 1000).toISOString(),
      aliases: {},
      skipped: [],
      count: 0,
    },
  });
  resetModelAliasCache();
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  const result = await maybeRefreshGatewayModelMap({ base: GATEWAY_BASE, key: 'sk-test', fetchImpl, now });
  assert.equal(result, null);
  assert.equal(called, false);
});

test('maybeRefreshGatewayModelMap: stale이면 refresh를 부른다', async (t) => {
  isolated(t);
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  const result = await maybeRefreshGatewayModelMap({ base: GATEWAY_BASE, key: 'sk-test', fetchImpl });
  assert.equal(called, true);
  assert.ok(result);
  assert.equal(result.count, 0);
});
