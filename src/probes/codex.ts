/**
 * Codex provider probe.
 *
 * Reads ~/.codex/auth.json OAuth tokens, decodes JWT claims for email/account
 * id/expiry, and merges in rate-limit state from the codex-oauth-bridge state
 * file written by previous API calls.
 *
 * No network calls — Codex tokens are already locally available; rate limits
 * come from the bridge which updates them on each request.
 */
import {
  CODEX_AUTH_PATH,
  CODEX_EXPIRY_WARN_DAYS,
  CODEX_MULTI_ACCOUNT_PATH,
  CODEX_STATE_PATH,
  FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  readJsonFile,
  type CodexAccount,
  type CodexProviderState,
  type RateWindow,
} from "../providers-state.js";
import { loadCodexUsageHistory, recordWeeklySample } from "../lib/codex-usage-history.js";
import { projectWeeklyUsage } from "../lib/codex-projection.js";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_REFRESH_MS = 60_000;

type CodexStore = {
  tokens?: {
    access_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
};

type CodexBridgeState = {
  accountId?: string;
  email?: string;
  expiresAt?: number;
  lastRefresh?: string;
  updatedAt?: number;
  rateLimits?: { fiveHour?: RateWindow; weekly?: RateWindow };
};

type MultiAccountEntry = {
  accessToken?: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  expiresAt?: number;
  alias: string;
  authInvalid?: boolean;
};

type MultiAccountStore = {
  accounts?: Record<string, MultiAccountEntry>;
  activeAlias?: string;
};

type UsageWindow = {
  used_percent?: number;
  reset_at?: number;
  reset_after_seconds?: number;
  /** Backend-provided window duration, when available. Prefer over heuristics. */
  limit_window_seconds?: number;
};

type WindowSlot = "fiveHour" | "weekly" | undefined;

type UsageResponse = {
  rate_limit?: {
    primary_window?: UsageWindow;
    secondary_window?: UsageWindow;
  };
};

/**
 * Classify a /wham/usage quota window as five-hour or weekly.
 *
 * 1. If the backend exposes limit_window_seconds, use it directly.
 *    - ~5h  -> fiveHour
 *    - ~7d  -> weekly
 * 2. Otherwise fall back to the reset horizon:
 *    - <= 6h -> fiveHour
 *    - ~6-8d -> weekly
 * 3. If neither signal is usable, return undefined and do not assume a slot.
 */
function classifyWindow(window: UsageWindow | undefined): WindowSlot {
  if (!window || typeof window.used_percent !== "number") return undefined;

  if (typeof window.limit_window_seconds === "number" && Number.isFinite(window.limit_window_seconds)) {
    const durationMin = window.limit_window_seconds / 60;
    if (durationMin >= 240 && durationMin <= 360) return "fiveHour"; // 4-6h centered on 5h
    if (durationMin >= 6 * 24 * 60 && durationMin <= 8 * 24 * 60) return "weekly"; // 6-8d centered on 7d
    return undefined;
  }

  const resetSec =
    typeof window.reset_after_seconds === "number" && Number.isFinite(window.reset_after_seconds)
      ? window.reset_after_seconds
      : typeof window.reset_at === "number" && window.reset_at > Date.now() / 1000
        ? window.reset_at - Date.now() / 1000
        : undefined;

  if (typeof resetSec === "number" && Number.isFinite(resetSec)) {
    const resetMin = resetSec / 60;
    if (resetMin <= 360) return "fiveHour"; // <= 6h
    if (resetMin >= 6 * 24 * 60 && resetMin <= 8 * 24 * 60) return "weekly"; // ~6-8d
  }

  return undefined;
}

const rateLimitCache = new Map<string, { cached: CodexBridgeState["rateLimits"]; cachedAt: number; inFlight?: Promise<CodexBridgeState["rateLimits"] | undefined> }>();

function decodeJwt(token: string | undefined): Record<string, unknown> | null {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readEmail(claims: Record<string, unknown> | null): string | undefined {
  if (!claims) return undefined;
  if (typeof claims.email === "string") return claims.email;
  const profile = claims["https://api.openai.com/profile"];
  if (profile && typeof profile === "object" && "email" in profile && typeof profile.email === "string") {
    return profile.email;
  }
  return undefined;
}

function readAccountId(claims: Record<string, unknown> | null): string | undefined {
  if (!claims) return undefined;
  const auth = claims["https://api.openai.com/auth"];
  if (auth && typeof auth === "object" && "chatgpt_account_id" in auth && typeof auth.chatgpt_account_id === "string") {
    return auth.chatgpt_account_id;
  }
  return undefined;
}

function readExpiry(claims: Record<string, unknown> | null): number | undefined {
  const exp = claims?.exp;
  return typeof exp === "number" ? exp * 1000 : undefined;
}

function slotMaxResetMs(slot: WindowSlot): number {
  if (slot === "fiveHour") return 6 * 3_600_000; // <= 6h
  if (slot === "weekly") return 8 * 86_400_000; // ~8d
  return 0;
}

function toRateWindow(window: UsageWindow | undefined, slot: WindowSlot): RateWindow | undefined {
  if (!slot) return undefined;
  if (!window || typeof window.used_percent !== "number") return undefined;
  const candidateResetAt = typeof window.reset_at === "number"
    ? window.reset_at * 1000
    : typeof window.reset_after_seconds === "number"
      ? Date.now() + window.reset_after_seconds * 1000
      : undefined;
  // The backend occasionally sends a reset from another quota window. Do not
  // present it as a five-hour reset when it is outside that window's range.
  const maxResetMs = slotMaxResetMs(slot);
  const resetAt = candidateResetAt && candidateResetAt > Date.now() && candidateResetAt - Date.now() <= maxResetMs
    ? candidateResetAt
    : undefined;
  if (slot === "fiveHour" && !resetAt) return undefined;
  return {
    limit: 100,
    remaining: Math.max(0, Math.min(100, 100 - window.used_percent)),
    resetAt,
    updatedAt: Date.now(),
  };
}

function pickWindow(
  primary: UsageWindow | undefined,
  secondary: UsageWindow | undefined,
  slot: WindowSlot,
): UsageWindow | undefined {
  if (!slot) return undefined;
  const primarySlot = classifyWindow(primary);
  const secondarySlot = classifyWindow(secondary);
  if (primarySlot === slot && secondarySlot !== slot) return primary;
  if (secondarySlot === slot && primarySlot !== slot) return secondary;
  if (primarySlot === slot && secondarySlot === slot) {
    // Prefer the window whose classification came from limit_window_seconds.
    const primaryHasDuration = typeof primary?.limit_window_seconds === "number";
    const secondaryHasDuration = typeof secondary?.limit_window_seconds === "number";
    if (primaryHasDuration && !secondaryHasDuration) return primary;
    if (!primaryHasDuration && secondaryHasDuration) return secondary;
    return primary;
  }
  return undefined;
}

async function fetchRateLimits(accessToken: string, accountId: string | undefined) {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  const response = await fetchWithTimeout(USAGE_URL, { headers }, FETCH_TIMEOUT_MS);
  if (!response.ok) throw new Error(`http ${response.status}`);
  const data = await response.json() as UsageResponse;
  const primary = data.rate_limit?.primary_window;
  const secondary = data.rate_limit?.secondary_window;
  const fiveHour = toRateWindow(pickWindow(primary, secondary, "fiveHour"), "fiveHour");
  const weekly = toRateWindow(pickWindow(primary, secondary, "weekly"), "weekly");
  if (!fiveHour && !weekly) throw new Error("quota unavailable");
  return { fiveHour, weekly };
}

async function liveRateLimits(accessToken: string, accountId: string | undefined, cacheKey: string) {
  const entry = rateLimitCache.get(cacheKey);
  if (entry?.cached && Date.now() - entry.cachedAt < USAGE_REFRESH_MS) return entry.cached;
  if (entry?.inFlight) return entry.inFlight;

  const promise = fetchRateLimits(accessToken, accountId)
    .then((limits) => {
      rateLimitCache.set(cacheKey, { cached: limits, cachedAt: Date.now() });
      return limits;
    })
    .catch(() => undefined)
    .finally(() => {
      const e = rateLimitCache.get(cacheKey);
      if (e) e.inFlight = undefined;
    });

  rateLimitCache.set(cacheKey, { cached: entry?.cached, cachedAt: entry?.cachedAt ?? 0, inFlight: promise });
  return promise;
}

export async function probeCodex(): Promise<CodexProviderState> {
  const multiRaw = readJsonFile(CODEX_MULTI_ACCOUNT_PATH) as MultiAccountStore | null;
  const hasMulti = multiRaw?.accounts && Object.keys(multiRaw.accounts).length > 0;

  if (!hasMulti) {
    const raw = readJsonFile(CODEX_AUTH_PATH) as CodexStore | null;
    const bridge = readJsonFile(CODEX_STATE_PATH) as CodexBridgeState | null;
    const accessToken = raw?.tokens?.access_token;
    const idToken = raw?.tokens?.id_token;
    if (!accessToken || !idToken) {
      return { type: "subscription", status: "empty", accounts: [] };
    }

    const accessClaims = decodeJwt(accessToken);
    const idClaims = decodeJwt(idToken);
    const email = bridge?.email || readEmail(idClaims) || readEmail(accessClaims);
    const accountId =
      bridge?.accountId ||
      raw?.tokens?.account_id ||
      readAccountId(idClaims) ||
      readAccountId(accessClaims) ||
      "codex";
    const expiresAt = bridge?.expiresAt || readExpiry(accessClaims) || readExpiry(idClaims);
    const accountIdForHeaders = raw?.tokens?.account_id || readAccountId(idClaims) || readAccountId(accessClaims);
    const liveLimits = await liveRateLimits(accessToken, accountIdForHeaders, "codex");
    const rateLimits = liveLimits || bridge?.rateLimits;
    const now = Date.now();

    const weeklyUsedPercent =
      typeof liveLimits?.weekly?.remaining === "number" && typeof liveLimits?.weekly?.limit === "number" && liveLimits.weekly.limit > 0
        ? (1 - liveLimits.weekly.remaining / liveLimits.weekly.limit) * 100
        : undefined;
    const weeklyResetAt = liveLimits?.weekly?.resetAt;
    if (typeof weeklyUsedPercent === "number" && Number.isFinite(weeklyUsedPercent)) {
      recordWeeklySample(weeklyUsedPercent, weeklyResetAt, now);
    }
    const weeklyProjection =
      typeof weeklyUsedPercent === "number" && typeof weeklyResetAt === "number"
        ? projectWeeklyUsage(loadCodexUsageHistory(now), weeklyUsedPercent, weeklyResetAt, now)
        : undefined;

    const warnCutoff = now + CODEX_EXPIRY_WARN_DAYS * 24 * 3_600_000;
    const accounts: CodexAccount[] = [
      {
        alias: accountId === "codex" ? "codex" : accountId.slice(0, 8),
        email,
        expiresAt,
        usageCount: undefined,
        authInvalid: false,
        limitStatus: undefined,
        rateLimits,
        weeklyProjection,
        expiringSoon: typeof expiresAt === "number" && expiresAt <= warnCutoff,
      },
    ];

    return {
      type: "subscription",
      status: "ok",
      activeAlias: accounts[0]?.alias ?? null,
      accounts,
    };
  }

  const entries = Object.entries(multiRaw!.accounts!);
  const now = Date.now();
  const warnCutoff = now + CODEX_EXPIRY_WARN_DAYS * 24 * 3_600_000;
  const accounts: CodexAccount[] = [];

  for (const [alias, entry] of entries) {
    if (entry.authInvalid) {
      accounts.push({ alias, email: entry.email, authInvalid: true });
      continue;
    }
    const accessToken = entry.accessToken;
    if (!accessToken) {
      accounts.push({ alias, email: entry.email, authInvalid: true });
      continue;
    }

    const accountIdForHeaders = entry.accountId;
    const liveLimits = await liveRateLimits(accessToken, accountIdForHeaders, alias);

    const weeklyUsedPercent =
      typeof liveLimits?.weekly?.remaining === "number" && typeof liveLimits?.weekly?.limit === "number" && liveLimits.weekly.limit > 0
        ? (1 - liveLimits.weekly.remaining / liveLimits.weekly.limit) * 100
        : undefined;
    const weeklyResetAt = liveLimits?.weekly?.resetAt;
    if (typeof weeklyUsedPercent === "number" && Number.isFinite(weeklyUsedPercent)) {
      recordWeeklySample(weeklyUsedPercent, weeklyResetAt, now, alias);
    }
    const weeklyProjection =
      typeof weeklyUsedPercent === "number" && typeof weeklyResetAt === "number"
        ? projectWeeklyUsage(loadCodexUsageHistory(now, alias), weeklyUsedPercent, weeklyResetAt, now)
        : undefined;

    accounts.push({
      alias,
      email: entry.email,
      expiresAt: entry.expiresAt,
      usageCount: undefined,
      authInvalid: false,
      limitStatus: undefined,
      rateLimits: liveLimits || undefined,
      weeklyProjection,
      expiringSoon: typeof entry.expiresAt === "number" && entry.expiresAt <= warnCutoff,
    });
  }

  return {
    type: "subscription",
    status: "ok",
    activeAlias: multiRaw!.activeAlias ?? accounts[0]?.alias ?? null,
    accounts,
  };
}
