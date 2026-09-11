export const TASK_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type PermissionProfile = "read_only" | "workspace_write" | "unrestricted";
export type ReasoningEffort = "off" | "low" | "high" | "max";
export type EstimateConfidence = "low" | "medium" | "high";

export interface TaskBudget {
  timeoutMs: number;
  maxTurns: number;
  maxResponseTokens: number;
  maxOutputTokens: number;
  commandTimeoutMs: number;
}

export interface TokenUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

export interface TaskResult {
  assistantText: string;
  stopReason: string;
  changedFiles: string[];
  verification: string[];
  toolCalls: Array<{ name: string; status?: string }>;
}

export interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface TaskRecord {
  id: string;
  task: string;
  workspaceRoot: string;
  permissionProfile: PermissionProfile;
  allowDestructive: boolean;
  reasoningEffort: ReasoningEffort;
  budget: TaskBudget;
  status: TaskStatus;
  phase: string;
  progressPercent: number;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  elapsedMs: number | null;
  estimatedCompletionAt: string;
  estimatedRemainingMs: number;
  estimateConfidence: EstimateConfidence;
  recommendedWaitMs: number;
  sessionId: string | null;
  harnessVersion: string | null;
  result: TaskResult | null;
  error: TaskError | null;
  usage: TokenUsage;
  logTail: string[];
}

export interface SubmitTaskInput {
  task: string;
  workspaceRoot: string;
  permissionProfile?: PermissionProfile;
  allowDestructive?: boolean;
  reasoningEffort?: ReasoningEffort;
  budget?: Partial<TaskBudget>;
}

export interface HarnessProgress {
  phase?: string;
  progressPercent?: number;
  message?: string;
  sessionId?: string;
  usage?: Partial<TokenUsage>;
  toolCall?: { name: string; status?: string };
}

export interface HarnessRunOptions {
  taskId: string;
  task: string;
  workspaceRoot: string;
  permissionProfile: PermissionProfile;
  allowDestructive: boolean;
  reasoningEffort: ReasoningEffort;
  budget: TaskBudget;
  previousSessionId: string | null;
  signal: AbortSignal;
  onProgress(progress: HarnessProgress): Promise<void>;
}

export interface HarnessRunResult {
  assistantText: string;
  stopReason: string;
  sessionId: string;
  harnessVersion: string;
  usage: TokenUsage;
  toolCalls: Array<{ name: string; status?: string }>;
}

export interface AgentHarness {
  run(options: HarnessRunOptions): Promise<HarnessRunResult>;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: null,
};

export function isTerminalStatus(status: TaskStatus): boolean {
  return ["succeeded", "failed", "cancelled", "interrupted"].includes(status);
}
