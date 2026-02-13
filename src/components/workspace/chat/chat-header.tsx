import { ArrowLeft, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/store/agent-store";

export function ChatHeader() {
  const activeChatTabId = useAgentStore((s) => s.activeChatTabId);
  const activeTab = useAgentStore((s) =>
    s.chatTabs.find((t) => t.id === s.activeChatTabId),
  );
  const session = useAgentStore((s) => {
    const tab = s.chatTabs.find((t) => t.id === s.activeChatTabId);
    return tab?.sessionId ? s.sessions[tab.sessionId] : null;
  });
  const closeTab = useAgentStore((s) => s.closeTab);
  const newChat = useAgentStore((s) => s.newChat);

  const agentName = session?.agentName ?? activeTab?.label ?? "ai agent";
  const sessionBusy = !session || activeTab?.isConnecting;

  return (
    <div className="shrink-0 px-1 py-2 pr-5">
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-border/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="back"
            onClick={() => activeChatTabId && closeTab(activeChatTabId)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-sm text-foreground truncate min-w-0">
            {agentName.toLowerCase()}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="new chat"
            disabled={!!sessionBusy}
            onClick={() => void newChat()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
