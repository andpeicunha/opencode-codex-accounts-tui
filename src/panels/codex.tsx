/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, createMemo } from "solid-js";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import {
  loadState,
  type CodexAccount,
  type CodexProviderState,
  type RateWindow,
} from "../providers-state.js";
import {
  COLOR_OK,
  COLOR_WARN,
  COLOR_DANGER,
  COLOR_MUTED,
  formatDurationHM,
  formatDurationShort,
  MS_PER_DAY,
} from "../lib/format.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 2_000);
const STALE_QUOTA_DAYS = 7;
const STALE_QUOTA_MS = STALE_QUOTA_DAYS * MS_PER_DAY;
const STALE_DATA_MIN = 30;
const STALE_DATA_MS = STALE_DATA_MIN * 60_000;

function isStaleAccount(account: CodexAccount): boolean {
  if (account.authInvalid) return true;
  const fh = account.rateLimits?.fiveHour;
  if (
    fh?.remaining === 0 &&
    typeof fh.updatedAt === "number" &&
    Date.now() - fh.updatedAt > STALE_QUOTA_MS
  ) {
    return true;
  }
  return false;
}

function formatFiveHourReset(window?: RateWindow): string {
  if (!window?.resetAt) return "?";
  const updatedAt = window.updatedAt;
  if (typeof updatedAt === "number" && Date.now() - updatedAt > STALE_DATA_MS) {
    const ageMs = Date.now() - updatedAt;
    const ageMin = Math.floor(ageMs / 60_000);
    if (ageMin < 60) return `stale ${ageMin}m`;
    const ageH = Math.floor(ageMin / 60);
    const ageM = ageMin % 60;
    return ageM > 0 ? `stale ${ageH}h${ageM}m` : `stale ${ageH}h`;
  }
  return formatDurationHM(window.resetAt);
}

function usageRatio(window?: RateWindow): number | null {
  if (!window || typeof window.remaining !== "number" || typeof window.limit !== "number" || window.limit <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, 1 - window.remaining / window.limit));
}

function usageColor(window?: RateWindow): string {
  const ratio = usageRatio(window);
  if (ratio === null) return COLOR_MUTED;
  if (ratio >= 0.8) return COLOR_DANGER;
  if (ratio >= 0.5) return COLOR_WARN;
  return COLOR_OK;
}

function formatPercent(window?: RateWindow): string {
  const ratio = usageRatio(window);
  return ratio === null ? "?" : `${Math.round(ratio * 100)}%`;
}

export const CodexAccountsPanel = (props: { api: TuiPluginApi }) => {
  const [codex, setCodex] = createSignal<CodexProviderState | null>(null);

  const load = () => {
    const s = loadState();
    if (s) setCodex(s.providers.codex);
    try { props.api.renderer.requestRender(); } catch {}
  };
  load();

  const interval = setInterval(load, REFRESH_MS);
  onCleanup(() => clearInterval(interval));

  const view = createMemo(() => {
    const state = codex();
    if (!state) return <text> </text>;
    if (state.status === "empty") return <text> </text>;
    if (state.status === "ok" && !state.accounts.some((account) => account.rateLimits?.fiveHour || account.rateLimits?.weekly)) {
      return <text> </text>;
    }

    if (state.status === "error") {
      return (
        <box gap={0}>
          <text><b>Codex</b></text>
          <text fg={COLOR_DANGER} wrapMode="none">
            {"  "}{state.error ?? "codex read error"}
          </text>
        </box>
      );
    }

    // Build pre-formatted line strings (not arrays, no <For>)
    const lines: Array<[string, string]> = [];
    for (const account of state.accounts) {
      if (isStaleAccount(account)) continue;
      const fiveHour = account.rateLimits?.fiveHour;
      const weekly = account.rateLimits?.weekly;
      if (fiveHour || weekly) {
        const color = usageColor(fiveHour);
        const text = `  5h ${formatPercent(fiveHour)} (${formatFiveHourReset(fiveHour)}) · 7d ${formatPercent(weekly)} (${formatDurationShort(weekly?.resetAt)})`;
        lines.push([color, text]);
      }
    }

    if (lines.length === 0) return <text> </text>;

    return (
      <box gap={0}>
        <text><b>Codex</b></text>
        <box gap={0}>
          {lines.map(([color, text]) => (
            <text fg={color} wrapMode="none">
              {text}
            </text>
          ))}
        </box>
      </box>
    );
  });

  return view;
};
