import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { TaskManager } from "./task-manager.js";
import type { SubmitTaskInput } from "./types.js";

const budgetSchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
  maxResponseTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  commandTimeoutMs: z.number().int().positive().optional(),
}).optional();

export function createMcpServer(manager: TaskManager): McpServer {
  const server = new McpServer({ name: "scrooge-mcp", version: "0.1.0" });

  server.registerTool("submit_task", {
    description: "Submit a coding task to the persistent DeepSeek Harness worker. Call wait_task after submission.",
    inputSchema: {
      task: z.string().min(1),
      workspaceRoot: z.string().min(1),
      permissionProfile: z.enum(["read_only", "workspace_write", "unrestricted"]).optional(),
      allowDestructive: z.boolean().optional(),
      reasoningEffort: z.enum(["off", "low", "high", "max"]).optional(),
      budget: budgetSchema,
    },
  }, async input => {
    const request = {
      task: input.task,
      workspaceRoot: input.workspaceRoot,
      ...(input.permissionProfile === undefined ? {} : { permissionProfile: input.permissionProfile }),
      ...(input.allowDestructive === undefined ? {} : { allowDestructive: input.allowDestructive }),
      ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
      ...(input.budget === undefined ? {} : { budget: input.budget }),
    } as SubmitTaskInput;
    return textResult(await manager.submit(request));
  });

  server.registerTool("wait_task", {
    description: "Wait on a task without polling. The server blocks until the task ends or the wait limit expires.",
    inputSchema: {
      taskId: z.string().uuid(),
      maxWaitMs: z.number().int().positive().optional(),
    },
  }, async ({ taskId, maxWaitMs }) => textResult(await manager.wait(taskId, maxWaitMs ?? 600_000)));

  server.registerTool("get_task", {
    description: "Get a task snapshot, progress, timing estimate, result, errors, and token usage.",
    inputSchema: { taskId: z.string().uuid() },
  }, async ({ taskId }) => textResult(manager.get(taskId)));

  server.registerTool("cancel_task", {
    description: "Cancel a queued or running task.",
    inputSchema: { taskId: z.string().uuid() },
  }, async ({ taskId }) => textResult(await manager.cancel(taskId)));

  server.registerTool("list_tasks", {
    description: "List recent delegated tasks.",
    inputSchema: {
      status: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]).optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
  }, async ({ status, limit }) => textResult(manager.list(status, limit)));

  return server;
}

export async function startMcpServer(manager: TaskManager): Promise<void> {
  const server = createMcpServer(manager);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
