import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Server-side last-session monitor only. This file does not collect provider
// quota data and does not render the TUI. Provider quota collection lives in
// providers-monitor.ts; TUI rendering lives in index.tsx.

const id = "opencode-last-session-monitor";
const STATE_FILE = join(homedir(), ".local", "state", "opencode-last-session", "sessions.json");

type SavedSession = {
  sessionId: string;
  title?: string;
  directory: string;
  updated?: number;
  updatedAt: number;
  source: "plugin";
};

type State = Record<string, SavedSession>;

type SessionLike = {
  id?: string;
  title?: string;
  directory?: string | null;
  updated?: number;
  parentID?: string | null;
};

function loadState(): State {
  try {
    if (!existsSync(STATE_FILE)) return {};
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return {};
  }
}

function saveState(state: State): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

function extractSessionID(event: any): string | undefined {
  const props = event?.properties ?? {};
  return props.sessionID || props.sessionId || props.id || props.info?.id || props.info?.sessionID;
}

function shouldTrackEvent(eventType: string): boolean {
  return (
    eventType === "session.updated" ||
    eventType === "session.idle" ||
    eventType === "message.updated" ||
    eventType === "message.part.updated"
  );
}

async function fetchSession(client: any, sessionID: string): Promise<SessionLike | undefined> {
  try {
    const response = await client.session.get({ path: { id: sessionID } });
    return response.data as SessionLike | undefined;
  } catch {
    return undefined;
  }
}

async function listSessionsForDirectory(client: any, directory: string): Promise<SessionLike[]> {
  try {
    const response = await client.session.list({ directory, limit: 200, order: "updated" });
    const data = response.data as any;
    if (Array.isArray(data)) return data as SessionLike[];
    if (Array.isArray(data?.items)) return data.items as SessionLike[];
    if (Array.isArray(data?.sessions)) return data.sessions as SessionLike[];
    return [];
  } catch {
    return [];
  }
}

function saveSession(session: SessionLike): void {
  if (!session.id || !session.directory) return;
  // Only primary sessions should own the cwd mapping. Subagents inherit context,
  // but reopening should return to the parent visible session.
  if (session.parentID) return;

  const state = loadState();
  state[session.directory] = {
    sessionId: session.id,
    title: session.title,
    directory: session.directory,
    updated: session.updated,
    updatedAt: Date.now(),
    source: "plugin",
  };
  saveState(state);
}

const server: Plugin = async ({ client, directory }) => {
  const monitoredDirectory = directory;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let interval: ReturnType<typeof setInterval> | undefined;

  const track = (sessionID: string) => {
    const previous = pending.get(sessionID);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      pending.delete(sessionID);
      void fetchSession(client, sessionID).then((session) => {
        if (session) saveSession(session);
      });
    }, 250);
    pending.set(sessionID, timer);
  };

  const syncDirectoryState = async () => {
    const sessions = await listSessionsForDirectory(client, monitoredDirectory);
    if (sessions.length === 0) return;

    const state = loadState();
    const saved = state[monitoredDirectory];
    const savedSession = saved?.sessionId ? sessions.find((session) => session.id === saved.sessionId) : undefined;
    const selected = savedSession || sessions[0];
    if (!selected?.id || !selected.directory) return;

    if (selected.parentID) return;

    state[monitoredDirectory] = {
      sessionId: selected.id,
      title: selected.title,
      directory: selected.directory,
      updated: selected.updated,
      updatedAt: Date.now(),
      source: "plugin",
    };
    saveState(state);
  };

  interval = setInterval(() => {
    void syncDirectoryState();
  }, 5000);

  return {
    async event({ event }) {
      if (!shouldTrackEvent(event.type)) return;
      const sessionID = extractSessionID(event);
      if (!sessionID) return;
      track(sessionID);
      void syncDirectoryState();
    },
    async "chat.message"(input) {
      if (input.sessionID) track(input.sessionID);
      void syncDirectoryState();
    },
    async dispose() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      if (interval) clearInterval(interval);
    },
  };
};

const pluginModule: PluginModule = { id, server };

export default pluginModule;
