/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, createMemo } from "solid-js";
import {
  loadState,
  type CodexAccount,
  type CodexProviderState,
  type RateWindow,
} from "../providers-state.js";
import { onTick } from "../lib/tick.js";
import {
  COLOR_OK,
  COLOR_WARN,
  COLOR_DANGER,
  COLOR_MUTED,
  formatDurationHM,
} from "../lib/format.js";
const STALE_QUOTA_DAYS = 7;
const STALE_QUOTA_MS = STALE_QUOTA_DAYS * 86_400_000;
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

function formatResetLabel(window?: RateWindow, fallback = "reset indisponível"): string {
  if (!window?.resetAt) return fallback;
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

function formatWeeklyReset(window?: RateWindow): string {
  if (!window?.resetAt) return "?";
  const diff = window.resetAt - Date.now();
  if (diff <= 0) return "00h";
  const totalHours = Math.ceil(diff / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d ${String(hours).padStart(2, "0")}h`;
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

function projectionColor(percent: number): string {
  if (percent >= 95) return COLOR_DANGER;
  if (percent >= 80) return COLOR_WARN;
  return COLOR_OK;
}

export const CodexAccountsPanel = () => {
  const [codex, setCodex] = createSignal<CodexProviderState | null>(null);

  const load = () => {
    const s = loadState();
    if (s) setCodex(s.providers.codex);
  };
  load();
  onCleanup(onTick(load));

  const view = createMemo(() => {
    const state = codex();
    if (!state) return <text> </text>;
    if (state.status === "empty" || state.status === "disabled") return <text> </text>;
    if (state.status === "ok" && !state.accounts.some((account) => account.rateLimits?.fiveHour || account.rateLimits?.weekly)) {
      return (
        <box gap={0}>
          <text><b>Codex</b></text>
          <text fg={COLOR_MUTED} wrapMode="none">{"  limites indisponíveis"}</text>
        </box>
      );
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
        const color = usageColor(fiveHour ?? weekly);
        const parts: string[] = [];
        if (fiveHour) parts.push(`5h ${formatPercent(fiveHour)} (${formatResetLabel(fiveHour)})`);
        if (weekly) parts.push(`7d ${formatPercent(weekly)} (${formatWeeklyReset(weekly)})`);
        lines.push([color, `  ${parts.join(" · ")}`]);
        if (!fiveHour) {
          if (account.weeklyProjection) {
            lines.push([projectionColor(account.weeklyProjection.projectedUsedPercent), `  Projeção ${Math.round(account.weeklyProjection.projectedUsedPercent)}%`]);
          } else {
            lines.push([COLOR_MUTED, "  coletando ritmo"]);
          }
        }
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

  return view();
};
