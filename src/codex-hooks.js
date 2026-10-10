import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, readSync, closeSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig, userLanguage } from './config.js';
import { koreanStyleInjection, koreanStyleEnabled } from './korean-style.js';
import { cohesionInjection } from './cohesion.js';
import { codexHarnessPaths, syncCodexKoreanBlock } from './codex-harness.js';
import { writeViaTmp } from './state-file.js';
import { findProjectRoot } from './harness.js';
import { runCodexBrief } from './codex-brief.js';
import { codexDocumentTool, codexDocumentNote, convertCodexDocument } from './codex-doc2md.js';
import { codexDelegationTool, codexRouteHint, codexDelegateEnabled } from './codex-delegation.js';
import { bindCodexSubagent, closeStaleCodexRoutes, unsettledCodexRoutes } from './codex-ledger.js';
import { seedOfferBlock } from './seed-rules.js';
import { readCodexRouteScan, openCodexCandidates, shouldRescanCodex } from './codex-route-scan.js';
import { userDataDir } from './paths.js';
import { debug } from './debug.js';

const require = createRequire(import.meta.url);
const lint = require('./korean-lint.cjs');
const doc2md = require('./doc2md.cjs');

function context(event, text) {
  return text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : null;
}

/**
 * Codex 0.159.2 keeps about 2,450 tokens of one hook's context and cuts the
 * middle: a 4,500-token SessionStart kept its head and tail and dropped 2,042
 * tokens, which was most of the Korean style guide, while the low-priority
 * offers at the end survived. The budget leaves room for estimate error.
 */
export const CODEX_CONTEXT_TOKEN_BUDGET = 2000;

/** Overestimates on purpose: ASCII at 3.5 chars a token, anything else at 1.3. */
export function estimateCodexTokens(text) {
  let ascii = 0, other = 0;
  for (const ch of String(text ?? '')) { if (ch.codePointAt(0) < 128) ascii++; else other++; }
  return Math.ceil(ascii / 3.5 + other / 1.3);
}

/**
 * Fit context parts into the budget whole, never cut. Parts are tried by
 * priority (lower first); a part that does not fit moves to `overflowFile`
 * when `spill` is set and is dropped otherwise. A pointer to the file goes
 * first, since the head of a context is what Codex always keeps.
 */
export function fitCodexContext(parts, { budget = CODEX_CONTEXT_TOKEN_BUDGET, overflowFile, write = writeOverflow } = {}) {
  const items = parts.map((p, i) => ({ ...p, i, tokens: estimateCodexTokens(p.text) })).filter((p) => p.text);
  const pointer = (file) => `[Sprag] Some Sprag instructions exceed Codex's hook context limit. Read ${JSON.stringify(file)} before starting work and follow it like the instructions below.`;
  const reserve = overflowFile && items.some((p) => p.spill) ? estimateCodexTokens(pointer(overflowFile)) : 0;
  let used = reserve;
  const kept = new Set(), spilled = [];
  for (const p of [...items].sort((a, b) => a.priority - b.priority || a.i - b.i)) {
    if (used + p.tokens <= budget) { kept.add(p.i); used += p.tokens; }
    else if (p.spill && overflowFile) spilled.push(p);
  }
  const out = items.filter((p) => kept.has(p.i)).map((p) => p.text);
  if (spilled.length) {
    try {
      write(overflowFile, spilled.sort((a, b) => a.i - b.i).map((p) => p.text).join('\n\n') + '\n');
      out.unshift(pointer(overflowFile));
    } catch (e) { debug('codex:overflow', e); }
  }
  return out.join('\n\n');
}

function writeOverflow(file, text) {
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeViaTmp(tmp, file, text, { mode: 0o600 });
}

function overflowFileFor(root) {
  const key = createHash('sha256').update(resolve(root || '.')).digest('hex').slice(0, 16);
  return join(userDataDir(), 'codex-context', `${key}.md`);
}

/**
 * `codex exec` runs have no one to answer a question, yet their SessionStart
 * payload says `source: "startup"` like an interactive one. The rollout's
 * first record says who started it (`originator: "codex_exec"`).
 */
export function isCodexExecSession(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return false;
  let fd;
  try {
    fd = openSync(transcriptPath, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    const first = JSON.parse(buffer.subarray(0, length).toString('utf8').split('\n')[0]);
    const meta = first?.type === 'session_meta' ? first.payload : null;
    return meta?.originator === 'codex_exec' || meta?.source === 'exec';
  } catch (e) {
    if (e?.code !== 'ENOENT') debug('codex:exec-detect', e);
    return false;
  } finally { if (fd !== undefined) closeSync(fd); }
}

/**
 * Project route candidates from the last scan. Never scans inline: session
 * start must stay fast, so a stale scan is refreshed in a detached process
 * and its results show up next session.
 */
async function routeNotice(root, { spawnRescan = defaultRescan } = {}) {
  const cache = readCodexRouteScan();
  if (await shouldRescanCodex(cache)) spawnRescan();
  const open = openCodexCandidates(cache, { root });
  if (!open.length) return null;
  return [`[Sprag route-scan] ${open.length} recurring delegable pattern(s) in this project. Mention them once; do not register without the user's scope decision.`,
    ...open.slice(0, 3).map((c) => `  R${c.id} ${c.category} x${c.count}: ${c.from} -> ${c.suggestedModel || '(choose a model)'}`),
    '  Review: sprag route-scan --agent codex | approve: sprag delegate rules add R<N> --global|--project --agent codex'].join('\n');
}

function defaultRescan() {
  if (process.env.CTS_NO_ROUTE_SCAN === '1') return;
  spawn(process.execPath, [process.argv[1], 'route-scan', '--refresh', '--quiet', '--agent', 'codex'],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/**
 * Prices the delegated runs the ledger has not joined yet, in a detached
 * process. The ledger was refreshed only by the route scan, which the rescan
 * gate holds back for up to a day, so "Routing saved" showed a delegation that
 * long after it happened. Claude's side has the same shortcut on its
 * PostToolUse hook; Codex has no hook for a finished child, so the next prompt
 * of the parent is the earliest point that knows one was spawned.
 */
function defaultLedgerRefresh() {
  if (process.env.CTS_NO_ROUTE_SCAN === '1') return;
  spawn(process.execPath, [process.argv[1], 'route-scan', 'savings', '--refresh', '--quiet', '--agent', 'codex'],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

export function lintCodexTool(payload, { scope = 'all' } = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const input = payload.tool_input;
  const command = typeof input === 'string' ? input : input?.command ?? input?.cmd ?? input?.content ?? input?.patch;
  const tool = payload.tool_name?.replace(/^(?:functions|tools)\./, '');
  let paths = [];
  if (['Bash', 'exec_command', 'shell_command', 'shell'].includes(tool)) paths = lint.writtenPathsOfBash(command);
  else if (['apply_patch', 'Edit', 'Write'].includes(tool) && typeof command === 'string' && command.startsWith('*** Begin Patch')) {
    // Patch headers are the path-bearing records of Codex's patch grammar.
    // Check the final file, including move destinations, not diff markers.
    paths = [...command.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)\r?$/gm)].map((m) => m[1].trimEnd());
  } else return lint.lintToolUse(payload, { scope });
  const messages = [];
  for (const path of new Set(paths)) {
    const file = resolve(payload.cwd || process.cwd(), typeof input?.workdir === 'string' ? input.workdir : '.', path);
    if (!lint.isLintTarget(file, scope)) continue;
    try {
      const s = statSync(file);
      if (!s.isFile() || s.size > 512 * 1024) continue;
      let text = readFileSync(file, 'utf8');
      if (lint.isHtmlFile(file)) text = lint.stripHtml(text);
      const findings = lint.lintKoreanText(text, { code: !lint.isProseFile(file) });
      if (findings.length) messages.push(lint.formatFindings(file, findings));
    } catch (e) { if (e?.code !== 'ENOENT') debug('codex:lint', e); }
  }
  return messages.length ? messages.join('\n\n') : null;
}

export async function codexHookOutput(event, payload, { cfg = loadConfig(), refreshLedger = defaultLedgerRefresh } = {}) {
  if (!payload || typeof payload !== 'object') return null;
  if (event === 'session-start' || event === 'subagent-start') {
    if (event === 'subagent-start' && !codexDelegateEnabled(cfg)) return null;
    if (event === 'subagent-start') {
      try { bindCodexSubagent(payload); } catch (e) { debug('codex:bind', e); }
    }
    const root = findProjectRoot(payload.cwd || process.cwd(), { agent: 'codex' });
    const parts = [];
    // Keep the preset file current with this version's wording before it is read.
    if (event === 'session-start') {
      try { (await import('./preset-ratchet.js')).preparePresetRatchet({ agent: 'codex' }); } catch (e) { debug('codex:preset', e); }
    }
    const { presetRatchetPath } = await import('./preset-ratchet.js');
    // Lower priority survives the budget first. Rules and style move to a file
    // when they do not fit; offers and notices are simply left out.
    for (const [scope, ratchet] of [['global', codexHarnessPaths(root, 'global').ratchet],
      ['preset', presetRatchetPath({ agent: 'codex' })], ['project', codexHarnessPaths(root, 'project').ratchet]]) {
      try {
        if (statSync(ratchet).size > 32 * 1024) {
          parts.push({ priority: 1, text: `Read the ${scope} Sprag ratchet rules at ${JSON.stringify(ratchet)} before working; they exceed the automatic injection limit.` });
        } else {
          const text = readFileSync(ratchet, 'utf8').trim();
          // An empty preset file is only its header; injecting it would spend
          // tokens every session on no rules.
          if (text && (scope !== 'preset' || /^- /m.test(text))) parts.push({ priority: 1, spill: true, text: `[Sprag Codex ratchet: ${scope}]\n${text}` });
        }
      } catch (e) { if (e?.code !== 'ENOENT') debug('codex:ratchet', e); }
    }
    if (event === 'subagent-start') parts.push({ priority: 0, text:
      '[Sprag Codex delegation]\nStay within the assigned task and any caller-provided budget. Return findings with file references and actual verification results; state unfinished work. Use only available Codex tools and configured roles. Do not infer a model tier or invent a tool-call budget.' });
    // Codex reads the Korean guide from the global AGENTS.md, so the hook adds it
    // only when that block was just written (this session may have loaded the old
    // file) or could not be synced. Children read the same file.
    let korean = null;
    try { korean = syncCodexKoreanBlock({ cfg }); } catch (e) { debug('codex:korean-sync', e); }
    if (korean?.action !== 'unchanged') parts.push({ priority: 2, spill: true, text: koreanStyleInjection({ cfg }) });
    parts.push({ priority: 3, spill: true, text: await cohesionInjection({ cfg }) });
    if (process.env.CTS_NO_DOC2MD !== '1' && cfg?.codex?.doc2md !== false) parts.push({ priority: 4, spill: true, text: codexDocumentNote() });
    // Offers ask the user a question; a `codex exec` run has no one to answer it.
    if (event === 'session-start' && payload.source !== 'compact' && !isCodexExecSession(payload.transcript_path)) {
      try { parts.push({ priority: 5, text: await routeNotice(root) }); } catch (e) { debug('codex:route-notice', e); }
      try { parts.push({ priority: 6, text: seedOfferBlock({ root, agent: 'codex' }) }); } catch (e) { debug('codex:seed-offer', e); }
    }
    return context(event === 'subagent-start' ? 'SubagentStart' : 'SessionStart',
      fitCodexContext(parts, { overflowFile: overflowFileFor(root) }));
  }
  if (event === 'prompt') {
    const parts = [];
    if (codexDelegateEnabled(cfg)) {
      // Before the hint for this prompt is recorded: a hint from an earlier turn
      // that no child claimed is closed, and children that did run get priced.
      try { closeStaleCodexRoutes(payload); } catch (e) { debug('codex:close-routes', e); }
      try { if (unsettledCodexRoutes() > 0) refreshLedger(); } catch (e) { debug('codex:ledger-refresh', e); }
      try {
        parts.push(codexRouteHint(payload, { cfg, root: findProjectRoot(payload.cwd || process.cwd(), { agent: 'codex' }) }));
      } catch (e) { debug('codex:route-hint', e); }
    }
    if (cfg?.codex?.brief !== false) {
      try {
        parts.push(runCodexBrief({ sessionId: payload.session_id, transcriptPath: payload.transcript_path, cwd: payload.cwd,
          root: findProjectRoot(payload.cwd || process.cwd(), { agent: 'codex' }) }));
      }
      catch (e) { debug('codex:brief', e); }
    }
    if (process.env.CTS_NO_DOC2MD !== '1' && cfg?.codex?.doc2md !== false) {
      parts.push(doc2md.contextForPrompt(payload, { lang: userLanguage(), agent: 'codex', convert: convertCodexDocument }));
    }
    return context('UserPromptSubmit', parts.filter(Boolean).join('\n\n'));
  }
  if (event === 'pre-tool') {
    if (process.env.CTS_NO_DOC2MD !== '1' && cfg?.codex?.doc2md !== false) {
      const result = codexDocumentTool(payload);
      if (result) return result;
    }
    return codexDelegationTool(payload, { cfg, root: findProjectRoot(payload.cwd || process.cwd(), { agent: 'codex' }) });
  }
  if (event === 'post-tool') {
    if (!koreanStyleEnabled(cfg) || cfg?.koreanStyle?.lint === 'off') return null;
    const result = lintCodexTool(payload, { scope: cfg?.koreanStyle?.lintScope === 'prose' ? 'prose' : 'all' });
    const text = typeof result === 'string' ? result : result ? lint.formatFindings(result.filePath, result.findings) : null;
    if (!text) return null;
    if (cfg?.koreanStyle?.lint === 'warn') return context('PostToolUse', text);
    return { decision: 'block', reason: text };
  }
  throw new Error(`Unknown Codex hook event: ${event}`);
}
