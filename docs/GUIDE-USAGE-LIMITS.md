# Claude Code 5-hour and weekly usage limits, explained

[← README](../README.md) · [한국어](./GUIDE-USAGE-LIMITS.ko.md)

Claude Code enforces usage against two rolling windows: a shorter one (around 5 hours) and a longer one (around 7 days), each with its own reset time. Hitting either one stops new requests until that window resets. The fastest way to avoid getting cut off mid-task is to watch usage as you go rather than finding out when a request is refused, and to cut token spend per turn so the same window lasts longer.

## Why the limit exists per window, not per day

The two windows track independently and reset on their own schedules: the shorter window resets a few hours after it fills, the longer one resets on a weekly cycle. Because they're independent, it's possible to be well under one and close to the other; a burst of heavy sessions early in the week can exhaust the weekly window even while the 5-hour window keeps resetting cleanly in between. That's why watching only "have I hit a wall yet" undersells how close you are: the two numbers need to be checked separately.

## See both windows before you hit them

If you're not already watching this, the two things worth checking are how full each window is and when it resets. Claude Code can show how much of each window you have used when you ask for it. What it doesn't do by default is put that number in front of you continuously while you work, or warn you before you're close to the cap: that requires either checking manually or a tool that puts it in the terminal.

## Reduce what each turn costs so the window lasts longer

Heavier turns use up a window faster than light ones, so the practical lever is the same one that reduces cost generally: fewer tokens per turn means more turns fit in a window before it fills.

- **`/compact` and `/clear` at the right time.** Every turn re-bills accumulated context until it's compacted or cleared. Doing this deliberately when a task shifts, instead of waiting for automatic compaction, keeps sessions leaner. Details: [reducing Claude Code token usage](./GUIDE-REDUCE-TOKENS.md).
- **Push read-heavy work into a subagent.** A subagent that explores a codebase and returns a short answer keeps the exploration tokens out of your main context, so the main session's window fills more slowly.
- **Convert large documents before attaching them.** A raw pptx or PDF attachment can cost tens of thousands of tokens beyond the prompt itself. See [doc2md](./DOC2MD.md) for measured conversion savings.
- **Don't switch models mid-session to save cost.** It looks like it should help, but prompt caches are kept per model, so a mid-session switch starts a cold cache and re-reads the whole conversation at full price. See [why realtime routing costs more](./NOT-A-ROUTER.md).

## What Sprag adds: both windows in the statusline, every turn

Sprag's statusline reads the current-session and weekly rate-limit windows on every render and shows both as a progress bar with a reset time, for example:

```
✦ current ▰▰▰▰▰▰▰▱▱▱▱▱ 62% 🔄 21:33 · 📅 weekly ▰▰▰▰▰▱▱▱▱▱▱▱ 38% 🔄 Tue 19:33
```

When either window crosses 90%, the chip turns into a red warning (`🚨 5H NN%` or `🚨 7D NN%`) and moves to the front of the line, so it's the first thing you see rather than something you have to notice among other segments. If both windows cross 90% at the same time, the one resetting sooner is promoted to the red warning and the other stays visible as a highlighted segment, since the sooner reset is the one that actually matters for what to do next. Full segment reference: [statusline](./STATUSLINE.md).

When a cap is genuinely close and you need to preserve your work state before Claude Code pauses, `sprag handoff` writes the session's git state, model, recorded context and token usage, and the current limits to a Markdown file you can hand to a fresh session once the window resets.

```bash
npm i -g sprag-cli
sprag mode 7d     # switch the statusline's savings window to 7 days
```

Related: [Reduce Claude Code token usage](./GUIDE-REDUCE-TOKENS.md) · [Statusline reference](./STATUSLINE.md) · [Command reference](./COMMANDS.md)
