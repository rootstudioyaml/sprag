/**
 * routingState: what a PC reports so the dashboard can tell routing off, rules not loaded
 * and delegation agents missing apart. Every case runs on a throwaway home directory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { routingState, claudeConfigDir } = await import('../src/routing-state.js');
const { definitions } = await import('../src/delegation-agents.js');

const NAMES = ['t1-worker', 't2-explore'];
const IMPORT = '@~/.claude/ratchet-model.md';

function setup(t, { claudeMd, ratchet = true, agents = NAMES, dir = '.claude' } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'sprag-rstate-'));
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const cdir = join(home, dir);
  mkdirSync(join(cdir, 'agents'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  if (claudeMd !== undefined) writeFileSync(join(cdir, 'CLAUDE.md'), claudeMd);
  if (ratchet) writeFileSync(join(home, '.claude', 'ratchet-model.md'), '# rules\n');
  for (const a of agents) writeFileSync(join(cdir, 'agents', `${a}.md`), '---\nname: x\n---\n');
  return home;
}

test('all three true when routing is on, the import line and file exist and every agent is there', (t) => {
  const home = setup(t, { claudeMd: `# me\n\n${IMPORT}\n` });
  assert.deepEqual(routingState({ cfg: {}, env: {}, home, names: NAMES }), { on: true, loaded: true, agents: true });
});

test('on follows config.routing: only an explicit false is off', (t) => {
  const home = setup(t, { claudeMd: IMPORT });
  assert.equal(routingState({ cfg: { routing: false }, env: {}, home, names: NAMES }).on, false);
  assert.equal(routingState({ cfg: { routing: true }, env: {}, home, names: NAMES }).on, true);
  assert.equal(routingState({ cfg: {}, env: {}, home, names: NAMES }).on, true);
});

test('loaded is false without the import line, without CLAUDE.md, or when the imported file is missing', (t) => {
  const noLine = setup(t, { claudeMd: '# only the harness\n@~/.claude/ratchet.md\n' });
  assert.equal(routingState({ cfg: {}, env: {}, home: noLine, names: NAMES }).loaded, false);
  const noMd = setup(t, {});
  assert.equal(routingState({ cfg: {}, env: {}, home: noMd, names: NAMES }).loaded, false);
  const noFile = setup(t, { claudeMd: IMPORT, ratchet: false });
  assert.equal(routingState({ cfg: {}, env: {}, home: noFile, names: NAMES }).loaded, false);
  const projectOnly = setup(t, { claudeMd: '@.claude/ratchet-model.md\n' });
  assert.equal(routingState({ cfg: {}, env: {}, home: projectOnly, names: NAMES }).loaded, false, 'a project-relative import is not the global one');
});

test('agents is false when one is missing and null when the definitions are unknown', (t) => {
  const home = setup(t, { claudeMd: IMPORT, agents: ['t1-worker'] });
  assert.equal(routingState({ cfg: {}, env: {}, home, names: NAMES }).agents, false);
  assert.equal(routingState({ cfg: {}, env: {}, home, names: [] }).agents, null);
});

test('the bundled definitions are what agents checks by default', (t) => {
  const names = definitions().map((d) => d.name);
  assert.ok(names.length > 0);
  const full = setup(t, { claudeMd: IMPORT, agents: names });
  assert.equal(routingState({ cfg: {}, env: {}, home: full }).agents, true);
  const partial = setup(t, { claudeMd: IMPORT, agents: names.slice(1) });
  assert.equal(routingState({ cfg: {}, env: {}, home: partial }).agents, false);
});

test('CLAUDE_CONFIG_DIR is where CLAUDE.md and agents are read; the ~ import still points at the home directory', (t) => {
  const home = setup(t, { claudeMd: IMPORT, dir: 'alt' });
  const alt = join(home, 'alt');
  assert.equal(claudeConfigDir({ env: { CLAUDE_CONFIG_DIR: alt }, home }), alt);
  assert.equal(claudeConfigDir({ env: {}, home }), join(home, '.claude'));
  // agents were installed under the alternate directory only
  const s = routingState({ cfg: {}, env: { CLAUDE_CONFIG_DIR: alt }, home, names: NAMES });
  assert.deepEqual(s, { on: true, loaded: true, agents: true });
  // without the variable, Claude reads ~/.claude: no CLAUDE.md and no agents there
  const d = routingState({ cfg: {}, env: {}, home, names: NAMES });
  assert.equal(d.loaded, false);
  assert.equal(d.agents, false);
});

test('never throws: an unreadable CLAUDE.md gives null for that field', (t) => {
  const home = setup(t, {});
  mkdirSync(join(home, '.claude', 'CLAUDE.md')); // a directory where the file should be
  const s = routingState({ cfg: {}, env: {}, home, names: NAMES });
  assert.equal(s.loaded, null);
  assert.equal(s.on, true);
});
