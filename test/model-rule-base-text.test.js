/**
 * modelRuleBaseText: with an example the sentence is byte-identical to what it
 * always was; without one (a rule redrawn from a structured record by the team
 * layer) the example parenthesis is left out instead of printed empty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelRuleBaseText } from '../src/model-rules.js';

// root null looks only in the user agents directory; point HOME at an empty one so a real
// ~/.claude/agents on the developer's machine cannot change the wording.
function emptyHome(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-basetext-'));
  const saved = { home: process.env.HOME, profile: process.env.USERPROFILE };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  t.after(() => {
    for (const [k, v] of [['HOME', saved.home], ['USERPROFILE', saved.profile]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });
}

const G = { category: 'explore', label: '탐색 라벨', labelEn: 'lookup label', example: '어디서 발급하는데', exampleEn: 'where is it issued' };

test('with an example the sentence is unchanged', (t) => {
  emptyHome(t);
  const o = { root: null };
  assert.equal(modelRuleBaseText({ ...G, tier: 'T2' }, 'ko', o), '"탐색 라벨" 단순 요청(예: "어디서 발급하는데")은 model: haiku에 위임');
  assert.equal(modelRuleBaseText({ ...G, tier: 'T1' }, 'ko', o), '"탐색 라벨" 중간 난도 요청(예: "어디서 발급하는데")은 model: sonnet에 위임');
  assert.equal(modelRuleBaseText({ ...G, tier: 'T1H' }, 'ko', o), '"탐색 라벨" 고난도 구현 요청(예: "어디서 발급하는데")은 Fable·Mythos 세션에 한해 model: opus에 위임');
  assert.equal(modelRuleBaseText({ ...G, tier: 'T2' }, 'en', o), 'Simple "lookup label" requests (e.g. "where is it issued") go to a model: haiku subagent');
  assert.equal(modelRuleBaseText({ ...G, tier: 'T1' }, 'en', o), 'Moderate "lookup label" requests (e.g. "where is it issued") go to a model: sonnet subagent');
  assert.equal(modelRuleBaseText({ ...G, tier: 'T1H' }, 'en', o), 'Heavy "lookup label" implementation requests (e.g. "where is it issued") go to a model: opus subagent, in Fable/Mythos sessions only');
  // the English example falls back to the Korean one when exampleEn is empty, as before
  assert.match(modelRuleBaseText({ ...G, tier: 'T2', exampleEn: '' }, 'en', o), /\(e\.g\. "어디서 발급하는데"\)/);
});

test('without any example the parenthesis is left out, in every tier and both languages', (t) => {
  emptyHome(t);
  const o = { root: null };
  const bare = { ...G, example: '', exampleEn: '' };
  assert.equal(modelRuleBaseText({ ...bare, tier: 'T2' }, 'ko', o), '"탐색 라벨" 단순 요청은 model: haiku에 위임');
  assert.equal(modelRuleBaseText({ ...bare, tier: 'T1' }, 'ko', o), '"탐색 라벨" 중간 난도 요청은 model: sonnet에 위임');
  assert.equal(modelRuleBaseText({ ...bare, tier: 'T1H' }, 'ko', o), '"탐색 라벨" 고난도 구현 요청은 Fable·Mythos 세션에 한해 model: opus에 위임');
  assert.equal(modelRuleBaseText({ ...bare, tier: 'T2' }, 'en', o), 'Simple "lookup label" requests go to a model: haiku subagent');
  assert.equal(modelRuleBaseText({ ...bare, tier: 'T1' }, 'en', o), 'Moderate "lookup label" requests go to a model: sonnet subagent');
  assert.equal(modelRuleBaseText({ ...bare, tier: 'T1H' }, 'en', o), 'Heavy "lookup label" implementation requests go to a model: opus subagent, in Fable/Mythos sessions only');
  const missing = { category: 'explore', label: 'x', labelEn: 'y', tier: 'T2' };
  assert.doesNotMatch(modelRuleBaseText(missing, 'ko', o), /예:/);
  assert.doesNotMatch(modelRuleBaseText({ ...bare, example: '  ', tier: 'T2' }, 'en', o), /e\.g\./);
});
