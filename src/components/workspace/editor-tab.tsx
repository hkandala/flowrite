import React, { useCallback, useRef } from "react";

import { useWorkspaceStore } from "@/store/workspace-store";
import { showTabContextMenu } from "./tab-context-menu";

// Props match DockviewDefaultTab signature from dockview-react
interface EditorTabProps {
  api: {
    id: string;
    close: () => void;
  };
  containerApi: unknown;
  params: Record<string, unknown>;
  hideClose?: boolean;
  closeActionOverride?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerLeave?: (e: React.PointerEvent) => void;
  tabLocation?: string;
}

function useTitle(api: { id: string }) {
  const dockviewApi = useWorkspaceStore((s) => s.dockviewApi);
  const [title, setTitle] = React.useState<string>("");

  React.useEffect(() => {
    if (!dockviewApi) return;

    const panel = dockviewApi.panels.find((p) => p.id === api.id);
    if (panel) {
      setTitle(panel.title ?? "");
      const disposable = panel.api.onDidTitleChange(() => {
        setTitle(panel.title ?? "");
      });
      return () => disposable.dispose();
    }
  }, [dockviewApi, api.id]);

  return title;
}

export function EditorTab(props: EditorTabProps) {
  const {
    api,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    hideClose,
    closeActionOverride,
  } = props;

  const title = useTitle(api);
  const isDirty = useWorkspaceStore((s) => s.dirtyPanels.has(api.id));
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const closeOtherTabs = useWorkspaceStore((s) => s.closeOtherTabs);
  const closeAllTabs = useWorkspaceStore((s) => s.closeAllTabs);
  const closeSavedTabs = useWorkspaceStore((s) => s.closeSavedTabs);

  const isMiddleMouseButton = useRef(false);

  const handleClose = useCallback(
    async (event: React.MouseEvent | React.PointerEvent) => {
      event.preventDefault();

      if (closeActionOverride) {
        closeActionOverride();
        return;
      }

      await closeTab(api.id);
    },
    [api.id, closeActionOverride, closeTab],
  );

  const _onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      isMiddleMouseButton.current = event.button === 1;
      onPointerDown?.(event);
    },
    [onPointerDown],
  );

  const _onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (isMiddleMouseButton.current && event.button === 1 && !hideClose) {
        isMiddleMouseButton.current = false;
        handleClose(event);
      }
      onPointerUp?.(event);
    },
    [onPointerUp, handleClose, hideClose],
  );

  const _onPointerLeave = useCallback(
    (event: React.PointerEvent) => {
      isMiddleMouseButton.current = false;
      onPointerLeave?.(event);
    },
    [onPointerLeave],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      showTabContextMenu(api.id, {
        onClose: (panelId) => closeTab(panelId),
        onCloseOthers: (panelId) => closeOtherTabs(panelId),
        onCloseAll: () => closeAllTabs(),
        onCloseSaved: () => closeSavedTabs(),
      });
    },
    [api.id, closeTab, closeOtherTabs, closeAllTabs, closeSavedTabs],
  );

  const onBtnPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
  }, []);

  return (
    <div
      data-testid="dockview-dv-default-tab"
      onPointerDown={_onPointerDown}
      onPointerUp={_onPointerUp}
      onPointerLeave={_onPointerLeave}
      onContextMenu={handleContextMenu}
      className="dv-default-tab"
    >
      <span className="dv-default-tab-content">{title}</span>

      {/* dirty indicator dot */}
      {isDirty && <span className="dirty-indicator" />}

      {/* close button */}
      {!hideClose && (
        <div
          className="dv-default-tab-action"
          onPointerDown={onBtnPointerDown}
          onClick={handleClose}
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 9 9"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M1 1L8 8M8 1L1 8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
