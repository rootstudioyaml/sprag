# How to reduce Codex CLI token usage

[← README](../README.md) · [한국어](./GUIDE-CODEX-TOKENS.ko.md)

The same habits that cut Claude Code token spend apply to Codex CLI: keep sessions scoped so old context doesn't linger, push read-heavy exploration into a subagent instead of your main thread, and convert large documents to Markdown before pasting or attaching them. Codex's own usage accounting is separate from Claude Code's (the two never share a session, a cache, or a spend total) but the underlying cost driver is the same one: tokens accumulated in context that get re-billed on every subsequent turn.

## Scope sessions instead of letting one grow indefinitely

A Codex session that drifts across unrelated tasks carries all of the earlier tasks' context into later, unrelated turns. Starting a fresh session (or otherwise resetting context) when the task genuinely changes keeps each session's accumulated context proportional to what that task actually needs, rather than to everything that happened in the terminal that day.

## Delegate bounded, repeatable work to a cheaper model

Codex supports native subagent spawning (`spawn_agent`), which can target a specific model and reasoning effort per call. That's the lever for cost: a task that's read-heavy and produces a small, checkable answer doesn't need the same model or effort level as the main session driving it. Routing that category of work (a lookup, a translation, a paste-and-explain) to a cheaper model on a per-call basis leaves the main session's own model and effort untouched for the judgment calls that actually need it.

The same caution about mid-session model switching that applies to Claude Code applies here in spirit: switching the *main* session's model to save cost has a hidden downside if the runtime keeps any per-model cache or state, so the safer place to introduce a cheaper model is a scoped, bounded subagent call rather than the main session itself.

## Convert large documents before they enter context

A PDF, spreadsheet, or slide deck attached directly costs tokens proportional to how the file is packaged, not how much it actually says: a slide deck's underlying XML can run into hundreds of thousands of tokens once tags and style attributes are counted. Converting to Markdown first keeps the content and drops the packaging overhead. This is format-agnostic: the same principle holds whether the conversion happens by hand or through a tool, and it applies before the file reaches Codex just as much as it applies before it reaches Claude Code. See [doc2md](./DOC2MD.md) for the measured numbers (from Claude Code attachments, but the packaging-vs-content gap they demonstrate isn't specific to one client).

## What Sprag adds for Codex

Sprag supports Codex through its native `AGENTS.md` and `hooks.json` interfaces, alongside its Claude Code integration: installing one does not require or disable the other. Pass `--agent codex` to target Codex explicitly.

```bash
npm i -g sprag-cli
sprag install --agent codex
```

What that installs:

- **Harness rules in `AGENTS.md`.** The same ratchet-rule mechanism as Claude Code (a repeated mistake becomes a one-line rule loaded every session) written to Codex's own instruction file instead of `CLAUDE.md`.
- **A session-bound companion panel.** On macOS with zsh, installation sets up tmux so the panel renders inline in the same terminal when you type `codex`, falling back to a separate window when tmux, a non-zsh login shell, or an existing `codex` alias gets in the way.
- **Opt-in delegation**, turned on separately with `sprag delegate on --agent codex`. Once on, `sprag delegate model <id> --effort <level> --agent codex` sets a default target for built-in spawns without an explicit model, and category rules (`sprag delegate rules add explore --from <model> --model <cheaper-model> --project --agent codex`) route specific request types to a cheaper model while leaving everything else on the parent model. Matching is scoped by category, provider, and exact parent model, and project rules take precedence over global ones.
- **Document conversion and diagnostics**, the same doc2md pipeline used for Claude Code, plus `sprag panel doctor --agent codex` to check hook execution, launch failures, and recent rendered frames after installation.

Codex usage accounting stays separate from Claude Code's throughout: there's no shared spend total or shared cache clock between the two integrations. Full reference: [Codex integration](./CODEX.md).

```bash
npm i -g sprag-cli
sprag delegate on --agent codex
```

Related: [Reduce Claude Code token usage](./GUIDE-REDUCE-TOKENS.md) · [Codex integration](./CODEX.md) · [Command reference](./COMMANDS.md)
