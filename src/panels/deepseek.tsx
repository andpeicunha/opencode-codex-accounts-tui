/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, createMemo } from "solid-js";
import { loadState, type DeepSeekProviderState } from "../providers-state.js";
import { onTick } from "../lib/tick.js";
import { balanceColor } from "../lib/format.js";

export const DeepseekUsagePanel = () => {
  const [ds, setDs] = createSignal<DeepSeekProviderState | null>(null);

  const load = () => {
    setDs(loadState()?.providers?.deepseek ?? null);
  };
  load();

  onCleanup(onTick(load));

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

  return view();
};
