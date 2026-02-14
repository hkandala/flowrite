import { ChevronDown, KeyRound, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup } from "@/components/ui/input-group";
import { ScrollButton } from "@/components/ui/scroll-button";
import type { ConnectionError } from "@/store/agent-store";
import { useAgentStore } from "@/store/agent-store";

import { ChatHeader } from "./chat/chat-header";
import { AgentSettingsModal } from "./chat/agent-settings-modal";
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

function AgentSelectionView() {
  const agents = useAgentStore((s) => s.agents);
  const connect = useAgentStore((s) => s.connect);
  const lastSelectedAgentId = useAgentStore((s) => s.lastSelectedAgentId);
  const setLastSelectedAgent = useAgentStore((s) => s.setLastSelectedAgent);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const configuredAgents = useMemo(
    () => agents.filter((agent) => agent.commandConfigured),
    [agents],
  );
  const selectedAgent = useMemo(
    () =>
      configuredAgents.find((agent) => agent.id === lastSelectedAgentId) ??
      null,
    [configuredAgents, lastSelectedAgentId],
  );

  // Use persisted selection, fall back to first configured agent
  const effectiveSelectedId =
    (selectedAgent ? lastSelectedAgentId : null) ??
    configuredAgents[0]?.id ??
    null;

  return (
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
                  {selectedAgent?.name ??
                    configuredAgents.find((a) => a.id === effectiveSelectedId)
                      ?.name ??
                    "select an agent..."}
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
                    onClick={() => void setLastSelectedAgent(agent.id)}
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
          disabled={!effectiveSelectedId || configuredAgents.length === 0}
          onClick={() =>
            effectiveSelectedId && void connect(effectiveSelectedId)
          }
        >
          start session
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="mt-1 w-full text-xs text-muted-foreground"
          onClick={() => setSettingsOpen(true)}
        >
          configure acp agents
        </Button>
        <AgentSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      </div>
    </div>
  );
}

export function AiChatPane() {
  const chatTabs = useAgentStore((s) => s.chatTabs);
  const activeChatTabId = useAgentStore((s) => s.activeChatTabId);
  const activeTab = useAgentStore((s) =>
    s.chatTabs.find((t) => t.id === s.activeChatTabId),
  );
  const session = useAgentStore((s) => {
    const tab = s.chatTabs.find((t) => t.id === s.activeChatTabId);
    return tab?.sessionId ? s.sessions[tab.sessionId] : null;
  });
  const respondPermission = useAgentStore((s) => s.respondPermission);

  const hasActiveTab = chatTabs.length > 0 && !!activeChatTabId && !!activeTab;

  const isConnecting = activeTab?.isConnecting ?? false;
  const connectionError = activeTab?.connectionError ?? null;
  const messages = session?.messages ?? [];
  const pendingPermissions = session?.pendingPermissions ?? [];
  const isResponding = session?.isResponding ?? false;

  return (
    <div className="h-full flex flex-col">
      {hasActiveTab && <ChatHeader />}

      {!hasActiveTab ? (
        <AgentSelectionView />
      ) : (
        <ChatContainerRoot className="flex-1 min-h-0 py-3 pr-5 select-text">
          <ChatContainerContent className="min-h-full space-y-3">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                {connectionError ? (
                  <ConnectionErrorDisplay error={connectionError} />
                ) : (
                  <>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-foreground/8">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <span className="text-sm">
                      {isConnecting
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
            <ChatContainerScrollAnchor />
          </ChatContainerContent>
          <div className="absolute bottom-4 right-5">
            <ScrollButton />
          </div>
        </ChatContainerRoot>
      )}

      {pendingPermissions.map((permission) => {
        const matchedToolCall = messages
          .flatMap((m) => m.toolCalls)
          .find((tc) => tc.id === permission.toolCallId);
        return (
          <div key={permission.requestId} className="pr-3.5 pb-2">
            <PermissionDialog
              permission={permission}
              matchedToolCall={matchedToolCall}
              isResponding={isResponding}
              onRespond={(requestId, optionId) => {
                if (session) {
                  void respondPermission(
                    session.sessionId,
                    requestId,
                    optionId,
                  );
                }
              }}
            />
          </div>
        );
      })}

      <ChatInput />
    </div>
  );
}
