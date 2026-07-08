/**
 * Server-side monitor: orchestrates provider probes and writes a unified
 * state file consumed by the TUI sidebar.
 *
 * Each provider has its own probe in ./probes/ that knows how to fetch its
 * data and shape it into the providers-state contract. This file only
 * coordinates timing, transient-failure suppression, and the write loop.
 */
import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_REFRESH_MS,
  PROVIDERS_STATE_PATH,
  type DeepSeekProviderState,
  type MiniMaxProviderState,
  type OpenCodeGoProviderState,
  type ProvidersState,
} from "./providers-state.js";
import { probeCodex } from "./probes/codex.js";
import { probeDeepSeek } from "./probes/deepseek.js";
import { probeMiniMax } from "./probes/minimax.js";
import { probeOpenCodeGo } from "./probes/opencode-go.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_REFRESH_MS || 5_000);
const FAILURE_THRESHOLD = Number(process.env.OPENCODE_PROVIDERS_ERROR_THRESHOLD || 3);

interface FailureTracker<T> {
  count: number;
  lastGood: T | null;
}

const deepseekFailures: FailureTracker<DeepSeekProviderState> = { count: 0, lastGood: null };
const opencodeGoFailures: FailureTracker<OpenCodeGoProviderState> = { count: 0, lastGood: null };
const minimaxFailures: FailureTracker<MiniMaxProviderState> = { count: 0, lastGood: null };

// Atomic write: write to a temp file then rename. The TUI watcher fires once
// on the rename, and readers never see a partial JSON.
function writeState(state: ProvidersState): void {
  mkdirSync(dirname(PROVIDERS_STATE_PATH), { recursive: true });
  const tmpPath = join(dirname(PROVIDERS_STATE_PATH), `.providers-state.${process.pid}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmpPath, PROVIDERS_STATE_PATH);
}

function applyTransientSuppression<T extends { status: string; transient?: boolean }>(
  tracker: FailureTracker<T>,
  fresh: T,
): T {
  if (fresh.status === "error" && fresh.transient === true) {
    tracker.count++;
    if (tracker.count < FAILURE_THRESHOLD && tracker.lastGood?.status === "ok") {
      return tracker.lastGood;
    }
  } else if (fresh.status === "ok") {
    tracker.count = 0;
    tracker.lastGood = fresh;
  }
  return fresh;
}

async function pollOnce(): Promise<ProvidersState> {
  const [freshDeepSeek, freshMiniMax, freshOpenCodeGo] = await Promise.all([
    probeDeepSeek(),
    probeMiniMax(),
    probeOpenCodeGo(),
  ]);

  const finalDeepSeek = applyTransientSuppression(deepseekFailures, freshDeepSeek);
  const finalOpenCodeGo = applyTransientSuppression(opencodeGoFailures, freshOpenCodeGo);
  const finalMiniMax = applyTransientSuppression(minimaxFailures, freshMiniMax);

  return {
    updatedAt: Date.now(),
    providers: {
      codex: probeCodex(),
      deepseek: finalDeepSeek,
      opencodeGo: finalOpenCodeGo,
      minimax: finalMiniMax,
    },
  };
}

const monitor: Plugin = async () => {
  let interval: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const safeWrite = (state: ProvidersState) => {
    if (stopped) return;
    try {
      writeState(state);
    } catch {
      // state file may be locked by another process; retry on next tick
    }
  };

  const tick = () => {
    void pollOnce().then(safeWrite).catch(() => undefined);
  };

  void pollOnce().then(safeWrite).catch(() => undefined);
  interval = setInterval(tick, REFRESH_MS);
  if (typeof interval.unref === "function") interval.unref();

  return {
    async dispose() {
      stopped = true;
      if (interval) clearInterval(interval);
    },
  };
};

const pluginModule: PluginModule = { id: "opencode-providers-monitor", server: monitor };

export default pluginModule;
