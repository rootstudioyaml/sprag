import { expect, test } from 'claude-code/testing'

const USAGE = {
  startedAt: 1_000,
  context: { tokens: 120_000, window: 1_000_000, percent: 12 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 41.5, resetsAt: '2026-10-12T05:00:00.000Z' },
    { kind: 'seven_day', percentUsed: 7 },
  ],
  cost: { usd: 1.25 },
}

// What $.process.run resolves for a finished child
const done = (exitCode: number, stdout: string) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

type Ran = { argv: string[]; stdin?: string; timeoutMs?: number }

/** The engine's side of a session on the given surface, with the statusline's output as `output`. */
function world(on: any, surface: 'desktop' | 'terminal', output: { exitCode: number; stdout: string; deny?: string }, settings = {}) {
  const ran: Ran[] = []
  on('session.surfaces', () => ({ value: [surface] }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.model', () => ({ value: 'claude-opus-4-7' }))
  on('session.usage', () => ({ value: USAGE }))
  on('settings.read', () => ({ value: settings }))
  on('process.run', (_$: unknown, e: { argv: readonly string[]; init?: { stdin?: string; timeoutMs?: number } }) => {
    ran.push({ argv: [...e.argv], stdin: e.init?.stdin, timeoutMs: e.init?.timeoutMs })
    return output.deny ? { deny: output.deny } : done(output.exitCode, output.stdout)
  })
  return { ran, output }
}

// The refresh is not awaited by the turn, so let it run to its end before looking
const completeTurn = async ($: any) => {
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer' })
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0))
}
const props = { hasSurvey: false, isWorking: false, maxRows: 4 }

test('the desktop surface draws the statusline above the prompt', async ($, on) => {
  world(on, 'desktop', { exitCode: 0, stdout: 'Opus | Ctx 12%\n5H 41%\n' })
  on('turn.complete', () => ({ text: '' }))
  await completeTurn($)

  const band = await $.ui.mount({ plugin: 'sprag-statusline', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await band.find({ text: 'Opus | Ctx 12%' })).toBeDefined()
  expect(await band.find({ text: '5H 41%' })).toBeDefined()
})

test('the terminal surface is left to its own statusline', async ($, on) => {
  const w = world(on, 'terminal', { exitCode: 0, stdout: 'Opus | Ctx 12%\n' })
  // What the engine itself draws beneath the plugin, to show the mod passes through
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text>engine band</Text>
      </Box>
    )
  })
  on('turn.complete', () => ({ text: '' }))
  await completeTurn($)
  // Nothing is run for a surface that never draws the band
  expect(w.ran).toEqual([])
  const band = await $.ui.mount({ plugin: 'sprag-statusline', surface: 'terminal', component: 'AbovePrompt', props })
  expect(await band.find({ text: 'Opus | Ctx 12%' })).toBeUndefined()
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('the command gets --no-color, the user own sprag command included', async ($, on) => {
  const own = world(on, 'desktop', { exitCode: 0, stdout: 'x\n' }, { statusLine: { command: 'npx sprag-cli --statusline --single-line' } })
  on('turn.complete', () => ({ text: '' }))
  await completeTurn($)
  expect(own.ran[0].argv).toEqual(['npx', 'sprag-cli', '--statusline', '--single-line', '--no-color'])
  expect(own.ran[0].timeoutMs).toBe(3000)
})

test('another tool statusLine command is not run; sprag is', async ($, on) => {
  const other = world(on, 'desktop', { exitCode: 0, stdout: 'x\n' }, { statusLine: { command: '~/bin/my-line --fancy' } })
  on('turn.complete', () => ({ text: '' }))
  await completeTurn($)
  expect(other.ran[0].argv).toEqual(['sprag', '--statusline', '--no-color'])
})

test('a failing run keeps the text drawn before it, without throwing', async ($, on) => {
  const w = world(on, 'desktop', { exitCode: 0, stdout: 'Opus | Ctx 12%\n' })
  on('turn.complete', () => ({ text: '' }))
  await completeTurn($)

  w.output.exitCode = 1
  w.output.stdout = ''
  await completeTurn($)
  w.output.deny = 'refused'
  await completeTurn($)

  const band = await $.ui.mount({ plugin: 'sprag-statusline', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await band.find({ text: 'Opus | Ctx 12%' })).toBeDefined()
})

test('stray ANSI escapes and blank lines are dropped', async ($, on) => {
  world(on, 'desktop', { exitCode: 0, stdout: '\u001b[31mOpus\u001b[0m | Ctx\n\n   \n5H 41%\n' })
  on('turn.complete', () => ({ text: '' }))
  await completeTurn($)

  const band = await $.ui.mount({ plugin: 'sprag-statusline', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await band.find({ text: 'Opus | Ctx' })).toBeDefined()
  expect(await band.findAll({ type: 'Text' })).toHaveLength(2)
})

test('session.usage figures reach the statusline as its stdin keys', async ($, on) => {
  const w = world(on, 'desktop', { exitCode: 0, stdout: 'x\n' })
  on('turn.complete', () => ({ text: '' }))
  await completeTurn($)

  expect(JSON.parse(w.ran[0].stdin ?? '{}')).toEqual({
    session_id: 's1',
    cwd: '/work/app',
    workspace: { current_dir: '/work/app', project_dir: '/work/app' },
    model: { id: 'claude-opus-4-7', display_name: 'claude-opus-4-7' },
    context_window: { context_window_size: 1_000_000, used_percentage: 12 },
    rate_limits: {
      five_hour: { used_percentage: 41.5, resets_at: 1_791_781_200 },
      seven_day: { used_percentage: 7 },
    },
    cost: { total_cost_usd: 1.25 },
  })
})

