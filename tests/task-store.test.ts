import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TaskStore } from "../src/task-store.js";
import type { TaskRecord } from "../src/types.js";

function task(id: string): TaskRecord {
  const now = new Date().toISOString();
  return {
    id, task: "test", workspaceRoot: process.cwd(), permissionProfile: "read_only", allowDestructive: false,
    reasoningEffort: "high", budget: { timeoutMs: 1, maxTurns: 1, maxResponseTokens: 1, maxOutputTokens: 1, commandTimeoutMs: 1 },
    status: "queued", phase: "queued", progressPercent: 0, createdAt: now, startedAt: null, updatedAt: now,
    completedAt: null, elapsedMs: null, estimatedCompletionAt: now, estimatedRemainingMs: 1, estimateConfidence: "low",
    recommendedWaitMs: 1, sessionId: null, harnessVersion: null, result: null, error: null,
    usage: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, estimatedCostUsd: null }, logTail: [],
  };
}

describe("task store", () => {
  it("persists tasks and workspace sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "scrooge-store-"));
    try {
      const store = new TaskStore(root);
      const record = task("00000000-0000-4000-8000-000000000001");
      await store.save(record);
      expect(await store.get(record.id)).toMatchObject({ id: record.id });
      await store.setWorkspaceSession("workspace", "session-1");
      expect(await store.getWorkspaceSession("workspace")).toBe("session-1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
