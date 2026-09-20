/**
 * Regressions for the 2026-09-21 review pass. Each block pins one defect that
 * a full-codebase read turned up, so the fix cannot quietly drift back:
 * Korean acks that the ASCII-only `\b` never matched, a ledger that credited a
 * rule with runs older than the rule, hook removal that took other tools'
 * hooks along, an `--icon` flag that overrode the stored mode, a window size
 * that audited differently as a number and as a string, and a savings figure
 * priced at the wrong session's model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isSkippable, ruleCouldHaveRouted, ESCALATE_RE, EDIT_RE } from '../src/route-scan.js';
import { routeHint, looksPasted } from '../src/route-inject.js';
import { withoutCacheMonitorHooks } from '../src/hook-manager.js';
import { resolveLabelMode } from '../src/statusline-mode.js';
import { parseWindow } from '../src/compact-window.js';
import { estimateCost, estimateCostAcross } from '../src/cost.js';
import { getLastUserMessageTime } from '../src/parser.js';

test('Korean acks are skipped; a word that merely starts with one is not', () => {
  for (const t of ['계속 진행', '응 다 정리해도돼', '네', '진행', 'ok go', '고고']) {
    assert.equal(isSkippable(t), true, `ack: ${t}`);
  }
  for (const t of ['네이버 리뷰 확인', '진행하자', '응답 형식을 바꿔줘']) {
    assert.equal(isSkippable(t), false, `task: ${t}`);
  }
});

test('a rule is not credited with runs that started before it was promoted', () => {
  const rule = { promotedAt: '2026-09-10' };
  const before = { startedAt: Date.parse('2026-09-01T00:00:00Z') };
  const after = { startedAt: Date.parse('2026-09-12T00:00:00Z') };
  assert.equal(ruleCouldHaveRouted(rule, before), false);
  assert.equal(ruleCouldHaveRouted(rule, after), true);
  // Older registries carry no date and runs without a timestamp cannot be
  // placed: both keep the previous behaviour.
  assert.equal(ruleCouldHaveRouted({}, before), true);
  assert.equal(ruleCouldHaveRouted(rule, { startedAt: null }), true);
});

test('escalate and edit regexes match the intended shapes only', () => {
  assert.equal(ESCALATE_RE.test('왜?'), true);
  assert.equal(ESCALATE_RE.test('왜 이렇게 나오지'), true);
  assert.equal(ESCALATE_RE.test('릴리즈 진행하자'), true);
  assert.equal(ESCALATE_RE.test('릴리즈 노트 업데이트'), false, 'editing release notes is not a release');
  assert.equal(EDIT_RE.test('설정되도록하자'), true);
  assert.equal(EDIT_RE.test('유지되도록 하자'), true);
  assert.equal(EDIT_RE.test('되게 느린데 확인해봐'), false, 'the intensifier is not an edit');
  assert.equal(EDIT_RE.test('되도록 빨리 돌려줘'), false, 'the adverb is not an edit');
});

test('a long written request is not a paste; a log or stack trace is', () => {
  const rules = [{ category: 'paste', tier: 'T2', agent: 'haiku-explore', budget: { calls: 8, out: 1500 } }];
  const spec = ('이 기능은 사용자가 지도를 열었을 때 현재 위치 주변 매장을 보여 주고 ').repeat(12);
  assert.ok(spec.length >= 400);
  assert.equal(looksPasted(spec), false);
  assert.equal(routeHint(spec, { rules, lang: 'ko', root: tmpdir() }), null);
  const log = Array.from({ length: 12 }, (_, i) => `2026-09-21 07:00:${String(i).padStart(2, '0')} worker: request ${i} ok`).join('\n')
    + '\nError: ECONNRESET\n    at TCP.onStreamRead (node:internal/stream_base_commons:217:20)\n';
  assert.equal(looksPasted(log), true);
  assert.ok(routeHint(log.padEnd(400, ' '), { rules, lang: 'ko', root: tmpdir() }));
});

test('removing our hook keeps another tool\'s hook in the same matcher group', () => {
  const groups = [
    {
      matcher: 'Bash|Edit|Write',
      hooks: [
        { type: 'command', command: 'other-tool --post' },
        { type: 'command', command: 'sprag --hook-run --threshold 0.7' },
      ],
    },
    { matcher: 'Read', hooks: [{ type: 'command', command: 'sprag --hook-run' }] },
    { matcher: 'Edit', hooks: [{ type: 'command', command: 'third-tool' }] },
  ];
  const out = withoutCacheMonitorHooks(groups);
  assert.deepEqual(out, [
    { matcher: 'Bash|Edit|Write', hooks: [{ type: 'command', command: 'other-tool --post' }] },
    { matcher: 'Edit', hooks: [{ type: 'command', command: 'third-tool' }] },
  ]);
});

test('the installed --icon flag yields to a stored label choice', () => {
  const env = {}; // not IntelliJ
  const hasFlag = (f) => f === '--icon';
  assert.equal(resolveLabelMode({ hasFlag, cfg: { labels: 'text' }, env }).mode, 'text');
  assert.equal(resolveLabelMode({ hasFlag, cfg: { labels: 'narrow' }, env }).mode, 'narrow');
  assert.equal(resolveLabelMode({ hasFlag, cfg: { icon: false }, env }).mode, 'text', 'legacy key counts too');
  const fresh = resolveLabelMode({ hasFlag, cfg: {}, env });
  assert.equal(fresh.mode, 'icon');
  assert.equal(fresh.reason, 'flag:--icon');
});

test('a numeric bare-hundreds window parses like the string form', () => {
  assert.equal(parseWindow(200), 200_000);
  assert.equal(parseWindow('200'), 200_000);
  assert.equal(parseWindow(200_000), 200_000);
  assert.equal(parseWindow(1_000_000), 1_000_000);
});

test('window savings are priced per session, not at the first session\'s model', () => {
  const totals = { input: 1_000_000, cacheCreation: 0, cacheRead: 9_000_000, output: 100_000, ephemeral5m: 0, ephemeral1h: 0 };
  const haiku = { model: 'claude-haiku-4-5-20251001', totals };
  const fable = { model: 'claude-fable-5-1', totals };
  const across = estimateCostAcross([haiku, fable]);
  const expected = estimateCost(totals, haiku.model).savings + estimateCost(totals, fable.model).savings;
  assert.ok(Math.abs(across.savings - expected) < 0.02, `${across.savings} vs ${expected}`);
  // The old single call priced everything at sessions[0] — here the cheap one.
  const wrong = estimateCost({ ...totals, input: 2_000_000, cacheRead: 18_000_000, output: 200_000 }, haiku.model);
  assert.ok(across.savings > wrong.savings * 2, 'the cheap-tier estimate understated the saving');
  assert.equal(across.tier, estimateCost(totals, fable.model).tier, 'dominant tier is the one that cost most');
});

test('last user timestamp is found from the tail of a large transcript', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-tail-'));
  const path = join(dir, 'session.jsonl');
  try {
    const lines = [
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T10:00:00Z' }),
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T10:02:00Z' }),
    ];
    // ~300KB of assistant/tool turns after the last user entry: several tail
    // chunks, so the partial-line carry between chunks is exercised.
    for (let i = 0; i < 1500; i++) {
      lines.push(JSON.stringify({ type: 'assistant', timestamp: '2026-07-01T10:03:00Z', message: { content: 'x'.repeat(180) } }));
    }
    writeFileSync(path, lines.join('\n') + '\n');
    const t = await getLastUserMessageTime(path);
    assert.equal(t.toISOString(), '2026-07-01T10:02:00.000Z');
    writeFileSync(path, lines.filter((l) => !l.includes('"user"')).join('\n') + '\n');
    assert.equal(await getLastUserMessageTime(path), null, 'no user entry anywhere');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
