import { create } from "zustand";
import { DockviewApi } from "dockview";
import { open } from "@tauri-apps/plugin-dialog";
import type { PlateEditor } from "platejs/react";

import { getBaseDir, isInternalPath } from "@/lib/utils";

// panel width constraints
export const LEFT_PANEL_MIN_WIDTH = 150;
export const LEFT_PANEL_MAX_WIDTH = 800;
export const RIGHT_PANEL_MIN_WIDTH = 150;
export const RIGHT_PANEL_MAX_WIDTH = 800;

// --- editor registry (module-level to avoid re-renders) ---

interface EditorCallbacks {
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  focus: () => void;
  toggleMaximize: () => void;
  toggleFullWidth: () => void;
  persistMetadata: () => void;
}

const editorRegistry = new Map<string, EditorCallbacks>();

export function registerEditor(panelId: string, callbacks: EditorCallbacks) {
  editorRegistry.set(panelId, callbacks);
}

export function unregisterEditor(panelId: string) {
  editorRegistry.delete(panelId);
}

// --- save confirmation ---

export interface SaveConfirmation {
  panelId: string;
  title: string;
  resolve: (result: "save" | "discard" | "cancel") => void;
}

// --- quit confirmation ---

export interface QuitConfirmation {
  hasDirty: boolean;
  resolve: (result: "save" | "discard" | "cancel") => void;
}

// --- store ---

interface WorkspaceState {
  dockviewApi: DockviewApi | null;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  editorMaximized: boolean;
  activeFilePath: string | null;
  dirtyPanels: Set<string>;
  saveConfirmation: SaveConfirmation | null;
  quitConfirmation: QuitConfirmation | null;
  activeEditor: PlateEditor | null;
  chatEditor: PlateEditor | null;
  rightPanelTab: "chat" | "comments";
  activeCommentId: string | null;
  showNewDocComment: boolean;
}

interface WorkspaceActions {
  setDockviewApi: (api: DockviewApi) => void;
  addEditorTab: (targetGroupId?: string) => void;
  openFile: (filePath: string) => void;
  openFileToSide: (filePath: string) => void;
  closeFile: (filePath: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  openExternalFile: (absolutePath: string) => void;
  handleOpenFile: () => Promise<void>;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setLeftPanelWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  toggleEditorMaximized: () => void;
  setActiveFilePath: (path: string | null) => void;

  // comments / right panel
  setActiveEditor: (editor: PlateEditor | null) => void;
  setChatEditor: (editor: PlateEditor | null) => void;
  setRightPanelTab: (tab: "chat" | "comments") => void;
  setActiveCommentId: (id: string | null) => void;
  openCommentInPanel: (commentId: string) => void;
  openNewDocComment: () => void;
  setShowNewDocComment: (show: boolean) => void;

  // dirty tracking
  markDirty: (panelId: string) => void;
  markClean: (panelId: string) => void;
  isDirty: (panelId: string) => boolean;
  hasDirtyPanels: () => boolean;

  // save orchestration
  requestSave: () => Promise<void>;
  requestSaveAll: () => Promise<void>;
  savePanel: (panelId: string) => Promise<void>;

  // save confirmation
  requestSaveConfirmation: (
    panelId: string,
    title: string,
  ) => Promise<"save" | "discard" | "cancel">;
  resolveSaveConfirmation: (result: "save" | "discard" | "cancel") => void;

  // quit confirmation
  requestQuitConfirmation: () => Promise<"save" | "discard" | "cancel">;
  resolveQuitConfirmation: (result: "save" | "discard" | "cancel") => void;

  // tab management
  closeTab: (panelId: string) => Promise<void>;
  closeOtherTabs: (panelId: string) => Promise<void>;
  closeTabsToRight: (panelId: string) => Promise<void>;
  closeAllTabs: () => Promise<void>;
  closeSavedTabs: () => void;
}

type WorkspaceStore = WorkspaceState & WorkspaceActions;

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  dockviewApi: null,
  leftPanelVisible: true,
  rightPanelVisible: true,
  leftPanelWidth: 300,
  rightPanelWidth: 375,
  editorMaximized: false,
  activeFilePath: null,
  dirtyPanels: new Set<string>(),
  saveConfirmation: null,
  quitConfirmation: null,
  activeEditor: null,
  chatEditor: null,
  rightPanelTab: "chat",
  activeCommentId: null,
  showNewDocComment: false,

  setDockviewApi: (api) => set({ dockviewApi: api }),

  toggleLeftPanel: () =>
    set((state) => ({ leftPanelVisible: !state.leftPanelVisible })),

  toggleRightPanel: () =>
    set((state) => ({ rightPanelVisible: !state.rightPanelVisible })),

  setLeftPanelWidth: (width) =>
    set({
      leftPanelWidth: Math.min(
        LEFT_PANEL_MAX_WIDTH,
        Math.max(LEFT_PANEL_MIN_WIDTH, width),
      ),
    }),

  setRightPanelWidth: (width) =>
    set({
      rightPanelWidth: Math.min(
        RIGHT_PANEL_MAX_WIDTH,
        Math.max(RIGHT_PANEL_MIN_WIDTH, width),
      ),
    }),

  toggleEditorMaximized: () =>
    set((state) => ({ editorMaximized: !state.editorMaximized })),

  setActiveFilePath: (path) => set({ activeFilePath: path }),

  // --- comments / right panel ---

  setActiveEditor: (editor) => set({ activeEditor: editor }),

  setChatEditor: (editor) => set({ chatEditor: editor }),

  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  setActiveCommentId: (id) => set({ activeCommentId: id }),

  openCommentInPanel: (commentId) =>
    set({
      rightPanelVisible: true,
      rightPanelTab: "comments",
      activeCommentId: commentId,
    }),

  openNewDocComment: () =>
    set({
      rightPanelVisible: true,
      rightPanelTab: "comments",
      showNewDocComment: true,
    }),

  setShowNewDocComment: (show) => set({ showNewDocComment: show }),

  // --- dirty tracking ---

  markDirty: (panelId) =>
    set((state) => {
      if (state.dirtyPanels.has(panelId)) return state;
      const next = new Set(state.dirtyPanels);
      next.add(panelId);
      return { dirtyPanels: next };
    }),

  markClean: (panelId) =>
    set((state) => {
      if (!state.dirtyPanels.has(panelId)) return state;
      const next = new Set(state.dirtyPanels);
      next.delete(panelId);
      return { dirtyPanels: next };
    }),

  isDirty: (panelId) => get().dirtyPanels.has(panelId),

  hasDirtyPanels: () => get().dirtyPanels.size > 0,

  // --- save orchestration ---

  requestSave: async () => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;

    const activePanel = dockviewApi.activePanel;
    if (!activePanel) return;

    const callbacks = editorRegistry.get(activePanel.id);
    if (callbacks) {
      await callbacks.save();
    }
  },

  requestSaveAll: async () => {
    const { dirtyPanels } = get();
    const promises: Promise<void>[] = [];

    for (const panelId of dirtyPanels) {
      const callbacks = editorRegistry.get(panelId);
      if (callbacks) {
        promises.push(callbacks.save());
      }
    }

    await Promise.all(promises);
  },

  savePanel: async (panelId) => {
    const callbacks = editorRegistry.get(panelId);
    if (callbacks) {
      await callbacks.save();
    }
  },

  // --- save confirmation ---

  requestSaveConfirmation: (panelId, title) => {
    return new Promise<"save" | "discard" | "cancel">((resolve) => {
      set({ saveConfirmation: { panelId, title, resolve } });
    });
  },

  resolveSaveConfirmation: (result) => {
    const { saveConfirmation } = get();
    if (saveConfirmation) {
      saveConfirmation.resolve(result);
      set({ saveConfirmation: null });
    }
  },

  // --- quit confirmation ---

  requestQuitConfirmation: () => {
    const hasDirty = get().hasDirtyPanels();
    return new Promise<"save" | "discard" | "cancel">((resolve) => {
      set({ quitConfirmation: { hasDirty, resolve } });
    });
  },

  resolveQuitConfirmation: (result) => {
    const { quitConfirmation } = get();
    if (quitConfirmation) {
      quitConfirmation.resolve(result);
      set({ quitConfirmation: null });
    }
  },

  // --- tab management ---

  addEditorTab: (targetGroupId) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;

    const num = nextUntitledNumber(dockviewApi);
    const id = `editor-${Date.now()}-${num}`;
    const tabTitle = `untitled-${num}`;

    dockviewApi.addPanel({
      id,
      component: "editor",
      title: tabTitle,
      params: { title: tabTitle },
      ...(targetGroupId ? { position: { referenceGroup: targetGroupId } } : {}),
    });
  },

  openFile: (filePath) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;

    // if the file is already open, activate that tab
    for (const panel of dockviewApi.panels) {
      if ((panel.params as Record<string, unknown>)?.filePath === filePath) {
        panel.api.setActive();
        return;
      }
    }

    // derive display name: strip path and .md extension
    const fileName = filePath.split("/").pop() || filePath;
    const displayName = fileName.endsWith(".md")
      ? fileName.slice(0, -3)
      : fileName;
    const id = `file-${Date.now()}`;

    dockviewApi.addPanel({
      id,
      component: "editor",
      title: displayName,
      params: { title: displayName, filePath },
    });
  },

  closeFile: (filePath) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;

    const prefix = filePath + "/";
    const panelsToClose = dockviewApi.panels.filter((panel) => {
      const panelPath = (panel.params as Record<string, unknown>)?.filePath as
        | string
        | undefined;
      if (!panelPath) return false;
      return panelPath === filePath || panelPath.startsWith(prefix);
    });
    for (const panel of panelsToClose) {
      panel.api.close();
    }
  },

  renameFile: (oldPath, newPath) => {
    const { dockviewApi, activeFilePath } = get();
    if (!dockviewApi) return;

    const oldPrefix = oldPath + "/";

    for (const panel of dockviewApi.panels) {
      const panelPath = (panel.params as Record<string, unknown>)?.filePath as
        | string
        | undefined;
      if (!panelPath) continue;

      let updatedPath: string | null = null;
      if (panelPath === oldPath) {
        updatedPath = newPath;
      } else if (panelPath.startsWith(oldPrefix)) {
        updatedPath = newPath + panelPath.slice(oldPath.length);
      }

      if (updatedPath) {
        const fileName = updatedPath.split("/").pop() || updatedPath;
        const displayName = fileName.endsWith(".md")
          ? fileName.slice(0, -3)
          : fileName;
        panel.api.updateParameters({
          filePath: updatedPath,
          title: displayName,
        });
        panel.api.setTitle(displayName);
      }
    }

    // update activeFilePath if affected
    if (activeFilePath) {
      if (activeFilePath === oldPath) {
        set({ activeFilePath: newPath });
      } else if (activeFilePath.startsWith(oldPrefix)) {
        set({
          activeFilePath: newPath + activeFilePath.slice(oldPath.length),
        });
      }
    }
  },

  openFileToSide: (filePath) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;

    // if the file is already open, activate that tab
    for (const panel of dockviewApi.panels) {
      if ((panel.params as Record<string, unknown>)?.filePath === filePath) {
        panel.api.setActive();
        return;
      }
    }

    // derive display name: strip path and .md extension
    const fileName = filePath.split("/").pop() || filePath;
    const displayName = fileName.endsWith(".md")
      ? fileName.slice(0, -3)
      : fileName;
    const id = `file-${Date.now()}`;

    const activePanel = dockviewApi.activePanel;

    dockviewApi.addPanel({
      id,
      component: "editor",
      title: displayName,
      params: { title: displayName, filePath },
      position: activePanel
        ? { referencePanel: activePanel.id, direction: "right" }
        : undefined,
    });
  },

  openExternalFile: (absolutePath: string) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;

    // if the file is already open, activate that tab
    for (const panel of dockviewApi.panels) {
      const params = panel.params as Record<string, unknown>;
      if (params?.filePath === absolutePath && params?.isExternal === true) {
        panel.api.setActive();
        return;
      }
    }

    // derive display name from filename
    const fileName = absolutePath.split("/").pop() || absolutePath;
    const displayName = fileName.endsWith(".md")
      ? fileName.slice(0, -3)
      : fileName;
    const id = `ext-file-${Date.now()}`;

    dockviewApi.addPanel({
      id,
      component: "editor",
      title: displayName,
      params: {
        title: displayName,
        filePath: absolutePath,
        isExternal: true,
      },
    });
  },

  handleOpenFile: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });

    if (!selected) return;

    const filePath = typeof selected === "string" ? selected : selected;

    const internal = await isInternalPath(filePath);
    if (internal) {
      // convert absolute path to relative path for internal files
      const baseDir = await getBaseDir();
      let relativePath = filePath;
      if (filePath.startsWith(baseDir)) {
        relativePath = filePath.slice(baseDir.length);
        // remove leading slash
        if (relativePath.startsWith("/")) {
          relativePath = relativePath.slice(1);
        }
      }
      get().openFile(relativePath);
    } else {
      get().openExternalFile(filePath);
    }
  },

  closeTab: async (panelId) => {
    const { dockviewApi, isDirty, requestSaveConfirmation, savePanel } = get();
    if (!dockviewApi) return;

    const panel = dockviewApi.panels.find((p) => p.id === panelId);
    if (!panel) return;

    if (isDirty(panelId)) {
      const title = panel.title ?? "untitled";
      const result = await requestSaveConfirmation(panelId, title);

      if (result === "cancel") return;
      if (result === "save") {
        await savePanel(panelId);
      }
    }

    panel.api.close();
  },

  closeOtherTabs: async (panelId) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;

    const otherPanels = dockviewApi.panels.filter((p) => p.id !== panelId);

    for (const panel of otherPanels) {
      await get().closeTab(panel.id);
    }
  },

  closeTabsToRight: async (panelId) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;

    const panel = dockviewApi.panels.find((p) => p.id === panelId);
    if (!panel) return;

    const group = panel.group;
    const groupPanels = group.panels;
    const idx = groupPanels.findIndex((p) => p.id === panelId);
    if (idx === -1) return;

    const panelsToRight = groupPanels.slice(idx + 1);
    for (const p of panelsToRight) {
      await get().closeTab(p.id);
    }
  },

  closeAllTabs: async () => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;

    // copy list since closing modifies it
    const panels = [...dockviewApi.panels];

    for (const panel of panels) {
      await get().closeTab(panel.id);
    }
  },

  closeSavedTabs: () => {
    const { dockviewApi, dirtyPanels } = get();
    if (!dockviewApi) return;

    const panels = [...dockviewApi.panels];
    for (const panel of panels) {
      if (!dirtyPanels.has(panel.id)) {
        panel.api.close();
      }
    }
  },
}));

/** Focus the Plate editor in the active panel. */
export function focusActiveEditor() {
  // Wait for React renders and dockview layout to settle before focusing.
  // setTimeout defers past the current synchronous work + microtasks,
  // then requestAnimationFrame waits for the next paint (CSS/layout applied).
  setTimeout(() => {
    requestAnimationFrame(() => {
      const { dockviewApi } = useWorkspaceStore.getState();
      if (!dockviewApi?.activePanel) return;

      const callbacks = editorRegistry.get(dockviewApi.activePanel.id);
      callbacks?.focus();
    });
  }, 0);
}

/** Toggle maximize on the active panel's editor. */
export function toggleActiveEditorMaximize() {
  const { dockviewApi } = useWorkspaceStore.getState();
  if (!dockviewApi?.activePanel) return;

  const callbacks = editorRegistry.get(dockviewApi.activePanel.id);
  callbacks?.toggleMaximize();
}

/** Toggle full width on the active panel's editor. */
export function toggleActiveEditorFullWidth() {
  const { dockviewApi } = useWorkspaceStore.getState();
  if (!dockviewApi?.activePanel) return;

  const callbacks = editorRegistry.get(dockviewApi.activePanel.id);
  callbacks?.toggleFullWidth();
}

/** Trigger debounced metadata persist on the active panel's editor. */
export function persistActiveEditorMetadata() {
  const { dockviewApi } = useWorkspaceStore.getState();
  if (!dockviewApi?.activePanel) return;

  const callbacks = editorRegistry.get(dockviewApi.activePanel.id);
  callbacks?.persistMetadata();
}

function nextUntitledNumber(dockviewApi: DockviewApi): number {
  const usedNumbers = new Set<number>();
  for (const panel of dockviewApi.panels) {
    const title = panel.title ?? "";
    const match = title.match(/^untitled-(\d+)$/);
    if (match) {
      usedNumbers.add(Number(match[1]));
    }
  }
  let n = 1;
  while (usedNumbers.has(n)) n++;
  return n;
}
