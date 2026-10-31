#!/usr/bin/env node
// Measured breakdown of the v3 savings formula over the last N days of local
// transcripts, for the "how savings are counted" card on sprag.io and in the
// README. Each term of the formula is summed over the rule-attributed runs, so
// the card can show the formula on the left and these totals on the right.
//
// A route-scan writes the rule registry, the ledger and the ratchet files, so
// the scan runs in a throwaway copy: a temporary HOME whose .claude/projects
// links to the real transcripts, and a copy of the state directory. Nothing
// under the real home is written.
//
// Usage: node scripts/savings-snapshot.mjs [days=14] > docs/explain/savings-snapshot.json

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const days = Number(process.argv.find((a) => /^\d+$/.test(a))) || 14;
const MARK = 'SPRAG_SAVINGS_SNAPSHOT_CHILD';

if (!process.env[MARK]) {
  const realHome = homedir();
  const state = process.platform === 'darwin'
    ? join(realHome, 'Library', 'Application Support', 'claude-token-saver')
    : join(process.env.XDG_CONFIG_HOME || join(realHome, '.config'), 'claude-token-saver');
  const box = mkdtempSync(join(tmpdir(), 'sprag-snapshot-'));
  try {
    mkdirSync(join(box, 'home', '.claude'), { recursive: true });
    symlinkSync(join(realHome, '.claude', 'projects'), join(box, 'home', '.claude', 'projects'));
    if (existsSync(state)) {
      cpSync(state, join(box, 'config', 'claude-token-saver'), {
        recursive: true,
        filter: (src) => !src.includes('doc2md-venv'),
      });
    }
    // Re-run this same file (resolved from the module, not argv) inside the copy.
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), String(days)], {
      env: { ...process.env, [MARK]: '1', HOME: join(box, 'home'), XDG_CONFIG_HOME: join(box, 'config') },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    process.exitCode = r.status ?? 1;
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
} else {
  const { runRouteScan } = await import('../src/route-scan.js');
  const trace = [];
  await runRouteScan({ days, trace });
  // The scan reads every session file touched in the window, and a long
  // session carries runs from before it. Only runs that started inside the
  // window count, so the dates on the card are the dates of the work.
  const since = Date.now() - days * 86400000;
  const inWindow = trace.filter((t) => Number.isFinite(t.startedAt) && t.startedAt >= since);
  const v3 = inWindow.filter((t) => t.basis === 'v3');
  const sum = (f) => v3.reduce((a, t) => a + (f(t) || 0), 0);
  const round = (x) => Math.round(x * 100) / 100;
  const reread = sum((t) => t.cfReread);
  const newIO = sum((t) => t.cfWork - t.cfReread);
  const carry = sum((t) => t.cfCarry);
  const subagent = sum((t) => t.subActual);
  const delegating = sum((t) => t.overhead);
  const saving = sum((t) => t.usd);
  const C = v3.map((t) => t.C).filter(Number.isFinite).sort((a, b) => a - b);
  const starts = v3.map((t) => t.startedAt).filter(Number.isFinite);
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  console.log(JSON.stringify({
    days,
    from: starts.length ? day(Math.min(...starts)) : null,
    to: starts.length ? day(Math.max(...starts)) : null,
    runs: v3.length,
    fallbackV2: inWindow.length - v3.length,
    outsideWindow: trace.length - inWindow.length,
    terms: {
      rereadConversation: round(reread),
      rereadPiledUp: round(carry),
      newInputOutput: round(newIO),
      subagentCost: round(subagent),
      delegatingCost: round(delegating),
    },
    saving: round(saving),
    // The terms are rounded one by one, so their sum can differ from saving by a cent.
    check: round(reread + carry + newIO - subagent - delegating),
    negativeRuns: v3.filter((t) => t.usd < 0).length,
    contextTokens: C.length ? {
      mean: Math.round(C.reduce((a, b) => a + b, 0) / C.length),
      median: C[Math.floor((C.length - 1) / 2)],
    } : null,
  }, null, 2));
}
