/**
 * learnProfileMapping 이 최근 세션부터 읽는지 검증합니다.
 *
 * 회귀 배경: discoverSessionFiles(src/parser.js)는 세션 파일을 오래된 순으로
 * 돌려주는데, learnProfileMapping 은 주석으로만 "최근 순"을 요구하면서
 * sessionPaths.slice(0, maxSessions) 로 앞부분만 읽었습니다. 그래서 세션 수가
 * maxSessions 를 넘는 환경에서는 최근 위임 기록이 통째로 잘려 나가고, 최근에만
 * 등장한 프로파일이 영구히 미해석으로 남았습니다. 이 테스트는 호출부가 오래된
 * 순으로 넘겨도 최근 파일을 읽는지 확인합니다.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { learnProfileMapping, resetModelAliasCache } from '../src/model-alias.js';

let tmp;
let prevXdg;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cts-newest-'));
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

/** 프로파일 ID 하나만 기록된 최소 트랜스크립트를 만들고 mtime 을 고정합니다. */
function writeTranscript(name, pid, mtimeSec) {
  const dir = join(tmp, 'sessions');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  const arn = `converse/arn:aws:bedrock:ap-northeast-2:000000000000:application-inference-profile/${pid}`;
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-09-18T00:00:00.000Z',
    message: { id: `msg-${pid}`, model: arn, usage: { input_tokens: 1, output_tokens: 1 } },
  });
  writeFileSync(path, `${line}\n`);
  utimesSync(path, mtimeSec, mtimeSec);
  return path;
}

test('오래된 순으로 넘겨도 최근 세션을 읽는다', async () => {
  const base = 1_760_000_000;
  const oldest = writeTranscript('oldest.jsonl', 'pidoldest', base);
  const middle = writeTranscript('middle.jsonl', 'pidmiddle', base + 3600);
  const newest = writeTranscript('newest.jsonl', 'pidnewest', base + 7200);

  // discoverSessionFiles 와 같은 순서(오래된 순)로 넘기고 한 개만 읽게 합니다.
  const res = await learnProfileMapping({
    sessionPaths: [oldest, middle, newest],
    maxSessions: 1,
  });

  assert.equal(res.scannedSessions, 1);
  assert.ok(
    Object.prototype.hasOwnProperty.call(res.learned, 'pidnewest'),
    '가장 최근 세션의 프로파일 ID 가 학습 대상에 들어가야 합니다',
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(res.learned, 'pidoldest'),
    false,
    '가장 오래된 세션은 maxSessions 를 넘겨 잘려야 합니다',
  );
});

test('maxSessions 안에 다 들어가면 전부 읽는다', async () => {
  resetModelAliasCache();
  const base = 1_770_000_000;
  const a = writeTranscript('a.jsonl', 'pidaaa', base);
  const b = writeTranscript('b.jsonl', 'pidbbb', base + 60);

  const res = await learnProfileMapping({ sessionPaths: [a, b], maxSessions: 10 });

  assert.equal(res.scannedSessions, 2);
  assert.ok(Object.prototype.hasOwnProperty.call(res.learned, 'pidaaa'));
  assert.ok(Object.prototype.hasOwnProperty.call(res.learned, 'pidbbb'));
});

test('읽을 수 없는 경로가 섞여도 던지지 않는다', async () => {
  resetModelAliasCache();
  const good = writeTranscript('good.jsonl', 'pidgood', 1_780_000_000);
  const res = await learnProfileMapping({
    sessionPaths: [join(tmp, 'sessions', 'missing.jsonl'), good],
    maxSessions: 10,
  });
  assert.ok(Object.prototype.hasOwnProperty.call(res.learned, 'pidgood'));
});
