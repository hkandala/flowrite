import { useWorkspaceStore } from "@/store/workspace-store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AiChatPane } from "./ai-chat-pane";
import { CommentsPane } from "./comments-pane";

export function RightPanel() {
  const rightPanelTab = useWorkspaceStore((s) => s.rightPanelTab);
  const setRightPanelTab = useWorkspaceStore((s) => s.setRightPanelTab);

  return (
    <Tabs
      value={rightPanelTab}
      onValueChange={(v) => setRightPanelTab(v as "chat" | "comments")}
      className="h-full flex flex-col pt-4 pl-3"
    >
      <TabsList>
        <TabsTrigger value="chat">chat</TabsTrigger>
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
