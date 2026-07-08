/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import {
  loadState,
  type OpenCodeGoProviderState,
} from "../providers-state.js";
import { formatDurationHM, formatDurationShort, usageColor } from "../lib/format.js";
import { ProviderPanel, type PanelLine } from "./generic.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 2_000);

type Window = NonNullable<OpenCodeGoProviderState["windows"]>[keyof NonNullable<OpenCodeGoProviderState["windows"]>];

function formatReset(window: Window | undefined, kind: "short" | "long"): string {
  if (!window) return "?";
  const fn = kind === "short" ? formatDurationHM : formatDurationShort;
  return `${window.usedPct}% (${fn(window.resetAt ?? null)})`;
}

export const OpenCodeGoPanel = (props: { api: TuiPluginApi }) => {
  const [s, setS] = createSignal<OpenCodeGoProviderState | null>(null);

  const load = () => {
    setS(loadState()?.providers?.opencodeGo ?? null);
  };

  load();

  // Fallback interval — reloads state every 2s regardless of events
  const interval = setInterval(load, REFRESH_MS);

  // Force TUI repaint whenever the signal value changes.
  // This is the key fix: SolidJS signals update, but the TUI may not
  // re-render without an explicit requestRender() call.
  createEffect(() => {
    const _ = s();
    try { props.api.renderer.requestRender(); } catch {}
  });

  // Subscribe to TUI session/message events so state reloads happen
  // reactively as the user interacts with OpenCode, not just on a timer.
  const unsubs: Array<() => void> = [];
  try {
    unsubs.push(props.api.event.on("session.updated", load));
    unsubs.push(props.api.event.on("session.next.text.ended", load));
    unsubs.push(props.api.event.on("message.updated", load));
  } catch {}

  onCleanup(() => {
    clearInterval(interval);
    for (const fn of unsubs) {
      try { fn(); } catch {}
    }
  });

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
