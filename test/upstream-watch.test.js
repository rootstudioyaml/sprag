import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cmpVersion, sliceClaudeChangelog, pickCodexReleases, chunkText, buildPrompt,
  capNewest, versionLabel, buildParentMessage, parseEnvFile, verdictLine,
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
