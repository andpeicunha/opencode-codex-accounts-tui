#!/usr/bin/env node
/**
 * opencode-ls — reopen the saved OpenCode session for the current directory.
 *
 * Daily usage:
 *   opencode-ls
 *
 * Behavior:
 * - key = current working directory
 * - if a saved session exists, refresh its title from OpenCode and reopen it
 * - if exactly one session exists for this directory, save and reopen it
 * - if multiple sessions exist and none is saved, ask once, then save choice
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const PORT = process.env.OPENCODE_PORT || "4096";
const URL = `http://localhost:${PORT}`;
const PID_FILE = `/tmp/opencode-server-${PORT}.pid`;
const STATE_FILE = join(homedir(), ".local", "state", "opencode-last-session", "sessions.json");
const cwd = process.cwd();
const key = cwd;
const legacyKey = `${cwd}::default`;

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

function runJson(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return JSON.parse(result.stdout);
}

function listSessions() {
  return runJson("opencode", ["session", "list", "--format", "json", "-n", "300"]);
}

function sessionsForDirectory(sessions) {
  return sessions
    .filter((session) => session.directory === cwd)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

function sessionById(sessions, id) {
  return sessions.find((session) => session.id === id);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function serverRunning() {
  if (!existsSync(PID_FILE)) return false;
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  return Number.isFinite(pid) && pidAlive(pid);
}

function ensureServer() {
  if (serverRunning()) return;
  console.log(`Starting opencode server on port ${PORT}...`);
  const child = spawn("opencode", ["serve", "--port", PORT], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
}

function saveSelection(state, session) {
  state[key] = {
    sessionId: session.id,
    title: session.title,
    directory: cwd,
    updated: session.updated,
    updatedAt: Date.now(),
  };
  saveState(state);
}

function formatAge(ts) {
  if (!ts) return "?";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function chooseSession(candidates) {
  console.log(`Multiple OpenCode sessions found for ${basename(cwd)}:\n`);
  candidates.slice(0, 20).forEach((session, index) => {
    console.log(`${index + 1}. ${session.title}`);
    console.log(`   ${session.id} · updated ${formatAge(session.updated)}\n`);
  });

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = await rl.question("Choose session: ");
      const index = Number(answer.trim()) - 1;
      if (Number.isInteger(index) && candidates[index]) return candidates[index];
      console.log(`Enter a number between 1 and ${Math.min(candidates.length, 20)}.`);
    }
  } finally {
    rl.close();
  }
}

function setTerminalTitle(session) {
  const title = `OC · ${basename(cwd)} · ${session.title}`;
  process.stdout.write(`\x1b]0;${title}\x07`);
}

function attach(sessionId) {
  ensureServer();
  const attachArgs = ["attach", URL, "--dir", cwd];
  if (sessionId) attachArgs.push("--session", sessionId);
  let interval;

  if (sessionId) {
    interval = setInterval(() => {
      try {
        const sessions = listSessions();
        const latest = sessionById(sessions, sessionId);
        if (!latest?.title) return;
        const state = loadState();
        if (state[key]?.title !== latest.title) {
          state[key] = {
            ...(state[key] || {}),
            sessionId,
            title: latest.title,
            directory: cwd,
            updated: latest.updated,
            updatedAt: Date.now(),
          };
          saveState(state);
          setTerminalTitle(latest);
        }
      } catch {
        // ignore polling errors; keep session usable
      }
    }, 4000);
  }

  const child = spawn("opencode", attachArgs, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (interval) clearInterval(interval);
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

async function main() {
  const state = loadState();
  if (!state[key] && state[legacyKey]) {
    state[key] = state[legacyKey];
    delete state[legacyKey];
    saveState(state);
  }
  const sessions = listSessions();
  const candidates = sessionsForDirectory(sessions);
  const savedId = state[key]?.sessionId;
  const saved = savedId ? sessionById(sessions, savedId) : undefined;

  if (process.argv.includes("--status")) {
    console.log(JSON.stringify({ cwd, saved: savedId, savedTitle: saved?.title, candidates: candidates.length }, null, 2));
    return;
  }

  let selected = saved;
  if (!selected) {
    if (candidates.length === 0) {
      console.log(`No previous OpenCode session found for ${cwd}.`);
      console.log("Starting without a saved session.");
      attach(undefined);
      return;
    }
    selected = candidates.length === 1 ? candidates[0] : await chooseSession(candidates);
  }

  saveSelection(state, selected);
  setTerminalTitle(selected);
  console.log(`Reopening ${selected.title}`);
  attach(selected.id);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
