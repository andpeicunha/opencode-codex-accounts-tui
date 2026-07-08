/** @jsxImportSource @opentui/solid */
import { onCleanup, createSignal, createMemo } from "solid-js";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatDurationShort, formatMoney, usageColor } from "../lib/format.js";

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

export const CursorUsagePanel = (props: { api: TuiPluginApi }) => {
  const [cache, setCache] = createSignal<CursorUsage | null>(null);

  const loadCache = () => {
    setCache(readCache());
    try { props.api.renderer.requestRender(); } catch {}
  };
  loadCache();

  const interval = setInterval(loadCache, REFRESH_MS);
  onCleanup(() => clearInterval(interval));

  const view = createMemo(() => {
    const c = cache();
    if (!c) return <text> </text>;

    const planLimit = c.plan_limit_cents ?? 0;
    const planUsed = c.plan_used_cents ?? 0;
    if (planLimit <= 0) return <text> </text>;

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
        <text><b>Cursor{isStale ? " (stale)" : ""}</b></text>
        <text fg={usageColor(planPct)} wrapMode="none">
          {"  "}plan: {"$"}{formatMoney(planUsed)}/{formatMoney(planLimit)}{" "}{Math.round(planPct)}%{" ("}{formatDurationShort(c.billing_cycle_end_ms ?? null)}{")"}
        </text>
        <text fg={usageColor(Math.max(fivePct, sevenPct))} wrapMode="none">
          {"  "}5h {Math.round(fivePct)}%{" · 7d "}{Math.round(sevenPct)}%
        </text>
      </box>
    );
  });

  return view;
};
