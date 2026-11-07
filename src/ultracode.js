/**
 * Ultracode detection — the one session state Claude Code does not put in the
 * statusline payload.
 *
 * Since 2.1.302 ultracode is not an effort level. It is an independent toggle,
 * "dynamic workflows on every task", that can be on at any level, and the
 * payload still carries only `effort.level`; there is no ultracode field. (The
 * older builds raised the level to `xhigh` and reported that, so the two
 * arrived identical. The new ones leave the level alone, so there is nothing in
 * the payload to recover it from at all.)
 *
 * What does carry it is the transcript. Claude Code injects a system-reminder
 * when ultracode turns on and another when it turns off, and both are recorded
 * as attachment entries:
 *
 *   {"type":"attachment","attachment":{"type":"ultra_effort_enter","reminderType":"full"}}
 *   {"type":"attachment","attachment":{"type":"ultra_effort_exit"}}
 *
 * The `enter` attachment repeats while ultracode stays on — once on the turn it
 * is switched on ("full"), then every tenth user turn as a reminder ("sparse",
 * TURNS_BETWEEN_MAINTENANCE = 10) — so the most recent of the two markers is
 * the current state, and an active session keeps refreshing it near the tail.
 * (A keyword in the prompt can switch it on for one turn only; that writes a
 * different attachment and is deliberately not a session state here.)
 *
 * A marker is only written when the NEXT turn is assembled, though, so on its own
 * it leaves the chip a turn behind. The command's own output closes that gap,
 * because Claude Code writes it to the transcript the moment the command returns:
 *
 *   {"type":"user","message":{"content":"<local-command-stdout>Ultracode on (this
 *    session only): dynamic workflows on every task. Effort stays high.</local-command-stdout>"}}
 *
 * The strings below are the ones the 2.1.302 binary builds in its `k()` function:
 *
 *   on     Ultracode on (this session only): dynamic workflows on every task. Effort stays high.
 *   off    Ultracode off. Effort stays high.
 *   query  Current effort level: high (…)  or  Effort level: auto (currently high),
 *          with ` · Ultracode on` appended while it is on; no suffix means off.
 *   level  Set effort level to high: …  — changes only the level, so it says nothing
 *          about ultracode locally. A remote session appends ` · Ultracode off`
 *          (U+00B7) when the level change switched it off, and `Effort level set
 *          to auto…` can carry the same suffix.
 *
 * Builds before 2.1.302 phrase it as a level instead: `Set effort level to
 * ultracode …` and `Current effort level: ultracode (…)` turn it on. Their
 * `Set effort level to <level>` rows used to mean "off", but that is no longer
 * true of the new builds and the two cannot be told apart, so those rows decide
 * nothing; the old builds' next-turn exit attachment clears the state, which
 * costs one turn of lag.
 *
 * Hence the read below: walk backwards from the end of the transcript and take
 * whichever of the two signals comes last. The scan is capped (see SCAN_BYTES)
 * because the statusline re-renders every few seconds and most sessions carry
 * neither signal — an uncapped backwards scan would read the whole transcript,
 * every render, to answer "no". The cap makes the failure one-directional: past
 * it we report "off", which is what the line showed before this existed.
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
 * Substrings worth parsing a line for. The first is the attachment; the rest are
 * the shapes the toggle and the `/effort` query print. Cheap prefilters only —
 * every hit is parsed and checked before it counts. A `Set effort level to` /
 * `Effort level set to` row matters only when it carries the ` · Ultracode off`
 * suffix, which the `Ultracode off` entry already catches.
 */
const MARKERS = [
  'ultra_effort_', 'Ultracode on (', 'Ultracode off', 'Effort level: auto', 'Current effort level:',
  'Set effort level to ultracode',
];
const NEWLINE = 0x0a;
const COMMAND_STDOUT = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/;
/** A query answer or level change that ends in the ultracode suffix. */
const SUFFIX_ON = /\s·\sUltracode on\s*$/;
const SUFFIX_OFF = /\s·\sUltracode off\s*$/;

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
 * The state one command output reports, or null when the entry is not one or
 * says nothing about ultracode.
 *
 * The filter is narrow on purpose, because these phrases travel. In the session
 * the first version was built in, "Set effort level to …" appears six times
 * outside a real command output: three times in assistant text that quoted it and
 * three in tool results that printed it. Requiring a user entry whose content is a
 * plain string carrying the `<local-command-stdout>` wrapper excluded all six and
 * kept all twelve real ones — a tool result's content is an array of blocks, and
 * quoted prose is not a user entry at all.
 *
 * A cancelled picker writes `<local-command-stdout>Cancelled</local-command-stdout>`,
 * which matches nothing here and correctly changes no state, and so does a plain
 * `Set effort level to high: …` row.
 */
function commandState(entry) {
  if (entry.type !== 'user') return null;
  const content = entry.message && entry.message.content;
  if (typeof content !== 'string' || !content.includes('<local-command-stdout>')) return null;
  const wrapped = content.match(COMMAND_STDOUT);
  const text = (wrapped ? wrapped[1] : content).trim();
  if (text.startsWith('Ultracode on (')) return true;
  if (text.startsWith('Ultracode off')) return false;
  // Before 2.1.302 ultracode was a level, and naming it meant on.
  if (/^Set effort level to ultracode\b/.test(text)) return true;
  if (/^Current effort level: ultracode\b/.test(text)) return true;
  // The query answers in both directions: the suffix is present only while on.
  if (/^(?:Current effort level:|Effort level: auto)/.test(text)) return SUFFIX_ON.test(text);
  // A level change leaves ultracode alone locally; only the remote suffix says off.
  if (/^(?:Set effort level to|Effort level set to)\b/.test(text)) return SUFFIX_OFF.test(text) ? false : null;
  return null;
}

/** Returned by readState when the transcript cannot be read at all. */
const UNREADABLE = Symbol('unreadable');

/** The newest marker in the trailing window: true/false, null for none, UNREADABLE for no file. */
function readState(transcriptPath, scanBytes) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return UNREADABLE;
  let size;
  try {
    size = statSync(transcriptPath).size;
  } catch {
    return UNREADABLE;
  }
  if (size === 0) return null;

  const start = Math.max(0, size - scanBytes);
  const buf = Buffer.alloc(size - start);
  let fd;
  try {
    fd = openSync(transcriptPath, 'r');
    readSync(fd, buf, 0, buf.length, start);
  } catch {
    return UNREADABLE;
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
 * Is ultracode on, according to this transcript?
 *
 * @param {string|null|undefined} transcriptPath - `transcript_path` from the statusline payload.
 * @param {object} [opts]
 * @param {number} [opts.scanBytes=SCAN_BYTES] - how many trailing bytes to search.
 * @returns {boolean|null} true/false from the newest marker, null when there is
 *   none in range or the file cannot be read. It is kept distinct from false so a
 *   caller can tell "the session turned it off" from "nothing said".
 */
export function ultracodeFromTranscript(transcriptPath, { scanBytes = SCAN_BYTES } = {}) {
  const state = readState(transcriptPath, scanBytes);
  return state === UNREADABLE ? null : state;
}

/**
 * The state the ultra chip should show.
 *
 * Unlike the level it replaced, ultracode no longer rides on any effort level, so
 * there is no payload value to gate the read on and no stale-marker guard to
 * apply: the transcript is the only source and the newest marker is the answer.
 * The caller still decides whether to ask at all (a live statusline render that
 * was handed a transcript path), which keeps every other caller at zero I/O.
 *
 * @param {string|null|undefined} transcriptPath
 * @returns {boolean|null} true while on; false when off or when nothing in range
 *   says otherwise; null when there is no readable transcript.
 */
export function ultracodeChipState(transcriptPath) {
  const state = readState(transcriptPath, SCAN_BYTES);
  if (state === UNREADABLE) return null;
  return state === true;
}
