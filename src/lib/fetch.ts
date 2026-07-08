/**
 * Shared fetch helper with abort-based timeout.
 * Single source of truth for all probes that need HTTP.
 */

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 80);
  return String(error).slice(0, 80);
}