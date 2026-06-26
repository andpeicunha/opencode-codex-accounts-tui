/** @jsxImportSource @opentui/solid */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_PATH = join(homedir(), ".config/opencode/providers-state.json");

const fmtReset = (ms: number | undefined): string => {
  if (!ms) return "?";
  const d = new Date(ms);
  return `${d.getHours()}h`;
};

const readState = (): any => {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); }
  catch { return null; }
};

export const MinimaxUsagePanel = () => {
  const m = readState()?.providers?.minimax?.quota;
  if (!m?.fiveHour || !m?.weekly) return null;

  return (
    <box>
      <text><b>Minimax</b></text>
      <text> 5h {m.fiveHour.used}% ({fmtReset(m.fiveHour.resetAt)}) · 7d {m.weekly.used}% ({fmtReset(m.weekly.resetAt)})</text>
    </box>
  );
};
