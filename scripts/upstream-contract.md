# What sprag relies on from Claude Code and Codex

This list is the input to `scripts/upstream-watch.mjs`. It is compiled from the code by grep, so the file:line pointers drift as the code changes; treat them as starting points and re-check with Grep before relying on one. A release note that touches any item below can break sprag or change what it shows.

## (a) Claude Code settings.json keys

- `statusLine` (`command`, `refreshInterval`, `type`) is written and repaired in `~/.claude/settings.json`; used by `src/installer.js:417` and `src/installer.js:484`.
- `hooks.SessionStart`, `hooks.UserPromptSubmit`, `hooks.PostToolUse`, `hooks.PreToolUse` are written as arrays of `{ matcher, hooks: [{ type: 'command', command, timeout }] }`; used by `src/installer.js:513` and `src/hook-manager.js:76`.
- `autoCompactWindow` (number or `"auto"`) at the top level, plus `modelSettings[<canonical model id>].autoCompactWindow` (Claude Code 2.1.288+); read and written by `src/compact-window.js:199` and `src/compact-window.js:377`.
- Settings precedence that sprag mirrors: managed policy, local project, project, user `settings.json`; used by `src/compact-window.js:22`.
- `claudeMdExcludes` (array of path patterns) is appended to skip generated Cowork copies; used by `src/cowork-sync.js:236`.
- `env` block of settings.json (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_PLUGIN_DIRS`) is read and, for the plugin dirs, written; used by `src/gateway-auth.js:117` and `src/installer.js:866`.
- `apiKeyHelper` is executed the same way Claude Code does, from `settings.local.json`, `settings.json` project and user; used by `src/gateway-auth.js:67`.
- `enabledPlugins` is read to avoid loading a module twice; used by `src/installer.js:876`.
- `theme` in `~/.claude.json` or settings.json picks the effort colors; used by `src/effort-palette.js:108`.
- Agent files `~/.claude/agents/<name>.md` with frontmatter `name`, `description`, `tools`, `model`, `effort` are written and read back; used by `src/delegation-agents.js:56` and `src/delegation-agents.js:151`.
- `~/.claude/CLAUDE.md` `@` imports of the ratchet files, and `.claude/ratchet*.md` in projects; used by `src/harness.js:78`.

## (b) Statusline stdin payload

- `model.id` and `model.display_name`, including Bedrock and LiteLLM style ids; used by `src/stdin-payload.js:180`.
- `context_window.used_percentage` and `context_window.context_window_size`; used by `src/stdin-payload.js:164`.
- `rate_limits.<window>.used_percentage` and `resets_at` for any window key (`five_hour`, `seven_day`, per-model windows), plus `used_usd` and `limit_usd` on a gateway spend limit (2.1.284+); used by `src/stdin-payload.js:99`.
- `effort.level`, absent for models without an effort setting; used by `src/stdin-payload.js:215`.
- `session_id` and `transcript_path`; used by `src/stdin-payload.js:177` and `src/stdin-payload.js:230`.
- Statusline refresh cadence and the payload being sent on stdin as one JSON blob every refresh; used by `src/stdin-payload.js:27`.
- The desktop app Code tab never runs `statusLine.command`; the `sprag-statusline` mod covers it with the `claude-code` mod API (`atom`, `read`, `update`, `Register`, `SessionUsage`); used by `mod/sprag-statusline/hooks/register.tsx:1`.

## (c) Hook events and payloads

- PostToolUse payload `{ session_id, transcript_path, cwd, tool_name, tool_input, tool_response }` for the cache monitor; used by `src/hook.cjs:10`.
- PreToolUse on `tool_name` `Task` or `Agent`, reading `tool_input.model`, `tool_input.subagent_type`, `tool_input.prompt`; used by `src/delegation-guard.js:124` and `src/delegation-guard.js:246`.
- PreToolUse output shape `hookSpecificOutput` with `hookEventName`, `updatedInput`, `permissionDecision`, `permissionDecisionReason`, `additionalContext`; used by `src/delegation-guard.js:280` and `src/doc2md.cjs:1027`.
- PostToolUse `additionalContext` nudges; used by `src/commands/brief.js:30`.
- SessionStart and UserPromptSubmit hooks that print context for the model; used by `src/installer.js:513` and `src/route-inject.js:168`.
- Edit and Write tool names with `tool_input.file_path` in the doc2md guard; used by `src/doc2md.cjs:964`.
- `hook_event_name`, `agent_id`, `session_id` in follow-up tracking; used by `src/route-follow.js:193` and `src/route-follow.js:207`.
- Plugin/mod hook manifests `mod/*/hooks/hooks.json` with `modules`, and `.claude-plugin/plugin.json`; used by `package.json:26`.

## (d) Transcript JSONL

- Location `~/.claude/projects/<munged cwd>/<sessionId>.jsonl`; used by `src/parser.js:10`.
- Subagent transcripts at `<sessionId>/subagents/agent-<id>.jsonl` and `.meta.json` with `agentType`, `description`, `toolUseId`, `spawnDepth`; used by `src/subagent-records.js:11`.
- Entry fields `type` (`user`, `assistant`, `attachment`), `timestamp`, `sessionId`, `requestId`, `cwd`, `isSidechain`, `toolUseResult`; used by `src/parser.js:44` and `src/session-records.js:106`.
- `message.id`, `message.model` (including `<synthetic>`), `message.usage` with `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`; used by `src/parser.js:55`.
- Gateway-shaped usage keys `inference_geo`, `iterations`, `speed`; used by `src/parser.js:19`.
- Attachment entries `ultra_effort_enter` and `ultra_effort_exit`, and the command output strings `Set effort level to ...` and `Current effort level: ...`; used by `src/ultracode.js:64` and `src/ultracode.js:91`.
- Streaming duplicates share a `requestId`; sprag keeps the last one; used by `src/parser.js:27`.
- Declared model attachments in the transcript; used by `src/model-alias.js:380`.

## (e) Environment variables

- `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; used by `src/compact-window.js:234` and `src/commands/compact-window.js:81`.
- `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_FABLE_MODEL`; used by `src/model-alias.js:92`.
- `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`; used by `src/gateway-auth.js:36` and `src/oauth-budget.js:68`.
- `CLAUDE_CODE_OAUTH_TOKEN`, plus the credential store: macOS keychain item `Claude Code-credentials` and `~/.claude/.credentials.json` with `claudeAiOauth.accessToken`; used by `src/oauth-budget.js:94` and `src/oauth-budget.js:109`.
- `GET https://api.anthropic.com/api/oauth/usage` response with `extra_usage`; used by `src/oauth-budget.js:38`.
- `CLAUDE_CODE_PLUGIN_DIRS` (list separator is platform specific); used by `src/installer.js:866` and `src/commands/doc2md.js:179`.
- `CLAUDE_CODE_ENTRYPOINT`; used by `src/monthly-reset-offer.js:50`.
- `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`; used by `src/route-inject.js:168`.

## (f) Claude Code CLI behavior

- `claude --version` output parsed as a semver to gate features; used by `src/compact-window.js:41`.
- `/autocompact` writes `autoCompactWindow` and `"auto"` since 2.1.288; used by `src/compact-window.js:25`.
- Model aliases `opus`, `sonnet`, `haiku` in agent frontmatter and in `Task` `model`; used by `src/delegation-agents.js:57` and `src/model-alias.js:92`.
- `/effort` levels `low`, `medium`, `high`, `xhigh`, `max`, `ultracode`; used by `src/ultracode.js:67` and `src/effort-palette.js:9`.
- `claude --print --input-format stream-json` behavior for document blocks, measured once for the doc2md savings estimate; used by `src/doc2md-ledger.cjs:23`.
- `claude --continue` is recommended in user-facing advice; used by `src/advice.js:139`.
- Claude app Cowork sessions under `~/Library/Application Support/Claude/local-agent-mode-sessions/<org>/<account>/<session>/.claude/projects`; used by `src/cowork-sessions.js:37` and `src/cowork-sessions.js:67`.

## (g) Codex

- Home directory `CODEX_HOME` or `~/.codex`, with `config.toml`, `hooks.json`, `AGENTS.md`, `AGENTS.override.md`; used by `src/agent.js:7`, `src/codex/doctor.js:39` and `src/codex/harness.js:24`.
- `config.toml` keys `model_provider`, `model_providers.<name>`, profiles, `features.hooks` and the older `features.codex_hooks`; used by `src/codex/budget.js:13` and `src/codex/doctor.js:44`.
- Hook events `SessionStart`, `SubagentStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, output via `hookSpecificOutput.additionalContext`, `updatedInput`, `permissionDecision`; used by `src/codex/hooks.js:30` and `src/codex/delegation.js:420`.
- Hook payload fields `session_id`, `turn_id`, `cwd`, `transcript_path`, `tool_name`, `tool_input`, `model`, `model_provider`, `agent_id`; used by `src/codex/hooks.js:141` and `src/codex/ledger.js:120`.
- Tool names `spawn_agent`, `wait_agent` and their arguments `model`, `reasoning_effort`, `fork_turns`; used by `src/codex/delegation.js:304` and `src/codex/hooks.js:181`.
- Rollout log entries `session_meta`, `turn_context`, `event_msg` (`task_started`, `task_complete`, `turn_aborted`, `token_count`, `item_completed`, `exec_command_end`, `patch_apply_end`, `user_message`, `thread_settings_applied`), `response_item` (`message` with `phase: final_answer`, `function_call`, `custom_tool_call` and their outputs); used by `src/codex/parser.js:22` and `src/codex/parser.js:123`.
- `token_count` payload `info.total_token_usage` and `info.last_token_usage.input_tokens`; used by `src/codex/parser.js:337` and `src/codex/delegation.js:270`.
- A forked child writes its own `session_meta` first and then a copy of the parent's; used by `src/codex/parser.js:11`.
- CLI calls `codex features list` (lines like `multi_agent true`) and `codex debug models --bundled` (JSON); used by `src/codex/delegation-diagnostics.js:24` and `src/codex/delegation-diagnostics.js:30`.
- Env `CODEX_THREAD_ID`; used by `src/commands/codex.js:574`.
- Codex deferring SessionStart until the first prompt in some versions; used by `src/commands/codex.js:432`.
