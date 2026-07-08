/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { loadState, type DeepSeekProviderState } from "../providers-state.js";
import { balanceColor } from "../lib/format.js";
import { ProviderPanel, type PanelLine } from "./generic.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 2_000);

export const DeepseekUsagePanel = (props: { api: TuiPluginApi }) => {
  const [ds, setDs] = createSignal<DeepSeekProviderState | null>(null);

  const load = () => {
    setDs(loadState()?.providers?.deepseek ?? null);
  };

  load();

  const interval = setInterval(load, REFRESH_MS);

  createEffect(() => {
    const _ = ds();
    try { props.api.renderer.requestRender(); } catch {}
  });

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
