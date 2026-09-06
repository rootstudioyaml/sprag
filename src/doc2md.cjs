/**
 * doc2md — hand the model a Markdown rendering of an attached document
 * instead of the binary.
 *
 * A pptx or xlsx read straight into the context window is close to the worst
 * thing a token-saving tool can allow: the bytes are unreadable to the model,
 * so it either gets nothing useful or spends a fortune finding that out. This
 * intercepts the Read, converts the file once, caches the result, and points
 * the model at the .md.
 *
 * CommonJS on purpose. It runs from ~/.claude/ through the copied hook script,
 * where there is no package.json to declare `"type": "module"`, which is the
 * same reason korean-lint.cjs is written this way.
 *
 * Conversion is markitdown, a Python package. It cannot be an npm dependency,
 * so a missing install is an ordinary state rather than an error: say so once,
 * then get out of the way and let the Read proceed untouched. Failing loudly
 * on every Read would be worse than the problem being solved, and failing
 * silently is how graphify's `except ImportError: return ""` hid a broken
 * converter for months.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ledger = require('./doc2md-ledger.cjs');

// Formats where the original is of no use to the model. Images are absent
// deliberately: markitdown returns nothing for them, and OCR misread resource
// names in testing (`c5.xlarge` as `c.xlarge`), which is worse than no text at
// all in a document where those names are the content. The model reads images
// natively anyway.
// `.fig` converts through openfig-core in Node rather than markitdown; see
// fig2md.cjs for why it cannot go through the Python path.
const TARGET_EXTENSIONS = ['.pptx', '.xlsx', '.xls', '.pdf', '.docx', '.fig'];

// Big enough for real decks and reports, small enough that a hostile file
// cannot make the converter the expensive part of the turn.
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
// A conversion larger than this costs more to read than it saves.
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
// Cold `import markitdown` measured at ~12s; conversions after that are under
// two seconds except for very large workbooks, which the row cap handles.
const CONVERT_TIMEOUT_MS = 120_000;

// Names that suggest the file should not be left lying around as plain text.
// Deliberately blunt: the cost of skipping a payroll deck is one extra manual
// step, and the cost of caching it is not recoverable.
const SENSITIVE_PATTERNS = [
  /secret/i, /password/i, /credential/i, /salary/i, /payroll/i, /confidential/i,
  /개인정보/, /급여/, /계약/, /대외비/,
];

// Mirrors src/paths.js userDataDir(). Duplicated rather than imported because
// this file is CommonJS and paths.js is ESM; the precedence order has to match
// it exactly, or conversions would land somewhere the rest of the tool does
// not look.
function userDataDir() {
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

/**
 * Where conversions live.
 *
 * Not next to the original, and not in the project's own `.claude/`: either
 * one drops a plain-text copy of a possibly confidential attachment into a
 * directory people commit. Keeping it in the tool's own state directory means
 * there is nothing for the user to remember to gitignore.
 */
function cacheDir() {
  return path.join(userDataDir(), 'doc2md-cache');
}

function ensureCacheDir() {
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir honours the mode only on creation, so an older directory made with
  // the default mask is tightened here.
  try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
  return dir;
}

function isTargetPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  return TARGET_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function isSensitivePath(filePath) {
  const base = path.basename(filePath || '');
  return SENSITIVE_PATTERNS.some((re) => re.test(base));
}

/**
 * Cache path for a source file. The hash covers the absolute path, so two
 * `report.pptx` files in different projects do not overwrite each other.
 */
function cachePathFor(filePath) {
  const abs = path.resolve(filePath);
  const hash = crypto.createHash('sha256').update(abs).digest('hex').slice(0, 12);
  // Keep letters and digits of any script, so a Korean or Japanese file name
  // stays readable in the cache directory instead of collapsing into a row of
  // underscores. Only characters that are awkward in a path are replaced.
  const base = path.basename(abs)
    .replace(/[^\p{L}\p{N}._-]/gu, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 80);
  return path.join(cacheDir(), `${base}.${hash}.md`);
}

function metaPathFor(cacheFile) {
  return cacheFile.replace(/\.md$/, '.meta.json');
}

/** A cached conversion still matching the source's mtime and size, or null. */
function readCache(filePath) {
  const cacheFile = cachePathFor(filePath);
  try {
    const src = fs.statSync(filePath);
    const meta = JSON.parse(fs.readFileSync(metaPathFor(cacheFile), 'utf8'));
    if (meta.size !== src.size || meta.mtimeMs !== src.mtimeMs) return null;
    fs.statSync(cacheFile);
    return { cacheFile, meta };
  } catch {
    return null;
  }
}

/** `31854740` → `30.4MB`, for the banner and the hook's one-line summary. */
function humanBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * The header stamped onto every conversion.
 *
 * Without it a conversion is an anonymous .md in a directory nobody opened on
 * purpose, and the reader has no way to tell that this tool produced it, from
 * what, or when. Four lines of provenance answer all of that at the top of the
 * file the model is about to read, and cost about 60 tokens.
 */
function banner(sourcePath, saving) {
  const src = fs.statSync(sourcePath);
  const lines = [
    '<!--',
    'claude-token-saver doc2md 가 변환한 파일입니다. 직접 편집하지 마십시오.',
    `원본: ${path.resolve(sourcePath)} (${humanBytes(src.size)})`,
    `변환: ${new Date().toISOString()} · Markdown ${humanBytes(Buffer.byteLength(saving.markdown, 'utf8'))} · 약 ${saving.tokens.toLocaleString('en-US')} 토큰`,
  ];
  if (saving.usd > 0) {
    const savedTokens = Math.max(0, saving.baseline - saving.tokens);
    // The alternative differs by format, so the sentence names it: a PDF
    // would have been attached, a zip document would have been unpacked.
    const alternative = path.extname(sourcePath).toLowerCase() === '.pdf'
      ? '원본을 첨부하면'
      : '압축을 풀어 본문 XML을 읽으면';
    lines.push(
      `${alternative} 약 ${saving.baseline.toLocaleString('en-US')} 토큰이 드는데, `
      + `변환본은 ${saving.tokens.toLocaleString('en-US')} 토큰입니다. `
      + `약 ${savedTokens.toLocaleString('en-US')} 토큰, $${saving.usd.toFixed(2)} 을 아꼈습니다(추정).`,
    );
  }
  lines.push('-->', '');
  return lines.join('\n');
}

function writeCache(filePath, markdown, extra) {
  ensureCacheDir();
  const cacheFile = cachePathFor(filePath);
  const src = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const saving = Object.assign(
    ledger.estimateSaving({
      ext,
      pages: (extra && extra.pages) || 0,
      markupBytes: (extra && extra.markupBytes) || 0,
      markdown,
    }),
    { markdown },
  );
  fs.writeFileSync(cacheFile, banner(filePath, saving) + markdown, { encoding: 'utf8', mode: 0o600 });
  ledger.recordConversion(userDataDir(), {
    key: path.resolve(filePath),
    ts: Date.now(),
    usd: saving.usd,
    ext,
    tokens: saving.tokens,
    baseline: saving.baseline,
  });
  const meta = Object.assign({
    source: path.resolve(filePath),
    size: src.size,
    mtimeMs: src.mtimeMs,
    convertedAt: new Date().toISOString(),
    // Carried in the metadata so the hook can report what the conversion cost
    // and saved without re-reading and re-measuring the markdown.
    markdownBytes: Buffer.byteLength(markdown, 'utf8'),
    tokens: saving.tokens,
    baselineTokens: saving.baseline,
    savedUsd: saving.usd,
  }, extra || {});
  fs.writeFileSync(metaPathFor(cacheFile), JSON.stringify(meta, null, 2), { encoding: 'utf8', mode: 0o600 });
  return { cacheFile, meta };
}

/**
 * A Python that can import markitdown, or null.
 *
 * Order matters: an explicit override first, then a `uv tool` install, then
 * whatever is on PATH. Probing costs a process spawn each, so the answer is
 * memoized for the life of this process, and the caller memoizes across
 * processes through the notice file.
 */
let interpreterCache;
function findInterpreter() {
  if (interpreterCache !== undefined) return interpreterCache;
  const candidates = [];
  if (process.env.CTS_DOC2MD_PYTHON) candidates.push(process.env.CTS_DOC2MD_PYTHON);
  candidates.push(
    // The tool's own venv, created by `doc2md install-converter`. First
    // because it is the only one this tool controls: telling people to
    // `pip install` into the system interpreter is how a token-saving CLI
    // ends up owning a break in someone else's project.
    managedPython(),
    path.join(os.homedir(), '.local', 'share', 'uv', 'tools', 'markitdown', 'bin', 'python'),
    path.join(os.homedir(), '.local', 'bin', 'markitdown-python'),
    'python3',
    'python',
  );
  for (const bin of candidates) {
    try {
      const probe = spawnSync(bin, ['-c', 'import markitdown'], { timeout: 20_000, stdio: 'ignore' });
      if (probe.status === 0) {
        interpreterCache = bin;
        return bin;
      }
    } catch { /* candidate unusable, try the next */ }
  }
  interpreterCache = null;
  return null;
}

const CONVERTER = path.join(__dirname, '..', 'presets', 'doc2md', 'convert.py');

/** Path to the interpreter inside the venv this tool manages. */
function managedPython() {
  const dir = path.join(userDataDir(), 'doc2md-venv');
  return process.platform === 'win32'
    ? path.join(dir, 'Scripts', 'python.exe')
    : path.join(dir, 'bin', 'python');
}

const MARKITDOWN_SPEC = 'markitdown[pptx,pdf,xlsx,docx]';

// Editing libraries, installed alongside the converter. Reading is doc2md's
// own job; editing is the agent's, done per-request with a short script
// against a COPY of the document. These are the libraries those scripts need,
// pre-installed so "swap the chart on slide 23" does not stall on pip.
const EDIT_LIBS = ['python-pptx', 'python-docx', 'openpyxl'];

/**
 * Build the managed venv and install markitdown into it.
 *
 * Kept behind an explicit command: creating a 300MB virtualenv is not
 * something to do because somebody opened a spreadsheet once. But once asked
 * for, it goes somewhere this tool owns, so uninstalling the CLI takes the
 * whole thing with it and no system interpreter is touched.
 */
function installConverter({ onProgress = () => {} } = {}) {
  const venv = path.join(userDataDir(), 'doc2md-venv');
  const target = managedPython();

  if (!fs.existsSync(target)) {
    onProgress(`creating ${venv}`);
    let created = false;
    for (const base of ['python3', 'python']) {
      const r = spawnSync(base, ['-m', 'venv', venv], { encoding: 'utf8', timeout: 180_000 });
      if (r.status === 0) { created = true; break; }
    }
    if (!created) {
      return { ok: false, reason: 'no-python', detail: 'no python3 with the venv module on PATH' };
    }
  }

  onProgress(`installing ${MARKITDOWN_SPEC} + ${EDIT_LIBS.join(', ')}`);
  const install = spawnSync(target, ['-m', 'pip', 'install', '--quiet', MARKITDOWN_SPEC, ...EDIT_LIBS], {
    encoding: 'utf8',
    timeout: 900_000,
  });
  if (install.status !== 0) {
    return { ok: false, reason: 'pip-failed', detail: (install.stderr || '').slice(0, 400) };
  }

  // The probe is the actual acceptance test: pip can exit 0 and still leave an
  // interpreter that cannot import what was asked for.
  const probe = spawnSync(target, ['-c', 'import markitdown'], { timeout: 60_000, stdio: 'ignore' });
  if (probe.status !== 0) {
    return { ok: false, reason: 'import-failed', detail: 'installed, but markitdown does not import' };
  }
  interpreterCache = target;
  clearNotice();
  return { ok: true, python: target };
}

/**
 * Convert one file. Returns `{ ok: true, cacheFile, meta }`, or
 * `{ ok: false, reason, detail }` where reason is one of:
 *   no-markitdown | too-large | sensitive | unsafe-archive | no-text |
 *   convert-failed | timeout
 *
 * Every failure is a reason to leave the original Read alone, never to break
 * it. That is the whole contract with the hook.
 */
/**
 * Bridge from this synchronous pipeline to the async fig converter: run it in
 * a child process and read one JSON object from stdout, exactly the contract
 * the Python converter already speaks. Costs a process spawn, buys the same
 * timeout and isolation the other formats get.
 */
function spawnFigConvert(fig2md, filePath) {
  const runner = path.join(__dirname, 'fig2md-runner.cjs');
  const run = spawnSync(process.execPath, [runner, filePath, userDataDir()], {
    encoding: 'utf8',
    timeout: CONVERT_TIMEOUT_MS,
    maxBuffer: MAX_MARKDOWN_BYTES * 4,
  });
  if (run.error && run.error.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout' };
  if (run.status !== 0) {
    return { ok: false, reason: 'convert-failed', detail: (run.stderr || '').slice(0, 300) };
  }
  try {
    return JSON.parse(run.stdout);
  } catch {
    return { ok: false, reason: 'convert-failed', detail: 'fig converter produced no JSON' };
  }
}

function convert(filePath, { converter = CONVERTER, python: pythonOverride = null } = {}) {
  if (!isTargetPath(filePath)) return { ok: false, reason: 'not-target' };
  if (isSensitivePath(filePath)) return { ok: false, reason: 'sensitive' };

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    return { ok: false, reason: 'missing', detail: String(e.message || e) };
  }
  if (stat.size > MAX_SOURCE_BYTES) {
    return { ok: false, reason: 'too-large', detail: `${stat.size} bytes` };
  }

  const cached = readCache(filePath);
  if (cached) return { ok: true, cached: true, cacheFile: cached.cacheFile, meta: cached.meta };

  // Figma files take the Node converter; everything else goes to markitdown.
  if (path.extname(filePath).toLowerCase() === '.fig') {
    const fig2md = require('./fig2md.cjs');
    const result = spawnFigConvert(fig2md, filePath);
    if (!result.ok) return result;
    const written = writeCache(filePath, result.markdown, {
      note: result.note, truncated: false, rows: 0, pages: 0, markupBytes: 0,
    });
    return { ok: true, cached: false, cacheFile: written.cacheFile, meta: written.meta };
  }

  // The override exists so tests can drive a stub converter with any Python at
  // all: the normal search insists the interpreter can import markitdown,
  // which would make the whole path untestable without the real package.
  const python = pythonOverride || findInterpreter();
  if (!python) return { ok: false, reason: 'no-markitdown' };

  const run = spawnSync(python, [converter, filePath], {
    encoding: 'utf8',
    timeout: CONVERT_TIMEOUT_MS,
    maxBuffer: MAX_MARKDOWN_BYTES * 4,
  });
  if (run.error && run.error.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout' };
  if (run.status !== 0) {
    return { ok: false, reason: 'convert-failed', detail: (run.stderr || '').slice(0, 300) };
  }

  let payload;
  try {
    payload = JSON.parse(run.stdout);
  } catch {
    return { ok: false, reason: 'convert-failed', detail: 'converter produced no JSON' };
  }
  if (!payload.ok) return { ok: false, reason: payload.reason, detail: payload.detail };

  let markdown = payload.markdown || '';
  let clipped = false;
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
    // Reading a 20MB markdown file is the same waste in a different format.
    markdown = markdown.slice(0, MAX_MARKDOWN_BYTES);
    clipped = true;
  }

  const written = writeCache(filePath, markdown, {
    note: payload.note || null,
    truncated: !!payload.truncated || clipped,
    rows: payload.rows || 0,
    pages: payload.pages || 0,
    markupBytes: payload.markup_bytes || 0,
    clipped,
  });
  return { ok: true, cached: false, cacheFile: written.cacheFile, meta: written.meta };
}

/** Where the "markitdown is not installed" notice records that it was shown. */
function noticePath() {
  return path.join(userDataDir(), 'doc2md-notice.json');
}

function noticeAlreadyShown() {
  try {
    return JSON.parse(fs.readFileSync(noticePath(), 'utf8')).shown === true;
  } catch {
    return false;
  }
}

/**
 * Forget that the notice was shown.
 *
 * Called after the converter is installed, so that if it later disappears the
 * user is told once more instead of meeting permanent silence.
 */
function clearNotice() {
  try {
    fs.rmSync(noticePath(), { force: true });
  } catch { /* nothing to forget */ }
}

function markNoticeShown() {
  try {
    fs.mkdirSync(userDataDir(), { recursive: true });
    fs.writeFileSync(noticePath(), JSON.stringify({ shown: true, at: new Date().toISOString() }));
  } catch { /* an unwritable state dir just means the notice repeats */ }
}

const INSTALL_HINT = 'claude-token-saver doc2md install-converter';

/**
 * Decide what to tell Claude Code about one PreToolUse(Read) payload.
 *
 * Returns null when the hook should stay out of the way, or a PreToolUse hook
 * output object. Blocking is the right call for a successful conversion:
 * allowing the Read and merely mentioning the .md would put the binary in the
 * context window anyway, which is the cost this exists to avoid.
 */
function decideForRead(context, opts = {}) {
  if (!context || context.tool_name !== 'Read') return null;
  const toolInput = context.tool_input;
  const filePath = toolInput && typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
  if (!isTargetPath(filePath)) return null;

  const result = convert(filePath, opts);
  const name = path.basename(filePath);

  if (result.ok) {
    const bits = [`[doc2md] ${name} 는 Markdown 으로 변환했습니다.`];
    bits.push(`  변환본: ${result.cacheFile}`);
    if (result.meta && result.meta.note) bits.push(`  ${result.meta.note}`);
    if (result.meta && result.meta.clipped) {
      bits.push('  변환 결과가 너무 커서 뒷부분을 잘랐습니다. 전체가 필요하면 원본을 직접 다루십시오.');
    }
    bits.push('  원본 대신 이 파일을 Read 하십시오. 원본을 직접 확인해야 한다면 그 이유를 밝히십시오.');
    return { deny: true, reason: bits.join('\n') };
  }

  // From here down the Read is allowed through untouched. The only question is
  // whether the model is told why nothing was converted.
  if (result.reason === 'no-markitdown') {
    if (noticeAlreadyShown()) return null;
    markNoticeShown();
    return {
      deny: false,
      reason: `[doc2md] ${name} 를 변환하려 했으나 markitdown 이 설치되어 있지 않습니다.\n`
        + `  설치: ${INSTALL_HINT}\n`
        + '  설치 전까지는 원본을 그대로 읽습니다. 이 안내는 한 번만 표시됩니다.',
    };
  }
  if (result.reason === 'no-text') {
    return {
      deny: false,
      reason: `[doc2md] ${name} 에서 본문 텍스트를 추출하지 못했습니다(스캔 PDF 로 보입니다). 원본을 직접 확인하십시오.`,
    };
  }
  // The one case that blocks without converting. A file that expands to fill
  // the disk is not something to hand on to the next reader with a shrug.
  if (result.reason === 'unsafe-archive') {
    return {
      deny: true,
      reason: `[doc2md] ${name} 는 압축 폭탄으로 보여 변환하지 않았습니다 (${result.detail}). 신뢰할 수 있는 파일인지 먼저 확인하십시오.`,
    };
  }
  if (result.reason === 'bad-archive') {
    return {
      deny: false,
      reason: `[doc2md] ${name} 는 압축 파일로 열리지 않습니다 (${result.detail}). 내려받다 끊겼을 수 있습니다.`,
    };
  }
  if (result.reason === 'too-large') {
    return {
      deny: false,
      reason: `[doc2md] ${name} 는 크기 상한(50MB)을 넘어 변환하지 않았습니다 (${result.detail}).`,
    };
  }
  if (result.reason === 'sensitive') {
    return {
      deny: false,
      reason: `[doc2md] ${name} 는 파일명이 민감 문서 패턴에 걸려 변환하지 않았습니다. 평문 사본을 남기지 않기 위한 조치입니다.`,
    };
  }
  if (result.reason === 'timeout' || result.reason === 'convert-failed') {
    return {
      deny: false,
      reason: `[doc2md] ${name} 변환에 실패했습니다(${result.reason}). 원본을 그대로 읽습니다.`,
    };
  }
  return null;
}

/**
 * Document paths mentioned in a prompt.
 *
 * This exists because the PreToolUse hook cannot reach the formats it was
 * written for. Claude Code rejects pptx/xlsx/docx as binary *before* running
 * the hook — verified: a `.pdf` Read fires the hook, a `.pptx` Read never
 * does — so by the time doc2md could speak, the tool call is already refused.
 * UserPromptSubmit runs earlier than any of that and sees the raw text, so a
 * path the user typed can be converted before the model tries to open it.
 *
 * Quoted, `@`-prefixed and bare paths all count. Windows drive letters are
 * matched too, since the rest of the module is path-agnostic.
 */
function documentPathsIn(text) {
  if (typeof text !== 'string' || !text) return [];
  const exts = TARGET_EXTENSIONS.map((e) => e.slice(1)).join('|');
  const re = new RegExp(`[@'"\`]?((?:[A-Za-z]:)?[~./][^\\s'"\`]*\\.(?:${exts}))`, 'gi');
  const found = [];
  for (const m of text.matchAll(re)) {
    const raw = m[1];
    const abs = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw);
    if (!found.includes(abs)) found.push(abs);
  }
  return found;
}

// One prompt naming a dozen decks should not turn a keystroke into a minute of
// conversion. The rest are named in the note so nothing disappears quietly.
const MAX_PROMPT_CONVERSIONS = 3;

/**
 * The one line that makes a conversion visible: what came in, what went out,
 * and what not attaching the original was worth.
 *
 * The sizes matter more than they look. A 30MB deck that becomes 90KB of
 * Markdown is the whole argument for this feature, and without the figures
 * the model has nothing concrete to tell the user it happened.
 */
function conversionSummary(sourcePath, meta = {}) {
  const parts = [];
  try {
    parts.push(`${humanBytes(fs.statSync(sourcePath).size)} → ${humanBytes(meta.markdownBytes || 0)}`);
  } catch { /* the size is a nicety, not the point */ }
  if (meta.tokens) parts.push(`약 ${Number(meta.tokens).toLocaleString('en-US')} 토큰`);
  if (meta.savedUsd > 0) parts.push(`첨부 대비 약 $${Number(meta.savedUsd).toFixed(2)} 절감(추정)`);
  return parts.join(', ');
}

/**
 * Context to inject for a UserPromptSubmit payload, or null.
 *
 * Returns plain text because that is what this hook can give the model:
 * stdout becomes context it can act on. There is no decision to make here —
 * the prompt is not blocked, it is answered better.
 */
function contextForPrompt(payload, opts = {}) {
  const lang = opts.lang === 'ko' ? 'ko' : 'en';
  if (!payload || typeof payload.prompt !== 'string') return null;
  const paths = documentPathsIn(payload.prompt).filter((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });
  if (paths.length === 0) return null;

  const lines = [];
  const targets = paths.slice(0, MAX_PROMPT_CONVERSIONS);
  for (const p of targets) {
    const name = path.basename(p);
    const result = convert(p, opts);
    if (result.ok) {
      lines.push(`  ${name} → ${result.cacheFile}`);
      lines.push(`      ${conversionSummary(p, result.meta)}`);
      if (result.meta && result.meta.note) lines.push(`      ${result.meta.note}`);
      if (result.meta && result.meta.clipped) {
        lines.push('      변환 결과가 너무 커서 뒷부분을 잘랐습니다. 전체가 필요하면 원본을 직접 다루십시오.');
      }
    } else if (result.reason === 'no-markitdown') {
      lines.push(lang === 'ko'
        ? `  ${name}: 변환기가 없어 변환하지 못했습니다. 설치: ${INSTALL_HINT}`
        : `  ${name}: no converter installed. Install it with: ${INSTALL_HINT}`);
    } else if (result.reason === 'no-figparser') {
      lines.push(lang === 'ko'
        ? `  ${name}: .fig 파서가 없어 변환하지 못했습니다. 설치: claude-token-saver doc2md install-converter`
        : `  ${name}: no .fig parser installed. Install it with: claude-token-saver doc2md install-converter`);
    } else if (result.reason === 'sensitive') {
      lines.push(lang === 'ko'
        ? `  ${name}: 파일명이 민감 문서 패턴에 걸려 변환하지 않았습니다.`
        : `  ${name}: skipped — the filename matches a sensitive-document pattern.`);
    } else {
      lines.push(lang === 'ko'
        ? `  ${name}: 변환하지 못했습니다 (${result.reason}).`
        : `  ${name}: conversion failed (${result.reason}).`);
    }
  }
  if (paths.length > targets.length) {
    lines.push(lang === 'ko'
      ? `  (문서 ${paths.length}개 가운데 앞 ${targets.length}개만 변환했습니다. 나머지는 \`claude-token-saver doc2md <경로>\` 로 변환하십시오.)`
      : `  (converted the first ${targets.length} of ${paths.length} documents; run \`claude-token-saver doc2md <path>\` for the rest.)`);
  }

  return lang === 'ko'
    ? [
      '[doc2md] 이 프롬프트에 문서 경로가 있어 Markdown 으로 변환해 두었습니다.',
      ...lines,
      '원본 대신 위 변환본을 Read 하십시오. pptx·xlsx·docx 는 Read 도구가 이진 파일이라며 거부하므로 원본을 직접 열 수 없습니다.',
    '변환이 일어났다는 사실은 사용자에게도 보여야 하므로, 답변 첫 줄에 변환한 문서마다 다음 형식으로 한 줄씩 출력하십시오: `📄 [claude-token-saver] doc2md: <파일명> (<원본 크기> → <Markdown 크기>, 약 <토큰> 토큰)`. 절감액이 함께 안내됐다면 그 금액도 같은 줄 끝에 덧붙이십시오.',
      '경로가 주어지지 않은 문서를 열어야 할 때는 `claude-token-saver doc2md <경로>` 를 실행해 변환본 경로를 얻으십시오.',
    ].join('\n')
    : [
      '[doc2md] This prompt names document paths, which have been converted to Markdown:',
      ...lines,
      'Read the conversions above rather than the originals: Read refuses pptx/xlsx/docx as binary files, so the originals cannot be opened directly.',
    'The user cannot see that any of this happened, so open your reply with one line per converted document: `📄 [claude-token-saver] doc2md: <name> (<source size> → <markdown size>, ~<tokens> tokens)`, adding the saving above if one was reported.',
      'For a document whose path was not given here, run `claude-token-saver doc2md <path>` to get its conversion.',
    ].join('\n');
}

/**
 * The standing note injected at session start.
 *
 * Two things the model cannot work out on its own: that attaching a document
 * costs far more than naming its path, and that the binary-file refusal it
 * will meet on a pptx has a one-command answer.
 */
function sessionNote(lang = 'en') {
  if (lang === 'ko') {
    return [
      '[doc2md] 문서(pptx·xlsx·pdf·docx)를 다룰 때의 규칙입니다.',
      '  문서를 열어야 하는데 Read 가 이진 파일이라며 거부하면, `claude-token-saver doc2md <경로>` 를 실행하고 그 결과로 나온 .md 를 Read 하십시오.',
      '  사용자가 문서를 메시지에 직접 첨부했다면, 첨부는 내용 전체가 컨텍스트에 실려 토큰을 크게 씁니다. 다음부터는 첨부 대신 파일 경로를 적어 달라고 안내하십시오. 경로로 주면 변환본만 읽습니다.',
      '  변환은 단방향입니다. 변환본 .md 를 고쳐도 원본에는 반영되지 않습니다. 문서 수정 요청을 받으면: ① 원본을 복사하고 ② 복사본을 스크립트로 수정하십시오. pptx·docx·xlsx 는 도구 venv 파이썬에 python-pptx·python-docx·openpyxl 이 준비되어 있고(`claude-token-saver doc2md` 상태 출력에 경로가 나옵니다), .fig 는 openfig-core 로 편집·재인코드합니다. ③ 수정한 복사본을 doc2md 로 재변환해 변경이 들어갔는지 검증하십시오. 차트·이미지 같은 시각 요소는 변환본에 안 잡히므로 텍스트 검증만으로 완료를 단정하지 마십시오.',
    ].join('\n');
  }
  return [
    '[doc2md] Handling documents (pptx/xlsx/pdf/docx):',
    '  If Read refuses a document as a binary file, run `claude-token-saver doc2md <path>` and Read the .md it prints.',
    '  If the user attached a document to their message, its full contents were billed into the context. Tell them that naming the file path instead is far cheaper, since only the converted Markdown gets read.',
    '  Conversions are one-way: editing the cached .md changes nothing in the source. When asked to modify a document: ① copy the original, ② edit the COPY with a script — the managed venv python has python-pptx/python-docx/openpyxl, and .fig edits go through openfig-core — then ③ re-convert the copy with doc2md to verify the change landed. Charts and images do not appear in conversions, so text verification alone does not prove visual edits.',
  ].join('\n');
}

/**
 * Guard for Edit/Write. Two writes are refused, for different reasons.
 *
 * A write to a conversion in the cache: the conversion is one-way, so an edit
 * there changes nothing the user cares about — and worse, the cache still
 * matches the source's mtime, so the corrupted copy would be served on every
 * later read while looking exactly like the document. The deny explains where
 * the work should go instead.
 *
 * A write to the original document: Edit and Write emit text, and a pptx or
 * .fig overwritten with text is destroyed, not edited. Nothing this tool
 * ships can write those formats back.
 */
function decideForWrite(context) {
  if (!context || (context.tool_name !== 'Edit' && context.tool_name !== 'Write')) return null;
  const toolInput = context.tool_input;
  const filePath = toolInput && typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
  if (!filePath) return null;
  const abs = path.resolve(filePath);

  if (abs.startsWith(cacheDir() + path.sep)) {
    let source = null;
    try {
      source = JSON.parse(fs.readFileSync(metaPathFor(abs), 'utf8')).source;
    } catch { /* the deny stands on its own */ }
    return {
      deny: true,
      reason: '[doc2md] 이 파일은 변환 캐시입니다. 여기를 고쳐도 원본 문서에는 아무것도 반영되지 않고, '
        + '캐시만 오염된 채 다음 읽기부터 계속 서빙됩니다.\n'
        + (source ? `  원본: ${source}\n` : '')
        + '  문서 수정이 목적이라면: 원본을 복사한 뒤(cp) 복사본을 스크립트로 수정하십시오. '
        + `pptx·docx·xlsx 는 ${managedPython()} 에 python-pptx·python-docx·openpyxl 이 설치되어 있고, `
        + '.fig 는 doc2md-fig 의 openfig-core 로 편집·재인코드할 수 있습니다. '
        + '수정 후 복사본을 `claude-token-saver doc2md <복사본>` 으로 재변환해 의도한 변경이 들어갔는지 확인하십시오. 원본은 절대 직접 수정하지 마십시오.',
    };
  }

  if (isTargetPath(abs)) {
    return {
      deny: true,
      reason: `[doc2md] ${path.basename(abs)} 는 이진 문서입니다. Edit/Write 는 텍스트를 쓰므로 이 파일을 파괴합니다. `
        + '수정하려면 원본을 복사한 뒤(cp) 복사본을 스크립트로 고치십시오. '
        + `pptx·docx·xlsx 는 ${managedPython()} 의 python-pptx·python-docx·openpyxl, .fig 는 openfig-core 를 쓰고, `
        + '수정 후 `claude-token-saver doc2md <복사본>` 재변환으로 결과를 검증하십시오.',
    };
  }
  return null;
}

/** The decision rendered as the JSON Claude Code expects on stdout. */
function formatHookOutput(decision) {
  if (!decision) return null;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.deny ? 'deny' : 'allow',
      permissionDecisionReason: decision.reason,
    },
  });
}

module.exports = {
  TARGET_EXTENSIONS,
  MAX_SOURCE_BYTES,
  INSTALL_HINT,
  MARKITDOWN_SPEC,
  managedPython,
  installConverter,
  clearNotice,
  cacheDir,
  cachePathFor,
  metaPathFor,
  isTargetPath,
  isSensitivePath,
  documentPathsIn,
  contextForPrompt,
  sessionNote,
  findInterpreter,
  readCache,
  writeCache,
  convert,
  decideForRead,
  decideForWrite,
  formatHookOutput,
};
