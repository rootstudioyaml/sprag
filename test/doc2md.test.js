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
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

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
  assert.equal(statSync(d.cacheDir()).mode & 0o777, 0o700);

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
    steps.push(removeDoc2mdHook().action);
    steps.push(removeDoc2mdHook().action);
    console.log(JSON.stringify(steps));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(run.status, 0, run.stderr);
  const [created, again, removed, absent] = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.equal(created, 'created');
  assert.equal(again, 'exists', 'installing twice must not duplicate the entry');
  assert.equal(removed, 'removed');
  assert.equal(absent, 'absent');

  // The child wrote the file between install and remove, so read what it left:
  // the foreign hook has to be exactly as it started.
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.deepEqual(settings.hooks.PreToolUse, [foreign], "someone else's hook survives");
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
    env: { ...process.env, HOME: home, USERPROFILE: home },
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
