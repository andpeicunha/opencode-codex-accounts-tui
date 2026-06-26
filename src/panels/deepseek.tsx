/** @jsxImportSource @opentui/solid */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_PATH = join(homedir(), ".config/opencode/providers-state.json");

const COLOR_OK = process.env.OPENCODE_PROVIDERS_TUI_COLOR_OK || "#22c55e";
const COLOR_WARN = process.env.OPENCODE_PROVIDERS_TUI_COLOR_WARN || "#f59e0b";
const COLOR_DANGER = process.env.OPENCODE_PROVIDERS_TUI_COLOR_DANGER || "#ef4444";
const COLOR_MUTED = process.env.OPENCODE_PROVIDERS_TUI_COLOR_MUTED || "#6b7280";

const readState = (): any => {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); }
  catch { return null; }
};

// Balance-based: ≥$3 ok, $1-3 warn, <$1 danger.
function balanceColor(balance: number): string {
  if (balance < 1) return COLOR_DANGER;
  if (balance < 3) return COLOR_WARN;
  return COLOR_OK;
}

export const DeepseekUsagePanel = () => {
  const ds = readState()?.providers?.deepseek;
  if (!ds || ds.status !== "ok") return null;

  const balance = ds.totalBalance;
  if (typeof balance !== "number") return null;

  const balanceStr = balance.toFixed(2);
  const currency = ds.currency ?? "USD";
  const color = balanceColor(balance);

  return (
    <box>
      <text><b>Deepseek</b></text>
      <text fg={color}> Restante {balanceStr} {currency}</text>
    </box>
  );
};
