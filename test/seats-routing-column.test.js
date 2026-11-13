/**
 * Seats table "Routing" column (team and ops consoles) and the clearer denominator of the delegating-PCs KPI.
 * The pages are plain scripts, so the pieces under test are cut out of their source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const PAGES = { team: read('../site/team/index.html'), ops: read('../site/ops/index.html') };
const ux = read('../site/assets/admin-ux.js');

const KEYS = ['sr.c.routing', 'sr.rt.on', 'sr.rt.off', 'sr.rt.not', 'sr.rt.unknown',
  'sr.tip.rt.on', 'sr.tip.rt.off', 'sr.tip.rt.rules', 'sr.tip.rt.agents', 'sr.tip.rt.unknown', 'ux.dm.of', 'ux.dm.sub'];

/** The text of the page between the `I18N = {` and the second dictionary, split per language by the dictionary opening. */
function defined(html, key) {
  return html.split('\n').filter((l) => l.includes(`"${key}"`)).length;
}

for (const [name, html] of Object.entries(PAGES)) {
  test(`${name}: every new i18n key is defined in both languages`, () => {
    for (const k of KEYS) assert.equal(defined(html, k), 2, `${k} must appear once per language`);
    // English first, Korean second: the order the dictionaries are written in
    for (const k of KEYS) {
      const lines = html.split('\n');
      const at = lines.map((l, i) => (l.includes(`"${k}"`) ? i : -1)).filter((i) => i >= 0);
      assert.ok(/[가-힣]/.test(lines[at[1]]), `${k}: the second definition is Korean`);
      assert.ok(!/[가-힣]/.test(lines[at[0]]), `${k}: the first definition is English`);
    }
  });

  test(`${name}: the Routing column sits in the seats table and is part of the CSV`, () => {
    assert.match(html, /key:'routing', label:t\('sr\.c\.routing'\)/);
    const from = html.indexOf("key:'routing'");
    const col = html.slice(from, html.indexOf("key:'signal'", from));
    assert.doesNotMatch(col, /noCsv/, 'a column without noCsv is exported');
    assert.match(col, /val: r =>/, 'val is the CSV and sort value');
  });

  test(`${name}: routingOf classifies on, off, not loaded and unknown`, () => {
    const a = html.indexOf('const routingOf = r => {');
    const b = html.indexOf('\n  };', a) + 5;
    assert.ok(a > 0 && b > a);
    const routingOf = new Function('t', `${html.slice(a, b)}\nreturn routingOf;`)((k) => k);
    const kind = (r) => routingOf(r).k;
    assert.equal(kind({ routing_on: true, routing_loaded: true, routing_agents: true }), 'on');
    assert.equal(kind({ routing_on: false, routing_loaded: true, routing_agents: true }), 'off');
    assert.equal(kind({ routing_on: false, routing_loaded: false, routing_agents: false }), 'off', 'off wins over the other two');
    assert.equal(kind({ routing_on: true, routing_loaded: false, routing_agents: true }), 'not');
    assert.equal(kind({ routing_on: true, routing_loaded: true, routing_agents: false }), 'not');
    assert.equal(kind({ routing_on: null, routing_loaded: null, routing_agents: null }), 'unknown');
    assert.equal(kind({}), 'unknown', 'an older server sends no routing keys');
    assert.equal(kind({ routing_on: true, routing_loaded: null, routing_agents: true }), 'unknown');
    assert.equal(routingOf({ routing_on: true, routing_loaded: false, routing_agents: false }).tip, 'sr.tip.rt.rules\nsr.tip.rt.agents');
    assert.equal(routingOf({ routing_on: true, routing_loaded: false, routing_agents: true }).tip, 'sr.tip.rt.rules');
    assert.equal(routingOf({ routing_on: true, routing_loaded: true, routing_agents: false }).tip, 'sr.tip.rt.agents');
  });
}

test('the delegating-PCs KPI is written through ux.dm.of and explains its denominator', () => {
  const line = ux.split('\n').find((l) => l.includes("dm: { id:'dm'"));
  assert.ok(line);
  assert.match(line, /t\('ux\.dm\.of', \{ n: Math\.round\(n\), of: mach \}\)/);
  assert.match(line, /sub: esc\(t\('ux\.dm\.sub'\)\)/);
  assert.doesNotMatch(line, /' \/ ' \+ mach/, 'the bare "n / m" format is gone');
});

test('the new texts keep the numbers: placeholders {n} and {of} in both languages', () => {
  for (const html of Object.values(PAGES)) {
    const lines = html.split('\n').filter((l) => l.includes('"ux.dm.of"'));
    assert.equal(lines.length, 2);
    for (const l of lines) assert.ok(l.includes('{n}') && l.includes('{of}'), l);
    assert.match(lines[0], /active PCs/);
    assert.match(lines[1], /활동 PC/);
  }
});
