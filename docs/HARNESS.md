# Harness, compact-window and seed

[← README](../README.md) · [한국어](./HARNESS.ko.md)

## 🅷 Harness mode

Bootstrap five engineering principles (Ratchet · Evidence · PEV · Structured Task · Default Safe Path) into `CLAUDE.md` with one command; the statusline scores it as `🅷 5/5`. When the same error keeps recurring, a `🅷⚠ ratchet?` nudge appears so you can promote it to a rule.

```bash
sprag harness init                # this project
sprag harness init --global       # ~/.claude/CLAUDE.md — every project
sprag harness check               # current score (global fallback honored)
sprag harness analyze             # run the transcript analysis manually (no hook needed); refreshes harness-state.json
sprag harness promote <N> --global|--project   # warning #N → ratchet rule (scope required)
sprag harness promote "<rule text>" --global|--project  # register your own hand-written rules the same way
sprag harness pull                # register the package's curated ratchet rules into your global ratchet (opt-in, dedupes)
sprag harness list / rm <N>       # view / delete rules (auto .bak)
sprag harness off | on            # toggle the 🅷 chip
```

- `promote` **requires** `--project`/`--global` in non-TTY contexts (scripts, LLM calls) — a scope choice is never silently made for the caller.
- `pull` registers the **author-curated ratchet rules** bundled with the package (`presets/ratchet-rules.json` — only general-purpose rules promoted from real recurring mistakes) into your global ratchet (`~/.claude/ratchet.md`). `install`/`init` never auto-inject anything; `pull` is always opt-in and idempotent. Drop any rule you dislike with `harness rm`.
- `seed` offers the same presets **one at a time**. Where `pull` registers the whole ratchet set in one go, `seed` covers the model-fitting presets too and asks about each of them in the first session after an install or upgrade ([below](#-seed-delegation-that-works-from-the-first-session)).
- 🅷⚠ runtime warnings (`ratchet?` `no-evidence` `PEV-skip`) expire after 30 minutes, subdirectory sessions match their project correctly, and PEV-skip counts only mutating tools (Edit/Write/Bash) so read-only research sessions don't trip it (v2.16.0+).

<details>
<summary>⚠️ <code>harness rm</code> — checklist before deleting</summary>

The whole point of the ratchet is **one-direction accumulation**. Deleting rules casually means the same mistakes return.

- **Rule too broad, blocking valid cases?** → ❌ delete ✅ narrow the condition (e.g. `"no hardcoded values"` → `"no hardcoded values outside tests"`)
- **Rule too narrow, almost never fires?** → ❌ delete ✅ leave it (zero cost)
- **Genuinely wrong?** → ✅ delete then

An auto `.bak` is kept, but **the session context that earned the rule its place is not recoverable.**
</details>


## 📦 compact-window — pin where a 1M session compacts

Claude Code compacts when usage approaches `min(autoCompactWindow, model max context)`. On a 1M window, with that value unset, compaction only fires near 800k — and until then every request re-bills the whole context. **1M is too large; the recommendation is a 400k–700k band** — 2–3.5x a 200k session's headroom for the genuinely large pastes, with the runaway tail cut off.

**Anything inside the band is left alone.** 400k is the floor where the saving beats the extra compactions, and long sessions often want more room than that. Only an unset window, or one above 700k, is warned about (a smaller one is a deliberate, more aggressive choice).

**200k sessions are never warned** — their window is already at or below 200k, so the setting cannot change anything.

```bash
sprag compact-window                       # status (model, window, value, source)
sprag compact-window set --global          # pin 500k (mid-band) in ~/.claude/settings.json
sprag compact-window set --project         # pin it in <root>/.claude/settings.json
sprag compact-window set --global --value 600k   # explicit value (100k–1M)
sprag compact-window off | on              # toggle the warning
```

- On a 1M model with the value unset or above 700k, the statusline shows `🅷⚠ compact-window?` and the session briefing hands the model the exact registration command.
- Scope (`--global`/`--project`) is **required** for `set` — a global settings file is never edited on a guess.
- Every other key in `settings.json` is preserved and a `.bak` is written first. Malformed JSON aborts the write untouched.
- An exported `CLAUDE_CODE_AUTO_COMPACT_WINDOW` beats settings.json; `set` detects that and says so.

## 🌱 seed: delegation that works from the first session

The model-fitting ratchet (`ratchet-model.md`) **starts empty.** A rule exists only after route-scan has seen the same kind of work recur in your own logs and you have approved that candidate. So a fresh install delegates nothing, and keeps delegating nothing for days — precisely the stretch where the savings would matter most.

`seed` fills that gap from presets bundled with the package.

| Presets | What they cover | File |
|---|---|---|
| 9 model-fitting | running commands, lookup, status checks, questions about pasted logs, read-and-summarize — each with a T2 (haiku) and a T1 (sonnet) rule | `presets/model-rules.json` |
| 6 ratchet | general-purpose rules promoted from mistakes that actually recurred | `presets/ratchet-rules.json` |

**How they get registered:** in the first session after an install or upgrade, the SessionStart hook hands the pending presets to the model, which walks the user through them **one at a time**. Each answer runs one of these immediately:

```bash
sprag seed                                   # pending presets + recorded answers
sprag seed accept <id> --global|--project     # register one (scope required)
sprag seed accept all --global                # when the user says "register them all"
sprag seed skip <id>                          # decline — never offered again
sprag seed reset                              # clear the answers and offer everything again
```

- **Nothing is written without a yes to that specific rule.** A declined rule stays declined across upgrades; a later release only surfaces the presets it actually added.
- A preset is withheld when you already approved a rule of the same shape (same tier and category).
- A seeded rule **does not pass someone else's statistics off as yours.** It is recorded as `preset (curated)` until a scan measures real firings and delegations, and then those numbers replace it. If its delegated error rate crosses the threshold it gets the same review flag as any other rule.
- The scope must be stated as `--global` or `--project`. The hook environment is non-TTY, so the CLI cannot ask — the model confirms with the user and passes the flag.

---
