/**
 * The implementation hand-off guidance lives in several copies: the rendered
 * model-rules header, the preset ratchet rule, the two implementing agent
 * bodies, the Codex hint and the guard's cap line. A replay of ten real
 * implementation hand-offs showed that a thin specification and a lookup-sized
 * output cap cost the most, so every copy has to say the same things. This file
 * pins them together; changing one copy without the others fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { implementationDelegationRule } from '../src/implementation-delegation.js';
import { codexImplementationHint } from '../src/codex/delegation.js';
import { IMPLEMENTATION_CAP_LINE } from '../src/delegation-guard.js';
import { bundledBundle, bundleShapeError } from '../src/presets-source.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const ruleCopy = (id) => readJson('presets/ratchet-rules.json').rules.find((r) => r.id === id);
const agentBody = (name) => readJson('presets/agents.json').agents.find((a) => a.name === name).body;

function codexHint() {
  const base = mkdtempSync(join(tmpdir(), 'sprag-implspec-'));
  try {
    const dir = join(base, 'state');
    const home = join(base, 'codex');
    for (const p of [dir, join(home, 'sessions'), join(home, 'archived_sessions')]) mkdirSync(p, { recursive: true });
    const cfg = { codex: { sharedRules: { auto: false, targets: [
      { tier: 'T1', from: 'parent-model', model: 'child-model', provider: 'current-gateway', effort: 'high' },
    ] } } };
    return codexImplementationHint({ dir, home, cfg, model: 'parent-model', provider: 'current-gateway',
      sessionId: 'parent-session', record: () => {} });
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const KO_MARKERS = ['함께 고칠 곳', '저장소 규약', '완료 기준', '보고 형식', '출력 토큰 상한'];
const EN_MARKERS = ['other callers', 'conventions', 'completion criteria', 'report format', 'output-token cap'];

test('Korean copies of the implementation specification carry the same markers', () => {
  const copies = {
    'model-rules header': implementationDelegationRule('claude', 'ko'),
    'fix-777a15.ko': ruleCopy('fix-777a15').ko,
  };
  for (const [name, text] of Object.entries(copies)) {
    for (const marker of KO_MARKERS) assert.ok(text.includes(marker), `${name} lacks "${marker}"`);
  }
});

test('English copies of the implementation specification carry the same markers', () => {
  const copies = {
    'claude header': implementationDelegationRule('claude', 'en'),
    'codex header': implementationDelegationRule('codex', 'en'),
    'fix-777a15.en': ruleCopy('fix-777a15').en,
    'codex implementation hint': codexHint(),
  };
  for (const [name, text] of Object.entries(copies)) {
    for (const marker of EN_MARKERS) assert.ok(text.toLowerCase().includes(marker), `${name} lacks "${marker}"`);
  }
});

test('the rendered rule lists the nine specification items and drops the old budget wording', () => {
  for (const [agent, lang] of [['claude', 'ko'], ['claude', 'en'], ['codex', 'en']]) {
    const text = implementationDelegationRule(agent, lang);
    for (let n = 1; n <= 9; n += 1) assert.match(text, new RegExp(`^ {4}${n}\\. `, 'm'), `${agent}/${lang} item ${n}`);
    assert.doesNotMatch(text, /예산과|a budget,/, `${agent}/${lang}`);
  }
  assert.equal(ruleCopy('fix-777a15').id, 'fix-777a15');
});

test('the Codex implementation hint states no output-token cap', () => {
  const hint = codexHint();
  assert.match(hint, /State no output-token cap/);
  assert.doesNotMatch(hint, /8000 output tokens/);
  assert.match(hint, /Do not recursively delegate/);
});

test('the guard cap line agrees with the specification copies', () => {
  assert.match(IMPLEMENTATION_CAP_LINE, /no output-token cap/);
  assert.match(IMPLEMENTATION_CAP_LINE, /does not fit the code/);
});

test('t1-worker and t1h-worker carry the file-changing block in both languages, the t2 agents do not', () => {
  for (const name of ['t1-worker', 't1h-worker']) {
    const { en, ko } = agentBody(name);
    for (const phrase of ['other callers', 'does not fit the code', 'match the diff']) {
      assert.ok(en.includes(phrase), `${name}.en lacks "${phrase}"`);
    }
    assert.doesNotMatch(en, /stay within the caps \(tool calls, output tokens\)/, `${name}.en`);
    for (const phrase of ['호출 지점과 사본', '다른 설계로 구현하지 마십시오', 'diff와 일치']) {
      assert.ok(ko.includes(phrase), `${name}.ko lacks "${phrase}"`);
    }
    assert.doesNotMatch(ko, /상한\(도구 호출 횟수, 출력 토큰\)/, `${name}.ko`);
  }
  for (const name of ['t2-explore', 't2-runner', 't2-translate']) {
    const { en, ko } = agentBody(name);
    assert.match(en, /stay within the caps \(tool calls, output tokens\)/, `${name}.en keeps the lookup cap`);
    assert.match(ko, /상한\(도구 호출 횟수, 출력 토큰\)/, `${name}.ko keeps the lookup cap`);
    assert.doesNotMatch(en, /does not fit the code/, name);
  }
});

test('the bundled preset still has the shape a published bundle needs', () => {
  const bundle = bundledBundle({ version: 5, minCli: '3.74.0' });
  assert.equal(bundleShapeError(bundle), null);
});
