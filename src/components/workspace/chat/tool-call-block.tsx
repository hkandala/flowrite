import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { openFileFromAbsolutePath } from "@/lib/utils";
import { cleanLocation, deriveLabel } from "@/lib/tool-call-label";
import { useWorkspaceStore } from "@/store/workspace-store";
import type { ToolCall } from "@/store/agent-store";

interface ToolCallBlockProps {
  toolCall: ToolCall;
}

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
  const hasDiff =
    toolCall.diffData?.newText != null &&
    (toolCall.kind === "edit" || toolCall.kind === "read");

  const [expanded, setExpanded] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(false);

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

  const label = subject ? `${verb} ${subject}` : verb;

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
            <div
              className={cn(
                "rounded-lg border border-border overflow-auto text-[11px] [--diffs-font-size:11px] [--diffs-line-height:16px]",
                !diffExpanded && "max-h-[125px]",
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (!diffExpanded) setDiffExpanded(true);
              }}
            >
              <FileDiff
                fileDiff={diffMetadata}
                options={{
                  diffStyle: "unified",
                  lineDiffType: "word",
                  theme: "pierre-dark",
                  disableFileHeader: true,
                  disableLineNumbers: true,
                }}
              />
            </div>
          )}
          {toolCall.content && !hasDiff && (
            <pre className="text-xs text-muted-foreground overflow-x-auto lowercase">
              {toolCall.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
