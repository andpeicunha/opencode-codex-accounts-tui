/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, createMemo } from "solid-js";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { usageColor } from "../lib/format.js";

const MS_PER_HOUR = 3_600_000;
const USAGE_ENDPOINT =
  process.env.OPENCODE_CLAUDE_USAGE_ENDPOINT || "https://api.anthropic.com/api/oauth/usage";
const CREDENTIALS_PATH =
  process.env.OPENCODE_CLAUDE_USAGE_CREDENTIALS_PATH ||
  join(homedir(), ".claude/.credentials.json");
const REFRESH_MS = Number(process.env.OPENCODE_CLAUDE_USAGE_REFRESH_MS || 60_000);
const REQUEST_TIMEOUT_MS = Number(process.env.OPENCODE_CLAUDE_USAGE_TIMEOUT_MS || 8_000);

type ClaudeCredentials = {
  claudeAiOauth?: {
    accessToken?: string;
    expiresAt?: number;
    subscriptionType?: string;
    rateLimitTier?: string;
  };
};

type ClaudeUsageWindow = {
  used_percentage?: number;
  resets_at?: number;
};

type ClaudeUsageResponse = {
  five_hour?: ClaudeUsageWindow;
  seven_day?: ClaudeUsageWindow;
  extra_usage?: { is_enabled?: boolean; used_percentage?: number; monthly_limit_usd?: number };
};

type PanelState = {
  status: "ok" | "error" | "missing-credentials" | "stale";
  tier?: string;
  rateLimitTier?: string;
  fiveHour?: { pct: number; resetsIn: string };
  sevenDay?: { pct: number; resetsIn: string };
  extraUsage?: { enabled: boolean; pct?: number };
  error?: string;
};

const readCredentials = (): ClaudeCredentials | null => {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8")) as ClaudeCredentials;
  } catch {
    return null;
  }
};

const hoursUntil = (isoOrMs: number | string | undefined): string => {
  if (isoOrMs === undefined) return "?";
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms)) return "?";
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  const hrs = Math.floor(diff / MS_PER_HOUR);
  const mins = Math.floor((diff % MS_PER_HOUR) / 60_000);
  if (hrs > 0) return `${hrs}h`;
  return `${mins}m`;
};

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUsage(token: string): Promise<ClaudeUsageResponse> {
  const response = await fetchWithTimeout(
    USAGE_ENDPOINT,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
      },
    },
    REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`http ${response.status}`);
  }
  return (await response.json()) as ClaudeUsageResponse;
}

export const ClaudeUsagePanel = (props: { api: TuiPluginApi }) => {
  const [state, setState] = createSignal<PanelState>({ status: "missing-credentials" });
  let lastGood: PanelState | null = null;
  let transientFailures = 0;
  const FAILURE_THRESHOLD = 3;

  const load = async () => {
    const creds = readCredentials();
    const token = creds?.claudeAiOauth?.accessToken;
    if (!token) {
      setState({ status: "missing-credentials" });
      try { props.api.renderer.requestRender(); } catch {}
      return;
    }

    try {
      const usage = await fetchUsage(token);
      const tier = creds?.claudeAiOauth?.subscriptionType;
      const rateLimitTier = creds?.claudeAiOauth?.rateLimitTier;

      const next: PanelState = {
        status: "ok",
        tier,
        rateLimitTier,
        fiveHour:
          usage.five_hour?.used_percentage !== undefined
            ? {
                pct: Math.round(usage.five_hour.used_percentage),
                resetsIn: hoursUntil(usage.five_hour.resets_at),
              }
            : undefined,
        sevenDay:
          usage.seven_day?.used_percentage !== undefined
            ? {
                pct: Math.round(usage.seven_day.used_percentage),
                resetsIn: hoursUntil(usage.seven_day.resets_at),
              }
            : undefined,
        extraUsage: usage.extra_usage
          ? {
              enabled: !!usage.extra_usage.is_enabled,
              pct:
                usage.extra_usage.used_percentage !== undefined
                  ? Math.round(usage.extra_usage.used_percentage)
                  : undefined,
            }
          : undefined,
      };

      lastGood = next;
      transientFailures = 0;
      setState(next);
    } catch (err) {
      transientFailures++;
      if (transientFailures < FAILURE_THRESHOLD && lastGood) {
        setState({ ...lastGood, status: "stale", error: String(err).slice(0, 60) });
      } else {
        setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    try { props.api.renderer.requestRender(); } catch {}
  };

  void load();
  const interval = setInterval(() => void load(), REFRESH_MS);
  onCleanup(() => clearInterval(interval));

  const view = createMemo(() => {
    const data = state();

    if (data.status === "missing-credentials") {
      return (
        <box gap={0}>
          <text><b>Claude Usage</b></text>
          <text wrapMode="none">
            {" ○ sem credenciais — rode `claude login` em ~/.claude/.credentials.json"}
          </text>
        </box>
      );
    }

    const tierLabel =
      data.tier && data.rateLimitTier
        ? `${data.tier} · ${data.rateLimitTier}`
        : data.tier || data.rateLimitTier || "";

    const fh = data.fiveHour;
    const sd = data.sevenDay;

    return (
      <box gap={0}>
        <text><b>Claude Usage</b></text>
        {tierLabel ? (
          <text wrapMode="none">
            {" ● "}{tierLabel}{data.status === "stale" ? " (stale)" : ""}
          </text>
        ) : null}
        {fh ? (
          <text fg={usageColor(fh.pct)} wrapMode="none">
            {"   5h "}{fh.pct}%{" · resets "}{fh.resetsIn}
          </text>
        ) : null}
        {sd ? (
          <text fg={usageColor(sd.pct)} wrapMode="none">
            {"   7d "}{sd.pct}%{" · resets "}{sd.resetsIn}
          </text>
        ) : null}
        {data.extraUsage?.enabled ? (
          <text wrapMode="none">
            {"   extra "}{data.extraUsage.pct ?? "?"}% used
          </text>
        ) : null}
        {data.status === "error" && data.error ? (
          <text wrapMode="none">
            {"   error: "}{data.error}
          </text>
        ) : null}
      </box>
    );
  });

  return view;
};
