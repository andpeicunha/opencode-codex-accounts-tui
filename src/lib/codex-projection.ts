/**
 * Conservative weekly usage projection for Codex.
 *
 * Input is a sparse, append-only list of weekly used-percent observations.
 * Each sample records which weekly reset window it belongs to. Projection
 * derives incremental growth rates only between consecutive samples within the
 * same reset window. Gaps are treated as missing data, never as zero usage.
 *
 * The projection starts from the live weekly used percent and advances to the
 * live weekly reset, using either a global median incremental rate or a
 * weekday-profiled rate with a global fallback for days without coverage.
 *
 * Risk bands:
 * - low:    projected used percent < 80
 * - medium: projected used percent 80-94
 * - high:   projected used percent >= 95
 */
import type { CodexUsageSample } from "./codex-usage-history.js";
import type { CodexWeeklyProjection } from "../providers-state.js";

/** Minimum number of valid incremental rates before any projection is emitted. */
export const MIN_INTERVALS = 24;

/** Minimum number of distinct days of week required for weekday profiling. */
export const MIN_WEEKDAY_COVERAGE = 4;

const MS_PER_HOUR = 60 * 60 * 1_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function riskBand(projectedUsedPercent: number): CodexWeeklyProjection["risk"] {
  if (projectedUsedPercent >= 95) return "high";
  if (projectedUsedPercent >= 80) return "medium";
  return "low";
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function distinctWeekdays(ratesByDay: readonly number[][]): number {
  return ratesByDay.reduce((count, rates) => (rates.length > 0 ? count + 1 : count), 0);
}

type DerivedRates = {
  global: number[];
  byDay: number[][];
};

/**
 * Derive incremental growth rates from consecutive samples of the same reset.
 *
 * - Only pairs with matching resetAt are used.
 * - Negative deltas are ignored (usage resets mid-window are not a signal).
 * - Gaps are not filled with zero; they simply produce no rate.
 */
function deriveRates(samples: readonly CodexUsageSample[]): DerivedRates {
  const global: number[] = [];
  const byDay: number[][] = Array.from({ length: 7 }, () => []);

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (
      typeof prev.resetAt !== "number" ||
      typeof curr.resetAt !== "number" ||
      prev.resetAt !== curr.resetAt
    ) {
      continue;
    }
    const deltaPct = curr.usedPercent - prev.usedPercent;
    const deltaHours = (curr.at - prev.at) / MS_PER_HOUR;
    if (deltaPct < 0 || deltaHours <= 0) continue;
    const rate = deltaPct / deltaHours;
    global.push(rate);
    const dow = new Date(curr.at).getUTCDay();
    byDay[dow].push(rate);
  }

  return { global, byDay };
}

/**
 * Produce a weekly usage projection from local history.
 *
 * The projection starts from the current weekly used percent and advances to
 * the current weekly reset. History is used only to derive incremental growth
 * rates; it is never used as the projection starting point.
 *
 * - Returns undefined when fewer than 24 valid incremental rates exist.
 * - Uses a global median incremental rate when fewer than 4 weekdays are
 *   covered by those rates.
 * - Uses a weekday profile when coverage is sufficient, falling back to the
 *   global rate for any day without its own profile (never zero).
 * - Never treats missing intervals as zero usage.
 *
 * @param samples - Raw usage samples; will be sorted and filtered internally.
 * @param currentUsedPercent - Live weekly used percent (0-100).
 * @param currentResetAt - Live weekly reset timestamp in milliseconds.
 * @param now - Current timestamp used as the projection start.
 */
export function projectWeeklyUsage(
  samples: readonly CodexUsageSample[],
  currentUsedPercent: number,
  currentResetAt: number,
  now = Date.now(),
): CodexWeeklyProjection | undefined {
  if (
    !Number.isFinite(currentUsedPercent) ||
    !Number.isFinite(currentResetAt) ||
    !Number.isFinite(now)
  ) {
    return undefined;
  }

  const valid = samples
    .filter((s) => s && typeof s.at === "number" && typeof s.usedPercent === "number")
    .filter((s) => s.usedPercent >= 0 && s.usedPercent <= 100 && s.at <= now)
    .sort((a, b) => a.at - b.at);

  const { global: globalRates, byDay: ratesByDay } = deriveRates(valid);
  if (globalRates.length < MIN_INTERVALS) {
    return undefined;
  }

  const globalRate = median(globalRates);
  const weekdayCoverage = distinctWeekdays(ratesByDay);
  const useProfile = weekdayCoverage >= MIN_WEEKDAY_COVERAGE;

  const profile: number[] = Array.from({ length: 7 }, (_, dow) =>
    ratesByDay[dow].length > 0 ? median(ratesByDay[dow]) : globalRate,
  );

  const horizon = currentResetAt;
  let projected = clampPercent(currentUsedPercent);

  if (horizon > now) {
    let cursor = now;
    while (cursor < horizon) {
      const next = Math.min(cursor + MS_PER_HOUR, horizon);
      const fractionHours = (next - cursor) / MS_PER_HOUR;
      const dow = new Date(cursor).getUTCDay();
      const rate = useProfile ? profile[dow] : globalRate;
      projected += rate * fractionHours;
      cursor = next;
    }
  }

  projected = clampPercent(projected);

  return {
    projectedUsedPercent: projected,
    risk: riskBand(projected),
    method: useProfile ? "weekday" : "global",
    intervalCount: globalRates.length,
    weekdayCoverage,
  };
}
