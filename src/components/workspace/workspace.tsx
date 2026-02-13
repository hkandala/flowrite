import { useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useHotkeys } from "react-hotkeys-hook";

import { ThemeProvider } from "@/components/ui/theme-provider";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import {
  useWorkspaceStore,
  focusActiveEditor,
  toggleActiveEditorMaximize,
  toggleActiveEditorFullWidth,
} from "@/store/workspace-store";
import { useAgentStore } from "@/store/agent-store";
import { openFileFromAbsolutePath, getBaseDir } from "@/lib/utils";
import { insertFileReference } from "@/components/chat/transforms/insert-file-reference";
import { MarkdownPlugin } from "@platejs/markdown";
import matter from "gray-matter";

const HOTKEY_OPTIONS = {
  enableOnContentEditable: true,
  enableOnFormTags: true as const,
  preventDefault: true,
};

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
  const requestQuitConfirmation = useWorkspaceStore(
    (s) => s.requestQuitConfirmation,
  );
  const initAgents = useAgentStore((s) => s.initAgents);

  // focus the webview on mount so keyboard shortcuts work immediately
  // in new windows without requiring a click first
  useEffect(() => {
    // the body needs tabIndex to be programmatically focusable
    document.body.tabIndex = -1;
    document.body.style.outline = "none";
    document.body.focus();
  }, []);

  useEffect(() => {
    void initAgents();
  }, [initAgents]);

  // --- keyboard shortcuts ---

  // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs within the active group
  useHotkeys(
    ["ctrl+tab", "ctrl+shift+tab"],
    (e) => {
      const api = useWorkspaceStore.getState().dockviewApi;
      if (!api?.activePanel) return;

      const group = api.activePanel.group;
      const panels = group.panels;
      const currentIdx = panels.findIndex((p) => p.id === api.activePanel!.id);
      if (currentIdx === -1) return;

      const nextIdx = e.shiftKey
        ? (currentIdx - 1 + panels.length) % panels.length
        : (currentIdx + 1) % panels.length;

      panels[nextIdx].api.setActive();
      focusActiveEditor();
    },
    HOTKEY_OPTIONS,
  );

  // Cmd+1-9 — focus the Nth editor group (sorted by visual position)
  useHotkeys(
    Array.from({ length: 9 }, (_, i) => `mod+${i + 1}`),
    (e) => {
      if (e.repeat) return;
      const groupIndex = Number(e.key) - 1;
      const api = useWorkspaceStore.getState().dockviewApi;
      if (!api) return;

      const groups = [...api.groups].sort((a, b) => {
        const rectA = a.element.getBoundingClientRect();
        const rectB = b.element.getBoundingClientRect();
        if (Math.abs(rectA.top - rectB.top) > 5) {
          return rectA.top - rectB.top;
        }
        return rectA.left - rectB.left;
      });

      if (groupIndex < groups.length) {
        const group = groups[groupIndex];
        const target = group.activePanel ?? group.panels[0];
        if (target) {
          target.api.setActive();
          focusActiveEditor();
        }
      }
    },
    HOTKEY_OPTIONS,
  );

  // Cmd+N — new tab
  useHotkeys(
    "mod+n",
    (e) => {
      if (e.repeat) return;
      addEditorTab();
      focusActiveEditor();
    },
    HOTKEY_OPTIONS,
    [addEditorTab],
  );

  // Cmd+S — save
  useHotkeys(
    "mod+s",
    (e) => {
      if (e.repeat) return;
      requestSave();
    },
    HOTKEY_OPTIONS,
    [requestSave],
  );

  // Cmd+O — open file
  useHotkeys(
    "mod+o",
    (e) => {
      if (e.repeat) return;
      handleOpenFile();
    },
    HOTKEY_OPTIONS,
    [handleOpenFile],
  );

  // Cmd+W — close active tab
  useHotkeys(
    "mod+w",
    (e) => {
      if (e.repeat) return;
      const api = useWorkspaceStore.getState().dockviewApi;
      if (api?.activePanel) {
        closeTab(api.activePanel.id);
        focusActiveEditor();
      }
    },
    HOTKEY_OPTIONS,
    [closeTab],
  );

  // Cmd+Shift+S — save all
  useHotkeys(
    "mod+shift+s",
    (e) => {
      if (e.repeat) return;
      requestSaveAll();
    },
    HOTKEY_OPTIONS,
    [requestSaveAll],
  );

  // Cmd+Shift++ — toggle maximize / zen mode
  useHotkeys(
    "mod+shift+equal",
    (e) => {
      if (e.repeat) return;
      toggleActiveEditorMaximize();
    },
    HOTKEY_OPTIONS,
  );

  // Cmd+Shift+- — toggle full width
  useHotkeys(
    "mod+shift+minus",
    (e) => {
      if (e.repeat) return;
      toggleActiveEditorFullWidth();
    },
    HOTKEY_OPTIONS,
  );

  // Cmd+L — add file reference to chat
  useHotkeys(
    "mod+l",
    async (e) => {
      if (e.repeat) return;
      const state = useWorkspaceStore.getState();
      const { activeFilePath, activeEditor } = state;

      if (!activeFilePath) return;

      // ensure right panel is visible and chat tab is active
      if (!state.rightPanelVisible) {
        state.toggleRightPanel();
      }
      state.setRightPanelTab("chat");

      // resolve absolute path
      const isExternal = activeFilePath.startsWith("/");
      let absolutePath: string;
      if (isExternal) {
        absolutePath = activeFilePath;
      } else {
        const baseDir = await getBaseDir();
        absolutePath = `${baseDir}/${activeFilePath}`;
      }

      // count frontmatter lines to offset line numbers
      let frontmatterLineCount = 0;
      try {
        const rawContent = await invoke<string>(
          isExternal ? "read_external_file" : "read_file",
          { path: isExternal ? absolutePath : activeFilePath },
        );
        const parsed = matter(rawContent);
        if (Object.keys(parsed.data).length > 0) {
          const bodyStart = rawContent.indexOf(parsed.content);
          if (bodyStart > 0) {
            frontmatterLineCount =
              rawContent.slice(0, bodyStart).split("\n").length - 1;
          }
        }
      } catch {
        // ignore — frontmatter offset stays 0
      }

      // determine line range from editor selection using markdown serialization
      let lineStart: number | undefined;
      let lineEnd: number | undefined;
      if (activeEditor?.selection) {
        const { anchor, focus } = activeEditor.selection;
        if (
          anchor.path[0] !== focus.path[0] ||
          anchor.offset !== focus.offset
        ) {
          const startBlock = Math.min(anchor.path[0], focus.path[0]);
          const endBlock = Math.max(anchor.path[0], focus.path[0]);

          try {
            const mdApi = activeEditor.getApi(MarkdownPlugin).markdown;

            if (startBlock > 0) {
              const beforeMd = mdApi.serialize({
                value: activeEditor.children.slice(0, startBlock),
              });
              lineStart =
                beforeMd.split("\n").length + 1 + frontmatterLineCount;
            } else {
              lineStart = 1 + frontmatterLineCount;
            }

            const throughEndMd = mdApi.serialize({
              value: activeEditor.children.slice(0, endBlock + 1),
            });
            lineEnd = throughEndMd.split("\n").length + frontmatterLineCount;
          } catch {
            lineStart = startBlock + 1 + frontmatterLineCount;
            lineEnd = endBlock + 1 + frontmatterLineCount;
          }
        }
      }

      // extract display name (strip path and .md extension)
      const fileName = activeFilePath.split("/").pop() || activeFilePath;
      const displayName = fileName.endsWith(".md")
        ? fileName.slice(0, -3)
        : fileName;

      // insert file reference — chatEditor is always mounted
      const { chatEditor: editor } = useWorkspaceStore.getState();
      if (editor) {
        insertFileReference(editor, {
          filePath: absolutePath,
          displayName,
          lineStart,
          lineEnd,
        });

        // focus chat editor after panel visibility settles
        setTimeout(() => {
          editor.tf.focus({ edge: "end" });
        }, 100);
      }
    },
    HOTKEY_OPTIONS,
  );

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
          focusActiveEditor();
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
            focusActiveEditor();
          }
        }),
      );

      // handle file opened from OS (file association / drag-drop to dock).
      // uses window-specific listener so only the targeted window opens the file.
      const currentWindow = getCurrentWindow();
      unlisten.push(
        await currentWindow.listen<string>(
          "open-file-from-os",
          async (event) => {
            await openFileFromAbsolutePath(
              event.payload,
              openFile,
              openExternalFile,
            );
            // backend always buffers AND emits — drain the buffer to prevent
            // stale entries from reopening on future window mounts
            try {
              await invoke<string[]>("take_pending_files");
            } catch {
              /* ignore */
            }
          },
        ),
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

  // handle app quit with save confirmation
  useEffect(() => {
    const unlisten = listen("request-quit", async () => {
      const result = await requestQuitConfirmation();

      if (result === "cancel") return;

      if (result === "save") {
        await requestSaveAll();
      }

      // tell Rust it's safe to quit
      await emit("confirm-quit");
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [requestQuitConfirmation, requestSaveAll]);

  return (
    <ThemeProvider>
      <main className="h-screen w-screen bg-background/75 text-foreground">
        <WorkspaceLayout />
      </main>
    </ThemeProvider>
  );
}

export default Workspace;
