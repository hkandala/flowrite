import { useCallback, useEffect, useRef, useState } from "react";
import { IDockviewPanelProps } from "dockview";
import { Plate, createPlateEditor } from "platejs/react";
import {
  UnfoldHorizontal,
  FoldHorizontal,
  Maximize2,
  Minimize2,
  Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import matter from "gray-matter";
import { MarkdownPlugin } from "@platejs/markdown";

import { cn, getBaseDir, isInternalPath } from "@/lib/utils";
import { Editor as PlateEditor, EditorContainer } from "@/components/ui/editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useWorkspaceStore,
  registerEditor,
  unregisterEditor,
} from "@/store/workspace-store";
import { BasicBlocksKit } from "@/components/editor/plugins/basic-blocks-kit";
import { BasicMarksKit } from "@/components/editor/plugins/basic-marks-kit";
import { LinkKit } from "@/components/editor/plugins/link-kit";
import { ListKit } from "@/components/editor/plugins/list-kit";
import { CodeBlockKit } from "@/components/editor/plugins/code-block-kit";
import { TableKit } from "../editor/plugins/table-kit";
import { EmojiKit } from "../editor/plugins/emoji-kit";
import { DateKit } from "../editor/plugins/date-kit";
import { ToggleKit } from "../editor/plugins/toggle-kit";
import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import { AutoformatKit } from "@/components/editor/plugins/autoformat-kit";
import { ExitBreakKit } from "@/components/editor/plugins/exit-break-kit";
import { SlashKit } from "../editor/plugins/slash-kit";
import { FloatingToolbarKit } from "../editor/plugins/floating-toolbar-kit";

const BUTTON_TIMEOUT = 1500;
const SCROLL_DEBOUNCE = 300;

/** Get the last element of an array (ES2020-safe alternative to .at(-1)) */
function lastElement<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

const editorPlugins = [
  ...BasicBlocksKit,
  ...BasicMarksKit,
  ...LinkKit,
  ...ListKit,
  ...CodeBlockKit,
  ...TableKit,
  ...EmojiKit,
  ...DateKit,
  ...ToggleKit,
  ...MarkdownKit,
  ...AutoformatKit,
  ...ExitBreakKit,
  ...SlashKit,
  ...FloatingToolbarKit,
];

interface EditorPaneParams {
  title: string;
  filePath?: string;
  isExternal?: boolean;
}

export function EditorPane(props: IDockviewPanelProps<EditorPaneParams>) {
  const filePath = props.params.filePath;
  const isExternal = props.params.isExternal ?? false;

  const [editor, setEditor] = useState<ReturnType<
    typeof createPlateEditor
  > | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const metadataRef = useRef<Record<string, unknown>>({});
  const hasOriginalFrontmatterRef = useRef(false);

  const [isFullWidth, setIsFullWidth] = useState(false);
  const [showButtons, setShowButtons] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const btnTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollingRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // dirty tracking refs
  const savedUndoRef = useRef<unknown>(null);
  const initialLoadCompleteRef = useRef(false);

  const editorMaximized = useWorkspaceStore((s) => s.editorMaximized);
  const toggleEditorMaximized = useWorkspaceStore(
    (s) => s.toggleEditorMaximized,
  );
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const markClean = useWorkspaceStore((s) => s.markClean);
  const editorTabFocusRequest = useWorkspaceStore(
    (s) => s.editorTabFocusRequest,
  );
  // initialize to current value so the effect only fires for future requests
  const lastHandledEditorFocusRequestRef = useRef(editorTabFocusRequest);

  // --- save callbacks ---

  const performSave = useCallback(async () => {
    if (!editor) return;

    const currentFilePath = props.params.filePath;
    const currentIsExternal = props.params.isExternal ?? false;

    if (!currentFilePath) {
      // untitled - delegate to saveAs
      await performSaveAs();
      return;
    }

    const markdown = editor.getApi(MarkdownPlugin).markdown.serialize();

    if (currentIsExternal) {
      // external file: preserve original frontmatter behavior
      const rawContent = hasOriginalFrontmatterRef.current
        ? matter.stringify(markdown, metadataRef.current)
        : markdown;

      await invoke("update_external_file", {
        path: currentFilePath,
        content: rawContent,
      });
    } else {
      // internal file: always use frontmatter
      const rawContent = matter.stringify(markdown, metadataRef.current);
      await invoke("update_file", {
        path: currentFilePath,
        content: rawContent,
      });
    }

    // update dirty tracking
    savedUndoRef.current = lastElement(editor.history.undos) ?? null;
    markClean(props.api.id);
  }, [
    editor,
    props.params.filePath,
    props.params.isExternal,
    props.api.id,
    markClean,
  ]);

  const performSaveAs = useCallback(async () => {
    if (!editor) return;

    // default to the tab title with .md extension, in the flowrite directory
    const tabTitle = props.params.title || "untitled";
    const defaultName = tabTitle.endsWith(".md") ? tabTitle : `${tabTitle}.md`;
    const baseDir = await getBaseDir();
    const defaultPath = `${baseDir}/${defaultName}`;

    const selectedPath = await saveDialog({
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });

    if (!selectedPath) return;

    const markdown = editor.getApi(MarkdownPlugin).markdown.serialize();
    const isExtPath = !(await isInternalPath(selectedPath));

    if (isExtPath) {
      const rawContent = hasOriginalFrontmatterRef.current
        ? matter.stringify(markdown, metadataRef.current)
        : markdown;

      await invoke("update_external_file", {
        path: selectedPath,
        content: rawContent,
      });

      // update panel params and title
      const fileName = selectedPath.split("/").pop() || selectedPath;
      const displayName = fileName.endsWith(".md")
        ? fileName.slice(0, -3)
        : fileName;

      props.api.updateParameters({
        filePath: selectedPath,
        isExternal: true,
      });
      props.api.setTitle(displayName);
    } else {
      // convert to relative path for internal file
      const baseDir = await getBaseDir();
      let relativePath = selectedPath;
      if (selectedPath.startsWith(baseDir)) {
        relativePath = selectedPath.slice(baseDir.length);
        if (relativePath.startsWith("/")) {
          relativePath = relativePath.slice(1);
        }
      }

      const rawContent = matter.stringify(markdown, metadataRef.current);
      await invoke("update_file", {
        path: relativePath,
        content: rawContent,
      });

      const fileName = relativePath.split("/").pop() || relativePath;
      const displayName = fileName.endsWith(".md")
        ? fileName.slice(0, -3)
        : fileName;

      props.api.updateParameters({
        filePath: relativePath,
        isExternal: false,
      });
      props.api.setTitle(displayName);
    }

    // update dirty tracking
    savedUndoRef.current = lastElement(editor.history.undos) ?? null;
    markClean(props.api.id);
  }, [editor, props.api, props.params.title, markClean]);

  // --- register save callbacks ---

  useEffect(() => {
    registerEditor(props.api.id, {
      save: performSave,
      saveAs: performSaveAs,
    });
    return () => unregisterEditor(props.api.id);
  }, [props.api.id, performSave, performSaveAs]);

  // load file content and create editor
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (filePath) {
        setIsLoading(true);
        initialLoadCompleteRef.current = false;
        try {
          let rawContent: string;

          if (isExternal) {
            rawContent = await invoke<string>("read_external_file", {
              path: filePath,
            });
          } else {
            rawContent = await invoke<string>("read_file", {
              path: filePath,
            });
          }

          if (cancelled) return;

          const parsed = matter(rawContent);
          metadataRef.current = parsed.data;
          hasOriginalFrontmatterRef.current =
            Object.keys(parsed.data).length > 0;

          const ed = createPlateEditor({
            plugins: editorPlugins,
            value: (editor) =>
              editor
                .getApi(MarkdownPlugin)
                .markdown.deserialize(parsed.content),
          });

          setEditor(ed);

          // mark initial load complete after editor settles
          requestAnimationFrame(() => {
            if (!cancelled) {
              savedUndoRef.current = lastElement(ed.history.undos) ?? null;
              initialLoadCompleteRef.current = true;
            }
          });
        } catch (err) {
          if (cancelled) return;
          console.error("failed to load file:", err);
          const ed = createPlateEditor({ plugins: editorPlugins });
          setEditor(ed);
          requestAnimationFrame(() => {
            if (!cancelled) {
              initialLoadCompleteRef.current = true;
            }
          });
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      } else {
        // untitled tab — create empty editor
        const ed = createPlateEditor({ plugins: editorPlugins });
        setEditor(ed);
        setIsLoading(false);
        requestAnimationFrame(() => {
          if (!cancelled) {
            savedUndoRef.current = lastElement(ed.history.undos) ?? null;
            initialLoadCompleteRef.current = true;
          }
        });
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [filePath, isExternal]);

  // --- onChange handler for dirty tracking ---
  const handleEditorChange = useCallback(() => {
    if (!initialLoadCompleteRef.current || !editor) return;

    const currentTop = lastElement(editor.history.undos) ?? null;
    if (currentTop !== savedUndoRef.current) {
      markDirty(props.api.id);
    } else {
      markClean(props.api.id);
    }
  }, [editor, props.api.id, markDirty, markClean]);

  // mouse movement: show buttons (unless mid-scroll)
  const handleMouseMove = useCallback(() => {
    if (scrollingRef.current) return;
    setShowButtons(true);
    if (btnTimerRef.current) clearTimeout(btnTimerRef.current);
    btnTimerRef.current = setTimeout(
      () => setShowButtons(false),
      BUTTON_TIMEOUT,
    );
  }, []);

  // mouse leaves: hide buttons
  const handleMouseLeave = useCallback(() => {
    setShowButtons(false);
    if (btnTimerRef.current) clearTimeout(btnTimerRef.current);
  }, []);

  // capture-phase scroll listener: hide buttons during scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      setShowButtons((prev) => (prev ? false : prev));
      if (btnTimerRef.current) clearTimeout(btnTimerRef.current);

      scrollingRef.current = true;
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollingRef.current = false;
      }, SCROLL_DEBOUNCE);
    };

    el.addEventListener("scroll", onScroll, true);

    return () => {
      el.removeEventListener("scroll", onScroll, true);
      if (btnTimerRef.current) clearTimeout(btnTimerRef.current);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const handleToggleMaximize = () => {
    if (editorMaximized) {
      invoke("set_traffic_lights_visible", { visible: true });
    } else {
      props.api.maximize();
      invoke("set_traffic_lights_visible", { visible: false });
    }
    toggleEditorMaximized();
  };

  // prevent interactive elements inside the editor (checkboxes, etc.) from
  // being reachable via Tab — they should only be clickable with mouse
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editor) return;

    let rafId = 0;

    const disableTabOnFocusables = () => {
      container
        .querySelectorAll<HTMLElement>(
          'input:not([tabindex="-1"]), [role="checkbox"]:not([tabindex="-1"])',
        )
        .forEach((el) => (el.tabIndex = -1));
    };

    disableTabOnFocusables();
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(disableTabOnFocusables);
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [editor]);

  // focus editor when tab-bar interaction requests it
  useEffect(() => {
    if (!editor) return;
    if (editorTabFocusRequest === lastHandledEditorFocusRequestRef.current) {
      return;
    }
    lastHandledEditorFocusRequestRef.current = editorTabFocusRequest;

    requestAnimationFrame(() => {
      if (props.api.isActive) {
        editor.tf.focus();
      }
    });
  }, [editor, editorTabFocusRequest, props.api]);

  // loading state
  if (isLoading || !editor) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <Plate editor={editor} onChange={handleEditorChange}>
        <ScrollArea
          className="h-full w-full editor-pane-scroll-area"
          maskHeight={0}
        >
          <EditorContainer className="w-full h-auto min-h-full overflow-y-visible">
            <PlateEditor
              variant="fullWidth"
              autoFocus={false}
              tabIndex={-1}
              className={cn(
                "h-auto min-h-full pt-15 px-10",
                isFullWidth && "sm:px-10 sm:pt-6",
              )}
              placeholder="start typing..."
            />
          </EditorContainer>
        </ScrollArea>
      </Plate>

      {/* toolbar icons */}
      <div
        className={cn(
          "absolute top-2 right-2 z-10 flex items-center gap-0.5",
          "transition-opacity duration-300",
          showButtons ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        {/* width toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              tabIndex={-1}
              onClick={() => {
                setIsFullWidth((prev) => !prev);
                requestAnimationFrame(() => editor.tf.focus());
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/30 transition-colors hover:bg-foreground/8 hover:text-foreground/70"
            >
              {isFullWidth ? (
                <FoldHorizontal className="h-4 w-4" />
              ) : (
                <UnfoldHorizontal className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {isFullWidth ? "center content" : "full width"}
          </TooltipContent>
        </Tooltip>

        {/* maximize / minimize toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              tabIndex={-1}
              onClick={() => {
                handleToggleMaximize();
                requestAnimationFrame(() => editor.tf.focus());
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/30 transition-colors hover:bg-foreground/8 hover:text-foreground/70"
            >
              {editorMaximized ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {editorMaximized ? "minimize" : "maximize"}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
