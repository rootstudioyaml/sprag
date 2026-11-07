import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PER_MILLION } from '../src/openai-prices.js';
import {
  cmpVersion, sliceClaudeChangelog, pickCodexReleases, chunkText, buildPrompt,
  capNewest, versionLabel, buildParentMessage, parseEnvFile, verdictLine,
  parseAnthropicPricing, parseOpenAIPricing, diffAnthropicPrices, diffOpenAIPrices, newModels, findingsDigest, buildPricingMessage,
} from '../scripts/upstream-watch.mjs';

const CHANGELOG = `# Changelog

## 2.1.319

- Fixed statusline flicker
- Added \`effort\` to the payload

## 2.1.318

- Improved hooks

## 2.1.317

- Fixed a crash

## 2.1.9

- Old entry
`;

test('cmpVersion compares numerically, not as strings', () => {
  assert.equal(cmpVersion('2.1.9', '2.1.10'), -1);
  assert.equal(cmpVersion('2.1.10', '2.1.9'), 1);
  assert.equal(cmpVersion('2.1.319', '2.1.319'), 0);
  assert.equal(cmpVersion('0.167.0', '0.9.9'), 1);
  assert.equal(cmpVersion('3.0', '3.0.0'), 0);
});

test('sliceClaudeChangelog honors both bounds and returns newest first', () => {
  const r = sliceClaudeChangelog(CHANGELOG, '2.1.317', '2.1.319');
  assert.deepEqual(r.map((s) => s.version), ['2.1.319', '2.1.318']);
  assert.match(r[0].body, /statusline flicker/);
  assert.doesNotMatch(r[0].body, /Improved hooks/);
  const until = sliceClaudeChangelog(CHANGELOG, '2.1.9', '2.1.318');
  assert.deepEqual(until.map((s) => s.version), ['2.1.318', '2.1.317']);
  assert.deepEqual(sliceClaudeChangelog(CHANGELOG, '2.1.319', '2.1.319'), []);
});

test('sliceClaudeChangelog with no last-seen version returns only the newest', () => {
  const r = sliceClaudeChangelog(CHANGELOG, null, '2.1.319');
  assert.equal(r.length, 1);
  assert.equal(r[0].version, '2.1.319');
  assert.equal(sliceClaudeChangelog(CHANGELOG, null, '2.1.318')[0].version, '2.1.318');
});

test('pickCodexReleases keeps stable rust tags only', () => {
  const list = [
    { tag_name: 'rust-v0.168.0-alpha.3', body: 'a', html_url: 'u1', prerelease: true },
    { tag_name: 'rust-v0.167.0', body: 'b', html_url: 'u2' },
    { tag_name: 'rust-v0.166.0', body: 'c', html_url: 'u3', draft: true },
    { tag_name: 'rust-v0.165.1', body: 'd', html_url: 'u4', prerelease: true },
    { tag_name: 'v0.164.0', body: 'e', html_url: 'u5' },
    { tag_name: 'rust-v0.165.0', body: 'f', html_url: 'u6' },
  ];
  assert.deepEqual(pickCodexReleases(list, '0.164.0'), [
    { version: '0.167.0', body: 'b', url: 'u2' },
    { version: '0.165.0', body: 'f', url: 'u6' },
  ]);
  assert.deepEqual(pickCodexReleases(list, '0.167.0'), []);
  assert.deepEqual(pickCodexReleases(list, null).map((r) => r.version), ['0.167.0']);
});

test('capNewest keeps the newest entries and counts the rest', () => {
  const list = Array.from({ length: 7 }, (_, i) => ({ version: `1.0.${7 - i}` }));
  const { kept, skipped } = capNewest(list, 5);
  assert.equal(kept.length, 5);
  assert.equal(kept[0].version, '1.0.7');
  assert.equal(skipped, 2);
});

test('chunkText never exceeds the limit and keeps paragraphs whole when it can', () => {
  const p = (n, c) => c.repeat(n);
  const text = [p(40, 'a'), p(40, 'b'), p(40, 'c'), p(40, 'd')].join('\n\n');
  const chunks = chunkText(text, 100);
  assert.ok(chunks.every((c) => c.length <= 100));
  assert.deepEqual(chunks, [`${p(40, 'a')}\n\n${p(40, 'b')}`, `${p(40, 'c')}\n\n${p(40, 'd')}`]);
  assert.deepEqual(chunkText('short', 100), ['short']);
  assert.deepEqual(chunkText('', 100), []);
});

test('chunkText hard-splits a single over-long paragraph without losing text', () => {
  const long = 'x'.repeat(250);
  const chunks = chunkText(`intro\n\n${long}\n\nend`, 100);
  assert.ok(chunks.every((c) => c.length <= 100));
  assert.equal(chunks.join('').replace(/\n/g, ''), `intro${long}end`);
});

test('buildPrompt carries the contract text and every version heading', () => {
  const versions = [
    { version: '2.1.319', body: '- Fixed A' },
    { version: '2.1.318', body: '- Changed B' },
  ];
  const prompt = buildPrompt({ product: 'claude', versions, contract: 'CONTRACT-MARKER-XYZ' });
  assert.match(prompt, /CONTRACT-MARKER-XYZ/);
  assert.match(prompt, /## 2\.1\.319\n- Fixed A/);
  assert.match(prompt, /## 2\.1\.318\n- Changed B/);
  assert.match(prompt, /Claude Code/);
  assert.match(buildPrompt({ product: 'codex', versions, contract: 'c' }), /Codex/);
});

test('message helpers: label, verdict, parent', () => {
  const v = [{ version: '2.1.319' }, { version: '2.1.318' }, { version: '2.1.317' }];
  assert.equal(versionLabel(v), '2.1.317 ~ 2.1.319');
  assert.equal(versionLabel([v[0]]), '2.1.319');
  assert.equal(verdictLine('\n\n*영향 없음*\n\n본문'), '*영향 없음*');
  const parent = buildParentMessage({ product: 'codex', versions: [v[0]], verdict: '영향 없음', skipped: 2, links: ['<u|0.1.0>'] });
  assert.match(parent, /^\*Codex 2\.1\.319 출시: sprag 영향 분석\*/);
  assert.match(parent, /2개는 건너뛰었습니다/);
  assert.match(parent, /<u\|0\.1\.0>/);
});

test('parseEnvFile reads simple lines and strips quotes', () => {
  const env = parseEnvFile('# comment\nA=1\nB="two words"\nexport C=\'x\'\n\nD=plain # note\nbad line\n');
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'x', D: 'plain' });
});

// ---------------------------------------------------------------------------
// Price-table check

const ANTHROPIC_MD = readFileSync(new URL('./fixtures/anthropic-pricing.md', import.meta.url), 'utf8');
const OPENAI_MD = readFileSync(new URL('./fixtures/openai-pricing.md', import.meta.url), 'utf8');

test('parseAnthropicPricing reads the model table and strips notes', () => {
  const rows = parseAnthropicPricing(ANTHROPIC_MD);
  assert.ok(rows.length >= 18, `rows: ${rows.length}`);
  const opus = rows.find((r) => r.name === 'Claude Opus 5.5');
  assert.equal(opus.id, 'claude-opus-5-5');
  assert.equal(opus.input, 4);
  assert.equal(opus.cacheRead, 0.2); // `$0.20 / MTok<sup>2</sup>`
  assert.equal(opus.output, 20);
  assert.equal(rows.find((r) => r.name === 'Claude Opus 5').id, 'claude-opus-5');
  assert.equal(rows.find((r) => r.id === 'claude-mythos-5-1').name, 'Claude Mythos 5.1'); // link note removed
  assert.equal(rows.find((r) => r.id === 'claude-opus-4-1').name, 'Claude Opus 4.1'); // nested parentheses
  const sonnet5 = rows.find((r) => r.id === 'claude-sonnet-5');
  assert.equal(sonnet5.input, 2); // `$2 / MTok<sup>3</sup>`
  assert.equal(sonnet5.output, 10);
  const haiku = rows.filter((r) => r.id === 'claude-haiku-5-5');
  assert.deepEqual(haiku.map((r) => r.long), [false, true]);
  assert.deepEqual(haiku.map((r) => r.input), [0.1, 0.5]);
  assert.ok(rows.every((r) => !/[()<>]/.test(r.name)));
});

test('parseAnthropicPricing skips other tables and returns [] when the model table is gone', () => {
  const decoy = '| Model | Price |\n| --- | --- |\n| Claude Decoy 9 | $1 |\n\n';
  assert.equal(parseAnthropicPricing(decoy + ANTHROPIC_MD).some((r) => r.id === 'claude-decoy-9'), false);
  assert.deepEqual(parseAnthropicPricing(decoy), []);
  assert.deepEqual(parseAnthropicPricing(''), []);
});

test('diffAnthropicPrices finds nothing against the current page and one finding for a changed cell', () => {
  const rows = parseAnthropicPricing(ANTHROPIC_MD);
  assert.deepEqual(diffAnthropicPrices(rows, { at: '2026-11-07' }), []);
  const changed = rows.map((r) => (r.id === 'claude-opus-5-5' ? { ...r, cacheRead: 0.15 } : r));
  assert.deepEqual(diffAnthropicPrices(changed, { at: '2026-11-07' }), [
    { kind: 'price', id: 'claude-opus-5-5', field: 'cacheRead', table: 0.2, page: 0.15, tier: 'claude-opus-5-5' },
  ]);
  const longChanged = rows.map((r) => (r.long ? { ...r, output: 3 } : r));
  const [f] = diffAnthropicPrices(longChanged, { at: '2026-11-07' });
  assert.equal(f.tier, 'claude-haiku-5-5-long');
  assert.equal(f.table, 2.5);
});

test('diffAnthropicPrices compares against the rate card in effect at `at`', () => {
  const rows = parseAnthropicPricing(ANTHROPIC_MD);
  const before = diffAnthropicPrices(rows, { at: '2026-10-06' });
  assert.deepEqual(before, [
    { kind: 'price', id: 'claude-sonnet-5-5', field: 'cacheRead', table: 0.2, page: 0.1, tier: 'claude-sonnet-5-5' },
  ]);
  assert.deepEqual(diffAnthropicPrices(rows, { at: '2026-11-07' }), []);
});

test('parseOpenAIPricing reads both Standard tables and nothing after them', () => {
  const rows = parseOpenAIPricing(OPENAI_MD);
  const by = (id) => rows.find((r) => r.id === id);
  assert.deepEqual(by('gpt-6-astra'), { id: 'gpt-6-astra', input: 10, cacheRead: 1, cacheWrite: 12.5, output: 50 });
  assert.deepEqual(by('gpt-5.5'), { id: 'gpt-5.5', input: 5, cacheRead: 0.5, cacheWrite: null, output: 30 });
  assert.equal(by('gpt-5.5-pro').cacheRead, null);
  assert.deepEqual(by('gpt-4o-mini'), { id: 'gpt-4o-mini', input: 0.15, cacheRead: 0.075, cacheWrite: null, output: 0.6 });
  assert.equal(rows.filter((r) => r.id === 'gpt-6-astra').length, 1); // the Batch table is not read
  assert.equal(by('gpt-6-astra').input, 10);
  assert.deepEqual(parseOpenAIPricing('no tables here'), []);
});

test('diffOpenAIPrices reports page models missing from the table and only real price differences', () => {
  const rows = parseOpenAIPricing(OPENAI_MD);
  // The Codex table now matches the page, so the real table reports nothing.
  assert.deepEqual(diffOpenAIPrices(rows), []);
  // Without its row, gpt-6.1-terra is reported as missing with the page prices.
  const { 'gpt-6.1-terra': _terra, ...withoutTerra } = PER_MILLION;
  const findings = diffOpenAIPrices(rows, withoutTerra);
  const missing = findings.filter((f) => f.kind === 'missing');
  assert.ok(missing.some((f) => f.id === 'gpt-6.1-terra'));
  assert.deepEqual(missing.find((f) => f.id === 'gpt-6.1-terra').page, { input: 1, cacheRead: 0.05, cacheWrite: 1.25, output: 5 });
  assert.ok(findings.every((f) => f.kind === 'missing' || (f.kind === 'price' && f.table !== f.page)));
  // gpt-5.5 has no cache-write rate on both sides: null equals null, so no finding.
  assert.equal(findings.some((f) => f.id === 'gpt-5.5'), false);
  const changed = diffOpenAIPrices([{ id: 'gpt-5.5', input: 5, cacheRead: 0.5, cacheWrite: 6, output: 31 }]);
  assert.deepEqual(changed, [
    { kind: 'price', id: 'gpt-5.5', field: 'cacheWrite', table: null, page: 6 },
    { kind: 'price', id: 'gpt-5.5', field: 'output', table: 30, page: 31 },
  ]);
});

test('only GPT-5 and GPT-6 family models count as missing from the Codex table', () => {
  const page = ['gpt-6.1-terra', 'gpt-5-mini', 'gpt-4o', 'gpt-4.1-mini', 'o3', 'o3-pro'].map((id) => ({ id, input: 1, cacheRead: null, cacheWrite: null, output: 2 }));
  assert.deepEqual(diffOpenAIPrices(page, {}).map((f) => f.id), ['gpt-6.1-terra', 'gpt-5-mini']);
});

test('newModels returns nothing on the first run, and the digest ignores finding order', () => {
  assert.deepEqual(newModels(['a', 'b'], undefined), []);
  assert.deepEqual(newModels(['a', 'b', 'c'], ['a', 'b']), ['c']);
  const f1 = { kind: 'price', id: 'x', field: 'input', table: 1, page: 2 };
  const f2 = { kind: 'missing', id: 'y', page: { input: 1 } };
  assert.equal(findingsDigest([f1, f2]), findingsDigest([f2, f1]));
  assert.notEqual(findingsDigest([f1]), findingsDigest([f1, f2]));
  assert.equal(findingsDigest([]), findingsDigest([]));
});

test('buildPricingMessage counts findings, leaves empty sections out, and avoids banned characters', () => {
  const anthropic = [{ kind: 'price', id: 'claude-opus-5-5', field: 'cacheRead', table: 0.2, page: 0.15, tier: 'claude-opus-5-5' }];
  const openai = [
    { kind: 'missing', id: 'gpt-6.1-terra', page: { input: 1, cacheRead: 0.05, cacheWrite: 1.25, output: 5 } },
    { kind: 'price', id: 'gpt-5.5', field: 'output', table: 30, page: 31 },
  ];
  const msg = buildPricingMessage({ anthropic, openai, newAnthropic: ['Claude Opus 6'], newOpenAI: [], date: '2026-11-07' });
  // Three differences plus one new model: a new model counts toward the total.
  assert.ok(msg.startsWith('*가격표 점검 (2026-11-07): 차이 4건*'));
  assert.ok(msg.includes('ALIAS_HISTORY'));
  assert.ok(msg.includes('• claude-opus-5-5 캐시 읽기: sprag $0.20, 공식 $0.15'));
  for (const h of ['Anthropic 가격 차이', 'OpenAI 가격 차이', 'sprag 표에 없는 OpenAI 모델', '새로 올라온 모델']) assert.ok(msg.includes(h), h);
  assert.ok(msg.includes("from: '2026-11-07'"));
  assert.ok(msg.includes('src/openai-prices.js'));
  assert.equal(/[·—]/.test(msg), false);

  const only = buildPricingMessage({ anthropic, date: '2026-11-07' });
  assert.ok(only.includes('차이 1건'));
  assert.equal(only.includes('OpenAI'), false);
  assert.equal(only.includes('새로 올라온 모델'), false);
  assert.equal(only.includes('src/openai-prices.js'), false);

  const fetchFail = buildPricingMessage({ openai: [{ kind: 'fetch', source: 'openai', page: 'u', reason: 'timeout' }], date: '2026-11-07' });
  assert.ok(fetchFail.includes('가격 페이지 확인 실패'));
  assert.ok(fetchFail.includes('차이 1건'));
});
