#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const STATE_PATH = resolvePath(
  process.env.OPENCODE_PROVIDERS_STATE_PATH,
  join(homedir(), ".config", "opencode", "providers-state.json"),
);

const STALE_AFTER_MS = 10 * 60_000;

function resolvePath(value, fallback) {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (isAbsolute(raw)) return raw;
  return join(homedir(), raw.replace(/^~\/?/, ""));
}

function pct(window) {
  if (!window || typeof window.limit !== "number" || typeof window.remaining !== "number" || window.limit <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - window.remaining / window.limit) * 100)));
}

function ageText(ts) {
  if (typeof ts !== "number") return "?";
  const ageMs = Date.now() - ts;
  if (ageMs < 0) return "agora";
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m atrás` : `${hrs}h atrás`;
}

function resetText(resetAt) {
  if (typeof resetAt !== "number") return null;
  const diff = resetAt - Date.now();
  if (diff <= 0) return "00h";
  const hrs = Math.ceil(diff / 3_600_000);
  const days = Math.floor(hrs / 24);
  const rem = hrs % 24;
  return days > 0 ? `${days}d ${String(rem).padStart(2, "0")}h` : `${String(hrs).padStart(2, "0")}h`;
}

try {
  const json = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  const codex = json?.providers?.codex;
  const account = codex?.accounts?.find((a) => a.alias === codex.activeAlias) ?? codex?.accounts?.[0];
  const weekly = account?.rateLimits?.weekly;
  const fiveHour = account?.rateLimits?.fiveHour;
  const topUpdatedAt = json?.updatedAt;
  const stale = typeof topUpdatedAt === "number" && Date.now() - topUpdatedAt > STALE_AFTER_MS;

  if (!account || (!weekly && !fiveHour)) {
    console.log("Codex: sem dados");
    process.exit(0);
  }

  const parts = [];
  if (fiveHour) parts.push(`5h ${pct(fiveHour)}%${resetText(fiveHour.resetAt) ? ` (${resetText(fiveHour.resetAt)})` : ""}`);
  if (weekly) parts.push(`7d ${pct(weekly)}%${resetText(weekly.resetAt) ? ` (${resetText(weekly.resetAt)})` : ""}`);

  const used = weekly ? pct(weekly) : pct(fiveHour);
  const remaining = typeof used === "number" ? 100 - used : null;
  const snapshot = ageText(topUpdatedAt);

  console.log(`Codex ${parts.join(" · ")}`);
  console.log(`Snapshot ${snapshot}${stale ? " · stale" : ""}${typeof remaining === "number" && weekly ? ` · ${remaining}% restante` : ""}`);
} catch {
  console.log(`Codex: não foi possível ler ${STATE_PATH}`);
  process.exit(1);
}
