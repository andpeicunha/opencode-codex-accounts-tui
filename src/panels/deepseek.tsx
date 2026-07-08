/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup } from "solid-js";
import { loadState, type DeepSeekProviderState } from "../providers-state.js";
import { balanceColor } from "../lib/format.js";
import { ProviderPanel, type PanelLine } from "./generic.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 5_000);

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

  const lines: PanelLine[] = [
    { text: `  Restante ${balanceStr} ${currency}`, color },
  ];

  return <ProviderPanel title="Deepseek" lines={lines} />;
};
