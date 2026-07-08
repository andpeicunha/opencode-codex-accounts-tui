/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, Show } from "solid-js";
import {
  loadState,
  type OpenCodeGoProviderState,
} from "../providers-state.js";
import { formatDurationHM, formatDurationShort, usageColor } from "../lib/format.js";
import { ProviderPanel, type PanelLine } from "./generic.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 5_000);

type Window = NonNullable<OpenCodeGoProviderState["windows"]>[keyof NonNullable<OpenCodeGoProviderState["windows"]>];

// Short windows (5h) deserve HH:MM precision so you can see the exact minute
// the rate resets. Longer windows (7d, 30d) collapse to h/d.
function formatReset(window: Window | undefined, kind: "short" | "long"): string {
  if (!window) return "?";
  const fn = kind === "short" ? formatDurationHM : formatDurationShort;
  return `${window.usedPct}% (${fn(window.resetAt ?? null)})`;
}

export const OpenCodeGoPanel = () => {
  const [s, setS] = createSignal<OpenCodeGoProviderState | null>(null);

  const load = () => {
    setS(loadState()?.providers?.opencodeGo ?? null);
  };

  load();
  const interval = setInterval(load, REFRESH_MS);
  interval.unref?.();
  onCleanup(() => clearInterval(interval));

  return (
    <Show when={s()}>
      {(state) => {
        if (state().status === "missing-config") return null;
        if (state().status === "error") {
          return (
            <ProviderPanel
              title="OpenCode Go"
              lines={[{ text: `  ${state().error ?? "opencode-go read error"}`, color: "#ef4444" }]}
            />
          );
        }
        if (state().status !== "ok" || !state().windows) return null;

        const rolling = state().windows!.rolling;
        const weekly = state().windows!.weekly;
        const monthly = state().windows!.monthly;

        const worstPct = Math.max(rolling?.usedPct ?? 0, weekly?.usedPct ?? 0, monthly?.usedPct ?? 0);
        const color = usageColor(worstPct);

        const lines: PanelLine[] = [
          {
            text: `  5h ${formatReset(rolling, "short")} · 7d ${formatReset(weekly, "long")} · 30d ${formatReset(monthly, "long")}`,
            color,
          },
        ];

        return <ProviderPanel title="OpenCode Go" lines={lines} />;
      }}
    </Show>
  );
};
