/**
 * Pins the delegation grade for a test.
 *
 * The grade is not stored any more: it reads 'quality' unless config.json in
 * the tool's data directory holds a `relaxUntil` deadline in the future, which
 * reads 'cost'. Tests that pin the older behaviour (T2 rules kept, no JUDGE
 * gate) are about the relaxed window, so they say so here instead of depending
 * on whatever the machine running the suite has configured.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A relax deadline far enough ahead that no test run reaches it (epoch ms). */
export const FAR_FUTURE = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;

/** The config keys that make a grade: 'cost' opens a relax window, 'quality' closes it. */
export function gradeKeys(grade = 'cost') {
  return grade === 'cost' ? { relaxUntil: FAR_FUTURE } : {};
}

/** Writes the grade into <dataDir>/config.json (see gradeKeys), keeping any other keys already there. */
export function writeGradeConfig(dataDir, grade = 'cost', extra = {}) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'config.json');
  let cfg = {};
  try { if (existsSync(file)) cfg = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { /* start over */ }
  delete cfg.relaxUntil;
  writeFileSync(file, JSON.stringify({ ...cfg, ...extra, ...gradeKeys(grade) }, null, 2) + '\n');
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
