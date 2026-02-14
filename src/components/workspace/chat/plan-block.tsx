import { Check, Circle, CircleDot } from "lucide-react";

import type { PlanEntry } from "@/store/agent-store";

interface PlanBlockProps {
  entries: PlanEntry[];
}

const statusIcon = (status: PlanEntry["status"]) => {
  switch (status) {
    case "completed":
      return <Check className="h-3.5 w-3.5 text-emerald-500" />;
    case "in_progress":
      return <CircleDot className="h-3.5 w-3.5 text-blue-500" />;
    default:
      return <Circle className="h-3 w-3 text-muted-foreground" />;
  }
};

export function PlanBlock({ entries }: PlanBlockProps) {
  if (entries.length === 0) return null;

  return (
    <div className="rounded-md border border-border/60 bg-muted/25 px-3 py-2 space-y-1.5">
      {entries.map((entry, index) => (
        <div
          key={`${entry.content}-${index}`}
          className="flex items-start gap-2"
        >
          <span className="pt-0.5">{statusIcon(entry.status)}</span>
          <span className="text-sm text-foreground/90">
            {entry.content}
          </span>
        </div>
      ))}
    </div>
  );
}
