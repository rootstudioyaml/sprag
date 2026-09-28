import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { codexUserDir } from './agent.js';
import { userDataDir } from './paths.js';
import { readCodexSnapshot } from './codex-parser.js';

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
export function runCodexBrief({ sessionId, transcriptPath, cwd, now = Date.now(), dir = userDataDir() } = {}) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const snapshot = readCodexSnapshot(transcriptPath);
  if (!snapshot || (snapshot.sessionId && snapshot.sessionId !== sessionId)) return null;
  const issues = codexIssues(snapshot, { now });
  const directory = stateDir(dir);
  const file = join(directory, `${hash(sessionId)}.json`);
  const state = readState(file);
  const active = Array.isArray(state.active) ? state.active.filter((sig) => typeof sig === 'string') : [];
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
