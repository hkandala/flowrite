import { ChevronDown, KeyRound, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup } from "@/components/ui/input-group";
import type { ConnectionError } from "@/store/agent-store";
import { useAgentStore } from "@/store/agent-store";

import { AgentSettingsModal } from "./chat/agent-settings-modal";
import { ChatHeader } from "./chat/chat-header";
import { ChatInput } from "./chat/chat-input";
import { ChatMessage } from "./chat/chat-message";
import { PermissionDialog } from "./chat/permission-dialog";

function ConnectionErrorDisplay({ error }: { error: ConnectionError }) {
  if (error.kind === "auth_required") {
    return (
      <div className="flex flex-col items-center gap-2 max-w-xs text-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-foreground/8">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-xs font-medium text-foreground/70">
          authentication required
        </p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
        {error.authMethods && error.authMethods.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            {error.authMethods.map((method) => (
              <div key={method.id} className="text-xs text-muted-foreground/80">
                <span className="font-medium text-foreground/60">
                  {method.name}
                </span>
                {method.description && (
                  <span> &mdash; {method.description}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (error.kind === "timeout") {
    return (
      <div className="flex flex-col items-center gap-2 max-w-xs text-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-foreground/8">
          <TriangleAlert className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-xs font-medium text-foreground/70">
          agent timed out
        </p>
        <p className="text-xs text-muted-foreground">
          the agent took too long to respond
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 max-w-xs text-center">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-destructive/20">
        <TriangleAlert className="h-4 w-4 text-destructive/70" />
      </div>
      <p className="text-xs font-medium text-foreground/70">
        {error.kind === "crashed"
          ? "agent process stopped unexpectedly"
          : "failed to connect to agent"}
      </p>
      <p className="text-xs text-muted-foreground">
        check the agent configuration and try again
      </p>
    </div>
  );
}

export function AiChatPane() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const activeSessionId = useAgentStore((s) => s.activeSessionId);
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const connectionError = useAgentStore((s) => s.connectionError);
  const agentName = useAgentStore((s) => s.agentName);
  const messages = useAgentStore((s) => s.messages);
  const isCreatingSession = useAgentStore((s) => s.isCreatingSession);
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

  const showChatView =
    activeSessionId ||
    connectionStatus === "connecting" ||
    (connectionStatus === "error" && agentName);

  if (!showChatView) {
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
              disabled={!selectedAgentId || configuredAgents.length === 0}
              onClick={() => selectedAgentId && void connect(selectedAgentId)}
            >
              {connectionStatus === "error" ? "reconnect" : "start session"}
            </Button>
          </div>

          {connectionError && (
            <ConnectionErrorDisplay error={connectionError} />
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
      <ChatHeader />

      <div className="flex-1 min-h-0 overflow-y-auto py-3 pr-5 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
            {connectionError ? (
              <ConnectionErrorDisplay error={connectionError} />
            ) : (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-foreground/8">
                  <Sparkles className="h-5 w-5" />
                </div>
                <span className="text-sm">
                  {isCreatingSession || connectionStatus === "connecting"
                    ? "connecting to agent..."
                    : "start a conversation"}
                </span>
              </>
            )}
          </div>
        ) : (
          messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))
        )}
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
    </div>
  );
}
