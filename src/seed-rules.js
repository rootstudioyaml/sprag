/**
 * seed-rules — the curated starter set, offered one rule at a time.
 *
 * Two things reach a fresh install with nothing behind them: the model-fitting
 * ratchet (`ratchet-model.md`), which is empty until route-scan has gathered
 * enough of the user's own history to propose a candidate, and the hand-written
 * ratchet (`ratchet.md`), which only ever grows from mistakes the user has
 * already made. So a brand-new install delegates nothing and remembers nothing,
 * and stays that way for days — exactly the period where the savings would
 * matter most.
 *
 * This module closes that gap with presets bundled in the package:
 *   presets/model-rules.json   → tier-delegation rules (the model ratchet)
 *   presets/ratchet-rules.md   → field-tested mistake rules (the global ratchet)
 *
 * Nothing is written without the user agreeing to that specific rule. The
 * SessionStart hook lists what is pending and tells the model to ask one rule at
 * a time; each answer is recorded in the state dir, so a declined rule stays
 * declined across sessions and upgrades, and a preset added in a later release
 * shows up as the only pending item rather than re-asking the whole set.
 *
 * State file: <stateDir>/seed-state.json
 *   { decided: { "<id>": { action: 'accepted' | 'skipped', at, scope? } } }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { userDataDir } from './paths.js';
import { userLanguage } from './config.js';
import {
  addModelRule,
  composeRuleText,
  loadModelRules,
  modelRuleBaseText,
  syncAllFiles,
} from './model-rules.js';
import {
  findProjectRoot,
  harnessListRules,
  harnessPromote,
  presetRuleEntries,
} from './harness.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function seedStatePath() {
  return join(userDataDir(), 'seed-state.json');
}

export function loadSeedState() {
  try {
    const data = JSON.parse(readFileSync(seedStatePath(), 'utf8'));
    return data && typeof data.decided === 'object' && data.decided ? data : { decided: {} };
  } catch {
    return { decided: {} };
  }
}

export function saveSeedState(state) {
  const dir = userDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(seedStatePath(), JSON.stringify(state, null, 2) + '\n');
}

/** Bundled tier-delegation presets (empty array when the file is unreadable). */
export function modelPresets() {
  try {
    const data = JSON.parse(readFileSync(join(packageRoot, 'presets', 'model-rules.json'), 'utf8'));
    return Array.isArray(data.presets) ? data.presets : [];
  } catch {
    return [];
  }
}

/**
 * Ratchet-text presets, each with an id derived from its own text. Index-based
 * ids would renumber the moment a rule is inserted above them, silently moving
 * a user's "no" onto a different rule.
 */
export function ratchetPresets(lang = userLanguage()) {
  return presetRuleEntries().map((r) => ({
    // Hashed from the Korean text in both languages: the id has to survive a
    // reworded translation, or a user who declined a rule would be asked again
    // the next time its English copy changes.
    id: `fix-${createHash('sha1').update(r.ko).digest('hex').slice(0, 6)}`,
    text: lang === 'ko' ? r.ko : r.en,
    ko: r.ko,
  }));
}

const stripDate = (t) => t.replace(/^\d{4}-\d{2}-\d{2}(\s*\([^)]*\))?:\s*/, '').trim();

/**
 * Everything still worth asking about: presets the user has not answered and
 * that are not already covered by a rule they have.
 *
 * "Already covered" is deliberately loose for model presets — any registered
 * rule for the same tier and category wins, whatever its scope or agent. A user
 * whose own route-scan already promoted that shape does not need ours, and
 * offering it anyway would read as the tool failing to notice its own state.
 */
export function pendingSeeds({ lang = userLanguage(), root = findProjectRoot() } = {}) {
  const { decided } = loadSeedState();
  const registered = (() => {
    try {
      return loadModelRules().rules;
    } catch {
      return [];
    }
  })();
  const haveModel = new Set(registered.map((r) => `${r.tier}|${r.category}`));

  const haveText = new Set();
  for (const scope of ['global', 'project']) {
    try {
      for (const r of harnessListRules({ root, scope }).rules) haveText.add(stripDate(r.text));
    } catch { /* a missing ratchet file just means nothing is registered yet */ }
  }

  const out = [];
  for (const p of modelPresets()) {
    if (decided[p.id]) continue;
    if (haveModel.has(`${p.tier}|${p.category}`)) continue;
    out.push({
      kind: 'model',
      id: p.id,
      tier: p.tier,
      label: lang === 'ko' ? p.label : p.labelEn,
      agent: p.agent,
      ruleText: composeRuleText(modelRuleBaseText(p, lang), { budget: p.budget }, lang),
      preset: p,
    });
  }
  for (const p of ratchetPresets(lang)) {
    if (decided[p.id]) continue;
    // Either language counts as already registered: `harness pull` may have
    // written the other one.
    if (haveText.has(stripDate(p.text)) || haveText.has(stripDate(p.ko))) continue;
    out.push({ kind: 'ratchet', id: p.id, ruleText: p.text, preset: p });
  }
  return out;
}

/** One pending seed by id, or null. Ids are matched exactly. */
export function findSeed(id, opts = {}) {
  return pendingSeeds(opts).find((s) => s.id === id) || null;
}

function recordDecision(id, action, extra = {}) {
  const state = loadSeedState();
  state.decided[id] = { action, at: new Date().toISOString().slice(0, 10), ...extra };
  saveSeedState(state);
}

/**
 * Register one preset. Scope is the caller's to decide — the same requirement
 * the ratchet itself puts on promote, because a rule in the wrong scope is
 * either noise in every other project or missing from the one that needed it.
 *
 * Returns { id, kind, scope, path?, rule } or null when the id is not pending.
 */
export async function acceptSeed(id, { scope = 'global', root = findProjectRoot(), lang = userLanguage() } = {}) {
  const seed = findSeed(id, { lang, root });
  if (!seed) return null;

  if (seed.kind === 'ratchet') {
    const res = harnessPromote(seed.ruleText, { root, scope });
    recordDecision(id, 'accepted', { scope });
    return { id, kind: 'ratchet', scope, path: res.path, rule: seed.ruleText };
  }

  const p = seed.preset;
  const today = new Date().toISOString().slice(0, 10);
  // A project-scope rule has to carry the munged project key, or the next scan
  // cannot match episode stats to it and the rule never updates. route-scan is
  // imported lazily: it pulls in the transcript parser, which is far too heavy
  // for the session-start path that only lists pending seeds.
  let project = null;
  if (scope === 'project') {
    const { mungeProjectPath } = await import('./route-scan.js');
    project = mungeProjectPath(root);
  }
  const entry = addModelRule({
    // Namespaced away from scan signatures (`T1|run|<project>`) so a later
    // promote of the user's own candidate for the same shape is a separate
    // entry rather than a silent overwrite.
    signature: `${p.tier}|${p.category}|preset`,
    tier: p.tier,
    category: p.category,
    label: p.label,
    labelEn: p.labelEn,
    agent: p.agent,
    scope,
    targetRoot: scope === 'project' ? root : null,
    project,
    rule: modelRuleBaseText(p, lang),
    example: p.example,
    exampleEn: p.exampleEn,
    count: 0,
    budget: p.budget || null,
    // Marks the rule as seeded rather than measured, so the rendered file does
    // not report someone else's recurrence count as this user's evidence.
    origin: 'preset',
    promotedAt: today,
    lastSeen: today,
  });
  const written = syncAllFiles();
  recordDecision(id, 'accepted', { scope });
  return { id, kind: 'model', scope, paths: written, rule: composeRuleText(entry.rule, entry, lang) };
}

/** Record a "no" so the rule is never offered again (until `seed reset`). */
export function skipSeed(id, opts = {}) {
  const seed = findSeed(id, opts);
  if (!seed) return null;
  recordDecision(id, 'skipped');
  return { id, kind: seed.kind, rule: seed.ruleText };
}

/** Forget every recorded answer — the full set becomes pending again. */
export function resetSeeds() {
  const state = loadSeedState();
  const count = Object.keys(state.decided).length;
  saveSeedState({ decided: {} });
  return count;
}

/**
 * The SessionStart block. Returns null when nothing is pending, which is the
 * steady state — every session after the offers are answered pays nothing.
 *
 * The model is told to ask one rule at a time because that is what the user
 * asked for, and because a single "register all of these?" question invites a
 * yes to rules the user never read.
 */
export function seedOfferBlock({ lang = userLanguage(), root = findProjectRoot() } = {}) {
  const pending = pendingSeeds({ lang, root });
  if (pending.length === 0) return null;
  const models = pending.filter((s) => s.kind === 'model');
  const fixes = pending.filter((s) => s.kind === 'ratchet');
  const lines = [];
  if (lang === 'ko') {
    lines.push(`[claude-token-saver seed] 아직 등록되지 않은 추천 룰이 ${pending.length}건 있습니다 (패키지 동봉 프리셋).`);
    lines.push('사용자에게 **한 건씩 순서대로** 보여 주고 등록할지 물어보십시오. 한 번에 전체 등록을 권하지 말고, 답을 받은 뒤 바로 아래 명령을 실행하십시오.');
    if (models.length > 0) {
      lines.push(`  · 모델 피팅 룰 ${models.length}건 — 등록하면 해당 유형 작업이 더 싼 서브에이전트로 위임됩니다.`);
      for (const s of models) {
        lines.push(`    [${s.id}] ${s.tier} · "${s.label}" → ${s.agent}`);
        lines.push(`        "${s.ruleText}"`);
      }
    }
    if (fixes.length > 0) {
      lines.push(`  · 랫쳇 룰 ${fixes.length}건 — 같은 실수를 반복하지 않도록 세션마다 읽히는 규칙입니다.`);
      for (const s of fixes) lines.push(`    [${s.id}] ${s.ruleText}`);
    }
    lines.push('  등록: claude-token-saver seed accept <id> --global|--project   # 적용 범위는 반드시 사용자에게 확인');
    lines.push('  거절: claude-token-saver seed skip <id>                        # 다시 묻지 않습니다');
    lines.push('  (사용자가 "전부 등록"이라고 답하면 `seed accept all --global` 을 쓸 수 있습니다)');
  } else {
    lines.push(`[claude-token-saver seed] ${pending.length} recommended rule(s) from the bundled presets are not registered yet.`);
    lines.push('Walk the user through them **one at a time** and ask about each. Do not push the whole set at once; run the matching command as soon as they answer.');
    if (models.length > 0) {
      lines.push(`  · ${models.length} model-fitting rule(s) — once registered, that kind of work goes to a cheaper subagent.`);
      for (const s of models) {
        lines.push(`    [${s.id}] ${s.tier} · "${s.label}" → ${s.agent}`);
        lines.push(`        "${s.ruleText}"`);
      }
    }
    if (fixes.length > 0) {
      lines.push(`  · ${fixes.length} ratchet rule(s) — read at the start of every session so the same mistake is not repeated.`);
      for (const s of fixes) lines.push(`    [${s.id}] ${s.ruleText}`);
    }
    lines.push('  register: claude-token-saver seed accept <id> --global|--project   # ALWAYS confirm the scope with the user');
    lines.push('  decline:  claude-token-saver seed skip <id>                        # never offered again');
    lines.push('  (if the user says "register them all", `seed accept all --global` does that)');
  }
  return lines.join('\n');
}
