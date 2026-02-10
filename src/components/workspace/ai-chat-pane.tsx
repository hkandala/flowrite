import { MessageCircle } from "lucide-react";

export function AiChatPane() {
  return (
    <div className="h-full flex flex-col p-3 text-muted-foreground">
      <div className="flex-1 flex flex-col items-center justify-center gap-5 text-muted-foreground">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-foreground/8">
          <MessageCircle className="h-5 w-5" />
        </div>
        <span className="text-sm">ask ai agent</span>
      </div>
    </div>
  );
}
