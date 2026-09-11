import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { ScroogeConfig } from "./config.js";
import type { AgentHarness, HarnessProgress, HarnessRunOptions, HarnessRunResult, TokenUsage } from "./types.js";

export class DshAcpHarness implements AgentHarness {
  readonly #config: ScroogeConfig;
  readonly #sessions = new Map<string, PersistentDshSession>();

  constructor(config: ScroogeConfig) {
    this.#config = config;
  }

  async run(options: HarnessRunOptions): Promise<HarnessRunResult> {
    const key = options.workspaceRoot;
    let session = this.#sessions.get(key);
    if (session === undefined) {
      session = await PersistentDshSession.start(this.#config, options);
      this.#sessions.set(key, session);
    }
    try {
      return await session.prompt(options);
    } catch (error) {
      if (isTransportError(error)) {
        this.#sessions.delete(key);
        await session.close();
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.#sessions.values()].map(session => session.close()));
    this.#sessions.clear();
  }
}

class PersistentDshSession {
  readonly #process: ChildProcess;
  readonly #connection: acp.ClientConnection;
  readonly #session: acp.ActiveSession;
  readonly #workspaceRoot: string;
  readonly #harnessVersion: string;
  readonly #stop = new AbortController();
  #busy = false;

  private constructor(
    child: ChildProcess,
    connection: acp.ClientConnection,
    session: acp.ActiveSession,
    workspaceRoot: string,
    harnessVersion: string,
  ) {
    this.#process = child;
    this.#connection = connection;
    this.#session = session;
    this.#workspaceRoot = workspaceRoot;
    this.#harnessVersion = harnessVersion;
  }

  static async start(config: ScroogeConfig, options: HarnessRunOptions): Promise<PersistentDshSession> {
    const workspaceRoot = options.workspaceRoot;
    const command = process.platform === "win32" && config.dshCommand === "dsh"
      ? windowsPowerShell()
      : config.dshCommand;
    const args = process.platform === "win32" && config.dshCommand === "dsh"
      ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "& dsh --profile acp"]
      : ["--profile", "acp"];
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ...(command !== config.dshCommand ? { PSModulePath: `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\Modules` } : {}),
        DSH_HOME: config.dshHome,
        DSH_PERMISSION_MODE: dshPermissionMode(options),
        ...(config.telemetryDisabled ? { DSH_TELEMETRY_DISABLED: "1" } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stderr = child.stderr;
    stderr?.on("data", chunk => { process.stderr.write(`[dsh] ${String(chunk)}`); });
    const input = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);
    const app = acp.client({ name: "scrooge-mcp" })
      .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => ({
        outcome: {
          outcome: "selected" as const,
          optionId: selectPermissionOption(params.options, options),
        },
      }))
      .onRequest(acp.methods.client.fs.readTextFile, async () => ({ content: "" }))
      .onRequest(acp.methods.client.fs.writeTextFile, async () => ({}));
    const connection = await app.connect(stream);
    const ctx = connection.agent;
    await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    const session = await ctx.buildSession(workspaceRoot).start();
    await configureReasoning(ctx, session.sessionId, options.reasoningEffort, session.newSessionResponse.configOptions);
    return new PersistentDshSession(child, connection, session, workspaceRoot, config.expectedDshVersion);
  }

  async prompt(options: HarnessRunOptions): Promise<HarnessRunResult> {
    if (this.#busy) throw new Error("The workspace already has an active DSH session prompt");
    this.#busy = true;
    const timeout = setTimeout(() => this.#stop.abort(), options.budget.timeoutMs);
    const usage: TokenUsage = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, estimatedCostUsd: null };
    const toolCalls: Array<{ name: string; status?: string }> = [];
    let assistantText = "";
    let stopReason = "end_turn";
    try {
      await this.#session.prompt(options.task);
      for (;;) {
        const update = await abortable(this.#session.nextUpdate(), options.signal, this.#stop.signal);
        if (update.kind === "stop") {
          stopReason = update.stopReason;
          break;
        }
        await this.handleUpdate(update.update, options, usage, toolCalls, text => { assistantText += text; });
      }
      return {
        assistantText,
        stopReason,
        sessionId: this.#session.sessionId,
        harnessVersion: this.#harnessVersion,
        usage,
        toolCalls,
      };
    } finally {
      clearTimeout(timeout);
      this.#busy = false;
    }
  }

  private async handleUpdate(
    update: acp.SessionUpdate,
    options: HarnessRunOptions,
    usage: TokenUsage,
    toolCalls: Array<{ name: string; status?: string }>,
    addText: (value: string) => void,
  ): Promise<void> {
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      addText(update.content.text);
      await options.onProgress({ phase: "responding", progressPercent: 90, message: update.content.text.slice(-500) });
    } else if (update.sessionUpdate === "tool_call") {
      toolCalls.push({ name: update.toolCallId, ...(update.status == null ? {} : { status: update.status }) });
      await options.onProgress({ phase: "tool", progressPercent: 50, toolCall: { name: update.toolCallId, ...(update.status == null ? {} : { status: update.status }) } });
    } else if (update.sessionUpdate === "tool_call_update") {
      await options.onProgress({ phase: "tool", progressPercent: 70, toolCall: { name: update.toolCallId, ...(update.status == null ? {} : { status: update.status }) } });
    } else if (update.sessionUpdate === "usage_update") {
      usage.totalTokens = update.used;
      await options.onProgress({ phase: "reasoning", progressPercent: 25, usage: { totalTokens: update.used } });
    } else if (update.sessionUpdate === "agent_thought_chunk") {
      await options.onProgress({ phase: "reasoning", progressPercent: 20 });
    }
  }

  async close(): Promise<void> {
    this.#stop.abort();
    this.#session.dispose();
    this.#connection.close();
    if (!this.#process.killed) this.#process.kill();
    await once(this.#process, "close").catch(() => undefined);
  }
}

function windowsPowerShell(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  return systemRoot === undefined ? "powershell.exe" : `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

function dshPermissionMode(options: HarnessRunOptions): string {
  if (options.permissionProfile === "read_only") return "read-only";
  if (options.permissionProfile === "unrestricted") return "danger-full-access";
  return "workspace-write";
}

function selectPermissionOption(
  options: readonly acp.PermissionOption[],
  run: HarnessRunOptions,
): string {
  const allowed = run.permissionProfile !== "read_only" &&
    (run.permissionProfile === "unrestricted" || !run.allowDestructive);
  const candidate = options.find(option => allowed && option.kind === "allow_once") ??
    options.find(option => option.kind === "reject_once") ??
    options.find(option => option.kind === "reject_always") ??
    options[0];
  return candidate?.optionId ?? "reject-once";
}

async function configureReasoning(
  ctx: acp.ClientContext,
  sessionId: string,
  effort: HarnessRunOptions["reasoningEffort"],
  configOptions: readonly acp.SessionConfigOption[] | null | undefined,
): Promise<void> {
  const option = configOptions?.find(candidate => candidate.id === "reasoning_effort");
  const values = option?.type === "select" ? option.options.flatMap(group =>
    "value" in group ? [group] : group.options,
  ) : [];
  const value = values.find(candidate => candidate.value === effort)?.value;
  if (option === undefined || value === undefined) return;
  await ctx.request(acp.methods.agent.session.setConfigOption, {
    sessionId,
    configId: option.id,
    type: "select",
    value,
  });
}

async function abortable<T>(promise: Promise<T>, ...signals: AbortSignal[]): Promise<T> {
  if (signals.some(signal => signal.aborted)) throw new Error("Task cancelled");
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Task cancelled"));
    signals.forEach(signal => signal.addEventListener("abort", onAbort, { once: true }));
    promise.then(resolve, reject).finally(() => signals.forEach(signal => signal.removeEventListener("abort", onAbort)));
  });
}

function isTransportError(error: unknown): boolean {
  return error instanceof Error && /connection|closed|session|transport/i.test(error.message);
}
