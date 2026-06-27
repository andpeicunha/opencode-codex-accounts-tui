/** @jsxImportSource @opentui/solid */
import { onCleanup, createSignal } from "solid-js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { COLOR_OK, COLOR_WARN, COLOR_DANGER, formatDurationShort, formatMoney, usageColor } from "../lib/format.js";

// The Cursor CLI statusline already runs `~/Apps/dotfiles/cursor/scripts/
// cursor-usage-fetch.sh`, which writes a cached JSON snapshot here with a 60s
// TTL and handles OAuth refresh + Connect RPC against api2.cursor.sh.
// We just read the snapshot — no porting of the fetch logic to TS.
const CURSOR_CACHE_PATH = join(
  process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
  "cursor-statusline",
  "usage.json",
);

const STALE_THRESHOLD_S = 5 * 60;
const REFRESH_MS = 30_000;

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

export const CursorUsagePanel = () => {
  const [cache, setCache] = createSignal<CursorUsage | null>(null);

  const loadCache = () => {
    setCache(readCache());
  };

  loadCache();

  const interval = setInterval(loadCache, REFRESH_MS);
  interval.unref?.();
  onCleanup(() => clearInterval(interval));

  const c = cache();
  if (!c) return null;

  const planLimit = c.plan_limit_cents ?? 0;
  const planUsed = c.plan_used_cents ?? 0;
  // Unlimited plan or missing data → don't render.
  if (planLimit <= 0) return null;

  const spend5h = c.spend_5h_cents ?? 0;
  const spend7d = c.spend_7d_cents ?? 0;
  const planPct = (planUsed / planLimit) * 100;
  const fivePct = (spend5h / planLimit) * 100;
  const sevenPct = (spend7d / planLimit) * 100;

  const fetchedAt = c.fetched_at ?? 0;
  const isStale =
    fetchedAt > 0 && Date.now() / 1000 - fetchedAt > STALE_THRESHOLD_S;

  return (
    <box gap={0}>
      <text>
        <b>Cursor{isStale ? " (stale)" : ""}</b>
      </text>
      <text fg={usageColor(planPct)} wrapMode="none">
        {"  "}plan: ${formatMoney(planUsed)}/${formatMoney(planLimit)} {Math.round(planPct)}% ({formatDurationShort(c.billing_cycle_end_ms ?? null)})
      </text>
      <text fg={usageColor(Math.max(fivePct, sevenPct))} wrapMode="none">
        {"  "}5h {Math.round(fivePct)}% · 7d {Math.round(sevenPct)}%
      </text>
    </box>
  );
};
