import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  PanelLeft,
  PanelLeftDashed,
  PanelRight,
  PanelRightDashed,
  Plus,
  Settings,
  TextCursor,
} from "lucide-react";
import {
  DockviewReact,
  DockviewReadyEvent,
  themeAbyssSpaced,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
} from "dockview";
import { invoke } from "@tauri-apps/api/core";

import "dockview/dist/styles/dockview.css";
import "./workspace-layout.css";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import {
  useWorkspaceStore,
  LEFT_PANEL_MIN_WIDTH,
  LEFT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
} from "@/store/workspace-store";
import { FileTreePane } from "./file-tree-pane";
import { AiChatPane } from "./ai-chat-pane";
import { EditorPane } from "./editor-pane";

const customTheme: DockviewTheme = {
  ...themeAbyssSpaced,
  className: `${themeAbyssSpaced.className} dockview-theme-custom`,
};

const components = {
  editor: EditorPane,
};

function AddTabButton(props: IDockviewHeaderActionsProps) {
  const addEditorTab = useWorkspaceStore((state) => state.addEditorTab);

  return (
    <button
      className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/8 transition-colors"
      onClick={() => addEditorTab(props.group.id)}
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  );
}

function EmptyState() {
  const addEditorTab = useWorkspaceStore((state) => state.addEditorTab);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 m-1 rounded-xl border border-foreground/6">
      <div className="flex flex-col gap-4">
        {/* logo + name */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-foreground/8">
            <TextCursor className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="mt-1 text-2xl font-medium text-foreground/80">
            flowrite
          </h1>
        </div>

        {/* new note */}
        <button
          onClick={() => addEditorTab()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-foreground/8 py-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          new note
        </button>
      </div>
    </div>
  );
}

// ---- resize handle ----

interface PanelResizeHandleProps {
  /** which edge the handle sits on */
  side: "left" | "right";
  currentWidth: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
}

function PanelResizeHandle({
  side,
  currentWidth,
  minWidth,
  maxWidth,
  onWidthChange,
}: PanelResizeHandleProps) {
  const widthRef = useRef(currentWidth);
  widthRef.current = currentWidth;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widthRef.current;

      const onMouseMove = (e: MouseEvent) => {
        // dragging toward content-side increases width
        const delta =
          side === "right" ? e.clientX - startX : startX - e.clientX;
        const next = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
        onWidthChange(next);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [side, minWidth, maxWidth, onWidthChange],
  );

  return (
    <div
      className={cn(
        "absolute top-0 bottom-0 z-10 w-1.5 cursor-col-resize",
        "hover:bg-foreground/10 transition-colors",
        side === "right" ? "-right-px" : "-left-px",
      )}
      onMouseDown={handleMouseDown}
    />
  );
}

// ---- layout ----

// macOS traffic lights need ~72px from the left edge
const TRAFFIC_LIGHTS_WIDTH = 72;

export function WorkspaceLayout() {
  const {
    dockviewApi,
    setDockviewApi,
    leftPanelVisible,
    rightPanelVisible,
    leftPanelWidth,
    rightPanelWidth,
    editorMaximized,
    toggleLeftPanel,
    toggleRightPanel,
    setLeftPanelWidth,
    setRightPanelWidth,
    toggleEditorMaximized,
    setActiveFilePath,
    requestEditorTabFocus,
  } = useWorkspaceStore();

  const dockviewRef = useRef<HTMLDivElement>(null);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      setDockviewApi(event.api);
    },
    [setDockviewApi],
  );

  const handleDockviewMouseDownCapture = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".dv-tabs-and-actions-container")) return;
      requestEditorTabFocus();
    },
    [requestEditorTabFocus],
  );

  useLayoutEffect(() => {
    if (!dockviewApi || !dockviewRef.current) return;
    const dvEl = dockviewRef.current.firstElementChild as HTMLElement | null;
    if (!dvEl) return;

    const style = getComputedStyle(dvEl);
    const width =
      dvEl.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    const height =
      dvEl.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom);
    dockviewApi.layout(width, height);

    if (!editorMaximized && dockviewApi.hasMaximizedGroup()) {
      dockviewApi.exitMaximizedGroup();
    }
  }, [dockviewApi, leftPanelVisible, rightPanelVisible, editorMaximized]);

  // sync activeFilePath with the dockview active panel
  useEffect(() => {
    if (!dockviewApi) return;

    const syncActiveFile = () => {
      const panel = dockviewApi.activePanel;
      const filePath = panel
        ? ((panel.params as Record<string, unknown>)?.filePath as
            | string
            | undefined)
        : undefined;
      setActiveFilePath(filePath ?? null);
    };

    // set initial value
    syncActiveFile();

    // listen for tab switches, closes, etc.
    const disposable = dockviewApi.onDidActivePanelChange(() => {
      syncActiveFile();
    });

    return () => disposable.dispose();
  }, [dockviewApi, setActiveFilePath]);

  // keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape → exit maximized mode
      if (e.code === "Escape" && editorMaximized) {
        e.preventDefault();
        invoke("set_traffic_lights_visible", { visible: true });
        toggleEditorMaximized();
        return;
      }

      if (!e.metaKey || !e.shiftKey) return;

      if (e.code === "KeyE") {
        // ⌘⇧E → toggle file tree
        e.preventDefault();
        toggleLeftPanel();
      } else if (e.code === "KeyL") {
        // ⌘⇧L → toggle ai chat
        e.preventDefault();
        toggleRightPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    toggleLeftPanel,
    toggleRightPanel,
    editorMaximized,
    toggleEditorMaximized,
    dockviewApi,
  ]);

  return (
    <div className="h-full w-full flex flex-col relative">
      {/* drag region strip when header is hidden in maximized mode –
          sits over the gap between window edge and editor content */}
      {editorMaximized && (
        <div
          data-tauri-drag-region
          className="absolute inset-x-0 top-0 h-3 z-10 select-none"
        />
      )}

      {/* header - window drag region with toggle buttons */}
      {!editorMaximized && (
        <header
          data-tauri-drag-region
          className="h-9.5 shrink-0 flex items-center select-none border-b border-border/50"
        >
          {/* traffic lights spacer */}
          <div className="shrink-0" style={{ width: TRAFFIC_LIGHTS_WIDTH }} />

          {/* drag region spacer */}
          <div className="flex-1" data-tauri-drag-region />

          {/* right-side toolbar icons */}
          <div className="flex items-center gap-0.5">
            {/* file tree toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-7 w-7 flex items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-foreground/8"
                  onClick={toggleLeftPanel}
                >
                  {leftPanelVisible ? (
                    <PanelLeft className="h-3.5 w-3.5" />
                  ) : (
                    <PanelLeftDashed className="h-3.5 w-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                toggle file tree <Kbd>⌘⇧E</Kbd>
              </TooltipContent>
            </Tooltip>

            {/* chat toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-7 w-7 flex items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-foreground/8"
                  onClick={toggleRightPanel}
                >
                  {rightPanelVisible ? (
                    <PanelRight className="h-3.5 w-3.5" />
                  ) : (
                    <PanelRightDashed className="h-3.5 w-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                toggle ai chat <Kbd>⌘⇧L</Kbd>
              </TooltipContent>
            </Tooltip>

            {/* settings */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="h-7 w-7 flex items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-foreground/8">
                  <Settings className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                settings
              </TooltipContent>
            </Tooltip>
          </div>

          {/* right edge padding */}
          <div className="w-3 shrink-0" />
        </header>
      )}

      {/* content - three column layout */}
      <div className="flex-1 min-h-0 flex">
        {/* left sidebar - file tree (always mounted to preserve state) */}
        <div
          className={cn(
            "h-full shrink-0 relative overflow-hidden",
            editorMaximized && "hidden",
          )}
          style={{ width: leftPanelVisible ? leftPanelWidth : 0 }}
          ref={(el) => {
            if (el) {
              if (!leftPanelVisible || editorMaximized) {
                el.setAttribute("inert", "");
              } else {
                el.removeAttribute("inert");
              }
            }
          }}
        >
          <FileTreePane />
          {leftPanelVisible && (
            <PanelResizeHandle
              side="right"
              currentWidth={leftPanelWidth}
              minWidth={LEFT_PANEL_MIN_WIDTH}
              maxWidth={LEFT_PANEL_MAX_WIDTH}
              onWidthChange={setLeftPanelWidth}
            />
          )}
        </div>

        {/* center - dockview editor */}
        <div
          className={cn(
            "flex-1 min-w-0 h-full overflow-hidden",
            editorMaximized && "dockview-maximized",
          )}
          onMouseDownCapture={handleDockviewMouseDownCapture}
          onKeyDownCapture={(e) => {
            if (
              (e.key === "Enter" || e.key === " ") &&
              (e.target as HTMLElement).closest(".dv-tab")
            ) {
              e.preventDefault();
              // dispatch pointerdown to activate the tab via dockview's internal handler
              const tab = (e.target as HTMLElement).closest<HTMLElement>(
                ".dv-tab",
              );
              tab?.dispatchEvent(
                new PointerEvent("pointerdown", {
                  bubbles: true,
                  cancelable: true,
                  button: 0,
                }),
              );
              requestEditorTabFocus();
            }
          }}
        >
          <DockviewReact
            ref={dockviewRef}
            onReady={onReady}
            components={components}
            theme={customTheme}
            rightHeaderActionsComponent={AddTabButton}
            watermarkComponent={EmptyState}
            disableFloatingGroups
            disableTabsOverflowList
            scrollbars="native"
          />
        </div>

        {/* right sidebar - chat (hidden via CSS when maximized to preserve state) */}
        <div
          className={cn(
            "h-full shrink-0 relative overflow-hidden",
            editorMaximized && "hidden",
          )}
          style={{ width: rightPanelVisible ? rightPanelWidth : 0 }}
          ref={(el) => {
            if (el) {
              if (!rightPanelVisible || editorMaximized) {
                el.setAttribute("inert", "");
              } else {
                el.removeAttribute("inert");
              }
            }
          }}
        >
          {rightPanelVisible && (
            <>
              <PanelResizeHandle
                side="left"
                currentWidth={rightPanelWidth}
                minWidth={RIGHT_PANEL_MIN_WIDTH}
                maxWidth={RIGHT_PANEL_MAX_WIDTH}
                onWidthChange={setRightPanelWidth}
              />
              <AiChatPane />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
