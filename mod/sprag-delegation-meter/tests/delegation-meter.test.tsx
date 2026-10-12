import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

// One request's usage as the API reports it
const STEP = {
  input_tokens: 1200,
  output_tokens: 300,
  cache_read_input_tokens: 40_000,
  cache_creation_input_tokens: 5_000,
  model: 'claude-haiku-4-5',
}

/**
 * Stubs everything the mod calls and every event it passes on. Returns what
 * it logged and saved; `session` is what $.session.id() answers, and a test
 * may change it between runs. Spawns are answered with `agentIds` in order.
 */
function engine(on: any, agentIds: string[] = []) {
  const seen = { session: 's1', logs: [] as string[], saved: new Map<string, Record<string, unknown>>() }
  on('session.id', () => ({ value: seen.session }))
  on('ui.log', ($: unknown, e: { text: string }) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('store.get', ($: unknown, e: { key: string }) => ({ value: seen.saved.get(e.key) }))
  on('store.set', ($: unknown, e: { key: string; value: unknown }) => {
    seen.saved.set(e.key, e.value as Record<string, unknown>)
    return { value: undefined }
  })
  const queue = [...agentIds]
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: queue.shift() }))
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: STEP }
  })
  on('turn.complete', () => ({ text: '' }))
  return seen
}

/** One request of a loop, read to its end as the engine would. */
async function step($: Engine, turnId: string, index: number, agentId?: string) {
  const stream = $.turn.step({ turnId, index, model: 'claude-haiku-4-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
  let next = await stream.next()
  while (next.done !== true) next = await stream.next()
}

const done = (turnId: string, agentId: string, durationMs: number) => ({
  turnId, answer: 'done', durationMs, isAborted: false, reason: 'answer' as const, agentId,
})

test('a delegated run is measured from its own requests', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const seen = engine(on, ['a1'])

  await $.agent.spawn({ prompt: 'list the files under src', description: 'list files', model: 'haiku' })
  await step($, 't1', 0, 'a1')
  await step($, 't1', 1, 'a1')
  await clock.advance(12_300)
  await $.turn.complete(done('t1', 'a1', 12_300))

  expect(seen.saved.get('run:s1:a1')).toMatchObject({
    agentId: 'a1',
    requestedModel: 'haiku',
    model: 'claude-haiku-4-5',
    steps: 2,
    turns: 1,
    durationMs: 12_300,
    startedAt: 1_000,
    endedAt: 13_300,
    usage: { input: 2_400, output: 600, cacheRead: 80_000, cacheWrite: 10_000 },
  })
  expect(seen.logs[0]).toMatch(/^🔀 \[sprag\] "list files" → haiku 위임/)
  expect(seen.logs[1]).toBe(
    '🔀 [sprag] haiku 위임 완료 · 12.3초 · 요청 2회 · 입력 2.4k · 캐시 읽기 80.0k · 캐시 쓰기 10.0k · 출력 600',
  )
})

test('a resumed subagent adds its next turn to the saved run', async ($, on) => {
  mock.clock(on)
  const seen = engine(on, ['a1'])

  await $.agent.spawn({ prompt: 'list the files under src', description: 'list files', model: 'haiku' })
  await step($, 't1', 0, 'a1')
  await $.turn.complete(done('t1', 'a1', 1_000))
  // SendMessage resumes the same loop: no spawn, a new turn with the same agent id
  await step($, 't2', 0, 'a1')
  await $.turn.complete(done('t2', 'a1', 2_000))

  expect(seen.saved.get('run:s1:a1')).toMatchObject({
    description: 'list files',
    model: 'claude-haiku-4-5',
    steps: 2,
    turns: 2,
    durationMs: 3_000,
    usage: { input: 2_400, output: 600, cacheRead: 80_000, cacheWrite: 10_000 },
  })
})

test('the session id is read per run, so /clear does not file runs under the old one', async ($, on) => {
  mock.clock(on)
  const seen = engine(on, ['a1', 'a2'])

  await $.agent.spawn({ prompt: 'first', description: 'first', model: 'haiku' })
  await step($, 't1', 0, 'a1')
  await $.turn.complete(done('t1', 'a1', 1_000))
  // /clear moves the conversation to another session id; the module stays loaded
  seen.session = 's2'
  await $.agent.spawn({ prompt: 'second', description: 'second', model: 'haiku' })
  await step($, 't2', 0, 'a2')
  await $.turn.complete(done('t2', 'a2', 1_000))

  expect([...seen.saved.keys()].sort()).toEqual(['run:s1:a1', 'run:s2:a2'])
})

test('a turn with no step seen falls back to the turn total', async ($, on) => {
  mock.clock(on)
  const seen = engine(on)

  // The module reloaded mid-run: no spawn and no step reached it
  await $.turn.complete({
    turnId: 't1', answer: '', durationMs: 500, isAborted: true, reason: 'aborted', agentId: 'a2', usage: STEP,
  })

  expect(seen.saved.get('run:s1:a2')).toMatchObject({
    model: null,
    answeredBy: 'claude-haiku-4-5',
    steps: 0,
    lastReason: 'aborted',
    usage: { input: 1_200, output: 300, cacheRead: 40_000, cacheWrite: 5_000 },
  })
})

test('the main loop is not recorded', async ($, on) => {
  mock.clock(on)
  const seen = engine(on)

  await step($, 'm1', 0)
  await $.turn.complete({ turnId: 'm1', answer: 'hi', durationMs: 900, isAborted: false, reason: 'answer' })

  expect(seen.saved.size).toBe(0)
  expect(seen.logs).toEqual([])
})
