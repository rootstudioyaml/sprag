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
  RATCHET_IMPORT_RE,
  MODEL_RATCHET_IMPORT_RE,
} from './harness-templates.js';
import { routeWarningForStatusline } from './route-scan.js';
import { ruleHealthWarningForStatusline, modelRatchetPathFor, renderModelRatchet } from './model-rules.js';
import { compactWindowWarningForStatusline } from './compact-window.js';

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

// Global harness lives in ~/.claude/CLAUDE.md — Claude Code loads this for every
// project, so a global init makes the 5 harness sections apply everywhere
// (mirrors the project/global split that ratchet.md already has).
function globalClaudeMdPath() {
  return join(homedir(), '.claude', 'CLAUDE.md');
}

function resolveClaudeMdPath(scope, root) {
  return scope === 'global' ? globalClaudeMdPath() : claudeMdPath(root);
}

/**
 * Count how many of the 5 harness sections appear in the project's CLAUDE.md.
 * Returns { configured, total, missing, hasBlock }. Cheap enough to call from
 * statusline — single file read + regex.
 */
// Count harness sections in a single CLAUDE.md file. Shared by both scopes.
function statusForFile(filePath) {
  if (!existsSync(filePath)) {
    return {
      configured: 0,
      total: HARNESS_SECTIONS.length,
      missing: HARNESS_SECTIONS.map((s) => s.id),
      hasBlock: false,
      hasFile: false,
      optOut: false,
      custom: false,
      hasRatchetImport: false,
      hasModelRatchetImport: false,
      file: filePath,
    };
  }
  let content = '';
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    // Unreadable file (permissions, etc.) — report every section missing so
    // `harness check` can't print "All 5 sections present ✅" over a 0/5.
    return { configured: 0, total: HARNESS_SECTIONS.length, missing: HARNESS_SECTIONS.map((s) => s.id), hasBlock: false, hasFile: true, optOut: false, custom: false, hasRatchetImport: false, hasModelRatchetImport: false, file: filePath };
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
    // Whether the promoted ratchet rules actually reach the model. Blocks
    // written before v3.6.3 have all 5 sections but no import, so the rules
    // sat in a file nothing read — worth flagging separately from N/5.
    hasRatchetImport: RATCHET_IMPORT_RE.test(content),
    hasModelRatchetImport: MODEL_RATCHET_IMPORT_RE.test(content),
    file: filePath,
  };
}

/**
 * Harness status for a project, with scope control:
 *   scope 'project' — count only <root>/CLAUDE.md
 *   scope 'global'  — count only ~/.claude/CLAUDE.md
 *   scope 'auto' (default) — use the project file if it carries the harness
 *     block, otherwise fall back to the global file. This makes a project that
 *     relies on a globally-installed harness report 🅷 5/5 (covered by global),
 *     matching reality: Claude Code loads ~/.claude/CLAUDE.md for every project.
 * The returned `source` ('project'|'global') tells callers which file was used.
 *
 * The `@` import flags are the union of both files, not just the source one:
 * Claude Code loads ~/.claude/CLAUDE.md for every project *and* the project
 * CLAUDE.md, so a project-scope block with the imports living in the global
 * file still gets the ratchet rules. Checking only the source file made that
 * layout report a false `ratchet-unloaded`. `importSource` says which file
 * actually carries them ('project' | 'global' | 'both' | null).
 */
export function harnessStatus(root = findProjectRoot(), { scope = 'auto' } = {}) {
  const project = statusForFile(claudeMdPath(root));
  const global = statusForFile(globalClaudeMdPath());
  const pick = (s, source) => ({ ...s, ...unionImports(project, global), root, source });
  if (scope === 'project') return pick(project, 'project');
  if (scope === 'global') return pick(global, 'global');
  if (project.hasBlock) return pick(project, 'project');
  if (global.hasBlock) return pick(global, 'global');
  return pick(project, 'project');
}

// Union the two files' import flags. Same file read twice (project root === ~)
// is harmless — OR is idempotent.
function unionImports(project, global) {
  const samePath = project.file === global.file;
  const g = samePath ? { hasRatchetImport: false, hasModelRatchetImport: false } : global;
  const inProject = project.hasRatchetImport || project.hasModelRatchetImport;
  const inGlobal = g.hasRatchetImport || g.hasModelRatchetImport;
  return {
    hasRatchetImport: project.hasRatchetImport || g.hasRatchetImport,
    hasModelRatchetImport: project.hasModelRatchetImport || g.hasModelRatchetImport,
    importSource: inProject && inGlobal ? 'both' : inProject ? 'project' : inGlobal ? 'global' : null,
  };
}

/**
 * harness init — write CLAUDE.md (single file, 5 sections) + .claude/ratchet.md.
 * If CLAUDE.md exists, back it up to CLAUDE.md.bak-YYYYMMDD-HHMMSS first
 * (per user-confirmed design: backup, then overwrite with the harness block).
 *
 * Returns { wrote: [], backedUp: [], skipped: [] } so the CLI can report.
 */
export function harnessInit({ root = findProjectRoot(), force = false, scope = 'project' } = {}) {
  const cmPath = resolveClaudeMdPath(scope, root); // global → ~/.claude/CLAUDE.md
  const rmPath = resolveRatchetPath(scope, root);  // global → ~/.claude/ratchet.md
  const result = { wrote: [], backedUp: [], skipped: [], root, scope };

  // CLAUDE.md
  const block = harnessClaudeMdBlock(scope);
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
    mkdirSync(dirname(cmPath), { recursive: true }); // global: ensure ~/.claude exists
    writeFileSync(cmPath, block);
    result.wrote.push(cmPath);
  }

  // ratchet.md (only if missing — don't clobber user-grown rules)
  if (!existsSync(rmPath)) {
    mkdirSync(dirname(rmPath), { recursive: true });
    writeFileSync(rmPath, harnessRatchetMdInitial());
    result.wrote.push(rmPath);
  } else {
    result.skipped.push(rmPath + ' (already exists)');
  }

  // ratchet-model.md — tool-owned, normally written by route-scan. The block
  // imports it, so seed an empty one now rather than ship a dangling import
  // into every project that has not been scanned yet.
  const mrPath = modelRatchetPathFor(scope, root);
  if (!existsSync(mrPath)) {
    try {
      mkdirSync(dirname(mrPath), { recursive: true });
      writeFileSync(mrPath, renderModelRatchet([]));
      result.wrote.push(mrPath);
    } catch { /* unwritable — route-scan will retry on its next sync */ }
  } else {
    result.skipped.push(mrPath + ' (already exists)');
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
export function harnessUninit({ root = findProjectRoot(), purgeRatchet = false, scope = 'project' } = {}) {
  const cmPath = resolveClaudeMdPath(scope, root);
  const rmPath = resolveRatchetPath(scope, root);
  const result = { removed: [], backedUp: [], skipped: [], root, scope };

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
 * harness pull — register the CURATED ratchet rules bundled with this package
 * (presets/ratchet-rules.md) into the user's ratchet, global by default.
 *
 * Rationale: a project ratchet already inherits the global one (global is the
 * upper layer of the hierarchy), so there is nothing to copy between the
 * user's own scopes. What CAN'T reach the user any other way is the package
 * author's field-tested rules — pull ships those, strictly opt-in:
 * install/init never auto-injects anything.
 *
 * Deduped by rule text (ignoring the YYYY-MM-DD stamp) — idempotent.
 * Returns { path, scope, added, skippedRules, presets }.
 */
export function harnessPull({ root = findProjectRoot(), scope = 'global' } = {}) {
  const presets = presetRules();
  const rmPath = resolveRatchetPath(scope, root);
  const result = { path: rmPath, scope, added: [], skippedRules: 0, presets: presets.length };
  const stripDate = (t) => t.replace(/^\d{4}-\d{2}-\d{2}:\s*/, '').trim();

  let content = existsSync(rmPath)
    ? readFileSync(rmPath, 'utf8')
    : harnessRatchetMdInitial();
  const have = new Set(
    harnessListRules({ root, scope }).rules.map((r) => stripDate(r.text)),
  );
  for (const rule of presets) {
    if (have.has(rule)) {
      result.skippedRules += 1;
      continue;
    }
    content = appendRatchetRule(content, rule);
    have.add(rule);
    result.added.push(rule);
  }
  if (result.added.length) {
    mkdirSync(dirname(rmPath), { recursive: true });
    writeFileSync(rmPath, content);
  }
  return result;
}

/** Parse the bundled preset rules (markdown bullets under presets/). */
export function presetRules() {
  try {
    const path = join(dirname(new URL(import.meta.url).pathname), '..', 'presets', 'ratchet-rules.md');
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => /^\s*-\s+/.test(l))
      .map((l) => l.replace(/^\s*-\s+/, '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
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
    // and the "## Rules" anchor are ignored. (Model-fitting rules live in a
    // separate tool-owned file, ratchet-model.md — never listed here.)
    if (/^\s*-\s+/.test(line)) {
      const text = line.replace(/^\s*-\s+/, '');
      rules.push({ index: rules.length + 1, lineNo: i, text, ...parseRuleMeta(text) });
    }
  }
  return { path: rmPath, rules, bytes: Buffer.byteLength(readFileSync(rmPath, 'utf8'), 'utf8') };
}

/**
 * Rule metadata, parsed from the line the user already writes:
 *   "- 2026-05-08: [video,tts] 자막 렌더 시 ..."
 * Both parts are optional — `date` is null on undated rules, `tags` empty on
 * untagged ones. Tags exist to make pruning targeted (`prune --tag video`);
 * they deliberately do NOT filter what gets loaded, because CLAUDE.md `@`
 * imports are static — the file that is imported is the file that is read, so
 * the only way to spend fewer tokens is to have fewer rules in it.
 */
export function parseRuleMeta(text) {
  const dateM = text.match(/^(\d{4})-(\d{2})-(\d{2})\s*:/);
  // Tags must lead the rule body (right after the date, or at the very start),
  // so a bracketed aside later in the sentence is not mistaken for a tag list.
  const tagM = text.match(/^(?:\d{4}-\d{2}-\d{2}\s*:\s*)?\[([^\]]+)\]/);
  return {
    date: dateM ? dateM[0].replace(/\s*:$/, '') : null,
    tags: tagM ? tagM[1].split(',').map((t) => t.trim()).filter(Boolean) : [],
  };
}

// Rough token cost of the imported ratchet, charged on every single request of
// every session. 4 bytes/token is the usual mixed ko/en approximation.
export const RATCHET_TOKEN_BUDGET = 2000;

export function ratchetSizeStatus({ root = findProjectRoot(), scope = 'project' } = {}) {
  const { path, rules, bytes = 0 } = harnessListRules({ root, scope });
  const tokens = Math.round(bytes / 4);
  return { path, count: rules.length, bytes, tokens, overBudget: tokens > RATCHET_TOKEN_BUDGET };
}

/**
 * harness prune — move rules out of ratchet.md into ratchet-archive.md next to
 * it. Selection is by tag and/or age; nothing is deleted, so a pruned rule can
 * be pasted back. Returns the pruned rules for the CLI to echo.
 */
export function harnessPrune({ root = findProjectRoot(), scope = 'project', tag = null, olderThanMonths = null, dryRun = false } = {}) {
  const { path: rmPath, rules } = harnessListRules({ root, scope });
  if (!existsSync(rmPath)) return { ok: false, error: `ratchet.md not found at ${rmPath}` };
  if (!tag && !olderThanMonths) return { ok: false, error: 'Nothing selected — pass --tag <t> and/or --older-than <months>' };
  const cutoff = olderThanMonths ? Date.now() - olderThanMonths * 30 * 24 * 60 * 60 * 1000 : null;
  const doomed = rules.filter((r) => {
    if (tag && !r.tags.includes(tag)) return false;
    // An undated rule has no age to judge, so age-based pruning leaves it be.
    if (cutoff !== null) {
      const t = r.date ? Date.parse(r.date) : NaN;
      if (!Number.isFinite(t) || t >= cutoff) return false;
    }
    return true;
  });
  if (dryRun || doomed.length === 0) return { ok: true, path: rmPath, pruned: doomed, dryRun: true };
  const content = readFileSync(rmPath, 'utf8');
  writeFileSync(rmPath + '.bak', content);
  const drop = new Set(doomed.map((r) => r.lineNo));
  const kept = content.split('\n').filter((_, i) => !drop.has(i));
  writeFileSync(rmPath, kept.join('\n'));
  const archivePath = join(dirname(rmPath), 'ratchet-archive.md');
  const header = existsSync(archivePath) ? '' : '# Ratchet Archive (pruned rules — not loaded into sessions)\n\n';
  const stamp = new Date().toISOString().slice(0, 10);
  const body = doomed.map((r) => `- ${r.text}  <!-- pruned ${stamp} -->`).join('\n') + '\n';
  writeFileSync(archivePath, (existsSync(archivePath) ? readFileSync(archivePath, 'utf8').replace(/\n*$/, '\n') : header) + body);
  return { ok: true, path: rmPath, backup: rmPath + '.bak', archive: archivePath, pruned: doomed };
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
  //   ratchet? > no-evidence > PEV-skip. Guards, in order:
  //   - freshness: the hook rewrites the state on every tool use, so anything
  //     older than WARNING_TTL_MS is a dead session's leftovers — a red 🅷⚠
  //     must never linger for days after the triggering session ended.
  //   - project match: state.cwd is the *session* cwd, which may be a subdir
  //     of the repo, while projectRoot is the walked-up root. Normalize both
  //     through findProjectRoot so launching Claude Code in a subdirectory
  //     still surfaces (and correctly scopes) the warning. A state with no
  //     cwd at all is unattributable — stay silent rather than leak it into
  //     every project.
  const WARNING_TTL_MS = 30 * 60 * 1000;
  const state = readHarnessState();
  let warning = null;
  if (state) {
    const ts = state.timestamp ? Date.parse(state.timestamp) : NaN;
    const fresh = Number.isFinite(ts) && Date.now() - ts <= WARNING_TTL_MS;
    const matches = !!state.cwd && findProjectRoot(state.cwd) === projectRoot;
    if (fresh && matches) {
      if (state.ratchetCandidate && state.ratchetCandidate.count >= 2) {
        const id = state.ratchetCandidate.id || 1;
        warning = `ratchet? #${id}`;
      }
      else if (state.evidenceLow) warning = 'no-evidence';
      else if (state.pevSkip) warning = 'PEV-skip';
    }
  }
  // Config defect, above the optimization nudges: the harness block is there
  // but carries no `@` import, so every promoted ratchet rule is dead weight.
  // One `harness init` re-run fixes it and the warning goes away for good.
  if (!warning && status.hasBlock && !(status.hasRatchetImport && status.hasModelRatchetImport)) warning = 'ratchet-unloaded';
  // Same class of defect, one notch lower: the session runs on a 1M-context
  // model with no `autoCompactWindow` cap, so compaction only fires past 800k
  // and every request until then re-bills the whole context. 200k sessions are
  // exempt — the setting cannot change anything for them.
  if (!warning) {
    try {
      warning = compactWindowWarningForStatusline(projectRoot, cfg);
    } catch { /* settings unreadable — stay silent */ }
  }
  // Below session-quality warnings: a promoted delegation rule whose
  // category started failing (`rule-health R<N>`) — the user approved that
  // rule, so its degradation outranks a mere new-candidate nudge.
  if (!warning) {
    try {
      warning = ruleHealthWarningForStatusline(projectRoot);
    } catch { /* registry unreadable — stay silent */ }
  }
  // Lowest precedence: route-scan delegation candidate (`route? R<N>`).
  // Session-quality warnings above always win — routing is an optimization
  // nudge, not a correctness signal. Cheap: one small cached-JSON read.
  if (!warning) {
    try {
      warning = routeWarningForStatusline(projectRoot);
    } catch { /* scan cache unreadable — stay silent */ }
  }
  return { ...status, warning };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
