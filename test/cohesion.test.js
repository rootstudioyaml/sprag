/**
 * cohesion — English cohesion guidance injection.
 *
 * Pins the three behaviours that matter: opt-in (never billed silently),
 * suppression while the Korean guidance carries the same rules, and the
 * provenance comment staying out of what gets injected.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('the guidance file ships and the comment is stripped from the text', async () => {
  const co = await import('../src/cohesion.js');
  assert.ok(existsSync(co.COHESION_PATH), 'preset file is present');
  const raw = readFileSync(co.COHESION_PATH, 'utf8');
  assert.match(raw, /given-new/i, 'the file records where the rules came from');
  const text = co.cohesionText();
  assert.doesNotMatch(text, /claude-token-saver's own text/, 'provenance comment is stripped');
  assert.match(text, /Move from known to new/);
  assert.match(text, /One clear referent per pronoun/);
});

test('injection is opt-in and suppressed while the Korean guidance is on', async () => {
  const co = await import('../src/cohesion.js');
  // Disabled (or undecided) config: nothing is injected.
  assert.equal(await co.cohesionInjection({ cfg: {} }), null);
  assert.equal(await co.cohesionInjection({ cfg: { cohesion: { enabled: false } } }), null);
  // Enabled, Korean off: the block goes out with its framing line.
  const block = await co.cohesionInjection({ cfg: { cohesion: { enabled: true } } });
  assert.match(block, /\[claude-token-saver cohesion\]/);
  assert.match(block, /No leaps/);
  // Enabled, Korean on: the Korean supplement already carries these rules.
  const suppressed = await co.cohesionInjection({
    cfg: { cohesion: { enabled: true }, koreanStyle: { enabled: true } },
  });
  assert.equal(suppressed, null);
});
