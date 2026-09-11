import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TaskRecord } from "./types.js";

export class TaskStore {
  readonly #tasksDir: string;
  readonly #sessionFile: string;

  constructor(dataDir: string) {
    this.#tasksDir = join(dataDir, "tasks");
    this.#sessionFile = join(dataDir, "workspace-sessions.json");
  }

  async initialize(): Promise<void> {
    await mkdir(this.#tasksDir, { recursive: true });
  }

  async save(task: TaskRecord): Promise<void> {
    await this.initialize();
    await atomicWrite(this.taskPath(task.id), JSON.stringify(task, null, 2));
  }

  async get(id: string): Promise<TaskRecord | null> {
    try {
      return JSON.parse(await readFile(this.taskPath(id), "utf8")) as TaskRecord;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async list(limit = 100): Promise<TaskRecord[]> {
    await this.initialize();
    const names = (await readdir(this.#tasksDir)).filter(name => name.endsWith(".json"));
    const tasks = await Promise.all(names.map(async name => JSON.parse(
      await readFile(join(this.#tasksDir, name), "utf8"),
    ) as TaskRecord));
    return tasks.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
  }

  async interruptActiveTasks(now = new Date().toISOString()): Promise<number> {
    const tasks = await this.list(Number.MAX_SAFE_INTEGER);
    const active = tasks.filter(task => task.status === "queued" || task.status === "running");
    await Promise.all(active.map(async task => {
      task.status = "interrupted";
      task.phase = "interrupted";
      task.updatedAt = now;
      task.completedAt = now;
      task.elapsedMs = task.startedAt === null ? 0 : Math.max(0, Date.parse(now) - Date.parse(task.startedAt));
      task.error = {
        code: "SERVER_RESTARTED",
        message: "The MCP server stopped before this task completed. The task was not replayed.",
        retryable: true,
      };
      await this.save(task);
    }));
    return active.length;
  }

  async getWorkspaceSession(workspaceKey: string): Promise<string | null> {
    const sessions = await this.readSessions();
    return sessions[workspaceKey] ?? null;
  }

  async setWorkspaceSession(workspaceKey: string, sessionId: string): Promise<void> {
    const sessions = await this.readSessions();
    sessions[workspaceKey] = sessionId;
    await atomicWrite(this.#sessionFile, JSON.stringify(sessions, null, 2));
  }

  private taskPath(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid task ID");
    return join(this.#tasksDir, `${id}.json`);
  }

  private async readSessions(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.#sessionFile, "utf8")) as Record<string, string>;
    } catch (error) {
      if (isMissing(error)) return {};
      throw error;
    }
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    await rm(path, { force: true });
    await rename(temporary, path);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
