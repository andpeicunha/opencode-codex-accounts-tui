/**
 * Server-side monitor that polls every AI provider used by the user
 * and writes a unified state file consumed by the TUI sidebar.
 *
 * Data collection only. This file must not contain rendered TUI strings;
 * formatting belongs in index.tsx.
 *
 * Polled providers:
 *  - Codex:    read from the existing oc-codex-multi-account store
 *  - DeepSeek: GET /user/balance with $DEEPSEEK_API_KEY
 *  - MiniMax:  GET /v1/token_plan/remains if a token-plan key is set,
 *              otherwise just acknowledge the standard API key
 */
import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CODEX_EXPIRY_WARN_DAYS,
  CODEX_STORE_PATH,
  DEFAULT_REFRESH_MS,
  PROVIDERS_STATE_PATH,
  loadManualState,
  type CodexAccount,
  type CodexProviderState,
  type DeepSeekProviderState,
  type MiniMaxProviderState,
  type ProvidersState,
  type RateWindow,
} from "./providers-state.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_REFRESH_MS || DEFAULT_REFRESH_MS);
const FETCH_TIMEOUT_MS = 8_000;

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

const MINIMAX_ENDPOINTS = [
  {
    id: "standard",
    envVar: "MINIMAX_API_KEY",
    url: "https://api.minimax.io/v1/token_plan/remains",
  },
  {
    id: "coding-plan",
    envVar: "MINIMAX_CODING_PLAN_API_KEY",
    url: "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
  },
  {
    id: "standard-fallback",
    envVar: "MINIMAX_API_KEY",
    url: null,
  },
] as const;

type DeepSeekBalance = {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
};

type CodexStore = {
  accounts?: Record<
    string,
    {
      alias?: string;
      email?: string;
      expiresAt?: number;
      usageCount?: number;
      authInvalid?: boolean;
      limitStatus?: string;
      rateLimits?: { fiveHour?: RateWindow; weekly?: RateWindow };
    }
  >;
  activeAlias?: string | null;
};

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function writeState(state: ProvidersState): void {
  mkdirSync(dirname(PROVIDERS_STATE_PATH), { recursive: true });
  writeFileSync(PROVIDERS_STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

function buildCodexState(): CodexProviderState {
  const raw = readJson(CODEX_STORE_PATH) as CodexStore | null;
  if (!raw || !raw.accounts || Object.keys(raw.accounts).length === 0) {
    return { type: "subscription", status: "empty", accounts: [] };
  }

  const now = Date.now();
  const warnCutoff = now + CODEX_EXPIRY_WARN_DAYS * 24 * 3_600_000;
  const accounts: CodexAccount[] = Object.entries(raw.accounts).map(([key, a]) => {
    const alias = a.alias ?? key;
    return {
      alias,
      email: a.email,
      expiresAt: a.expiresAt,
      usageCount: a.usageCount,
      authInvalid: a.authInvalid,
      limitStatus: a.limitStatus,
      rateLimits: a.rateLimits,
      expiringSoon: typeof a.expiresAt === "number" && a.expiresAt <= warnCutoff,
    };
  });

  return {
    type: "subscription",
    status: "ok",
    activeAlias: raw.activeAlias ?? null,
    accounts,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeDeepSeek(): Promise<DeepSeekProviderState> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { type: "pay-per-token", status: "missing-key" };
  }

  try {
    const response = await fetchWithTimeout(
      DEEPSEEK_BALANCE_URL,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      FETCH_TIMEOUT_MS,
    );

    if (response.status === 401) {
      return { type: "pay-per-token", status: "error", error: "invalid api key" };
    }
    if (response.status === 402) {
      return {
        type: "pay-per-token",
        status: "rate-limited",
        isAvailable: false,
        error: "balance insufficient",
      };
    }
    if (response.status === 429) {
      return { type: "pay-per-token", status: "rate-limited", error: "rate limited" };
    }
    if (!response.ok) {
      return { type: "pay-per-token", status: "error", error: `http ${response.status}` };
    }

    const body = (await response.json()) as DeepSeekBalance;
    const primary = body.balance_infos?.[0];
    if (!primary) {
      return { type: "pay-per-token", status: "error", error: "empty balance response" };
    }

    return {
      type: "pay-per-token",
      status: "ok",
      currency: primary.currency,
      totalBalance: parseAmount(primary.total_balance),
      toppedUpBalance: parseAmount(primary.topped_up_balance),
      grantedBalance: parseAmount(primary.granted_balance),
      isAvailable: body.is_available ?? true,
    };
  } catch (error) {
    return { type: "pay-per-token", status: "error", error: errorMessage(error) };
  }
}

function parseAmount(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 80);
  return String(error).slice(0, 80);
}

type MiniMaxQuotaResponse = {
  base_resp?: { status_code?: number; status_msg?: string };
  model_remains?: Array<{
    model_name?: string;
    end_time?: number;
    weekly_end_time?: number;
    remains_time?: number;
    current_interval_total_count?: number;
    current_interval_usage_count?: number;
    current_weekly_total_count?: number;
    current_weekly_usage_count?: number;
    current_interval_status?: number;
    current_interval_remaining_percent?: number;
    current_weekly_status?: number;
    current_weekly_remaining_percent?: number;
  }>;
};

async function probeMiniMax(): Promise<MiniMaxProviderState> {
  for (const endpoint of MINIMAX_ENDPOINTS) {
    const apiKey = process.env[endpoint.envVar];
    if (!apiKey) continue;

    if (!endpoint.url) {
      return { type: "pay-per-token", status: "ok", keySource: "standard" };
    }

    // MiniMax API accepts both Bearer and X-Api-Key headers depending on the
    // endpoint. The chat and quota endpoints require `Authorization: Bearer`.
    // Try Bearer first (the documented method), then X-Api-Key as fallback.
    const headerSets: Record<string, string>[] = [
      { Authorization: `Bearer ${apiKey}` },
      { "X-Api-Key": apiKey },
    ];

    for (const headers of headerSets) {
      try {
        const response = await fetchWithTimeout(
          endpoint.url,
          { headers },
          FETCH_TIMEOUT_MS,
        );

        if (response.status === 401) {
          continue; // try next header
        }
        if (response.status === 429) {
          return {
            type: "token-plan",
            status: "rate-limited",
            keySource: endpoint.id,
            endpoint: endpoint.url,
            error: "rate limited",
          };
        }
        if (!response.ok) {
          return {
            type: "token-plan",
            status: "error",
            keySource: endpoint.id,
            endpoint: endpoint.url,
            error: `http ${response.status}`,
          };
        }

        const body = (await response.json()) as MiniMaxQuotaResponse;
        // The MiniMax API responds with HTTP 200 even on auth failure, putting
        // the error in `base_resp.status_code: 1004`. When the message asks
        // for a different auth header, retry with the next header set.
        if (body.base_resp?.status_code === 1004) {
          continue;
        }
        if (body.base_resp?.status_code && body.base_resp.status_code !== 0) {
          return {
            type: "token-plan",
            status: "error",
            keySource: endpoint.id,
            endpoint: endpoint.url,
            error: body.base_resp.status_msg ?? "upstream error",
          };
        }

        // Prefer "general" model entry, otherwise fall back to the first one.
        const modelEntry = body.model_remains?.find((m) => m.model_name === "general")
          ?? body.model_remains?.[0];
        if (!modelEntry) {
          return {
            type: "token-plan",
            status: "error",
            keySource: endpoint.id,
            endpoint: endpoint.url,
            error: "empty model_remains",
          };
        }

        // New Token Plan format provides remaining_percent directly; convert to
        // a RateWindow (used%, remaining quota) for the TUI.
        const buildWindowFromPercent = (
          remainingPercent: number | undefined,
          resetAt: number | undefined,
        ): RateWindow | undefined => {
          if (typeof remainingPercent !== "number") return undefined;
          const used = Math.max(0, Math.min(100, 100 - remainingPercent));
          return {
            used,
            limit: 100,
            remaining: Math.max(0, Math.min(100, remainingPercent)),
            resetAt,
          };
        };

        const fiveHour = buildWindowFromPercent(
          modelEntry.current_interval_remaining_percent,
          modelEntry.end_time,
        );
        const weekly = buildWindowFromPercent(
          modelEntry.current_weekly_remaining_percent,
          modelEntry.weekly_end_time,
        );

        return {
          type: "token-plan",
          status: "ok",
          keySource: endpoint.id,
          endpoint: endpoint.url,
          quota: { fiveHour, weekly },
        };
      } catch (error) {
        return {
          type: "token-plan",
          status: "error",
          keySource: endpoint.id,
          endpoint: endpoint.url,
          error: errorMessage(error),
        };
      }
    }
    // Both header sets returned 401 for this endpoint. Report invalid key.
    return {
      type: "token-plan",
      status: "error",
      keySource: endpoint.id,
      endpoint: endpoint.url,
      error: "invalid api key",
    };
  }

  return { type: "pay-per-token", status: "missing-key" };
}

async function pollOnce(): Promise<ProvidersState> {
  const [deepseek, minimax] = await Promise.all([probeDeepSeek(), probeMiniMax()]);
  // Manual credits are only used when the API didn't return live quota data.
  const hasLiveQuota = minimax.status === "ok" && Boolean(minimax.quota);
  const manual = hasLiveQuota ? null : loadManualState();
  const manualCredits = manual?.minimax?.credits;
  const manualNote = manual?.minimax?.note;
  const enrichedMiniMax: MiniMaxProviderState =
    manualCredits !== undefined
      ? {
          ...minimax,
          manualCredits: {
            balance: manualCredits,
            unit: manual?.minimax?.unit ?? "credits",
            note: manualNote,
          },
        }
      : minimax;
  return {
    updatedAt: Date.now(),
    providers: {
      codex: buildCodexState(),
      deepseek,
      minimax: enrichedMiniMax,
    },
  };
}

const id = "opencode-providers-monitor";
const statePath = PROVIDERS_STATE_PATH;

const monitor: Plugin = async () => {
  let interval: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const safeWrite = (state: ProvidersState) => {
    if (stopped) return;
    try {
      writeState(state);
    } catch {
      // state file may be locked by another process; retry on next tick
    }
  };

  const tick = () => {
    void pollOnce().then(safeWrite).catch(() => undefined);
  };

  void pollOnce().then(safeWrite).catch(() => undefined);
  interval = setInterval(tick, REFRESH_MS);
  if (typeof interval.unref === "function") interval.unref();

  return {
    async dispose() {
      stopped = true;
      if (interval) clearInterval(interval);
    },
  };
};

const pluginModule: PluginModule = { id, server: monitor };

// Path is exported for diagnostics; intentional unused-var suppression.
void statePath;
void join;

export default pluginModule;
