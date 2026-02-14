import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Plate, createPlateEditor } from "platejs/react";
import { MarkdownPlugin } from "@platejs/markdown";
import { computeDiff } from "@platejs/diff";
import { Check, X, CheckCheck, Undo2, FileText } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { Value } from "platejs";

import { cn, getBaseDir, isInternalPath } from "@/lib/utils";
import { Editor as PlateEditor, EditorContainer } from "@/components/ui/editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BasicBlocksKit } from "@/components/editor/plugins/basic-blocks-kit";
import { BasicMarksKit } from "@/components/editor/plugins/basic-marks-kit";
import { LinkKit } from "@/components/editor/plugins/link-kit";
import { ListKit } from "@/components/editor/plugins/list-kit";
import { CodeBlockKit } from "@/components/editor/plugins/code-block-kit";
import { TableKit } from "@/components/editor/plugins/table-kit";
import { ToggleKit } from "@/components/editor/plugins/toggle-kit";
import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import { DiffPlugin } from "@/components/editor/plugins/diff-kit";
import { useDiffStore } from "@/store/diff-store";

type BlockDecision = "keep" | "undo" | "pending";

interface DiffOverlayProps {
  oldText: string | null;
  newText: string;
  filePath: string;
  sessionId: string;
  onDismiss: () => void;
}

const diffViewPlugins = [
  ...BasicBlocksKit,
  ...BasicMarksKit,
  ...LinkKit,
  ...ListKit,
  ...CodeBlockKit,
  ...TableKit,
  ...ToggleKit,
  ...MarkdownKit,
  DiffPlugin,
];

function deserializeMarkdown(text: string) {
  const tempEditor = createPlateEditor({
    plugins: diffViewPlugins,
  });
  return tempEditor.getApi(MarkdownPlugin).markdown.deserialize(text);
}

export function DiffOverlay({
  oldText,
  newText,
  filePath,
  sessionId,
  onDismiss,
}: DiffOverlayProps) {
  const { acceptDiff, rejectDiff } = useDiffStore();

  const { diffNodes, oldNodes, newNodes, changedIndices } = useMemo(() => {
    const oldN = oldText ? deserializeMarkdown(oldText) : [];
    const newN = deserializeMarkdown(newText);
    const diff = computeDiff(oldN, newN, {});

    // Determine which top-level blocks have changes
    const changed = new Set<number>();
    diff.forEach((node, i) => {
      if (nodeHasChanges(node)) changed.add(i);
    });

    return {
      diffNodes: diff,
      oldNodes: oldN,
      newNodes: newN,
      changedIndices: changed,
    };
  }, [oldText, newText]);

  const [decisions, setDecisions] = useState<Record<number, BlockDecision>>(
    () => {
      const init: Record<number, BlockDecision> = {};
      for (let i = 0; i < diffNodes.length; i++) {
        init[i] = changedIndices.has(i) ? "pending" : "keep";
      }
      return init;
    },
  );

  const diffEditor = useMemo(() => {
    return createPlateEditor({
      plugins: diffViewPlugins,
      value: diffNodes as Value,
    });
  }, [diffNodes]);

  const allDecided = Object.values(decisions).every((d) => d !== "pending");

  const setBlockDecision = useCallback(
    (index: number, decision: BlockDecision) => {
      setDecisions((prev) => ({ ...prev, [index]: decision }));
    },
    [],
  );

  const handleKeepAll = useCallback(() => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const i of changedIndices) {
        next[i] = "keep";
      }
      return next;
    });
  }, [changedIndices]);

  const handleUndoAll = useCallback(() => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const i of changedIndices) {
        next[i] = "undo";
      }
      return next;
    });
  }, [changedIndices]);

  const handleApply = useCallback(async () => {
    const allKeep = Object.values(decisions).every((d) => d === "keep");
    const allUndo = [...changedIndices].every((i) => decisions[i] === "undo");

    let finalContent: string;
    if (allKeep) {
      finalContent = newText;
    } else if (allUndo && oldText !== null) {
      finalContent = oldText;
    } else {
      // Mixed: reconstruct by choosing blocks from old or new
      const finalBlocks = diffNodes.map((node, i) => {
        if (!changedIndices.has(i)) return newNodes[i] ?? node;
        const decision = decisions[i] ?? "keep";
        if (decision === "undo") {
          return oldNodes[i] ?? node;
        }
        return newNodes[i] ?? node;
      });

      const tempEditor = createPlateEditor({
        plugins: diffViewPlugins,
        value: finalBlocks as Value,
      });
      finalContent =
        tempEditor.getApi(MarkdownPlugin).markdown.serialize() ?? "";
    }

    try {
      const internal = await isInternalPath(filePath);
      if (internal) {
        const baseDir = await getBaseDir();
        const relativePath = filePath.startsWith(baseDir)
          ? filePath.slice(baseDir.length + 1)
          : filePath;
        await invoke("update_file", {
          path: relativePath,
          content: finalContent,
        });
      } else {
        await invoke("update_external_file", {
          path: filePath,
          content: finalContent,
        });
      }

      if (allUndo) {
        rejectDiff(sessionId, filePath);
      } else {
        acceptDiff(sessionId, filePath);
      }
    } catch (err) {
      console.error("Failed to apply diff:", err);
    }

    onDismiss();
  }, [
    decisions,
    changedIndices,
    diffNodes,
    oldNodes,
    newNodes,
    oldText,
    newText,
    filePath,
    sessionId,
    onDismiss,
    acceptDiff,
    rejectDiff,
  ]);

  // Track block element positions for overlay controls
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [blockPositions, setBlockPositions] = useState<
    { top: number; index: number }[]
  >([]);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const updatePositions = () => {
      const editorEl = container.querySelector("[data-slate-editor]");
      if (!editorEl) return;

      const positions: { top: number; index: number }[] = [];
      const topLevelBlocks = editorEl.querySelectorAll(
        ":scope > [data-slate-node='element']",
      );
      const containerRect = container.getBoundingClientRect();

      topLevelBlocks.forEach((block, index) => {
        if (changedIndices.has(index)) {
          const blockRect = block.getBoundingClientRect();
          positions.push({
            top: blockRect.top - containerRect.top,
            index,
          });
        }
      });

      setBlockPositions(positions);
    };

    // Wait for the editor to render
    requestAnimationFrame(() => {
      requestAnimationFrame(updatePositions);
    });
  }, [diffEditor, changedIndices]);

  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Top toolbar */}
      <div className="flex items-center justify-between border-b px-4 py-2 bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate font-medium" title={filePath}>
            {fileName}
          </span>
          <span className="text-xs text-muted-foreground/60">
            agent changes
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleKeepAll}
            className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Keep All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUndoAll}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Undo All
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button
            variant="default"
            size="sm"
            onClick={handleApply}
            disabled={!allDecided}
          >
            Apply
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              acceptDiff(sessionId, filePath);
              onDismiss();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Diff editor view */}
      <div className="relative flex-1 overflow-hidden" ref={editorContainerRef}>
        <Plate editor={diffEditor} readOnly>
          <ScrollArea className="h-full w-full" maskHeight={0}>
            <EditorContainer className="w-full h-auto min-h-full overflow-y-visible">
              <PlateEditor
                variant="fullWidth"
                autoFocus={false}
                tabIndex={-1}
                className="h-auto min-h-full pt-6 px-10"
              />
            </EditorContainer>
          </ScrollArea>
        </Plate>

        {/* Per-block decision controls overlay */}
        {blockPositions.map(({ top, index }) => {
          const decision = decisions[index] ?? "pending";
          return (
            <div
              key={index}
              className="absolute left-1.5 z-10 flex flex-col gap-0.5"
              style={{ top }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() =>
                      setBlockDecision(
                        index,
                        decision === "keep" ? "pending" : "keep",
                      )
                    }
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded transition-colors",
                      decision === "keep"
                        ? "bg-emerald-500 text-white"
                        : "text-muted-foreground/40 hover:text-emerald-600 hover:bg-emerald-50",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={4}>
                  {decision === "keep" ? "reset" : "keep this change"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() =>
                      setBlockDecision(
                        index,
                        decision === "undo" ? "pending" : "undo",
                      )
                    }
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded transition-colors",
                      decision === "undo"
                        ? "bg-red-500 text-white"
                        : "text-muted-foreground/40 hover:text-red-600 hover:bg-red-50",
                    )}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={4}>
                  {decision === "undo" ? "reset" : "undo this change"}
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Check if a node (or its descendants) has diff marks */
function nodeHasChanges(node: any): boolean {
  if (node.diff) return true;
  if (node.diffOperation) return true;
  if (node.children) {
    return node.children.some((child: any) => nodeHasChanges(child));
  }
  return false;
}
