import { Plus, RefreshCw, SlidersHorizontal, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/store/agent-store";

interface ChatHeaderProps {
  onOpenSettings: () => void;
}

export function ChatHeader({ onOpenSettings }: ChatHeaderProps) {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const agentName = useAgentStore((s) => s.agentName);
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const newChat = useAgentStore((s) => s.newChat);
  const connect = useAgentStore((s) => s.connect);
  const disconnect = useAgentStore((s) => s.disconnect);

  return (
    <div className="shrink-0 px-3 py-2 pr-5">
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-border/60">
        <span className="text-sm text-foreground truncate min-w-0">
          {agentName?.toLowerCase() ?? "ai agent"}
        </span>

        <div className="flex items-center gap-1.5">
          {connectionStatus === "error" && activeAgentId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="reconnect"
              onClick={() => void connect(activeAgentId)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              reconnect
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="new chat"
            onClick={() => void newChat()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="settings"
            onClick={onOpenSettings}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="disconnect"
            onClick={disconnect}
          >
            <Unplug className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
