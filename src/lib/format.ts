/** @jsxImportSource @opentui/solid */
// Shared color constants + format helpers. Single source of truth for all panels.
// All env-overridable so users can customize without forking.

export const COLOR_OK = process.env.OPENCODE_PROVIDERS_TUI_COLOR_OK || "#22c55e";
export const COLOR_WARN = process.env.OPENCODE_PROVIDERS_TUI_COLOR_WARN || "#f59e0b";
export const COLOR_DANGER = process.env.OPENCODE_PROVIDERS_TUI_COLOR_DANGER || "#ef4444";
export const COLOR_MUTED = process.env.OPENCODE_PROVIDERS_TUI_COLOR_MUTED || "#6b7280";

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;
const HOURS_PER_DAY = 24;

/**
 * Compact reset timer. Returns "now", "?m", "?h", or "?d".
 * Handles 0/NaN/null gracefully.
 */
export function formatDurationShort(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "?";
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  const minutes = Math.ceil(diff / MS_PER_MIN);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(hours / HOURS_PER_DAY)}d`;
}

/**
 * Zero-padded "HH:MM" for short windows (≤ a few hours).
 * Returns "00:00" when expired.
 */
export function formatDurationHM(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "?";
  const diff = ms - Date.now();
  if (diff <= 0) return "00:00";
  const totalMinutes = Math.ceil(diff / MS_PER_MIN);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Color for percentage-based usage (0-100).
 * ≥80% danger, ≥50% warn, else ok.
 */
export function usageColor(usedPct: number): string {
  if (usedPct >= 80) return COLOR_DANGER;
  if (usedPct >= 50) return COLOR_WARN;
  return COLOR_OK;
}

/**
 * Color for USD balance (deepseek).
 * <1 DANGER, <3 WARN, else OK.
 */
export function balanceColor(balance: number): string {
  if (balance < 1) return COLOR_DANGER;
  if (balance < 3) return COLOR_WARN;
  return COLOR_OK;
}

/**
 * Format cents to "X.YZ" dollars.
 */
export function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** MS_PER_DAY constant for callers that need day math. */
export { MS_PER_DAY };
