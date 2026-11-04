/**
 * routing master switch — `config.routing === false` turns every delegation
 * path off together, and turning it back on restores the full rendering.
 *
 * HOME and XDG_CONFIG_HOME point at a throwaway directory BEFORE any sprag
 * module loads: config.js fixes its path at import, and the ratchet files live
 * under homedir(). node --test runs each file in its own process, so the
 * override cannot leak into other tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sprag-routing-'));
const home = join(dir, 'home');
mkdirSync(join(home, '.claude'), { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(dir, 'cfg');
process.env.SPRAG_LANG = 'ko';
test.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const sw = await import('../src/routing-switch.js');
const { saveConfig, loadConfig } = await import('../src/config.js');
const mr = await import('../src/model-rules.js');
const rf = await import('../src/route-follow.js');
const seed = await import('../src/seed-rules.js');
const pr = await import('../src/preset-ratchet.js');

const GLOBAL_FILE = join(home, '.claude', 'ratchet-model.md');
const RULE = {
  tier: 'T1', category: 'run', label: '명령 실행', labelEn: 'running commands', agent: 't1-worker',
  scope: 'global', targetRoot: null, project: '-p', signature: 'T1|run|-p', rule: 'r',
  example: 'npm 인증', promotedAt: '2026-08-01', count: 5, status: 'active',
};

test('routingEnabled: a missing key is on, only an explicit false is off', () => {
  assert.equal(sw.routingEnabled({}), true);
  assert.equal(sw.routingEnabled({ routing: true }), true);
  assert.equal(sw.routingEnabled({ routing: false }), false);
  assert.equal(sw.routingEnabled(null), true);
});

test('setRoutingEnabled writes config.json and routingEnabled() reads it back', () => {
  saveConfig({ language: 'ko' });
  sw.setRoutingEnabled(false);
  assert.equal(loadConfig().routing, false);
  assert.equal(loadConfig().language, 'ko', 'other keys survive');
  assert.equal(sw.routingEnabled(), false);
  sw.setRoutingEnabled(true);
  assert.equal(sw.routingEnabled(), true);
});

test('followToolUse returns null while routing is off, even with a follow record', () => {
  const fdir = mkdtempSync(join(dir, 'follow-'));
  const T0 = 1_800_000_000_000;
  rf.startFollow('s1', { category: 'explore', label: 'x', target: 'model: haiku', lang: 'ko' }, { dir: fdir, now: T0 });
  const call = (cfg) => rf.followToolUse({ session_id: 's1', tool_name: 'Read', tool_input: {} },
    { dir: fdir, cfg, now: T0 + 1000 });
  assert.equal(call({ routing: false }), null);
  assert.equal(call({ routing: false }), null);
  // Control: with routing on the second lookup nudges, so the null above came from the switch.
  call({});
  assert.ok(call({}), 'routing on still nudges');
});

test('syncAllFiles: off writes the short notice, on restores the full rendering', () => {
  mr.saveModelRules({ rules: [RULE] });
  sw.setRoutingEnabled(true);
  mr.syncAllFiles();
  const full = readFileSync(GLOBAL_FILE, 'utf8');
  assert.match(full, /## Rules/);
  assert.match(full, /이미 승인했습니다/);

  sw.setRoutingEnabled(false);
  mr.syncAllFiles();
  const off = readFileSync(GLOBAL_FILE, 'utf8');
  assert.ok(off.startsWith('# Model-Fitting Ratchet (sprag 자동 관리)'));
  assert.ok(!off.includes('## Rules'));
  assert.ok(!off.includes('승인'));
  assert.ok(off.includes('sprag routing on'));
  assert.equal(mr.loadModelRules().rules.length, 1, 'the registry is untouched');

  // A path that lost its last rule is rewritten too when it still exists.
  const stray = join(home, 'stray', '.claude', 'ratchet-model.md');
  mkdirSync(join(home, 'stray', '.claude'), { recursive: true });
  writeFileSync(stray, 'old');
  mr.syncAllFiles({ previousPaths: [stray] });
  assert.equal(readFileSync(stray, 'utf8'), off);

  sw.setRoutingEnabled(true);
  mr.syncAllFiles();
  assert.equal(readFileSync(GLOBAL_FILE, 'utf8'), full, 'turning it back on re-renders the same file');
});

test('syncAllFiles: rule-less files from harness init follow the switch both ways', () => {
  // harness init seeds these with renderModelRatchet([]), whose header alone
  // claims the user approved delegation. The registry names neither file.
  mr.saveModelRules({ rules: [] });
  const proj = join(dir, 'ruleless-proj');
  const projFile = join(proj, '.claude', 'ratchet-model.md');
  mkdirSync(join(proj, '.claude'), { recursive: true });
  const empty = mr.renderModelRatchet([]);
  assert.match(empty, /이미 승인했습니다/);
  writeFileSync(GLOBAL_FILE, empty);
  writeFileSync(projFile, empty);
  const untouched = join(dir, 'other-proj', '.claude', 'ratchet-model.md');
  mkdirSync(join(dir, 'other-proj', '.claude'), { recursive: true });
  writeFileSync(untouched, 'hand-written');

  sw.setRoutingEnabled(false);
  mr.syncAllFiles({ roots: [proj] });
  const off = sw.routingOffRatchetText('ko');
  assert.equal(readFileSync(GLOBAL_FILE, 'utf8'), off);
  assert.equal(readFileSync(projFile, 'utf8'), off);
  assert.equal(readFileSync(untouched, 'utf8'), 'hand-written', 'only the roots passed in are touched');

  sw.setRoutingEnabled(true);
  mr.syncAllFiles({ roots: [proj] });
  assert.equal(readFileSync(GLOBAL_FILE, 'utf8'), empty);
  assert.equal(readFileSync(projFile, 'utf8'), empty);

  // On, a rule-less file that is not the off notice is left alone.
  writeFileSync(projFile, 'custom');
  mr.syncAllFiles({ roots: [proj] });
  assert.equal(readFileSync(projFile, 'utf8'), 'custom');
});

test('acceptedGlobalPresets leaves out delegation presets while off', () => {
  const decided = {};
  for (const id of sw.DELEGATION_PRESET_IDS) decided[id] = { action: 'accepted', scope: 'global', at: '2026-11-01' };
  const other = seed.ratchetPresets('ko').find((p) => !sw.DELEGATION_PRESET_IDS.has(p.id));
  decided[other.id] = { action: 'accepted', scope: 'global', at: '2026-11-01' };
  seed.saveSeedState({ decided });

  sw.setRoutingEnabled(true);
  const onIds = pr.acceptedGlobalPresets({ lang: 'ko' }).map((p) => p.id);
  for (const id of sw.DELEGATION_PRESET_IDS) assert.ok(onIds.includes(id), `${id} is rendered when on`);

  sw.setRoutingEnabled(false);
  const offIds = pr.acceptedGlobalPresets({ lang: 'ko' }).map((p) => p.id);
  for (const id of sw.DELEGATION_PRESET_IDS) assert.ok(!offIds.includes(id), `${id} is dropped when off`);
  assert.ok(offIds.includes(other.id), 'other presets stay');
  assert.deepEqual(Object.keys(seed.loadSeedState().decided).sort(), Object.keys(decided).sort(), 'seed-state is not touched');
  sw.setRoutingEnabled(true);
});

test('pendingSeeds offers no model or delegation seeds while off, and findSeed still resolves them', () => {
  seed.saveSeedState({ decided: {} });
  mr.saveModelRules({ rules: [] });
  const opts = { lang: 'ko', root: join(dir, 'proj') };

  sw.setRoutingEnabled(true);
  const on = seed.pendingSeeds(opts);
  assert.ok(on.some((s) => s.kind === 'model'), 'control: model seeds are offered when on');
  for (const id of sw.DELEGATION_PRESET_IDS) assert.ok(on.some((s) => s.id === id), `${id} is offered when on`);

  sw.setRoutingEnabled(false);
  const off = seed.pendingSeeds(opts);
  assert.ok(!off.some((s) => s.kind === 'model'));
  for (const id of sw.DELEGATION_PRESET_IDS) assert.ok(!off.some((s) => s.id === id), `${id} is not offered when off`);
  assert.ok(off.some((s) => s.kind === 'ratchet'), 'non-delegation presets are still offered');
  assert.ok(seed.findSeed([...sw.DELEGATION_PRESET_IDS][0], opts), 'an explicit seed accept can still find it');
  sw.setRoutingEnabled(true);
});

test('routingOffRatchetText passes the Korean lint and carries no approval wording', async () => {
  const lint = (await import('../src/korean-lint.cjs')).default;
  const ko = sw.routingOffRatchetText('ko');
  assert.deepEqual(lint.lintKoreanText(ko, { maxFindings: 100 }), []);
  assert.ok(!ko.includes('승인'));
  assert.ok(ko.includes('sprag routing on'));
  const en = sw.routingOffRatchetText('en');
  assert.ok(en.startsWith('# Model-Fitting Ratchet (managed by sprag)'));
  assert.ok(en.includes('sprag routing on'));
  assert.ok(!/approved/i.test(en));
});
