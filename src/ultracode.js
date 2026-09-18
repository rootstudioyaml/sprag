/**
 * Ultracode detection — the one effort level Claude Code does not put in the
 * statusline payload.
 *
 * `/effort ultracode` is "xhigh + dynamic workflow orchestration, this session
 * only". Claude Code stores it as two things: the effort level, which it raises
 * to `xhigh`, and a session flag for the orchestration half. Only the level
 * reaches the statusline contract (2.1.276 builds the payload as
 * `...modelHasEffort(model) && { effort: { level: resolved } }`, where `resolved`
 * is validated against the level list and so can never read "ultracode"), so a
 * session on ultracode and a session on plain xhigh arrive here identical.
 *
 * What does distinguish them is in the transcript. Claude Code injects a
 * system-reminder when ultracode turns on and another when it turns off, and
 * both are recorded as attachment entries:
 *
 *   {"type":"attachment","attachment":{"type":"ultra_effort_enter","reminderType":"full"}}
 *   {"type":"attachment","attachment":{"type":"ultra_effort_exit"}}
 *
 * The `enter` attachment repeats while ultracode stays on — once on the turn it
 * is switched on ("full"), then every tenth user turn as a reminder ("sparse",
 * TURNS_BETWEEN_MAINTENANCE = 10) — so the most recent of the two markers is
 * the current state, and an active session keeps refreshing it near the tail.
 *
 * A marker is only written when the NEXT turn is assembled, though, so on its own
 * it leaves the chip a turn behind: you run `/effort ultracode`, nothing has been
 * recorded yet, and the chip still says xhigh until you send something. The
 * command's own output closes that gap, because Claude Code writes it to the
 * transcript the moment the command returns:
 *
 *   {"type":"user","message":{"content":"<local-command-stdout>Set effort level to
 *    ultracode (this session only): xhigh + dynamic workflow orchestration</local-command-stdout>"}}
 *
 * measured 7s, 34s and 72s ahead of the matching attachment in one session. Both
 * directions are legible there: the ultracode row is the only one that names the
 * level, and every other `/effort <level>` clears the flag as it sets the level
 * (`effortUpdate:{value:e,ultracode:!1}`), so those rows mean "off". The bare
 * query prints `Current effort level: …`, which reads the same way.
 *
 * Hence the read below: walk backwards from the end of the transcript and take
 * whichever of the two signals comes last. The scan is capped (see SCAN_BYTES)
 * because the statusline re-renders every few seconds and most sessions carry
 * neither signal — an uncapped backwards scan would read the whole transcript,
 * every render, to answer "no". The cap makes the failure one-directional: past
 * it we report "not ultracode", which is what the chip showed before this
 * existed.
 */

import { openSync, readSync, closeSync, statSync } from 'node:fs';

/**
 * How far back to look for a marker. Measured against real transcripts: the
 * gap between two consecutive markers of an ultracode session ran to 2.2MB
 * (ten heavy turns), and the tail after the last one to 0.9MB. 4MB clears both
 * with room, and costs a single bounded read of a file the renderer's own
 * session parse has already pulled into the page cache.
 */
const SCAN_BYTES = 4 * 1024 * 1024;
/**
 * Substrings worth parsing a line for. The first is the attachment; the other
 * two are the shapes `/effort` prints. Cheap prefilters only — every hit is
 * parsed and checked before it counts.
 */
const MARKERS = ['ultra_effort_', 'Set effort level to', 'Current effort level:'];
const NEWLINE = 0x0a;
/** The levels Claude Code accepts; any of them being SET means ultracode is off. */
const PLAIN_LEVELS = /Set effort level to (?:low|medium|high|xhigh|max)\b/;
/** The bare query's answer, which names ultracode when it is on. */
const QUERY_LEVEL = /Current effort level: (\w+)/;

/**
 * The state one transcript line carries, or null when it carries none.
 *
 * The line has to be parsed, not just matched: a transcript records tool output
 * too, so a session that greps for these very strings (this feature was built
 * in one) has lines that contain `ultra_effort_enter` as quoted text. Only an
 * attachment entry of that type is a marker.
 *
 * Sidechain entries are skipped. A subagent runs its own effort resolution, so
 * its reminder describes the subagent, not the session the chip is about.
 */
function markerState(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (!entry || typeof entry !== 'object') return null;
  if (entry.isSidechain === true) return null;
  const type = entry.attachment && entry.attachment.type;
  if (type === 'ultra_effort_enter') return true;
  if (type === 'ultra_effort_exit') return false;
  return commandState(entry);
}

/**
 * The state one `/effort` command output reports, or null when the entry is not
 * one.
 *
 * The filter is narrow on purpose, because these phrases travel. In the session
 * this was built in, "Set effort level to …" appears six times outside a real
 * command output: three times in assistant text that quoted it and three in tool
 * results that printed it. Requiring a user entry whose content is a plain
 * string carrying the `<local-command-stdout>` wrapper excluded all six and kept
 * all twelve real ones — a tool result's content is an array of blocks, and
 * quoted prose is not a user entry at all.
 *
 * A cancelled picker writes `<local-command-stdout>Cancelled</local-command-stdout>`,
 * which matches nothing here and correctly changes no state.
 */
function commandState(entry) {
  if (entry.type !== 'user') return null;
  const content = entry.message && entry.message.content;
  if (typeof content !== 'string' || !content.includes('<local-command-stdout>')) return null;
  if (content.includes('Set effort level to ultracode')) return true;
  const query = content.match(QUERY_LEVEL);
  if (query) return query[1] === 'ultracode';
  if (PLAIN_LEVELS.test(content)) return false;
  return null;
}

/**
 * Is ultracode on, according to this transcript?
 *
 * @param {string|null|undefined} transcriptPath - `transcript_path` from the statusline payload.
 * @param {object} [opts]
 * @param {number} [opts.scanBytes=SCAN_BYTES] - how many trailing bytes to search.
 * @returns {boolean|null} true/false from the newest marker, null when there is
 *   none in range or the file cannot be read. Callers treat null as "not
 *   ultracode"; it is kept distinct from false so a caller can tell "the
 *   session turned it off" from "nothing said".
 */
export function ultracodeFromTranscript(transcriptPath, { scanBytes = SCAN_BYTES } = {}) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return null;
  let size;
  try {
    size = statSync(transcriptPath).size;
  } catch {
    return null;
  }
  if (size === 0) return null;

  const start = Math.max(0, size - scanBytes);
  const buf = Buffer.alloc(size - start);
  let fd;
  try {
    fd = openSync(transcriptPath, 'r');
    readSync(fd, buf, 0, buf.length, start);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
  }

  // Backwards by candidate rather than line by line: lastIndexOf is a memchr
  // over the window, while splitting 4MB of JSONL into lines to walk the tail
  // would allocate the whole transcript tail as strings on every render.
  let from = buf.length;
  while (from > 0) {
    // The newest hit of any marker, so the attachment and the command output
    // compete on position and the later one wins.
    let hit = -1;
    for (const marker of MARKERS) {
      const at = buf.lastIndexOf(marker, from - 1, 'utf8');
      if (at > hit) hit = at;
    }
    if (hit === -1) return null;
    const lineStart = buf.lastIndexOf(NEWLINE, hit) + 1;
    const nlAfter = buf.indexOf(NEWLINE, hit);
    const lineEnd = nlAfter === -1 ? buf.length : nlAfter;
    // A window that starts mid-line leaves its first line truncated; that line
    // fails to parse and is skipped like any other non-marker.
    const state = markerState(buf.toString('utf8', lineStart, lineEnd));
    if (state !== null) return state;
    if (lineStart === 0) return null;
    from = lineStart;
  }
  return null;
}

/**
 * The level the effort chip should name.
 *
 * Reads the transcript only when the payload says `xhigh`, since that is the
 * only level ultracode can present as — which keeps every other session, and
 * every non-statusline caller, at zero extra I/O.
 *
 * The `xhigh` guard is also what keeps a stale marker honest. Dropping effort
 * (say `/effort medium`) turns ultracode off, but the `exit` marker is only
 * written when the next turn is assembled, so between those two moments the
 * newest marker still says `enter` while the payload already says `medium`.
 * Trusting the level here means the chip follows the payload, not the lag.
 *
 * @param {string|null} level - the level from the payload (see extractEffort).
 * @param {string|null|undefined} transcriptPath
 * @returns {string|null} `'ultracode'`, or `level` unchanged.
 */
export function effortChipLevel(level, transcriptPath) {
  if (level !== 'xhigh') return level;
  return ultracodeFromTranscript(transcriptPath) === true ? 'ultracode' : level;
}
