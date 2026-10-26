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
 *   team-rules.json  last pulled rules (organization rules first, then team
 *                    rules; each row carries level 'org' or 'team')
 *
 * Rules arrive with every full sync (5 minutes) and with the rules-only pull
 * (`team sync --rules-only`, at most hourly). Either kind rewrites the ratchet
 * files right away, so a new session picks the rules up without waiting for
 * the next session-start render.
 *
 * Opt out of all network traffic with SPRAG_NO_TEAM_SYNC=1.
 */

import { envVar } from './env.js';
import { readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { release as osRelease } from 'node:os';
import { createRequire } from 'node:module';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { memberId, readMemberId } from './member-id.js';
import { userLanguage } from './config.js';
import { debug } from './debug.js';
import { trustSystemCA } from './system-ca.js';
import { loadLedger, modelFamily, roundUsd } from './savings-ledger.js';
import { sessionCost, pricedParts } from './claude-price.js';
import { uploadPrompts, dropOffsets, promptOffsetsExist } from './team-prompts.js';
import { rulesPullDue, syncTeamRatchet, ensureTeamImport } from './team-ratchet.js';
import { codexUserDir } from './agent.js';

export const PROMPT_SYNC_INTERVAL_MS = 30 * 60 * 1000;

const require = createRequire(import.meta.url);

export const TEAM_API_URL = 'https://hiycfjwswtkixyoqkznm.supabase.co';
// Public anon key (role=anon). Access is gated by the RPCs, not by this value.
export const TEAM_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpeWNmandzd3RraXh5b3Frem5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNTc4MzYsImV4cCI6MjEwNzgzMzgzNn0.gyYcvGD70CEX64aGV-dsmZgmmOBdvhJlzIpx9Qo2l3w';
// Local testing only: SPRAG_TEAM_API_URL + SPRAG_TEAM_ANON_KEY point the client at a local stack.
export const teamApiUrl = (env = process.env) => envVar('TEAM_API_URL', env) || TEAM_API_URL;
export const teamAnonKey = (env = process.env) => envVar('TEAM_ANON_KEY', env) || TEAM_ANON_KEY;
export const TEAM_SYNC_INTERVAL_MS = 5 * 60 * 1000;   // the copy in team-ratchet.js must match (test/team-prompts.test.js pins them)
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

/**
 * The member's animal from the virtual office, stored as `standing` in team.json
 * for the statusline chip. Best effort: a server older than member_standing
 * (PGRST202) or any failure leaves the state untouched and never fails the caller.
 */
async function refreshStanding({ memberKey, dir, fetch, now }) {
  try {
    const r = await rpc('member_standing', { member_key: memberKey }, { fetch });
    if (!r || typeof r !== 'object' || typeof r.grade !== 'string') return;
    const cur = loadTeamState(dir);
    if (!isJoined(cur) || cur.memberKey !== memberKey) return;
    saveTeamState({
      ...cur,
      standing: { grade: r.grade, tier: r.tier ?? null, rank: Number.isFinite(r.rank) ? r.rank : null, ranked: Number.isFinite(r.ranked) ? r.ranked : null, crown: !!r.crown, fetchedAt: now },
    }, dir);
  } catch (e) {
    debug('team-sync', e); // PGRST202 "Could not find the function": an older server, ignore
  }
}

/**
 * What the statusline `team` chip needs, from team.json and the member-id file
 * alone: no network and no file creation. Null when not joined (or left).
 */
export function readTeamChip({ dir = userDataDir() } = {}) {
  try {
    const state = loadTeamState(dir);
    if (!isJoined(state)) return null;
    const label = String(state.displayName || '').trim() || readMemberId({ dir });
    if (!label) return null;
    const st = state.standing;
    return {
      label,
      lang: userLanguage(),
      standing: st && typeof st.grade === 'string'
        ? { grade: st.grade, rank: Number.isFinite(st.rank) ? st.rank : null, ranked: Number.isFinite(st.ranked) ? st.ranked : null, fetchedAt: Number(st.fetchedAt) || 0 }
        : null,
    };
  } catch (e) { debug('team-sync', e); return null; }
}

export function teamSyncDisabled(env = process.env) { return envVar('NO_TEAM_SYNC', env) === '1'; }
export function isJoined(state) { return !!(state && state.memberKey && !state.left); }

/** Prompt uploads run on their own 30-minute timer, only while capture is on. */
export function promptSyncDue(state, now = Date.now()) {
  return isJoined(state) && state.promptCapture === true && !state.pausedReported
    && (!state.lastPromptSyncAt || now - state.lastPromptSyncAt >= PROMPT_SYNC_INTERVAL_MS);
}

export const LEDGER_RETRY_BASE_MS = 15 * 60 * 1000;
export const LEDGER_RETRY_MAX_MS = 60 * 60 * 1000;
const IN_FLIGHT_MS = 2 * 60 * 1000;
export const LEDGER_WINDOW_DAYS = 30;

/** Retry delay after n consecutive failed ledger syncs: 15, 30, 60 minutes, then 60. */
export function ledgerRetryDelayMs(failures) {
  const n = Math.max(1, Math.floor(Number(failures) || 1));
  return Math.min(LEDGER_RETRY_BASE_MS * 2 ** (n - 1), LEDGER_RETRY_MAX_MS);
}

/**
 * The ledger/rules sync is due every 5 minutes after the last SUCCESS, or, after a
 * failure, when the backoff since the last attempt has elapsed. An attempt that
 * began less than 2 minutes ago counts as in flight, so two hooks do not both spawn.
 */
export function teamSyncDue(state, now = Date.now()) {
  if (!isJoined(state)) return false;
  const attempt = Number(state.lastSyncAttemptAt);
  if (Number.isFinite(attempt) && attempt > 0 && now - attempt >= 0 && now - attempt < IN_FLIGHT_MS) return false;
  const failures = Number(state.syncFailures) || 0;
  if (failures > 0) return !Number.isFinite(attempt) || attempt <= 0 || now - attempt >= ledgerRetryDelayMs(failures);
  return !state.lastSyncAt || now - state.lastSyncAt >= TEAM_SYNC_INTERVAL_MS;
}

/**
 * Which local days a ledger sync uploads: from the day before the watermark (that
 * day was still open when it was uploaded) through today, at most 30 days. With
 * no watermark, the last 30 days.
 */
export function ledgerWindow(state, now = Date.now()) {
  const today = new Date(now);
  const earliest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (LEDGER_WINDOW_DAYS - 1));
  let start = earliest;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(state?.ledgerSyncedThrough || ''));
  if (m) {
    const from = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1);
    if (from > earliest) start = from;
  }
  const startKey = dayKey(start.getTime());
  // aggregateDaily cuts by time, so ask for a little more and filter by day below
  const days = Math.ceil((now - start.getTime()) / 86400000) + 1;
  return { startKey, days };
}

/**
 * The preset bundle version this machine runs (0 for the bundled presets), so
 * the /ops console can show how far a published version has rolled out. A
 * server without the preset_version argument (before 20261018001400_presets)
 * answers "Could not find the function"; the upload is then repeated without it.
 */
async function ledgerUpsert({ memberKey, rows, version, dir, fetch }) {
  const params = { member_key: memberKey, rows, sprag_version: version || '' };
  let presetVersion = null;
  try {
    const { presetSource } = await import('./presets-source.js');
    const s = presetSource({ dir });
    presetVersion = s.kind === 'remote' ? s.version : 0;
  } catch (e) { debug('team-sync:preset-version', e); }
  if (presetVersion == null) return rpc('ledger_upsert', params, { fetch });
  try {
    return await rpc('ledger_upsert', { ...params, preset_version: presetVersion }, { fetch });
  } catch (e) {
    if (!/preset_version|Could not find the function|PGRST202/i.test(String(e && e.message))) throw e;
    return rpc('ledger_upsert', params, { fetch });
  }
}

export async function rpc(fn, params, {
  fetch = globalThis.fetch, timeoutMs = 8000, url = teamApiUrl(), key = teamAnonKey(),
} = {}) {
  trustSystemCA();
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
async function apiJson(path, { body, accessToken, label, fetch = globalThis.fetch, timeoutMs = 8000, url = teamApiUrl(), key = teamAnonKey(), prefer } = {}) {
  trustSystemCA();
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

/** The server refuses uploads and joins 14 days after an organization's paid term ends ('org_expired: ...'). */
export const isOrgExpiredError = (e) => /\borg_expired\b/.test(String((e && e.message) || e || ''));

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

// Device info: OS name and OS version. The CPU architecture is not sent: the
// `arch` key stays in the payload (the member_set_info RPC takes it as an
// argument) but is always empty. Nothing that names the machine (no hostname,
// username or path) is read or sent.
const DARWIN_TO_MACOS = { 20: '11', 21: '12', 22: '13', 23: '14', 24: '15', 25: '26' };

export function deviceInfo({
  platform = process.platform, release = osRelease(),
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
  return { os: os.slice(0, 40), os_version: osVersion.slice(0, 40), arch: '' };
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
  const device = memberId({ dir });
  const name = String(displayName || '').trim() || device;
  const params = { invite_token: token, display_name: name, agent, sprag_version: version || '', auto_joined: !!autoJoined };
  let r;
  try {
    // device_id lets the server find this machine's earlier row in the organization and reuse its seat
    // instead of adding a second one. A server older than that answers "Could not find the function";
    // the join is then repeated without it.
    try {
      r = await rpc('team_join', { ...params, device_id: device }, { fetch });
    } catch (e) {
      if (!/device_id|Could not find the function|PGRST202/i.test(String(e && e.message))) throw e;
      r = await rpc('team_join', params, { fetch });
    }
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
  const out = await reportDeviceInfo({ state, dir, fetch, env });
  await refreshStanding({ memberKey: r.member_key, dir, fetch, now });
  return out;
}

export const DISPLAY_NAME_MAX = 80;

/**
 * Rename this machine's member row (`sprag team name <n>`). The server trims
 * and cuts the name the same way; its answer is what gets stored locally.
 * Throws when not joined or the name is empty, before any fetch.
 */
export async function setDisplayName({ displayName, fetch, dir = userDataDir() } = {}) {
  // Array.from counts code points like Postgres left() does, so an emoji is never split.
  const name = Array.from(String(displayName || '').trim()).slice(0, DISPLAY_NAME_MAX).join('').trim();
  if (!name) throw new Error('display name is empty');
  const state = loadTeamState(dir);
  if (!isJoined(state)) throw new Error('not in a team');
  const r = await rpc('member_set_name', { member_key: state.memberKey, display_name: name }, { fetch });
  const stored = typeof r === 'string' && r.trim() ? r : name;
  // Re-read so a background sync that saved in the meantime keeps its fields.
  saveTeamState({ ...loadTeamState(dir), displayName: stored }, dir);
  return stored;
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

/**
 * Pull the approved rules and write team-rules.json. Rows are kept as the
 * server sends them, `level` included. Returns the RPC body and the rule rows.
 */
async function pullRules({ memberKey, dir, fetch, now }) {
  const r = (await rpc('team_rules_get', { member_key: memberKey }, { fetch })) || {};
  const rules = Array.isArray(r.rules) ? r.rules : [];
  writeStateFile(teamRulesCachePath(dir), JSON.stringify({
    version: 1, fetchedAt: now, teamId: r.team_id, teamName: r.team_name, orgId: r.org_id || null, orgName: r.org_name || null,
    plan: r.plan, promptCapture: !!r.prompt_capture, rules, removed: Array.isArray(r.removed) ? r.removed : [],
  }, null, 2) + '\n');
  return { r, rules };
}

/** State fields a rules pull refreshes. */
function withRulesMeta(state, r, now) {
  const next = { ...state, lastRulesAt: now };
  if (r.team_name) next.teamName = r.team_name;
  if (r.plan) next.plan = r.plan;
  if (r.org_name) next.orgName = r.org_name;
  if (r.prompt_capture !== undefined) next.promptCapture = !!r.prompt_capture;
  delete next.lastRulesError;
  return next;
}

/**
 * Re-render the ratchet files from the fresh cache, for Claude Code and, when
 * its home exists, Codex, and keep the CLAUDE.md import in step. Fails soft:
 * the session-start hook renders them again anyway.
 */
export function refreshTeamRatchetFiles({ dir = userDataDir() } = {}) {
  const out = {};
  for (const agent of ['claude', 'codex']) {
    if (agent === 'codex' && !existsSync(codexUserDir())) continue;
    try { out[agent] = syncTeamRatchet({ agent, dir }); } catch (e) { debug('team-sync:ratchet', e); }
  }
  try { ensureTeamImport(); } catch (e) { debug('team-sync:import', e); }
  return out;
}

export async function syncTeam({
  now = Date.now(), dir = userDataDir(), fetch, force = false, env = process.env, version, sessions, promptsOnly = false, rulesOnly = false,
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
  let resumed = false;
  if (state.pausedReported) {
    try {
      await rpc('member_set_sync', { member_key: state.memberKey, paused: false }, { fetch });
      state = { ...state };
      delete state.pausedReported;
      saveTeamState(state, dir);
      force = true;
      resumed = true;
    } catch (e) {
      debug('team-sync', e);
    }
  }
  // Rules only: one small RPC, no ledger and no prompts, and lastSyncAt stays
  // put. A resume falls through to the full sync instead.
  if (rulesOnly && !resumed) {
    if (!force && !rulesPullDue(state, now, env)) return { skipped: 'not-due' };
    state = { ...state, lastRulesAttemptAt: now };
    try { saveTeamState(state, dir); } catch (e) { debug('team-sync', e); }
    try {
      const { r, rules } = await pullRules({ memberKey: state.memberKey, dir, fetch, now });
      saveTeamState(withRulesMeta(loadTeamState(dir), r, now), dir);
      refreshTeamRatchetFiles({ dir });
      return { uploaded: 0, rules: rules.length, rulesOnly: true };
    } catch (e) {
      debug('team-sync', e);
      try { saveTeamState({ ...loadTeamState(dir), lastRulesError: e.message }, dir); } catch (e2) { debug('team-sync', e2); }
      return { error: e.message };
    }
  }
  // Prompts have their own 30-minute timer and are cheap (bytes past the stored
  // offsets); the ledger re-parses only the days since its watermark (about a second) and keeps its 5 minutes.
  if (promptsOnly || (!force && !teamSyncDue(state, now))) {
    if (!force && !promptSyncDue(state, now)) return { skipped: 'not-due' };
    if (!state.promptCapture) return { skipped: 'not-due' };
    // claim the slot first so a second hook in the same minute finds nothing due
    state = { ...state, lastPromptSyncAt: now };
    saveTeamState(state, dir);
    const prompts = await syncPrompts({ state, dir, fetch, now });
    return { uploaded: 0, rules: 0, prompts: prompts ?? 0, promptsOnly: true };
  }
  // Claim the attempt first: a second hook within two minutes sees it in flight.
  state = { ...state, lastSyncAttemptAt: now };
  try { saveTeamState(state, dir); } catch (e) { debug('team-sync', e); }
  state = await reportDeviceInfo({ state, dir, fetch, env });
  try {
    const win = ledgerWindow(state, now);
    const rows = (await aggregateDaily({ now, dir, sessions, days: win.days }))
      .filter((r) => r.day >= win.startKey).slice(-MAX_ROWS);
    await ledgerUpsert({ memberKey: state.memberKey, rows, version, dir, fetch });
    const { r, rules } = await pullRules({ memberKey: state.memberKey, dir, fetch, now });
    const next = withRulesMeta({ ...state, lastSyncAt: now, lastSyncAttemptAt: now, lastSyncRows: rows.length, ledgerSyncedThrough: dayKey(now) }, r, now);
    delete next.syncFailures;
    delete next.lastError;
    saveTeamState(next, dir);
    refreshTeamRatchetFiles({ dir });
    await refreshStanding({ memberKey: state.memberKey, dir, fetch, now });
    const prompts = await syncPrompts({ state: next, dir, fetch, now });
    return { uploaded: rows.length, rules: rules.length, ...(prompts !== null ? { prompts } : {}) };
  } catch (e) {
    debug('team-sync', e);
    // lastSyncAt stays the last SUCCESS and the watermark does not move, so the
    // next success re-sends every missed day. Retry after 15, 30, 60 minutes.
    try {
      saveTeamState({ ...state, lastSyncAttemptAt: now, syncFailures: (Number(state.syncFailures) || 0) + 1, lastError: e.message }, dir);
    } catch (e2) { debug('team-sync', e2); }
    return { error: e.message };
  }
}

/**
 * Prompt upload step of a sync. Capture off: forget the offsets so a later
 * switch-on starts at the end of every file. Capture on: upload what is new.
 * Fails soft; a problem here never marks the whole sync as failed.
 */
async function syncPrompts({ state, dir, fetch, now = Date.now() }) {
  try {
    if (!state.promptCapture) {
      if (promptOffsetsExist(dir)) dropOffsets(dir);
      return null;
    }
    const put = (params) => rpc('prompt_chunk_put', { member_key: state.memberKey, ...params }, { fetch, timeoutMs: 30000 });
    const r = await uploadPrompts({ put, dir });
    const fresh = loadTeamState(dir);
    if (r.off) {
      dropOffsets(dir);
      saveTeamState({ ...fresh, promptCapture: false }, dir);
      return null;
    }
    const patch = { lastPromptSyncAt: now };
    if (r.uploaded > 0) {
      Object.assign(patch, { lastPromptUploadAt: Date.now(), lastPromptCount: r.uploaded,
        promptsUploadedTotal: (fresh.promptsUploadedTotal || 0) + r.uploaded });
    }
    saveTeamState({ ...fresh, ...patch }, dir);
    return r.uploaded;
  } catch (e) {
    debug('team-sync', e);
    return null;
  }
}

export async function autoJoin({ env = process.env, fetch, dir = userDataDir(), version, now = Date.now() } = {}) {
  const token = env.SPRAG_TEAM_TOKEN;
  if (!token || !TOKEN_RE.test(token)) return null;
  const state = loadTeamState(dir);
  // A state with `left: true` never auto-rejoins: leaving must beat the
  // environment, or `sprag team leave` would be undone by the next session.
  if (isJoined(state) || state.left) return null;
  const name = memberId({ dir });
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
