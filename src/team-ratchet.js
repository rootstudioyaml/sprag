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
  const at = Number(state.lastSyncAt);
  return !Number.isFinite(at) || at <= 0 || now - at > SYNC_INTERVAL_MS;
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
  const ratchet = live.filter((r) => (r.scope || 'ratchet') !== 'model');
  const model = live.filter((r) => r.scope === 'model');
  if (!ratchet.length && !model.length) return null;
  const ko = lang === 'ko' && agent !== 'codex';
  const name = cache.teamName || '';
  const head = ko
    ? `# 팀 래칫 룰 (sprag 관리)\n\n팀 "${name}" 이 승인한 룰입니다. sprag 가 세션 시작 때 통째로 다시 쓰므로 직접 고치지 마십시오. 목록: \`sprag team rules\``
    : `# Team Ratchet Rules (managed by sprag)\n\nRules approved by team "${name}". sprag rewrites this file at session start, so do not edit it by hand. List: \`sprag team rules\``;
  const line = (r) => `- ${r.text.trim().replace(/\s*\n\s*/g, ' ')}`;
  let out = `${TEAM_RATCHET_MARKER}\n${head}\n`;
  if (ratchet.length) out += `\n## Rules\n\n${ratchet.map(line).join('\n')}\n`;
  if (model.length) out += `\n## Model rules\n\n${model.map(line).join('\n')}\n`;
  return out;
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
  if (teamSyncDisabled(env)) {
    if (!isJoined(state) || state.pausedReported) return false;
  } else if (!autoJoinPending(state, env) && !teamSyncDue(state, now) && !(isJoined(state) && state.pausedReported)) {
    return false;
  }
  try {
    spawn(execPath, [argv[1], 'team', 'sync', '--background'],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch (e) {
    debug('team-ratchet:spawn', e);
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
