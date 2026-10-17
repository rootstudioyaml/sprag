/**
 * 호스트가 모델을 관리하는 세션에서 등록되지 않은 등급으로는 위임을 안내하지 않는지 검증합니다.
 *
 * 회귀 배경: 2026-10-12 Claude 데스크톱 앱(3P 모드)은 claude 를 띄울 때
 * ANTHROPIC_DEFAULT_HAIKU_MODEL 과 ANTHROPIC_DEFAULT_SONNET_MODEL 을 빈 값으로
 * 넘겼고, settings.json 의 env 는 이 값을 덮어쓰지 못했습니다. brief 훅은 그래도
 * "haiku 로 위임하십시오"라고 안내했고, Task(model: "haiku") 는 세션 모델인 opus 로
 * 실행되어 절감 없이 서브에이전트 비용만 들었습니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeHint, routeMatch, unreachableTiers } from '../src/route-inject.js';
import { childEnv } from './helpers/child-env.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

const rules = [
  { category: 'check', tier: 'T2', agent: 'haiku', budget: { calls: 8, out: 1500 } },
  { category: 'check', tier: 'T1', agent: 'sonnet', budget: { calls: null, out: 8000 } },
];
const PROMPT = '지금 실행 중인 버전이 뭔지 확인해줘';
const EMPTY = mkdtempSync(join(tmpdir(), 'cts-host-models-'));
// 개발자 홈의 ~/.claude/agents 에 위임 에이전트가 깔려 있으면 안내 문구가 에이전트 이름으로 바뀌므로, 홈을 빈 디렉터리로 고정합니다.
process.env.HOME = EMPTY;

const HOST = { CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' };
const hint = (env) => routeHint(PROMPT, { rules, lang: 'ko', root: EMPTY, env });

test('호스트가 관리하지 않는 세션에서는 빈 변수가 있어도 막는 등급이 없다', () => {
  assert.deepEqual(unreachableTiers({}), []);
  assert.deepEqual(unreachableTiers({ ANTHROPIC_DEFAULT_HAIKU_MODEL: '' }), []);
  assert.match(hint({}), /위임하십시오/);
});

test('haiku 가 등록되지 않으면 haiku 안내를 빼고 sonnet 으로만 안내한다', () => {
  const env = { ...HOST, ANTHROPIC_DEFAULT_HAIKU_MODEL: '', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5' };
  assert.deepEqual(unreachableTiers(env), ['T2']);
  const match = routeMatch(PROMPT, { rules, root: EMPTY, env });
  assert.equal(match.t2, undefined);
  assert.equal(match.t1.tier, 'T1');
  const out = hint(env);
  assert.match(out, /model: sonnet/);
  assert.doesNotMatch(out, /haiku/);
});

test('두 등급 모두 등록되지 않으면 위임 대신 직접 처리와 등록 방법을 안내한다', () => {
  const env = { ...HOST, ANTHROPIC_DEFAULT_HAIKU_MODEL: '', ANTHROPIC_DEFAULT_SONNET_MODEL: '' };
  const match = routeMatch(PROMPT, { rules, root: EMPTY, env });
  assert.deepEqual(match.unreachable, ['T2', 'T1']);
  const out = hint(env);
  assert.match(out, /위임하지 말고 직접 처리하십시오/);
  assert.match(out, /Claude 앱 설정에 haiku, sonnet 모델을 등록하면/);
  assert.doesNotMatch(out, /로 위임하십시오/);
});

test('두 등급이 모두 등록되면 지금처럼 haiku 와 sonnet 을 함께 안내한다', () => {
  const env = { ...HOST, ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5' };
  assert.deepEqual(unreachableTiers(env), []);
  assert.match(hint(env), /기본 model: haiku, 여러 단계·여러 파일이 얽히면 model: sonnet/);
});

/**
 * 위 단위 테스트는 env 를 직접 넘기므로, 호출부(src/commands/brief.js)가 실제 프로세스
 * 환경을 읽는지는 보지 못합니다. 그래서 실제 훅을 자식 프로세스로 띄워 확인합니다.
 */
test('brief 훅은 자기 프로세스 환경으로 등록되지 않은 등급을 판정한다', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-brief-host-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const home = join(dir, 'home');
  const state = join(dir, 'state');
  const project = join(dir, 'project');
  for (const d of [join(home, '.claude'), join(state, 'claude-token-saver'), project]) mkdirSync(d, { recursive: true });
  writeFileSync(join(state, 'claude-token-saver', 'config.json'), JSON.stringify({ language: 'ko' }) + '\n');
  writeFileSync(join(state, 'claude-token-saver', 'model-rules.json'), JSON.stringify({ rules }) + '\n');

  const run = (extra) => execFileSync(process.execPath, [CLI, 'brief', '--hook'], {
    cwd: project,
    env: childEnv({ HOME: home, XDG_CONFIG_HOME: state, APPDATA: state, NO_COLOR: '1', CTS_NO_UPDATE_CHECK: '1', ...extra }),
    input: JSON.stringify({ session_id: 'brief-host', prompt: PROMPT, cwd: project }),
    encoding: 'utf8',
  });

  const blocked = run({ ...HOST, ANTHROPIC_DEFAULT_HAIKU_MODEL: '', ANTHROPIC_DEFAULT_SONNET_MODEL: '' });
  assert.match(blocked, /위임하지 말고 직접 처리하십시오/);
  const registered = run({ ...HOST, ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5' });
  assert.match(registered, /기본 model: haiku/);
});
