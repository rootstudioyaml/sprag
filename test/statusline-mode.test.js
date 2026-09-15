/**
 * Label-mode resolution. Three call sites used to carry their own copy of this
 * decision (real statusline, --demo, no-session line) and they disagreed inside
 * IntelliJ, which made a deliberate downgrade look like a terminal bug. These
 * tests pin the rules so a fourth copy cannot quietly reintroduce the drift.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLabelMode,
  isJetBrainsTerminal,
  iconForceRequested,
} from '../src/statusline-mode.js';

const JB = { TERMINAL_EMULATOR: 'JetBrains-JediTerm' };
const PLAIN = { TERM_PROGRAM: 'iTerm.app' };
const flags = (...names) => (name) => names.includes(name);
const ICON_ON = { icon: true };

test('IntelliJ downgrades to text even against an explicit --icon', () => {
  const r = resolveLabelMode({ hasFlag: flags('--icon'), cfg: ICON_ON, env: JB });
  assert.equal(r.mode, 'text');
  assert.equal(r.reason, 'intellij-guard');
});

test('other terminals honor --icon and the persisted config', () => {
  assert.equal(resolveLabelMode({ hasFlag: flags('--icon'), cfg: {}, env: PLAIN }).mode, 'icon');
  assert.equal(resolveLabelMode({ cfg: ICON_ON, env: PLAIN }).mode, 'icon');
  assert.equal(resolveLabelMode({ cfg: { icon: false }, env: PLAIN }).mode, 'text');
});

test('SPRAG_ICON=force lifts the IntelliJ guard', () => {
  const env = { ...JB, SPRAG_ICON: 'force' };
  const r = resolveLabelMode({ hasFlag: flags('--icon'), cfg: ICON_ON, env });
  assert.equal(r.mode, 'icon');
  assert.equal(r.reason, 'intellij-forced');
});

test('the persisted icon-force flag lifts it too, so wrappers need no edit', () => {
  const r = resolveLabelMode({ cfg: { icon: true, iconForce: true }, env: JB });
  assert.equal(r.mode, 'icon');
});

test('an explicit opt-out beats the escape hatch in both forms', () => {
  const env = { ...JB, SPRAG_ICON: 'force' };
  for (const flag of ['--text', '--no-icon']) {
    const r = resolveLabelMode({ hasFlag: flags(flag), cfg: { icon: true, iconForce: true }, env });
    assert.equal(r.mode, 'text', `${flag} must win`);
    assert.equal(r.reason, 'flag:--text');
  }
});

test('SPRAG_ICON only forces on the exact value, case and padding aside', () => {
  for (const raw of ['force', 'FORCE', '  Force  ']) {
    assert.equal(iconForceRequested({ env: { SPRAG_ICON: raw } }), true, raw);
  }
  for (const raw of ['', '1', 'true', 'yes', 'forced']) {
    assert.equal(iconForceRequested({ env: { SPRAG_ICON: raw } }), false, raw);
  }
  assert.equal(iconForceRequested({ env: {} }), false);
});

test('the IntelliJ signal is that one env var and nothing else', () => {
  assert.equal(isJetBrainsTerminal(JB), true);
  assert.equal(isJetBrainsTerminal(PLAIN), false);
  assert.equal(isJetBrainsTerminal({ TERMINAL_EMULATOR: 'JetBrains-Other' }), false);
  assert.equal(isJetBrainsTerminal({}), false);
});
