# Scrooge MCP English Usage Guide

## Architecture

Scrooge is a local `stdio` MCP server. Codex desktop calls Scrooge over MCP. Scrooge maintains a durable task queue and delegates work to DeepSeek `deepseek-flash` through DSH ACP v1. Task records live under `%LOCALAPPDATA%/scrooge-mcp`, outside the repository and workspace.

The default concurrency is two tasks. Terminal states are persisted. On process restart, queued and running tasks are marked `interrupted`; side-effecting work is not replayed automatically.

## Install and configure

```powershell
npm install --global @deepseek-ai/dsh@0.1.5-rc.2
dsh --version
npm install
npm run build
```

Add `examples/codex-config.toml` to `%USERPROFILE%/.codex/config.toml`, replace all paths with absolute paths, and put the real API key directly in `[mcp_servers.scrooge.env]` as `DEEPSEEK_API_KEY`. Codex desktop passes it when starting the MCP server, so no PowerShell environment variable is needed. Never commit that config file.

## Tool workflow

Use `submit_task` -> `wait_task` -> `get_task`. The submission response includes estimated completion time, remaining milliseconds, confidence, and a recommended wait. `wait_task` blocks inside the server, avoiding high-frequency polling and unnecessary main-model inference.

Important inputs: `task` describes the goal and acceptance checks; `workspaceRoot` is an authorized absolute path; `permissionProfile` is `read_only`, `workspace_write`, or `unrestricted`; `allowDestructive` is false by default; `reasoningEffort` is `off`, `low`, `high`, or `max`.

## Security boundary

`workspace_write` permits edits and normal verification inside the workspace. `unrestricted` is required for commands outside it. Destructive operations additionally require `allowDestructive=true`. Timeouts, output caps, and path checks are application-level policy, not an OS sandbox. Do not run untrusted work against sensitive data.

## Caching and cost

One ACP session is reused per workspace during the process lifetime. Stable prompt and tool ordering improve DeepSeek prefix-cache opportunities. The current version starts a new session after a process restart and does not claim cache continuity. ACP currently exposes context occupancy rather than exact cache hit/miss billing counters.
