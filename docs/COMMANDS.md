# Command reference

[← README](../README.md) · [한국어](./COMMANDS.ko.md)

## Commands

Run these in your shell (inside Claude Code, the `/claude-token-saver` Skill is the only entry point):

| Command | What it does |
|---|---|
| `sprag` | Last-1-day diagnostic report (`--days N` / `--hours N`) |
| `sprag last` | Most recent warning + remediation |
| `sprag history` | Last 7 days of warning transitions |
| `sprag handoff` | Back work up to `HANDOFF-*.md` before a cap blocks you |
| `sprag mode [keywords...]` | Output config (`icon`/`text`, `en`/`ko`, `1h`–`30d` window, …) |
| `sprag harness ...` | 🅷 Harness management (below) |
| `sprag route-scan` | Detect recurring easy work on expensive models → propose haiku-delegation ratchet rules (below) |
| `sprag route-scan savings` | The routing-savings ledger — per-model-change rollup + per-run log (the evidence behind the figure) |
| `sprag compact-window` | Warn when a 1M-context session has no auto-compact cap → pin 400k with `set` (below) |
| `sprag korean on\|off\|status` | Inject Korean writing guidance at session start and install the write-time check (below) |
| `sprag cohesion on\|off\|status\|show` | Inject English cohesion guidance (sentence-connection rules) at session start |
| `sprag korean lint block\|warn\|off` | How the write-time check handles findings |
| `sprag korean lint scope all\|prose` | Check every text file, or documents only |
| `sprag doc2md on\|off` | Convert attached documents to Markdown before the model reads them (below) |
| `sprag doc2md <file>` | Convert one file by hand. Diagnostic: it prints the refusal reason instead of swallowing it |
| `sprag mode ttl=5m\|1h\|auto` | Pin the cache TTL bucket. The default `auto` trusts the measured split, then falls back to gateway detection |
| `sprag --version` | Print the installed version |
| `sprag update-check` | Is a newer version out? (`--refresh` to ask now, `--dismiss` to mute this version's offer) |
| `sprag upgrade` | Install the latest release with the package manager that installed this copy (`--print` shows the command only) |
| `sprag install` | Manually register Skill + statusline |
| `sprag uninstall [--purge]` | Remove the hooks, statusline and skill it registered. Recorded savings are kept unless `--purge` is given |

The output language is decided once, at install time: a terminal install proposes the system locale and asks whether to use Korean, while an unattended install records what the locale says. Once recorded it is never asked again, not even on an upgrade. Change it later with `mode ko` / `mode en`, or pin it for a scripted install with `CTS_LANG=ko` / `CTS_LANG=en`. Statusline chips stay symbolic either way.

<details>
<summary>All CLI options</summary>

| Flag | Description | Default |
|------|-------------|---------|
| `--days, -d` | Analysis period in days | 30 |
| `--hours` | Analysis window in hours (overrides `--days`) | – |
| `--format, -f` | `table` / `json` / `csv` | table |
| `--project, -p` | Filter by project directory | all |
| `--threshold` | Hit-rate alert threshold (0.0–1.0) | 0.7 |
| `--statusline` | One-line statusline output | – |
| `--icon` | Use 🧠 / ⏳ / 💰 / 📦 icons | text |
| `--verbose` | Longer labels | – |
| `--no-timer` | Hide TTL countdown | show |
| `--no-color` | Strip ANSI codes | – |
| `--segments=…` | Limit statusline segments (e.g. `model,five_hour,seven_day,saved`) | all |
| `--install-hook` / `--uninstall-hook` | Manage the PostToolUse hook | – |
</details>

---
