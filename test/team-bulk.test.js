/**
 * The team dashboard creates several teams from a pasted list and exports the team to join
 * command mapping as CSV. The helpers are evaluated from the page source, so these checks pin
 * what the page actually runs:
 *  - which pasted names reach team_create and which are skipped,
 *  - the CSV columns and the command each row carries, which must match the Invite & enroll tab,
 *  - the CSV escaping that keeps a team name from running as a spreadsheet formula.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../site/team/index.html', import.meta.url), 'utf8');
const ux = readFileSync(new URL('../site/assets/admin-ux.js', import.meta.url), 'utf8');

function pageHelpers() {
  const start = html.indexOf('const BULK_MAX = ');
  const end = html.indexOf('/* end of team bulk helpers */', start);
  assert.ok(start > 0 && end > start, 'team bulk helper block not found in site/team/index.html');
  return new Function(`${html.slice(start, end)}\nreturn { BULK_MAX, TEAM_NAME_MAX, bulkNames, joinRows, joinCmd, JOIN_HEAD };`)();
}

/** csvCell from admin-ux.js, the escaping AdminUX.csv applies to every cell. */
function csvCell() {
  const start = ux.indexOf('const csvCell = ');
  const end = ux.indexOf('function download(', start);
  assert.ok(start > 0 && end > start, 'csvCell not found in site/assets/admin-ux.js');
  return new Function(`${ux.slice(start, end)}\nreturn csvCell;`)();
}

test('bulkNames keeps one name per line and drops blanks, duplicates and existing names', () => {
  const { bulkNames } = pageHelpers();
  const r = bulkNames('  Platform \n\nApps\r\napps\nData\n  \nMobile\n', ['Data', ' platform']);
  assert.deepEqual(r.names, ['Apps', 'Mobile']);
  assert.deepEqual(r.dup, ['Platform', 'apps', 'Data']);
  assert.deepEqual(r.long, []);
});

test('bulkNames skips names over 80 characters, counted per character like team_create', () => {
  const { bulkNames, TEAM_NAME_MAX } = pageHelpers();
  assert.equal(TEAM_NAME_MAX, 80);
  const ok = '팀'.repeat(80), emoji = '🚀'.repeat(80), over = 'a'.repeat(81);
  const r = bulkNames([ok, emoji, over].join('\n'), []);
  assert.deepEqual(r.names, [ok, emoji]);
  assert.deepEqual(r.long, [over]);
});

test('bulk create runs at most 50 teams per batch and goes through team_create', () => {
  assert.equal(pageHelpers().BULK_MAX, 50);
  assert.match(html, /sb\.rpc\('team_create', \{ p_name: names\[i\], p_org_id: org\.id \}\)/);
});

test('joinRows maps each team to its token, join command, shell line and managed settings', () => {
  const { joinRows, JOIN_HEAD } = pageHelpers();
  const tok = 'spt_' + 'a'.repeat(32);
  const rows = joinRows([{ id: 't1', name: 'Platform', invite_token: tok }, { id: 't2', name: 'No token', invite_token: null }]);
  assert.deepEqual(rows[0], JOIN_HEAD);
  assert.deepEqual(JOIN_HEAD, ['team', 'team_id', 'invite_token', 'join_command', 'shell_profile', 'managed_settings']);
  assert.equal(rows.length, 2, 'a team without a token is left out');
  assert.deepEqual(rows[1], ['Platform', 't1', tok, `npm i -g sprag-cli@latest && sprag team join ${tok}`,
    `export SPRAG_TEAM_TOKEN=${tok}`, JSON.stringify({ env: { SPRAG_TEAM_TOKEN: tok } })]);
});

test('the Invite & enroll tab and the empty state use the same join command as the export', () => {
  assert.match(html, /\$\('sn-join'\)\.textContent = joinCmd\(tok\);/);
  assert.match(html, /return tm \? joinCmd\(tm\.invite_token\) : '';/);
  assert.equal(html.split("sprag team join ' +").length - 1, 1, 'the join command string is built in one place only');
});

test('the dashboards load admin-ux.js and preset-sign.js with ?v=<package version>', () => {
  // Cloudflare serves /assets with max-age=14400. Without the query a browser kept the old
  // admin-ux.js under the v3.99.0 page and the export threw 'AdminUX.csv is not a function'.
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const ops = readFileSync(new URL('../site/ops/index.html', import.meta.url), 'utf8');
  for (const [name, page] of [['team', html], ['ops', ops]]) {
    assert.ok(page.includes(`<script src="/assets/admin-ux.js?v=${version}"></script>`), `${name}: admin-ux.js is not versioned`);
    assert.doesNotMatch(page, /<script src="[^"]*\/assets\/(admin-ux|preset-sign)\.js"/, `${name}: an unversioned dashboard script is left`);
  }
  assert.ok(ops.includes(`<script src="/assets/preset-sign.js?v=${version}"></script>`));
  const sync = readFileSync(new URL('../scripts/sync-site-version.mjs', import.meta.url), 'utf8');
  const re = new RegExp(sync.match(/const sceneRe = \/(.+)\/g;/)[1], 'g');
  assert.equal(`src="/assets/admin-ux.js?v=1.0.0" import('/assets/scene/office-scene.js?v=1.0.0')`.replace(re, '$19.9.9'),
    `src="/assets/admin-ux.js?v=9.9.9" import('/assets/scene/office-scene.js?v=9.9.9')`, 'npm version bumps the dashboard scripts too');
});

test('CSV cells quote commas and JSON, and neutralise a team name that starts like a formula', () => {
  const cell = csvCell();
  assert.equal(cell('{"env":{"SPRAG_TEAM_TOKEN":"x"}}'), '"{""env"":{""SPRAG_TEAM_TOKEN"":""x""}}"');
  assert.equal(cell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(cell('npm i -g sprag-cli@latest && sprag team join spt_1'), 'npm i -g sprag-cli@latest && sprag team join spt_1');
  assert.match(ux, /window\.AdminUX = \{[^}]*\bcsv\b[^}]*\}/);
});
