#!/usr/bin/env node
/**
 * Measures what attaching a document to a message actually costs, so the
 * savings doc2md reports rest on a number someone observed rather than on a
 * guess about how the client handles attachments.
 *
 * The savings figure is a difference between two worlds: the document read as
 * converted Markdown, and the same document attached whole. Only the first is
 * observable from inside the tool. The second has to be measured once, by
 * attaching a file and reading what the turn cost.
 *
 * Method
 *   1. Open a fresh session and send one short prompt with the document
 *      ATTACHED. Nothing else — no file reads, no tool calls.
 *   2. Open another fresh session and send the SAME prompt with no attachment.
 *   3. Run this script. It finds both sessions, reads the first assistant
 *      turn's input tokens in each, and reports the difference.
 *
 * The difference is the attachment's cost. Compare it against the token count
 * of the same document's conversion (the banner at the top of the .md prints
 * that figure) to get the per-format baseline multiplier.
 *
 * Both sessions must be fresh: a first turn is the only one whose input is
 * just the system prompt plus the message, with no conversation behind it.
 *
 * Usage:
 *   node scripts/doc2md-baseline.mjs                 # two most recent sessions
 *   node scripts/doc2md-baseline.mjs <id-a> <id-b>   # named sessions
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROJECTS = join(homedir(), '.claude', 'projects');

/** Every session transcript on this machine, newest first. */
function transcripts() {
  const out = [];
  for (const project of readdirSync(PROJECTS)) {
    const dir = join(PROJECTS, project);
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const file = join(dir, name);
      try {
        out.push({ id: name.replace(/\.jsonl$/, ''), file, mtime: statSync(file).mtimeMs, project });
      } catch { /* vanished mid-scan */ }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * The first assistant turn of a session: its input tokens, the user text that
 * prompted it, and whether that user message carried an attachment.
 *
 * Input tokens are the sum of fresh input, cache writes and cache reads. A
 * split between them is a caching artefact — the same content can land in any
 * of the three depending on what the previous session left warm — and what is
 * being measured here is content, not cache luck.
 */
function firstTurn(file) {
  let prompt = null;
  let attached = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const msg = row.message;
    if (!msg) continue;

    if (msg.role === 'user' && prompt === null) {
      const content = msg.content;
      if (typeof content === 'string') {
        prompt = content;
      } else if (Array.isArray(content)) {
        prompt = content.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
        attached = content.some((b) => b?.type === 'document' || b?.type === 'image');
      }
      continue;
    }

    if (msg.role === 'assistant' && msg.usage) {
      const u = msg.usage;
      const tokens = (u.input_tokens || 0)
        + (u.cache_creation_input_tokens || 0)
        + (u.cache_read_input_tokens || 0);
      return { tokens, prompt: (prompt || '').slice(0, 80), attached, model: msg.model };
    }
  }
  return null;
}

const wanted = process.argv.slice(2);
const all = transcripts();
const picked = wanted.length
  ? wanted.map((id) => all.find((t) => t.id === id || t.id.startsWith(id)))
  : all.slice(0, 2);

if (picked.some((p) => !p)) {
  console.error('세션을 찾지 못했습니다. `ls ~/.claude/projects/*/` 로 확인하십시오.');
  process.exit(1);
}

const rows = [];
for (const t of picked) {
  const turn = firstTurn(t.file);
  if (!turn) {
    console.error(`${t.id}: 첫 어시스턴트 턴이 없어 건너뜁니다.`);
    continue;
  }
  rows.push({ ...turn, id: t.id });
  console.log(
    `${turn.attached ? '첨부 있음' : '첨부 없음'}  ${String(turn.tokens).padStart(9)} 토큰  `
    + `${t.id.slice(0, 8)}  ${turn.model || '?'}\n`
    + `           "${turn.prompt.replace(/\s+/g, ' ')}"`,
  );
}

if (rows.length === 2) {
  const [a, b] = rows;
  const delta = Math.abs(a.tokens - b.tokens);
  console.log(`\n차이: ${delta.toLocaleString('en-US')} 토큰`);
  console.log('이 값이 첨부 한 건의 비용입니다. 변환본 머리말에 적힌 토큰 수와 비교하면');
  console.log('해당 형식의 절감 계수가 나옵니다. src/doc2md-ledger.cjs 의 ATTACHMENT_BASELINE 에 넣으십시오.');
}
