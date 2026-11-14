/**
 * Harness analyzer — scans a session transcript JSONL for warning signals
 * and writes a small state file the statusline can read cheaply.
 *
 * Three signals (precedence: ratchet? > no-evidence > PEV-skip):
 *
 * 1. Ratchet candidate — same is_error tool_use_result (grouped by
 *    normalizeError) appears 2+ times in the last 30 turns. Suggests the user codify a rule so it doesn't repeat.
 *
 * 2. Evidence rate — fraction of recent assistant messages that ship proof
 *    (code blocks, tool_use_result, "test"/"output"/"diff"/"screenshot"
 *    keywords). <30% → ⚠ no-evidence — high chance the model is reporting
 *    "done" without showing it.
 *
 * 3. PEV-skip — many *mutating* tool_use calls (Edit/Write/Bash…, 5+) in the
 *    last 15 assistant turns with no plan signal (no TodoWrite, no
 *    "plan"/"Phase"/"단계" mention). Suggests the model is racing through
 *    edits without a verify pass. Read-only exploration (Read/Grep/Glob)
 *    deliberately doesn't count — reading five files is research, not racing.
 *
 * CommonJS so hook.cjs can `require()` it without a bundler step.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATE_DIR = stateDir();
const STATE_PATH = path.join(STATE_DIR, 'harness-state.json');
const CANDIDATES_PATH = path.join(STATE_DIR, 'ratchet-candidates.json');

const RECENT_TURNS = 15;        // PEV / evidence window (assistant turns)
const RATCHET_TURNS = 30;       // ratchet-candidate window
const EVIDENCE_THRESHOLD = 0.3; // <30% → ⚠ no-evidence
const PEV_TOOLUSE_THRESHOLD = 5;
// Tools that change state. Only these count toward PEV-skip — an agentic
// session trivially racks up 5+ *read* tool calls (Read/Grep/Glob) while
// researching, which is exactly the behavior we don't want to punish.
const MUTATING_TOOL_RE = /^(edit|write|multiedit|notebookedit|bash)$/i;

// Mirrors src/paths.js userDataDir() exactly (same order as doc2md.cjs).
// Duplicated because this file is CommonJS and paths.js is ESM; the
// precedence must match or state lands where the rest of the tool won't look.
function stateDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'claude-token-saver');
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'claude-token-saver');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'claude-token-saver');
  }
  return path.join(os.homedir(), '.config', 'claude-token-saver');
}

function readJsonl(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore corrupt line
    }
  }
  return out;
}

/**
 * The entries in the last `maxBytes` of a transcript. Every signal here looks
 * at the recent end of the session only, and the tool hook calls this on each
 * tool use, so the cost has to stay flat while the transcript grows (a long
 * session reaches tens of megabytes). The first line of the slice is dropped
 * when the read started mid-file, because it is cut.
 */
function readTailEntries(file, maxBytes) {
  const limit = maxBytes > 0 ? maxBytes : 1024 * 1024;
  let raw = '';
  let cut = false;
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - limit);
    const buf = Buffer.alloc(size - start);
    let read = 0;
    while (read < buf.length) {
      const n = fs.readSync(fd, buf, read, buf.length - read, start + read);
      if (n <= 0) break;
      read += n;
    }
    raw = buf.toString('utf8', 0, read);
    cut = start > 0;
  } catch {
    return [];
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
  const lines = raw.split('\n');
  if (cut) lines.shift();
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore corrupt line
    }
  }
  return out;
}

/**
 * The conversation itself: user and assistant messages in order, one entry per
 * message.
 *
 * A transcript is more than that. Claude Code writes hook results, API request
 * records, mode and title changes between the messages, and stores each content
 * block of one assistant message (thinking, text, tool_use) as its own line.
 * Reading the raw lines as turns broke two signals: the tool result was no
 * longer the entry right after its tool call (a hook record sat between them),
 * so no assistant message ever counted as showing its work, and a window of 15
 * "assistant turns" covered a handful of real ones. Subagent lines kept in the
 * parent transcript (`isSidechain`) are not this session's conversation.
 */
function conversation(entries) {
  const out = [];
  for (const e of entries) {
    if (!e || !e.message || e.isSidechain === true) continue;
    if (e.type !== 'user' && e.type !== 'assistant') continue;
    const prev = out[out.length - 1];
    const id = e.message.id;
    if (e.type === 'assistant' && id && prev && prev.type === 'assistant' && prev.message.id === id
      && Array.isArray(prev.message.content) && Array.isArray(e.message.content)) {
      prev.message = { ...prev.message, content: prev.message.content.concat(e.message.content) };
      prev.timestamp = e.timestamp || prev.timestamp;
      continue;
    }
    out.push({ type: e.type, timestamp: e.timestamp, message: e.message });
  }
  return out;
}

/**
 * Pull the text payload out of an assistant message, regardless of whether
 * Claude Code stored it as a string, a content-block array, or a mix.
 */
function assistantText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b && b.type === 'text') return b.text || '';
        return '';
      })
      .join('\n');
  }
  return '';
}

function toolUsesIn(msg) {
  if (!msg || !Array.isArray(msg.content)) return [];
  return msg.content.filter((b) => b && b.type === 'tool_use');
}

function toolResultsIn(msg) {
  if (!msg || !Array.isArray(msg.content)) return [];
  return msg.content.filter((b) => b && b.type === 'tool_result');
}

function looksLikeEvidence(text) {
  if (!text) return false;
  // Code block (``` …) is the cheapest evidence signal — almost always
  // present when the assistant shows actual command output or a diff.
  if (/```[\s\S]*?```/.test(text)) return true;
  const lower = text.toLowerCase();
  // Korean + English keywords. Order doesn't matter — first hit wins.
  const evidenceWords = [
    'stdout', 'output', 'diff', 'screenshot', 'passed', 'pytest', 'jest',
    'test result', 'verified', 'verifying',
    '출력', '결과', '스크린샷', '통과', '검증', '확인했', '확인됨',
  ];
  return evidenceWords.some((w) => lower.includes(w));
}

function looksLikePlanSignal(text, toolUses) {
  if (toolUses.some((t) => /^todowrite$/i.test(t.name || ''))) return true;
  if (!text) return false;
  const lower = text.toLowerCase();
  const planWords = ['plan', 'phase', 'step 1', 'step1', 'first,', 'next,',
    '단계', '계획', '먼저', '다음으로', '순서대로'];
  return planWords.some((w) => lower.includes(w));
}

// A tool call the user turned down comes back as an error result too. Two of
// those in a row are the user's decision, twice, and no rule would have
// prevented them. In 14 days of transcripts on one machine these were the most
// common "repeated error" (9 of 51 sessions that had one). An interrupted call
// is the same kind of result.
const USER_DECISION_RE = /^(?:<tool_use_error>\s*)?(?:The user doesn't want to (?:proceed|take this action)|\[Request interrupted by user|\[Tool call interrupted|Permission (?:for this action|to use \S+) (?:was|has been) denied|Claude requested permissions? to|The user (?:rejected|denied|declined))/i;

/**
 * The grouping key of an error text: volatile parts (paths, hashes, numbers)
 * are replaced so two runs of the same failure land in one group.
 */
function normalizeError(text) {
  return String(text)
    .replace(/^<tool_use_error>\s*/i, '')
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.@~+-]+){2,}\/?/g, '<path>')
    .replace(/\b[0-9a-f]{7,}\b/gi, '<id>')
    .replace(/\d+/g, '#')
    .slice(0, 60);
}

/** `{ key, pattern }` of an is_error tool_result, or null when it is not a signal. */
function errorInfo(toolResult) {
  if (!toolResult || toolResult.is_error !== true) return null;
  const c = toolResult.content;
  let txt = '';
  if (typeof c === 'string') txt = c;
  else if (Array.isArray(c)) {
    txt = c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join(' ');
  }
  txt = txt.replace(/\s+/g, ' ').trim();
  if (!txt) return null;
  if (USER_DECISION_RE.test(txt)) return null;
  const key = normalizeError(txt);
  // A bare exit status says nothing about what failed; "Exit code 1" alone
  // would group every failed command in the session.
  if (key.replace(/^Exit code #/, '').trim().length < 12) return null;
  return { key, pattern: txt.slice(0, 80) };
}

/**
 * The error groups in the last `RATCHET_TURNS` messages of the conversation:
 * `{ key, pattern, count, lastAt }`, `pattern` being the first original text
 * seen (80 chars). Takes raw transcript entries.
 */
function recentErrors(rawEntries) {
  const groups = new Map();
  const recent = conversation(rawEntries).slice(-RATCHET_TURNS);
  for (const e of recent) {
    for (const tr of toolResultsIn(e.message)) {
      const info = errorInfo(tr);
      if (!info) continue;
      const cur = groups.get(info.key) || { key: info.key, pattern: info.pattern, count: 0, lastAt: e.timestamp };
      cur.count += 1;
      cur.lastAt = e.timestamp || cur.lastAt;
      groups.set(info.key, cur);
    }
  }
  return [...groups.values()];
}

/**
 * Error groups that appear 2+ times in the last `RATCHET_TURNS` messages.
 * Takes raw transcript entries.
 */
function findRatchetCandidates(rawEntries) {
  const list = recentErrors(rawEntries).filter((g) => g.count >= 2);
  // Top 5 by count, ID assigned in rank order so `harness promote 1` always
  // targets the most-repeated error — stable even as new candidates appear.
  list.sort((a, b) => b.count - a.count);
  return list.slice(0, 5).map((g, i) => ({ id: i + 1, pattern: g.pattern, count: g.count, lastAt: g.lastAt, key: g.key }));
}

/**
 * Evidence rate — over the last RECENT_TURNS *assistant* messages, the
 * fraction that ship proof (code block / keywords). Tool_result blocks in
 * the immediate next user message also count as "shown the work."
 */
function computeEvidenceRate(entries) {
  // Window by *assistant turns*, not raw JSONL entries — one agentic turn can
  // span dozens of entries, so an entry-sliced window covered only 1-2 real
  // turns and made the rate jumpy.
  const idxs = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i] && entries[i].type === 'assistant') idxs.push(i);
  }
  const recentIdxs = idxs.slice(-RECENT_TURNS);
  if (recentIdxs.length === 0) return null;
  let proofCount = 0;
  for (const i of recentIdxs) {
    const text = assistantText(entries[i].message);
    let proof = looksLikeEvidence(text);
    // If the *next* entry is a user message with tool_result blocks, count
    // that as evidence for the assistant turn that triggered it.
    const next = entries[i + 1];
    if (!proof && next && next.type === 'user' && toolResultsIn(next.message).length > 0) {
      proof = true;
    }
    if (proof) proofCount++;
  }
  return proofCount / recentIdxs.length;
}

function computePevSkip(entries) {
  const assistants = entries.filter((e) => e && e.type === 'assistant');
  const recent = assistants.slice(-RECENT_TURNS);
  let mutatingCount = 0;
  let planSignal = false;
  for (const e of recent) {
    const text = assistantText(e.message);
    const tus = toolUsesIn(e.message);
    mutatingCount += tus.filter((t) => MUTATING_TOOL_RE.test(t.name || '')).length;
    if (looksLikePlanSignal(text, tus)) planSignal = true;
  }
  return mutatingCount >= PEV_TOOLUSE_THRESHOLD && !planSignal;
}

function analyzeTranscript(transcriptPath, opts) {
  opts = opts || {};
  // The hook has already parsed the transcript for its own totals; reading a
  // 65MB session a second time per tool call is the one avoidable cost here.
  // The tool hook has no parsed transcript at hand and passes `tailBytes`.
  const raw = Array.isArray(opts.entries) ? opts.entries
    : opts.tailBytes ? readTailEntries(transcriptPath, opts.tailBytes)
      : readJsonl(transcriptPath);
  if (raw.length === 0) return null;
  const entries = conversation(raw);
  const evidenceRate = computeEvidenceRate(entries);
  const pevSkip = computePevSkip(entries);
  const ratchetCandidates = findRatchetCandidates(raw);
  return {
    sessionId: opts.sessionId || null,
    cwd: opts.cwd || null,
    transcriptPath: transcriptPath,
    timestamp: new Date().toISOString(),
    evidenceRate: evidenceRate,
    evidenceLow: evidenceRate !== null && evidenceRate < EVIDENCE_THRESHOLD,
    pevSkip: pevSkip,
    ratchetCandidate: ratchetCandidates[0] || null, // back-compat
    ratchetCandidates: ratchetCandidates,
  };
}

function writeJsonAtomic(dir, file, obj) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // tmp + rename so the statusline never reads a half-written file.
    const tmp = file + '.' + process.pid + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
      fs.renameSync(tmp, file);
    } catch (e) {
      // A failed write or rename must not leave the temp file behind.
      try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
      throw e;
    }
  } catch {
    // best-effort
  }
}

function writeState(state) {
  if (!state) return;
  writeJsonAtomic(STATE_DIR, STATE_PATH, state);
}

/**
 * The ratchet candidates the tool hook found, kept apart from the state file:
 * the state file is the analyzer's (evidence, PEV), this one is the follower's.
 * `dir` replaces the state dir (tests).
 */
function candidatesFile(dir) {
  return dir ? path.join(dir, 'ratchet-candidates.json') : CANDIDATES_PATH;
}

function writeCandidates(obj, dir) {
  if (!obj) return;
  writeJsonAtomic(dir || STATE_DIR, candidatesFile(dir), obj);
}

function readCandidates(dir) {
  try {
    return JSON.parse(fs.readFileSync(candidatesFile(dir), 'utf8'));
  } catch {
    return null;
  }
}

function readState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return null;
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  analyzeTranscript,
  readTailEntries,
  conversation,
  normalizeError,
  recentErrors,
  findRatchetCandidates,
  writeState,
  readState,
  readCandidates,
  writeCandidates,
  STATE_PATH,
  CANDIDATES_PATH,
  EVIDENCE_THRESHOLD,
};
