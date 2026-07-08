/**
 * OpenCode Go provider probe.
 *
 * OpenCode Go is a subscription plan whose usage data is rendered into the
 * workspace dashboard page as SolidJS SSR hydration output. This probe fetches
 * the dashboard HTML and parses three usage windows (rolling ~5h, weekly,
 * monthly) directly from the embedded `*Usage` chunks.
 *
 * Authentication uses the same session as the web UI:
 *   - workspaceId: visible in the dashboard URL
 *   - authCookie:  the `auth` cookie from the opencode.ai session
 *
 * Configured via ~/.config/opencode/opencode-quota/opencode-go.json (same
 * file the @slkiser/opencode-quota plugin reads), so both monitors stay in
 * sync without us depending on the plugin's internals at runtime.
 */
import {
  OPENCODE_GO_CONFIG_PATH,
  OPENCODE_GO_DASHBOARD_URL_PREFIX,
  OPENCODE_GO_DASHBOARD_URL_SUFFIX,
  errorMessage,
  fetchWithTimeout,
  readJsonFile,
  type OpenCodeGoProviderState,
} from "../providers-state.js";

type OpenCodeGoConfigFile = {
  workspaceId?: string;
  authCookie?: string;
};

type ScrapeWindow = { usagePercent?: number; resetInSec?: number };

const NUMBER_PATTERN = "[+-]?\\d+(?:\\.\\d+)?";

// Scrape pattern: usage window format on the dashboard is
// `rollingUsage:$R[N]={status:"...",resetInSec:NUMBER,usagePercent:NUMBER}`.
// Field order after the opening `{` is not fixed, so we match both fields
// in any order via two capture groups and pick the sensible one.
function parseUsageWindow(html: string, name: string): ScrapeWindow | null {
  const re = new RegExp(
    `${name}Usage:\\$R\\[\\d+\\]=\\{[^{}]*\\}`,
  );
  const match = re.exec(html);
  if (!match) return null;
  const block = match[0];
  const pct = block.match(/usagePercent:([+-]?\d+(?:\.\d+)?)/);
  const reset = block.match(/resetInSec:([+-]?\d+(?:\.\d+)?)/);
  if (!pct || !reset) return null;
  const usagePercent = Number(pct[1]);
  const resetInSec = Number(reset[1]);
  if (!Number.isFinite(usagePercent) || !Number.isFinite(resetInSec)) return null;
  return { usagePercent, resetInSec };
}

function rollingWindow(html: string): ScrapeWindow | null {
  return parseUsageWindow(html, "rolling");
}

function weeklyWindow(html: string): ScrapeWindow | null {
  return parseUsageWindow(html, "weekly");
}

function monthlyWindow(html: string): ScrapeWindow | null {
  return parseUsageWindow(html, "monthly");
}

function readConfig(): { workspaceId: string; authCookie: string } | null {
  const raw = readJsonFile(OPENCODE_GO_CONFIG_PATH) as OpenCodeGoConfigFile | null;
  if (!raw?.workspaceId || !raw.authCookie) return null;
  return { workspaceId: raw.workspaceId, authCookie: raw.authCookie };
}

async function fetchDashboard(workspaceId: string, authCookie: string): Promise<string> {
  const url = `${OPENCODE_GO_DASHBOARD_URL_PREFIX}${encodeURIComponent(workspaceId)}${OPENCODE_GO_DASHBOARD_URL_SUFFIX}`;
  const response = await fetchWithTimeout(
    url,
    { headers: { Cookie: `auth=${authCookie}` } },
    10_000,
  );
  if (!response.ok) {
    throw new Error(`http ${response.status}`);
  }
  return response.text();
}

function mapWindow(window: ScrapeWindow | null) {
  if (window?.usagePercent === undefined || window.resetInSec === undefined) return undefined;
  return {
    usedPct: window.usagePercent,
    resetInSec: window.resetInSec,
    resetAt: Date.now() + window.resetInSec * 1000,
  };
}

export async function probeOpenCodeGo(): Promise<OpenCodeGoProviderState> {
  const config = readConfig();
  if (!config) {
    return { type: "subscription", status: "missing-config" };
  }

  let html: string;
  try {
    html = await fetchDashboard(config.workspaceId, config.authCookie);
  } catch (err) {
    return {
      type: "subscription",
      status: "error",
      error: errorMessage(err),
      transient: true,
    };
  }

  const windows = {
    rolling: mapWindow(rollingWindow(html)),
    weekly: mapWindow(weeklyWindow(html)),
    monthly: mapWindow(monthlyWindow(html)),
  };

  if (!windows.rolling && !windows.weekly && !windows.monthly) {
    return { type: "subscription", status: "error", error: "no windows parsed" };
  }

  return { type: "subscription", status: "ok", windows };
}
