/**
 * Harness module — manages CLAUDE.md (single file, 5 sections), ratchet.md,
 * and reports completeness for the statusline 🅷 N/5 indicator.
 *
 * Detection is project-scoped: we look at the current working directory's
 * CLAUDE.md (or the nearest one walking up to the git root). Statusline calls
 * harnessStatus() per render — keep it cheap (read + regex, no parsing).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import {
  HARNESS_SECTIONS,
  HARNESS_BLOCK_BEGIN,
  HARNESS_BLOCK_END,
  harnessClaudeMdBlock,
  harnessRatchetMdInitial,
  appendRatchetRule,
} from './harness-templates.js';

const require = createRequire(import.meta.url);
function readHarnessState() {
  try {
    const a = require('./harness-analyzer.cjs');
    return a.readState();
  } catch {
    return null;
  }
}

/**
 * Walk up from `start` looking for a project root marker (CLAUDE.md, .git,
 * or package.json). Falls back to `start` itself so harness commands always
 * have *some* directory to write into, even outside a repo.
 */
export function findProjectRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (
      existsSync(join(dir, 'CLAUDE.md')) ||
      existsSync(join(dir, '.git')) ||
      existsSync(join(dir, 'package.json'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

function claudeMdPath(root) {
  return join(root, 'CLAUDE.md');
}

function ratchetMdPath(root) {
  return join(root, '.claude', 'ratchet.md');
}

function globalRatchetMdPath() {
  return join(homedir(), '.claude', 'ratchet.md');
}

function resolveRatchetPath(scope, root) {
  return scope === 'global' ? globalRatchetMdPath() : ratchetMdPath(root);
}

/**
 * Count how many of the 5 harness sections appear in the project's CLAUDE.md.
 * Returns { configured, total, missing, hasBlock }. Cheap enough to call from
 * statusline — single file read + regex.
 */
export function harnessStatus(root = findProjectRoot()) {
  const path = claudeMdPath(root);
  if (!existsSync(path)) {
    return {
      configured: 0,
      total: HARNESS_SECTIONS.length,
      missing: HARNESS_SECTIONS.map((s) => s.id),
      hasBlock: false,
      hasFile: false,
      root,
    };
  }
  let content = '';
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return { configured: 0, total: HARNESS_SECTIONS.length, missing: [], hasBlock: false, hasFile: true, root };
  }
  const hasBlock = content.includes(HARNESS_BLOCK_BEGIN);
  // Opt-out marker — when the user intentionally customizes the harness block
  // and doesn't want the statusline to nag, they can drop this comment
  // anywhere in CLAUDE.md to silence the 🅷 indicator entirely.
  const optOut = /<!--\s*harness-check:\s*off\s*-->/i.test(content);
  const present = [];
  const missing = [];
  for (const s of HARNESS_SECTIONS) {
    if (content.includes(s.heading)) present.push(s.id);
    else missing.push(s.id);
  }
  // Custom state — user has the harness block but at least one header was
  // hand-edited away from the canonical text. Treat as intentional divergence
  // (don't show N/5 nag) but still surface a neutral 🅷 custom marker so they
  // know the auto-check no longer applies.
  const custom = hasBlock && present.length < HARNESS_SECTIONS.length;
  return {
    configured: present.length,
    total: HARNESS_SECTIONS.length,
    missing,
    hasBlock,
    hasFile: true,
    optOut,
    custom,
    root,
  };
}

/**
 * harness init — write CLAUDE.md (single file, 5 sections) + .claude/ratchet.md.
 * If CLAUDE.md exists, back it up to CLAUDE.md.bak-YYYYMMDD-HHMMSS first
 * (per user-confirmed design: backup, then overwrite with the harness block).
 *
 * Returns { wrote: [], backedUp: [], skipped: [] } so the CLI can report.
 */
export function harnessInit({ root = findProjectRoot(), force = false } = {}) {
  const cmPath = claudeMdPath(root);
  const rmPath = ratchetMdPath(root);
  const result = { wrote: [], backedUp: [], skipped: [], root };

  // CLAUDE.md
  const block = harnessClaudeMdBlock();
  if (existsSync(cmPath)) {
    const existing = readFileSync(cmPath, 'utf8');
    if (existing.includes(HARNESS_BLOCK_BEGIN) && !force) {
      // Already has a harness block — replace it in-place, preserving the
      // user's other content above/below.
      const re = new RegExp(
        `${escapeRe(HARNESS_BLOCK_BEGIN)}[\\s\\S]*?${escapeRe(HARNESS_BLOCK_END)}\\n?`,
        'm',
      );
      const next = existing.replace(re, block);
      writeFileSync(cmPath, next);
      result.wrote.push(cmPath + ' (block updated in place)');
    } else {
      // Backup as safety net, then APPEND the harness block to existing
      // content (do not clobber). Users keep all their prior CLAUDE.md content;
      // the harness block is added at the end and managed in-place on re-runs
      // via the BEGIN/END markers.
      const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15); // YYYYMMDDTHHMMSS
      const bak = `${cmPath}.bak-${stamp}`;
      writeFileSync(bak, existing);
      const sep = existing.endsWith('\n') ? '\n' : '\n\n';
      writeFileSync(cmPath, existing + sep + block);
      result.backedUp.push(bak);
      result.wrote.push(cmPath + ' (harness block appended)');
    }
  } else {
    writeFileSync(cmPath, block);
    result.wrote.push(cmPath);
  }

  // .claude/ratchet.md (only if missing — don't clobber user-grown rules)
  if (!existsSync(rmPath)) {
    mkdirSync(dirname(rmPath), { recursive: true });
    writeFileSync(rmPath, harnessRatchetMdInitial());
    result.wrote.push(rmPath);
  } else {
    result.skipped.push(rmPath + ' (already exists)');
  }

  return result;
}

/**
 * harness uninit — remove the harness block from CLAUDE.md (preserves the
 * user's other content). A safety backup is written first. ratchet.md is
 * left intact (user-grown rules) unless `purgeRatchet` is true.
 *
 * Returns { removed: [], backedUp: [], skipped: [] }.
 */
export function harnessUninit({ root = findProjectRoot(), purgeRatchet = false } = {}) {
  const cmPath = claudeMdPath(root);
  const rmPath = ratchetMdPath(root);
  const result = { removed: [], backedUp: [], skipped: [], root };

  if (existsSync(cmPath)) {
    const existing = readFileSync(cmPath, 'utf8');
    if (existing.includes(HARNESS_BLOCK_BEGIN)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
      const bak = `${cmPath}.bak-${stamp}`;
      writeFileSync(bak, existing);
      const re = new RegExp(
        `\\n*${escapeRe(HARNESS_BLOCK_BEGIN)}[\\s\\S]*?${escapeRe(HARNESS_BLOCK_END)}\\n?`,
        'm',
      );
      const next = existing.replace(re, '').replace(/\n{3,}$/, '\n\n');
      writeFileSync(cmPath, next);
      result.backedUp.push(bak);
      result.removed.push(cmPath + ' (harness block removed)');
    } else {
      result.skipped.push(cmPath + ' (no harness block found)');
    }
  } else {
    result.skipped.push(cmPath + ' (does not exist)');
  }

  if (purgeRatchet && existsSync(rmPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const bak = `${rmPath}.bak-${stamp}`;
    writeFileSync(bak, readFileSync(rmPath, 'utf8'));
    result.backedUp.push(bak);
    // Replace with empty initial template rather than delete (preserves dir).
    writeFileSync(rmPath, harnessRatchetMdInitial());
    result.removed.push(rmPath + ' (reset to initial)');
  } else if (existsSync(rmPath)) {
    result.skipped.push(rmPath + ' (kept; pass --purge-ratchet to reset)');
  }

  return result;
}

/**
 * harness promote — append a one-line rule to .claude/ratchet.md.
 * Creates the file from the initial template if missing.
 */
export function harnessPromote(ruleText, { root = findProjectRoot(), scope = 'project' } = {}) {
  const rmPath = resolveRatchetPath(scope, root);
  let existing = '';
  if (existsSync(rmPath)) {
    existing = readFileSync(rmPath, 'utf8');
  } else {
    mkdirSync(dirname(rmPath), { recursive: true });
    existing = harnessRatchetMdInitial();
  }
  const next = appendRatchetRule(existing, ruleText);
  writeFileSync(rmPath, next);
  return { path: rmPath, root, scope };
}

/**
 * harness list — return numbered ratchet rules from .claude/ratchet.md.
 * Numbering is 1-based and matches `harness rm <N>`.
 */
export function harnessListRules({ root = findProjectRoot(), scope = 'project' } = {}) {
  const rmPath = resolveRatchetPath(scope, root);
  if (!existsSync(rmPath)) return { path: rmPath, rules: [] };
  const lines = readFileSync(rmPath, 'utf8').split('\n');
  const rules = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A "rule line" starts with "- " (markdown bullet). Header lines, blanks,
    // and the "## Rules" anchor are ignored.
    if (/^\s*-\s+/.test(line)) {
      rules.push({ index: rules.length + 1, lineNo: i, text: line.replace(/^\s*-\s+/, '') });
    }
  }
  return { path: rmPath, rules };
}

/**
 * harness rm — remove a ratchet rule by its 1-based index. Writes a `.bak`
 * before mutating so the user can recover. Returns the removed rule for the
 * CLI to echo back.
 *
 * NOTE: Removal is intentionally a separate verb from `promote`. Ratchet's
 * value is one-way accumulation; deleting should feel deliberate. The CLI
 * surfaces a "narrow the condition instead" reminder around this call.
 */
export function harnessRmRule(n, { root = findProjectRoot(), scope = 'project' } = {}) {
  const { path: rmPath, rules } = harnessListRules({ root, scope });
  if (!existsSync(rmPath)) {
    return { ok: false, error: `ratchet.md not found at ${rmPath}` };
  }
  const target = rules.find((r) => r.index === n);
  if (!target) {
    return { ok: false, error: `No rule #${n} (have ${rules.length})`, rules };
  }
  const content = readFileSync(rmPath, 'utf8');
  writeFileSync(rmPath + '.bak', content);
  const lines = content.split('\n');
  lines.splice(target.lineNo, 1);
  writeFileSync(rmPath, lines.join('\n'));
  return { ok: true, path: rmPath, backup: rmPath + '.bak', removed: target };
}

/**
 * Statusline segment shape for the 🅷 indicator. Returns null when the user
 * has explicitly disabled harness display, or when there's no CLAUDE.md and
 * no .claude/ at all (silent in non-init'd projects so we don't nag).
 */
export function harnessStatusForStatusline(cfg, { root } = {}) {
  if (cfg && cfg.harness && cfg.harness.enabled === false) return null;
  const projectRoot = root || findProjectRoot();
  const status = harnessStatus(projectRoot);
  // Silent when the project has neither CLAUDE.md nor a .claude/ dir — the
  // user hasn't opted in, no point nagging.
  if (!status.hasFile && !existsSync(join(projectRoot, '.claude'))) return null;
  if (status.optOut) return null;
  // Attach a warning derived from the analyzer state file (if any). Precedence:
  //   ratchet? > no-evidence > PEV-skip. Only surfaces when the state's
  //   sessionId or cwd matches this project, so unrelated sessions don't leak.
  const state = readHarnessState();
  let warning = null;
  if (state) {
    const matches = (state.cwd && state.cwd === projectRoot) || !state.cwd;
    if (matches) {
      if (state.ratchetCandidate && state.ratchetCandidate.count >= 2) {
        const id = state.ratchetCandidate.id || 1;
        warning = `ratchet? #${id}`;
      }
      else if (state.evidenceLow) warning = 'no-evidence';
      else if (state.pevSkip) warning = 'PEV-skip';
    }
  }
  return { ...status, warning };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
