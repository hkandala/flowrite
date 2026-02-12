import { useState } from "react";
import {
  Brain,
  ChevronDown,
  Eye,
  FilePenLine,
  Globe,
  Move,
  Search,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ToolCall } from "@/store/agent-store";

interface ToolCallBlockProps {
  toolCall: ToolCall;
}

const statusClasses: Record<ToolCall["status"], string> = {
  pending: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  in_progress: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  completed: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-500 border-red-500/30",
};

const kindIcon = (kind: string) => {
  switch (kind) {
    case "read":
      return Eye;
    case "edit":
      return FilePenLine;
    case "delete":
      return Trash2;
    case "search":
      return Search;
    case "execute":
      return Terminal;
    case "fetch":
      return Globe;
    case "think":
      return Brain;
    case "move":
      return Move;
    default:
      return Wrench;
  }
};

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = kindIcon(toolCall.kind);

  return (
    <div className="rounded-md border border-border/60 bg-muted/25">
      <button
        type="button"
        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm text-foreground truncate">
            {toolCall.title}
          </span>
        </span>
        <span className="inline-flex items-center gap-2 shrink-0">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] uppercase tracking-wide",
              statusClasses[toolCall.status],
            )}
          >
            {toolCall.status.replace("_", " ")}
          </Badge>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {toolCall.locations && toolCall.locations.length > 0 && (
            <div className="space-y-1">
              {toolCall.locations.map((location) => (
                <div
                  key={location}
                  className="text-xs text-muted-foreground font-mono truncate"
                >
                  {location}
                </div>
              ))}
            </div>
          )}
          {toolCall.content && (
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words rounded border border-border/60 bg-background/55 px-2 py-1.5">
              {toolCall.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
