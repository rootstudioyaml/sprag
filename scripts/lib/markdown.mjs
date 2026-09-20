// Zero-dependency Markdown -> HTML renderer, scoped to what docs/*.md actually uses.
// Exported: renderMarkdown(md, opts) -> { html, headings }
//   opts.link(url) -> url   rewrite callback applied to every link/image URL.

const RAW_HTML_TAGS = ['<img', '<details', '<summary', '</details>', '<br', '<p', '<div', '<a ', '<kbd'];
const ALERT_LABELS = { NOTE: 'Note', WARNING: 'Warning', TIP: 'Tip', IMPORTANT: 'Important', CAUTION: 'Caution' };
const ALERT_CLASS = { NOTE: 'note', WARNING: 'warning' };

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Strip markdown markup to plain text (used for heading ids and descriptions).
export function toPlainText(text) {
  return String(text)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function slugify(text, usedIds) {
  let s = toPlainText(text).toLowerCase();
  s = s.replace(/[^\p{L}\p{N}]+/gu, '-');
  s = s.replace(/^-+|-+$/g, '');
  if (!s) s = 'section';
  let id = s;
  let n = 2;
  while (usedIds.has(id)) {
    id = `${s}-${n}`;
    n++;
  }
  usedIds.add(id);
  return id;
}

function renderInline(text, opts) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];

    if (ch === '`') {
      const j = text.indexOf('`', i + 1);
      if (j !== -1) {
        out += `<code>${escapeHtml(text.slice(i + 1, j))}</code>`;
        i = j + 1;
        continue;
      }
    }

    if (ch === '!' ) {
      const m = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(text.slice(i));
      if (m) {
        const url = opts.link(m[2]);
        out += `<img src="${escapeAttr(url)}" alt="${escapeAttr(m[1])}">`;
        i += m[0].length;
        continue;
      }
    }

    if (ch === '[') {
      const m = /^\[([^\]]*)\]\(([^)]+)\)/.exec(text.slice(i));
      if (m) {
        const url = opts.link(m[2]);
        out += `<a href="${escapeAttr(url)}">${renderInline(m[1], opts)}</a>`;
        i += m[0].length;
        continue;
      }
    }

    if (ch === '<') {
      const m = /^<(https?:\/\/[^>\s]+)>/.exec(text.slice(i));
      if (m) {
        const url = opts.link(m[1]);
        out += `<a href="${escapeAttr(url)}">${escapeHtml(m[1])}</a>`;
        i += m[0].length;
        continue;
      }
    }

    if (ch === '*' && text[i + 1] === '*') {
      const m = /^\*\*([\s\S]+?)\*\*/.exec(text.slice(i));
      if (m) {
        out += `<strong>${renderInline(m[1], opts)}</strong>`;
        i += m[0].length;
        continue;
      }
    }

    if (ch === '*') {
      const m = /^\*([^*]+?)\*/.exec(text.slice(i));
      if (m) {
        out += `<em>${renderInline(m[1], opts)}</em>`;
        i += m[0].length;
        continue;
      }
    }

    if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '&') out += '&amp;';
    else out += ch;
    i++;
  }
  return out;
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let escaped = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (escaped) {
      cur += c;
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      cur += c;
      continue;
    }
    if (c === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const HR_RE = /^-{3,}$/;
const HEADING_RE = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^```(\S*)\s*$/;
const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function isBlockStart(lines, i) {
  const line = lines[i];
  if (line.trim() === '') return true;
  if (FENCE_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (HR_RE.test(line.trim())) return true;
  if (/^>/.test(line)) return true;
  if (LIST_RE.test(line)) return true;
  if (RAW_HTML_TAGS.some((tag) => line.trimStart().startsWith(tag))) return true;
  if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) return true;
  return false;
}

function parseList(lines, opts) {
  // lines: array of list-item lines (and continuation/nested lines) all belonging to one list
  const first = LIST_RE.exec(lines[0]);
  const baseIndent = first[1].length;
  const isOrdered = /^\d+\./.test(first[2]);
  const items = [];
  let i = 0;
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (!m || m[1].length !== baseIndent) break;
    let itemText = m[3];
    i++;
    const subLines = [];
    while (i < lines.length) {
      const mm = LIST_RE.exec(lines[i]);
      if (mm && mm[1].length > baseIndent) {
        subLines.push(lines[i]);
        i++;
      } else if (lines[i].trim() !== '' && /^\s{2,}/.test(lines[i]) && !LIST_RE.test(lines[i])) {
        itemText += ' ' + lines[i].trim();
        i++;
      } else {
        break;
      }
    }
    let subHtml = '';
    if (subLines.length) {
      subHtml = parseList(subLines, opts);
    }
    items.push(`<li>${renderInline(itemText, opts)}${subHtml}</li>`);
  }
  const tag = isOrdered ? 'ol' : 'ul';
  return `<${tag}>${items.join('')}</${tag}>`;
}

function parseBlocks(lines, opts, headings, usedIds) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1];
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // closing fence
      const cls = lang ? ` class="lang-${escapeAttr(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const hMatch = HEADING_RE.exec(line);
    if (hMatch) {
      const level = hMatch[1].length;
      const rawText = hMatch[2];
      const id = slugify(rawText, usedIds);
      headings.push({ level, text: toPlainText(rawText), id });
      out.push(`<h${level} id="${id}">${renderInline(rawText, opts)}</h${level}>`);
      i++;
      continue;
    }

    if (HR_RE.test(line.trim())) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (RAW_HTML_TAGS.some((tag) => line.trimStart().startsWith(tag))) {
      const htmlLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        htmlLines.push(lines[i]);
        i++;
      }
      out.push(htmlLines.join('\n'));
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const headerCells = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      let tbl = '<div class="tbl"><table><thead><tr>';
      for (const c of headerCells) tbl += `<th>${renderInline(c, opts)}</th>`;
      tbl += '</tr></thead><tbody>';
      for (const r of rows) {
        tbl += '<tr>';
        for (const c of r) tbl += `<td>${renderInline(c, opts)}</td>`;
        tbl += '</tr>';
      }
      tbl += '</tbody></table></div>';
      out.push(tbl);
      continue;
    }

    if (/^>/.test(line)) {
      const qLines = [];
      while (i < lines.length && /^>/.test(lines[i])) {
        qLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      let cls = '';
      let label = '';
      const firstTrim = (qLines[0] || '').trim();
      const alertMatch = /^\[!(NOTE|WARNING|TIP|IMPORTANT|CAUTION)\]\s*$/.exec(firstTrim);
      if (alertMatch) {
        const kind = alertMatch[1];
        label = ALERT_LABELS[kind];
        cls = ALERT_CLASS[kind] ? ` class="${ALERT_CLASS[kind]}"` : '';
        qLines.shift();
      }
      const innerHtml = parseBlocks(qLines, opts, headings, usedIds);
      const labelHtml = label ? `<p><strong>${label}:</strong></p>` : '';
      out.push(`<blockquote${cls}>${labelHtml}${innerHtml}</blockquote>`);
      continue;
    }

    if (LIST_RE.test(line)) {
      const listLines = [];
      while (i < lines.length && (LIST_RE.test(lines[i]) || (lines[i].trim() !== '' && /^\s{2,}/.test(lines[i])))) {
        listLines.push(lines[i]);
        i++;
      }
      out.push(parseList(listLines, opts));
      continue;
    }

    // paragraph
    {
      const pLines = [line.trim()];
      i++;
      while (i < lines.length && !isBlockStart(lines, i)) {
        pLines.push(lines[i].trim());
        i++;
      }
      out.push(`<p>${renderInline(pLines.join(' '), opts)}</p>`);
    }
  }
  return out.join('\n');
}

export function renderMarkdown(md, opts = {}) {
  const link = opts.link || ((u) => u);
  const o = { link };
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const headings = [];
  const usedIds = new Set();
  const html = parseBlocks(lines, o, headings, usedIds);
  return { html, headings };
}
