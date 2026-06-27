/** @jsxImportSource @opentui/solid */
import { loadState } from "../providers-state.js";
import { COLOR_OK, COLOR_WARN, COLOR_DANGER, formatDurationShort, formatDurationHM, usageColor } from "../lib/format.js";

export const MinimaxUsagePanel = () => {
  const m = loadState()?.providers?.minimax?.quota;
  if (!m?.fiveHour || !m?.weekly) return null;

  const fhUsed = m.fiveHour.used ?? 0;
  const sdUsed = m.weekly.used ?? 0;
  // Worst-of: line color reflects the most concerning window.
  const color = usageColor(Math.max(fhUsed, sdUsed));

  return (
    <box>
      <text><b>Minimax</b></text>
      <text fg={color} wrapMode="none">
        {" "}5h {fhUsed}% ({formatDurationHM(m.fiveHour.resetAt)}) · 7d {sdUsed}% ({formatDurationShort(m.weekly.resetAt)})
      </text>
    </box>
  );
};
