/**
 * #16: on 600 labelled prompts the rule hint marked 47 test prompts as light
 * work and 36 of them needed the main model. The misfires were replies to the
 * previous turn, feedback, outward actions, edit asks EDIT_RE missed and long
 * written specs. These gates keep the hint quiet on those shapes while the
 * lookups and commands it was right about keep firing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeMatch, looksLikeContextOrSpec } from '../src/route-inject.js';
import { codexPromptCategory } from '../src/codex/delegation.js';

const rules = ['check', 'run', 'read', 'paste', 'explore'].map((category) => (
  { category, tier: 'T2', scope: 'global', status: 'active' }
));
const match = (text) => routeMatch(text, { rules, env: {} });

test('replies, feedback, self-checks, outward actions, edits and long specs get no hint', () => {
  for (const text of [
    '응 블렌더로 확인부터 진행해줘',
    '그래 네가 돌려봐',
    '아니면 다른 대안을 좀 찾아보자',
    '아,, 뭐야 이게 이건 내가 원하는 화면이 아니야',
    'A로 더 다듬어서 다시 보여줘',
    '귀여운게 아니라 징그러운데 다른걸로 검색해보자',
    '이미지로 확인해볼게',
    '어디까지 진행되었는지 확인이 필요해',
    '결과 보고서 슬랙 채널에 올려주면 아침에 확인할게',
    '영상 확인할 수 있는 링크 업로드해줘',
    '저자가 누군지에 대해서도 확인해서 추가해주고',
    '팀 대시보드는 로컬로 확인할 수 있게 셋팅하자 가격 메뉴도 다른 벤치마크 사이트들 확인해서 비슷한 형태로 구성하고 멤버십 용어도 다시 정리해서 화면에 반영하자 그리고 좌석 연결 확인도 필요해',
  ]) {
    assert.equal(match(text), null, text);
    assert.equal(looksLikeContextOrSpec(text), true, text);
  }
});

test('lookups and commands keep their hint', () => {
  for (const text of [
    'git push 해줘',
    'npm test 돌려줘',
    '지금 실행 중인 버전이 뭔지 확인해줘',
    'preset v3 잘 내려받아지는지 확인',
    '소넷 위임시 effort 뭘로 셋팅 되는지 확인',
    'pdf 파일같은것만 추려서 목록으로 보면 될 듯 다운로드 폴더에 몰려있을것같아',
    '1번으로 기록 없는 사용량 출처 확인해줘 이 pc 는 주로 claudecode를 사용하기때문에 로컬 기록이 없는게 이상해 원장 기록방식에 홀이 있는건 아닐까?',
  ]) {
    assert.ok(match(text), `should still match: ${text}`);
    assert.equal(looksLikeContextOrSpec(text), false, text);
  }
});

test('a long paste is still a paste, not a spec', () => {
  const log = Array.from({ length: 12 }, (_, i) => `2026-11-07T10:00:${String(i).padStart(2, '0')} ERROR worker ${i} failed`).join('\n');
  assert.equal(looksLikeContextOrSpec(log), false);
});

// Codex copies the Claude Code gates (src/codex/delegation.js), so the same
// shapes must stay quiet there too.
test('the Codex prompt hint applies the same gates', () => {
  assert.equal(codexPromptCategory('응 블렌더로 확인부터 진행해줘'), null);
  assert.equal(codexPromptCategory('영상 확인할 수 있는 링크 업로드해줘'), null);
  assert.ok(codexPromptCategory('지금 실행 중인 버전이 뭔지 확인해줘'));
});

// #16 follow-up review of 57 real hinted delegations: two of the three that lost
// quality silently were open web research handed to a cheaper model.
test('open web research gets no hint', () => {
  for (const text of [
    '레딧이나 해커뉴스에서 활용할 수 있는 캐릭터 오픈소스를 좀 살펴보자',
    'cyber 관련 인터넷 소식 최근 발표된 내용 확인',
    '좋을만한 오픈소스 확인해보자',
    'blender 3d 모델링 프롬프트 팁을 인터넷으로 찾아보자',
  ]) {
    assert.equal(match(text), null, text);
  }
});

// A subagent's report and a compaction summary arrive as user turns; a hint
// there told the main model to delegate the checking of a subagent's result.
test('subagent reports and compaction summaries are not requests', () => {
  for (const text of [
    'Another Claude session sent a message:\n<agent-message from="a1">\n찾아보고 확인한 결과를 보고합니다\n</agent-message>',
    '<agent-message from="a1">확인 결과입니다</agent-message>',
    'This session is being continued from a previous conversation that ran out of context. 확인해줘',
  ]) {
    assert.equal(match(text), null, text);
  }
});

// The shared clause that tells the main model not to delegate open research is
// written into ratchet-model.md in both languages.
test('ratchet-model carries the open-research clause in Korean and English', async () => {
  const { renderModelRatchet } = await import('../src/model-rules.js');
  const ko = renderModelRatchet([], 'ko', { root: null });
  const en = renderModelRatchet([], 'en', { root: null });
  assert.match(ko, /열린 조사는 위임하지 않습니다/);
  assert.match(en, /Do not delegate open research on the web/);
});
