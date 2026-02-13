import { useWorkspaceStore } from "@/store/workspace-store";
import { useAgentStore } from "@/store/agent-store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AiChatPane } from "./ai-chat-pane";
import { CommentsPane } from "./comments-pane";

export function RightPanel() {
  const rightPanelTab = useWorkspaceStore((s) => s.rightPanelTab);
  const setRightPanelTab = useWorkspaceStore((s) => s.setRightPanelTab);

  const activeTab = useAgentStore((s) =>
    s.chatTabs.find((t) => t.id === s.activeChatTabId),
  );
  const session = useAgentStore((s) => {
    const tab = s.chatTabs.find((t) => t.id === s.activeChatTabId);
    return tab?.sessionId ? s.sessions[tab.sessionId] : null;
  });

  const hasTab = !!activeTab;
  const isConnecting = activeTab?.isConnecting ?? false;
  const hasError = !!activeTab?.connectionError;
  const isConnected = hasTab && !isConnecting && !hasError && !!session;

  const statusDotClass = isConnected
    ? "bg-emerald-500"
    : isConnecting
      ? "bg-amber-500"
      : hasError
        ? "bg-red-500"
        : "bg-zinc-500";

  return (
    <Tabs
      value={rightPanelTab}
      onValueChange={(value) => {
        const next = value as "chat" | "comments";
        setRightPanelTab(next);
        if (next === "chat") {
          requestAnimationFrame(() => {
            const input = document.getElementById(
              "agent-chat-input",
            ) as HTMLTextAreaElement | null;
            if (!input) return;
            input.focus();
            const end = input.value.length;
            input.setSelectionRange(end, end);
          });
        }
      }}
      className="h-full flex flex-col pt-4 pl-2"
    >
      <TabsList>
        <TabsTrigger value="chat">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`} />
            <span>chat</span>
          </span>
        </TabsTrigger>
        <TabsTrigger value="comments">comments</TabsTrigger>
      </TabsList>
      <TabsContent value="chat" className="flex-1 min-h-0">
        <AiChatPane />
      </TabsContent>
      <TabsContent value="comments" className="flex-1 min-h-0">
        <CommentsPane />
      </TabsContent>
    </Tabs>
  );
}
