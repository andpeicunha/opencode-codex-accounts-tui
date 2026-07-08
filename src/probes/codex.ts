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
  CODEX_STATE_PATH,
  readJsonFile,
  type CodexAccount,
  type CodexProviderState,
  type RateWindow,
} from "../providers-state.js";

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

export function probeCodex(): CodexProviderState {
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
  const now = Date.now();
  const warnCutoff = now + CODEX_EXPIRY_WARN_DAYS * 24 * 3_600_000;
  const accounts: CodexAccount[] = [
    {
      alias: accountId === "codex" ? "codex" : accountId.slice(0, 8),
      email,
      expiresAt,
      usageCount: undefined,
      authInvalid: false,
      limitStatus: undefined,
      rateLimits: bridge?.rateLimits,
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
