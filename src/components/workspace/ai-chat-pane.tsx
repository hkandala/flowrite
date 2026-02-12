import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/store/agent-store";

import { AgentSettingsModal } from "./chat/agent-settings-modal";
import { ChatHeader } from "./chat/chat-header";
import { ChatInput } from "./chat/chat-input";
import { ChatMessage } from "./chat/chat-message";
import { PermissionDialog } from "./chat/permission-dialog";

export function AiChatPane() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const activeSessionId = useAgentStore((s) => s.activeSessionId);
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const connectionError = useAgentStore((s) => s.connectionError);
  const messages = useAgentStore((s) => s.messages);
  const pendingPermission = useAgentStore((s) => s.pendingPermission);
  const isResponding = useAgentStore((s) => s.isResponding);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const connect = useAgentStore((s) => s.connect);
  const respondPermission = useAgentStore((s) => s.respondPermission);

  const listRef = useRef<HTMLDivElement | null>(null);

  const configuredAgents = useMemo(
    () => agents.filter((agent) => agent.commandConfigured),
    [agents],
  );

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, isResponding, pendingPermission]);

  if (!activeSessionId) {
    return (
      <div className="h-full flex flex-col p-3 text-muted-foreground">
        <div className="flex-1 flex flex-col items-center justify-center gap-5 text-muted-foreground rounded-xl border border-foreground/8 px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-foreground/8">
            <MessageCircle className="h-5 w-5" />
          </div>
          <span className="text-sm">start an ai agent session</span>

          <div className="w-full max-w-xs space-y-2">
            <label className="block text-xs text-muted-foreground">
              configured agents
            </label>
            <select
              value={selectedAgentId ?? ""}
              className="w-full h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
              onChange={(event) => selectAgent(event.target.value || null)}
            >
              <option value="">select an agent...</option>
              {configuredAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>

          {connectionError && (
            <p className="text-xs text-red-500 text-center max-w-xs">
              {connectionError}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              disabled={
                !selectedAgentId ||
                configuredAgents.length === 0 ||
                connectionStatus === "connecting"
              }
              onClick={() => selectedAgentId && void connect(selectedAgentId)}
            >
              {connectionStatus === "connecting"
                ? "starting..."
                : connectionStatus === "error"
                  ? "reconnect"
                  : "start session"}
            </Button>
          </div>
        </div>

        <AgentSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <ChatHeader onOpenSettings={() => setSettingsOpen(true)} />

      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3"
      >
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
      </div>

      {pendingPermission && (
        <div className="px-3 pb-2">
          <PermissionDialog
            permission={pendingPermission}
            isResponding={isResponding}
            onRespond={(requestId, optionId) =>
              void respondPermission(requestId, optionId)
            }
          />
        </div>
      )}

      <ChatInput />

      <AgentSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
