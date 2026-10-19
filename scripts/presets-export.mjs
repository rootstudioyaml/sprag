#!/usr/bin/env node
/**
 * Print the preset bundle that the files in presets/ make.
 *
 *   node scripts/presets-export.mjs              # bundle JSON (format 1, version 1, unsigned)
 *   node scripts/presets-export.mjs --sql        # the INSERT that seeds it as the published row
 *   node scripts/presets-export.mjs --version 4 --min-cli 3.71.0
 *
 * The server's version 1 (supabase/migrations/20261018001400_presets.sql in the
 * sprag-team repository) was generated with --sql. Ids are the ones the CLI
 * already uses, so a machine's recorded seed answers carry over unchanged.
 */
import { bundledBundle } from '../src/presets-source.js';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const version = Number(arg('--version', '1'));
const minCli = arg('--min-cli', '3.71.0');
const bundle = bundledBundle({ version, minCli });

if (!argv.includes('--sql')) {
  console.log(JSON.stringify(bundle, null, 2));
} else {
  const lit = (v) => {
    const s = JSON.stringify(v);
    if (s.includes('$preset$')) throw new Error('preset text contains the dollar-quote tag');
    return `$preset$${s}$preset$::jsonb`;
  };
  console.log([
    'insert into public.preset_bundles (version, format, status, ratchet_rules, model_rules, agents, min_cli, notes, sig, published_at)',
    `values (${version}, ${bundle.format}, 'published',`,
    `  ${lit(bundle.ratchet_rules)},`,
    `  ${lit(bundle.model_rules)},`,
    `  ${lit(bundle.agents)},`,
    `  ${minCli ? `'${minCli.replace(/'/g, "''")}'` : 'null'}, 'Seeded from the presets bundled with sprag-cli (unsigned)', null, now());`,
  ].join('\n'));
}
