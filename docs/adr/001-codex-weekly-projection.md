# ADR 001: Codex Weekly Usage Projection

## Context

Codex exposes two `/wham/usage` quota windows. Historically the primary window
was the 5-hour window and the secondary window was the 7-day window. The
backend is moving to dynamic window naming and may already return a ~7-day
window as `primary_window` for some accounts. The TUI must still show the
correct slots without guessing.

## Decision

1. **Dynamic window classification**
   - If the response includes `limit_window_seconds`, classify by duration:
     ~5h -> five-hour, ~7d -> weekly.
   - Otherwise classify by reset horizon: <=6h -> five-hour, ~6-8d -> weekly.
   - If classification fails, the window is not assigned to a slot.

2. **Local history for projection**
   - Keep a JSON file at `~/.config/opencode/codex-usage-history.json`
     (overridable via `OPENCODE_CODEX_USAGE_HISTORY_PATH`).
   - One sample per hour, retained for 30 days, written atomically.
   - Only timestamp and weekly used-percent are stored. Tokens, models,
     account ids, and request metadata are deliberately excluded.
   - Samples are only recorded when the probe observes a real weekly window
     from `/wham/usage`. No extra timers, polling, or network calls are added.

3. **Conservative projection**
    - Each sample records the weekly `resetAt` it belongs to.
    - Derive incremental growth rates (`delta usedPercent / hours`) only from
      consecutive samples within the same reset window.
    - Ignore negative deltas; gaps in observations are treated as missing data,
      never as zero usage.
    - No projection is emitted before 24 valid incremental rates exist.
    - Compute a global median incremental rate and, when 4+ weekdays are covered
      by those rates, a per-day median rate. Days without a profile fall back to
      the global rate, never zero.
    - Start the projection from the live weekly used percent and advance to the
      live weekly reset, applying the chosen rate day by day.
    - Output is the expected used percent at reset, clamped 0-100, plus a risk
      band: low <80%, medium 80-94%, high >=95%. When history is insufficient
      the projection object is omitted entirely.

## Consequences

- The panel can warn users early when the weekly quota is trending toward
  exhaustion before the next reset.
- Projection is honest about uncertainty: insufficient history omits the
  projection object instead of fabricating a number.
- The projection does not rely on the most recent sample value as its starting
  point; it uses the live weekly used percent and reset explicitly.
- No database, background job, or additional network traffic is required.
