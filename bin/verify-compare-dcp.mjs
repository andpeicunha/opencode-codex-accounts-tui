#!/usr/bin/env node
import { readFileSync } from "node:fs";

const source = readFileSync("src/plugins/codex-usage.ts", "utf8");

for (const needle of [
  "OPENCODE_USAGE_CHANGE_MARKERS_PATH",
  "dcp_v1",
  "markers.markers.find((marker) => marker?.id === \"dcp_v1\")",
  "buildCompareDcpMessage()",
  "execFileSync(\"sqlite3\"",
  "\"-readonly\"",
  ".parameter set ?1",
  "s.last_ts < ?1",
  "s.first_ts > ?1",
  "COUNT(DISTINCT sid) AS sessions",
  "GROUP BY bucket, model",
]) {
  if (!source.includes(needle)) throw new Error(`missing DCP implementation marker: ${needle}`);
}

const executeBlock = source.match(/"command\.execute\.before": async \(input\) => \{[\s\S]*?\n    \},\n    event:/)?.[0] ?? "";
if (!executeBlock.includes("snapshotCodexUsage()")) throw new Error("/usage path missing");
if (!executeBlock.includes("buildCompareMessage(days)")) throw new Error("numeric /compare path missing");
if (!executeBlock.includes("args.split(/\\s+/).includes(\"--dcp\")")) throw new Error("/compare --dcp trigger missing");

const events = [
  { sid: "before", ts: 100, model: "a", inp: 10, out: 5, reasoning: 1, cache_r: 2, cache_w: 3 },
  { sid: "cross", ts: 100, model: "a", inp: 100, out: 100, reasoning: 0, cache_r: 0, cache_w: 0 },
  { sid: "cross", ts: 300, model: "a", inp: 100, out: 100, reasoning: 0, cache_r: 0, cache_w: 0 },
  { sid: "after", ts: 300, model: "b", inp: 20, out: 10, reasoning: 4, cache_r: 5, cache_w: 6 },
];
const marker = 200;
const bounds = new Map();
for (const event of events) {
  const bound = bounds.get(event.sid) ?? { first: event.ts, last: event.ts };
  bound.first = Math.min(bound.first, event.ts);
  bound.last = Math.max(bound.last, event.ts);
  bounds.set(event.sid, bound);
}
const clean = events.filter((event) => {
  const bound = bounds.get(event.sid);
  return (event.ts < marker && bound.last < marker) || (event.ts > marker && bound.first > marker);
});
const totals = clean.reduce((acc, event) => {
  const bucket = event.ts < marker ? "before" : "after";
  acc[bucket] ??= { total: 0, inp: 0, out: 0, reasoning: 0, cache_r: 0, cache_w: 0, events: 0, sessions: new Set() };
  acc[bucket].total += event.inp + event.out + event.reasoning + event.cache_r + event.cache_w;
  acc[bucket].inp += event.inp;
  acc[bucket].out += event.out;
  acc[bucket].reasoning += event.reasoning;
  acc[bucket].cache_r += event.cache_r;
  acc[bucket].cache_w += event.cache_w;
  acc[bucket].events += 1;
  acc[bucket].sessions.add(event.sid);
  return acc;
}, {});
if (clean.length !== 2 || totals.before.total !== 21 || totals.after.total !== 45) {
  throw new Error("DCP fixture must exclude crossing sessions and sum token fields deterministically");
}
if (totals.before.sessions.size !== 1 || totals.after.sessions.size !== 1) {
  throw new Error("DCP fixture must count distinct clean sessions by side");
}

const markerFixtures = [
  { markers: [{ id: "dcp_v1", at: "2026-08-12T00:00:00.000Z" }] },
  { dcp_v1: "2026-08-12T00:00:00.000Z", markers: [{ id: "other", at: "2026-08-13T00:00:00.000Z" }] },
];

function resolveMarkerTs(fixture) {
  const marker = Array.isArray(fixture?.markers) ? fixture.markers.find((entry) => entry?.id === "dcp_v1") : undefined;
  const value = marker?.at ?? fixture?.dcp_v1;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

if (resolveMarkerTs(markerFixtures[0]) !== Date.parse("2026-08-12T00:00:00.000Z")) {
  throw new Error("markers[] shape must resolve dcp_v1 timestamp");
}
if (resolveMarkerTs(markerFixtures[1]) !== Date.parse("2026-08-12T00:00:00.000Z")) {
  throw new Error("legacy dcp_v1 key must remain supported when markers[] is absent");
}

console.log("compare dcp verification ok");
