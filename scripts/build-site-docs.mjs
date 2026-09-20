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
    title: 'Install Sprag, the Claude Code token saver',
    description:
      'Install the Sprag command-line harness for Claude Code with one npm command, register the statusline and hooks, and verify the setup.',
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
    slug: 'korean-style',
    src: 'KOREAN-STYLE.md',
    title: 'Korean writing style gate for Claude Code output',
    description: 'Sprag lints Korean text at write time: double passives, translationese, cohesion between sentences.',
    keywords: ['claude code korean', 'korean style lint', '한국어 번역투 검사'],
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

const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />`;

const BRAND_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="26" fill="none" stroke="#59637A" stroke-width="6"/>
        <g fill="#5e6ad2">
          <rect x="26.5" y="9.5" width="11" height="15" rx="3.6" transform="rotate(-30 32 17)"/>
          <g transform="rotate(120 32 32)"><rect x="26.5" y="9.5" width="11" height="15" rx="3.6" transform="rotate(-30 32 17)"/></g>
          <g transform="rotate(240 32 32)"><rect x="26.5" y="9.5" width="11" height="15" rx="3.6" transform="rotate(-30 32 17)"/></g>
        </g>
        <circle cx="32" cy="32" r="8.5" fill="none" stroke="#59637A" stroke-width="4"/>
      </svg>`;

const GH_ICONS = `<a class="gh ic" href="${REPO}" aria-label="GitHub" title="GitHub">
        <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
      </a>
      <a class="gh ic npmic" href="https://www.npmjs.com/package/sprag-cli" aria-label="npm" title="npm">
        <svg viewBox="0 0 18 7" width="26" height="10" aria-hidden="true"><path fill="#cb3837" d="M0 0h18v6H9v1H5V6H0Zm1 5h2V2h1v3h1V1H1Zm5-4v5h2V5h2V1Zm2 1h1v2H8Zm3-1v4h2V2h1v3h1V2h1v3h1V1Z"/></svg>
      </a>`;

function styleBlock() {
  return `<style>
  :root{
    --bg:#010102; --panel:#0f1011; --panel2:#141516;
    --line:#23252a; --line2:#34343a;
    --ink:#f7f8f8; --dim:#8a8f98; --faint:#62666d;
    --amber:#5e6ad2; --amber2:#828fff;
    --teal:#35d6a8; --blue:#6a9bff; --red:#ff6b6b;
    --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
    --disp:"Inter",-apple-system,BlinkMacSystemFont,sans-serif;
    --sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    --r:8px; --rc:12px; --rp:16px;
    --ease:cubic-bezier(.23,1,.32,1);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);
       -webkit-font-smoothing:antialiased;line-height:1.55}
  a{color:inherit;text-decoration:none}
  ::selection{background:rgba(94,106,210,.25)}
  a:focus-visible{outline:2px solid var(--amber);outline-offset:2px;border-radius:4px}
  .wrap{max-width:1080px;margin:0 auto;padding:0 24px}

  header{position:sticky;top:0;z-index:50;border-bottom:1px solid var(--line);
         background:rgba(1,1,2,.8);backdrop-filter:blur(12px)}
  header .wrap{display:flex;align-items:center;justify-content:space-between;height:56px}
  .brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:15.5px;letter-spacing:.01em;font-family:var(--disp)}
  .brand svg{width:20px;height:20px;display:block}
  header nav{display:flex;align-items:center;gap:22px;font-size:13.5px;color:var(--dim)}
  header nav a:hover{color:var(--ink)}
  .gh{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line2);
      border-radius:6px;padding:5px 10px;font-size:12.5px;color:var(--dim)}
  .gh:hover{border-color:#3a3d47;color:var(--ink)}
  .gh.ic{padding:0;width:34px;height:30px;justify-content:center;color:var(--dim)}
  .gh.ic svg{display:block}
  .gh.npmic{width:44px}
  .gh.npmic:hover{border-color:#5a3236}
  .lang{display:inline-flex;border:1px solid var(--line2);border-radius:6px;overflow:hidden}
  .lang button{border:0;background:transparent;color:var(--faint);padding:5px 9px;
    font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;cursor:pointer;text-decoration:none;display:inline-flex}
  .lang a{border:0;background:transparent;color:var(--faint);padding:5px 9px;
    font-family:var(--mono);font-size:11.5px;letter-spacing:.04em}
  .lang a+a{border-left:1px solid var(--line2)}
  .lang a:hover{color:var(--dim)}
  .lang a[aria-pressed=true]{background:rgba(94,106,210,.12);color:var(--amber)}
  html[lang=ko] body{word-break:keep-all;line-height:1.7}
  @media(max-width:720px){header nav .hide-sm{display:none}}
  @media(hover:none) and (pointer:coarse){
    .gh{min-height:40px;padding:8px 12px}
    .gh.ic{width:40px;height:40px}
    .gh.npmic{width:50px}
    .lang a{padding:10px 12px}
  }

  footer{border-top:1px solid var(--line);padding:36px 0 56px;color:var(--faint);font-size:13px}
  footer .wrap{display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;align-items:center}
  footer a:hover{color:var(--ink)}

  main.doc{max-width:78ch;margin:0 auto;padding:48px 24px 96px}
  main.doc h1,main.doc h2,main.doc h3,main.doc h4{scroll-margin-top:72px}
  .crumbs{font-size:13px;color:var(--faint);margin-bottom:22px}
  .crumbs a:hover{color:var(--ink)}
  main.doc h1{font-family:var(--disp);font-size:clamp(28px,4vw,38px);letter-spacing:-.02em;line-height:1.15}
  main.doc h2{font-family:var(--disp);font-size:24px;letter-spacing:-.01em;margin:40px 0 12px;line-height:1.3}
  main.doc h3{font-family:var(--disp);font-size:18px;margin:28px 0 10px;line-height:1.35}
  main.doc h4{font-size:15px;margin:20px 0 8px}
  main.doc p{color:var(--dim);line-height:1.7;margin:14px 0}
  main.doc .lede{color:var(--ink);font-size:16.5px;margin-top:14px}
  main.doc a{color:var(--amber2);text-decoration:underline;text-underline-offset:3px}
  main.doc pre{background:var(--panel);border:1px solid var(--line);border-radius:var(--rc);
    padding:16px 18px;overflow-x:auto;font-family:var(--mono);font-size:13px;line-height:1.6;margin:16px 0}
  main.doc pre code{background:none;border:0;padding:0;font-size:inherit}
  main.doc code{font-family:var(--mono);font-size:.92em;background:var(--panel2);
    border:1px solid var(--line);border-radius:5px;padding:1px 5px}
  main.doc .tbl{overflow-x:auto;margin:18px 0}
  main.doc table{border-collapse:collapse;width:100%;font-size:14px}
  main.doc th,main.doc td{border:1px solid var(--line);padding:8px 10px;vertical-align:top;text-align:left}
  main.doc th{background:var(--panel)}
  main.doc blockquote{border-left:3px solid var(--line2);padding:2px 16px;color:var(--dim);margin:16px 0}
  main.doc blockquote.warning{border-color:var(--red)}
  main.doc blockquote.note{border-color:var(--blue)}
  main.doc img{max-width:100%;height:auto;border-radius:var(--r)}
  main.doc hr{border:0;border-top:1px solid var(--line);margin:32px 0}
  main.doc ul,main.doc ol{padding-left:1.4em;color:var(--dim);line-height:1.7;margin:14px 0}
  main.doc li{margin:4px 0}
  main.doc details{border:1px solid var(--line);border-radius:var(--rc);padding:12px 16px;margin:16px 0;background:var(--panel)}
  main.doc summary{cursor:pointer;color:var(--ink);font-weight:500}
  main.doc kbd{font-family:var(--mono);font-size:.85em;background:var(--panel2);border:1px solid var(--line2);
    border-radius:4px;padding:1px 6px}
  .more{margin-top:56px;padding-top:24px;border-top:1px solid var(--line)}
  .more h2{font-family:var(--disp);font-size:16px;margin-bottom:12px}
  .more ul{list-style:none;padding:0;display:flex;flex-direction:column;gap:6px}
  .more a{color:var(--amber2);text-decoration:underline;text-underline-offset:3px;font-size:14px}
  html[lang=ko] main.doc{word-break:keep-all;line-height:1.7}
</style>`;
}

function pageHead({ lang, slug, title, description, keywordsStr, canonical, hasKo, koUrl, enUrl, dateModified }) {
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
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} | Sprag</title>
<meta name="description" content="${escapeAttr(description)}" />
<meta name="keywords" content="${escapeAttr(keywordsStr)}" />
<link rel="canonical" href="${canonical}" />
${altBlock}
<meta name="robots" content="index, follow" />
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

function headerHtml({ lang, docsHref, hasKo, enUrl, koUrl }) {
  let langSwitch = '';
  if (hasKo) {
    langSwitch = `<span class="lang" role="group" aria-label="Language">
        <a href="${enUrl}" aria-pressed="${lang === 'en'}">EN</a>
        <a href="${koUrl}" aria-pressed="${lang === 'ko'}">KO</a>
      </span>`;
  }
  return `<header>
  <div class="wrap">
    <a class="brand" href="/">
      ${BRAND_SVG}
      Sprag
    </a>
    <nav>
      <a href="${docsHref}">${lang === 'ko' ? '문서' : 'Docs'}</a>
      ${langSwitch}
      ${GH_ICONS}
    </nav>
  </div>
</header>`;
}

function footerHtml() {
  return `<footer>
  <div class="wrap">
    <span>Apache-2.0 © YAML Studio</span>
    <span><a href="/docs/">Docs</a> · <a href="${REPO}">GitHub</a> · <a href="https://www.npmjs.com/package/sprag-cli">npm</a> · <a href="${REPO}/blob/main/docs/BENCHMARK.md">Benchmark</a></span>
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
  <nav class="crumbs"><a href="/">Sprag</a> / <a href="${docsHref}">${crumbLabel}</a></nav>
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
${footerHtml()}
</body>
</html>
`;
}

function indexPageHtml({ lang, entries }) {
  const canonical = lang === 'ko' ? `${SITE_ORIGIN}/docs/ko/` : `${SITE_ORIGIN}/docs/`;
  const docsHref = lang === 'ko' ? '/docs/ko/' : '/docs/';
  const title = lang === 'ko' ? '문서' : 'Docs';
  const description =
    lang === 'ko' ? 'Sprag 문서를 한국어로 읽을 수 있습니다.' : 'Reference pages for Sprag, the command-line harness for Claude Code.';
  const head = pageHead({
    lang,
    slug: 'index',
    title,
    description,
    keywordsStr: 'sprag docs, claude code documentation',
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
  .dgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-top:32px}
  .dcard{display:block;background:var(--panel);border:1px solid var(--line);border-radius:var(--rc);padding:18px}
  .dcard:hover{border-color:var(--line2)}
  .dcard b{display:block;font-family:var(--disp);font-size:15px}
  .dcard span{display:block;margin-top:8px;font-size:13px;color:var(--dim);line-height:1.6}
</style>
</head>
<body>
${headerHtml({ lang, docsHref, hasKo: true, enUrl: `${SITE_ORIGIN}/docs/`, koUrl: `${SITE_ORIGIN}/docs/ko/` })}
<main class="doc">
  <nav class="crumbs"><a href="/">Sprag</a> / ${title}</nav>
  <h1>${title}</h1>
  <p class="lede">${escapeHtml(description)}</p>
  <div class="dgrid">
      ${cards}
  </div>
</main>
${footerHtml()}
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
  for (const e of entries) {
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
      .filter((o) => o.slug !== e.slug)
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
    });
    const enPath = path.join(targetSiteDir, 'docs', e.slug, 'index.html');
    writeFile(enPath, enPage);
    written.push(enPath);

    if (e.hasKo) {
      const { html: koHtml } = renderMarkdown(e.koBody, { link });
      const koMore = entries
        .filter((o) => o.hasKo && o.slug !== e.slug)
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
      });
      const koPath = path.join(targetSiteDir, 'docs', 'ko', e.slug, 'index.html');
      writeFile(koPath, koPage);
      written.push(koPath);
    }
  }

  // Index pages.
  const enIndexPath = path.join(targetSiteDir, 'docs', 'index.html');
  writeFile(enIndexPath, indexPageHtml({ lang: 'en', entries }));
  written.push(enIndexPath);

  const koIndexPath = path.join(targetSiteDir, 'docs', 'ko', 'index.html');
  writeFile(koIndexPath, indexPageHtml({ lang: 'ko', entries: entries.filter((e) => e.hasKo) }));
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
