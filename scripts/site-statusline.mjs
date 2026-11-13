#!/usr/bin/env node
/**
 * site-statusline: regenerate the statusline samples on the public home page
 * (site/index.html) from the REAL formatter, so the page cannot drift from what
 * the product prints.
 *
 * It calls formatReport() with a fixed, made-up session (virtual organization,
 * no real addresses), converts the ANSI colors to <span class="sl-c-...">, and
 * writes the result between marker comments in site/index.html:
 *
 *   <!-- statusline-sample:hero:start --> ... <!-- statusline-sample:hero:end -->
 *   <!-- statusline-sample:demo:start --> ... <!-- statusline-sample:demo:end -->
 *
 * Both places get the same block: an English <pre class="sl-out sl-en"> and a
 * Korean <pre class="sl-out sl-ko"> (only the team line differs), and the page
 * CSS shows the one that matches <html lang>.
 *
 * Deterministic: the clock is pinned (global Date), the timezone is UTC and HOME
 * points at an empty directory, so the user's own config, theme and Claude
 * settings cannot leak into the sample. Running it twice changes nothing.
 *
 * Usage:  node scripts/site-statusline.mjs          # rewrite site/index.html
 *         node scripts/site-statusline.mjs --print  # plain text of both samples, no write
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = join(repoRoot, 'site', 'index.html');

// ---- pin the environment BEFORE the formatter is imported (it reads these at load) ----
Object.assign(process.env, { TZ: 'UTC' }); // an assignment, not a read of the ambient value
process.env.COLORTERM = 'truecolor';
process.env.HOME = mkdtempSync(join(tmpdir(), 'sprag-site-sl-'));
process.env.USERPROFILE = process.env.HOME;
// The harness chip reads the project around the working directory; an empty one draws nothing.
process.chdir(mkdtempSync(join(tmpdir(), 'sprag-site-sl-cwd-')));
delete process.env.NO_COLOR;
delete process.env.CLAUDE_CONFIG_DIR;
// The compact-window chip warns about the machine's own setting, not about the product.
process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '500000';

// Thu 2026-11-12 14:00 UTC. formatResetClock() builds `new Date()`, which does not
// go through Date.now(), so the Date constructor itself is pinned.
const NOW = Date.UTC(2026, 10, 12, 14, 0, 0);
const RealDate = Date;
class PinnedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(NOW);
    else super(...args);
  }
  static now() { return NOW; }
}
globalThis.Date = PinnedDate;

const { formatReport } = await import('../src/formatters/statusline.js');

// ---- the sample session (everything here is invented) ----
const sec = (ms) => Math.floor(ms / 1000);
const SINCE = RealDate.UTC(2026, 9, 17, 12, 0, 0); // 10/17

const sampleData = (lang) => ({
  summary: { hitRate: 0.988 },
  ttl: { total: 100, pct1h: 1 },
  cost: { savings: 1520 },
  options: { days: 7, windowLabel: '7d', version: '3.124.0' },
  lastActivity: NOW - 48_000, // 59:12 left on a 1h cache entry
  update: { available: false, latest: '3.124.0', checkedAt: NOW - 5 * 60_000 },
  contextWindow: { size: '1M', overWarn: false },
  ctxLive: { usedPct: 18, size: 1_000_000 },
  model: 'claude-opus-5-5',
  effort: 'high',
  caps: {
    windows: [
      { key: 'five_hour', usedPct: 62, resetsAt: sec(NOW) + 2 * 3600 + 33 * 60 }, // 16:33
      { key: 'seven_day', usedPct: 38, resetsAt: sec(RealDate.UTC(2026, 10, 17, 19, 0, 0)) }, // Tue 19:00
    ],
  },
  monthSpend: { usd: 412.8, label: 'Nov', unpriced: 0 },
  delegationSaved: 136.02,
  delegationTotals: {
    week: 0, month: 0, total: 136.02, spent: 0, spentMissing: 0, since: SINCE,
    pairs: [
      { from: 'opus', to: 'sonnet', runs: 52, usd: 88.4 },
      { from: 'fable', to: 'haiku', runs: 18, usd: 31.2 },
      { from: 'opus', to: 'haiku', runs: 9, usd: 11.1 },
      { from: 'fable', to: 'sonnet', runs: 4, usd: 5.32 },
    ],
  },
  doc2mdTotals: {
    total: 4.03, docs: 3, since: SINCE,
    byExt: [{ ext: 'pptx', docs: 1, usd: 3.1 }, { ext: 'pdf', docs: 2, usd: 0.93 }],
  },
  team: {
    label: 'member-1a2b3c4d', org: 'northwind', team: 'Platform', plan: 'pro', lang,
    standing: {
      grade: 'fox', fetchedAt: NOW, rank: 3, ranked: 12, teamRank: 1, teamRanked: 4,
      scorePct: 0.75, next: { grade: 'cheetah', pass: 2, needDlg: false }, spendRank: 2, dlgRank: 5,
    },
  },
});

const render = (lang, color) => formatReport(sampleData(lang), {
  color, mode: 'icon', verbose: true, columns: 160, maxLines: 4,
});

// ---- ANSI -> HTML ----
// The sample is truecolor, so each tone is an exact RGB. Known tones become classes
// (the page CSS maps them to colors that keep 4.5:1 on the dark panel); anything
// else falls back to an inline rgb() so no color is ever lost.
const TONES = {
  '251,113,133': 'red', '52,211,153': 'green', '251,191,36': 'yellow', '251,146,60': 'orange',
  '34,211,238': 'cyan', '167,139,250': 'violet', '100,116,139': 'gray', '177,185,249': 'blue',
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ansiToHtml(text) {
  let out = '';
  let fg = null; // class name or { rgb }
  let bold = false;
  let last = 0;
  const open = () => {
    if (!fg && !bold) return '';
    const cls = [bold ? 'sl-b' : '', typeof fg === 'string' ? `sl-c-${fg}` : ''].filter(Boolean).join(' ');
    const style = fg && typeof fg === 'object' ? ` style="color:rgb(${fg.rgb})"` : '';
    return `<span class="${cls}"${style}>`;
  };
  let isOpen = false;
  const close = () => { if (isOpen) { out += '</span>'; isOpen = false; } };
  const text_ = (s) => {
    if (!s) return;
    const h = open();
    if (h) { out += h; isOpen = true; }
    out += esc(s);
    close();
  };
  const re = /\x1b\[([0-9;]*)([A-Za-z])/g;
  let m;
  while ((m = re.exec(text))) {
    text_(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] !== 'm') continue; // \x1b[K and friends are dropped
    const p = m[1];
    if (p === '' || p === '0') { fg = null; bold = false; }
    else if (p === '1') bold = true;
    else if (p.startsWith('38;2;')) {
      const rgb = p.slice(5).replace(/;/g, ',');
      fg = TONES[rgb] || { rgb };
    }
  }
  text_(text.slice(last));
  return out;
}

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

const samples = {};
for (const lang of ['en', 'ko']) {
  const colored = render(lang, true).replace(/\n$/, '');
  const plain = strip(render(lang, false)).replace(/\n$/, '');
  // Nothing may be folded away: a `+N` chip means columns/maxLines are too small.
  if (/ \+\d+(?!\S)/.test(plain.split('\n').pop())) {
    throw new Error(`the ${lang} sample folded chips into "+N": raise columns or maxLines`);
  }
  samples[lang] = { plain, html: ansiToHtml(colored) };
}

if (process.argv.includes('--print')) {
  for (const lang of ['en', 'ko']) process.stdout.write(`--- ${lang}\n${samples[lang].plain}\n`);
  process.exit(0);
}

const block = ['en', 'ko']
  .map((lang) => `<pre class="sl-out sl-${lang}" lang="${lang}">${samples[lang].html}</pre>`)
  .join('\n');

// ---- write between the markers ----
let page = readFileSync(pagePath, 'utf8');
for (const name of ['hero', 'demo']) {
  const start = `<!-- statusline-sample:${name}:start -->`;
  const end = `<!-- statusline-sample:${name}:end -->`;
  const a = page.indexOf(start);
  const b = page.indexOf(end);
  if (a < 0 || b < a) throw new Error(`markers for "${name}" not found in site/index.html`);
  page = page.slice(0, a + start.length) + '\n' + block + '\n' + page.slice(b);
}
writeFileSync(pagePath, page);
process.stdout.write(`site/index.html updated (en ${samples.en.plain.split('\n').length} lines, ko ${samples.ko.plain.split('\n').length} lines)\n`);
