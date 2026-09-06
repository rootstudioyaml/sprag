/**
 * fig2md — Markdown rendering of a Figma `.fig` export.
 *
 * Planning documents increasingly live in Figma rather than PowerPoint, and a
 * `.fig` handed to the model is even more opaque than a pptx: the container
 * is a zip, but the payload inside (`canvas.fig`) is Figma's binary kiwi
 * format, so there is no XML to fall back on. Without a converter the file is
 * simply unreadable.
 *
 * markitdown does not speak this format, so the conversion runs in Node with
 * [openfig-core] (MIT, three small pure-JS dependencies). The parser is not
 * bundled: this package deliberately ships with zero dependencies, so
 * openfig-core is installed on demand into the tool's own state directory —
 * the same arrangement as the markitdown venv, for the same reason.
 *
 * Verified 2026-09-06 against real files: a community Bootstrap UI kit
 * (8.1MB, 4,155 nodes, 1,312 of them text) and a 52MB Tailwind kit, each
 * converting in under a second, plus a round-trip fixture whose Korean text
 * nodes came back byte-identical. Both .fig vintages parse — the current
 * zip container and the older bare fig-kiwi stream.
 *
 * [openfig-core]: https://github.com/OpenFig-org/openfig-core
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FIG_PARSER_SPEC = 'openfig-core@^0.4.1';

/** Where the on-demand parser install lives, under the tool's state dir. */
function managedFigDir(userDataDir) {
  return path.join(userDataDir, 'doc2md-fig');
}

function loadParser(userDataDir) {
  try {
    // eslint-disable-next-line import/no-dynamic-require
    return require(path.join(managedFigDir(userDataDir), 'node_modules', 'openfig-core', 'dist', 'index.cjs'));
  } catch {
    return null;
  }
}

/**
 * Install openfig-core into the managed directory. Mirrors the markitdown
 * venv install: network once, probe as the acceptance test.
 */
function installFigParser(userDataDir, { onProgress = () => {} } = {}) {
  const dir = managedFigDir(userDataDir);
  fs.mkdirSync(dir, { recursive: true });
  const pkgJson = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgJson)) {
    fs.writeFileSync(pkgJson, JSON.stringify({ name: 'doc2md-fig', private: true }) + '\n');
  }
  onProgress(`installing ${FIG_PARSER_SPEC}`);
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--silent', FIG_PARSER_SPEC], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (r.status !== 0) {
    return { ok: false, reason: 'npm-failed', detail: (r.stderr || '').slice(0, 400) };
  }
  if (!loadParser(userDataDir)) {
    return { ok: false, reason: 'import-failed', detail: 'installed, but openfig-core does not load' };
  }
  return { ok: true, dir };
}

/**
 * Node name plus type, indented by depth: the skeleton lines of the outline.
 */
function heading(node, depth) {
  const name = String(node.name || '').trim() || '(이름 없음)';
  return `${'#'.repeat(Math.min(depth + 2, 6))} ${name}`;
}

/**
 * Walk the parsed document and render an outline.
 *
 * The traversal follows `childrenMap` (guid → ordered children), which is how
 * the parser exposes hierarchy. Containers become headings, TEXT nodes become
 * body lines, and everything visual (vectors, rectangles, images) is counted
 * rather than listed: in a planning document the words are the content, and
 * two hundred `Rectangle 173` lines would drown them.
 */
function renderMarkdown(doc, sourceName) {
  const guidKey = (g) => `${g.sessionID}:${g.localID}`;
  const lines = [];
  const skipped = Object.create(null);
  let textNodes = 0;

  const CONTAINERS = new Set(['DOCUMENT', 'CANVAS', 'FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SLIDE', 'SYMBOL']);

  function walk(node, depth) {
    if (!node || node.phase === 'REMOVED' || node.visible === false) return;
    const type = node.type || '?';
    if (type === 'TEXT') {
      textNodes += 1;
      const text = String(node.textData?.characters || '').trim();
      const name = String(node.name || '').trim();
      // The layer name usually repeats the text's first line; only show it
      // when it says something the text does not.
      if (name && text && !text.startsWith(name) && !name.startsWith(text.slice(0, 20))) {
        lines.push(`- **${name}**: ${text.replace(/\n/g, ' / ')}`);
      } else if (text) {
        lines.push(`- ${text.replace(/\n/g, ' / ')}`);
      }
      return;
    }
    if (CONTAINERS.has(type)) {
      if (type !== 'DOCUMENT') {
        lines.push('', heading(node, depth), '');
      }
      const children = doc.childrenMap?.get?.(guidKey(node.guid))
        || doc.childrenMap?.[guidKey(node.guid)]
        || [];
      for (const child of children) walk(child, depth + (type === 'DOCUMENT' ? 0 : 1));
      return;
    }
    skipped[type] = (skipped[type] || 0) + 1;
  }

  const root = (doc.nodes || []).find((n) => n.type === 'DOCUMENT');
  if (root) walk(root, 0);

  const title = doc.meta?.file_name || sourceName;
  const head = [`# ${title}`];
  const skippedText = Object.entries(skipped)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ${n}개`)
    .join(', ');
  if (skippedText) {
    head.push('', `(텍스트 외 시각 요소는 생략했습니다: ${skippedText}. 시각 확인이 필요하면 Figma에서 원본을 여십시오.)`);
  }
  return { markdown: [...head, ...lines, ''].join('\n'), textNodes };
}

/**
 * Convert one `.fig` file. Same result contract as the Python converter:
 * `{ ok, markdown, note, truncated, rows, pages, markup_bytes }` or
 * `{ ok: false, reason, detail }`.
 *
 * `markup_bytes` is 0 on purpose. The office formats price their alternative
 * as "unzip and wade through the XML", but a .fig unzips to another binary —
 * there is no readable fallback, so there is no honest baseline to claim and
 * these conversions count as documents handled rather than money saved.
 */
async function convertFig(filePath, userDataDir) {
  const parser = loadParser(userDataDir);
  if (!parser) return { ok: false, reason: 'no-figparser' };
  let doc;
  try {
    const buf = fs.readFileSync(filePath);
    // Two vintages of the same extension: current exports are a zip wrapping
    // canvas.fig, older ones are the bare fig-kiwi stream (magic "fig-kiwi").
    // Verified on a real 8.4MB community kit that only the binary path reads.
    doc = buf[0] === 0x50 && buf[1] === 0x4b
      ? await parser.parseFig(buf)
      : await parser.parseFigBinary(buf);
  } catch (e) {
    return { ok: false, reason: 'convert-failed', detail: String(e.message || e).slice(0, 300) };
  }
  const { markdown, textNodes } = renderMarkdown(doc, path.basename(filePath, '.fig'));
  if (!textNodes) {
    // A design file with no words converts to an empty outline, which would
    // read as "the document says nothing" — a worse claim than "unreadable".
    return { ok: false, reason: 'no-text', detail: 'the file has no text nodes' };
  }
  return { ok: true, markdown, note: null, truncated: false, rows: 0, pages: 0, markup_bytes: 0 };
}

module.exports = {
  FIG_PARSER_SPEC,
  managedFigDir,
  installFigParser,
  convertFig,
  renderMarkdown,
};
