import { useWorkspaceStore } from "@/store/workspace-store";
import { useAgentStore } from "@/store/agent-store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AiChatPane } from "./ai-chat-pane";
import { CommentsPane } from "./comments-pane";

export function RightPanel() {
  const rightPanelTab = useWorkspaceStore((s) => s.rightPanelTab);
  const setRightPanelTab = useWorkspaceStore((s) => s.setRightPanelTab);
  const connectionStatus = useAgentStore((s) => s.connectionStatus);

  const statusDotClass =
    connectionStatus === "connected"
      ? "bg-emerald-500"
      : connectionStatus === "connecting"
        ? "bg-amber-500"
        : connectionStatus === "error"
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
