/**
 * evals/impl-delegation-rate.mjs: turn collection and summary over a fake
 * projects directory. Every transcript line below is invented.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { collectTurns, summarize, isoWeek } = await import('../evals/impl-delegation-rate.mjs');

const dir = mkdtempSync(join(tmpdir(), 'sprag-impl-rate-'));
test.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const user = (ts, text, extra = {}) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: text }, ...extra });
const tools = (...uses) => ({
  type: 'assistant',
  message: { role: 'assistant', content: uses.map(([name, input], i) => ({ type: 'tool_use', id: `t${i}`, name, input })) },
});
const edit = (file, text = 'x'.repeat(100)) => ['Edit', { file_path: file, old_string: 'a', new_string: text }];

const proj = join(dir, 'proj-a');
mkdirSync(proj, { recursive: true });
const lines = [
  // 1: delegated turn (the main model edits one file itself, still a delegated turn)
  user('2026-11-02T10:00:00Z', '로그인 API 구현해줘'),
  tools(['Agent', { subagent_type: 't1-worker', prompt: '수정할 파일: src/a.js\n완료 기준: 테스트 통과' }], edit('/work/src/a.js')),
  // 2: direct turn with three code files
  user('2026-11-02T11:00:00Z', '세 파일을 고쳐줘'),
  tools(edit('/work/src/a.js', 'x'.repeat(100)), edit('/work/src/b.js', 'x'.repeat(100))),
  tools(edit('/work/src/c.js', 'x'.repeat(100)), edit('/work/src/c.js', 'x'.repeat(100))),
  // 3: three documents only, not direct
  user('2026-11-03T09:00:00Z', '문서를 고쳐줘'),
  tools(edit('/work/docs/a.md'), edit('/work/docs/b.md'), edit('/work/README.txt')),
  // 4: lookup agent plus two code files, not direct and not delegated
  user('2026-11-03T10:00:00Z', '확인해줘'),
  tools(['Agent', { subagent_type: 'Explore', prompt: '수정할 파일을 찾아라' }], edit('/work/src/a.js'), edit('/work/src/b.js')),
  // 5: tool results and system text do not start a new turn
  { type: 'user', timestamp: '2026-11-03T10:01:00Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't0', content: 'ok' }] } },
  user('2026-11-03T10:02:00Z', '<system-reminder>noise</system-reminder>'),
  // 6: sidechain lines are ignored even when they look like a direct turn
  user('2026-11-04T09:00:00Z', 'sidechain prompt', { isSidechain: true }),
  { ...tools(edit('/work/src/x.js'), edit('/work/src/y.js'), edit('/work/src/z.js')), isSidechain: true },
  // 7: out of range
  user('2026-10-01T09:00:00Z', '옛 요청'),
  tools(edit('/work/src/a.js'), edit('/work/src/b.js'), edit('/work/src/c.js')),
];
writeFileSync(join(proj, 's1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

test('collectTurns: keeps delegated and edit turns, drops sidechain and out-of-range lines', async () => {
  const turns = await collectTurns(dir, { since: '2026-11-01', until: '2026-11-30' });
  assert.equal(turns.filter((t) => t.delegated).length, 1);
  assert.deepEqual(turns.map((t) => t.date), ['2026-11-02', '2026-11-02', '2026-11-03']);
  assert.equal(turns.some((t) => t.edits.some((e) => /\/[xyz]\.js$/.test(e.file))), false, 'sidechain edits');
  assert.equal(turns.some((t) => t.edits.some((e) => /\.(md|txt)$/.test(e.file))), false, 'documents are not code edits');
});

test('summarize: one delegated turn, one direct turn, documents and two-file turns are neither', async () => {
  const s = summarize(await collectTurns(dir, { since: '2026-11-01' }));
  assert.deepEqual(s.total, { delegated: 1, direct: 1, ratePct: 50 });
  assert.deepEqual(s.weeks.map((w) => [w.week, w.delegated, w.direct]), [['2026-W45', 1, 1]]);
  // direct turn: 4 edits of 100 chars; after file 1 (a.js, 100 used) 75%, after file 2 50%, after file 3 25%
  assert.deepEqual(s.medianRemainingShare, { afterFile1: 0.75, afterFile2: 0.5, afterFile3: 0.25, directTurns: 1 });
});

test('isoWeek: ISO week labels across a year boundary', () => {
  assert.equal(isoWeek('2026-11-02'), '2026-W45');
  assert.equal(isoWeek('2026-01-01'), '2026-W01');
  assert.equal(isoWeek('2027-01-01'), '2026-W53');
});

test('collectTurns: a missing directory yields no turns', async () => {
  assert.deepEqual(await collectTurns(join(dir, 'nope'), {}), []);
});
