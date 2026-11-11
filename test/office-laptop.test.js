import { test } from 'node:test';
import assert from 'node:assert/strict';

const { laptopKind, officeSceneData } = await import('../site/assets/scene/office-scene.js');

test('laptopKind: mac family gets the apple, windows the panes, everything else the dot', () => {
  for(const v of ['macOS', 'Mac OS X', 'darwin', 'MACOS', 'Darwin', 'macOS 26.1 · arm64']) assert.equal(laptopKind(v), 'mac', v);
  for(const v of ['Windows', 'win32', 'WINDOWS', 'Windows 11 23H2']) assert.equal(laptopKind(v), 'win', v);
  for(const v of ['Linux', 'Ubuntu', 'freebsd', '', null, undefined, 0]) assert.equal(laptopKind(v), 'other', String(v));
});

const tt = (k, v) => k + (v ? JSON.stringify(v) : '');
const data = rows => officeSceneData({ rows, usage: {}, promptRows: null, teams: [{ id: 't1', name: 'T' }], used: rows.length, limit: 30, orgName: 'O', rangeLabel: '30d', t: tt, money: x => '$' + x, rel: x => x, os: () => '' });

test('officeSceneData hands each person the OS of the most recently seen machine', () => {
  const rows = [
    { member_id: 'a', display_name: 'A', team_id: 't1', team_name: 'T', signal: 'ok', os: 'macOS', last_seen: '2026-11-01T00:00:00Z' },
    { member_id: 'b', display_name: 'B', team_id: 't1', team_name: 'T', signal: 'ok', os: 'Windows' },
    { member_id: 'c', display_name: 'C', team_id: 't1', team_name: 'T', signal: 'ok', os: 'Linux', seat_of: 'a', last_seen: '2026-11-10T00:00:00Z' },
    { member_id: 'd', display_name: 'D', team_id: 't1', team_name: 'T', signal: 'ok' },
  ];
  const by = Object.fromEntries(data(rows).people.map(p => [p.id, p]));
  assert.equal(by.a.os, 'Linux', 'a and c share a person; the newer machine wins');
  assert.equal(by.b.os, 'Windows');
  assert.equal(by.d.os, '', 'no OS reported gives an empty string, which draws the dot');
  assert.equal(laptopKind(by.a.os), 'other'); assert.equal(laptopKind(by.b.os), 'win'); assert.equal(laptopKind(by.d.os), 'other');
});

test('an older machine without an OS does not hide the newest machine that has one', () => {
  const rows = [
    { member_id: 'a', display_name: 'A', team_id: 't1', team_name: 'T', signal: 'ok', os: 'darwin', last_seen: '2026-11-01T00:00:00Z' },
    { member_id: 'c', display_name: 'C', team_id: 't1', team_name: 'T', signal: 'ok', seat_of: 'a', last_seen: '2026-11-10T00:00:00Z' },
  ];
  assert.equal(data(rows).people[0].os, 'darwin');
});
