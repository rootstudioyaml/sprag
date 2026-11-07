#!/usr/bin/env node
/**
 * upstream-watch — notice new Claude Code and Codex releases, have Claude read
 * their release notes against what sprag depends on, and post the result to a
 * Slack channel.
 *
 * Why this exists: sprag reads settings.json keys, statusline and hook payloads,
 * transcript and rollout formats that Claude Code and Codex never promised to
 * keep. Breakage used to be found by a user whose statusline went blank, days
 * after the release. This runs from a maintainer's machine, so the list of
 * affected places is ready when the release lands, not when the bug report does.
 *
 * It is a maintainer tool and is not shipped: package.json `files` lists only
 * bin/, src/ and a few others, so nothing under scripts/ reaches the tarball.
 * The dependency list the analysis is checked against is scripts/upstream-contract.md.
 * It is compiled by grep and goes stale, so update it when sprag starts relying
 * on something new.
 *
 *   node scripts/upstream-watch.mjs                 # check both, analyze new versions, post to Slack
 *   node scripts/upstream-watch.mjs --dry-run       # analyze and print, no Slack, state unchanged
 *   node scripts/upstream-watch.mjs --no-llm        # skip analysis, print the release-note excerpts only (implies --dry-run)
 *   node scripts/upstream-watch.mjs --only claude|codex|pricing
 *   node scripts/upstream-watch.mjs --since 2.1.300 # treat this as the last seen Claude Code version (codex: --since-codex 0.160.0)
 *   node scripts/upstream-watch.mjs --env-file <path>  # where SLACK_BOT_TOKEN and SPRAG_SLACK_CHANNEL_ID live
 *
 * Two things cost or reach outside, so both are explicit. The analysis is one
 * `claude -p` call per product, run with ANTHROPIC_API_KEY and
 * ANTHROPIC_AUTH_TOKEN removed from its environment so it bills the
 * subscription login, not API credit. The Slack post needs SLACK_BOT_TOKEN and
 * SPRAG_SLACK_CHANNEL_ID, from the environment first and then from the env file
 * (default ../yaml-sns-agent/.env). The token is never printed.
 *
 * State lives in ${XDG_STATE_HOME or ~/.local/state}/sprag-upstream-watch/state.json
 * and moves forward only after Slack accepted the post for that product, so a
 * failed run is simply retried by the next one. With no state at all, the latest
 * release is the only one treated as new: the first run does not replay history.
 *
 * The `pricing` product compares both official pricing pages (Markdown) with
 * src/cost.js and src/openai-prices.js. It makes no LLM call. It posts only when
 * there is a difference that differs from the last posted one, so an unfixed
 * difference is not repeated every day. `--dry-run --only pricing` prints the message.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectPricingTier, ratesAt } from '../src/cost.js';
import { PER_MILLION } from '../src/openai-prices.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_PATH = join(ROOT, 'scripts', 'upstream-contract.md');
const CLAUDE_CHANGELOG_URL = 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';
const CLAUDE_CHANGELOG_PAGE = 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md';
const MAX_VERSIONS = 5;
const SLACK_CHUNK = 3500;
const MAX_BODY_CHARS = 20000;
const FETCH_TIMEOUT_MS = 20_000;
const LLM_TIMEOUT_MS = 10 * 60 * 1000;

export const PRODUCTS = {
  claude: { key: 'claude', name: 'Claude Code' },
  codex: { key: 'codex', name: 'Codex' },
  pricing: { key: 'pricing', name: 'Pricing' },
};

const ANTHROPIC_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';
const OPENAI_PRICING_URL = 'https://developers.openai.com/api/docs/pricing.md';
const PRICE_EPSILON = 1e-9;

/** Numeric x.y.z comparison: negative when a < b, 0 when equal, positive when a > b. */
export function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The CHANGELOG sections for versions newer than `sinceExclusive` and no newer
 * than `untilInclusive`, newest first. A null `sinceExclusive` is the first run:
 * only the newest section comes back.
 */
export function sliceClaudeChangelog(md, sinceExclusive, untilInclusive) {
  const lines = String(md).split('\n');
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = /^##\s+v?(\d+\.\d+\.\d+)\b/.exec(line);
    if (m) {
      cur = { version: m[1], lines: [] };
      sections.push(cur);
    } else if (/^#{1,2}\s/.test(line)) {
      cur = null;
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  const picked = sections
    .filter((s) => (sinceExclusive == null || cmpVersion(s.version, sinceExclusive) > 0)
      && (untilInclusive == null || cmpVersion(s.version, untilInclusive) <= 0))
    .map((s) => ({ version: s.version, body: s.lines.join('\n').trim() }))
    .sort((a, b) => cmpVersion(b.version, a.version));
  return sinceExclusive == null ? picked.slice(0, 1) : picked;
}

/**
 * Stable Codex releases from the GitHub releases list, newest first. Only tags of
 * the form rust-vX.Y.Z count; alpha and beta tags, prereleases and drafts do not.
 * A null `sinceExclusive` returns only the newest.
 */
export function pickCodexReleases(list, sinceExclusive) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || r.draft || r.prerelease) continue;
    const m = /^rust-v(\d+\.\d+\.\d+)$/.exec(String(r.tag_name || ''));
    if (!m) continue;
    if (sinceExclusive != null && cmpVersion(m[1], sinceExclusive) <= 0) continue;
    out.push({ version: m[1], body: String(r.body || '').trim(), url: r.html_url || '' });
  }
  out.sort((a, b) => cmpVersion(b.version, a.version));
  return sinceExclusive == null ? out.slice(0, 1) : out;
}

/** The newest `max` entries of a newest-first list, and how many were left out. */
export function capNewest(list, max = MAX_VERSIONS) {
  return { kept: list.slice(0, max), skipped: Math.max(0, list.length - max) };
}

/**
 * Split text into chunks of at most `limit` characters on paragraph boundaries.
 * A paragraph that alone exceeds the limit is cut at a line break when one sits
 * in the back half of the window, and hard-cut otherwise.
 */
export function chunkText(text, limit = SLACK_CHUNK) {
  const paragraphs = String(text).split(/\n{2,}/).map((p) => p.replace(/\s+$/, '')).filter((p) => p.trim() !== '');
  const chunks = [];
  let cur = '';
  const flush = () => { if (cur) chunks.push(cur); cur = ''; };
  for (const p of paragraphs) {
    if (p.length > limit) {
      flush();
      let rest = p;
      while (rest.length > limit) {
        const nl = rest.lastIndexOf('\n', limit);
        const at = nl > limit / 2 ? nl : limit;
        chunks.push(rest.slice(0, at));
        rest = rest.slice(at).replace(/^\n/, '');
      }
      cur = rest;
      continue;
    }
    if (!cur) cur = p;
    else if (cur.length + 2 + p.length <= limit) cur += `\n\n${p}`;
    else { flush(); cur = p; }
  }
  flush();
  return chunks;
}

/** The prompt for one product: dependency list, release notes, and the answer format. */
export function buildPrompt({ product, versions, contract }) {
  const name = PRODUCTS[product]?.name || product;
  const notes = versions.map((v) => {
    const body = v.body.length > MAX_BODY_CHARS ? `${v.body.slice(0, MAX_BODY_CHARS)}\n(이하 생략)` : v.body;
    return `## ${v.version}\n${body}`;
  }).join('\n\n');
  return [
    `당신은 sprag 유지보수자를 돕는 검토자입니다. 새로 나온 ${name} 릴리스의 변경이 sprag에 주는 영향을 분석해 주십시오.`,
    '',
    `sprag는 ${name}의 설정 파일과 훅 페이로드와 로그 형식에 기대어 동작하는 CLI입니다. sprag가 의존하는 항목은 아래 목록과 같습니다.`,
    '',
    '<의존 목록>',
    String(contract).trim(),
    '</의존 목록>',
    '',
    `<${name} 릴리스 노트>`,
    notes,
    `</${name} 릴리스 노트>`,
    '',
    '작업 방식은 다음과 같습니다.',
    '1. 릴리스 노트의 각 줄이 의존 목록의 항목에 해당하는지 따져 봅니다.',
    '2. 해당한다고 보이면 Read, Grep, Glob으로 저장소를 열어 실제 코드를 확인합니다.',
    '3. 직접 열어 확인하지 않은 파일 경로는 쓰지 않습니다. 경로를 지어내면 안 됩니다.',
    '4. 해당하지 않는 줄은 언급하지 않습니다.',
    '',
    '출력은 한국어 Slack mrkdwn으로 씁니다. 표는 Slack에서 보이지 않으니 쓰지 않습니다. 굵게는 별표 하나로 감싸 씁니다.',
    '',
    '첫 줄은 한 줄 판정입니다. "영향 있음 N건" 또는 "영향 없음"으로 시작합니다.',
    '',
    '영향 있는 변경마다 아래 항목을 채웁니다.',
    '*변경 내용*: 릴리스 노트의 해당 줄을 그대로 인용합니다.',
    '*영향받는 sprag 코드*: 파일:줄 형식으로 씁니다.',
    '*문제 여부*: 깨짐, 동작 변화, 새 기회 중 하나를 고릅니다.',
    '*수정 방향*: 한두 문장으로 씁니다.',
    '*우선순위*: 높음, 보통, 낮음 중 하나를 고릅니다.',
    '',
    'sprag가 새로 활용할 수 있는 변경이 있으면 마지막에 짧은 목록으로 덧붙입니다. 없으면 이 목록은 쓰지 않습니다.',
    '',
    '영향이 없으면 그렇다고 한 줄로 쓰고 끝냅니다.',
  ].join('\n');
}

/** "2.1.319" for one version, "2.1.317 ~ 2.1.319" for several (newest-first input). */
export function versionLabel(versions) {
  if (versions.length === 1) return versions[0].version;
  return `${versions[versions.length - 1].version} ~ ${versions[0].version}`;
}

/** The first non-empty line of the analysis, with Slack bold markers kept as written. */
export function verdictLine(analysis) {
  const line = String(analysis).split('\n').map((l) => l.trim()).find((l) => l !== '');
  return line || '판정을 읽지 못했습니다.';
}

/** The channel message that opens the thread. */
export function buildParentMessage({ product, versions, verdict, skipped = 0, links = [] }) {
  const name = PRODUCTS[product]?.name || product;
  const parts = [`*${name} ${versionLabel(versions)} 출시: sprag 영향 분석*`];
  if (verdict) parts.push(verdict);
  if (skipped > 0) parts.push(`최신 ${versions.length}개만 분석했고 ${skipped}개는 건너뛰었습니다.`);
  if (links.length) parts.push(`릴리스 노트: ${links.join(' ')}`);
  return parts.join('\n');
}

/** KEY=VALUE lines of an env file as an object. Quotes are stripped; comments and blanks are skipped. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
      v = v.slice(1, -1);
    } else {
      v = v.replace(/\s+#.*$/, '');
    }
    out[m[1]] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Price-table check: the two official pricing pages against src/cost.js and src/openai-prices.js.

/** Cells of one Markdown table row, or null when the line is not a row. */
function tableCells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Blocks of consecutive table lines: `{ header, rows }` with every row as a cell array. */
function markdownTables(md) {
  const tables = [];
  let cur = null;
  for (const line of String(md).split('\n')) {
    const cells = tableCells(line);
    if (!cells) { cur = null; continue; }
    if (!cur) { cur = { header: cells, rows: [] }; tables.push(cur); continue; }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    cur.rows.push(cells);
  }
  return tables;
}

/** USD number in a price cell such as `$12.50 / MTok<sup>1</sup>`; null for `-` or no number. */
function priceCell(cell) {
  const m = /\$\s*([\d,]*\.?\d+)/.exec(String(cell ?? '').replace(/<sup>.*?<\/sup>/g, ''));
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** `Claude Opus 5.5` -> `claude-opus-5-5`; `Claude Opus 5` -> `claude-opus-5`. */
function anthropicModelId(name) {
  const m = /^Claude\s+([A-Za-z]+)\s+(\d+(?:\.\d+)?)$/.exec(name);
  if (m) return `claude-${m[1].toLowerCase()}-${m[2].replace(/\./g, '-')}`;
  return name.toLowerCase().replace(/[\s.]+/g, '-');
}

/**
 * Rows of the model table on Anthropic's pricing page (USD per million tokens). The table is the first one
 * whose header starts with `Model` and has a `Base input tokens` column; other tables are ignored.
 */
export function parseAnthropicPricing(md) {
  const table = markdownTables(md).find((t) => /^model$/i.test(t.header[0]) && t.header.some((h) => /base input tokens/i.test(h)));
  if (!table) return [];
  const col = (re) => table.header.findIndex((h) => re.test(h));
  const at = { input: col(/base input/i), cw5m: col(/5m cache/i), cw1h: col(/1h cache/i), cacheRead: col(/cache hits/i), output: col(/output/i) };
  if (Object.values(at).some((i) => i < 0)) return [];
  const rows = [];
  for (const cells of table.rows) {
    const cell = cells[0] || '';
    const name = cell.replace(/\s*\(.*\)\s*$/, '').trim();
    if (!name) continue;
    rows.push({
      name,
      id: anthropicModelId(name),
      long: /over 100,000 tokens/i.test(cell),
      input: priceCell(cells[at.input]),
      cw5m: priceCell(cells[at.cw5m]),
      cw1h: priceCell(cells[at.cw1h]),
      cacheRead: priceCell(cells[at.cacheRead]),
      output: priceCell(cells[at.output]),
    });
  }
  return rows;
}

/**
 * Rows of the two "Standard" tables on OpenAI's pricing page: short-context rates, USD per million tokens.
 * `cacheWrite` is the 30-minute write rate where the page has one.
 */
export function parseOpenAIPricing(md) {
  const text = String(md);
  const start = text.indexOf('### Standard pricing data');
  if (start < 0) return [];
  const after = text.slice(start + 1);
  const next = after.search(/\n###\s/);
  const section = next < 0 ? after : after.slice(0, next);
  const rows = [];
  for (const table of markdownTables(section)) {
    if (!/^model$/i.test(table.header[0])) continue;
    const col = (re) => table.header.findIndex((h) => re.test(h));
    const at = {
      input: col(/^(short context )?input$/i),
      output: col(/^(short context )?output$/i),
      cacheRead: col(/^(short context )?cached input$/i),
      cacheWrite: col(/^short context 30m write$/i),
    };
    if (at.input < 0 || at.output < 0) continue;
    for (const cells of table.rows) {
      const id = (cells[0] || '').replace(/\s*\(.*\)\s*$/, '').trim();
      if (!id) continue;
      rows.push({
        id,
        input: priceCell(cells[at.input]),
        cacheRead: at.cacheRead < 0 ? null : priceCell(cells[at.cacheRead]),
        cacheWrite: at.cacheWrite < 0 ? null : priceCell(cells[at.cacheWrite]),
        output: priceCell(cells[at.output]),
      });
    }
  }
  return rows;
}

const samePrice = (a, b) => (a === null || a === undefined || b === null || b === undefined ? (a ?? null) === (b ?? null) : Math.abs(a - b) <= PRICE_EPSILON);

const ANTHROPIC_FIELDS = [['input', 'input'], ['cw5m', 'cacheWrite5m'], ['cw1h', 'cacheWrite1h'], ['cacheRead', 'cacheRead'], ['output', 'output']];

/** Page rows that differ from the rate card sprag applies at `at`: `{ kind: 'price', id, field, table, page, tier }`. */
export function diffAnthropicPrices(rows, { at } = {}) {
  const findings = [];
  for (const row of rows) {
    const tier = row.long ? 'claude-haiku-5-5-long' : detectPricingTier(row.id, { at });
    const card = ratesAt(tier, at);
    if (!card) continue;
    for (const [pageField, tableField] of ANTHROPIC_FIELDS) {
      if (!samePrice(card[tableField], row[pageField])) {
        findings.push({ kind: 'price', id: row.id, field: tableField, table: card[tableField], page: row[pageField], tier });
      }
    }
  }
  return findings;
}

const OPENAI_FIELDS = ['input', 'cacheRead', 'cacheWrite', 'output'];

// sprag's OpenAI table prices Codex calls only, so only the GPT-5 and GPT-6
// families count as missing; gpt-4.x, gpt-4o and o-series rows on the page
// are not models Codex runs.
const CODEX_FAMILY_RE = /^gpt-[56](?:\.\d+)?(?:-[a-z]+)?$/;

/** Price differences for models in both lists, and `{ kind: 'missing', id, page }` for Codex-family page models sprag lacks. */
export function diffOpenAIPrices(rows, table = PER_MILLION) {
  const findings = [];
  for (const row of rows) {
    const known = table[row.id];
    if (!known) {
      if (!CODEX_FAMILY_RE.test(row.id)) continue;
      findings.push({ kind: 'missing', id: row.id, page: { input: row.input, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, output: row.output } });
      continue;
    }
    OPENAI_FIELDS.forEach((field, i) => {
      if (!samePrice(known[i], row[field])) findings.push({ kind: 'price', id: row.id, field, table: known[i] ?? null, page: row[field] });
    });
  }
  return findings;
}

/** Names that were not in the previous run's `seen` list. The first run (no `seen`) reports nothing. */
export function newModels(names, seen) {
  if (!Array.isArray(seen)) return [];
  const known = new Set(seen);
  return [...new Set(names)].filter((n) => !known.has(n));
}

/** Stable hash of a findings list: the order of findings does not matter. */
export function findingsDigest(findings) {
  const sorted = findings.map((f) => JSON.stringify(f)).sort();
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

const FIELD_LABEL = {
  input: '입력', output: '출력', cacheRead: '캐시 읽기', cacheWrite: '캐시 쓰기',
  cacheWrite5m: '캐시 쓰기 5분', cacheWrite1h: '캐시 쓰기 1시간',
};

function usd(n) {
  if (n === null || n === undefined) return '없음';
  const s = String(n);
  const decimals = s.includes('.') ? s.split('.')[1].length : 0;
  return `$${decimals < 2 ? n.toFixed(2) : s}`;
}

function priceLine(f) {
  const longNote = f.tier && f.tier.endsWith('-long') ? ' (100k 초과)' : '';
  return `• ${f.id}${longNote} ${FIELD_LABEL[f.field] || f.field}: sprag ${usd(f.table)}, 공식 ${usd(f.page)}`;
}

function missingLine(f) {
  const p = f.page || {};
  return `• ${f.id}: 입력 ${usd(p.input)}, 출력 ${usd(p.output)}`;
}

function fetchLine(f) {
  return `• ${f.source === 'openai' ? 'OpenAI' : 'Anthropic'} 가격 페이지를 읽지 못했습니다: ${f.reason}`;
}

/** Slack mrkdwn (Korean) for the daily price-table check. Empty sections are left out. */
export function buildPricingMessage({ anthropic = [], openai = [], newAnthropic = [], newOpenAI = [], date }) {
  const all = [...anthropic, ...openai];
  const fresh = [...newAnthropic, ...newOpenAI];
  const lines = [`*가격표 점검 (${date}): 차이 ${all.length + fresh.length}건*`];
  const section = (title, items) => { if (items.length) lines.push('', `*${title}*`, ...items); };
  section('Anthropic 가격 차이', anthropic.filter((f) => f.kind === 'price').map(priceLine));
  section('OpenAI 가격 차이', openai.filter((f) => f.kind === 'price').map(priceLine));
  section('sprag 표에 없는 OpenAI 모델', openai.filter((f) => f.kind === 'missing').map(missingLine));
  section('가격 페이지 확인 실패', all.filter((f) => f.kind === 'fetch').map(fetchLine));
  section('새로 올라온 모델', fresh.map((n) => `• ${n}`));
  const howTo = [];
  if (newAnthropic.length) {
    howTo.push('새 Anthropic 모델은 src/cost.js 에서 별칭 이력(ALIAS_HISTORY)과 가격 등급에 출시일 행이 필요한지 확인합니다.');
  }
  if (anthropic.some((f) => f.kind === 'price')) {
    howTo.push(`Anthropic 차이는 src/cost.js 의 PRICE_HISTORY 에서 해당 등급에 from: '${date}' 행을 새로 더해 고칩니다. 기존 행은 과거 실행의 가격이므로 고치지 않습니다.`);
  }
  if (openai.some((f) => f.kind === 'price' || f.kind === 'missing')) {
    howTo.push('OpenAI 차이는 src/openai-prices.js 의 표를 고치고 확인 날짜(OPENAI_PRICES_CHECKED_AT)도 오늘로 바꿉니다.');
  }
  if (howTo.length) lines.push('', ...howTo);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Everything below touches the network, the disk or a child process.

function stateFile() {
  const base = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(base, 'sprag-upstream-watch', 'state.json');
}

function readState() {
  try { return JSON.parse(readFileSync(stateFile(), 'utf8')); } catch { return {}; }
}

function writeState(state) {
  const file = stateFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

function parseArgs(argv) {
  const opts = { dryRun: false, noLlm: false, only: null, since: null, sinceCodex: null, envFile: null };
  const value = (i, flag) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-llm') { opts.noLlm = true; opts.dryRun = true; }
    else if (a === '--only') { opts.only = value(i, a); i++; if (!PRODUCTS[opts.only]) throw new Error('--only takes claude, codex or pricing'); }
    else if (a === '--since') { opts.since = value(i, a); i++; }
    else if (a === '--since-codex') { opts.sinceCodex = value(i, a); i++; }
    else if (a === '--env-file') { opts.envFile = value(i, a); i++; }
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  return res.text();
}

async function gatherClaude(since) {
  const r = spawnSync('npm', ['view', '@anthropic-ai/claude-code', 'version'], { encoding: 'utf8', timeout: 30_000 });
  const latest = (r.stdout || '').trim();
  if (r.status !== 0 || !/^\d+\.\d+\.\d+$/.test(latest)) throw new Error(`npm view failed: ${(r.stderr || '').trim().slice(0, 200)}`);
  if (since != null && cmpVersion(latest, since) <= 0) return { versions: [], skipped: 0, links: [], latest };
  const md = await fetchText(CLAUDE_CHANGELOG_URL);
  const found = sliceClaudeChangelog(md, since, latest);
  const { kept, skipped } = capNewest(found);
  return { versions: kept, skipped, links: [`<${CLAUDE_CHANGELOG_PAGE}|CHANGELOG>`], latest };
}

function gatherCodex(since) {
  const r = spawnSync('gh', ['api', 'repos/openai/codex/releases?per_page=30'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`gh api failed: ${(r.stderr || '').trim().slice(0, 200)}`);
  let list;
  try { list = JSON.parse(r.stdout); } catch { throw new Error('gh api returned something that is not JSON'); }
  const found = pickCodexReleases(list, since);
  const { kept, skipped } = capNewest(found);
  return { versions: kept, skipped, links: kept.map((v) => `<${v.url}|${v.version}>`) };
}

function analyze(prompt) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const r = spawnSync('claude', ['-p', '--model', 'sonnet', '--allowedTools', 'Read Grep Glob'], {
    cwd: ROOT, env, input: prompt, encoding: 'utf8', timeout: LLM_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024,
  });
  if (r.error) throw new Error(`claude -p failed to run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`claude -p exited ${r.status}: ${(r.stderr || '').trim().slice(0, 300)}`);
  const out = (r.stdout || '').trim();
  if (!out) throw new Error('claude -p returned no text');
  return out;
}

export function slackConfig(envFile) {
  const file = envFile ? resolve(envFile) : resolve(ROOT, '..', 'yaml-sns-agent', '.env');
  let fromFile = {};
  if (existsSync(file)) {
    try { fromFile = parseEnvFile(readFileSync(file, 'utf8')); } catch { /* unreadable file counts as absent */ }
  }
  const token = process.env.SLACK_BOT_TOKEN || fromFile.SLACK_BOT_TOKEN;
  const channel = process.env.SPRAG_SLACK_CHANNEL_ID || fromFile.SPRAG_SLACK_CHANNEL_ID;
  const missing = [!token && 'SLACK_BOT_TOKEN', !channel && 'SPRAG_SLACK_CHANNEL_ID'].filter(Boolean);
  if (missing.length) throw new Error(`missing ${missing.join(' and ')} (looked in the environment and ${file})`);
  return { token, channel };
}

export async function slackPost({ token, channel }, text, threadTs) {
  const body = { channel, text, unfurl_links: false, unfurl_media: false };
  if (threadTs) body.thread_ts = threadTs;
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Slack rejected the post: ${json.error || `HTTP ${res.status}`}`);
  return json.ts;
}

function printExcerpts(product, versions) {
  for (const v of versions) {
    console.log(`## ${PRODUCTS[product].name} ${v.version}`);
    console.log(v.body || '(empty release body)');
    console.log('');
  }
}

async function runProduct(product, opts, state, contract, slack) {
  const name = PRODUCTS[product].name;
  const since = (product === 'claude' ? opts.since : opts.sinceCodex) ?? state[product] ?? null;
  const found = product === 'claude' ? await gatherClaude(since) : gatherCodex(since);
  if (!found.versions.length) {
    console.log(`${name}: no new versions${since ? ` since ${since}` : ''}`);
    return { ok: true };
  }
  const { versions, skipped, links } = found;
  console.log(`${name}: ${versions.length} new version(s) ${versionLabel(versions)}${skipped ? `, ${skipped} older skipped` : ''}`);

  if (opts.noLlm) {
    printExcerpts(product, versions);
    return { ok: true };
  }

  const analysis = analyze(buildPrompt({ product, versions, contract }));
  const parent = buildParentMessage({ product, versions, verdict: verdictLine(analysis), skipped, links });
  const chunks = chunkText(analysis, SLACK_CHUNK);

  if (opts.dryRun) {
    console.log('--- parent message ---');
    console.log(parent);
    chunks.forEach((c, i) => { console.log(`--- thread reply ${i + 1}/${chunks.length} ---`); console.log(c); });
    return { ok: true };
  }

  const ts = await slackPost(slack, parent);
  for (const c of chunks) await slackPost(slack, c, ts);
  writeState({ ...state, [product]: versions[0].version });
  state[product] = versions[0].version;
  console.log(`${name}: posted ${versionLabel(versions)} (${chunks.length} reply message(s))`);
  return { ok: true };
}

/** One official page, parsed. A failed fetch or a parse with no rows becomes a `fetch` finding, never "no differences". */
async function loadPricingPage(source, url, parse) {
  try {
    const rows = parse(await fetchText(url));
    if (!rows.length) throw new Error('the page parsed to zero model rows');
    return { rows, finding: null };
  } catch (e) {
    return { rows: null, finding: { kind: 'fetch', source, page: url, reason: e.message } };
  }
}

async function runPricing(opts, state, getSlack) {
  const date = new Date().toISOString().slice(0, 10);
  const [a, o] = await Promise.all([
    loadPricingPage('anthropic', ANTHROPIC_PRICING_URL, parseAnthropicPricing),
    loadPricingPage('openai', OPENAI_PRICING_URL, parseOpenAIPricing),
  ]);
  const anthropic = a.rows ? diffAnthropicPrices(a.rows, { at: Date.now() }) : [a.finding];
  const openai = o.rows ? diffOpenAIPrices(o.rows) : [o.finding];
  const prev = state.pricing || {};
  const anthropicNames = a.rows ? [...new Set(a.rows.map((r) => r.name))] : null;
  const openaiIds = o.rows ? o.rows.map((r) => r.id) : null;
  const newAnthropic = anthropicNames ? newModels(anthropicNames, prev.seenAnthropic) : [];
  const newOpenAI = openaiIds ? newModels(openaiIds, prev.seenOpenAI) : [];
  // A new model counts as a finding even when its prices match: its alias
  // history and table row still need a look, and without this it would be
  // folded into `seen` silently.
  const findings = [...anthropic, ...openai, ...[...newAnthropic, ...newOpenAI].map((id) => ({ kind: 'new', id }))];
  const digest = findingsDigest(findings);
  const message = buildPricingMessage({ anthropic, openai, newAnthropic, newOpenAI, date });
  // A page that failed to load keeps its previous seen list, so its models are not forgotten.
  const nextState = () => ({
    ...state,
    pricing: {
      seenAnthropic: anthropicNames ?? prev.seenAnthropic ?? [],
      seenOpenAI: openaiIds ?? prev.seenOpenAI ?? [],
      lastDigest: digest,
    },
  });

  console.log(`Pricing: ${findings.length} finding(s), ${newAnthropic.length + newOpenAI.length} new model(s)`);
  if (opts.dryRun) {
    if (findings.length) { console.log('--- message ---'); console.log(message); }
    return { ok: true };
  }
  if (!findings.length) {
    writeState(nextState());
    Object.assign(state, nextState());
    return { ok: true };
  }
  if (digest === prev.lastDigest) {
    console.log('Pricing: same findings as the last post, not posting again');
    return { ok: true };
  }
  const slack = getSlack();
  const chunks = chunkText(message, SLACK_CHUNK);
  const ts = await slackPost(slack, chunks[0]);
  for (const c of chunks.slice(1)) await slackPost(slack, c, ts);
  writeState(nextState());
  Object.assign(state, nextState());
  console.log(`Pricing: posted ${findings.length} finding(s)`);
  return { ok: true };
}

async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error(`upstream-watch: ${e.message}`); return 1; }
  const state = readState();
  let contract = '';
  let slack = null;
  const products = opts.only ? [opts.only] : ['claude', 'codex', 'pricing'];
  const llmProducts = products.filter((p) => p !== 'pricing');
  try {
    if (!opts.noLlm && llmProducts.length) contract = readFileSync(CONTRACT_PATH, 'utf8');
    // The pricing check needs the Slack token only when it has something to post, so it loads it lazily.
    if (!opts.dryRun && llmProducts.length) slack = slackConfig(opts.envFile);
  } catch (e) { console.error(`upstream-watch: ${e.message}`); return 1; }

  let failed = false;
  for (const product of products) {
    try {
      if (product === 'pricing') await runPricing(opts, state, () => slack || slackConfig(opts.envFile));
      else await runProduct(product, opts, state, contract, slack);
    } catch (e) {
      failed = true;
      console.error(`upstream-watch: ${PRODUCTS[product].name}: ${e.message}`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
