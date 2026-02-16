import { memo, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Maximize2 } from "lucide-react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { openFileFromAbsolutePath } from "@/lib/utils";
import { cleanLocation, deriveLabel } from "@/lib/tool-call-label";
import { useWorkspaceStore } from "@/store/workspace-store";
import type { ToolCall } from "@/store/agent-store";
import { DiffModal } from "./diff-modal";

interface ToolCallBlockProps {
  toolCall: ToolCall;
}

const formatToolDuration = (startedAt: number): string => {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  return `${seconds}s`;
};

export const ToolCallBlock = memo(function ToolCallBlock({
  toolCall,
}: ToolCallBlockProps) {
  const hasDiff =
    toolCall.diffData?.newText != null &&
    (toolCall.kind === "edit" || toolCall.kind === "read");

  const [expanded, setExpanded] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Auto-expand when diff data arrives
  useEffect(() => {
    if (hasDiff) setExpanded(true);
  }, [hasDiff]);
  const isActive =
    toolCall.status === "pending" || toolCall.status === "in_progress";
  const { verb, subject } = deriveLabel(toolCall);

  const hasDetails =
    (toolCall.locations && toolCall.locations.length > 0) ||
    toolCall.content ||
    hasDiff;

  // Only allow clicking .md files to open in editor
  const location = toolCall.locations?.[0];
  const loc = location ? cleanLocation(location) : null;
  const isClickableFile = loc !== null && loc.fullPath.endsWith(".md");

  const handleFileClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!loc) return;
    try {
      await invoke<string>("read_external_file", { path: loc.fullPath });
      const { openFile, openExternalFile } = useWorkspaceStore.getState();
      openFileFromAbsolutePath(loc.fullPath, openFile, openExternalFile);
    } catch {
      toast.error("file doesn't exist");
    }
  };

  const diffMetadata = useMemo(() => {
    if (!hasDiff || !toolCall.diffData) return null;
    const filename =
      toolCall.diffData.path.split("/").pop() || toolCall.diffData.path;
    try {
      return parseDiffFromFile(
        { name: filename, contents: toolCall.diffData.oldText ?? "" },
        { name: filename, contents: toolCall.diffData.newText ?? "" },
      );
    } catch {
      return null;
    }
  }, [hasDiff, toolCall.diffData]);

  const label = useMemo(() => {
    const base = subject ? `${verb} ${subject}` : verb;
    if (toolCall.kind === "think" && !isActive) {
      const duration = formatToolDuration(toolCall.startedAt);
      return `${base} · ${duration}`;
    }
    return base;
  }, [verb, subject, toolCall.kind, toolCall.startedAt, isActive]);

  return (
    <div className="px-1.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors max-w-full overflow-hidden"
        onClick={() => hasDetails && setExpanded((value) => !value)}
      >
        <span
          className={cn(
            "font-medium text-sm truncate",
            isActive
              ? [
                  "bg-[linear-gradient(to_right,var(--muted-foreground)_40%,var(--foreground)_60%,var(--muted-foreground)_80%)]",
                  "bg-size-[200%_auto] bg-clip-text text-transparent",
                  "animate-[shimmer_4s_infinite_linear]",
                ]
              : "text-muted-foreground",
          )}
        >
          {isClickableFile && !isActive ? (
            <>
              {verb}{" "}
              <span
                role="link"
                tabIndex={0}
                className="underline decoration-muted-foreground hover:decoration-foreground hover:text-foreground cursor-pointer transition-colors"
                onClick={handleFileClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    handleFileClick(e as unknown as React.MouseEvent);
                }}
              >
                {subject}
              </span>
            </>
          ) : (
            label
          )}
        </span>
        {hasDetails && (
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 transition-transform",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>
      {expanded && hasDetails && (
        <div className="pl-1 pt-1.5 space-y-1.5">
          {toolCall.locations &&
            toolCall.locations.length > 0 &&
            !diffMetadata && (
              <div className="space-y-0.5">
                {toolCall.locations.map((locationItem) => (
                  <div
                    key={locationItem}
                    className="text-xs text-muted-foreground font-mono truncate lowercase"
                  >
                    {locationItem}
                  </div>
                ))}
              </div>
            )}
          {diffMetadata && (
            <div className="-ml-2.5 -mr-1.5 rounded-lg border border-border overflow-hidden text-[11px] [--diffs-font-size:11px] [--diffs-line-height:16px] my-4">
              <div
                className="flex items-center justify-between px-2.5 py-1.5 bg-muted/30 cursor-pointer select-none border-b border-border"
                onClick={(e) => {
                  e.stopPropagation();
                  setDiffExpanded((v) => !v);
                }}
              >
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                  {diffExpanded ? (
                    <ChevronDown className="size-3 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0" />
                  )}
                  <span className="truncate font-mono">
                    {toolCall.diffData?.path.split("/").pop() ||
                      toolCall.diffData?.path}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setModalOpen(true);
                  }}
                  className="flex items-center justify-center p-0.5 pl-1 rounded hover:bg-white/10 transition-colors shrink-0"
                >
                  <Maximize2 className="size-3" />
                </button>
              </div>
              <div
                className={cn(
                  "overflow-auto",
                  !diffExpanded && "max-h-[125px]",
                )}
              >
                <FileDiff
                  fileDiff={diffMetadata}
                  options={{
                    diffStyle: "unified",
                    lineDiffType: "word",
                    diffIndicators: "none",
                    theme: "pierre-dark",
                    disableFileHeader: true,
                    disableLineNumbers: true,
                    overflow: "wrap",
                  }}
                />
              </div>
            </div>
          )}
          {toolCall.content && !hasDiff && (
            <pre className="text-xs text-muted-foreground overflow-x-auto lowercase">
              {toolCall.content}
            </pre>
          )}
        </div>
      )}
      {modalOpen && toolCall.diffData && (
        <DiffModal
          diffData={toolCall.diffData}
          open={modalOpen}
          onOpenChange={setModalOpen}
        />
      )}
    </div>
  );
});
