import { create } from "zustand";

export interface FileDiffEntry {
  sessionId: string;
  path: string; // absolute path from ACP
  oldText: string | null; // null = new file
  newText: string;
  timestamp: number;
  status: "pending" | "accepted" | "rejected";
}

// State: Record<sessionId, Record<path, FileDiffEntry>>
type DiffMap = Record<string, Record<string, FileDiffEntry>>;

interface DiffState {
  diffs: DiffMap;
}

interface DiffActions {
  addDiff: (entry: Omit<FileDiffEntry, "timestamp" | "status">) => void;
  getActiveDiffForFile: (absolutePath: string) => FileDiffEntry | null;
  acceptDiff: (sessionId: string, path: string) => void;
  rejectDiff: (sessionId: string, path: string) => void;
  acceptAllForSession: (sessionId: string) => void;
  rejectAllForSession: (sessionId: string) => void;
  clearSessionDiffs: (sessionId: string) => void;
}

export const useDiffStore = create<DiffState & DiffActions>((set, get) => ({
  diffs: {},

  addDiff: (entry) => {
    set((state) => {
      const sessionDiffs = { ...state.diffs[entry.sessionId] };
      sessionDiffs[entry.path] = {
        ...entry,
        timestamp: Date.now(),
        status: "pending",
      };
      return {
        diffs: {
          ...state.diffs,
          [entry.sessionId]: sessionDiffs,
        },
      };
    });
  },

  getActiveDiffForFile: (absolutePath) => {
    const { diffs } = get();
    let latest: FileDiffEntry | null = null;
    for (const sessionDiffs of Object.values(diffs)) {
      const entry = sessionDiffs[absolutePath];
      if (entry && entry.status === "pending") {
        if (!latest || entry.timestamp > latest.timestamp) {
          latest = entry;
        }
      }
    }
    return latest;
  },

  acceptDiff: (sessionId, path) => {
    set((state) => {
      const sessionDiffs = state.diffs[sessionId];
      if (!sessionDiffs?.[path]) return {};
      return {
        diffs: {
          ...state.diffs,
          [sessionId]: {
            ...sessionDiffs,
            [path]: { ...sessionDiffs[path], status: "accepted" as const },
          },
        },
      };
    });
  },

  rejectDiff: (sessionId, path) => {
    set((state) => {
      const sessionDiffs = state.diffs[sessionId];
      if (!sessionDiffs?.[path]) return {};
      return {
        diffs: {
          ...state.diffs,
          [sessionId]: {
            ...sessionDiffs,
            [path]: { ...sessionDiffs[path], status: "rejected" as const },
          },
        },
      };
    });
  },

  acceptAllForSession: (sessionId) => {
    set((state) => {
      const sessionDiffs = state.diffs[sessionId];
      if (!sessionDiffs) return {};
      const updated: Record<string, FileDiffEntry> = {};
      for (const [path, entry] of Object.entries(sessionDiffs)) {
        updated[path] =
          entry.status === "pending"
            ? { ...entry, status: "accepted" as const }
            : entry;
      }
      return {
        diffs: { ...state.diffs, [sessionId]: updated },
      };
    });
  },

  rejectAllForSession: (sessionId) => {
    set((state) => {
      const sessionDiffs = state.diffs[sessionId];
      if (!sessionDiffs) return {};
      const updated: Record<string, FileDiffEntry> = {};
      for (const [path, entry] of Object.entries(sessionDiffs)) {
        updated[path] =
          entry.status === "pending"
            ? { ...entry, status: "rejected" as const }
            : entry;
      }
      return {
        diffs: { ...state.diffs, [sessionId]: updated },
      };
    });
  },

  clearSessionDiffs: (sessionId) => {
    set((state) => {
      const { [sessionId]: _, ...rest } = state.diffs;
      return { diffs: rest };
    });
  },
}));
