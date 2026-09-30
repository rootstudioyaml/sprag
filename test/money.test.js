import test from 'node:test';
import assert from 'node:assert/strict';
import { signedUsd } from '../src/money.js';

test('signed dollars put the sign before the dollar mark', () => {
  assert.equal(signedUsd(-0.123), '-$0.12');
  assert.equal(signedUsd(0.5), '$0.50');
  assert.equal(signedUsd(-0.001), '$0.00');
  assert.equal(signedUsd(-0.00012, 4), '-$0.0001');
});
