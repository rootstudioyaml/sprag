/**
 * docs-statusline — regenerate docs/statusline.png from the REAL statusline.
 *
 * The screenshot in the README has to be the actual output, not a mock-up, or
 * it drifts from what users see. This runs the CLI with a representative stdin
 * payload (so the rate-limit gauges and model chip are present), converts the
 * ANSI truecolor output to HTML, and screenshots it with headless Chrome.
 *
 * Usage:  node scripts/docs-statusline.mjs        # writes /tmp html + prints size
 *         (then follow the printed chrome command, or run `npm run docs:statusline`)
 *
 * Requires Google Chrome; nothing is added to the package's dependencies.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outHtml = join(repoRoot, 'docs', 'statusline.html');

const now = Math.floor(Date.now() / 1000);
const payload = JSON.stringify({
  model: { display_name: 'Opus 5' },
  context_window: { context_window_size: 1000000, used_percentage: 47 },
  rate_limits: {
    five_hour: { used_percentage: 62, resets_at: now + 7200 },
    seven_day: { used_percentage: 38, resets_at: now + 3 * 86400 },
  },
});

const raw = execSync('node bin/cli.js --statusline', {
  cwd: repoRoot,
  input: payload,
  env: { ...process.env, COLORTERM: 'truecolor' },
  encoding: 'utf8',
});

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toHtml(line) {
  let out = '';
  let open = 0;
  const re = /\x1b\[([0-9;]*)([A-Za-z])/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    out += esc(line.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] !== 'm') continue; // drop \x1b[K etc.
    const params = m[1];
    if (params === '0' || params === '') {
      while (open > 0) { out += '</span>'; open--; }
    } else if (params === '1') {
      out += '<span style="font-weight:700">'; open++;
    } else if (params.startsWith('38;2;')) {
      const [r, g, b] = params.slice(5).split(';');
      out += `<span style="color:rgb(${r},${g},${b})">`; open++;
    }
  }
  out += esc(line.slice(last));
  while (open > 0) { out += '</span>'; open--; }
  return out;
}

const lines = raw.replace(/\x1b\[K/g, '').replace(/\n$/, '').split('\n');
const body = lines.map((l) => `<div class="l">${toHtml(l)}</div>`).join('\n');

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: #0d1117; }
  .term {
    background: #0d1117;
    padding: 20px 24px;
    box-sizing: border-box;
    font-family: "SFMono-Regular", Menlo, Consolas, monospace, "Apple Color Emoji";
    font-size: 15px;
    line-height: 1.85;
    color: #c9d1d9;
    white-space: pre;
    width: max-content;
  }
</style>
<script>
  addEventListener('load', () => {
    const t = document.querySelector('.term');
    document.body.setAttribute('data-w', Math.ceil(t.getBoundingClientRect().width));
    document.body.setAttribute('data-h', Math.ceil(t.getBoundingClientRect().height));
  });
</script>
<div class="term">
${body}
</div>
`;
writeFileSync(outHtml, html);
console.log(`wrote ${outHtml} (${lines.length} lines)`);
console.log('\nNow screenshot it (size is measured by the page itself):');
console.log(`  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`);
console.log(`  SIZE=$("$CHROME" --headless --disable-gpu --dump-dom --window-size=4000,400 "file://${outHtml}" 2>/dev/null | grep -o 'data-w="[0-9]*" data-h="[0-9]*"')`);
console.log(`  # then: "$CHROME" --headless --disable-gpu --screenshot=docs/statusline.png \\`);
console.log(`  #         --window-size=<w>,<h> --force-device-scale-factor=2 --hide-scrollbars \\`);
console.log(`  #         --default-background-color=0d1117ff "file://${outHtml}"`);
