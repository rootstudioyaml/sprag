/**
 * judgement-prompt: a regex pass that tells a prompt asking for a judgement
 * (review, audit, diagnosis, web search, "there is none" lookups) from one that
 * reads facts off a command or a named page. Every prompt here is invented;
 * none is copied from a session.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isJudgementDelegation, judgementEvidence, SAVING_GRADE_KINDS } from '../src/judgement-prompt.js';

const kindOf = (prompt) => isJudgementDelegation(prompt);

test('review work that ends in improvements or priorities is judgement', () => {
  assert.deepEqual(kindOf('Review the repository at ./app and list improvements by priority. Read-only.'), { judgement: true, kind: 'review' });
  assert.deepEqual(kindOf('이 저장소를 살펴보고 개선점을 우선순위와 함께 정리해 주십시오.'), { judgement: true, kind: 'review' });
});

test('an audit or a security pass is judgement, in both languages', () => {
  assert.equal(kindOf('Audit the login flow and report anything unsafe.').kind, 'audit');
  assert.equal(kindOf('로그인 흐름을 감사하고 허점을 정리하십시오.').kind, 'audit');
  assert.equal(kindOf('Read-only investigation in the repo: how does retry work across modules?').kind, 'audit');
});

test('root-cause work is diagnosis', () => {
  assert.equal(kindOf('Find the root cause of the flaky upload test and explain why it fails on CI.').kind, 'diagnosis');
  assert.equal(kindOf('배포가 왜 실패했는지 원인을 진단해 주십시오.').kind, 'diagnosis');
});

test('searching the web for candidates is judgement', () => {
  assert.equal(kindOf('Research task: use WebSearch to find three open-source chart libraries and compare them.').kind, 'search');
  assert.equal(kindOf('웹 검색으로 무료 아이콘 팩 후보를 찾아 보고하십시오.').kind, 'search');
  assert.equal(kindOf('Collect what people say on Reddit about the new pricing and report the common complaints. Research only.').kind, 'search');
});

test('a lookup where "there is none" can be the answer is judgement', () => {
  assert.equal(kindOf('Is there any setting that disables telemetry? Say so if there is none.').kind, 'absence');
  assert.equal(kindOf('Read-only search in ./docs for the refund policy document.').kind, 'absence');
});

test('a check where the output decides what to open next is judgement', () => {
  assert.equal(kindOf('Run the status command, then depending on what it prints decide which log to read.').kind, 'conditional');
  assert.equal(kindOf('명령 출력에 따라 어느 로그를 더 볼지 정하십시오.').kind, 'conditional');
});

test('commands, named files and plain copies are not judgement', () => {
  assert.equal(kindOf('Run exactly this command and relay its stdout verbatim:\n\nnpm test 2>&1 | tail -20').judgement, false);
  assert.equal(kindOf('Read src/config.js and src/paths.js. Report the exported function names and the file each writes. No opinions.').judgement, false);
  assert.equal(kindOf('다음 명령을 실행하고 출력을 그대로 전달하십시오: git log --oneline -5').judgement, false);
  assert.equal(kindOf('Convert the three CSV files in ./data to JSON with the script in ./tools and report the exit code.').judgement, false);
});

test('reading named pages and copying what they say is not judgement', () => {
  const read = 'Read https://docs.example.com/guide/limits and quote the sentence that gives the default limit. Under 100 words.';
  assert.deepEqual(kindOf(read), { judgement: false, kind: null });
  assert.equal(kindOf('https://docs.example.com/a 와 https://docs.example.com/b 를 읽고 기본값을 원문 그대로 옮겨 적으십시오.').judgement, false);
  // The same pages plus a request to go and find more sources is a search again.
  assert.equal(kindOf(`${read} Then use WebSearch to find two more sources.`).judgement, true);
});

test('a finished design handed over to build is not judgement, even when it mentions audits', () => {
  const brief = 'Implement the following. The design is fixed.\n\nAdd an audit log table and a review button. Files to change: src/log.js. Tests: node --test.';
  assert.equal(kindOf(brief).judgement, false);
  assert.equal(kindOf('설계가 이미 확정되었습니다. 감사 로그 화면을 만드는 구현 작업입니다. 수정할 파일: src/log.js').judgement, false);
});

test('a mention that is negated does not count', () => {
  assert.equal(kindOf('Run the suite once. If it fails, do not diagnose, just quote the failing test names.').judgement, false);
  assert.equal(kindOf('테스트를 실행하십시오. 실패해도 원인 분석을 하지 말고 파일명만 인용하십시오.').judgement, false);
});

test('a site name next to no research verb is not a search', () => {
  assert.equal(kindOf('Write a short caption for the Hacker News post and save it to ./out/caption.txt.').judgement, false);
});

test('work on a file the caller hands over, with the web closed, is not a search', () => {
  assert.equal(kindOf('Read ./digest.md and write the summary. Do not search the web. The digest holds Reddit and Hacker News items with candidates.').judgement, false);
});

test("the guard's own appendix is not part of the ask", () => {
  const asked = 'Print the package version from package.json.';
  const withAppendix = `${asked}\n\n<!-- sprag:delegation -->\n\nAudit anything you touch. Find the root cause of every error.`;
  assert.equal(kindOf(withAppendix).judgement, false);
});

test('empty and non-string input is not judgement', () => {
  for (const v of ['', null, undefined, 42, {}]) assert.deepEqual(kindOf(v), { judgement: false, kind: null });
});

test('judgementEvidence names the text that triggered the answer', () => {
  const r = judgementEvidence('Audit the billing module.');
  assert.equal(r.judgement, true);
  assert.equal(r.match, 'audit');
  assert.equal(judgementEvidence('List the files.').match, null);
});

test('the saving grade acts on diagnosis and audit only', () => {
  assert.deepEqual([...SAVING_GRADE_KINDS].sort(), ['audit', 'diagnosis']);
});
