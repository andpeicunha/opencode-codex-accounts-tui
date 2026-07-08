/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, createMemo } from "solid-js";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { loadState, type DeepSeekProviderState } from "../providers-state.js";
import { balanceColor } from "../lib/format.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 2_000);

export const DeepseekUsagePanel = (props: { api: TuiPluginApi }) => {
  const [ds, setDs] = createSignal<DeepSeekProviderState | null>(null);

  const load = () => {
    setDs(loadState()?.providers?.deepseek ?? null);
    try { props.api.renderer.requestRender(); } catch {}
  };
  load();

  const interval = setInterval(load, REFRESH_MS);
  onCleanup(() => clearInterval(interval));

  const view = createMemo(() => {
    const state = ds();
    if (!state || state.status !== "ok" || typeof state.totalBalance !== "number") {
      return <text> </text>;
    }
    return (
      <box gap={0}>
        <text><b>Deepseek</b></text>
        <text fg={balanceColor(state.totalBalance)} wrapMode="none">
          {"  Restante "}{state.totalBalance.toFixed(2)}{" "}{state.currency ?? "USD"}
        </text>
      </box>
    );
  });

  return view;
};
