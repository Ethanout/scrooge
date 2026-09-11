# Scrooge MCP 中文使用指南

## 工作原理

Scrooge 是本地 `stdio` MCP 服务。Codex desktop 通过 MCP 调用 Scrooge，Scrooge 维护任务队列，再通过 DSH 的 ACP v1 接口调用 DeepSeek `deepseek-flash`。任务记录写入 `%LOCALAPPDATA%/scrooge-mcp`，不会写入代码工作区。

默认最多并行运行两个任务。任务完成、失败、取消或服务重启时都会保存终态。服务重启不会自动重放未完成任务。

## 安装和配置

```powershell
npm install --global @deepseek-ai/dsh@0.1.5-rc.2
dsh --version
$env:DEEPSEEK_API_KEY = "sk-your-key"
npm install
npm run build
```

将 `examples/codex-config.toml` 加入 `%USERPROFILE%/.codex/config.toml`，并替换全部路径为绝对路径。API key 只通过环境变量提供。

## 工具调用

推荐流程是 `submit_task` -> `wait_task` -> `get_task`。提交后服务返回预计完成时间、剩余毫秒数、置信度和推荐等待时间。`wait_task` 在服务端阻塞，不会让主模型高频轮询。

主要参数：`task` 是任务和验收标准，`workspaceRoot` 是用户授权的绝对路径，`permissionProfile` 是 `read_only`、`workspace_write` 或 `unrestricted`，`allowDestructive` 默认 false，`reasoningEffort` 可以是 `off`、`low`、`high` 或 `max`。

## 安全边界

`workspace_write` 允许工作区内代码修改和常规测试。`unrestricted` 才允许工作区外命令。破坏性操作还需要 `allowDestructive=true`。命令超时、输出大小和路径规则是应用层策略，不是 OS 沙箱；不要把不可信任务放在含有敏感数据的环境中。

## 缓存和费用

同一工作区在服务进程内复用一个 ACP 会话，并保持稳定提示词和工具顺序，有利于 DeepSeek 前缀缓存。服务重启后当前版本使用新会话，不保证缓存连续性。ACP 当前只提供上下文占用，不提供精确 cache hit/miss 计费字段，因此不会把上下文占用伪装成计费数据。
