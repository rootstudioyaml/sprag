/**
 * team-ratchet — rules the user's team approved, kept in a tool-owned file.
 *
 * `sprag team sync` caches the approved rules in team-rules.json. This module
 * only turns that cache into a ratchet file (no network), keeps the CLAUDE.md
 * import in step with the file, and starts the detached sync when it is due.
 * Every function degrades to a no-op for a machine that never joined a team.
 *
 *   Claude Code  ~/.claude/ratchet-team.md
 *   Codex        <CODEX_HOME>/ratchet-team.md
 */

import { envVar } from './env.js';
import * as childProcess from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { codexUserDir } from './agent.js';
import { userLanguage } from './config.js';
import { debug } from './debug.js';
import {
  HARNESS_BLOCK_BEGIN,
  HARNESS_BLOCK_END,
  TEAM_RATCHET_IMPORT_RE,
  teamRatchetImportLine,
} from './harness-templates.js';
import { userDataDir } from './paths.js';
import { writeStateFile, writeViaTmp } from './state-file.js';

export { TEAM_RATCHET_IMPORT_RE, teamRatchetImportLine };

export const TEAM_RATCHET_MARKER = '<!-- sprag:team-ratchet -->';
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const IN_FLIGHT_MS = 2 * 60 * 1000;
const TOKEN_RE = /^spt_[0-9a-f]{32}$/;

export const teamStatePathFor = (dir = userDataDir()) => join(dir, 'team.json');
export const teamRulesCachePathFor = (dir = userDataDir()) => join(dir, 'team-rules.json');

function readJson(file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

export function readTeamState(dir = userDataDir()) {
  return readJson(teamStatePathFor(dir)) || {};
}

export function readTeamRulesCache(dir = userDataDir()) {
  return readJson(teamRulesCachePathFor(dir));
}

export function isJoined(state) {
  return !!(state && state.memberKey && state.left !== true);
}

export function teamSyncDue(state, now = Date.now()) {
  if (!isJoined(state)) return false;
  // Same rule as teamSyncDue in team-sync.js (a test pins the two together).
  const attempt = Number(state.lastSyncAttemptAt);
  if (Number.isFinite(attempt) && attempt > 0 && now - attempt >= 0 && now - attempt < IN_FLIGHT_MS) return false;
  const failures = Number(state.syncFailures) || 0;
  if (failures > 0) {
    const delay = Math.min(15 * 60 * 1000 * 2 ** (failures - 1), 60 * 60 * 1000);
    return !Number.isFinite(attempt) || attempt <= 0 || now - attempt >= delay;
  }
  const at = Number(state.lastSyncAt);
  return !Number.isFinite(at) || at <= 0 || now - at >= SYNC_INTERVAL_MS;
}

export const PROMPT_SYNC_INTERVAL_MS = 30 * 60 * 1000;
export const RULES_PULL_INTERVAL_MS = 60 * 60 * 1000;
const RULES_RETRY_MS = 15 * 60 * 1000;

/**
 * The rules-only pull (one small RPC, no ledger parsing) is due an hour after
 * the last time rules arrived, by either kind of sync. It stays out of the way
 * of the full sync: not while that one is in flight or backing off after a
 * failure (its retry pulls the rules too), and not within 15 minutes of its own
 * last attempt, which doubles as its in-flight guard and failure backoff.
 */
export function rulesPullDue(state, now = Date.now(), env = process.env) {
  if (!isJoined(state) || state.pausedReported || teamSyncDisabled(env)) return false;
  if ((Number(state.syncFailures) || 0) > 0) return false;
  const attempt = Number(state.lastSyncAttemptAt);
  if (Number.isFinite(attempt) && attempt > 0 && now - attempt >= 0 && now - attempt < IN_FLIGHT_MS) return false;
  const tried = Number(state.lastRulesAttemptAt);
  if (Number.isFinite(tried) && tried > 0 && now - tried >= 0 && now - tried < RULES_RETRY_MS) return false;
  const last = Math.max(Number(state.lastRulesAt) || 0, Number(state.lastSyncAt) || 0);
  return last <= 0 || now - last >= RULES_PULL_INTERVAL_MS;
}

/**
 * Stat-free gate for the prompt uploader: joined, capture on (as last seen by a
 * sync), uploads not switched off or reported paused, and the last prompt run is
 * 30 minutes old. Reads nothing but the already-loaded team.json.
 */
export function promptSyncDue(state, now = Date.now(), env = process.env) {
  if (!isJoined(state) || state.promptCapture !== true || state.pausedReported) return false;
  if (teamSyncDisabled(env)) return false;
  const at = Number(state.lastPromptSyncAt);
  return !Number.isFinite(at) || at <= 0 || now - at >= PROMPT_SYNC_INTERVAL_MS;
}

export function autoJoinPending(state, env = process.env) {
  return TOKEN_RE.test(env.SPRAG_TEAM_TOKEN || '') && !isJoined(state) && state?.left !== true;
}

export function teamSyncDisabled(env = process.env) {
  return envVar('NO_TEAM_SYNC', env) === '1';
}

export function teamRatchetPath({ agent = 'claude' } = {}) {
  return agent === 'codex'
    ? join(codexUserDir(), 'ratchet-team.md')
    : join(homedir(), '.claude', 'ratchet-team.md');
}

export function renderTeamRatchet(cache, { lang = 'en', agent = 'claude' } = {}) {
  if (!cache || !Array.isArray(cache.rules)) return null;
  const removed = new Set(Array.isArray(cache.removed) ? cache.removed : []);
  const live = cache.rules.filter((r) => r && typeof r.text === 'string' && r.text.trim() && !removed.has(r.id));
  if (!live.length) return null;
  // Rows from servers older than the org layer carry no level: they are team rules.
  const org = live.filter((r) => r.level === 'org');
  const team = live.filter((r) => r.level !== 'org');
  const isModel = (r) => r.scope === 'model';
  const ko = lang === 'ko' && agent !== 'codex';
  const name = cache.teamName || '';
  const orgName = cache.orgName || '';
  const scopeLine = ko
    ? (orgName ? `조직 "${orgName}" 과 팀 "${name}" 에서 승인한 룰입니다.` : `팀 "${name}" 이 승인한 룰입니다.`)
    : (orgName ? `Rules approved for organization "${orgName}" and team "${name}".` : `Rules approved by team "${name}".`);
  const head = ko
    ? `# 팀 래칫 룰 (sprag 관리)\n\n${scopeLine} sprag 가 세션 시작 때 통째로 다시 쓰므로 직접 고치지 마십시오. 목록: \`sprag team rules\``
    : `# Team Ratchet Rules (managed by sprag)\n\n${scopeLine} sprag rewrites this file at session start, so do not edit it by hand. List: \`sprag team rules\``;
  const H = ko
    ? { org: '조직 룰', orgModel: '조직 모델 룰', team: '팀 룰', teamModel: '팀 모델 룰' }
    : { org: 'Organization rules', orgModel: 'Organization model rules', team: 'Team rules', teamModel: 'Team model rules' };
  const line = (r) => `- ${r.text.trim().replace(/\s*\n\s*/g, ' ')}`;
  const section = (rows, title, modelTitle) => {
    if (!rows.length) return '';
    const plain = rows.filter((r) => !isModel(r));
    const model = rows.filter(isModel);
    let s = `\n## ${title}\n`;
    if (plain.length) s += `\n${plain.map(line).join('\n')}\n`;
    if (model.length) s += `\n### ${modelTitle}\n\n${model.map(line).join('\n')}\n`;
    return s;
  };
  return `${TEAM_RATCHET_MARKER}\n${head}\n${section(org, H.org, H.orgModel)}${section(team, H.team, H.teamModel)}`;
}

function writeIfChanged(file, text) {
  let before = null;
  try { before = readFileSync(file, 'utf8'); } catch { /* first write */ }
  if (before === text) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeViaTmp(`${file}.tmp-${process.pid}`, file, text);
  return true;
}

function ownedFile(file) {
  try { return readFileSync(file, 'utf8').split('\n', 1)[0].trim() === TEAM_RATCHET_MARKER; } catch { return false; }
}

export function syncTeamRatchet({ agent = 'claude', lang = userLanguage(), dir = userDataDir() } = {}) {
  const file = teamRatchetPath({ agent });
  const state = readTeamState(dir);
  const text = isJoined(state) ? renderTeamRatchet(readTeamRulesCache(dir), { lang, agent }) : null;
  if (text === null) {
    if (existsSync(file) && ownedFile(file)) {
      rmSync(file, { force: true });
      return { file, rules: 0, changed: true, removed: true };
    }
    return { file, rules: 0, changed: false, removed: false };
  }
  const changed = writeIfChanged(file, text);
  return { file, rules: (text.match(/^- /gm) || []).length, changed, removed: false };
}

/**
 * Keep the team import in the global harness block in step with the file.
 * Only the tool's own marked block is edited; a CLAUDE.md without it is left alone.
 */
export function ensureTeamImport() {
  const file = join(homedir(), '.claude', 'CLAUDE.md');
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return { file, added: false, removed: false }; }
  const begin = text.indexOf(HARNESS_BLOCK_BEGIN);
  const end = text.indexOf(HARNESS_BLOCK_END);
  if (begin < 0 || end < begin) return { file, added: false, removed: false };
  const block = text.slice(begin, end);
  const has = TEAM_RATCHET_IMPORT_RE.test(block);
  const exists = existsSync(teamRatchetPath());
  if (exists && !has) {
    writeFileSync(file, `${text.slice(0, end)}${teamRatchetImportLine()}\n${text.slice(end)}`);
    return { file, added: true, removed: false };
  }
  if (!exists && has) {
    const cleaned = block.replace(/^@~\/\.claude\/ratchet-team\.md[ \t]*\r?\n?/m, '');
    writeFileSync(file, `${text.slice(0, begin)}${cleaned}${text.slice(end)}`);
    return { file, added: false, removed: true };
  }
  return { file, added: false, removed: false };
}

export function spawnTeamSyncIfDue({
  state = readTeamState(), now = Date.now(), env = process.env,
  spawn = childProcess.spawn, argv = process.argv, execPath = process.execPath,
} = {}) {
  // Switched off: spawn once more only to report the pause (team-sync.js).
  // Switched back on after a reported pause: spawn now to report the resume.
  // Otherwise the full sync when it is due, else the hourly rules-only pull.
  let flags;
  if (teamSyncDisabled(env)) {
    if (!isJoined(state) || state.pausedReported) return false;
    flags = ['--background'];
  } else if (autoJoinPending(state, env) || teamSyncDue(state, now) || (isJoined(state) && state.pausedReported)) {
    flags = ['--background'];
  } else if (rulesPullDue(state, now, env)) {
    flags = ['--background', '--rules-only'];
  } else {
    return false;
  }
  try {
    spawn(execPath, [argv[1], 'team', 'sync', ...flags],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch (e) {
    debug('team-ratchet:spawn', e);
    return false;
  }
}

/**
 * Called from the per-prompt hooks: one small team.json read, no network and no
 * parsing here. When the ledger/rules sync is due (6 hours after the last success,
 * or its failure backoff elapsed), start the detached `team sync --background`
 * child; else, when only the prompt upload is due, start it in prompts-only
 * mode; else, when only the hourly rules pull is due, start it in rules-only
 * mode. Prints nothing.
 */
export function spawnTeamSyncOnPrompt({
  state = readTeamState(), now = Date.now(), env = process.env,
  spawn = childProcess.spawn, argv = process.argv, execPath = process.execPath,
} = {}) {
  if (teamSyncDisabled(env) || !isJoined(state)) return false;
  let flags;
  if (teamSyncDue(state, now)) flags = ['--background'];
  else if (promptSyncDue(state, now, env)) flags = ['--background', '--prompts-only'];
  else if (rulesPullDue(state, now, env)) flags = ['--background', '--rules-only'];
  else return false;
  try {
    spawn(execPath, [argv[1], 'team', 'sync', ...flags], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch (e) {
    debug('team-ratchet:spawn-prompt-hook', e);
    return false;
  }
}

export function autoJoinNoticeBlock(dir = userDataDir(), lang = userLanguage()) {
  const file = teamStatePathFor(dir);
  const state = readJson(file);
  if (!state || state.autoJoinNoticePending !== true) return null;
  const name = state.teamName || '';
  try { writeStateFile(file, `${JSON.stringify({ ...state, autoJoinNoticePending: false }, null, 2)}\n`); }
  catch (e) { debug('team-ratchet:notice-clear', e); }
  return lang === 'ko'
    ? `Sprag: 이 PC는 SPRAG_TEAM_TOKEN 으로 팀 "${name}" 에 자동 참여됐습니다. 보내는 것은 하루 단위 집계(지출·절감·위임 횟수)뿐입니다. \`sprag team status --show-payload\` 로 내용을 확인하고 \`sprag team leave\` 로 멈출 수 있습니다.`
    : `Sprag: this machine was enrolled in team "${name}" through SPRAG_TEAM_TOKEN. It sends daily aggregates only (spend, savings, delegation counts). See what is sent with \`sprag team status --show-payload\`; stop with \`sprag team leave\`.`;
}
