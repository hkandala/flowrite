import { memo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

interface ThinkingBarProps {
  thinking: string;
  isStreaming: boolean;
  thinkingStartedAt: number | null;
}

const formatDuration = (startedAt: number): string => {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `thought for ${m}m ${s}s`;
  }
  return `thought for ${seconds}s`;
};

export const ThinkingBar = memo(function ThinkingBar({
  thinking,
  isStreaming,
  thinkingStartedAt,
}: ThinkingBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (!thinking.trim()) return null;

  const label = isStreaming
    ? "thinking..."
    : thinkingStartedAt
      ? formatDuration(thinkingStartedAt)
      : "thought";

  return (
    <div className="px-1.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          className={cn(
            "font-medium text-sm",
            isStreaming
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
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded && (
        <div className="pl-1 pt-1.5">
          <div className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap wrap-break-word">
            {thinking}
          </div>
        </div>
      )}
    </div>
  );
});
