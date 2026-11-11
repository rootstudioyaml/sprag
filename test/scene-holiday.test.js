import { test } from 'node:test';
import assert from 'node:assert/strict';

const { holidayOn, inHolidaySeason, seoulMonthDay } = await import('../site/assets/scene/holiday.js');

/* Seoul wall clock to an instant: UTC+9, so subtract nine hours */
const seoul = (y, mo, d, h = 0, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h - 9, mi));

test('holidayOn: the season opens at Nov 1 00:00 Seoul and closes after Jan 6', () => {
  assert.equal(holidayOn(seoul(2026, 10, 31, 23, 59), ''), false);
  assert.equal(holidayOn(seoul(2026, 11, 1, 0, 0), ''), true);
  assert.equal(holidayOn(seoul(2026, 11, 11, 12), ''), true);
  assert.equal(holidayOn(seoul(2026, 12, 25, 12), ''), true);
  assert.equal(holidayOn(seoul(2026, 12, 31, 23, 59), ''), true);
  assert.equal(holidayOn(seoul(2027, 1, 1, 0, 0), ''), true, 'the season crosses the new year');
  assert.equal(holidayOn(seoul(2027, 1, 6, 23, 59), ''), true);
  assert.equal(holidayOn(seoul(2027, 1, 7, 0, 0), ''), false);
  assert.equal(holidayOn(seoul(2026, 7, 4, 12), ''), false);
  assert.equal(holidayOn(seoul(2026, 10, 15, 12), ''), false);
});

test('holidayOn: the date is read on the Seoul clock, not UTC', () => {
  /* 2026-10-31 15:00 UTC is already Nov 1 00:00 in Seoul */
  assert.equal(holidayOn(new Date('2026-10-31T15:00:00Z'), ''), true);
  assert.equal(holidayOn(new Date('2026-10-31T14:59:59Z'), ''), false);
  /* 2027-01-06 15:00 UTC is Jan 7 00:00 in Seoul */
  assert.equal(holidayOn(new Date('2027-01-06T14:59:59Z'), ''), true);
  assert.equal(holidayOn(new Date('2027-01-06T15:00:00Z'), ''), false);
  assert.deepEqual(seoulMonthDay(new Date('2026-12-31T15:00:00Z')), { month: 1, day: 1 });
});

test('holidayOn: the season query beats the calendar', () => {
  const summer = seoul(2026, 7, 4, 12), winter = seoul(2026, 12, 25, 12);
  assert.equal(holidayOn(summer, '?season=xmas'), true);
  assert.equal(holidayOn(winter, '?season=off'), false);
  assert.equal(holidayOn(winter, '?a=1&season=off'), false);
  assert.equal(holidayOn(summer, '?season=other'), false, 'an unknown value falls back to the calendar');
  assert.equal(holidayOn(winter, '?season=other'), true);
  assert.equal(holidayOn(summer, 'season=xmas'), true, 'a query string without the leading question mark also works');
});

test('holidayOn: without a browser location it uses the calendar only, and a bad date is false', () => {
  assert.equal(holidayOn(seoul(2026, 12, 25, 12)), true);
  assert.equal(holidayOn(seoul(2026, 3, 1, 12)), false);
  assert.equal(holidayOn(new Date(NaN), ''), false);
});

test('inHolidaySeason: month and day edges', () => {
  for(const [m, d] of [[11, 1], [11, 15], [11, 30], [12, 1], [12, 31], [1, 1], [1, 6]]) assert.equal(inHolidaySeason(m, d), true, m + '-' + d);
  for(const [m, d] of [[10, 31], [10, 1], [1, 7], [2, 1], [7, 4]]) assert.equal(inHolidaySeason(m, d), false, m + '-' + d);
});

test('office-scene wires the holiday dressing behind holidayOn and frees it on every rebuild', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../site/assets/scene/office-scene.js', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*holidayOn[^}]*makeTree[^}]*makeGarland[^}]*makeWreath[^}]*santaHat[^}]*\} from '\.\/holiday\.js'/);
  assert.match(src, /xmas = holidayOn\(\)/, 'one flag per build, from the calendar or ?season=');
  for(const fn of ['makeTree', 'makeGarland', 'makeWreath', 'santaHat', 'reindeerAntlers', 'rudolphNose']) assert.ok(src.includes(fn + '(T'), fn + ' is called');
  assert.match(src, /hol\.forEach\(h => \{ if\(h\.parent\) h\.parent\.remove\(h\); h\.userData\.dispose\(\); \}\)/, 'clear() disposes everything');
  assert.match(src, /h\.userData\.tick\(time, envN\)/, 'step() ticks the lights with the night amount');
  assert.match(src, /holWall\.visible = !wallHid\.z/, 'the wall decorations fold away with the back wall');
  assert.match(src, /HAT_SKIP = new Set\(\['panda', 'raccoon', 'squirrel'\]\)/, 'species that already wear a hat skip the Santa hat');
  assert.match(src, /ANTLER_SKIP = new Set\(\[[^\]]*'deer'/, 'species with horns or antlers of their own keep the nose only');
  assert.match(src, /hash\(o\.p\.id \+ ':xmas'\) < 0\.5 \? 'santa' : 'rudolph'/, 'the same person always gets the same set');
  assert.match(src, /noseTipOf\(T, m\)/, 'the nose tip is read off each loaded model');
});
