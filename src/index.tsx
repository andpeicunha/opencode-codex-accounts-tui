/** @jsxImportSource @opentui/solid */
import type { JSX } from "@opentui/solid";
import { panelEnabled } from "./lib/panel-enabled";
import { emitTick } from "./lib/tick";
import { CodexAccountsPanel } from "./panels/codex";
import { ClaudeUsagePanel } from "./panels/claude";
import { CursorUsagePanel } from "./panels/cursor";
import { DeepseekUsagePanel } from "./panels/deepseek";
import { MinimaxUsagePanel } from "./panels/minimax";
import { OpenCodeGoPanel } from "./panels/opencode-go";
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const id = "opencode-codex-accounts-tui";

// Single shared refresh cadence for all AI usage panels.
const TICK_MS = Number(process.env.OPENCODE_PROVIDERS_TUI_REFRESH_MS || 15_000);

const tui: TuiPlugin = async (api) => {
  // One shared interval drives all panel polling. Solid repaints reactively.
  // Panels subscribe to the tick via onTick() from src/lib/tick.ts.
  const tickTimer = setInterval(() => {
    emitTick();
  }, TICK_MS);
  if (typeof tickTimer.unref === "function") tickTimer.unref();

  // Sidebar order: lower renders higher in the panel. Order tuned so the
  // most-used providers (Go, Codex, DeepSeek) cluster at the top; claude and
  // cursor stay opt-in via env vars and appear at the bottom when enabled.
  const panels: Array<[string, number, () => JSX.Element]> = [
    ["OPENCODE_GO", 145, () => <OpenCodeGoPanel />],
    ["CODEX",       144, () => <CodexAccountsPanel />],
    ["DEEPSEEK",    143, () => <DeepseekUsagePanel />],
    ["MINIMAX",     142, () => <MinimaxUsagePanel />],
    ["CLAUDE",      141, () => <ClaudeUsagePanel />],
    ["CURSOR",      146, () => <CursorUsagePanel />],
  ];

  for (const [provider, order, render] of panels) {
    if (!panelEnabled(provider)) continue;
    api.slots.register({ order, slots: { sidebar_content: render } });
  }

  api.lifecycle?.onDispose?.(() => {
    clearInterval(tickTimer);
  });
};

const pluginModule: TuiPluginModule & { id: string } = { id, tui };

export default pluginModule;
