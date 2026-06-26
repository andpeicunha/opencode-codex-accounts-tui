/** @jsxImportSource @opentui/solid */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_PATH = join(homedir(), ".config/opencode/providers-state.json");

const readState = (): any => {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); }
  catch { return null; }
};

export const DeepseekUsagePanel = () => {
  const ds = readState()?.providers?.deepseek;
  if (!ds || ds.status !== "ok") return null;

  const balance = ds.totalBalance?.toFixed(2) ?? "?";
  const currency = ds.currency ?? "USD";

  return (
    <box>
      <text><b>Deepseek</b></text>
      <text> Restante {balance} {currency}</text>
    </box>
  );
};
