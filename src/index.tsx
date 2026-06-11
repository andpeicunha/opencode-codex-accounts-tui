/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { Show, createSignal, onCleanup } from "solid-js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const id = "opencode-codex-accounts-tui";

const DEFAULT_STORE_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "codex-multi-account-accounts.json",
);

const STORE_PATH = resolveStorePath(process.env.OPENCODE_CODEX_ACCOUNTS_STORE_PATH);
const REFRESH_INTERVAL_MS = Number(process.env.OPENCODE_CODEX_ACCOUNTS_REFRESH_MS || 60_000);
const SIDEBAR_ORDER = Number(process.env.OPENCODE_CODEX_ACCOUNTS_SIDEBAR_ORDER || 145);

const COLOR_OK = process.env.OPENCODE_CODEX_ACCOUNTS_COLOR_OK || "#22c55e";
const COLOR_WARN = process.env.OPENCODE_CODEX_ACCOUNTS_COLOR_WARN || "#f59e0b";
const COLOR_DANGER = process.env.OPENCODE_CODEX_ACCOUNTS_COLOR_DANGER || "#ef4444";

type RateWindow = {
  remaining?: number;
  limit?: number;
  resetAt?: number;
};

type Account = {
  alias?: string;
  email?: string;
  expiresAt?: number;
  usageCount?: number;
  authInvalid?: boolean;
  limitStatus?: string;
  rateLimits?: {
    fiveHour?: RateWindow;
    weekly?: RateWindow;
  };
};

type Store = {
  accounts?: Record<string, Account>;
  activeAlias?: string | null;
};

type PanelLine = {
  text: string;
  color?: string;
};

type PanelState = {
  status: "ok" | "empty" | "error";
  lines: PanelLine[];
};

function resolveStorePath(value?: string): string {
  if (!value?.trim()) return DEFAULT_STORE_PATH;
  const trimmed = value.trim();
  if (isAbsolute(trimmed)) return trimmed;
  return join(homedir(), trimmed.replace(/^~\/?/, ""));
}

function usageRatio(window?: RateWindow): number | null {
  if (!window || typeof window.remaining !== "number" || typeof window.limit !== "number" || window.limit <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, 1 - window.remaining / window.limit));
}

function usageColor(window?: RateWindow): string | undefined {
  const ratio = usageRatio(window);
  if (ratio === null) return undefined;
  if (ratio >= 0.8) return COLOR_DANGER;
  if (ratio >= 0.5) return COLOR_WARN;
  return COLOR_OK;
}

function formatEmail(email?: string): string {
  if (!email) return "unknown";
  if (email.length <= 26) return email;
  const [name, domain] = email.split("@");
  if (!domain) return `${email.slice(0, 23)}...`;
  return `${name.slice(0, 10)}…@${domain}`;
}

function formatWindow(window?: RateWindow): string {
  if (!window || typeof window.remaining !== "number" || typeof window.limit !== "number") return "?";
  const used = Math.round((usageRatio(window) ?? 0) * 100);
  return `${used}% used · ${window.remaining}/${window.limit} left`;
}

function formatExpiry(expiresAt?: number): string {
  if (!expiresAt) return "?";
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.round(diff / 3_600_000);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function accountHealth(account: Account): string {
  if (account.authInvalid) return "auth";
  if (account.limitStatus === "error") return "err";
  return "ok";
}

function accountColor(account: Account): string {
  if (account.authInvalid || account.limitStatus === "error") return COLOR_DANGER;
  const fiveHour = usageRatio(account.rateLimits?.fiveHour) ?? 0;
  const weekly = usageRatio(account.rateLimits?.weekly) ?? 0;
  const worst = Math.max(fiveHour, weekly);
  if (worst >= 0.8) return COLOR_DANGER;
  if (worst >= 0.5) return COLOR_WARN;
  return COLOR_OK;
}

function buildPanelState(): PanelState {
  try {
    const store = JSON.parse(readFileSync(STORE_PATH, "utf8")) as Store;
    const entries = Object.entries(store.accounts ?? {});
    if (entries.length === 0) return { status: "empty", lines: [{ text: "No Codex accounts" }] };

    const lines: PanelLine[] = [];
    for (const [alias, account] of entries) {
      const active = store.activeAlias === alias ? "●" : "○";
      lines.push({ text: `${active} ${alias} · ${accountHealth(account)}`, color: accountColor(account) });
      lines.push({ text: `  ${formatEmail(account.email)}` });
      lines.push({ text: `  5h ${formatWindow(account.rateLimits?.fiveHour)}`, color: usageColor(account.rateLimits?.fiveHour) });
      lines.push({ text: `  7d ${formatWindow(account.rateLimits?.weekly)}`, color: usageColor(account.rateLimits?.weekly) });
      lines.push({ text: `  exp ${formatExpiry(account.expiresAt)} · uses ${account.usageCount ?? 0}` });
    }

    return { status: "ok", lines };
  } catch {
    return { status: "error", lines: [{ text: "Cannot read Codex accounts", color: COLOR_DANGER }] };
  }
}

function CodexAccountsPanel(props: { api: TuiPluginApi }) {
  const [panel, setPanel] = createSignal<PanelState>(buildPanelState());
  const interval = setInterval(() => setPanel(buildPanelState()), REFRESH_INTERVAL_MS);
  onCleanup(() => clearInterval(interval));

  return (
    <Show when={panel().status !== "empty"}>
      <box gap={0}>
        <text fg={props.api.theme.current.text}>
          <b>Codex Accounts</b>
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
        return <CodexAccountsPanel api={api} />;
      },
    },
  });
};

const pluginModule: TuiPluginModule & { id: string } = { id, tui };

export default pluginModule;
