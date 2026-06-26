/** @jsxImportSource @opentui/solid */
import { Show, createSignal, onCleanup } from "solid-js";
import { loadState } from "../providers-state.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 15_000);

export const ClaudeUsagePanel = () => {
  const [state, setState] = createSignal<any>(null);

  const load = () => {
    const s = loadState();
    // Expects claude data in providers-state.json (providers.claude) when available
    const claudeData = (s as any)?.providers?.claude;
    if (claudeData) setState(claudeData);
  };

  load();

  const interval = setInterval(load, REFRESH_MS);
  onCleanup(() => clearInterval(interval));

  const data = state();
  if (!data) return null;

  return (
    <Show when={true}>
      <box gap={0}>
        <text>
          <b>Claude</b>
        </text>
        <text wrapMode="none">
          {data.status === "ok" ? "● available" : data.status === "error" ? "err" : data.status ?? "?"}
        </text>
      </box>
    </Show>
  );
};
