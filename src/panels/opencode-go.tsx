/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, createMemo } from "solid-js";
import {
  loadState,
  type OpenCodeGoProviderState,
} from "../providers-state.js";
import { onTick } from "../lib/tick.js";
import { formatDurationHM, formatDurationShort, usageColor } from "../lib/format.js";

type Window = NonNullable<OpenCodeGoProviderState["windows"]>[keyof NonNullable<OpenCodeGoProviderState["windows"]>];

function formatReset(window: Window | undefined, kind: "short" | "long"): string {
  if (!window) return "?";
  const fn = kind === "short" ? formatDurationHM : formatDurationShort;
  return `${window.usedPct}% (${fn(window.resetAt ?? null)})`;
}

export const OpenCodeGoPanel = () => {
  const [s, setS] = createSignal<OpenCodeGoProviderState | null>(null);

  const load = () => {
    setS(loadState()?.providers?.opencodeGo ?? null);
  };
  load();
  onCleanup(onTick(load));

  // Reactive view: recomputes whenever s() changes.
  const view = createMemo(() => {
    const state = s();
    if (!state) return <text> </text>;
    if (state.status === "disabled") return <text> </text>;
    if (state.status === "missing-config") {
      return <box gap={0}><text><b>OpenCode Go</b></text><text wrapMode="none">{"  configuração ausente"}</text></box>;
    }
    if (state.status === "error") {
      return (
        <box gap={0}>
          <text><b>OpenCode Go</b></text>
          <text fg="#ef4444" wrapMode="none">
            {"  "}{state.error ?? "opencode-go read error"}
          </text>
        </box>
      );
    }
    if (state.status !== "ok" || !state.windows) return <text> </text>;

    const rolling = state.windows.rolling;
    const weekly = state.windows.weekly;
    const monthly = state.windows.monthly;
    const worstPct = Math.max(rolling?.usedPct ?? 0, weekly?.usedPct ?? 0, monthly?.usedPct ?? 0);

    return (
      <box gap={0}>
        <text><b>OpenCode Go</b></text>
        <text fg={usageColor(worstPct)} wrapMode="none">
          {"  5h "}{formatReset(rolling, "short")}{" · 7d "}{formatReset(weekly, "long")}
        </text>
        <text fg={usageColor(monthly?.usedPct ?? 0)} wrapMode="none">
          {"  30d "}{formatReset(monthly, "long")}
        </text>
      </box>
    );
  });

  return view();
};
