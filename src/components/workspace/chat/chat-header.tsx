import { ArrowLeft, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/store/agent-store";

export function ChatHeader() {
  const agentName = useAgentStore((s) => s.agentName);
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const isCreatingSession = useAgentStore((s) => s.isCreatingSession);
  const newChat = useAgentStore((s) => s.newChat);
  const endSessionAndGoBack = useAgentStore((s) => s.endSessionAndGoBack);

  const sessionBusy = connectionStatus !== "connected" || isCreatingSession;

  return (
    <div className="shrink-0 px-1 py-2 pr-5">
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-border/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="back"
            onClick={endSessionAndGoBack}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-sm text-foreground truncate min-w-0">
            {agentName?.toLowerCase() ?? "ai agent"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="new chat"
            disabled={sessionBusy}
            onClick={() => void newChat()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
