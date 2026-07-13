/**
 * Shared contracts between the server-side providers monitor and the TUI sidebar.
 *
 * - File paths: where monitor writes state and where panels read it.
 * - Type definitions: the shape of that state.
 * - Loaders: file -> typed object for the TUI side.
 *
 * The state is a snapshot of multiple providers polled independently, each with
 * its own billing model (subscription quota windows, pay-per-token balance,
 * dashboard-scraped usage). One snapshot is written per tick and consumed by
 * every sidebar panel.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const PROVIDERS_STATE_PATH = resolvePath(
  process.env.OPENCODE_PROVIDERS_STATE_PATH,
  join(homedir(), ".config", "opencode", "providers-state.json"),
);

export const CODEX_AUTH_PATH = resolvePath(
  process.env.OPENCODE_CODEX_AUTH_PATH,
  join(homedir(), ".codex", "auth.json"),
);

export const CODEX_STATE_PATH = resolvePath(
  process.env.OPENCODE_CODEX_STATE_PATH,
  join(homedir(), ".config", "opencode", "codex-oauth-state.json"),
);

export const OPENCODE_GO_CONFIG_PATH = resolvePath(
  process.env.OPENCODE_OPENCODE_GO_CONFIG_PATH,
  join(homedir(), ".config", "opencode", "opencode-quota", "opencode-go.json"),
);

export const DEFAULT_REFRESH_MS = 30_000;
export const CODEX_EXPIRY_WARN_DAYS = 30;
export const OPENCODE_GO_REFRESH_MS = 60_000;
export const FETCH_TIMEOUT_MS = 8_000;

// OpenCode Go dashboard URL pieces. Keep in sync with @slkiser/opencode-quota.
export const OPENCODE_GO_DASHBOARD_URL_PREFIX = "https://opencode.ai/workspace/";
export const OPENCODE_GO_DASHBOARD_URL_SUFFIX = "/go";

export type RateWindow = {
  remaining?: number;
  limit?: number;
  resetAt?: number;
  used?: number;
  updatedAt?: number;
};

export type CodexWeeklyProjection = {
  /** Projected used percentage at the next weekly reset, clamped 0-100. */
  projectedUsedPercent: number;
  /** Risk band derived from the projected used percentage. */
  risk: "low" | "medium" | "high";
  /** How the projection was produced. */
  method: "global" | "weekday";
  /** Number of valid incremental rates (same-reset consecutive samples) used. */
  intervalCount: number;
  /** Number of distinct days of week (0-6) covered by the observations. */
  weekdayCoverage: number;
};

export type CodexAccount = {
  alias: string;
  email?: string;
  expiresAt?: number;
  usageCount?: number;
  authInvalid?: boolean;
  limitStatus?: string;
  rateLimits?: {
    fiveHour?: RateWindow;
    weekly?: RateWindow;
  };
  /** Local, conservative weekly projection for UI consumption. */
  weeklyProjection?: CodexWeeklyProjection;
  expiringSoon?: boolean;
};

export type CodexProviderState = {
  type: "subscription";
  status: "ok" | "error" | "empty" | "disabled";
  activeAlias?: string | null;
  accounts: CodexAccount[];
  error?: string;
};

export type DeepSeekProviderState = {
  type: "pay-per-token";
  status: "ok" | "error" | "missing-key" | "rate-limited" | "disabled";
  currency?: string;
  totalBalance?: number;
  toppedUpBalance?: number;
  grantedBalance?: number;
  isAvailable?: boolean;
  error?: string;
  transient?: boolean;
};

export type OpenCodeGoProviderState = {
  type: "subscription";
  status: "ok" | "error" | "missing-config" | "disabled";
  windows?: {
    rolling?: { usedPct: number; resetInSec: number; resetAt?: number };
    weekly?: { usedPct: number; resetInSec: number; resetAt?: number };
    monthly?: { usedPct: number; resetInSec: number; resetAt?: number };
  };
  error?: string;
  transient?: boolean;
};

export type MiniMaxProviderState = {
  type: "pay-per-token" | "token-plan";
  status: "ok" | "error" | "missing-key" | "rate-limited" | "disabled";
  keySource?: "standard" | "coding-plan" | "china-coding-plan";
  endpoint?: string;
  quota?: {
    fiveHour?: RateWindow;
    weekly?: RateWindow;
  };
  error?: string;
  transient?: boolean;
};

export type ProvidersState = {
  updatedAt: number;
  providers: {
    codex: CodexProviderState;
    deepseek: DeepSeekProviderState;
    opencodeGo: OpenCodeGoProviderState;
    minimax: MiniMaxProviderState;
  };
};

export function resolvePath(envValue: string | undefined, fallback: string): string {
  if (!envValue?.trim()) return fallback;
  const trimmed = envValue.trim();
  if (isAbsolute(trimmed)) return trimmed;
  return join(homedir(), trimmed.replace(/^~\/?/, ""));
}

export function loadState(): ProvidersState | null {
  try {
    if (!existsSync(PROVIDERS_STATE_PATH)) return null;
    return JSON.parse(readFileSync(PROVIDERS_STATE_PATH, "utf8")) as ProvidersState;
  } catch {
    return null;
  }
}

export function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 80);
  return String(error).slice(0, 80);
}
