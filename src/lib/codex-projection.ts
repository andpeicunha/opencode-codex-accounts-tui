/**
 * Conservative weekly usage projection for Codex.
 *
 * Input is a sparse, append-only list of weekly used-percent observations.
 * Each sample records which weekly reset window it belongs to. Projection
 * derives incremental growth rates only between consecutive samples within the
 * same reset window. Gaps are treated as missing data, never as zero usage.
 *
 * The legacy projection starts from the live weekly used percent and advances
 * to the live weekly reset, using either a global median incremental rate or a
 * weekday-profiled rate with a global fallback for days without coverage.
 *
 * For bursty usage profiles, the user-facing projection also computes an
 * active-pattern view: median rate from positive-delta intervals only, converted
 * to %/day from estimated active hours/day, then projected to the weekly reset.
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

/** Reasonable cap on estimated active hours per day. */
const MAX_ACTIVE_HOURS_PER_DAY = 12;

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
  active: number[];
};

type ActiveInterval = {
  resetAt: number;
  durationHours: number;
};

/**
 * Derive incremental growth rates from consecutive samples of the same reset.
 *
 * - Only pairs with matching resetAt are used.
 * - Negative deltas are ignored (usage resets mid-window are not a signal).
 * - Gaps are not filled with zero; they simply produce no rate.
 *
 * Also collects positive-delta interval metadata for active-hours estimation.
 */
function deriveRates(
  samples: readonly CodexUsageSample[],
): { rates: DerivedRates; activeIntervals: ActiveInterval[] } {
  const global: number[] = [];
  const byDay: number[][] = Array.from({ length: 7 }, () => []);
  const active: number[] = [];
  const activeIntervals: ActiveInterval[] = [];

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

    if (deltaPct > 0) {
      active.push(rate);
      activeIntervals.push({ resetAt: prev.resetAt, durationHours: deltaHours });
    }
  }

  return { rates: { global, byDay, active }, activeIntervals };
}

/**
 * Estimate active hours per day from the most recent reset window.
 *
 * - Uses intervals from the latest reset window first.
 * - Falls back to all observed data when the latest window has no intervals.
 * - Clamped to [0, MAX_ACTIVE_HOURS_PER_DAY].
 */
function estimateActiveHoursPerDay(
  samples: readonly CodexUsageSample[],
  activeIntervals: readonly ActiveInterval[],
): number {
  if (samples.length < 2 || activeIntervals.length === 0) return 0;

  // Latest reset window in the data
  const latestReset = activeIntervals[activeIntervals.length - 1].resetAt;
  const windowIntervals = activeIntervals.filter((i) => i.resetAt === latestReset);
  const windowSamples = samples.filter((s) => s.resetAt === latestReset);

  if (windowIntervals.length > 0 && windowSamples.length >= 2) {
    const activeHours = windowIntervals.reduce((sum, i) => sum + i.durationHours, 0);
    const elapsedDays = (windowSamples[windowSamples.length - 1].at - windowSamples[0].at) / MS_PER_DAY;
    if (elapsedDays > 0) {
      return Math.min(MAX_ACTIVE_HOURS_PER_DAY, Math.max(0, activeHours / elapsedDays));
    }
  }

  // Fallback: all active intervals over the entire observed span
  const totalActiveHours = activeIntervals.reduce((sum, i) => sum + i.durationHours, 0);
  const totalElapsedDays = (samples[samples.length - 1].at - samples[0].at) / MS_PER_DAY;
  if (totalElapsedDays > 0) {
    return Math.min(MAX_ACTIVE_HOURS_PER_DAY, Math.max(0, totalActiveHours / totalElapsedDays));
  }

  return 0;
}

/**
 * Compute active-pattern projection fields.
 *
 * Active median hourly rate is derived from positive-delta intervals only.
 * Daily usage is estimated as rate × active hours/day.
 * Projection is current + daily × days remaining, clamped 0-100.
 * When there are no active intervals, projection equals current and daily is 0.
 */
function computeActiveProjection(
  activeRates: readonly number[],
  activeHoursPerDay: number,
  currentUsedPercent: number,
  daysRemaining: number,
  activeIntervalCount: number,
): {
  activeProjectedUsedPercent: number;
  activeRisk: CodexWeeklyProjection["risk"];
  activeDailyUsedPercent: number;
} {
  if (activeIntervalCount === 0) {
    return {
      activeProjectedUsedPercent: clampPercent(currentUsedPercent),
      activeRisk: riskBand(clampPercent(currentUsedPercent)),
      activeDailyUsedPercent: 0,
    };
  }

  const activeMedianRate = median(activeRates);
  const activeDailyUsedPercent = clampPercent(activeMedianRate * activeHoursPerDay);
  const projected = clampPercent(currentUsedPercent + activeDailyUsedPercent * Math.max(0, daysRemaining));

  return {
    activeProjectedUsedPercent: projected,
    activeRisk: riskBand(projected),
    activeDailyUsedPercent,
  };
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

  const { rates: { global: globalRates, byDay: ratesByDay, active: activeRates }, activeIntervals } = deriveRates(valid);
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

  // Active-pattern projection
  const activeIntervalCount = activeRates.length;
  const activeHoursPerDay = estimateActiveHoursPerDay(valid, activeIntervals);
  const daysRemaining = Math.max(0, (currentResetAt - now) / MS_PER_DAY);

  const active = computeActiveProjection(
    activeRates,
    activeHoursPerDay,
    currentUsedPercent,
    daysRemaining,
    activeIntervalCount,
  );

  return {
    projectedUsedPercent: projected,
    risk: riskBand(projected),
    method: useProfile ? "weekday" : "global",
    intervalCount: globalRates.length,
    weekdayCoverage,
    activeProjectedUsedPercent: active.activeProjectedUsedPercent,
    activeRisk: active.activeRisk,
    activeDailyUsedPercent: active.activeDailyUsedPercent,
    activeDaysRemaining: daysRemaining,
    activeIntervalCount,
  };
}
