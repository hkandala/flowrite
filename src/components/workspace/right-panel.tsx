import { useWorkspaceStore } from "@/store/workspace-store";
import { useAgentStore } from "@/store/agent-store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { AiChatPane } from "./ai-chat-pane";
import { CommentsPane } from "./comments-pane";

export function RightPanel() {
  const rightPanelTab = useWorkspaceStore((s) => s.rightPanelTab);
  const setRightPanelTab = useWorkspaceStore((s) => s.setRightPanelTab);
  const commentCount = useWorkspaceStore((s) => s.commentCount);

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
            const chatEditor = useWorkspaceStore.getState().chatEditor;
            if (chatEditor) {
              chatEditor.tf.focus({ edge: "end" });
            }
          });
        }
      }}
      className="h-full flex flex-col pt-4 pl-2"
    >
      <TabsList>
        <TabsTrigger value="chat" className="relative">
          chat
          {hasTab && (
            <span className={`h-3 w-3 rounded-full ${statusDotClass}`} />
          )}
        </TabsTrigger>
        <TabsTrigger value="comments" className="relative">
          comments
          {commentCount > 0 && (
            <Badge
              variant="outline"
              className="h-4 min-w-4 px-1.5 text-xs border bg-foreground/80 text-background"
            >
              {commentCount}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="chat"
        className="flex-1 min-h-0"
        forceMount
        hidden={rightPanelTab !== "chat"}
      >
        <AiChatPane />
      </TabsContent>
      <TabsContent
        value="comments"
        className="flex-1 min-h-0"
        forceMount
        hidden={rightPanelTab !== "comments"}
      >
        <CommentsPane />
      </TabsContent>
    </Tabs>
  );
}
