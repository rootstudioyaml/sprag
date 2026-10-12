/**
 * learnProfileMapping 이 서브에이전트가 선언한 모델을 요청한 모델보다 우선하는지 검증합니다.
 *
 * 회귀 배경: 2026-10-12 Claude 데스크톱 앱(3P 모드)에 haiku 모델이 등록되지 않은
 * 상태에서 Task(model: "haiku") 로 위임하자, 서브에이전트는 세션 모델(opus)로
 * 실행됐습니다. 트랜스크립트에는 haiku 요청만 남았고, 학습은 이 요청 1건을 근거로
 * 메인 프로파일을 haiku 로 판정했습니다(explicit 1표 대 inferred 'main' 4,153표).
 * 서브에이전트 기록 앞머리의 attachment.type === 'model' 레코드에는 실제로 실행된
 * 모델(identity.modelId)이 적혀 있으므로, 이 값이 있으면 요청보다 우선해야 합니다.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { learnProfileMapping, resetModelAliasCache, voteRole } from '../src/model-alias.js';

let tmp;
let prevXdg;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cts-declared-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  // profile-map.json 이 실제 사용자 캐시가 아니라 임시 디렉터리에 써지게 합니다.
  process.env.XDG_CONFIG_HOME = tmp;
  resetModelAliasCache();
});

after(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  rmSync(tmp, { recursive: true, force: true });
  resetModelAliasCache();
});

const arn = (pid) => `converse/arn:aws:bedrock:ap-northeast-2:000000000000:application-inference-profile/${pid}`;

const declaration = (modelId, isSidechain) => ({
  type: 'attachment',
  isSidechain,
  attachment: { type: 'model', identity: { modelId } },
});

const reply = (pid, isSidechain, content = []) => ({
  type: 'assistant',
  isSidechain,
  timestamp: '2026-10-12T00:00:00.000Z',
  message: { model: arn(pid), content, usage: { input_tokens: 1, output_tokens: 1 } },
});

/**
 * 메인 세션 하나와 그 세션이 위임한 서브에이전트 실행들을 기록합니다.
 * runs 의 각 항목은 { requested, declared, pid } 이고, declared 가 null 이면
 * 선언 레코드가 없던 시기의 트랜스크립트를 흉내 냅니다.
 */
function writeSession(name, { mainPid, mainDeclared, mainReplies = 4, runs }) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'session.jsonl');
  const lines = [declaration(mainDeclared, false)];
  for (let i = 0; i < mainReplies; i++) lines.push(reply(mainPid, false));
  runs.forEach((r, i) => {
    lines.push(reply(mainPid, false, [
      { type: 'tool_use', id: `tu${i}`, name: 'Agent', input: { model: r.requested, prompt: 'p' } },
    ]));
  });
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  const sub = join(dir, 'session', 'subagents');
  mkdirSync(sub, { recursive: true });
  runs.forEach((r, i) => {
    const body = [];
    if (r.declared) body.push(declaration(r.declared, true));
    body.push(reply(r.pid, true));
    writeFileSync(join(sub, `agent-a${i}.jsonl`), body.map((l) => JSON.stringify(l)).join('\n') + '\n');
    writeFileSync(join(sub, `agent-a${i}.meta.json`), JSON.stringify({ toolUseId: `tu${i}`, model: r.requested }));
  });
  return path;
}

test('haiku 를 요청했지만 세션 모델로 실행된 위임은 메인 프로파일을 haiku 로 만들지 않는다', async () => {
  const path = writeSession('fallback', {
    mainPid: 'pidmain',
    mainDeclared: 'claude-opus-5-5[1m]',
    runs: [{ requested: 'haiku', declared: 'claude-opus-5-5[1m]', pid: 'pidmain' }],
  });
  const { learned } = await learnProfileMapping({ sessionPaths: [path] });
  // 수정 전에는 explicit-veto 경로로 'haiku' 가 나왔습니다.
  assert.notEqual(learned.pidmain.role, 'haiku');
  assert.equal(learned.pidmain.votes.explicit.haiku, undefined);
  assert.equal(learned.pidmain.votes.explicit.opus, 1);
});

test('선언된 모델이 요청과 같으면 지금처럼 요청한 등급으로 학습한다', async () => {
  const run = { requested: 'haiku', declared: 'claude-haiku-5-5', pid: 'pidhaiku' };
  const path = writeSession('registered', {
    mainPid: 'pidmain2',
    mainDeclared: 'claude-opus-5-5[1m]',
    runs: [run, run, run],
  });
  const { learned } = await learnProfileMapping({ sessionPaths: [path] });
  assert.equal(learned.pidhaiku.role, 'haiku');
  assert.equal(learned.pidhaiku.source, 'explicit');
});

test('선언 레코드가 없는 예전 트랜스크립트는 요청한 등급으로 투표한다', async () => {
  const run = { requested: 'haiku', declared: null, pid: 'pidlegacy' };
  const path = writeSession('legacy', {
    mainPid: 'pidmain3',
    mainDeclared: 'claude-opus-5-5[1m]',
    runs: [run, run, run],
  });
  const { learned } = await learnProfileMapping({ sessionPaths: [path] });
  assert.equal(learned.pidlegacy.role, 'haiku');
});

test('voteRole: 선언이 불투명한 ARN 이면 부모와 같은지로 대체 실행을 가려낸다', () => {
  const parent = 'arn:aws:bedrock:ap-northeast-2:0:application-inference-profile/pidmain';
  // 부모 모델과 같은 불투명 ID 로 실행됐다면 요청한 등급에 대해 아무 정보도 없습니다.
  assert.equal(voteRole('haiku', parent, parent), null);
  // 부모와 다른 불투명 ID 라면 요청을 그대로 믿습니다.
  assert.equal(voteRole('haiku', 'arn:aws:bedrock:ap-northeast-2:0:application-inference-profile/other', parent), 'haiku');
  // opus 요청이 부모 모델로 실행되는 것은 정상이므로 표를 버리지 않습니다.
  assert.equal(voteRole('opus', parent, parent), 'opus');
  // 계열 이름이 드러난 선언은 요청보다 우선합니다.
  assert.equal(voteRole('haiku', 'claude-sonnet-5-5', 'claude-opus-5-5[1m]'), 'sonnet');
  assert.equal(voteRole('sonnet', null, 'claude-opus-5-5[1m]'), 'sonnet');
});
