#!/usr/bin/env node
/**
 * Terminal status viewer for oc-codex-multi-account.
 *
 * Usage:
 *   node bin/codex-status.mjs          # single view
 *   node bin/codex-status.mjs --watch   # auto-refresh every 60s
 *   node bin/codex-status.mjs --watch 30  # auto-refresh every 30s
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const STORE_PATH = getEnvPath(
  "OPENCODE_CODEX_ACCOUNTS_STORE_PATH",
  join(homedir(), ".config", "opencode", "codex-multi-account-accounts.json"),
);

// ANSI colors
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[38;2;34;197;94m",
  yellow: "\x1b[38;2;245;158;11m",
  red: "\x1b[38;2;239;68;68m",
  gray: "\x1b[38;2;120;120;120m",
  white: "\x1b[38;2;220;220;220m",
};

function getEnvPath(key, fallback) {
  const val = process.env[key];
  if (!val?.trim()) return fallback;
  const t = val.trim();
  if (isAbsolute(t)) return t;
  return join(homedir(), t.replace(/^~\/?/, ""));
}

function util(w) {
  if (!w || typeof w.remaining !== "number" || typeof w.limit !== "number" || w.limit <= 0) return null;
  return Math.max(0, Math.min(1, 1 - w.remaining / w.limit));
}

function pct(w) {
  const r = util(w);
  return r === null ? "?" : `${Math.round(r * 100)}%`;
}

function resetIn(w) {
  if (!w?.resetAt) return "?";
  const diff = w.resetAt - Date.now();
  if (diff <= 0) return "now";
  const m = Math.ceil(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.ceil(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.ceil(h / 24)}d`;
}

function colorForUsage(w) {
  const r = util(w);
  if (r === null) return C.gray;
  if (r >= 0.8) return C.red;
  if (r >= 0.5) return C.yellow;
  return C.green;
}

function formatEmail(email) {
  if (!email) return "unknown";
  if (email.length <= 26) return email;
  const [name, domain] = email.split("@");
  if (!domain) return email.slice(0, 23) + "...";
  return name.slice(0, 10) + "…@" + domain;
}

function printStatus() {
  let store;
  try {
    store = JSON.parse(readFileSync(STORE_PATH, "utf8"));
  } catch {
    console.log(C.red + "Cannot read Codex accounts store." + C.reset);
    console.log(C.gray + STORE_PATH + C.reset);
    return;
  }

  const entries = Object.entries(store.accounts ?? {});
  if (entries.length === 0) {
    console.log(C.gray + "No Codex accounts configured." + C.reset);
    return;
  }

  console.log(C.bold + C.white + "  Codex Accounts" + C.reset);
  console.log(C.gray + "  " + "─".repeat(40) + C.reset);

  for (const [alias, acct] of entries) {
    const active = store.activeAlias === alias;
    const bullet = active ? C.green + "●" : C.gray + "○";
    const health = acct.authInvalid
      ? C.red + "auth"
      : acct.limitStatus === "error"
        ? C.red + "err"
        : C.green + "ok";
    const aliasColor = active ? C.white : C.gray;

    console.log(`  ${bullet} ${aliasColor}${alias}${C.reset} · ${health}${C.reset}`);
    console.log(`    ${C.gray}${formatEmail(acct.email)}${C.reset}`);

    const fh = acct.rateLimits?.fiveHour;
    const wk = acct.rateLimits?.weekly;
    const fhPct = pct(fh);
    const fhReset = resetIn(fh);
    const wkPct = pct(wk);
    const wkReset = resetIn(wk);
    const lineColor = colorForUsage(fh ?? wk);

    console.log(
      `    ${lineColor}5h ${fhPct} (${fhReset}) · 7d ${wkPct} (${wkReset})${C.reset}`,
    );

    const expiry = acct.expiresAt;
    const expText = expiry
      ? (() => {
          const d = expiry - Date.now();
          if (d <= 0) return "expired";
          const h = Math.round(d / 3_600_000);
          return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
        })()
      : "?";
    console.log(`    ${C.gray}token ${expText} · ${acct.usageCount ?? 0} uses${C.reset}`);
  }

  console.log(C.gray + "  " + "─".repeat(40) + C.reset);
  console.log(C.gray + `  Strategy: ${store.config?.rotationStrategy ?? "?"} · Last: ${new Date(store.lastRotation ?? Date.now()).toLocaleTimeString()}` + C.reset);
}

// --- CLI ---
const args = process.argv.slice(2);
const watchIdx = args.indexOf("--watch");
const watchMode = watchIdx !== -1;
const interval = watchMode && args[watchIdx + 1] ? Number(args[watchIdx + 1]) * 1000 : 60_000;

if (watchMode) {
  const loop = () => {
    console.clear();
    printStatus();
    setTimeout(loop, interval);
  };
  loop();
} else {
  printStatus();
}
