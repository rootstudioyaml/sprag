/**
 * team-expired — the CLI recognises the server's refusal once an organization's paid term has ended.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOrgExpiredError } from '../src/team-sync.js';

test('isOrgExpiredError matches the server refusal after a paid term ends', () => {
  // the exact text the sprag-team RPCs raise (ledger_upsert, prompt_chunk_put, team_join)
  assert.equal(isOrgExpiredError(new Error('org_expired: the paid term of this organization has ended')), true);
  assert.equal(isOrgExpiredError('org_expired: the paid term of this organization has ended'), true);
  assert.equal(isOrgExpiredError(new Error('organization suspended')), false);
  assert.equal(isOrgExpiredError(new Error('seat limit reached')), false);
  assert.equal(isOrgExpiredError(null), false);
});
