/** @jsxImportSource @opentui/solid */
import { loadState } from "../providers-state.js";
import { COLOR_OK, COLOR_WARN, COLOR_DANGER, balanceColor } from "../lib/format.js";

export const DeepseekUsagePanel = () => {
  const ds = loadState()?.providers?.deepseek;
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
