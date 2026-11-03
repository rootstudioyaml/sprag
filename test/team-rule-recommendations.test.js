/**
 * The Rules tab of the team dashboard recommends delegation rules that already worked for
 * some members (rule_recommendations) and lets an admin apply them to the organization or a
 * team. These checks pin the pieces that must not drift:
 *  - the category label table is a copy of src/route-scan.js, because the fallback text the
 *    page writes has to read like what a member PC writes for the same category,
 *  - the recommendation thresholds,
 *  - the call and the inserts that carry rec.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RULE_CATEGORY_LABELS } from '../src/rule-categories.js';

const html = readFileSync(new URL('../site/team/index.html', import.meta.url), 'utf8');

/** The page's label table and recText(), evaluated from the page source. */
function pageRecText() {
  const start = html.indexOf('const REC_CATS = ');
  const end = html.indexOf('/* end of rec text */', start);
  assert.ok(start > 0 && end > start, 'REC_CATS .. recText block not found in site/team/index.html');
  return new Function(`${html.slice(start, end)}\nreturn { REC_CATS, REC_TIERS, recText };`)();
}

/** The labels route-scan files requests under (label ko, labelEn en). They live in src/rule-categories.js. */
function routeScanLabels() {
  const out = {};
  for (const [id, c] of Object.entries(RULE_CATEGORY_LABELS)) out[id] = { ko: c.label, en: c.labelEn };
  return out;
}

test('page category labels are an exact copy of route-scan label and labelEn', () => {
  const src = routeScanLabels();
  assert.deepEqual(Object.keys(src).sort(), ['check', 'explore', 'paste', 'read', 'run', 'translate'], 'route-scan categories changed; update the page table too');
  assert.deepEqual(pageRecText().REC_CATS, src);
});

test('recommendation thresholds are 5 delegations and a 0.2 failure rate', () => {
  assert.match(html, /REC_MIN_DELEGATED\s*=\s*5\b/);
  assert.match(html, /REC_MAX_ERR\s*=\s*0\.2\b/);
});

test('the page loads rule_recommendations and inserts rec with org and team rules', () => {
  assert.match(html, /rpc\(\s*'rule_recommendations'\s*,\s*\{\s*p_org:/);
  assert.match(html, /from\('org_rules'\)\.insert\(\{[^{}]*scope:\s*'model'[^{}]*\brec\b[^{}]*\}\)/);
  assert.match(html, /from\('team_rules'\)\.insert\(\{[^{}]*scope:\s*'model'[^{}]*\brec\b[^{}]*status:\s*'approved'[^{}]*\}\)/);
  assert.match(html, /PGRST202/, 'a server without the function must hide the section');
});

test('recText writes the fallback sentence per tier, language and budget', () => {
  const { recText } = pageRecText();
  const run = { category: 'run', tier: 'T2', calls: 8, out: 1500 };
  assert.equal(recText(run, 'en'),
    'Simple "running commands (build/test/git)" requests go to a Haiku subagent, cap 8 tool calls / 1500 output tokens');
  assert.equal(recText(run, 'ko'),
    '"명령 실행 (빌드·테스트·git)" 단순 요청은 Haiku 서브에이전트에 위임 (상한 도구 호출 8회, 출력 1500 토큰)');
  assert.equal(recText({ category: 'explore', tier: 'T1', calls: null, out: 6439 }, 'en'),
    'Moderate "lookup (finding files/values)" requests go to a Sonnet subagent, cap 6439 output tokens');
  assert.equal(recText({ category: 'explore', tier: 'T1', calls: null, out: 6439 }, 'ko'),
    '"탐색·조회 (파일/값 찾기)" 중간 난도 요청은 Sonnet 서브에이전트에 위임 (상한 출력 6439 토큰)');
  const heavy = { category: 'run', tier: 'T1H', calls: null, out: 26729 };
  assert.match(recText(heavy, 'en'), /^Heavy "running commands \(build\/test\/git\)" implementation requests go to an Opus subagent in Fable\/Mythos sessions only, cap 26729 output tokens$/);
  assert.match(recText(heavy, 'ko'), /고난도 구현 요청은 Opus 서브에이전트에 위임, Fable·Mythos 세션에 한함 \(상한 출력 26729 토큰\)$/);
  assert.ok(!/cap/.test(recText({ category: 'read', tier: 'T2', calls: null, out: null }, 'en')), 'no budget, no cap clause');
});
