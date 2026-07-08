/** @jsxImportSource @opentui/solid */
import { watch } from "node:fs";
import { panelEnabled } from "./lib/panel-enabled";
import { CodexAccountsPanel } from "./panels/codex";
import { ClaudeUsagePanel } from "./panels/claude";
import { CursorUsagePanel } from "./panels/cursor";
import { DeepseekUsagePanel } from "./panels/deepseek";
import { MinimaxUsagePanel } from "./panels/minimax";
import { OpenCodeGoPanel } from "./panels/opencode-go";
import { PROVIDERS_STATE_PATH } from "./providers-state.js";
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const id = "opencode-codex-accounts-tui";

// Sidebar order: lower renders higher in the panel. Order tuned so the
// most-used providers (Go, Codex, DeepSeek) cluster at the top; claude and
// cursor stay opt-in via env vars and appear at the bottom when enabled.
const REGISTRY: Array<[string, number, () => any]> = [
  ["OPENCODE_GO", 145, () => <OpenCodeGoPanel />],
  ["CODEX",       144, () => <CodexAccountsPanel />],
  ["DEEPSEEK",    143, () => <DeepseekUsagePanel />],
  ["MINIMAX",     142, () => <MinimaxUsagePanel />],
  ["CLAUDE",      141, () => <ClaudeUsagePanel />],
  ["CURSOR",      146, () => <CursorUsagePanel />],
];

const tui: TuiPlugin = async (api) => {
  // Watch the state file for changes and force a TUI re-render on every
  // write from the server monitor. Polling is unreliable in the OpenCode
  // TUI (signals update but the viewport may not repaint without an
  // explicit render call), so fs.watch is the primary trigger and the
  // setInterval below is a safety net for changes that happen between
  // write bursts.
  let watcher: ReturnType<typeof watch> | undefined;
  const renderTimer = setInterval(() => {
    try {
      api.renderer.requestRender();
    } catch {}
  }, 2_000);
  if (typeof renderTimer.unref === "function") renderTimer.unref();

  try {
    watcher = watch(PROVIDERS_STATE_PATH, { persistent: false }, () => {
      try {
        api.renderer.requestRender();
      } catch {}
    });
  } catch {
    // state file may not exist yet; the setInterval above covers the gap
  }

  for (const [provider, order, render] of REGISTRY) {
    if (!panelEnabled(provider)) continue;
    api.slots.register({ order, slots: { sidebar_content: render } });
  }

  api.lifecycle?.onDispose?.(() => {
    clearInterval(renderTimer);
    watcher?.close();
  });
};

const pluginModule: TuiPluginModule & { id: string } = { id, tui };

export default pluginModule;
