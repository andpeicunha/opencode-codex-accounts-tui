/**
 * Local, append-only history for Codex weekly usage samples.
 *
 * - Stored as JSON in ~/.config/opencode/codex-usage-history.json
 *   (overridable via OPENCODE_CODEX_USAGE_HISTORY_PATH).
 * - Retains at most one sample per hour and 30 days of history.
 * - Writes are atomic (temp file + rename).
 * - Records only the timestamp and weekly used-percent; tokens, models,
 *   account identifiers, or request metadata are deliberately excluded.
 *
 * Samples are only collected from real /wham/usage weekly windows observed by
 * the probe. No extra timers, polling, or network requests are introduced.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { resolvePath } from "../providers-state.js";

export const CODEX_USAGE_HISTORY_PATH = resolvePath(
  process.env.OPENCODE_CODEX_USAGE_HISTORY_PATH,
  join(homedir(), ".config", "opencode", "codex-usage-history.json"),
);

/** Retention window: 30 days in milliseconds. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/** Minimum spacing between recorded samples: 1 hour in milliseconds. */
export const SAMPLE_INTERVAL_MS = 60 * 60 * 1_000;

export type CodexUsageSample = {
  /** UTC timestamp when the sample was observed. */
  at: number;
  /** Weekly used percent observed from the real quota window (0-100). */
  usedPercent: number;
  /** Weekly reset timestamp this sample belongs to, in milliseconds. */
  resetAt?: number;
  /** Optional account alias for multi-account deduplication. */
  accountAlias?: string;
};

export type CodexUsageHistory = {
  updatedAt?: number;
  samples: CodexUsageSample[];
};

function readHistory(): CodexUsageHistory {
  if (!existsSync(CODEX_USAGE_HISTORY_PATH)) return { samples: [] };
  try {
    const parsed = JSON.parse(readFileSync(CODEX_USAGE_HISTORY_PATH, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as CodexUsageHistory).samples)) {
      return parsed as CodexUsageHistory;
    }
  } catch {
    // Corrupt history is treated as empty; it will be rebuilt from new samples.
  }
  return { samples: [] };
}

function isValidSample(sample: unknown): sample is CodexUsageSample {
  if (!sample || typeof sample !== "object") return false;
  const s = sample as Record<string, unknown>;
  return (
    typeof s.at === "number" &&
    typeof s.usedPercent === "number" &&
    (s.resetAt === undefined || typeof s.resetAt === "number")
  );
}

/**
 * Remove samples older than 30 days and any entries that are not valid.
 *
 * @param now - Anchor timestamp for retention (usually Date.now()).
 */
export function pruneHistory(
  history: CodexUsageHistory,
  now = Date.now(),
): CodexUsageHistory {
  const cutoff = now - RETENTION_MS;
  const samples = history.samples
    .filter(isValidSample)
    .filter((s) => s.at >= cutoff && s.usedPercent >= 0 && s.usedPercent <= 100)
    .sort((a, b) => a.at - b.at);
  return { ...history, updatedAt: now, samples };
}

/**
 * Return the current valid sample list, pruned and sorted oldest-first.
 */
export function loadCodexUsageHistory(now = Date.now(), accountAlias?: string): CodexUsageSample[] {
  const allSamples = pruneHistory(readHistory(), now).samples;
  if (!accountAlias) return allSamples;
  return allSamples.filter((s) => s.accountAlias === accountAlias);
}

/**
 * Atomically write the history file, creating the parent directory if needed.
 */
function writeHistory(history: CodexUsageHistory): void {
  const dir = dirname(CODEX_USAGE_HISTORY_PATH);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.codex-usage-history.${process.pid}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(history, null, 2) + "\n");
  renameSync(tmpPath, CODEX_USAGE_HISTORY_PATH);
}

/**
 * Record a weekly usage sample if at least one hour has passed since the last
 * recorded sample. Samples are de-duplicated by hour and history is pruned to
 * 30 days before writing.
 *
 * @param usedPercent - Weekly used percent from the real quota window (0-100).
 * @param resetAt - Weekly reset timestamp this sample belongs to, in milliseconds.
 * @param now - Timestamp to record for this observation.
 */
export function recordWeeklySample(
  usedPercent: number,
  resetAt: number | undefined,
  now = Date.now(),
  accountAlias?: string,
): void {
  if (!Number.isFinite(usedPercent)) return;
  const clamped = Math.max(0, Math.min(100, usedPercent));
  const history = pruneHistory(readHistory(), now);
  const lastSameAlias = accountAlias
    ? [...history.samples].reverse().find((s) => s.accountAlias === accountAlias)
    : history.samples[history.samples.length - 1];
  if (lastSameAlias && now - lastSameAlias.at < SAMPLE_INTERVAL_MS) return;
  const sample: CodexUsageSample = { at: now, usedPercent: clamped };
  if (typeof resetAt === "number" && Number.isFinite(resetAt)) {
    sample.resetAt = resetAt;
  }
  if (accountAlias) {
    sample.accountAlias = accountAlias;
  }
  history.samples.push(sample);
  history.updatedAt = now;
  try {
    writeHistory(pruneHistory(history, now));
  } catch {
    // History is best-effort; a failed write must not break the probe.
  }
}
