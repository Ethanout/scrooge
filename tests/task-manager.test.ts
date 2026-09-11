import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskStore } from "../src/task-store.js";
import type { AgentHarness, HarnessRunOptions } from "../src/types.js";

class FakeHarness implements AgentHarness {
  async run(options: HarnessRunOptions) {
    await options.onProgress({ phase: "testing", progressPercent: 50 });
    return {
      assistantText: "done", stopReason: "end_turn", sessionId: "session-1", harnessVersion: "test", toolCalls: [],
      usage: { inputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 0, outputTokens: 2, reasoningTokens: 1, totalTokens: 3, estimatedCostUsd: 0 },
    };
  }
}

describe("task manager", () => {
  it("runs and reports an async task", async () => {
    const root = await mkdtemp(join(tmpdir(), "scrooge-manager-"));
    try {
      const config = loadConfig({ LOCALAPPDATA: root, SCROOGE_DEFAULT_TIMEOUT_MS: "10000", SCROOGE_MAX_TIMEOUT_MS: "20000" });
      const manager = new TaskManager(config, new TaskStore(root), new FakeHarness());
      await manager.initialize();
      const created = await manager.submit({ task: "run test", workspaceRoot: root });
      const result = await manager.wait(created.id, 5_000);
      expect(result.status).toBe("succeeded");
      expect(result.result?.assistantText).toBe("done");
      expect(result.usage.cacheReadTokens).toBe(1);
      await manager.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires unrestricted permission for destructive mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "scrooge-manager-"));
    try {
      const config = loadConfig({ LOCALAPPDATA: root });
      const manager = new TaskManager(config, new TaskStore(root), new FakeHarness());
      await manager.initialize();
      await expect(manager.submit({ task: "delete", workspaceRoot: root, allowDestructive: true })).rejects.toThrow("unrestricted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
