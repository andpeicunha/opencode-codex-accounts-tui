#!/usr/bin/env node
import { readFileSync } from "node:fs";

const source = readFileSync("src/plugins/codex-usage.ts", "utf8");

const helperMatch = source.match(/function loadCodexProjectionSamples\([\s\S]*?^}/m);
if (!helperMatch) {
  throw new Error("missing loadCodexProjectionSamples helper");
}

const helper = helperMatch[0];
if (!helper.includes("loadCodexUsageHistory(now, accountAlias)")) {
  throw new Error("projection helper must load alias-specific samples when alias exists");
}
if (!helper.includes("filter((sample) => !sample.accountAlias)")) {
  throw new Error("projection helper must keep legacy unaliased samples isolated");
}

const projectionSection = source.match(/function buildProjectionSection\([\s\S]*?^}/m)?.[0] ?? "";
if (!projectionSection.includes("loadCodexProjectionSamples(now, alias)")) {
  throw new Error("/usage projection must use alias-isolated sample loading");
}
if (projectionSection.includes("loadCodexUsageHistory(now)") || projectionSection.includes("loadCodexUsageHistory(now,")) {
  throw new Error("/usage projection must not load mixed history directly");
}
if (projectionSection.includes("earliestReset") || projectionSection.includes("daysUntilReset")) {
  throw new Error("aggregate projected percentage must not use the earliest reset horizon");
}
if (!projectionSection.includes("sumProjectedAbsolute += (projection.activeProjectedUsedPercent / 100) * weekly.limit")) {
  throw new Error("aggregate projected percentage must sum per-account projected absolute capacity");
}
if (!projectionSection.includes("Math.max(0, Math.min(100, (sumProjectedAbsolute / totalCapacity) * 100))")) {
  throw new Error("aggregate projected percentage must be normalized by total capacity and clamped to 0..100");
}

const divergentResetFixture = [
  { limit: 100, currentPct: 10, dailyPct: 10, daysToReset: 1 },
  { limit: 300, currentPct: 20, dailyPct: 10, daysToReset: 3 },
];
const projectedFromOwnReset = divergentResetFixture.reduce(
  (sum, account) => sum + ((account.currentPct + account.dailyPct * account.daysToReset) / 100) * account.limit,
  0,
) / divergentResetFixture.reduce((sum, account) => sum + account.limit, 0) * 100;
const projectedFromEarliestReset = divergentResetFixture.reduce(
  (sum, account) => sum + ((account.currentPct + account.dailyPct * 1) / 100) * account.limit,
  0,
) / divergentResetFixture.reduce((sum, account) => sum + account.limit, 0) * 100;
if (Math.abs(projectedFromOwnReset - 42.5) > 0.000001 || Math.abs(projectedFromEarliestReset - 27.5) > 0.000001) {
  throw new Error("divergent reset fixture must distinguish own-reset aggregate projection from earliest-reset projection");
}

console.log("codex usage projection alias isolation ok");
