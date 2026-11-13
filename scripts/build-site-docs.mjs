#!/usr/bin/env node
// Generates static documentation pages under site/docs/ from docs/*.md, plus
// the doc-index pages and site/sitemap.xml. See docs/ + site/index.html for
// the source of truth on look and content; this script only reads/writes.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, toPlainText } from './lib/markdown.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const SITE_DIR = path.join(ROOT, 'site');
const REPO = 'https://github.com/rootstudioyaml/sprag';
const SITE_ORIGIN = 'https://sprag.io';

const MANIFEST = [
  {
    slug: 'codex',
    src: 'CODEX.md',
    title: 'Codex: hooks, ratchet rules, model delegation, and a companion panel',
    description: 'Install Sprag for Codex, connect native hooks and AGENTS.md, inspect local token usage, discover recurring work, and track attributed routing estimates with provider prices.',
    keywords: ['codex harness', 'codex hooks', 'codex statusline', 'codex companion panel', 'codex agents.md', 'codex model delegation'],
  },
  {
    slug: 'statusline',
    src: 'STATUSLINE.md',
    title: 'Claude Code statusline: cache hit rate, cache TTL countdown, 5-hour and 7-day rate limits',
    description:
      'Reference for the Sprag statusline for Claude Code: prompt cache hit rate, cache expiry countdown, context usage, 5-hour and 7-day rate-limit windows, monthly spend, and the warning chips that lead the line when something is wrong.',
    keywords: [
      'claude code statusline',
      'claude code statusline cache',
      'claude code cache hit rate',
      'claude code prompt cache ttl',
      'claude code rate limit 5 hour 7 day',
      'claude code context usage',
    ],
  },
  {
    slug: 'not-a-router',
    src: 'NOT-A-ROUTER.md',
    title: 'Why realtime model routing can cost more in Claude Code',
    description:
      "Prompt caches are kept per model, so switching Claude Code to a cheaper model mid-session starts from a cold cache and re-reads the whole conversation at full price. Sprag delegates to subagents instead and leaves the main session's cache intact.",
    keywords: [
      'claude code model routing',
      'claude code prompt cache per model',
      'claude code switch model cost',
      'llm router cache miss',
      'claude code delegate to haiku',
    ],
  },
  {
    slug: 'route-scan',
    src: 'ROUTE_SCAN.md',
    title: 'Delegate repeat Claude Code work to Haiku and Sonnet subagents with route-scan',
    description:
      'sprag route-scan reads your Claude Code session logs after the fact, finds request types an expensive model handled repeatedly, and writes delegation rules that send that work to cheaper subagents. Savings are recorded per run as a ledger, not an estimate.',
    keywords: [
      'claude code token saver',
      'claude code cheaper model',
      'claude code haiku subagent',
      'claude code delegation rules',
      'reduce claude code cost',
    ],
  },
  {
    slug: 'harness',
    src: 'HARNESS.md',
    title: 'Claude Code harness: ratchet rules, evidence-gated completion, Plan-Execute-Verify',
    description:
      'The Sprag harness for Claude Code turns repeated failures into rules that load every session, blocks "all done" reports with no evidence attached, and enforces a Plan, Execute, Verify cycle on multi-step work.',
    keywords: [
      'claude code harness',
      'claude code ratchet rules',
      'claude code claude.md rules',
      'claude code evidence',
      'plan execute verify',
    ],
  },
  {
    slug: 'doc2md',
    src: 'DOC2MD.md',
    title: 'Convert pptx, xlsx, pdf, docx and fig to Markdown before Claude Code reads them',
    description:
      'sprag doc2md converts PowerPoint, Excel, PDF, Word and Figma files to Markdown so Claude Code reads a compact text version instead of a raw attachment. One 510k-token deck became a few thousand tokens.',
    keywords: [
      'convert pptx to markdown claude',
      'pdf to markdown claude code',
      'xlsx to markdown',
      'docx to markdown cli',
      'claude code attach document tokens',
    ],
  },
  {
    slug: 'gateways',
    src: 'GATEWAYS.md',
    title: 'Claude Code statusline behind LiteLLM and other gateways',
    description:
      'How the Sprag statusline reads spend, budgets and cache TTL when Claude Code runs through LiteLLM or another API gateway, and why the cache countdown can look frozen.',
    keywords: ['claude code litellm', 'claude code gateway statusline', 'litellm budget claude code', 'claude code cache ttl frozen'],
  },
  {
    slug: 'install',
    src: 'INSTALL.md',
    title: 'Install Sprag for Claude Code and Codex',
    description:
      'Choose the Claude Code or Codex integration, register the appropriate harness and hooks, and verify the setup.',
    keywords: ['install claude code token saver', 'sprag install', 'claude code statusline setup', 'npm sprag-cli'],
  },
  {
    slug: 'commands',
    src: 'COMMANDS.md',
    title: 'Sprag command reference',
    description: 'Every sprag command in one page: route-scan, harness, doc2md, handoff, mode, stats and the statusline switches.',
    keywords: ['sprag commands', 'sprag cli reference', 'claude-token-saver commands'],
  },
  {
    slug: 'team',
    src: 'TEAM.md',
    // Built and reachable by URL, but kept out of the docs index, the "more
    // docs" lists and the sitemap (noindex) until the team plan launches, like
    // site/team/ and site/pricing/.
    hidden: true,
    title: 'Sprag team layer: shared spend, savings and rules',
    description:
      'The opt-in team layer: what each member uploads (daily aggregates only), how an organization enrolls with one environment variable, and how team-approved rules reach every session.',
    keywords: ['claude code team spend', 'sprag team', 'claude code team dashboard', 'team token usage claude code'],
  },
  {
    slug: 'data',
    src: 'DATA.md',
    title: 'What Sprag sends: open source, Pro and Enterprise',
    description:
      'Plan by plan, what Sprag uploads to its server: nothing on the free CLI, daily numeric totals on Pro, and opt-in masked prompt capture on Enterprise.',
    keywords: ['sprag privacy', 'sprag telemetry', 'sprag data collection', 'claude code tool privacy', 'what does sprag send'],
  },
  {
    slug: 'korean-style',
    src: 'KOREAN-STYLE.md',
    title: 'Korean writing style gate for Claude Code output',
    description: 'Sprag lints Korean text at write time: double passives, translationese, cohesion between sentences.',
    keywords: ['claude code korean', 'korean style lint', '한국어 번역투 검사'],
  },
  {
    slug: 'reduce-claude-code-tokens',
    src: 'GUIDE-REDUCE-TOKENS.md',
    title: 'How to reduce Claude Code token usage',
    description:
      'Compact and clear at the right time, push exploration into a subagent, convert large documents to Markdown first, and stay inside the prompt cache TTL. Then see how Sprag automates each step.',
    keywords: [
      'reduce claude code token usage',
      'claude code tokens too expensive',
      'claude code haiku subagent',
      'claude code save tokens',
    ],
  },
  {
    slug: 'claude-code-usage-limits',
    src: 'GUIDE-USAGE-LIMITS.md',
    title: 'Claude Code 5-hour and weekly usage limits, explained',
    description:
      'Claude Code enforces two independent rolling windows, roughly 5 hours and 7 days, each with its own reset. How to watch both before you hit them and reduce per-turn cost so a window lasts longer.',
    keywords: [
      'claude code 5 hour limit',
      'claude code weekly limit',
      'claude code rate limit reached',
      'claude code usage limit',
    ],
  },
  {
    slug: 'codex-token-usage',
    src: 'GUIDE-CODEX-TOKENS.md',
    title: 'How to reduce Codex CLI token usage',
    description:
      'Scope sessions, delegate bounded work to a cheaper model through native spawn_agent calls, and convert large documents before they enter context. What Sprag adds for Codex on top of that.',
    keywords: [
      'codex cli token usage',
      'reduce codex tokens',
      'codex subagent cheaper model',
      'codex cli cost',
    ],
  },
  {
    slug: 'compare',
    src: 'COMPARE.md',
    title: 'Sprag vs ccusage, claude-usage, and statusline tools',
    description:
      'ccusage, claude-usage and CCometixLine report what Claude Code already spent. Sprag reports it too, and also writes delegation rules that route repeat work to a cheaper subagent. Where each tool fits, and where they can run together.',
    keywords: [
      'ccusage alternative',
      'claude code cost tracker',
      'claude usage dashboard alternative',
      'claude code statusline comparison',
    ],
  },
];

const srcBasenameToSlug = new Map(MANIFEST.map((e) => [e.src, e.slug]));

function gitDate(relPath) {
  try {
    const out = execSync(`git log -1 --format=%cI -- ${JSON.stringify(relPath)}`, {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    if (out) return out;
  } catch {
    /* fall through to today */
  }
  return new Date().toISOString();
}

function readDoc(relPath) {
  return fs.readFileSync(path.join(DOCS_DIR, relPath), 'utf8');
}

function docExists(relPath) {
  return fs.existsSync(path.join(DOCS_DIR, relPath));
}

// Drop the leading H1 (rendered separately as the page's own <h1>) and the
// "[← README] · [...]" nav line the docs use for cross-linking.
function preprocessSource(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  if (/^#\s+/.test(lines[0] || '')) lines.shift();
  for (let i = 0; i < lines.length && i < 6; i++) {
    if (/^\[←\s*README\]/.test((lines[i] || '').trim())) {
      lines.splice(i, 1);
      break;
    }
  }
  return lines.join('\n');
}

function truncateAtWord(str, max) {
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const idx = cut.lastIndexOf(' ');
  return `${(idx > 0 ? cut.slice(0, idx) : cut).trim()}…`;
}

// KO title = first H1 text. KO description = first paragraph after the H1
// that isn't the nav line, headings, code fences, lists, quotes or tables.
function extractKoMeta(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let title = '';
  while (i < lines.length) {
    const m = /^#\s+(.+)$/.exec(lines[i]);
    if (m) {
      title = m[1].trim();
      i++;
      break;
    }
    i++;
  }
  let description = '';
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') {
      i++;
      continue;
    }
    if (/^\[←\s*README\]/.test(trimmed)) {
      i++;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) i++;
      i++;
      continue;
    }
    if (/^[-*]\s|^\d+\.\s|^>|^\|/.test(line)) {
      i++;
      continue;
    }
    const pLines = [trimmed];
    i++;
    while (i < lines.length && lines[i].trim() !== '') {
      pLines.push(lines[i].trim());
      i++;
    }
    description = pLines.join(' ');
    break;
  }
  description = toPlainText(description);
  description = truncateAtWord(description, 155);
  return { title, description };
}

function makeLinkRewriter() {
  return function link(url) {
    if (/^https?:\/\//.test(url) || url.startsWith('mailto:') || url.startsWith('#')) return url;
    const hashIdx = url.indexOf('#');
    const p = hashIdx === -1 ? url : url.slice(0, hashIdx);
    const hash = hashIdx === -1 ? '' : url.slice(hashIdx);

    if (p === '../README.md') return `${REPO}#readme${hash}`;
    if (p === '../README.ko.md') return `${REPO}/blob/main/README.ko.md${hash}`;
    if (p === '../CHANGELOG.md') return `${REPO}/blob/main/CHANGELOG.md${hash}`;
    if (p.startsWith('../')) return `${REPO}/blob/main/${p.slice(3)}${hash}`;

    let m = /^(?:\.\/)?([^/]+)\.ko\.md$/.exec(p);
    if (m) {
      const enBase = `${m[1]}.md`;
      const slug = srcBasenameToSlug.get(enBase);
      if (slug) return `/docs/ko/${slug}/${hash}`;
      return `${REPO}/blob/main/docs/${m[1]}.ko.md${hash}`;
    }

    m = /^(?:\.\/)?([^/]+)\.md$/.exec(p);
    if (m) {
      const base = `${m[1]}.md`;
      const slug = srcBasenameToSlug.get(base);
      if (slug) return `/docs/${slug}/${hash}`;
      return `${REPO}/blob/main/docs/${base}${hash}`;
    }

    if (!p.startsWith('/')) {
      const clean = p.replace(/^\.\//, '');
      return `https://raw.githubusercontent.com/rootstudioyaml/sprag/main/docs/${clean}${hash}`;
    }
    return url;
  };
}

const FAVICON_LINKS = `<link rel="icon" href="/assets/logo/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/assets/logo/favicon-32.png" sizes="32x32" type="image/png" />
<link rel="icon" href="/assets/logo/favicon-16.png" sizes="16x16" type="image/png" />
<link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png" />`;

// Fonts come from tokens.css (@import), so the page only preconnects. The inline snippet applies the
// saved light/dark choice before first paint, same key as assets/theme-toggle.js.
const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<script>try{var t=localStorage.getItem('sprag-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="/assets/tokens.css" />
<link rel="stylesheet" href="/assets/site-header.css?v=4" />`;

const BRAND_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true">
        <path fill="currentColor" fill-rule="evenodd" d="M3 32a29 29 0 1 0 58 0a29 29 0 1 0 -58 0ZM9 32a23 23 0 1 0 46 0a23 23 0 1 0 -46 0ZM21.5 32a10.5 10.5 0 1 0 21 0a10.5 10.5 0 1 0 -21 0ZM25.5 32a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0Z"/>
        <path fill="currentColor" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round" d="M25.54 13.8L32.46 9.8L38.46 20.2L31.54 24.2ZM50.99 35.5L50.99 43.5L38.99 43.5L38.99 35.5ZM19.47 46.7L12.55 42.7L18.55 32.3L25.47 36.3Z"/>
        <path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M12.74 24.99A20.5 20.5 0 0 1 24.99 12.74M47.7 18.82A20.5 20.5 0 0 1 52.19 35.56M35.56 52.19A20.5 20.5 0 0 1 18.82 47.7"/>
      </svg>`;

const GH_ICONS = `<a class="gh ic" href="${REPO}" aria-label="GitHub" title="GitHub">
        <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
      </a>
      <a class="gh ic npmic" href="https://www.npmjs.com/package/sprag-cli" aria-label="npm" title="npm">
        <svg viewBox="0 0 18 7" width="26" height="10" aria-hidden="true"><path fill="currentColor" d="M0 0h18v6H9v1H5V6H0Zm1 5h2V2h1v3h1V1H1Zm5-4v5h2V5h2V1Zm2 1h1v2H8Zm3-1v4h2V2h1v3h1V2h1v3h1V1Z"/></svg>
      </a>`;

function styleBlock() {
  // Colors, fonts and the light/dark switch come from assets/tokens.css; the header from site-header.css.
  // Only the document body, footer and index cards are styled here.
  return `<style>
  *{box-sizing:border-box;margin:0;padding:0;letter-spacing:0!important}
  html{scroll-behavior:smooth}
  body{background:var(--bg);color:var(--ink);font-family:var(--font-body);
       -webkit-font-smoothing:antialiased;line-height:1.55}
  a{color:inherit;text-decoration:none}
  ::selection{background:color-mix(in oklab,var(--accent) 28%,transparent)}
  a:focus-visible{outline:2px solid var(--accent-fg);outline-offset:2px}
  .wrap{max-width:1080px;margin:0 auto;padding:0 24px}
  html[lang=ko] body{word-break:keep-all;line-height:1.7}

  footer{border-top:1px solid var(--line);padding:32px 0 56px;color:var(--faint);font-size:13px}
  footer .frow{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px 28px;align-items:center}
  footer .frow + .frow{margin-top:12px}
  footer .fl{display:flex;flex-wrap:wrap;gap:6px 22px}
  footer a:hover{color:var(--ink)}
  footer .wrap.biz{display:block;margin:16px auto 0;font-size:12px;line-height:1.7;overflow-wrap:anywhere}
  footer .wrap.biz[hidden]{display:none}
  footer .biz p{display:flex;flex-wrap:wrap;gap:4px 16px}
  footer .biz a{text-decoration:underline;text-underline-offset:4px}

  main.doc{max-width:78ch;margin:0 auto;padding:48px 24px 96px;min-width:0;overflow-wrap:break-word}
  main.doc h1,main.doc h2,main.doc h3,main.doc h4{scroll-margin-top:72px;text-transform:none}
  .crumbs{font:500 11.5px/1.4 var(--font-mono);letter-spacing:.02em!important;text-transform:uppercase;color:var(--faint);margin-bottom:22px}
  .crumbs a:hover{color:var(--ink)}
  main.doc h1{font-family:var(--font-display);font-size:clamp(30px,3.2vw,40px);line-height:1.15;overflow-wrap:anywhere}
  main.doc h2{font-family:var(--font-display);font-size:24px;margin:40px 0 12px;line-height:1.3}
  main.doc h3{font-family:var(--font-display);font-size:18px;margin:28px 0 10px;line-height:1.35}
  main.doc h4{font-size:15px;margin:20px 0 8px}
  main.doc p{color:var(--dim);line-height:1.7;margin:14px 0}
  main.doc .lede{color:var(--ink);font-size:16.5px;margin-top:14px}
  main.doc .inst{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin-top:18px;font-size:14px}
  main.doc a{color:var(--accent-fg);text-decoration:underline;text-underline-offset:4px}
  main.doc pre{background:var(--panel);border:1px solid var(--line);border-radius:0;max-width:100%;
    padding:16px 18px;overflow-x:auto;font-family:var(--font-mono);font-size:13px;line-height:1.6;margin:16px 0}
  main.doc pre code{background:none;border:0;padding:0;font-size:inherit}
  main.doc code{font-family:var(--font-mono);font-size:.92em;background:var(--panel);
    border:1px solid var(--line);border-radius:0;padding:1px 5px}
  main.doc .tbl{overflow-x:auto;margin:18px 0;-webkit-overflow-scrolling:touch}
  main.doc table{border-collapse:collapse;width:100%;min-width:560px;font-size:14px}
  main.doc th,main.doc td{border:1px solid var(--line);padding:8px 10px;vertical-align:top;text-align:left;overflow-wrap:normal}
  main.doc td a{overflow-wrap:anywhere}
  main.doc th{font:500 11.5px/1.4 var(--font-mono);letter-spacing:.02em!important;text-transform:uppercase;color:var(--dim)}
  main.doc blockquote{border-left:2px solid var(--line2);padding:2px 16px;color:var(--dim);margin:16px 0}
  main.doc blockquote.warning{border-color:var(--ink)}
  main.doc blockquote.note{border-color:var(--accent-fg)}
  main.doc img{max-width:100%;height:auto;border-radius:0}
  main.doc hr{border:0;border-top:1px solid var(--line);margin:32px 0}
  main.doc ul,main.doc ol{padding-left:1.4em;color:var(--dim);line-height:1.7;margin:14px 0}
  main.doc li{margin:4px 0}
  main.doc details{border-top:1px solid var(--line);padding:12px 0;margin:16px 0}
  main.doc summary{cursor:pointer;color:var(--ink);font-weight:500}
  main.doc kbd{font-family:var(--font-mono);font-size:.85em;background:var(--panel);border:1px solid var(--line2);
    border-radius:0;padding:1px 6px}
  .more{margin-top:56px;padding-top:24px;border-top:1px solid var(--line)}
  .more h2{font:500 11.5px/1.4 var(--font-mono);letter-spacing:.02em!important;text-transform:uppercase;color:var(--faint);margin-bottom:12px}
  .more ul{list-style:none;padding:0;display:flex;flex-direction:column;gap:6px}
  .more a{color:var(--accent-fg);text-decoration:underline;text-underline-offset:4px;font-size:14px}
  @media(max-width:480px){main.doc{padding:28px 18px 64px}.wrap{padding:0 18px}}
</style>`;
}

// Google Ads tag, kept identical to the one in the hand-written pages under site/.
const GOOGLE_TAG = `<!-- Google tag (gtag.js): Google Ads conversion measurement, see /privacy/ -->
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-18548782436"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'AW-18548782436');
</script>
<!-- Event snippet for 페이지 조회 conversion page: every public page counts, because Performance Max sends ad clicks to any sprag.io page -->
<script>
  gtag('event', 'conversion', {'send_to': 'AW-18548782436/cKBSCNv3vrIdEOTq34xF'});
</script>
<!-- Event snippets for 설치 명령 복사 and 문의 메일 클릭 conversions: a click on an install command copy button or an email link counts -->
<script>
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-copy], a[href^="mailto:"]');
    if (!el) return;
    var label = el.hasAttribute('data-copy') ? '3CnACPmE0bIdEOTq34xF' : 'rBY1CPyE0bIdEOTq34xF';
    gtag('event', 'conversion', {'send_to': 'AW-18548782436/' + label});
  });
</script>
<!-- Cloudflare Web Analytics: cookieless visit counts, see /privacy/ -->
<script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "61e11587311d49608109159f4d3507f0"}'></script>`;

function pageHead({ lang, slug, title, description, keywordsStr, canonical, hasKo, koUrl, enUrl, dateModified, hidden = false }) {
  const altBlock =
    hasKo === undefined
      ? ''
      : hasKo
        ? `<link rel="alternate" hreflang="en" href="${enUrl}" />
<link rel="alternate" hreflang="ko" href="${koUrl}" />
<link rel="alternate" hreflang="x-default" href="${enUrl}" />`
        : '';
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title,
    description,
    inLanguage: lang,
    url: canonical,
    isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    about: { '@id': `${SITE_ORIGIN}/#software` },
    author: { '@id': `${SITE_ORIGIN}/#author` },
    publisher: { '@id': `${SITE_ORIGIN}/#author` },
    dateModified,
    mainEntityOfPage: canonical,
  };
  return `<meta charset="utf-8" />
${GOOGLE_TAG}
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} | Sprag</title>
<meta name="description" content="${escapeAttr(description)}" />
<meta name="keywords" content="${escapeAttr(keywordsStr)}" />
<link rel="canonical" href="${canonical}" />
${altBlock}
<meta name="robots" content="${hidden ? 'noindex, nofollow' : 'index, follow'}" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${escapeAttr(title)}" />
<meta property="og:description" content="${escapeAttr(description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${SITE_ORIGIN}/assets/logo/sprag-lockup.png" />
<meta property="og:site_name" content="Sprag" />
<meta name="twitter:card" content="summary_large_image" />
${FAVICON_LINKS}
${FONT_LINKS}
${styleBlock()}
<script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
</script>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const NAV_LABELS = {
  en: ['How it works', 'Routing', 'Features', 'Docs', 'Proof lab', 'License', 'Team console'],
  ko: ['작동 방식', '라우팅', '기능', '문서', '검증 Lab', '라이선스', '팀 콘솔'],
};

const THEME_TOGGLE = `<button class="theme-tg" type="button" aria-label="Light / dark theme" title="Light / dark theme">
        <svg class="i-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z"/></svg>
        <svg class="i-sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></svg>
      </button>`;

// Same markup and link order as the home header (site/index.html). The language toggle is two links here
// because each language is its own page.
function headerHtml({ lang, docsHref, hasKo, enUrl, koUrl }) {
  let langSwitch = '';
  if (hasKo) {
    langSwitch = `<span class="lang" role="group" aria-label="Language">
        <a href="${enUrl}" aria-pressed="${lang === 'en'}">EN</a>
        <a href="${koUrl}" aria-pressed="${lang === 'ko'}">KO</a>
      </span>`;
  }
  // The site pages pick their language from ?lang= first, so a Korean doc keeps the reader in Korean.
  const q = lang === 'ko' ? '?lang=ko' : '';
  const [how, routing, features, docs, proof, license, team] = NAV_LABELS[lang === 'ko' ? 'ko' : 'en'];
  return `<header class="site-hdr">
  <div class="wrap">
    <a class="brand" href="/${q}">
      ${BRAND_SVG}
      Sprag
    </a>
    <nav>
      <a class="hide-sm" href="/${q}#how">${how}</a>
      <a class="hide-sm" href="/${q}#routing">${routing}</a>
      <a class="hide-sm" href="/${q}#features">${features}</a>
      <a class="hide-sm" href="${docsHref}" aria-current="page">${docs}</a>
      <a class="hide-sm" href="/proof/${q}">${proof}</a>
      <a href="/license/${q}">${license}</a>
      <a class="hide-sm" href="/team/${q}">${team}</a>
      ${langSwitch}
      ${THEME_TOGGLE}
      ${GH_ICONS}
    </nav>
  </div>
</header>`;
}

// The business block and the legal pages stay hidden until the first paying
// customer: they were on from 2026-11-01 and went off again on 2026-11-05.
// Payment sends the order link by mail, so the footer is not needed yet. Flip
// together with the hand-written pages' footer `hidden` and the legal pages'
// noindex.
const SHOW_BIZ = false;
const BIZ_FTC = 'https://www.ftc.go.kr/bizCommPop.do?wrkr_no=0000000000';
// The FTC lookup still lists the values filed on 2026-07-09 for another service
// (its support email and a Toss Payments shop page as the domain). The link is
// hidden until the change filing for sprag.io is reflected there. To restore it,
// set this to true and put the same anchor back in the hand-written pages' footer.
const SHOW_FTC = false;
const BIZ_INFO = {
  en: [
    'YAML Studio ((상호 비공개))',
    'Representative: 홍길동',
    'Business registration no. 000-00-00000',
    'Mail-order business registration 0000-00-0000',
    '(address withheld)',
    'Email: <a href="mailto:support@sprag.io">support@sprag.io</a>',
  ],
  ko: [
    '상호 (상호 비공개) (브랜드 YAML Studio)',
    '대표 홍길동',
    '사업자등록번호 000-00-00000',
    '통신판매업 신고 제0000-00-0000호',
    '주소 (주소 비공개)',
    '이메일 <a href="mailto:support@sprag.io">support@sprag.io</a>',
  ],
};
const BIZ_LINKS = {
  en: ['Terms of Service', 'Privacy Policy', 'Refund Policy', 'Verify business info'],
  ko: ['이용약관', '개인정보처리방침', '환불정책', '사업자정보확인'],
};

const FOOT_LABELS = {
  en: { docs: 'Docs', benchmark: 'Benchmark', sends: 'What Sprag sends' },
  ko: { docs: '문서', benchmark: '벤치마크', sends: 'Sprag가 보내는 데이터' },
};

function footerHtml(lang = 'en') {
  const l = lang === 'ko' ? 'ko' : 'en';
  const f = FOOT_LABELS[l];
  const info = BIZ_INFO[l].map((t) => `<span>${t}</span>`).join('');
  const [terms, privacy, refund, verify] = BIZ_LINKS[l];
  const q = l === 'ko' ? '?lang=ko' : '';
  const dataHref = l === 'ko' ? '/docs/ko/data/' : '/docs/data/';
  return `<footer>
  <div class="wrap frow">
    <span>Apache-2.0</span>
    <span class="fl"><a href="${l === 'ko' ? '/docs/ko/' : '/docs/'}">${f.docs}</a><a href="${REPO}">GitHub</a><a href="https://www.npmjs.com/package/sprag-cli">npm</a><a href="${REPO}/blob/main/docs/BENCHMARK.md">${f.benchmark}</a></span>
  </div>
  <div class="wrap frow">
    <span class="fl"><a href="/terms/${q}">${terms}</a><a href="/privacy/${q}">${privacy}</a><a href="/refund/${q}">${refund}</a><a href="${dataHref}">${f.sends}</a></span>
  </div>
  <div class="wrap biz"${SHOW_BIZ ? '' : ' hidden'}>
    <p>${info}</p>${SHOW_FTC ? `\n    <p><a href="${BIZ_FTC}" target="_blank" rel="noopener">${verify}</a></p>` : ''}
  </div>
</footer>`;
}

function docPageHtml(opts) {
  const {
    lang,
    slug,
    title,
    description,
    keywordsStr,
    bodyHtml,
    dateModified,
    hasKo,
    enUrl,
    koUrl,
    moreDocs,
    hidden = false,
  } = opts;
  const canonical = lang === 'ko' ? `${SITE_ORIGIN}/docs/ko/${slug}/` : `${SITE_ORIGIN}/docs/${slug}/`;
  const docsHref = lang === 'ko' ? '/docs/ko/' : '/docs/';
  const head = pageHead({
    lang,
    slug,
    title,
    description,
    keywordsStr,
    canonical,
    hidden,
    hasKo,
    koUrl,
    enUrl,
    dateModified,
  });
  const crumbLabel = lang === 'ko' ? '문서' : 'Docs';
  const moreLabel = lang === 'ko' ? '다른 문서' : 'More docs';
  const moreList = moreDocs.map((d) => `<li><a href="${d.href}">${escapeHtml(d.title)}</a></li>`).join('\n        ');
  return `<!doctype html>
<html lang="${lang}">
<head>
${head}
</head>
<body>
${headerHtml({ lang, docsHref, hasKo, enUrl, koUrl })}
<main class="doc">
  <nav class="crumbs"><a href="/${lang === 'ko' ? '?lang=ko' : ''}">Sprag</a> / <a href="${docsHref}">${crumbLabel}</a></nav>
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">${escapeHtml(description)}</p>
  ${bodyHtml}
  <section class="more">
    <h2>${moreLabel}</h2>
    <ul>
        ${moreList}
    </ul>
  </section>
</main>
${footerHtml(lang)}
<script src="/assets/theme-toggle.js" defer></script>
</body>
</html>
`;
}

const INSTALL_LINE = {
  en: { label: 'Install docs', href: '/docs/install/' },
  ko: { label: '설치 문서', href: '/docs/ko/install/' },
};

function indexPageHtml({ lang, entries }) {
  const canonical = lang === 'ko' ? `${SITE_ORIGIN}/docs/ko/` : `${SITE_ORIGIN}/docs/`;
  const docsHref = lang === 'ko' ? '/docs/ko/' : '/docs/';
  const title = lang === 'ko' ? '문서' : 'Docs';
  const description =
    lang === 'ko' ? 'Claude Code와 Codex용 Sprag 설치와 기능을 설명합니다.' : 'Reference pages for Sprag, the command-line harness for Claude Code and Codex.';
  const head = pageHead({
    lang,
    slug: 'index',
    title,
    description,
    keywordsStr: 'sprag docs, claude code documentation, codex harness documentation',
    canonical,
    hasKo: true,
    koUrl: `${SITE_ORIGIN}/docs/ko/`,
    enUrl: `${SITE_ORIGIN}/docs/`,
    dateModified: new Date().toISOString(),
  });
  const cards = entries
    .map((e) => {
      const t = lang === 'ko' ? e.koTitle : e.title;
      const d = lang === 'ko' ? e.koDescription : e.description;
      const href = lang === 'ko' ? `/docs/ko/${e.slug}/` : `/docs/${e.slug}/`;
      return `<a class="dcard" href="${href}"><b>${escapeHtml(t)}</b><span>${escapeHtml(d)}</span></a>`;
    })
    .join('\n      ');
  return `<!doctype html>
<html lang="${lang}">
<head>
${head}
<style>
  .dgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0 32px;margin-top:32px}
  main.doc a.dcard{display:block;color:var(--ink);text-decoration:none;border-top:1px solid var(--line);padding:18px 0 22px}
  .dcard:hover{border-top-color:var(--ink)}
  .dcard b{display:block;font-family:var(--font-display);font-size:15px}
  .dcard span{display:block;margin-top:8px;font-size:13px;color:var(--dim);line-height:1.6}
</style>
</head>
<body>
${headerHtml({ lang, docsHref, hasKo: true, enUrl: `${SITE_ORIGIN}/docs/`, koUrl: `${SITE_ORIGIN}/docs/ko/` })}
<main class="doc">
  <nav class="crumbs"><a href="/${lang === 'ko' ? '?lang=ko' : ''}">Sprag</a> / ${title}</nav>
  <h1>${title}</h1>
  <p class="inst"><code>npm i -g sprag-cli</code><a href="${INSTALL_LINE[lang].href}">${INSTALL_LINE[lang].label}</a></p>
  <p class="lede">${escapeHtml(description)}</p>
  <div class="dgrid">
      ${cards}
  </div>
</main>
${footerHtml(lang)}
<script src="/assets/theme-toggle.js" defer></script>
</body>
</html>
`;
}

function buildSitemap(entries) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [];
  urls.push(`  <url>
    <loc>${SITE_ORIGIN}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/?lang=en"/>
    <xhtml:link rel="alternate" hreflang="ko" href="${SITE_ORIGIN}/?lang=ko"/>
  </url>`);
  urls.push(`  <url>
    <loc>${SITE_ORIGIN}/docs/</loc>
    <priority>0.7</priority>
  </url>`);
  urls.push(`  <url>
    <loc>${SITE_ORIGIN}/docs/ko/</loc>
    <priority>0.7</priority>
  </url>`);
  // The replay evidence page. Hand-written HTML outside docs/, so the entry
  // has to be listed here; without it every rebuild dropped /proof/.
  urls.push(`  <url>
    <loc>${SITE_ORIGIN}/proof/</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/proof/?lang=en"/>
    <xhtml:link rel="alternate" hreflang="ko" href="${SITE_ORIGIN}/proof/?lang=ko"/>
  </url>`);
  // Legal pages (hand-written, bilingual in-page): payment providers and the
  // e-commerce act expect them to be discoverable.
  for (const slug of SHOW_BIZ ? ['terms', 'privacy', 'refund'] : []) {
    urls.push(`  <url>
    <loc>${SITE_ORIGIN}/${slug}/</loc>
    <lastmod>2026-11-01</lastmod>
    <priority>0.4</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/${slug}/?lang=en"/>
    <xhtml:link rel="alternate" hreflang="ko" href="${SITE_ORIGIN}/${slug}/?lang=ko"/>
  </url>`);
  }
  // site/team/ and site/pricing/ stay out of the sitemap until the team plan
  // launches; they are reachable by URL only (both carry noindex). Hidden
  // manifest entries (docs/team) stay out for the same reason.
  for (const e of entries) {
    if (e.hidden) continue;
    const enUrl = `${SITE_ORIGIN}/docs/${e.slug}/`;
    const koUrl = e.hasKo ? `${SITE_ORIGIN}/docs/ko/${e.slug}/` : null;
    const enAlt = e.hasKo
      ? `
    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}"/>
    <xhtml:link rel="alternate" hreflang="ko" href="${koUrl}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${enUrl}"/>`
      : '';
    urls.push(`  <url>
    <loc>${enUrl}</loc>
    <lastmod>${e.enDate.slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>${enAlt}
  </url>`);
    if (e.hasKo) {
      urls.push(`  <url>
    <loc>${koUrl}</loc>
    <lastmod>${e.koDate.slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}"/>
    <xhtml:link rel="alternate" hreflang="ko" href="${koUrl}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${enUrl}"/>
  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function build({ outDir } = {}) {
  const targetSiteDir = outDir || SITE_DIR;
  const written = [];
  const link = makeLinkRewriter();

  // Pass 1: read + preprocess + compute metadata for every manifest entry.
  const entries = MANIFEST.map((m) => {
    const koSrc = m.src.replace(/\.md$/, '.ko.md');
    const hasKo = docExists(koSrc);
    const enRaw = readDoc(m.src);
    const enBody = preprocessSource(enRaw);
    const enDate = gitDate(path.join('docs', m.src));
    const entry = { ...m, hasKo, enBody, enDate };
    if (hasKo) {
      const koRaw = readDoc(koSrc);
      const koMeta = extractKoMeta(koRaw);
      entry.koSrc = koSrc;
      entry.koTitle = koMeta.title;
      entry.koDescription = koMeta.description;
      entry.koBody = preprocessSource(koRaw);
      entry.koDate = gitDate(path.join('docs', koSrc));
    }
    return entry;
  });

  // Pass 2: render + write.
  for (const e of entries) {
    const enUrl = `${SITE_ORIGIN}/docs/${e.slug}/`;
    const koUrl = e.hasKo ? `${SITE_ORIGIN}/docs/ko/${e.slug}/` : undefined;

    const { html: enHtml } = renderMarkdown(e.enBody, { link });
    const enMore = entries
      .filter((o) => !o.hidden && o.slug !== e.slug)
      .map((o) => ({ href: `/docs/${o.slug}/`, title: o.title }));
    const enPage = docPageHtml({
      lang: 'en',
      slug: e.slug,
      title: e.title,
      description: e.description,
      keywordsStr: e.keywords.join(', '),
      bodyHtml: enHtml,
      dateModified: e.enDate,
      hasKo: e.hasKo,
      enUrl,
      koUrl,
      moreDocs: enMore,
      hidden: e.hidden,
    });
    const enPath = path.join(targetSiteDir, 'docs', e.slug, 'index.html');
    writeFile(enPath, enPage);
    written.push(enPath);

    if (e.hasKo) {
      const { html: koHtml } = renderMarkdown(e.koBody, { link });
      const koMore = entries
        .filter((o) => !o.hidden && o.hasKo && o.slug !== e.slug)
        .map((o) => ({ href: `/docs/ko/${o.slug}/`, title: o.koTitle }));
      const koPage = docPageHtml({
        lang: 'ko',
        slug: e.slug,
        title: e.koTitle,
        description: e.koDescription,
        keywordsStr: e.keywords.join(', '),
        bodyHtml: koHtml,
        dateModified: e.koDate,
        hasKo: true,
        enUrl,
        koUrl,
        moreDocs: koMore,
        hidden: e.hidden,
      });
      const koPath = path.join(targetSiteDir, 'docs', 'ko', e.slug, 'index.html');
      writeFile(koPath, koPage);
      written.push(koPath);
    }
  }

  // Index pages.
  const enIndexPath = path.join(targetSiteDir, 'docs', 'index.html');
  writeFile(enIndexPath, indexPageHtml({ lang: 'en', entries: entries.filter((e) => !e.hidden) }));
  written.push(enIndexPath);

  const koIndexPath = path.join(targetSiteDir, 'docs', 'ko', 'index.html');
  writeFile(koIndexPath, indexPageHtml({ lang: 'ko', entries: entries.filter((e) => e.hasKo && !e.hidden) }));
  written.push(koIndexPath);

  // Sitemap.
  const sitemapPath = path.join(targetSiteDir, 'sitemap.xml');
  writeFile(sitemapPath, buildSitemap(entries));
  written.push(sitemapPath);

  return { written, entries };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { written } = build({});
  console.log(`Wrote ${written.length} files:`);
  for (const f of written) console.log(' -', path.relative(ROOT, f));
}
