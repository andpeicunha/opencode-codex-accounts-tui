import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { loadCodexUsageHistory } from "../lib/codex-usage-history.js";
import { projectWeeklyUsage } from "../lib/codex-projection.js";

type RateWindow = {
  limit?: number;
  remaining?: number;
  resetAt?: number;
  resetInSec?: number;
};

type CodexState = {
  updatedAt?: number;
  providers?: {
    codex?: {
      activeAlias?: string | null;
      accounts?: Array<{
        alias?: string;
        rateLimits?: {
          fiveHour?: RateWindow;
          weekly?: RateWindow;
        };
      }>;
    };
    deepseek?: {
      status?: string;
      currency?: string;
      totalBalance?: number;
      isAvailable?: boolean;
    };
  };
};

type AssistantMessage = {
  id?: string;
  role?: string;
  time?: { completed?: number };
};

const STATE_PATH = resolvePath(
  process.env.OPENCODE_PROVIDERS_STATE_PATH,
  join(homedir(), ".config", "opencode", "providers-state.json"),
);

const TOKENS_DB_PATH = join(
  homedir(),
  ".local/share/opencode/oh-my-tokens/oh-my-tokens.db",
);

type DSRates = {
  input: number; output: number; cache_read: number; cache_write: number; reasoning: number;
};

const DS_FLASH_RATES: DSRates = { input: 0.14, output: 0.28, cache_read: 0.0028, cache_write: 0.14, reasoning: 0.28 };
const DS_PRO_RATES: DSRates = { input: 0.435, output: 0.87, cache_read: 0.003625, cache_write: 0.435, reasoning: 0.87 };

const STALE_AFTER_MS = 10 * 60_000;
const BAR_WIDTH = 13;
const SEPARATOR = "═".repeat(62);
const COMMANDS = ["usage", "compare"] as const;

const COMMAND_HANDLED_SENTINEL = "__CODEX_USAGE_COMMAND_HANDLED__";
let lastToastMessageId: string | undefined;

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  cyan: "\u001b[36m",
  bold: "\u001b[1m",
};

function handled(): never {
  throw new Error(COMMAND_HANDLED_SENTINEL);
}

function isCommandHandledError(err: unknown): boolean {
  return err instanceof Error && err.message === COMMAND_HANDLED_SENTINEL;
}

function resolvePath(value: string | undefined, fallback: string): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (isAbsolute(raw)) return raw;
  return join(homedir(), raw.replace(/^~\/?/, ""));
}

function pctFromRemaining(window?: RateWindow): number | null {
  if (!window || typeof window.limit !== "number" || typeof window.remaining !== "number" || window.limit <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - window.remaining / window.limit) * 100)));
}

function bar(pct: number | null): string {
  const clamped = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  return "=".repeat(filled) + "-".repeat(BAR_WIDTH - filled);
}

function fmtWindowReset(window?: RateWindow): string {
  const totalMinutes = typeof window?.resetAt === "number"
    ? Math.max(0, Math.ceil((window.resetAt - Date.now()) / 60_000))
    : typeof window?.resetInSec === "number"
      ? Math.max(0, Math.ceil(window.resetInSec / 60))
      : null;
  if (totalMinutes === null) return "xxd xxh";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return days > 0
    ? `${days}d ${String(hours).padStart(2, "0")}h`
    : `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function fmtReset(window?: RateWindow): string {
  if (typeof window?.resetAt === "number") {
    const diff = window.resetAt - Date.now();
    if (diff <= 0) return "00h";
    const hours = Math.ceil(diff / 3_600_000);
    const days = Math.floor(hours / 24);
    const rem = hours % 24;
    return days > 0 ? `${days}d ${String(rem).padStart(2, "0")}h` : `${String(hours).padStart(2, "0")}h`;
  }
  if (typeof window?.resetInSec === "number") {
    const hours = Math.ceil(window.resetInSec / 3600);
    const days = Math.floor(hours / 24);
    const rem = hours % 24;
    return days > 0 ? `${days}d ${String(rem).padStart(2, "0")}h` : `${String(hours).padStart(2, "0")}h`;
  }
  return "?";
}

function fmtReset5h(window?: RateWindow): string {
  const totalMinutes = typeof window?.resetAt === "number"
    ? Math.max(0, Math.ceil((window.resetAt - Date.now()) / 60_000))
    : typeof window?.resetInSec === "number"
      ? Math.max(0, Math.ceil(window.resetInSec / 60))
      : null;
  if (totalMinutes === null) return "?";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}

function fmtCompactReset5h(window?: RateWindow): string {
  const totalMinutes = typeof window?.resetAt === "number"
    ? Math.max(0, Math.ceil((window.resetAt - Date.now()) / 60_000))
    : typeof window?.resetInSec === "number"
      ? Math.max(0, Math.ceil(window.resetInSec / 60))
      : null;
  if (totalMinutes === null) return "?";
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}m`;
}

function hasValidReset(window: RateWindow | undefined, maxResetMs: number): window is RateWindow & { resetAt: number } {
  return typeof window?.resetAt === "number"
    && window.resetAt > Date.now()
    && window.resetAt - Date.now() <= maxResetMs;
}

function fmtSnapshot(updatedAt?: number): string {
  if (typeof updatedAt !== "number") return "snapshot desconhecido";
  const ts = new Date(updatedAt).toLocaleString("pt-BR");
  const ageMs = Date.now() - updatedAt;
  if (ageMs < 0) return `snapshot ${ts}`;
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return `snapshot ${ts} · agora`;
  if (mins < 60) return `snapshot ${ts} · ${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `snapshot ${ts} · ${hrs}h${rem ? ` ${rem}m` : ""} atrás`;
}

function isStale(updatedAt?: number): boolean {
  return typeof updatedAt === "number" && Date.now() - updatedAt > STALE_AFTER_MS;
}

function formatRow(label: string, pct: number | null, reset: string): string {
  const pctText = pct === null ? "  ?%" : `${String(Math.round(pct)).padStart(3, " ")}%`;
  return `  ${label.padEnd(4)} ${pctText}  ${bar(pct)}  ${reset}`;
}

function colorForPct(pct: number | null): string {
  if (pct === null) return ANSI.dim;
  if (pct > 90) return ANSI.red;
  if (pct >= 60) return ANSI.yellow;
  return ANSI.green;
}

function colorize(text: string, color: string): string {
  return `${color}${text}${ANSI.reset}`;
}

function formatDeepSeekBalance(deepseek?: NonNullable<CodexState["providers"]>["deepseek"]): string {
  const currency = deepseek?.currency ?? "USD";
  if (deepseek?.status === "missing-key") {
    return `  ${colorize("DS", ANSI.cyan)}  ${colorize("chave ausente", ANSI.red)}`;
  }
  if (deepseek?.status === "rate-limited") {
    return `  ${colorize("DS", ANSI.cyan)}  ${colorize("rate-limited", ANSI.red)}`;
  }
  if (deepseek?.isAvailable === false) {
    return `  ${colorize("DS", ANSI.cyan)}  ${colorize("indisponível", ANSI.red)}`;
  }
  if (typeof deepseek?.totalBalance !== "number") {
    return `  ${colorize("DS", ANSI.cyan)}  ${colorize("sem saldo/dado", ANSI.yellow)}`;
  }
  const balanceColor = deepseek.totalBalance < 1 ? ANSI.red : deepseek.totalBalance < 3 ? ANSI.yellow : ANSI.green;
  return `  ${colorize("DS", ANSI.cyan)}  ${colorize(deepseek.totalBalance.toFixed(2), balanceColor)} ${currency}  ${colorize(deepseek.status === "ok" ? "disponível" : deepseek.status ?? "", balanceColor)}`;
}

function readState(): CodexState | null {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as CodexState;
  } catch {
    return null;
  }
}

function buildMessage(state: CodexState): string {
  return `Usage\n${buildToastMessage(state) ?? "sem dados"}`;
}

function snapshotCodexUsage(): string {
  const state = readState();
  return state ? buildMessage(state) : `Codex: não foi possível ler ${STATE_PATH}`;
}

function buildToastMessage(state: CodexState): string | null {
  const codex = state.providers?.codex;
  const accounts = codex?.accounts ?? [];

  const lines: string[] = [];
  let hasCodex = false;

  if (accounts.length > 0) {
    for (const account of accounts) {
      const weekly = account?.rateLimits?.weekly;
      if (!weekly || typeof weekly.limit !== "number" || typeof weekly.remaining !== "number" || weekly.limit <= 0) continue;
      hasCodex = true;
      const pct = Math.round(((weekly.limit - weekly.remaining) / weekly.limit) * 100);
      const alias = account?.alias ?? "?";
      const label = alias === "andrepeixoto" ? "CODEX PER 7d" : alias === "work" ? "CODEX WOR 7d" : `CODEX ${alias} 7d`;
      lines.push(formatUsageLine(label, pct, weekly));
    }
  }
  if (!hasCodex) {
    lines.push("CODEX: sem dados");
  }

  const deepseek = state.providers?.deepseek;
  const dsText = typeof deepseek?.totalBalance === "number" ? `US$ ${deepseek.totalBalance.toFixed(2)}` : "sem dado";
  lines.push(`DS  ${dsText}`);

  const projection = buildProjectionSection(state);
  if (projection) {
    lines.push("──");
    lines.push(projection);
  }

  return lines.join("\n");
}

function formatUsageLine(label: string, pct: number | null, window?: RateWindow): string {
  const pctText = pct === null ? " ?%" : `${String(Math.round(pct)).padStart(3)}%`;
  return `${label.padEnd(14)} ${pctText} [${bar(pct)}] ${fmtWindowReset(window)}`;
}

function fmtDaysHoursFromDays(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "0h";
  const totalHours = Math.ceil(days * 24);
  const wholeDays = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return wholeDays > 0 ? `${wholeDays}d ${String(hours).padStart(2, "0")}h` : `${hours}h`;
}

function fmtCodexTimeToLimit(currentUsedPercent: number, dailyUsedPercent: number): string | null {
  if (!Number.isFinite(currentUsedPercent) || !Number.isFinite(dailyUsedPercent) || dailyUsedPercent <= 0) {
    return null;
  }
  const remainingPct = Math.max(0, 100 - currentUsedPercent);
  const daysToLimit = remainingPct / dailyUsedPercent;
  return fmtDaysHoursFromDays(daysToLimit);
}

function buildProjectionSection(state: CodexState): string | null {
  const codex = state.providers?.codex;
  const accounts = codex?.accounts ?? [];
  if (accounts.length === 0) return null;

  const now = Date.now();
  let totalCapacity = 0;
  let totalUsed = 0;
  let sumDailyAbsolute = 0;
  let earliestReset: number | null = null;
  let hasAnyProjection = false;

  for (const account of accounts) {
    const weekly = account?.rateLimits?.weekly;
    if (!weekly || typeof weekly.limit !== "number" || typeof weekly.remaining !== "number" || weekly.limit <= 0 || !weekly.resetAt) continue;

    const used = weekly.limit - weekly.remaining;
    totalCapacity += weekly.limit;
    totalUsed += used;
    if (earliestReset === null || weekly.resetAt < earliestReset) {
      earliestReset = weekly.resetAt;
    }

    const currentPct = (used / weekly.limit) * 100;
    const alias = account?.alias;

    const samples = loadCodexUsageHistory(now, alias);
    let projection = projectWeeklyUsage(samples, currentPct, weekly.resetAt, now);

    // Legacy fallback: only for andrepeixoto — reuse old samples without
    // accountAlias when the alias-filtered history is insufficient for a
    // projection (e.g. too few samples to derive enough incremental rates).
    if (!projection && alias === "andrepeixoto") {
      const allSamples = loadCodexUsageHistory(now);
      const legacy = allSamples.filter((s) => !s.accountAlias);
      if (legacy.length > 0) {
        projection = projectWeeklyUsage(legacy, currentPct, weekly.resetAt, now);
      }
    }

    if (projection) {
      hasAnyProjection = true;
      sumDailyAbsolute += (projection.activeDailyUsedPercent / 100) * weekly.limit;
    }
  }

  if (totalCapacity <= 0 || !hasAnyProjection) return null;

  const combinedDailyPct = (sumDailyAbsolute / totalCapacity) * 100;
  const daysUntilReset = earliestReset ? Math.max(0, (earliestReset - now) / (24 * 60 * 60 * 1000)) : 0;
  const currentAggPct = (totalUsed / totalCapacity) * 100;
  const projectedAggPct = Math.max(0, currentAggPct + combinedDailyPct * daysUntilReset);

  const risk = projectedAggPct >= 95 ? "high" : projectedAggPct >= 80 ? "medium" : "low";
  const riskIcon = risk === "high" ? "🟥" : risk === "medium" ? "🟨" : "🟩";

  return `CODEX:        ~${Math.round(combinedDailyPct)}%/dia → ~${Math.round(projectedAggPct)}% ${riskIcon}`;
}

async function showUsageToast(client: Parameters<Plugin>[0]["client"]): Promise<void> {
  const state = readState();
  if (!state) return;
  const message = buildToastMessage(state);
  if (!message) return;
  try {
    await client.tui.showToast({
      body: { title: "Usage", message, variant: "info", duration: 9000 },
    });
  } catch {
    // ignore
  }
}

async function injectRawOutput(client: Parameters<Plugin>[0]["client"], sessionID: string, message: string): Promise<void> {
  try {
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true,
        parts: [{ type: "text", text: message, ignored: true }],
      },
    });
  } catch {
    // ignore
  }
}

// ── Cost comparison helpers ──────────────────────────────────────────

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI (CODEX)",
  "opencode-go": "OC Go",
  deepseek: "DeepSeek",
  "minimax-coding-plan": "MiniMax",
};

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$?";
  if (n === 0) return "$0";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 100) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

function calcDSCost(inp: number, out: number, cache_r: number, cache_w: number, reasoning: number, rates: DSRates): number {
  return (inp * rates.input + out * rates.output + cache_r * rates.cache_read + cache_w * rates.cache_write + reasoning * rates.reasoning) / 1_000_000;
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function fmtProvider(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

type TokenRow = { provider: string; inp: number; out: number; cache_r: number; cache_w: number; reasoning: number; cost: number };

function queryTokens(sql: string, days: number): TokenRow[] {
  try {
    const cutoff = Date.now() - days * 86_400_000;
    const filledSQL = sql.replace(/\?/g, String(cutoff));
    const out = execSync(`sqlite3 --json "${TOKENS_DB_PATH}" "${filledSQL}"`, {
      encoding: "utf8",
      timeout: 5000,
    });
    return JSON.parse(out) as TokenRow[];
  } catch {
    return [];
  }
}

function buildCompareMessage(days: number): string {
  const byProvider = queryTokens(
    `SELECT provider,
            SUM(inp) AS inp, SUM(out) AS out,
            SUM(cache_r) AS cache_r, SUM(cache_w) AS cache_w, SUM(reasoning) AS reasoning,
            SUM(cost) AS cost
     FROM events WHERE ts > ? GROUP BY provider ORDER BY (SUM(inp)+SUM(out)) DESC`,
    days,
  );
  if (byProvider.length === 0) return "sem dados de tokens para comparação.";

  const state = readState();
  const codex = state?.providers?.codex;
  const account = codex?.accounts?.find((a) => a.alias === codex?.activeAlias) ?? codex?.accounts?.[0];

  const codEntry = byProvider.find((r) => r.provider === "openai");
  const dsEntry = byProvider.find((r) => r.provider === "deepseek");

  const monthlyRatio = 30 / days;
  const dsMonthly = dsEntry ? dsEntry.cost * monthlyRatio : null;

  // ── Table helpers ──
  const colWidths = [16, 8, 10, 14];

  function fmtRow(cells: string[], widths: number[]): string {
    return "│ " + cells.map((c, i) => c.padEnd(widths[i])).join(" │ ") + " │";
  }

  function hr(widths: number[]): string {
    return "├" + widths.map((w) => "─".repeat(w + 2)).join("┼") + "┤";
  }

  function top(widths: number[]): string {
    return "┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐";
  }

  function bottom(widths: number[]): string {
    return "└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘";
  }

  const lines: string[] = [];
  lines.push(`📊 COMPARAÇÃO — ${days}d`);
  lines.push(top(colWidths));
  lines.push(fmtRow(["Provider", "Tokens", "Custo real", "DS/mês"], colWidths));
  lines.push(hr(colWidths));

  if (codEntry) {
    const codDsCost = calcDSCost(codEntry.inp, codEntry.out, codEntry.cache_r, codEntry.cache_w, codEntry.reasoning, DS_FLASH_RATES);
    const codMonthly = codDsCost * monthlyRatio;
    lines.push(fmtRow(["Codex", fmtTokens(codEntry.inp + codEntry.out), "$20/mês", `~${fmtUsd(codMonthly)}`], colWidths));
  }

  if (dsEntry && dsMonthly !== null) {
    lines.push(fmtRow(["DeepSeek", fmtTokens(dsEntry.inp + dsEntry.out), fmtUsd(dsEntry.cost), `~${fmtUsd(dsMonthly)}`], colWidths));
  }

  lines.push(bottom(colWidths));

  // ── Capacity section ──
  const weekly = account?.rateLimits?.weekly;
  if (weekly && typeof weekly.limit === "number" && typeof weekly.remaining === "number" && weekly.limit > 0 && weekly.resetAt) {
    const currentPct = (1 - weekly.remaining / weekly.limit) * 100;
    const samples = loadCodexUsageHistory();
    const projection = projectWeeklyUsage(samples, currentPct, weekly.resetAt);

    if (projection) {
      const riskIcon = projection.activeRisk === "high" ? "🟥" : projection.activeRisk === "medium" ? "🟨" : "🟩";
      const dailyPct = Math.round(projection.activeDailyUsedPercent);
      const daysStr = projection.activeDaysRemaining.toFixed(1);
      const projPct = Math.round(projection.activeProjectedUsedPercent);
      const rateStr = fmtCodexTimeToLimit(currentPct, projection.activeDailyUsedPercent);

      lines.push("");
      lines.push("CAPACIDADE");
      lines.push(`- CODEX: ${dailyPct}%/dia × ${daysStr}d → ~${projPct}% ${riskIcon}`);
      if (rateStr) {
        lines.push(`- CODEX RATE: ~${rateStr} → 100%`);
      }

      if (dsMonthly !== null) {
        lines.push("VIABILIDADE");
        lines.push(`- DS RATE/MES: ~${fmtUsd(dsMonthly)}`);
        lines.push(`- $20+${Math.round(dsMonthly)} <> $40 ${dsMonthly < 14 ? "🟩" : dsMonthly <= 18 ? "🟨" : "🟥"}`);
      }
    }
  }

  return lines.join("\n");
}

const server: Plugin = async ({ client }) => {
  return {
    config: async (input) => {
      const cfg = input as unknown as { command?: Record<string, { template: string; description: string }> };
      cfg.command ??= {};
      const DESCRIPTIONS: Record<string, string> = {
        usage: "Usage snapshot de todos os providers (CODEX, OC GO, DS)",
        compare: "Comparação de custos entre providers vs DeepSeek API. Use /compare --N para N dias (padrão 7)",
      };
      for (const name of COMMANDS) {
        cfg.command[name] = {
          template: `/${name}`,
          description: DESCRIPTIONS[name] ?? "",
        };
      }
    },
    "command.execute.before": async (input) => {
      const cmd = (input as { command?: string }).command;
      if (!cmd || !COMMANDS.includes(cmd as (typeof COMMANDS)[number])) return;
      const sessionID = (input as { sessionID?: string }).sessionID;
      if (!sessionID) handled();
      const args = (input as { arguments?: string }).arguments ?? "";
      const days = cmd === "compare" ? parseInt(args.replace(/^-+/, ""), 10) || 7 : 1;
      const message = cmd === "compare" ? buildCompareMessage(days) : snapshotCodexUsage();
      await injectRawOutput(client, sessionID, message);
      handled();
    },
    event: async (input) => {
      const event = (input as { event?: { type?: string; properties?: { info?: AssistantMessage } } }).event;
      if (event?.type !== "message.updated") return;
      const message = event.properties?.info;
      if (message?.role !== "assistant" || !message.time?.completed) return;
      if (message.id && message.id === lastToastMessageId) return;
      lastToastMessageId = message.id;
      await showUsageToast(client);
    },
  };
};

const pluginModule: PluginModule = { id: "codex-usage", server };

export default pluginModule;
