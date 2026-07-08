/** @jsxImportSource @opentui/solid */
// Generic sidebar panel: renders a title followed by a stack of colorable lines.
// Used by every provider panel that consumes the unified state file. Panels
// that need custom fetch logic (claude, cursor) have their own render path.
import { For, Show } from "solid-js";
import { COLOR_MUTED } from "../lib/format.js";

export type PanelLine = { text: string; color?: string };

export function ProviderPanel(props: { title: string; lines: PanelLine[] }) {
  return (
    <Show when={props.lines.length > 0}>
      <box gap={0}>
        <text>
          <b>{props.title}</b>
        </text>
        <box gap={0}>
          <For each={props.lines}>
            {(line) => (
              <text fg={line.color ?? COLOR_MUTED} wrapMode="none">
                {line.text || " "}
              </text>
            )}
          </For>
        </box>
      </box>
    </Show>
  );
}
