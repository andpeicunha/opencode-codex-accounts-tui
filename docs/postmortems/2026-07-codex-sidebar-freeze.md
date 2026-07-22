# Postmortem: Codex sidebar freeze / stale snapshot

Date: 2026-07-14

## Summary

The Codex sidebar occasionally appeared stuck on an old percentage, and in one
iteration caused the TUI to stop responding to new prompts and `/exit`.

## Impact

- Sidebar showed stale Codex usage for several minutes.
- In the worst case, the OpenCode TUI became unresponsive.
- This affected active sessions until they were restarted.

## What happened

We changed the Codex panel to support the new 7d-only display path and then
reworked the rendering/reactivity path.

Two separate issues showed up during validation:

1. **Stale data path**
   - The provider monitor had overlapping cache layers.
   - That could delay state refreshes much longer than expected.

2. **Panel rendering path**
   - The Codex panel used a render pattern that could freeze updates in the TUI
     until the session was restarted.

## Root cause

The issue was not a single bug.

- The monitor-side cache made refreshes slower and less predictable.
- The panel-side render pattern could keep showing a stale snapshot.

Together, they created the impression that the Codex percent was “stuck”.

## Resolution

- Kept the Codex panel logic minimal.
- Reverted the risky render change.
- Confirmed the live JSON snapshot was still updating.
- Validated that a session restart could recover the fresh view.

## Lessons learned

- Prefer one cache layer, not two overlapping ones.
- Keep TUI rendering simple and reactive.
- If a sidebar value looks stale, verify both the file snapshot and the
  component update path.

## Follow-ups

- Consider a manual refresh affordance in the sidebar.
- Revisit the monitor cache design and keep it single-layer.
- Add a small regression check for stale Codex rendering.
