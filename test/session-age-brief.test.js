/**
 * A session open for more than a day gets one briefing per whole day of age: it names the age and
 * the start time, asks the model to write a handoff with `sprag handoff`, and to give the user the
 * sentence to type in a new session. The start comes from the transcript's first timestamp, so a
 * resumed session counts from its first request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DAY = 24 * 60 * 60 * 1000;

async function withXdg(dir, fn) {
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev; }
}

function transcript(dir, startIso) {
  const tx = join(dir, 't.jsonl');
  writeFileSync(tx, [
    JSON.stringify({ type: 'summary', leafUuid: 'x' }),
    JSON.stringify({ type: 'user', timestamp: startIso, message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2030-01-01T00:00:00.000Z', message: { usage: { input_tokens: 1000 } } }),
  ].join('\n') + '\n');
  return tx;
}

test('sessionStartedAt reads the first timestamp in the transcript', async () => {
  const { sessionStartedAt } = await import('../src/brief.js');
  const dir = mkdtempSync(join(tmpdir(), 'sprag-age-'));
  assert.equal(sessionStartedAt(transcript(dir, '2026-11-01T03:00:00.000Z')), Date.parse('2026-11-01T03:00:00.000Z'));
  assert.equal(sessionStartedAt(join(dir, 'missing.jsonl')), null);
});

test('no age briefing in the first day, then one per whole day', async () => {
  const { runBrief, briefStatePath } = await import('../src/brief.js');
  const dir = mkdtempSync(join(tmpdir(), 'sprag-age-'));
  const start = Date.parse('2026-11-01T03:00:00.000Z');
  const tx = transcript(dir, new Date(start).toISOString());
  await withXdg(dir, async () => {
    const quiet = await runBrief({ sessionId: 'sess-age', transcriptPath: tx, now: start + 23 * 60 * 60 * 1000 });
    assert.doesNotMatch(quiet || '', /세션을 시작한 지/);

    const one = await runBrief({ sessionId: 'sess-age', transcriptPath: tx, now: start + DAY + 60_000 });
    assert.match(one || '', /이 세션을 시작한 지 1일이 넘었습니다/);
    assert.match(one, /sprag handoff/);
    assert.match(one, /핸드오프 이어서 해줘/);
    assert.equal(JSON.parse(readFileSync(briefStatePath(), 'utf8')).sessions['sess-age'].startedAt, start);

    const same = await runBrief({ sessionId: 'sess-age', transcriptPath: tx, now: start + DAY + 3_600_000 });
    assert.doesNotMatch(same || '', /세션을 시작한 지/, 'once per day count');

    const three = await runBrief({ sessionId: 'sess-age', transcriptPath: tx, now: start + 3 * DAY + 60_000 });
    assert.match(three || '', /3일이 넘었습니다/);
  });
});

test('the age message passes the Korean style lint', async () => {
  const { sessionAgeMessage } = await import('../src/brief.js');
  const { default: lint } = await import('../src/korean-lint.cjs');
  const issues = lint.lintKoreanText(sessionAgeMessage(2, Date.parse('2026-11-01T03:00:00.000Z')));
  assert.deepEqual(issues, []);
});
