/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup } from "solid-js";
import { loadState, type DeepSeekProviderState } from "../providers-state.js";
import { COLOR_OK, COLOR_WARN, COLOR_DANGER, balanceColor } from "../lib/format.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 15_000);

export const DeepseekUsagePanel = () => {
  const [ds, setDs] = createSignal<DeepSeekProviderState | null>(null);

  const load = () => {
    setDs(loadState()?.providers?.deepseek ?? null);
  };

  load();
  const interval = setInterval(load, REFRESH_MS);
  interval.unref?.();
  onCleanup(() => clearInterval(interval));

  const state = ds();
  if (!state || state.status !== "ok") return null;

  const balance = state.totalBalance;
  if (typeof balance !== "number") return null;

  const balanceStr = balance.toFixed(2);
  const currency = state.currency ?? "USD";
  const color = balanceColor(balance);

  return (
    <box>
      <text><b>Deepseek</b></text>
      <text fg={color}> Restante {balanceStr} {currency}</text>
    </box>
  );
};
