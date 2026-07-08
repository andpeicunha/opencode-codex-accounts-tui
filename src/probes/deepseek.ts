/**
 * DeepSeek provider probe.
 *
 * Reads account balance via DeepSeek's /user/balance endpoint. Pay-per-token;
 * the balance reflects remaining prepaid credits.
 *
 * Uses DEEPSEEK_API_KEY env var and interprets HTTP status codes:
 *   200 ok, 401 invalid key, 402 balance insufficient, 429 rate limited.
 */
import {
  FETCH_TIMEOUT_MS,
  errorMessage,
  fetchWithTimeout,
  type DeepSeekProviderState,
} from "../providers-state.js";

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

type DeepSeekBalance = {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
};

function parseAmount(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function probeDeepSeek(): Promise<DeepSeekProviderState> {
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
    return { type: "pay-per-token", status: "error", error: errorMessage(error), transient: true };
  }
}
