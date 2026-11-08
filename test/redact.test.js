/**
 * redact — one table of secret shapes behind findSecrets, redactSecrets and
 * maskPreview. The shapes listed here are the union of the Enterprise uploader's
 * patterns and the extra ones the repo's own evals masker knew (npm_, sk-proj-,
 * AIza, Google refresh tokens), plus credentials in URLs and password flags.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, redactPersonal, findSecrets, maskPreview, safeExcerpt } from '../src/redact.js';
import * as teamPrompts from '../src/team-prompts.js';

const A = (n, c = 'a') => c.repeat(n);

const SHAPES = [
  ['npm token', `npm_${A(36, 'Z')}`],
  ['openai project key', `sk-proj-${A(48, 'Q')}`],
  ['anthropic key', `sk-ant-api03-${A(30, 'x')}`],
  ['github pat', `github_pat_${A(40, 'k')}`],
  ['github classic', `ghp_${A(36, 'p')}`],
  ['aws access key', 'AKIAABCDEFGHIJKLMNOP'],
  ['slack bot token', 'xoxb-12345678901-abcdefghij'],
  ['google api key', `AIza${A(35, 'B')}`],
  ['google refresh token', `1//${A(50, 'r')}`],
  ['google access token', `ya29.${A(40, 'a')}`],
  ['stripe live key', `sk_live_${A(24, 'S')}`],
  ['jwt', `eyJ${A(20, 'h')}.eyJ${A(20, 'p')}.${A(20, 's')}`],
  ['huggingface token', `hf_${A(34, 'h')}`],
];

for (const [name, secret] of SHAPES) {
  test(`${name} is found and masked, and findSecrets does not return it`, () => {
    const text = `run it with ${secret} please`;
    const hits = findSecrets(text);
    assert.equal(hits.length, 1, name);
    assert.equal(text.slice(hits[0].start, hits[0].end), secret);
    assert.deepEqual(Object.keys(hits[0]).sort(), ['end', 'kind', 'start']);
    assert.ok(!JSON.stringify(hits).includes(secret), 'the value must not appear in the result');
    assert.equal(redactSecrets(text), 'run it with [redacted] please');
    assert.equal(maskPreview(text), 'run it with [redacted] please');
  });
}

test('credentials in URLs: only the password goes', () => {
  assert.equal(redactSecrets('git clone https://alice:s3cr3tPw@github.com/a/b.git'), 'git clone https://alice:[redacted]@github.com/a/b.git');
  assert.equal(redactSecrets('postgres://u:pw1@db:5432/x'), 'postgres://u:[redacted]@db:5432/x');
  // a variable reference or a placeholder is not a secret; a plain host:port is not credentials
  assert.equal(findSecrets('postgres://u:$DB_PASS@db/x').length, 0);
  assert.equal(findSecrets('https://example.com:8443/path and http://localhost:3000/').length, 0);
});

test('password-like flags: the value goes, the flag stays', () => {
  assert.equal(redactSecrets('mysql --password=hunter2 -h db'), 'mysql --password=[redacted] -h db');
  assert.equal(redactSecrets('tool --api-key=abc123 run'), 'tool --api-key=[redacted] run');
  assert.equal(redactSecrets('tool --refresh-token="a b c" run'), 'tool --refresh-token=[redacted] run');
  assert.equal(redactSecrets('login --token abc123xyz9 now'), 'login --token [redacted] now');
  assert.equal(redactSecrets('curl -u admin:hunter2pw https://x.test'), 'curl -u admin:[redacted] https://x.test');
  assert.equal(redactSecrets('curl -H "Authorization: Basic dXNlcjpwYXNzd29yZA==" x'), 'curl -H "Authorization: Basic [redacted]" x');
});

test('env style assignments and Bearer headers (the old patterns) still work', () => {
  assert.equal(redactSecrets('PGPASSWORD=pw123 psql'), 'PGPASSWORD=[redacted] psql');
  assert.equal(redactSecrets('export NPM_TOKEN="abc def"'), 'export NPM_TOKEN=[redacted]');
  assert.equal(redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuv'), 'Authorization: Bearer [redacted]');
});

test('ordinary sentences and flags are left alone', () => {
  const clean = [
    'token budget is 8000',
    'password reset flow',
    'the password field must be at least 8 characters',
    'node cli.js --max-tokens=1024 --token-budget 8000',
    'run with --token flag set, and --password-stdin',
    'if (key == null || key === other) return',
    'const handler = (key) => key => 1',
    'KEY=$HOME/bin and PASSWORD=${PW}',
    'Basic authentication is supported',
    'see https://example.com/docs and git@github.com:a/b.git',
    'Bearer authentication scheme',
    '1//2 and 10//20 are fractions',
  ];
  for (const text of clean) {
    assert.deepEqual(findSecrets(text), [], text);
    assert.equal(redactSecrets(text), text);
  }
});

test('overlapping shapes merge into one span', () => {
  const text = `NPM_TOKEN=npm_${A(36, 'Z')} next`;
  assert.equal(findSecrets(text).length, 1);
  assert.equal(redactSecrets(text), 'NPM_TOKEN=[redacted] next');
});

test('a private key block, whole or cut off, is masked to the end', () => {
  assert.equal(redactSecrets('a\n-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\nb'), 'a\n[redacted]\nb');
  assert.equal(redactSecrets('cut -----BEGIN PRIVATE KEY-----\nMIIBabc'), 'cut [redacted]');
});

test('maskPreview masks before it cuts', () => {
  const token = `ghp_${A(36, 'p')}`;
  const out = maskPreview(`${A(20, 'x')} ${token} tail`, 30);
  assert.ok(!out.includes('ghp_'), out);
  assert.ok(out.length <= 30);
});

test('safeExcerpt masks before the cut, so no half-token survives at the limit', () => {
  const token = `ghp_${A(36, 'p')}`;
  const text = `${A(70, 'x')} ${token}`;
  const out = safeExcerpt(text, 80);
  assert.ok(!out.includes('ghp_'), out);
  assert.ok(out.length <= 80);
  assert.equal(safeExcerpt('mail me at a@example.com'), 'mail me at [redacted:email]');
});

test('team-prompts re-exports the same functions', () => {
  assert.equal(teamPrompts.redactSecrets, redactSecrets);
  assert.equal(teamPrompts.redactPersonal, redactPersonal);
});
