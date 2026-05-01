/**
 * Harness analyzer — scans a session transcript JSONL for warning signals
 * and writes a small state file the statusline can read cheaply.
 *
 * Three signals (precedence: ratchet? > no-evidence > PEV-skip):
 *
 * 1. Ratchet candidate — same is_error tool_use_result appears 2+ times in
 *    the last 30 turns. Suggests the user codify a rule so it doesn't repeat.
 *
 * 2. Evidence rate — fraction of recent assistant messages that ship proof
 *    (code blocks, tool_use_result, "test"/"output"/"diff"/"screenshot"
 *    keywords). <30% → ⚠ no-evidence — high chance the model is reporting
 *    "done" without showing it.
 *
 * 3. PEV-skip — many tool_use calls (5+) in the last 15 turns with no plan
 *    signal (no TodoWrite, no "plan"/"Phase"/"단계" mention). Suggests the
 *    model is racing through edits without a verify pass.
 *
 * CommonJS so hook.cjs can `require()` it without a bundler step.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATE_DIR = stateDir();
const STATE_PATH = path.join(STATE_DIR, 'harness-state.json');

const RECENT_TURNS = 15;        // PEV / evidence window
const RATCHET_TURNS = 30;       // ratchet-candidate window
const EVIDENCE_THRESHOLD = 0.3; // <30% → ⚠ no-evidence
const PEV_TOOLUSE_THRESHOLD = 5;

function stateDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), 'claude-token-saver');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'claude-token-saver');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'claude-token-saver');
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

function errorSignature(toolResult) {
  if (!toolResult || toolResult.is_error !== true) return null;
  const c = toolResult.content;
  let txt = '';
  if (typeof c === 'string') txt = c;
  else if (Array.isArray(c)) {
    txt = c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join(' ');
  }
  txt = txt.replace(/\s+/g, ' ').trim();
  if (!txt) return null;
  // First 80 chars is enough to dedupe most repeated errors without overfitting
  // to volatile bits like timestamps or pids.
  return txt.slice(0, 80);
}

/**
 * Walk the last `RATCHET_TURNS` turns and surface error signatures that
 * appear 2+ times. Returns the top candidate (or null).
 */
function findRatchetCandidates(entries) {
  const counts = new Map();
  const recent = entries.slice(-RATCHET_TURNS);
  for (const e of recent) {
    const msg = e && e.message;
    if (!msg) continue;
    for (const tr of toolResultsIn(msg)) {
      const sig = errorSignature(tr);
      if (!sig) continue;
      const cur = counts.get(sig) || { count: 0, lastAt: e.timestamp };
      cur.count += 1;
      cur.lastAt = e.timestamp || cur.lastAt;
      counts.set(sig, cur);
    }
  }
  const list = [];
  for (const [sig, info] of counts.entries()) {
    if (info.count < 2) continue;
    list.push({ pattern: sig, count: info.count, lastAt: info.lastAt });
  }
  // Top 5 by count, ID assigned in rank order so `harness promote 1` always
  // targets the most-repeated error — stable even as new candidates appear.
  list.sort((a, b) => b.count - a.count);
  return list.slice(0, 5).map((c, i) => ({ id: i + 1, ...c }));
}

/**
 * Evidence rate — over the last RECENT_TURNS *assistant* messages, the
 * fraction that ship proof (code block / keywords). Tool_result blocks in
 * the immediate next user message also count as "shown the work."
 */
function computeEvidenceRate(entries) {
  const recent = entries.slice(-RECENT_TURNS * 2); // both user/assistant
  const assistants = [];
  for (let i = 0; i < recent.length; i++) {
    const e = recent[i];
    if (e && e.type === 'assistant') {
      const text = assistantText(e.message);
      let proof = looksLikeEvidence(text);
      // If the *next* entry is a user message with tool_result blocks, count
      // that as evidence for the assistant turn that triggered it.
      const next = recent[i + 1];
      if (!proof && next && next.type === 'user' && toolResultsIn(next.message).length > 0) {
        proof = true;
      }
      assistants.push(proof);
    }
  }
  if (assistants.length === 0) return null;
  const proofCount = assistants.filter(Boolean).length;
  return proofCount / assistants.length;
}

function computePevSkip(entries) {
  const recent = entries.slice(-RECENT_TURNS);
  let toolUseCount = 0;
  let planSignal = false;
  for (const e of recent) {
    if (!e || e.type !== 'assistant') continue;
    const text = assistantText(e.message);
    const tus = toolUsesIn(e.message);
    toolUseCount += tus.length;
    if (looksLikePlanSignal(text, tus)) planSignal = true;
  }
  return toolUseCount >= PEV_TOOLUSE_THRESHOLD && !planSignal;
}

function analyzeTranscript(transcriptPath, opts) {
  opts = opts || {};
  const entries = readJsonl(transcriptPath);
  if (entries.length === 0) return null;
  const evidenceRate = computeEvidenceRate(entries);
  const pevSkip = computePevSkip(entries);
  const ratchetCandidates = findRatchetCandidates(entries);
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

function writeState(state) {
  if (!state) return;
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
  } catch {
    // best-effort
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
  writeState,
  readState,
  STATE_PATH,
  EVIDENCE_THRESHOLD,
};
