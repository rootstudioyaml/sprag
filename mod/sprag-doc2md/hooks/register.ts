import type { EngineInterface, Register } from 'claude-code'

/**
 * sprag-doc2md: the mod form of sprag's PreToolUse(Read) hook.
 *
 * The settings hook can only refuse the Read and tell Claude where the
 * converted Markdown is, which costs one more tool call per document. A mod
 * sits in front of the call, so it hands the same call on with the path
 * swapped: Claude asked for deck.pptx and reads deck.md, and the permission
 * check still runs on the path that is actually read.
 *
 * Whenever this mod does not redirect (not a document, conversion refused or
 * failed, sprag not on PATH) the call goes on untouched, and sprag's settings
 * hook beneath it explains the refusal exactly as it does today. After a
 * redirect that hook sees a .md path and stays silent, so the two never
 * answer the same Read twice.
 *
 * The exception is an encrypted document (password or DRM). Claude Code
 * refuses a pptx, xlsx or docx as a binary file before any settings hook runs,
 * so the settings hook can never tell the model why such a file cannot be
 * read; this mod is the only place that can, so it refuses the Read itself
 * with the CLI's notice.
 */

// Mirrors TARGET_EXTENSIONS in src/doc2md.cjs. A hooks module has no Node, so
// it cannot load that file; test/mod-install.test.js holds the two in step.
const TARGET = /\.(pptx|xlsx|xls|pdf|docx|fig)$/i

// The CLI's name, as CLI_NAME in src/cli-name.js spells it. The mod cannot
// import that file either; test/mod-install.test.js holds the two in step.
const CLI = 'sprag'

// The converter gives up at 120 s on its own; the margin covers CLI start-up.
// Time spent in $.process.run does not count against the hook's 10 s budget,
// so the Read waits as long as the conversion does, as it does under the
// settings hook today. The status line says so while it lasts.
const CONVERT_TIMEOUT_MS = 150_000

// What `sprag doc2md <path>` prints on success. Parsing human output is a
// prototype shortcut: a `--json` flag on that command should replace it.
const CONVERTED = /^✓ (cached|converted): (.+)$/m

// What `sprag doc2md <path>` prints on stderr for an encrypted document: the
// reason line, then one indented line holding the notice for the model. A CLI
// that predates the notice line prints the reason line alone.
const LOCKED = /^✗ (encrypted|drm-protected)\b.*$/m

type Converted = { cacheFile: string; isCached: boolean }
type Locked = { locked: string }

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/**
 * Runs the conversion the settings hook would run, ledger entry included.
 * Answers null on any failure so the caller passes the event on unchanged,
 * and `{ locked }` with the CLI's notice when the document is encrypted.
 *
 * A first conversion can take a minute, and nothing else on screen says the
 * Read is waiting on it, so the status line under the prompt names the file
 * until the CLI returns. A status line rather than a transcript line: whether
 * the file is cached is unknown until the CLI answers, and a log line on every
 * Read would double the lines for the cached ones too.
 */
async function convert($: EngineInterface, path: string): Promise<Converted | Locked | null> {
  $.ui.status(`doc2md: ${baseName(path)} 변환 중…`)
  try {
    const run = await $.process.run([CLI, 'doc2md', path], { timeoutMs: CONVERT_TIMEOUT_MS })
    if (run.exitCode !== 0) {
      const reason = LOCKED.exec(run.stderr)
      if (!reason) return null
      const rest = run.stderr.slice(reason.index + reason[0].length)
      const notice = rest.split('\n').map(line => line.trim()).find(line => line !== '')
      return notice ? { locked: notice } : null
    }
    const match = CONVERTED.exec(run.stdout)
    if (!match) return null
    return { cacheFile: match[2].trim(), isCached: match[1] === 'cached' }
  } catch {
    return null
  } finally {
    $.ui.status(undefined)
  }
}

const isLocked = (doc: Converted | Locked): doc is Locked => 'locked' in doc

function logRedirect($: EngineInterface, from: string, doc: Converted) {
  $.ui.log(`doc2md: ${baseName(from)} 대신 변환본을 읽습니다${doc.isCached ? ' (캐시)' : ''}`)
}

export const register: Register = on => {
  // Both hooks fail open, which is the point of the .catch on each: a hook that
  // breaks hands the event on as it came and sprag's settings hook beneath
  // answers as before. Only the encrypted-document refusal in the Read hook guards
  // anything, and failing open there costs the notice, not safety.
  // Where the hook had already called next, next(e) replays that call.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (!TARGET.test(e.file_path)) return next(e)
    const doc = await convert($, e.file_path)
    if (!doc) return next(e)
    // Refuse rather than pass the original on: it cannot be opened, and the
    // binary-file refusal it would meet says nothing of why.
    if (isLocked(doc)) return { deny: `[doc2md] ${doc.locked}` }
    logRedirect($, e.file_path, doc)
    // Line and page ranges addressed the binary and mean nothing in the
    // Markdown (`pages` applies to PDFs only), so the whole file is read.
    const { offset: _offset, limit: _limit, pages: _pages, ...call } = e
    return next({ ...call, file_path: doc.cacheFile })
  }).catch(($, e, next) => next(e))

  // An @-mentioned document is attached whole, before any tool call, so the
  // Read hook above never sees it. Redirect the attachment the same way.
  on('prompt.mention', { path: TARGET }, async ($, e, next) => {
    const doc = await convert($, e.path)
    // A deny here would only reach the debug log, not the model, so an
    // encrypted mention goes on as it came; the prompt hook names it instead.
    if (!doc || isLocked(doc)) return next(e)
    logRedirect($, e.path, doc)
    // A mention carries no `pages` (PromptMentionInput has mention, path,
    // offset, limit and agentId), so only the line range is dropped here.
    const { offset: _offset, limit: _limit, ...mention } = e
    return next({ ...mention, path: doc.cacheFile })
  }).catch(($, e, next) => next(e))
}
