/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, Show } from "solid-js";
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

  return (
    <Show when={ds() && ds()!.status === "ok" && typeof ds()!.totalBalance === "number"}>
      <ProviderPanel
        title="Deepseek"
        lines={[
          {
            text: `  Restante ${ds()!.totalBalance!.toFixed(2)} ${ds()!.currency ?? "USD"}`,
            color: balanceColor(ds()!.totalBalance!),
          },
        ]}
      />
    </Show>
  );
};
