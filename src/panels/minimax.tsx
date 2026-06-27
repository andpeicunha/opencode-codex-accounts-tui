/** @jsxImportSource @opentui/solid */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_PATH = join(homedir(), ".config/opencode/providers-state.json");

const COLOR_OK = process.env.OPENCODE_PROVIDERS_TUI_COLOR_OK || "#22c55e";
const COLOR_WARN = process.env.OPENCODE_PROVIDERS_TUI_COLOR_WARN || "#f59e0b";
const COLOR_DANGER = process.env.OPENCODE_PROVIDERS_TUI_COLOR_DANGER || "#ef4444";
const COLOR_MUTED = process.env.OPENCODE_PROVIDERS_TUI_COLOR_MUTED || "#6b7280";

// Mirrors codex's formatReset: returns time until reset, not the hour-of-day.
// resetAt is a unix-ms timestamp from providers-state.json.
function formatReset(resetAt: number | undefined): string {
  if (!resetAt) return "?";
  const diff = resetAt - Date.now();
  if (diff <= 0) return "now";
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

const readState = (): any => {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); }
  catch { return null; }
};

// Same usage thresholds as Codex: <50% ok, 50-80% warn, >=80% danger.
function usageColor(usedPct: number): string {
  if (usedPct >= 80) return COLOR_DANGER;
  if (usedPct >= 50) return COLOR_WARN;
  return COLOR_OK;
}

export const MinimaxUsagePanel = () => {
  const m = readState()?.providers?.minimax?.quota;
  if (!m?.fiveHour || !m?.weekly) return null;

  const fhUsed = m.fiveHour.used ?? 0;
  const sdUsed = m.weekly.used ?? 0;
  // Worst-of: line color reflects the most concerning window.
  const color = usageColor(Math.max(fhUsed, sdUsed));

  return (
    <box>
      <text><b>Minimax</b></text>
      <text fg={color} wrapMode="none">
        {" "}5h {fhUsed}% ({formatReset(m.fiveHour.resetAt)}) · 7d {sdUsed}% ({formatReset(m.weekly.resetAt)})
      </text>
    </box>
  );
};
