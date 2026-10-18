import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TEAM_RATCHET_MARKER, renderTeamRatchet, syncTeamRatchet, ensureTeamImport, spawnTeamSyncIfDue,
  autoJoinNoticeBlock, teamRatchetPath, teamSyncDue, isJoined, autoJoinPending, readTeamState,
} from '../src/team-ratchet.js';
import { HARNESS_BLOCK_BEGIN, HARNESS_BLOCK_END } from '../src/harness-templates.js';

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-team-'));
  const saved = {
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    XDG: process.env.XDG_CONFIG_HOME, CODEX: process.env.CODEX_HOME,
  };
  // os.homedir() reads USERPROFILE on Windows, HOME elsewhere.
  process.env.HOME = join(dir, 'home');
  process.env.USERPROFILE = join(dir, 'home');
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg');
  delete process.env.CODEX_HOME;
  mkdirSync(join(dir, 'home', '.claude'), { recursive: true });
  const data = join(dir, 'cfg', 'claude-token-saver');
  mkdirSync(data, { recursive: true });
  t.after(() => {
    for (const [k, v] of [['HOME', saved.HOME], ['USERPROFILE', saved.USERPROFILE],
      ['XDG_CONFIG_HOME', saved.XDG], ['CODEX_HOME', saved.CODEX]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { dir, data, home: join(dir, 'home') };
}

const CACHE = {
  teamName: 'Acme',
  rules: [
    { id: 'a', text: 'A → do a', scope: 'ratchet' },
    { id: 'b', text: 'B → do b', scope: 'ratchet' },
    { id: 'c', text: 'C → model c', scope: 'model' },
  ],
  removed: ['b'],
};
const join1 = (data, extra = {}) =>
  writeFileSync(join(data, 'team.json'), JSON.stringify({ memberKey: 'k', teamName: 'Acme', ...extra }));

test('render: en/ko, removed skipped, model section, null when empty', () => {
  const en = renderTeamRatchet(CACHE, { lang: 'en' });
  assert.equal(en.split('\n')[0], TEAM_RATCHET_MARKER);
  assert.match(en, /# Team Ratchet Rules/);
  assert.match(en, /## Rules\n\n- A → do a/);
  assert.doesNotMatch(en, /B → do b/);
  assert.match(en, /## Model rules\n\n- C → model c/);
  const ko = renderTeamRatchet(CACHE, { lang: 'ko' });
  assert.match(ko, /# 팀 래칫 룰/);
  assert.match(ko, /팀 "Acme" 이 승인한 룰/);
  assert.match(renderTeamRatchet(CACHE, { lang: 'ko', agent: 'codex' }), /# Team Ratchet Rules/);
  assert.equal(renderTeamRatchet(null), null);
  assert.equal(renderTeamRatchet({ rules: [{ id: 'x', text: 't' }], removed: ['x'] }), null);
});

test('sync writes, is idempotent, removes owned file, keeps foreign file', (t) => {
  const s = sandbox(t);
  join1(s.data);
  writeFileSync(join(s.data, 'team-rules.json'), JSON.stringify(CACHE));
  const r1 = syncTeamRatchet({ lang: 'en' });
  assert.equal(r1.changed, true);
  assert.equal(r1.rules, 2);
  assert.ok(readFileSync(teamRatchetPath(), 'utf8').startsWith(TEAM_RATCHET_MARKER));
  assert.equal(syncTeamRatchet({ lang: 'en' }).changed, false);
  rmSync(join(s.data, 'team-rules.json'));
  const r3 = syncTeamRatchet({ lang: 'en' });
  assert.equal(r3.removed, true);
  assert.equal(existsSync(teamRatchetPath()), false);
  writeFileSync(teamRatchetPath(), '# mine\n- keep\n');
  const r4 = syncTeamRatchet({ lang: 'en' });
  assert.equal(r4.removed, false);
  assert.ok(existsSync(teamRatchetPath()));
});

test('sync removes the file when the machine left the team', (t) => {
  const s = sandbox(t);
  join1(s.data);
  writeFileSync(join(s.data, 'team-rules.json'), JSON.stringify(CACHE));
  syncTeamRatchet({ lang: 'en' });
  join1(s.data, { left: true });
  assert.equal(syncTeamRatchet({ lang: 'en' }).removed, true);
});

test('ensureTeamImport adds inside the block, removes when file gone, skips blockless', (t) => {
  const s = sandbox(t);
  const md = join(s.home, '.claude', 'CLAUDE.md');
  writeFileSync(md, `top\n${HARNESS_BLOCK_BEGIN}\nbody\n@~/.claude/ratchet.md\n${HARNESS_BLOCK_END}\nafter\n`);
  writeFileSync(teamRatchetPath(), `${TEAM_RATCHET_MARKER}\n- x\n`);
  assert.equal(ensureTeamImport().added, true);
  let text = readFileSync(md, 'utf8');
  assert.match(text, new RegExp(`@~/\\.claude/ratchet-team\\.md\\n${HARNESS_BLOCK_END}`));
  assert.equal(ensureTeamImport().added, false);
  rmSync(teamRatchetPath());
  assert.equal(ensureTeamImport().removed, true);
  text = readFileSync(md, 'utf8');
  assert.doesNotMatch(text, /ratchet-team/);
  assert.match(text, /@~\/\.claude\/ratchet\.md\n/);
  const plain = 'no block here\n';
  writeFileSync(md, plain);
  writeFileSync(teamRatchetPath(), `${TEAM_RATCHET_MARKER}\n- x\n`);
  ensureTeamImport();
  assert.equal(readFileSync(md, 'utf8'), plain);
});

test('spawnTeamSyncIfDue spawns when due or auto-join pending, not otherwise', () => {
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  const base = { spawn, argv: ['node', '/cli.js'], execPath: '/bin/node', now: 1_000_000_000_000 };
  const due = { memberKey: 'k', lastSyncAt: base.now - 7 * 3600 * 1000 };
  assert.equal(spawnTeamSyncIfDue({ ...base, state: due, env: {} }), true);
  assert.deepEqual(calls[0].args, ['/cli.js', 'team', 'sync', '--background']);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(spawnTeamSyncIfDue({ ...base, state: { memberKey: 'k' }, env: {} }), true);
  const tok = { SPRAG_TEAM_TOKEN: `spt_${'a'.repeat(32)}` };
  assert.equal(spawnTeamSyncIfDue({ ...base, state: {}, env: tok }), true);
  const n = calls.length;
  assert.equal(spawnTeamSyncIfDue({ ...base, state: due, env: { SPRAG_NO_TEAM_SYNC: '1' } }), false);
  assert.equal(spawnTeamSyncIfDue({ ...base, state: {}, env: {} }), false);
  assert.equal(spawnTeamSyncIfDue({ ...base, state: { memberKey: 'k', lastSyncAt: base.now - 1000 }, env: {} }), false);
  assert.equal(spawnTeamSyncIfDue({ ...base, state: { left: true }, env: tok }), false);
  assert.equal(calls.length, n);
  assert.equal(isJoined({ memberKey: 'k', left: true }), false);
  assert.equal(teamSyncDue({ memberKey: 'k', lastSyncAt: base.now }, base.now), false);
  assert.equal(autoJoinPending({ memberKey: 'k' }, tok), false);
});

test('autoJoinNoticeBlock returns the line once and clears the flag', (t) => {
  const s = sandbox(t);
  join1(s.data, { autoJoinNoticePending: true, lastSyncRows: 3 });
  const en = autoJoinNoticeBlock(s.data, 'en');
  assert.match(en, /enrolled in team "Acme" through SPRAG_TEAM_TOKEN/);
  assert.equal(autoJoinNoticeBlock(s.data, 'en'), null);
  const st = readTeamState(s.data);
  assert.equal(st.lastSyncRows, 3);
  assert.equal(st.memberKey, 'k');
  join1(s.data, { autoJoinNoticePending: true });
  assert.match(autoJoinNoticeBlock(s.data, 'ko'), /자동 참여됐습니다/);
});
