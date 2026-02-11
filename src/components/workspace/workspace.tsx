import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ThemeProvider } from "@/components/ui/theme-provider";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { useWorkspaceStore } from "@/store/workspace-store";
import { isInternalPath, getBaseDir } from "@/lib/utils";

function Workspace() {
  const addEditorTab = useWorkspaceStore((s) => s.addEditorTab);
  const requestSave = useWorkspaceStore((s) => s.requestSave);
  const requestSaveAll = useWorkspaceStore((s) => s.requestSaveAll);
  const handleOpenFile = useWorkspaceStore((s) => s.handleOpenFile);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const openExternalFile = useWorkspaceStore((s) => s.openExternalFile);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const hasDirtyPanels = useWorkspaceStore((s) => s.hasDirtyPanels);
  const requestSaveConfirmation = useWorkspaceStore(
    (s) => s.requestSaveConfirmation,
  );

  // focus the webview on mount so keyboard shortcuts work immediately
  // in new windows without requiring a click first
  useEffect(() => {
    // the body needs tabIndex to be programmatically focusable
    document.body.tabIndex = -1;
    document.body.style.outline = "none";
    document.body.focus();
  }, []);

  // keyboard shortcuts — handled here (not as native menu accelerators)
  // so we can properly ignore key-repeat via e.repeat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.repeat) return;

      if (!e.shiftKey) {
        switch (e.key) {
          case "n":
            e.preventDefault();
            addEditorTab();
            // double setTimeout(0) lets React render the new pane, then focus
            setTimeout(() => {
              setTimeout(
                () => useWorkspaceStore.getState().requestEditorTabFocus(),
                0,
              );
            }, 0);
            return;
          case "s":
            e.preventDefault();
            requestSave();
            return;
          case "o":
            e.preventDefault();
            handleOpenFile();
            return;
          case "w":
            e.preventDefault();
            {
              const api = useWorkspaceStore.getState().dockviewApi;
              if (api?.activePanel) {
                closeTab(api.activePanel.id);
                // focus the next active editor after the tab closes
                setTimeout(() => {
                  setTimeout(
                    () => useWorkspaceStore.getState().requestEditorTabFocus(),
                    0,
                  );
                }, 0);
              }
            }
            return;
        }
      } else {
        switch (e.key) {
          case "s":
            e.preventDefault();
            requestSaveAll();
            return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addEditorTab, requestSave, requestSaveAll, handleOpenFile, closeTab]);

  // listen for menu click events from Tauri backend
  // (these fire when the user clicks a menu item with the mouse)
  useEffect(() => {
    const unlisten: Array<() => void> = [];

    const setup = async () => {
      unlisten.push(
        await listen("menu-save", () => {
          requestSave();
        }),
      );

      unlisten.push(
        await listen("menu-save-all", () => {
          requestSaveAll();
        }),
      );

      unlisten.push(
        await listen("menu-new-file", () => {
          addEditorTab();
          setTimeout(() => {
            setTimeout(
              () => useWorkspaceStore.getState().requestEditorTabFocus(),
              0,
            );
          }, 0);
        }),
      );

      unlisten.push(
        await listen("menu-open-file", () => {
          handleOpenFile();
        }),
      );

      unlisten.push(
        await listen("menu-close-editor", () => {
          const api = useWorkspaceStore.getState().dockviewApi;
          if (!api) return;
          const activePanel = api.activePanel;
          if (activePanel) {
            closeTab(activePanel.id);
            setTimeout(() => {
              setTimeout(
                () => useWorkspaceStore.getState().requestEditorTabFocus(),
                0,
              );
            }, 0);
          }
        }),
      );

      // handle file opened from OS (file association / drag-drop to dock)
      unlisten.push(
        await listen<string>("open-file-from-os", async (event) => {
          const absolutePath = event.payload;
          const internal = await isInternalPath(absolutePath);

          if (internal) {
            const baseDir = await getBaseDir();
            let relativePath = absolutePath;
            if (absolutePath.startsWith(baseDir)) {
              relativePath = absolutePath.slice(baseDir.length);
              if (relativePath.startsWith("/")) {
                relativePath = relativePath.slice(1);
              }
            }
            openFile(relativePath);
          } else {
            openExternalFile(absolutePath);
          }
        }),
      );
    };

    setup();

    return () => {
      unlisten.forEach((fn) => fn());
    };
  }, [
    addEditorTab,
    requestSave,
    requestSaveAll,
    handleOpenFile,
    openFile,
    openExternalFile,
    closeTab,
  ]);

  // handle window close with save confirmation
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const currentWindow = getCurrentWindow();

      unlisten = await currentWindow.onCloseRequested(async (event) => {
        if (hasDirtyPanels()) {
          event.preventDefault();

          const result = await requestSaveConfirmation(
            "__window__",
            "this window",
          );

          if (result === "cancel") return;

          if (result === "save") {
            await requestSaveAll();
          }

          // destroy the window (bypasses close event)
          await currentWindow.destroy();
        }
      });
    };

    setup();

    return () => {
      unlisten?.();
    };
  }, [hasDirtyPanels, requestSaveConfirmation, requestSaveAll]);

  return (
    <ThemeProvider>
      <main className="h-screen w-screen bg-background/75 text-foreground">
        <WorkspaceLayout />
      </main>
    </ThemeProvider>
  );
}

export default Workspace;
