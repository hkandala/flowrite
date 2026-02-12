import { RefreshCw, Settings, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/store/agent-store";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
  onOpenSettings: () => void;
}

const statusDotClass = {
  disconnected: "bg-zinc-500/70",
  connecting: "bg-amber-500",
  connected: "bg-emerald-500",
  error: "bg-red-500",
};

export function ChatHeader({ onOpenSettings }: ChatHeaderProps) {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const agentName = useAgentStore((s) => s.agentName);
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const newChat = useAgentStore((s) => s.newChat);
  const connect = useAgentStore((s) => s.connect);
  const disconnect = useAgentStore((s) => s.disconnect);

  return (
    <div className="shrink-0 border-b border-border/60 px-3 py-2 flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-2 w-2 rounded-full",
            statusDotClass[connectionStatus],
          )}
        />
        <span className="text-sm text-foreground truncate">
          {agentName ?? "ai agent"}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {connectionStatus === "error" && activeAgentId && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void connect(activeAgentId)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            reconnect
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void newChat()}
        >
          new chat
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onOpenSettings}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={disconnect}
        >
          <Unplug className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
