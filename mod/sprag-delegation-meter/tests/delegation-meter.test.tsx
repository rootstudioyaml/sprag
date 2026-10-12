import { expect, mock, test } from 'claude-code/testing'

// One request's usage as the API reports it
const STEP = {
  input_tokens: 1200,
  output_tokens: 300,
  cache_read_input_tokens: 40_000,
  cache_creation_input_tokens: 5_000,
  model: 'claude-haiku-4-5',
}

type Saved = Map<string, Record<string, unknown>>
test('a delegated run is measured from its own requests', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  on('session.id', () => ({ value: 's1' }))
  const logs: string[] = []
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  const saved: Saved = new Map()
  on('store.set', ($, e) => {
    saved.set(e.key, e.value as Record<string, unknown>)
    return { value: undefined }
  })
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: STEP }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ prompt: 'list the files under src', description: 'list files', model: 'haiku' })
  for (const index of [0, 1]) {
    const stream = $.turn.step({ turnId: 't1', index, model: 'claude-haiku-4-5', messageCount: 1, agentId: 'a1' })
    let step = await stream.next()
    while (step.done !== true) step = await stream.next()
  }
  await clock.advance(12_300)
  await $.turn.complete({
    turnId: 't1', answer: 'done', durationMs: 12_300, isAborted: false, reason: 'answer', agentId: 'a1',
  })

  expect(saved.get('run:s1:a1')).toMatchObject({
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
  expect(logs[0]).toMatch(/^🔀 \[sprag\] "list files" → haiku 위임/)
  expect(logs[1]).toBe(
    '🔀 [sprag] haiku 위임 완료 · 12.3초 · 요청 2회 · 입력 2.4k · 캐시 읽기 80.0k · 캐시 쓰기 10.0k · 출력 600',
  )
})

test('a turn with no step seen falls back to the turn total', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  const saved: Saved = new Map()
  on('store.set', ($, e) => {
    saved.set(e.key, e.value as Record<string, unknown>)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))

  // The module reloaded mid-run: no spawn and no step reached it
  await $.turn.complete({
    turnId: 't1', answer: '', durationMs: 500, isAborted: true, reason: 'aborted', agentId: 'a2', usage: STEP,
  })

  expect(saved.get('run:s1:a2')).toMatchObject({
    model: null,
    answeredBy: 'claude-haiku-4-5',
    steps: 0,
    lastReason: 'aborted',
    usage: { input: 1_200, output: 300, cacheRead: 40_000, cacheWrite: 5_000 },
  })
})

test('the main loop is not recorded', async ($, on) => {
  mock.clock(on)
  let wrote = false
  on('store.set', () => {
    wrote = true
    return { value: undefined }
  })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage: STEP }
  })
  on('turn.complete', () => ({ text: '' }))

  const stream = $.turn.step({ turnId: 'm1', index: 0, model: 'claude-opus-5', messageCount: 1 })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  await $.turn.complete({ turnId: 'm1', answer: 'hi', durationMs: 900, isAborted: false, reason: 'answer' })

  expect(wrote).toBe(false)
})
