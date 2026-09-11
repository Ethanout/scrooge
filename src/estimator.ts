import type { EstimateConfidence, PermissionProfile, TaskRecord } from "./types.js";

export interface Estimate {
  estimatedCompletionAt: string;
  estimatedRemainingMs: number;
  estimateConfidence: EstimateConfidence;
  recommendedWaitMs: number;
}

export function initialEstimate(
  task: string,
  profile: PermissionProfile,
  history: TaskRecord[],
  now = Date.now(),
): Estimate {
  const comparable = history
    .filter(item => item.permissionProfile === profile && item.status === "succeeded" && item.elapsedMs !== null)
    .slice(-20);
  const fallback = baseDuration(task, profile);
  const historical = comparable.length === 0
    ? fallback
    : Math.round(comparable.reduce((sum, item) => sum + (item.elapsedMs ?? 0), 0) / comparable.length);
  const estimatedRemainingMs = clamp(Math.round(fallback * 0.4 + historical * 0.6), 15_000, 60 * 60_000);

  return buildEstimate(estimatedRemainingMs, comparable.length >= 8 ? "high" : comparable.length >= 3 ? "medium" : "low", now);
}

export function runningEstimate(task: TaskRecord, now = Date.now()): Estimate {
  const startedAt = task.startedAt === null ? now : Date.parse(task.startedAt);
  const elapsed = Math.max(0, now - startedAt);
  const progress = clamp(task.progressPercent, 1, 95);
  const projectedTotal = elapsed > 5_000 ? elapsed / (progress / 100) : task.estimatedRemainingMs;
  const remaining = clamp(Math.round(projectedTotal - elapsed), 2_000, 60 * 60_000);
  const confidence: EstimateConfidence = progress >= 70 ? "high" : progress >= 30 ? "medium" : task.estimateConfidence;
  return buildEstimate(remaining, confidence, now);
}

function buildEstimate(remainingMs: number, confidence: EstimateConfidence, now: number): Estimate {
  return {
    estimatedCompletionAt: new Date(now + remainingMs).toISOString(),
    estimatedRemainingMs: remainingMs,
    estimateConfidence: confidence,
    recommendedWaitMs: clamp(Math.ceil(remainingMs * 1.1), 5_000, 10 * 60_000),
  };
}

function baseDuration(task: string, profile: PermissionProfile): number {
  const profileBase = profile === "read_only" ? 75_000 : profile === "workspace_write" ? 180_000 : 240_000;
  const textFactor = Math.min(300_000, Math.ceil(task.length / 500) * 30_000);
  return profileBase + textFactor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
