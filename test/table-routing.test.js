// The first screen of `sprag` is the pitch. A first run (npx sprag-cli) has
// nothing installed, so the report must say what the tool does (how much work a
// cheaper model could take) before it warns about spikes or caps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../src/formatters/table.js';
import { buildTableDemoData } from '../src/demo.js';

const base = () => buildTableDemoData({ version: '0.0.0' });
const render = (routing) => formatReport({ ...base(), routing }, { color: false });
const cand = (id, label, count) => ({ id, label, labelEn: label, count, agent: 'sonnet-worker' });

test('routing section shows share, candidates and approve command before warnings', () => {
  const out = render({
    days: 14, total: 234, easy: 43,
    candidates: [cand(1, 'running commands (build/test/git)', 15), cand(2, 'status checks / verification', 5)],
  });
  assert.match(out, /43 of 234 requests \(18%\) were lookups, checks or test runs a cheaper model handles\./);
  assert.match(out, /R1 {2}"running commands \(build\/test\/git\)" ×15 {2}→ {2}delegate to sonnet-worker/);
  assert.match(out, /R2 {2}"status checks \/ verification" ×5/);
  assert.match(out, /harness promote R1 --global/);
  const at = out.indexOf('Routing');
  const spike = out.search(/Spike|spike|Rate-limit cap|How to handle it/);
  assert.ok(spike > 0, 'demo data should render a warning section');
  assert.ok(at > 0 && at < spike);
});

test('zero episodes prints only the empty-scan sentence', () => {
  const out = render({ days: 14, total: 0, easy: 0, candidates: [] });
  assert.match(out, /No Claude Code sessions in the last 14 days to scan\./);
  assert.doesNotMatch(out, /requests \(/);
});

test('no candidates keeps the share line and explains the threshold', () => {
  const out = render({ days: 14, total: 50, easy: 10, candidates: [] });
  assert.match(out, /10 of 50 requests \(20%\)/);
  assert.match(out, /No recurring delegable work yet \(a pattern needs 3 repeats\)\./);
  assert.doesNotMatch(out, /Approve one/);
});

test('without routing the section is absent and the header is renamed', () => {
  const out = formatReport({ ...base(), options: { days: 30, version: '0.0.0' } }, { color: false });
  assert.doesNotMatch(out, /Routing/);
  assert.match(out, /Sprag — Last 30 days/);
});
