/**
 * profile-map.json 의 쓰기 경로와 gateway 절 신선도 회귀 테스트.
 *
 * 코드리뷰에서 받은 지적 세 건을 고정합니다. 첫째로 두 생산자(학습 경로와
 * 게이트웨이 갱신)가 파일 전체를 다시 쓰면서 서로의 절을 지우던 문제,
 * 둘째로 gateway 절이 오래되어도 학습값을 계속 가리던 문제,
 * 셋째로 프로토타입 체인 조회로 별칭이 함수 객체가 될 수 있던 문제입니다.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadProfileMap,
  saveProfileMap,
  updateProfileMap,
  resetModelAliasCache,
  resolveModelAlias,
  UNKNOWN_MODEL,
} from '../src/model-alias.js';

const BASE = 'https://litellm.example.com';
const ENV = {
  ANTHROPIC_BASE_URL: BASE,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'global.anthropic.claude-haiku-4-5',
};

let tmp;
let prevXdg;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cts-pmwrite-'));
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

function gatewaySection(ageMs = 0) {
  return {
    base: BASE,
    fetchedAt: new Date(Date.now() - ageMs).toISOString(),
    aliases: { svz6i349uyle: 'global.anthropic.claude-haiku-4-5' },
    skipped: [],
    count: 1,
  };
}

test('학습 경로의 쓰기가 게이트웨이 절을 지우지 않는다', () => {
  saveProfileMap({
    version: 1,
    modelAliases: { 'keep-me': 'claude-opus-5' },
    gateway: null,
    learned: { old: { role: 'haiku' } },
  });

  // 다른 프로세스가 게이트웨이 절을 기록한 상황.
  updateProfileMap({ gateway: gatewaySection() });
  // 그 뒤 학습 경로가 자기 절만 기록합니다.
  updateProfileMap({ learned: { fresh: { role: 'sonnet' } }, scannedSessions: 7 });

  resetModelAliasCache();
  const map = loadProfileMap();
  assert.equal(map.gateway.aliases.svz6i349uyle, 'global.anthropic.claude-haiku-4-5');
  assert.deepEqual(Object.keys(map.learned), ['fresh']);
  assert.equal(map.modelAliases['keep-me'], 'claude-opus-5');
  assert.equal(map.scannedSessions, 7);
});

test('게이트웨이 갱신이 학습 절을 지우지 않는다', () => {
  saveProfileMap({ version: 1, modelAliases: {}, gateway: null, learned: {} });

  updateProfileMap({ learned: { pid1: { role: 'sonnet' } }, scannedSessions: 3 });
  updateProfileMap({ gateway: gatewaySection() });

  resetModelAliasCache();
  const map = loadProfileMap();
  assert.equal(map.learned.pid1.role, 'sonnet');
  assert.equal(map.gateway.base, BASE);
});

test('쓰기 후 임시 파일이 남지 않는다', () => {
  updateProfileMap({ gateway: gatewaySection() });
  const leftovers = readdirSync(join(tmp, 'claude-token-saver')).filter((f) => f.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('신선한 gateway 절은 ARN 을 해석한다', () => {
  saveProfileMap({ version: 1, modelAliases: {}, gateway: gatewaySection(), learned: {} });
  const arn = 'converse/arn:aws:bedrock:ap-northeast-2:000000000000:application-inference-profile/svz6i349uyle';
  assert.equal(resolveModelAlias(arn, { env: ENV }), 'global.anthropic.claude-haiku-4-5');
});

test('유효기간을 크게 넘긴 gateway 절은 물러나고 학습값이 답한다', () => {
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  saveProfileMap({
    version: 1,
    modelAliases: {},
    gateway: gatewaySection(thirtyDays),
    learned: { svz6i349uyle: { role: 'haiku', source: 'explicit' } },
  });
  const arn = 'converse/arn:aws:bedrock:ap-northeast-2:000000000000:application-inference-profile/svz6i349uyle';
  // 학습값의 role 이 haiku 이므로 환경변수가 선언한 haiku 별칭으로 해석됩니다.
  assert.equal(resolveModelAlias(arn, { env: ENV }), 'global.anthropic.claude-haiku-4-5');
});

test('오래된 gateway 절이고 학습값도 없으면 unknown 으로 남는다', () => {
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  saveProfileMap({ version: 1, modelAliases: {}, gateway: gatewaySection(thirtyDays), learned: {} });
  const arn = 'converse/arn:aws:bedrock:ap-northeast-2:000000000000:application-inference-profile/svz6i349uyle';
  assert.equal(resolveModelAlias(arn, { env: ENV }), UNKNOWN_MODEL);
});

test('fetchedAt 이 없거나 깨진 gateway 절은 신뢰하지 않는다', () => {
  const gw = gatewaySection();
  delete gw.fetchedAt;
  saveProfileMap({ version: 1, modelAliases: {}, gateway: gw, learned: {} });
  const arn = 'converse/arn:aws:bedrock:ap-northeast-2:000000000000:application-inference-profile/svz6i349uyle';
  assert.equal(resolveModelAlias(arn, { env: ENV }), UNKNOWN_MODEL);
});

test('프로토타입 속성 이름이 별칭으로 새어 나오지 않는다', () => {
  saveProfileMap({ version: 1, modelAliases: {}, gateway: gatewaySection(), learned: {} });
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const got = resolveModelAlias(name, { env: ENV });
    assert.equal(typeof got, 'string', `${name} 이 문자열이 아닌 값으로 해석되었습니다`);
    // 계열명이 없는 이름이므로 그대로 통과하거나 unknown 이어야 하며,
    // 함수 객체나 프로토타입 멤버가 나와서는 안 됩니다.
    assert.ok(got === name || got === UNKNOWN_MODEL, `${name} → ${got}`);
  }
});
