import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, realpathSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { codexUserDir } from './agent.js';
import { userDataDir } from './paths.js';
import { readResetMarks, isBeforeReset } from './saved-reset.cjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const ledgerDir = ({ home = codexUserDir(), dir = userDataDir() } = {}) => join(dir, 'codex-doc2md', hash(resolve(home)));
const finite = (n) => Number.isSafeInteger(n) && n >= 0;

// One file per source avoids lost updates when parallel hooks prepare documents.
export function recordCodexDocument(source, result, opts) {
  if (!result?.ok) return;
  try {
    const dir = ledgerDir(opts);
    const file = join(dir, `${hash(realpathSync(source))}.json`);
    const meta = result.meta || {};
    const event = { version: 1, ext: extname(source).slice(1).toLowerCase(),
      sourceBytes: finite(meta.size) ? meta.size : null,
      markdownBytes: finite(meta.markdownBytes) ? meta.markdownBytes : null,
      clipped: !!(meta.clipped || meta.truncated) };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(event) + '\n', { mode: 0o600 });
    renameSync(tmp, file);
  } catch { /* Accounting must not prevent document conversion. */ }
}

// Records carry no timestamp field, so the reset mark is compared with the
// file's mtime. A source converted again rewrites its record and counts as new.
export function codexDocumentTotals(opts) {
  const since = readResetMarks(opts?.dir ?? userDataDir())['codex-docs'];
  const total = { docs: 0, byExt: [], scope: 'codex-total', since };
  const byExt = new Map();
  try {
    const dir = ledgerDir(opts);
    for (const file of readdirSync(dir).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      try {
        if (since !== null && isBeforeReset(statSync(join(dir, file)).mtimeMs, since)) continue;
        const event = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        if (event?.version !== 1 || !['pdf', 'pptx', 'xlsx', 'xls', 'docx', 'fig'].includes(event.ext)) continue;
        total.docs++;
        byExt.set(event.ext, (byExt.get(event.ext) || 0) + 1);
      } catch { /* Ignore only the damaged record. */ }
    }
  } catch { /* No Codex document history yet. */ }
  total.byExt = [...byExt].map(([ext, docs]) => ({ ext, docs })).sort((a, b) => b.docs - a.docs || a.ext.localeCompare(b.ext));
  return total;
}
