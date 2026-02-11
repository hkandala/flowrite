import { create } from "zustand";
import { DockviewApi } from "dockview";

// panel width constraints
export const LEFT_PANEL_MIN_WIDTH = 150;
export const LEFT_PANEL_MAX_WIDTH = 800;
export const RIGHT_PANEL_MIN_WIDTH = 150;
export const RIGHT_PANEL_MAX_WIDTH = 800;

interface WorkspaceState {
  dockviewApi: DockviewApi | null;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  editorMaximized: boolean;
  activeFilePath: string | null;
  editorTabFocusRequest: number;
}

interface WorkspaceActions {
  setDockviewApi: (api: DockviewApi) => void;
  addEditorTab: (targetGroupId?: string) => void;
  openFile: (filePath: string) => void;
  openFileToSide: (filePath: string) => void;
  closeFile: (filePath: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setLeftPanelWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  toggleEditorMaximized: () => void;
  setActiveFilePath: (path: string | null) => void;
  requestEditorTabFocus: () => void;
}

type WorkspaceStore = WorkspaceState & WorkspaceActions;

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  dockviewApi: null,
  leftPanelVisible: true,
  rightPanelVisible: true,
  leftPanelWidth: 300,
  rightPanelWidth: 300,
  editorMaximized: false,
  activeFilePath: null,
  editorTabFocusRequest: 0,

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

  requestEditorTabFocus: () =>
    set((state) => ({
      editorTabFocusRequest: state.editorTabFocusRequest + 1,
    })),

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
}));

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
