/**
 * Two things under test:
 *   - scripts/lib/markdown.mjs, the zero-dependency Markdown -> HTML renderer
 *     that docs/*.md is put through
 *   - scripts/build-site-docs.mjs's build({ outDir }), which runs every
 *     manifest doc through it and writes site/docs/**, plus the sitemap
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderMarkdown } from '../scripts/lib/markdown.mjs';
import { build } from '../scripts/build-site-docs.mjs';

function render(md, opts) {
  return renderMarkdown(md, opts);
}

test('heading ids: slugified, duplicates numbered, Korean preserved', () => {
  const { headings } = render('# Hello World\n\n## 한글 제목\n\n## 한글 제목\n');
  assert.deepEqual(
    headings.map((h) => h.id),
    ['hello-world', '한글-제목', '한글-제목-2'],
  );
  assert.equal(headings[1].text, '한글 제목');
});

test('fenced code: escapes markup chars and is never inline-parsed', () => {
  const { html } = render('```bash\necho "<b>*not bold*</b>" & true\n```\n');
  assert.match(html, /<pre><code class="lang-bash">/);
  assert.match(html, /&lt;b&gt;\*not bold\*&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<strong>|<em>/);
});

test('inline code inside a table cell', () => {
  const { html } = render('| Flag | Default |\n|---|---|\n| `--days` | 30 |\n');
  assert.match(html, /<div class="tbl">/);
  assert.match(html, /<td><code>--days<\/code><\/td>/);
});

test('nested list, one level of indent', () => {
  const { html } = render('- item one\n- item two\n  - nested a\n  - nested b\n');
  assert.match(html, /<ul><li>item one<\/li><li>item two<ul><li>nested a<\/li><li>nested b<\/li><\/ul><\/li><\/ul>/);
});

test('GitHub alert blockquotes get a class and a label', () => {
  const note = render('> [!NOTE]\n> a note\n').html;
  assert.match(note, /<blockquote class="note"><p><strong>Note:<\/strong><\/p>/);
  const warn = render('> [!WARNING]\n> danger\n').html;
  assert.match(warn, /<blockquote class="warning"><p><strong>Warning:<\/strong><\/p>/);
});

test('horizontal rule vs a table separator row', () => {
  const { html } = render('---\n\n| A | B |\n|---|---|\n| 1 | 2 |\n');
  assert.match(html, /<hr>/);
  assert.match(html, /<table>/);
  // the table's own --- separator row must never turn into an <hr>
  assert.equal((html.match(/<hr>/g) || []).length, 1);
});

test('raw HTML passthrough for <img>/<details> lines', () => {
  const { html } = render('<details>\n<summary>hi</summary>\nbody\n</details>\n');
  assert.match(html, /<details>\n<summary>hi<\/summary>\nbody\n<\/details>/);
});

test('link rewrite callback applied to links and images', () => {
  const { html } = render('[text](./STATUSLINE.md) and ![alt](./pic.png)', {
    link: (u) => `REWRITTEN:${u}`,
  });
  assert.match(html, /href="REWRITTEN:\.\/STATUSLINE\.md"/);
  assert.match(html, /src="REWRITTEN:\.\/pic\.png"/);
});

test('bold, italic and link nesting', () => {
  const { html } = render('**bold *and italic* text** plus a [link](https://x.test)');
  assert.match(html, /<strong>bold <em>and italic<\/em> text<\/strong>/);
  assert.match(html, /<a href="https:\/\/x\.test">link<\/a>/);
});

test('build({ outDir }) generates the full site/docs tree', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'sprag-site-docs-'));
  try {
    const { entries } = build({ outDir });
    assert.ok(entries.length > 0);

    for (const e of entries) {
      const enPath = join(outDir, 'docs', e.slug, 'index.html');
      assert.ok(existsSync(enPath), `missing EN page for ${e.slug}`);
      const html = readFileSync(enPath, 'utf8');
      assert.match(html, /rel="canonical"/);
      assert.match(html, /application\/ld\+json/);
      assert.match(html, new RegExp(`<title>${e.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| Sprag</title>`));
      assert.doesNotMatch(html, /```/);
      assert.doesNotMatch(html, /\]\(\.\//);
      assert.doesNotMatch(html, /\]\(\.\.\//);

      if (e.hasKo) {
        const koPath = join(outDir, 'docs', 'ko', e.slug, 'index.html');
        assert.ok(existsSync(koPath), `missing KO page for ${e.slug}`);
        const koHtml = readFileSync(koPath, 'utf8');
        assert.match(koHtml, /rel="canonical"/);
        assert.match(koHtml, /application\/ld\+json/);
        assert.doesNotMatch(koHtml, /```/);
      }
    }

    assert.ok(existsSync(join(outDir, 'docs', 'index.html')));
    assert.ok(existsSync(join(outDir, 'docs', 'ko', 'index.html')));

    const sitemap = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
    for (const e of entries) {
      assert.match(sitemap, new RegExp(`https://sprag\\.io/docs/${e.slug}/`));
      if (e.hasKo) {
        assert.match(sitemap, new RegExp(`https://sprag\\.io/docs/ko/${e.slug}/`));
      }
    }
    assert.match(sitemap, /<loc>https:\/\/sprag\.io\/<\/loc>/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
