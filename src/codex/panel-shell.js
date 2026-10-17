import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const BEGIN = '# >>> sprag codex panel >>>';
const END = '# <<< sprag codex panel <<<';

export const PANEL_SHELL_BLOCK = `${BEGIN}
function codex() {
  local sprag_root="$PWD" sprag_open=1 sprag_next=0 sprag_arg
  case "\${1-}" in
    exec|e|review|login|logout|mcp|plugin|app-server|remote-control|completion|update|doctor|sandbox|debug|apply|queue|archive|delete|migrate-rollouts|unarchive|cloud|exec-server|features|help|agents|app) sprag_open=0 ;;
  esac
  for sprag_arg in "$@"; do
    if (( sprag_next )); then
      sprag_root="$sprag_arg"
      sprag_next=0
      continue
    fi
    case "$sprag_arg" in
      -C|--cd) sprag_next=1 ;;
      --cd=*) sprag_root="\${sprag_arg#--cd=}" ;;
      --help|-h|--version|-V) sprag_open=0 ;;
    esac
  done
  if [[ -t 0 && -t 1 && "\${SPRAG_CODEX_PANEL-}" != 1 ]] && (( sprag_open )); then
    command sprag panel run --agent codex -- "$@"
    return $?
  fi
  command codex "$@"
}
${END}
`;

export function installPanelShell({ file = join(process.env.ZDOTDIR || homedir(), '.zshrc'), remove = false } = {}) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) throw new Error('Malformed Sprag shell block; repair it before installation.');
  if (start < 0 && !remove && /(?:function\s+codex\b|\bcodex\s*\(\)|\balias\s+codex=)/m.test(text)) {
    throw new Error('An existing codex alias/function is present; keeping it unchanged.');
  }
  const next = start >= 0 ? text.slice(0, start) + (remove ? '' : PANEL_SHELL_BLOCK.trimEnd()) + text.slice(end + END.length)
    : remove ? text : text + (text.endsWith('\n') || !text ? '' : '\n') + PANEL_SHELL_BLOCK;
  if (next !== text) {
    mkdirSync(dirname(file), { recursive: true });
    if (text) writeFileSync(`${file}.bak-${Date.now()}`, text);
    writeFileSync(file, next);
  }
  return file;
}
