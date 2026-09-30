# Sprag vs ccusage, claude-usage, and statusline tools

[← README](../README.md) · [한국어](./COMPARE.ko.md)

If you're comparing Sprag to ccusage, claude-usage, or a statusline tool like CCometixLine: those tools show you what Claude Code already spent, and Sprag does that too, plus it acts on the pattern it finds by delegating repeat work to a cheaper model. They're not mutually exclusive: several people run a usage dashboard alongside Sprag's statusline for a longer-range view, since Sprag's own statusline is built for the current session rather than historical reporting.

## The dividing line: reporting versus acting

**ccusage**, **claude-usage**, and **CCometixLine** all read Claude Code's local session logs and turn them into a report: token counts, model breakdowns, cost estimates, git and context info in the terminal prompt. That's genuinely useful: you can't fix what you can't see, and all three make the numbers visible in different formats (CLI report, web dashboard, statusline).

None of them change what happens on the next request. They tell you a session was expensive; they don't do anything about the next one being expensive in the same way. That's the gap Sprag's `route-scan` fills: it reads the same kind of session logs, finds a *repeated* request pattern an expensive model kept handling, and writes a delegation rule so that pattern goes to a cheaper subagent automatically from the next session on. The reporting layer and the acting layer aren't in tension: you can use both.

## ccusage

[ccusage](https://github.com/ryoppippi/ccusage) analyzes coding-agent CLI token usage and cost from local data. It's a CLI-first tool with wide adoption (its README carries an "Awesome Claude Code" badge and a Trendshift badge) and reads the same JSONL session transcripts Claude Code writes locally. It's the closest thing to a standard for after-the-fact Claude Code cost reporting.

Where it stops: ccusage tells you what happened. It doesn't watch a live session's cache hit rate or rate-limit windows as you work, and it doesn't generate rules that change future model selection. If your workflow is "run a report weekly to see where money went," ccusage covers that well on its own. If you also want the current session's cache health and rate-limit headroom in your prompt in real time, and want repeated expensive patterns automatically routed to a cheaper subagent, that's the part Sprag adds.

## claude-usage

[claude-usage](https://github.com/phuryn/claude-usage) (Claude Code Usage Dashboard) is explicit about its own scope: "Pro and Max subscribers get a progress bar. This gives you the full picture." It reads the same local logs and renders them as a web dashboard or a VS Code extension, with charts and cost estimates across API, Pro, and Max plans, and can track usage from the CLI, the VS Code extension, and dispatched Code sessions (it can't see Cowork sessions, which run server-side with no local transcript).

It's built for visibility depth: dashboards and charts a terminal statusline can't show. It doesn't touch model routing or write delegation rules; it's a read path only, same as ccusage. Running it alongside Sprag makes sense if you want the deep historical dashboard on top of Sprag's live statusline and its route-scan delegation.

## Statusline tools (CCometixLine)

[CCometixLine](https://github.com/Haleclipse/CCometixLine) is a Rust statusline for Claude Code with Git integration, usage tracking based on transcript analysis, an interactive TUI for configuration, and Claude Code enhancement utilities like a context-warning disabler and a verbose-mode enabler. Its focus is a fast, customizable prompt segment showing model, directory, git status, and context window information, with a theme system and granular segment control.

Sprag's statusline covers different ground within the same slot: prompt cache hit rate, the cache TTL countdown, both rate-limit windows (5-hour and 7-day) with reset times, and (once there's ledger data) a routing-savings line showing what got delegated and what it saved. It also surfaces a harness score (`🅷 5/5`) tracking whether the session is following its own operating rules. CCometixLine's TUI-driven customization and Claude Code patching utilities aren't things Sprag does; if you want that level of statusline theming control specifically, that's its niche. The two aren't designed to run in the same statusline slot at once, but nothing stops using CCometixLine's TUI theming ideas as a reference while running Sprag for the cache and rate-limit chips.

## Where Sprag is different, concretely

- **route-scan** doesn't just report a pattern: it writes a delegation rule (with the scope you approve) so that request type runs on a Haiku or Sonnet subagent starting the next session, and it records the measured savings per delegated run in a ledger you can audit with `sprag route-scan savings`. See [route-scan](./ROUTE_SCAN.md).
- **The harness** turns a repeated mistake into a rule loaded every session (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex), so correction cost is paid once. See [harness](./HARNESS.md).
- **doc2md** converts pptx, xlsx, pdf, docx, and Figma files to Markdown before they enter context, which is a token-avoidance step none of the reporting tools above perform. See [doc2md](./DOC2MD.md).
- **Never touches your main session's model.** Prompt caches are kept per model, so Sprag delegates through subagents instead of switching the session model mid-conversation. See [why realtime routing costs more](./NOT-A-ROUTER.md).

```bash
npm i -g sprag-cli
```

Related: [Reduce Claude Code token usage](./GUIDE-REDUCE-TOKENS.md) · [route-scan](./ROUTE_SCAN.md) · [Statusline reference](./STATUSLINE.md) · [Benchmark](./BENCHMARK.md)
