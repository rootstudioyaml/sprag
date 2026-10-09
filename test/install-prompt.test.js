/**
 * install prompt gating — the install may only stop and ask when a human is
 * attached. Everything else (postinstall, CI, pipes) has to keep the old
 * automatic behavior, because a blocked prompt there hangs an install.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { canPrompt, confirm } from '../src/prompt.js';

const tty = { isTTY: true };
const notTty = { isTTY: false };

test('canPrompt requires both streams to be a terminal', () => {
  assert.equal(canPrompt({ env: {}, stdin: tty, stdout: tty }), true);
  assert.equal(canPrompt({ env: {}, stdin: notTty, stdout: tty }), false);
  assert.equal(canPrompt({ env: {}, stdin: tty, stdout: notTty }), false);
});

test('canPrompt refuses inside npm postinstall, CI and CTS_NO_INPUT', () => {
  assert.equal(canPrompt({ env: { npm_lifecycle_event: 'postinstall' }, stdin: tty, stdout: tty }), false);
  assert.equal(canPrompt({ env: { CI: 'true' }, stdin: tty, stdout: tty }), false);
  assert.equal(canPrompt({ env: { CTS_NO_INPUT: '1' }, stdin: tty, stdout: tty }), false);
  // CI=false is what some shells export when the variable is merely defined.
  assert.equal(canPrompt({ env: { CI: 'false' }, stdin: tty, stdout: tty }), true);
});

/** Drive confirm() with a scripted answer and throw the output away. */
async function answer(text, opts = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const p = confirm('question?', { ...opts, input, output });
  input.write(text);
  input.end();
  return p;
}

test('confirm reads yes and no in both short and long form', async () => {
  assert.equal(await answer('y\n'), true);
  assert.equal(await answer('yes\n'), true);
  assert.equal(await answer('n\n'), false);
  assert.equal(await answer('no\n'), false);
  assert.equal(await answer('Y\n'), true);
});

test('an empty or unrecognized answer takes the default', async () => {
  assert.equal(await answer('\n', { defaultValue: true }), true);
  assert.equal(await answer('\n', { defaultValue: false }), false);
  assert.equal(await answer('maybe\n', { defaultValue: false }), false);
  assert.equal(await answer('maybe\n', { defaultValue: true }), true);
});

test('a closed stream resolves to the default instead of hanging', async () => {
  assert.equal(await answer('', { defaultValue: true }), true);
  assert.equal(await answer('', { defaultValue: false }), false);
});

import { choose } from '../src/prompt.js';

const CHOICES = [
  { key: 'merge', label: 'm' },
  { key: 'replace', label: 'r' },
  { key: 'keep', label: 'k' },
];

/** Drive choose() with a scripted answer; `null` closes the stream without a line. */
async function pick(text) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const p = choose('how?', CHOICES, { input, output });
  if (text !== null) input.write(text);
  input.end();
  return p;
}

test('choose accepts a 1-based number', async () => {
  assert.equal(await pick('2\n'), 'replace');
  assert.equal(await pick('3\n'), 'keep');
});

test('choose accepts a key, case-insensitively', async () => {
  assert.equal(await pick('keep\n'), 'keep');
  assert.equal(await pick('Replace\n'), 'replace');
});

test('choose falls back to the default on empty, unknown or closed input', async () => {
  assert.equal(await pick('\n'), 'merge');
  assert.equal(await pick('9\n'), 'merge');
  assert.equal(await pick('banana\n'), 'merge');
  assert.equal(await pick(null), 'merge');
});
