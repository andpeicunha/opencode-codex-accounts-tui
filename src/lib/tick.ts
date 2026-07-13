/**
 * Shared refresh tick for all TUI panels.
 *
 * A single interval in the plugin entrypoint calls emitTick() every N seconds.
 * Panels subscribe with onTick(fn) and receive a cleanup function.
 *
 * This replaces per-panel setInterval calls and reduces render churn.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to the shared refresh tick. Returns a cleanup function. */
export function onTick(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Called by the entrypoint's single shared interval. */
export function emitTick(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // One broken panel must not stop refreshes for the others.
    }
  }
}
