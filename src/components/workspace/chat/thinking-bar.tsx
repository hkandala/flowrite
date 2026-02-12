import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

interface ThinkingBarProps {
  thinking: string;
}

export function ThinkingBar({ thinking }: ThinkingBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (!thinking.trim()) return null;

  return (
    <div className="rounded-md border border-border/60 bg-muted/35">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-primary/70 animate-pulse" />
          <Brain className="h-3.5 w-3.5" />
          <span>Thinking...</span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <div className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {thinking}
          </div>
        </div>
      )}
    </div>
  );
}
