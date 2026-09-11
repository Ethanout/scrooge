import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { access, realpath } from "node:fs/promises";
import type { ScroogeConfig } from "./config.js";
import { resolveBudget } from "./config.js";
import { initialEstimate, runningEstimate } from "./estimator.js";
import type { AgentHarness, HarnessRunResult, SubmitTaskInput, TaskRecord, TaskStatus } from "./types.js";
import { EMPTY_USAGE, isTerminalStatus } from "./types.js";
import { TaskStore } from "./task-store.js";

export class TaskManager {
  readonly #config: ScroogeConfig;
  readonly #store: TaskStore;
  readonly #harness: AgentHarness;
  readonly #tasks = new Map<string, TaskRecord>();
  readonly #abortControllers = new Map<string, AbortController>();
  readonly #waiters = new Map<string, Set<() => void>>();
  #running = 0;

  constructor(config: ScroogeConfig, store: TaskStore, harness: AgentHarness) {
    this.#config = config;
    this.#store = store;
    this.#harness = harness;
  }

  async initialize(): Promise<void> {
    await this.#store.initialize();
    const tasks = await this.#store.list(Number.MAX_SAFE_INTEGER);
    for (const task of tasks) this.#tasks.set(task.id, task);
    await this.#store.interruptActiveTasks();
    for (const task of this.#tasks.values()) {
      if (task.status === "queued" || task.status === "running") task.status = "interrupted";
    }
  }

  async submit(input: SubmitTaskInput): Promise<TaskRecord> {
    const workspaceRoot = await validateWorkspace(input.workspaceRoot);
    const permissionProfile = input.permissionProfile ?? "workspace_write";
    if (input.allowDestructive === true && permissionProfile !== "unrestricted") {
      throw new Error("allowDestructive requires the unrestricted permission profile");
    }
    const now = new Date().toISOString();
    const estimate = initialEstimate(input.task, permissionProfile, [...this.#tasks.values()]);
    const task: TaskRecord = {
      id: randomUUID(),
      task: input.task.trim(),
      workspaceRoot,
      permissionProfile,
      allowDestructive: input.allowDestructive === true,
      reasoningEffort: input.reasoningEffort ?? this.#config.defaultReasoningEffort,
      budget: resolveBudget(input.budget, this.#config),
      status: "queued",
      phase: "queued",
      progressPercent: 0,
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      completedAt: null,
      elapsedMs: null,
      ...estimate,
      sessionId: await this.#store.getWorkspaceSession(workspaceRoot),
      harnessVersion: null,
      result: null,
      error: null,
      usage: { ...EMPTY_USAGE },
      logTail: [],
    };
    if (task.task.length === 0) throw new Error("task must not be empty");
    this.#tasks.set(task.id, task);
    await this.#store.save(task);
    void this.drain();
    return this.snapshot(task);
  }

  get(id: string): TaskRecord {
    const task = this.#tasks.get(id);
    if (task === undefined) throw new Error(`Task not found: ${id}`);
    this.refreshEstimate(task);
    return this.snapshot(task);
  }

  list(status?: TaskStatus, limit = 50): TaskRecord[] {
    return [...this.#tasks.values()]
      .filter(task => status === undefined || task.status === status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.min(100, Math.max(1, limit)))
      .map(task => { this.refreshEstimate(task); return this.snapshot(task); });
  }

  async wait(id: string, maxWaitMs: number): Promise<TaskRecord> {
    const task = this.get(id);
    if (isTerminalStatus(task.status)) return task;
    const waitMs = Math.min(this.#config.maxWaitMs, Math.max(1_000, maxWaitMs));
    await new Promise<void>(resolveWait => {
      const timer = setTimeout(resolveWait, waitMs);
      const callback = () => { clearTimeout(timer); resolveWait(); };
      const waiters = this.#waiters.get(id) ?? new Set<() => void>();
      waiters.add(callback);
      this.#waiters.set(id, waiters);
    });
    return this.get(id);
  }

  async cancel(id: string): Promise<TaskRecord> {
    const task = this.#tasks.get(id);
    if (task === undefined) throw new Error(`Task not found: ${id}`);
    if (isTerminalStatus(task.status)) return this.snapshot(task);
    task.status = "cancelled";
    task.phase = "cancelled";
    task.error = { code: "CANCELLED", message: "The task was cancelled by the MCP client.", retryable: true };
    task.completedAt = new Date().toISOString();
    task.elapsedMs = task.startedAt === null ? 0 : Date.parse(task.completedAt) - Date.parse(task.startedAt);
    task.updatedAt = task.completedAt;
    this.#abortControllers.get(id)?.abort();
    await this.persistAndNotify(task);
    return this.snapshot(task);
  }

  async close(): Promise<void> {
    for (const controller of this.#abortControllers.values()) controller.abort();
    if ("close" in this.#harness && typeof this.#harness.close === "function") await this.#harness.close();
  }

  private async drain(): Promise<void> {
    while (this.#running < this.#config.maxConcurrency) {
      const task = [...this.#tasks.values()].find(candidate => candidate.status === "queued");
      if (task === undefined) return;
      this.#running += 1;
      void this.execute(task).finally(() => {
        this.#running -= 1;
        void this.drain();
      });
    }
  }

  private async execute(task: TaskRecord): Promise<void> {
    const now = new Date().toISOString();
    task.status = "running";
    task.phase = "starting";
    task.startedAt = now;
    task.updatedAt = now;
    task.progressPercent = 1;
    const controller = new AbortController();
    this.#abortControllers.set(task.id, controller);
    await this.persistAndNotify(task);
    try {
      const result = await this.#harness.run({
        taskId: task.id,
        task: buildPrompt(task),
        workspaceRoot: task.workspaceRoot,
        permissionProfile: task.permissionProfile,
        allowDestructive: task.allowDestructive,
        reasoningEffort: task.reasoningEffort,
        budget: task.budget,
        previousSessionId: task.sessionId,
        signal: controller.signal,
        onProgress: async progress => {
          if (progress.phase !== undefined) task.phase = progress.phase;
          if (progress.progressPercent !== undefined) task.progressPercent = progress.progressPercent;
          if (progress.message !== undefined) task.logTail = [...task.logTail, progress.message].slice(-20);
          if (progress.usage !== undefined) task.usage = { ...task.usage, ...progress.usage };
          task.updatedAt = new Date().toISOString();
          this.refreshEstimate(task);
          await this.persistAndNotify(task);
        },
      });
      await this.finishSuccess(task, result);
    } catch (error) {
      task.status = controller.signal.aborted ? "cancelled" : "failed";
      task.phase = task.status;
      task.error = { code: task.status === "cancelled" ? "CANCELLED" : "HARNESS_FAILED", message: errorMessage(error), retryable: task.status !== "cancelled" };
      task.completedAt = new Date().toISOString();
      task.elapsedMs = Date.parse(task.completedAt) - Date.parse(task.startedAt ?? task.completedAt);
      task.updatedAt = task.completedAt;
    } finally {
      this.#abortControllers.delete(task.id);
      await this.persistAndNotify(task);
    }
  }

  private async finishSuccess(task: TaskRecord, result: HarnessRunResult): Promise<void> {
    task.status = "succeeded";
    task.phase = "completed";
    task.progressPercent = 100;
    task.completedAt = new Date().toISOString();
    task.elapsedMs = Date.parse(task.completedAt) - Date.parse(task.startedAt ?? task.completedAt);
    task.updatedAt = task.completedAt;
    task.sessionId = result.sessionId;
    task.harnessVersion = result.harnessVersion;
    task.result = { assistantText: result.assistantText, stopReason: result.stopReason, changedFiles: [], verification: [], toolCalls: result.toolCalls };
    task.usage = result.usage;
    await this.#store.setWorkspaceSession(task.workspaceRoot, result.sessionId);
  }

  private refreshEstimate(task: TaskRecord): void {
    if (task.status !== "running") return;
    Object.assign(task, runningEstimate(task));
  }

  private async persistAndNotify(task: TaskRecord): Promise<void> {
    await this.#store.save(task);
    if (isTerminalStatus(task.status)) {
      for (const waiter of this.#waiters.get(task.id) ?? []) waiter();
      this.#waiters.delete(task.id);
    }
  }

  private snapshot(task: TaskRecord): TaskRecord {
    return structuredClone(task);
  }
}

function buildPrompt(task: TaskRecord): string {
  return [
    `Work on the coding task below in workspace ${task.workspaceRoot}.`,
    `Permission profile: ${task.permissionProfile}. Destructive operations allowed: ${task.allowDestructive}.`,
    `Use reasoning effort ${task.reasoningEffort}.`,
    "Inspect before editing. Keep changes focused. Run relevant verification before finishing.",
    "If a file changed after you read it, reread it before applying a patch.",
    `Task:\n${task.task}`,
  ].join("\n\n");
}

async function validateWorkspace(input: string): Promise<string> {
  const workspace = resolve(input);
  await access(workspace);
  return realpath(workspace);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
