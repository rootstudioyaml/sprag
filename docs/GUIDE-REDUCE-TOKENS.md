# How to reduce Claude Code token usage

[← README](../README.md) · [한국어](./GUIDE-REDUCE-TOKENS.ko.md)

Four things cut Claude Code token spend without installing anything: run `/compact` before a long session gets to auto-compact on its own, `/clear` between unrelated tasks instead of carrying old context forward, split research into a subagent so its exploration tokens do not sit in your main context, and convert large attachments (PDF, pptx, docx, xlsx) to Markdown before pasting them in. Do those four things and the rest of this page is about automating them.

## Compact and clear at the right time, not by default

Claude Code compacts automatically once usage nears the session's context window, but by then every turn up to that point has been billed in full at least once. If you know a task is about to shift (a new feature, a different file tree, a different person's question) running `/compact` or `/clear` yourself before that point keeps the carried-forward context smaller on purpose, rather than waiting for the automatic threshold. `/clear` is the sharper tool: it drops history entirely, which is correct when the next task shares nothing with the last one.

The setting that controls when auto-compact fires is `autoCompactWindow`. On a 1M-token model, leaving it unset means compaction only kicks in near 800k tokens, and until then every request re-bills the whole accumulated context. Pinning it lower (Sprag's own reference point is a 400k–700k band) trims the tail of long sessions without compacting so often that you lose useful continuity. This is a one-time setting change, not a habit to remember.

## Push exploration into a subagent

A subagent that reads ten files to find one answer spends tokens in its own context, then hands back a short summary. Do the same search in your main thread and all ten files' worth of tokens sit in your context for the rest of the session, re-billed on every subsequent turn until you compact. The rule of thumb: anything that's read-heavy and produces a small answer ("where is X defined," "what does this error mean," "summarize this log") belongs in a subagent, not the main thread.

This also applies to model choice, but not in the way people first reach for. Switching your main session to a cheaper model mid-conversation does not save what it looks like it should, because [prompt caches are kept per model](./NOT-A-ROUTER.md). A model switch starts from a cold cache and re-reads the whole conversation at full price: past roughly 20k tokens of history, one switch can erase everything the cheaper model was going to save. Spawning a subagent on a cheaper model for a bounded task, and leaving the main session's model and cache alone, avoids that trap entirely.

## Convert documents before you attach them

Attaching a PDF, PowerPoint, Excel, or Word file lets Claude Code read the file directly, but the client pays for that in tokens that scale with the file's raw structure, not its content. A 7-page report PDF costs roughly 20,000 extra input tokens over the same prompt without it. A 31.8MB pptx, read as its underlying XML, runs to roughly 540,000 tokens once tags and style attributes are counted: that alone does not fit in a 200k context window. Converting the same file to plain Markdown first, then pasting or attaching that instead, keeps the content and drops the packaging: the same pptx converts to about 22,600 tokens, a 23.8x reduction measured on that file.

## Stay inside the prompt cache's TTL

Claude Code's prompt cache expires on a timer. Coming back to a session after that window closes means the next turn re-reads the accumulated context at full price instead of the roughly 10% a cache hit costs. If you're stepping away and plan to return, sending one more message before the TTL lapses keeps the cache warm; if you know you won't be back in time, there's no penalty for letting it expire naturally, but it's worth knowing that's why the next message after a long gap costs more than usual.

## What Sprag automates on top of this

Doing all of the above by hand works, but it depends on remembering to do it every session. Sprag installs once and wires these into the harness instead of into your memory:

- **route-scan** reads your own session logs after the fact, finds requests an expensive model handled repeatedly, and writes delegation rules that send that pattern to a Haiku or Sonnet subagent from then on: no model switching in the main session, so the cache stays intact. See [route-scan](./ROUTE_SCAN.md).
- **doc2md** converts pptx, xlsx, pdf, docx and Figma `.fig` files to Markdown automatically, with the source and conversion time noted at the top of the output. See [doc2md](./DOC2MD.md).
- **The statusline** prints cache hit rate, the TTL countdown, context usage, and both rate-limit windows on every turn, so a cache miss or a context spike is visible before it becomes a surprise bill. See [statusline](./STATUSLINE.md).
- **The harness** turns a repeated mistake into a one-line rule loaded every session, so the same correction doesn't cost tokens twice. See [harness](./HARNESS.md).

```bash
npm i -g sprag-cli
```

Related: [Claude Code usage limits](./GUIDE-USAGE-LIMITS.md) · [Why realtime model routing costs more](./NOT-A-ROUTER.md) · [Command reference](./COMMANDS.md)
