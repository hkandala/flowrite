import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ToolCall } from "@/store/agent-store";

interface ToolCallBlockProps {
  toolCall: ToolCall;
}

/** Extract a clean file name from a location path like "/a/b/file.md:0" */
const cleanLocation = (
  location: string,
): { name: string; line: string | null } => {
  // Split off :lineNumber suffix
  const colonMatch = location.match(/^(.+?):(\d+(?::\d+)?)$/);
  const path = colonMatch ? colonMatch[1] : location;
  const linePart = colonMatch ? colonMatch[2] : null;

  const name = path.split("/").filter(Boolean).pop() || path;

  // ":0" means full file — don't show it
  const line = linePart && linePart !== "0" ? linePart : null;

  return { name: name.toLowerCase(), line };
};

const deriveLabel = (toolCall: ToolCall): string => {
  const location = toolCall.locations?.[0];
  const loc = location ? cleanLocation(location) : null;
  const fileName = loc?.name || null;
  const lineRange = loc?.line ? `:${loc.line}` : "";

  const title = toolCall.title?.toLowerCase() || "";
  const generic = [
    "read",
    "write",
    "edit",
    "delete",
    "search",
    "find",
    "execute",
    "run",
    "bash",
    "fetch",
    "think",
    "move",
    "tool",
    "list",
  ];
  const isGeneric = generic.some((g) => title.startsWith(g));
  const subject = fileName || (!isGeneric && title) || null;

  switch (toolCall.kind) {
    case "read": {
      const file = subject || "file";
      return `reading ${file}${lineRange}`;
    }
    case "edit": {
      const file = subject || "file";
      return `editing ${file}${lineRange}`;
    }
    case "delete": {
      const file = subject || "file";
      return `deleting ${file}`;
    }
    case "search": {
      const query = !isGeneric && title ? title : null;
      return query ? `searching ${query}` : "searching";
    }
    case "execute": {
      const cmd = !isGeneric && title ? title : null;
      return cmd ? `running ${cmd}` : "running command";
    }
    case "fetch": {
      const target = subject || null;
      return target ? `fetching ${target}` : "fetching";
    }
    case "think":
      return "thinking";
    case "move": {
      const file = subject || "file";
      return `moving ${file}`;
    }
    default:
      return subject || "running tool";
  }
};

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isActive =
    toolCall.status === "pending" || toolCall.status === "in_progress";
  const label = deriveLabel(toolCall);

  const hasDetails =
    (toolCall.locations && toolCall.locations.length > 0) || toolCall.content;

  return (
    <div className="px-1.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => hasDetails && setExpanded((value) => !value)}
      >
        <span
          className={cn(
            "font-medium text-sm",
            isActive
              ? [
                  "bg-[linear-gradient(to_right,var(--muted-foreground)_40%,var(--foreground)_60%,var(--muted-foreground)_80%)]",
                  "bg-size-[200%_auto] bg-clip-text text-transparent",
                  "animate-[shimmer_4s_infinite_linear]",
                ]
              : "text-muted-foreground",
          )}
        >
          {label}
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
          {toolCall.locations && toolCall.locations.length > 0 && (
            <div className="space-y-0.5">
              {toolCall.locations.map((location) => (
                <div
                  key={location}
                  className="text-xs text-muted-foreground font-mono truncate lowercase"
                >
                  {location}
                </div>
              ))}
            </div>
          )}
          {toolCall.content && (
            <pre className="text-xs text-muted-foreground overflow-x-auto lowercase">
              {toolCall.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
