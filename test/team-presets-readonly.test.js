/**
 * The team dashboard shows the published Sprag preset bundle, read only. Editing and
 * publishing presets belongs to the superuser on /ops; if the team page could write a
 * bundle, any organization owner would hold a path into every member's session context.
 * The server refuses writes on its own (preset_* RPCs require is_platform_admin, the
 * table has no write grant, the CLI verifies the signature), and these checks keep the
 * page from ever growing a write path in the first place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../site/team/index.html', import.meta.url), 'utf8');

test('team page calls no preset RPC other than presets_published', () => {
  const called = [...html.matchAll(/rpc\(\s*['"`](presets?_[a-z_]+)/g)].map((m) => m[1]);
  assert.ok(called.includes('presets_published'), 'the preset section should load presets_published');
  assert.deepEqual([...new Set(called)], ['presets_published']);
});

test('team page carries none of the preset write machinery', () => {
  for (const needle of [
    'preset_draft_new', 'preset_draft_save', 'preset_draft_delete', 'preset_publish', 'preset_revert',
    'preset_admin_list', 'preset_admin_get', 'preset_require_admin', 'preset_bundles', 'PresetSign', 'preset-sign.js',
  ]) {
    assert.ok(!html.includes(needle), `site/team/index.html must not reference ${needle}`);
  }
});

test('the preset section renders no controls', () => {
  const start = html.indexOf('function presetsSection(');
  assert.ok(start > 0, 'presetsSection() not found');
  const end = html.indexOf('function loadPresets(', start);
  assert.ok(end > start, 'loadPresets() should follow presetsSection()');
  const body = html.slice(start, end);
  for (const tag of ['<button', '<form', '<input', '<textarea', '<select', 'contenteditable', 'data-rl']) {
    assert.ok(!body.includes(tag), `presetsSection() must not render ${tag}`);
  }
});
