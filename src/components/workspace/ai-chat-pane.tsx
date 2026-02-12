import { useMemo, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup } from "@/components/ui/input-group";
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

  const configuredAgents = useMemo(
    () => agents.filter((agent) => agent.commandConfigured),
    [agents],
  );
  const selectedAgent = useMemo(
    () =>
      configuredAgents.find((agent) => agent.id === selectedAgentId) ?? null,
    [configuredAgents, selectedAgentId],
  );

  if (!activeSessionId) {
    return (
      <div className="h-full flex flex-col p-3 text-muted-foreground">
        <div className="flex-1 flex flex-col items-center justify-center gap-5 text-muted-foreground px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-foreground/8">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="text-sm">talk to ai agent</span>

          <div className="w-full max-w-74">
            <InputGroup className="bg-transparent dark:bg-transparent">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1 justify-between rounded-none border-0 shadow-none h-8 text-sm text-foreground"
                  >
                    <span className="truncate">
                      {selectedAgent?.name ?? "select an agent..."}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="min-w-(--radix-dropdown-menu-trigger-width)"
                >
                  {configuredAgents.length === 0 ? (
                    <DropdownMenuItem disabled>
                      no configured agents
                    </DropdownMenuItem>
                  ) : (
                    configuredAgents.map((agent) => (
                      <DropdownMenuItem
                        key={agent.id}
                        onClick={() => selectAgent(agent.id)}
                      >
                        {agent.name}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </InputGroup>

            <Button
              type="button"
              variant="glass"
              className="mt-2 w-full"
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

          {connectionError && (
            <p className="text-xs text-red-500 text-center max-w-xs">
              {connectionError}
            </p>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          className="mb-4 w-fit self-center"
          onClick={() => setSettingsOpen(true)}
        >
          configure acp agents
        </Button>

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

      <div className="flex-1 min-h-0 overflow-y-auto py-3 pr-5 space-y-3">
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
