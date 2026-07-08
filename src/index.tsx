/** @jsxImportSource @opentui/solid */
import { panelEnabled } from "./lib/panel-enabled";
import { CodexAccountsPanel } from "./panels/codex";
import { ClaudeUsagePanel } from "./panels/claude";
import { CursorUsagePanel } from "./panels/cursor";
import { DeepseekUsagePanel } from "./panels/deepseek";
import { MinimaxUsagePanel } from "./panels/minimax";
import { OpenCodeGoPanel } from "./panels/opencode-go";
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const id = "opencode-codex-accounts-tui";

const tui: TuiPlugin = async (api) => {
  // Global safety-net: request a re-render every 2s so the TUI repaints
  // when panel signals update from their own interval + event listeners.
  // This is a fallback for when event emissions are sparse or the TUI
  // render cycle doesn't pick up signal changes on its own.
  const renderTimer = setInterval(() => {
    try {
      api.renderer.requestRender();
    } catch {}
  }, 2_000);
  if (typeof renderTimer.unref === "function") renderTimer.unref();

  // Sidebar order: lower renders higher in the panel. Order tuned so the
  // most-used providers (Go, Codex, DeepSeek) cluster at the top; claude and
  // cursor stay opt-in via env vars and appear at the bottom when enabled.
  const panels: Array<[string, number, () => any]> = [
    ["OPENCODE_GO", 145, () => <OpenCodeGoPanel api={api} />],
    ["CODEX",       144, () => <CodexAccountsPanel api={api} />],
    ["DEEPSEEK",    143, () => <DeepseekUsagePanel api={api} />],
    ["MINIMAX",     142, () => <MinimaxUsagePanel api={api} />],
    ["CLAUDE",      141, () => <ClaudeUsagePanel />],
    ["CURSOR",      146, () => <CursorUsagePanel />],
  ];

  for (const [provider, order, render] of panels) {
    if (!panelEnabled(provider)) continue;
    api.slots.register({ order, slots: { sidebar_content: render } });
  }

  api.lifecycle?.onDispose?.(() => {
    clearInterval(renderTimer);
  });
};

const pluginModule: TuiPluginModule & { id: string } = { id, tui };

export default pluginModule;
