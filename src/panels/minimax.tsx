/** @jsxImportSource @opentui/solid */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_PATH = join(homedir(), ".config/opencode/providers-state.json");

const COLOR_OK = process.env.OPENCODE_PROVIDERS_TUI_COLOR_OK || "#22c55e";
const COLOR_WARN = process.env.OPENCODE_PROVIDERS_TUI_COLOR_WARN || "#f59e0b";
const COLOR_DANGER = process.env.OPENCODE_PROVIDERS_TUI_COLOR_DANGER || "#ef4444";
const COLOR_MUTED = process.env.OPENCODE_PROVIDERS_TUI_COLOR_MUTED || "#6b7280";

const fmtReset = (ms: number | undefined): string => {
  if (!ms) return "?";
  const d = new Date(ms);
  return `${d.getHours()}h`;
};

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
        {" "}5h {fhUsed}% ({fmtReset(m.fiveHour.resetAt)}) · 7d {sdUsed}% ({fmtReset(m.weekly.resetAt)})
      </text>
    </box>
  );
};
