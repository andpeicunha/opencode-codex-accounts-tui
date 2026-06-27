/** @jsxImportSource @opentui/solid */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The Cursor CLI statusline already runs `~/Apps/dotfiles/cursor/scripts/
// cursor-usage-fetch.sh`, which writes a cached JSON snapshot here with a 60s
// TTL and handles OAuth refresh + Connect RPC against api2.cursor.sh.
// We just read the snapshot — no porting of the fetch logic to TS.
const CURSOR_CACHE_PATH = join(
  process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
  "cursor-statusline",
  "usage.json",
);

const COLOR_OK = process.env.OPENCODE_PROVIDERS_TUI_COLOR_OK || "#22c55e";
const COLOR_WARN = process.env.OPENCODE_PROVIDERS_TUI_COLOR_WARN || "#f59e0b";
const COLOR_DANGER = process.env.OPENCODE_PROVIDERS_TUI_COLOR_DANGER || "#ef4444";
const COLOR_MUTED = process.env.OPENCODE_PROVIDERS_TUI_COLOR_MUTED || "#6b7280";

const STALE_THRESHOLD_S = 5 * 60;

type CursorUsage = {
  fetched_at?: number;
  plan_used_cents?: number;
  plan_limit_cents?: number;
  plan_remaining_cents?: number;
  billing_cycle_end_ms?: number | null;
  spend_5h_cents?: number;
  spend_7d_cents?: number;
};

function readCache(): CursorUsage | null {
  if (!existsSync(CURSOR_CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CURSOR_CACHE_PATH, "utf8")) as CursorUsage;
  } catch {
    return null;
  }
}

function formatReset(ms: number | null | undefined): string {
  if (!ms) return "?";
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

// Mirrors codex/minimax thresholds.
function usageColor(usedPct: number): string {
  if (usedPct >= 80) return COLOR_DANGER;
  if (usedPct >= 50) return COLOR_WARN;
  return COLOR_OK;
}

export const CursorUsagePanel = () => {
  const cache = readCache();
  if (!cache) return null;

  const planLimit = cache.plan_limit_cents ?? 0;
  const planUsed = cache.plan_used_cents ?? 0;
  // Unlimited plan or missing data → don't render.
  if (planLimit <= 0) return null;

  const spend5h = cache.spend_5h_cents ?? 0;
  const spend7d = cache.spend_7d_cents ?? 0;
  const planPct = (planUsed / planLimit) * 100;
  const fivePct = (spend5h / planLimit) * 100;
  const sevenPct = (spend7d / planLimit) * 100;

  const fetchedAt = cache.fetched_at ?? 0;
  const isStale =
    fetchedAt > 0 && Date.now() / 1000 - fetchedAt > STALE_THRESHOLD_S;

  return (
    <box gap={0}>
      <text>
        <b>Cursor{isStale ? " (stale)" : ""}</b>
      </text>
      <text fg={usageColor(planPct)} wrapMode="none">
        {"  "}plan: ${formatMoney(planUsed)}/${formatMoney(planLimit)} {Math.round(planPct)}% ({formatReset(cache.billing_cycle_end_ms ?? null)})
      </text>
      <text fg={usageColor(fivePct)} wrapMode="none">
        {"  "}5h {Math.round(fivePct)}% · 7d {Math.round(sevenPct)}%
      </text>
    </box>
  );
};