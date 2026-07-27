/**
 * The harness block must carry the `@` import that actually loads ratchet.md
 * into a session. Without it `harness promote` is a write-only operation:
 * rules land in a file nothing reads (the v3.6.2 hole).
 */
import test from 'node:test';
import assert from 'node:assert';
import {
  harnessClaudeMdBlock,
  ratchetImportLine,
  modelRatchetImportLine,
  RATCHET_IMPORT_RE,
  MODEL_RATCHET_IMPORT_RE,
} from './src/harness-templates.js';
import { parseRuleMeta } from './src/harness.js';

test('project block imports the repo-local ratchet', () => {
  const block = harnessClaudeMdBlock('project');
  assert.match(block, /^@\.claude\/ratchet\.md$/m);
  assert.ok(RATCHET_IMPORT_RE.test(block));
});

test('global block imports the user-level ratchet', () => {
  const block = harnessClaudeMdBlock('global');
  assert.match(block, /^@~\/\.claude\/ratchet\.md$/m);
  assert.ok(RATCHET_IMPORT_RE.test(block));
});

test('default scope is project (back-compat with no-arg callers)', () => {
  assert.strictEqual(harnessClaudeMdBlock(), harnessClaudeMdBlock('project'));
  assert.strictEqual(ratchetImportLine(), '@.claude/ratchet.md');
});

test('import line sits inside the managed block so re-init upgrades it', () => {
  const block = harnessClaudeMdBlock('project');
  assert.ok(block.indexOf('@.claude/ratchet.md') < block.indexOf('harness:end'));
});

test('detector rejects a block whose import line was deleted', () => {
  const stripped = harnessClaudeMdBlock('project').replace('@.claude/ratchet.md\n', '');
  assert.ok(!RATCHET_IMPORT_RE.test(stripped));
});

test('model ratchet is imported too, in both scopes', () => {
  assert.ok(MODEL_RATCHET_IMPORT_RE.test(harnessClaudeMdBlock('project')));
  assert.ok(MODEL_RATCHET_IMPORT_RE.test(harnessClaudeMdBlock('global')));
  assert.strictEqual(modelRatchetImportLine('global'), '@~/.claude/ratchet-model.md');
});

test('the two import detectors do not match each other', () => {
  assert.ok(!RATCHET_IMPORT_RE.test('@.claude/ratchet-model.md'));
  assert.ok(!MODEL_RATCHET_IMPORT_RE.test('@.claude/ratchet.md'));
});

test('rule metadata parses date and optional tags', () => {
  assert.deepStrictEqual(parseRuleMeta('2026-05-08: [video,tts] 자막 수정'), { date: '2026-05-08', tags: ['video', 'tts'] });
  assert.deepStrictEqual(parseRuleMeta('2026-05-08: 태그 없는 룰'), { date: '2026-05-08', tags: [] });
  assert.deepStrictEqual(parseRuleMeta('날짜 없는 룰'), { date: null, tags: [] });
  assert.deepStrictEqual(parseRuleMeta('[video] 날짜 없이 태그만'), { date: null, tags: ['video'] });
  // A bracketed aside mid-sentence is not a tag list.
  assert.deepStrictEqual(parseRuleMeta('2026-05-08: 빌드 실패 시: [로그 확인]'), { date: '2026-05-08', tags: [] });
});
