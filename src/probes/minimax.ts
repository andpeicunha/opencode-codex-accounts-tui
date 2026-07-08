/**
 * MiniMax provider probe.
 *
 * MiniMax exposes its subscription quota via a token-plan API. There are two
 * endpoints — standard and coding-plan — and two accepted auth header styles
 * (Bearer and X-Api-Key). This probe tries every (endpoint, header) pair
 * until one returns a non-401 response, so a user with only the standard key
 * still gets a "live" status instead of `missing-key`.
 *
 * Quota shape: a list of `model_remains` entries with per-window remaining
 * percentages. We surface the entry named "general" (or the first one if no
 * "general" exists) into the standardized RateWindow shape.
 */
import {
  FETCH_TIMEOUT_MS,
  errorMessage,
  fetchWithTimeout,
  type MiniMaxProviderState,
  type RateWindow,
} from "../providers-state.js";

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

type MiniMaxQuotaResponse = {
  base_resp?: { status_code?: number; status_msg?: string };
  model_remains?: Array<{
    model_name?: string;
    end_time?: number;
    weekly_end_time?: number;
    current_interval_remaining_percent?: number;
    current_weekly_remaining_percent?: number;
  }>;
};

function windowFromPercent(
  remainingPercent: number | undefined,
  resetAt: number | undefined,
): RateWindow | undefined {
  if (typeof remainingPercent !== "number") return undefined;
  const used = Math.max(0, Math.min(100, 100 - remainingPercent));
  return {
    used,
    limit: 100,
    remaining: Math.max(0, Math.min(100, remainingPercent)),
    resetAt,
  };
}

export async function probeMiniMax(): Promise<MiniMaxProviderState> {
  for (const endpoint of MINIMAX_ENDPOINTS) {
    const apiKey = process.env[endpoint.envVar];
    if (!apiKey) continue;

    if (!endpoint.url) {
      return { type: "pay-per-token", status: "ok", keySource: "standard" };
    }

    // MiniMax accepts Bearer or X-Api-Key depending on endpoint version.
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

        if (response.status === 401) continue; // try next header
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
        if (body.base_resp?.status_code === 1004) continue;
        if (body.base_resp?.status_code && body.base_resp.status_code !== 0) {
          return {
            type: "token-plan",
            status: "error",
            keySource: endpoint.id,
            endpoint: endpoint.url,
            error: body.base_resp.status_msg ?? "upstream error",
          };
        }

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

        const fiveHour = windowFromPercent(
          modelEntry.current_interval_remaining_percent,
          modelEntry.end_time,
        );
        const weekly = windowFromPercent(
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
          transient: true,
        };
      }
    }

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
