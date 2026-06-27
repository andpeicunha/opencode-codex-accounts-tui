/** @jsxImportSource @opentui/solid */
import { panelEnabled } from "./lib/panel-enabled";
import { CodexAccountsPanel } from "./panels/codex";
import { ClaudeUsagePanel } from "./panels/claude";
import { CursorUsagePanel } from "./panels/cursor";
import { DeepseekUsagePanel } from "./panels/deepseek";
import { MinimaxUsagePanel } from "./panels/minimax";
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const id = "opencode-codex-accounts-tui";

const REGISTRY: Array<[string, number, () => any]> = [
  ["CODEX",    145, () => <CodexAccountsPanel />],
  ["CLAUDE",   144, () => <ClaudeUsagePanel />],
  ["DEEPSEEK", 143, () => <DeepseekUsagePanel />],
  ["MINIMAX",  142, () => <MinimaxUsagePanel />],
  ["CURSOR",   146, () => <CursorUsagePanel />],
];

const tui: TuiPlugin = async (api) => {
  for (const [provider, order, render] of REGISTRY) {
    if (!panelEnabled(provider)) continue;
    api.slots.register({ order, slots: { sidebar_content: render } });
  }
};

const pluginModule: TuiPluginModule & { id: string } = { id, tui };

export default pluginModule;
