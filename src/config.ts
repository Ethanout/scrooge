import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TaskBudget } from "./types.js";

export interface ScroogeConfig {
  dataDir: string;
  dshHome: string;
  dshCommand: string;
  maxConcurrency: number;
  maxWaitMs: number;
  defaultBudget: TaskBudget;
  maximumBudget: TaskBudget;
  expectedDshVersion: string;
  telemetryDisabled: boolean;
  defaultReasoningEffort: "off" | "low" | "high" | "max";
}

const DEFAULT_BUDGET: TaskBudget = {
  timeoutMs: 30 * 60_000,
  maxTurns: 20,
  maxResponseTokens: 32_768,
  maxOutputTokens: 160_000,
  commandTimeoutMs: 5 * 60_000,
};

const MAXIMUM_BUDGET: TaskBudget = {
  timeoutMs: 2 * 60 * 60_000,
  maxTurns: 60,
  maxResponseTokens: 384_000,
  maxOutputTokens: 1_000_000,
  commandTimeoutMs: 30 * 60_000,
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ScroogeConfig {
  const localData = env.LOCALAPPDATA ?? join(homedir(), ".local", "share");
  const dataDir = resolve(env.SCROOGE_DATA_DIR ?? join(localData, "scrooge-mcp"));

  return {
    dataDir,
    dshHome: resolve(env.SCROOGE_DSH_HOME ?? join(dataDir, "dsh")),
    dshCommand: env.SCROOGE_DSH_COMMAND ?? "dsh",
    maxConcurrency: integerEnv(env.SCROOGE_MAX_CONCURRENCY, 2, 1, 16),
    maxWaitMs: integerEnv(env.SCROOGE_MAX_WAIT_MS, 10 * 60_000, 1_000, 60 * 60_000),
    defaultBudget: budgetFromEnv(env, "SCROOGE_DEFAULT", DEFAULT_BUDGET),
    maximumBudget: budgetFromEnv(env, "SCROOGE_MAX", MAXIMUM_BUDGET),
    expectedDshVersion: env.SCROOGE_EXPECTED_DSH_VERSION ?? "0.1.5-rc.2",
    telemetryDisabled: env.SCROOGE_DSH_TELEMETRY !== "enabled",
    defaultReasoningEffort: resolveReasoningEffort(env.SCROOGE_DEFAULT_REASONING_EFFORT),
  };
}

function resolveReasoningEffort(value: string | undefined): "off" | "low" | "high" | "max" {
  if (value === undefined) return "high";
  if (value === "off" || value === "low" || value === "high" || value === "max") return value;
  throw new Error(`Unsupported reasoning effort: ${value}`);
}

export function resolveBudget(
  requested: Partial<TaskBudget> | undefined,
  config: ScroogeConfig,
): TaskBudget {
  return {
    timeoutMs: bounded(requested?.timeoutMs, config.defaultBudget.timeoutMs, config.maximumBudget.timeoutMs),
    maxTurns: bounded(requested?.maxTurns, config.defaultBudget.maxTurns, config.maximumBudget.maxTurns),
    maxResponseTokens: bounded(
      requested?.maxResponseTokens,
      config.defaultBudget.maxResponseTokens,
      config.maximumBudget.maxResponseTokens,
    ),
    maxOutputTokens: bounded(
      requested?.maxOutputTokens,
      config.defaultBudget.maxOutputTokens,
      config.maximumBudget.maxOutputTokens,
    ),
    commandTimeoutMs: bounded(
      requested?.commandTimeoutMs,
      config.defaultBudget.commandTimeoutMs,
      config.maximumBudget.commandTimeoutMs,
    ),
  };
}

function budgetFromEnv(env: NodeJS.ProcessEnv, prefix: string, fallback: TaskBudget): TaskBudget {
  return {
    timeoutMs: positiveEnv(env[`${prefix}_TIMEOUT_MS`], fallback.timeoutMs),
    maxTurns: positiveEnv(env[`${prefix}_TURNS`], fallback.maxTurns),
    maxResponseTokens: positiveEnv(env[`${prefix}_RESPONSE_TOKENS`], fallback.maxResponseTokens),
    maxOutputTokens: positiveEnv(env[`${prefix}_OUTPUT_TOKENS`], fallback.maxOutputTokens),
    commandTimeoutMs: positiveEnv(env[`${prefix}_COMMAND_TIMEOUT_MS`], fallback.commandTimeoutMs),
  };
}

function integerEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function positiveEnv(value: string | undefined, fallback: number): number {
  return integerEnv(value, fallback, 1, Number.MAX_SAFE_INTEGER);
}

function bounded(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return Math.min(fallback, max);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Budget values must be positive integers");
  if (value > max) throw new Error(`Budget value ${value} exceeds the configured maximum ${max}`);
  return value;
}

export const TEST_DATA_DIR = join(tmpdir(), "scrooge-mcp-tests");
