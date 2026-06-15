/** @jsxImportSource @opentui/solid */
// TUI rendering only. This file formats the providers snapshot written to
// providers-state.json; it must not probe provider APIs or mutate provider data.
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { Show, createSignal, onCleanup } from "solid-js";
import {
  PROVIDERS_STATE_PATH,
  loadState,
  type CodexAccount,
  type CodexProviderState,
  type DeepSeekProviderState,
  type MiniMaxProviderState,
  type ProvidersState,
  type RateWindow,
} from "./providers-state.js";

const id = "opencode-providers-tui";

const REFRESH_INTERVAL_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 15_000);
const SIDEBAR_ORDER = Number(process.env.OPENCODE_PROVIDERS_TUI_SIDEBAR_ORDER || 145);

const COLOR_OK = process.env.OPENCODE_PROVIDERS_TUI_COLOR_OK || "#22c55e";
const COLOR_WARN = process.env.OPENCODE_PROVIDERS_TUI_COLOR_WARN || "#f59e0b";
const COLOR_DANGER = process.env.OPENCODE_PROVIDERS_TUI_COLOR_DANGER || "#ef4444";
const COLOR_MUTED = process.env.OPENCODE_PROVIDERS_TUI_COLOR_MUTED || "#6b7280";

type PanelLine = { text: string; color?: string };
type PanelState = { status: "ok" | "empty" | "error"; lines: PanelLine[] };
type ActiveProvider = "codex" | "deepseek" | "minimax";

function dimIfInactive(active: boolean, color: string): string {
  return active ? color : COLOR_MUTED;
}

function normalizeProvider(providerID: string | undefined, modelID: string | undefined): ActiveProvider | undefined {
  const provider = providerID?.toLowerCase();
  const model = modelID?.toLowerCase();

  if (provider?.includes("minimax") || model?.includes("minimax")) return "minimax";
  if (provider?.includes("deepseek") || model?.includes("deepseek")) return "deepseek";
  if (provider === "codex" || provider === "openai" || model?.startsWith("gpt-")) return "codex";

  return undefined;
}

function currentSessionID(api: TuiPluginApi): string | undefined {
  const current = api.route.current;
  if (current.name !== "session") return undefined;

  const sessionID = current.params?.sessionID;
  if (typeof sessionID !== "string") return undefined;

  return sessionID;
}

function currentSessionProvider(api: TuiPluginApi): ActiveProvider | undefined {
  const sessionID = currentSessionID(api);
  if (!sessionID) return undefined;

  const messages = api.state.session.messages(sessionID);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const provider = normalizeProvider(message.providerID, message.modelID);
    if (provider) return provider;
  }

  return undefined;
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

function formatExpiry(expiresAt?: number): string {
  if (!expiresAt) return "?";
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expired";
  const days = Math.round(diff / 86_400_000);
  if (Math.abs(days) < 1) return `${Math.round(diff / 3_600_000)}h`;
  return `${days}d`;
}

function formatBalance(value: number | undefined, currency: string | undefined): string {
  if (value === undefined) return "?";
  const rounded = value < 1 ? value.toFixed(4) : value.toFixed(2);
  return currency ? `${rounded} ${currency}` : rounded;
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

function deepseekColor(state: DeepSeekProviderState): string {
  if (state.status === "ok" && typeof state.totalBalance === "number") {
    if (state.totalBalance < 5) return COLOR_DANGER;
    if (state.totalBalance < 20) return COLOR_WARN;
    return COLOR_OK;
  }
  if (state.status === "rate-limited") return COLOR_DANGER;
  if (state.status === "error") return COLOR_DANGER;
  if (state.status === "missing-key") return COLOR_MUTED;
  return COLOR_OK;
}

function minimaxColor(state: MiniMaxProviderState): string {
  if (state.status === "ok") {
    const fiveHour = usageRatio(state.quota?.fiveHour) ?? 0;
    const weekly = usageRatio(state.quota?.weekly) ?? 0;
    const worst = Math.max(fiveHour, weekly);
    if (worst >= 0.8) return COLOR_DANGER;
    if (worst >= 0.5) return COLOR_WARN;
    return COLOR_OK;
  }
  if (state.status === "rate-limited" || state.status === "error") return COLOR_DANGER;
  if (state.status === "missing-key") return COLOR_MUTED;
  return COLOR_OK;
}

function buildCodexLines(state: CodexProviderState, active: boolean): PanelLine[] {
  if (state.status === "empty") return [{ text: "no accounts", color: COLOR_MUTED }];
  if (state.status === "error") {
    return [{ text: state.error ?? "codex read error", color: dimIfInactive(active, COLOR_DANGER) }];
  }
  const lines: PanelLine[] = [];
  for (const account of state.accounts) {
    const marker = state.activeAlias === account.alias ? "●" : "○";
    lines.push({
      text: `${marker} ${account.alias} · ${codexAccountHealth(account)} · exp:${formatExpiry(account.expiresAt)}`,
      color: dimIfInactive(active, codexAccountColor(account)),
    });
    const fiveHour = account.rateLimits?.fiveHour;
    const weekly = account.rateLimits?.weekly;
    lines.push({
      text: `  5h ${formatPercent(fiveHour)} (${formatReset(fiveHour)}) · 7d ${formatPercent(weekly)} (${formatReset(weekly)})`,
      color: dimIfInactive(active, usageColor(fiveHour)),
    });
  }
  return lines;
}

function buildDeepSeekLines(state: DeepSeekProviderState, active: boolean): PanelLine[] {
  if (state.status === "missing-key") {
    return [{ text: "DEEPSEEK_API_KEY not set", color: COLOR_MUTED }];
  }
  if (state.status === "error") {
    return [{ text: `error: ${state.error ?? "unknown"}`, color: dimIfInactive(active, COLOR_DANGER) }];
  }
  if (state.status === "rate-limited") {
    return [
      { text: "● deepseek · rate-limited", color: dimIfInactive(active, COLOR_DANGER) },
      { text: `  ${state.error ?? "throttled"}`, color: COLOR_MUTED },
    ];
  }
  const lines: PanelLine[] = [];
  lines.push({ text: "● deepseek · pay-per-token", color: dimIfInactive(active, deepseekColor(state)) });
  if (typeof state.totalBalance === "number") {
    lines.push({
      text: `  Restante ${formatBalance(state.totalBalance, state.currency)}`,
      color: dimIfInactive(active, deepseekColor(state)),
    });
  }
  if (state.isAvailable === false) {
    lines.push({ text: "  ⚠ balance insufficient", color: dimIfInactive(active, COLOR_DANGER) });
  }
  return lines;
}

function buildMiniMaxLines(state: MiniMaxProviderState, active: boolean): PanelLine[] {
  if (state.status === "missing-key") {
    return [
      { text: "● minimax · no key", color: COLOR_MUTED },
      { text: "  set MINIMAX_API_KEY", color: COLOR_MUTED },
    ];
  }
  if (state.status === "error") {
    return [
      { text: `● minimax · ${state.error ?? "error"}`, color: dimIfInactive(active, COLOR_DANGER) },
      ...(state.keySource ? [{ text: `  source ${state.keySource}`, color: COLOR_MUTED }] : []),
    ];
  }
  if (state.status === "rate-limited") {
    return [{ text: "● minimax · rate-limited", color: dimIfInactive(active, COLOR_DANGER) }];
  }

  const lines: PanelLine[] = [];
  const label = state.type === "token-plan" ? "token-plan" : "pay-per-token";
  lines.push({ text: `● minimax · ${label}`, color: dimIfInactive(active, minimaxColor(state)) });

  if (state.manualCredits) {
    const balance = state.manualCredits.balance;
    if (typeof balance === "number") {
      const formatted = balance.toLocaleString("en-US", { maximumFractionDigits: 4 });
      const unit = state.manualCredits.unit ?? "credits";
      lines.push({
        text: `  credits ${formatted} ${unit}`,
        color: dimIfInactive(active, balance < 100 ? COLOR_DANGER : balance < 500 ? COLOR_WARN : COLOR_OK),
      });
    }
    if (state.manualCredits.note) {
      lines.push({ text: `  note: ${state.manualCredits.note}`, color: COLOR_MUTED });
    }
  } else if (state.type === "token-plan" && state.quota) {
    const fiveHour = state.quota.fiveHour;
    const weekly = state.quota.weekly;
    lines.push({
      text: `  5h ${formatPercent(fiveHour)} (${formatReset(fiveHour)}) · 7d ${formatPercent(weekly)} (${formatReset(weekly)})`,
      color: dimIfInactive(active, usageColor(fiveHour)),
    });
  } else {
    lines.push({ text: "  pay-per-token · no live balance endpoint", color: COLOR_MUTED });
  }
  return lines;
}

function buildPanelState(api: TuiPluginApi, activeProviderOverride?: ActiveProvider): PanelState {
  const snapshot = loadState();
  if (!snapshot) {
    return { status: "empty", lines: [{ text: "Providers panel: waiting for monitor", color: COLOR_MUTED }] };
  }

  const activeProvider = activeProviderOverride ?? currentSessionProvider(api);
  const isActive = (provider: ActiveProvider) => activeProvider === undefined || activeProvider === provider;
  const lines: PanelLine[] = [];
  lines.push({ text: "● codex · subscription", color: dimIfInactive(isActive("codex"), COLOR_OK) });
  lines.push(...buildCodexLines(snapshot.providers.codex, isActive("codex")));
  lines.push({ text: "" });
  lines.push(...buildDeepSeekLines(snapshot.providers.deepseek, isActive("deepseek")));
  lines.push({ text: "" });
  lines.push(...buildMiniMaxLines(snapshot.providers.minimax, isActive("minimax")));

  const ageMin = Math.round((Date.now() - snapshot.updatedAt) / 60_000);
  if (ageMin > 5) {
    lines.push({ text: "" });
    lines.push({ text: `last update ${ageMin}m ago`, color: COLOR_WARN });
  }

  return { status: "ok", lines };
}

function ProvidersPanel(props: { api: TuiPluginApi }) {
  const [activeProvider, setActiveProvider] = createSignal<ActiveProvider | undefined>(currentSessionProvider(props.api));
  const [panel, setPanel] = createSignal<PanelState>(buildPanelState(props.api, activeProvider()));

  const refresh = () => {
    const current = currentSessionProvider(props.api);
    setActiveProvider(current);
    setPanel(buildPanelState(props.api, current));
  };

  const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
  const offMessageUpdated = props.api.event.on("message.updated", (event) => {
    const info = event.properties.info;
    if (info.role !== "assistant") return;

    const sessionID = currentSessionID(props.api);
    if (sessionID && info.sessionID !== sessionID) return;

    const provider = normalizeProvider(info.providerID, info.modelID);
    if (!provider) return;

    setActiveProvider(provider);
    setPanel(buildPanelState(props.api, provider));
  });

  onCleanup(() => {
    clearInterval(interval);
    offMessageUpdated();
  });

  return (
    <Show when={panel().status !== "empty"}>
      <box gap={0}>
        <text fg={props.api.theme.current.text}>
          <b>Providers</b>
        </text>
        <box gap={0}>
          {panel().lines.map((line) => (
            <text fg={line.color ?? props.api.theme.current.textMuted} wrapMode="none">
              {line.text || " "}
            </text>
          ))}
        </box>
      </box>
    </Show>
  );
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content() {
        return <ProvidersPanel api={api} />;
      },
    },
  });
};

const pluginModule: TuiPluginModule & { id: string } = { id, tui };

// PROVIDERS_STATE_PATH is intentionally retained for future diagnostics /
// custom loaders. Suppress the unused-import warning.
void PROVIDERS_STATE_PATH;

export default pluginModule;
