#!/usr/bin/env node
/**
 * Write the published preset bundle back into presets/ before a release, so the
 * fallback that ships in the package matches what the /ops console published.
 *
 *   npm run presets:pull                      # fetch presets_published() and write the files
 *   npm run presets:pull -- --from <file>     # use a bundle JSON saved earlier instead
 *   npm run presets:pull -- --dry-run         # say what would change, write nothing
 *   npm run presets:pull -- --allow-unsigned  # accept a bundle this CLI would not apply
 *
 * Writes presets/ratchet-rules.json (rules), presets/model-rules.json (presets)
 * and presets/agents.json (agents), keeping each file's `note`. Refuses a bundle
 * whose signature does not verify against PRESET_SIGNING_KEYS unless told
 * otherwise: the package fallback should never carry text the CLI itself would
 * have rejected. SPRAG_TEAM_API_URL / SPRAG_TEAM_ANON_KEY point it at a local stack.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateBundle } from '../src/presets-source.js';
import { rpc, teamApiUrl, teamAnonKey } from '../src/team-sync.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const from = argv.includes('--from') ? argv[argv.indexOf('--from') + 1] : null;

let bundle;
if (from) bundle = JSON.parse(readFileSync(from, 'utf8'));
else bundle = await rpc('presets_published', {}, { url: teamApiUrl(), key: teamAnonKey() });
if (!bundle) { console.error('Nothing is published.'); process.exit(1); }

const ev = evaluateBundle(bundle);
if (!ev.ok && !has('--allow-unsigned')) {
  console.error(`Refusing v${bundle.version}: ${ev.reason}. Pass --allow-unsigned to write it anyway.`);
  process.exit(1);
}

const files = [
  ['ratchet-rules.json', 'rules', bundle.ratchet_rules],
  ['model-rules.json', 'presets', bundle.model_rules],
  ['agents.json', 'agents', bundle.agents],
];
let changed = 0;
for (const [name, key, list] of files) {
  const path = join(root, 'presets', name);
  const before = readFileSync(path, 'utf8');
  const data = JSON.parse(before);
  data[key] = list;
  const after = JSON.stringify(data, null, 2) + '\n';
  if (after === before) { console.log(`unchanged  presets/${name}`); continue; }
  changed += 1;
  console.log(`${has('--dry-run') ? 'would write' : 'wrote'}  presets/${name} (${list.length} ${key})`);
  if (!has('--dry-run')) writeFileSync(path, after);
}
console.log(`Bundle v${bundle.version}${ev.ok ? ` signed by ${ev.kid}` : ` (${ev.reason})`}: ${changed} file(s) ${has('--dry-run') ? 'would change' : 'changed'}.`);
