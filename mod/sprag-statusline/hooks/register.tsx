import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

/**
 * sprag-statusline: sprag's statusline in the Claude desktop app.
 *
 * The desktop app's Code tab runs claude in stream-json mode, which never runs
 * settings.json's statusLine.command. Hooks and mods do run there, so this mod
 * runs the same sprag command itself and draws its text in the band above the
 * prompt. Running the real CLI also leaves what a statusline render leaves: the
 * rate-limit snapshot and the context window size that the delegation briefing
 * reads back.
 *
 * The terminal has its own statusline, so the band is drawn on the desktop
 * surface only. Nothing here may slow or break a session: a run is skipped
 * while another is in flight, cut off after a few seconds, and a failure keeps
 * the last text on screen.
 */

const lines = atom({ plugin: 'sprag-statusline', key: 'lines' } as const, [] as string[])

const REFRESH_MS = 5000
const RUN_TIMEOUT_MS = 3000
const DEFAULT_ARGV = ['sprag', '--statusline', '--no-color']

// The executable names src/installer.js's argsAfterOurExecutable accepts
const OUR_EXECUTABLES = ['sprag', 'claude-token-saver', 'sprag-cli']
const RUNNERS = /^(npx|bunx|pnpx)$/
const RUNNER_SUBCOMMANDS: Record<string, string[]> = {
  pnpm: ['dlx', 'exec'],
  yarn: ['dlx', 'run'],
  bun: ['x', 'run'],
  npm: ['exec'],
}

/** Whether a statusLine command starts with sprag's executable, as the installer judges it. */
function isOurCommand(tokens: string[]): boolean {
  let i = 0
  if (RUNNERS.test(tokens[0] ?? '')) i = 1
  else if (RUNNER_SUBCOMMANDS[tokens[0] ?? '']?.includes(tokens[1] ?? '')) i = 2
  const token = tokens[i]
  if (!token) return false
  const exe = (token.split(/[/\\]/).pop() ?? '').replace(/\.(cmd|exe|ps1)$/i, '')
  return OUR_EXECUTABLES.includes(exe)
}

/**
 * The command to run: the user's own sprag statusLine command with --no-color
 * added, or the default one. This module has no shell, so the command is split
 * on whitespace, the same way the installer reads it; a command with quoting
 * falls back to the default rather than being run in pieces.
 */
export function statuslineArgv(settings: Readonly<Record<string, unknown>>): string[] {
  const statusLine = settings.statusLine as { command?: unknown } | undefined
  const command = typeof statusLine?.command === 'string' ? statusLine.command.trim() : ''
  if (!command || /["'`$;|&<>\\]/.test(command)) return DEFAULT_ARGV
  const tokens = command.split(/\s+/)
  if (!isOurCommand(tokens)) return DEFAULT_ARGV
  return tokens.includes('--no-color') ? tokens : [...tokens, '--no-color']
}

/**
 * The JSON Claude Code's statusline would have been fed. Fields the engine has
 * no value for are left out, never zeroed: sprag reads an absent rate_limits as
 * "no data" but a 0 as "0% used". transcript_path is left out because the mod
 * cannot know it, and sprag takes it only for the effort chip.
 */
export function statuslinePayload(input: {
  sessionId: string
  cwd: string
  model: string
  usage: SessionUsage
}) {
  const { usage } = input
  const payload: Record<string, unknown> = {
    session_id: input.sessionId,
    cwd: input.cwd,
    workspace: { current_dir: input.cwd, project_dir: input.cwd },
    model: { id: input.model, display_name: input.model },
  }
  if (usage.context.percent !== undefined) {
    payload.context_window = {
      context_window_size: usage.context.window,
      used_percentage: usage.context.percent,
    }
  }
  if (usage.rateLimits.length) {
    const limits: Record<string, { used_percentage: number; resets_at?: number }> = {}
    for (const limit of usage.rateLimits) {
      const at = limit.resetsAt ? Math.floor(Date.parse(limit.resetsAt) / 1000) : NaN
      limits[limit.kind] = {
        used_percentage: limit.percentUsed,
        ...(Number.isFinite(at) ? { resets_at: at } : {}),
      }
    }
    payload.rate_limits = limits
  }
  if (usage.cost) payload.cost = { total_cost_usd: usage.cost.usd }
  return payload
}

/**
 * The argv with `--columns <n>` added, so sprag fits its chips to the band and
 * wraps them at chip boundaries instead of the band wrapping them mid-chip. A
 * command that already names its width, or an unknown width, is left as it is.
 */
export function withColumns(argv: string[], columns: number | undefined): string[] {
  if (!columns || !Number.isFinite(columns) || columns < 20) return argv
  if (argv.includes('--columns')) return argv
  return [...argv, '--columns', String(Math.floor(columns))]
}

// First engine whose Box takes overflowX="scroll" and whose Text takes
// wrap="clip". Older engines check a tree's props by name and value and skip a
// hook whose tree has one they do not know, so the band would vanish there.
export const CLIP_MIN_VERSION = '2.1.326'

/** Whether a release version (`2.1.326`, `2.1.330-dev`) is at least `min`. */
export function atLeast(version: string | undefined, min: string): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number)
  const a = version ? parse(version) : undefined
  const b = parse(min)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

/** Output with stray ANSI escapes removed and blank lines dropped. */
export function cleanOutput(text: string): string[] {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '')
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
}

let isRunning = false
let timer: { cancel: () => void } | undefined
// The band's width as the last draw saw it; the next run fits the text to it
let bandColumns: number | undefined
// Whether this engine takes the clip props; read once, after a reload again
let canClip: Promise<boolean> | undefined

/** Whether the engine is CLIP_MIN_VERSION or later. An engine that cannot say counts as older. */
function engineCanClip($: EngineInterface): Promise<boolean> {
  canClip ??= $.session
    .version()
    .then(v => atLeast(v.base ?? v.version, CLIP_MIN_VERSION))
    .catch(() => false)
  return canClip
}

/** Runs the statusline once and stores its text; any failure leaves the last text as it was. */
async function refresh($: EngineInterface): Promise<void> {
  if (isRunning) return
  isRunning = true
  try {
    if (!(await $.session.surfaces()).includes('desktop')) return
    const [sessionId, cwd, model, usage, settings] = await Promise.all([
      $.session.id(),
      $.session.cwd(),
      $.session.model(),
      $.session.usage(),
      $.settings.read(),
    ])
    const run = await $.process.run(withColumns(statuslineArgv(settings), bandColumns), {
      stdin: JSON.stringify(statuslinePayload({ sessionId, cwd, model, usage })),
      timeoutMs: RUN_TIMEOUT_MS,
    })
    if (run.exitCode !== 0) return
    const next = cleanOutput(run.stdout)
    if (!next.length) return
    // An unchanged text is not written, so the band is not redrawn every tick
    const same = JSON.stringify(await read($, lines)) === JSON.stringify(next)
    if (!same) await update($, lines, () => next)
  } catch {
    // The statusline is a convenience; a refused or timed-out run is not worth an error
  } finally {
    isRunning = false
  }
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    timer?.cancel()
    timer = $.clock.every(REFRESH_MS, () => void refresh($))
    void refresh($)
    return next(e)
  })

  // Not awaited: a slow statusline must never hold a turn open
  on('turn.complete', ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    // A new width refits the text now rather than at the next tick
    const columns = e.props.bodyColumns
    if (typeof columns === 'number' && columns !== bandColumns) {
      bandColumns = columns
      void refresh($)
    }
    const shown = (await read($, lines)).slice(0, Math.max(0, e.props.maxRows))
    if (!shown.length) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    // On an engine that has them, a line wider than the band stays on its row
    // and scrolls sideways instead of wrapping in the middle of a chip. They go
    // in as spreads so the module still type-checks against older engine types.
    const clip = await engineCanClip($)
    const boxProps = clip ? { overflowX: 'scroll' as const } : {}
    const textProps = clip ? { wrap: 'clip' as const } : {}
    // One statusline line per row; a Box lays its children out in a row unless told otherwise
    return (
      <Box flexDirection="column" {...boxProps}>
        {shown.map((line, i) => (
          <Text key={`line-${i}`} dimColor {...textProps}>
            {line}
          </Text>
        ))}
      </Box>
    )
  })
}
