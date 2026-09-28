import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { childEnv } from './helpers/child-env.js';
import { codexDocumentTool, convertCodexDocument } from '../src/codex-doc2md.js';
import { codexDocumentTotals } from '../src/codex-doc2md-ledger.js';
const doc2md = createRequire(import.meta.url)('../src/doc2md.cjs');
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
function fixture(t) {
  // realpath: Windows hands out the 8.3 form (RUNNER~1) here while the hooks
  // resolve the long one, and the two spellings name different cache files.
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'sprag-codex-doc-')));
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return home;
}

test('Codex reads reuse the shared converter and redirect only recognized literal document reads', (t) => {
  const cwd = fixture(t), paths = [];
  const convert = (file) => { paths.push(file); return { ok: true, cacheFile: '/cache/book.md', meta: { clipped: true, size: 100, markdownBytes: 10 } }; };
  for (const [tool_name, tool_input] of [['Read', { file_path: 'book.pdf' }], ['mcp__filesystem__read_file', { path: 'book.pdf' }],
    ['Bash', { command: 'cat "book.pdf"' }], ['functions.exec_command', { cmd: 'head -n 10 book.pdf', workdir: 'docs' }]]) {
    const out = codexDocumentTool({ cwd, tool_name, tool_input }, { convert }).hookSpecificOutput;
    assert.equal(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason, /\/cache\/book.md/);
    assert.match(out.permissionDecisionReason, /clipped/);
  }
  assert.equal(paths.at(-1), join(cwd, 'docs', 'book.pdf'));
  for (const cmd of ['cat notes.md', 'cat *.pdf', 'cat "$FILE.pdf"', 'cat book.pdf | head', 'cat book.pdf other.pdf']) {
    assert.equal(codexDocumentTool({ cwd, tool_name: 'Bash', tool_input: { command: cmd } }, { convert }), null);
  }
  assert.equal(paths.length, 4);
});

test('conversion failure reports failure, while unsafe archives are denied', (t) => {
  const cwd = fixture(t), payload = { cwd, tool_name: 'read_file', tool_input: { path: 'book.pdf' } };
  const failed = codexDocumentTool(payload, { convert: () => ({ ok: false, reason: 'no-markitdown' }) }).hookSpecificOutput;
  assert.equal(failed.permissionDecision, undefined);
  assert.match(failed.additionalContext, /Conversion failed/);
  assert.doesNotMatch(failed.additionalContext, /installing/);
  const unsafe = codexDocumentTool(payload, { convert: () => ({ ok: false, reason: 'unsafe-archive' }) }).hookSpecificOutput;
  assert.equal(unsafe.permissionDecision, 'deny');
});

test('Codex converter exceptions and inaccessible cache views return explicit failures', (t) => {
  const cwd = fixture(t);
  const source = join(cwd, 'book.pdf');
  assert.deepEqual(convertCodexDocument(source, { convert: () => { throw new Error('private converter details'); } }),
    { ok: false, reason: 'convert-failed' });
  assert.deepEqual(convertCodexDocument(source, { convert: () => ({ ok: true, cacheFile: join(cwd, 'missing.md') }) }),
    { ok: false, reason: 'cache-unavailable' });
});

test('failed Codex cache writes clean up temporary files, preserve the shared cache, and do not count documents', (t) => {
  const cwd = fixture(t), source = join(cwd, 'book.pdf'), cacheFile = join(cwd, 'book.md');
  writeFileSync(source, 'fixture');
  const original = '# Shared conversion\n';
  writeFileSync(cacheFile, original);
  const blockedView = cacheFile.replace(/\.md$/, '.codex.md');
  mkdirSync(blockedView);
  writeFileSync(join(blockedView, 'keep'), 'existing data');
  const opts = { dir: cwd, home: cwd, convert: () => ({ ok: true, cacheFile, meta: { size: 7, markdownBytes: 20 } }) };
  assert.deepEqual(convertCodexDocument(source, opts), { ok: false, reason: 'cache-unavailable' });
  assert.equal(readFileSync(cacheFile, 'utf8'), original);
  assert.equal(readFileSync(join(blockedView, 'keep'), 'utf8'), 'existing data');
  assert.equal(readdirSync(cwd).some((name) => name.endsWith('.tmp')), false);
  assert.equal(codexDocumentTotals(opts).docs, 0);
  const hook = codexDocumentTool({ cwd, tool_name: 'Read', tool_input: { file_path: 'book.pdf' } }, {
    convert: (file) => convertCodexDocument(file, opts),
  }).hookSpecificOutput;
  assert.equal(hook.permissionDecision, undefined);
  assert.match(hook.additionalContext, /Conversion failed \(cache-unavailable\)/);
});

test('Codex read and prompt hooks disclose converter truncation even without byte clipping', (t) => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, 'book.pdf'), 'fixture');
  const convert = () => ({ ok: true, cacheFile: '/cache/book.md', meta: { truncated: true, clipped: false } });
  const out = codexDocumentTool({ cwd, tool_name: 'Read', tool_input: { file_path: 'book.pdf' } }, { convert });
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /incomplete|not the complete document/);
  const text = doc2md.contextForPrompt({ cwd, prompt: 'Read book.pdf' }, { agent: 'codex', convert });
  assert.match(text, /incomplete|not the complete document/);
});

test('one failed Codex cache view preserves prompt briefing and other document conversions', (t) => {
  const home = fixture(t), state = join(home, 'cfg');
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = state;
  let first, second;
  try {
    for (const name of ['first.pdf', 'second.pdf']) writeFileSync(join(home, name), 'fixture');
    first = doc2md.writeCache(join(home, 'first.pdf'), '# First\n', {}, { agent: 'codex' });
    second = doc2md.writeCache(join(home, 'second.pdf'), '# Second\n', {}, { agent: 'codex' });
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
  }
  mkdirSync(first.cacheFile.replace(/\.md$/, '.codex.md'));
  const transcript = join(home, 'rollout.jsonl');
  writeFileSync(transcript, JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: {
    type: 'token_count', info: { last_token_usage: { input_tokens: 190000 }, model_context_window: 200000 },
  } }) + '\n');
  const env = childEnv({ HOME: home, CODEX_HOME: join(home, 'codex'), XDG_CONFIG_HOME: state, CTS_LANG: 'en', CTS_DOC2MD_NO_AUTOINSTALL: '1' });
  const result = spawnSync(process.execPath, [CLI, 'codex-hook', '--event', 'prompt', '--agent', 'codex'], {
    cwd: home, env, encoding: 'utf8', timeout: 10000,
    input: JSON.stringify({ session_id: 'main', cwd: home, transcript_path: transcript, prompt: 'Read first.pdf and second.pdf' }),
  });
  assert.equal(result.status, 0, result.stderr);
  const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(text, /95%/);
  assert.match(text, /first.pdf: conversion failed \(cache-unavailable\)/);
  assert.ok(text.includes(second.cacheFile.replace(/\.md$/, '.codex.md')));
  const history = spawnSync(process.execPath, [CLI, 'history', '--format', 'json', '--agent', 'codex'], {
    cwd: home, env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(history.status, 0, history.stderr);
  assert.equal(JSON.parse(history.stdout).events.length, 1, 'the delivered warning remains in history');
  const failedCli = spawnSync(process.execPath, [CLI, 'doc2md', join(home, 'first.pdf'), '--agent', 'codex'], {
    cwd: home, env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(failedCli.status, 1);
  assert.match(failedCli.stderr, /Doc2md failed: cache-unavailable/);
  assert.doesNotMatch(failedCli.stdout, /Converted|Cached/);
  assert.equal(existsSync(join(home, '.claude')), false);
});

test('document writes, moves, and cache paths behind symlinks are protected before writes', (t) => {
  const cwd = fixture(t);
  for (const tool_input of [{ command: '*** Begin Patch\n*** Add File: book.pdf\n+text\n*** End Patch' },
    { content: '*** Begin Patch\n*** Update File: a.md\n*** Move to: book.xlsx\n@@\n-a\n+b\n*** End Patch' }]) {
    assert.equal(codexDocumentTool({ cwd, tool_name: 'apply_patch', tool_input }).hookSpecificOutput.permissionDecision, 'deny');
  }
  const binaryDeny = codexDocumentTool({ cwd, tool_name: 'Bash', tool_input: { command: 'echo broken > book.pptx' } }).hookSpecificOutput;
  assert.equal(binaryDeny.permissionDecision, 'deny');
  assert.doesNotMatch(binaryDeny.permissionDecisionReason, /[가-힣]/, 'the default write guard must speak English to Codex, not Korean');
  assert.equal(codexDocumentTool({ cwd, tool_name: 'Bash', tool_input: { command: 'cp book.pptx copy.pptx' } }), null);
  const cache = join(cwd, 'cache'); mkdirSync(cache); symlinkSync(cache, join(cwd, 'alias'));
  const out = codexDocumentTool({ cwd, tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: alias/new.md\n+x\n*** End Patch' } },
    { guard: ({ tool_input }) => tool_input.file_path.startsWith(realpathSync(cache) + sep) ? { deny: true, reason: 'cache' } : null });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('Codex CLI status, prompt, pre-read and off use shared cached conversions without installing or touching Claude settings', (t) => {
  const home = fixture(t), state = join(home, 'cfg'), source = join(home, 'book.pdf');
  writeFileSync(source, 'cached fixture, not a real PDF');
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = state;
  let cached;
  try { cached = doc2md.writeCache(source, '# Extracted text\n', { pages: 1 }); }
  finally { if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; }
  const env = childEnv({ HOME: home, CODEX_HOME: join(home, 'codex'), XDG_CONFIG_HOME: state, CTS_LANG: 'en', CTS_DOC2MD_NO_AUTOINSTALL: '1', CTS_NO_KOREAN: '1' });
  const run = (args, payload) => spawnSync(process.execPath, [CLI, ...args, '--agent', 'codex'], { cwd: home, env, input: payload && JSON.stringify(payload), encoding: 'utf8', timeout: 10000 });
  const status = run(['doc2md', 'status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Codex document conversion: on/);
  assert.equal(run(['doc2md', source]).status, 0);
  assert.equal(run(['doc2md', 'on']).status, 0);
  const p = { cwd: home, tool_name: 'Bash', tool_input: { command: 'cat book.pdf' } };
  const out = JSON.parse(run(['codex-hook', '--event', 'pre-tool'], p).stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  const codexFile = cached.cacheFile.replace(/\.md$/, '.codex.md');
  assert.ok(out.permissionDecisionReason.includes(codexFile));
  const prompt = JSON.parse(run(['codex-hook', '--event', 'prompt'], { cwd: home, prompt: 'Summarize book.pdf' }).stdout).hookSpecificOutput.additionalContext;
  assert.ok(prompt.includes(codexFile)); assert.doesNotMatch(prompt, /\$/);
  assert.doesNotMatch(readFileSync(codexFile, 'utf8'), /\$|아꼈습니다/);
  assert.match(readFileSync(codexFile, 'utf8'), /Extracted text/);
  const panel = run(['--statusline', '--text', '--single-line']);
  assert.match(panel.stdout, /Doc2md 1 docs \(Codex total\)/);
  assert.equal(run(['doc2md', 'off']).status, 0);
  assert.equal(run(['codex-hook', '--event', 'pre-tool'], p).stdout, '');
  assert.equal(readFileSync(cached.cacheFile, 'utf8').includes('Extracted text'), true);
  assert.equal(existsSync(join(home, '.claude')), false);
});
