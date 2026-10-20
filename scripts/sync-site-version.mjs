#!/usr/bin/env node
// Copies package.json's version into the landing page's structured data.
//
// `npm version` runs this as the `version` lifecycle script: after the bump,
// before the release commit. The site used to be edited by hand, so the bump
// in v3.54.0 left `softwareVersion` at 3.53.0 and test/site-md.test.js failed
// on every CI runner. The script stages the page itself, because npm commits
// only package.json and the lockfile on its own.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = join(ROOT, 'site', 'index.html');
// The scene modules are imported with `?v=<version>`: a stale copy of
// office-scene.js kept drawing the old office after a deploy, because neither
// GitHub Pages nor a browser revalidates a module script that carries no
// validators. The query changes with every release, so the new page always
// fetches the new module.
const scenePages = ['ops', 'team'].map((d) => join(ROOT, 'site', d, 'index.html'));
const sceneRe = /(\/assets\/scene\/[a-z-]+\.js\?v=)[^'"]+/g;
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const html = readFileSync(page, 'utf8');
const re = /("softwareVersion":\s*")[^"]*(")/g;
const found = html.match(re) || [];
// Exactly one entry: none means the markup moved and this would silently do
// nothing, and more than one means we cannot tell which the test reads.
if (found.length !== 1) {
  console.error(`sync-site-version: expected one softwareVersion in site/index.html, found ${found.length}`);
  process.exit(1);
}
const next = html.replace(re, `$1${version}$2`);
if (next !== html) writeFileSync(page, next);
const staged = ['site/index.html'];
for (const file of scenePages) {
  const text = readFileSync(file, 'utf8');
  if (!sceneRe.test(text)) {
    console.error(`sync-site-version: no versioned scene import in ${file}`);
    process.exit(1);
  }
  const bumped = text.replace(sceneRe, `$1${version}`);
  if (bumped !== text) writeFileSync(file, bumped);
  staged.push(file.slice(ROOT.length + 1));
}
if (!process.argv.includes('--no-stage')) {
  execFileSync('git', ['add', ...staged], { cwd: ROOT, stdio: 'inherit' });
}
console.log(`sync-site-version: site/index.html softwareVersion = ${version}; scene imports ?v=${version}`);
