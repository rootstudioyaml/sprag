/**
 * doc2md decides, per Read, whether the model gets a converted Markdown file
 * or the original. The conversion itself is markitdown's job and is verified
 * by hand against real fixtures; what has to hold here is the surrounding
 * contract, because every branch of it is a way to break someone's Read:
 *
 *   - files it has no business touching are left completely alone
 *   - a conversion that cannot happen never blocks the original Read
 *   - a hostile archive is the one thing that does block
 *   - conversions are cached by source mtime and size, and never land in the
 *     user's project directory
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { childEnv } from './helpers/child-env.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);

function isolated(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-doc2md-'));
  const prevData = process.env.XDG_CONFIG_HOME;
  const prevPy = process.env.CTS_DOC2MD_PYTHON;
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    if (prevData === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevData;
    if (prevPy === undefined) delete process.env.CTS_DOC2MD_PYTHON;
    else process.env.CTS_DOC2MD_PYTHON = prevPy;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// Stands in for markitdown so the suite stays dependency-free. It speaks the
// same JSON the real converter does.
function stubConverter(dir, body) {
  const file = join(dir, 'stub.py');
  writeFileSync(file, body);
  return file;
}

const OK_STUB = `import json, sys
json.dump({"ok": True, "markdown": "# 제목\\n| a | b |", "note": None,
           "truncated": False, "rows": 0}, sys.stdout)
`;

test('only the formats the model cannot read itself are targets', () => {
  const d = require('../src/doc2md.cjs');
  for (const ext of ['.pptx', '.xlsx', '.xls', '.pdf', '.docx']) {
    assert.equal(d.isTargetPath(`/tmp/report${ext}`), true, ext);
  }
  // Source, prose and images are read natively. Images especially: markitdown
  // returns nothing for them and OCR misread resource names in testing, which
  // is worse than no text in a document where the names are the content.
  for (const ext of ['.md', '.py', '.txt', '.json', '.png', '.jpg']) {
    assert.equal(d.isTargetPath(`/tmp/report${ext}`), false, ext);
  }
  assert.equal(d.isTargetPath(''), false);
  assert.equal(d.isTargetPath(null), false);
  // Case from a Windows-authored attachment still counts.
  assert.equal(d.isTargetPath('/tmp/DECK.PPTX'), true);
});

test('the hook stays out of the way of everything it does not own', (t) => {
  isolated(t);
  const d = require('../src/doc2md.cjs');
  assert.equal(d.decideForRead(null), null);
  assert.equal(d.decideForRead({ tool_name: 'Write', tool_input: { file_path: '/tmp/a.pptx' } }), null);
  assert.equal(d.decideForRead({ tool_name: 'Read', tool_input: { file_path: '/tmp/a.md' } }), null);
  assert.equal(d.decideForRead({ tool_name: 'Read', tool_input: {} }), null);
});

test('a successful conversion blocks the Read and names the replacement', (t) => {
  const dir = isolated(t);
  const d = require('../src/doc2md.cjs');
  const src = join(dir, 'deck.pptx');
  writeFileSync(src, 'not really a pptx, the stub does not look');

  const converted = d.convert(src, { converter: stubConverter(dir, OK_STUB), python: 'python3' });
  if (!converted.ok && converted.reason === 'no-markitdown') {
    t.skip('no python on this machine');
    return;
  }
  assert.equal(converted.ok, true);
  assert.match(readFileSync(converted.cacheFile, 'utf8'), /제목/);

  // Not beside the original, and not inside the project: a plain-text copy of
  // a possibly confidential attachment must not end up somewhere people
  // commit, and requiring a .gitignore entry is a step users would forget.
  assert.ok(!converted.cacheFile.startsWith(dir + '/deck'));
  assert.match(converted.cacheFile, /doc2md-cache/);
  // POSIX permission bits only: Windows reports 0o666 for everything, so the
  // assertion would be testing the platform rather than the code.
  if (process.platform !== 'win32') {
    assert.equal(statSync(d.cacheDir()).mode & 0o777, 0o700);
  }

  // Allowing the Read and merely mentioning the .md would put the binary in
  // the context window anyway, which is the whole cost being avoided.
  const decision = d.decideForRead({ tool_name: 'Read', tool_input: { file_path: src } });
  assert.equal(decision.deny, true);
  assert.match(decision.reason, /deck\.pptx/);
  assert.match(decision.reason, /doc2md-cache/);
  const out = JSON.parse(d.formatHookOutput(decision));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('a second read hits the cache; touching the source invalidates it', (t) => {
  const dir = isolated(t);
  const d = require('../src/doc2md.cjs');
  const conv = { converter: stubConverter(dir, OK_STUB), python: 'python3' };
  const src = join(dir, 'sheet.xlsx');
  writeFileSync(src, 'v1');

  const first = d.convert(src, conv);
  if (!first.ok) {
    t.skip('no python on this machine');
    return;
  }
  assert.equal(first.cached, false);
  assert.equal(d.convert(src, conv).cached, true);

  // Same size, new mtime: the cache keys on both, so an edited source is not
  // served from a stale conversion.
  writeFileSync(src, 'v2');
  assert.equal(d.convert(src, conv).cached, false);
});

test('nothing that fails to convert takes the original Read down with it', (t) => {
  const dir = isolated(t);
  const d = require('../src/doc2md.cjs');
  const src = join(dir, 'deck.pptx');
  writeFileSync(src, 'x');

  const cases = {
    'no-text': `import json, sys
json.dump({"ok": False, "reason": "no-text", "detail": "converter returned nothing"}, sys.stdout)
`,
    'bad-archive': `import json, sys
json.dump({"ok": False, "reason": "bad-archive", "detail": "File is not a zip file"}, sys.stdout)
`,
  };
  for (const [reason, body] of Object.entries(cases)) {
    rmSync(d.cacheDir(), { recursive: true, force: true });
    const decision = d.decideForRead(
      { tool_name: 'Read', tool_input: { file_path: src } },
      { converter: stubConverter(dir, body), python: 'python3' },
    );
    if (!decision) {
      t.skip('no python on this machine');
      return;
    }
    assert.equal(decision.deny, false, `${reason} must let the Read through`);
    assert.match(decision.reason, /doc2md/);
  }

  // An empty .md would read to the model as a document with nothing in it,
  // which is a different and worse claim than "could not extract".
  const scanned = d.decideForRead(
    { tool_name: 'Read', tool_input: { file_path: src } },
    { converter: stubConverter(dir, cases['no-text']), python: 'python3' },
  );
  assert.match(scanned.reason, /추출하지 못했습니다/);
});

test('a zip bomb is the one thing that blocks without converting', (t) => {
  const dir = isolated(t);
  const d = require('../src/doc2md.cjs');
  const src = join(dir, 'deck.pptx');
  writeFileSync(src, 'x');
  const decision = d.decideForRead(
    { tool_name: 'Read', tool_input: { file_path: src } },
    {
      python: 'python3',
      converter: stubConverter(dir, `import json, sys
json.dump({"ok": False, "reason": "unsafe-archive", "detail": "expands past 524288000 bytes"}, sys.stdout)
`),
    },
  );
  if (!decision) {
    t.skip('no python on this machine');
    return;
  }
  assert.equal(decision.deny, true);
  assert.match(decision.reason, /압축 폭탄/);
});

test('size and filename limits are checked before a converter is ever spawned', (t) => {
  const dir = isolated(t);
  const d = require('../src/doc2md.cjs');

  // A filename that says the contents should not be cached as plain text.
  // Blunt on purpose: skipping a payroll deck costs one manual step, caching
  // it is not recoverable.
  for (const name of ['2026-salary.xlsx', 'secret-plan.pptx', '개인정보-명단.xlsx']) {
    const p = join(dir, name);
    writeFileSync(p, 'x');
    assert.equal(d.isSensitivePath(p), true, name);
    assert.equal(d.convert(p, { converter: '/nonexistent' }).reason, 'sensitive');
  }

  const missing = d.convert(join(dir, 'nope.pdf'), { converter: '/nonexistent' });
  assert.equal(missing.reason, 'missing');
  assert.equal(d.convert(join(dir, 'notes.md'), { converter: '/nonexistent' }).reason, 'not-target');
});

test('the install/remove pair touches only its own PreToolUse entry', (t) => {
  const dir = isolated(t);
  const home = join(dir, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const settingsPath = join(home, '.claude', 'settings.json');
  const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'somebody-elses-hook' }] };
  writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [foreign] } }, null, 2));

  // A child process, because the installer resolves ~/.claude through
  // os.homedir(), which cannot be redirected inside a running process. The
  // real machine's settings.json is not a safe thing to test against.
  const script = `
    import { installDoc2mdHook, removeDoc2mdHook } from ${JSON.stringify(new URL('../src/installer.js', import.meta.url).href)};
    const steps = [];
    steps.push(installDoc2mdHook().action);
    steps.push(installDoc2mdHook().action);
    const { readFileSync } = await import('node:fs');
    const parsed = JSON.parse(readFileSync(process.env.HOME + '/.claude/settings.json', 'utf8')).hooks;
    steps.push(Object.keys(parsed).sort().join('+'));
    steps.push(parsed.PreToolUse.map((m) => m.matcher).sort().join('+'));
    steps.push(removeDoc2mdHook().action);
    steps.push(removeDoc2mdHook().action);
    console.log(JSON.stringify(steps));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: childEnv({ HOME: home }),
  });
  assert.equal(run.status, 0, run.stderr);
  const [created, again, events, matchers, removed, absent] = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.equal(created, 'created');
  assert.equal(again, 'exists', 'installing twice must not duplicate the entry');
  // Both halves, or the feature only half works: PreToolUse cannot see pptx,
  // and UserPromptSubmit is the only place that can.
  assert.equal(events, 'PreToolUse+UserPromptSubmit');
  // Read for the conversion, Edit|Write for the one-way guard, plus the
  // foreign Bash entry that was already there.
  assert.equal(matchers, 'Bash+Edit|Write+Read');
  assert.equal(removed, 'removed');
  assert.equal(absent, 'absent');

  // The child wrote the file between install and remove, so read what it left:
  // the foreign hook has to be exactly as it started.
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.deepEqual(settings.hooks.PreToolUse, [foreign], "someone else's hook survives");
});

test('document paths are picked out of prompt text in every form users write them', () => {
  const d = require('../src/doc2md.cjs');
  const found = d.documentPathsIn(
    'compare @/tmp/a.pptx with "/tmp/b.xlsx" and /tmp/c.PDF, then ./rel/d.docx',
  );
  // The scanner returns resolved absolute paths, which use the platform's own
  // separator — compare on the shape, not on the slash.
  const ends = (suffix) => found.some((p) => p.split(/[\\/]/).slice(-2).join('/') === suffix);
  assert.ok(ends('tmp/a.pptx'), 'an @ reference');
  assert.ok(ends('tmp/b.xlsx'), 'a quoted path');
  assert.ok(ends('tmp/c.PDF'), 'an uppercase extension');
  assert.ok(ends('rel/d.docx'), 'a relative path, resolved');

  // A Windows path is a path. Before this, the scanner matched none of these
  // and simply reported no documents on that platform.
  const win = d.documentPathsIn('C:\\Users\\me\\기획서.pptx 와 \\\\nas\\team\\보고서.docx 확인');
  assert.equal(win.length, 2, JSON.stringify(win));
  // Nothing to convert means nothing to say.
  assert.deepEqual(d.documentPathsIn('fix the README and run the tests'), []);
  assert.deepEqual(d.documentPathsIn(null), []);
});

test('a prompt naming a document gets its conversion as context', (t) => {
  const dir = isolated(t);
  const d = require('../src/doc2md.cjs');
  const src = join(dir, 'deck.pptx');
  writeFileSync(src, 'x');

  // This path exists because PreToolUse cannot reach these formats at all:
  // Claude Code refuses pptx/xlsx/docx as binary before any hook runs, which
  // was verified by watching a .pdf Read fire the hook while a .pptx Read
  // never did. UserPromptSubmit runs before all of that.
  const ctx = d.contextForPrompt(
    { hook_event_name: 'UserPromptSubmit', prompt: `요약해줘 ${src}` },
    { converter: stubConverter(dir, OK_STUB), python: 'python3', lang: 'ko' },
  );
  if (ctx === null) {
    t.skip('no python on this machine');
    return;
  }
  assert.match(ctx, /doc2md/);
  assert.match(ctx, /deck\.pptx/);
  assert.match(ctx, /doc2md-cache/);

  // A prompt with no document in it must cost nothing and say nothing.
  assert.equal(d.contextForPrompt({ prompt: 'run the tests' }), null);
  assert.equal(d.contextForPrompt({}), null);
  assert.equal(d.contextForPrompt(null), null);

  // A path that does not exist is not an error to report; the user may simply
  // be talking about a file they intend to create.
  assert.equal(d.contextForPrompt({ prompt: `see ${join(dir, 'ghost.pptx')}` }), null);
});

test('the session note tells the model both things it cannot work out alone', () => {
  const d = require('../src/doc2md.cjs');
  for (const lang of ['ko', 'en']) {
    const note = d.sessionNote(lang);
    assert.match(note, /doc2md/);
    // The recovery for the binary-file refusal it will otherwise be stuck on.
    assert.match(note, /sprag doc2md/);
  }
  // An English session must not be steered into Korean by an injected block.
  assert.doesNotMatch(d.sessionNote('en'), /[가-힣]/);
});

test('a hook naming a subcommand this build lacks prints nothing at all', () => {
  // The failure this guards against actually shipped: a 3.25.0 global install
  // against a settings.json written by 3.26.0 did not recognise `doc2md`, fell
  // through to the default report, and pushed a full statistics table into the
  // hook stream on every Read. Silence is the only safe answer.
  const run = spawnSync(process.execPath, ['bin/cli.js', 'no-such-subcommand', '--hook'], {
    encoding: 'utf8',
    input: '{"tool_name":"Read","tool_input":{"file_path":"/tmp/x.pptx"}}',
    // fileURLToPath, not `.pathname`: on Windows the latter yields
    // `/D:/a/repo`, which is not a directory any process can start in.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), '', 'an unknown subcommand under --hook must stay silent');
});

test('the registered hook sets no timeout of its own', (t) => {
  const dir = isolated(t);
  const home = join(dir, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const script = `
    import { installDoc2mdHook } from ${JSON.stringify(new URL('../src/installer.js', import.meta.url).href)};
    installDoc2mdHook();
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: childEnv({ HOME: home }),
  });
  assert.equal(run.status, 0, run.stderr);
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  const mine = settings.hooks.PreToolUse.find((m) => m.matcher === 'Read');
  assert.match(mine.hooks[0].command, /doc2md --hook/);
  // Claude Code defaults command hooks to ten minutes, so naming a number
  // could only lower that ceiling — and a cold markitdown import measured at
  // twelve seconds before any conversion starts.
  assert.equal(mine.hooks[0].timeout, undefined);
});

test('a non-Latin file name survives into the cache path instead of becoming underscores', () => {
  const d = require('../src/doc2md.cjs');
  const korean = basename(d.cachePathFor('/tmp/사업계획서(초안).docx'));
  assert.match(korean, /^사업계획서_초안_\.docx\.[0-9a-f]{12}\.md$/);

  // Separators and other path-hostile characters are still replaced, and a run
  // of them collapses so the name stays readable.
  const messy = basename(d.cachePathFor('/tmp/a b:c/d  e**f.pptx'));
  assert.match(messy, /^d_e_f\.pptx\.[0-9a-f]{12}\.md$/);

  // Two files whose names sanitise identically still get distinct cache files.
  assert.notEqual(d.cachePathFor('/tmp/한글.pdf'), d.cachePathFor('/other/한글.pdf'));
});


test('a conversion carries provenance and lands in the savings ledger', (t) => {
  const dir = isolated(t);
  const d = require('../src/doc2md.cjs');
  const ledger = require('../src/doc2md-ledger.cjs');
  const src = join(dir, 'deck.pptx');
  writeFileSync(src, 'PK pretend deck');

  const out = d.convert(src, { converter: stubConverter(dir, OK_STUB), python: 'python3' });
  if (!out.ok) return; // no usable python3 here; the ledger tests below still cover the math

  const text = readFileSync(out.cacheFile, 'utf8');
  // Someone opening a stray .md must be able to tell what made it, and from what.
  assert.match(text, /sprag doc2md/);
  assert.ok(text.includes(src));
  assert.match(text, /# 제목/); // the conversion itself still follows the banner

  const totals = ledger.doc2mdSavedTotals(join(dir, 'claude-token-saver'));
  assert.equal(totals.docs, 1);
  assert.equal(totals.byExt[0].ext, 'pptx');
});

test('each format is priced against the fallback it actually has', () => {
  const ledger = require('../src/doc2md-ledger.cjs');
  const markdown = 'x'.repeat(4000); // ~1,000 tokens

  // A PDF attached whole is billed per page, so reading it as text is worth
  // real money.
  const pdf = ledger.estimateSaving({ ext: '.pdf', pages: 10, markdown });
  assert.equal(pdf.baseline, 10 * ledger.PDF_TOKENS_PER_PAGE);
  assert.ok(pdf.usd > 0);

  // A deck never reaches the model as an attachment at all; the fallback is
  // unzipping it, so the body XML is what the conversion is measured against.
  const pptx = ledger.estimateSaving({ ext: '.pptx', markupBytes: 400_000, markdown });
  assert.equal(pptx.baseline, 100_000);
  assert.ok(pptx.usd > pdf.usd);

  // A container whose markup could not be measured claims nothing.
  const blind = ledger.estimateSaving({ ext: '.pptx', markdown });
  assert.equal(blind.usd, 0);
  assert.equal(blind.baseline, blind.tokens);

  // A .fig is the one format Read does not refuse: it pulls the binary in as
  // text at a flat cost, whatever the file's size, so the baseline is flat too.
  const smallFig = ledger.estimateSaving({ ext: '.fig', markdown: 'x'.repeat(400) });
  const bigFig = ledger.estimateSaving({ ext: '.fig', markdown: 'x'.repeat(73_600) });
  assert.equal(smallFig.baseline, 44_000);
  assert.equal(bigFig.baseline, 44_000);
  assert.ok(smallFig.usd > bigFig.usd, 'a smaller conversion saves more against a flat baseline');

  // Neither baseline may fall below what the conversion actually produced —
  // that would report a negative saving as zero and understate the document.
  const wordy = ledger.estimateSaving({ ext: '.pdf', pages: 1, markdown: 'x'.repeat(40000) });
  assert.equal(wordy.baseline, wordy.tokens);
  assert.equal(wordy.usd, 0);
});

test('the ledger survives a corrupt file and counts a re-conversion once', (t) => {
  const dir = isolated(t);
  const ledger = require('../src/doc2md-ledger.cjs');
  writeFileSync(join(dir, 'doc2md-ledger.json'), '{ not json');
  assert.equal(ledger.doc2mdSavedTotals(dir).docs, 0);

  ledger.recordConversion(dir, { key: '/a/b.pdf', ts: 1, usd: 0.5, ext: '.pdf', tokens: 10, baseline: 100 });
  assert.equal(ledger.doc2mdSavedTotals(dir).total, 0.5);
  // Converting the same source again updates its event instead of adding one.
  ledger.recordConversion(dir, { key: '/a/b.pdf', ts: 2, usd: 0.7, ext: '.pdf', tokens: 10, baseline: 100 });
  const after = ledger.doc2mdSavedTotals(dir);
  assert.equal(after.docs, 1);
  assert.equal(after.total, 0.7);
});


test('a .fig renders as an outline of its words, and an all-vector file refuses honestly', () => {
  const fig = require('../src/fig2md.cjs');
  const guid = (n) => ({ sessionID: 1, localID: n });
  const doc = {
    meta: { file_name: '온보딩 기획서' },
    nodes: [
      { type: 'DOCUMENT', guid: guid(0) },
      { type: 'CANVAS', name: 'Page 1', guid: guid(1) },
      { type: 'FRAME', name: '개요', guid: guid(2) },
      { type: 'TEXT', name: '목표', guid: guid(3), textData: { characters: '완료율 78% 회복' } },
      { type: 'TEXT', name: '숨김', guid: guid(4), visible: false, textData: { characters: '보이면 안 됨' } },
      { type: 'RECTANGLE', guid: guid(5) },
      { type: 'VECTOR', guid: guid(6) },
    ],
    childrenMap: new Map(),
  };
  const byId = (n) => doc.nodes.find((x) => x.guid.localID === n);
  doc.childrenMap.set('1:0', [byId(1)]);
  doc.childrenMap.set('1:1', [byId(2), byId(5)]);
  doc.childrenMap.set('1:2', [byId(3), byId(4), byId(6)]);

  const { markdown, textNodes } = fig.renderMarkdown(doc, 'fallback');
  assert.match(markdown, /^# 온보딩 기획서/);
  assert.match(markdown, /## Page 1/);
  assert.match(markdown, /### 개요/);
  assert.match(markdown, /\*\*목표\*\*: 완료율 78% 회복/);
  // Hidden layers and shapes stay out of the text; shapes are counted instead.
  assert.ok(!markdown.includes('보이면 안 됨'));
  assert.match(markdown, /RECTANGLE 1개/);
  assert.equal(textNodes, 1);

  // No words at all is a refusal, not an empty document.
  const bare = fig.renderMarkdown({ nodes: [{ type: 'DOCUMENT', guid: guid(0) }], childrenMap: new Map() }, 'x');
  assert.equal(bare.textNodes, 0);
});

test('.fig is a target format and its cache path survives the extension', () => {
  const d = require('../src/doc2md.cjs');
  assert.equal(d.isTargetPath('/tmp/기획서.fig'), true);
  assert.match(basename(d.cachePathFor('/tmp/기획서.fig')), /^기획서\.fig\.[0-9a-f]{12}\.md$/);
});


test('writes to a conversion or an original document are refused with directions', (t) => {
  const dir = isolated(t);
  const d = require('../src/doc2md.cjs');

  // Build a real cache entry so the deny can name the source.
  const src = join(dir, 'deck.pptx');
  writeFileSync(src, 'PK pretend');
  const out = d.convert(src, { converter: stubConverter(dir, OK_STUB), python: 'python3' });

  if (out.ok) {
    const deny = d.decideForWrite({ tool_name: 'Edit', tool_input: { file_path: out.cacheFile } });
    assert.equal(deny.deny, true);
    assert.ok(deny.reason.includes(src), 'the deny names the original document');
  }

  // The original binary is protected from both text-writing tools.
  for (const tool of ['Edit', 'Write']) {
    const deny = d.decideForWrite({ tool_name: tool, tool_input: { file_path: src } });
    assert.equal(deny.deny, true);
  }
  // Everything else passes through untouched, including Reads.
  assert.equal(d.decideForWrite({ tool_name: 'Write', tool_input: { file_path: join(dir, 'notes.md') } }), null);
  assert.equal(d.decideForWrite({ tool_name: 'Read', tool_input: { file_path: src } }), null);
});


test('the interpreter probe rejects a half-finished install and an outdated Python', (t) => {
  const dir = isolated(t);
  const d = require('../src/doc2md.cjs');

  // A base interpreter is only accepted at 3.10+, because pip resolves
  // markitdown to a 2019 placeholder release on anything older and every
  // conversion then dies at import time.
  const base = d.findVenvBase();
  if (base) assert.match(base.version, /python 3\.(1[0-9]|[2-9][0-9])/);

  // The readiness probe imports the class, not the package: mid-install the
  // package directory exists while the class does not.
  const halfInstalled = join(dir, 'half.py');
  writeFileSync(halfInstalled, 'import sys; sys.exit(0)');
  assert.equal(typeof d.ensureConverterInstalled, 'function');

  // With auto-install switched off, nothing is spawned and the answer is a
  // plain false — the escape hatch a locked-down machine needs.
  const prev = process.env.CTS_DOC2MD_NO_AUTOINSTALL;
  process.env.CTS_DOC2MD_NO_AUTOINSTALL = '1';
  t.after(() => {
    if (prev === undefined) delete process.env.CTS_DOC2MD_NO_AUTOINSTALL;
    else process.env.CTS_DOC2MD_NO_AUTOINSTALL = prev;
  });
  assert.equal(d.ensureConverterInstalled({ waitMs: 10 }), false);
});


test('an encrypted document is reported as locked, never as corruption, and never blocks', (t) => {
  const dir = isolated(t);
  // Without this the isolated state directory looks like a fresh machine and
  // the auto-install fires for real: a 15s test that races its own cleanup.
  const prev = process.env.CTS_DOC2MD_NO_AUTOINSTALL;
  process.env.CTS_DOC2MD_NO_AUTOINSTALL = '1';
  t.after(() => {
    if (prev === undefined) delete process.env.CTS_DOC2MD_NO_AUTOINSTALL;
    else process.env.CTS_DOC2MD_NO_AUTOINSTALL = prev;
  });
  const d = require('../src/doc2md.cjs');

  // A password-protected OOXML is an OLE compound file, not a zip. Opening it
  // as a zip says "not a zip file", which reads as a broken download and
  // sends the user hunting for the wrong problem.
  const locked = join(dir, 'locked.docx');
  writeFileSync(locked, Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(512),
    Buffer.from('EncryptedPackage', 'utf16le'),
  ]));

  const decision = d.decideForRead({ tool_name: 'Read', tool_input: { file_path: locked } });
  if (decision) {
    // Whatever else happens, a document nobody can decrypt must not take the
    // Read down with it.
    assert.equal(decision.deny, false);
  }
});

test('the interpreter search follows the platform it is running on', (t) => {
  const d = require('../src/doc2md.cjs');
  const names = d.interpreterCandidates().map((c) => `${c.bin} ${c.args.join(' ')}`.trim());
  if (process.platform === 'win32') {
    // `python3` is rarely on PATH on Windows, and a bare `python` may be the
    // Store alias stub; the launcher is what actually finds an install.
    assert.ok(names.some((n) => n === 'py -3'), names.join(' | '));
    assert.ok(names.some((n) => n.endsWith('python.exe')), names.join(' | '));
  } else {
    assert.ok(names.includes('python3'), names.join(' | '));
  }
  // Both shapes survive the round trip into spawn arguments.
  assert.deepEqual(d.interpreterParts('/usr/bin/python3'), { bin: '/usr/bin/python3', args: [] });
  assert.deepEqual(d.interpreterParts({ bin: 'py', args: ['-3'] }), { bin: 'py', args: ['-3'] });
});

test('the .fig parser spec carries nothing cmd.exe would eat', () => {
  const fig = require('../src/fig2md.cjs');
  // `^` is the escape character in cmd.exe, where the Windows install runs.
  assert.ok(!fig.FIG_PARSER_SPEC.includes('^'), fig.FIG_PARSER_SPEC);
  assert.match(fig.FIG_PARSER_SPEC, /^openfig-core@[0-9x.]+$/);
});
