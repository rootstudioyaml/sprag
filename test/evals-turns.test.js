// Unit tests for the pure parts of scripts/evals/turns.mjs. Fixtures only: no ledger, no claude, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parentPathOf, agentIdOf, lastAssistantText, isRealUser, findAnchor, extractFinalAnswer, capFinal,
  buildTurnPrompt, parseTurnGrade, summarize, pickMixed,
} from '../scripts/evals/turns.mjs';

const T = (n) => `2026-11-01T00:00:${String(n).padStart(2, '0')}.000Z`;
const asst = (n, text, extra = {}) => ({ type: 'assistant', isSidechain: false, timestamp: T(n), message: { content: [{ type: 'text', text }] }, ...extra });
const tool = (n, id, name = 'Agent') => ({ type: 'assistant', isSidechain: false, timestamp: T(n), message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
const result = (n, id, text) => ({ type: 'user', timestamp: T(n), message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });
const human = (n, text) => ({ type: 'user', timestamp: T(n), message: { role: 'user', content: text } });
const handBack = (n, agent, text) => ({ type: 'attachment', timestamp: T(n), attachment: { type: 'queued_command', commandMode: 'prompt', prompt: `<agent-message from="${agent}">\n[Subagent hand-back] ${text}</agent-message>` } });
const notify = (n, agent, tid) => ({ type: 'attachment', timestamp: T(n), attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: `<task-notification><task-id>${agent}</task-id><tool-use-id>${tid}</tool-use-id></task-notification>` } });

test('parentPathOf maps a subagent transcript to its session file, else null', () => {
  assert.equal(parentPathOf('/p/.claude/projects/-slug/abc-123/subagents/agent-a1b2.jsonl'), '/p/.claude/projects/-slug/abc-123.jsonl');
  assert.equal(parentPathOf('/p/.claude/projects/-slug/abc-123.jsonl'), null);
  assert.equal(parentPathOf('/p/-slug/abc/subagents/other.jsonl'), null);
  assert.equal(agentIdOf('/p/-slug/abc/subagents/agent-a1b2.jsonl'), 'a1b2');
  assert.equal(agentIdOf('/p/x.jsonl'), null);
});

test('lastAssistantText takes the last assistant entry that has text', () => {
  const e = [asst(1, 'first'), asst(2, 'final report'), { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Read' }] } }];
  assert.equal(lastAssistantText(e), 'final report');
  assert.equal(lastAssistantText([]), '');
});

test('isRealUser accepts typed messages and rejects tool results, notifications and system text', () => {
  assert.equal(isRealUser(human(1, 'hello')), true);
  assert.equal(isRealUser({ type: 'user', message: { content: [{ type: 'text', text: 'typed in a block' }] } }), true);
  assert.equal(isRealUser(result(1, 't', 'x')), false);
  assert.equal(isRealUser(human(1, '<system-reminder>x</system-reminder>')), false);
  assert.equal(isRealUser(human(1, '<task-notification>x</task-notification>')), false);
  assert.equal(isRealUser({ ...human(1, 'meta'), isMeta: true }), false);
  assert.equal(isRealUser(handBack(1, 'a', 'report')), false);
  assert.equal(isRealUser(notify(1, 'a', 't')), false);
  assert.equal(isRealUser({ type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'typed while busy' } }), true);
  assert.equal(isRealUser(asst(1, 'x')), false);
});

test('findAnchor prefers the hand-back, then the notification, then a synchronous result', () => {
  const launch = [tool(1, 'tu1'), result(2, 'tu1', 'Async agent launched. agentId: ag1')];
  const e = [...launch, asst(3, 'waiting'), handBack(4, 'ag1', 'report text'), notify(5, 'ag1', 'tu1')];
  assert.deepEqual(findAnchor(e, 'ag1'), { index: 3, how: 'hand-back' });
  assert.deepEqual(findAnchor([...launch, notify(5, 'ag1', 'tu1')], 'ag1'), { index: 2, how: 'notification' });
  assert.deepEqual(findAnchor([tool(1, 'tu2'), result(2, 'tu2', 'sync report agentId: ag2')], 'ag2'), { index: 1, how: 'result' });
  assert.equal(findAnchor(launch, 'nope'), null);
});

test('findAnchor falls back to the Agent call closest in time', () => {
  const e = [tool(10, 'far'), result(11, 'far', 'r'), tool(30, 'near'), human(31, 'ignore'), result(32, 'near', 'done')];
  const start = Date.parse(T(31));
  assert.deepEqual(findAnchor(e, 'unknown', { startMs: start }), { index: 4, how: 'time+result' });
  assert.equal(findAnchor(e, 'unknown', { startMs: Date.parse(T(59)), toleranceMs: 5e3 }), null);
  assert.equal(findAnchor(e, 'unknown'), null);
});

test('extractFinalAnswer joins main text up to the next real user message', () => {
  const e = [
    tool(1, 'tu'), handBack(2, 'ag', 'r'),
    asst(3, 'Here is what I found.'), tool(4, 'x', 'Read'), result(5, 'x', 'file'),
    asst(6, 'And the second part.'), { ...asst(7, 'sidechain text'), isSidechain: true },
    human(8, 'next question'), asst(9, 'answer to the next question'),
  ];
  assert.equal(extractFinalAnswer(e, 1), 'Here is what I found.\n\nAnd the second part.');
  assert.equal(extractFinalAnswer([handBack(1, 'ag', 'r'), human(2, 'u'), asst(3, 'late')], 0), '');
  assert.equal(extractFinalAnswer([handBack(1, 'ag', 'r'), asst(2, 'x', { message: { content: [{ type: 'thinking', thinking: 'hm' }] } })], 0), '');
});

test('capFinal keeps head and tail of a long answer', () => {
  assert.equal(capFinal('short', 100), 'short');
  const long = 'a'.repeat(500) + 'MIDDLE' + 'z'.repeat(500);
  const c = capFinal(long, 100);
  assert.match(c, /^a{60}/);
  assert.match(c, /z{40}$/);
  assert.match(c, /\[\.\.\. \d+ characters omitted \.\.\.\]/);
  assert.ok(!c.includes('MIDDLE'));
});

test('buildTurnPrompt carries task, reference, P and F and asks for the JSON keys', () => {
  const p = buildTurnPrompt({ task: 'find X', reference: 'REF-TEXT', delegated: 'P-TEXT', final: 'F-TEXT' });
  for (const s of ['find X', 'REF-TEXT', 'P-TEXT', 'F-TEXT', '"report"', '"missing"', '"final"', '"note"', 'NOT missing']) assert.ok(p.includes(s), s);
  assert.match(buildTurnPrompt({ task: 't', reference: 'r', delegated: 'd', final: ' ' }), /\(empty\)/);
});

test('parseTurnGrade accepts a valid grade, in a claude JSON envelope or bare, and rejects bad ones', () => {
  const g = { report: 'partial', missing: ['the port is 8080'], final: 'passed', note: 'F repeated the gap.' };
  assert.deepEqual(parseTurnGrade(JSON.stringify({ result: JSON.stringify(g) })).grade, g);
  assert.deepEqual(parseTurnGrade('Sure.\n' + JSON.stringify(g)).grade, g);
  const none = parseTurnGrade(JSON.stringify({ report: 'ok', missing: [], final: 'fixed', note: 'n' }));
  assert.equal(none.grade.final, 'not_applicable'); // nothing missing: nothing to fix
  assert.ok(parseTurnGrade(JSON.stringify({ result: 'no json here' })).errors);
  assert.ok(parseTurnGrade(JSON.stringify({ result: 'rate limited', is_error: true })).errors[0].includes('claude reported an error'));
  assert.ok(parseTurnGrade(JSON.stringify({ ...g, report: 'great' })).errors.includes('report invalid'));
  assert.ok(parseTurnGrade(JSON.stringify({ ...g, final: 'maybe' })).errors.includes('final invalid'));
  assert.ok(parseTurnGrade(JSON.stringify({ ...g, missing: 'x' })).errors.includes('missing invalid'));
});

test('summarize counts the report grades and the final fate of cases with missing facts', () => {
  const r = (report, missing, final) => ({ grade: { report, missing, final, note: '' } });
  const s = summarize([r('ok', [], 'not_applicable'), r('partial', ['a'], 'fixed'), r('partial', ['b'], 'passed'), r('fail', ['c'], 'not_applicable'), { errors: ['x'] }]);
  assert.deepEqual(s, { graded: 4, report: { ok: 1, partial: 2, fail: 1 }, withMissing: 3, finalOfMissing: { fixed: 1, passed: 1, not_applicable: 1 } });
});

test('pickMixed round-robins over kinds and respects the limit', () => {
  const c = (id, kind) => ({ id, kind });
  const cands = [c('r1', 'run'), c('r2', 'run'), c('r3', 'run'), c('c1', 'check'), c('p1', 'paste')];
  assert.deepEqual(pickMixed(cands, 4).map((x) => x.id), ['c1', 'p1', 'r1', 'r2']);
  assert.equal(pickMixed(cands, 99).length, 5);
  assert.deepEqual(pickMixed([], 5), []);
});
