/**
 * Delegation grade, prompt side: the judgement gate (JUDGE_RE), the grade's
 * effect on routeMatch, judgementMatch, the Opus recommendation, the grade line
 * and the judgement clause in ratchet-model.md, and `sprag routing grade`.
 *
 * HOME and XDG_CONFIG_HOME point at a throwaway directory before any sprag
 * module loads, because config.js fixes its path at import. Every example text
 * below is invented.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { childEnv } from './helpers/child-env.js';

const dir = mkdtempSync(join(tmpdir(), 'sprag-judgement-'));
const home = join(dir, 'home');
mkdirSync(join(home, '.claude'), { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(dir, 'cfg');
process.env.SPRAG_LANG = 'ko';
test.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const { JUDGE_RE, ESCALATE_RE } = await import('../src/route-scan.js');
const { routeMatch, judgementMatch, escalationNotice } = await import('../src/route-inject.js');
const { renderModelRatchet, syncAllFiles } = await import('../src/model-rules.js');
const { codexPromptCategory } = await import('../src/codex/delegation.js');
const sw = await import('../src/routing-switch.js');
const lint = (await import('../src/korean-lint.cjs')).default;

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

const rule = (tier, category) => ({
  tier, category, label: category, labelEn: category, scope: 'global', targetRoot: null, project: '-p',
  signature: `${tier}|${category}|-p`, rule: 'r', example: 'x', promotedAt: '2026-11-01', count: 5, status: 'active',
});
const rules = [rule('T2', 'check'), rule('T1', 'check'), rule('T2', 'read')];
const CHECK = '지금 실행 중인 버전이 뭔지 확인해줘';

test('JUDGE_RE catches audits, recommendations, rankings, absence checks and research', () => {
  for (const t of [
    '이 모듈 보안 감사해줘', '결제 흐름을 감사 부탁합니다', 'audit the retry logic', '쓸 만한 라이브러리 추천해줘',
    'recommend a queue library', '남은 작업 우선순위 정리해줘', '이슈 순위를 매겨 줘', 'prioritize these tickets',
    'prioritise the backlog', '빠진 케이스가 없는지 봐줘', '있는지 없는지 알려줘', '캐시가 존재하는지 알려줘',
    '이 주제 조사해 줘', '시장을 좀 더 조사해보자', '경쟁 서비스 리서치 부탁', 'do some research on queues',
    'find alternatives to this package', 'is there a library that parses this format?',
  ]) assert.ok(JUDGE_RE.test(t), t);
});

test('JUDGE_RE leaves thanks, product nouns, file names and plain checks alone', () => {
  for (const t of [
    '감사합니다', '도와줘서 감사해요', '정말 감사드립니다', 'audit log 파일을 열어줘', '추천 위임 룰 목록 보여줘',
    'recommendation letter 초안', 'notes/topic-research-summary.md 를 읽어줘', '실행되고 있는지 확인해줘',
    '그걸 할 수 없는지 모르겠어', '할 순 없는지 몰라', 'is there an exported function that returns the day?',
    'is there a file that holds the config?', '지금 실행 중인 버전이 뭔지 확인해줘',
  ]) assert.ok(!JUDGE_RE.test(t), t);
});

test('JUDGE_RE leaves ESCALATE_RE untouched: the old gate still decides the old words', () => {
  assert.ok(ESCALATE_RE.test('이 구조를 설계해줘'));
  assert.ok(!ESCALATE_RE.test('쓸 만한 라이브러리 추천해줘'), 'the new words are not in ESCALATE_RE');
});

test('routeMatch: cost gates on ESCALATE_RE alone, quality on JUDGE_RE too', () => {
  const absence = '로그에 에러가 없는지 확인해줘';
  assert.ok(routeMatch(absence, { rules, grade: 'cost' }), 'cost still hands an absence check off');
  assert.ok(routeMatch(absence, { rules, grade: 'saving' }), 'an old saving value reads as cost');
  assert.equal(routeMatch(absence, { rules, grade: 'balanced' }), null, 'an old balanced value reads as quality');
  assert.equal(routeMatch(absence, { rules, grade: 'quality' }), null);
  // an ESCALATE_RE word closes every grade
  assert.equal(routeMatch('로그가 왜 이렇게 나오는지 확인해줘', { rules, grade: 'cost' }), null);
  // an ordinary check is unchanged in both
  for (const grade of sw.DELEGATION_GRADES) assert.ok(routeMatch(CHECK, { rules, grade }), grade);
});

test('routeMatch: quality drops the T2 rule of a lookup category and keeps T1', () => {
  const cost = routeMatch(CHECK, { rules, grade: 'cost' });
  assert.ok(cost.t2 && cost.t1, 'cost states both tiers');
  const q = routeMatch(CHECK, { rules, grade: 'quality' });
  assert.equal(q.t2, undefined);
  assert.ok(q.t1, 'the T1 rule stays');
  // only a T2 rule for that category: nothing is left to say
  assert.equal(routeMatch(CHECK, { rules: [rule('T2', 'check')], grade: 'quality' }), null);
  assert.ok(routeMatch(CHECK, { rules: [rule('T2', 'check')], grade: 'cost' }));
});

test('gradeKeepsRule keeps T2 only for paste, read and translate at quality', () => {
  for (const c of ['paste', 'read', 'translate']) assert.ok(sw.gradeKeepsRule('quality', rule('T2', c)), c);
  for (const c of ['explore', 'check', 'run']) assert.ok(!sw.gradeKeepsRule('quality', rule('T2', c)), c);
  for (const c of ['explore', 'check', 'run']) assert.ok(sw.gradeKeepsRule('quality', rule('T1', c)), c);
  assert.ok(sw.gradeKeepsRule('cost', rule('T2', 'run')));
  assert.ok(sw.gradeKeepsRule('saving', rule('T2', 'run')), 'an old saving value reads as cost');
  assert.ok(!sw.gradeKeepsRule('balanced', rule('T2', 'run')), 'an old balanced value reads as quality');
});

test('judgementMatch says which gate held the request back', () => {
  assert.deepEqual(judgementMatch('이 구조를 어떻게 설계할지 정해줘', { grade: 'quality' }), { judgement: true, kind: 'escalate', cat: null });
  assert.deepEqual(judgementMatch('쓸 만한 라이브러리 추천해줘', { grade: 'quality' }), { judgement: true, kind: 'judge', cat: null });
  assert.equal(judgementMatch('쓸 만한 라이브러리 추천해줘', { grade: 'cost' }), null, 'cost does not gate on JUDGE_RE');
  assert.equal(judgementMatch('이 구조를 어떻게 설계할지 정해줘', { grade: 'cost' }).kind, 'escalate');
  // a deploy is kept off the delegation path but is not a judgement
  assert.equal(judgementMatch('이 버전을 지금 배포해줘', { grade: 'quality' }).kind, 'action');
  assert.equal(judgementMatch(CHECK, { grade: 'quality' }), null);
  assert.equal(judgementMatch('<task-notification> 설계 끝', { grade: 'quality' }), null);
  assert.equal(judgementMatch('짧음', { grade: 'quality' }), null);
});

test('escalationNotice: Sonnet is told to move up, Opus and an unknown model are not', () => {
  const ask = '보안 취약점이 없는지 확인해줘';
  for (const grade of ['quality', 'cost']) {
    const out = escalationNotice(ask, { sessionRank: 1, grade, lang: 'ko' });
    assert.match(out, /^✇ \[sprag\] 이 요청은 판단이 결론인 일입니다\./, grade);
    assert.ok(out.includes(`위임 등급(${sw.gradeLabel(grade, 'ko')})`), grade);
    assert.equal(escalationNotice(ask, { sessionRank: 2, grade, lang: 'ko' }), null, `${grade}: Opus session`);
    assert.equal(escalationNotice(ask, { sessionRank: 3, grade, lang: 'ko' }), null, `${grade}: Fable session`);
    assert.equal(escalationNotice(ask, { sessionRank: null, grade, lang: 'ko' }), null, `${grade}: unknown model`);
  }
  assert.ok(escalationNotice(ask, { sessionRank: 0, grade: 'quality', lang: 'ko' }), 'a Haiku session is told too');
});

test('escalationNotice: cost speaks only for diagnosis, audit and security', () => {
  const opts = (grade) => ({ sessionRank: 1, grade, lang: 'ko' });
  for (const t of ['이 장애의 원인 분석해줘', '이 모듈 보안 감사해줘', 'check for vulnerabilities here', 'find the root cause of this']) {
    assert.ok(escalationNotice(t, opts('cost')), t);
  }
  for (const t of ['이 두 방식을 비교해줘', '이 구조를 설계해줘', '쓸 만한 라이브러리 추천해줘']) {
    assert.equal(escalationNotice(t, opts('cost')), null, t);
    if (judgementMatch(t, { grade: 'quality' })) assert.ok(escalationNotice(t, opts('quality')), `quality: ${t}`);
  }
});

test('escalationNotice: no notice for an ordinary request or an irreversible action', () => {
  assert.equal(escalationNotice(CHECK, { sessionRank: 1, grade: 'quality', lang: 'ko' }), null);
  assert.equal(escalationNotice('이 버전을 지금 배포해줘', { sessionRank: 1, grade: 'quality', lang: 'ko' }), null);
});

test('escalationNotice wording: Korean passes the lint, both languages recommend high and never xhigh', () => {
  const ko = escalationNotice('보안 취약점이 없는지 확인해줘', { sessionRank: 1, grade: 'quality', lang: 'ko' });
  assert.deepEqual(lint.lintKoreanText(ko, { maxFindings: 100 }), []);
  assert.ok(ko.includes('Opus(effort high)') && ko.includes('t1h-worker') && ko.includes('/model opus') && ko.includes('sprag.io/proof'));
  assert.ok(ko.includes('위임 등급(품질 우선)'));
  const en = escalationNotice('보안 취약점이 없는지 확인해줘', { sessionRank: 1, grade: 'cost', lang: 'en' });
  assert.ok(en.startsWith('✇ [sprag] This request ends in a judgement. At delegation grade cost,'));
  assert.ok(en.includes('Opus at effort high') && en.includes('/model opus'));
  assert.ok(!/xhigh/.test(ko + en));
});

test('renderModelRatchet: the grade line, the judgement clause and the quality T2 filter', () => {
  const sample = [rule('T2', 'check'), rule('T1', 'check'), rule('T2', 'read')];
  for (const grade of sw.DELEGATION_GRADES) {
    const ko = renderModelRatchet(sample, 'ko', { root: null, grade });
    assert.ok(ko.includes(`현재 위임 등급: ${sw.gradeLabel(grade, 'ko')}. 바꾸려면 \`sprag routing grade <quality|cost>\`.`), grade);
    assert.ok(ko.includes('결론이 판단입니다'), 'judgement clause (ko)');
    assert.ok(ko.includes('effort xhigh는 권하지 않습니다'));
    const en = renderModelRatchet(sample, 'en', { root: null, grade });
    assert.ok(en.includes(`Current delegation grade: ${grade}. Change it with sprag routing grade <quality|cost>.`), grade);
    assert.ok(en.replace(/\s+/g, ' ').includes('all end in a judgement'), 'judgement clause (en)');
    assert.ok(en.replace(/\s+/g, ' ').includes('Do not recommend effort xhigh'));
  }
  const body = (t) => t.split('## Rules')[1];
  const bal = body(renderModelRatchet(sample, 'ko', { root: null, grade: 'cost' }));
  const q = body(renderModelRatchet(sample, 'ko', { root: null, grade: 'quality' }));
  assert.match(bal, /<!-- T2 [^\n]*\/ T1 /, 'cost keeps the merged T2/T1 line for check');
  assert.doesNotMatch(q, /<!-- T2 [^\n]*\/ T1 /, 'quality drops the T2 check rule');
  assert.equal((q.match(/^- /gm) || []).length, 2, 'the T1 check line and the T2 read line remain');
  // the generated Korean text passes the lint at every grade
  for (const grade of sw.DELEGATION_GRADES) {
    const head = renderModelRatchet([], 'ko', { root: null, grade }).split('## Rules')[0];
    // The header predates this change and carries findings of its own, so only the two added passages are held to the lint.
    const added = head.split('\n').filter((l) => /현재 위임 등급/.test(l)).join('\n')
      + head.slice(head.indexOf('- 개선점이나'), head.indexOf('## 티어 판별'));
    assert.deepEqual(lint.lintKoreanText(added, { maxFindings: 100 }), [], grade);
  }
});

test('syncAllFiles rewrites ratchet-model.md when the grade changes', () => {
  const mr = join(home, '.claude', 'ratchet-model.md');
  const data = { rules: [rule('T2', 'check'), rule('T1', 'check')] };
  mkdirSync(join(dir, 'cfg', 'claude-token-saver'), { recursive: true });
  // the registry lives under the state directory; write it where model-rules reads it
  return import('../src/model-rules.js').then(({ saveModelRules }) => {
    saveModelRules(data);
    sw.setDelegationGrade('cost');
    syncAllFiles();
    const before = readFileSync(mr, 'utf8');
    assert.match(before, /현재 위임 등급: 비용 우선|Current delegation grade: cost/);
    assert.deepEqual(syncAllFiles(), [], 'unchanged grade writes nothing');
    sw.setDelegationGrade('quality');
    assert.deepEqual(syncAllFiles(), [mr]);
    const after = readFileSync(mr, 'utf8');
    assert.match(after, /현재 위임 등급: 품질 우선|Current delegation grade: quality/);
    assert.notEqual(after, before);
    sw.setDelegationGrade('quality');
  });
});

test('codexPromptCategory follows the grade gate; the Opus notice is not ported', () => {
  assert.ok(codexPromptCategory('로그에 에러가 없는지 확인해줘', { grade: 'cost' }));
  assert.equal(codexPromptCategory('로그에 에러가 없는지 확인해줘', { grade: 'balanced' }), null, 'an old balanced value reads as quality');
  assert.equal(codexPromptCategory('로그에 에러가 없는지 확인해줘', { grade: 'quality' }), null);
  assert.ok(codexPromptCategory(CHECK, { grade: 'quality' }));
});

function cli(args) {
  return spawnSync(process.execPath, [CLI, 'routing', ...args], {
    cwd: dir, encoding: 'utf8', timeout: 15000,
    env: childEnv({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(dir, 'cfg'), SPRAG_LANG: 'en', SPRAG_NO_UPDATE_CHECK: '1' }),
  });
}

test('sprag routing grade: shows, sets, refuses a bad value with exit 2, and status carries the line', () => {
  const show = cli(['grade']);
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /^grade: quality \(quality\)/, 'quality is the default');
  const set = cli(['grade', 'cost']);
  assert.equal(set.status, 0, set.stderr);
  assert.match(set.stdout, /Delegation grade is now cost/);
  assert.equal(set.stderr, '');
  assert.match(cli(['grade']).stdout, /^grade: cost \(cost\)/);
  assert.match(cli(['status']).stdout, /^grade: cost \(cost\)/m);
  assert.match(cli([]).stdout, /^grade: cost/m);
  const bad = cli(['grade', 'max']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Usage: sprag routing grade \[quality\|cost\]/);
  const configPath = join(dir, 'cfg', 'claude-token-saver', 'config.json');
  assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).delegationGrade, 'cost', 'a bad value changes nothing');
  // an old name is accepted, stored as its replacement, and warned about once
  const old = cli(['grade', 'balanced']);
  assert.equal(old.status, 0, old.stderr);
  assert.match(old.stderr, /Warning: the balanced grade no longer exists; storing quality\./);
  assert.equal(old.stderr.trim().split('\n').length, 1);
  assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).delegationGrade, 'quality');
  const oldSaving = cli(['grade', 'saving']);
  assert.match(oldSaving.stderr, /storing cost/);
  assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).delegationGrade, 'cost');
  cli(['grade', 'quality']);
});

test('brief --hook adds the Opus recommendation in a Sonnet session and stays quiet in an Opus one', () => {
  const hook = (model, prompt) => {
    const transcript = join(dir, `${model}.jsonl`);
    writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { model, role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }) + '\n');
    return spawnSync(process.execPath, [CLI, 'brief', '--hook'], {
      cwd: dir, encoding: 'utf8', timeout: 15000,
      input: JSON.stringify({ session_id: `s-${model}`, transcript_path: transcript, cwd: dir, prompt }),
      env: childEnv({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(dir, 'cfg'), SPRAG_LANG: 'en', SPRAG_NO_UPDATE_CHECK: '1' }),
    });
  };
  const ask = 'Please audit the retry logic in this module';
  const sonnet = hook('claude-sonnet-5-5', ask);
  assert.equal(sonnet.status, 0, sonnet.stderr);
  assert.match(sonnet.stdout, /This request ends in a judgement/);
  assert.doesNotMatch(hook('claude-opus-4-8', ask).stdout, /ends in a judgement/);
  assert.doesNotMatch(hook('claude-sonnet-5-5', 'tell me which version is running now').stdout, /ends in a judgement/);
});
