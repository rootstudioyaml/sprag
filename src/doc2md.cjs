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

// Formats where the original is of no use to the model. Images are absent
// deliberately: markitdown returns nothing for them, and OCR misread resource
// names in testing (`c5.xlarge` as `c.xlarge`), which is worse than no text at
// all in a document where those names are the content. The model reads images
// natively anyway.
const TARGET_EXTENSIONS = ['.pptx', '.xlsx', '.xls', '.pdf', '.docx'];

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
  const base = path.basename(abs).replace(/[^\w.\-]/g, '_');
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

function writeCache(filePath, markdown, extra) {
  ensureCacheDir();
  const cacheFile = cachePathFor(filePath);
  const src = fs.statSync(filePath);
  fs.writeFileSync(cacheFile, markdown, { encoding: 'utf8', mode: 0o600 });
  const meta = Object.assign({
    source: path.resolve(filePath),
    size: src.size,
    mtimeMs: src.mtimeMs,
    convertedAt: new Date().toISOString(),
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

/**
 * Convert one file. Returns `{ ok: true, cacheFile, meta }`, or
 * `{ ok: false, reason, detail }` where reason is one of:
 *   no-markitdown | too-large | sensitive | unsafe-archive | no-text |
 *   convert-failed | timeout
 *
 * Every failure is a reason to leave the original Read alone, never to break
 * it. That is the whole contract with the hook.
 */
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

function markNoticeShown() {
  try {
    fs.mkdirSync(userDataDir(), { recursive: true });
    fs.writeFileSync(noticePath(), JSON.stringify({ shown: true, at: new Date().toISOString() }));
  } catch { /* an unwritable state dir just means the notice repeats */ }
}

const INSTALL_HINT = 'pip install "markitdown[pptx,pdf,xlsx,docx]"';

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
  cacheDir,
  cachePathFor,
  metaPathFor,
  isTargetPath,
  isSensitivePath,
  findInterpreter,
  readCache,
  writeCache,
  convert,
  decideForRead,
  formatHookOutput,
};
