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
import { panelEnabled } from "./lib/panel-enabled.js";

const REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_REFRESH_MS || DEFAULT_REFRESH_MS);
const NETWORK_REFRESH_MS = Number(process.env.OPENCODE_PROVIDERS_NETWORK_REFRESH_MS || 60_000);
const FAILURE_THRESHOLD = Number(process.env.OPENCODE_PROVIDERS_ERROR_THRESHOLD || 3);

interface FailureTracker<T> {
  count: number;
  lastGood: T | null;
}

const deepseekFailures: FailureTracker<DeepSeekProviderState> = { count: 0, lastGood: null };
const opencodeGoFailures: FailureTracker<OpenCodeGoProviderState> = { count: 0, lastGood: null };
const minimaxFailures: FailureTracker<MiniMaxProviderState> = { count: 0, lastGood: null };
const cache = new Map<string, { value: unknown; updatedAt: number }>();

async function probeAtMost<T>(
  key: string,
  enabled: boolean,
  disabled: T,
  probe: () => Promise<T>,
): Promise<T> {
  if (!enabled) return disabled;
  const previous = cache.get(key) as { value: T; updatedAt: number } | undefined;
  if (previous && Date.now() - previous.updatedAt < NETWORK_REFRESH_MS) return previous.value;
  const value = await probe();
  cache.set(key, { value, updatedAt: Date.now() });
  return value;
}

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
  const [freshCodex, freshDeepSeek, freshMiniMax, freshOpenCodeGo] = await Promise.all([
    probeAtMost("codex", panelEnabled("CODEX"), { type: "subscription", status: "disabled", accounts: [] }, probeCodex),
    probeAtMost("deepseek", panelEnabled("DEEPSEEK"), { type: "pay-per-token", status: "disabled" }, probeDeepSeek),
    probeAtMost("minimax", panelEnabled("MINIMAX"), { type: "pay-per-token", status: "disabled" }, probeMiniMax),
    probeAtMost("opencode-go", panelEnabled("OPENCODE_GO"), { type: "subscription", status: "disabled" }, probeOpenCodeGo),
  ]);

  const finalDeepSeek = applyTransientSuppression(deepseekFailures, freshDeepSeek);
  const finalOpenCodeGo = applyTransientSuppression(opencodeGoFailures, freshOpenCodeGo);
  const finalMiniMax = applyTransientSuppression(minimaxFailures, freshMiniMax);

  return {
    updatedAt: Date.now(),
    providers: {
      codex: freshCodex,
      deepseek: finalDeepSeek,
      opencodeGo: finalOpenCodeGo,
      minimax: finalMiniMax,
    },
  };
}

const monitor: Plugin = async () => {
  let interval: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let polling = false;
  let lastProvidersFingerprint: string | undefined;

  const safeWrite = (state: ProvidersState) => {
    if (stopped) return;
    const fingerprint = JSON.stringify(state.providers);
    if (fingerprint === lastProvidersFingerprint) return;
    try {
      writeState(state);
      lastProvidersFingerprint = fingerprint;
    } catch {
      // state file may be locked by another process; retry on next tick
    }
  };

  const tick = () => {
    if (polling || stopped) return;
    polling = true;
    void pollOnce()
      .then(safeWrite)
      .catch(() => undefined)
      .finally(() => { polling = false; });
  };

  tick();
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
