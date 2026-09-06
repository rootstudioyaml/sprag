#!/usr/bin/env node
/**
 * verify-cli — exercise every user-facing subcommand on this OS.
 *
 * The unit suite runs the functions; this runs the CLI the way a person does,
 * against an isolated HOME, and asserts each command exits cleanly and says
 * something recognisable. It exists because the platform-specific breakage
 * this project has actually shipped was never in the logic: it was a home
 * directory resolved from the wrong variable, a `file://` URL used as a path,
 * a shell that needed `.cmd`, a console window popping up mid-prompt.
 *
 * No network, no installs, no writes outside the temp directory.
 *
 * Usage: node scripts/verify-cli.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repoRoot, 'bin', 'cli.js');
const work = mkdtempSync(join(tmpdir(), 'cts-cli-'));
const home = join(work, 'home');
const proj = join(work, 'proj');
mkdirSync(join(home, '.claude'), { recursive: true });
mkdirSync(proj, { recursive: true });

// Every child gets the sandbox home under whichever variable its platform
// reads: HOME on POSIX, USERPROFILE on Windows, and XDG/APPDATA for state.
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(work, 'state'),
  APPDATA: join(work, 'state'),
  CTS_DOC2MD_NO_AUTOINSTALL: '1',
  NO_COLOR: '1',
};

let failures = 0;
const rows = [];

function cts(args, { cwd = proj, input = undefined } = {}) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd, env, input, timeout: 120_000 }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

function check(name, cond, detail = '') {
  rows.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `\n        ${detail}`}`);
  if (!cond) failures += 1;
}

function ok(name, args, expect, opts) {
  const r = cts(args, opts);
  const matched = expect ? expect.test(r.out) : true;
  check(name, r.code === 0 && matched, `exit=${r.code} out=${r.out.slice(0, 300).replace(/\n/g, ' | ')}`);
  return r;
}

console.log(`platform: ${process.platform}  node: ${process.version}`);
console.log(`home:     ${home}\n`);

// --- surface that must work with no data at all -----------------------------
ok('--version prints a version', ['--version'], /\d+\.\d+\.\d+/);
ok('--demo renders a table', ['--demo', 'table'], /Cache|캐시|token/i);
ok('--statusline survives an empty home', ['--statusline', '--no-color', '--days', '1'], /./);
{
  // Exit 1 is correct here (nothing was found); what matters is that the
  // output a machine asked for is still machine-readable.
  const r = cts(['--format', 'json', '--days', '1']);
  let parsed = null;
  try { parsed = JSON.parse(r.out); } catch { /* reported below */ }
  check('--format json stays JSON when there is no data',
    parsed !== null && parsed.error === 'no-session-data', r.out.slice(0, 200));
}

// --- harness ----------------------------------------------------------------
ok('harness init writes the block', ['harness', 'init'], /CLAUDE\.md|wrote|작성/i);
check('harness init produced CLAUDE.md', existsSync(join(proj, 'CLAUDE.md')), 'file missing');
ok('harness check reads it back', ['harness', 'check'], /5\/5|5 of 5|섹션/i);
ok('harness promote appends a rule', ['harness', 'promote', 'verify: a → b', '--project'], /ratchet|Appended|추가/i);
{
  const ratchet = join(proj, '.claude', 'ratchet.md');
  check('promoted rule landed in ratchet.md',
    existsSync(ratchet) && /verify: a/.test(readFileSync(ratchet, 'utf8')), ratchet);
}
ok('harness list shows the promoted rule', ['harness', 'list'], /verify: a|1\./);
// Windows once returned an empty preset list here, silently, because the file
// was read through a `file://` URL path.
ok('harness pull offers preset rules', ['harness', 'pull', '--dry-run'], /\S/);

// --- korean style -----------------------------------------------------------
{
  const bad = join(work, 'sample.md');
  // Built from a code point on purpose: this line is a fixture that must
  // contain the very separator the linter rejects, and writing it literally
  // would make this file fail the project's own Korean style check.
  const emDash = String.fromCharCode(0x2014);
  writeFileSync(bad, `이 문장은 하나의 예시 ${emDash} 구분자를 포함합니다.\n`);
  const r = cts(['korean', 'lint', bad]);
  check('korean lint runs and reports', r.out.length > 0, `exit=${r.code}`);
}

// --- route-scan / rules -----------------------------------------------------
ok('route-scan rules works with no scan yet', ['route-scan', 'rules'], /\S/);
ok('route-scan savings works with no ledger', ['route-scan', 'savings'], /\S/);

// --- doc2md surface (no converter installed in this sandbox) -----------------
ok('doc2md status reports converter + hooks', ['doc2md'], /converter|변환기|hook/i);
ok('doc2md on registers hooks', ['doc2md', 'on'], /hook|훅/i);
{
  const settings = join(home, '.claude', 'settings.json');
  const parsed = existsSync(settings) ? JSON.parse(readFileSync(settings, 'utf8')) : {};
  const matchers = (parsed.hooks?.PreToolUse || []).map((m) => m.matcher).sort().join('+');
  check('both hook matchers are registered', matchers === 'Edit|Write+Read', `got ${matchers || '(none)'}`);
  check('the prompt hook is registered', Array.isArray(parsed.hooks?.UserPromptSubmit), 'missing');
}
ok('doc2md off removes them', ['doc2md', 'off'], /hook|훅/i);
{
  const settings = join(home, '.claude', 'settings.json');
  const parsed = existsSync(settings) ? JSON.parse(readFileSync(settings, 'utf8')) : {};
  const left = JSON.stringify(parsed.hooks || {});
  check('nothing of ours is left behind', !left.includes('doc2md'), left.slice(0, 200));
}

// A hook payload naming a document must never crash or print noise, even with
// no converter available.
{
  const r = cts(['doc2md', '--hook'], { input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: join(work, 'nope.pptx') } }) });
  check('Read hook stays quiet when it has nothing to say', r.code === 0, `exit=${r.code} out=${r.out.slice(0, 200)}`);
}
{
  const r = cts(['doc2md', '--hook-prompt'], { input: JSON.stringify({ prompt: 'nothing to convert here' }) });
  check('prompt hook stays quiet on an ordinary prompt', r.code === 0 && r.out.trim() === '', `exit=${r.code} out=${r.out.slice(0, 200)}`);
}

// --- install / uninstall ----------------------------------------------------
ok('install wires the statusline', ['install'], /settings|statusline|설치/i);
ok('uninstall reports what it removed', ['uninstall'], /removed|제거|Nothing/i);
{
  const settings = join(home, '.claude', 'settings.json');
  const left = existsSync(settings) ? readFileSync(settings, 'utf8') : '';
  check('uninstall leaves none of our entries behind', !left.includes('claude-token-saver'), left.slice(0, 200));
}

console.log(rows.join('\n'));
rmSync(work, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
