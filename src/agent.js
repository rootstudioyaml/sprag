import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';

export function codexUserDir() {
  return process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), '.codex');
}

export function codexProviderName({ home = codexUserDir() } = {}) {
  try {
    const cfg = parse(readFileSync(join(home, 'config.toml'), 'utf8'));
    return cfg.profiles?.[cfg.profile]?.model_provider || cfg.model_provider || 'openai';
  } catch (e) { return e.code === 'ENOENT' ? 'openai' : null; }
}

/** Remove the global selector before positional subcommand parsers see it. */
export function selectAgent(argv) {
  const args = [];
  let agent = 'claude';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { args.push(...argv.slice(i)); break; }
    if (arg === '--agent' || arg.startsWith('--agent=')) {
      const value = arg === '--agent' ? argv[++i] : arg.slice('--agent='.length);
      if (!['claude', 'codex'].includes(value)) {
        throw new Error('--agent expects claude or codex');
      }
      agent = value;
    } else args.push(arg);
  }
  return { agent, args };
}
