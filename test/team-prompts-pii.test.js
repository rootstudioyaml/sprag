/**
 * team-prompts PII redaction: email, Korean phone numbers, resident registration numbers, card numbers.
 * Every type has positives and the false-positive guards that the corpus run on real prompts called for.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { redactPersonal, redactSecrets, claudePromptFromLine, codexPromptFromLine } from '../src/team-prompts.js';

const same = (s) => assert.equal(redactPersonal(s), s, `should be untouched: ${s}`);
const masked = (input, want) => assert.equal(redactPersonal(input), want);

test('redactPersonal: email and mobile number in one sentence', () => {
  masked('고객 김민지 010-1234-5678 a.kim@example.co.kr', '고객 김민지 [redacted:phone] [redacted:email]');
  masked('mail Bob.O+tag@sub.example.com, thanks', 'mail [redacted:email], thanks');
  masked('<Alice <alice@corp.io>>', '<Alice <[redacted:email]>>');
});

test('redactPersonal: email false-positive guards', () => {
  for (const s of [
    'git clone git@github.com:org/repo.git',
    'remote ssh://git@gitlab.com/org/repo',
    'npm i react@18.3.1 @types/node @scope/pkg',
    'react@18.3.1-beta.abc',
    'logo@2x.png and icon@3x.webp',
    'user@localhost and foo@bar and a@b.c',
    'decorator @Component and @media screen',
  ]) same(s);
});

test('redactPersonal: Korean phone numbers', () => {
  masked('010-1234-5678', '[redacted:phone]');
  masked('01012345678', '[redacted:phone]');
  masked('010 1234 5678 / 011.123.4567', '[redacted:phone] / [redacted:phone]');
  masked('+82 10 9876 5432', '[redacted:phone]');
  masked('+82-10-9876-5432', '[redacted:phone]');
  masked('+82 (0)10-987-6543', '[redacted:phone]');
  masked('02-123-4567', '[redacted:phone]');
  masked('031-1234-5678', '[redacted:phone]');
  masked('전화는 010-1234-5678로 주세요', '전화는 [redacted:phone]로 주세요');
});

test('redactPersonal: phone false-positive guards', () => {
  for (const s of [
    '1588-1234', '1577-0000 and 1644-1234', '1800-1234',
    '1792292400000', 'id 20261101123456', '0212345678 plain landline digits',
    'e0990e2d7309f75343ff01012345678f2db8267ca1aa', '2026-11-01', '0.1234567890',
    '010-123', '12010-1234-5678',
  ]) same(s);
});

test('redactPersonal: resident registration numbers', () => {
  masked('900101-1234567', '[redacted:rrn]');
  masked('주민번호 900101 1234567 입니다', '주민번호 [redacted:rrn] 입니다');
  masked('외국인 850315-5123456', '외국인 [redacted:rrn]');
  for (const s of [
    '9001011234567', '1792292400000', '901301-1234567', '900132-1234567', '900101-9234567', '900101-123456', '900101-12345678',
  ]) same(s);
});

test('redactPersonal: card numbers need a valid Luhn check', () => {
  masked('4111 1111 1111 1111', '[redacted:card]');
  masked('4111-1111-1111-1111', '[redacted:card]');
  masked('card 5500-0000-0000-0004 ok', 'card [redacted:card] ok');
  masked('3782 822463 10005', '[redacted:card]'); // 4-6-5 AmEx
  masked('4111111111111111', '[redacted:card]');
  masked('378282246310005', '[redacted:card]');
  masked('2221000000000009', '[redacted:card]');
  masked('9490123456789013', '[redacted:card]'); // Korean domestic prefix 9
  masked('9490 1234 5678 9014', '9490 1234 5678 9014'); // bad Luhn
  for (const s of [
    '4111 1111 1111 1112', '4111-1111-1111-1112', '4111111111111112',
    '1234567890123456', // contiguous, no real issuer prefix
    '1792292400000', '12345678-1234-1234-1234-123456789012',
  ]) same(s);
});

test('redactPersonal: secrets keep the plain marker and win over a nested email', () => {
  assert.equal(redactSecrets('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), '[redacted]');
  assert.equal(redactPersonal(redactSecrets('PASSWORD=a.kim@example.co.kr call 010-1234-5678')), 'PASSWORD=[redacted] call [redacted:phone]');
  assert.equal(redactPersonal(redactSecrets('API_KEY="me@corp.io"')), 'API_KEY=[redacted]');
  assert.equal(redactPersonal('[redacted] stays'), '[redacted] stays');
  assert.equal(redactPersonal(undefined), '');
});

test('what would be uploaded is masked: claude and codex prompts go through redactPersonal', () => {
  const line = JSON.stringify({
    type: 'user', timestamp: '2026-10-18T10:01:00.000Z', cwd: '/Users/dev/work/app',
    message: { role: 'user', content: '고객 김민지 010-1234-5678 a.kim@example.co.kr 주민번호 900101-1234567 카드 4111 1111 1111 1111 키 ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
  });
  const p = claudePromptFromLine(line);
  assert.equal(p.text, '고객 김민지 [redacted:phone] [redacted:email] 주민번호 [redacted:rrn] 카드 [redacted:card] 키 [redacted]');
  const codex = codexPromptFromLine(JSON.stringify({
    timestamp: '2026-10-18T10:02:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'ping a.kim@example.co.kr' },
  }));
  assert.equal(codex.text, 'ping [redacted:email]');
});
