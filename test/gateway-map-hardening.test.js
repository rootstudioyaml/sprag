/**
 * 게이트웨이 모델 맵의 방어 조항 회귀 테스트.
 *
 * verify:key-safety 감사에서 찾은 위반 세 건을 고정합니다. 세 건 모두 토큰과는
 * 무관하지만, 두 건은 AWS 계정 ID 가 profile-map.json 에 기록되는 문제이고
 * 한 건은 정상 응답처럼 보이는 200 응답이 기존 캐시를 지우는 문제입니다.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  deriveAliasesFromModelInfo,
  refreshGatewayModelMap,
} from '../src/litellm-models.js';
import { loadProfileMap, saveProfileMap, resetModelAliasCache } from '../src/model-alias.js';

const ACCOUNT = '123456789012';
const BASE = 'https://litellm.example.com';

let tmp;
let prevXdg;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cts-gwmap-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
});

after(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  rmSync(tmp, { recursive: true, force: true });
  resetModelAliasCache();
});

beforeEach(() => {
  resetModelAliasCache();
});

function okFetch(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

test('model_name 이 foundation-model ARN 이어도 계정 ID 가 값에 새지 않는다', () => {
  const arn = `arn:aws:bedrock:ap-northeast-2:${ACCOUNT}:foundation-model/anthropic.claude-opus-5`;
  const res = deriveAliasesFromModelInfo({
    data: [{ model_name: arn, litellm_params: { model: `bedrock/converse/${arn}` } }],
  });

  const dumped = JSON.stringify(res.aliases);
  assert.equal(dumped.includes(ACCOUNT), false, `계정 ID 가 남았습니다: ${dumped}`);
  assert.equal(dumped.includes('arn:aws:bedrock'), false, `ARN 이 남았습니다: ${dumped}`);
  // 계열명은 살아남아야 합니다. 계정 ID 를 없애려고 항목을 버리면 안 됩니다.
  assert.equal(res.aliases['anthropic.claude-opus-5'], 'anthropic.claude-opus-5');
});

test('model_name 이 application-inference-profile ARN 이면 프로파일 ID 만 키가 된다', () => {
  const arn = `arn:aws:bedrock:ap-northeast-2:${ACCOUNT}:application-inference-profile/abc123xyz`;
  const res = deriveAliasesFromModelInfo({
    data: [{
      model_name: arn,
      model_info: { base_model: 'bedrock/anthropic.claude-haiku-4-5' },
      litellm_params: { model: `bedrock/converse/${arn}` },
    }],
  });

  assert.deepEqual(Object.keys(res.aliases), ['abc123xyz']);
  assert.equal(res.aliases.abc123xyz, 'anthropic.claude-haiku-4-5');
  assert.equal(JSON.stringify(res.aliases).includes(ACCOUNT), false);
});

test('계열명을 못 찾은 항목은 skipped 로 가고 별칭을 만들지 않는다', () => {
  const res = deriveAliasesFromModelInfo({
    data: [{ model_name: 'prod-large', litellm_params: { model: 'bedrock/some-internal-thing' } }],
  });
  assert.deepEqual(res.aliases, {});
  assert.deepEqual(res.skipped, ['prod-large']);
});

test('data 배열이 없는 200 응답은 실패로 취급하고 기존 캐시를 남긴다', async () => {
  saveProfileMap({
    version: 1,
    modelAliases: { 'keep-me': 'claude-opus-5' },
    gateway: { base: BASE, fetchedAt: new Date().toISOString(), aliases: { abc: 'anthropic.claude-haiku-4-5' }, skipped: [], count: 1 },
    learned: {},
  });

  const res = await refreshGatewayModelMap({
    base: BASE,
    key: 'stub-key',
    fetchImpl: okFetch({ models: ['a', 'b'] }),
  });

  assert.equal(res, null);
  resetModelAliasCache();
  const map = loadProfileMap();
  assert.equal(map.gateway.aliases.abc, 'anthropic.claude-haiku-4-5');
  assert.equal(map.modelAliases['keep-me'], 'claude-opus-5');
});

test('별칭을 하나도 못 뽑으면 기존 캐시를 덮어쓰지 않는다', async () => {
  saveProfileMap({
    version: 1,
    modelAliases: {},
    gateway: { base: BASE, fetchedAt: new Date().toISOString(), aliases: { abc: 'anthropic.claude-haiku-4-5' }, skipped: [], count: 1 },
    learned: {},
  });

  const res = await refreshGatewayModelMap({
    base: BASE,
    key: 'stub-key',
    fetchImpl: okFetch({ data: [] }),
  });

  assert.equal(res, null);
  resetModelAliasCache();
  assert.equal(loadProfileMap().gateway.aliases.abc, 'anthropic.claude-haiku-4-5');
});

test('캐시가 비어 있으면 빈 결과도 기록한다', async () => {
  saveProfileMap({ version: 1, modelAliases: {}, gateway: null, learned: {} });

  const res = await refreshGatewayModelMap({
    base: BASE,
    key: 'stub-key',
    fetchImpl: okFetch({ data: [{ model_name: 'prod-large', litellm_params: { model: 'bedrock/x' } }] }),
  });

  assert.ok(res, '첫 조회는 별칭이 없어도 기록되어야 합니다');
  assert.deepEqual(res.skipped, ['prod-large']);
  resetModelAliasCache();
  assert.equal(loadProfileMap().gateway.base, BASE);
});

test('저장된 gateway 절에 키가 들어가지 않는다', async () => {
  saveProfileMap({ version: 1, modelAliases: {}, gateway: null, learned: {} });
  const secret = 'sk-do-not-persist-abc123';
  const arn = `arn:aws:bedrock:ap-northeast-2:${ACCOUNT}:application-inference-profile/pid9`;

  await refreshGatewayModelMap({
    base: BASE,
    key: secret,
    fetchImpl: okFetch({
      data: [{
        model_name: 'global.anthropic.claude-haiku-4-5',
        litellm_params: { model: `bedrock/converse/${arn}` },
      }],
    }),
  });

  resetModelAliasCache();
  const dumped = JSON.stringify(loadProfileMap());
  assert.equal(dumped.includes(secret), false, '인증 키가 파일에 기록되었습니다');
  assert.equal(dumped.includes(ACCOUNT), false, '계정 ID 가 파일에 기록되었습니다');
});
