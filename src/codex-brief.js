import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { codexUserDir } from './agent.js';
import { userDataDir } from './paths.js';
import { readCodexSnapshot } from './codex-parser.js';
import { loadCodexModelRules } from './codex-delegation.js';
import { loadCodexLedger } from './codex-ledger.js';
import { codexRulesInReview } from './codex-rule-health.js';

const RESET_TOLERANCE_S = 300;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const stateDir = (dir) => join(dir, 'codex', hash(codexUserDir()), 'sessions');
const fresh = (value, now) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now + 60000 && now - timestamp < 300000;
};

export function codexIssues(snapshot, { now = Date.now() } = {}) {
  if (!snapshot) return [];
  const issues = [];
  const fraction = snapshot.contextWindow > 0 && Number.isFinite(snapshot.lastContextTokens)
    ? snapshot.lastContextTokens / snapshot.contextWindow : null;
  if (fraction >= 0.8 && fresh(snapshot.contextAt, now)) {
    const tier = fraction >= 0.95 ? 2 : 1;
    issues.push({ key: 'context', tier, signature: `context:${tier}`, level: tier === 2 ? 'critical' : 'warning',
      message: `Recorded input context is ${Math.round(fraction * 100)}% (${snapshot.lastContextTokens}/${snapshot.contextWindow} tokens).`,
      advice: 'Preserve decisions, verification results, and next steps before compaction. Use sprag handoff --agent codex when a handoff is needed.' });
  }
  if (fresh(snapshot.rateLimitsAt, now)) {
    for (const key of ['primary', 'secondary']) {
      const win = snapshot.rateLimits?.[key];
      if (!Number.isFinite(win?.used_percent) || win.used_percent < 90) continue;
      if (Number.isFinite(win.resets_at) && win.resets_at * 1000 <= now) continue;
      const label = Number.isFinite(win.window_minutes) && win.window_minutes > 0 ? `${win.window_minutes}m` : key;
      issues.push({ key: `limit:${key}`, tier: 1, signature: `limit:${key}:${win.resets_at ?? 'unknown'}`,
        level: 'warning', message: `Recorded ${label} rate limit is ${win.used_percent}% used.`,
        advice: 'Finish the current step and preserve the remaining work with sprag handoff --agent codex. This is a usage snapshot, not a billing estimate.' });
    }
  }
  return issues;
}

function readState(file) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    return state && Array.isArray(state.events) ? state : { events: [] };
  } catch { return { events: [] }; }
}

/** One file per home/session keeps unrelated sessions out of the same dedup state. */
export function runCodexBrief({ sessionId, transcriptPath, cwd, root: projectRoot, now = Date.now(), dir = userDataDir() } = {}) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const snapshot = readCodexSnapshot(transcriptPath);
  if (!snapshot || (snapshot.sessionId && snapshot.sessionId !== sessionId)) return null;
  const issues = codexIssues(snapshot, { now });
  const directory = stateDir(dir);
  const file = join(directory, `${hash(sessionId)}.json`);
  const state = readState(file);
  const active = Array.isArray(state.active) ? state.active.filter((sig) => typeof sig === 'string') : [];
  // Codex rewrites resets_at by about a second between records, so a limit
  // already announced for the same window keeps its first signature.
  for (const issue of issues) {
    const m = /^limit:(primary|secondary):(\d+(?:\.\d+)?)$/.exec(issue.signature);
    if (!m) continue;
    const resetsAt = Number(m[2]);
    const known = active.find((sig) => {
      const k = /^limit:(primary|secondary):(\d+(?:\.\d+)?)$/.exec(sig);
      return k && k[1] === m[1] && Math.abs(Number(k[2]) - resetsAt) <= RESET_TOLERANCE_S;
    });
    if (known) issue.signature = known;
  }
  // A failing model rule is announced once per session; the lines never block the other warnings.
  try {
    // The hook passes the project root its rule matching uses; a prompt sent from
    // a subdirectory must still see the project's rules.
    const root = resolve(projectRoot || cwd || snapshot.projectDir || '.');
    const rules = loadCodexModelRules({ dir });
    if (rules.length) {
      const events = Object.values(loadCodexLedger({ dir }).events);
      for (const { index, rule, health } of codexRulesInReview({ root, rules, events })) {
        issues.push({ key: 'rule-health', tier: 1,
          signature: `rule-health:${rule.scope}:${rule.targetRoot ?? ''}:${rule.category}:${rule.from}:${rule.model}:${rule.createdAt ?? ''}`,
          level: 'warning',
          message: `Codex model rule #${index} (${rule.category}, ${rule.from} -> ${rule.model}) failed ${health.errs} of ${health.runs} measured runs.`,
          advice: `Narrow or remove it: sprag delegate rules rm ${index} --agent codex` });
      }
    }
  } catch { /* An unreadable rule file or ledger only skips this line. */ }
  const next = issues.filter((issue) => !active.includes(issue.signature) &&
    !(issue.key === 'context' && issue.tier === 1 && active.includes('context:2')));
  // Missing or stale measurements do not resolve an earlier warning. A fresh
  // lower measurement does, so a refill after compaction can warn again.
  const observed = new Set();
  if (fresh(snapshot.contextAt, now) && snapshot.contextWindow > 0 && Number.isFinite(snapshot.lastContextTokens)) observed.add('context');
  if (fresh(snapshot.rateLimitsAt, now)) {
    for (const key of ['primary', 'secondary']) {
      if (Number.isFinite(snapshot.rateLimits?.[key]?.used_percent)) observed.add(`limit:${key}`);
    }
  }
  const remaining = active.filter((sig) => ![...observed].some((key) => sig.startsWith(`${key}:`)));
  const nextActive = [...new Set([...remaining, ...issues.map((issue) => issue.signature)])];
  if (!next.length && JSON.stringify(nextActive) === JSON.stringify(active)) return null;
  const at = new Date(now).toISOString();
  const events = [...state.events, ...next.map((issue) => ({ ...issue, at, sessionId, project: cwd || snapshot.projectDir || '' }))].slice(-200);
  mkdirSync(directory, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ active: nextActive, events }) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
  return next.length ? ['[Sprag Codex briefing]', ...next.map((issue) => `${issue.message} ${issue.advice}`)].join('\n') : null;
}

/**
 * Append one event outside the warning dedup, such as a handoff the user
 * wrote. Claude's history records handoffs too, so both agents' timelines
 * show when work was preserved.
 */
export function recordCodexHistoryEvent({ sessionId, project = '', key, level = 'info', message, advice = '', now = Date.now(), dir = userDataDir() } = {}) {
  if (typeof message !== 'string' || !message) return false;
  const owner = typeof sessionId === 'string' && sessionId ? sessionId : 'no-session';
  const directory = stateDir(dir);
  const file = join(directory, `${hash(owner)}.json`);
  const state = readState(file);
  const events = [...state.events, { key, tier: 0, signature: key, level, message, advice,
    at: new Date(now).toISOString(), sessionId: owner, project }].slice(-200);
  mkdirSync(directory, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...state, events }) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
  return true;
}

export function readCodexHistory({ days = 7, sessionId, project, dir = userDataDir(), now = Date.now() } = {}) {
  const directory = stateDir(dir);
  let files;
  try { files = readdirSync(directory); } catch { return []; }
  const cutoff = now - days * 86400000;
  return files.filter((file) => /^[a-f0-9]{64}\.json$/.test(file)).flatMap((file) => readState(join(directory, file)).events)
    .filter((event) => event && typeof event.message === 'string' && Date.parse(event.at) >= cutoff && Date.parse(event.at) <= now &&
      (!sessionId || event.sessionId === sessionId) && (!project || (typeof event.project === 'string' && event.project.includes(project))))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
