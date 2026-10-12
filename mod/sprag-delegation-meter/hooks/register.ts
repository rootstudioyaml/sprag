import type { EngineInterface, Register, TurnUsage } from 'claude-code'

/**
 * sprag-delegation-meter: what each delegated subagent actually spent.
 *
 * sprag's delegation ledger prices a run after the fact, from the transcript
 * it left. This mod reads the same numbers while the run happens, from the
 * API's own usage: agent.spawn says which model the subagent got and what its
 * parent runs on, every turn.step of the subagent's loop reports one
 * request's tokens, and turn.complete closes a turn of that loop.
 *
 * Each run is kept in $.store under a key of its own, `run:<session>:<agent>`,
 * so two sessions never overwrite each other's runs. The mod only observes: no
 * spawn, request or turn is changed, and sprag's transcript-based ledger keeps
 * running beside it.
 */

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

type Run = {
  sessionId: string
  agentId: string
  description: string
  subagentType: string
  /** The Agent tool's `model` parameter as given; null when the call named none. */
  requestedModel: string | null
  /** What the spawn resolved; null when this module never saw the spawn. */
  model: string | null
  parentModel: string | null
  /** The model the API last reported answering, by its own id. */
  answeredBy: string | null
  startedAt: number
  endedAt: number | null
  durationMs: number
  steps: number
  turns: number
  usage: Usage
  lastReason: string | null
}

// Families as sprag's modelFamily() names them: versions are noise in a log line.
const FAMILIES = ['fable', 'mythos', 'opus', 'sonnet', 'haiku']

const family = (model: string) => FAMILIES.find(f => model.toLowerCase().includes(f)) ?? model

const zero = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

const fromApi = (u: TurnUsage): Usage => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
})

const add = (into: Usage, more: Usage) => {
  into.input += more.input
  into.output += more.output
  into.cacheRead += more.cacheRead
  into.cacheWrite += more.cacheWrite
}

const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

const OUTCOME: Record<string, string> = { answer: '완료', aborted: '중단', refusal: '거절', error: '실패' }

// Runs in flight by agent id, and per run the requests of the turn still open.
// A run leaves the map once its turn is saved, so the map holds only what is
// running and does not grow with the session. $.store has the run from then
// on: a subagent resumed later (SendMessage starts another turn of the same
// loop) or met again after a module reload continues from its saved totals.
const runs = new Map<string, Run>()
const openTurn = new Map<string, { usage: Usage; steps: number }>()

const storeKey = (sessionId: string, agentId: string) => `run:${sessionId}:${agentId}`

const isRun = (value: unknown, agentId: string): value is Run =>
  typeof value === 'object' && value !== null
  && (value as Run).agentId === agentId
  && typeof (value as Run).usage === 'object' && (value as Run).usage !== null

/**
 * The run for an agent id: the one in flight, else the saved one, else a new
 * one. A subagent's first request can arrive before the spawn hook resumes
 * after `await next(e)`, so a step may be what creates the run.
 *
 * The session id is read per run and never cached in the module: the module
 * outlives /clear, /resume and /branch, each of which moves the conversation
 * to another session id without loading the module again.
 */
async function runFor($: EngineInterface, agentId: string): Promise<Run> {
  const held = runs.get(agentId)
  if (held) return held
  const sessionId = await $.session.id()
  let saved: unknown
  try {
    saved = await $.store.get(storeKey(sessionId, agentId))
  } catch {
    // An unreadable store costs this run only its earlier turns.
  }
  // A copy, since the totals are added to in place.
  const run: Run = isRun(saved, agentId) ? JSON.parse(JSON.stringify(saved)) : {
    sessionId,
    agentId,
    description: '',
    subagentType: '',
    requestedModel: null,
    model: null,
    parentModel: null,
    answeredBy: null,
    startedAt: await $.clock.now(),
    endedAt: null,
    durationMs: 0,
    steps: 0,
    turns: 0,
    usage: zero(),
    lastReason: null,
  }
  runs.set(agentId, run)
  return run
}

export const register: Register = on => {
  // A meter must never stop what it measures, so every hook here fails open:
  // a hook that breaks before its next() is skipped and the event goes on, and
  // one that breaks after it keeps the result next() settled to. That is the
  // engine's default already; each .catch states it, and answers the same way
  // when the hook is reached from beneath its own $ call (a re-entry).
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny !== undefined || !spawned.agentId) return spawned
    const run = await runFor($, spawned.agentId)
    run.description = e.description
    run.subagentType = e.subagentType
    run.requestedModel = e.model ?? null
    run.model = spawned.model
    run.parentModel = e.parentModel || null
    // A workflow can start dozens of agents; one line each would bury the transcript.
    if (!e.workflow) {
      const parent = run.parentModel ? ` (메인 ${family(run.parentModel)})` : ''
      $.ui.log(`🔀 [sprag] "${e.description}" → ${family(spawned.model)} 위임${parent}`)
    }
    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId && result.usage) {
      const run = await runFor($, e.agentId)
      const turn = openTurn.get(e.agentId) ?? { usage: zero(), steps: 0 }
      add(turn.usage, fromApi(result.usage))
      turn.steps += 1
      openTurn.set(e.agentId, turn)
      run.answeredBy = result.usage.model
    }
    return result
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) return next(e)
    const run = await runFor($, e.agentId)
    const turn = openTurn.get(e.agentId)
    openTurn.delete(e.agentId)
    // The steps' own counts are the measurement. The turn's sum stands in only
    // when no step was seen, e.g. the module reloaded during the turn.
    if (turn && turn.steps > 0) {
      add(run.usage, turn.usage)
      run.steps += turn.steps
    } else if (e.usage) {
      add(run.usage, fromApi(e.usage))
      run.answeredBy = e.usage.model
    }
    run.turns += 1
    run.durationMs += e.durationMs
    run.endedAt = await $.clock.now()
    run.lastReason = e.reason

    try {
      await $.store.set(storeKey(run.sessionId, run.agentId), run)
      runs.delete(e.agentId)
    } catch {
      // A store that refuses the write leaves only this run unrecorded. It
      // stays in the map, so its next turn still adds to these totals.
    }

    const model = family(run.model ?? run.answeredBy ?? 'unknown')
    const u = run.usage
    $.ui.log(
      `🔀 [sprag] ${model} 위임 ${OUTCOME[e.reason] ?? e.reason} · ${(run.durationMs / 1000).toFixed(1)}초`
        + ` · 요청 ${run.steps}회 · 입력 ${tokens(u.input)} · 캐시 읽기 ${tokens(u.cacheRead)}`
        + ` · 캐시 쓰기 ${tokens(u.cacheWrite)} · 출력 ${tokens(u.output)}`,
    )
    return next(e)
  }).catch(($, e, next) => next(e))
}
