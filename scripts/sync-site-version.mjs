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
if (!process.argv.includes('--no-stage')) {
  execFileSync('git', ['add', 'site/index.html'], { cwd: ROOT, stdio: 'inherit' });
}
console.log(`sync-site-version: site/index.html softwareVersion = ${version}`);
