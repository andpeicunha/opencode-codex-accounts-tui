/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, createMemo } from "solid-js";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { loadState, type MiniMaxProviderState } from "../providers-state.js";
import { COLOR_DANGER, formatDurationHM, formatDurationShort, usageColor } from "../lib/format.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 2_000);

export const MinimaxUsagePanel = (props: { api: TuiPluginApi }) => {
  const [m, setM] = createSignal<MiniMaxProviderState | null>(null);

  const load = () => {
    setM(loadState()?.providers?.minimax ?? null);
    try { props.api.renderer.requestRender(); } catch {}
  };
  load();

  const interval = setInterval(load, REFRESH_MS);
  onCleanup(() => clearInterval(interval));

  const view = createMemo(() => {
    const state = m();
    if (!state) return <text> </text>;
    if (state.status === "missing-key") return <text> </text>;
    if (state.status === "error") {
      return (
        <box gap={0}>
          <text><b>Minimax</b></text>
          <text fg={COLOR_DANGER} wrapMode="none">
            {"  "}{state.error ?? "read error"}
          </text>
        </box>
      );
    }
    if (state.status !== "ok") return <text> </text>;

    const q = state.quota;
    if (!q?.fiveHour || !q?.weekly) return <text> </text>;

    const fhUsed = q.fiveHour.used ?? 0;
    const sdUsed = q.weekly.used ?? 0;

    return (
      <box gap={0}>
        <text><b>Minimax</b></text>
        <text fg={usageColor(Math.max(fhUsed, sdUsed))} wrapMode="none">
          {"  5h "}{fhUsed}%{" ("}{formatDurationHM(q.fiveHour.resetAt)}{") · 7d "}{sdUsed}%{" ("}{formatDurationShort(q.weekly.resetAt)}{")"}
        </text>
      </box>
    );
  });

  return view;
};
