/**
 * team-sync — the opt-in team layer's client core.
 *
 * sprag is local-only by default. Nothing here runs unless team.json holds a
 * member key, which only `sprag team join` (or SPRAG_TEAM_TOKEN auto-join)
 * writes. Once joined, the CLI uploads DAILY AGGREGATES ONLY — spend, savings,
 * delegation counts and model-family share per local calendar day — and pulls
 * the team's approved rules. No prompts, paths or transcripts leave the machine.
 *
 * Files in the user data dir:
 *   team.json        membership state (mode 0600; holds the member key)
 *   team-rules.json  last pulled team rules
 *
 * Opt out of all network traffic with CTS_NO_TEAM_SYNC=1.
 */

import { readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { createRequire } from 'node:module';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { debug } from './debug.js';
import { loadLedger, modelFamily, roundUsd } from './savings-ledger.js';
import { sessionCost, pricedParts } from './claude-price.js';

const require = createRequire(import.meta.url);

export const TEAM_API_URL = 'https://hiycfjwswtkixyoqkznm.supabase.co';
// Public anon key (role=anon). Access is gated by the RPCs, not by this value.
export const TEAM_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpeWNmandzd3RraXh5b3Frem5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNTc4MzYsImV4cCI6MjEwNzgzMzgzNn0.gyYcvGD70CEX64aGV-dsmZgmmOBdvhJlzIpx9Qo2l3w';
export const TEAM_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const TEAM_STATE_VERSION = 1;

const TOKEN_RE = /^spt_[0-9a-f]{32}$/;
const MAX_ROWS = 400;

export function teamStatePath(dir = userDataDir()) { return join(dir, 'team.json'); }
export function teamRulesCachePath(dir = userDataDir()) { return join(dir, 'team-rules.json'); }

export function loadTeamState(dir = userDataDir()) {
  try {
    const s = JSON.parse(readFileSync(teamStatePath(dir), 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}

export function saveTeamState(state, dir = userDataDir()) {
  const file = teamStatePath(dir);
  writeStateFile(file, JSON.stringify(state, null, 2) + '\n');
  if (process.platform !== 'win32') {
    try { chmodSync(file, 0o600); } catch (e) { debug('team-sync', e); }
  }
}

export function teamSyncDisabled(env = process.env) { return env.CTS_NO_TEAM_SYNC === '1'; }
export function isJoined(state) { return !!(state && state.memberKey && !state.left); }

export function teamSyncDue(state, now = Date.now()) {
  return isJoined(state) && (!state.lastSyncAt || now - state.lastSyncAt >= TEAM_SYNC_INTERVAL_MS);
}

export async function rpc(fn, params, {
  fetch = globalThis.fetch, timeoutMs = 8000, url = TEAM_API_URL, key = TEAM_ANON_KEY,
} = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
      signal: ctl.signal,
    });
    let body = null;
    try { body = await res.json(); } catch { /* empty or non-JSON body */ }
    if (!res.ok) {
      const msg = (body && (body.message || body.hint)) || `HTTP ${res.status}`;
      throw new Error(`${fn}: ${msg}`);
    }
    return body;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`${fn}: timeout`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Local calendar day, same key as stats.js. */
function dayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * Per-day rows, oldest first, only days with activity inside the window.
 * saved_usd honours the `sprag saved reset` marks (events before a mark are
 * skipped), the same way the ledger totals do. delegated_errors is always null:
 * the ledger carries no error flag.
 */
export async function aggregateDaily({ now = Date.now(), dir = userDataDir(), days = 30, sessions = null } = {}) {
  const { readResetMarks, isBeforeReset } = require('./saved-reset.cjs');
  const doc2md = require('./doc2md-ledger.cjs');
  const cutoff = now - days * 24 * 3600 * 1000;
  const byDay = new Map();
  const get = (day) => {
    if (!byDay.has(day)) byDay.set(day, { spent: 0, saved: 0, runs: 0, fam: new Map() });
    return byDay.get(day);
  };
  let marks = {};
  try { marks = readResetMarks(dir) || {}; } catch (e) { debug('team-sync', e); }

  try {
    for (const e of Object.values(loadLedger().events)) {
      if (!Number.isFinite(e.ts) || e.ts < cutoff || e.ts > now) continue;
      if (isBeforeReset(e.ts, marks.routing)) continue;
      const d = get(dayKey(e.ts));
      const usd = Number(e.usd);
      if (Number.isFinite(usd)) d.saved += usd;
      d.runs += 1;
      const fam = modelFamily(e.to);
      d.fam.set(fam, (d.fam.get(fam) || 0) + 1);
    }
  } catch (e) { debug('team-sync', e); }

  try {
    for (const e of Object.values(doc2md.loadLedger(dir).events)) {
      if (!Number.isFinite(e.ts) || e.ts < cutoff || e.ts > now) continue;
      if (isBeforeReset(e.ts, marks.doc2md)) continue;
      get(dayKey(e.ts)).saved += Number(e.usd) || 0;
    }
  } catch (e) { debug('team-sync', e); }

  try {
    let list = sessions;
    if (!list) {
      const { parseAllSessions } = await import('./parser.js');
      list = await parseAllSessions({ days });
    }
    for (const s of list || []) {
      if (!s || !s.startTime || !s.totals) continue;
      const t = new Date(s.startTime).getTime();
      if (!Number.isFinite(t) || t < cutoff || t > now) continue;
      let cost = 0;
      for (const part of pricedParts(s)) {
        try {
          const c = sessionCost(part.totals, part.model);
          if (c) cost += c.actual;
        } catch (e) { debug('team-sync', e); }
      }
      get(dayKey(t)).spent += cost;
    }
  } catch (e) { debug('team-sync', e); }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .filter(([, d]) => d.spent || d.saved || d.runs)
    .map(([day, d]) => ({
      day,
      spent_usd: round4(d.spent),
      saved_usd: round4(d.saved),
      delegated_runs: d.runs,
      delegated_errors: null,
      family_share: Object.fromEntries(
        [...d.fam.entries()].map(([f, n]) => [f, Math.round((n / d.runs) * 1000) / 1000]),
      ),
    }));
}

export async function joinTeam({
  token, displayName, agent = 'claude', autoJoined = false, fetch, dir = userDataDir(), version, now = Date.now(),
} = {}) {
  if (!TOKEN_RE.test(String(token || ''))) throw new Error('invalid invite token (expected spt_ + 32 hex characters)');
  const name = String(displayName || '').trim() || 'member';
  const r = await rpc('team_join', {
    invite_token: token, display_name: name, agent, sprag_version: version || '', auto_joined: !!autoJoined,
  }, { fetch });
  if (!r || !r.member_key) throw new Error('team_join: no member key returned');
  const state = {
    version: TEAM_STATE_VERSION,
    teamId: r.team_id,
    teamName: r.team_name,
    memberId: r.member_id,
    memberKey: r.member_key,
    plan: r.plan,
    promptCapture: !!r.prompt_capture,
    displayName: name,
    agent,
    joinedAt: now,
    autoJoined: !!autoJoined,
    autoJoinNoticePending: !!autoJoined,
    lastSyncAt: null,
    lastSyncRows: 0,
  };
  saveTeamState(state, dir);
  return state;
}

export async function leaveTeam({ fetch, dir = userDataDir(), now = Date.now() } = {}) {
  const prev = loadTeamState(dir);
  let lastError;
  if (prev.memberKey) {
    try { await rpc('team_leave', { member_key: prev.memberKey }, { fetch }); }
    catch (e) { debug('team-sync', e); lastError = e.message; }
  }
  const next = { version: TEAM_STATE_VERSION, left: true, leftAt: now, teamName: prev.teamName, displayName: prev.displayName };
  if (lastError) next.lastError = lastError;
  saveTeamState(next, dir);
  try { rmSync(teamRulesCachePath(dir), { force: true }); } catch (e) { debug('team-sync', e); }
  return next;
}

export async function syncTeam({
  now = Date.now(), dir = userDataDir(), fetch, force = false, env = process.env, version, sessions,
} = {}) {
  if (teamSyncDisabled(env)) return { skipped: 'disabled' };
  const state = loadTeamState(dir);
  if (state.left) return { skipped: 'left' };
  if (!isJoined(state)) return { skipped: 'not-joined' };
  if (!force && !teamSyncDue(state, now)) return { skipped: 'not-due' };
  try {
    const rows = (await aggregateDaily({ now, dir, sessions })).slice(-MAX_ROWS);
    await rpc('ledger_upsert', { member_key: state.memberKey, rows, sprag_version: version || '' }, { fetch });
    const r = (await rpc('team_rules_get', { member_key: state.memberKey }, { fetch })) || {};
    const rules = Array.isArray(r.rules) ? r.rules : [];
    writeStateFile(teamRulesCachePath(dir), JSON.stringify({
      version: 1, fetchedAt: now, teamId: r.team_id, teamName: r.team_name, plan: r.plan,
      promptCapture: !!r.prompt_capture, rules, removed: Array.isArray(r.removed) ? r.removed : [],
    }, null, 2) + '\n');
    const next = { ...state, lastSyncAt: now, lastSyncRows: rows.length };
    if (r.team_name) next.teamName = r.team_name;
    if (r.plan) next.plan = r.plan;
    if (r.prompt_capture !== undefined) next.promptCapture = !!r.prompt_capture;
    delete next.lastError;
    saveTeamState(next, dir);
    return { uploaded: rows.length, rules: rules.length };
  } catch (e) {
    debug('team-sync', e);
    // Stamp lastSyncAt too, so an offline machine backs off for the interval.
    try { saveTeamState({ ...state, lastSyncAt: now, lastError: e.message }, dir); } catch (e2) { debug('team-sync', e2); }
    return { error: e.message };
  }
}

export async function autoJoin({ env = process.env, fetch, dir = userDataDir(), version, now = Date.now() } = {}) {
  const token = env.SPRAG_TEAM_TOKEN;
  if (!token || !TOKEN_RE.test(token)) return null;
  const state = loadTeamState(dir);
  // A state with `left: true` never auto-rejoins: leaving must beat the
  // environment, or `sprag team leave` would be undone by the next session.
  if (isJoined(state) || state.left) return null;
  let name = 'member';
  try { name = userInfo().username || 'member'; } catch { /* no passwd entry */ }
  try {
    return await joinTeam({ token, displayName: name, autoJoined: true, fetch, dir, version, now });
  } catch (e) {
    debug('team-sync', e);
    return null;
  }
}

export function autoJoinNotice(state, lang = 'en') {
  if (!state || !state.autoJoinNoticePending) return null;
  state.autoJoinNoticePending = false;
  const name = state.teamName || '';
  return lang === 'ko'
    ? `Sprag: 이 PC는 SPRAG_TEAM_TOKEN 으로 팀 "${name}" 에 자동 참여됐습니다. 보내는 것은 하루 단위 집계(지출·절감·위임 횟수)뿐입니다. \`sprag team status --show-payload\` 로 내용을 확인하고 \`sprag team leave\` 로 멈출 수 있습니다.`
    : `Sprag: this machine was enrolled in team "${name}" through SPRAG_TEAM_TOKEN. It sends daily aggregates only (spend, savings, delegation counts). See what is sent with \`sprag team status --show-payload\`; stop with \`sprag team leave\`.`;
}
