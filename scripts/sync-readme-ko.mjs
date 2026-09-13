#!/usr/bin/env node
/**
 * sync-readme-ko — embed README.ko.md into README.md as a collapsible block.
 *
 * README.ko.md stays the canonical Korean text; this script regenerates the
 * <details> section between the ko:begin / ko:end markers so the two never
 * drift. Wired into prepublishOnly, so every npm publish carries the current
 * Korean text; run it by hand after editing README.ko.md to refresh the repo
 * page too.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '<!-- ko:begin (generated from README.ko.md — edit that file, then run npm run sync:ko) -->';
const END = '<!-- ko:end -->';

const en = readFileSync(join(root, 'README.md'), 'utf8');
let ko = readFileSync(join(root, 'README.ko.md'), 'utf8');

// The English README right above already shows the logo, badges and nav —
// repeating them inside the details block reads as a rendering glitch, so the
// embedded copy starts at the first heading after the header rule.
const headerEnd = ko.indexOf('\n---\n');
if (headerEnd !== -1) ko = ko.slice(headerEnd + 5);

const block = `${BEGIN}
<details>
<summary><strong>🇰🇷 한국어로 보기 (클릭하면 한국어 전문이 펼쳐집니다)</strong></summary>

${ko.trim()}

</details>
${END}`;

let out;
if (en.includes(BEGIN)) {
  const re = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  out = en.replace(re, block);
} else {
  // First run: insert right after the centered header block's closing rule.
  const anchor = '\n---\n';
  const idx = en.indexOf(anchor);
  if (idx === -1) throw new Error('README.md: no --- anchor after the header block');
  out = en.slice(0, idx + anchor.length) + '\n' + block + '\n' + en.slice(idx + anchor.length);
}

writeFileSync(join(root, 'README.md'), out);
console.log('README.md: Korean section synced from README.ko.md');
