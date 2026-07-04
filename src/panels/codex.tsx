/** @jsxImportSource @opentui/solid */
import { Show, createSignal, onCleanup } from "solid-js";
import {
  loadState,
  type CodexAccount,
  type CodexProviderState,
  type RateWindow,
} from "../providers-state.js";
import { COLOR_OK, COLOR_WARN, COLOR_DANGER, COLOR_MUTED, formatDurationShort, formatDurationHM, MS_PER_DAY } from "../lib/format.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 15_000);

// Hide accounts that are clearly abandoned: invalid auth, or a 5h quota
// exhausted for more than this many days (oc-codex-multi-account only
// refreshes rateLimits on use, so a stale 0 means the user moved on).
const STALE_QUOTA_DAYS = 7;
const STALE_QUOTA_MS = STALE_QUOTA_DAYS * MS_PER_DAY;

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

function formatExpiry(expiresAt?: number): string {
  if (!expiresAt) return "?";
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expired";
  const days = Math.round(diff / MS_PER_DAY);
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
  interval.unref?.();
  onCleanup(() => clearInterval(interval));

  const state = codex();
  if (!state || state.status === "empty") return null;

  const lines: PanelLine[] = [];
  if (state.status === "error") {
    lines.push({ text: state.error ?? "codex read error", color: COLOR_DANGER });
  } else {
    for (const account of state.accounts) {
      if (isStaleAccount(account)) continue;
      const marker = state.activeAlias === account.alias ? "●" : "○";
      lines.push({
        text: `${marker} ${account.alias} · ${codexAccountHealth(account)} · exp:${formatExpiry(account.expiresAt)}`,
        color: codexAccountColor(account),
      });
      const fiveHour = account.rateLimits?.fiveHour;
      const weekly = account.rateLimits?.weekly;
      lines.push({
        text: `  5h ${formatPercent(fiveHour)} (${formatDurationHM(fiveHour?.resetAt)}) · 7d ${formatPercent(weekly)} (${formatDurationShort(weekly?.resetAt)})`,
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
