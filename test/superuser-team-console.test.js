// The superuser opens any organization's team console from /ops and sees everything an owner sees.
// The server already grants the superuser an owner's rights (is_platform_admin in every check);
// these tests pin the two client halves: the team console treats the role 'superuser' as an owner
// and lists every organization for the superuser, and /ops links each organization to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const team = readFileSync(root + 'site/team/index.html', 'utf8');
const ops = readFileSync(root + 'site/ops/index.html', 'utf8');

test('team console: the superuser role counts as admin and owner', () => {
  assert.match(team, /const isAdmin = \(\) => [^\n]*org\.role === 'superuser'/);
  assert.match(team, /const isOwner = \(\) => [^\n]*org\.role === 'superuser'/);
});

test('team console: the superuser gets every organization from ops_orgs, and ?org= picks one', () => {
  const body = team.slice(team.indexOf('async function loadOrgs('), team.indexOf('async function loadOrgSummary('));
  assert.ok(body.includes("sb.rpc('is_platform_admin')"));
  assert.ok(body.includes("sb.rpc('ops_orgs')"));
  assert.ok(body.includes("role: 'superuser'"));
  assert.ok(body.includes('urlId'));
  assert.match(team, /new URLSearchParams\(location\.search\)\.get\('org'\)/);
});

test('team console: the superuser role has a label in en and ko', () => {
  assert.ok(team.includes("'role.superuser':'Superuser'"));
  assert.ok(team.includes("'role.superuser':'슈퍼유저'"));
});

test('ops: the organization detail links to the team console for that organization', () => {
  assert.match(ops, /function teamConsoleUrl\(id\)\{[^}]*org: id/);
  assert.ok(ops.includes("href=\"${esc(teamConsoleUrl(sel.id))}\""));
  const n = s => ops.split(s).length - 1;
  assert.equal(n("'d.teamc':"), 2, 'd.teamc in en and ko');
  assert.equal(n("'d.teamc.tip':"), 2, 'd.teamc.tip in en and ko');
});
