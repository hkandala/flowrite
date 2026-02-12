import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PermissionRequest } from "@/store/agent-store";

interface PermissionDialogProps {
  permission: PermissionRequest;
  isResponding: boolean;
  onRespond: (requestId: string, optionId: string) => void;
}

export function PermissionDialog({
  permission,
  isResponding,
  onRespond,
}: PermissionDialogProps) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/8 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm text-foreground">
            Agent needs permission to continue.
          </p>
          <p className="text-xs text-muted-foreground">
            Tool call:{" "}
            <span className="font-mono">{permission.toolCallId}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {permission.options.map((option) => (
          <Button
            key={option.optionId}
            type="button"
            variant={
              option.kind.startsWith("reject") ? "destructive" : "outline"
            }
            size="sm"
            disabled={!isResponding}
            onClick={() => onRespond(permission.requestId, option.optionId)}
          >
            {option.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
