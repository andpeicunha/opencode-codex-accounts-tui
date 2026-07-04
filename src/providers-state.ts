/**
 * Unified providers state written by the server-side monitor plugin
 * and consumed by the TUI sidebar.
 *
 * Shared contract only: file paths, loaders, and TypeScript types exchanged
 * between providers-monitor.ts and index.tsx.
 *
 * Three billing models are represented:
 *  - Codex:    subscription with 5h/weekly rate windows
 *  - DeepSeek: pay-per-token, optional /user/balance probe
 *  - MiniMax:  pay-per-token (standard key) or token-plan with quota windows
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const PROVIDERS_STATE_PATH = resolvePath(
  process.env.OPENCODE_PROVIDERS_STATE_PATH,
  join(homedir(), ".config", "opencode", "providers-state.json"),
);

export const PROVIDERS_MANUAL_STATE_PATH = resolvePath(
  process.env.OPENCODE_PROVIDERS_MANUAL_STATE_PATH,
  join(homedir(), ".config", "opencode", "providers-manual-state.json"),
);

export const CODEX_STORE_PATH = resolvePath(
  process.env.OPENCODE_CODEX_ACCOUNTS_STORE_PATH,
  join(homedir(), ".config", "opencode", "codex-multi-account-accounts.json"),
);

export const DEFAULT_REFRESH_MS = 30_000;
export const CODEX_EXPIRY_WARN_DAYS = 30;

export type RateWindow = {
  remaining?: number;
  limit?: number;
  resetAt?: number;
  used?: number;
  updatedAt?: number;
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
  expiringSoon?: boolean;
};

export type CodexProviderState = {
  type: "subscription";
  status: "ok" | "error" | "empty";
  activeAlias?: string | null;
  accounts: CodexAccount[];
  error?: string;
};

export type DeepSeekProviderState = {
  type: "pay-per-token";
  status: "ok" | "error" | "missing-key" | "rate-limited";
  currency?: string;
  totalBalance?: number;
  toppedUpBalance?: number;
  grantedBalance?: number;
  isAvailable?: boolean;
  error?: string;
  transient?: boolean;
};

export type MiniMaxProviderState = {
  type: "pay-per-token" | "token-plan";
  status: "ok" | "error" | "missing-key" | "rate-limited";
  keySource?: "standard" | "coding-plan" | "china-coding-plan";
  endpoint?: string;
  quota?: {
    fiveHour?: RateWindow;
    weekly?: RateWindow;
  };
  manualCredits?: {
    balance?: number;
    unit?: string;
    note?: string;
  };
  error?: string;
  transient?: boolean;
};

export type ProvidersState = {
  updatedAt: number;
  providers: {
    codex: CodexProviderState;
    deepseek: DeepSeekProviderState;
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

export type ManualProvidersState = {
  minimax?: {
    credits?: number;
    unit?: string;
    note?: string;
  };
};

export function loadManualState(): ManualProvidersState | null {
  try {
    if (!existsSync(PROVIDERS_MANUAL_STATE_PATH)) return null;
    return JSON.parse(readFileSync(PROVIDERS_MANUAL_STATE_PATH, "utf8")) as ManualProvidersState;
  } catch {
    return null;
  }
}
