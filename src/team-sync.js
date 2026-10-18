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
 * Opt out of all network traffic with SPRAG_NO_TEAM_SYNC=1.
 */

import { envVar } from './env.js';
import { readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { userInfo, release as osRelease } from 'node:os';
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

export function teamSyncDisabled(env = process.env) { return envVar('NO_TEAM_SYNC', env) === '1'; }
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

/**
 * One JSON request against the Supabase project, for the owner sign-in flow
 * (GoTrue email code + the teams table). Same injectable fetch and 8s timeout
 * as rpc(). Errors carry the server's own message. The access token only ever
 * lives in memory: it is never written to disk or printed.
 */
async function apiJson(path, { body, accessToken, label, fetch = globalThis.fetch, timeoutMs = 8000, url = TEAM_API_URL, key = TEAM_ANON_KEY, prefer } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}), signal: ctl.signal });
    let data = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }
    if (!res.ok) {
      const msg = (data && (data.msg || data.error_description || data.message)) || `HTTP ${res.status}`;
      throw new Error(`${label}: ${msg}`);
    }
    return data;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`${label}: timeout`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Email a 6-digit sign-in code (valid 15 minutes). Creates the user if new. */
export async function requestSignInCode({ email, fetch } = {}) {
  await apiJson('/auth/v1/otp', { body: { email, create_user: true }, label: 'sign-in', fetch });
}

/** Exchange the emailed code for a session. Returns { accessToken, userId }. */
export async function verifySignInCode({ email, code, fetch } = {}) {
  const r = await apiJson('/auth/v1/verify', { body: { type: 'email', email, token: code }, label: 'verify', fetch });
  if (!r || !r.access_token || !r.user || !r.user.id) throw new Error('verify: no session returned');
  return { accessToken: r.access_token, userId: r.user.id };
}

/**
 * Create a team through the team_create RPC as the signed-in user. A null orgId
 * makes the server open a new organization named after the team; otherwise the
 * caller must be an owner or admin of that organization. userId is accepted for
 * call-site compatibility; the server derives the owner from the session.
 */
export async function createTeam({ name, accessToken, userId, orgId = null, fetch } = {}) {
  void userId;
  const r = await apiJson('/rest/v1/rpc/team_create', {
    body: { p_name: name, p_org_id: orgId || null }, accessToken, label: 'create team', fetch,
  });
  const row = Array.isArray(r) ? r[0] : r;
  if (!row || !row.invite_token) throw new Error('create team: no invite token returned');
  return {
    id: row.id, name: row.name, inviteToken: row.invite_token, plan: row.plan,
    orgId: row.org_id || null, orgName: row.org_name || null,
  };
}

/** Typed error for the server's 'seat limit reached' refusal (code SEAT_LIMIT). */
export class SeatLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeatLimitError';
    this.code = 'SEAT_LIMIT';
  }
}

export const isSeatLimitError = (e) => !!e && (e.code === 'SEAT_LIMIT' || /seat limit reached/i.test(String(e.message || '')));

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

// Device info: OS name, OS version and CPU architecture. Nothing that names the
// machine (no hostname, username or path) is read or sent.
const DARWIN_TO_MACOS = { 20: '11', 21: '12', 22: '13', 23: '14', 24: '15', 25: '26' };

export function deviceInfo({
  platform = process.platform, arch = process.arch, release = osRelease(),
  exec = (cmd, args) => execFileSync(cmd, args, { timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
  readText = (f) => readFileSync(f, 'utf8'),
} = {}) {
  let os = String(platform);
  let osVersion = String(release || '');
  try {
    if (platform === 'darwin') {
      os = 'macOS';
      let v = '';
      try { v = String(exec('sw_vers', ['-productVersion'])).trim(); } catch (e) { debug('team-sync', e); }
      osVersion = v || DARWIN_TO_MACOS[parseInt(release, 10)] || osVersion;
    } else if (platform === 'win32') {
      os = 'Windows';
      const build = parseInt(String(release).split('.')[2], 10);
      osVersion = build >= 22000 ? '11' : '10';
    } else if (platform === 'linux') {
      os = 'Linux';
      try {
        const text = readText('/etc/os-release');
        const get = (k) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^"|"$/g, '');
        // NAME + VERSION_ID ("Ubuntu", "24.04"): the dashboard prints them
        // side by side, and PRETTY_NAME already carries the version.
        const name = get('NAME') || get('PRETTY_NAME');
        if (name) { os = name; osVersion = get('VERSION_ID') || osVersion; }
      } catch (e) { debug('team-sync', e); }
    }
  } catch (e) { debug('team-sync', e); }
  return { os: os.slice(0, 40), os_version: osVersion.slice(0, 40), arch: String(arch).slice(0, 40) };
}

// Reports device info once after a join and again only when it changes. Fails
// soft: the next sync retries. Never runs while uploads are switched off.
export async function reportDeviceInfo({ state, dir = userDataDir(), fetch, env = process.env } = {}) {
  if (teamSyncDisabled(env) || !isJoined(state)) return state;
  const info = deviceInfo();
  if (state.deviceInfo && JSON.stringify(state.deviceInfo) === JSON.stringify(info)) return state;
  try {
    await rpc('member_set_info', { member_key: state.memberKey, ...info }, { fetch });
    const next = { ...state, deviceInfo: info };
    saveTeamState(next, dir);
    return next;
  } catch (e) {
    debug('team-sync', e);
    return state;
  }
}

export async function joinTeam({
  token, displayName, agent = 'claude', autoJoined = false, fetch, dir = userDataDir(), version, now = Date.now(), env = process.env,
} = {}) {
  if (!TOKEN_RE.test(String(token || ''))) throw new Error('invalid invite token (expected spt_ + 32 hex characters)');
  const name = String(displayName || '').trim() || 'member';
  let r;
  try {
    r = await rpc('team_join', {
      invite_token: token, display_name: name, agent, sprag_version: version || '', auto_joined: !!autoJoined,
    }, { fetch });
  } catch (e) {
    if (isSeatLimitError(e)) throw new SeatLimitError(e.message);
    throw e;
  }
  if (!r || !r.member_key) throw new Error('team_join: no member key returned');
  const state = {
    version: TEAM_STATE_VERSION,
    teamId: r.team_id,
    teamName: r.team_name,
    memberId: r.member_id,
    memberKey: r.member_key,
    plan: r.plan,
    orgId: r.org_id || null,
    orgName: r.org_name || null,
    seatsUsed: Number.isFinite(r.seats_used) ? r.seats_used : null,
    seatLimit: Number.isFinite(r.seat_limit) ? r.seat_limit : null,
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
  return reportDeviceInfo({ state, dir, fetch, env });
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
  let state = loadTeamState(dir);
  // The switch stops every usage upload. A joined machine still tells the
  // server once that it paused (no usage data), so the organization sees a
  // paused seat instead of a machine that went quiet.
  if (teamSyncDisabled(env)) {
    if (!isJoined(state) || state.pausedReported) return { skipped: 'disabled' };
    try {
      await rpc('member_set_sync', { member_key: state.memberKey, paused: true }, { fetch });
      saveTeamState({ ...state, pausedReported: true }, dir);
      return { skipped: 'disabled', reported: 'paused' };
    } catch (e) {
      debug('team-sync', e);
      return { skipped: 'disabled', error: e.message };
    }
  }
  if (state.left) return { skipped: 'left' };
  if (!isJoined(state)) return { skipped: 'not-joined' };
  if (state.pausedReported) {
    try {
      await rpc('member_set_sync', { member_key: state.memberKey, paused: false }, { fetch });
      state = { ...state };
      delete state.pausedReported;
      saveTeamState(state, dir);
      force = true;
    } catch (e) {
      debug('team-sync', e);
    }
  }
  if (!force && !teamSyncDue(state, now)) return { skipped: 'not-due' };
  state = await reportDeviceInfo({ state, dir, fetch, env });
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
    if (r.org_name) next.orgName = r.org_name;
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
    return await joinTeam({ token, displayName: name, autoJoined: true, fetch, dir, version, now, env });
  } catch (e) {
    // SeatLimitError (code SEAT_LIMIT) lands here too: auto-join stays silent and retries next session.
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
