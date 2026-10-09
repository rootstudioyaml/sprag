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
import { fileURLToPath } from 'node:url';
import {
  HARNESS_SECTIONS,
  HARNESS_BLOCK_BEGIN,
  HARNESS_BLOCK_END,
  harnessClaudeMdBlock,
  harnessRatchetMdInitial,
  appendRatchetRule,
  RATCHET_IMPORT_RE,
  MODEL_RATCHET_IMPORT_RE,
  renderPresetRatchet,
} from './harness-templates.js';
import { routeWarningForStatusline } from './route-scan.js';
import { ruleHealthWarningForStatusline, modelRatchetPathFor, renderModelRatchet } from './model-rules.js';
import { compactWindowWarningForStatusline } from './compact-window.js';
import { userLanguage } from './config.js';
import { codexUserDir } from './agent.js';

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
export function findProjectRoot(start = process.cwd(), { agent = 'claude' } = {}) {
  let dir = resolve(start);
  for (;;) {
    if (
      (agent === 'codex'
        ? existsSync(join(dir, 'AGENTS.md')) || existsSync(join(dir, 'AGENTS.override.md'))
        : existsSync(join(dir, 'CLAUDE.md'))) ||
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

function resolveRatchetPath(scope, root, agent = 'claude') {
  if (agent === 'codex') return scope === 'global' ? join(codexUserDir(), 'ratchet.md') : join(root, '.codex', 'ratchet.md');
  return scope === 'global' ? globalRatchetMdPath() : ratchetMdPath(root);
}

function initialRatchet(agent) {
  return agent === 'codex' ? '# Codex Ratchet Rules\n\n## Rules\n\n' : harnessRatchetMdInitial();
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
    const hasBegin = existing.includes(HARNESS_BLOCK_BEGIN);
    const blockRe = new RegExp(
      `${escapeRe(HARNESS_BLOCK_BEGIN)}[\\s\\S]*?${escapeRe(HARNESS_BLOCK_END)}\\n?`,
      'm',
    );
    const hasCompleteBlock = blockRe.test(existing);
    if (hasBegin && !hasCompleteBlock) {
      // A begin marker with no end marker after it: the extent of our block is
      // unknowable, so replacing or appending would either eat the user's text
      // or leave a second block beside the broken one. Touch nothing.
      result.skipped.push(`${cmPath} (harness block has a begin marker but no end marker — fix it manually)`);
      result.brokenBlock = true;
    } else if (hasCompleteBlock) {
      // Already has a harness block — replace it in-place, preserving the
      // user's other content above/below. This holds with or without --force:
      // --force used to fall through to the append branch, which added a second
      // block on every run.
      // A replacer function, not the string: `$&` or `$1` in a block would be
      // read as a replacement pattern.
      const next = existing.replace(blockRe, () => block);
      if (next === existing) {
        result.skipped.push(`${cmPath} (harness block already up to date)`);
      } else {
        if (force) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
          const bak = `${cmPath}.bak-${stamp}`;
          writeFileSync(bak, existing);
          result.backedUp.push(bak);
        }
        writeFileSync(cmPath, next);
        result.wrote.push(cmPath + ' (block updated in place)');
      }
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

  // ratchet-preset.md — tool-owned and imported by the global block only, so
  // it is seeded here for the same reason as ratchet-model.md above.
  if (scope === 'global') {
    const prPath = join(homedir(), '.claude', 'ratchet-preset.md');
    if (!existsSync(prPath)) {
      try {
        writeFileSync(prPath, renderPresetRatchet([], { lang: userLanguage() }));
        result.wrote.push(prPath);
      } catch { /* unwritable — the next session start renders it */ }
    }
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
    const beginIdx = existing.indexOf(HARNESS_BLOCK_BEGIN);
    const uninitRe = new RegExp(
      `\\n*${escapeRe(HARNESS_BLOCK_BEGIN)}[\\s\\S]*?${escapeRe(HARNESS_BLOCK_END)}\\n?`,
      'm',
    );
    if (beginIdx !== -1 && !uninitRe.test(existing)) {
      // Begin marker without an end marker: nothing to cut safely, and writing
      // the file back unchanged would still report a removal.
      result.skipped.push(`${cmPath} (harness block has a begin marker but no end marker — fix it manually)`);
    } else if (beginIdx !== -1) {
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
export function harnessPromote(ruleText, { root = findProjectRoot(), scope = 'project', agent = 'claude' } = {}) {
  const rmPath = resolveRatchetPath(scope, root, agent);
  let existing = '';
  if (existsSync(rmPath)) {
    existing = readFileSync(rmPath, 'utf8');
  } else {
    mkdirSync(dirname(rmPath), { recursive: true });
    existing = initialRatchet(agent);
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
export async function harnessPull({ root = findProjectRoot(), scope = 'global', agent = 'claude' } = {}) {
  // Global presets live in ratchet-preset.md now, rendered from recorded
  // answers, so pulling them globally is accepting every one of them.
  if (scope === 'global') {
    const { acceptedGlobalPresets, presetRatchetPath } = await import('./preset-ratchet.js');
    const { pendingSeeds, acceptSeed } = await import('./seed-rules.js');
    const added = [];
    for (const s of pendingSeeds({ root, agent }).filter((x) => x.kind === 'ratchet')) {
      if (await acceptSeed(s.id, { scope: 'global', root, agent })) added.push(s.ruleText);
    }
    const all = acceptedGlobalPresets({ agent }).length;
    return { path: presetRatchetPath({ agent }), scope, added, skippedRules: all - added.length, presets: presetRuleEntries().length };
  }
  const presets = presetRules();
  const rmPath = resolveRatchetPath(scope, root, agent);
  const result = { path: rmPath, scope, added: [], skippedRules: 0, presets: presets.length };
  const stripDate = (t) => t.replace(/^\d{4}-\d{2}-\d{2}:\s*/, '').trim();

  let content = existsSync(rmPath)
    ? readFileSync(rmPath, 'utf8')
    : initialRatchet(agent);
  const have = new Set(
    harnessListRules({ root, scope, agent }).rules.map((r) => stripDate(r.text)),
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

/**
 * The bundled preset rules, both languages per rule.
 *
 * These strings are injected into the model's context (by `seed`) and written
 * into the user's ratchet (by `pull`), so a Korean-only set would pull an
 * English session's responses into Korean — hence the pair. The `ko` text is
 * canonical: it is what identifies a rule, so revising an English wording never
 * turns a rule the user already answered into a new one.
 */
export function presetRuleEntries() {
  try {
    // fileURLToPath, not `.pathname`: the latter yields `/D:/repo/src` on
    // Windows, where the read fails and the catch below turns a missing
    // file into an empty rule set without ever saying so.
    const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'presets', 'ratchet-rules.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return (Array.isArray(data.rules) ? data.rules : [])
      .filter((r) => r && typeof r.ko === 'string' && r.ko.trim())
      .map((r) => ({ ko: r.ko.trim(), en: (r.en || r.ko).trim(),
        ...(Array.isArray(r.agents) ? { agents: r.agents.filter((a) => typeof a === 'string') } : {}) }));
  } catch {
    return [];
  }
}

/** Preset rule text in the user's configured language. */
export function presetRules(lang = userLanguage()) {
  return presetRuleEntries().map((r) => (lang === 'ko' ? r.ko : r.en));
}

/**
 * harness list — return numbered ratchet rules from .claude/ratchet.md.
 * Numbering is 1-based and matches `harness rm <N>`.
 */
export function harnessListRules({ root = findProjectRoot(), scope = 'project', agent = 'claude' } = {}) {
  const rmPath = resolveRatchetPath(scope, root, agent);
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

// CLAUDE.md itself is also charged on every request. The community guideline
// is "rules and file pointers, not documentation" — the harness block plus a
// modest project section fits well under this; docs pasted wholesale do not.
export const CLAUDE_MD_TOKEN_BUDGET = 4000;

/**
 * Advisory size/ignore facts for `harness check`:
 *  - approx token weight of the project (or global) CLAUDE.md
 *  - whether the project has a .claudeignore (limits what Claude Code will
 *    read into context during searches)
 * Purely informational — never affects the 🅷 N/5 score.
 */
export function contextWeightStatus({ root = findProjectRoot() } = {}) {
  const out = { claudeMd: null, hasClaudeIgnore: false };
  try {
    out.hasClaudeIgnore = existsSync(join(root, '.claudeignore'));
  } catch { /* fs error → treat as absent */ }
  for (const file of [join(root, 'CLAUDE.md'), join(homedir(), '.claude', 'CLAUDE.md')]) {
    try {
      if (!existsSync(file)) continue;
      const bytes = statSync(file).size;
      const tokens = Math.round(bytes / 4);
      out.claudeMd = { path: file, bytes, tokens, overBudget: tokens > CLAUDE_MD_TOKEN_BUDGET };
      break; // project file wins; global only as fallback
    } catch { /* unreadable → skip */ }
  }
  return out;
}

/**
 * harness prune — move rules out of ratchet.md into ratchet-archive.md next to
 * it. Selection is by tag and/or age; nothing is deleted, so a pruned rule can
 * be pasted back. Returns the pruned rules for the CLI to echo.
 */
export function harnessPrune({ root = findProjectRoot(), scope = 'project', agent = 'claude', tag = null, olderThanMonths = null, dryRun = false } = {}) {
  const { path: rmPath, rules } = harnessListRules({ root, scope, agent });
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
export function harnessRmRule(n, { root = findProjectRoot(), scope = 'project', agent = 'claude' } = {}) {
  const { path: rmPath, rules } = harnessListRules({ root, scope, agent });
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
export function harnessStatusForStatusline(cfg, { root, liveWindow = null } = {}) {
  if (cfg && cfg.harness && cfg.harness.enabled === false) return null;
  const projectRoot = root || findProjectRoot();
  const status = harnessStatus(projectRoot);
  // Silent when the project has neither CLAUDE.md nor a .claude/ dir — the
  // user hasn't opted in, no point nagging.
  if (!status.hasFile && !existsSync(join(projectRoot, '.claude'))) return null;
  if (status.optOut) return null;
  // Warnings derived from the analyzer state file (if any), then the config
  // and registry checks below. Every check runs and collects, in precedence
  // order, so the chip can name the first and count the rest: stopping at the
  // first hid everything behind it (a `PEV-skip` on screen meant a failing
  // `rule-health` was invisible until the PEV one cleared).
  //
  // Precedence: ratchet? > no-evidence > PEV-skip > ratchet-unloaded >
  // compact-window? > rule-health > route?. Guards on the state file, in order:
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
  const warnings = [];
  if (state) {
    const ts = state.timestamp ? Date.parse(state.timestamp) : NaN;
    const fresh = Number.isFinite(ts) && Date.now() - ts <= WARNING_TTL_MS;
    const matches = !!state.cwd && findProjectRoot(state.cwd) === projectRoot;
    if (fresh && matches) {
      if (state.ratchetCandidate && state.ratchetCandidate.count >= 2) {
        const id = state.ratchetCandidate.id || 1;
        warnings.push(`ratchet? #${id}`);
      }
      if (state.evidenceLow) warnings.push('no-evidence');
      if (state.pevSkip) warnings.push('PEV-skip');
    }
  }
  // Config defect, above the optimization nudges: the harness block is there
  // but carries no `@` import, so every promoted ratchet rule is dead weight.
  // One `harness init` re-run fixes it and the warning goes away for good.
  if (status.hasBlock && !(status.hasRatchetImport && status.hasModelRatchetImport)) warnings.push('ratchet-unloaded');
  // Same class of defect, one notch lower: the session runs on a 1M-context
  // model with no `autoCompactWindow` cap, so compaction only fires past 800k
  // and every request until then re-bills the whole context. 200k sessions are
  // exempt — the setting cannot change anything for them.
  try {
    const w = compactWindowWarningForStatusline(projectRoot, cfg, { liveWindow });
    if (w) warnings.push(w);
  } catch { /* settings unreadable — stay silent */ }
  // Below session-quality warnings: a promoted delegation rule whose
  // category started failing (`rule-health R<N>`) — the user approved that
  // rule, so its degradation outranks a mere new-candidate nudge.
  try {
    const w = ruleHealthWarningForStatusline(projectRoot);
    if (w) warnings.push(w);
  } catch { /* registry unreadable — stay silent */ }
  // Lowest precedence: route-scan delegation candidate (`route? R<N>`).
  // Session-quality warnings above always win — routing is an optimization
  // nudge, not a correctness signal. Cheap: one small cached-JSON read.
  try {
    const w = routeWarningForStatusline(projectRoot);
    if (w) warnings.push(w);
  } catch { /* scan cache unreadable — stay silent */ }
  // `warning` is the one shown; `moreWarnings` counts the ones it outranks.
  // The checks after the state file are a few small JSON reads (settings,
  // model-rules.json ~11KB, route-scan.json ~1KB). A render with no warning
  // already ran all of them; the change is that they now also run while an
  // earlier warning is up, so no render does more than the clean one did.
  return { ...status, warning: warnings[0] || null, moreWarnings: Math.max(0, warnings.length - 1), warnings };

}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
