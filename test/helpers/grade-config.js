/**
 * Pins the delegation grade for a test.
 *
 * The grade comes from config.json in the tool's data directory, and an unset
 * grade reads as 'quality'. Tests that pin the older behaviour (T2 rules kept,
 * no JUDGE gate) are about grade 'cost', so they say so here instead of
 * depending on whatever the machine running the suite has configured.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Writes `delegationGrade` into <dataDir>/config.json, keeping any other keys already there. */
export function writeGradeConfig(dataDir, grade = 'cost', extra = {}) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'config.json');
  let cfg = {};
  try { if (existsSync(file)) cfg = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { /* start over */ }
  writeFileSync(file, JSON.stringify({ ...cfg, ...extra, delegationGrade: grade }, null, 2) + '\n');
  return file;
}

/**
 * Points this process at a fresh data directory whose config carries `grade`.
 * It has to run before src/config.js is imported, which reads the path once at
 * load, so a test file imports ./helpers/grade-cost.js (this, with 'cost') as
 * its first import.
 */
export function useGrade(grade = 'cost') {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sprag-grade-cfg-')));
  writeGradeConfig(join(base, 'claude-token-saver'), grade);
  process.env.XDG_CONFIG_HOME = base;
  return base;
}
