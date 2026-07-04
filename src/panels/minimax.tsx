/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup } from "solid-js";
import { loadState, type MiniMaxProviderState } from "../providers-state.js";
import { COLOR_OK, COLOR_WARN, COLOR_DANGER, formatDurationShort, formatDurationHM, usageColor } from "../lib/format.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 15_000);

export const MinimaxUsagePanel = () => {
  const [m, setM] = createSignal<MiniMaxProviderState | null>(null);

  const load = () => {
    setM(loadState()?.providers?.minimax ?? null);
  };

  load();
  const interval = setInterval(load, REFRESH_MS);
  interval.unref?.();
  onCleanup(() => clearInterval(interval));

  const state = m();
  if (!state || state.status !== "ok") return null;
  const q = state.quota;
  if (!q?.fiveHour || !q?.weekly) return null;

  const fhUsed = q.fiveHour.used ?? 0;
  const sdUsed = q.weekly.used ?? 0;
  // Worst-of: line color reflects the most concerning window.
  const color = usageColor(Math.max(fhUsed, sdUsed));

  return (
    <box>
      <text><b>Minimax</b></text>
      <text fg={color} wrapMode="none">
        {" "}5h {fhUsed}% ({formatDurationHM(q.fiveHour.resetAt)}) · 7d {sdUsed}% ({formatDurationShort(q.weekly.resetAt)})
      </text>
    </box>
  );
};
