# Scrooge MCP

Scrooge is a local MCP task broker for Codex desktop. It delegates coding work to DeepSeek through the DeepSeek Harness ACP interface, so the main model can submit a task, wait without repeated polling, and retrieve the result later.

Scrooge is a developer-preview integration. DSH may introduce breaking changes. The adapter uses ACP v1 instead of importing DSH internals.

## 中文使用方法

要求 Node.js `22.19.0+`。安装 DSH，设置 API key，然后构建：

```powershell
npm install --global @deepseek-ai/dsh@0.1.5-rc.2
$env:DEEPSEEK_API_KEY = "sk-your-key"
npm install
npm run build
```

将 [`examples/codex-config.toml`](examples/codex-config.toml) 加入 `%USERPROFILE%/.codex/config.toml`，并替换为 Node.js 和 `dist/index.js` 的绝对路径。Codex 自带 Node.js `24.19.0` 可以使用。

调用流程：调用 `submit_task`，读取 `recommended_wait_ms`，用该值调用一次 `wait_task`；超时后使用快照中的新等待建议，或调用 `get_task`。不要高频轮询。

权限档为 `read_only`、`workspace_write`（默认）和 `unrestricted`。破坏性操作还必须显式设置 `allowDestructive: true`。命令限制是策略检查，不是操作系统安全沙箱。

默认 reasoning 为 `high`，单次响应上限为 `32,768` output tokens，任务总 output 预算为 `160,000` tokens。工作区会话在 MCP 进程内复用，以保持稳定前缀并提高缓存命中机会。

## 给 AI 的接入方法

将以下规则放入主模型的系统提示词或工具使用说明：

```text
你可以使用 Scrooge MCP 将较大的代码任务委托给 DeepSeek 子代理。
1. 适合异步执行、需要多轮文件操作或测试时调用 submit_task。
2. workspaceRoot 必须是用户明确授权的工作区绝对路径。
3. 默认 permissionProfile=workspace_write；只读分析使用 read_only；只有用户明确要求时使用 unrestricted。
4. allowDestructive 默认 false。只有用户明确授权删除、强制覆盖或系统配置修改时才设为 true，且 permissionProfile 必须是 unrestricted。
5. submit_task 返回后读取 recommended_wait_ms，并调用一次 wait_task，不要循环调用 get_task。
6. wait_task 超时后使用返回快照中的 recommended_wait_ms 再等待。
7. succeeded 时检查 result、changed files 和 verification；其他终态向用户说明 error。
8. 不要把 DEEPSEEK_API_KEY 放入 task、工具参数、日志或回复。
9. 不要声称缓存命中率或费用是精确值，除非服务返回对应计量字段。
```

## English Usage

Node.js `22.19.0+` is required. Install DSH, set `DEEPSEEK_API_KEY`, run `npm install`, then `npm run build`. Copy [`examples/codex-config.toml`](examples/codex-config.toml) into `%USERPROFILE%/.codex/config.toml` and replace paths with absolute paths.

Workflow: call `submit_task`, read `recommended_wait_ms`, call `wait_task` once, then use the new recommendation after a timeout. Do not poll frequently. Permission profiles are `read_only`, `workspace_write` (default), and `unrestricted`; destructive actions additionally require `allowDestructive: true`. These are policy checks, not an OS sandbox.

The default reasoning effort is `high`. The single-response limit is `32,768` output tokens and the total task output budget is `160,000` tokens. One ACP session is reused per workspace during the process lifetime to keep the prompt prefix stable and improve cache opportunities.

## Integration instructions for the main AI

Give these rules to Codex or another main model as system or tool-use guidance:

```text
You may delegate large coding tasks to the DeepSeek sub-agent through Scrooge MCP.
1. Use submit_task for asynchronous work that needs multiple file operations, tool calls, or tests.
2. workspaceRoot must be an absolute path explicitly authorized by the user.
3. Use permissionProfile=workspace_write by default; use read_only for inspection-only work; use unrestricted only when explicitly requested.
4. Keep allowDestructive=false by default. Set it true only for explicit authorization of deletion, force overwrite, or system configuration changes, and only with unrestricted.
5. After submit_task, read recommended_wait_ms and call wait_task once. Do not repeatedly poll with get_task.
6. If wait_task times out, wait using the returned recommended_wait_ms.
7. On succeeded, inspect result, changed files, and verification. On other terminal states, report error.
8. Never put DEEPSEEK_API_KEY in task text, tool arguments, logs, or replies.
9. Do not claim exact cache-hit rates or cost unless the service provides those billing fields.
```

## DSH and caching

DSH is a developer preview and may break between releases. Scrooge communicates through ACP v1 and does not import DSH internals. If the ACP contract changes, update [`src/harness.ts`](src/harness.ts). After a process restart, the current version starts a new ACP session and does not claim cache continuity. ACP currently exposes context occupancy, not exact cache billing counters.

## Documentation

- [中文完整指南](docs/USAGE.zh-CN.md)
- [English full guide](docs/USAGE.en.md)
- [Codex configuration](examples/codex-config.toml)
- [Environment variables](.env.example)

## Development

```powershell
npm test
npm run typecheck
npm run build
```
