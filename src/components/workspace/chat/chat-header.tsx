import { useState } from "react";
import { Unplug, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/store/agent-store";

import { AgentSettingsModal } from "./agent-settings-modal";

export function ChatHeader() {
  const activeChatTabId = useAgentStore((s) => s.activeChatTabId);
  const activeTab = useAgentStore((s) =>
    s.chatTabs.find((t) => t.id === s.activeChatTabId),
  );
  const sessionAgentName = useAgentStore((s) => {
    const tab = s.chatTabs.find((t) => t.id === s.activeChatTabId);
    return tab?.sessionId ? s.sessions[tab.sessionId]?.agentName : undefined;
  });
  const closeTab = useAgentStore((s) => s.closeTab);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const agentName = sessionAgentName ?? activeTab?.label ?? "ai agent";

  return (
    <div className="shrink-0 px-1 py-2 pr-5">
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-border/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm text-foreground truncate min-w-0 pl-2">
            {agentName.toLowerCase()}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="agent settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="disconnect"
            onClick={() => activeChatTabId && closeTab(activeChatTabId)}
          >
            <Unplug className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <AgentSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
