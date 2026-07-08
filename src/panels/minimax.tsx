/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, Show } from "solid-js";
import { loadState, type MiniMaxProviderState } from "../providers-state.js";
import {
  COLOR_DANGER,
  formatDurationHM,
  formatDurationShort,
  usageColor,
} from "../lib/format.js";
import { ProviderPanel, type PanelLine } from "./generic.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 5_000);

export const MinimaxUsagePanel = () => {
  const [m, setM] = createSignal<MiniMaxProviderState | null>(null);

  const load = () => {
    setM(loadState()?.providers?.minimax ?? null);
  };

  load();
  const interval = setInterval(load, REFRESH_MS);
  interval.unref?.();
  onCleanup(() => clearInterval(interval));

  return (
    <Show when={m()}>
      {(state) => {
        if (state().status === "missing-key") return null;
        if (state().status === "error") {
          return (
            <ProviderPanel
              title="Minimax"
              lines={[{ text: `  ${state().error ?? "read error"}`, color: COLOR_DANGER }]}
            />
          );
        }
        if (state().status !== "ok") return null;
        const q = state().quota;
        if (!q?.fiveHour || !q?.weekly) return null;

        const fhUsed = q.fiveHour.used ?? 0;
        const sdUsed = q.weekly.used ?? 0;
        const color = usageColor(Math.max(fhUsed, sdUsed));

        return (
          <ProviderPanel
            title="Minimax"
            lines={[
              {
                text: `  5h ${fhUsed}% (${formatDurationHM(q.fiveHour.resetAt)}) · 7d ${sdUsed}% (${formatDurationShort(q.weekly.resetAt)})`,
                color,
              },
            ]}
          />
        );
      }}
    </Show>
  );
};
