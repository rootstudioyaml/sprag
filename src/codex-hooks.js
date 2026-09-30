import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, userLanguage } from './config.js';
import { koreanStyleInjection, koreanStyleEnabled } from './korean-style.js';
import { cohesionInjection } from './cohesion.js';
import { codexHarnessPaths } from './codex-harness.js';
import { findProjectRoot } from './harness.js';
import { runCodexBrief } from './codex-brief.js';
import { codexDocumentTool, codexDocumentNote, convertCodexDocument } from './codex-doc2md.js';
import { codexDelegationTool, codexRouteHint } from './codex-delegation.js';
import { bindCodexSubagent } from './codex-ledger.js';
import { seedOfferBlock } from './seed-rules.js';
import { readCodexRouteScan, openCodexCandidates, shouldRescanCodex } from './codex-route-scan.js';

const require = createRequire(import.meta.url);
const lint = require('./korean-lint.cjs');
const doc2md = require('./doc2md.cjs');

function context(event, text) {
  return text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : null;
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
    } catch { /* Deleted, moved, or unreadable files need no feedback. */ }
  }
  return messages.length ? messages.join('\n\n') : null;
}

export async function codexHookOutput(event, payload, { cfg = loadConfig() } = {}) {
  if (!payload || typeof payload !== 'object') return null;
  if (event === 'session-start' || event === 'subagent-start') {
    if (event === 'subagent-start' && cfg?.codex?.delegate !== true) return null;
    if (event === 'subagent-start') {
      try { bindCodexSubagent(payload); } catch { /* Binding is best-effort; a missed one just leaves a run unpriced. */ }
    }
    const root = findProjectRoot(payload.cwd || process.cwd(), { agent: 'codex' });
    const parts = [];
    // Keep the preset file current with this version's wording before it is read.
    if (event === 'session-start') {
      try { (await import('./preset-ratchet.js')).preparePresetRatchet({ agent: 'codex' }); } catch { /* Presets are optional. */ }
    }
    const { presetRatchetPath } = await import('./preset-ratchet.js');
    for (const [scope, ratchet] of [['global', codexHarnessPaths(root, 'global').ratchet],
      ['preset', presetRatchetPath({ agent: 'codex' })], ['project', codexHarnessPaths(root, 'project').ratchet]]) {
      try {
        if (statSync(ratchet).size > 32 * 1024) {
          parts.push(`Read the ${scope} Sprag ratchet rules at ${JSON.stringify(ratchet)} before working; they exceed the automatic injection limit.`);
        } else {
          const text = readFileSync(ratchet, 'utf8').trim();
          // An empty preset file is only its header; injecting it would spend
          // tokens every session on no rules.
          if (text && (scope !== 'preset' || /^- /m.test(text))) parts.push(`[Sprag Codex ratchet: ${scope}]\n${text}`);
        }
      } catch { /* No rules registered in this scope. */ }
    }
    parts.push(koreanStyleInjection({ cfg }), await cohesionInjection({ cfg }));
    if (process.env.CTS_NO_DOC2MD !== '1' && cfg?.codex?.doc2md !== false) parts.push(codexDocumentNote());
    if (event === 'session-start' && payload.source !== 'compact') {
      try { parts.push(seedOfferBlock({ root, agent: 'codex' })); } catch { /* Offers are optional. */ }
      try { parts.push(await routeNotice(root)); } catch { /* A missing scan only delays candidates. */ }
    }
    if (event === 'subagent-start') parts.push(
      '[Sprag Codex delegation]\nStay within the assigned task and any caller-provided budget. Return findings with file references and actual verification results; state unfinished work. Use only available Codex tools and configured roles. Do not infer a model tier or invent a tool-call budget.');
    return context(event === 'subagent-start' ? 'SubagentStart' : 'SessionStart', parts.filter(Boolean).join('\n\n'));
  }
  if (event === 'prompt') {
    const parts = [];
    if (cfg?.codex?.delegate === true) {
      try {
        parts.push(codexRouteHint(payload, { root: findProjectRoot(payload.cwd || process.cwd(), { agent: 'codex' }),
          minContext: Number.isFinite(cfg?.codex?.delegateMinContext) ? cfg.codex.delegateMinContext : undefined }));
      } catch { /* Invalid routing state must not suppress briefing or conversion. */ }
    }
    if (cfg?.codex?.brief !== false) {
      try { parts.push(runCodexBrief({ sessionId: payload.session_id, transcriptPath: payload.transcript_path, cwd: payload.cwd })); }
      catch { /* Local telemetry must not prevent document conversion. */ }
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
