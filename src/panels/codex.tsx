/** @jsxImportSource @opentui/solid */
import { Show, createSignal, onCleanup } from "solid-js";
import {
  loadState,
  type CodexAccount,
  type CodexProviderState,
  type RateWindow,
} from "../providers-state.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 15_000);

const COLOR_OK = process.env.OPENCODE_PROVIDERS_TUI_COLOR_OK || "#22c55e";
const COLOR_WARN = process.env.OPENCODE_PROVIDERS_TUI_COLOR_WARN || "#f59e0b";
const COLOR_DANGER = process.env.OPENCODE_PROVIDERS_TUI_COLOR_DANGER || "#ef4444";
const COLOR_MUTED = process.env.OPENCODE_PROVIDERS_TUI_COLOR_MUTED || "#6b7280";

type PanelLine = { text: string; color?: string };

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

function formatReset(window?: RateWindow): string {
  if (!window?.resetAt) return "?";
  const diff = window.resetAt - Date.now();
  if (diff <= 0) return "now";
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

// Zero-padded "HH:MM" for short windows (5h). Mirrors panels/minimax.tsx.
function formatResetHHMM(window?: RateWindow): string {
  if (!window?.resetAt) return "?";
  const diff = window.resetAt - Date.now();
  if (diff <= 0) return "00:00";
  const totalMinutes = Math.ceil(diff / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatExpiry(expiresAt?: number): string {
  if (!expiresAt) return "?";
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expired";
  const days = Math.round(diff / 86_400_000);
  if (Math.abs(days) < 1) return `${Math.round(diff / 3_600_000)}h`;
  return `${days}d`;
}

function codexAccountHealth(account: CodexAccount): string {
  if (account.authInvalid) return "auth";
  if (account.limitStatus === "error") return "err";
  return "ok";
}

function codexAccountColor(account: CodexAccount): string {
  if (account.authInvalid || account.limitStatus === "error") return COLOR_DANGER;
  if (account.expiringSoon) return COLOR_WARN;
  const fiveHour = usageRatio(account.rateLimits?.fiveHour) ?? 0;
  const weekly = usageRatio(account.rateLimits?.weekly) ?? 0;
  const worst = Math.max(fiveHour, weekly);
  if (worst >= 0.8) return COLOR_DANGER;
  if (worst >= 0.5) return COLOR_WARN;
  return COLOR_OK;
}

export const CodexAccountsPanel = () => {
  const [codex, setCodex] = createSignal<CodexProviderState | null>(null);

  const load = () => {
    const s = loadState();
    if (s) setCodex(s.providers.codex);
  };

  load();

  const interval = setInterval(load, REFRESH_MS);
  onCleanup(() => clearInterval(interval));

  const state = codex();
  if (!state || state.status === "empty") return null;

  const lines: PanelLine[] = [];
  if (state.status === "error") {
    lines.push({ text: state.error ?? "codex read error", color: COLOR_DANGER });
  } else {
    for (const account of state.accounts) {
      const marker = state.activeAlias === account.alias ? "●" : "○";
      lines.push({
        text: `${marker} ${account.alias} · ${codexAccountHealth(account)} · exp:${formatExpiry(account.expiresAt)}`,
        color: codexAccountColor(account),
      });
      const fiveHour = account.rateLimits?.fiveHour;
      const weekly = account.rateLimits?.weekly;
      lines.push({
        text: `  5h ${formatPercent(fiveHour)} (${formatResetHHMM(fiveHour)}) · 7d ${formatPercent(weekly)} (${formatReset(weekly)})`,
        color: usageColor(fiveHour),
      });
    }
  }

  return (
    <Show when={lines.length > 0}>
      <box gap={0}>
        <text>
          <b>Codex</b>
        </text>
        <box gap={0}>
          {lines.map((line) => (
            <text fg={line.color ?? COLOR_MUTED} wrapMode="none">
              {line.text || " "}
            </text>
          ))}
        </box>
      </box>
    </Show>
  );
};
