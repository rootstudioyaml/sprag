import { createRequire } from 'node:module';
import { realpathSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { recordCodexDocument } from './codex-doc2md-ledger.js';

const require = createRequire(import.meta.url);
const doc2md = require('./doc2md.cjs');
const lint = require('./korean-lint.cjs');
const shellTools = new Set(['Bash', 'exec_command', 'shell_command', 'shell']);

function canonicalPath(file) {
  const missing = [];
  for (let current = file; ; current = dirname(current)) {
    try { return resolve(realpathSync(current), ...missing.reverse()); }
    catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code) || dirname(current) === current) return file; }
    missing.push(basename(current));
  }
}

export function codexDocumentNote() {
  return '[Sprag Doc2md]\nBefore reading PDF, Office, or Figma documents, run sprag doc2md <path> --agent codex and read the resulting Markdown. '
    + 'Conversions are one-way: never edit the cached Markdown. To modify a document, copy the original and edit the copy with a format-aware library, then reconvert it to verify the text. '
    + 'Text extraction does not verify charts, images, or layout. Report conversion failures and do not claim visual verification from text alone.';
}

export function convertCodexDocument(source, { convert = doc2md.convert, ...opts } = {}) {
  let result;
  try { result = convert(source, { agent: 'codex' }); }
  catch { return { ok: false, reason: 'convert-failed' }; }
  if (!result?.ok) return result || { ok: false, reason: 'convert-failed' };
  let tmp;
  try {
    // Existing shared caches can carry Claude attachment baselines and prices.
    // Keep their body, but give Codex a separate view with neutral provenance.
    const original = readFileSync(result.cacheFile, 'utf8');
    const end = original.startsWith('<!--\nsprag doc2md') ? original.indexOf('\n-->\n') : -1;
    const body = end >= 0 ? original.slice(end + 5) : original;
    const cacheFile = result.cacheFile.replace(/\.md$/, '.codex.md');
    const text = `<!--\nsprag doc2md: generated Markdown; do not edit.\nSource: ${JSON.stringify(resolve(source))}\nText extraction does not verify images or layout.\n-->\n${body}`;
    let previous;
    try { previous = readFileSync(cacheFile, 'utf8'); } catch { /* First Codex use. */ }
    if (previous !== text) {
      tmp = `${cacheFile}.${randomUUID()}.tmp`;
      writeFileSync(tmp, text, { mode: 0o600 });
      renameSync(tmp, cacheFile);
      tmp = null;
    }
    const { savedUsd, baselineTokens, ...meta } = result.meta || {};
    const prepared = { ...result, cacheFile, meta };
    recordCodexDocument(source, prepared, opts);
    return prepared;
  } catch {
    return { ok: false, reason: 'cache-unavailable' };
  } finally {
    if (tmp) { try { rmSync(tmp, { force: true }); } catch { /* Best-effort temporary file cleanup. */ } }
  }
}

/** Adapt supported Codex calls to the shared converter and write guard. */
export function codexDocumentTool(payload, { convert = convertCodexDocument, guard = doc2md.decideForWrite } = {}) {
  const tool = payload?.tool_name?.replace(/^(?:functions|tools)\./, '');
  const input = payload?.tool_input;
  const command = typeof input === 'string' ? input : input?.command ?? input?.cmd ?? input?.content ?? input?.patch;
  const cwd = resolve(payload?.cwd || process.cwd(), typeof input?.workdir === 'string' ? input.workdir : '.');
  let writes = [];
  if (tool === 'apply_patch' && typeof command === 'string' && command.startsWith('*** Begin Patch')) {
    writes = [...command.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)\r?$/gm)].map((m) => m[1].trimEnd());
  } else if (['Edit', 'Write'].includes(tool) && typeof input?.file_path === 'string') writes = [input.file_path];
  else if (shellTools.has(tool)) writes = lint.writtenPathsOfBash(command);
  for (const path of writes) {
    const file = resolve(cwd, path);
    const canonical = canonicalPath(file);
    for (const target of new Set([file, canonical])) {
      const decision = guard({ tool_name: 'Write', tool_input: { file_path: target } }, { agent: 'codex' });
      if (decision?.deny) return { hookSpecificOutput: { hookEventName: 'PreToolUse',
        permissionDecision: 'deny', permissionDecisionReason: decision.reason } };
    }
  }

  let file;
  if (['Read', 'read_file', 'mcp__filesystem__read_file', 'mcp__filesystem__read_text_file'].includes(tool)) {
    file = input?.file_path ?? input?.path;
  } else if (shellTools.has(tool) && typeof command === 'string') {
    // Only literal, single-file reads. Compound commands and expansions stay untouched.
    const match = /^(?:cat\s+(?:--\s+)?|(?:head|tail)\s+(?:-n\s+\d+\s+)?)(?:"([^"$`\n]+)"|'([^'\n]+)'|([^\s'"`$;&|<>*?(){}\\]+))\s*$/.exec(command.trim());
    if (match) file = match[1] || match[2] || match[3];
  }
  if (typeof file !== 'string' || !doc2md.isTargetPath(file)) return null;
  const result = convert(resolve(cwd, file));
  if (!result.ok) return { hookSpecificOutput: { hookEventName: 'PreToolUse',
    ...(result.reason === 'unsafe-archive' ? { permissionDecision: 'deny', permissionDecisionReason: '[doc2md] Unsafe archive; do not extract it.' }
      : { additionalContext: `[doc2md] Conversion failed (${result.reason}). Do not claim this document was converted. ${codexDocumentNote()}` }) } };
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `[doc2md] Read the converted Markdown at ${JSON.stringify(result.cacheFile)} instead of extracting ${JSON.stringify(file)} again. `
      + `Source ${result.meta?.size ?? 'unknown'} bytes; Markdown ${result.meta?.markdownBytes ?? 'unknown'} bytes.`
      + (result.meta?.clipped ? ' The conversion is clipped; it is not the complete document.'
        : result.meta?.truncated ? ' Text extraction is incomplete; it is not the complete document.' : '') } };
}
